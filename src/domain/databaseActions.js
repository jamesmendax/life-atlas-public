import { applyRelationChange, createDatabaseItem, databaseId, databaseItemById, dataSourceById, defaultDatabaseItemValues, itemDisplayTitle, makeDatabaseItemPage, relationDefinition } from "./database.js";
import { filePropertyIssue, isEmptyProperty, normalizeIdValues, normalizePropertyValue, READ_ONLY_PROPERTY_TYPES, validatePropertyValue } from "./databaseProperties.js";
import { normalizePageSettings } from "./pageActions.js";
import { allocateUniqueIds } from "./propertyChanges.js";
import { applyDatabaseTemplate } from "./templates.js";
import { applyTrackedPageEdit } from "./pageHistoryCapture.js";
import { isPageArchived } from "./archive.js";

function assertEditablePage(workspace, pageId) {
  const page = workspace.pages.find(entry => entry.id === pageId);
  if (!page || page.trashedAt || page.settings?.locked || isPageArchived(workspace, page.id)) throw new Error("页面不存在、已锁定、归档或在回收站中");
  return page;
}

function assertEditableSource(workspace, id) {
  const source = dataSourceById(workspace, id);
  if (!source || source.trashedAt || source.locked) throw new Error("数据库不存在、已锁定或在回收站中");
  if (source.ownerPageId) assertEditablePage(workspace, source.ownerPageId);
  return source;
}

function validateValue(workspace, property, raw) {
  const issue = validatePropertyValue(property, raw);
  if (issue) throw new Error(`${property.name}：${issue}`);
  if (isEmptyProperty(raw)) return;
  if (property.type === "number" && (!["number", "string"].includes(typeof raw) || !Number.isFinite(Number(raw)))) throw new Error(`${property.name}需要有效数字`);
  if (["status", "select", "multi_select"].includes(property.type)) {
    const ids = Array.isArray(raw) ? raw : [raw];
    if (ids.some(id => !property.options?.some(option => option.id === id))) throw new Error(`${property.name}包含已移除的选项`);
  }
  if (["people", "files"].includes(property.type)) {
    const records = property.type === "people" ? workspace.people : workspace.attachments;
    const ids = Array.isArray(raw) ? raw : [raw];
    if (ids.some(id => !records?.some(record => record.id === id && !record.trashedAt))) throw new Error(`${property.name}引用的条目不存在`);
    if (property.type === "files") for (const id of ids) {
      const issue = filePropertyIssue(records.find(entry => entry.id === id), property.config);
      if (issue) throw new Error(issue);
    }
  }
}

function relationIds(raw, name) {
  if (raw != null && raw !== "" && (Array.isArray(raw) ? raw : [raw]).some(id => typeof id !== "string" || !id.trim())) throw new Error(`${name}包含无效的关联值`);
  return normalizeIdValues(raw);
}

function setRelation(workspace, item, property, raw, now) {
  const relation = relationDefinition(workspace, item.sourceId, property);
  const ids = relationIds(raw, property.name);
  const previous = normalizeIdValues(item.values?.[property.id]);
  if (!ids.length && !previous.length) return workspace;
  const relatedSource = dataSourceById(workspace, relation?.targetSourceId);
  if (!relatedSource || relatedSource.trashedAt) throw new Error(`${property.name}的关联数据库不存在`);
  const reciprocal = relation.reciprocalPropertyId;
  if (reciprocal) assertEditableSource(workspace, relatedSource.id);
  const checked = reciprocal ? new Set([...ids, ...previous]) : ids;
  for (const id of checked) {
    const row = databaseItemById(workspace, id);
    const page = row && workspace.pages.find(entry => entry.id === row.pageId);
    if (!row || row.sourceId !== relatedSource.id || row.trashedAt || !page || page.trashedAt) throw new Error(`${property.name}引用的记录无效`);
    if (reciprocal && ids.includes(id) !== previous.includes(id) && (row.locked || page.settings?.locked)) throw new Error(`${property.name}的反向关联记录已锁定`);
  }
  const next = applyRelationChange(workspace, { itemId: item.id, propertyId: property.id, nextIds: ids, now });
  const saved = normalizeIdValues(databaseItemById(next, item.id)?.values?.[property.id]);
  if (saved.length !== ids.length || saved.some((id, index) => id !== ids[index]) || reciprocal && [...checked].some(id => normalizeIdValues(databaseItemById(next, id)?.values?.[reciprocal]).includes(item.id) !== ids.includes(id))) {
    throw new Error(`${property.name}无法写入，请检查关联的数量限制与反向属性`);
  }
  return next;
}

