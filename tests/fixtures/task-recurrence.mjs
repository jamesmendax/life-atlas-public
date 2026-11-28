import { createBlankWorkspace } from "../../src/domain/blankWorkspace.js";
import { createDataSource, createDatabaseItem, createDatabaseView, makeDatabaseItemPage } from "../../src/domain/database.js";

export const now = "2026-11-26T04:00:00.000Z";
export const recurrence = {
  datePropertyId: "due", intervalPropertyId: "interval", completeOptionId: "done", resetOptionId: "todo", unit: "days",
};

export function recurrenceWorkspace({ configured = true } = {}) {
  let sequence = 0;
  const idFactory = prefix => prefix + "-recurrence-" + ++sequence;
  const workspace = createBlankWorkspace({ now, idFactory });
  const owner = workspace.pages[0];
  const source = createDataSource({ id: "tasks", ownerPageId: owner.id, title: "项目与任务", createdAt: now, properties: [
    { id: "task-title", name: "任务", type: "title" },
    { id: "task-status", name: "状态", type: "status", config: configured ? { recurrence } : {}, options: [
      { id: "todo", name: "待办", group: "todo" }, { id: "doing", name: "进行中", group: "inProgress" }, { id: "done", name: "已完成", group: "complete" },
    ] },
    { id: "due", name: "截止", type: "date" }, { id: "interval", name: "重复间隔（天）", type: "number" },
  ] });
  const view = createDatabaseView({ id: "task-table", type: "table", name: "全部任务", sourceId: source.id });
  owner.title = source.title;
  owner.content = [{ id: "recurrence-db", type: "databaseView", props: { sourceId: source.id, viewId: view.id } }];
  workspace.ui.preferences.style = "mobai";
  workspace.dataSources.push(source);
  workspace.databaseViews.push(view);
  for (const [id, title, interval] of [["recur-task", "每周复盘", 7], ["one-off", "普通任务", null]]) {
    const page = makeDatabaseItemPage({ itemId: id, pageId: "page-" + id, folderId: owner.folderId, source, title, idFactory, now });
    workspace.pages.push(page);
    workspace.databaseItems.push(createDatabaseItem({ id, pageId: page.id, sourceId: source.id, createdAt: now,
      values: { "task-title": title, "task-status": "todo", interval, due: { start: "2026-11-27", end: null, includeTime: false, timeZone: null } },
    }));
  }
  return workspace;
}
