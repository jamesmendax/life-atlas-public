import { walkBlocks } from "../domain/blockDocument.js";
import {
  createDatabaseItem, createDatabaseView, createDataSource, createProperty, databaseItemById, databaseViewById, defaultDatabaseItemValues,
  ensureMapPlaceProperty, itemDisplayTitle, makeDatabaseItemPage, projectViewItems, resolvePropertyValue, searchViewItems,
  updateDatabaseItemValue, updateDatabaseView, viewsForSource,
} from "../domain/database.js";
import { formatPropertyValue, normalizePropertyValue, validatePropertyValue } from "../domain/databaseProperties.js";
import { isComputedFilterProperty, isNumberComparison, numericFilterValue } from "../domain/databaseFilters.js";
import { serializeDatabaseOccurrenceViewIds } from "../domain/databaseOccurrenceViews.js";
import { topLevelPages } from "../domain/navigation.js";
import { newNotePage } from "../domain/newPage.js";
import { normalizePageSettings } from "../domain/pageActions.js";
import { allocateUniqueIds } from "../domain/propertyChanges.js";
import { statusOptionGroup } from "../domain/statusGroups.js";
import { VIEW_REGISTRY } from "../domain/viewRegistry.js";
import {
  editedPage, getPage, markdownDocument, nextSortIndex, pageById, pageIdentity, resolveCreationFolder,
  toolError as error, toolResult as result,
} from "./workspaceToolSupport.js";

const writableTypes = new Set(["title", "text", "number", "select", "multi_select", "status", "date", "checkbox", "url", "email", "phone"]);
const emptyOperators = new Set(["is_empty", "is_not_empty", "checked", "unchecked"]);
const stringOperators = new Set(["contains", "not_contains", "starts_with"]);
const checkboxOperators = new Set(["checked", "unchecked"]);
const compareDate = new Set(["before", "after", "on_or_before", "on_or_after"]);
const optionsTypes = new Set(["select", "multi_select", "status"]);
const optionColors = ["gray", "blue", "green", "purple", "orange", "pink"];
const ellipsize = (value, maximum = 160) => String(value ?? "").slice(0, maximum);

function displayedSources(workspace, page) {
  const ids = new Set([page.databaseSourceId]);
  for (const block of walkBlocks(page.content)) if (block.type === "databaseView") ids.add(block.props?.sourceId);
  return (workspace.dataSources || []).filter((source) => {
    const owner = pageById(workspace, source.ownerPageId);
    return !source.trashedAt && (!source.ownerPageId || owner && !owner.trashedAt)
      && (source.ownerPageId === page.id || ids.has(source.id));
  });
}

function databaseTarget(workspace, args, context, { edit = false } = {}) {
  const page = getPage(workspace, args.page_id, context.currentPageId, { edit });
  const source = displayedSources(workspace, page).find((entry) => entry.id === args.source_id);
  if (!source) error("目标数据库未显示在指定页面。");
  const owner = source.ownerPageId ? getPage(workspace, source.ownerPageId, context.currentPageId, { edit }) : null;
  return { page, source, owner };
}

function getView(workspace, source, id) {
  const view = databaseViewById(workspace, id);
  if (!view || view.trashedAt || view.sourceId !== source.id) error("指定视图不属于目标数据库或已不可用。");
  return view;
}

function getProperty(source, id) {
  const property = source.properties?.find((entry) => entry.id === id);
  if (!property) error("目标数据库中没有这个属性。");
  return property;
}

function createProperties(specs, idFactory) {
  if (!specs?.length) return undefined;
  const names = specs.map((spec) => spec.name.trim());
  if (new Set(names).size !== names.length || specs.filter((spec) => spec.type === "title").length > 1) error("属性名称须各不相同，标题属性只能有一个。");
  return specs.map((spec) => {
    if (spec.options?.length && !optionsTypes.has(spec.type)) error("选项只能用于单选、多选或状态属性。");
    const labels = [...new Set((spec.options || []).map((option) => option.trim()))];
    const options = labels.map((label, index) => ({
      id: idFactory("option"), name: label, color: optionColors[index % optionColors.length],
      ...(spec.type === "status" ? { group: statusOptionGroup({ name: label }) } : {}),
    }));
    return createProperty({ id: idFactory("prop"), name: spec.name.trim(), type: spec.type, options });
  });
}

