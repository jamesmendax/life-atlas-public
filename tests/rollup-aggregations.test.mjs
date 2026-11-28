import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createProperty, resolveFormulaPropertyValue, resolvePropertyValue } from "../src/domain/database.js";
import { formatPropertyValue } from "../src/domain/databaseProperties.js";
import { resolveDisplayPropertyValue, resolveTypedPropertyValue, rollupAtoms } from "../src/domain/databasePropertyValues.js";
import { rollupAggregationOptions } from "../src/domain/rollupConfiguration.js";
import { FormulaPage, FormulaPerson } from "../src/domain/formula/values.js";
import { migrateStatusGroups } from "../src/domain/statusGroups.js";
import { renderFormulaResult } from "../src/components/formulaResult.js";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";

function fixture() {
  const workspace = migrateStatusGroups(fullWorkspace());
  const source = workspace.dataSources.find((entry) => entry.id === "ds-full");
  const item = workspace.databaseItems.find((entry) => entry.id === "i-3");
  const rollup = (aggregation, targetPropertyId) => createProperty({ id: `rollup-${aggregation}`, name: aggregation, type: "rollup", config: { relationPropertyId: "rel-back", targetPropertyId, aggregation } });
  const resolve = (property) => resolvePropertyValue(workspace, source, item, property);
  return { workspace, source, item, rollup, resolve };
}

test("percent_checked counts true checkboxes", () => {
  const { workspace, rollup, resolve } = fixture();
  const property = rollup("percent_checked", "done");
  assert.equal(resolve(property), 0.5);
  assert.equal(formatPropertyValue(workspace, property, resolve(property)), "50%");
  workspace.databaseItems.find((item) => item.id === "i-2").values.done = "true";
  assert.equal(resolve(property), 0.5);
});

test("checkbox counts and percentages treat omitted related checkboxes as unchecked", () => {
  const { workspace, item, rollup, resolve } = fixture();
  delete workspace.databaseItems.find(entry => entry.id === "i-2").values.done;
  const results = [
    ["checked", 1, 0],
    ["unchecked", 1, 0],
    ["percent_checked", 0.5, null],
    ["percent_unchecked", 0.5, null],
  ];
  for (const [aggregation, populated] of results) assert.equal(resolve(rollup(aggregation, "done")), populated);
  item.values["rel-back"] = ["i-2"];
  assert.equal(resolve(rollup("checked", "done")), 0);
  assert.equal(resolve(rollup("unchecked", "done")), 1);
  item.values["rel-back"] = [];
  for (const [aggregation, , empty] of results) assert.equal(resolve(rollup(aggregation, "done")), empty);
});

test("formulas read a missing checkbox as false in the same row and through a relation", () => {
  const { workspace, source, item, rollup, resolve } = fixture();
  const target = workspace.dataSources.find(entry => entry.id === "ds-inline");
  const related = workspace.databaseItems.find(entry => entry.id === "i-2");
  delete related.values.done;
  const flag = target.properties.find(entry => entry.id === "done");
  const number = createProperty({ id: "number", type: "formula", config: { expression: "toNumber({{done}})" } });
  const computedFlag = createProperty({ id: "computed-flag", type: "formula", config: { expression: "{{done}} == true" } });
  target.properties.push(number, computedFlag);
  assert.equal(Object.hasOwn(related.values, flag.id), false);
  assert.equal(resolvePropertyValue(workspace, target, related, flag), false);
  assert.equal(resolveFormulaPropertyValue(workspace, target, related, flag), false);
  assert.equal(resolvePropertyValue(workspace, target, related, number), 0);
  assert.equal(resolve(rollup("checked", computedFlag.id)), 1);

  const formula = createProperty({ id: "done-count", type: "formula", config: {
    expression: 'prop("任务").map(toNumber(current.prop("完成"))).sum()',
  } });
  assert.equal(resolvePropertyValue(workspace, source, item, formula), 1);
  item.values["rel-back"] = ["i-2"];
  assert.equal(resolve(rollup("checked", computedFlag.id)), 0);
});

