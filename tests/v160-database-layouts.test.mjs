import test from "node:test";
import assert from "node:assert/strict";
import { resolveDatabaseOccurrenceViews, resolveDatabaseOccurrenceSources, serializeDatabaseOccurrenceSourceIds } from "../src/domain/databaseOccurrenceViews.js";
import { createPageBundle, importPageBundle } from "../src/domain/pageBundle.js";
import { normalizeRecordLayout, resolveRecordLayoutView } from "../src/domain/recordLayout.js";
import { buildChartSvg } from "../src/domain/chartImageExport.js";
import { normalizeViewConfig } from "../src/domain/viewRegistry.js";
import { deleteTrashGroupPermanently, trashPage } from "../src/domain/trash.js";
import { coreParityWorkspace } from "./fixtures/core-parity-workspace.mjs";

function databaseFixture() {
  const workspace = coreParityWorkspace();
  const view = { id: "partner-table", sourceId: "partners", name: "Partner table", type: "table", config: {} };
  workspace.databaseViews.push(view);
  return workspace;
}

test("a container includes only declared sources and uses the selected view's source", () => {
  const workspace = databaseFixture();
  const base = { sourceId: "projects", viewId: "partner-table", viewIdsJson: '["view-table","partner-table"]' };
  assert.ok(resolveDatabaseOccurrenceViews(workspace, base).problems.some(problem => problem.code === "VIEW_SOURCE_MISMATCH"));
  const sourceIdsJson = serializeDatabaseOccurrenceSourceIds(["projects", "partners"]);
  const live = resolveDatabaseOccurrenceViews(workspace, { ...base, sourceIdsJson });
  assert.deepEqual(live.problems, []);
  assert.equal(live.selectedView.sourceId, "partners");
  assert.equal(live.views[0].sourceId, "projects");
  assert.deepEqual(resolveDatabaseOccurrenceSources(workspace, { sourceId: "projects", sourceIdsJson }).sourceIds, ["projects", "partners"]);
  for (const invalid of ['["partners","projects"]', '["projects","absent"]', '["projects","projects"]', "false", "[]"]) {
    const rejected = resolveDatabaseOccurrenceViews(workspace, { ...base, sourceIdsJson: invalid });
    assert.equal(rejected.selectedView, null, invalid);
    assert.ok(rejected.problems.length > 0);
  }
});

