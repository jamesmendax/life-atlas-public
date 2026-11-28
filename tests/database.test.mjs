import test from "node:test";
import assert from "node:assert/strict";

import {
  DATABASE_PROPERTY_TYPES,
  DATABASE_VIEW_TYPES,
  childItems,
  createDataSource,
  createDatabaseItem,
  createDatabaseView,
  createLinkedView,
  createProperty,
  createRelation,
  createStarterDatabase,
  groupViewItems,
  itemDisplayTitle,
  projectViewItems,
  resolvePropertyValue,
  updateDatabaseItemValue,
  updateDatabaseView,
} from "../src/domain/database.js";

function workspaceFixture() {
  const source = createDataSource({
    id: "tasks",
    title: "任务",
    properties: [
      createProperty({ id: "title", name: "名称", type: "title" }),
      createProperty({ id: "score", name: "分数", type: "number" }),
      createProperty({ id: "status", name: "状态", type: "status", options: [{ id: "todo", name: "未开始" }, { id: "done", name: "完成" }] }),
      createProperty({ id: "tags", name: "标签", type: "multi_select" }),
      createProperty({ id: "date", name: "日期", type: "date" }),
      createProperty({ id: "checked", name: "完成", type: "checkbox" }),
      createProperty({ id: "double", name: "双倍分数", type: "formula", config: { expression: "{{score}} * 2" } }),
      createProperty({ id: "created", name: "创建时间", type: "created_time" }),
      createProperty({ id: "modified", name: "修改时间", type: "modified_time" }),
      createProperty({ id: "itemid", name: "ID", type: "id" }),
    ],
  });
  const items = [
    createDatabaseItem({ id: "a", sourceId:"tasks", pageId:"page-a", values:{ title:"任务 A", score:5, status:"todo", tags:["study"], date:"2026-09-20", checked:false }, createdAt:"2026-09-01T00:00:00.000Z", updatedAt:"2026-09-02T00:00:00.000Z" }),
    createDatabaseItem({ id: "b", sourceId:"tasks", pageId:"page-b", values:{ title:"任务 B", score:9, status:"done", tags:["study","important"], date:"2026-09-21", checked:true }, createdAt:"2026-09-03T00:00:00.000Z", updatedAt:"2026-09-04T00:00:00.000Z" }),
    createDatabaseItem({ id: "b-child", sourceId:"tasks", pageId:"page-child", parentItemId:"b", values:{ title:"子任务", score:2, status:"todo" } }),
  ];
  return {
    dataSources:[source],
    databaseItems:items,
    databaseViews:[],
    relations:[],
    pages:[
      { id:"page-a", title:"任务 A" },
      { id:"page-b", title:"任务 B" },
      { id:"page-child", title:"子任务" },
    ],
  };
}

test("property and view registries cover the requested local database types", () => {
  for (const type of ["text","number","select","multi_select","status","date","checkbox","relation","rollup","formula","id","created_time","modified_time","people","url","email","phone","files","place"]) {
    assert.ok(DATABASE_PROPERTY_TYPES.includes(type), type);
  }
  assert.deepEqual(DATABASE_VIEW_TYPES, ["table","board","list","gallery","calendar","timeline","chart","form","dashboard","map","roadmap","feed"]);
});

test("DataSource, DatabaseView and Linked View remain separate from data items", () => {
  const workspace = workspaceFixture();
  const table = createDatabaseView({ id:"table-view", sourceId:"tasks", type:"table", name:"表格" });
  const board = createLinkedView("tasks", { id:"board-view", type:"board", name:"看板", groupBy:"status" });
  assert.equal(table.sourceId, board.sourceId);
  assert.equal(board.linked, true);
  assert.equal(workspace.databaseItems.length, 3);
  const switched = updateDatabaseView(table, { type:"gallery" });
  assert.equal(switched.type, "gallery");
  assert.equal(switched.sourceId, "tasks");
  assert.equal(workspace.databaseItems.length, 3);
});

test("filters, sorts and grouping project a view without duplicating source data", () => {
  const workspace = workspaceFixture();
  const view = createDatabaseView({
    sourceId:"tasks",
    type:"board",
    filter:{ propertyId:"score", operator:"greater_than", value:3 },
    sorts:[{ propertyId:"score", direction:"desc" }],
    groupBy:"status",
  });
  const projected = projectViewItems(workspace, view);
  assert.deepEqual(projected.map((item)=>item.id), ["b","a"]);
  const groups = groupViewItems(workspace, view);
  assert.deepEqual(groups.map((group)=>group.key).sort(), ["done","todo"]);
  assert.equal(workspace.databaseItems.length, 3);
});

