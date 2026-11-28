import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createBackupService } from "../../electron/main/backup/index.js";
import { createBackupInspector } from "../../electron/main/backup/inspection.js";
import { createDialogs } from "../../electron/main/dialogs.js";
import { sha256File } from "../../electron/main/backup/files.js";
import { FIXTURE_TIME } from "../fixtures/full-workspace.mjs";
import { TEST_PASSWORD, NEXT_PASSWORD } from "../fixtures/vault-items.mjs";
import { createDesktopBackupContext, backupVaultFactory, seedBackupVault, readBackupVaultState, createBackupDesktopCase, openBackupDialog, exportBackupUi, selectBackupUi, restoreBackupUi, confirmBackupRestoreUi, restoreWizardUi, assertBackupDataRootsEqual, assertBackupWorkspaceEqual, assertBackupWorkspaceAfterInitialVisit, readClosedBackupWorkspace, readBackupVaultUiState, stopBackupMemory, shootBackupModes } from "./backup-helpers.mjs";
import { REPO_ROOT, createIsolatedDirectory, queueDialogResponse, readDialogCalls } from "./helpers.mjs";
import { openVaultWindow, unlockUi, confirmRecoveryUi, callVault } from "./vault-helpers.mjs";

const backupPassword = "Backup-Pass-2026!";
const shotsDir = path.join(REPO_ROOT, ".qa/LOCAL-NOTION-001/WP-08/shots");

async function packageFixture(context, { encrypted = false } = {}) {
  const source = await createDesktopBackupContext(context, { vaultService: backupVaultFactory({ production: true }), retainOnFailure: true });
  const seeded = await seedBackupVault(source.vaultService);
  const expectedVault = await readBackupVaultState(source.vaultService, seeded.ids);
  const filePath = path.join(source.dataRoot, encrypted ? "encrypted.lifeatlas" : "vault.lifeatlas");
  const dialogs = createDialogs({ testHooksEnabled: true });
  dialogs.state.queue.showSaveDialog.push(filePath);
  const service = createBackupService({ ...source, dialogs, requestFlush: async () => true, requestConfirmation: async () => "confirmed" });
  context.after(() => service.stop());
  await service.exportFull({ includeVault: true, encryptPassword: encrypted ? backupPassword : null });
  await service.stop();
  return { ...source, seeded, expectedVault, filePath };
}

function readCiphertext(filePath) {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try { return { header: JSON.parse(db.prepare("SELECT json FROM vault_header WHERE id=1").get().json), items: db.prepare("SELECT id,blob FROM vault_items ORDER BY id").all().map((entry) => ({ id: entry.id, blobB64: Buffer.from(entry.blob).toString("base64") })) }; }
  finally { db.close(); }
}

test("exporting with the vault asks in the vault window only", { timeout: 120000 }, async (context) => {
  const state = await createBackupDesktopCase(context, { seed: true, vault: true, packaged: true, retainOnFailure: true, env: { LIFE_ATLAS_TEST_CONFIRM_TTL_MS: "3000" } });
  const output = state.own(createIsolatedDirectory("backup-confirm-rejections"));
  const vaultPage = await openVaultWindow(state.handle);
  const panel = await openBackupDialog(state.handle);
  await state.handle.page.waitForFunction(() => [...document.querySelectorAll(".mb-backup-dialog label")].some((label) => label.textContent.startsWith("包含密钥库") && !label.querySelector("input")?.disabled));
  assert.equal(await panel.getByLabel(/^包含密钥库/).isChecked(), true);
  assert.equal(await state.handle.page.locator('input[type="password"]:visible').count(), 0);
  for (const mode of ["wrong", "cancelled", "expired"]) {
    await panel.getByRole("button", { name: "导出", exact: true }).click();
    const confirmation = vaultPage.getByRole("dialog", { name: "导出完整备份（包含密钥库）", exact: true });
    await confirmation.waitFor();
    await panel.getByText("请在密钥库窗口中输入主密码确认", { exact: true }).waitFor();
    assert.equal(await state.handle.page.locator('input[type="password"]:visible').count(), 0);
    if (mode === "wrong") {
      await confirmation.getByLabel("确认操作的主密码", { exact: true }).fill("wrong-master-credential");
      await confirmation.getByRole("button", { name: "确认", exact: true }).click();
      await confirmation.getByRole("alert").filter({ hasText: "主密码不正确" }).waitFor();
      const db = new DatabaseSync(path.join(state.dataRoot, "vault.db"), { readOnly: true });
      try { assert.equal(Number(db.prepare("SELECT value FROM vault_state WHERE key='failedAttempts'").get().value), 1); } finally { db.close(); }
      await confirmation.getByRole("button", { name: "取消", exact: true }).click();
    } else if (mode === "cancelled") await confirmation.getByRole("button", { name: "取消", exact: true }).click();
    await confirmation.waitFor({ state: "hidden", timeout: 10000 });
    await state.handle.page.waitForFunction(() => [...document.querySelectorAll(".mb-backup-dialog button")].some((button) => button.textContent === "导出" && !button.disabled));
    assert.deepEqual(fs.readdirSync(output), []);
    assert.equal((await readDialogCalls(state.handle)).filter((entry) => entry.kind === "showSaveDialog").length, 0);
  }
  await state.close();
  state.complete();
});

