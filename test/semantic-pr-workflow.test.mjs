import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";

const baseDir = dirname(fileURLToPath(import.meta.url));
const workflowPath = resolve(baseDir, "../.github/workflows/semantic-pr.yml");
const aliasWorkflowPath = resolve(
    baseDir,
    "../.github/workflows/semantic-pull-request.yml",
);

const workflow = readFileSync(workflowPath, "utf8");
const aliasWorkflow = readFileSync(aliasWorkflowPath, "utf8");

test("serializes Semantic PR validation without cancelling active runs", () => {
  assert.match(
      workflow,
      /concurrency:\n  group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n  cancel-in-progress: false/,
  );
  assert.doesNotMatch(workflow, /cancel-in-progress:\s*true/);
});

test("declares least-privilege token permissions scoped to pull-requests write", () => {
  assert.match(workflow, /permissions:\n  pull-requests: write/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.doesNotMatch(workflow, /id-token:\s*write/);
  assert.doesNotMatch(workflow, /issues:\s*write/);
});

test("configures skip-bots input with default bots array", () => {
  assert.match(
      workflow,
      /skip-bots:\n\s+description: [^\n]+\n\s+type: string\n\s+required: false\n\s+default: '\["dependabot\[bot\]","renovate\[bot\]"\]'/,
  );
  assert.match(
      workflow,
      /if: \$\{\{ !contains\(fromJson\(inputs\.skip-bots\), github\.actor\) \}\}/,
  );
});

test("makes sticky comment steps resilient with continue-on-error", () => {
  const commentSteps = workflow.match(
      /uses: marocchino\/sticky-pull-request-comment[^\n]*\n\s+if: [^\n]+\n\s+continue-on-error: true/g,
  );
  assert.ok(commentSteps);
  assert.equal(commentSteps.length, 2);
});

test("does not checkout repository code (zero-checkout security boundary)", () => {
  assert.doesNotMatch(workflow, /uses: actions\/checkout/);
});

test("alias workflow semantic-pull-request.yml maintains contract parity", () => {
  // Strip header comments to verify structural and execution parity
  const stripComments = (content) =>
      content.replace(/^#[^\n]*\n/gm, "").trim();
  assert.equal(stripComments(workflow), stripComments(aliasWorkflow));
});
