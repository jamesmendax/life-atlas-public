import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createBacklinkIndex, extractPageLinks } from "../src/domain/backlinks.js";
import { upgradeWorkspace } from "../src/persistence/migrations.js";
import { restoreTrashGroup, trashPage } from "../src/domain/trash.js";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";
import { bigWorkspace } from "./fixtures/big-workspace.mjs";

const NOW = "2026-10-01T12:00:00.000Z";
const mention = (pageId) => ({ type: "pageMention", props: { pageId } });
const paragraph = (id, content) => ({ id, type: "paragraph", content });
const indexOf = (workspace) => { const index = createBacklinkIndex(); index.rebuild(workspace); return index; };
const patchPage = (workspace, id, patch) => ({ ...workspace, pages: workspace.pages.map((page) => page.id === id ? { ...page, ...patch } : page) });

test("backlinks match the fixture", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  const index = indexOf(workspace);
  assert.deepEqual(index.backlinksFor("p-z1", workspace), [{ sourcePageId: "p-a1", links: [{ blockId: "b-a1-p", kind: "mention", snippet: "提及：Z 目标页" }] }]);
  assert.deepEqual(index.backlinksFor("p-c1", workspace), [{ sourcePageId: "p-a1", links: [{ blockId: "b-a1-link", kind: "pageLink", snippet: "" }] }]);
  assert.deepEqual(index.backlinksFor("p-b1", workspace), [{ sourcePageId: "p-z1", links: [{ blockId: "b-z1-mention", kind: "mention", snippet: "B 笔记" }] }]);
  assert.deepEqual(index.backlinksFor("p-a1", workspace), []);
});

test("synced content counts for every page that shows it", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  workspace.syncedSources = workspace.syncedSources.map((source) => source.id === "sync-shared" ? { ...source, blocks: [paragraph("shared-mention", [mention("p-c1")])] } : source);
  const links = indexOf(workspace).backlinksFor("p-c1", workspace);
  assert.deepEqual(links.map((entry) => entry.sourcePageId), ["p-a1", "p-b1", "p-z1"]);
  for (const entry of links.slice(1)) assert.deepEqual(entry.links, [{ blockId: "shared-mention", kind: "mention", snippet: "C 深层" }]);
});

test("block links count as backlinks", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  const page = workspace.pages.find((entry) => entry.id === "p-z1");
  const next = patchPage(workspace, page.id, { content: [...page.content, paragraph("block-link", [{ type: "link", href: "lifeatlas://page/p-c1#block-b-c1-p", content: [{ type: "text", text: "跳转" }] }])] });
  assert.deepEqual(indexOf(next).backlinksFor("p-c1", next).find((entry) => entry.sourcePageId === "p-z1").links, [{ blockId: "block-link", kind: "blockLink", snippet: "跳转" }]);
});

test("content cards count as backlinks", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  const page = workspace.pages.find((entry) => entry.id === "p-b1");
  const card = { id: "b-card", type: "editorialCard", props: { title: "卡片", eyebrow: "", excerpt: "", imageUrl: "", pageId: "p-c1", layout: "card" }, content: [], children: [] };
  const next = patchPage(workspace, page.id, { content: [...page.content, card, { ...card, id: "b-empty-card", props: { ...card.props, pageId: "" } }] });
  assert.deepEqual(indexOf(next).backlinksFor("p-c1", next).find((entry) => entry.sourcePageId === "p-b1").links, [{ blockId: "b-card", kind: "editorialCard", snippet: "" }]);
});

test("trashed sources are hidden and come back after restore", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  const index = indexOf(workspace);
  const trashed = trashPage(workspace, "p-a1", NOW);
  index.update(workspace, trashed);
  assert.deepEqual(index.backlinksFor("p-z1", trashed), []);
  const restored = restoreTrashGroup(trashed, { kind: "page", id: "p-a1" }, { now: NOW }).workspace;
  index.update(trashed, restored);
  assert.deepEqual(index.backlinksFor("p-z1", restored), [{ sourcePageId: "p-a1", links: [{ blockId: "b-a1-p", kind: "mention", snippet: "提及：Z 目标页" }] }]);
});