test("a full backup restores workspace assets and vault on a new data root", { timeout: 240000 }, async (context) => {
  const source = await createBackupDesktopCase(context, { seed: true, large: true, vault: true, packaged: true, retainOnFailure: true });
  const output = source.own(createIsolatedDirectory("backup-vault-full-output"));
  const filePath = path.join(output, "full.lifeatlas");
  const vaultPage = await openVaultWindow(source.handle);
  await exportBackupUi(source.handle, filePath, { includeVault: true, vaultPage, onWorkspace: (value) => { source.exportedWorkspace = value; }, onConfirm: async (confirmation) => {
    await shootBackupModes(source.handle, source.handle.page, shotsDir, "export-with-vault");
    await shootBackupModes(source.handle, vaultPage, shotsDir, "vault-confirm-export", { preserveSize: true });
    await confirmation.getByLabel("确认操作的主密码", { exact: true }).fill(TEST_PASSWORD);
    await confirmation.getByRole("button", { name: "确认", exact: true }).click();
  } });
  await source.close();
  assertBackupWorkspaceEqual(readClosedBackupWorkspace(source.dataRoot), source.exportedWorkspace);
  const destination = await createBackupDesktopCase(context, { setup: true, packaged: true, retainOnFailure: true });
  const target = await restoreWizardUi(destination, filePath, { beforeLaunch: (root) => assertBackupWorkspaceEqual(readClosedBackupWorkspace(root), source.exportedWorkspace) });
  assertBackupWorkspaceEqual(destination.expectedWorkspace, source.exportedWorkspace);
  const restoredVault = await openVaultWindow(destination.handle);
  assert.equal((await callVault(restoredVault, "status")).locked, true);
  await unlockUi(restoredVault);
  assert.deepEqual(await readBackupVaultUiState(restoredVault, source.seededVault.ids), source.expectedVault);
  assert.equal(source.expectedVault.items.length, 10);
  await destination.close();
  await assertBackupDataRootsEqual(target, source.dataRoot);
  source.complete();
  destination.complete();
});

test("the recovery key unlocks a restored vault", { timeout: 150000 }, async (context) => {
  const source = await packageFixture(context);
  const state = await createBackupDesktopCase(context, { packaged: true, retainOnFailure: true });
  const panel = await selectBackupUi(state.handle, source.filePath);
  await panel.getByRole("button", { name: "恢复", exact: true }).waitFor();
  await shootBackupModes(state.handle, state.handle.page, shotsDir, "restore-summary-vault");
  await confirmBackupRestoreUi(state.handle, panel);
  const vaultPage = await openVaultWindow(state.handle);
  await vaultPage.getByRole("button", { name: "忘记主密码？使用恢复密钥", exact: true }).click();
  await vaultPage.getByLabel("输入恢复密钥", { exact: true }).fill(source.seeded.recoveryKey);
  await vaultPage.getByLabel("新主密码", { exact: true }).fill(NEXT_PASSWORD);
  await vaultPage.getByLabel("再次输入主密码", { exact: true }).fill(NEXT_PASSWORD);
  await vaultPage.getByRole("button", { name: "下一步", exact: true }).click();
  const recoveryKey = await vaultPage.getByLabel("恢复密钥", { exact: true }).textContent();
  await confirmRecoveryUi(vaultPage, recoveryKey);
  assert.deepEqual(await readBackupVaultUiState(vaultPage, source.seeded.ids), source.expectedVault);
  await state.close();
  state.complete();
  source.complete();
});

