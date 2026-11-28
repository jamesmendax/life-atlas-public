import test from "node:test";
import assert from "node:assert/strict";
import { createBackupDesktopCase } from "./backup-helpers.mjs";
import { openPageInSidebar, readDialogCalls } from "./helpers.mjs";

test("mouse side buttons go back and forward", { timeout: 60000 }, async (context) => {
  const state = await createBackupDesktopCase(context, { seed: true, packaged: true, retainOnFailure: true });
  const { handle } = state;
  await openPageInSidebar(handle.page, "Z 目标页");
  await openPageInSidebar(handle.page, "A 概览");
  await handle.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit("app-command", { preventDefault() {} }, "browser-backward"));
  await handle.page.waitForFunction(() => document.querySelector(".page-title-input")?.value === "Z 目标页");
  assert.equal(await handle.page.getByLabel("页面标题", { exact: true }).inputValue(), "Z 目标页");
  await handle.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit("app-command", { preventDefault() {} }, "browser-forward"));
  await handle.page.waitForFunction(() => document.querySelector(".page-title-input")?.value === "A 概览");
  assert.equal(await handle.page.getByLabel("页面标题", { exact: true }).inputValue(), "A 概览");
  await state.close();
  state.complete();
});

test("the workspace menu offers the data folder on desktop", { timeout: 60000 }, async (context) => {
  const state = await createBackupDesktopCase(context, { seed: true, packaged: true, retainOnFailure: true });
  await state.handle.page.locator(".workspace-switcher").click();
  await state.handle.page.getByRole("menuitem", { name: "打开数据目录", exact: true }).click();
  const deadline = performance.now() + 30000;
  let calls;
  do {
    calls = (await readDialogCalls(state.handle)).filter((entry) => entry.kind === "openPath");
    assert.ok(calls.length <= 1, "The data-folder action must not open more than once");
    if (calls.length === 1) break;
    assert.ok(performance.now() < deadline, "The data-folder action never reached the desktop adapter");
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls, [{ kind: "openPath", options: { path: state.dataRoot }, response: "" }]);
  await state.close();
  state.complete();
});
