import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const editor = fs.readFileSync(path.join(root, "src", "editor", "PageEditor.jsx"), "utf8");
const schema = fs.readFileSync(path.join(root, "src", "editor", "lifeAtlasSchema.jsx"), "utf8");
const databaseView = fs.readFileSync(path.join(root, "src", "components", "DatabaseView.jsx"), "utf8");

test("full-page database uses a normal Page carrying databaseSourceId", () => {
  assert.match(app, /pageType:\s*"database"/);
  assert.match(app, /databaseSourceId:\s*source\.id/);
  assert.match(app, /page\.pageType === "database"/);
  assert.match(app, /<DatabaseView/);
});

test("database items are created as normal editable Pages and opened through the same PageEditor route", () => {
  assert.match(app, /makeDatabaseItemPage/);
  assert.match(app, /databaseItems:/);
  assert.match(databaseView, /onOpenItemPage/);
  assert.match(editor, /databaseRuntime/);
  assert.match(editor, /LifeAtlasEditorRuntimeContext\.Provider/);
});

test("inline database custom block receives the same workspace runtime and can create nested databases", () => {
  assert.match(schema, /type:\s*"databaseView"/);
  assert.match(schema, /runtime\?\.workspace/);
  assert.match(schema, /runtime\?\.createInlineDatabase/);
  assert.match(app, /ownerPageId:\s*owner\.id/);
  assert.match(app, /parentDatabaseItemId/);
});

test("linked source selection creates an independent linked view, not a copied source", () => {
  assert.match(schema, /createLinkedView/);
  assert.match(app, /createLinkedDatabaseView/);
  assert.match(databaseView, /db\.empty\.linkedHint|Linked View/);
});
