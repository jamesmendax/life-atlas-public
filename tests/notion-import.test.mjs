import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { readNotionExport, planNotionImport, buildNotionImport, resolveNotionPath } from "../src/import/notionImport.js";
import { checkWorkspaceIntegrity } from "../src/domain/integrity.js";
import { upgradeWorkspace } from "../src/persistence/migrations.js";
import { documentToPlainText } from "../src/domain/content.js";
import { fullWorkspace, FIXTURE_TIME } from "./fixtures/full-workspace.mjs";
import { buildNotionExportZip, buildHtmlExportZip, notionExportFiles, NOTION_IDS } from "./fixtures/notion-export.mjs";

const fixturePlan = () => planNotionImport(new Map(Object.entries(notionExportFiles()).map(([filePath, content]) => [filePath, typeof content === "string" ? new TextEncoder().encode(content) : content])));
const uploadAttachment = async (name, bytes) => ({ url: `life-asset://${createHash("sha256").update(bytes).digest("hex")}` });
const options = (prefix = "import") => { let sequence = 0; return { now: FIXTURE_TIME, idFactory: (kind) => `${prefix}-${kind}-${++sequence}`, uploadAttachment }; };

test("split exports are merged and the top folder is removed", async () => {
  const split = await readNotionExport(await buildNotionExportZip({ split: true }));
  const flat = await readNotionExport(await buildNotionExportZip({ split: false }));
  assert.deepEqual([...split.entries.keys()].sort(), [...flat.entries.keys()].sort());
  assert.deepEqual([...split.entries.keys()].sort(), Object.keys(notionExportFiles()).sort());
  for (const [filePath, bytes] of split.entries) { assert.equal(filePath.startsWith("Export-test/"), false); assert.deepEqual(bytes, flat.entries.get(filePath)); }
  assert.deepEqual(split.problems, []);
});

test("the plan counts pages databases records and attachments", () => {
  assert.deepEqual(fixturePlan().counts, { pages: 3, databases: 1, records: 5, attachments: 3, attachmentBytes: 70 + 2048 + 4096 });
});

test("unrecognized files are listed", () => assert.ok(fixturePlan().unrecognized.some((entry) => entry.path === "readme.txt")));

test("html exports are refused with guidance", async () => {
  const plan = planNotionImport((await readNotionExport(await buildHtmlExportZip())).entries);
  assert.equal(plan.errors.length, 1);
  assert.ok(plan.errors[0].startsWith("这是 HTML 格式的导出包"));
});

test("imported pages keep the hierarchy and titles", async () => {
  const original = upgradeWorkspace(fullWorkspace());
  const result = await buildNotionImport(original, fixturePlan(), options());
  const folder = result.workspace.folders.find((entry) => entry.id === result.rootFolderId);
  const date = new Date(FIXTURE_TIME);
  const localDay = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  assert.equal(folder.name, `从 Notion 导入 ${localDay}`);
  const pages = result.workspace.pages.filter((page) => page.folderId === folder.id && !page.databaseSourceId);
  assert.deepEqual(pages.map((page) => page.title).sort(), ["个人笔记", "会议记录", "项目总览"].sort());
  const overview = pages.find((page) => page.title === "项目总览");
  assert.equal(overview.parentPageId, null);
  assert.equal(pages.find((page) => page.title === "个人笔记").parentPageId, null);
  assert.equal(pages.find((page) => page.title === "会议记录").parentPageId, overview.id);
  assert.equal(result.workspace.pages.filter((page) => page.folderId === folder.id).some((page) => /[0-9a-f]{32}/.test(page.title)), false);
});

test("page content becomes blocks", async () => {
  const result = await buildNotionImport(upgradeWorkspace(fullWorkspace()), fixturePlan(), options());
  const imported = result.workspace.pages.filter((page) => page.folderId === result.rootFolderId);
  const overview = imported.find((page) => page.title === "项目总览");
  const meeting = imported.find((page) => page.title === "会议记录");
  const database = imported.find((page) => page.pageType === "database");
  assert.deepEqual(overview.content.map((block) => block.type), ["paragraph", "heading", "checkListItem", "checkListItem", "quote", "codeBlock", "image", "pageLink", "callout", "equation", "table", "pageLink"]);
  assert.equal(overview.content[1].props.level, 2);
  assert.equal(overview.content[3].props.checked, true);
  assert.equal(overview.content[5].props.language, "js");
  assert.match(overview.content[6].props.url, /^life-asset:\/\/[0-9a-f]{64}$/);
  assert.equal(overview.content[7].props.pageId, meeting.id);
  assert.equal(overview.content[8].props.icon, "💡");
  assert.equal(overview.content[11].props.pageId, database.id);
  assert.ok(meeting.content[0].content.some((entry) => entry.type === "pageMention" && entry.props.pageId === overview.id));
  assert.equal(meeting.content[1].type, "bulletListItem");
  assert.equal(meeting.content[1].children.length, 1);
  assert.equal(meeting.content[2].type, "file");
});