test("an encrypted backup restores with its password", { timeout: 150000 }, async (context) => {
  const source = await packageFixture(context, { encrypted: true });
  const state = await createBackupDesktopCase(context, { packaged: true, retainOnFailure: true });
  const before = await sha256File(path.join(state.dataRoot, "workspace.db"));
  const panel = await selectBackupUi(state.handle, source.filePath);
  const encrypted = state.handle.page.getByRole("dialog", { name: "输入备份密码", exact: true });
  await encrypted.getByLabel("备份密码", { exact: true }).fill("wrong-backup-credential");
  await encrypted.getByRole("button", { name: "解锁备份", exact: true }).click();
  await encrypted.getByRole("alert").waitFor();
  assert.deepEqual(await sha256File(path.join(state.dataRoot, "workspace.db")), before);
  await encrypted.getByLabel("备份密码", { exact: true }).fill(backupPassword);
  await encrypted.getByRole("button", { name: "解锁备份", exact: true }).click();
  await encrypted.waitFor({ state: "hidden" });
  await panel.locator(".mb-backup-summary").getByText("已加密", { exact: true }).waitFor();
  await confirmBackupRestoreUi(state.handle, panel);
  const loaded = await state.handle.page.evaluate(() => window.lifeAtlas.workspace.load());
  assert.equal(loaded.ok, true);
  assertBackupWorkspaceAfterInitialVisit(loaded.value.workspace, source.workspaceService.readWorkspace());
  const vaultPage = await openVaultWindow(state.handle);
  await unlockUi(vaultPage);
  assert.deepEqual(await readBackupVaultUiState(vaultPage, source.seeded.ids), source.expectedVault);
  await state.close();
  state.complete();
  source.complete();
});

test("encrypted export and restore of one gigabyte stay within memory budget", { timeout: 420000 }, async (context) => {
  const source = await createBackupDesktopCase(context, { seed: true, vault: true, gigabyte: true, packaged: true, retainOnFailure: true });
  const output = source.own(createIsolatedDirectory("backup-v2-gigabyte-output"));
  const filePath = path.join(output, "encrypted-gigabyte.lifeatlas");
  const vaultPage = await openVaultWindow(source.handle);
  const panel = await openBackupDialog(source.handle);
  await panel.getByLabel("加密整个备份", { exact: true }).check();
  const inputs = panel.locator('input[type="password"]');
  assert.equal(await inputs.count(), 2);
  await inputs.nth(0).fill(backupPassword);
  await inputs.nth(1).fill(backupPassword);
  await shootBackupModes(source.handle, source.handle.page, shotsDir, "backup");
  await source.handle.app.evaluate(() => globalThis.__lifeAtlasTest.memory.start());
  await exportBackupUi(source.handle, filePath, { dialog: panel, includeVault: true, encryptPassword: backupPassword, vaultPage, onWorkspace: (value) => { source.exportedWorkspace = value; } });
  await stopBackupMemory(context, source.handle, "WP08_EXPORT_PEAK_MB");
  assert.deepEqual(fs.readdirSync(output), ["encrypted-gigabyte.lifeatlas"]);
  await source.close();
  assertBackupWorkspaceEqual(readClosedBackupWorkspace(source.dataRoot), source.exportedWorkspace);
  const destination = await createBackupDesktopCase(context, { packaged: true, retainOnFailure: true });
  await destination.handle.app.evaluate(() => globalThis.__lifeAtlasTest.memory.start());
  const restored = await restoreBackupUi(destination.handle, filePath, { encryptPassword: backupPassword });
  await stopBackupMemory(context, destination.handle, "WP08_RESTORE_PEAK_MB");
  assertBackupWorkspaceEqual(restored, source.exportedWorkspace);
  const restoredVault = await openVaultWindow(destination.handle);
  await unlockUi(restoredVault);
  assert.deepEqual(await readBackupVaultUiState(restoredVault, source.seededVault.ids), source.expectedVault);
  assert.equal(source.gigabyteHashes.length, 4);
  for (const hash of source.gigabyteHashes) assert.equal(fs.statSync(path.join(destination.dataRoot, "assets", hash.slice(0, 2), hash)).size, 268435456);
  assert.deepEqual(fs.readdirSync(destination.dataRoot).filter((name) => name.startsWith(".staging-")), []);
  await destination.close();
  await assertBackupDataRootsEqual(destination.dataRoot, source.dataRoot);
  context.diagnostic("WP08_GIGABYTE_ASSET_BYTES=1073741824; vaultItems=10; productionKdfMemoryKiB=131072");
  source.complete();
  destination.complete();
});

