import assert from "node:assert/strict";
import { createVaultService } from "../../electron/main/vault/vaultService.js";
import { lastTwoGroups } from "../../electron/main/vault/recoveryKey.js";
import { TEST_PASSWORD } from "../fixtures/vault-items.mjs";
import { ensureDataRootMarker } from "../../electron/main/storage/dataRoot.js";

export async function openVaultWindow(handle) {
  const pending = handle.app.waitForEvent("window");
  await handle.page.getByRole("button", { name: /^密钥库/ }).click();
  const page = await pending;
  await page.waitForFunction(() => document.documentElement.dataset.laVaultReady === "1", { timeout: 30000 });
  await page.locator(".vw[data-screen]").waitFor({ timeout: 30000 });
  return page;
}

export async function callVault(page, method, args) {
  const result = await page.evaluate(async ({ method: name, args: value }) => window.lifeAtlasVault[name](value), { method, args });
  assert.equal(result.ok, true, `${method} failed: ${result.error?.code}`);
  return result.value;
}

export async function seedVault(dataRoot, inputs = [], { confirmed = true, password = TEST_PASSWORD } = {}) {
  ensureDataRootMarker(dataRoot, { appVersion: "0.1.0", now: "2026-11-07T00:00:00.000Z" });
  const service = createVaultService({ dataRoot });
  try {
    const created = await service.create({ password });
    if (confirmed) service.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(created.recoveryKey) });
    const summaries = confirmed ? inputs.map((input) => service.createItem({ input }).summary) : [];
    return { recoveryKey: created.recoveryKey, summaries };
  } finally { service.lock("app-quit"); service.closeDatabase(); }
}

export async function unlockUi(page, password = TEST_PASSWORD) {
  await page.getByLabel("主密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "解锁", exact: true }).click();
  await page.locator('.vw[data-screen="main"]').waitFor({ timeout: 30000 });
}

export async function completeCreate(page, password = TEST_PASSWORD) {
  await page.getByRole("button", { name: "开始设置" }).click();
  await page.getByLabel("新主密码", { exact: true }).fill(password);
  await page.getByLabel("再次输入主密码").fill(password);
  assert.equal(await page.locator(".rules li.is-ok").count(), 3);
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByLabel("恢复密钥", { exact: true }).waitFor({ timeout: 30000 });
  return page.getByLabel("恢复密钥", { exact: true }).textContent();
}

export async function confirmRecoveryUi(page, recoveryKey) {
  await page.getByRole("button", { name: "我已保存，下一步" }).click();
  await page.getByLabel("恢复密钥最后两组").fill(lastTwoGroups(recoveryKey));
  await page.getByRole("button", { name: "确认并进入密钥库" }).click();
  await page.locator('.vw[data-screen="main"]').waitFor({ timeout: 30000 });
}
