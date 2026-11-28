import test from "node:test";
import assert from "node:assert/strict";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";
import { formatPropertyValue } from "../src/domain/databaseProperties.js";
import { groupViewItems, projectViewItems, resolvePropertyValue } from "../src/domain/database.js";
import { checkWorkspaceIntegrity } from "../src/domain/integrity.js";
import { BUILTIN_TEMPLATES, getBuiltinTemplate } from "../src/templates/registry.js";
import { instantiateTemplate } from "../src/templates/instantiate.js";
import { addDays, localDateString } from "../src/templates/dates.js";

const NOW = Date.parse("2026-11-01T10:00:00+08:00");
const counter = () => { let sequence = 0; return (prefix) => `${prefix}-${++sequence}`; };
const property = (source, name) => source.properties.find((entry) => entry.name === name);
const option = (source, name, optionName) => property(source, name).options.find((entry) => entry.name === optionName);

function generate(includeSampleData = true, workspace = fullWorkspace(), idFactory = counter()) {
  const template = getBuiltinTemplate("builtin.software-dev-roadmap");
  const result = instantiateTemplate(workspace, template, { now: NOW, idFactory, projectName: "Life Atlas", folderId: "f-z", includeSampleData });
  const project = result.workspace.pages.find((page) => page.id === result.rootPageId);
  const milestones = result.workspace.dataSources.find((source) => source.ownerPageId === project.id && source.title === "里程碑与阶段");
  const tasks = result.workspace.dataSources.find((source) => source.ownerPageId === project.id && source.title === "任务");
  const entries = result.workspace.databaseItems.filter((item) => item.sourceId === milestones.id);
  const taskEntries = result.workspace.databaseItems.filter((item) => item.sourceId === tasks.id);
  const views = result.workspace.databaseViews.filter((view) => [milestones.id, tasks.id].includes(view.sourceId));
  return { ...result, project, milestones, tasks, entries, taskEntries, views };
}

test("the project page has the five parts in order", () => {
  assert.equal(BUILTIN_TEMPLATES.length, 1);
  const result = generate();
  assert.equal(result.project.title, "Life Atlas · 开发进程");
  assert.equal(result.project.settings.fullWidth, true);
  assert.equal(result.project.icon, "icon:calendar-event");
  assert.equal(result.project.folderId, "f-z");
  assert.deepEqual(result.project.content.map((block) => block.type), ["callout", "heading", "databaseView", "heading", "databaseView", "heading", "databaseView", "heading", "databaseView"]);
  assert.equal(result.project.content[0].content, "项目目标：在这里用一句话写下这个项目要解决什么问题。");
  assert.deepEqual(result.project.content.filter((block) => block.type === "heading").map((block) => [block.props.level, block.content]), [[2, "时间脉络"], [2, "进行中"], [2, "全部任务"], [2, "版本记录"]]);
  const references = result.project.content.filter((block) => block.type === "databaseView").map((block) => result.views.find((view) => view.id === block.props.viewId));
  assert.deepEqual(references.map((view) => [view.name, view.sourceId, view.type, view.linked]), [["时间脉络", result.milestones.id, "roadmap", false], ["进行中", result.tasks.id, "list", true], ["看板", result.tasks.id, "board", false], ["版本记录", result.milestones.id, "list", true]]);
  assert.ok(result.workspace.pages.filter((page) => page.databaseSourceId === result.milestones.id || page.databaseSourceId === result.tasks.id).every((page) => page.folderId === "f-z"));
});

test("milestones data source matches the specification", () => {
  const { workspace, milestones, tasks } = generate();
  assert.deepEqual(milestones.properties.map((entry) => [entry.name, entry.type]), [["名称", "title"], ["类型", "select"], ["时间", "date"], ["状态", "status"], ["版本", "text"], ["负责人", "people"], ["任务", "relation"], ["进度", "rollup"], ["说明", "text"]]);
  assert.deepEqual(property(milestones, "类型").options.map((entry) => [entry.name, entry.color]), [["阶段", "blue"], ["里程碑", "purple"], ["发布", "green"], ["评审", "orange"]]);
  assert.deepEqual(property(milestones, "状态").options.map((entry) => [entry.name, entry.color, entry.group]), [["未开始", "gray", "todo"], ["进行中", "blue", "inProgress"], ["已完成", "green", "complete"], ["已延期", "red", "inProgress"], ["已取消", "gray", "complete"]]);
  const relation = property(milestones, "任务");
  assert.equal(relation.config.targetSourceId, tasks.id);
  assert.deepEqual(property(milestones, "进度").config, { relationPropertyId: relation.id, targetPropertyId: property(tasks, "状态").id, aggregation: "percent_complete" });
  const reciprocal = workspace.relations.filter((entry) => entry.sourceId === milestones.id || entry.sourceId === tasks.id);
  assert.equal(reciprocal.length, 2);
  assert.ok(reciprocal.some((entry) => entry.sourceId === milestones.id && entry.propertyId === relation.id && entry.targetSourceId === tasks.id && entry.reciprocalPropertyId === property(tasks, "所属阶段").id));
  assert.ok(reciprocal.some((entry) => entry.sourceId === tasks.id && entry.propertyId === property(tasks, "所属阶段").id && entry.targetSourceId === milestones.id && entry.reciprocalPropertyId === relation.id));
});