export function databaseActionConfigIssue(workspace, source, action) {
  const editing = action?.type === "updateRecord";
  if ((!editing && action?.type !== "createRecord") || !action?.targetSourceId) return "请选择动作的目标数据库";
  const target = dataSourceById(workspace, action.targetSourceId);
  if (!target || target.trashedAt) return "目标数据库不存在";
  if (editing) {
    const link = source?.properties.find(property => property.id === action.sourceRelationPropertyId);
    const expected = action.sourceRelationPropertyId ? relationDefinition(workspace, source?.id, link)?.targetSourceId : source?.id;
    if (expected !== target.id) return "编辑目标与触发记录的关联字段不匹配";
    if (!action.values || Array.isArray(action.values) || typeof action.values !== "object" || !Object.keys(action.values).length) return "请至少添加一个编辑字段";
  }
  if (!editing && action.templateId && !workspace.databaseTemplates?.some(entry => entry.sourceId === target.id && entry.id === action.templateId)) return "指定的记录模板不存在";
  if (!editing && (action.sourceRelationPropertyId || action.targetRelationPropertyId)) {
    const relationSource = (database, propertyId) => relationDefinition(workspace, database?.id, database?.properties?.find(property => property.id === propertyId))?.targetSourceId;
    const contextSource = action.sourceRelationPropertyId ? relationSource(source, action.sourceRelationPropertyId) : source?.id;
    if (!contextSource || relationSource(target, action.targetRelationPropertyId) !== contextSource) return "请选择指向同一数据库的关联字段";
  }
  try {
    for (const [id, raw] of Object.entries(action.values || {})) {
      const property = target.properties.find(entry => entry.id === id);
      if (!property || READ_ONLY_PROPERTY_TYPES.includes(property.type)) return "动作字段已删除或为只读";
      if (editing) {
        if (["title", "text", "select", "status", "url", "email", "phone"].includes(property.type) && raw != null && typeof raw !== "string") return `${property.name}需要文本值`;
        if (property.type === "checkbox" && typeof raw !== "boolean") return `${property.name}需要勾选值`;
        if (property.type === "place" && !isEmptyProperty(raw) && (typeof raw !== "object" || Array.isArray(raw))) return `${property.name}需要有效地点`;
        if (property.type === "relation") {
          const ids = relationIds(raw, property.name);
          const related = dataSourceById(workspace, relationDefinition(workspace, target.id, property)?.targetSourceId);
          if (!related || related.trashedAt) return `${property.name}的关联数据库不存在`;
          if (property.config?.relationLimit === 1 && ids.length > 1) return `${property.name}只允许一条关联记录`;
          for (const id of ids) {
            const record = databaseItemById(workspace, id);
            const page = record && workspace.pages.find(entry => entry.id === record.pageId);
            if (record?.sourceId !== related.id || record.trashedAt || !page || page.trashedAt) return `${property.name}引用的记录无效`;
          }
        }
      }
      validateValue(workspace, property, raw);
    }
  } catch (error) { return error.message; }
  return null;
}

