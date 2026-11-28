import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { lastTwoGroups } from "../../electron/main/vault/recoveryKey.js";
import { TEST_PASSWORD, NEXT_PASSWORD, RFC_SHA1_BASE32, createMarkers, vaultItemInputs } from "../fixtures/vault-items.mjs";
import { REPO_ROOT, launchApp, closeApp, createIsolatedDirectory, removeIsolatedDirectory, queueDialogResponse, assertNoNetworkAndErrors, shootWindowBothModes } from "./helpers.mjs";
import { openVaultWindow, callVault, seedVault, unlockUi, completeCreate, confirmRecoveryUi } from "./vault-helpers.mjs";
import { probeSyntheticClipboard } from "./clipboard-probe.mjs";

async function fresh(context, { inputs = [], seeded = true, env = {}, confirmed = true, password = TEST_PASSWORD } = {}) {
  const dataRoot = createIsolatedDirectory("vault-e2e");
  let handle;
  let closeAttempted = false;
  context.after(async () => {
    try {
      if (handle && !closeAttempted) { closeAttempted = true; await closeApp(handle, { keepDirs: true }); }
    } finally {
      const directories = [dataRoot, handle?.bootstrapDir, handle?.tempDir].filter((directory) => directory && fs.existsSync(directory));
      if (directories.length) console.log(`VAULT_E2E_PRESERVED ${JSON.stringify({ directories, pid: handle?.processOwnership?.mainPid })}`);
    }
  });
  const seed = seeded ? await seedVault(dataRoot, inputs, { confirmed, password }) : null;
  handle = await launchApp({ packaged: true, dataRoot, env });
  const page = await openVaultWindow(handle);
  return { handle, page, dataRoot, seed, async finish({ keepDirs = false } = {}) {
    await assertNoNetworkAndErrors(handle);
    closeAttempted = true;
    await closeApp(handle, { keepDirs: true });
    if (!keepDirs) for (const directory of [handle.tempDir, handle.bootstrapDir, dataRoot]) removeIsolatedDirectory(directory);
  } };
}

function loginInput(title = "Synthetic Login", secret = "LA-MARKER-ui-hidden-secret", totp = "") {
  return { type: "login", title, tags: [], favorite: false, subtitleFieldId: null, expiresAt: null, fields: [
    { label: "网址", kind: "url", value: "https://example.invalid/login", sensitive: false }, { label: "用户名", kind: "text", value: "synthetic-user", sensitive: false },
    { label: "密码", kind: "secret", value: secret, sensitive: true }, { label: "两步验证", kind: "totp", value: totp, sensitive: true },
  ] };
}