test("the database uses the all csv and inferred types", async () => {
  const result = await buildNotionImport(upgradeWorkspace(fullWorkspace()), fixturePlan(), options());
  const source = result.workspace.dataSources.find((entry) => entry.ownerPageId === result.workspace.pages.find((page) => page.folderId === result.rootFolderId && page.pageType === "database").id);
  assert.deepEqual(source.properties.map((property) => [property.name, property.type]), [["名称", "title"], ["状态", "select"], ["截止", "date"], ["标签", "multi_select"], ["完成", "checkbox"]]);
  assert.deepEqual(source.properties[1].options.map((option) => option.name), ["进行中", "完成"]);
  assert.deepEqual(source.properties[3].options.map((option) => option.name), ["前端", "后端"]);
  const items = result.workspace.databaseItems.filter((item) => item.sourceId === source.id);
  assert.equal(items.length, 5);
  const titleId = source.properties[0].id;
  const dateId = source.properties[2].id;
  assert.equal(items.find((item) => item.values[titleId] === "任务二").values[dateId].start, "2026-09-20T10:00");
  assert.equal(items.find((item) => item.values[titleId] === "任务四").values[dateId].end, "2026-09-23");
  for (const item of items) assert.equal(documentToPlainText(result.workspace.pages.find((page) => page.id === item.pageId).content), `${item.values[titleId]}的正文。`);
});

test("existing entities are untouched", async () => {
  const original = upgradeWorkspace(fullWorkspace());
  const before = structuredClone(original);
  const result = await buildNotionImport(original, fixturePlan(), options());
  for (const [collection, entities] of Object.entries(original)) if (Array.isArray(entities)) for (const [index, entity] of entities.entries()) assert.equal(result.workspace[collection][index], entity, `${collection}:${index}`);
  assert.deepEqual(original, before);
  const integrity = checkWorkspaceIntegrity(result.workspace);
  assert.equal(integrity.ok, true, JSON.stringify(integrity.problems));
  assert.equal(integrity.problems.some((problem) => problem.severity === "error"), false);
});

test("a second import gets a numbered folder name", async () => {
  const first = await buildNotionImport(upgradeWorkspace(fullWorkspace()), fixturePlan(), options("first"));
  const second = await buildNotionImport(first.workspace, fixturePlan(), options("second"));
  assert.equal(second.workspace.folders.find((folder) => folder.id === second.rootFolderId).name, `${first.workspace.folders.find((folder) => folder.id === first.rootFolderId).name} (2)`);
});

test("unsafe zip paths and conflicting split files are rejected", async () => {
  for (const filePath of ["../escape.md", "a/../../escape.md", "/escape.md", "a\\escape.md", "C:/escape.md"]) {
    const zip = new JSZip();
    zip.file(filePath, "# bad", { createFolders: false });
    await assert.rejects(readNotionExport(await zip.generateAsync({ type: "uint8array" })), /不安全/);
  }
  const outer = new JSZip();
  for (const [index, text] of ["# one", "# two"].entries()) {
    const inner = new JSZip();
    inner.file("same.md", text, { createFolders: false });
    outer.file(`Part-${index}.zip`, await inner.generateAsync({ type: "uint8array" }), { createFolders: false });
  }
  await assert.rejects(readNotionExport(await outer.generateAsync({ type: "uint8array" })), /同名文件内容不同/);
});

test("failed attachment staging never publishes or mutates workspace entities", async () => {
  const original = upgradeWorkspace(fullWorkspace());
  const before = structuredClone(original);
  const contexts = [];
  await assert.rejects(buildNotionImport(original, fixturePlan(), { ...options(), uploadAttachment: async (name, bytes, mime, context) => { contexts.push(context); if (contexts.length === 2) throw new Error("disk full"); return uploadAttachment(name, bytes, mime); } }), /disk full/);
  assert.equal(contexts.length, 2);
  assert.match(contexts[0].id, /^import-attachment-/);
  assert.equal(contexts[0].now, FIXTURE_TIME);
  assert.deepEqual(original, before);
});

test("relative notion links decode once and remain inside the export tree", () => {
  assert.equal(resolveNotionPath(`项目总览 ${NOTION_IDS.overview}/会议记录.md`, `../项目总览%20${NOTION_IDS.overview}.md`), `项目总览 ${NOTION_IDS.overview}.md`);
  for (const href of ["../../outside.md", "%2e%2e/%2e%2e/outside.md", "https://example.test/a.png", "file:///a.md", "/a.md", "%GG"]) assert.equal(resolveNotionPath("folder/page.md", href), null);
});

