import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { newNotePage } from "../src/domain/newPage.js";
import { makeDatabaseItemPage } from "../src/domain/database.js";
import { normalizePageSettings } from "../src/domain/pageActions.js";

test("new ordinary and record page settings survive normalization unchanged", () => {
  const note = newNotePage({ folderId: "folder", title: "Note", now: "2026-11-07T08:00:00Z", idFactory: (prefix) => `${prefix}-fixed` });
  const record = makeDatabaseItemPage({ itemId: "item", source: { id: "source", title: "Database" }, folderId: "folder" });
  for (const page of [note, record]) assert.deepEqual(normalizePageSettings(page.settings), page.settings);
});
test("full database page producers explicitly select full presentation", () => {
  const source = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.equal([...source.matchAll(/settings: \{ \.\.\.defaultPageSettings, fullWidth: true, presentationMode: "full" \}/g)].length, 2);
  const settings = { fontFamily: "default", smallText: false, fullWidth: true, presentationMode: "full", locked: false };
  assert.deepEqual(normalizePageSettings(settings), settings);
});
