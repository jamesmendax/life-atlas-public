import { createDataSource, createDatabaseItem, createDatabaseView, createProperty, createRelation } from "../../domain/database.js";
import { addDays, localDateString } from "../dates.js";

const SAMPLE_MILESTONES = [
  ["需求与规划", "阶段", -28, -14, "已完成", ""],
  ["需求评审通过", "评审", -14, null, "已完成", ""],
  ["原型与设计", "阶段", -14, 3, "进行中", ""],
  ["开发 v1", "阶段", 3, 38, "未开始", ""],
  ["文档编写", "阶段", 20, 45, "未开始", ""],
  ["功能冻结", "里程碑", 38, null, "未开始", ""],
  ["测试与修复", "阶段", 38, 52, "未开始", ""],
  ["v1.0 发布", "发布", 53, null, "未开始", "1.0.0"],
];
const SAMPLE_TASKS = [
  ["澄清项目目标", "需求与规划", "已完成", -21, "文档", 2],
  ["整理需求清单", "需求与规划", "已完成", -14, "文档", 4],
  ["绘制关键流程", "原型与设计", "已完成", -7, "设计", 4],
  ["设计界面原型", "原型与设计", "进行中", 0, "设计", 8],
  ["评审设计方案", "原型与设计", "进行中", 3, "前端", 2],
  ["实现核心功能", "开发 v1", "未开始", 20, "后端", 8],
  ["完善数据持久化", "开发 v1", "未开始", 38, "数据", 8],
  ["执行回归测试", "测试与修复", "未开始", 52, "测试", 4],
];