test("record pages match duplicate CSV titles in FIFO order and strip only known properties", async () => {
  const entries = new Map(Object.entries({
    "数据库.csv": "名称,状态\n同名,进行中\n同名,完成",
    "数据库/第一个.md": "# 同名\n\n状态: 进行中\n\n第一份正文",
    "数据库/第二个.md": "# 同名\n\n状态: 完成\n未知: 必须保留\n\n第二份正文",
  }).map(([filePath, text]) => [filePath, new TextEncoder().encode(text)]));
  const plan = planNotionImport(entries);
  assert.equal(plan.databases[0].records[0].page.path, "数据库/第一个.md");
  assert.equal(plan.databases[0].records[1].page.path, "数据库/第二个.md");
  assert.equal(plan.counts.pages, 0);
  const result = await buildNotionImport(upgradeWorkspace(fullWorkspace()), plan, options());
  const source = result.workspace.dataSources.find((entry) => entry.ownerPageId === result.workspace.pages.find((page) => page.folderId === result.rootFolderId && page.pageType === "database").id);
  const records = result.workspace.databaseItems.filter((item) => item.sourceId === source.id);
  assert.equal(documentToPlainText(result.workspace.pages.find((page) => page.id === records[0].pageId).content), "第一份正文");
  assert.equal(documentToPlainText(result.workspace.pages.find((page) => page.id === records[1].pageId).content), "未知: 必须保留\n第二份正文");
  const doubleBlank = new Map(entries);
  doubleBlank.set("数据库/第一个.md", new TextEncoder().encode("# 同名\n\n\n状态: 必须保留\n\n正文"));
  assert.ok(planNotionImport(doubleBlank).databases[0].records[0].page.body.includes("状态: 必须保留"));
});

test("relations resolve imported records and discard unresolved targets with a report", async () => {
  const entries = new Map(Object.entries({
    "项目.csv": '名称,任务\n项目一,"任务一 (任务/任务一.md), 缺失 (任务/缺失.md)"',
    "项目/项目一.md": "# 项目一\n\n项目正文",
    "任务.csv": "名称,截止\n任务一,September 19 2026",
    "任务/任务一.md": "# 任务一\n\n任务正文",
  }).map(([filePath, text]) => [filePath, new TextEncoder().encode(text)]));
  const result = await buildNotionImport(upgradeWorkspace(fullWorkspace()), planNotionImport(entries), options());
  const owner = result.workspace.pages.find((page) => page.folderId === result.rootFolderId && page.title === "项目");
  const source = result.workspace.dataSources.find((entry) => entry.ownerPageId === owner.id);
  const property = source.properties.find((entry) => entry.name === "任务");
  assert.equal(property.type, "relation");
  const targetSource = result.workspace.dataSources.find((entry) => entry.id === property.config.targetSourceId);
  assert.equal(targetSource.title, "任务");
  const target = result.workspace.databaseItems.find((item) => item.sourceId === targetSource.id);
  const record = result.workspace.databaseItems.find((item) => item.sourceId === source.id);
  assert.deepEqual(record.values[property.id], [target.id]);
  assert.equal(result.report.unrecognizedValues.length, 1);
  assert.equal(result.report.unrecognizedValues[0].value, "缺失");
  assert.ok(result.workspace.relations.some((relation) => relation.sourceId === source.id && relation.propertyId === property.id && relation.targetSourceId === targetSource.id));
  assert.equal(checkWorkspaceIntegrity(result.workspace).ok, true);
});

test("CRC mismatches in flat exports and nested split exports are refused", async () => {
  const corruptZip = async () => {
    const zip = new JSZip();
    zip.file("page.md", "# page\n\nsource", { createFolders: false, compression: "STORE" });
    const bytes = Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "STORE" }));
    const offset = bytes.indexOf(Buffer.from("source"));
    assert.ok(offset > 0);
    bytes[offset] ^= 1;
    return bytes;
  };
  const corrupted = await corruptZip();
  await assert.rejects(readNotionExport(corrupted), /CRC32/);
  const outer = new JSZip();
  outer.file("part.zip", corrupted, { createFolders: false });
  await assert.rejects(readNotionExport(await outer.generateAsync({ type: "uint8array" })), /CRC32/);
});

test("reader skips and oversized attachments are retained in the import report", async () => {
  const plan = fixturePlan();
  const skipped = { path: "oversized.pdf", reason: "单个附件超过 1 GB，已跳过" };
  plan.skipped = [skipped];
  plan.assets.push({ path: "too-big.bin", name: "too-big.bin", bytes: new Uint8Array(), size: 1024 * 1024 * 1024 + 1, mime: "application/octet-stream" });
  const before = structuredClone(plan);
  const result = await buildNotionImport(upgradeWorkspace(fullWorkspace()), plan, options());
  assert.equal(result.report.attachments, 3);
  assert.deepEqual(result.report.skipped[0], skipped);
  assert.notEqual(result.report.skipped[0], skipped);
  assert.equal(result.report.skipped[1].path, "too-big.bin");
  assert.deepEqual(plan, before);
});
