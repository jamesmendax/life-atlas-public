import { copyJson, ensureBlockIds, mapBlocks, stableJson, walkBlocks } from "../domain/blockDocument.js";
import { normalizePropertyValue } from "../domain/databaseProperties.js";
import { normalizeViewConfig, VIEW_REGISTRY } from "../domain/viewRegistry.js";
import { normalizeAttachment } from "../domain/attachments.js";
import { migrateStatusGroups as assignStatusGroups } from "../domain/statusGroups.js";
import { normalizeRollupDefinitions } from "../domain/rollupConfiguration.js";

const EPOCH = "1970-01-01T00:00:00.000Z";
// Phase 1/2 used cover by default; retain any valid kind already stored.
function normalizeHistoricalViewConfig(type, input) {
  const config = normalizeViewConfig(type, input);
  if (type === "gallery" && !["page-cover", "page-content", "files-property", "none"].includes(input?.gallery?.preview?.kind)) {
    config.gallery.preview.kind = "page-cover";
  }
  return config;
}

function withoutBlockIds(blocks) {
  return mapBlocks(blocks, (block) => { delete block.id; return block; });
}

// Pure and deterministic. No Date.now/random IDs, browser storage or mutation of
// the input. The browser repository retains the old key before publishing v7.
export function migratePhase1(input) {
  const workspace = copyJson(input || {});
  if (Number(workspace.schemaVersion) >= 7) return workspace;
  const time = workspace.savedAt || workspace.pages?.[0]?.createdAt || EPOCH;
  for (const key of ["pages", "folders", "dataSources", "databaseItems", "databaseViews", "relations", "syncedSources", "attachments", "people"]) {
    if (!Array.isArray(workspace[key])) workspace[key] = [];
  }
  if (!workspace.people.some((person) => person.id === "person-local")) workspace.people.push({ id: "person-local", displayName: "我", local: true, createdAt: time, updatedAt: time });
  workspace.ui = { ...workspace.ui, currentPersonId: workspace.ui?.currentPersonId || "person-local" };
  const usedIds = new Set([
    ...workspace.databaseViews.map((entry) => entry.id),
    ...workspace.syncedSources.map((entry) => entry.id),
    ...workspace.pages.flatMap((page) => walkBlocks(page.content).map((block) => block.id)),
  ]);
  const allocate = (prefix, location) => {
    const base = `migration-v7:${prefix}:${encodeURIComponent(location)}`;
    let id = base;
    let suffix = 0;
    while (usedIds.has(id)) id = `${base}:${++suffix}`;
    usedIds.add(id);
    return id;
  };
  const groups = new Map();
  const syncKeys = new Map();
  workspace.databaseViews = workspace.databaseViews.map((view) => ({ ...view, config: normalizeHistoricalViewConfig(view.type, view.config) }));
  workspace.pages = workspace.pages.map((page, pageIndex) => {
    const content = mapBlocks(page.content, (block, path) => {
      const location = `${page.id || pageIndex}/${block.id || path.join(".")}`;
      if (!block.id) block.id = allocate("block", location);
      if (block.type === "tabs") {
        const props = block.props || {};
        const panels = (block.children || []).filter((child) => child.type === "tabPanel");
        const ordinary = (block.children || []).filter((child) => child.type !== "tabPanel");
        const labels = String(props.tabs || "概览|笔记|资料").split("|").map((label) => label.trim()).filter(Boolean);
        const activeIndex = Math.max(0, Math.min((panels.length || labels.length || 1) - 1, Number(props.active) || 0));
        const children = panels.length ? panels.map((panel, index) => ({
          ...panel, props: { ...panel.props, tabId: panel.props?.tabId || allocate("tab", `${location}/${index}`), label: panel.props?.label || `标签 ${index + 1}` },
        })) : (labels.length ? labels : ["概览"]).map((label, index) => ({
          id: allocate("panel", `${location}/${index}`), type: "tabPanel",
          props: { tabId: allocate("tab", `${location}/${index}`), label, icon: "" },
          children: [{ id: allocate("paragraph", `${location}/${index}`), type: "paragraph", content: "" }],
        }));
        if (ordinary.length) children[activeIndex].children = [...(children[activeIndex].children || []), ...ordinary];
        const activeTabId = children.some((panel) => panel.props.tabId === props.activeTabId) ? props.activeTabId : children[activeIndex].props.tabId;
        const nextProps = { ...props, activeTabId };
        delete nextProps.tabs;
        delete nextProps.active;
        return { ...block, props: nextProps, children };
      }
      if (block.type === "syncedBlock" && !block.props?.sourceId) {
        const syncKey = block.props?.syncKey || `unshared:${location}`;
        const payload = { content: block.content || "", children: withoutBlockIds(block.children || []) };
        const fingerprint = `${syncKey}\u0000${stableJson(payload)}`;
        let source = groups.get(fingerprint);
        if (!source) {
          const id = allocate("sync", location);
          const blocks = ensureBlockIds([
            { type: "paragraph", content: copyJson(block.content || "") },
            ...(block.children || []),
          ], id);
          source = { id, blocks, revision: 0, createdAt: time, updatedAt: time, legacySyncKey: block.props?.syncKey || null, migratedReferences: [] };
          const prior = syncKeys.get(syncKey) || [];
          if (prior.length) {
            source.migrationConflict = "divergent-legacy-payloads-preserved";
            for (const other of prior) other.migrationConflict = source.migrationConflict;
          }
          prior.push(source);
          syncKeys.set(syncKey, prior);
          groups.set(fingerprint, source);
          workspace.syncedSources.push(source);
        }
        source.migratedReferences.push({ pageId: page.id, blockId: block.id });
        const props = { ...block.props, sourceId: source.id };
        delete props.syncKey;
        const result = { ...block, props };
        delete result.content;
        delete result.children;
        return result;
      }
      if (block.type === "databaseView" && Object.prototype.hasOwnProperty.call(block.props || {}, "presentation")) {
        const props = { ...block.props };
        const presentation = props.presentation;
        if (["chart", "form", "dashboard", "map"].includes(presentation)) {
          const old = workspace.databaseViews.find((view) => view.id === props.viewId);
          const id = allocate("view", location);
          const view = {
            ...(old || {}), id, sourceId: props.sourceId || old?.sourceId || "", type: presentation,
            name: `${old?.name || ""} ${VIEW_REGISTRY[presentation].label}`.trim(),
            config: normalizeViewConfig(presentation, old?.config),
            createdAt: old?.createdAt || time, updatedAt: old?.updatedAt || time,
          };
          workspace.databaseViews.push(view);
          props.viewId = id;
          props.sourceId = view.sourceId;
        }
        delete props.presentation;
        return { ...block, props };
      }
      return block;
    });
    return { ...page, content };
  });
  workspace.databaseItems = workspace.databaseItems.map((item) => {
    const source = workspace.dataSources.find((entry) => entry.id === item.sourceId);
    const values = { ...item.values };
    for (const property of source?.properties || []) {
      if (Object.prototype.hasOwnProperty.call(values, property.id)) values[property.id] = normalizePropertyValue(property, values[property.id]);
    }
    return { ...item, values };
  });
  workspace.schemaVersion = 7;
  return workspace;
}