async function selectByTitle(page, title) { await page.getByRole("button", { name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click(); await page.getByRole("heading", { name: title, exact: true }).waitFor(); }

async function waitForEmptyVault(page) {
  const deadline = Date.now() + 30000;
  do {
    const result = await page.evaluate(() => window.lifeAtlasVault.list());
    assert.equal(result.ok, true, result.error?.message);
    if (result.value.summaries.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  assert.fail("The deleted vault item remained in the persisted list after the original 30 second deadline");
}

async function domContains(page, value) {
  return page.evaluate((secret) => document.documentElement.outerHTML.includes(secret) || [...document.querySelectorAll("input,textarea")].some((input) => input.value.includes(secret)), value);
}

function failedAttempts(dataRoot) {
  const db = new DatabaseSync(path.join(dataRoot, "vault.db"), { readOnly: true });
  try { return Number(db.prepare("SELECT value FROM vault_state WHERE key='failedAttempts'").get()?.value || "0"); }
  finally { db.close(); }
}

async function vaultBlockAppearance(locator) {
  return locator.evaluate((node) => {
    const style = getComputedStyle(node);
    return [style.backgroundColor, style.borderColor, style.boxShadow, style.outlineStyle];
  });
}

async function assertVaultImageAndTextSelection(page, note) {
  const image = note.locator(".vault-note-image-frame img");
  await image.waitFor();
  await note.scrollIntoViewIfNeeded();
  const bounds = await image.boundingBox();
  assert.ok(bounds?.width > 40 && bounds.height > 20);
  assert.equal(await image.evaluate((node) => node.draggable), false);
  await image.evaluate((node) => node.addEventListener("dragstart", () => { node.dataset.dragStarted = "yes"; }, { once: true }));
  await page.mouse.move(bounds.x + 10, bounds.y + 10);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 45, bounds.y + 12, { steps: 8 });
  await page.mouse.up();
  assert.equal(await image.getAttribute("data-drag-started"), null);
  assert.equal(await page.evaluate(() => getSelection().toString()), "");
  const clearImage = await image.screenshot();

  const points = await note.locator(".vn-p").evaluateAll((paragraphs) => paragraphs.map((node, index) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    return { x: index === 0 ? rect.left + 0.3 : rect.right - 0.3, y: rect.top + rect.height / 2 };
  }));
  assert.equal(points.length, 2);
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  await page.mouse.move(points[1].x, points[1].y, { steps: 16 });
  await page.mouse.up();
  const selected = await page.evaluate(() => getSelection().toString());
  assert.ok(selected.includes("Alpha") && selected.includes("Omega"), "Native drag selects both text paragraphs across the attachments");
  assert.notEqual(await note.locator(".vn-p").first().evaluate((node) => getComputedStyle(node, "::selection").backgroundColor), "rgba(0, 0, 0, 0)");
  assert.deepEqual(await image.screenshot(), clearImage, "Cross-paragraph selection leaves the actual preview pixels unchanged");
}

test("vault attachment download buttons restore the original from drafts, details and editing", { timeout: 90000 }, async (context) => {
  const { page, handle, finish } = await fresh(context);
  const files = createIsolatedDirectory("vault-download-exports");
  context.after(() => removeIsolatedDirectory(files));
  const fileName = "行程凭证.bin";
  const imageName = "票根.png";
  const original = Buffer.from([0, 255, 11, 42, 7, 0, 129]);
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAGAAAAAoCAIAAACO8WhuAAAAWUlEQVR4nO3QMQ0AIADAMJziDEtYwgEfYUeTCVg69pq6NL4fxAMECBAgQOEAAQIECFA4QIAAAQIUDhAgQIAAhQMECBAgQOEAAQIECFA4QIAAAQIUDhAgQE87d+H1hwEgyhYAAAAASUVORK5CYII=", "base64");
  fs.writeFileSync(path.join(files, fileName), original);
  fs.writeFileSync(path.join(files, imageName), image);
  async function download(container, name, destination, expected, keyboard = false) {
    const target = path.join(files, destination);
    await queueDialogResponse(handle, "showSaveDialog", { canceled: false, filePath: target });
    const button = container.getByRole("button", { name: `下载原文件 ${name}`, exact: true });
    if (keyboard) await button.press("Enter");
    else await button.click();
    await page.getByRole("status").filter({ hasText: `已下载“${name}”的未加密副本` }).waitFor();
    assert.deepEqual(fs.readFileSync(target), expected);
  }
  await unlockUi(page);
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByLabel("条目类型").selectOption("secureNote");
  await page.getByLabel("条目标题").fill("旅行凭据样本");
  const editor = page.getByRole("group", { name: "内容 加密富文本编辑器" });
  const idleEditor = await vaultBlockAppearance(editor);
  await editor.getByRole("textbox", { name: "内容", exact: true }).fill("Alpha /文件");
  assert.deepEqual(await vaultBlockAppearance(editor), idleEditor);
  await queueDialogResponse(handle, "showOpenDialog", { canceled: false, filePaths: [path.join(files, fileName), path.join(files, imageName)] });
  await editor.getByRole("option", { name: /加密文件/ }).click();
  await editor.getByRole("button", { name: `下载原文件 ${fileName}` }).waitFor();
  const lastParagraph = editor.locator(".vault-note-input").last();
  await page.waitForFunction(() => document.activeElement === [...document.querySelectorAll(".vault-note-input")].at(-1));
  assert.equal(await lastParagraph.evaluate((node) => node.selectionStart === node.selectionEnd), true);
  await lastParagraph.fill("Omega");
  await lastParagraph.press("End");
  await lastParagraph.press("Shift+ArrowLeft");
  assert.equal(await lastParagraph.evaluate((node) => node.value.slice(node.selectionStart, node.selectionEnd)), "a");
  const card = editor.locator(".vault-note-media-card.is-image");
  const idleCard = await vaultBlockAppearance(card);
  assert.equal(await card.locator("img").evaluate((node) => node.draggable), false);
  await card.hover();
  await card.getByRole("textbox", { name: `图片说明 ${imageName}` }).fill("票根说明");
  assert.deepEqual(await vaultBlockAppearance(card), idleCard);
  assert.deepEqual(await vaultBlockAppearance(editor), idleEditor);
  fs.unlinkSync(path.join(files, fileName));
  fs.unlinkSync(path.join(files, imageName));
  await download(editor, fileName, "草稿.bin", original);
  await page.getByRole("button", { name: "保存条目" }).click();

  const details = page.getByRole("article", { name: "条目详情" });
  await details.getByRole("button", { name: `下载原文件 ${fileName}` }).waitFor();
  assert.equal(await page.locator(".vw-item.is-active").count(), 1);
  assert.equal(await page.evaluate(() => getSelection().toString()), "");
  const attachmentRow = details.locator(".vault-attachment-row").filter({ hasText: fileName });
  const idleRow = await vaultBlockAppearance(attachmentRow);
  await attachmentRow.hover();
  await attachmentRow.getByRole("button", { name: `下载原文件 ${fileName}` }).focus();
  assert.deepEqual(await vaultBlockAppearance(attachmentRow), idleRow);
  await details.getByRole("button", { name: "显示内容" }).click();
  const richNote = details.locator(".vault-note-view");
  await richNote.getByRole("button", { name: `下载原文件 ${imageName}` }).waitFor();
  await shootWindowBothModes(handle, "vault-file-download", { page, shotsDir: path.join(REPO_ROOT, ".qa/attachment-downloads") });
  await page.waitForFunction(() => document.documentElement.dataset.vaultTheme === "dark");
  await assertVaultImageAndTextSelection(page, richNote);
  await download(richNote, imageName, "读取图片.png", image, true);
  await details.getByRole("button", { name: "编辑条目" }).click();
  assert.equal(await page.evaluate(() => getSelection().toString()), "");
  await page.getByRole("button", { name: "显示", exact: true }).click();
  await download(editor, fileName, "编辑已有文件.bin", original);
  assert.equal(await page.getByRole("button", { name: `下载原文件 ${fileName}`, exact: true }).count(), 1);
  const imageDownload = card.getByRole("button", { name: `下载原文件 ${imageName}` });
  await imageDownload.press("Tab");
  const removeImage = card.getByRole("button", { name: `移除加密图片 ${imageName}` });
  assert.equal(await removeImage.evaluate((node) => node === document.activeElement && node.matches(":focus-visible")), true);
  assert.equal(await card.evaluate((node) => getComputedStyle(node).outlineStyle), "none");
  await removeImage.press("Enter");
  await card.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  await details.getByRole("button", { name: "显示内容" }).click();
  await richNote.locator(".vault-note-image-frame img").waitFor();
  assert.equal(await page.evaluate(() => getSelection().toString()), "");
  await handle.app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = "light"; });
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => document.documentElement.dataset.vaultTheme === "light");
  await assertVaultImageAndTextSelection(page, richNote);
  await finish();
});

