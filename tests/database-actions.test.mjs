import test from "node:test";
import assert from "node:assert/strict";
import { executeDatabaseAction, databaseActionConfigIssue } from "../src/domain/databaseActions.js";
import { duplicatePageIndependently } from "../src/domain/pageBundle.js";
import { CURRENT_SCHEMA_VERSION } from "../src/persistence/migrations.js";

const property = (id, type, config = {}) => ({ id, name: id, type, config });
const page = (id, title = id) => ({ id, title, folderId: "folder", content: [] });
const base = { type: "createRecord", targetSourceId: "expenses", title: "费用 · {title}", targetRelationPropertyId: "vendor" };
const request = { sourceItemId: "air", operationId: "operation-1", action: base };
const row = (ws, id) => ws.databaseItems.find(item => item.id === id);
function workspace() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION, folders: [{ id: "folder" }], ui: {},
    pages: [page("vendors-page"), page("expenses-page"), page("air-page", "SkyAir Airlines")],
    dataSources: [
      { id: "vendors", title: "供应商", ownerPageId: "vendors-page", properties: [property("title", "title"), property("expenses", "relation"), property("add", "button", { action: base })] },
      { id: "expenses", title: "费用", ownerPageId: "expenses-page", properties: [property("title", "title"), property("vendor", "relation"), property("vendor2", "relation"), property("amount", "number"), property("receipt", "unique_id", { nextNumber: 7 })] },
    ],
    databaseItems: [{ id: "air", sourceId: "vendors", pageId: "air-page", values: { title: "SkyAir Airlines", expenses: [] } }],
    relations: [
      { id: "vendor-expenses", sourceId: "vendors", targetSourceId: "expenses", propertyId: "expenses", reciprocalPropertyId: "vendor" },
      { id: "expense-vendor", sourceId: "expenses", targetSourceId: "vendors", propertyId: "vendor", reciprocalPropertyId: "expenses" },
      { id: "expense-vendor2", sourceId: "expenses", targetSourceId: "vendors", propertyId: "vendor2" },
    ],
    databaseTemplates: [{ id: "receipt-template", name: "发票", sourceId: "expenses", defaultValues: { amount: 20, receipt: 1 }, pageContent: [{ id: "template-block", type: "paragraph", content: "核对凭据" }] }],
  };
}

test("row action creates a templated expense, allocates its ID, and replays one saved operation", () => {
  const ws = workspace(), action = { ...base, templateId: "receipt-template", values: { amount: "42.5" } };
  assert.equal(databaseActionConfigIssue(ws, ws.dataSources[0], action), null);
  const created = executeDatabaseAction(ws, { ...request, action });
  assert.equal(created.workspace.pages.length, ws.pages.length + 1);
  assert.deepEqual(created.item.values, { title: "费用 · SkyAir Airlines", amount: 42.5, receipt: 7, vendor: ["air"] });
  assert.equal(created.page.content[0].content, "核对凭据");
  assert.notEqual(created.page.content[0].id, "template-block");
  assert.deepEqual(row(created.workspace, "air").values.expenses, [created.item.id]);
  assert.deepEqual(row(ws, "air").values.expenses, []);
  const saved = JSON.parse(JSON.stringify(created.workspace));
  const replay = executeDatabaseAction(saved, { ...request, action });
  assert.equal(replay.replayed, true);
  assert.equal(replay.workspace, saved);
  assert.equal(replay.item.id, created.item.id);
  assert.equal(executeDatabaseAction(saved, { ...request, action, operationId: "second-click" }).workspace.databaseItems.length, 3);
});

test("refuses invalid or locked writes without publishing pages, counters, or reciprocal changes", () => {
  for (const [mutate, patch] of [
    [ws => { ws.pages[0].settings = { locked: true }; }, {}],
    [ws => { ws.pages[1].settings = { locked: true }; }, {}],
    [ws => { ws.pages[2].settings = { locked: true }; }, {}],
    [ws => { ws.dataSources[1].locked = true; }, {}],
    [ws => { ws.dataSources[0].properties[1].config.relationLimit = 1; row(ws, "air").values.expenses = ["prior"]; }, {}],
    [() => {}, { values: { vendor: ["air"], vendor2: ["missing"] }, targetRelationPropertyId: "" }],
    [() => {}, { values: { amount: "NaN" } }],
    [() => {}, { templateId: "missing" }],
  ]) {
    const ws = workspace();
    mutate(ws);
    const frozen = JSON.stringify(ws);
    assert.throws(() => executeDatabaseAction(ws, { ...request, action: { ...base, ...patch } }));
    assert.equal(JSON.stringify(ws), frozen);
  }
});

