import assert from "node:assert/strict";
import test from "node:test";
import { createProperty, resolvePropertyValue } from "../src/domain/database.js";
import { createPageBundle, duplicatePageIndependently, importPageBundle } from "../src/domain/pageBundle.js";
import { updatePropertyDefinition } from "../src/domain/propertyChanges.js";
import { CURRENT_SCHEMA_VERSION, upgradeWorkspace } from "../src/persistence/migrations.js";
import { normalizeLoadedWorkspace } from "../src/persistence/normalize.js";

const field = (id, type, name, config = {}) => ({ id, name, type, config });
const relation = (id, name, targetSourceId) => field(id, "relation", name, { targetSourceId });
const rollup = (id, name, relationPropertyId, targetPropertyId, aggregation = "show") =>
  field(id, "rollup", name, { relationPropertyId, targetPropertyId, aggregation });
const formula = (id, name, expression) => field(id, "formula", name, { expression });
const page = id => ({ id, folderId: "folder", content: [], title: id });
const row = (id, sourceId, values) => ({ id, sourceId, pageId: id, values });
const sourceFor = (workspace, id) => workspace.dataSources.find(source => source.id === id);
const propertyFor = (source, id) => source.properties.find(property => property.id === id);
const result = (workspace, propertyId, source = sourceFor(workspace, "hub")) =>
  resolvePropertyValue(workspace, source, workspace.databaseItems.find(item => item.sourceId === source.id), propertyFor(source, propertyId));

function fixture() {
  const hub = { id: "hub", ownerPageId: "home", properties: [
    relation("projects", "Projects", "projects"),
    rollup("raw", "Raw tasks", "projects", "tasks"),
    rollup("from-formula", "Formula tasks", "projects", "task-pages"),
    rollup("raw-twice", "Double rollup", "projects", "raw-link"),
    formula("distinct", "Distinct units", 'prop("Raw tasks").flat().unique().map(current.prop("Units")).sum()'),
    formula("head", "First unit", 'prop("Formula tasks").flat().at(0).prop("Units")'),
    formula("nested", "Nested raw", 'prop("Double rollup").flat().flat().unique().map(current.prop("Units")).sum()'),
    formula("total", "All derived points", 'prop("Projects").map(current.prop("Tasks")).flat().map(current.prop("Points")).sum()'),
  ] };
  const projects = { id: "projects", ownerPageId: "project-db", properties: [
    relation("tasks", "Tasks", "tasks"),
    formula("task-pages", "Page values", 'prop("Tasks")'),
    rollup("raw-link", "Raw leaf links", "tasks", "self"),
  ] };
  const tasks = { id: "tasks", ownerPageId: "task-db", properties: [
    field("title", "title", "Name"), field("units", "number", "Units"),
    formula("points", "Points", 'prop("Units") * 2'), relation("self", "Self", "tasks"),
  ] };
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION, folders: [{ id: "folder" }], relations: [],
    pages: ["home", "project-db", "task-db", "hub-row", "a", "b", "s", "t"].map(page),
    dataSources: [hub, projects, tasks], databaseItems: [
      row("hub-row", "hub", { projects: ["a", "b"] }),
      row("a", "projects", { tasks: ["s", "t"] }), row("b", "projects", { tasks: ["s"] }),
      row("s", "tasks", { title: "Same name", units: 10, self: ["s"] }),
      row("t", "tasks", { title: "Same name", units: 30, self: ["t"] }),
    ],
  };
}

test("raw rollup values stay plain in tables and retain page identity through formula, nested rollup and list chains", () => {
  const workspace = fixture();
  assert.deepEqual(result(workspace, "raw"), [["s", "t"], ["s"]]);
  assert.equal(result(workspace, "head"), 10);
  assert.equal(result(workspace, "nested"), 40);
  assert.equal(result(workspace, "distinct"), 40);
  workspace.pages.find(entry => entry.id === "t").trashedAt = "2026-11-26";
  assert.equal(result(workspace, "distinct"), 10);
});

test("legacy show_original rollups normalize to Show original on load, import, and update", () => {
  const old = fixture();
  const field = propertyFor(sourceFor(old, "hub"), "raw");
  field.config.aggregation = "show_original";
  assert.equal(createProperty(field).config.aggregation, "show");
  const update = updatePropertyDefinition(old, { sourceId: "hub", propertyId: field.id, definition: { name: field.name } });
  const upgraded = upgradeWorkspace(old);
  const loaded = normalizeLoadedWorkspace(JSON.parse(JSON.stringify(old)), { idFactory: prefix => prefix });
  assert.equal(upgraded.schemaVersion, old.schemaVersion);
  assert.equal(loaded.schemaVersion, old.schemaVersion);
  assert.equal(propertyFor(sourceFor(loaded, "hub"), "raw").config.aggregation, "show");
  assert.equal(field.config.aggregation, "show_original");
  assert.equal(result(upgraded, "distinct"), 40);
  assert.equal(result(loaded, "distinct"), 40);
  assert.equal(result(update, "distinct"), 40);

  const bundle = createPageBundle(old.pages[0], old);
  const imported = importPageBundle({ ...old, pages: [...old.pages, page("import")] }, bundle, "import").workspace;
  const importedSource = imported.dataSources.find(source => source.ownerPageId === "import");
  assert.equal(importedSource.properties.find(property => property.name === field.name).config.aggregation, "show");
  const formula = importedSource.properties.find(property => property.name === "Distinct units");
  assert.equal(result(imported, formula.id, importedSource), 40);
});