export function migratePhase2(input) {
  const phase1 = migratePhase1(input);
  if (Number(phase1.schemaVersion) >= 8) return phase1;
  const workspace = copyJson(phase1);
  workspace.databaseViews = (workspace.databaseViews || []).map((view) => {
    const grouping = view.grouping && typeof view.grouping === "object"
      ? view.grouping
      : view.groupBy
        ? { primaryPropertyId: view.groupBy, secondaryPropertyId: null, hiddenGroupKeys: [], order: [], showEmpty: true }
        : null;
    let filter = view.filter;
    if (filter && !filter.kind) {
      if (Array.isArray(filter.and)) filter = { kind: "group", op: "and", children: filter.and.map((child) => child.kind ? child : { kind: "condition", ...child }) };
      else if (Array.isArray(filter.or)) filter = { kind: "group", op: "or", children: filter.or.map((child) => child.kind ? child : { kind: "condition", ...child }) };
      else filter = { kind: "condition", propertyId: filter.propertyId, operator: filter.operator || "contains", value: filter.value };
    }
    return {
      ...view,
      filter,
      ...(grouping ? { grouping } : {}),
      config: normalizeHistoricalViewConfig(view.type, view.config),
    };
  });
  workspace.schemaVersion = 8;
  return workspace;
}

