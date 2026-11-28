import test from "node:test";
import assert from "node:assert/strict";

import { derivePageSummary, documentToPlainText } from "../src/domain/content.js";
import { buildSearchDocuments, querySearch, searchSnippet } from "../src/search/searchIndex.js";

const folders = [
  { id: "life", parentId: null, name: "生活小知识", updatedAt: "2026-09-18T00:00:00.000Z" },
  { id: "parenting", parentId: "life", name: "家教篇", updatedAt: "2026-09-18T00:00:00.000Z" },
];

const chemistry = {
  id: "chemistry",
  folderId: "parenting",
  title: "化学",
  summary: "",
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-18T00:00:00.000Z",
  content: [
    {
      id: "b1",
      type: "paragraph",
      content: [{ type: "text", text: "本节重点讲解氧化还原反应中的电子转移和配平方法。" }],
      children: [],
    },
    {
      id: "b2",
      type: "bulletListItem",
      content: [{ type: "text", text: "典型例题与课后复盘" }],
      children: [],
    },
  ],
};

test("extracts searchable plain text from BlockNote-style blocks", () => {
  const text = documentToPlainText(chemistry.content);
  assert.match(text, /氧化还原/);
  assert.match(text, /典型例题/);
});

test("derives a compact automatic page summary from block content", () => {
  const summary = derivePageSummary(chemistry, 32);
  assert.match(summary, /氧化还原/);
  assert.ok(summary.length <= 45);
});

test("global search finds a page by body text even when the title does not contain the query", () => {
  const documents = buildSearchDocuments(folders, [chemistry]);
  const results = querySearch(documents, "氧化还原");
  assert.equal(results[0]?.entityId, "chemistry");
  assert.equal(results[0]?.type, "page");
  assert.match(searchSnippet(results[0], "氧化还原"), /氧化还原/);
});

test("global search finds folders by name and supports type filters", () => {
  const documents = buildSearchDocuments(folders, [chemistry]);
  const foldersOnly = querySearch(documents, "家教", "folders");
  assert.equal(foldersOnly.length, 1);
  assert.equal(foldersOnly[0].entityId, "parenting");

  const contentOnly = querySearch(documents, "电子转移", "content");
  assert.equal(contentOnly.length, 1);
  assert.equal(contentOnly[0].entityId, "chemistry");
});
