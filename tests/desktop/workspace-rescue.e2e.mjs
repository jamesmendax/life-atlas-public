import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openWorkspaceDatabase } from "../../electron/main/storage/workspaceDb.js";
import { verifyBackupFile } from "../../electron/main/backup/inspection.js";
import { WORKSPACE_RESCUE_SCOPE } from "../../src/backup/manifest.js";
import { createIsolatedDirectory, openPageInSidebar, queueDialogResponse, readDialogCalls } from "./helpers.mjs";
import { confirmBackupRestoreUi, createBackupDesktopCase, exportBackupUi, readClosedBackupWorkspace, selectBackupUi } from "./backup-helpers.mjs";

const BODY_EDIT = "保存失败时新增的正文";
const ORIGINAL_SCORE = 5;
const RESCUED_SCORE = 913;
const scoreCell = 'tr[data-item-id="i-3"] td[data-property-id="score"]';
const sourcePage = ({ pages }) => pages.find(({ id }) => id === "p-a1");
const sourceScore = ({ databaseItems }) => databaseItems.find(({ id }) => id === "i-3").values.score;

test("desktop saving error exports the in-memory workspace through verified archive restore", { timeout: 150000 }, async (context) => {
  const packaged = process.env.LIFE_ATLAS_RESCUE_PACKAGED === "1";
  const source = await createBackupDesktopCase(context, { packaged, seed: true, retainOnFailure: true });
  const output = source.own(createIsolatedDirectory("rescue-e2e-output"));
  const normalFile = path.join(output, "normal.lifeatlas");
  const failedTarget = path.join(output, "cannot-replace.lifeatlas");
  const rescueFile = path.join(output, "rescue.lifeatlas");
  fs.mkdirSync(failedTarget);
  const sentinel = path.join(failedTarget, "existing.txt");
  fs.writeFileSync(sentinel, "existing destination");
  const handle = source.handle;
  const page = handle.page;

  const backup = await exportBackupUi(handle, normalFile);
  const normal = await verifyBackupFile(normalFile);
  assert.equal(normal.ok, true);
  assert.equal(normal.summary.scope, undefined);
  assert.ok(normal.summary.assets.count > 0);
  await backup.getByRole("button", { name: "关闭对话框", exact: true }).click();
  await openPageInSidebar(page, "A 概览");

  const blockedDb = openWorkspaceDatabase(path.join(source.dataRoot, "workspace.db"));
  blockedDb.exec("CREATE TRIGGER refuse_e2e_rescue_writes BEFORE INSERT ON entities BEGIN SELECT RAISE(ABORT, 'persistent rescue test write failure'); END");
  try {
    const bodyBlock = page.locator('.life-editor[data-page-id="p-a1"] .bn-block-outer[data-id="b-a1-p"] .bn-block-content').first();
    await bodyBlock.click();
    await page.keyboard.press("End");
    await page.keyboard.insertText(BODY_EDIT);
    await bodyBlock.getByText(BODY_EDIT, { exact: false }).waitFor();
    const saveError = page.locator(".mb-save-error");
    await saveError.waitFor();
    const saveAttempt = await page.evaluate(async () => {
      const result = await window.lifeAtlas.workspace.load();
      const { workspace, generation } = result.value;
      const item = workspace.databaseItems.find(({ id }) => id === "i-3");
      return window.lifeAtlas.workspace.applyChanges({ schemaVersion: workspace.schemaVersion, generation, ui: null, deletes: [], upserts: [
        { collection: "databaseItems", id: item.id, json: JSON.stringify(item) },
      ] });
    });
    assert.equal(saveAttempt.error.code, "E_IO");

    await openPageInSidebar(page, "整页项目库");
    await page.locator(scoreCell).getByRole("button").click();
    const number = page.locator(".db-table-number-popover input");
    await number.fill(String(RESCUED_SCORE));
    await number.press("Enter");
    await page.locator(scoreCell).getByText(String(RESCUED_SCORE), { exact: true }).waitFor();
    await saveError.getByRole("button", { name: "重试保存", exact: true }).click();
    await saveError.getByRole("button", { name: "导出未保存的更改", exact: true }).click();
    const rescue = page.getByRole("dialog", { name: "导出工作区救援文件", exact: true });
    await rescue.getByText(/附件原文件、助手对话和密钥库未包含/).waitFor();

    await queueDialogResponse(handle, "showSaveDialog", { canceled: true });
    await rescue.getByRole("button", { name: "选择位置并导出", exact: true }).click();
    await rescue.getByRole("status").filter({ hasText: "已取消导出" }).waitFor();
    assert.equal(fs.existsSync(rescueFile), false);
    await queueDialogResponse(handle, "showSaveDialog", { canceled: false, filePath: failedTarget });
    await rescue.getByRole("button", { name: "选择位置并导出", exact: true }).click();
    await rescue.getByRole("alert").waitFor();
    assert.equal(fs.readFileSync(sentinel, "utf8"), "existing destination");
    assert.equal(fs.readdirSync(output).some((name) => name.includes(".partial-")), false);
    await queueDialogResponse(handle, "showSaveDialog", { canceled: false, filePath: rescueFile });
    await rescue.getByRole("button", { name: "重新选择位置", exact: true }).click();
    await rescue.getByRole("status").filter({ hasText: "已保存救援文件" }).waitFor();
    assert.equal(await saveError.isVisible(), true);
    const calls = await readDialogCalls(handle);
    const rescueCalls = calls.filter(({ kind, options }) => kind === "showSaveDialog" && options.title === "保存 Life Atlas 工作区救援文件");
    assert.equal(rescueCalls.length, 3);
    assert.ok(rescueCalls.every(({ options }) => options.defaultPath.startsWith("Life-Atlas-工作区救援-")));

    const persisted = readClosedBackupWorkspace(source.dataRoot);
    assert.equal(JSON.stringify(sourcePage(persisted).content).includes(BODY_EDIT), false);
    assert.equal(sourceScore(persisted), ORIGINAL_SCORE);
    const report = await verifyBackupFile(rescueFile);
    assert.equal(report.ok, true);
    assert.equal(report.summary.scope, WORKSPACE_RESCUE_SCOPE);
    assert.equal(report.summary.assets.count, 0);
    assert.equal(report.summary.vault.included, false);
    await rescue.getByRole("button", { name: "关闭", exact: true }).click();
  } finally {
    blockedDb.exec("DROP TRIGGER refuse_e2e_rescue_writes");
    blockedDb.close();
  }
  await source.close();

  const destination = await createBackupDesktopCase(context, { packaged, retainOnFailure: true });
  assert.notEqual(destination.dataRoot, source.dataRoot);
  const restore = await selectBackupUi(destination.handle, rescueFile);
  await restore.getByText(/工作区救援文件/).waitFor();
  await restore.getByText(/附件原文件、助手对话和密钥库未包含/).waitFor();
  const restored = await confirmBackupRestoreUi(destination.handle, restore);
  assert.equal(JSON.stringify(sourcePage(restored).content).includes(BODY_EDIT), true);
  assert.equal(sourceScore(restored), RESCUED_SCORE);
  await openPageInSidebar(destination.handle.page, "A 概览");
  await destination.handle.page.locator('.life-editor[data-page-id="p-a1"]').getByText(BODY_EDIT, { exact: false }).waitFor();
  await openPageInSidebar(destination.handle.page, "整页项目库");
  await destination.handle.page.locator(scoreCell).getByText(String(RESCUED_SCORE), { exact: true }).waitFor();
  await destination.close();
  source.complete();
  destination.complete();
  console.log(`LIFE_ATLAS_WORKSPACE_RESCUE ${JSON.stringify({ packaged, accessDeniedCode: "E_IO", originalScore: ORIGINAL_SCORE, rescuedScore: RESCUED_SCORE, restoredBody: BODY_EDIT, nativeDialogResponses: 3, fullBackup: "verified with assets" })}`);
});
