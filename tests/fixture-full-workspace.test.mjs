import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { fullWorkspace, fullWorkspaceAttachmentBytes } from "./fixtures/full-workspace.mjs";
import { CURRENT_SCHEMA_VERSION, upgradeWorkspace } from "../src/persistence/migrations.js";
import { buildSearchDocuments, querySearch } from "../src/search/searchIndex.js";

test("full fixture has the documented collection counts", () => {
  const workspace = fullWorkspace();
  const counts = { folders: 5, pages: 11, dataSources: 2, databaseItems: 4, databaseViews: 4, relations: 2, syncedSources: 2, attachments: 3, people: 2, pageTemplates: 1, databaseTemplates: 1, discussions: 2, comments: 3 };
  for (const [collection, count] of Object.entries(counts)) assert.equal(workspace[collection].length, count, collection);
});

test("full fixture attachment bytes match the documented hashes", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  const bytes = fullWorkspaceAttachmentBytes();
  for (const attachment of workspace.attachments) {
    assert.equal(bytes.get(attachment.id).length, attachment.size);
    assert.equal(createHash("sha256").update(bytes.get(attachment.id)).digest("hex"), attachment.checksum);
  }
});

test("full fixture is deterministic and returns fresh objects", () => {
  const first = fullWorkspace();
  const second = fullWorkspace();
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  first.pages[0].content[0].content = "changed";
  first.dataSources[0].properties[1].options[0].name = "changed";
  assert.deepEqual(fullWorkspace(), second);
  const specification = fs.readFileSync(new URL("../docs/blueprint/10-测试夹具规格.md", import.meta.url), "utf8");
  const literal = specification.slice(specification.indexOf("```js") + 6, specification.indexOf("```", specification.indexOf("```js") + 6)).replace(/^\r?\n/, "").replace(/\r\n/g, "\n");
  assert.equal(fs.readFileSync(new URL("./fixtures/full-workspace.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n").slice(0, literal.length), literal);
});

test("full fixture search baseline returns 27 documents", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  const documents = buildSearchDocuments(workspace.folders, workspace.pages, workspace);
  assert.equal(documents.length, 27);
  assert.deepEqual(querySearch(documents, "深层").map((result) => result.id), ["page:p-c1", "comment:cm-1", "comment:cm-2"]);
});

function originalFields(value, original) {
  if (Array.isArray(original)) {
    assert.equal(value?.length, original.length);
    return original.map((entry, index) => originalFields(value?.[index], entry));
  }
  if (original && typeof original === "object") return Object.fromEntries(Object.entries(original).map(([key, entry]) => [key, originalFields(value?.[key], entry)]));
  return value;
}

test("upgrading the full fixture adds one system inbox and preserves every original entity field", () => {
  const input = fullWorkspace();
  const before = structuredClone(input);
  const upgraded = upgradeWorkspace(input);
  assert.equal(upgraded.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.deepEqual(upgraded.folders.filter((folder) => folder.system), [{
    id: "system-inbox", system: "inbox", name: "收件箱", parentId: null, color: "stone", sortIndex: -1,
    lastOpenedPageId: null, trashedAt: null, trashedByFolderId: null, createdAt: input.savedAt, updatedAt: input.savedAt,
  }]);
  for (const [collection, entities] of Object.entries(input)) {
    if (!Array.isArray(entities)) continue;
    const originalIds = entities.map((entity) => entity.id);
    assert.deepEqual(upgraded[collection].map((entity) => entity.id), collection === "folders" ? [...originalIds, "system-inbox"] : originalIds, collection);
    for (const entity of entities) assert.deepEqual(originalFields(upgraded[collection].find((entry) => entry.id === entity.id), entity), entity, `${collection}:${entity.id}`);
  }
  for (const [collection, entities] of Object.entries(upgraded)) {
    if (Array.isArray(entities) && !Array.isArray(input[collection])) assert.deepEqual(entities, [], collection);
  }
  assert.deepEqual(upgradeWorkspace(upgraded), upgraded);
  assert.deepEqual(input, before);
});
