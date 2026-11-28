import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { bigWorkspace } from "../fixtures/big-workspace.mjs";
import { fullWorkspace, PNG_1X1_BASE64 } from "../fixtures/full-workspace.mjs";
import { CURRENT_SCHEMA_VERSION } from "../../src/persistence/migrations.js";
import { walkBlocks } from "../../src/domain/blockDocument.js";
import { openWorkspaceDatabase, quickCheck, readAllRows, assembleWorkspace } from "../../electron/main/storage/workspaceDb.js";
import { createIsolatedDirectory, removeIsolatedDirectory, assertTestPath, seedWorkspaceDatabase, launchApp, closeApp, killMainProcess, openPageInSidebar, assertNoNetworkAndErrors } from "./helpers.mjs";

const frozen = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../fixtures/workspace-v10.json", import.meta.url)), "utf8"));
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

async function storageCase(context, { workspace, normalize = true, prepare, ready = true, packaged = process.env.LIFE_ATLAS_STORAGE_UNPACKAGED !== "1" } = {}) {
  const state = { dataRoot: createIsolatedDirectory("storage-e2e"), handle: null, startupMs: 0, packaged, completed: false };
  context.after(async () => {
    if (!state.completed) console.log(`LIFE_ATLAS_TEST_FAILURE_ROOTS ${JSON.stringify({ test: context.name, dataRoot: state.dataRoot, bootstrapDir: state.handle?.bootstrapDir, tempDir: state.handle?.tempDir })}`);
    if (state.handle) await closeApp(state.handle, { keepDirs: !state.completed });
    else if (state.completed && fs.existsSync(state.dataRoot)) removeIsolatedDirectory(state.dataRoot);
  });
  if (workspace) await seedWorkspaceDatabase(state.dataRoot, workspace, { normalize });
  if (prepare) await prepare(state.dataRoot);
  const started = performance.now();
  state.handle = await launchApp({ packaged, dataRoot: state.dataRoot });
  const launched = performance.now();
  if (ready) await state.handle.page.locator('html[data-la-ready="1"]').waitFor();
  state.startupMs = performance.now() - started;
  state.startupPhases = { launchAppMs: launched - started, readyWaitMs: state.startupMs - (launched - started) };
  return state;
}

async function loadedWorkspace(handle) {
  const result = await handle.page.evaluate(() => window.lifeAtlas.workspace.load());
  assert.equal(result.ok, true, result.error?.message);
  return result.value.workspace;
}

async function persisted(handle, predicate, { timeout = 10000 } = {}) {
  const started = performance.now();
  let workspace;
  while (performance.now() - started < timeout) {
    workspace = await loadedWorkspace(handle);
    if (predicate(workspace)) return workspace;
    await pause(50);
  }
  assert.fail("The expected edit did not reach SQLite before the save deadline");
}

async function stopKeepingData(state) {
  const handle = state.handle;
  await assertNoNetworkAndErrors(handle);
  await closeApp(handle, { keepDirs: true });
  removeIsolatedDirectory(handle.tempDir);
  state.handle = null;
  return handle.bootstrapDir;
}

async function restart(state) {
  const bootstrapDir = await stopKeepingData(state);
  state.handle = await launchApp({ packaged: state.packaged, dataRoot: state.dataRoot, bootstrapDir });
  await state.handle.page.locator('html[data-la-ready="1"]').waitFor();
  return state.handle;
}

function readClosedWorkspace(dataRoot) {
  const db = openWorkspaceDatabase(path.join(dataRoot, "workspace.db"), { readOnly: true });
  try {
    assert.equal(quickCheck(db), "ok");
    return assembleWorkspace(readAllRows(db));
  } finally { db.close(); }
}

async function openPage(page, title) {
  await openPageInSidebar(page, title);
}

async function fillParagraph(page, text) {
  await page.locator('.life-editor .bn-block-content[data-content-type="paragraph"]').first().fill(text);
}

async function slash(page, title) {
  const editor = page.locator('.life-editor .bn-editor[contenteditable="true"]').first();
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(`/${title}`);
  const visibleTitle = title === "数据库 - Full page" ? "数据库 - 整页" : title;
  await page.getByRole("option").filter({ hasText: visibleTitle }).first().click();
}

