import test from "node:test";
import assert from "node:assert/strict";
import { migrateAssetProvider } from "../src/persistence/migrations.js";
import { migrateStatusGroups } from "../src/domain/statusGroups.js";
import { groupViewItems } from "../src/domain/database.js";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";

function fixture() {
  const workspace = migrateAssetProvider(fullWorkspace());
  const status = workspace.dataSources[0].properties.find((property) => property.type === "status");
  status.options = [
    { id: "done", name: "已延期", color: "gray" },
    { id: "finished", name: "进行已完成", color: "green" },
    { id: "doing", name: "处理中", color: "blue" },
    { id: "active", name: "正在进行", color: "blue" },
    { id: "later", name: "已延期", color: "red" },
    { id: "explicit", name: "已完成", color: "gray", group: "inProgress", extra: { retained: true } },
    { id: "invalid", name: "已完成", group: "invalid" },
    { id: "empty", name: "其他", group: "" },
  ];
  workspace.extra = { untouched: [1, 2, 3] };
  return workspace;
}

test("v13 assigns groups by id and name", () => {
  const input = fixture();
  const original = structuredClone(input);
  const result = migrateStatusGroups(input);
  assert.equal(result.schemaVersion, 13);
  assert.deepEqual(result.dataSources[0].properties.find((property) => property.type === "status").options.map((option) => option.group), ["complete", "complete", "inProgress", "inProgress", "todo", "inProgress", "complete", "todo"]);
  assert.deepEqual(input, original);
  assert.notEqual(result, input);
});

test("v13 touches only status options", () => {
  const input = fixture();
  input.dataSources[0].properties.find((property) => property.type === "title").options = [{ id: "done", name: "完成", extra: "keep" }];
  const expected = structuredClone(input);
  const result = migrateStatusGroups(input);
  result.schemaVersion = expected.schemaVersion;
  for (let sourceIndex = 0; sourceIndex < result.dataSources.length; sourceIndex += 1) {
    for (let propertyIndex = 0; propertyIndex < result.dataSources[sourceIndex].properties.length; propertyIndex += 1) {
      if (result.dataSources[sourceIndex].properties[propertyIndex].type === "status") result.dataSources[sourceIndex].properties[propertyIndex].options = expected.dataSources[sourceIndex].properties[propertyIndex].options;
    }
  }
  assert.deepEqual(result, expected);
});

test("v13 is idempotent", () => {
  const first = migrateStatusGroups(fixture());
  assert.deepEqual(migrateStatusGroups(first), first);
  assert.equal(migrateStatusGroups({ schemaVersion: 16, extra: "future" }).schemaVersion, 16);
});

test("board columns follow status groups", () => {
  const workspace = migrateStatusGroups(migrateAssetProvider(fullWorkspace()));
  const status = workspace.dataSources[0].properties.find((property) => property.id === "status");
  status.options = [
    { id: "complete-b", group: "complete", name: "完成 B" },
    { id: "progress-b", group: "inProgress", name: "进行 B" },
    { id: "todo-b", group: "todo", name: "待办 B" },
    { id: "todo-a", group: "todo", name: "待办 A" },
    { id: "progress-a", group: "inProgress", name: "进行 A" },
    { id: "complete-a", group: "complete", name: "完成 A" },
  ];
  workspace.databaseItems.find((item) => item.id === "i-1").values.status = "complete-a";
  workspace.databaseItems.find((item) => item.id === "i-2").values.status = null;
  const view = workspace.databaseViews.find((entry) => entry.id === "v-inline-board");
  assert.deepEqual(groupViewItems(workspace, view).map((group) => group.key), ["todo-b", "todo-a", "progress-b", "progress-a", "complete-b", "complete-a", "未分组"]);
  view.grouping.order = ["complete-a", "未分组", "todo-a"];
  assert.deepEqual(groupViewItems(workspace, view).slice(0, 3).map((group) => group.key), ["complete-a", "未分组", "todo-a"]);
});
