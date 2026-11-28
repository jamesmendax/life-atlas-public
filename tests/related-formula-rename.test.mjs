import assert from "node:assert/strict";
import test from "node:test";
import { resolvePropertyValue } from "../src/domain/database.js";
import { remapFormulaSources } from "../src/domain/formula/relatedPropertyReferences.js";
import { createPageBundle, duplicatePageIndependently, importPageBundle } from "../src/domain/pageBundle.js";
import { updatePropertyDefinition } from "../src/domain/propertyChanges.js";
import { CURRENT_SCHEMA_VERSION } from "../src/persistence/migrations.js";

const count = 'prop("任务").filter(current.prop("状态") == "已完成").length()';
const field = (id, type, name, config = {}) => ({ id, type, name, config });
const formula = (id, expression) => field(id, "formula", id, { expression });
const link = (id, name, targetSourceId) => field(id, "relation", name, { targetSourceId });
const db = (ws, id) => ws.dataSources.find(source => source.id === id);
const prop = (source, id) => source.properties.find(field => field.id === id);
const rename = (ws, id, name) => updatePropertyDefinition(ws, { sourceId: "tasks", propertyId: id, definition: { name }, now: "2026-11-26T12:00:00Z" });
const page = id => ({ id, folderId: "folder", content: [], title: id });
function fixture() {
  const projects = { id: "projects", ownerPageId: "home", properties: [
    link("tasks", "任务", "tasks"), link("other", "其他", "other"),
    formula("count", count), formula("taskAlias", 'prop("任务")'),
    formula("viaAlias", 'let(t, prop("taskAlias").first(), t.prop("状态"))'),
    formula("mixed", 'let(t, if({{choose}}, {{tasks}}, {{other}}), t.first().prop("状态"))'),
    field("choose", "checkbox", "choose"),
    formula("scoped", 'lets(o, {{other}}.first(), t, {{tasks}}.first(), [t.prop("状态"), o.prop("状态"), "状态"])'),
    formula("otherOnly", 'prop("其他").first().prop("状态")'),
    formula("chain", 'prop("任务").first().prop("上级任务").first().prop("状态")'),
  ] };
  const tasks = { id: "tasks", ownerPageId: "tasks-home", properties: [
    { ...field("stage", "status", "状态"), options: [{ id: "done", name: "已完成" }] },
    field("otherStage", "text", "阶段"), link("parent", "上级任务", "tasks"),
  ] };
  const other = { id: "other", ownerPageId: "other-home", properties: [field("stage", "text", "状态")] };
  return { schemaVersion: CURRENT_SCHEMA_VERSION, folders: [{ id: "folder" }], relations: [],
    pages: ["home", "tasks-home", "other-home", "p", "t", "q"].map(page), dataSources: [projects, tasks, other],
    databaseItems: [
      { id: "p", pageId: "p", sourceId: "projects", values: { tasks: ["t"], other: ["q"], choose: true } },
      { id: "t", pageId: "t", sourceId: "tasks", values: { stage: "done", otherStage: "待确认", parent: ["t"] } },
      { id: "q", pageId: "q", sourceId: "other", values: { stage: "另一库状态" } },
    ] };
}
function read(ws, id, choose = true, source = db(ws, "projects")) {
  const item = ws.databaseItems.find(row => row.sourceId === source.id);
  return resolvePropertyValue(ws, source, { ...item, values: { ...item.values, choose } }, prop(source, id));
}

test("an external field rename preserves the original benchmark, lexical receivers, nested and formula-backed relations", () => {
  const ws = fixture();
  const renamed = rename(ws, "stage", "进度");
  assert.equal(read(renamed, "count"), 1);
  assert.equal(read(renamed, "viaAlias"), "已完成");
  assert.equal(read(renamed, "chain"), "已完成");
  assert.deepEqual(read(renamed, "scoped"), ["已完成", "另一库状态", "状态"]);
  assert.equal(read(renamed, "mixed", true), "已完成");
  assert.equal(read(renamed, "mixed", false), "另一库状态");
  assert.equal(prop(db(renamed, "projects"), "otherOnly"), prop(db(ws, "projects"), "otherOnly"));
  assert.equal(prop(db(renamed, "projects"), "scoped").config.expression, 'lets(o, {{other}}.first(), t, {{tasks}}.first(), [t.prop("状态", "tasks", "stage"), o.prop("状态"), "状态"])');
  assert.equal(prop(db(ws, "projects"), "count").config.expression, count);
});