function updateRecords(workspace, { origin, target, action, operationId, now }) {
  const source = dataSourceById(workspace, origin.sourceId);
  const issue = databaseActionConfigIssue(workspace, source, action);
  if (issue) throw new Error(issue);
  const itemIds = action.sourceRelationPropertyId ? relationIds(origin.values?.[action.sourceRelationPropertyId], "触发记录") : [origin.id];
  if (!itemIds.length) throw new Error("触发记录的关联字段为空");
  const selected = new Set(itemIds);
  const rows = workspace.databaseItems.filter(item => selected.has(item.id));
  if (rows.length !== itemIds.length || rows.some(item => item.sourceId !== target.id || item.locked || item.trashedAt)) throw new Error("编辑目标记录不存在、已锁定或不属于目标数据库");
  for (const item of rows) assertEditablePage(workspace, item.pageId);

  const values = {};
  const relations = [];
  let title;
  for (const [id, raw] of Object.entries(action.values)) {
    const property = target.properties.find(entry => entry.id === id);
    if (property.type === "relation") relations.push([property, raw]);
    else if (property.type === "title") values[id] = title = String(raw ?? "");
    else values[id] = normalizePropertyValue(property, raw);
  }
  const time = new Date(now).toISOString();
  let draft = workspace;
  if (title !== undefined) {
    for (const row of rows) draft = applyTrackedPageEdit(draft, { pageId: row.pageId, patch: { title }, now: time, beforeEditId: databaseId("ver") });
  }
  const receipt = { sourceItemId: origin.id, operationId, targetSourceId: target.id, itemIds };
  draft = { ...draft, databaseItems: draft.databaseItems.map(item => {
    const edited = selected.has(item.id) ? { ...item, values: { ...item.values, ...values }, updatedAt: time } : item;
    return item.id === origin.id ? { ...edited, actionUpdateReceipts: [...(edited.actionUpdateReceipts || []), receipt] } : edited;
  }) };
  for (const id of itemIds) {
    for (const [property, raw] of relations) draft = setRelation(draft, databaseItemById(draft, id), property, raw, time);
  }
  // Reciprocal writes between selected rows must also preserve every requested final value.
  for (const id of itemIds) {
    for (const [property, raw] of relations) {
      const requested = normalizeIdValues(raw);
      const saved = normalizeIdValues(databaseItemById(draft, id).values[property.id]);
      if (requested.length !== saved.length || requested.some(value => !saved.includes(value))) throw new Error(`${property.name}的反向关联与本次编辑冲突`);
    }
  }
  return updateResult(draft, receipt, false);
}

function updateResult(workspace, receipt, replayed) {
  const item = databaseItemById(workspace, receipt.itemIds[0]);
  return { workspace, item, page: item && workspace.pages.find(page => page.id === item.pageId), replayed, updatedItemIds: receipt.itemIds };
}

export function replayDatabaseAction(workspace, sourceItemId, operationId, action) {
  const updated = databaseItemById(workspace, sourceItemId)?.actionUpdateReceipts?.find(entry => entry.sourceItemId === sourceItemId && entry.operationId === operationId);
  if (updated) {
    if (action?.type !== "updateRecord" || updated.targetSourceId !== action.targetSourceId) throw new Error("此操作已用于另一个动作");
    return updateResult(workspace, updated, true);
  }
  const previous = workspace.databaseItems.find(row => row.actionReceipt?.itemId === row.id && row.actionReceipt.sourceItemId === sourceItemId && row.actionReceipt.operationId === operationId);
  if (!previous) return null;
  if (action?.type !== "createRecord" || previous.sourceId !== action.targetSourceId) throw new Error("此操作已用于另一个目标数据库");
  return { workspace, item: previous, page: workspace.pages.find(page => page.id === previous.pageId), replayed: true };
}