function createDatabase(workspace, args, context) {
  const { idFactory, now, currentPageId } = context;
  const mode = args.mode ?? (args.parent_page_id ? "inline" : "page");
  if ((mode === "inline" && args.folder_id) || (mode === "page" && args.parent_page_id)) error("内联数据库请选择页面，整页数据库请选择文件夹。");
  const target = mode === "inline" ? getPage(workspace, args.parent_page_id || "current", currentPageId, { edit: true }) : null;
  const { workspace: base, folder } = target ? { workspace, folder: workspace.folders.find((entry) => entry.id === target.folderId && !entry.trashedAt) }
    : resolveCreationFolder(workspace, args.folder_id, context);
  if (!folder) error("目标页面所在文件夹不可用。");
  const title = args.title.trim();
  const pageId = target?.id ?? idFactory("dbpage");
  const properties = createProperties(args.properties, idFactory);
  const source = createDataSource({ id: idFactory("source"), title, ownerPageId: pageId, properties, createdAt: now });
  const type = args.type ?? "table";
  const view = createDatabaseView({
    id: idFactory("view"), sourceId: source.id, name: VIEW_REGISTRY[type].label, type,
    visiblePropertyIds: source.properties.map((property) => property.id),
    config: type === "roadmap" ? { roadmap: { datePropertyId: source.properties.find((property) => property.type === "date")?.id ?? null } } : {},
  });
  const block = { id: idFactory("block"), type: "databaseView", props: { sourceId: source.id, viewId: view.id, viewIdsJson: serializeDatabaseOccurrenceViewIds([view.id]) } };
  const created = ensureMapPlaceProperty({ ...base, dataSources: [...(base.dataSources || []), source], databaseViews: [...(base.databaseViews || []), view] }, view, now, idFactory);
  let next;
  if (target) {
    next = editedPage(created, target, { content: [...(target.content || []), block] }, context);
  } else {
    const page = newNotePage({
      folderId: folder.id, title, now, content: [block], iconColor: "#7f8ea3", fontFamily: workspace.ui?.preferences?.defaultFont,
      sortIndex: nextSortIndex(topLevelPages(base.pages, folder.id)), idFactory: () => pageId,
    });
    const owner = {
      ...page, icon: "icon:database", summary: "本地数据库页面", pageType: "database",
      databaseSourceId: source.id, databaseViewId: view.id,
      settings: normalizePageSettings({ ...page.settings, presentationMode: "full" }),
    };
    next = { ...created, pages: [...created.pages, owner] };
  }
  return result(next, { page_id: pageId, source_id: source.id, view_id: view.id, title, message: "已创建数据库。" });
}

function listPageDatabases(workspace, args, context) {
  const page = getPage(workspace, args.page_id, context.currentPageId);
  const sources = displayedSources(workspace, page);
  const visible = args.source_id ? sources.filter((source) => source.id === args.source_id) : sources;
  if (args.source_id && !visible.length) error("目标数据源未显示在指定页面。");
  const detail = visible.length === 1;
  return result(workspace, {
    ...pageIdentity(page),
    databases: visible.slice(0, 12).map((source) => ({
      source_id: source.id,
      title: ellipsize(source.title),
      ...(detail ? {
        views: viewsForSource(workspace, source.id).filter((view) => !view.trashedAt).slice(0, 14).map((view) => ({
          view_id: view.id, name: ellipsize(view.name), type: view.type,
          open_records_in: view.config?.openRecordsIn || "peek",
          show_database_title: view.config?.showDataSourceTitle !== false,
          show_page_icon: view.config?.showPageIcon !== false,
          group_property_id: view.grouping?.primaryPropertyId || view.groupBy || null,
          sort_property_ids: (view.sorts || []).map((sort) => sort.propertyId).slice(0, 12),
        })),
        properties: (source.properties || []).slice(0, 16).map((property) => ({
          property_id: property.id, name: ellipsize(property.name, 100), type: property.type,
          editable: writableTypes.has(property.type),
          ...(property.options?.length ? { options: property.options.slice(0, 8).map((option) => ({ id: ellipsize(option.id, 76), name: ellipsize(option.name, 76) })) } : {}),
        })),
      } : {}),
    })),
  });
}