test("restoring over an existing vault keeps a snapshot", { timeout: 150000 }, async (context) => {
  const source = await packageFixture(context);
  const state = await createBackupDesktopCase(context, { seed: true, vault: true, packaged: true, retainOnFailure: true });
  const oldCiphertext = readCiphertext(path.join(state.dataRoot, "vault.db"));
  await restoreBackupUi(state.handle, source.filePath);
  const listed = await state.handle.page.evaluate(() => window.lifeAtlas.backup.listSnapshots());
  assert.equal(listed.ok, true);
  const snapshot = listed.value.snapshots.find((entry) => entry.reason === "pre-restore");
  assert.equal(snapshot.includesVault, true);
  assert.deepEqual(readCiphertext(path.join(state.dataRoot, "snapshots", snapshot.id, "vault.db")), oldCiphertext);
  const panel = await openBackupDialog(state.handle, "本机快照");
  await panel.locator(".mb-snapshot-list button").filter({ hasText: "恢复前" }).first().click();
  await panel.getByLabel("恢复工作区", { exact: true }).uncheck();
  await panel.getByLabel("恢复密钥库", { exact: true }).check();
  await panel.getByRole("button", { name: "恢复此快照", exact: true }).click();
  const reload = state.handle.page.waitForEvent("domcontentloaded");
  await state.handle.page.getByRole("alertdialog", { name: "恢复这个快照？", exact: true }).getByRole("button", { name: "确认恢复", exact: true }).click();
  await reload;
  await state.handle.page.locator(".workspace-sidebar").waitFor();
  const vaultPage = await openVaultWindow(state.handle);
  await unlockUi(vaultPage);
  assert.deepEqual(await readBackupVaultUiState(vaultPage, state.seededVault.ids), state.expectedVault);
  await state.close();
  state.complete();
  source.complete();
});

