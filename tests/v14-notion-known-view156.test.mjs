import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readNotionExport as inspectNotionZip, buildNotionImport } from "../src/import/notionImport.js";
import { mapNotionSourceViewConfiguration, prepareNotionSourceViewConfigurations, notionSourceViewConfigurationFor, normalizeNotionConfigurationPath } from "../src/import/notionSourceViewConfig.js";
import { createDatabaseView, projectViewItems, groupViewItems } from "../src/domain/database.js";
import { workspace156, source156, deepFreeze, configurationTargetIndex156 } from "../.qa/LOCAL-NOTION-001/v14-wiki-real133/import156/fixture156.mjs";
import { W1Gallery, W2Board } from "../.qa/LOCAL-NOTION-001/v14-wiki-real133/import156/source-configurations156.mjs";

const prop = (source, name) => source.properties.find((property) => property.name === name);
const counts = (workspace) => Object.fromEntries(Object.entries(workspace).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length]));
function mapped(input, source) {
  const before = structuredClone({ input, source, workspace: workspace156 });
  deepFreeze(input);
  const result = mapNotionSourceViewConfiguration(input, source);
  assert.deepEqual({ input, source, workspace: workspace156 }, before, "mapping preserves the complete real input");
  return result;
}

test("known views retain the complete real85/58/11/31/20/122 Wiki input", () => {
  assert.deepEqual(counts(workspace156), { folders: 3, pages: 85, dataSources: 11, databaseItems: 58, databaseViews: 31, relations: 0, syncedSources: 0, attachments: 20, people: 1, pageTemplates: 0, databaseTemplates: 0, discussions: 0, comments: 0, pageVersions: 122 });
  assert.equal(typeof buildNotionImport, "function");
});

test("actual inspectNotionZip alias reads all62 real members without a generated replacement or pruning", async () => {
  const zip = await readFile(new URL("../.qa/LOCAL-NOTION-001/v11-wiki-replica48/wiki-source-html48.zip", import.meta.url));
  const inspected = await inspectNotionZip(zip);
  assert.equal(inspected.entries.size, 62);
  assert.deepEqual(inspected.problems, []);
  const paths = [...inspected.entries.keys()];
  assert.equal(paths.filter((path) => path.endsWith(".html")).length, 56);
  assert.equal(paths.filter((path) => path.endsWith(".csv")).length, 6);
  assert.ok(inspected.entries.has(W1Gallery.path));
  assert.ok(inspected.entries.has(W2Board.path));
});

test("W1 explicit Gallery maps nested Published/checked filters, sorts and both property lists to source-local IDs", () => {
  const source = source156("文章"), result = mapped(structuredClone(W1Gallery.views[0]), source);
  assert.equal(result.valid, true, result.reason);
  const published = prop(source, "状态").options.find((option) => option.name === "Published");
  assert.deepEqual(result.view.filter.children[0], { kind: "condition", propertyId: prop(source, "状态").id, operator: "equals", value: published.id });
  assert.equal(result.view.filter.children[1].propertyId, prop(source, "首页精选").id);
  assert.deepEqual(result.view.sorts, [{ propertyId: prop(source, "发布日期").id, direction: "desc" }]);
  const ids = ["标题", "摘要", "发布日期"].map((name) => prop(source, name).id);
  assert.deepEqual(result.view.visiblePropertyIds, ids);
  assert.deepEqual(result.view.config.gallery.visiblePropertyIds, ids);
  assert.ok(result.missingFields.includes("grouping"));
  assert.ok(result.missingFields.includes("config.gallery.imageFit"));
  const view = createDatabaseView({ ...result.view, id: "known156-gallery", sourceId: source.id });
  assert.equal(view.type, "gallery");
  const projected = projectViewItems(workspace156, view);
  assert.equal(projected.length, 2);
  projected.forEach((item) => assert.strictEqual(item, workspace156.databaseItems.find((candidate) => candidate.id === item.id)));
});