function queryDatabaseRecords(workspace, args, context) {
  const { source } = databaseTarget(workspace, args, context);
  const view = args.view_id ? getView(workspace, source, args.view_id) : { sourceId: source.id };
  const properties = [...new Set(args.property_ids || [])].map((id) => getProperty(source, id));
  const items = projectViewItems(workspace, view).filter((item) => pageById(workspace, item.pageId));
  const matches = args.query?.trim() ? searchViewItems(workspace, source, items, args.query) : items;
  if (args.count_only) return result(workspace, { count: matches.length });
  const offset = args.offset ?? 0;
  const limit = args.limit ?? 5;
  return result(workspace, {
    records: matches.slice(offset, offset + limit).map((item) => ({
      item_id: item.id, page_id: item.pageId, title: ellipsize(itemDisplayTitle(workspace, source, item)),
      ...(properties.length ? { fields: properties.map((property) => ({
        property_id: property.id, value: ellipsize(formatPropertyValue(workspace, property, resolvePropertyValue(workspace, source, item, property)), 150),
      })) } : {}),
    })),
    next_offset: offset + limit < matches.length ? offset + limit : null,
  });
}

function createRecord(workspace, args, context) {
  const { page: target, source, owner } = databaseTarget(workspace, args, context, { edit: true });
  const titleProperty = source.properties.find((property) => property.type === "title");
  if (!titleProperty) error("数据库缺少标题属性。");
  const { idFactory, now } = context;
  const folderId = owner?.folderId ?? target.folderId;
  const title = args.title.trim();
  const allocated = allocateUniqueIds(workspace, { sourceId: source.id, values: { ...defaultDatabaseItemValues(source), [titleProperty.id]: title } });
  const itemId = idFactory("item");
  const page = makeDatabaseItemPage({
    itemId, pageId: idFactory("page"), source, folderId, title, idFactory, now,
    sortIndex: nextSortIndex(workspace.pages.filter((entry) => entry.folderId === folderId)),
  });
  page.settings = normalizePageSettings({ fontFamily: workspace.ui?.preferences?.defaultFont });
  if (args.markdown) {
    const document = markdownDocument(args.markdown, idFactory);
    if (document.length) page.content = document;
  }
  const item = createDatabaseItem({ id: itemId, sourceId: source.id, pageId: page.id, values: allocated.values, createdAt: now });
  return result({
    ...allocated.workspace, pages: [...allocated.workspace.pages, page], databaseItems: [...(allocated.workspace.databaseItems || []), item],
  }, { ...pageIdentity(page), item_id: item.id, message: "已新增数据库记录。" });
}

function optionId(property, value) {
  if (typeof value !== "string") error("请选择已存在的数据库选项。");
  const trimmed = value.trim();
  const exact = property.options?.find((option) => option.id === trimmed);
  if (exact) return exact.id;
  const names = property.options?.filter((option) => option.name === trimmed);
  if (names?.length !== 1) error("请选择一个明确的现有选项。");
  return names[0].id;
}

function recordValue(property, value) {
  const { type } = property;
  if (!writableTypes.has(type)) error("此属性需在数据库界面编辑。");
  if (value === null) return type === "title" || type === "text" ? "" : normalizePropertyValue(property, null);
  if (["select", "status"].includes(type)) return value === "" ? null : optionId(property, value);
  if (type === "multi_select") return value === "" ? [] : [...new Set((Array.isArray(value) ? value : [value]).map((option) => optionId(property, option)))];
  if (type === "checkbox" && typeof value !== "boolean") error("复选框需要 true 或 false。");
  if (type === "number" && !(typeof value === "number" || typeof value === "string" && value.trim() && Number.isFinite(Number(value)))) error("数字属性需要有限的数字。");
  if (!["checkbox", "number"].includes(type) && typeof value !== "string") error("此属性需要文本值。");
  const normalized = normalizePropertyValue(property, value);
  const reason = validatePropertyValue(property, normalized);
  if (reason) error(reason);
  return normalized;
}

function updateRecord(workspace, args, context) {
  const { source } = databaseTarget(workspace, args, context, { edit: true });
  const item = databaseItemById(workspace, args.item_id);
  if (!item || item.sourceId !== source.id) error("记录不存在于指定数据库。");
  const page = getPage(workspace, item.pageId, context.currentPageId, { edit: true });
  const property = getProperty(source, args.property_id);
  const value = recordValue(property, args.value);
  const next = property.type === "title"
    ? editedPage(workspace, page, { title: value }, context)
    : { ...workspace, databaseItems: workspace.databaseItems.map((entry) => entry === item ? updateDatabaseItemValue(item, property.id, value, context.now) : entry) };
  return result(next, { item_id: item.id, page_id: page.id, message: "已更新数据库记录。" });
}

