import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assertPhysicalPath } from "../../electron/main/storage/dataRoot.js";
import { createBackupInspector, verifyBackupFile } from "../../electron/main/backup/inspection.js";
import { createMarkers, vaultItemInputs } from "../fixtures/vault-items.mjs";
import { seedVault } from "../desktop/seed-vault.mjs";
import { openVaultWindow, unlockUi } from "../desktop/vault-helpers.mjs";
import { exportBackupUi, seedDesktopFullWorkspace } from "../desktop/backup-helpers.mjs";
import { REPO_ROOT, assertNoNetworkAndErrors, closeApp, createIsolatedDirectory, launchApp, queueDialogResponse, removeIsolatedDirectory } from "../desktop/helpers.mjs";

const MASTER = "Release-Sweep-Pass-2026!";
const BACKUP = 'Sweep-Backup-Pass-2026!"';

async function exportMarkdown(handle, directory) {
  await handle.page.locator(".workspace-sidebar .workspace-switcher").click();
  await handle.page.getByRole("menu", { name: "工作区菜单", exact: true }).getByRole("menuitem", { name: "导出为 Markdown…", exact: true }).click();
  const dialog = handle.page.getByRole("dialog", { name: "导出为 Markdown", exact: true });
  await dialog.waitFor();
  await queueDialogResponse(handle, "showOpenDialog", { canceled: false, filePaths: [directory] });
  await dialog.getByRole("button", { name: "导出", exact: true }).click();
  await dialog.getByRole("status").filter({ hasText: "已导出到" }).waitFor({ timeout: 120000 });
  assert.equal(fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.startsWith("Life Atlas 导出 ")).length, 1);
  await dialog.getByRole("button", { name: "关闭对话框", exact: true }).click();
}

async function verifyVaultBackups(dataRoot, plainFile, encryptedFile, itemCount) {
  const plain = await verifyBackupFile(plainFile);
  assert.equal(plain.ok, true, JSON.stringify(plain.problems));
  assert.equal(plain.summary.encrypted, false);
  assert.equal(plain.summary.vault.included, true);
  assert.equal(plain.summary.vault.itemCount, itemCount);
  const inspector = createBackupInspector({ dataRoot });
  try {
    const request = await inspector.inspectFile(encryptedFile, { verifyOnly: true });
    assert.equal(request.needsPassword, true);
    const encrypted = await inspector.verifyWithPassword({ inspectId: request.inspectId, password: BACKUP });
    assert.equal(encrypted.report.ok, true, JSON.stringify(encrypted.report.problems));
    assert.equal(encrypted.report.summary.encrypted, true);
    assert.equal(encrypted.report.summary.vault.included, true);
    assert.equal(encrypted.report.summary.vault.itemCount, itemCount);
  } finally { inspector.stop(); }
}

