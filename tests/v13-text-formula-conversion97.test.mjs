import test from "node:test";
import assert from "node:assert/strict";
import * as propertyChanges from "../src/domain/propertyChanges.js";
import { createDatabaseView, createProperty, resolvePropertyValue } from "../src/domain/database.js";
import { coreParityWorkspace } from "./fixtures/core-parity-workspace.mjs";

const SOURCE_ID = "projects";
const PROPERTY_ID = "notes";
const CONVERTED_AT = "2026-11-13T04:34:56.789Z";
const CONFIGURED_AT = "2026-11-13T04:35:56.789Z";
const ARTICLE_EXPRESSION = 'if(prop("状态") == "Published" and not empty(prop("发布日期")) and dateBetween(now(), prop("发布日期"), "days") <= 21, "SHOW", "HIDE")';

const sourceFor = (workspace) => workspace.dataSources.find((source) => source.id === SOURCE_ID);
const propertyFor = (workspace) => sourceFor(workspace).properties.find((property) => property.id === PROPERTY_ID);
const noNewId = () => assert.fail("an in-place conversion must not allocate an ID");

function freezeTree(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeTree(child);
  return Object.freeze(value);
}

function fixture() {
  const workspace = coreParityWorkspace();
  const source = sourceFor(workspace);
  Object.assign(propertyFor(workspace), {
    name: "首页近期",
    config: { expression: '"OLD-CODE97"', numberFormat: { format: "number", decimals: 2 }, custom: { label: "keep97" } },
  });
  Object.assign(source.properties.find((property) => property.id === "status"), {
    type: "select",
    options: [{ id: "published97", name: "Published", color: "green" }, { id: "archived97", name: "Archived", color: "brown" }],
  });
  source.properties.find((property) => property.id === "date").name = "发布日期";
  for (const [index, item] of workspace.databaseItems.filter((item) => item.sourceId === SOURCE_ID).entries()) {
    item.values[PROPERTY_ID] = ["HIDE", "SHOW", 'prop("金额") + 97'][index];
    item.values.status = index === 1 ? "archived97" : "published97";
    item.values.date = index === 2 ? null : { start: "2026-11-12", end: null, includeTime: false, timeZone: null };
  }
  const view = workspace.databaseViews.find((entry) => entry.id === "view-table");
  Object.assign(view, {
    filter: { kind: "group", op: "and", children: [{ kind: "condition", propertyId: PROPERTY_ID, operator: "equals", value: "SHOW" }] },
    sorts: [{ propertyId: PROPERTY_ID, direction: "asc" }],
    config: { table: { columnWidths: { notes: 237, amount: 160 }, wrapPropertyIds: [PROPERTY_ID], calculations: { notes: "earliest", amount: "sum" } } },
  });
  workspace.databaseViews.find((entry) => entry.id === "view-list").config.table = { calculations: { notes: "count_all" } };
  const partner = workspace.dataSources.find((entry) => entry.id === "partners");
  partner.properties.push(createProperty({ id: PROPERTY_ID, name: "其他源文本", type: "text", config: { expression: "other97" } }));
  workspace.databaseItems.find((item) => item.sourceId === "partners").values[PROPERTY_ID] = "keep other source97";
  workspace.databaseViews.push(createDatabaseView({
    id: "partner-view97", sourceId: "partners", type: "table", visiblePropertyIds: [PROPERTY_ID],
    sorts: [{ propertyId: PROPERTY_ID, direction: "desc" }],
    config: { table: { calculations: { notes: "earliest" }, columnWidths: { notes: 211 } } },
  }));
  workspace.pageVersions = [{ id: "version97", pageId: "alpha-page", snapshot: { title: "旧标题97", content: [{ id: "old-body97", type: "paragraph", content: "保留历史97" }] } }];
  workspace.comments = [{ id: "comment97", pageId: "alpha-page", text: "保留评论97" }];
  return workspace;
}

const convert = (workspace, nextType = "formula", extra = {}) => propertyChanges.convertPropertyType(workspace, {
  sourceId: SOURCE_ID, propertyId: PROPERTY_ID, nextType, now: CONVERTED_AT, idFactory: noNewId, ...extra,
});

