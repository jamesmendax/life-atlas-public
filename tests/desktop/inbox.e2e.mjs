import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { FIXTURE_TIME } from "../fixtures/full-workspace.mjs";
import { formatDateTime } from "../../src/domain/content.js";
import { seedDesktopFullWorkspace, createBackupDesktopCase, captureBackupWorkspace, backupWorkspaceAfterInitialVisit, assertBackupWorkspaceEqual, assertBackupWorkspaceEntitiesEqual, readClosedBackupWorkspace } from "./backup-helpers.mjs";
import { createIsolatedDirectory, removeIsolatedDirectory, launchApp, closeApp, openPageInSidebar, assertNoNetworkAndErrors } from "./helpers.mjs";

async function persistedWorkspace(handle, predicate) {
  const deadline = performance.now() + 30000;
  do {
    const loaded = await handle.page.evaluate(() => window.lifeAtlas.workspace.load());
    assert.equal(loaded.ok, true, loaded.error?.message);
    if (predicate(loaded.value.workspace)) return loaded.value.workspace;
    assert.ok(performance.now() < deadline, "The expected inbox state was not persisted");
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (true);
}

async function inboxCase(context, { running = false } = {}) {
  const dataRoot = createIsolatedDirectory("inbox-e2e-data");
  const bootstrapDir = createIsolatedDirectory("inbox-e2e-bootstrap");
  const roots = [dataRoot, bootstrapDir];
  const launches = [];
  let completed = false;
  context.after(async () => {
    const cleanupErrors = [];
    for (const launch of [...launches].reverse()) if (!launch.closed) {
      try { await closeApp(launch.handle, { keepDirs: true }); launch.closed = true; }
      catch (error) { cleanupErrors.push(error); }
    }
    const directories = [...new Set(roots)].reverse();
    if (!completed || cleanupErrors.length) console.log(`LIFE_ATLAS_INBOX_CASE_RETAINED ${JSON.stringify({ directories: directories.filter((directory) => fs.existsSync(directory)), completed })}`);
    else for (const directory of directories) if (fs.existsSync(directory)) removeIsolatedDirectory(directory);
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Inbox case process cleanup failed; evidence directories retained");
  });
  const fixture = await seedDesktopFullWorkspace(dataRoot);
  const state = { dataRoot, bootstrapDir, handle: null, fixture, rawBeforeStartup: null, complete() { completed = true; } };
  state.launch = async ({ time = FIXTURE_TIME } = {}) => {
    state.rawBeforeStartup = readClosedBackupWorkspace(dataRoot);
    const handle = await launchApp({ packaged: true, dataRoot, bootstrapDir, env: { LIFE_ATLAS_TEST_CLOCK_MS: String(Date.parse(time)) }, rendererClock: { mode: running ? "running" : "fixed", time: new Date(time) } });
    launches.push({ handle, closed: false });
    roots.push(handle.tempDir);
    state.handle = handle;
    await handle.page.locator(".workspace-sidebar").waitFor();
    if (running) {
      const start = Date.parse(time);
      const loaded = await persistedWorkspace(handle, (workspace) => Date.parse(workspace.ui.lastReminderCheckAt) >= start && workspace.ui.recentVisits.some((visit) => visit.pageId === state.rawBeforeStartup.ui.selectedPageId && Date.parse(visit.visitedAt) >= start));
      assertBackupWorkspaceEntitiesEqual(loaded, state.rawBeforeStartup);
      assert.ok(Date.parse(loaded.ui.lastReminderCheckAt) < start + 30000);
      assert.deepEqual(loaded.ui.firedReminderIds, state.rawBeforeStartup.ui.firedReminderIds);
      assert.deepEqual(loaded.ui.reminderLog, state.rawBeforeStartup.ui.reminderLog);
    } else assertBackupWorkspaceEqual(await captureBackupWorkspace(handle), { ...backupWorkspaceAfterInitialVisit(state.rawBeforeStartup, time), savedAt: time });
    return handle;
  };
  state.close = async () => {
    const launch = launches.find((entry) => entry.handle === state.handle);
    if (!launch || launch.closed) return;
    await assertNoNetworkAndErrors(state.handle);
    await closeApp(state.handle, { keepDirs: true });
    launch.closed = true;
    state.handle = null;
  };
  await state.launch();
  return state;
}

function localMinute(time) {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function reminderProps(value, when) {
  if (!value || typeof value !== "object") return [];
  const found = value.type === "dateMention" && value.props?.kind === "reminder" && value.props.value === when ? [value.props] : [];
  return [...found, ...Object.values(value).flatMap((entry) => reminderProps(entry, when))];
}

async function insertReminder(handle, when) {
  await handle.page.keyboard.press("Control+k");
  const search = handle.page.getByRole("dialog", { name: "全局搜索", exact: true });
  await search.getByRole("combobox", { name: "搜索文件夹、页面与正文" }).fill("A 子页面");
  await search.locator(".search-result-row").filter({ has: handle.page.locator("strong", { hasText: "A 子页面" }) }).first().click();
  await handle.page.locator('.life-editor[data-page-id="p-a1-child"] .bn-editor').waitFor();
  const trailing = handle.page.locator(".bn-editor .bn-trailing-block");
  if (await trailing.count()) await trailing.last().click();
  else await handle.page.locator(".bn-editor .bn-inline-content").last().click();
  await handle.page.keyboard.press("Control+End");
  await handle.page.keyboard.press("Enter");
  await handle.page.keyboard.type("@提醒");
  await handle.page.getByRole("option").filter({ hasText: "提醒" }).first().click();
  const dialog = handle.page.getByRole("dialog", { name: "提醒", exact: true });
  await dialog.getByLabel("提醒时间", { exact: true }).fill(when);
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  const saved = await persistedWorkspace(handle, (workspace) => reminderProps(workspace.pages.find((page) => page.id === "p-a1-child")?.content, when).length === 1);
  const props = reminderProps(saved.pages.find((page) => page.id === "p-a1-child").content, when)[0];
  assert.match(props.reminderId, /^rem-/);
  return props.reminderId;
}

async function showReminderInbox(handle) {
  await handle.page.locator(".workspace-sidebar").getByRole("button", { name: /^收件箱/ }).click();
  await handle.page.getByRole("tab", { name: /^提醒/ }).click();
  await handle.page.locator(".inbox-reminder-row").waitFor();
}

test("the global shortcut opens quick capture", { timeout: 60000 }, async (context) => {
  const state = await createBackupDesktopCase(context, { seed: true, packaged: true, retainOnFailure: true });
  await state.handle.app.evaluate(() => globalThis.__lifeAtlasTest.triggerQuickCapture());
  const capture = state.handle.page.getByRole("dialog", { name: "快速记录", exact: true });
  await capture.waitFor();
  assert.equal(await capture.isVisible(), true);
  assert.equal(await capture.getByRole("textbox").count(), 2);
  assert.equal(await capture.getByRole("button", { name: "保存并打开", exact: true }).count(), 1);
  assert.equal(await capture.getByRole("button", { name: "保存", exact: true }).count(), 1);
  await state.handle.page.keyboard.press("Escape");
  await capture.waitFor({ state: "hidden" });
  await state.close();
  state.complete();
});

test("due reminders send a desktop notification and clicking opens the page", { timeout: 120000 }, async (context) => {
  const state = await inboxCase(context, { running: true });
  const fireAt = Date.parse(FIXTURE_TIME) + 300000;
  assert.equal(await state.handle.page.evaluate((time) => new Date(time).getTimezoneOffset(), fireAt), new Date(fireAt).getTimezoneOffset());
  const reminderId = await insertReminder(state.handle, localMinute(fireAt));
  await openPageInSidebar(state.handle.page, "Z 目标页");
  assert.ok(await state.handle.page.evaluate(() => Date.now()) < fireAt);
  assert.deepEqual(await state.handle.app.evaluate(() => globalThis.__lifeAtlasTest.notifications), []);
  await state.handle.page.clock.fastForward("05:05");
  const key = `${reminderId}@${new Date(fireAt).toISOString()}`;
  const fired = await persistedWorkspace(state.handle, (workspace) => workspace.ui.reminderLog.some((entry) => entry.key === key));
  const expected = { key, pageId: "p-a1-child", title: "A 子页面", fireAt, source: "提及", missed: false, readAt: null };
  assert.deepEqual(fired.ui.reminderLog, [expected]);
  assert.deepEqual(fired.ui.firedReminderIds, [key]);
  const deadline = performance.now() + 30000;
  let notifications;
  do {
    notifications = await state.handle.app.evaluate(() => globalThis.__lifeAtlasTest.notifications);
    assert.ok(notifications.length <= 1, "A reminder must produce exactly one notification");
    if (notifications.length) break;
    assert.ok(performance.now() < deadline, "The due reminder did not reach the desktop notification adapter");
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (true);
  assert.deepEqual(notifications, [{ title: "A 子页面", body: `提醒时间 ${formatDateTime(new Date(fireAt).toISOString())}`, pageId: "p-a1-child" }]);
  assert.equal(await state.handle.page.getByLabel("页面标题", { exact: true }).inputValue(), "Z 目标页");
  await state.handle.app.evaluate(() => globalThis.__lifeAtlasTest.clickNotification(0));
  await state.handle.page.waitForFunction(() => document.querySelector(".page-title-input")?.value === "A 子页面");
  const read = await persistedWorkspace(state.handle, (workspace) => Boolean(workspace.ui.reminderLog.find((entry) => entry.key === key)?.readAt));
  const readAt = read.ui.reminderLog[0].readAt;
  assert.ok(Date.parse(readAt) >= fireAt);
  assert.deepEqual(read.ui.reminderLog, [{ ...expected, readAt }]);
  assert.deepEqual(read.ui.firedReminderIds, [key]);
  await state.close();
  state.complete();
});

test("missed reminders appear once after a restart", { timeout: 120000 }, async (context) => {
  const state = await inboxCase(context);
  const fireAt = Date.parse(FIXTURE_TIME) - 60000;
  const reminderId = await insertReminder(state.handle, localMinute(fireAt));
  await state.close();
  const raw = readClosedBackupWorkspace(state.dataRoot);
  assert.deepEqual(raw.ui.reminderLog, []);
  assert.deepEqual(raw.ui.firedReminderIds, []);
  const key = `${reminderId}@${new Date(fireAt).toISOString()}`;
  const expected = { key, pageId: "p-a1-child", title: "A 子页面", fireAt, source: "提及", missed: true, readAt: null };
  for (const minutes of [1, 2]) {
    await state.launch({ time: new Date(Date.parse(FIXTURE_TIME) + minutes * 60000).toISOString() });
    const loaded = await persistedWorkspace(state.handle, (workspace) => workspace.ui.reminderLog.some((entry) => entry.key === key));
    assert.deepEqual(loaded.ui.reminderLog, [expected]);
    assert.deepEqual(loaded.ui.firedReminderIds, [key]);
    assert.deepEqual(await state.handle.app.evaluate(() => globalThis.__lifeAtlasTest.notifications), []);
    await showReminderInbox(state.handle);
    assert.equal(await state.handle.page.locator(".inbox-reminder-row").count(), 1);
    assert.equal(await state.handle.page.locator(".inbox-reminder-row").getByText("错过的提醒", { exact: true }).count(), 1);
    await state.close();
    assert.deepEqual(readClosedBackupWorkspace(state.dataRoot).ui.reminderLog, [expected]);
  }
  state.complete();
});