test("view sorts keep empty keys last and use locale collation for text and relation titles", () => {
  const source = createDataSource({
    id: "sessions",
    properties: [
      createProperty({ id: "title", name: "Name", type: "title" }),
      createProperty({ id: "slot", name: "Time slot", type: "text" }),
      createProperty({ id: "room", name: "Room", type: "relation", config: { targetSourceId: "rooms" } }),
    ],
  });
  const rooms = createDataSource({
    id: "rooms",
    properties: [createProperty({ id: "title", name: "Name", type: "title" })],
  });
  const workspace = {
    dataSources: [source, rooms],
    databaseItems: [
      createDatabaseItem({ id: "room-z", sourceId: rooms.id, pageId: "page-room-z", values: { title: "Room 1" } }),
      createDatabaseItem({ id: "room-a", sourceId: rooms.id, pageId: "page-room-a", values: { title: "Room 2" } }),
      ...[
        ["empty-slot", "", ["room-z"]],
        ["empty-room", "Fr 11:15 → 12:00", []],
        ["room-two", "Fr 11:15 → 12:00", ["room-a"]],
        ["dot-time", "Fr 11.15 → 12.00", ["room-z"]],
        ["room-one", "Fr 11:15 → 12:00", ["room-z"]],
        ["same-key", "fr 11:15 → 12:00", ["room-z"]],
      ].map(([id, slot, room]) => createDatabaseItem({ id, sourceId: source.id, pageId: "page-" + id, values: { title: id, slot, room } })),
    ],
  };
  const ordered = (direction) => projectViewItems(workspace, createDatabaseView({
    sourceId: source.id,
    sorts: [{ propertyId: "slot", direction }, { propertyId: "room", direction }],
  })).map(item => item.id);
  assert.deepEqual(ordered("asc"), ["room-one", "same-key", "room-two", "empty-room", "dot-time", "empty-slot"]);
  assert.deepEqual(ordered("desc"), ["dot-time", "room-two", "room-one", "same-key", "empty-room", "empty-slot"]);
});

test("view sorts compare populated number and date keys by value", () => {
  const workspace = workspaceFixture();
  const [first, second, third] = workspace.databaseItems;
  first.values.score = 2;
  second.values.score = 10;
  delete third.values.score;
  first.values.date = { start: "2026-09-20T08:00:00+08:00", includeTime: true };
  second.values.date = { start: "2026-09-20T06:00:00Z", includeTime: true };
  const ordered = (propertyId, direction) => projectViewItems(workspace, createDatabaseView({
    sourceId: "tasks", sorts: [{ propertyId, direction }],
  })).map(item => item.id);
  for (const propertyId of ["score", "date"]) {
    assert.deepEqual(ordered(propertyId, "asc"), ["a", "b", "b-child"]);
    assert.deepEqual(ordered(propertyId, "desc"), ["b", "a", "b-child"]);
  }
});

test("view sorts compare numeric chunks in titles and text by value", () => {
  const source = createDataSource({
    id: "milestones",
    properties: [
      createProperty({ id: "title", type: "title" }),
      createProperty({ id: "milestone", type: "text" }),
    ],
  });
  const workspace = {
    dataSources: [source],
    databaseItems: [
      ["tier-ten", "  Tier 10", " Tier 9 Wave 30 "],
      ["tier-two", "Tier 2", "Tier 1 Wave 100"],
      ["wave-thirty", "Cash / Wave", "Tier 1 Wave 30"],
      ["no-wave", "Unscheduled", ""],
    ].map(([id, title, milestone]) => createDatabaseItem({
      id, sourceId: source.id, pageId: "page-" + id, values: { title, milestone },
    })),
  };
  const ordered = (propertyId, direction) => projectViewItems(workspace, createDatabaseView({
    sourceId: source.id, sorts: [{ propertyId, direction }],
  })).map(item => item.id);

  assert.deepEqual(ordered("title", "asc"), ["wave-thirty", "tier-two", "tier-ten", "no-wave"]);
  assert.deepEqual(ordered("milestone", "asc"), ["wave-thirty", "tier-two", "tier-ten", "no-wave"]);
  assert.deepEqual(ordered("milestone", "desc"), ["tier-ten", "tier-two", "wave-thirty", "no-wave"]);
  assert.equal(workspace.databaseItems[0].values.title, "  Tier 10");
});

test("multi-select sorts rank the first tag by option order and defer ties to the next column", () => {
  const source = createDataSource({
    id: "tools",
    properties: [
      createProperty({ id: "title", type: "title" }),
      createProperty({ id: "tags", type: "multi_select", options: [
        { id: "z", name: "Zebra" }, { id: "a", name: "Ant" },
      ] }),
    ],
  });
  const workspace = {
    dataSources: [source],
    databaseItems: [
      ["second-tag-follows", "Aardvark", ["a", "z"]],
      ["same-key-first", "Chrono Field Uptime Calculator", ["z"]],
      ["first-tag-multivalue", "Bot Calculator", ["z", "a"]],
      ["same-key-second", "Chrono Field Uptime Calculator", ["z", "a"]],
      ["first-tag-legacy", "Cell Calculator", "z"],
      ["empty", "Empty", []],
    ].map(([id, title, tags]) => createDatabaseItem({
      id, sourceId: source.id, pageId: "page-" + id, values: { title, tags },
    })),
  };
  const ordered = direction => projectViewItems(workspace, createDatabaseView({
    sourceId: source.id,
    sorts: [{ propertyId: "tags", direction }, { propertyId: "title", direction: "asc" }],
  })).map(item => item.id);
  const firstTagIds = ["first-tag-multivalue", "first-tag-legacy", "same-key-first", "same-key-second"];

  assert.deepEqual(ordered("asc"), [...firstTagIds, "second-tag-follows", "empty"]);
  assert.deepEqual(ordered("desc"), ["second-tag-follows", ...firstTagIds, "empty"]);
});