// The caller commits only the returned snapshot. A later failed relation therefore
// discards the draft record, template page, unique ID allocation and earlier links together.
export function executeDatabaseAction(workspace, { action, sourceItemId, operationId, now = new Date().toISOString() } = {}) {
  if (!["createRecord", "updateRecord"].includes(action?.type)) throw new Error("请选择记录动作");
  if (typeof operationId !== "string" || !operationId.trim()) throw new Error("按钮操作缺少标识");
  const replay = replayDatabaseAction(workspace, sourceItemId, operationId, action);
  if (replay) return replay;
  const origin = databaseItemById(workspace, sourceItemId);
  if (!origin || origin.locked || origin.trashedAt) throw new Error("触发记录不存在或已锁定");
  const originPage = assertEditablePage(workspace, origin.pageId);
  const originSource = assertEditableSource(workspace, origin.sourceId);
  const target = assertEditableSource(workspace, action.targetSourceId);
  if (action.type === "updateRecord") return updateRecords(workspace, { origin, target, action, operationId, now });
  const owner = workspace.pages.find(page => page.id === target.ownerPageId);
  const folderId = owner?.folderId || originPage.folderId;
  if (!folderId) throw new Error("目标数据库缺少文件夹");
  const template = workspace.databaseTemplates?.find(entry => entry.id === action.templateId && entry.sourceId === target.id);
  if (action.templateId && !template) throw new Error("指定的记录模板不存在");
  const applied = template && applyDatabaseTemplate(template);
  const defaults = { ...defaultDatabaseItemValues(target), ...applied?.values, ...action.values };
  const titleProperty = target.properties.find(property => property.type === "title");
  const title = String(action.title || defaults[titleProperty?.id] || template?.name || "新记录")
    .replaceAll("{title}", () => itemDisplayTitle(workspace, originSource, origin));
  if (titleProperty) defaults[titleProperty.id] = title;

  if (action.sourceRelationPropertyId && !action.targetRelationPropertyId) throw new Error("请选择要填写的目标关联字段");
  if (action.targetRelationPropertyId) {
    const targetProperty = target.properties.find(property => property.id === action.targetRelationPropertyId);
    const relation = relationDefinition(workspace, target.id, targetProperty);
    let expectedSourceId = originSource.id;
    let ids = [origin.id];
    if (action.sourceRelationPropertyId) {
      const from = originSource.properties.find(property => property.id === action.sourceRelationPropertyId);
      expectedSourceId = relationDefinition(workspace, originSource.id, from)?.targetSourceId;
      ids = normalizeIdValues(origin.values?.[from?.id]);
      if (!ids.length) throw new Error("触发记录的关联字段为空");
    }
    if (!expectedSourceId || relation?.targetSourceId !== expectedSourceId) throw new Error("两端关联字段的数据库不匹配");
    defaults[targetProperty.id] = ids;
  }

  const values = {};
  const relations = [];
  for (const [id, raw] of Object.entries(defaults)) {
    const property = target.properties.find(entry => entry.id === id);
    if (!property) throw new Error(`目标字段不存在：${id}`);
    if (READ_ONLY_PROPERTY_TYPES.includes(property.type) || property.type === "button") {
      if (Object.hasOwn(action.values || {}, id)) throw new Error(`${property.name}为只读字段`);
      continue; // A saved record template may contain computed fields.
    }
    validateValue(workspace, property, raw);
    if (property.type === "relation") relations.push([property, raw]);
    else values[id] = normalizePropertyValue(property, raw);
  }
  const time = new Date(now).toISOString();
  const itemId = databaseId("item");
  const sortIndex = workspace.pages.reduce((max, page) => page.folderId === folderId ? Math.max(max, Number(page.sortIndex) || 0) : max, 0) + 10;
  const page = makeDatabaseItemPage({ itemId, pageId: databaseId("dbpage"), source: target, folderId, title, sortIndex, now: time });
  page.settings = normalizePageSettings({ ...page.settings, fontFamily: workspace.ui?.preferences?.defaultFont, ...applied?.appearance?.settings });
  if (applied) {
    page.content = applied.content;
    for (const key of ["icon", "iconColor", "cover"]) if (Object.hasOwn(applied.appearance || {}, key)) page[key] = applied.appearance[key];
  }
  const allocated = allocateUniqueIds(workspace, { sourceId: target.id, values });
  const item = createDatabaseItem({ id: itemId, sourceId: target.id, pageId: page.id, values: allocated.values, createdAt: time });
  item.actionReceipt = { itemId, sourceItemId, operationId };
  let draft = { ...allocated.workspace, databaseItems: [...allocated.workspace.databaseItems, item], pages: [...allocated.workspace.pages, page] };
  for (const [property, raw] of relations) draft = setRelation(draft, item, property, raw, time);
  return { workspace: draft, item: databaseItemById(draft, itemId), page, replayed: false };
}
