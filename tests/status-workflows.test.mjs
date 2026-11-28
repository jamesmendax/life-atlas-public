import assert from "node:assert/strict";
import test from "node:test";
import { applyStatusChange, captureStatusChange } from "../src/domain/statusWorkflows.js";
import { updateTableItemsProperty } from "../src/domain/tableRecordActions.js";
import { updatePropertyDefinition } from "../src/domain/propertyChanges.js";

const now = "2026-11-27T10:00:00.000Z";
const due = { start: "2026-11-27", end: null, includeTime: false, timeZone: null };
const recurrence = { datePropertyId: "due", intervalPropertyId: "interval", unit: "days", completeOptionId: "done", resetOptionId: "todo" };
function fixture(repeat = false) {
  const title = { id: "title", type: "title", name: "名称" };
  const status = {
    id: "stage", type: "status", name: "阶段",
    options: [{ id: "todo", name: "待办", group: "todo" }, { id: "done", name: "成交", group: "complete" }],
    config: {
      statusAction: {
        optionId: "done",
        action: { type: "createRecord", targetSourceId: "projects", targetRelationPropertyId: "lead", title: "项目 · {title}" },
      },
      ...(repeat ? { recurrence } : {}),
    },
  };
  const leads = {
    id: "leads", title: "线索", ownerPageId: "leads-page",
    properties: [title, status, { id: "due", name: "截止", type: "date" }, { id: "interval", name: "间隔", type: "number" },
      { id: "projects", name: "项目", type: "relation", config: { targetSourceId: "projects" } }],
  };
  const projects = { id: "projects", title: "项目", ownerPageId: "projects-page",
    properties: [title, { id: "lead", name: "来源线索", type: "relation", config: { targetSourceId: "leads" } }],
  };
  const item = { id: "lead", sourceId: "leads", pageId: "record", values: { title: "客户演示", stage: "todo", due, interval: repeat ? 7 : null } };
  const workspace = {
    dataSources: [leads, projects], databaseItems: [item], databaseTemplates: [],
    pages: ["leads-page", "projects-page", "record"].map((id, sortIndex) => ({ id, folderId: "folder", sortIndex, settings: {}, content: [] })),
    relations: [
      { sourceId: "leads", propertyId: "projects", targetSourceId: "projects", reciprocalPropertyId: "lead" },
      { sourceId: "projects", propertyId: "lead", targetSourceId: "leads", reciprocalPropertyId: "projects" },
    ],
  };
  return { workspace, command: captureStatusChange(leads, item, status, "done", "completed-workflow", now) };
}

test("entering a configured stage creates one linked record and a replay creates none", () => {
  const { workspace, command } = fixture();
  const outcome = applyStatusChange(workspace, command);
  assert.equal(outcome.newRecord.values.title, "项目 · 客户演示");
  assert.deepEqual(outcome.newRecord.values.lead, ["lead"]);
  assert.equal(outcome.workspace.databaseItems[0].values.stage, "done");
  assert.deepEqual(outcome.workspace.databaseItems[0].values.projects, [outcome.newRecord.id]);
  assert.equal(applyStatusChange(outcome.workspace, command).workspace, outcome.workspace);
  assert.equal(workspace.databaseItems[0].values.stage, "todo");
});

test("a target failure rolls back both status advancement and recurrence", () => {
  const { workspace, command } = fixture(true);
  workspace.pages.find(page => page.id === "projects-page").settings.locked = true;
  const outcome = applyStatusChange(workspace, command);
  assert.match(outcome.reason, /锁定/);
  assert.equal(outcome.workspace, workspace);
  assert.equal(workspace.databaseItems[0].values.due.start, "2026-11-27");
  assert.equal(workspace.databaseItems[0].recurrenceReceipts, undefined);
});

test("recurrence can coexist with a status action without replaying either half", () => {
  const { workspace, command } = fixture(true);
  const outcome = applyStatusChange(workspace, command);
  const item = outcome.workspace.databaseItems[0];
  assert.equal(item.values.stage, "todo");
  assert.equal(item.values.due.start, "2026-12-04");
  assert.equal(item.recurrenceReceipts.length, 1);
  assert.equal(outcome.workspace.databaseItems.length, 2);
  assert.equal(applyStatusChange(outcome.workspace, command).workspace, outcome.workspace);
});