function fixtureFiles(context) {
  const directory = createIsolatedDirectory("storage-inputs");
  context.after(() => { if (fs.existsSync(directory)) removeIsolatedDirectory(directory); });
  const image = path.join(directory, "storage-image.png");
  const pdf = path.join(directory, "storage-document.pdf");
  const html = path.join(directory, "test.html");
  fs.writeFileSync(image, Buffer.from(PNG_1X1_BASE64, "base64"));
  fs.writeFileSync(pdf, "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
  fs.writeFileSync(html, "<!doctype html><html><body><strong>Safe text fixture</strong><script>window.untrustedAssetExecuted=true</script></body></html>");
  return { directory, image, pdf, html };
}

function assetFiles(dataRoot) {
  const directory = assertTestPath(path.join(dataRoot, "assets"));
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const shard of fs.readdirSync(directory, { withFileTypes: true })) {
    assert.equal(shard.isDirectory(), true);
    assert.match(shard.name, /^[a-f0-9]{2}$/);
    const shardPath = assertTestPath(path.join(directory, shard.name));
    for (const file of fs.readdirSync(shardPath, { withFileTypes: true })) {
      assert.equal(file.isFile(), true);
      assert.match(file.name, /^[a-f0-9]{64}$/);
      files.push(assertTestPath(path.join(shardPath, file.name)));
    }
  }
  return files;
}

async function uploadBlock(handle, file, type) {
  const before = await loadedWorkspace(handle);
  const previousIds = before.pages.flatMap((page) => walkBlocks(page.content).map((entry) => entry.id));
  await slash(handle.page, type === "image" ? "图片" : "文件");
  const addedId = await handle.page.waitForFunction(({ type, previousIds }) => {
    const previous = new Set(previousIds);
    return [...document.querySelectorAll(`.life-editor .bn-block-content[data-content-type="${type}"]`)]
      .map((element) => element.closest("[data-id]")?.getAttribute("data-id"))
      .find((id) => id && !previous.has(id));
  }, { type, previousIds });
  const blockId = await addedId.jsonValue();
  await addedId.dispose();
  const block = handle.page.locator(`.life-editor .bn-block-outer[data-id="${blockId}"] .bn-block-content[data-content-type="${type}"]`);
  await block.locator(".bn-add-file-button").click();
  await handle.page.locator('.bn-panel input[type="file"]').setInputFiles(file);
  await block.locator(".bn-add-file-button").waitFor({ state: "hidden" });
  await handle.page.keyboard.press("Escape");
  const workspace = await persisted(handle, (value) => value.attachments.length > before.attachments.length && value.pages.some((page) => walkBlocks(page.content).some((entry) => entry.id === blockId && /^life-asset:\/\/[a-f0-9]{64}$/.test(entry.props?.url || ""))));
  const uploaded = workspace.pages.flatMap((page) => walkBlocks(page.content)).find((entry) => entry.id === blockId);
  assert.equal(uploaded.props.url, `life-asset://${sha256(file)}`);
  return uploaded.props.url;
}

