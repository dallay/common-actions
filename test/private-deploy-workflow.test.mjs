import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/private-deploy.yml", import.meta.url), "utf8");
const scripts = [...workflow.matchAll(/        run: \|\n((?:          .*\n|\n)+)/g)]
  .map((match) => match[1].replace(/^ {10}/gm, ""));
const valid = {
  DEPLOYMENT_URL: "https://servicio.interno:8443/api/deploy?modo=normal",
  DEPLOYMENT_PAYLOAD: '{"version":"1.2.3"}',
  API_KEY_HEADER: "x-api-key",
  API_KEY: "clave-privada",
  TAILSCALE_CLIENT_ID: "cliente",
  TAILSCALE_AUDIENCE: "audiencia",
  TAILSCALE_TAGS: "tag:ci",
};

function run(script, changes = {}, status = "202", exit = "0") {
  const directory = mkdtempSync(resolve(tmpdir(), "private-deploy-"));
  const capture = resolve(directory, "capture.json");
  writeFileSync(resolve(directory, "curl"), `#!/usr/bin/env python3
import json, os, sys
with open(os.environ["CAPTURE"], "w") as output:
    json.dump({"args": sys.argv[1:], "body": sys.stdin.read()}, output)
sys.stderr.write("NO DEBE APARECER: " + os.environ["DEPLOYMENT_URL"] + os.environ["API_KEY"])
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
    try { request = JSON.parse(readFileSync(capture, "utf8")); } catch { /* Sin POST. */ }
    return { ...result, request };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("declara contrato, aislamiento, OIDC y serialización sin cancelar", () => {
  for (const input of ["deployment-url", "deployment-payload", "api-key-header", "tailscale-client-id", "tailscale-audience", "tailscale-tags"]) {
    assert.match(workflow, new RegExp(`      ${input}:\\n`));
  }
  assert.match(workflow, /default: x-api-key/);
  assert.match(workflow, /secrets:\n      api-key:\n[^]*?required: true/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /timeout-minutes: 5/);
  assert.match(workflow, /permissions:\n  id-token: write\n/);
  assert.match(workflow, /concurrency:\n  group: private-deploy-\$\{\{ github.repository \}\}-\$\{\{ github.workflow \}\}-\$\{\{ github.ref \}\}-\$\{\{ inputs.deployment-url \}\}\n  cancel-in-progress: false/);
  assert.match(workflow, /deploy:\n    name: Enviar solicitud privada\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - name: Validar parámetros antes de conectar\n        env:\n(?:          [A-Z_]+: .*\n){7}/);
  assert.match(workflow, /- name: Enviar POST sin exponer datos\n        env:\n(?:          (?:DEPLOYMENT_URL|DEPLOYMENT_PAYLOAD|API_KEY_HEADER|API_KEY): .*\n){4}        shell: bash\n/);
  assert.doesNotMatch(workflow, /jobs:\n  deploy:\n[^]*?\n    env:\n/);
  const validationStep = workflow.slice(workflow.indexOf("- name: Validar parámetros"), workflow.indexOf("- name: Conectar a la red"));
  for (const variable of ["DEPLOYMENT_URL", "DEPLOYMENT_PAYLOAD", "API_KEY_HEADER", "API_KEY", "TAILSCALE_CLIENT_ID", "TAILSCALE_AUDIENCE", "TAILSCALE_TAGS"]) {
    assert.match(validationStep, new RegExp(`          ${variable}:`));
  }
  const tailscaleStep = workflow.slice(workflow.indexOf("- name: Conectar a la red"), workflow.indexOf("- name: Enviar POST"));
  assert.doesNotMatch(tailscaleStep, /\n        env:\n/);
  const postStep = workflow.slice(workflow.indexOf("- name: Enviar POST"));
  for (const variable of ["DEPLOYMENT_URL", "DEPLOYMENT_PAYLOAD", "API_KEY_HEADER", "API_KEY"]) {
    assert.match(postStep, new RegExp(`          ${variable}:`));
  }
  for (const variable of ["TAILSCALE_CLIENT_ID", "TAILSCALE_AUDIENCE", "TAILSCALE_TAGS"]) {
    assert.doesNotMatch(postStep, new RegExp(`          ${variable}:`));
  }
  assert.match(workflow, /tailscale\/github-action@99a8333667fff04fdd6cffb46dfd409f8329a7bf # v4/);
  for (const input of ["oauth-client-id", "audience", "tags"]) assert.match(workflow, new RegExp(`          ${input}:`));
  for (const [variable, input] of Object.entries({ DEPLOYMENT_URL: "deployment-url", DEPLOYMENT_PAYLOAD: "deployment-payload",
    API_KEY_HEADER: "api-key-header", TAILSCALE_CLIENT_ID: "tailscale-client-id", TAILSCALE_AUDIENCE: "tailscale-audience", TAILSCALE_TAGS: "tailscale-tags" })) {
    assert.ok(workflow.includes(`${variable}: \${{ inputs.${input} }}`));
  }
  assert.ok(workflow.includes("API_KEY: ${{ secrets.api-key }}"));
  assert.doesNotMatch(workflow, /checkout|secrets: inherit|oauth-secret|set -x/);
  assert.equal(scripts.length, 2);
  for (const script of scripts) assert.doesNotMatch(script, /\$\{\{/);
  assert.ok(workflow.indexOf("run: |") < workflow.indexOf("uses: tailscale/"));
});

test("acepta URL HTTP privada y JSON escalar o estructurado", () => {
  for (const body of ['{"ok":true}', "[]", '"texto"', "null", "42"]) {
    const result = run(scripts[0], { DEPLOYMENT_URL: "http://100.64.0.1:8080/deploy", DEPLOYMENT_PAYLOAD: body });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.request, undefined);
  }
});

for (const [variable, values] of Object.entries({
  DEPLOYMENT_URL: ["", "ftp://host/deploy", "https:///deploy", "https://user:pass@host", "https://@host", "https://host/#", "https://host/#oculto", "https://host/a b", "https://host/\n", "https://host/\u0001", "https://host:99999", "https://host/\\otro"],
  DEPLOYMENT_PAYLOAD: ["", "{invalido}", "NaN", "Infinity", '{"a":NaN}'],
  API_KEY_HEADER: ["", "x clave", "x:clave", "x-key\r\nOtro"],
  API_KEY: ["", "  ", "clave\nOtro", "clave\rOtro"],
  TAILSCALE_CLIENT_ID: ["", "  "],
  TAILSCALE_AUDIENCE: ["", "\n"],
  TAILSCALE_TAGS: ["", "  "],
})) {
  values.forEach((value, index) => test(`rechaza ${variable} inválido (caso ${index + 1}) sin revelar valores`, () => {
    const result = run(scripts[0], { [variable]: value });
    assert.notEqual(result.status, 0);
    assert.equal(result.request, undefined);
    assert.match(result.stderr, /::error::/);
    assert.doesNotMatch(result.stdout + result.stderr, /clave-privada|servicio\.interno|invalido|NO DEBE APARECER/);
  }));
}

test("envía un POST exacto con cabecera configurable sin redirecciones ni reintentos", () => {
  const body = JSON.stringify({ dato: '$(touch /no-ejecutar) `id` " Unicode: ñ' });
  const result = run(scripts[1], { API_KEY_HEADER: "Authorization", API_KEY: "Bearer secreto", DEPLOYMENT_PAYLOAD: body });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.request.body, body);
  const args = result.request.args;
  assert.equal(args[0], "--disable");
  for (const [flag, value] of Object.entries({
    "--request": "POST", "--url": valid.DEPLOYMENT_URL, "--data-binary": "@-",
    "--output": "/dev/null", "--write-out": "%{http_code}", "--connect-timeout": "10",
    "--max-time": "60", "--retry": "0", "--max-redirs": "0", "--proto": "=http,https", "--noproxy": "*",
  })) assert.equal(args[args.indexOf(flag) + 1], value, flag);
  assert.ok(args.includes("Authorization: Bearer secreto"));
  assert.ok(args.includes("Content-Type: application/json"));
  assert.ok(args.includes("--globoff"));
  assert.ok(args.includes("--silent"));
  assert.ok(!args.some((arg) => ["-L", "--location", "--insecure", "-k", "--verbose"].includes(arg)));
  assert.doesNotMatch(result.stdout + result.stderr, /secreto|servicio\.interno|dato|NO DEBE APARECER/);
});

for (const status of ["200", "204", "299", "301", "400", "401", "500", "000"]) {
  test(`interpreta HTTP ${status} sin imprimir respuesta ni datos`, () => {
    const result = run(scripts[1], {}, status);
    assert.equal(result.status === 0, /^2/.test(status));
    assert.doesNotMatch(result.stdout + result.stderr, /clave-privada|servicio\.interno|NO DEBE APARECER/);
  });
}

test("falla ante error de transporte aunque curl haya emitido un código 2xx", () => {
  const result = run(scripts[1], {}, "200", "28");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /::error::/);
  assert.doesNotMatch(result.stdout + result.stderr, /clave-privada|servicio\.interno|NO DEBE APARECER/);
});