test("W2 explicit Board maps stage manual order, hidden empty group and shared real rows", () => {
  const source = source156("札记"), result = mapped(structuredClone(W2Board.views[0]), source);
  assert.equal(result.valid, true, result.reason);
  const stage = prop(source, "阶段");
  assert.equal(result.view.groupBy, stage.id);
  assert.equal(result.view.grouping.primaryPropertyId, stage.id);
  assert.deepEqual(result.view.grouping.order, ["初记", "成形", "推演"].map((name) => stage.options.find((option) => option.name === name).id));
  assert.deepEqual(result.view.grouping.hiddenGroupKeys, ["未分组"]);
  const view = createDatabaseView({ ...result.view, id: "known156-board", sourceId: source.id });
  const groups = groupViewItems(workspace156, view);
  assert.deepEqual(groups.map((group) => group.key), result.view.grouping.order);
  assert.deepEqual(groups.map((group) => group.items.length), [2, 4, 3]);
  assert.deepEqual(result.missingFields, ["config"]);
});

test("recursive view config maps table/form/dashboard/gallery/calendar/timeline/chart/map property references and option defaults", () => {
  const source = source156("文章");
  const input = { name: "映射覆盖", type: "table", filter: { or: [{ propertyId: "状态", operator: "not_equals", value: "Published" }] }, sorts: [], groupBy: null, grouping: null,
    visiblePropertyIds: ["标题"], config: {
      table: { columnWidths: { 标题: 160 }, wrapPropertyIds: ["摘要"], calculations: { 标题: "count_all" } },
      calendar: { datePropertyId: "发布日期" }, timeline: { datePropertyId: "发布日期" },
      chart: { xPropertyId: "状态", valuePropertyId: "阅读时间", groupPropertyId: "主题" },
      map: { labelPropertyId: "标题", placePropertyId: null },
      gallery: { preview: { kind: "files-property", propertyId: "摘要" }, visiblePropertyIds: ["摘要"] },
      form: { fields: [{ propertyId: "状态", defaultValue: "Published" }] },
      dashboard: { widgets: [{ id: "widget", chart: { xPropertyId: "状态" } }], globalFilters: [{ propertyId: "状态", operator: "equals", value: "Published" }] },
      ordinaryMetadata: { note: "标题", futureFlag: true },
    } };
  const result = mapped(input, source);
  assert.equal(result.valid, true, result.reason);
  const id = (name) => prop(source, name).id, option = prop(source, "状态").options.find((option) => option.name === "Published").id;
  assert.deepEqual(result.view.config.table, { columnWidths: { [id("标题")]: 160 }, wrapPropertyIds: [id("摘要")], calculations: { [id("标题")]: "count_all" } });
  assert.equal(result.view.config.calendar.datePropertyId, id("发布日期"));
  assert.equal(result.view.config.timeline.datePropertyId, id("发布日期"));
  assert.equal(result.view.config.chart.valuePropertyId, id("阅读时间"));
  assert.equal(result.view.config.chart.groupPropertyId, id("主题"));
  assert.equal(result.view.config.map.labelPropertyId, id("标题"));
  assert.equal(result.view.config.gallery.preview.propertyId, id("摘要"));
  assert.equal(result.view.config.form.fields[0].defaultValue, option);
  assert.equal(result.view.config.dashboard.globalFilters[0].value, option);
  assert.equal(result.view.filter.or[0].value, option);
  assert.deepEqual(result.view.config.ordinaryMetadata, input.config.ordinaryMetadata);
  assert.deepEqual(result.missingFields, ["config.openRecordsIn"]);
});

test("partial settings disclose each missing field without guessing filters from the real rows", () => {
  const result = mapped({ name: "只知名称", type: "board" }, source156("札记"));
  assert.equal(result.valid, true);
  assert.equal(Object.hasOwn(result.view, "filter"), false);
  assert.deepEqual(result.missingFields, ["filter", "sorts", "groupBy", "grouping", "visiblePropertyIds", "config"]);
});