test("first run sets a password and confirms the recovery key", { timeout: 60000 }, async (context) => {
  const { page, handle, finish } = await fresh(context, { seeded: false });
  const recoveryKey = await completeCreate(page);
  const recoveryDir = createIsolatedDirectory("vault-recovery-card"); context.after(() => removeIsolatedDirectory(recoveryDir)); const card = path.join(recoveryDir, "recovery.html");
  await queueDialogResponse(handle, "showSaveDialog", { canceled: false, filePath: card }); await page.getByRole("button", { name: "保存恢复卡" }).click();
  await page.getByRole("status").filter({ hasText: "恢复卡已保存" }).waitFor(); assert.ok(fs.readFileSync(card, "utf8").includes(recoveryKey));
  await page.getByRole("button", { name: "我已保存，下一步" }).click(); await page.getByRole("textbox", { name: "恢复密钥最后两组" }).fill("WRONG-WRONG"); await page.getByRole("button", { name: "确认并进入密钥库" }).click(); await page.getByRole("alert").filter({ hasText: "和恢复密钥的最后两组不一致" }).waitFor();
  await page.getByRole("textbox", { name: "恢复密钥最后两组" }).fill(lastTwoGroups(recoveryKey)); await page.getByRole("button", { name: "确认并进入密钥库" }).click(); await page.locator('.vw[data-screen="main"]').waitFor(); assert.equal((await callVault(page, "list")).summaries.length, 0);
  await finish();
});