test("fresh data root opens the blank workspace", { timeout: 60000 }, async (context) => {
  const state = await storageCase(context);
  const sidebar = state.handle.page.locator(".workspace-sidebar");
  assert.deepEqual(await sidebar.locator(".tree-folder-main .workspace-tree-label").allTextContents(), ["我的空间"]);
  assert.deepEqual(await sidebar.locator(".page-tree-row .workspace-tree-label").allTextContents(), ["开始使用 Life Atlas"]);
  const bootstrapDir = await stopKeepingData(state);
  const workspace = readClosedWorkspace(state.dataRoot);
  assert.equal(workspace.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(workspace.folders.filter((folder) => !folder.system).length, 1);
  assert.equal(workspace.folders.filter((folder) => folder.system === "inbox").length, 1);
  assert.equal(workspace.folders.length, 2);
  const inbox = workspace.folders.find((folder) => folder.system === "inbox");
  assert.equal(inbox.id, "system-inbox");
  assert.equal(inbox.name, "收件箱");
  assert.equal(workspace.pages.length, 1);
  removeIsolatedDirectory(bootstrapDir);
  state.completed = true;
});

test("edits survive a restart", { timeout: 90000 }, async (context) => {
  const state = await storageCase(context);
  const page = state.handle.page;
  await page.locator(".private-nav-header").click({ button: "right" });
  await page.getByRole("menuitem", { name: "新建顶层文件夹", exact: true }).click();
  await page.locator(".new-folder-modal").getByLabel("文件夹名称", { exact: true }).fill("重启验收文件夹");
  await page.locator(".new-folder-modal").getByRole("button", { name: "创建文件夹", exact: true }).click();
  await page.locator('.tree-folder-main[title="重启验收文件夹"]').click();
  await page.locator(".private-nav-header").hover();
  await page.locator(".workspace-sidebar").getByRole("button", { name: "新建页面", exact: true }).click();
  await page.locator(".new-folder-modal").getByLabel("页面标题", { exact: true }).fill("重启验收页面");
  await page.locator(".new-folder-modal").getByRole("button", { name: "创建页面", exact: true }).click();
  await fillParagraph(page, "关闭后必须保留的正文");
  await slash(page, "数据库 - Full page");
  await page.locator(".database-view.is-full-page").waitFor();
  for (let index = 0; index < 3; index += 1) await page.getByRole("button", { name: "新建记录", exact: true }).click();
  await persisted(state.handle, (workspace) => workspace.pages.some((entry) => entry.title === "新数据库" && entry.pageType === "database") && workspace.databaseItems.length === 3);
  for (let index = 0; index < 3; index += 1) {
    const titleControl = page.locator(".database-view .db-title-control").nth(index);
    await titleControl.hover();
    await titleControl.locator(".db-title-open").click();
    await page.getByRole("dialog", { name: "记录预览", exact: true }).getByRole("button", { name: "打开完整页面", exact: true }).click();
    await page.getByLabel("页面标题", { exact: true }).fill(`重启记录 ${index + 1}`);
    await openPage(page, "新数据库");
  }
  const before = await persisted(state.handle, (workspace) => workspace.databaseItems.length === 3 && workspace.databaseItems.every((item) => /^重启记录 [123]$/.test(item.values.title)) && workspace.pages.some((entry) => entry.title === "重启验收页面" && JSON.stringify(entry.content).includes("关闭后必须保留的正文")));
  const restoredHandle = await restart(state);
  const after = await loadedWorkspace(restoredHandle);
  assert.deepEqual(after.folders, before.folders);
  assert.deepEqual(after.pages, before.pages);
  assert.deepEqual(after.dataSources, before.dataSources);
  assert.deepEqual(after.databaseViews, before.databaseViews);
  assert.deepEqual(after.databaseItems, before.databaseItems);
  await openPage(restoredHandle.page, "重启验收页面");
  assert.match(await restoredHandle.page.locator(".life-editor").innerText(), /关闭后必须保留的正文/);
  await openPage(restoredHandle.page, "新数据库");
  assert.equal(await restoredHandle.page.locator(".database-view tbody tr[data-item-id]").count(), 3);
  await assertNoNetworkAndErrors(restoredHandle);
  state.completed = true;
});

test("saving sends only the changed page", { timeout: 60000 }, async (context) => {
  const state = await storageCase(context);
  await fillParagraph(state.handle.page, "初始化页面历史");
  await persisted(state.handle, (workspace) => workspace.pages.some((entry) => JSON.stringify(entry.content).includes("初始化页面历史") && workspace.pageVersions.some((version) => version.pageId === entry.id && version.reason === "before-edit")));
  await state.handle.page.locator(".save-state.is-saved").waitFor();
  await fillParagraph(state.handle.page, "仅保存这个页面的改动");
  await persisted(state.handle, (workspace) => JSON.stringify(workspace.pages[0].content).includes("仅保存这个页面的改动"));
  await state.handle.page.locator(".save-state.is-saved").waitFor();
  const changeset = await state.handle.app.evaluate(() => globalThis.__lifeAtlasTest.lastChangeset);
  assert.equal(changeset.upserts, 1);
  assert.equal(changeset.deletes, 0);
  await assertNoNetworkAndErrors(state.handle);
  state.completed = true;
});

test("closing right after typing still saves", { timeout: 60000 }, async (context) => {
  const state = await storageCase(context);
  await fillParagraph(state.handle.page, "立即关闭仍然保存这句正文");
  const handle = await restart(state);
  const workspace = await loadedWorkspace(handle);
  assert.match(JSON.stringify(workspace.pages[0].content), /立即关闭仍然保存这句正文/);
  assert.match(await handle.page.locator(".life-editor").innerText(), /立即关闭仍然保存这句正文/);
  await assertNoNetworkAndErrors(handle);
  state.completed = true;
});

test("a killed process keeps committed data", { timeout: 60000 }, async (context) => {
  const state = await storageCase(context);
  await fillParagraph(state.handle.page, "A 已确认保存");
  await persisted(state.handle, (workspace) => JSON.stringify(workspace.pages[0].content).includes("A 已确认保存"));
  await state.handle.page.locator(".save-state.is-saved").waitFor();
  await fillParagraph(state.handle.page, "A 已确认保存\nB 尚未等待防抖");
  const old = state.handle;
  await killMainProcess(old);
  await closeApp(old, { keepDirs: true });
  removeIsolatedDirectory(old.tempDir);
  state.handle = null;
  state.handle = await launchApp({ packaged: state.packaged, dataRoot: state.dataRoot, bootstrapDir: old.bootstrapDir });
  await state.handle.page.locator('html[data-la-ready="1"]').waitFor();
  const workspace = await loadedWorkspace(state.handle);
  assert.match(JSON.stringify(workspace.pages[0].content), /A 已确认保存/);
  const logsDirectory = assertTestPath(path.join(state.dataRoot, "logs"));
  const log = fs.readdirSync(logsDirectory).filter((name) => /^\d{4}-\d{2}-\d{2}\.log$/.test(name)).map((name) => fs.readFileSync(assertTestPath(path.join(logsDirectory, name)), "utf8")).join("\n");
  assert.match(log, /"event":"lock\.stale-recovered"/);
  const bootstrapDir = await stopKeepingData(state);
  readClosedWorkspace(state.dataRoot);
  removeIsolatedDirectory(bootstrapDir);
  state.completed = true;
});

test("uploaded files become content addressed assets", { timeout: 90000 }, async (context) => {
  const state = await storageCase(context);
  const files = fixtureFiles(context);
  const imageUrl = await uploadBlock(state.handle, files.image, "image");
  await uploadBlock(state.handle, files.pdf, "file");
  const stored = assetFiles(state.dataRoot);
  assert.equal(stored.length, 2);
  assert.ok(stored.some((file) => path.basename(file) === sha256(files.image)));
  assert.ok(stored.some((file) => path.basename(file) === sha256(files.pdf)));
  for (const file of stored) assert.equal(sha256(file), path.basename(file));
  await uploadBlock(state.handle, files.image, "image");
  assert.equal(assetFiles(state.dataRoot).length, 2);
  const handle = await restart(state);
  await handle.page.waitForFunction((url) => [...document.querySelectorAll(".life-editor img")].some((image) => image.src === url && image.complete && image.naturalWidth > 0), imageUrl);
  await assertNoNetworkAndErrors(handle);
  state.completed = true;
});

test("icon and cover uploads are stored as assets", { timeout: 60000 }, async (context) => {
  const state = await storageCase(context);
  const files = fixtureFiles(context);
  await state.handle.page.getByRole("button", { name: "更换图标", exact: true }).click();
  const iconDialog = state.handle.page.getByRole("dialog", { name: "更换图标", exact: true });
  await iconDialog.getByRole("tab", { name: "Upload", exact: true }).click();
  await iconDialog.locator('input[type="file"]').setInputFiles(files.image);
  await iconDialog.locator('.icon-upload-preview img[src^="life-asset://"]').waitFor();
  await iconDialog.getByRole("button", { name: "保存图标", exact: true }).click();
  await state.handle.page.locator(".page-document-header").hover();
  await state.handle.page.getByRole("button", { name: "添加封面", exact: true }).click();
  const coverDialog = state.handle.page.getByRole("dialog", { name: "更换封面", exact: true });
  await coverDialog.getByRole("tab", { name: "Upload", exact: true }).click();
  await coverDialog.locator('input[type="file"]').setInputFiles(files.image);
  await coverDialog.locator('input[type="range"]').waitFor();
  await coverDialog.getByRole("button", { name: "保存封面", exact: true }).click();
  await persisted(state.handle, (workspace) => /^life-asset:\/\//.test(workspace.pages[0].icon) && /^life-asset:\/\//.test(workspace.pages[0].cover?.value || ""));
  const bootstrapDir = await stopKeepingData(state);
  const db = openWorkspaceDatabase(path.join(state.dataRoot, "workspace.db"), { readOnly: true });
  try {
    for (const row of db.prepare("SELECT json FROM entities").all()) assert.doesNotMatch(row.json, /data:image\/[^;]+;base64,/);
    const workspace = assembleWorkspace(readAllRows(db));
    assert.equal(workspace.pages[0].icon, `life-asset://${sha256(files.image)}`);
    assert.equal(workspace.pages[0].cover.value, `life-asset://${sha256(files.image)}`);
  } finally { db.close(); }
  removeIsolatedDirectory(bootstrapDir);
  state.completed = true;
});

test("asset protocol validates requests", { timeout: 60000 }, async (context) => {
  const state = await storageCase(context);
  const files = fixtureFiles(context);
  const htmlUrl = await uploadBlock(state.handle, files.html, "file");
  const result = await state.handle.page.evaluate(async (url) => {
    const invalid = await fetch("life-asset://xyz");
    const missing = await fetch(`life-asset://${"0".repeat(64)}`);
    const html = await fetch(url);
    const range = await fetch(url, { headers: { Range: "bytes=0-9" } });
    return { invalid: invalid.status, missing: missing.status, html: { status: html.status, mime: html.headers.get("content-type"), nosniff: html.headers.get("x-content-type-options"), csp: html.headers.get("content-security-policy"), text: await html.text() }, range: { status: range.status, size: (await range.arrayBuffer()).byteLength, contentRange: range.headers.get("content-range") }, executed: window.untrustedAssetExecuted === true };
  }, htmlUrl);
  assert.equal(result.invalid, 400);
  assert.equal(result.missing, 404);
  assert.equal(result.html.status, 200);
  assert.match(result.html.mime, /^text\/plain/);
  assert.equal(result.html.nosniff, "nosniff");
  assert.equal(result.html.csp, "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
  assert.equal(result.html.text, fs.readFileSync(files.html, "utf8"));
  assert.equal(result.range.status, 206);
  assert.equal(result.range.size, 10);
  assert.match(result.range.contentRange, /^bytes 0-9\/\d+$/);
  assert.equal(result.executed, false);
  await assertNoNetworkAndErrors(state.handle, { expectedHttpErrors: [
    { url: "life-asset://xyz", status: 400, count: 1 },
    { url: `life-asset://${"0".repeat(64)}`, status: 404, count: 1 },
  ] });
  state.completed = true;
});

test("a schema 10 database is migrated with a snapshot", { timeout: 60000 }, async (context) => {
  const state = await storageCase(context, { workspace: frozen, normalize: false });
  const snapshots = fs.readdirSync(assertTestPath(path.join(state.dataRoot, "snapshots"))).filter((name) => name.endsWith("-pre-migration"));
  assert.equal(snapshots.length, 1);
  const snapshotDb = openWorkspaceDatabase(path.join(state.dataRoot, "snapshots", snapshots[0], "workspace.db"), { readOnly: true });
  try { assert.deepEqual(assembleWorkspace(readAllRows(snapshotDb)), frozen); } finally { snapshotDb.close(); }
  assert.equal((await loadedWorkspace(state.handle)).schemaVersion, CURRENT_SCHEMA_VERSION);
  await openPage(state.handle.page, "编辑器验收");
  await state.handle.page.locator(".life-editor").waitFor();
  await assertNoNetworkAndErrors(state.handle);
  state.completed = true;
});

test("a corrupted database shows the error page and stays untouched", { timeout: 60000 }, async (context) => {
  let originalHash;
  const state = await storageCase(context, { workspace: fullWorkspace(), ready: false, prepare: (dataRoot) => {
    const file = assertTestPath(path.join(dataRoot, "workspace.db"));
    const descriptor = fs.openSync(file, "r+");
    try { fs.writeSync(descriptor, Buffer.from("not-a-database!!"), 0, 16, 0); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    originalHash = sha256(file);
  } });
  await state.handle.page.getByRole("heading", { name: "数据无法读取", exact: true }).waitFor();
  await pause(10000);
  assert.equal(sha256(path.join(state.dataRoot, "workspace.db")), originalHash);
  assert.equal(fs.existsSync(path.join(state.dataRoot, "workspace.db-wal")), false);
  assert.equal((await state.handle.page.evaluate(() => window.lifeAtlas.workspace.load())).error.code, "E_CORRUPT");
  assert.equal((await state.handle.page.evaluate((schemaVersion) => window.lifeAtlas.workspace.applyChanges({ generation: "gen-e2e", schemaVersion, upserts: [], deletes: [], ui: null }), CURRENT_SCHEMA_VERSION)).error.code, "E_CORRUPT");
  await assertNoNetworkAndErrors(state.handle);
  state.completed = true;
});

test("large workspaces open within budget", { timeout: 120000 }, async (context) => {
  const state = await storageCase(context, { workspace: bigWorkspace() });
  console.log(`WP04_STARTUP_MS=${state.startupMs.toFixed(3)}`);
  const firstLoadMs = await state.handle.app.evaluate(() => globalThis.__lifeAtlasTest.storageTimings.lastLoadMs);
  const navigation = await state.handle.page.evaluate(() => performance.getEntriesByType("navigation").map((entry) => ({ responseEnd: entry.responseEnd, domContentLoadedEventEnd: entry.domContentLoadedEventEnd, loadEventEnd: entry.loadEventEnd })));
  console.log(`WP04_STARTUP_PHASES=${JSON.stringify({ ...state.startupPhases, firstObservedStorageLoadMs: firstLoadMs, navigation })}`);
  await state.handle.page.getByLabel("页面标题", { exact: true }).fill("性能标题修改");
  await persisted(state.handle, (workspace) => workspace.pages.find((entry) => entry.id === "big-db-page")?.title === "性能标题修改");
  const applyMs = await state.handle.app.evaluate(() => globalThis.__lifeAtlasTest.storageTimings.lastApplyMs);
  console.log(`WP04_APPLY_MS=${applyMs.toFixed(3)}`);
  assert.ok(state.startupMs < 3000, `Startup took ${state.startupMs.toFixed(3)}ms, budget is <3000ms`);
  assert.ok(applyMs < 50, `SQLite apply took ${applyMs.toFixed(3)}ms, budget is <50ms`);
  await assertNoNetworkAndErrors(state.handle);
  state.completed = true;
});

test("invalid changesets are rejected by the main process", { timeout: 60000 }, async (context) => {
  const state = await storageCase(context);
  const before = await loadedWorkspace(state.handle);
  const results = await state.handle.page.evaluate(async () => {
    const loaded = await window.lifeAtlas.workspace.load();
    const changeset = { generation: loaded.value.generation, schemaVersion: loaded.value.workspace.schemaVersion, upserts: [], deletes: [], ui: null };
    const oversized = JSON.stringify({ id: "oversized-page", title: "Oversized", content: "x".repeat(20 * 1024 * 1024) });
    const invalid = [
      { collection: "not-a-collection", id: "bad", json: JSON.stringify({ id: "bad" }) },
      { collection: "pages", id: "x".repeat(201), json: JSON.stringify({ id: "x".repeat(201) }) },
      { collection: "pages", id: "oversized-page", json: oversized },
    ];
    return Promise.all(invalid.map((entry) => window.lifeAtlas.workspace.applyChanges({ ...changeset, upserts: [entry] })));
  });
  for (const result of results) { assert.equal(result.ok, false); assert.equal(result.error.code, "E_INVALID_ARGUMENT"); }
  assert.deepEqual(await loadedWorkspace(state.handle), before);
  await assertNoNetworkAndErrors(state.handle);
  state.completed = true;
});