function makeFilter(source, args) {
  if (!args.filter_property_id && (args.filter_operator !== undefined || args.filter_value !== undefined)) error("请先指定筛选属性。");
  if (args.filter_property_id === "") return null;
  if (!args.filter_property_id) return undefined;
  if (!args.filter_operator) error("请指定筛选条件。");
  const property = getProperty(source, args.filter_property_id);
  const { filter_operator: operator, filter_value: value } = args;
  const numeric = isNumberComparison(operator);
  if ((checkboxOperators.has(operator) && property.type !== "checkbox")
    || (compareDate.has(operator) && property.type !== "date")
    || (numeric && !["number", "converted_amount", "formula", "rollup"].includes(property.type))) error("筛选条件与属性类型不匹配。");
  if (emptyOperators.has(operator)) return { propertyId: property.id, operator };
  if (value === undefined) error("请指定筛选值。");
  if (stringOperators.has(operator) && typeof value !== "string") error("此筛选条件需要文本。");
  if (numeric && (isComputedFilterProperty(property) || property.type === "converted_amount")) {
    const threshold = numericFilterValue(value);
    if (threshold === null) error("此筛选条件需要数字。");
    return { propertyId: property.id, operator, value: threshold };
  }
  const expected = stringOperators.has(operator) ? value
    : property.type === "multi_select" ? optionId(property, value)
      : writableTypes.has(property.type) ? recordValue(property, value) : value;
  return { propertyId: property.id, operator, value: expected };
}

function updateView(workspace, args, context) {
  const { source } = databaseTarget(workspace, args, context, { edit: true });
  const view = getView(workspace, source, args.view_id);
  if (Object.keys(args).length < 4) error("请指定要更改的视图设置。");
  const config = { ...view.config };
  if (args.open_records_in !== undefined) config.openRecordsIn = args.open_records_in;
  if (args.show_database_title !== undefined) config.showDataSourceTitle = args.show_database_title;
  if (args.show_page_icon !== undefined) config.showPageIcon = args.show_page_icon;
  if (args.type === "roadmap" && !config.roadmap) config.roadmap = { datePropertyId: source.properties.find((property) => property.type === "date")?.id ?? null };
  const patch = {
    config,
    ...(args.name !== undefined ? { name: args.name.trim() } : {}),
    ...(args.type !== undefined ? { type: args.type } : {}),
  };
  if (args.visible_property_ids !== undefined) {
    const title = source.properties.find((property) => property.type === "title");
    const requested = args.visible_property_ids.map((id) => getProperty(source, id).id);
    patch.visiblePropertyIds = [...new Set([...(title ? [title.id] : []), ...requested])];
  }
  if (args.group_property_id !== undefined) {
    const id = args.group_property_id ? getProperty(source, args.group_property_id).id : null;
    patch.groupBy = id;
    if (id !== (view.grouping?.primaryPropertyId || view.groupBy || null)) {
      patch.grouping = { primaryPropertyId: id, secondaryPropertyId: null, hiddenGroupKeys: [], order: [], showEmpty: true };
    }
  }
  if (args.sort_direction !== undefined && !args.sort_property_id) error("请先指定排序属性。");
  if (args.sort_property_id !== undefined) {
    patch.sorts = args.sort_property_id ? [{ propertyId: getProperty(source, args.sort_property_id).id, direction: args.sort_direction || "asc" }] : [];
  }
  const filter = makeFilter(source, args);
  if (filter !== undefined) patch.filter = filter;
  const updated = updateDatabaseView(view, patch);
  const next = { ...workspace, databaseViews: workspace.databaseViews.map((entry) => entry === view ? updated : entry) };
  return result(args.type === "map" ? ensureMapPlaceProperty(next, updated, context.now, context.idFactory) : next,
    { view_id: view.id, message: "已更新数据库视图。" });
}

export const databaseAssistantReadTools = ["list_page_databases", "query_database_records"];
export const databaseAssistantTools = {
  create_database: createDatabase,
  list_page_databases: listPageDatabases,
  query_database_records: queryDatabaseRecords,
  create_database_record: createRecord,
  update_database_record: updateRecord,
  update_database_view: updateView,
};