test("permanent source deletion keeps the remaining views of explicit multi-source containers", () => {
  const workspace = databaseFixture();
  const date = "2026-11-27T07:00:00.000Z";
  const page = workspace.pages.find(({ id }) => id === "database-page");
  workspace.pages.push({ ...page, id: "partners-owner", pageType: null, databaseSourceId: null });
  workspace.dataSources.find(({ id }) => id === "partners").ownerPageId = "partners-owner";
  workspace.dataSources.push({ id: "outside", properties: [] });
  workspace.databaseViews.push({ id: "outside-view", sourceId: "outside" });
  const props = { sourceId: "projects", sourceIdsJson: '["projects","partners"]', viewId: "partner-table", viewIdsJson: '["view-table","partner-table","view-board"]' };
  const block = (id, changes = {}) => ({ id, type: "databaseView", props: { ...props, ...changes } });
  const badSource = block("bad-source", { sourceIdsJson: '["projects","partners","missing-source"]' });
  const badView = block("bad-view", { viewIdsJson: '["view-table","partner-table","outside-view","missing-view"]' });
  const malformed = block("malformed", { sourceIdsJson: '["projects","partners","partners"]' });
  const onlyRemovedView = block("only-removed-view", { viewIdsJson: '["partner-table"]' });
  page.databaseSourceIds = ["projects", "partners"];
  page.databaseViewId = "partner-table";
  page.content = [block("fullpage")];
  workspace.pages.push({ ...page, id: "metadata-only", content: [] });
  const editor = workspace.pages.find(({ id }) => id === "editor-page");
  editor.content = [{ id: "nested", type: "paragraph", children: [block("inline"), badSource, badView, malformed, onlyRemovedView] }];
  workspace.syncedSources.push({ id: "multi-sync", blocks: [block("sync")] });
  workspace.pageTemplates = [{ id: "multi-template", content: [block("template")] }];
  workspace.databaseTemplates = [{ id: "multi-record-template", sourceId: "projects", pageContent: [block("record-template")] }];
  workspace.pageVersions = [{ id: "frozen-version", pageId: editor.id, content: [block("historical")] }];

  const trashed = trashPage(workspace, "partners-owner", date);
  assert.equal(trashed.pages.find(({ id }) => id === "database-page").content[0].props.sourceIdsJson, props.sourceIdsJson);
  const before = structuredClone(trashed);
  const deleted = deleteTrashGroupPermanently(trashed, { kind: "page", id: "partners-owner" });
  assert.equal(deleted.dataSources.some(({ id }) => id === "partners"), false);
  assert.equal(deleted.databaseViews.some(({ id }) => id === "partner-table"), false);
  const full = deleted.pages.find(({ id }) => id === "database-page");
  assert.deepEqual(full.databaseSourceIds, ["projects"]);
  assert.equal(full.databaseViewId, "view-table");
  assert.equal(full.importRevision, 1);
  const metadataOnly = deleted.pages.find(({ id }) => id === "metadata-only");
  assert.deepEqual(metadataOnly.databaseSourceIds, ["projects"]);
  assert.equal(metadataOnly.databaseViewId, null);
  const [inline, missingSource, wrongViews, unchanged, emptied] = deleted.pages.find(({ id }) => id === editor.id).content[0].children;
  const synced = deleted.syncedSources.find(({ id }) => id === "multi-sync");
  assert.equal(synced.revision, 1);
  for (const occurrence of [full.content[0], inline, synced.blocks[0], deleted.pageTemplates[0].content[0], deleted.databaseTemplates[0].pageContent[0]]) {
    assert.equal(occurrence.props.sourceIdsJson, '["projects"]', occurrence.id);
    const resolved = resolveDatabaseOccurrenceViews(deleted, occurrence.props);
    assert.deepEqual(resolved.problems, [], occurrence.id);
    assert.equal(resolved.selectedView.id, "view-table");
    assert.deepEqual(resolved.viewIds, ["view-table", "view-board"]);
  }
  assert.deepEqual(resolveDatabaseOccurrenceViews(deleted, missingSource.props).problems.map(({ code }) => code), ["SOURCE_MISSING"]);
  assert.deepEqual(resolveDatabaseOccurrenceViews(deleted, wrongViews.props).problems.map(({ code }) => code), ["VIEW_SOURCE_MISMATCH", "VIEW_MISSING"]);
  assert.deepEqual(unchanged, malformed);
  const noViews = resolveDatabaseOccurrenceViews(deleted, emptied.props);
  assert.equal(noViews.selectedView, null);
  assert.deepEqual(noViews.problems, []);
  assert.deepEqual(deleted.pageVersions, before.pageVersions);
  assert.deepEqual(trashed, before);
});

test("page backup and independent import remap the container, each view and cross-source layout references", () => {
  const workspace = databaseFixture();
  const page = workspace.pages.find(entry => entry.id === "database-page");
  page.databaseSourceIds = ["projects", "partners"];
  page.databaseViewId = "partner-table";
  page.content = [{ id: "multi", type: "databaseView", props: {
    sourceId: "projects", sourceIdsJson: '["projects","partners"]', viewId: "partner-table", viewIdsJson: '["view-table","partner-table"]',
  } }];
  const originalSource = workspace.dataSources.find(entry => entry.id === "projects");
  originalSource.recordLayout = { mode: "tabs", pinnedPropertyIds: ["status"], sections: [], views: [
    { id: "other-layout", name: "Partners", sourceId: "partners", viewId: "partner-table" },
  ] };
  const bundle = createPageBundle(page, workspace);
  assert.deepEqual(bundle.related.dataSources.map(entry => entry.id).sort(), ["partners", "projects"]);
  const target = { id: "receiving", folderId: "dest", content: [] };
  let sequence = 0;
  const imported = importPageBundle({ pages: [target], folders: [{ id: "dest" }] }, bundle, target.id, kind => `${kind}-imported-${++sequence}`);
  const output = imported.page;
  const [primary, partner] = output.databaseSourceIds;
  assert.notEqual(primary, "projects");
  assert.notEqual(partner, "partners");
  assert.equal(output.databaseSourceId, primary);
  const occurrence = resolveDatabaseOccurrenceViews(imported.workspace, output.content[0].props);
  assert.deepEqual(occurrence.problems, []);
  assert.equal(occurrence.selectedView.sourceId, partner);
  assert.equal(occurrence.selectedView.id, output.databaseViewId);
  assert.deepEqual(occurrence.views.map(view => view.sourceId), [primary, partner]);
  const layout = imported.workspace.dataSources.find(entry => entry.id === primary).recordLayout;
  assert.equal(layout.views[0].sourceId, partner);
  assert.equal(layout.views[0].viewId, output.databaseViewId);
  assert.deepEqual(layout.pinnedPropertyIds, ["status"]);
});