test("scheduled backups run and clean up", { timeout: 180000 }, async (context) => {
  const state = await createBackupDesktopCase(context, { seed: true, vault: true, packaged: true, retainOnFailure: true });
  const output = state.own(createIsolatedDirectory("backup-schedule-e2e-output"));
  for (let index = 1; index <= 9; index += 1) fs.writeFileSync(path.join(output, `Life-Atlas-自动备份-202610${String(index).padStart(2, "0")}-2000.lifeatlas`), "old automatic backup");
  fs.writeFileSync(path.join(output, "manual.lifeatlas"), "preserve manual backup");
  const vaultPage = await openVaultWindow(state.handle);
  await state.handle.app.evaluate((electron, value) => globalThis.__lifeAtlasTest.clock.set(value), new Date(2026, 10, 1, 19, 59).getTime());
  const panel = await openBackupDialog(state.handle, "定期备份");
  await panel.getByLabel("启用定期备份", { exact: true }).check();
  await queueDialogResponse(state.handle, "showOpenDialog", { canceled: false, filePaths: [output] });
  await panel.getByRole("button", { name: "选择文件夹…", exact: true }).click();
  const weekday = panel.getByRole("combobox", { name: /^每周/ });
  const hour = panel.getByRole("combobox", { name: /^时间/ });
  await weekday.selectOption("0");
  await hour.selectOption("20");
  assert.equal(await weekday.inputValue(), "0");
  assert.equal(await hour.inputValue(), "20");
  await panel.getByLabel("包含密钥库", { exact: true }).check();
  await panel.getByLabel("加密整个备份", { exact: true }).check();
  assert.equal(await panel.getByRole("button", { name: "保存计划", exact: true }).isDisabled(), true);
  await panel.getByLabel("备份密码（使用 Windows 加密保存）", { exact: true }).fill(backupPassword);
  await shootBackupModes(state.handle, state.handle.page, shotsDir, "schedule-settings");
  await panel.getByRole("button", { name: "保存计划", exact: true }).click();
  const confirmation = vaultPage.getByRole("dialog", { name: "开启定期备份（包含密钥库）", exact: true });
  await confirmation.getByLabel("确认操作的主密码", { exact: true }).fill(TEST_PASSWORD);
  await confirmation.getByRole("button", { name: "确认", exact: true }).click();
  await panel.getByRole("status").filter({ hasText: "备份计划已保存" }).waitFor();
  assert.equal(await panel.getByLabel("备份密码（使用 Windows 加密保存）", { exact: true }).inputValue(), "");
  assert.equal(await panel.getByRole("button", { name: "保存计划", exact: true }).isDisabled(), true);
  assert.equal(fs.readFileSync(path.join(state.dataRoot, "backup-schedule.json"), "utf8").includes(backupPassword), false);
  assert.equal((await state.handle.app.evaluate(() => globalThis.__lifeAtlasTest.schedule.checkNow())).ran, false);
  await state.handle.app.evaluate((electron, value) => globalThis.__lifeAtlasTest.clock.set(value), new Date(2026, 10, 1, 20).getTime());
  const result = await state.handle.app.evaluate(() => globalThis.__lifeAtlasTest.schedule.checkNow());
  assert.equal(result.ran, true);
  assert.equal(path.basename(result.filePath), "Life-Atlas-自动备份-20261101-2000.lifeatlas");
  assert.equal(fs.readdirSync(output).filter((name) => /^Life-Atlas-自动备份-\d{8}-\d{4}\.lifeatlas$/.test(name)).length, 8);
  assert.equal(fs.readFileSync(path.join(output, "manual.lifeatlas"), "utf8"), "preserve manual backup");
  assert.equal(await vaultPage.getByRole("dialog", { name: "开启定期备份（包含密钥库）", exact: true }).count(), 0);
  const inspector = createBackupInspector({ dataRoot: state.dataRoot, now: () => FIXTURE_TIME });
  try {
    const request = await inspector.inspectFile(result.filePath);
    assert.equal(request.needsPassword, true);
    const inspected = await inspector.inspectWithPassword({ inspectId: request.inspectId, password: backupPassword });
    assert.equal(inspected.summary.encrypted, true);
    assert.equal(inspected.summary.vault.itemCount, 10);
  } finally { inspector.stop(); }
  assert.equal((await state.handle.app.evaluate(() => globalThis.__lifeAtlasTest.schedule.checkNow())).ran, false);
  await panel.getByRole("button", { name: "关闭对话框", exact: true }).click();
  const reopened = await openBackupDialog(state.handle, "定期备份");
  assert.equal(await reopened.getByLabel("加密整个备份", { exact: true }).isChecked(), true);
  assert.equal(await reopened.getByRole("button", { name: "保存计划", exact: true }).isDisabled(), true);
  await state.close();
  const destination = await createBackupDesktopCase(context, { setup: true, packaged: true, retainOnFailure: true });
  await restoreWizardUi(destination, result.filePath, {
    encryptPassword: backupPassword,
    beforeLaunch: (root) => assertBackupDataRootsEqual(root, state.dataRoot),
  });
  assertBackupWorkspaceEqual(destination.expectedWorkspace, state.expectedWorkspace);
  const restoredVault = await openVaultWindow(destination.handle);
  assert.equal((await callVault(restoredVault, "status")).locked, true);
  await unlockUi(restoredVault);
  assert.deepEqual(await readBackupVaultUiState(restoredVault, state.seededVault.ids), state.expectedVault);
  const file = await sha256File(result.filePath);
  context.diagnostic(`Scheduled file restored from the selected directory: ${file.size} bytes, SHA-256 ${file.sha256}, ${destination.expectedWorkspace.pages.length} pages, ${state.expectedVault.items.length} vault items`);
  await destination.close();
  destination.complete();
  state.complete();
});