test("a full release session leaves no plaintext and makes no network requests", { timeout: 360000 }, async () => {
  const root = createIsolatedDirectory("release-security");
  const dataRoot = path.join(root, "data");
  const bootstrapDir = path.join(root, "bootstrap");
  const output = path.join(root, "artifacts");
  const plainFile = path.join(output, "sweep-plain.lifeatlas");
  const encryptedFile = path.join(output, "sweep-encrypted.lifeatlas");
  const markdownDirectory = path.join(output, "sweep-markdown");
  const markerFile = path.join(root, "markers.txt");
  for (const directory of [dataRoot, bootstrapDir, markdownDirectory]) fs.mkdirSync(directory, { recursive: true });
  const markers = createMarkers();
  const inputs = vaultItemInputs(markers);
  let handle;
  let closeAttempted = false;
  let failure;
  try {
    await seedDesktopFullWorkspace(dataRoot);
    const { recoveryKey } = await seedVault(dataRoot, { password: MASTER, inputs });
    fs.writeFileSync(markerFile, `${[...markers.all(), MASTER, BACKUP, recoveryKey].join("\n")}\n`, "utf8");
    handle = await launchApp({ packaged: true, dataRoot, bootstrapDir, env: { LIFE_ATLAS_TEST_CLIPBOARD_MS: "1500" } });
    await handle.page.locator('html[data-la-ready="1"]').waitFor();
    await handle.page.locator(".workspace-sidebar").waitFor();
    const vaultPage = await openVaultWindow(handle);
    await unlockUi(vaultPage, MASTER);
    const apiItem = inputs.find((input) => input.type === "apiKey");
    const displayed = apiItem.fields.find((field) => field.label === "API Key").value;
    const copied = apiItem.fields.find((field) => field.label === "Secret").value;
    assert.notEqual(displayed, copied);
    await vaultPage.locator(".vw-item").filter({ hasText: apiItem.title }).click();
    await vaultPage.getByRole("heading", { name: apiItem.title, exact: true }).waitFor();
    await vaultPage.getByRole("button", { name: "显示API Key", exact: true }).click();
    await vaultPage.waitForFunction((value) => [...document.querySelectorAll(".vw-field")].some((field) => field.querySelector(".vw-field-label")?.textContent === "API Key" && field.querySelector(".vw-field-value")?.textContent === value), displayed);
    await vaultPage.getByRole("button", { name: "复制Secret", exact: true }).click();
    await vaultPage.locator(".vw-field.is-copied .copy-clear").waitFor();
    assert.equal(await handle.app.evaluate(({ clipboard }) => clipboard.readText()), copied);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    assert.equal(await handle.app.evaluate(({ clipboard }) => clipboard.readText()), "");
    await vaultPage.getByRole("button", { name: "上锁", exact: true }).click();
    await vaultPage.locator('.vw[data-screen="locked"]').waitFor();
    const confirmVault = async (confirmation) => {
      await confirmation.getByLabel("确认操作的主密码", { exact: true }).fill(MASTER);
      await confirmation.getByRole("button", { name: "确认", exact: true }).click();
    };
    const plainDialog = await exportBackupUi(handle, plainFile, { includeVault: true, vaultPage, onConfirm: confirmVault });
    await plainDialog.getByRole("button", { name: "关闭对话框", exact: true }).click();
    const encryptedDialog = await exportBackupUi(handle, encryptedFile, { includeVault: true, encryptPassword: BACKUP, vaultPage, onConfirm: confirmVault });
    await encryptedDialog.getByRole("button", { name: "关闭对话框", exact: true }).click();
    await exportMarkdown(handle, markdownDirectory);
    const snapshot = await handle.app.evaluate(() => globalThis.__lifeAtlasTest.snapshots.checkNow());
    const snapshotRoot = path.join(dataRoot, "snapshots");
    const snapshotDirectory = assertPhysicalPath(path.join(snapshotRoot, snapshot.id), { root: snapshotRoot, allowMissing: false });
    const metadata = JSON.parse(fs.readFileSync(path.join(snapshotDirectory, "snapshot.json"), "utf8"));
    assert.equal(metadata.reason, "daily");
    for (const name of ["workspace.db", "vault.db"]) {
      assert.ok(metadata.files.some((file) => file.name === name));
      assert.equal(fs.existsSync(path.join(snapshotDirectory, name)), true);
    }
    await assertNoNetworkAndErrors(handle);
    closeAttempted = true;
    await closeApp(handle, { keepDirs: true });
    await verifyVaultBackups(dataRoot, plainFile, encryptedFile, inputs.length);
    const scan = spawnSync(process.execPath, [path.join(REPO_ROOT, "tools/scan-plaintext.mjs"), dataRoot, plainFile, encryptedFile, markdownDirectory, "--markers", markerFile], { cwd: REPO_ROOT, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
    if (scan.stdout) process.stdout.write(scan.stdout);
    if (scan.stderr) process.stderr.write(scan.stderr);
    assert.ifError(scan.error);
    assert.equal(scan.status, 0, "Release plaintext scanner must exit zero");
    assert.match(scan.stdout, /plaintext scanner: 0 hits/);
    console.log("RELEASE_SECURITY vaultItems=7; clipboardCleared=true; snapshotsIncludeVault=true; plaintextHits=0");
  } catch (error) { failure = error; }
  finally {
    if (handle && !closeAttempted) {
      try { await closeApp(handle, { keepDirs: true }); }
      catch (error) { failure = failure ? new AggregateError([failure, error], "Security sweep and normal close failed") : error; }
    }
  }
  if (failure) { console.log(`RELEASE_SECURITY_PRESERVED ${root}`); throw failure; }
  if (handle) removeIsolatedDirectory(handle.tempDir);
  removeIsolatedDirectory(root);
});