test("rollups ignore duplicate, foreign, missing, and trashed records", () => {
  const { workspace, item, rollup, resolve } = fixture();
  const foreign = workspace.databaseItems.find(entry => entry.id === "i-4");
  foreign.values.done = true;
  workspace.pages.find(page => page.id === "p-rec-2").trashedAt = "2026-11-01T00:00:00Z";
  item.values["rel-back"] = ["i-1", "i-2", "i-4", "missing", "i-1"];
  assert.equal(resolve(rollup("count", "title")), 1);
  assert.equal(resolve(rollup("checked", "done")), 1);
  assert.equal(resolve(rollup("unchecked", "done")), 0);
  assert.equal(resolve(rollup("percent_checked", "done")), 1);

  workspace.pages = workspace.pages.filter(page => page.id !== "p-rec-1");
  assert.equal(resolve(rollup("checked", "done")), 1);
});

test("percent_complete uses the complete group", () => {
  const { workspace, rollup, resolve } = fixture();
  const target = workspace.dataSources[0].properties.find((property) => property.id === "status");
  target.options.push({ id: "cancelled", name: "已取消", group: "complete" }, { id: "custom-done", name: "完成", group: "todo" });
  const property = rollup("percent_complete", "status");
  assert.equal(resolve(property), 0.5);
  workspace.databaseItems.find((item) => item.id === "i-2").values.status = "cancelled";
  assert.equal(resolve(property), 1);
  workspace.databaseItems.find((item) => item.id === "i-2").values.status = "custom-done";
  assert.equal(resolve(property), 0.5);
});

test("count_unique ignores empty values", () => {
  const { workspace, item, rollup, resolve } = fixture();
  const property = rollup("count_unique", "status");
  assert.equal(resolve(property), 2);
  workspace.dataSources[0].properties.find((entry) => entry.id === "status").options.find((option) => option.id === "doing").name = "已完成";
  assert.equal(resolve(property), 1);
  workspace.databaseItems.find((entry) => entry.id === "i-2").values.status = null;
  item.values["rel-back"].push("missing");
  assert.equal(resolve(property), 1);
});

test("date_range spans the earliest start and latest end", () => {
  const { workspace, rollup, resolve } = fixture();
  workspace.databaseItems.find((item) => item.id === "i-1").values.due = { start: "2026-10-05", end: "2026-10-08", includeTime: false, timeZone: null };
  workspace.databaseItems.find((item) => item.id === "i-2").values.due = { start: "2026-10-01", end: "2026-10-06", includeTime: false, timeZone: null };
  const property = rollup("date_range", "due");
  assert.deepEqual(resolve(property), { start: "2026-10-01", end: "2026-10-08", includeTime: false, timeZone: null });
  assert.equal(formatPropertyValue(workspace, property, resolve(property)), "2026-10-01 → 2026-10-08");
  workspace.databaseItems.find((item) => item.id === "i-2").values.due = "2026-10-10";
  assert.equal(resolve(property).end, "2026-10-10");
});

test("earliest and latest date rollups return scalar boundaries for downstream formulas", () => {
  const { workspace, source, item, rollup, resolve } = fixture();
  const [first, second] = workspace.databaseItems;
  first.values.due = { start: "2026-10-05", end: "2026-10-18", includeTime: false, timeZone: null };
  second.values.due = { start: "2026-10-01", end: "2026-10-06", includeTime: false, timeZone: null };
  const earliest = rollup("earliest_date", "due");
  const latest = rollup("latest_date", "due");
  source.properties.push(earliest, latest);
  assert.deepEqual(resolve(earliest), { start: "2026-10-01", end: null, includeTime: false, timeZone: null });
  assert.deepEqual(resolve(latest), { start: "2026-10-18", end: null, includeTime: false, timeZone: null });
  const next = createProperty({ id: "next-date", type: "formula", config: { expression: 'dateAdd({{rollup-latest_date}}, 1, "days")' } });
  assert.equal(resolvePropertyValue(workspace, source, item, next).start, "2026-10-19");
  item.values["rel-back"] = [];
  assert.equal(resolve(earliest), null);
  assert.equal(resolve(latest), null);
});

test("timed date rollups compare instants and preserve the chosen endpoint and time zone", () => {
  const { workspace, rollup, resolve } = fixture();
  const [first, second] = workspace.databaseItems;
  first.values.due = { start: "2026-10-01T11:00", end: "2026-10-01T13:00", includeTime: true, timeZone: "Asia/Shanghai" };
  second.values.due = { start: "2026-10-01T06:00", end: "2026-10-01T07:00", includeTime: true, timeZone: "UTC" };
  assert.deepEqual(resolve(rollup("earliest_date", "due")), { start: "2026-10-01T11:00", end: null, includeTime: true, timeZone: "Asia/Shanghai" });
  assert.deepEqual(resolve(rollup("latest_date", "due")), { start: "2026-10-01T07:00", end: null, includeTime: true, timeZone: "UTC" });
  second.values.due = "unparseable";
  assert.equal(resolve(rollup("latest_date", "due")).start, "2026-10-01T13:00");
  first.values.due = null;
  assert.equal(resolve(rollup("earliest_date", "due")), null);
});

