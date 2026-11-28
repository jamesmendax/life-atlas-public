import assert from "node:assert/strict";
import test from "node:test";
import { createDataSource, createDatabaseView, defaultDatabaseItemValues, groupViewItems, projectViewItems, resolveDisplayPropertyValue, resolvePropertyValue } from "../src/domain/database.js";
import { formatPropertyValue } from "../src/domain/databaseProperties.js";
import { convertPropertyType, updatePropertyDefinition } from "../src/domain/propertyChanges.js";
import { updateTableItemsProperty } from "../src/domain/tableRecordActions.js";

function fixture(config = { defaultOptionId: "SpWX" }) {
  const source = createDataSource({ id: "connectors", properties: [
    { id: "status", type: "status", name: "Status", config, options: [
      { id: "SpWX", name: "Backlog", group: "todo" },
      { id: "V>@g", name: "Planned", group: "inProgress" },
    ] },
    { id: "formula", type: "formula", name: "Label", config: { expression: 'prop("Status")' } },
  ] });
  const databaseItems = [
    { id: "omitted", sourceId: source.id, pageId: "p1", values: {} },
    { id: "backlog", sourceId: source.id, pageId: "p2", values: { status: "SpWX" } },
    { id: "planned", sourceId: source.id, pageId: "p3", values: { status: "V>@g" } },
  ];
  return { dataSources: [source], databaseItems, pages: databaseItems.map(item => ({ id: item.pageId })) };
}

test("a configured status default is shared by table rendering, filters, board groups, and formulas", () => {
  const workspace = fixture();
  const [source] = workspace.dataSources;
  const [, status, formula] = source.properties;
  const [omitted] = workspace.databaseItems;
  const board = createDatabaseView({ sourceId: source.id, type: "board", groupBy: status.id });
  const idList = items => items.map(item => item.id);
  const filter = (operator, value) => projectViewItems(workspace, { ...board, filter: { propertyId: status.id, operator, value } });

  assert.deepEqual(groupViewItems(workspace, board).map(group => [group.key, idList(group.items)]), [
    ["SpWX", ["omitted", "backlog"]], ["V>@g", ["planned"]],
  ]);
  assert.deepEqual(idList(filter("equals", "SpWX")), ["omitted", "backlog"]);
  assert.deepEqual(idList(filter("status_group_is", "todo")), ["omitted", "backlog"]);
  assert.deepEqual(filter("is_empty"), []);
  assert.equal(formatPropertyValue(workspace, status, resolveDisplayPropertyValue(workspace, source, omitted, status)), "Backlog");
  assert.equal(resolvePropertyValue(workspace, source, omitted, formula), "Backlog");
  assert.deepEqual(defaultDatabaseItemValues(source), { status: "SpWX" });
  assert.deepEqual(omitted.values, {});

  const cleared = updateTableItemsProperty(workspace, { sourceId: source.id, itemIds: [omitted.id], propertyId: status.id, value: null });
  assert.deepEqual(cleared.databaseItems[0].values, { status: null });
  assert.equal(resolvePropertyValue(cleared, source, cleared.databaseItems[0], status), null);
});

test("status defaults can be changed or removed without assigning values to existing records", () => {
  const workspace = fixture({});
  const [source] = workspace.dataSources;
  const status = source.properties[1];
  const [omitted] = workspace.databaseItems;
  const read = (data, item = omitted) => resolvePropertyValue(data, data.dataSources[0], item, data.dataSources[0].properties[1]);
  const configure = (data, definition) => updatePropertyDefinition(data, { sourceId: source.id, propertyId: status.id, definition });
  assert.equal(read(workspace), null);
  assert.deepEqual(defaultDatabaseItemValues(source), {});

  const configured = configure(workspace, { config: { defaultOptionId: "V>@g" } });
  assert.equal(read(JSON.parse(JSON.stringify(configured))), "V>@g");
  assert.equal(read(configured, workspace.databaseItems[1]), "SpWX");
  assert.deepEqual(defaultDatabaseItemValues(configured.dataSources[0]), { status: "V>@g" });

  const converted = convertPropertyType(configured, { sourceId: source.id, propertyId: status.id, nextType: "select" });
  assert.equal(converted.databaseItems[0].values.status, "V>@g");
  assert.equal(Object.hasOwn(converted.dataSources[0].properties[1].config, "defaultOptionId"), false);
  const deleted = configure(configured, { options: status.options.filter(option => option.id !== "V>@g") });
  assert.equal(deleted.dataSources[0].properties[1].config.defaultOptionId, null);
  assert.equal(read(deleted), null);
});

test("removing a stored status keeps it empty without applying the default", () => {
  const workspace = fixture();
  const [source] = workspace.dataSources;
  const [, status] = source.properties;
  const explicitBlank = { id: "cleared", sourceId: source.id, values: { status: null } };
  workspace.databaseItems.push(explicitBlank);
  const updateOptions = (state, options) => updatePropertyDefinition(state, {
    sourceId: source.id, propertyId: status.id, definition: { options },
  });
  const updated = updateOptions(workspace, status.options.filter(option => option.id !== "V>@g"));
  const [currentSource] = updated.dataSources;
  const [, currentStatus, formula] = currentSource.properties;
  const [omitted, , stale] = updated.databaseItems;
  const filtered = (operator, value) => projectViewItems(updated, {
    sourceId: source.id, filter: { propertyId: status.id, operator, value },
  }).map(item => item.id);

  assert.equal(resolvePropertyValue(updated, currentSource, omitted, currentStatus), "SpWX");
  assert.equal(resolvePropertyValue(updated, currentSource, stale, currentStatus), null);
  assert.equal(resolvePropertyValue(updated, currentSource, stale, formula), null);
  assert.deepEqual(filtered("is_empty"), [stale.id, explicitBlank.id]);
  assert.deepEqual(filtered("equals", "V>@g"), []);
  assert.equal(updated.databaseItems, workspace.databaseItems);
  assert.equal(stale.values.status, "V>@g");

  const restored = updateOptions(updated, status.options);
  const [restoredSource] = restored.dataSources;
  assert.equal(resolvePropertyValue(restored, restoredSource, stale, restoredSource.properties[1]), "V>@g");
});

test("batch assignments of the effective status or a blank survive later default changes", () => {
  for (const [config, value] of [[{ defaultOptionId: "SpWX" }, "SpWX"], [{}, null]]) {
    const workspace = fixture(config);
    const [source] = workspace.dataSources;
    const status = source.properties[1];
    const [omitted] = workspace.databaseItems;
    const args = { sourceId: source.id, itemIds: [omitted.id], propertyId: status.id, value };
    const assigned = updateTableItemsProperty(workspace, args);
    assert.deepEqual(assigned.databaseItems[0].values, { status: value });
    assert.equal(updateTableItemsProperty(assigned, args), assigned);

    const changed = updatePropertyDefinition(assigned, {
      sourceId: source.id, propertyId: status.id, definition: { config: { defaultOptionId: "V>@g" } },
    });
    const [updatedSource] = changed.dataSources;
    assert.equal(resolvePropertyValue(changed, updatedSource, changed.databaseItems[0], updatedSource.properties[1]), value);
  }
});
