import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createAssetStore } from "../../electron/main/storage/assetStore.js";
import { openWorkspaceDatabase, prepareWritable, readAllRows, assembleWorkspace, writeWorkspaceDiff } from "../../electron/main/storage/workspaceDb.js";
import { convertBrowserPackage } from "../../electron/main/backup/legacyConversion.js";
import { checkWorkspaceIntegrity } from "../../src/domain/integrity.js";
import { createIsolatedDirectory, removeIsolatedDirectory, seedWorkspaceDatabase, launchApp, closeApp, queueDialogResponse, assertNoNetworkAndErrors } from "../desktop/helpers.mjs";
import { FIXTURE_TIME, fixtureBytes, fullWorkspaceAttachmentBytes } from "../fixtures/full-workspace.mjs";
import { releaseWorkspace } from "../fixtures/release-workspace.mjs";

const attachmentBytes = 256 * 1024 * 1024;
const searchTargets = [
  { id: "big-p-4321", title: "性能检索目标一" },
  { id: "big-p-17", title: "性能检索目标二" },
  { id: "big-p-2500", title: "性能检索目标三" },
];

async function seedPerformanceWorkspace(dataRoot) {
  await seedWorkspaceDatabase(dataRoot, releaseWorkspace());
  const db = openWorkspaceDatabase(path.join(dataRoot, "workspace.db"));
  try {
    prepareWritable(db);
    const rows = readAllRows(db);
    const input = assembleWorkspace(rows);
    const store = createAssetStore({ assetsDir: path.join(dataRoot, "assets"), db, now: FIXTURE_TIME });
    const fullBytes = fullWorkspaceAttachmentBytes();
    const index = [];
    for (const attachment of input.attachments) {
      const bytes = fullBytes.get(attachment.id);
      assert.ok(bytes, `Missing full fixture attachment bytes: ${attachment.id}`);
      const { assetId } = store.put({ bytes, mime: attachment.mime, name: attachment.name });
      index.push({ sha256: assetId, size: bytes.byteLength, mime: attachment.mime, originalName: attachment.name, createdAt: attachment.createdAt, legacyAttachmentId: attachment.id });
    }
    const converted = await convertBrowserPackage(input, index, { putAsset: (bytes, metadata) => store.put({ bytes, mime: metadata.mime, name: metadata.name }) });
    assert.deepEqual(converted.report.leftovers, []);
    const workspace = converted.workspace;
    const attachments = [];
    for (let index = 0; index < 4; index += 1) {
      let bytes = fixtureBytes(`release-big-${index}`, attachmentBytes);
      const name = `大附件-${index}.mp4`;
      const { assetId } = store.put({ bytes, mime: "video/mp4", name });
      bytes = null;
      const asset = store.get(assetId);
      assert.equal(asset.size, attachmentBytes);
      assert.equal(fs.statSync(store.filePath(assetId)).size, attachmentBytes);
      attachments.push({ id: `release-big-attachment-${index}`, name, mime: "video/mp4", size: asset.size, provider: "asset", storageKey: assetId, checksum: assetId, externalUrl: null, metadata: {}, createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME });
    }
    assert.equal(new Set(attachments.map((attachment) => attachment.checksum)).size, 4);
    const template = workspace.pages.find((page) => page.id === "p-z1");
    assert.ok(template);
    assert.ok(workspace.folders.some((folder) => folder.id === "f-z"));
    workspace.attachments.push(...attachments);
    workspace.pages.push({ ...structuredClone(template), id: "release-big-attachments-page", folderId: "f-z", parentPageId: null, title: "大附件", icon: "📎", iconColor: null, cover: null, sortIndex: 50, content: attachments.map((attachment, index) => ({ id: `release-big-file-${index}`, type: "file", props: { url: `life-asset://${attachment.storageKey}`, name: attachment.name, caption: "" } })) });
    assert.equal(checkWorkspaceIntegrity(workspace).ok, true);
    writeWorkspaceDiff(db, rows, workspace, { now: FIXTURE_TIME });
    assert.equal(fs.existsSync(path.join(dataRoot, "vault.db")), false);
  } finally { db.close(); }
}

function median(samples) {
  assert.equal(samples.length, 3);
  assert.ok(samples.every((sample) => Number.isFinite(sample) && sample >= 0));
  return [...samples].sort((first, second) => first - second)[1];
}

async function waitForFullBackup(handle, previousBackupAt) {
  const deadline = Date.now() + 300000;
  do {
    const status = await handle.page.evaluate(() => window.lifeAtlas.backup.getStatus());
    assert.equal(status.ok, true, status.error?.message || "Backup status is unavailable");
    if (Boolean(status.value.lastFullBackupAt) && status.value.lastFullBackupAt !== previousBackupAt) return;
    await delay(100);
  } while (Date.now() < deadline);
  assert.fail("The completed full backup did not reach status before the wait deadline");
}