test("empty relations give null and blank display", () => {
  const { workspace, item, rollup, resolve } = fixture();
  item.values["rel-back"] = [];
  for (const [aggregation, target] of [["percent_checked", "done"], ["percent_complete", "status"], ["date_range", "due"]]) {
    const property = rollup(aggregation, target);
    assert.equal(resolve(property), null, aggregation);
    assert.equal(formatPropertyValue(workspace, property, resolve(property)), "", aggregation);
  }
  assert.equal(resolve(rollup("count_unique", "status")), 0);
  item.values["rel-back"] = ["i-2"];
  assert.equal(resolve(rollup("date_range", "due")), null);
  assert.equal(resolve(rollup("percent_complete", "status")), 0);
});

test("records in trash are ignored", () => {
  const { workspace, rollup, resolve } = fixture();
  const property = rollup("percent_complete", "status");
  assert.equal(resolve(property), 0.5);
  workspace.pages.find((page) => page.id === "p-rec-2").trashedAt = "2026-11-01T00:00:00.000Z";
  assert.equal(resolve(property), 1);
  workspace.pages.find((page) => page.id === "p-rec-1").trashedAt = "2026-11-01T00:00:00.000Z";
  assert.equal(resolve(property), null);
});

test("show original preserves stored choice IDs while formulas read active labels and omit empty cells", () => {
  const { workspace, source, item, rollup, resolve } = fixture();
  const target = workspace.dataSources[0];
  target.properties.push(
    { id: "visibility", type: "select", options: [{ id: "iMoo", name: "🌐 Public" }] },
    { id: "channels", type: "multi_select", options: [{ id: "x", name: "Mobile" }, { id: "y", name: "Desktop" }] },
  );
  const linked = id => workspace.databaseItems.find(entry => entry.id === id);
  linked("i-1").values.visibility = "iMoo";
  linked("i-1").values.channels = ["x", "y"];
  linked("i-2").values.channels = [];

  for (const [targetId, raw, typed, labels] of [
    ["visibility", ["iMoo"], ["🌐 Public"], "🌐 Public"],
    ["status", ["done", "doing"], ["已完成", "进行中"], "已完成, 进行中"],
    ["channels", [["x", "y"]], [["Mobile", "Desktop"]], "Mobile, Desktop"],
  ]) {
    const field = { ...rollup("show", targetId), id: targetId + "-original", name: targetId + " original" };
    source.properties.push(field);
    assert.deepEqual(resolve(field), raw);
    assert.deepEqual(resolveFormulaPropertyValue(workspace, source, item, field, undefined, true), typed);
    const last = createProperty({ id: targetId + "-last", type: "formula", config: { expression: `last(prop("${field.name}"))` } });
    assert.deepEqual(resolve(last), typed.at(-1));
    assert.equal(formatPropertyValue(workspace, field, raw), labels);
    const display = resolveDisplayPropertyValue(workspace, source, item, field);
    assert.equal(renderToStaticMarkup(renderFormulaResult(workspace, field, display, source)).replace(/<[^>]+>/g, ""), labels);
  }
  const visibility = source.properties.find(field => field.id === "visibility-original");
  item.values["rel-back"] = [];
  assert.deepEqual(resolve(visibility), []);
  assert.equal(renderFormulaResult(workspace, visibility, resolve(visibility)), "");
});

test("date lists keep readable dates and ranges in rollup cells", () => {
  const { workspace, source, item, rollup } = fixture();
  const [first, second] = workspace.databaseItems;
  first.values.due = { start: "2026-10-03T09:15", end: "2026-10-04T10:30", includeTime: true, timeZone: "Asia/Shanghai" };
  second.values.due = "2026-10-12";

  for (const aggregation of ["show", "show_unique"]) {
    const property = rollup(aggregation, "due");
    const displayed = resolveDisplayPropertyValue(workspace, source, item, property);
    const label = "2026-10-03 09:15 → 2026-10-04 10:30 (Asia/Shanghai), 2026-10-12";
    assert.equal(formatPropertyValue(workspace, property, displayed, { source }), label);
    assert.equal(renderFormulaResult(workspace, property, displayed, source), label);
  }
});

