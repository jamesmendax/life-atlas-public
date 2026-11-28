import test from "node:test";
import assert from "node:assert/strict";
import { duplicateDatabaseItem } from "../src/domain/database.js";
import { createPageBundle, duplicatePageIndependently, importPageBundle } from "../src/domain/pageBundle.js";
import { applyTaskRecurrence, captureRecurrenceOccurrence } from "../src/domain/taskRecurrence.js";
import { now, recurrenceWorkspace } from "./fixtures/task-recurrence.mjs";

const originalId = "recur-task";
const statusId = "task-status";
const item = (workspace, id) => workspace.databaseItems.find(row => row.id === id);
function complete(workspace, itemId, operationId) {
  const row = item(workspace, itemId);
  const source = workspace.dataSources.find(entry => entry.id === row.sourceId);
  const property = source.properties.find(entry => entry.id === statusId);
  const expectedOccurrence = captureRecurrenceOccurrence(source, row, property);
  const result = applyTaskRecurrence(workspace, { itemId, propertyId: statusId, value: "done", operationId, now, expectedOccurrence });
  assert.equal(result.reason, undefined);
  assert.equal(result.handled, true);
  return result.workspace;
}
function monthlyDue(start, end) {
  return { start, end, includeTime: true, timeZone: "Asia/Shanghai" };
}
const jan = monthlyDue("2027-01-31T21:00+08:00", "2027-02-01T09:15+08:00");
const feb = monthlyDue("2027-02-28T21:00+08:00", "2027-03-01T09:15+08:00");
const mar = monthlyDue("2027-03-31T21:00+08:00", "2027-04-01T09:15+08:00");

function februaryWorkspace() {
  const workspace = recurrenceWorkspace();
  workspace.dataSources[0].properties.find(entry => entry.id === statusId).config.recurrence.unit = "months";
  const row = item(workspace, originalId);
  row.values.interval = 1;
  row.values.due = jan;
  const result = complete(workspace, originalId, "january-original");
  const clamped = item(result, originalId);
  assert.deepEqual(clamped.values.due, feb);
  // 1.5.0 had only the receipt, including in previously exported page JSON.
  delete clamped.recurrenceAnchors;
  clamped.actionUpdateReceipts = [{ operationId: "update-original" }];
  clamped.actionReceipt = { operationId: "create-original" };
  return result;
}

function assertDetached(row) {
  assert.deepEqual(row.recurrenceAnchors, [{ propertyId: statusId, datePropertyId: "due", nextDue: feb, anchorDay: 31 }]);
  assert.equal(row.actionReceipt, undefined);
  assert.equal(row.actionUpdateReceipts, undefined);
  assert.equal(row.recurrenceReceipts, undefined);
}
for (const mode of ["record duplicate", "independent page", "page JSON round-trip", "1.5.0 page JSON import"]) {
  test(mode + " preserves month-end intent while the copy begins its own history", () => {
    const original = februaryWorkspace();
    const snapshot = structuredClone(original);
    const owner = original.pages[0];
    let workspace;
    if (mode === "record duplicate") {
      let sequence = 0;
      workspace = duplicateDatabaseItem(original, { itemId: originalId, now, idFactory: prefix => prefix + "-copy-" + ++sequence });
    } else if (mode === "independent page") {
      workspace = duplicatePageIndependently(original, owner.id, { now }).workspace;
    } else {
      const bundle = createPageBundle(owner, original);
      const selected = bundle.related.databaseItems.find(row => row.id === originalId);
      assertDetached(selected);
      if (mode === "1.5.0 page JSON import") {
        delete selected.recurrenceAnchors;
        selected.recurrenceReceipts = structuredClone(item(original, originalId).recurrenceReceipts);
      }
      const destination = { ...original, pages: [...original.pages, { id: "import-target", folderId: owner.folderId }] };
      workspace = importPageBundle(destination, JSON.parse(JSON.stringify(bundle)), "import-target").workspace;
    }
    assert.deepEqual(original, snapshot);
    const copied = workspace.databaseItems.find(row => row.id !== originalId && row.values["task-title"] === "每周复盘");
    assertDetached(copied);
    const result = complete(workspace, copied.id, "january-original");
    assert.deepEqual(item(result, copied.id).values.due, mar);
    assert.equal(item(result, copied.id).recurrenceReceipts.length, 1);
    assert.equal(item(result, copied.id).recurrenceReceipts[0].itemId, copied.id);
    assert.deepEqual(item(result, originalId), item(original, originalId));
    const both = complete(result, originalId, "february-original");
    assert.deepEqual(item(both, originalId).values.due, mar);
    assert.equal(item(both, originalId).recurrenceReceipts.length, 2);
  });
}

test("a new due date or nonmonthly rule never inherits an old clamped calendar day", () => {
  for (const replacement of ["different date", "different property", "weekly"]) {
    const original = februaryWorkspace();
    const row = item(original, originalId);
    const source = original.dataSources[0];
    const config = source.properties.find(entry => entry.id === statusId).config.recurrence;
    if (replacement === "different date") row.values.due = "2027-02-25";
    if (replacement === "different property") {
      source.properties.push({ id: "new-due", type: "date", name: "新日期" });
      row.values["new-due"] = feb;
      config.datePropertyId = "new-due";
    }
    if (replacement === "weekly") config.unit = "weeks";
    let count = 0;
    const copy = duplicateDatabaseItem(original, { itemId: originalId, now, idFactory: prefix => prefix + "-copy-" + ++count });
    const copied = copy.databaseItems.at(-1);
    assert.equal(copied.recurrenceAnchors, undefined);
    const next = item(complete(copy, copied.id, "fresh"), copied.id);
    const due = next.values[config.datePropertyId];
    assert.equal(typeof due === "string" ? due : due.start.slice(0, 10),
      replacement === "different date" ? "2027-03-25" : replacement === "different property" ? "2027-03-28" : "2027-03-07");
  }
});