test("text becomes formula in place while preserving workspace identities and references", () => {
  const workspace = freezeTree(fixture());
  const before = structuredClone(workspace);
  const converted = convert(workspace);
  const expected = structuredClone(before);
  const source = sourceFor(expected);
  source.updatedAt = CONVERTED_AT;
  Object.assign(propertyFor(expected), { type: "formula", options: [] });
  propertyFor(expected).config.expression = "";
  for (const item of expected.databaseItems.filter((entry) => entry.sourceId === SOURCE_ID)) {
    item.values[PROPERTY_ID] = null;
    item.updatedAt = CONVERTED_AT;
  }
  delete expected.databaseViews.find((view) => view.id === "view-table").config.table.calculations.notes;
  assert.deepEqual(converted, expected);
  assert.deepEqual(workspace, before);
  assert.strictEqual(converted.pages, workspace.pages);
  assert.strictEqual(converted.attachments, workspace.attachments);
  assert.strictEqual(converted.pageVersions, workspace.pageVersions);
  assert.strictEqual(converted.databaseItems.at(-1), workspace.databaseItems.at(-1));
  assert.strictEqual(converted.dataSources.find((entry) => entry.id === "partners"), workspace.dataSources.find((entry) => entry.id === "partners"));
});

test("conversion targets preserve the ten legacy types and add formula only for text", () => {
  const legacy = ["text", "number", "select", "multi_select", "status", "date", "checkbox", "url", "email", "phone"];
  assert.deepEqual(propertyChanges.CONVERTIBLE_TYPES, legacy);
  assert.deepEqual(propertyChanges.propertyTypeConversionTargets("text"), ["number", "select", "multi_select", "status", "date", "checkbox", "url", "email", "phone", "formula"]);
  for (const type of legacy.slice(1)) {
    assert.deepEqual(propertyChanges.propertyTypeConversionTargets(type), legacy.filter((candidate) => candidate !== type));
  }
  for (const type of ["title", "formula", "rollup", "people", "files", "place", "id", "unique_id", "created_time", "modified_time", "created_by", "last_edited_by", "unknown97", "", null, undefined]) {
    assert.deepEqual(propertyChanges.propertyTypeConversionTargets(type), [], String(type));
  }
});

test("all legacy cross-type conversions and supported same-type no-ops remain available", () => {
  const legacy = ["text", "number", "select", "multi_select", "status", "date", "checkbox", "url", "email", "phone"];
  for (const from of legacy) {
    const workspace = fixture();
    propertyFor(workspace).type = from;
    for (const item of workspace.databaseItems.filter((entry) => entry.sourceId === SOURCE_ID)) item.values[PROPERTY_ID] = null;
    const before = structuredClone(workspace);
    freezeTree(workspace);
    for (const to of legacy) {
      const converted = convert(workspace, to);
      if (from === to) assert.strictEqual(converted, workspace, from);
      else {
        assert.equal(propertyFor(converted).type, to, `${from} -> ${to}`);
        assert.equal(propertyFor(converted).id, PROPERTY_ID);
        assert.equal(sourceFor(converted).id, SOURCE_ID);
      }
    }
    assert.deepEqual(workspace, before);
  }
});

test("title guards and previously unsupported conversions retain their errors", () => {
  const workspace = freezeTree(fixture());
  assert.throws(() => convert(workspace, "formula", { propertyId: "title" }), /名称属性不能更改类型或删除/);
  assert.throws(() => convert(workspace, "title"), /名称属性不能更改类型或删除/);
  for (const propertyId of ["amount", "status", "date", "checked", "labels", "url", "email", "phone", "formula", "people", "files", "place", "relation", "rollup"]) {
    assert.throws(() => convert(workspace, "formula", { propertyId }), /这种属性不能更改类型/, propertyId);
  }
  for (const nextType of ["people", "files", "rollup", "unknown97", undefined]) {
    assert.throws(() => convert(workspace, nextType, { nextType }), /这种属性不能更改类型/, String(nextType));
  }
  assert.throws(() => convert(workspace, "people", { propertyId: "people" }), /这种属性不能更改类型/);
  assert.throws(() => convert(workspace, "formula", { propertyId: "formula" }), /这种属性不能更改类型/);
});

