import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { collectTableCsvFiles, createMarkdownCsvArchive, pageToMarkdown, pageToStandaloneHtml } from "../src/domain/pageExport.js";
import { parseCsv } from "../src/domain/csv.js";
import { markdownToBlocks } from "../src/domain/markdownBlocks.js";
import * as history from "../src/domain/pageHistory.js";
import { convertBrowserPackage } from "../electron/main/backup/legacyConversion.js";
import { createBackupInspector } from "../electron/main/backup/inspection.js";
import { restoreFromToken } from "../electron/main/backup/desktopRestore.js";
import { exportFullBackup } from "../electron/main/backup/desktopExport.js";
import { exportBrowserBackup } from "../src/backup/browserBackup.js";
import { backupWorkspace } from "./fixtures/backup-helpers.mjs";
import { fullWorkspaceAttachmentBytes, FIXTURE_TIME } from "./fixtures/full-workspace.mjs";
import { createDesktopBackupContext } from "./desktop/backup-helpers.mjs";

const inline = (text) => [{ type: "text", text, styles: {} }];
const cell = (text, props) => props ? { type: "tableCell", props, content: inline(text) } : inline(text);
const table = (rows, headerRows = 0, headerCols = 0) => ({
  type: "table",
  content: { type: "tableContent", headerRows, headerCols, rows: rows.map((cells) => ({ cells })) },
});
const merged = table([
  [cell("H0"), cell("H1"), cell("H2"), cell("H3")],
  [cell("L1", { rowspan: 2 }), cell("A", { colspan: 2 }), cell("B")],
  [cell("C"), cell("D"), cell("E")],
], 1, 1);
const tablePage = { id: "test-grid", title: "合成跨度", content: [merged] };
const tableGrid = [["H0", "H1", "H2", "H3"], ["L1", "A", "", "B"], ["", "C", "D", "E"]];

test("existing spans export at their logical coordinates in both Markdown paths and CSV", () => {
  const before = structuredClone(tablePage);
  assert.deepEqual(parseCsv(collectTableCsvFiles(tablePage)[0].csv), tableGrid);
  for (const options of [{}, { workspace: {}, links: {} }]) {
    const text = pageToMarkdown(tablePage, { ...options, includeTitle: false });
    const [tableBlock] = markdownToBlocks(text, { idFactory: () => "imported-table", extended: true });
    assert.deepEqual(tableBlock.content.rows.map(({ cells }) => cells.map((items) => items.map((item) => item.text).join(""))), tableGrid);
  }
  assert.deepEqual(tablePage, before);
});

test("standalone HTML preserves spans and uses logical header columns", () => {
  const html = pageToStandaloneHtml(tablePage);
  assert.match(html, /<th rowspan="2">L1<\/th><td colspan="2">A<\/td><td>B<\/td>/);
  assert.match(html, /<tr><td>C<\/td><td>D<\/td><td>E<\/td><\/tr>/);
});

test("overlapping old spans export HTML and CSV at the same recovered cell positions", () => {
  const page = { content: [table([
    [cell("X"), cell("A", { rowspan: 2, colspan: 2 })],
    [cell("C", { colspan: 2 })],
  ])] };
  assert.match(pageToStandaloneHtml(page), /<td rowspan="2" colspan="2">A<\/td><\/tr><tr><td><\/td><td colspan="2">C<\/td>/);
  assert.deepEqual(parseCsv(collectTableCsvFiles(page)[0].csv), [["X", "A", "", "", ""], ["", "", "", "C", ""]]);
});

test("the real Markdown and CSV ZIP explains span loss and keeps fully covered rows", async () => {
  const page = { title: "复合跨度", content: [table([[cell("<A>", { colspan: 2, rowspan: 2 })], [], [cell("B"), cell("C")]])] };
  const archive = await createMarkdownCsvArchive(page);
  const zip = await JSZip.loadAsync(await archive.blob.arrayBuffer());
  assert.match(await zip.file("_README.txt").async("string"), /跨度|合并/);
  assert.deepEqual(parseCsv(await zip.file("table-01.csv").async("string")), [["<A>", ""], ["", ""], ["B", "C"]]);
  assert.match(await zip.file("复合跨度.md").async("string"), /\| {2}\| {2}\|/);
  assert.match(pageToStandaloneHtml(page), /<td rowspan="2" colspan="2">&lt;A&gt;<\/td><\/tr><tr><\/tr>/);
});

