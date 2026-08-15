import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workflowPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../.github/workflows/semantic-pr.yml",
);
const workflow = readFileSync(workflowPath, "utf8");

test("serializes Semantic PR validation without cancelling active runs", () => {
  assert.match(
    workflow,
    /concurrency:\n  group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n  cancel-in-progress: false/,
  );
  assert.doesNotMatch(workflow, /cancel-in-progress:\s*true/);
});