test("record layouts use ordered source property IDs and diagnose unavailable or archived linked views", () => {
  const properties = [{ id: "title", type: "title" }, ...Array.from({ length: 18 }, (_, index) => ({ id: `p${index}`, type: "text" }))];
  const input = { mode: "tabs", pinnedPropertyIds: ["title", "missing", ...properties.slice(1, 17).map(property => property.id), "p2"],
    sections: [{ id: "section", name: "  Budget  ", propertyIds: ["p2", "p16", "missing", "p15"] }, { id: "section", name: "dup" }],
    views: [{ id: "related", name: "  Other  ", sourceId: "partners", viewId: "partner-table" }] };
  const layout = normalizeRecordLayout(input, { properties });
  assert.equal(layout.pinnedPropertyIds.length, 15);
  assert.deepEqual(layout.sections, [{ id: "section", name: "Budget", propertyIds: ["p16", "p15"] }]);
  assert.deepEqual(layout.views, [{ id: "related", name: "Other", sourceId: "partners", viewId: "partner-table" }]);
  const workspace = databaseFixture();
  assert.equal(resolveRecordLayoutView(workspace, layout.views[0]).view.id, "partner-table");
  assert.equal(resolveRecordLayoutView(workspace, { ...layout.views[0], sourceId: "projects" }), null);
  workspace.dataSources.find(entry => entry.id === "partners").ownerPageId = "partner-page";
  workspace.pages.find(entry => entry.id === "partner-page").archivedAt = "2026-11-26T00:00:00.000Z";
  // Reproduce the normal identity change on a workspace update.
  assert.equal(resolveRecordLayoutView({ ...workspace }, layout.views[0]).archived, true);
});

test("chart exports keep axis ticks and encode every explicit axis and donut label mode", () => {
  const points = [
    { key: "one", categoryKey: "one", seriesKey: "", label: "设计", value: 3 },
    { key: "two", categoryKey: "two", seriesKey: "", label: "发布", value: 2 },
  ];
  const projection = { points, valueLabel: "数量", total: 5 };
  const categoryProperty = { name: "分组" };
  const svg = config => buildChartSvg({ projection, config, categoryProperty, theme: "dark" }).svg;
  for (const kind of ["bar", "column", "line"]) {
    for (const axisTitles of ["none", "x", "y", "both"]) {
      const text = svg({ kind, axisTitles });
      assert.equal(text.includes('data-chart-axis="x"'), ["x", "both"].includes(axisTitles));
      assert.equal(text.includes('data-chart-axis="y"'), ["y", "both"].includes(axisTitles));
      assert.match(text, />0<\/text>/);
      if (axisTitles === "both") assert.match(text, kind === "bar" ? /data-chart-axis="x"[^>]*>数量<\/text>/ : /data-chart-axis="x"[^>]*>分组<\/text>/);
    }
  }
  const labels = { none: [], value: ["3", "2"], name: ["设计", "发布"], both: ["设计 · 3", "发布 · 2"] };
  for (const [donutLabels, texts] of Object.entries(labels)) {
    const text = svg({ kind: "donut", donutLabels, showLegend: false });
    const matches = [...text.matchAll(/<g data-chart-sector-label="[^"]+"><title>.*?<\/title><path [^>]+\/><text [^>]+>(.*?)<\/text>/g)];
    assert.deepEqual(matches.map(match => match[1]).sort(), [...texts].sort());
  }
  assert.equal(normalizeViewConfig("chart", { chart: { axisTitles: ["x"], donutLabels: "both" } }).chart.axisTitles, "none");
  assert.equal(normalizeViewConfig("chart", { chart: { axisTitles: ["x"], donutLabels: "both" } }).chart.donutLabels, "both");
});
