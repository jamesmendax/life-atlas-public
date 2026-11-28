import { coreParityWorkspace } from "./core-parity-workspace.mjs";

export function boardStatisticsWorkspace() {
  const workspace = coreParityWorkspace();
  const source = workspace.dataSources[0];
  source.properties.find(property => property.id === "amount").config.numberFormat = { format: "cny" };
  const rows = workspace.databaseItems.filter(item => item.sourceId === source.id);
  rows[0].values.amount = 12;
  rows[0].values.labels = ["design", "launch"];
  rows[1].values.amount = 0;
  rows[2].values.amount = null;
  const adjustment = { ...rows[0], id: "adjustment", pageId: "adjustment-page", values: {
    ...rows[0].values, title: "印量调整", amount: -8, labels: ["launch"],
  } };
  workspace.databaseItems.push(adjustment);
  const samplePage = workspace.pages.find(page => page.id === rows[0].pageId);
  workspace.pages.push({ ...samplePage, id: adjustment.pageId, title: adjustment.values.title, content: [] });
  const view = workspace.databaseViews.find(entry => entry.type === "board");
  view.grouping.secondaryPropertyId = "labels";
  view.config.board = { colorColumns: true };
  view.visiblePropertyIds = ["title", "amount"];
  const boardPage = workspace.pages.find(page => page.id === source.ownerPageId);
  boardPage.databaseViewId = view.id;
  boardPage.settings = { ...boardPage.settings, fullWidth: true, presentationMode: "full" };
  boardPage.content = [{ id: "board-statistics-db", type: "databaseView", props: {
    sourceId: source.id, viewId: view.id, viewIdsJson: JSON.stringify([view.id, "view-table"]),
  } }];
  return { workspace, source, view, rows: [...rows, adjustment] };
}