for (const [label, input, sourceOverride] of [
  ["missing property", { filter: { propertyId: "不存在", operator: "checked" } }],
  ["foreign local property ID", { visiblePropertyIds: [source156("札记").properties[0].id] }],
  ["duplicate property list", { visiblePropertyIds: ["标题", "标题"] }],
  ["missing option", { filter: { propertyId: "状态", operator: "equals", value: "不存在" } }],
  ["ambiguous property", { visiblePropertyIds: ["标题"] }, { properties: [...source156("文章").properties, { ...prop(source156("文章"), "标题"), id: "duplicate" }] }],
  ["ambiguous option", { filter: { propertyId: "状态", operator: "equals", value: "Published" } }, { properties: source156("文章").properties.map((property) => property.name === "状态" ? { ...property, options: [...property.options, { ...property.options.find((option) => option.name === "Published"), id: "duplicate-option" }] } : property) }],
  ["invalid layout", { type: "invented" }], ["invalid operator", { filter: { propertyId: "标题", operator: "invented" } }],
  ["unmapped relation value", { filter: { propertyId: "关联测试", operator: "equals", value: "foreign-item" } }, { properties: [...source156("文章").properties, { id: "relation-test156", name: "关联测试", type: "relation", options: [] }] }],
  ["foreign config reference", { config: { gallery: { sourceId: source156("札记").id } } }],
  ["duplicate sort target", { sorts: [{ propertyId: "标题", direction: "asc" }, { propertyId: "标题", direction: "desc" }] }],
]) test(`invalid known view rejects ${label} while retaining all real input`, () => {
  const source = sourceOverride ? { ...source156("文章"), ...sourceOverride } : source156("文章");
  const result = mapped(structuredClone(input), deepFreeze(source));
  assert.equal(result.valid, false);
  assert.ok(result.reason);
  assert.equal(Object.hasOwn(result, "view"), false);
});

test("text comparison literals stay names while form multi-select defaults become same-property option IDs", () => {
  const source = source156("文章"), theme = prop(source, "主题");
  const result = mapped({ filter: { propertyId: "状态", operator: "contains", value: "Published" }, config: { form: { fields: [{ propertyId: "主题", defaultValue: [theme.options[0].name] }] } } }, source);
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.view.filter.value, "Published");
  assert.deepEqual(result.view.config.form.fields[0].defaultValue, [theme.options[0].id]);
});

// Descriptor indexing tests only: all original paths/collections/records retained.
// Full HTML planning/build behavior is in import156/browser-checks156.mjs for the
// parent; a reduced/fake DOM import is deliberately not presented as that proof.
const plan = configurationTargetIndex156;
const firstDescriptor = plan.pages.find((descriptor) => descriptor.path === W1Gallery.path);

test("configuration target indexing retains all62 members,56 HTML descriptors,6 sources and38 records", () => {
  assert.equal(plan.retainedMemberPaths.length, 62);
  assert.equal(plan.pages.length, 12);
  assert.equal(plan.databases.length, 6);
  assert.equal(plan.databases.reduce((total, source) => total + source.records.length, 0), 38);
  assert.equal([...plan.pages, ...plan.databases.flatMap((source) => [source.page, ...source.records.map((record) => record.page)])].length, 56);
});

test("normalized export path and zero-based collection ordinal select only the unique original occurrence", () => {
  const warnings = [], input = [{ ...W1Gallery, path: `./${encodeURIComponent(W1Gallery.path)}` }, W2Board];
  const before = structuredClone({ plan, input });
  deepFreeze(input); deepFreeze(plan);
  const prepared = prepareNotionSourceViewConfigurations(plan, input, warnings);
  assert.deepEqual({ plan, input }, before);
  assert.deepEqual(warnings, []);
  assert.equal(prepared.entries.size, 2);
  const first = notionSourceViewConfigurationFor(prepared, firstDescriptor, 0);
  assert.equal(first.currentViewIndex, 0);
  assert.strictEqual(first.sourceDescriptor, plan.databases.find((source) => source.page.path === W1Gallery.sourcePath));
  assert.equal(notionSourceViewConfigurationFor(prepared, firstDescriptor, 1), undefined);
});