test("all seven item types can be created edited trashed restored and deleted", { timeout: 120000 }, async (context) => {
  const { page, handle, finish } = await fresh(context); await unlockUi(page);
  for (const type of ["login", "apiKey", "server", "database", "secureNote", "recoveryCodes", "custom"]) {
    const title = `UI ${type}`;
    await page.getByRole("button", { name: "新建", exact: true }).click(); await page.getByLabel("条目类型").selectOption(type); await page.getByLabel("条目标题").fill(title);
    if (type === "custom") { await page.getByRole("button", { name: "添加字段" }).click(); await page.getByLabel("字段 1 标签").fill("Custom Secret"); await page.getByLabel("字段 1 类型").selectOption("secret"); }
    const values = page.getByRole("form", { name: "新建密钥条目" }).locator("textarea"); for (let index = 0; index < await values.count(); index += 1) await values.nth(index).fill("Synthetic-Field-48");
    if (type === "login") await page.getByRole("textbox", { name: "两步验证", exact: true }).fill(RFC_SHA1_BASE32);
    if (type === "apiKey") { await page.getByRole("textbox", { name: "到期日", exact: true }).fill("2027-01-10"); await page.getByLabel("条目到期日", { exact: true }).fill("2027-01-10"); }
    await page.getByRole("button", { name: "保存条目" }).click(); await page.getByRole("heading", { name: title, exact: true }).waitFor();
    await page.getByRole("button", { name: "编辑条目", exact: true }).click(); await page.getByLabel("条目标题").fill(`${title} Edited`); await page.getByRole("button", { name: "保存条目" }).click(); await page.getByRole("heading", { name: `${title} Edited`, exact: true }).waitFor();
    await page.getByRole("button", { name: "移到回收站" }).click(); await page.getByRole("button", { name: /^回收站/ }).click(); await selectByTitle(page, `${title} Edited`); await page.getByRole("button", { name: "恢复条目" }).click(); await page.getByRole("button", { name: /^全部/ }).click(); await selectByTitle(page, `${title} Edited`); await page.getByRole("button", { name: "移到回收站" }).click(); await page.getByRole("button", { name: /^回收站/ }).click(); await selectByTitle(page, `${title} Edited`);
    await page.getByRole("button", { name: "永久删除", exact: true }).click(); await page.getByRole("dialog", { name: "永久删除密钥条目" }).getByRole("button", { name: "确认", exact: true }).click();
    await waitForEmptyVault(page);
    await page.getByRole("button", { name: /^全部/ }).click();
  }
  await finish();
});

test("unrevealed secrets are absent from the dom", { timeout: 90000 }, async (context) => {
  const secret = "LA-MARKER-ui-hidden-7289"; const { page, finish } = await fresh(context, { inputs: [loginInput("Secret Entry", secret)] }); await unlockUi(page); await selectByTitle(page, "Secret Entry");
  assert.equal(await domContains(page, secret), false); await page.getByRole("button", { name: "显示密码", exact: true }).click(); await page.getByText(secret, { exact: true }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event("blur"))); await page.waitForFunction((value) => !document.documentElement.outerHTML.includes(value), secret); assert.equal(await domContains(page, secret), false);
  await page.getByRole("button", { name: "显示密码", exact: true }).click(); await page.getByText(secret, { exact: true }).waitFor();
  await new Promise((resolve) => setTimeout(resolve, 21000)); assert.equal(await domContains(page, secret), false); await finish();
});

test("copied secrets are cleared from the clipboard", { timeout: 60000 }, async (context) => {
  const secret = "LA-MARKER-ui-copied-4829"; const { page, handle, finish } = await fresh(context, { inputs: [loginInput("Copy Entry", secret)], env: { LIFE_ATLAS_TEST_CLIPBOARD_MS: "1500" } }); await unlockUi(page); await selectByTitle(page, "Copy Entry"); await page.getByRole("button", { name: "复制密码", exact: true }).click();
  await page.locator(".copy-clear").waitFor();
  assert.equal(await handle.app.evaluate(({ clipboard }) => clipboard.readText()), secret); await new Promise((resolve) => setTimeout(resolve, 1700)); assert.equal(await handle.app.evaluate(({ clipboard }) => clipboard.readText()), "");
  await page.getByRole("button", { name: "复制密码", exact: true }).click(); await page.locator(".copy-clear").waitFor(); await handle.app.evaluate(({ clipboard }) => clipboard.writeText("其他内容")); await new Promise((resolve) => setTimeout(resolve, 1700)); assert.equal(await handle.app.evaluate(({ clipboard }) => clipboard.readText()), "其他内容"); await finish();
});

test("idle vault locks itself", { timeout: 60000 }, async (context) => {
  const { page, handle, finish } = await fresh(context, { inputs: [loginInput("Idle Secret Title")], env: { LIFE_ATLAS_TEST_AUTOLOCK_MS: "2000" } }); await unlockUi(page);
  await page.getByRole("heading", { name: "密钥库已上锁", exact: true }).waitFor({ timeout: 10000 }); assert.equal((await page.content()).includes("Idle Secret Title"), false);
  const result = await page.evaluate(() => window.lifeAtlasVault.list()); assert.equal(result.error.code, "E_LOCKED"); await page.close(); const reopened = await openVaultWindow(handle); await reopened.getByRole("heading", { name: "密钥库已上锁", exact: true }).waitFor(); await finish();
});