test("a status action copies the triggering record's related client only when source IDs agree", () => {
  const ws = workspace();
  ws.dataSources.push({ id: "leads", properties: [property("client", "relation", { targetSourceId: "vendors" })] });
  ws.pages.push(page("lead-page", "签约"));
  ws.databaseItems.push({ id: "lead", sourceId: "leads", pageId: "lead-page", values: { client: ["air"] } });
  const action = { ...base, sourceRelationPropertyId: "client" };
  const created = executeDatabaseAction(ws, { ...request, action, sourceItemId: "lead" });
  assert.deepEqual(created.item.values.vendor, ["air"]);
  assert.deepEqual(row(created.workspace, "air").values.expenses, [created.item.id]);
  row(ws, "lead").values.client = [];
  assert.throws(() => executeDatabaseAction(ws, { ...request, action, sourceItemId: "lead" }), /为空/);
  ws.dataSources.at(-1).properties[0].config.targetSourceId = "leads";
  assert.ok(databaseActionConfigIssue(ws, ws.dataSources.at(-1), action));
});

test("page duplication follows and independently rewrites button and status destination, template and typed values", () => {
  const ws = workspace();
  ws.relations = [];
  const action = { ...base, targetRelationPropertyId: "", templateId: "receipt-template", values: { vendor2: ["air"] } };
  ws.dataSources[0].properties = [property("title", "title"), property("add", "button", { action }), property("stage", "status", { statusAction: { optionId: "won", action } })];
  ws.dataSources[1].properties.find(p => p.id === "vendor2").config.targetSourceId = "vendors";
  row(ws, "air").actionReceipt = { operationId: "original-action" };
  row(ws, "air").recurrenceReceipts = [{ operationId: "original-recurrence" }];
  const { workspace: copied } = duplicatePageIndependently(ws, "vendors-page", { id: "duplicate" });
  const vendorCopy = copied.dataSources.find(source => source.ownerPageId === "duplicate");
  const localAction = vendorCopy.properties.find(p => p.type === "button").config.action;
  assert.notEqual(localAction.targetSourceId, "expenses");
  assert.notEqual(localAction.templateId, "receipt-template");
  assert.deepEqual(vendorCopy.properties.find(p => p.type === "status").config.statusAction, { optionId: "won", action: localAction });
  const localRow = copied.databaseItems.find(item => item.sourceId === vendorCopy.id);
  assert.equal(localRow.actionReceipt, undefined);
  assert.equal(localRow.recurrenceReceipts, undefined);
  assert.equal(row(copied, "air").recurrenceReceipts[0].operationId, "original-recurrence");
  assert.deepEqual(localAction.values.vendor2, [localRow.id]);
  const result = executeDatabaseAction(copied, { ...request, sourceItemId: localRow.id, action: localAction });
  assert.equal(result.item.sourceId, localAction.targetSourceId);
  assert.deepEqual(result.item.values.vendor2, [localRow.id]);
  assert.equal(result.workspace.databaseItems.filter(item => item.sourceId === "expenses").length, 0);
});

const update = { type: "updateRecord", targetSourceId: "expenses", sourceRelationPropertyId: "expenses", values: { amount: "21.75", title: "已核对" } };

function withExpenses() {
  const first = executeDatabaseAction(workspace(), request);
  const second = executeDatabaseAction(first.workspace, { ...request, operationId: "second" });
  return { ws: second.workspace, ids: [first.item.id, second.item.id] };
}

