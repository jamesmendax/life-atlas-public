import test from "node:test";
import assert from "node:assert/strict";
import { coreParityWorkspace } from "./fixtures/core-parity-workspace.mjs";
import { pageSemanticText } from "../src/domain/documentSemantics.js";
import { pageToMarkdown, pageToStandaloneHtml, collectTableCsvFiles, createJsonBackup } from "../src/domain/pageExport.js";
import { createPageBundle, importPageBundle } from "../src/domain/pageBundle.js";
import { buildSearchDocuments } from "../src/search/searchIndex.js";
import { walkBlocks } from "../src/domain/blockDocument.js";

test("semantic search and text exports include every tab, canonical sync, live mentions and human properties", () => {
  const workspace = coreParityWorkspace(), page = workspace.pages.find((entry) => entry.id === "editor-page");
  workspace.pages.find((entry) => entry.id === "alpha-page").title = "最新项目名称";
  workspace.people.find((entry) => entry.id === "person-a").displayName = "最新成员名称";
  const before = structuredClone(workspace);
  const text = pageSemanticText(page, workspace);
  for (const term of ["计划", "任务", "资料", "计划正文可被搜索", "核对验收清单", "共享交付说明", "最新项目名称", "最新成员名称", "2026-09-19", "设计说明.pdf", "柏林"]) assert.ok(text.includes(term), term);
  assert.ok(!text.includes("[object Object]"));
  const markdown = pageToMarkdown(page, { workspace });
  assert.match(markdown, /### 资料/); assert.match(markdown, /共享交付说明/); assert.match(markdown, /最新成员名称/);
  const html = pageToStandaloneHtml(page, { workspace });
  assert.match(html, /最新项目名称/); assert.match(html, /<table>/);
  assert.ok(collectTableCsvFiles(page, { workspace })[0].csv.includes("设计说明.pdf"));
  const documents = buildSearchDocuments(workspace.folders, workspace.pages, workspace);
  assert.ok(documents.find((entry) => entry.entityId === page.id).body.includes("共享交付说明"));
  assert.deepEqual(workspace, before);
});

test("page bundle roundtrip preserves canonical references and does not overwrite colliding existing entities", async () => {
  const workspace = coreParityWorkspace(), page = workspace.pages.find((entry) => entry.id === "editor-page");
  workspace.pages.push({ id: "unrelated", title: "Private unrelated", folderId: "work", content: [] });
  const bundle = createPageBundle(page, workspace);
  assert.ok(!bundle.related.pages.some((entry) => entry.id === "unrelated"));
  assert.equal(bundle.related.syncedSources.length, 1);
  assert.equal(bundle.related.databaseItems.length, 4);
  const before = structuredClone(workspace);
  let id = 0;
  const imported = importPageBundle(workspace, JSON.parse(JSON.stringify(bundle)), "unrelated", (prefix) => `${prefix}-import-${++id}`);
  assert.deepEqual(workspace, before);
  assert.deepEqual(imported.workspace.syncedSources[0], workspace.syncedSources[0]);
  const refs = walkBlocks(imported.page.content).filter((block) => block.type === "syncedBlock");
  assert.ok(refs.length >= 3);
  assert.ok(refs.every((block) => block.props.sourceId === refs[0].props.sourceId));
  assert.notEqual(refs[0].props.sourceId, "shared-source");
  assert.match(pageSemanticText(imported.page, imported.workspace), /共享交付说明/);
  assert.match(pageSemanticText(imported.page, imported.workspace), /设计说明.pdf/);
  assert.match(pageSemanticText(imported.page, imported.workspace), /林初/);
  const originalIds = new Set(walkBlocks(page.content).map((block) => block.id));
  assert.ok(walkBlocks(imported.page.content).every((block) => !originalIds.has(block.id)));
  const backup = createJsonBackup(page, { workspace });
  assert.equal(JSON.parse(await backup.blob.text()).related.syncedSources.length, 1);
});

test("missing and recursive sources produce explicit export notices rather than unbounded traversal", () => {
  const workspace = coreParityWorkspace();
  workspace.syncedSources[0].blocks = [{ type: "syncedBlock", props: { sourceId: "shared-source" } }];
  const page = { title: "Edges", content: [{ type: "syncedBlock", props: { sourceId: "shared-source" } }, { type: "syncedBlock", props: { sourceId: "missing" } }] };
  assert.match(pageSemanticText(page, workspace), /同步引用循环/);
  assert.match(pageSemanticText(page, workspace), /同步内容不可用/);
});