test("throttling shows a countdown", { timeout: 60000 }, async (context) => {
  const { page, dataRoot, finish } = await fresh(context);
  for (let index = 0; index < 5; index += 1) {
    await page.getByLabel("主密码", { exact: true }).fill("wrong-master-password"); await page.getByRole("button", { name: "解锁", exact: true }).click();
    await page.getByRole("button", { name: "解锁中…", exact: true }).waitFor();
    await page.getByRole("alert").waitFor(); await page.waitForFunction(() => ![...document.querySelectorAll("button")].some((button) => button.textContent === "解锁中…"));
    assert.equal(failedAttempts(dataRoot), index + 1);
  }
  await page.getByRole("status").filter({ hasText: "请等待" }).waitFor(); assert.equal(await page.getByRole("button", { name: "解锁", exact: true }).isDisabled(), true); await finish();
});

test("recovery and password changes rotate keys", { timeout: 90000 }, async (context) => {
  const { page, seed, finish } = await fresh(context, { inputs: [loginInput("Rotate Entry")] }); await page.getByRole("button", { name: "忘记主密码？使用恢复密钥" }).click();
  await page.getByLabel("输入恢复密钥").fill(seed.recoveryKey); await page.getByLabel("新主密码", { exact: true }).fill(NEXT_PASSWORD); await page.getByLabel("再次输入主密码").fill(NEXT_PASSWORD); await page.getByRole("button", { name: "下一步", exact: true }).click(); await page.getByLabel("恢复密钥", { exact: true }).waitFor(); const firstNewKey = await page.getByLabel("恢复密钥", { exact: true }).textContent(); await confirmRecoveryUi(page, firstNewKey);
  const changed = await callVault(page, "changePassword", { currentPassword: NEXT_PASSWORD, newPassword: TEST_PASSWORD }); await callVault(page, "confirmRecoveryKey", { lastTwoGroups: lastTwoGroups(changed.recoveryKey) }); const regenerated = await callVault(page, "regenerateRecoveryKey", { password: TEST_PASSWORD }); await callVault(page, "confirmRecoveryKey", { lastTwoGroups: lastTwoGroups(regenerated.recoveryKey) });
  const old = await page.evaluate(({ recoveryKey, newPassword }) => window.lifeAtlasVault.unlockWithRecoveryKey({ recoveryKey, newPassword }), { recoveryKey: firstNewKey, newPassword: NEXT_PASSWORD }); assert.equal(old.error.code, "E_BAD_PASSWORD"); assert.equal((await callVault(page, "list")).summaries.length, 1); await finish();
});

test("workspace window has no vault access", { timeout: 60000 }, async (context) => {
  const { handle, finish } = await fresh(context); assert.equal(await handle.page.evaluate(() => window.lifeAtlasVault === undefined), true);
  const status = await handle.page.evaluate(() => window.lifeAtlas.app.getVaultStatus()); assert.equal(status.ok, true); assert.deepEqual(Object.keys(status.value).sort(), ["exists", "locked"]);
  const before = handle.page.url(); await handle.page.evaluate(() => { location.href = "app://bundle/vault.html"; }); await new Promise((resolve) => setTimeout(resolve, 300)); assert.equal(handle.page.url(), before); await finish();
});

test("vault window is content protected and uses a memory session", { timeout: 60000 }, async (context) => {
  const { handle, finish } = await fresh(context);
  const state = await handle.app.evaluate(({ BrowserWindow, session }) => { const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes("vault.html")); return { protected: typeof window.isContentProtected === "function" ? window.isContentProtected() : globalThis.__lifeAtlasTest.contentProtected, persistent: session.fromPartition("vault").isPersistent() }; });
  assert.equal(state.protected, true); assert.equal(state.persistent, false); await finish();
});

