import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { ensureDataRootMarker } from "../../electron/main/storage/dataRoot.js";
import { createHash } from "node:crypto";
import { convertBrowserPackage } from "../../electron/main/backup/legacyConversion.js";
import { normalizeLoadedWorkspace } from "../../src/persistence/normalize.js";
import { requiredCollections } from "../../src/backup/format.js";
import { sha256File } from "../../electron/main/backup/files.js";
import { backupFixture, sortedEntities } from "../fixtures/backup-helpers.mjs";
import { FIXTURE_TIME } from "../fixtures/full-workspace.mjs";
import { createBackupDesktopCase, readClosedBackupWorkspace, readBackupFileWorkspace, assertBackupWorkspaceEqual, assertBackupWorkspaceEntitiesEqual, assertBackupWorkspaceAfterInitialVisit, exportBackupUi, shootBackupModes } from "./backup-helpers.mjs";
import { REPO_ROOT, createIsolatedDirectory, queueDialogResponse, openPageInSidebar } from "./helpers.mjs";

const shotsDir = path.join(REPO_ROOT, ".qa/LOCAL-NOTION-001/WP-05/shots");

async function chooseRoot(state, target) {
  await queueDialogResponse(state.handle, "showOpenDialog", { canceled: false, filePaths: [target] });
  await state.handle.page.locator(".wizard .wiz-choice").nth(1).click();
  await state.handle.page.getByRole("status").waitFor();
}

async function finishWizard(state, target, { beforeLaunch } = {}) {
  await state.handle.page.getByRole("button", { name: "继续", exact: true }).click();
  const exit = once(state.handle.app.process(), "exit");
  await state.handle.page.getByRole("button", { name: "开始使用", exact: true }).click();
  assert.equal((await exit)[0], 0);
  await state.close({ check: false });
  assert.equal(JSON.parse(fs.readFileSync(path.join(state.bootstrapDir, "bootstrap.json"), "utf8")).dataRoot, target);
  if (beforeLaunch) await beforeLaunch();
  await state.launch({ wizard: false });
  const info = await state.handle.page.evaluate(() => window.lifeAtlas.app.getInfo());
  assert.equal(info.ok, true);
  assert.equal(info.value.dataRoot, target);
}

test("wizard creates a blank workspace in the chosen folder", { timeout: 120000 }, async (context) => {
  const state = await createBackupDesktopCase(context, { setup: true, packaged: true, retainOnFailure: true });
  const parent = state.own(createIsolatedDirectory("first-run-blank"));
  const target = path.join(parent, "data");
  await chooseRoot(state, target);
  await state.handle.page.getByRole("status").filter({ hasText: "将创建这个文件夹" }).waitFor();
  await shootBackupModes(state.handle, state.handle.page, shotsDir, "wizard", { preserveSize: true });
  await state.handle.page.getByRole("button", { name: "继续", exact: true }).click();
  await state.handle.page.getByRole("button", { name: /^新建空白工作区/ }).click();
  await shootBackupModes(state.handle, state.handle.page, shotsDir, "wizard-start", { preserveSize: true });
  await finishWizard(state, target);
  await state.handle.page.getByLabel("页面标题", { exact: true }).waitFor();
  assert.equal(await state.handle.page.getByLabel("页面标题", { exact: true }).inputValue(), "开始使用 Life Atlas");
  await state.close();
  const workspace = readClosedBackupWorkspace(target);
  assert.equal(workspace.folders.filter((folder) => !folder.system).length, 1);
  assert.equal(workspace.folders.filter((folder) => folder.system === "inbox").length, 1);
  assert.equal(workspace.folders.length, 2);
  const inbox = workspace.folders.find((folder) => folder.system === "inbox");
  assert.equal(inbox.id, "system-inbox");
  assert.equal(inbox.name, "收件箱");
  assert.equal(workspace.pages.some((page) => page.folderId === inbox.id), false);
  assert.equal(workspace.pages.length, 1);
  assert.equal(workspace.pages[0].title, "开始使用 Life Atlas");
  state.complete();
});