test("current-record action updates typed properties, page title and before-edit history; later edits survive replay", () => {
  const ws = workspace(), source = ws.dataSources[0];
  source.properties.push(property("done", "checkbox"), property("due", "date"), property("tags", "multi_select"));
  source.properties.at(-1).options = [{ id: "tag" }];
  const action = { type: "updateRecord", targetSourceId: "vendors", values: { title: "新名称", done: true, due: "2026-12-01", tags: ["tag"] } };
  const command = { ...request, action };
  assert.equal(databaseActionConfigIssue(ws, source, action), null);
  const edited = executeDatabaseAction(ws, command);
  assert.deepEqual(edited.updatedItemIds, ["air"]);
  assert.deepEqual(edited.item.values, { ...row(ws, "air").values, ...action.values, due: { start: "2026-12-01", end: null, timeZone: null, includeTime: false } });
  assert.equal(edited.page.title, "新名称");
  assert.equal(edited.workspace.pageVersions[0].title, "SkyAir Airlines");
  assert.equal(edited.workspace.pageVersions[0].reason, "before-edit");
  const saved = JSON.parse(JSON.stringify(edited.workspace));
  row(saved, "air").values.done = false;
  const retry = executeDatabaseAction(saved, command);
  assert.equal(retry.workspace, saved);
  assert.equal(retry.item.values.done, false);
  assert.equal(retry.replayed, true);
  assert.equal(row(ws, "air").values.done, undefined);
});

test("editing all explicitly related records captures the original targets once across retries", () => {
  const { ws, ids } = withExpenses();
  const command = { ...request, operationId: "edit-many", action: update };
  const edited = executeDatabaseAction(ws, command);
  assert.deepEqual(edited.updatedItemIds, ids);
  assert.equal(edited.workspace.databaseItems.length, ws.databaseItems.length);
  for (const id of ids) {
    const item = row(edited.workspace, id);
    assert.equal(item.values.amount, 21.75);
    assert.equal(item.values.title, "已核对");
    assert.equal(edited.workspace.pages.find(page => page.id === item.pageId).title, "已核对");
  }
  const saved = JSON.parse(JSON.stringify(edited.workspace));
  row(saved, "air").values.expenses = [];
  row(saved, ids[0]).values.amount = 99;
  const retry = executeDatabaseAction(saved, command);
  assert.equal(retry.workspace, saved);
  assert.equal(retry.replayed, true);
  assert.deepEqual(retry.updatedItemIds, ids);
  assert.equal(row(saved, ids[0]).values.amount, 99);
  assert.throws(() => executeDatabaseAction(saved, { ...command, action: { ...base } }), /另一个动作/);
});

test("a stale link, locked target, invalid typed field or protected reciprocal fails the entire update", () => {
  for (const mutate of [
    (ws, ids) => { row(ws, ids[1]).locked = true; },
    (ws, ids) => { ws.pages.find(page => page.id === row(ws, ids[1]).pageId).settings.locked = true; },
    ws => { row(ws, "air").values.expenses.push("missing"); },
    ws => { row(ws, "air").values.expenses.push("air"); },
    ws => { row(ws, "air").values.expenses.push({ id: "invalid" }); },
    ws => { ws.dataSources[0].properties = ws.dataSources[0].properties.filter(entry => entry.id !== "expenses"); },
    (ws, ids, action) => { action.values = { receipt: 10 }; },
    (ws, ids, action) => { action.values.amount = "invalid"; },
    (ws, ids, action) => { action.values.vendor = ["missing"]; },
    (ws, ids, action) => {
      // The second row points to a second vendor whose reverse field cannot be cleared.
      ws.pages.push(page("locked-page"));
      ws.databaseItems.push({ id: "locked", sourceId: "vendors", pageId: "locked-page", locked: true, values: { expenses: [ids[1]] } });
      row(ws, ids[1]).values.vendor.push("locked");
      action.values.vendor = [];
    },
  ]) {
    const { ws, ids } = withExpenses(), action = structuredClone(update);
    mutate(ws, ids, action);
    const snapshot = structuredClone(ws);
    assert.throws(() => executeDatabaseAction(ws, { ...request, operationId: "edit-many", action }));
    assert.deepEqual(ws, snapshot);
  }
});

test("related-record action replaces or clears an existing reciprocal link on every selected row", () => {
  const { ws, ids } = withExpenses();
  const action = { ...update, values: { vendor: [] } };
  const outcome = executeDatabaseAction(ws, { ...request, action, operationId: "unlink-all" });
  for (const id of ids) assert.deepEqual(row(outcome.workspace, id).values.vendor, []);
  assert.deepEqual(row(outcome.workspace, "air").values.expenses, []);
  assert.deepEqual(row(ws, "air").values.expenses, ids);
});