test("nothing secret reaches the disk after a ui session", { timeout: 90000 }, async (context) => {
  const markers = createMarkers(); const { page, handle, dataRoot, finish } = await fresh(context, { seeded: false }); const key = await completeCreate(page); await confirmRecoveryUi(page, key);
  for (const input of vaultItemInputs(markers)) await callVault(page, "createItem", { input }); await callVault(page, "lock"); await finish({ keepDirs: true });
  const markerRoot = createIsolatedDirectory("vault-ui-markers"); context.after(() => removeIsolatedDirectory(markerRoot)); const markerFile = path.join(markerRoot, "markers.txt"); fs.writeFileSync(markerFile, [...markers.all(), TEST_PASSWORD, key].join("\n"));
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, "tools/scan-plaintext.mjs"), dataRoot, "--markers", markerFile], { encoding: "utf8" }); assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const directory of [handle.bootstrapDir, handle.tempDir]) removeIsolatedDirectory(directory);
  removeIsolatedDirectory(dataRoot);
});

test("the vault never touches the network", { timeout: 60000 }, async (context) => {
  const { page, finish } = await fresh(context, { inputs: [loginInput("Offline Entry")] }); await unlockUi(page); await selectByTitle(page, "Offline Entry"); await page.getByRole("button", { name: "显示密码", exact: true }).click(); await page.getByRole("button", { name: /^设置$/ }).click(); await finish();
});

test("totp codes follow the injected clock", { timeout: 60000 }, async (context) => {
  const { page, handle, finish } = await fresh(context, { inputs: [loginInput("Totp Entry", "Synthetic-Password-48", RFC_SHA1_BASE32)] }); await unlockUi(page); await handle.app.evaluate(() => globalThis.__lifeAtlasTest.clock.set(59000)); await selectByTitle(page, "Totp Entry");
  await page.getByLabel("两步验证码").waitFor(); assert.equal((await page.getByLabel("两步验证码").textContent()).replace(/\s/g, "").slice(0, 6), "287082");
  await handle.app.evaluate(() => globalThis.__lifeAtlasTest.clock.advance(30000)); await page.waitForFunction(() => { const code = document.querySelector(".totp"); return code && [...code.querySelectorAll("b")].map((node) => node.textContent).join("") !== "287082"; }); await finish();
});

test("keyboard alone can unlock create copy and lock", { timeout: 60000 }, async (context) => {
  const { page, handle, finish } = await fresh(context); await page.getByLabel("主密码", { exact: true }).pressSequentially(TEST_PASSWORD); await page.keyboard.press("Enter"); await page.locator('.vw[data-screen="main"]').waitFor(); await page.keyboard.press("Control+n"); await page.getByLabel("条目标题").fill("Keyboard Entry"); await page.getByRole("textbox", { name: "密码", exact: true }).fill("Keyboard-Secret-48"); await page.getByRole("button", { name: "保存条目" }).focus(); await page.keyboard.press("Enter"); await page.getByRole("heading", { name: "Keyboard Entry", exact: true }).waitFor(); await page.getByRole("button", { name: "复制密码", exact: true }).focus(); await page.keyboard.press("Enter"); await page.locator(".copy-clear").waitFor(); assert.equal(await handle.app.evaluate(({ clipboard }) => clipboard.readText()), "Keyboard-Secret-48"); await page.keyboard.press("Control+l"); await page.getByRole("heading", { name: "密钥库已上锁", exact: true }).waitFor(); await finish();
});

test("confirm requests appear in the vault window", { timeout: 90000 }, async (context) => {
  const { page, handle, dataRoot, finish } = await fresh(context, { env: { LIFE_ATLAS_TEST_CONFIRM_TTL_MS: "3000" } });
  for (const locked of [true, false]) {
    if (!locked) await unlockUi(page);
    const pending = handle.app.evaluate(() => globalThis.__lifeAtlasTest.requestConfirmation({ kind: "export-backup", title: "导出完整备份（包含密钥库）", description: "测试" }));
    const dialog = page.getByRole("dialog", { name: "导出完整备份（包含密钥库）" }); await dialog.waitFor(); await dialog.getByLabel("确认操作的主密码").fill(TEST_PASSWORD); await dialog.getByRole("button", { name: "确认", exact: true }).click(); assert.equal(await pending, "confirmed"); assert.equal((await callVault(page, "status")).locked, locked);
  }
  const before = failedAttempts(dataRoot);
  const wrong = handle.app.evaluate(() => globalThis.__lifeAtlasTest.requestConfirmation({ kind: "export-backup", title: "错误密码请求", description: "测试" }));
  const wrongDialog = page.getByRole("dialog", { name: "错误密码请求" }); await wrongDialog.waitFor(); await wrongDialog.getByLabel("确认操作的主密码").fill("wrong-confirmation-password"); await wrongDialog.getByRole("button", { name: "确认", exact: true }).click(); await wrongDialog.getByRole("alert").filter({ hasText: "主密码不正确" }).waitFor(); assert.equal(failedAttempts(dataRoot), before + 1); await wrongDialog.getByRole("button", { name: "取消", exact: true }).click(); assert.equal(await wrong, "cancelled");
  const cancel = handle.app.evaluate(() => globalThis.__lifeAtlasTest.requestConfirmation({ kind: "export-backup", title: "取消请求", description: "测试" })); await page.getByRole("dialog", { name: "取消请求" }).getByRole("button", { name: "取消", exact: true }).click(); assert.equal(await cancel, "cancelled");
  const expires = handle.app.evaluate(() => globalThis.__lifeAtlasTest.requestConfirmation({ kind: "schedule-backup", title: "过期请求", description: "测试" })); const expiryDialog = page.getByRole("dialog", { name: "过期请求" }); await expiryDialog.waitFor(); await expiryDialog.getByLabel("确认操作的主密码").fill(TEST_PASSWORD); assert.equal(await expires, "expired"); await expiryDialog.waitFor({ state: "hidden" }); assert.equal(await page.getByLabel("确认操作的主密码").count(), 0); await finish();
});