test("missing sources or properties remain unchanged before type validation", () => {
  const workspace = freezeTree(fixture());
  assert.strictEqual(convert(workspace, "formula", { sourceId: "missing97" }), workspace);
  assert.strictEqual(convert(workspace, "title", { propertyId: "missing97" }), workspace);
});

test("empty text follows existing null and timestamp semantics without storing code", () => {
  for (const raw of [null, undefined, "", "HIDE", 'prop("金额") + 97']) {
    const workspace = fixture();
    const item = workspace.databaseItems.find((entry) => entry.id === "alpha");
    if (raw === undefined) delete item.values[PROPERTY_ID];
    else item.values[PROPERTY_ID] = raw;
    propertyFor(workspace).config = { custom: { label: "keep without expression97" } };
    const before = structuredClone(workspace);
    freezeTree(workspace);
    const converted = convert(workspace);
    const nextItem = converted.databaseItems.find((entry) => entry.id === "alpha");
    assert.deepEqual(propertyFor(converted).config, { custom: { label: "keep without expression97" }, expression: "" });
    if (raw == null) {
      assert.strictEqual(nextItem, item);
      assert.equal(Object.hasOwn(nextItem.values, PROPERTY_ID), raw !== undefined);
      assert.equal(nextItem.updatedAt, item.updatedAt);
    } else {
      assert.equal(nextItem.values[PROPERTY_ID], null);
      assert.equal(nextItem.updatedAt, CONVERTED_AT);
    }
    assert.deepEqual(workspace, before);
  }
});

test("two conversions from the same input reuse every identity without allocating IDs", () => {
  const workspace = freezeTree(fixture());
  const first = convert(workspace);
  const second = convert(workspace);
  assert.deepEqual(second, first);
  assert.equal(propertyFor(first).id, propertyFor(workspace).id);
  assert.equal(propertyFor(second).name, "首页近期");
  assert.deepEqual(first.databaseViews, second.databaseViews);
  assert.deepEqual(first.databaseItems.map((item) => [item.id, item.pageId]), workspace.databaseItems.map((item) => [item.id, item.pageId]));
});

test("configuring the original article expression evaluates labels through the same property", (t) => {
  const workspace = fixture();
  sourceFor(workspace).properties.find((property) => property.id === "formula").config.expression = 'concat("result97:", prop("首页近期"))';
  const before = structuredClone(workspace);
  freezeTree(workspace);
  const converted = freezeTree(convert(workspace));
  const configured = propertyChanges.updatePropertyDefinition(converted, {
    sourceId: SOURCE_ID, propertyId: PROPERTY_ID,
    definition: { config: { expression: ARTICLE_EXPRESSION } }, now: CONFIGURED_AT,
  });
  const property = propertyFor(configured);
  assert.equal(property.id, PROPERTY_ID);
  assert.equal(property.type, "formula");
  assert.equal(property.config.expression, ARTICLE_EXPRESSION);
  assert.deepEqual(property.config.custom, { label: "keep97" });
  assert.deepEqual(property.config.numberFormat, { format: "number", decimals: 2 });
  assert.equal(sourceFor(configured).updatedAt, CONFIGURED_AT);
  assert.strictEqual(configured.databaseItems, converted.databaseItems);
  assert.strictEqual(configured.databaseViews, converted.databaseViews);
  assert.strictEqual(configured.pages, converted.pages);
  assert.strictEqual(configured.attachments, converted.attachments);
  assert.strictEqual(configured.pageVersions, converted.pageVersions);
  t.mock.method(Date, "now", () => Date.parse(CONVERTED_AT));
  const source = sourceFor(configured);
  const items = ["alpha", "beta", "gamma"].map((id) => configured.databaseItems.find((item) => item.id === id));
  assert.deepEqual(items.map((item) => resolvePropertyValue(configured, source, item, property)), ["SHOW", "HIDE", "HIDE"]);
  assert.deepEqual(items.map((item) => item.values.status), ["published97", "archived97", "published97"]);
  assert.deepEqual(items.map((item) => item.values[PROPERTY_ID]), [null, null, null]);
  assert.equal(resolvePropertyValue(configured, source, items[0], source.properties.find((entry) => entry.id === "formula")), "result97:SHOW");
  assert.deepEqual(workspace, before);
});