export function migratePhase3(input) {
  const phase2 = migratePhase2(input);
  if (Number(phase2.schemaVersion) >= 9) return phase2;
  const workspace = copyJson(phase2);
  const time = workspace.savedAt || workspace.pages?.[0]?.createdAt || EPOCH;
  for (const key of ["pageTemplates", "databaseTemplates", "discussions", "comments", "attachments"]) {
    if (!Array.isArray(workspace[key])) workspace[key] = [];
  }
  workspace.attachments = workspace.attachments.map((attachment) => normalizeAttachment(attachment, time));
  workspace.pageTemplates = workspace.pageTemplates.map((template) => ({
    ...template,
    name: String(template.name || "页面模板"),
    content: Array.isArray(template.content) ? template.content : [],
    createdAt: template.createdAt || time,
    updatedAt: template.updatedAt || template.createdAt || time,
  }));
  workspace.databaseTemplates = workspace.databaseTemplates.map((template) => ({
    ...template,
    name: String(template.name || "数据库模板"),
    defaultValues: template.defaultValues && typeof template.defaultValues === "object" ? template.defaultValues : {},
    pageContent: Array.isArray(template.pageContent) ? template.pageContent : [],
    pageAppearance: template.pageAppearance && typeof template.pageAppearance === "object" ? template.pageAppearance : null,
    createdAt: template.createdAt || time,
    updatedAt: template.updatedAt || template.createdAt || time,
  }));
  workspace.discussions = workspace.discussions.map((discussion) => ({
    ...discussion,
    anchor: discussion.anchor && typeof discussion.anchor === "object" ? discussion.anchor : { kind:"page" },
    resolvedAt: discussion.resolvedAt || null,
    createdAt: discussion.createdAt || time,
    updatedAt: discussion.updatedAt || discussion.createdAt || time,
  }));
  workspace.comments = workspace.comments.map((comment) => ({
    ...comment,
    body: String(comment.body || ""),
    authorId: comment.authorId || workspace.ui?.currentPersonId || "person-local",
    createdAt: comment.createdAt || time,
    editedAt: comment.editedAt || null,
    deletedAt: comment.deletedAt || null,
  }));
  workspace.schemaVersion = 9;
  return workspace;
}

export function migrateWorkspaceShell(input) {
  const phase3 = migratePhase3(input);
  if (Number(phase3.schemaVersion) >= 10) return phase3;
  const workspace = copyJson(phase3);
  // Historical imports can carry user edits and references.
  workspace.pages ||= [];
  workspace.schemaVersion = 10;
  return workspace;
}

export function migrateTrashGroups(input) {
  const shell = migrateWorkspaceShell(input);
  if (Number(shell.schemaVersion) >= 11) return shell;
  const workspace = copyJson(shell);
  workspace.folders = (workspace.folders || []).map((folder) => ({ ...folder, trashedAt: folder.trashedAt ?? null, trashedByFolderId: folder.trashedByFolderId ?? null }));
  workspace.pages = (workspace.pages || []).map((page) => ({ ...page, trashedAt: page.trashedAt ?? null, trashedByFolderId: page.trashedByFolderId ?? null, trashedByPageId: page.trashedByPageId ?? null }));
  workspace.schemaVersion = 11;
  return workspace;
}

export function migrateAssetProvider(input) {
  const previous = migrateTrashGroups(input);
  if (Number(previous.schemaVersion) >= 12) return previous;
  return { ...copyJson(previous), schemaVersion: 12 };
}

export function migrateStatusGroups(input) { return assignStatusGroups(migrateAssetProvider(input)); }

export function migrateNavigationState(input) {
  const previous = migrateStatusGroups(input);
  if (Number(previous.schemaVersion) >= 14) return previous;
  const workspace = copyJson(previous);
  const ui = workspace.ui || {};
  workspace.ui = { ...ui, recentVisits: Array.isArray(ui.recentVisits) ? ui.recentVisits : [], favoritePageIds: Array.isArray(ui.favoritePageIds) ? ui.favoritePageIds : [], sidebarWidth: typeof ui.sidebarWidth === "number" && ui.sidebarWidth >= 200 && ui.sidebarWidth <= 480 ? ui.sidebarWidth : 248 };
  workspace.schemaVersion = 14;
  return workspace;
}