test("release performance stays within budget", { timeout: 1200000 }, async (context) => {
  const dataRoot = createIsolatedDirectory("release-performance-data");
  const output = createIsolatedDirectory("release-performance-output");
  context.diagnostic(`RELEASE_PERFORMANCE_ROOTS ${JSON.stringify({ dataRoot, output })}`);
  let handle;
  let completed = false;
  context.after(async () => {
    if (!completed) console.log(`LIFE_ATLAS_TEST_FAILURE_ROOTS ${JSON.stringify({ test: context.name, dataRoot, output, bootstrapDir: handle?.bootstrapDir, tempDir: handle?.tempDir })}`);
    if (handle) await closeApp(handle, { keepDirs: !completed });
    if (completed) for (const directory of [output, dataRoot]) if (fs.existsSync(directory)) removeIsolatedDirectory(directory);
  });
  await seedPerformanceWorkspace(dataRoot);
  const startupStart = Date.now();
  handle = await launchApp({ packaged: true, dataRoot });
  const page = handle.page;
  await page.locator('html[data-la-ready="1"]').waitFor();
  const startupMs = Date.now() - startupStart;
  console.log(`RELEASE_STARTUP_MS=${startupMs}`);
  const searchSamples = [];
  const openSamples = [];
  for (const target of searchTargets) {
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "全局搜索", exact: true });
    await dialog.waitFor();
    const input = dialog.locator("input");
    await input.waitFor();
    const searchMs = await page.evaluate(async (text) => {
      const dialog = document.querySelector('[aria-label="全局搜索"]');
      const input = dialog?.querySelector("input");
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!dialog || !input || !setValue) throw new Error("Global search input is unavailable");
      const start = performance.now();
      setValue.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return await new Promise((resolve, reject) => {
        let frame;
        const timeout = setTimeout(() => { cancelAnimationFrame(frame); reject(new Error(`Global search timed out: ${text}`)); }, 30000);
        const tick = () => {
          if ([...dialog.querySelectorAll('[role="option"]')].some((option) => option.textContent.includes(text))) {
            clearTimeout(timeout);
            resolve(performance.now() - start);
          } else frame = requestAnimationFrame(tick);
        };
        tick();
      });
    }, target.title);
    searchSamples.push(searchMs);
    const openStart = Date.now();
    await input.press("Enter");
    await page.locator(`.life-editor[data-page-id="${target.id}"] .bn-block-content`).first().waitFor();
    openSamples.push(Date.now() - openStart);
  }
  const searchMs = median(searchSamples);
  const openMs = median(openSamples);
  console.log(`RELEASE_SEARCH_MS=${searchMs}`);
  console.log(`RELEASE_OPEN_PAGE_MS=${openMs}`);
  context.diagnostic(`RELEASE_SEARCH_SAMPLES_MS=${JSON.stringify(searchSamples)}; RELEASE_OPEN_PAGE_SAMPLES_MS=${JSON.stringify(openSamples)}`);
  await delay(10000);
  const idleMemoryMb = (await handle.app.evaluate(({ app }) => app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0))) / 1024;
  assert.ok(Number.isFinite(idleMemoryMb) && idleMemoryMb > 0);
  console.log(`RELEASE_IDLE_MEMORY_MB=${idleMemoryMb}`);
  const backupFile = path.join(output, "release-backup.lifeatlas");
  await queueDialogResponse(handle, "showSaveDialog", { canceled: false, filePath: backupFile });
  const previousStatus = await page.evaluate(() => window.lifeAtlas.backup.getStatus());
  assert.equal(previousStatus.ok, true, previousStatus.error?.message);
  await page.locator(".workspace-switcher").click();
  await page.getByRole("menuitem", { name: "备份与恢复…", exact: true }).click();
  const backupDialog = page.getByRole("dialog", { name: "备份与恢复", exact: true });
  await backupDialog.waitFor();
  await backupDialog.getByRole("button", { name: "完整备份", exact: true }).click();
  await backupDialog.getByRole("heading", { name: "导出完整备份", exact: true }).waitFor();
  assert.equal(await backupDialog.getByLabel(/^包含密钥库/).isEnabled(), false);
  assert.equal(await backupDialog.getByLabel("加密整个备份", { exact: true }).isChecked(), false);
  const backupStart = Date.now();
  await backupDialog.getByRole("button", { name: "导出", exact: true }).click();
  await waitForFullBackup(handle, previousStatus.value.lastFullBackupAt);
  const backupMs = Date.now() - backupStart;
  console.log(`RELEASE_BACKUP_MS=${backupMs}`);
  const backupBytes = fs.statSync(backupFile).size;
  console.log(`RELEASE_BACKUP_BYTES=${backupBytes}`);
  assert.ok(backupBytes > 1024 * 1024 * 1024, `Full backup must exceed 1 GiB: ${backupBytes} bytes`);
  await assertNoNetworkAndErrors(handle);
  assert.ok(startupMs < 4000, `Cold startup exceeded 4000 ms: ${startupMs}`);
  assert.ok(searchMs < 200, `Median global search exceeded 200 ms: ${searchMs}`);
  assert.ok(openMs < 300, `Median page opening exceeded 300 ms: ${openMs}`);
  assert.ok(idleMemoryMb < 600, `Idle working-set memory exceeded 600 MB: ${idleMemoryMb}`);
  assert.ok(backupMs < 120000, `Full backup exceeded 120000 ms: ${backupMs}`);
  completed = true;
});