test("an unconfirmed recovery key forces regeneration", { timeout: 60000 }, async (context) => {
  const { page, finish } = await fresh(context, { confirmed: false }); await page.getByLabel("主密码", { exact: true }).fill(TEST_PASSWORD); await page.getByRole("button", { name: "解锁", exact: true }).click(); await page.getByRole("heading", { name: "重新生成恢复密钥", exact: true }).waitFor();
  assert.equal((await page.content()).includes("密钥条目列表"), false); await page.getByLabel("重新生成时的主密码").fill(TEST_PASSWORD); await page.getByRole("button", { name: "重新生成", exact: true }).click(); await page.getByLabel("恢复密钥", { exact: true }).waitFor(); const key = await page.getByLabel("恢复密钥", { exact: true }).textContent(); await confirmRecoveryUi(page, key); await finish();
});

test("reset is reachable from the lock screen", { timeout: 60000 }, async (context) => {
  const { page, dataRoot, finish } = await fresh(context); await page.getByRole("button", { name: "忘记了主密码和恢复密钥？重置密钥库" }).click(); await page.getByLabel("重置确认短语").fill("重置我的密钥库"); await page.getByRole("button", { name: "确认重置密钥库", exact: true }).waitFor({ timeout: 15000 }); await page.getByRole("button", { name: "确认重置密钥库", exact: true }).click(); await page.getByRole("heading", { name: "你的私密密钥库", exact: true }).waitFor(); assert.ok(fs.readdirSync(path.join(dataRoot, "snapshots")).some((name) => name.endsWith("vault-reset"))); await finish();
});

test("history shows and restores old passwords", { timeout: 60000 }, async (context) => {
  const { page, handle, finish } = await fresh(context, { inputs: [loginInput("History Entry", "original-value")] }); await unlockUi(page); const id = (await callVault(page, "list")).summaries[0].id; const item = (await callVault(page, "getItem", { id })).item; const fieldId = item.fields.find((field) => field.kind === "secret").id;
  for (const value of ["first-value", "second-value", "third-value"]) await callVault(page, "updateItem", { id, patch: { fields: item.fields.map((field) => ({ id: field.id, label: field.label, kind: field.kind, sensitive: field.sensitive, ...(field.id === fieldId ? { value } : { keepValue: true }) })) } });
  await selectByTitle(page, "History Entry"); const field = page.locator(".vw-field").filter({ has: page.getByText("密码", { exact: true }) }); await field.getByRole("button", { name: "历史记录（3）", exact: true }).click(); await field.locator(".history-entry").first().getByRole("button", { name: "显示", exact: true }).click(); await page.getByText("second-value", { exact: true }).waitFor(); await field.locator(".history-entry").first().getByRole("button", { name: "恢复为当前值" }).click(); await page.getByRole("dialog", { name: "恢复历史值" }).getByRole("button", { name: "确认", exact: true }).click(); await field.getByRole("button", { name: "历史记录（4）", exact: true }).waitFor(); await page.getByRole("button", { name: "显示密码", exact: true }).click(); await page.getByText("second-value", { exact: true }).waitFor(); await field.getByRole("button", { name: "历史记录（4）", exact: true }).click(); await shootWindowBothModes(handle, "vault-history", { page, shotsDir: path.join(REPO_ROOT, ".qa/WP-11/shots") }); await finish();
});