test("duplicate normalized occurrence targets are all rejected, not silently last-wins", () => {
  const warnings = [], prepared = prepareNotionSourceViewConfigurations(plan, [{ ...W1Gallery, path: `./${W1Gallery.path}` }, { ...W1Gallery }], warnings);
  assert.equal(prepared.entries.size, 0);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((warning) => warning.kind === "view_configuration_invalid"));
});

test("ordered provided views and current index remain occurrence-local without changing the full original target index", () => {
  const views = [structuredClone(W1Gallery.views[0]), { name: "Second test view", type: "list" }];
  const input = [{ ...W1Gallery, views, currentViewIndex: 1 }, W2Board], warnings = [];
  const before = structuredClone({ plan, input });
  deepFreeze(input);
  const prepared = prepareNotionSourceViewConfigurations(plan, input, warnings);
  const first = notionSourceViewConfigurationFor(prepared, firstDescriptor, 0);
  assert.strictEqual(first.entry.views, views);
  assert.equal(first.currentViewIndex, 1);
  assert.deepEqual(warnings, []);
  assert.deepEqual({ plan, input }, before);
});

test("ambiguous original descriptor and source paths are rejected while all original arrays remain retained", () => {
  for (const ambiguity of ["descriptor", "source"]) {
    const ambiguous = structuredClone(plan);
    if (ambiguity === "descriptor") ambiguous.pages.push(structuredClone(firstDescriptor));
    else ambiguous.databases.push(structuredClone(plan.databases.find((source) => source.page.path === W1Gallery.sourcePath)));
    const before = structuredClone(ambiguous), warnings = [];
    deepFreeze(ambiguous);
    const prepared = prepareNotionSourceViewConfigurations(ambiguous, [W1Gallery], warnings);
    assert.equal(prepared.entries.size, 0);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].kind, "view_configuration_invalid");
    assert.deepEqual(ambiguous, before);
  }
});

test("two full-page declarations on different actual root collections are rejected rather than picking one", () => {
  const root = plan.pages.find((descriptor) => descriptor.collections.length === 7), warnings = [];
  assert.ok(root);
  const prepared = prepareNotionSourceViewConfigurations(plan, [
    { path: root.path, collectionIndex: 0, pageType: "database", views: [{ name: "One", type: "table" }] },
    { path: root.path, collectionIndex: 1, pageType: "database", views: [{ name: "Two", type: "table" }] },
  ], warnings);
  assert.equal(prepared.entries.size, 0);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((warning) => warning.kind === "view_configuration_invalid"));
});

for (const [label, overrides] of [
  ["missing target", { path: "missing.html" }], ["negative ordinal", { collectionIndex: -1 }],
  ["missing ordinal", { collectionIndex: 1 }], ["fractional ordinal", { collectionIndex: 0.5 }],
  ["foreign source path", { sourcePath: "missing.csv" }], ["empty views", { views: [] }],
  ["out-of-range current view", { currentViewIndex: 1 }], ["invalid page declaration", { pageType: "page" }],
  ["unmapped entry source ID", { sourceId: "foreign-source" }],
]) test(`invalid source configuration reports ${label} before any import mutation`, () => {
  const warnings = [], prepared = prepareNotionSourceViewConfigurations(plan, [{ ...W1Gallery, ...overrides }], warnings);
  assert.equal(prepared.entries.size, 0);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].kind, "view_configuration_invalid");
});

test("absent metadata keeps unknown membership and accepts no invented Page type", () => {
  for (const input of [undefined, []]) {
    const warnings = [], prepared = prepareNotionSourceViewConfigurations(plan, input, warnings);
    assert.equal(prepared.entries.size, 0);
    assert.deepEqual(warnings, []);
  }
  for (const path of ["../outside.html", "C:/outside.html", "/outside.html", "path\\outside.html", "%GG"]) assert.equal(normalizeNotionConfigurationPath(path), null);
});
