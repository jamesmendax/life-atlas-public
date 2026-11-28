import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TEST_PASSWORD, RFC_SHA1_BASE32 } from "../fixtures/vault-items.mjs";
import { lastTwoGroups } from "../../electron/main/vault/recoveryKey.js";
import { REPO_ROOT, launchApp, closeApp, createIsolatedDirectory, removeIsolatedDirectory, assertNoNetworkAndErrors, shootWindowBothModes } from "./helpers.mjs";
import { openVaultWindow, callVault, unlockUi } from "./vault-helpers.mjs";

const REFERENCE_SECRET = "Synthetic-Reference-Password-48!";
const SHOTS_DIR = path.join(REPO_ROOT, ".qa/WP-07/shots");

function prototypeVaultInputs() {
  const field = (label, kind, value, sensitive = false) => ({ label, kind, value, sensitive: sensitive || ["secret", "totp"].includes(kind) });
  const entries = [
    { type: "login", title: "GitHub", subtitle: "用户名", tags: ["工作"], fields: [field("网址", "url", "https://github.com/login"), field("用户名", "text", "medax-dev"), field("密码", "secret", REFERENCE_SECRET), field("两步验证", "totp", RFC_SHA1_BASE32), field("备注", "multiline", "主力账号。恢复码另外打印了一份，放在书房抽屉。") ] },
    { type: "apiKey", title: "阿里云 AccessKey", subtitle: "Key 名称", tags: ["工作"], fields: [field("Key 名称", "text", "oss-backup"), field("API Key", "secret", "Synthetic-Aliyun-Key-48")] },
    { type: "apiKey", title: "OpenAI API", subtitle: "Key 名称", tags: ["工作"], fields: [field("Key 名称", "text", "life-atlas-dev"), field("API Key", "secret", "Synthetic-OpenAI-Key-48")] },
    { type: "apiKey", title: "Cloudflare Token", subtitle: "Key 名称", tags: ["工作"], fields: [field("Key 名称", "text", "life-atlas-dns"), field("API Key", "secret", "Synthetic-Cloudflare-Key-48")] },
    { type: "login", title: "教务系统", subtitle: "用户名", tags: ["学校"], fields: [field("用户名", "text", "t20190413"), field("密码", "secret", "Synthetic-School-Password-48")] },
    { type: "server", title: "腾讯云服务器", subtitle: "账号", tags: ["工作"], fields: [field("账号", "text", "root@10.0.3.17"), field("主机", "text", "10.0.3.17"), field("密码", "secret", "Synthetic-Server-Password-48")] },
    { type: "custom", title: "家里 Wi-Fi", subtitle: "网络名称", tags: [], fields: [field("网络名称", "text", "TP-LINK_5G_7C21"), field("密码", "secret", "Synthetic-WiFi-Password-48")] },
  ];
  return entries.map((entry, index) => ({ ...entry, favorite: index < 3, expiresAt: null }));
}

test("vault screens in daytime and at night", { timeout: 120000 }, async (context) => {
  const dataRoot = createIsolatedDirectory("vault-screens");
  let handle;
  let closeAttempted = false;
  context.after(async () => {
    try {
      if (handle && !closeAttempted) { closeAttempted = true; await closeApp(handle, { keepDirs: true }); }
    } finally {
      const directories = [dataRoot, handle?.bootstrapDir, handle?.tempDir].filter((directory) => directory && fs.existsSync(directory));
      if (directories.length) console.log(`VAULT_SCREENS_PRESERVED ${JSON.stringify({ directories, pid: handle?.processOwnership?.mainPid })}`);
    }
  });
  handle = await launchApp({ packaged: true, dataRoot });
  const page = await openVaultWindow(handle);
  const shoot = (name) => shootWindowBothModes(handle, name, { page, shotsDir: SHOTS_DIR });

  await page.getByRole("button", { name: "开始设置" }).click();
  await page.getByLabel("新主密码", { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel("再次输入主密码").fill(TEST_PASSWORD.slice(0, 7));
  await page.getByText("两次输入不一致", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "下一步", exact: true }).isDisabled(), true);
  await shoot("vault-setup");

  await page.getByLabel("再次输入主密码").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByLabel("恢复密钥", { exact: true }).waitFor();
  const recoveryKey = await page.getByLabel("恢复密钥", { exact: true }).textContent();
  await shoot("vault-recovery-key");
  await page.getByRole("button", { name: "我已保存，下一步" }).click();
  await page.getByLabel("恢复密钥最后两组").fill(lastTwoGroups(recoveryKey));
  await page.getByRole("button", { name: "确认并进入密钥库" }).click();
  await page.locator('.vw[data-screen="main"]').waitFor();

  for (const { subtitle, ...input } of prototypeVaultInputs()) {
    const { summary } = await callVault(page, "createItem", { input: { ...input, subtitleFieldId: null } });
    const { item } = await callVault(page, "getItem", { id: summary.id });
    const subtitleFieldId = item.fields.find((entry) => entry.label === subtitle).id;
    await callVault(page, "updateItem", { id: summary.id, patch: { subtitleFieldId } });
  }
  await callVault(page, "lock");
  await page.getByRole("heading", { name: "密钥库已上锁", exact: true }).waitFor();
  await shoot("vault-locked");
  await unlockUi(page);
  await page.getByRole("button", { name: /GitHub/ }).click();
  await page.getByRole("heading", { name: "GitHub", exact: true }).waitFor();
  await page.getByRole("button", { name: "复制密码", exact: true }).click();
  await page.getByText("已复制，30 秒后清除剪贴板", { exact: true }).waitFor();
  await shoot("vault");

  await page.getByRole("button", { name: "显示密码", exact: true }).click();
  await page.getByText(REFERENCE_SECRET, { exact: true }).waitFor();
  await shoot("vault-detail-revealed");
  await page.getByRole("button", { name: "编辑条目", exact: true }).click();
  await page.getByRole("form", { name: "编辑密钥条目" }).waitFor();
  await shoot("vault-edit");
  await page.getByRole("form", { name: "编辑密钥条目" }).getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
  await shoot("vault-settings");

  const pending = handle.app.evaluate(() => globalThis.__lifeAtlasTest.requestConfirmation({ kind: "export-backup", title: "导出完整备份（包含密钥库）", description: "请输入主密码确认。此操作不会改变当前上锁状态。" }));
  const confirmation = page.getByRole("dialog", { name: "导出完整备份（包含密钥库）" });
  await confirmation.waitFor();
  await shoot("vault-confirm-request");
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await pending, "cancelled");
  await page.getByRole("button", { name: "重置密钥库", exact: true }).click();
  await page.getByRole("heading", { name: "重置密钥库", exact: true }).waitFor();
  await page.getByLabel("重置确认短语").fill("重置我的密钥库");
  await shoot("vault-reset");
  await assertNoNetworkAndErrors(handle);
  closeAttempted = true;
  await closeApp(handle, { keepDirs: true });
  for (const directory of [handle.tempDir, handle.bootstrapDir, dataRoot]) removeIsolatedDirectory(directory);
});