test("tasks data source matches the specification", () => {
  const { milestones, tasks } = generate();
  assert.deepEqual(tasks.properties.map((entry) => [entry.name, entry.type]), [["名称", "title"], ["状态", "status"], ["优先级", "select"], ["所属阶段", "relation"], ["截止日期", "date"], ["标签", "multi_select"], ["负责人", "people"], ["预估（小时）", "number"]]);
  assert.deepEqual(property(tasks, "状态").options.map((entry) => [entry.name, entry.color, entry.group]), [["未开始", "gray", "todo"], ["进行中", "blue", "inProgress"], ["已完成", "green", "complete"], ["已阻塞", "red", "inProgress"]]);
  assert.deepEqual(property(tasks, "优先级").options.map((entry) => [entry.name, entry.color]), [["P0", "red"], ["P1", "orange"], ["P2", "blue"], ["P3", "gray"]]);
  assert.deepEqual(property(tasks, "标签").options.map((entry) => [entry.name, entry.color]), [["前端", "blue"], ["后端", "purple"], ["数据", "brown"], ["测试", "yellow"], ["设计", "pink"], ["文档", "gray"], ["运维", "green"]]);
  assert.equal(property(tasks, "所属阶段").config.targetSourceId, milestones.id);
});

test("views and roadmap configuration match the specification", () => {
  const { workspace, milestones, tasks, views } = generate();
  assert.equal(views.length, 9);
  assert.deepEqual(views.filter((view) => view.sourceId === milestones.id && !view.linked).map((view) => [view.name, view.type]), [["时间脉络", "roadmap"], ["甘特图", "timeline"], ["看板", "board"], ["表格", "table"]]);
  assert.deepEqual(views.filter((view) => view.sourceId === tasks.id && !view.linked).map((view) => [view.name, view.type]), [["看板", "board"], ["表格", "table"], ["日历", "calendar"]]);
  const roadmap = views.find((view) => view.type === "roadmap").config.roadmap;
  assert.equal(roadmap.datePropertyId, property(milestones, "时间").id);
  assert.equal(roadmap.colorPropertyId, null);
  assert.equal(roadmap.markerPropertyId, property(milestones, "类型").id);
  assert.equal(roadmap.subtitlePropertyId, property(milestones, "版本").id);
  assert.equal(roadmap.progressPropertyId, property(milestones, "进度").id);
  assert.deepEqual(roadmap.markerMap, Object.fromEntries([["阶段", "circle"], ["里程碑", "diamond"], ["发布", "major"], ["评审", "square"]].map(([name, marker]) => [option(milestones, "类型", name).id, marker])));
  assert.equal(views.find((view) => view.type === "timeline").config.timeline.datePropertyId, property(milestones, "时间").id);
  assert.equal(views.find((view) => view.type === "calendar").config.calendar.datePropertyId, property(tasks, "截止日期").id);
  assert.equal(views.find((view) => view.sourceId === tasks.id && view.type === "board").grouping.primaryPropertyId, property(tasks, "状态").id);
  const active = views.find((view) => view.name === "进行中");
  assert.deepEqual(active.filter, { kind: "condition", propertyId: property(tasks, "状态").id, operator: "status_group_is", value: "inProgress" });
  assert.equal(projectViewItems(workspace, active).length, 2);
  option(tasks, "状态", "已完成").group = "inProgress";
  assert.equal(projectViewItems(workspace, active).length, 5);
  option(tasks, "状态", "已完成").group = "complete";
  assert.equal(projectViewItems(workspace, active).length, 2);
  const release = views.find((view) => view.name === "版本记录");
  assert.equal(projectViewItems(workspace, release).length, 1);
  assert.deepEqual(release.sorts, [{ propertyId: property(milestones, "时间").id, direction: "desc" }]);
});

