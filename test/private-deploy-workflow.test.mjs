import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/private-deploy.yml", import.meta.url), "utf8");
const scripts = [...workflow.matchAll(/        run: \|\n((?:          .*\n|\n)+)/g)]
  .map((match) => match[1].replace(/^ {10}/gm, ""));
const authModeScript = scripts[0];
const oidcValidationScript = scripts[1];
const deploymentValidationScript = scripts[2];
const postScript = scripts[3];
const oauthValidationScript = scripts[4];
const valid = {
  DEPLOYMENT_URL: "https://internal.service:8443/api/deploy?mode=normal",
  DEPLOYMENT_PAYLOAD: '{"version":"1.2.3"}',
  API_KEY_HEADER: "x-api-key",
  API_KEY: "secret-key",
  TAILSCALE_AUTH_MODE: "oidc",
  TAILSCALE_CLIENT_ID: "client",
  TAILSCALE_AUDIENCE: "audience",
  TAILSCALE_OAUTH_SECRET: "oauth-secret",
  TAILSCALE_TAGS: "tag:ci",
};

function run(script, changes = {}, status = "202", exit = "0") {
  const directory = mkdtempSync(resolve(tmpdir(), "private-deploy-"));
  const capture = resolve(directory, "capture.json");
  writeFileSync(resolve(directory, "curl"), `#!/usr/bin/env python3
import json, os, sys
with open(os.environ["CAPTURE"], "w") as output:
    json.dump({"args": sys.argv[1:], "body": sys.stdin.read()}, output)
sys.stderr.write("MUST NOT APPEAR: " + os.environ["DEPLOYMENT_URL"] + os.environ["API_KEY"])
sys.stdout.write(os.environ["MOCK_STATUS"])
sys.exit(int(os.environ["MOCK_EXIT"]))
`, { mode: 0o700 });
  try {
    const result = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script], {
      encoding: "utf8",
      env: { ...process.env, ...valid, ...changes, PATH: `${directory}:${process.env.PATH}`,
        CAPTURE: capture, MOCK_STATUS: status, MOCK_EXIT: exit },
    });
    let request;
    try { request = JSON.parse(readFileSync(capture, "utf8")); } catch {}
    return { ...result, request };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("declares dual authentication modes with isolated permissions", () => {
  for (const input of ["deployment-url", "deployment-payload", "api-key-header", "tailscale-auth-mode", "tailscale-client-id", "tailscale-audience", "tailscale-tags"]) {
    assert.match(workflow, new RegExp(`      ${input}:\\n`));
  }
  assert.match(workflow, /default: oidc/);
  assert.match(workflow, /tailscale-client-id-secret:\n        description: Tailscale OAuth client ID; required in oauth mode\n        required: false/);
  assert.match(workflow, /tailscale-tags-secret:\n        description: Tailscale tags; required in oauth mode\n        required: false/);
  assert.match(workflow, /tailscale-oauth-secret:\n        description: OAuth client secret; required in oauth mode\n        required: false/);
  assert.match(workflow, /secrets\.tailscale-client-id-secret \|\| inputs\.tailscale-client-id/);
  assert.match(workflow, /secrets\.tailscale-tags-secret \|\| inputs\.tailscale-tags/);
  assert.match(workflow, /permissions: \{\}/);
  assert.doesNotMatch(workflow, /permissions:\n  id-token: write/);
  assert.match(workflow, /deploy-oidc:[\s\S]*?permissions:\n      id-token: write/);
  assert.match(workflow, /deploy-oauth:[\s\S]*?permissions: \{\}/);
  assert.match(workflow, /inputs\.tailscale-auth-mode == 'oidc'/);
  assert.match(workflow, /inputs\.tailscale-auth-mode == 'oauth'/);
  assert.match(workflow, /oauth-secret: \$\{\{ secrets\.tailscale-oauth-secret \}\}/);
  assert.match(workflow, /audience: \$\{\{ inputs\.tailscale-audience \}\}/);
  assert.match(workflow, /validate-auth-mode:[\\s\\S]*?oidc\\|oauth/);
  assert.match(workflow, /- name: Validate OIDC parameters[\s\S]*?TAILSCALE_AUDIENCE/);
  assert.match(workflow, /- name: Validate OAuth parameters[\s\S]*?TAILSCALE_OAUTH_SECRET/);
  assert.equal((workflow.match(/&validate-deployment/g) ?? []).length, 1);
  assert.equal((workflow.match(/&send-deployment/g) ?? []).length, 1);
  assert.equal((workflow.match(/^      - &validate-deployment/gm) ?? []).length, 1);
  assert.equal((workflow.match(/^      - &send-deployment/gm) ?? []).length, 1);
  assert.equal((workflow.match(/^      - \*validate-deployment/gm) ?? []).length, 1);
  assert.equal((workflow.match(/^      - \*send-deployment/gm) ?? []).length, 1);
  assert.match(workflow, /tailscale\/github-action@99a8333667fff04fdd6cffb46dfd409f8329a7bf # v4/);
  assert.equal(scripts.length, 5);
  assert.deepEqual([authModeScript.includes("oidc|oauth"), deploymentValidationScript.includes("urlsplit"), postScript.includes("subprocess.run(command")], [true, true, true]);
});

test("accepts only the supported authentication modes", () => {
  for (const mode of ["oidc", "oauth"]) assert.equal(run(authModeScript, { TAILSCALE_AUTH_MODE: mode }).status, 0);
  const result = run(authModeScript, { TAILSCALE_AUTH_MODE: "unknown" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /oidc or oauth/);
});

test("validates mode-specific Tailscale credentials", () => {
  assert.equal(run(oidcValidationScript).status, 0);
  assert.notEqual(run(oidcValidationScript, { TAILSCALE_AUDIENCE: "" }).status, 0);
  assert.notEqual(run(oidcValidationScript, { TAILSCALE_CLIENT_ID: "  " }).status, 0);
  assert.notEqual(run(oidcValidationScript, { TAILSCALE_TAGS: "\n" }).status, 0);
  const oauth = run(oauthValidationScript, { TAILSCALE_AUTH_MODE: "oauth" });
  assert.equal(oauth.status, 0, oauth.stderr);
  assert.notEqual(run(oauthValidationScript, { TAILSCALE_OAUTH_SECRET: "" }).status, 0);
  assert.notEqual(run(oauthValidationScript, { TAILSCALE_OAUTH_SECRET: "  " }).status, 0);
  assert.notEqual(run(oauthValidationScript, { TAILSCALE_TAGS: "" }).status, 0);
  assert.notEqual(run(oauthValidationScript, { TAILSCALE_CLIENT_ID: "\n" }).status, 0);
});

test("validates deployment URL, JSON, header, and API key before connecting", () => {
  assert.equal(run(deploymentValidationScript).status, 0);
  const invalid = {
    DEPLOYMENT_URL: ["", "ftp://host/deploy", "https:///deploy", "https://user:pass@host", "https://@host", "https://host/#hidden", "https://host/a b", "https://host/\n", "https://host/\u0001", "https://host:99999", "https://host/\\other"],
    DEPLOYMENT_PAYLOAD: ["", "{invalid}", "NaN", "Infinity", '{"a":NaN}'],
    API_KEY_HEADER: ["", "x key", "x:key", "x-key\r\nOther"],
    API_KEY: ["key\nOther", "key\rOther"],
  };
  for (const [variable, values] of Object.entries(invalid)) {
    for (const value of values) {
      const result = run(deploymentValidationScript, { [variable]: value });
      assert.notEqual(result.status, 0, `${variable} accepted ${JSON.stringify(value)}`);
      assert.match(result.stderr, /::error::/);
      assert.doesNotMatch(result.stdout + result.stderr, /secret-key|internal\.service|MUST NOT APPEAR/);
    }
  }
});

test("sends the exact POST without redirects, retries, or secret output", () => {
  const body = JSON.stringify({ data: '$(touch /do-not-run) `id` " Unicode: ñ' });
  const result = run(postScript, { API_KEY_HEADER: "Authorization", API_KEY: "Bearer secret", DEPLOYMENT_PAYLOAD: body });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.request.body, body);
  const args = result.request.args;
  assert.ok(args.includes("Authorization: Bearer secret"));
  assert.equal(args[0], "--disable");
  for (const [flag, value] of Object.entries({
    "--request": "POST", "--url": valid.DEPLOYMENT_URL, "--data-binary": "@-",
    "--output": "/dev/null", "--write-out": "%{http_code}", "--connect-timeout": "10",
    "--max-time": "60", "--retry": "0", "--max-redirs": "0", "--proto": "=http,https", "--noproxy": "*",
  })) assert.equal(args[args.indexOf(flag) + 1], value, flag);
  assert.ok(args.includes("Content-Type: application/json"));
  assert.doesNotMatch(result.stdout + result.stderr, /secret|internal\.service|MUST NOT APPEAR/);
});

for (const status of ["200", "204", "299", "301", "400", "401", "500", "000"]) {
  test(`interprets HTTP ${status} without printing response or data`, () => {
    const result = run(postScript, {}, status);
    assert.equal(result.status === 0, /^2/.test(status));
    assert.doesNotMatch(result.stdout + result.stderr, /secret-key|internal\.service|MUST NOT APPEAR/);
  });
}

test("fails on transport error even if curl emitted a 2xx code", () => {
  const result = run(postScript, {}, "200", "28");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /::error::/);
  assert.doesNotMatch(result.stdout + result.stderr, /secret-key|internal\.service|MUST NOT APPEAR/);
});