export const CURRENT_SCHEMA_VERSION = 20;
export function upgradeWorkspace(input) {
  const workspace = migrateProductFunctions(input);
  normalizeRollupDefinitions(workspace.dataSources);
  return workspace;
}

export function migrateInbox(input) {
  const previous = migrateNavigationState(input);
  if (Number(previous.schemaVersion) >= 15) return previous;
  const workspace = copyJson(previous);
  const time = workspace.savedAt || EPOCH;
  if (!workspace.folders.some((folder) => folder.system === "inbox")) workspace.folders.push({ id: "system-inbox", system: "inbox", name: "收件箱", parentId: null, color: "stone", sortIndex: -1, lastOpenedPageId: null, trashedAt: null, trashedByFolderId: null, createdAt: time, updatedAt: time });
  workspace.pages = workspace.pages.map((page) => ({ ...page, inboxedAt: page.inboxedAt ?? null }));
  const ui = workspace.ui || {};
  workspace.ui = { ...ui, firedReminderIds: Array.isArray(ui.firedReminderIds) ? ui.firedReminderIds : [], reminderLog: Array.isArray(ui.reminderLog) ? ui.reminderLog : [], lastReminderCheckAt: ui.lastReminderCheckAt ?? null };
  workspace.schemaVersion = 15;
  return workspace;
}

export function migratePageVersions(input) {
  const previous = migrateInbox(input);
  if (Number(previous.schemaVersion) >= 16) return previous;
  return { ...copyJson(previous), schemaVersion: 16, pageVersions: Array.isArray(previous.pageVersions) ? copyJson(previous.pageVersions) : [] };
}

// Older editors do not know the component block. Upgrade the compatibility marker
// before the new editor can save such a block, while retaining all prior rows.
export function migrateComponents(input) {
  const previous = migratePageVersions(input);
  return Number(previous.schemaVersion) >= 17 ? previous : { ...previous, schemaVersion: 17 };
}

function migrateFormulaRules(input) {
  const previous = migrateComponents(input);
  if (Number(previous.schemaVersion) >= 19) return previous;
  const workspace = { ...previous, schemaVersion: 19 };
  if (Array.isArray(previous.dataSources)) workspace.dataSources = previous.dataSources.map(source => {
    if (!Array.isArray(source?.properties)) return source;
    const properties = source.properties.map(property => {
      if (property?.type !== "formula" || !property.config || !Object.hasOwn(property.config, "formulaSemantics")) return property;
      const config = { ...property.config };
      delete config.formulaSemantics;
      return { ...property, config };
    });
    return properties.some((property, index) => property !== source.properties[index]) ? { ...source, properties } : source;
  });
  return workspace;
}

export function migrateProductFunctions(input) {
  const previous = migrateFormulaRules(input);
  if (Number(previous.schemaVersion) >= 20) return previous;
  const declaration = (blocks) => mapBlocks(blocks || [], (block) => block.type === "databaseView"
    && !block.props?.sourceIdsJson ? { ...block, props: { ...block.props, sourceIdsJson: JSON.stringify(block.props?.sourceId ? [block.props.sourceId] : []) } } : block);
  return {
    ...previous,
    schemaVersion: 20,
    databaseVersions: Array.isArray(previous.databaseVersions) ? copyJson(previous.databaseVersions) : [],
    pages: (previous.pages || []).map((page) => ({
      ...page, archivedAt: page.archivedAt || null, content: declaration(page.content),
      ...(page.pageType === "database" && page.databaseSourceId && !page.databaseSourceIds
        ? { databaseSourceIds: [page.databaseSourceId] } : {}),
    })),
    databaseItems: (previous.databaseItems || []).map((item) => ({ ...item, dependencyIds: Array.isArray(item.dependencyIds) ? [...item.dependencyIds] : [] })),
    syncedSources: (previous.syncedSources || []).map((source) => ({ ...source, blocks: declaration(source.blocks) })),
    pageTemplates: (previous.pageTemplates || []).map((template) => ({ ...template, content: declaration(template.content) })),
    databaseTemplates: (previous.databaseTemplates || []).map((template) => ({ ...template, pageContent: declaration(template.pageContent) })),
  };
}