const note = (id, text = id, children = []) => ({ id, type: "paragraph", content: inline(text), children });

test("history detects reorder and parent changes without confusing additions and deletions with moves", () => {
  assert.equal(typeof history.countMovedBlocks, "function");
  const before = [note("a"), note("b"), note("c"), note("removed")];
  const after = [note("added"), note("a"), note("b", "edited"), note("c")];
  assert.equal(history.countMovedBlocks(before, after), 0);
  assert.equal(history.countMovedBlocks(before, [note("b"), note("c"), note("a"), note("removed")]), 1);
  assert.equal(history.countMovedBlocks(before, [note("a", "a", [note("b")]), note("c"), note("removed")]), 1);
  assert.equal(history.countMovedBlocks([note("p", "p", [note("x"), note("y")])], [note("p", "p", [note("y"), note("x")])]), 1);
  assert.deepEqual(history.compareBlocks(before, after), { added: 1, removed: 1, changed: 1 });
});

test("legacy parents with missing or duplicated IDs do not make unrelated children look moved", () => {
  for (const parentId of [undefined, "repeated"]) {
    const before = [note(parentId, "first", [note("a")]), note(parentId, "second", [note("b")])];
    assert.equal(history.countMovedBlocks(before, [...before].reverse()), 0);
  }
});

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const assetUrl = (bytes) => `life-asset://${digest(bytes)}`;
const versionMedia = (id, url) => ({ id, type: "file", props: { url }, children: [] });
const b64 = (bytes, mime = "image/png") => `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
const dangling = "blob:history-only#life-attachment=unknown-history-id";

test("legacy conversion reports unresolved fields under the historical version ID", async () => {
  const input = { pageVersions: [{ id: "version-only", pageId: "page", content: [note("parent", "unchanged", [versionMedia("file", dangling)])] }] };
  const { workspace, report } = await convertBrowserPackage(input, [], { putAsset: () => assert.fail("unresolved bytes must not be fabricated") });
  assert.deepEqual(workspace, input);
  assert.deepEqual(report.leftovers, [{ collection: "pageVersions", id: "version-only", field: "content[0].children[0].props.url" }]);
});

test("conversion handles a large original version and still rejects noncanonical Base64 and invalid asset results", async () => {
  const bytes = Buffer.alloc(3 * 1024 * 1024, 0xa3);
  const url = b64(bytes);
  const snapshot = history.createPageVersion({ id: "page", icon: url, content: [note("p")] }, { id: "large-history", reason: "before-edit", now: FIXTURE_TIME });
  assert.ok(snapshot.sizeBytes > 4 * 1024 * 1024);
  const result = await convertBrowserPackage({ pageVersions: [snapshot] }, [], { putAsset: (written) => {
    assert.deepEqual(written, bytes);
    return { url: assetUrl(written) };
  } });
  assert.equal(result.workspace.pageVersions[0].icon, assetUrl(bytes));
  assert.equal(result.workspace.pageVersions[0].sizeBytes, snapshot.sizeBytes);
  assert.equal(result.report.convertedDataUrls, 1);
  for (const [bad, code] of [["data:image/png;base64,YR==", "E_CORRUPT"], ["data:image/png;base64,YQ==", "E_IO"]]) {
    await assert.rejects(convertBrowserPackage({ pageVersions: [{ id: "bad", icon: bad }] }, [], { putAsset: () => ({ url: "invalid" }) }), { code });
  }
});

test("history-only icon, cover and nested attachment bytes survive migration, full backup and SQLite reopen", async (context) => {
  const dest = await createDesktopBackupContext(context, { seed: false });
  const fresh = await createDesktopBackupContext(context, { seed: false });
  const icon = Buffer.from("v160-history-only-icon");
  const cover = Buffer.from("v160-history-only-cover");
  const attachmentBytes = Buffer.from("v160-history-only-file");
  const legacy = "blob:synthetic#life-attachment=v160-historical-file";
  const workspace = backupWorkspace();
  const version = history.createPageVersion({
    ...workspace.pages.find((page) => page.id === "p-c1"),
    icon: b64(icon), cover: { kind: "upload", value: b64(cover), position: 39 },
    content: [note("parent", "unchanged", [{ ...versionMedia("file", legacy), props: { url: legacy, attachmentId: "v160-historical-file" } }]), note("literal", b64(icon))],
  }, { id: "version-exclusive", reason: "before-edit", now: FIXTURE_TIME });
  workspace.pageVersions = [version];
  workspace.attachments.push({ id: "v160-historical-file", provider: "local-ref", storageKey: "v160-storage-key", name: "history.bin", mime: "application/octet-stream", size: attachmentBytes.length, createdAt: FIXTURE_TIME });
  const attachments = fullWorkspaceAttachmentBytes();
  attachments.set("v160-storage-key", attachmentBytes);
  const { blob, skippedAttachmentIds } = await exportBrowserBackup({ workspace, now: FIXTURE_TIME, readAttachmentBlob: (id) => attachments.has(id) ? new Blob([attachments.get(id)]) : null });
  assert.deepEqual(skippedAttachmentIds, []);
  const incoming = path.join(dest.dataRoot, "browser-history.lifeatlas");
  fs.writeFileSync(incoming, Buffer.from(await blob.arrayBuffer()));
  const inspectAndRestore = async (target, file, platform) => {
    const inspector = createBackupInspector({ dataRoot: target.dataRoot, now: FIXTURE_TIME });
    try {
      const inspected = await inspector.inspectFile(file);
      assert.equal(inspected.summary?.platform, platform);
      assert.ok(inspected.token);
      await restoreFromToken(inspected.token, { ...target, inspector, restoreVault: false });
      target.workspaceService.close();
      await target.workspaceService.load();
    } finally { inspector.stop(); }
  };
  const expected = structuredClone(version);
  expected.icon = assetUrl(icon);
  expected.cover.value = assetUrl(cover);
  expected.content[0].children[0].props.url = assetUrl(attachmentBytes);
  const assertVersion = (target) => {
    const loaded = target.workspaceService.readWorkspace();
    assert.deepEqual(loaded.pageVersions.find((entry) => entry.id === version.id), expected);
    assert.equal(loaded.attachments.find((entry) => entry.id === "v160-historical-file").storageKey, digest(attachmentBytes));
    for (const bytes of [icon, cover, attachmentBytes]) assert.deepEqual(fs.readFileSync(target.assetStore.filePath(digest(bytes))), bytes);
    assert.equal(target.workspaceService.db.prepare("PRAGMA quick_check").get().quick_check, "ok");
  };
  await inspectAndRestore(dest, incoming, "browser");
  assertVersion(dest);
  const full = path.join(dest.dataRoot, "desktop-history.lifeatlas");
  await exportFullBackup({ ...dest, db: dest.workspaceService.db, workspace: dest.workspaceService.readWorkspace(), targetPath: full });
  await inspectAndRestore(fresh, full, "desktop");
  assertVersion(fresh);
});

test("an unresolved historical attachment rejects a valid package before swapping the live SQLite database", async (context) => {
  const target = await createDesktopBackupContext(context);
  const workspace = backupWorkspace();
  workspace.pageVersions = [history.createPageVersion({ ...workspace.pages[0], content: [versionMedia("dangling", dangling)] }, { id: "dangling-history", reason: "before-edit", now: FIXTURE_TIME })];
  const attachments = fullWorkspaceAttachmentBytes();
  const { blob } = await exportBrowserBackup({ workspace, now: FIXTURE_TIME, readAttachmentBlob: (id) => attachments.has(id) ? new Blob([attachments.get(id)]) : null });
  const incoming = path.join(target.dataRoot, "dangling-history.lifeatlas");
  fs.writeFileSync(incoming, Buffer.from(await blob.arrayBuffer()));
  const inspector = createBackupInspector({ dataRoot: target.dataRoot, now: FIXTURE_TIME });
  context.after(() => inspector.stop());
  const { token, problems } = await inspector.inspectFile(incoming);
  assert.ok(token, JSON.stringify(problems));
  target.workspaceService.checkpoint();
  const fileBefore = digest(fs.readFileSync(target.workspaceService.filePath));
  const generation = target.workspaceService.getMeta("generation");
  await assert.rejects(restoreFromToken(token, { ...target, inspector, restoreVault: false }), { code: "E_CORRUPT" });
  assert.equal(target.workspaceService.getMeta("generation"), generation);
  assert.equal(digest(fs.readFileSync(target.workspaceService.filePath)), fileBefore);
  assert.deepEqual(fs.readdirSync(target.dataRoot).filter((name) => name.startsWith(".staging-")), []);
});