test("wizard folder rules are enforced", { timeout: 60000 }, async (context) => {
  const state = await createBackupDesktopCase(context, { setup: true, packaged: true, retainOnFailure: true });
  const parent = state.own(createIsolatedDirectory("first-run-folder-rules"));
  const unrelated = path.join(parent, "unrelated");
  fs.mkdirSync(unrelated);
  fs.writeFileSync(path.join(unrelated, "keep.txt"), "unrelated file");
  await chooseRoot(state, unrelated);
  await state.handle.page.getByRole("status").filter({ hasText: "已有其他文件" }).waitFor();
  assert.equal(await state.handle.page.getByRole("button", { name: "继续", exact: true }).isDisabled(), true);
  assert.equal(fs.readFileSync(path.join(unrelated, "keep.txt"), "utf8"), "unrelated file");
  const existing = path.join(parent, "existing");
  ensureDataRootMarker(existing, { appVersion: "0.1.0", now: FIXTURE_TIME });
  await chooseRoot(state, existing);
  await state.handle.page.getByRole("status").filter({ hasText: "已经是 Life Atlas 数据目录" }).waitFor();
  assert.equal(await state.handle.page.getByRole("button", { name: "继续", exact: true }).isEnabled(), true);
  await state.handle.page.getByRole("button", { name: "继续", exact: true }).click();
  await state.handle.page.getByRole("button", { name: /^打开这个工作区/ }).waitFor();
  await state.handle.page.getByRole("button", { name: "上一步", exact: true }).click();
  const synced = path.join(parent, "OneDrive", "new-data");
  await chooseRoot(state, synced);
  await state.handle.page.getByRole("status").filter({ hasText: "同步盘可能损坏" }).waitFor();
  await state.handle.page.getByLabel("我了解这个提醒，仍要使用此位置", { exact: true }).check();
  assert.equal(await state.handle.page.getByRole("button", { name: "继续", exact: true }).isEnabled(), true);
  await state.close();
  state.complete();
});

test("wizard restores a browser migration package", { timeout: 150000 }, async (context) => {
  const state = await createBackupDesktopCase(context, { setup: true, packaged: true, retainOnFailure: true });
  const parent = state.own(createIsolatedDirectory("first-run-browser-migration"));
  const target = path.join(parent, "data");
  const browser = await backupFixture();
  const assets = JSON.parse(Buffer.from(browser.files.get("assets/index.json")).toString("utf8"));
  const converted = await convertBrowserPackage(browser.workspace, assets, { putAsset: (bytes) => { const assetId = createHash("sha256").update(bytes).digest("hex"); return { assetId, url: `life-asset://${assetId}` }; } });
  const expected = normalizeLoadedWorkspace(converted.workspace, { fallbackWorkspace: converted.workspace, now: FIXTURE_TIME });
  const source = path.join(parent, "migration.lifeatlas");
  fs.writeFileSync(source, browser.bytes);
  await chooseRoot(state, target);
  await state.handle.page.getByRole("button", { name: "继续", exact: true }).click();
  await state.handle.page.getByRole("button", { name: /^从备份恢复/ }).click();
  await queueDialogResponse(state.handle, "showOpenDialog", { canceled: false, filePaths: [source] });
  await state.handle.page.getByRole("button", { name: "选择备份文件…", exact: true }).click();
  await state.handle.page.locator(".wiz-summary").getByText("浏览器迁移包", { exact: true }).waitFor();
  await finishWizard(state, target, { beforeLaunch: () => assertBackupWorkspaceEqual(readClosedBackupWorkspace(target), expected) });
  const loaded = await state.handle.page.evaluate(() => window.lifeAtlas.workspace.load());
  assert.equal(loaded.ok, true);
  assertBackupWorkspaceAfterInitialVisit(loaded.value.workspace, expected);
  for (const entry of assets) assert.equal((await sha256File(path.join(target, "assets", entry.sha256.slice(0, 2), entry.sha256))).sha256, entry.sha256);
  let exportedWorkspace;
  const output = path.join(parent, "after-visits.lifeatlas");
  await exportBackupUi(state.handle, output, { onWorkspace: (value) => { exportedWorkspace = value; } });
  assertBackupWorkspaceEntitiesEqual(exportedWorkspace, expected);
  assertBackupWorkspaceEqual(await readBackupFileWorkspace(output), exportedWorkspace);
  await state.close();
  const workspace = readClosedBackupWorkspace(target);
  for (const collection of requiredCollections(expected.schemaVersion)) assert.deepEqual(sortedEntities(workspace[collection]), sortedEntities(expected[collection]), collection);
  assert.deepEqual(workspace.ui.preferences, expected.ui.preferences);
  assert.equal(JSON.stringify(workspace.pages).includes("data:image/png;base64"), false);
  assert.equal(JSON.stringify(workspace.pages).includes("#life-attachment="), false);
  assert.equal(workspace.attachments.length, 3);
  await state.launch({ wizard: false });
  await openPageInSidebar(state.handle.page, "B 笔记");
  await state.handle.page.waitForFunction(() => [...document.querySelectorAll(".life-editor img")].some((image) => image.complete && image.naturalWidth > 0));
  await openPageInSidebar(state.handle.page, "C 深层");
  await state.handle.page.waitForFunction(() => [...document.querySelectorAll(".page-icon-button img")].some((image) => image.complete && image.naturalWidth > 0));
  await openPageInSidebar(state.handle.page, "Z 目标页");
  await state.handle.page.locator(".page-cover").waitFor();
  await shootBackupModes(state.handle, state.handle.page, shotsDir, "after-migration");
  await state.close();
  state.complete();
});
