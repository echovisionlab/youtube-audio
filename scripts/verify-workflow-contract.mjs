import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const ci = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
const release = await readFile(
  new URL(".github/workflows/release.yml", root),
  "utf8",
);

assert.match(ci, /pull_request:\s+branches:\s+- main/u);
assert.doesNotMatch(ci, /push:\s+branches:\s+- main/u);
assert.doesNotMatch(ci, /workflow_dispatch:/u);
assert.match(ci, /name: Validate/u);
assert.match(ci, /concurrency:/u);
assert.match(release, /name: Release Please/u);
assert.match(release, /token: \$\{\{ github\.token \}\}/u);
assert.match(release, /npm stage publish --access public --provenance/u);
assert.match(release, /id-token: write/u);
assert.doesNotMatch(release, /secrets\.|self-hosted/u);

for (const source of [ci, release]) {
  for (const action of source.matchAll(
    /^\s*(?:-\s*)?uses: ([^@]+)@([^\s]+)/gmu,
  )) {
    assert.match(
      action[2],
      /^[0-9a-f]{40}$/u,
      `${action[1]} must use a full SHA`,
    );
  }
}

console.log("GitHub Actions workflow contract passed.");