test("field rename bindings follow rollup and collection results and remap on independent copy and JSON import", () => {
  const workspace = updatePropertyDefinition(fixture(), { sourceId: "tasks", propertyId: "units", definition: { name: "Points input" } });
  const hub = sourceFor(workspace, "hub");
  for (const [id, expected] of [["distinct", 40], ["head", 10], ["nested", 40]]) {
    assert.match(propertyFor(hub, id).config.expression, /"Units", "tasks", "units"/);
    assert.equal(result(workspace, id), expected);
  }

  const duplicated = duplicatePageIndependently(workspace, "home", { id: "copy" }).workspace;
  const cloned = duplicated.dataSources.find(source => source.ownerPageId === "copy");
  assert.equal(result(duplicated, "distinct", cloned), 40);
  const bundle = JSON.parse(JSON.stringify(createPageBundle(duplicated.pages.find(entry => entry.id === "copy"), duplicated)));
  const imported = importPageBundle({ ...duplicated, pages: [...duplicated.pages, page("incoming")] }, bundle, "incoming").workspace;
  const reopened = JSON.parse(JSON.stringify(imported));
  const incoming = reopened.dataSources.find(source => source.ownerPageId === "incoming");
  assert.equal(result(reopened, "distinct", incoming), 40);
  assert.equal(result(reopened, "head", incoming), 10);
  assert.equal(result(reopened, "nested", incoming), 40);
  assert.doesNotMatch(propertyFor(incoming, "distinct").config.expression, /"Units", "tasks", "units"/);
});

test("memoized cross-project reads are reused within a calculation and recomputed after data changes", () => {
  const workspace = fixture();
  const shared = workspace.databaseItems.find(item => item.id === "s");
  let reads = 0;
  let amount = 10;
  Object.defineProperty(shared.values, "units", { get: () => { reads++; return amount; } });
  assert.equal(result(workspace, "total"), 100);
  assert.equal(reads, 1);
  amount = 18;
  assert.equal(result(workspace, "total"), 132);
  assert.equal(reads, 2);
  workspace.databaseItems.find(item => item.id === "hub-row").values.projects = ["a"];
  assert.equal(result(workspace, "total"), 96);
  assert.equal(reads, 3);

  const points = propertyFor(sourceFor(workspace, "tasks"), "points");
  points.config.expression = 'prop("Points")';
  assert.equal(result(workspace, "total").error.code, "CYCLE");
  const hub = sourceFor(workspace, "hub");
  assert.equal(resolvePropertyValue(workspace, hub, workspace.databaseItems[0], propertyFor(hub, "distinct"), undefined, { maxSteps: 5 }).error.code, "EVAL");
});

test("schema 18 formula markers are removed on upgrade, independent copy and page bundle import", () => {
  const old = { ...fixture(), schemaVersion: 18 };
  const hub = sourceFor(old, "hub");
  const list = "concat([1,2],[3,4]).length()";
  hub.properties.push(
    field("old-concat", "formula", "Old concat", { expression: list, formulaSemantics: "legacy", numberFormat: { format: "number", decimals: 2 } }),
    field("old-slice", "formula", "Old slice", { expression: "slice([1,2,3],1,2)", formulaSemantics: "current" }),
    formula("old-label", "Old label", 'concat("A", slice("BCD",1,2))'),
  );
  const workspace = upgradeWorkspace(old);
  const migrated = sourceFor(workspace, "hub");
  assert.equal(workspace.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(old.schemaVersion, 18);
  assert.equal(propertyFor(hub, "old-concat").config.formulaSemantics, "legacy");
  assert.deepEqual(propertyFor(migrated, "old-concat").config, { expression: list, numberFormat: { format: "number", decimals: 2 } });
  assert.deepEqual(propertyFor(migrated, "old-slice").config, { expression: "slice([1,2,3],1,2)" });
  assert.equal(propertyFor(migrated, "old-label").config.formulaSemantics, undefined);
  assert.equal(result(workspace, "old-concat"), 4);
  assert.deepEqual(result(workspace, "old-slice"), [2]);
  assert.equal(result(workspace, "old-label"), "AC");
  assert.deepEqual(upgradeWorkspace(workspace), workspace);

  const restoredOld = importPageBundle({ ...workspace, pages: [...workspace.pages, page("old-json")] },
    JSON.parse(JSON.stringify(createPageBundle(old.pages[0], old))), "old-json").workspace;
  const restored = restoredOld.dataSources.find(source => source.ownerPageId === "old-json");
  assert.equal(result(restoredOld, "old-concat", restored), 4);
  assert.equal(propertyFor(restored, "old-concat").config.formulaSemantics, undefined);
  const duplicated = duplicatePageIndependently(restoredOld, "home", { id: "new-copy" }).workspace;
  const clone = duplicated.dataSources.find(source => source.ownerPageId === "new-copy");
  assert.equal(result(duplicated, "old-concat", clone), 4);
  assert.deepEqual(result(duplicated, "old-slice", clone), [2]);
});