function build({ now, idFactory, projectName, folderId, includeSampleData }) {
  const timestamp = new Date(now).toISOString();
  const today = localDateString(now);
  const rootPageId = idFactory("page");
  const milestonesId = idFactory("source");
  const tasksId = idFactory("source");
  const options = (entries) => entries.map(([name, color, group]) => ({ id: idFactory("option"), name, color, ...(group ? { group } : {}) }));
  const makeProperty = (name, type, choices = [], config = {}) => createProperty({ id: idFactory("property"), name, type, options: choices, config });
  const milestoneProperties = [
    makeProperty("名称", "title"),
    makeProperty("类型", "select", options([["阶段", "blue"], ["里程碑", "purple"], ["发布", "green"], ["评审", "orange"]])),
    makeProperty("时间", "date"),
    makeProperty("状态", "status", options([["未开始", "gray", "todo"], ["进行中", "blue", "inProgress"], ["已完成", "green", "complete"], ["已延期", "red", "inProgress"], ["已取消", "gray", "complete"]])),
    makeProperty("版本", "text"),
    makeProperty("负责人", "people"),
    makeProperty("任务", "relation", [], { targetSourceId: tasksId }),
    makeProperty("进度", "rollup"),
    makeProperty("说明", "text"),
  ];
  const taskProperties = [
    makeProperty("名称", "title"),
    makeProperty("状态", "status", options([["未开始", "gray", "todo"], ["进行中", "blue", "inProgress"], ["已完成", "green", "complete"], ["已阻塞", "red", "inProgress"]])),
    makeProperty("优先级", "select", options([["P0", "red"], ["P1", "orange"], ["P2", "blue"], ["P3", "gray"]])),
    makeProperty("所属阶段", "relation", [], { targetSourceId: milestonesId }),
    makeProperty("截止日期", "date"),
    makeProperty("标签", "multi_select", options([["前端", "blue"], ["后端", "purple"], ["数据", "brown"], ["测试", "yellow"], ["设计", "pink"], ["文档", "gray"], ["运维", "green"]])),
    makeProperty("负责人", "people"),
    makeProperty("预估（小时）", "number"),
  ];
  const milestoneProperty = (name) => milestoneProperties.find((property) => property.name === name);
  const taskProperty = (name) => taskProperties.find((property) => property.name === name);
  const optionId = (property, name) => property.options.find((option) => option.name === name).id;
  milestoneProperty("进度").config = { relationPropertyId: milestoneProperty("任务").id, targetPropertyId: taskProperty("状态").id, aggregation: "percent_complete" };
  const dataSources = [
    createDataSource({ id: milestonesId, title: "里程碑与阶段", ownerPageId: rootPageId, properties: milestoneProperties, createdAt: timestamp, updatedAt: timestamp }),
    createDataSource({ id: tasksId, title: "任务", ownerPageId: rootPageId, properties: taskProperties, createdAt: timestamp, updatedAt: timestamp }),
  ];
  const makeView = (sourceId, name, type, configuration = {}) => ({ ...createDatabaseView({ id: idFactory("view"), sourceId, name, type, ...configuration }), createdAt: timestamp, updatedAt: timestamp });
  const roadmap = makeView(milestonesId, "时间脉络", "roadmap", { config: { roadmap: {
    datePropertyId: milestoneProperty("时间").id,
    colorPropertyId: null,
    markerPropertyId: milestoneProperty("类型").id,
    subtitlePropertyId: milestoneProperty("版本").id,
    progressPropertyId: milestoneProperty("进度").id,
    markerMap: Object.fromEntries([["阶段", "circle"], ["里程碑", "diamond"], ["发布", "major"], ["评审", "square"]].map(([name, marker]) => [optionId(milestoneProperty("类型"), name), marker])),
  } } });
  const taskBoard = makeView(tasksId, "看板", "board", { groupBy: taskProperty("状态").id });
  const activeTasks = makeView(tasksId, "进行中", "list", { linked: true, filter: { kind: "condition", propertyId: taskProperty("状态").id, operator: "status_group_is", value: "inProgress" } });
  const releases = makeView(milestonesId, "版本记录", "list", { linked: true, filter: { kind: "condition", propertyId: milestoneProperty("类型").id, operator: "equals", value: optionId(milestoneProperty("类型"), "发布") }, sorts: [{ propertyId: milestoneProperty("时间").id, direction: "desc" }] });
  const databaseViews = [
    roadmap,
    makeView(milestonesId, "甘特图", "timeline", { config: { timeline: { datePropertyId: milestoneProperty("时间").id } } }),
    makeView(milestonesId, "看板", "board", { groupBy: milestoneProperty("状态").id }),
    makeView(milestonesId, "表格", "table"),
    taskBoard,
    makeView(tasksId, "表格", "table"),
    makeView(tasksId, "日历", "calendar", { config: { calendar: { datePropertyId: taskProperty("截止日期").id } } }),
    activeTasks,
    releases,
  ];
  const block = (type, content, props = {}) => ({ id: idFactory("block"), type, props, ...(content === undefined ? {} : { content }) });
  const page = (id, title, content, sortIndex, extras = {}) => ({
    id, folderId, title, icon: "icon:file-text", iconColor: null, cover: null,
    settings: { fontFamily: "default", smallText: false, fullWidth: false, presentationMode: "default", locked: false },
    trashedAt: null, summary: "", contentRevision: 0, summarySourceRevision: 0, summaryUpdatedAt: timestamp,
    tags: [], sortIndex, createdAt: timestamp, updatedAt: timestamp, content, ...extras,
  });
  const project = page(rootPageId, `${projectName} · 开发进程`, [
    block("callout", "项目目标：在这里用一句话写下这个项目要解决什么问题。", { tone: "neutral", icon: "💡" }),
    block("heading", "时间脉络", { level: 2 }),
    block("databaseView", undefined, { sourceId: milestonesId, viewId: roadmap.id }),
    block("heading", "进行中", { level: 2 }),
    block("databaseView", undefined, { sourceId: tasksId, viewId: activeTasks.id }),
    block("heading", "全部任务", { level: 2 }),
    block("databaseView", undefined, { sourceId: tasksId, viewId: taskBoard.id }),
    block("heading", "版本记录", { level: 2 }),
    block("databaseView", undefined, { sourceId: milestonesId, viewId: releases.id }),
  ], 10, { icon: "icon:calendar-event", settings: { fontFamily: "default", smallText: false, fullWidth: true, presentationMode: "full", locked: false } });
  const pages = [project];
  const databaseItems = [];
  const date = (start, end = null) => ({ start: addDays(today, start), end: end === null ? null : addDays(today, end), includeTime: false, timeZone: null });
  const makeItem = (sourceId, title, values) => {
    const id = idFactory("item");
    const pageId = idFactory("page");
    pages.push(page(pageId, title, [block("paragraph", "")], pages.length * 10, { databaseSourceId: sourceId, parentDatabaseItemId: null }));
    const item = createDatabaseItem({ id, sourceId, pageId, values, createdAt: timestamp, updatedAt: timestamp });
    databaseItems.push(item);
    return item;
  };
  if (includeSampleData) {
    const milestones = new Map();
    for (const [name, type, start, end, status, version] of SAMPLE_MILESTONES) {
      milestones.set(name, makeItem(milestonesId, name, {
        [milestoneProperty("名称").id]: name,
        [milestoneProperty("类型").id]: optionId(milestoneProperty("类型"), type),
        [milestoneProperty("时间").id]: date(start, end),
        [milestoneProperty("状态").id]: optionId(milestoneProperty("状态"), status),
        [milestoneProperty("版本").id]: version,
        [milestoneProperty("负责人").id]: [],
        [milestoneProperty("任务").id]: [],
        [milestoneProperty("说明").id]: "",
      }));
    }
    for (const [name, phase, status, due, tag, estimate] of SAMPLE_TASKS) {
      const milestone = milestones.get(phase);
      const task = makeItem(tasksId, name, {
        [taskProperty("名称").id]: name,
        [taskProperty("状态").id]: optionId(taskProperty("状态"), status),
        [taskProperty("优先级").id]: optionId(taskProperty("优先级"), "P2"),
        [taskProperty("所属阶段").id]: [milestone.id],
        [taskProperty("截止日期").id]: date(due),
        [taskProperty("标签").id]: [optionId(taskProperty("标签"), tag)],
        [taskProperty("负责人").id]: [],
        [taskProperty("预估（小时）").id]: estimate,
      });
      milestone.values[milestoneProperty("任务").id].push(task.id);
    }
  }
  const relations = [
    createRelation({ id: idFactory("relation"), sourceId: milestonesId, propertyId: milestoneProperty("任务").id, targetSourceId: tasksId, reciprocalPropertyId: taskProperty("所属阶段").id }),
    createRelation({ id: idFactory("relation"), sourceId: tasksId, propertyId: taskProperty("所属阶段").id, targetSourceId: milestonesId, reciprocalPropertyId: milestoneProperty("任务").id }),
  ];
  return { pages, dataSources, databaseViews, databaseItems, relations };
}

export const softwareDevRoadmap = {
  id: "builtin.software-dev-roadmap",
  version: 1,
  name: "软件开发进程",
  description: "一键生成项目页面、“里程碑”和“任务”两张互相关联的数据库，默认显示时间脉络。里程碑的进度按关联任务的完成情况自动计算。",
  category: "开发",
  preview: "roadmap-thumb",
  build,
};