test("expiring items are flagged and listed", { timeout: 60000 }, async (context) => {
  const expiry = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10); const input = { ...loginInput("Expiring API"), type: "apiKey", expiresAt: expiry };
  const { page, handle, finish } = await fresh(context, { inputs: [input] }); await unlockUi(page); await page.getByRole("button", { name: /^即将到期/ }).click(); await page.getByRole("button", { name: /Expiring API/ }).first().waitFor(); assert.ok(await page.getByText("即将到期", { exact: true }).count() >= 1); await shootWindowBothModes(handle, "vault-expiring", { page, shotsDir: path.join(REPO_ROOT, ".qa/WP-11/shots") }); await finish();
});

test("security check lists weak reused stale and missing totp", { timeout: 60000 }, async (context) => {
  const { page, handle, finish } = await fresh(context, { inputs: [loginInput("Weak Entry", "123"), loginInput("Shared First", "Shared-Password-48"), loginInput("Shared Second", "Shared-Password-48")] }); await unlockUi(page); await handle.app.evaluate(() => globalThis.__lifeAtlasTest.clock.advance(366 * 86400000)); await page.getByRole("button", { name: /^安全检查/ }).click(); for (const name of ["弱密码 · 1", "重复密码 · 2", "超过一年未修改 · 3", "未设置两步验证 · 3"]) await page.getByRole("heading", { name, exact: true }).waitFor(); await shootWindowBothModes(handle, "vault-security-check", { page, shotsDir: path.join(REPO_ROOT, ".qa/WP-11/shots") }); await finish();
});

test("browser csv import previews without passwords and imports", { timeout: 60000 }, async (context) => {
  const { page, handle, dataRoot, finish } = await fresh(context); await unlockUi(page); const source = path.join(dataRoot, "synthetic.csv"); fs.copyFileSync(path.join(REPO_ROOT, "tests/fixtures/browser-passwords/chrome.csv"), source); await queueDialogResponse(handle, "showOpenDialog", { canceled: false, filePaths: [source] }); await page.getByRole("button", { name: /^设置$/ }).click(); await page.getByRole("button", { name: "从浏览器导入密码…" }).click(); await page.getByRole("heading", { name: "导入浏览器密码" }).waitFor(); for (let index = 1; index <= 5; index += 1) assert.equal(await domContains(page, `csv-chrome-test-${index}`), false); await shootWindowBothModes(handle, "vault-csv-preview", { page, shotsDir: path.join(REPO_ROOT, ".qa/WP-11/shots") }); await page.getByRole("button", { name: "导入 5 条", exact: true }).click(); await page.getByRole("status").filter({ hasText: "已导入 5 条" }).waitFor(); assert.equal((await callVault(page, "list")).summaries.length, 5); assert.ok(fs.existsSync(source)); fs.unlinkSync(source); await finish();
});

test("passphrases can be generated in the editor", { timeout: 60000 }, async (context) => {
  const { page, handle, finish } = await fresh(context); await unlockUi(page); await page.getByRole("button", { name: "新建", exact: true }).click(); await page.getByLabel("条目标题").fill("Phrase Entry"); await page.locator(".editor-field").filter({ has: page.getByRole("textbox", { name: "密码", exact: true }) }).getByRole("button", { name: "生成密码 / 口令短语" }).click(); await page.getByRole("button", { name: "口令短语", exact: true }).click(); await page.getByRole("button", { name: "生成", exact: true }).click(); await page.locator(".generated-value").waitFor(); await page.locator(".generated-value").scrollIntoViewIfNeeded(); await shootWindowBothModes(handle, "vault-passphrase", { page, shotsDir: path.join(REPO_ROOT, ".qa/WP-11/shots") }); await page.getByRole("button", { name: "使用", exact: true }).click(); assert.ok((await page.getByRole("textbox", { name: "密码", exact: true }).inputValue()).length > 15); await finish();
});

test("the security notes explain clipboard history", { timeout: 60000 }, async (context) => {
  const { page, handle, finish } = await fresh(context); await unlockUi(page); await page.getByRole("button", { name: /^设置$/ }).click(); await page.getByText(/Windows 的“剪贴板历史”/).waitFor(); await page.getByText(/Electronic Frontier Foundation/).waitFor(); await page.getByText(/Electronic Frontier Foundation/).scrollIntoViewIfNeeded(); await shootWindowBothModes(handle, "vault-security-notes", { page, shotsDir: path.join(REPO_ROOT, ".qa/WP-11/shots") }); const formats = await handle.app.evaluate(probeSyntheticClipboard); console.log(`VAULT_CLIPBOARD_FORMATS=${JSON.stringify(formats)}`); assert.equal(formats.fallback.textPreserved, true); await finish();
});