test("show unique deduplicates choice values before passing their labels to formulas", () => {
  const { workspace, source, item, rollup, resolve } = fixture();
  const target = workspace.dataSources[0];
  target.properties.push(createProperty({ id: "reading", type: "select", options: [
    { id: "previous", name: "current" }, { id: "current", name: "Finished" },
  ] }));
  workspace.databaseItems.find(entry => entry.id === "i-1").values.reading = "previous";
  workspace.databaseItems.find(entry => entry.id === "i-2").values.reading = "current";
  const field = rollup("show_unique", "reading");
  source.properties.push(field);

  assert.deepEqual(resolve(field), ["previous", "current"]);
  assert.deepEqual(resolveFormulaPropertyValue(workspace, source, item, field, undefined, true), ["current", "Finished"]);
});

test("formula property inputs resolve labels, metadata timestamps and typed people without changing raw values", () => {
  const { workspace, source, item } = fixture();
  const target = workspace.dataSources.find(entry => entry.id === "ds-inline");
  const task = workspace.databaseItems.find(entry => entry.id === "i-1");
  const tags = createProperty({ id: "tags-inputs", type: "multi_select", name: "Tags", options: [{ id: "finance-tag", name: "Finance" }] });
  const code = createProperty({ id: "code-inputs", type: "unique_id", name: "Numbered task", config: { prefix: "TASK" } });
  const created = createProperty({ id: "created-inputs", type: "created_time", name: "Created" });
  const modified = createProperty({ id: "modified-inputs", type: "modified_time", name: "Modified" });
  const people = createProperty({ id: "people-inputs", type: "people", name: "People" });
  const creator = createProperty({ id: "creator-inputs", type: "created_by", name: "Creator" });
  const editor = createProperty({ id: "editor-inputs", type: "last_edited_by", name: "Editor" });
  target.properties.push(tags, code, created, modified, people, creator, editor);
  task.createdAt = "2026-11-01T02:43:27.123Z";
  task.updatedAt = "2026-11-01T02:43:27.987-05:00";
  Object.assign(task.values, { [tags.id]: ["finance-tag", "deleted"], [code.id]: 8, [people.id]: ["linda", "missing", "no-email"] });
  Object.assign(workspace, { people: [
    { id: "person-local", displayName: "Local author" },
    { id: "linda", displayName: "Linda", email: "linda@example.test" },
    { id: "no-email", displayName: "No email", email: "invalid\nemail@example.test" },
  ] });
  const evaluate = (database, row, expression) => resolvePropertyValue(workspace, database, row, createProperty({
    id: "typed-check", type: "formula", config: { expression },
  }));
  const relation = source.properties.find(field => field.id === "rel-back").name;
  assert.equal(evaluate(target, task, 'prop("Tags").includes("Finance")'), true);
  assert.equal(evaluate(source, item, `prop(${JSON.stringify(relation)}).first().prop("Tags").includes("Finance")`), true);
  assert.equal(evaluate(target, task, 'prop("Numbered task").split("-").first()'), "TASK");
  assert.equal(evaluate(target, task, 'toNumber(prop("Created"))'), Date.parse(task.createdAt));
  assert.equal(evaluate(target, task, 'toNumber(prop("Modified"))'), Date.parse(task.updatedAt));
  const members = resolveTypedPropertyValue(workspace, target, task, people);
  assert.ok(members.every(person => person instanceof FormulaPerson));
  assert.deepEqual(members.map(person => [person.id, person.displayName, person.email]), [
    ["linda", "Linda", "linda@example.test"], ["no-email", "No email", null],
  ]);
  for (const author of [creator, editor]) {
    const value = resolveTypedPropertyValue(workspace, target, task, author);
    assert.ok(value instanceof FormulaPerson);
    assert.deepEqual([value.id, value.displayName, value.email], ["person-local", "Local author", null]);
  }
  const pages = resolveTypedPropertyValue(workspace, source, item, source.properties.find(field => field.id === "rel-back"));
  assert.ok(pages[0] instanceof FormulaPage);
  assert.equal(pages[0].id, task.id);
  assert.equal(pages[0].pageId, task.pageId);
  assert.deepEqual(resolvePropertyValue(workspace, target, task, tags), ["finance-tag"]);
  assert.equal(resolvePropertyValue(workspace, target, task, code), 8);
  assert.equal(resolvePropertyValue(workspace, target, task, created), task.createdAt);
  assert.deepEqual(task.values[tags.id], ["finance-tag", "deleted"]);
  assert.deepEqual(task.values[people.id], ["linda", "missing", "no-email"]);
});