test("native batch status edits go through the same transition rule", () => {
  const { workspace } = fixture();
  const args = { sourceId: "leads", itemIds: ["lead"], propertyId: "stage", value: "done", now: Date.parse(now) };
  const next = updateTableItemsProperty(workspace, args);
  assert.equal(next.databaseItems[0].values.stage, "done");
  assert.equal(next.databaseItems.length, 2);
  assert.equal(updateTableItemsProperty(next, args), next);
});

test("explicitly assigning an effective workflow status saves it without firing the action or recurrence", () => {
  for (const value of ["done", null]) {
    const { workspace } = fixture(true);
    const [source] = workspace.dataSources;
    const status = source.properties[1];
    const [item] = workspace.databaseItems;
    delete item.values.stage;
    status.config.defaultOptionId = value;
    const command = captureStatusChange(source, item, status, value, "assign-default", now);
    const single = applyStatusChange(workspace, command);
    assert.equal(single.reason, undefined);
    const batch = updateTableItemsProperty(workspace, { sourceId: source.id, itemIds: [item.id], propertyId: status.id, value, now: Date.parse(now) });
    for (const result of [single.workspace, batch]) {
      assert.equal(result.databaseItems.length, 1);
      assert.deepEqual(result.databaseItems[0].values, { ...item.values, stage: value });
      assert.equal(result.databaseItems[0].recurrenceReceipts, undefined);
      assert.equal(applyStatusChange(result, command).workspace, result);
    }
  }
});

test("a workflow rule change cannot write through a locked database page", () => {
  const { workspace } = fixture();
  workspace.pages.find(page => page.id === "leads-page").settings.locked = true;
  const changed = updatePropertyDefinition(workspace, {
    sourceId: "leads", propertyId: "stage", definition: { config: { statusAction: null } }, now,
  });
  assert.equal(changed, workspace);
});

test("status-triggered updates run once alongside recurrence without running the target's own status action", () => {
  const { workspace } = fixture(true);
  const [leads, projects] = workspace.dataSources;
  const lead = workspace.databaseItems[0], status = leads.properties[1];
  const action = { type: "updateRecord", targetSourceId: projects.id, sourceRelationPropertyId: "projects", values: { stage: "done" } };
  projects.properties.push(structuredClone(status));
  status.config.statusAction.action = action;
  workspace.pages.push({ id: "project-page", folderId: "folder", settings: {}, content: [] });
  workspace.databaseItems.push({ id: "existing", sourceId: projects.id, pageId: "project-page", values: { stage: "todo" } });
  lead.values.projects = ["existing"];
  const command = captureStatusChange(leads, lead, status, "done", "update-transition", now);
  const result = applyStatusChange(workspace, command);
  assert.equal(result.reason, undefined);
  assert.deepEqual(result.updatedItemIds, ["existing"]);
  assert.equal(result.newRecord, undefined);
  assert.equal(result.workspace.databaseItems.length, 2);
  assert.equal(result.workspace.databaseItems[0].values.stage, "todo");
  assert.equal(result.workspace.databaseItems[0].values.due.start, "2026-12-04");
  assert.equal(result.workspace.databaseItems[1].values.stage, "done");
  const saved = JSON.parse(JSON.stringify(result.workspace));
  saved.databaseItems[1].values.stage = "todo";
  assert.equal(applyStatusChange(saved, command).workspace, saved);
  assert.equal(saved.databaseItems[1].values.stage, "todo");
  const locked = structuredClone(workspace);
  locked.databaseItems[1].locked = true;
  const failed = applyStatusChange(locked, command);
  assert.equal(failed.workspace, locked);
  assert.match(failed.reason, /锁定/);
  assert.equal(locked.databaseItems[0].recurrenceReceipts, undefined);
});

test("replaying an old status command after the trigger row returned to its original status does not advance it", () => {
  const { workspace } = fixture();
  const source = workspace.dataSources[0], item = workspace.databaseItems[0], status = source.properties[1];
  status.config.statusAction.action = { type: "updateRecord", targetSourceId: source.id, values: { interval: "11" } };
  const command = captureStatusChange(source, item, status, "done", "update-self", now);
  const first = applyStatusChange(workspace, command);
  assert.equal(first.workspace.databaseItems[0].values.interval, 11);
  const later = JSON.parse(JSON.stringify(first.workspace));
  later.databaseItems[0].values.stage = "todo";
  later.databaseItems[0].values.interval = 19;
  assert.equal(applyStatusChange(later, command).workspace, later);
  assert.deepEqual([later.databaseItems[0].values.stage, later.databaseItems[0].values.interval], ["todo", 19]);
});
