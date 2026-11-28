import { browserScenario } from "./harness.mjs";
import { formatDateLabel } from "../../src/domain/databaseProperties.js";
import { recurrence, recurrenceWorkspace } from "../fixtures/task-recurrence.mjs";

await browserScenario("task-recurrence-150", async ({ page, check, assert, persisted }) => {
  const db = page.locator('[data-id="recurrence-db"] .database-view');
  const row = (workspace, id) => workspace.databaseItems.find(item => item.id === id);
  async function complete(id) {
    const cell = db.locator('tr[data-item-id="' + id + '"] td[data-property-id="task-status"]');
    await cell.locator("summary").click();
    await cell.getByRole("option", { name: "已完成", exact: true }).click();
  }
  await check("configure weekly recurrence through the status property", async () => {
    await db.locator('.db-property-header[data-type="status"]').click();
    await page.getByRole("menuitem", { name: "编辑属性…", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "编辑状态属性" });
    await panel.getByRole("button", { name: "周期任务设置" }).click();
    await panel.getByLabel("触发完成状态").selectOption("done");
    await panel.getByLabel("顺延后重置为").selectOption("todo");
    await panel.getByLabel("顺延日期属性").selectOption("due");
    await panel.getByLabel("重复间隔属性").selectOption("interval");
    await panel.getByLabel("重复间隔单位").selectOption("days");
    await panel.getByRole("button", { name: "保存周期规则" }).click();
    const saved = await persisted(w => w.dataSources[0].properties[1].config.recurrence);
    assert.deepEqual(saved.dataSources[0].properties[1].config.recurrence, recurrence);
    await panel.getByRole("button", { name: "关闭属性设置" }).click();
  });
  for (const [count, date] of [[1, "2026-12-04"], [2, "2026-12-11"]]) {
    await check("complete weekly review for " + date, async () => {
      await complete("recur-task");
      const w = await persisted(w => row(w, "recur-task").values.due.start === date);
      const task = row(w, "recur-task");
      assert.equal(task.values["task-status"], "todo");
      assert.equal(task.recurrenceReceipts.length, count);
      const visible = db.locator('tr[data-item-id="recur-task"]');
      assert.match(await visible.locator('[data-property-id="task-status"]').innerText(), /待办/);
      assert.equal((await visible.locator('[data-property-id="due"]').innerText()).trim(), formatDateLabel(task.values.due));
      await page.reload();
      await db.waitFor();
    });
  }
  await check("batch completion advances the recurring task and finishes the ordinary task", async () => {
    await db.getByRole("checkbox", { name: "全选", exact: true }).check();
    await db.getByRole("button", { name: "修改属性", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "批量修改属性" });
    await dialog.getByLabel("要批量修改的属性").selectOption("task-status");
    await dialog.locator("summary").click();
    await dialog.getByRole("option", { name: "已完成", exact: true }).click();
    await dialog.getByRole("button", { name: "应用到 2 条记录" }).click();
    const w = await persisted(w => row(w, "one-off").values["task-status"] === "done" && row(w, "recur-task").values.due.start === "2026-12-18");
    assert.equal(row(w, "recur-task").values["task-status"], "todo");
    assert.equal(row(w, "recur-task").recurrenceReceipts.length, 3);
    assert.equal(row(w, "one-off").values.due.start, "2026-11-27");
    assert.equal(row(w, "one-off").recurrenceReceipts, undefined);
  });
}, { workspace: recurrenceWorkspace({ configured: false }) });