test("single-select sorts follow the configured option order in both directions", () => {
  const source = createDataSource({
    id: "releases",
    properties: [createProperty({ id: "release", type: "select", options: [
      { id: "latest", name: "2027-12" }, { id: "earliest", name: "2026-03" },
    ] })],
  });
  const workspace = {
    dataSources: [source],
    databaseItems: ["empty", "earliest", "latest"].map(id => createDatabaseItem({
      id, sourceId: source.id, pageId: "page-" + id, values: { release: id === "empty" ? null : id },
    })),
  };
  const ordered = direction => projectViewItems(workspace, createDatabaseView({
    sourceId: source.id, sorts: [{ propertyId: "release", direction }],
  })).map(item => item.id);

  assert.deepEqual(ordered("asc"), ["latest", "earliest", "empty"]);
  assert.deepEqual(ordered("desc"), ["earliest", "latest", "empty"]);
  source.properties.find(property => property.id === "release").options.reverse();
  assert.deepEqual(ordered("asc"), ["earliest", "latest", "empty"]);
});

test("formula, ID, created and modified properties resolve locally", () => {
  const workspace = workspaceFixture();
  const source = workspace.dataSources[0];
  const item = workspace.databaseItems[0];
  const property = (id) => source.properties.find((candidate)=>candidate.id===id);
  assert.equal(resolvePropertyValue(workspace, source, item, property("double")), 10);
  assert.equal(resolvePropertyValue(workspace, source, item, property("itemid")), "a");
  assert.equal(resolvePropertyValue(workspace, source, item, property("created")), "2026-09-01T00:00:00.000Z");
  assert.equal(resolvePropertyValue(workspace, source, item, property("modified")), "2026-09-02T00:00:00.000Z");
});

test("Relation and Rollup support count/sum without arbitrary code execution", () => {
  const workspace = workspaceFixture();
  const people = createDataSource({
    id:"people",
    title:"People",
    properties:[
      createProperty({id:"title",name:"名称",type:"title"}),
      createProperty({id:"points",name:"积分",type:"number"}),
    ],
  });
  workspace.dataSources.push(people);
  workspace.databaseItems.push(
    createDatabaseItem({id:"p1",sourceId:"people",pageId:"p1-page",values:{title:"甲",points:10}}),
    createDatabaseItem({id:"p2",sourceId:"people",pageId:"p2-page",values:{title:"乙",points:20}}),
  );
  const source=workspace.dataSources[0];
  source.properties.push(
    createProperty({id:"peopleRel",name:"成员",type:"relation",config:{targetSourceId:"people"}}),
    createProperty({id:"pointsSum",name:"积分总和",type:"rollup",config:{relationPropertyId:"peopleRel",targetPropertyId:"points",aggregation:"sum"}}),
    createProperty({id:"peopleCount",name:"成员数",type:"rollup",config:{relationPropertyId:"peopleRel",targetPropertyId:"points",aggregation:"count"}}),
  );
  workspace.relations.push(createRelation({sourceId:"tasks",propertyId:"peopleRel",targetSourceId:"people"}));
  workspace.databaseItems[0]=updateDatabaseItemValue(workspace.databaseItems[0],"peopleRel",["p1","p2"]);
  const sumProp=source.properties.find((property)=>property.id==="pointsSum");
  const countProp=source.properties.find((property)=>property.id==="peopleCount");
  assert.equal(resolvePropertyValue(workspace,source,workspace.databaseItems[0],sumProp),30);
  assert.equal(resolvePropertyValue(workspace,source,workspace.databaseItems[0],countProp),2);
});

test("parentItemId creates local database sub-item hierarchy", () => {
  const workspace=workspaceFixture();
  assert.deepEqual(childItems(workspace,"b").map((item)=>item.id),["b-child"]);
  assert.equal(itemDisplayTitle(workspace, workspace.dataSources[0], workspace.databaseItems[2]), "子任务");
});

test("starter database creates real item pages instead of opaque table rows", () => {
  const starter=createStarterDatabase({title:"知识库",ownerPageId:"chemistry",folderId:"parenting"});
  assert.equal(starter.items.length,3);
  assert.equal(starter.pages.length,3);
  for (const item of starter.items) {
    assert.ok(starter.pages.some((page)=>page.id===item.pageId));
  }
});