test("typed Rollup display and filtering share active labels while plain values retain option IDs", () => {
  const { workspace, source, item, rollup, resolve } = fixture();
  const target = workspace.dataSources.find(entry => entry.id === "ds-inline");
  target.properties.push(createProperty({ id: "rollup-label-tags", type: "multi_select", options: [
    { id: "finance-id", name: "Finance" }, { id: "automation-id", name: "Automation" },
  ] }));
  workspace.databaseItems.find(entry => entry.id === "i-1").values["rollup-label-tags"] = ["finance-id", "automation-id", "removed"];
  workspace.databaseItems.find(entry => entry.id === "i-2").values["rollup-label-tags"] = ["finance-id"];
  const original = rollup("show", "rollup-label-tags");
  const unique = rollup("show_unique", "rollup-label-tags");
  assert.deepEqual(resolve(original), [["finance-id", "automation-id"], ["finance-id"]]);
  assert.deepEqual(resolve(unique), ["finance-id", "automation-id"]);
  assert.deepEqual(resolveDisplayPropertyValue(workspace, source, item, original), [["Finance", "Automation"], ["Finance"]]);
  assert.deepEqual(rollupAtoms(resolveTypedPropertyValue(workspace, source, item, original)), ["Finance", "Automation", "Finance"]);
  assert.deepEqual(resolveDisplayPropertyValue(workspace, source, item, unique), ["Finance", "Automation"]);
  assert.deepEqual(rollupAtoms([[null, []], [0], false, ""]), [0, false]);
});

test("numeric rollups support median and range and reject incompatible computed values", () => {
  const { workspace, rollup, resolve } = fixture();
  const target = workspace.dataSources.find(entry => entry.id === "ds-inline");
  const response = createProperty({ id: "response", type: "formula", name: "Response", config: { expression: 'if({{done}}, 2, 8)' } });
  target.properties.push(response);
  const options = rollupAggregationOptions(response);
  assert.ok(options.median);
  assert.ok(options.range);
  assert.equal(resolve(rollup("median", response.id)), 5);
  assert.equal(resolve(rollup("range", response.id)), 6);
  response.config.expression = 'if({{done}}, 2, "8")';
  for (const [operation, expected] of [["sum", "数字"], ["median", "数字"], ["range", "数字"], ["checked", "复选框"], ["earliest_date", "日期"]]) {
    const error = resolve(rollup(operation, response.id)).error;
    assert.equal(error.code, "TYPE");
    assert.ok(error.message.includes("Response") && error.message.includes(expected));
  }
  response.config.expression = 'prop("Not present")';
  assert.equal(resolve(rollup("sum", response.id)).error.code, "REF");
});

test("date ranges retain the complete selected instants through downstream formulas", () => {
  const { workspace, source, item, rollup, resolve } = fixture();
  const [first, second] = workspace.databaseItems;
  first.values.due = { start: "2026-10-01T11:00", end: "2026-10-01T13:00", includeTime: true, timeZone: "Asia/Shanghai" };
  second.values.due = { start: "2026-10-01T06:00", end: "2026-10-01T07:00", includeTime: true, timeZone: "UTC" };
  const range = rollup("date_range", "due");
  source.properties.push(range);
  assert.deepEqual(resolve(range), { start: "2026-10-01T03:00:00.000Z", end: "2026-10-01T07:00:00.000Z", includeTime: true, timeZone: null });
  for (const [functionName, iso] of [["dateStart", "2026-10-01T03:00Z"], ["dateEnd", "2026-10-01T07:00Z"]]) {
    const formula = createProperty({ id: functionName, type: "formula", config: { expression: `toNumber(${functionName}(prop("date_range")))` } });
    assert.equal(resolvePropertyValue(workspace, source, item, formula), Date.parse(iso));
  }
  second.values.due.timeZone = "Asia/Shanghai";
  assert.deepEqual(resolve(range), { start: "2026-10-01T06:00", end: "2026-10-01T13:00", includeTime: true, timeZone: "Asia/Shanghai" });
});