test("related property bindings survive last, findIndex and comments between call tokens", () => {
  const ws = fixture();
  const source = db(ws, "projects");
  source.properties.push(
    formula("lastTask", 'prop("任务").last() . /* receiver */ prop /* method */ ("状态" /* field */ )'),
    formula("firstDone", 'prop("任务").findIndex(current . /* receiver */ prop("状态") == "已完成")'),
  );
  const renamed = rename(ws, "stage", "进度");
  assert.equal(read(renamed, "lastTask"), "已完成");
  assert.equal(read(renamed, "firstDone"), 0);
  assert.equal(prop(db(renamed, "projects"), "lastTask").config.expression,
    'prop("任务").last() . /* receiver */ prop /* method */ ("状态" /* field */ , "tasks", "stage")');

  const bound = '{{tasks}}.last()./* receiver */ prop("状态", "tasks" /* source */, "stage")';
  assert.equal(remapFormulaSources(bound, id => `${id}-copied`), bound.replace('"tasks"', '"tasks-copied"'));
});

test("schema-only rename binds empty relations and survives same-name reuse, edited formulas and displaced destinations", () => {
  const ws = fixture();
  db(ws, "projects").properties.push(formula("both", 'let(t, {{tasks}}.first(), [t.prop("状态"), t.prop("阶段")])'));
  ws.databaseItems[0].values.tasks = [];
  const renamed = rename(ws, "stage", "阶段");
  renamed.databaseItems = structuredClone(ws.databaseItems);
  renamed.databaseItems[0].values.tasks = ["t"];
  assert.deepEqual(read(renamed, "both"), ["已完成", "待确认"]);
  const reused = rename(renamed, "otherStage", "状态");
  const previous = prop(db(reused, "projects"), "both").config.expression;
  const fresh = 'prop("任务").first().prop("状态")';
  const edited = updatePropertyDefinition(reused, { sourceId: "projects", propertyId: "both",
    definition: { config: { expression: `[${previous}, ${fresh}]` } } });
  assert.deepEqual(read(edited, "both"), [["已完成", "待确认"], "待确认"]);
  db(edited, "projects").properties.push(formula("new", fresh));
  assert.equal(read(edited, "new"), "待确认");
  const stripped = structuredClone(edited);
  db(stripped, "tasks").properties = db(stripped, "tasks").properties.filter(p => p.id !== "stage");
  assert.equal(read(stripped, "viaAlias").error.code, "REF");
});

test("bound source IDs remap through page duplication, export and import while field IDs and literal IDs stay local", () => {
  const ws = fixture();
  db(ws, "projects").properties.push(formula("literal", 'let(t, {{tasks}}.first(), [t.prop("状态"), "tasks"])'));
  const renamed = rename(ws, "stage", "进度");
  const duplicate = duplicatePageIndependently(renamed, "home", { id: "duplicate" }).workspace;
  const cloned = duplicate.dataSources.find(source => source.ownerPageId === "duplicate");
  const bundle = JSON.parse(JSON.stringify(createPageBundle(duplicate.pages.find(p => p.id === "duplicate"), duplicate)));
  duplicate.pages.push(page("import"));
  const reopened = JSON.parse(JSON.stringify(importPageBundle(duplicate, bundle, "import").workspace));
  const imported = reopened.dataSources.find(source => source.ownerPageId === "import");
  for (const s of [cloned, imported]) {
    const target = prop(s, "tasks").config.targetSourceId;
    assert.notEqual(target, "tasks");
    assert.ok(prop(s, "count").config.expression.includes(JSON.stringify(target)));
    assert.equal(read(reopened, "count", true, s), 1);
    assert.deepEqual(read(reopened, "literal", true, s), ["已完成", "tasks"]);
    assert.equal(read(reopened, "mixed", false, s), "另一库状态");
  }
  assert.notEqual(prop(cloned, "tasks").config.targetSourceId, prop(imported, "tasks").config.targetSourceId);
});
