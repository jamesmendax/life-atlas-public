import test from "node:test";
import assert from "node:assert/strict";
import { migrateInbox, migratePageVersions } from "../src/persistence/migrations.js";
import { createPageVersion } from "../src/domain/pageHistory.js";
import { fullWorkspace, FIXTURE_TIME } from "./fixtures/full-workspace.mjs";

function previousWorkspace() {
  const workspace = { ...migrateInbox(fullWorkspace()), schemaVersion: 15 };
  delete workspace.pageVersions;
  return workspace;
}

test("v16 adds an empty page version list", () => {
  for (const invalid of [undefined, null, { invalid: true }]) {
    const input = previousWorkspace();
    if (invalid !== undefined) input.pageVersions = invalid;
    const before = structuredClone(input);
    const result = migratePageVersions(input);
    assert.equal(result.schemaVersion, 16);
    assert.deepEqual(result.pageVersions, []);
    assert.deepEqual(input, before);
    for (const collection of ["folders", "pages", "dataSources", "databaseItems", "attachments"]) assert.deepEqual(result[collection], input[collection]);
  }
});

test("v16 keeps existing versions", () => {
  const input = previousWorkspace();
  input.pageVersions = [createPageVersion(input.pages.find((page) => page.id === "p-a1-child"), { id: "pv-existing", now: FIXTURE_TIME, reason: "before-edit" })];
  const before = structuredClone(input);
  const result = migratePageVersions(input);
  assert.equal(result.schemaVersion, 16);
  assert.deepEqual(result.pageVersions, before.pageVersions);
  assert.deepEqual(input, before);
});

test("v16 is idempotent", () => {
  const first = migratePageVersions(previousWorkspace());
  const before = structuredClone(first);
  const second = migratePageVersions(first);
  assert.deepEqual(second, before);
  assert.deepEqual(first, before);
  assert.equal(second.schemaVersion, 16);
});