test("sample data uses dates relative to today", () => {
  const { milestones, tasks, entries, taskEntries } = generate();
  assert.equal(localDateString(NOW), "2026-11-01");
  assert.deepEqual(entries.map((item) => [item.values[property(milestones, "名称").id], item.values[property(milestones, "时间").id].start, item.values[property(milestones, "时间").id].end, formatPropertyValue(null, property(milestones, "类型"), item.values[property(milestones, "类型").id]), formatPropertyValue(null, property(milestones, "状态"), item.values[property(milestones, "状态").id]), item.values[property(milestones, "版本").id]]), [
    ["需求与规划", "2026-10-04", "2026-10-18", "阶段", "已完成", ""],
    ["需求评审通过", "2026-10-18", null, "评审", "已完成", ""],
    ["原型与设计", "2026-10-18", "2026-11-04", "阶段", "进行中", ""],
    ["开发 v1", "2026-11-04", "2026-12-09", "阶段", "未开始", ""],
    ["文档编写", "2026-11-21", "2026-12-16", "阶段", "未开始", ""],
    ["功能冻结", "2026-12-09", null, "里程碑", "未开始", ""],
    ["测试与修复", "2026-12-09", "2026-12-23", "阶段", "未开始", ""],
    ["v1.0 发布", "2026-12-24", null, "发布", "未开始", "1.0.0"],
  ]);
  assert.equal(taskEntries.length, 8);
  const related = (name) => entries.find((entry) => entry.values[property(milestones, "名称").id] === name).values[property(milestones, "任务").id];
  assert.deepEqual(["需求与规划", "原型与设计", "开发 v1", "测试与修复"].map((name) => related(name).length), [2, 3, 2, 1]);
  for (const entry of entries) for (const id of entry.values[property(milestones, "任务").id]) assert.deepEqual(taskEntries.find((task) => task.id === id).values[property(tasks, "所属阶段").id], [entry.id]);
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-11-01", -28), "2026-10-04");
});

test("progress shows 100 percent and 33 percent", () => {
  const { workspace, milestones, entries } = generate();
  const progress = property(milestones, "进度");
  const value = (name) => resolvePropertyValue(workspace, milestones, entries.find((entry) => entry.values[property(milestones, "名称").id] === name), progress);
  assert.equal(value("需求与规划"), 1);
  assert.equal(value("原型与设计"), 1 / 3);
  assert.equal(formatPropertyValue(workspace, progress, value("需求与规划")), "100%");
  assert.equal(formatPropertyValue(workspace, progress, value("原型与设计")), "33%");
});

test("without sample data both sources are empty and views still work", () => {
  const { workspace, entries, taskEntries, views } = generate(false);
  assert.equal(entries.length, 0);
  assert.equal(taskEntries.length, 0);
  for (const view of views) {
    assert.deepEqual(projectViewItems(workspace, view), []);
    if (view.type === "board") assert.ok(groupViewItems(workspace, view).length > 0);
  }
});

test("two instances share no ids and stay independent", () => {
  const input = fullWorkspace();
  const factory = counter();
  const first = generate(true, input, factory);
  const second = generate(true, first.workspace, factory);
  const ids = (result) => [result.project.id, ...[result.milestones, result.tasks].flatMap((source) => [source.id, ...source.properties.flatMap((entry) => [entry.id, ...entry.options.map((value) => value.id)])]), ...result.views.map((view) => view.id), ...result.entries.flatMap((entry) => [entry.id, entry.pageId]), ...result.taskEntries.flatMap((entry) => [entry.id, entry.pageId]), ...result.project.content.map((block) => block.id), ...result.workspace.relations.filter((relation) => relation.sourceId === result.milestones.id || relation.sourceId === result.tasks.id).map((relation) => relation.id)];
  const firstIds = ids(first);
  const secondIds = ids(second);
  assert.equal(new Set(firstIds).size, firstIds.length);
  assert.equal(new Set(secondIds).size, secondIds.length);
  assert.ok(firstIds.every((id) => !secondIds.includes(id)));
  const changed = structuredClone(second.workspace);
  changed.databaseItems.find((entry) => entry.id === second.entries[0].id).values[property(second.milestones, "名称").id] = "只改第二套";
  assert.equal(changed.databaseItems.find((entry) => entry.id === first.entries[0].id).values[property(first.milestones, "名称").id], "需求与规划");
  assert.deepEqual(input, fullWorkspace());
});

test("the merged workspace passes the integrity checker", () => {
  const { workspace } = generate();
  assert.equal(checkWorkspaceIntegrity(workspace).ok, true);
  const template = getBuiltinTemplate("builtin.software-dev-roadmap");
  assert.throws(() => instantiateTemplate(fullWorkspace(), template, { now: NOW, idFactory: counter(), projectName: "项目", folderId: "missing", includeSampleData: true }), /文件夹|完整性/);
  assert.throws(() => instantiateTemplate(fullWorkspace(), template, { now: NOW, idFactory: () => "duplicate", projectName: "项目", folderId: "f-z", includeSampleData: true }), /ID/);
  assert.throws(() => instantiateTemplate(fullWorkspace(), template, { now: NOW, idFactory: counter(), projectName: " ", folderId: "f-z", includeSampleData: true }), /项目名称/);
});
