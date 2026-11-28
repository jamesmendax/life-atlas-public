import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { applyTaskRecurrence, captureRecurrenceOccurrence } from "../src/domain/taskRecurrence.js";
import { assembleWorkspace, initializeWorkspace, openWorkspaceDatabase, prepareWritable, readAllRows, writeWorkspaceDiff } from "../electron/main/storage/workspaceDb.js";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";
import { now, recurrenceWorkspace } from "./fixtures/task-recurrence.mjs";

function command(workspace, operationId = "first", itemId = "recur-task") {
  const source = workspace.dataSources[0];
  const property = source.properties.find(entry => entry.id === "task-status");
  const item = workspace.databaseItems.find(entry => entry.id === itemId);
  return { itemId, propertyId: property.id, value: "done", expectedOccurrence: captureRecurrenceOccurrence(source, item, property), operationId, now };
}

test("124 weekly completion, atomic receipt, SQLite reopen, replay, stale occurrence and intentional next completion", context => {
  const directory = createIsolatedDirectory("recurrence-150");
  const database = path.join(directory, "workspace.db");
  let db = openWorkspaceDatabase(database);
  context.after(() => { try { db?.close(); } finally { removeIsolatedDirectory(directory); } });
  prepareWritable(db);
  const initial = recurrenceWorkspace();
  initializeWorkspace(db, initial, { generation: "test-generation", now });
  const options = command(initial);
  const first = applyTaskRecurrence(initial, options);
  assert.equal(first.handled, true);
  assert.equal(initial.databaseItems[0].values.due.start, "2026-11-27");
  assert.equal(first.workspace.databaseItems[0].values["task-status"], "todo");
  assert.equal(first.workspace.databaseItems[0].values.due.start, "2026-12-04");
  assert.equal(first.workspace.databaseItems[1], initial.databaseItems[1]);
  writeWorkspaceDiff(db, readAllRows(db), first.workspace, { now });
  db.close();
  db = openWorkspaceDatabase(database);
  const reopened = assembleWorkspace(readAllRows(db));
  const [receipt] = reopened.databaseItems[0].recurrenceReceipts;
  assert.deepEqual(receipt.previousDue, initial.databaseItems[0].values.due);
  assert.deepEqual(receipt.nextDue, reopened.databaseItems[0].values.due);
  assert.equal(receipt.completedAt, now);
  for (const replay of [options, command(reopened, "first")]) {
    const repeated = applyTaskRecurrence(reopened, replay);
    assert.equal(repeated.workspace, reopened);
    assert.equal(repeated.duplicate, true);
  }
  const stale = applyTaskRecurrence(reopened, { ...options, operationId: "delayed" });
  assert.equal(stale.workspace, reopened);
  assert.match(stale.reason, /已更改/);
  const second = applyTaskRecurrence(reopened, command(reopened, "next"));
  assert.equal(second.workspace.databaseItems[0].values.due.start, "2026-12-11");
  assert.equal(second.workspace.databaseItems[0].recurrenceReceipts.length, 2);
});

test("blank intervals, ordinary status changes and already-complete values leave recurrence idle", () => {
  const workspace = recurrenceWorkspace();
  for (const request of [command(workspace, "first", "one-off"), { ...command(workspace), value: "doing" }]) {
    const result = applyTaskRecurrence(workspace, request);
    assert.equal(result.workspace, workspace);
    assert.equal(result.handled, false);
  }
  workspace.databaseItems[0].values["task-status"] = "done";
  const result = applyTaskRecurrence(workspace, command(workspace));
  assert.equal(result.workspace, workspace);
  assert.equal(result.duplicate, true);
  const property = workspace.dataSources[0].properties[1];
  property.options.push({ id: "archived", name: "已归档", group: "complete" });
  workspace.databaseItems[0].values["task-status"] = "archived";
  assert.equal(applyTaskRecurrence(workspace, command(workspace)).handled, false);
});

test("preserves both clock times, offsets, IANA zone, range length and reminders and source date representation", () => {
  const workspace = recurrenceWorkspace();
  const values = workspace.databaseItems[0].values;
  const due = { start: "2026-10-25T23:45:20.180+08:00", end: "2026-10-26T02:15:00+0800", includeTime: true,
    timeZone: "Asia/Shanghai", reminder: { id: "r1", offset: "1h" } };
  values.due = due;
  const first = applyTaskRecurrence(workspace, command(workspace)).workspace.databaseItems[0];
  assert.deepEqual(first.recurrenceReceipts[0].previousDue, due);
  assert.deepEqual(first.values.due, { ...due, start: "2026-11-01T23:45:20.180+08:00", end: "2026-11-02T02:15:00+0800" });
  workspace.dataSources[0].properties[1].config.recurrence.unit = "weeks";
  values.interval = 1;
  values.due = "2028-02-25T15:30Z";
  assert.equal(applyTaskRecurrence(workspace, command(workspace)).workspace.databaseItems[0].values.due, "2028-03-03T15:30Z");
});

test("monthly wall-calendar clamping keeps the intended day and the range across leap February", () => {
  const workspace = recurrenceWorkspace();
  workspace.dataSources[0].properties[1].config.recurrence.unit = "months";
  const values = workspace.databaseItems[0].values;
  values.interval = 1;
  values.due = { start: "2028-01-31", end: "2028-02-02", includeTime: false };
  const february = applyTaskRecurrence(workspace, command(workspace)).workspace;
  assert.deepEqual(february.databaseItems[0].values.due, { ...values.due, start: "2028-02-29", end: "2028-03-02" });
  const march = applyTaskRecurrence(february, command(february, "march")).workspace;
  assert.deepEqual(march.databaseItems[0].values.due, { ...values.due, start: "2028-03-31", end: "2028-04-02" });
  values.due = "2028-02-29";
  values.interval = 12;
  assert.equal(applyTaskRecurrence(workspace, command(workspace)).workspace.databaseItems[0].values.due, "2029-02-28");
});

test("invalid dates, config, stale settings and nonpositive intervals report a reason without a partial write", () => {
  for (const edit of [
    w => { w.databaseItems[0].values.interval = 0; }, w => { w.databaseItems[0].values.interval = 1.5; },
    w => { w.databaseItems[0].values.due = "2026-02-30"; }, w => { w.databaseItems[0].values.due = "9999-12-31"; },
    w => { w.databaseItems[0].values.due = { start: "2026-11-27", end: "2026-11-26" }; },
    w => { w.dataSources[0].properties[1].config.recurrence.unit = "hours"; },
    w => { w.dataSources[0].properties[1].config.recurrence.completeOptionId = "removed"; },
    w => { w.dataSources[0].properties[1].config.recurrence.resetOptionId = "done"; },
    w => { w.dataSources[0].properties = w.dataSources[0].properties.filter(entry => entry.id !== "interval"); },
    w => { w.dataSources[0].locked = true; }, w => { w.pages[0].settings.locked = true; },
    w => { w.pages[1].settings.locked = true; }, w => { w.pages[1].trashedAt = now; },
  ]) {
    const workspace = recurrenceWorkspace();
    edit(workspace);
    const result = applyTaskRecurrence(workspace, command(workspace));
    assert.equal(result.workspace, workspace);
    assert.ok(result.handled && result.reason);
  }
  const workspace = recurrenceWorkspace();
  const request = command(workspace);
  workspace.dataSources[0].properties[1].config.recurrence = null;
  assert.match(applyTaskRecurrence(workspace, request).reason, /已更改/);
});
