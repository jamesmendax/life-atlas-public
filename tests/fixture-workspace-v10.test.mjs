import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";

test("v10 fixture stays frozen at schema 10", () => {
  const source = fs.readFileSync(new URL("./fixtures/workspace-v10.json", import.meta.url));
  const workspace = JSON.parse(source.toString("utf8"));
  assert.equal(createHash("sha256").update(source).digest("hex"), "b14bd672c33af384fbec1425dd32ddb51296d250d494302dbeb8b63d85996332");
  assert.equal(workspace.schemaVersion, 10);
  assert.equal(workspace.pages.length, 6);
  assert.equal(workspace.databaseItems.length, 4);
  assert.equal(workspace.databaseViews.length, 10);
});