test("incremental updates match a full rebuild", () => {
  let workspace = upgradeWorkspace(fullWorkspace());
  const index = indexOf(workspace);
  const changes = [
    (current) => patchPage(current, "p-z1", { content: [paragraph("added", [mention("p-c1")])] }),
    (current) => patchPage(current, "p-a1", { content: current.pages.find((page) => page.id === "p-a1").content.filter((block) => block.id !== "b-a1-p") }),
    (current) => ({ ...current, pages: [...current.pages, { ...current.pages[1], id: "added-page", title: "新增", content: [paragraph("new-mention", [mention("p-z1")])] }] }),
    (current) => ({ ...current, pages: current.pages.filter((page) => page.id !== "p-b1") }),
    (current) => ({ ...current, syncedSources: current.syncedSources.map((source) => source.id === "sync-shared" ? { ...source, blocks: [paragraph("new-sync", [mention("p-a1")])] } : source) }),
  ];
  for (const change of changes) {
    const next = change(workspace);
    index.update(workspace, next);
    const full = indexOf(next);
    for (const target of new Set([...workspace.pages, ...next.pages].map((page) => page.id))) assert.deepEqual(index.backlinksFor(target, next), full.backlinksFor(target, next), target);
    workspace = next;
  }
});

test("updating one page in a large workspace is fast", () => {
  const workspace = bigWorkspace({ pages: 5000, records: 0 });
  const index = indexOf(workspace);
  const source = workspace.pages[0];
  const target = workspace.pages[4999];
  const durations = [];
  let previous = workspace;
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const next = patchPage(previous, source.id, { content: [...source.content, paragraph(`measured-${iteration}`, [mention(target.id)])] });
    const started = performance.now();
    index.update(previous, next);
    durations.push(performance.now() - started);
    previous = next;
  }
  const median = [...durations].sort((first, second) => first - second)[2];
  const queryStarted = performance.now();
  assert.equal(index.backlinksFor(target.id, previous).length, 1);
  const query = performance.now() - queryStarted;
  console.log(`WP16_BACKLINK_UPDATE_MS=${median.toFixed(3)}`);
  console.log(`WP16_BACKLINK_QUERY_MS=${query.toFixed(3)}`);
  assert.ok(median < 20, `update median ${median} ms`);
  assert.ok(query < 5, `query ${query} ms`);
});

test("table cell links are traversed and self links are ignored", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  const page = { ...workspace.pages[0], content: [
    { id: "table", type: "table", content: { type: "tableContent", rows: [{ cells: [[mention("p-c1")], { type: "tableCell", content: [{ type: "link", href: "lifeatlas://page/p-z1#block-target", content: [{ type: "text", text: "Z" }] }] }] }] } },
    paragraph("self", [mention("p-a1"), { type: "link", href: "lifeatlas://page/p-a1", content: [{ type: "text", text: "自己" }] }]),
  ] };
  assert.deepEqual(extractPageLinks(page, workspace), [{ targetPageId: "p-c1", blockId: "table", kind: "mention", snippet: "" }, { targetPageId: "p-z1", blockId: "table", kind: "blockLink", snippet: "" }]);
});

test("target title changes refresh semantic backlink snippets", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  const next = patchPage(workspace, "p-z1", { title: "新目标" });
  const index = indexOf(workspace);
  index.update(workspace, next);
  assert.deepEqual(index.backlinksFor("p-z1", next), indexOf(next).backlinksFor("p-z1", next));
  assert.equal(index.backlinksFor("p-z1", next)[0].links[0].snippet, "提及：新目标");
});

test("nested synced source updates refresh their referring pages", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  const previous = { ...workspace, syncedSources: workspace.syncedSources.map((source) => source.id === "sync-shared" ? { ...source, blocks: [{ id: "nested", type: "syncedBlock", props: { sourceId: "sync-only-b1" } }] } : source) };
  const next = { ...previous, syncedSources: previous.syncedSources.map((source) => source.id === "sync-only-b1" ? { ...source, blocks: [paragraph("nested-mention", [mention("p-c1")])] } : source) };
  const index = indexOf(previous);
  index.update(previous, next);
  assert.deepEqual(index.backlinksFor("p-c1", next), indexOf(next).backlinksFor("p-c1", next));
  assert.deepEqual(index.backlinksFor("p-c1", next).map((entry) => entry.sourcePageId), ["p-a1", "p-b1", "p-z1"]);
});

test("snippets are capped without splitting surrogate pairs", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  const page = { ...workspace.pages[0], content: [paragraph("long", [{ type: "text", text: "😀".repeat(90) }, mention("p-c1")])] };
  const links = extractPageLinks(page, workspace);
  assert.equal(links[0].snippet, `${"😀".repeat(80)}…`);
});
