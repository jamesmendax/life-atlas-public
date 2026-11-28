import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { fullWorkspace, FIXTURE_TIME } from "./fixtures/full-workspace.mjs";
import { expectedV20BlockDeclarations } from "./fixtures/schema-v20-expectations.mjs";
import { createPageVersion } from "../src/domain/pageHistory.js";
import { normalizeLoadedWorkspace } from "../src/persistence/normalize.js";
import * as migrations from "../src/persistence/migrations.js";
import { migrateStatusGroups } from "../src/domain/statusGroups.js";

const { CURRENT_SCHEMA_VERSION } = migrations;
const NOW = "2026-10-02T08:00:00.000Z";

// Exact pre-repair UTF-8 sources, including any BOM, embedded from the parent's
// workspace-copy-boundaries-before01 snapshot. The test has no dependency on
// ignored QA files. Only imports among these boundary modules are redirected;
// other dependencies use the same production modules as the current side.
const FROZEN_SOURCES = new Map([
  ["src/persistence/normalize.js", { sha256: "8706F53705FBAF967C249579C66A7B052152050A340080DC3860A16F78A701B8", source: "import { copyJson } from \"../domain/blockDocument.js\";\nimport { normalizePageSettings } from \"../domain/pageActions.js\";\nimport { purgeExpiredTrashGroups } from \"../domain/trash.js\";\nimport { prunePageVersions } from \"../domain/pageHistory.js\";\nimport { upgradeWorkspace } from \"./migrations.js\";\nimport { normalizeThemePreference } from \"../ui/theme.js\";\n\nexport { CURRENT_SCHEMA_VERSION } from \"./migrations.js\";\n\nconst EMPTY_ASSET_PREFERENCES = {\n  recentEmojiIds: [],\n  recentIconIds: [],\n  recentCoverIds: [],\n  favoriteCoverIds: [],\n};\n\nfunction normalizeIdList(value, limit = 64) {\n  return Array.from(new Set(Array.isArray(value) ? value.filter((item) => typeof item === \"string\" && item) : [])).slice(0, limit);\n}\n\nexport function normalizeLoadedWorkspace(input, { fallbackWorkspace, now, idFactory } = {}) {\n  const fallback = fallbackWorkspace && typeof fallbackWorkspace === \"object\" ? fallbackWorkspace : { folders: [], pages: [], ui: {} };\n  const source = copyJson(input && typeof input === \"object\" ? input : fallback);\n  const time = source.savedAt || source.pages?.[0]?.createdAt || \"1970-01-01T00:00:00.000Z\";\n  const preferences = source.ui?.preferences ?? fallback.ui?.preferences ?? {};\n  const folders = Array.isArray(source.folders)\n    ? source.folders.map((folder) => ({\n        ...folder,\n        createdAt: folder.createdAt || folder.updatedAt || time,\n        updatedAt: folder.updatedAt || folder.createdAt || time,\n      }))\n    : copyJson(fallback.folders || []);\n  const pages = Array.isArray(source.pages)\n    ? source.pages.map((page) => ({\n        ...page,\n        icon: page.icon || \"📄\",\n        iconColor: page.iconColor || null,\n        cover: page.cover ?? null,\n        settings: normalizePageSettings(page.settings),\n        trashedAt: page.trashedAt ?? null,\n        summary: page.summary || \"\",\n        contentRevision: Number.isFinite(page.contentRevision) ? page.contentRevision : 0,\n        summarySourceRevision: Number.isFinite(page.summarySourceRevision) ? page.summarySourceRevision : 0,\n        summaryUpdatedAt: page.summaryUpdatedAt || page.updatedAt || page.createdAt || time,\n        tags: Array.isArray(page.tags) ? page.tags : [],\n        createdAt: page.createdAt || page.updatedAt || time,\n        updatedAt: page.updatedAt || page.createdAt || time,\n      }))\n    : copyJson(fallback.pages || []);\n  const workspace = upgradeWorkspace({\n    ...source,\n    schemaVersion: source.schemaVersion || 1,\n    folders,\n    pages,\n    dataSources: Array.isArray(source.dataSources) ? source.dataSources : [],\n    databaseItems: Array.isArray(source.databaseItems) ? source.databaseItems : [],\n    databaseViews: Array.isArray(source.databaseViews) ? source.databaseViews : [],\n    relations: Array.isArray(source.relations) ? source.relations : [],\n    ui: {\n      ...(fallback.ui || {}),\n      ...(source.ui || {}),\n      preferences: { ...preferences, theme: normalizeThemePreference(preferences.theme), defaultFont: [\"default\", \"serif\", \"mono\"].includes(preferences.defaultFont) ? preferences.defaultFont : \"default\", startPage: preferences.startPage === \"home\" ? \"home\" : \"last\" },\n      assetPreferences: {\n        ...EMPTY_ASSET_PREFERENCES,\n        ...((source.ui || {}).assetPreferences || {}),\n        recentEmojiIds: normalizeIdList(source.ui?.assetPreferences?.recentEmojiIds, 48),\n        recentIconIds: normalizeIdList(source.ui?.assetPreferences?.recentIconIds, 48),\n        recentCoverIds: normalizeIdList(source.ui?.assetPreferences?.recentCoverIds, 32),\n        favoriteCoverIds: normalizeIdList(source.ui?.assetPreferences?.favoriteCoverIds, 150),\n      },\n    },\n  });\n  if (!workspace.workspaceId) {\n    if (typeof idFactory !== \"function\") throw new Error(\"缺少工作区 ID 生成器\");\n    workspace.workspaceId = idFactory(\"ws\");\n  }\n  const cleaned = purgeExpiredTrashGroups(workspace, now ?? time);\n  const pageIds = new Set(cleaned.pages.map((page) => page.id));\n  return { ...cleaned, pageVersions: prunePageVersions(cleaned.pageVersions, now ?? time).filter((version) => pageIds.has(version.pageId)) };\n}\n" }],
  ["src/persistence/migrations.js", { sha256: "C7AA6766B317BE5C002CA28F072A8A3964F6F15D83A3462BA810AA1C911E0E5F", source: "import { copyJson, ensureBlockIds, mapBlocks, stableJson, walkBlocks } from \"../domain/blockDocument.js\";\nimport { normalizePropertyValue } from \"../domain/databaseProperties.js\";\nimport { normalizeViewConfig, VIEW_REGISTRY } from \"../domain/viewRegistry.js\";\nimport { normalizeAttachment } from \"../domain/attachments.js\";\nimport { migrateStatusGroups as assignStatusGroups } from \"../domain/statusGroups.js\";\n\nconst EPOCH = \"1970-01-01T00:00:00.000Z\";\nfunction withoutBlockIds(blocks) {\n  return mapBlocks(blocks, (block) => { delete block.id; return block; });\n}\n\n// Pure and deterministic. No Date.now/random IDs, browser storage or mutation of\n// the input. The browser repository retains the old key before publishing v7.\nexport function migratePhase1(input) {\n  const workspace = copyJson(input || {});\n  if (Number(workspace.schemaVersion) >= 7) return workspace;\n  const time = workspace.savedAt || workspace.pages?.[0]?.createdAt || EPOCH;\n  for (const key of [\"pages\", \"folders\", \"dataSources\", \"databaseItems\", \"databaseViews\", \"relations\", \"syncedSources\", \"attachments\", \"people\"]) {\n    if (!Array.isArray(workspace[key])) workspace[key] = [];\n  }\n  if (!workspace.people.some((person) => person.id === \"person-local\")) workspace.people.push({ id: \"person-local\", displayName: \"我\", local: true, createdAt: time, updatedAt: time });\n  workspace.ui = { ...workspace.ui, currentPersonId: workspace.ui?.currentPersonId || \"person-local\" };\n  const usedIds = new Set([\n    ...workspace.databaseViews.map((entry) => entry.id),\n    ...workspace.syncedSources.map((entry) => entry.id),\n    ...workspace.pages.flatMap((page) => walkBlocks(page.content).map((block) => block.id)),\n  ]);\n  const allocate = (prefix, location) => {\n    const base = `migration-v7:${prefix}:${encodeURIComponent(location)}`;\n    let id = base;\n    let suffix = 0;\n    while (usedIds.has(id)) id = `${base}:${++suffix}`;\n    usedIds.add(id);\n    return id;\n  };\n  const groups = new Map();\n  const syncKeys = new Map();\n  workspace.databaseViews = workspace.databaseViews.map((view) => ({ ...view, config: normalizeViewConfig(view.type, view.config) }));\n  workspace.pages = workspace.pages.map((page, pageIndex) => {\n    const content = mapBlocks(page.content, (block, path) => {\n      const location = `${page.id || pageIndex}/${block.id || path.join(\".\")}`;\n      if (!block.id) block.id = allocate(\"block\", location);\n      if (block.type === \"tabs\") {\n        const props = block.props || {};\n        const panels = (block.children || []).filter((child) => child.type === \"tabPanel\");\n        const ordinary = (block.children || []).filter((child) => child.type !== \"tabPanel\");\n        const labels = String(props.tabs || \"概览|笔记|资料\").split(\"|\").map((label) => label.trim()).filter(Boolean);\n        const activeIndex = Math.max(0, Math.min((panels.length || labels.length || 1) - 1, Number(props.active) || 0));\n        const children = panels.length ? panels.map((panel, index) => ({\n          ...panel, props: { ...panel.props, tabId: panel.props?.tabId || allocate(\"tab\", `${location}/${index}`), label: panel.props?.label || `标签 ${index + 1}` },\n        })) : (labels.length ? labels : [\"概览\"]).map((label, index) => ({\n          id: allocate(\"panel\", `${location}/${index}`), type: \"tabPanel\",\n          props: { tabId: allocate(\"tab\", `${location}/${index}`), label, icon: \"\" },\n          children: [{ id: allocate(\"paragraph\", `${location}/${index}`), type: \"paragraph\", content: \"\" }],\n        }));\n        if (ordinary.length) children[activeIndex].children = [...(children[activeIndex].children || []), ...ordinary];\n        const activeTabId = children.some((panel) => panel.props.tabId === props.activeTabId) ? props.activeTabId : children[activeIndex].props.tabId;\n        const nextProps = { ...props, activeTabId };\n        delete nextProps.tabs;\n        delete nextProps.active;\n        return { ...block, props: nextProps, children };\n      }\n      if (block.type === \"syncedBlock\" && !block.props?.sourceId) {\n        const syncKey = block.props?.syncKey || `unshared:${location}`;\n        const payload = { content: block.content || \"\", children: withoutBlockIds(block.children || []) };\n        const fingerprint = `${syncKey}\\u0000${stableJson(payload)}`;\n        let source = groups.get(fingerprint);\n        if (!source) {\n          const id = allocate(\"sync\", location);\n          const blocks = ensureBlockIds([\n            { type: \"paragraph\", content: copyJson(block.content || \"\") },\n            ...(block.children || []),\n          ], id);\n          source = { id, blocks, revision: 0, createdAt: time, updatedAt: time, legacySyncKey: block.props?.syncKey || null, migratedReferences: [] };\n          const prior = syncKeys.get(syncKey) || [];\n          if (prior.length) {\n            source.migrationConflict = \"divergent-legacy-payloads-preserved\";\n            for (const other of prior) other.migrationConflict = source.migrationConflict;\n          }\n          prior.push(source);\n          syncKeys.set(syncKey, prior);\n          groups.set(fingerprint, source);\n          workspace.syncedSources.push(source);\n        }\n        source.migratedReferences.push({ pageId: page.id, blockId: block.id });\n        const props = { ...block.props, sourceId: source.id };\n        delete props.syncKey;\n        const result = { ...block, props };\n        delete result.content;\n        delete result.children;\n        return result;\n      }\n      if (block.type === \"databaseView\" && Object.prototype.hasOwnProperty.call(block.props || {}, \"presentation\")) {\n        const props = { ...block.props };\n        const presentation = props.presentation;\n        if ([\"chart\", \"form\", \"dashboard\", \"map\"].includes(presentation)) {\n          const old = workspace.databaseViews.find((view) => view.id === props.viewId);\n          const id = allocate(\"view\", location);\n          const view = {\n            ...(old || {}), id, sourceId: props.sourceId || old?.sourceId || \"\", type: presentation,\n            name: `${old?.name || \"\"} ${VIEW_REGISTRY[presentation].label}`.trim(),\n            config: normalizeViewConfig(presentation, old?.config),\n            createdAt: old?.createdAt || time, updatedAt: old?.updatedAt || time,\n          };\n          workspace.databaseViews.push(view);\n          props.viewId = id;\n          props.sourceId = view.sourceId;\n        }\n        delete props.presentation;\n        return { ...block, props };\n      }\n      return block;\n    });\n    return { ...page, content };\n  });\n  workspace.databaseItems = workspace.databaseItems.map((item) => {\n    const source = workspace.dataSources.find((entry) => entry.id === item.sourceId);\n    const values = { ...item.values };\n    for (const property of source?.properties || []) {\n      if (Object.prototype.hasOwnProperty.call(values, property.id)) values[property.id] = normalizePropertyValue(property, values[property.id]);\n    }\n    return { ...item, values };\n  });\n  workspace.schemaVersion = 7;\n  return workspace;\n}\n\nexport function migratePhase2(input) {\n  const phase1 = migratePhase1(input);\n  if (Number(phase1.schemaVersion) >= 8) return phase1;\n  const workspace = copyJson(phase1);\n  workspace.databaseViews = (workspace.databaseViews || []).map((view) => {\n    const grouping = view.grouping && typeof view.grouping === \"object\"\n      ? view.grouping\n      : view.groupBy\n        ? { primaryPropertyId: view.groupBy, secondaryPropertyId: null, hiddenGroupKeys: [], order: [], showEmpty: true }\n        : null;\n    let filter = view.filter;\n    if (filter && !filter.kind) {\n      if (Array.isArray(filter.and)) filter = { kind: \"group\", op: \"and\", children: filter.and.map((child) => child.kind ? child : { kind: \"condition\", ...child }) };\n      else if (Array.isArray(filter.or)) filter = { kind: \"group\", op: \"or\", children: filter.or.map((child) => child.kind ? child : { kind: \"condition\", ...child }) };\n      else filter = { kind: \"condition\", propertyId: filter.propertyId, operator: filter.operator || \"contains\", value: filter.value };\n    }\n    return {\n      ...view,\n      filter,\n      ...(grouping ? { grouping } : {}),\n      config: normalizeViewConfig(view.type, view.config),\n    };\n  });\n  workspace.schemaVersion = 8;\n  return workspace;\n}\n\nexport function migratePhase3(input) {\n  const phase2 = migratePhase2(input);\n  if (Number(phase2.schemaVersion) >= 9) return phase2;\n  const workspace = copyJson(phase2);\n  const time = workspace.savedAt || workspace.pages?.[0]?.createdAt || EPOCH;\n  for (const key of [\"pageTemplates\", \"databaseTemplates\", \"discussions\", \"comments\", \"attachments\"]) {\n    if (!Array.isArray(workspace[key])) workspace[key] = [];\n  }\n  workspace.attachments = workspace.attachments.map((attachment) => normalizeAttachment(attachment, time));\n  workspace.pageTemplates = workspace.pageTemplates.map((template) => ({\n    ...template,\n    name: String(template.name || \"页面模板\"),\n    content: Array.isArray(template.content) ? template.content : [],\n    createdAt: template.createdAt || time,\n    updatedAt: template.updatedAt || template.createdAt || time,\n  }));\n  workspace.databaseTemplates = workspace.databaseTemplates.map((template) => ({\n    ...template,\n    name: String(template.name || \"数据库模板\"),\n    defaultValues: template.defaultValues && typeof template.defaultValues === \"object\" ? template.defaultValues : {},\n    pageContent: Array.isArray(template.pageContent) ? template.pageContent : [],\n    pageAppearance: template.pageAppearance && typeof template.pageAppearance === \"object\" ? template.pageAppearance : null,\n    createdAt: template.createdAt || time,\n    updatedAt: template.updatedAt || template.createdAt || time,\n  }));\n  workspace.discussions = workspace.discussions.map((discussion) => ({\n    ...discussion,\n    anchor: discussion.anchor && typeof discussion.anchor === \"object\" ? discussion.anchor : { kind:\"page\" },\n    resolvedAt: discussion.resolvedAt || null,\n    createdAt: discussion.createdAt || time,\n    updatedAt: discussion.updatedAt || discussion.createdAt || time,\n  }));\n  workspace.comments = workspace.comments.map((comment) => ({\n    ...comment,\n    body: String(comment.body || \"\"),\n    authorId: comment.authorId || workspace.ui?.currentPersonId || \"person-local\",\n    createdAt: comment.createdAt || time,\n    editedAt: comment.editedAt || null,\n    deletedAt: comment.deletedAt || null,\n  }));\n  workspace.schemaVersion = 9;\n  return workspace;\n}\n\nconst LEGACY_ASSISTANT_REPLICA_KEY = \"notion-mendax-vibe-wiki-v1\";\n\nexport function migrateWorkspaceShell(input) {\n  const phase3 = migratePhase3(input);\n  if (Number(phase3.schemaVersion) >= 10) return phase3;\n  const workspace = copyJson(phase3);\n  const removedIds = new Set(\n    (workspace.pages || [])\n      .filter((page) => page.replicaKey === LEGACY_ASSISTANT_REPLICA_KEY)\n      .map((page) => page.id),\n  );\n  workspace.pages = (workspace.pages || []).filter((page) => !removedIds.has(page.id));\n  if (removedIds.has(workspace.ui?.selectedPageId)) {\n    workspace.ui = { ...(workspace.ui || {}), selectedPageId: null };\n  }\n  workspace.schemaVersion = 10;\n  return workspace;\n}\n\nexport function migrateTrashGroups(input) {\n  const shell = migrateWorkspaceShell(input);\n  if (Number(shell.schemaVersion) >= 11) return shell;\n  const workspace = copyJson(shell);\n  workspace.folders = (workspace.folders || []).map((folder) => ({ ...folder, trashedAt: folder.trashedAt ?? null, trashedByFolderId: folder.trashedByFolderId ?? null }));\n  workspace.pages = (workspace.pages || []).map((page) => ({ ...page, trashedAt: page.trashedAt ?? null, trashedByFolderId: page.trashedByFolderId ?? null, trashedByPageId: page.trashedByPageId ?? null }));\n  workspace.schemaVersion = 11;\n  return workspace;\n}\n\nexport function migrateAssetProvider(input) {\n  const previous = migrateTrashGroups(input);\n  if (Number(previous.schemaVersion) >= 12) return previous;\n  return { ...copyJson(previous), schemaVersion: 12 };\n}\n\nexport function migrateStatusGroups(input) { return assignStatusGroups(migrateAssetProvider(input)); }\n\nexport function migrateNavigationState(input) {\n  const previous = migrateStatusGroups(input);\n  if (Number(previous.schemaVersion) >= 14) return previous;\n  const workspace = copyJson(previous);\n  const ui = workspace.ui || {};\n  workspace.ui = { ...ui, recentVisits: Array.isArray(ui.recentVisits) ? ui.recentVisits : [], favoritePageIds: Array.isArray(ui.favoritePageIds) ? ui.favoritePageIds : [], sidebarWidth: typeof ui.sidebarWidth === \"number\" && ui.sidebarWidth >= 200 && ui.sidebarWidth <= 480 ? ui.sidebarWidth : 248 };\n  workspace.schemaVersion = 14;\n  return workspace;\n}\n\nexport const CURRENT_SCHEMA_VERSION = 16;\nexport function upgradeWorkspace(workspace) { return migratePageVersions(workspace); }\n\nexport function migrateInbox(input) {\n  const previous = migrateNavigationState(input);\n  if (Number(previous.schemaVersion) >= 15) return previous;\n  const workspace = copyJson(previous);\n  const time = workspace.savedAt || EPOCH;\n  if (!workspace.folders.some((folder) => folder.system === \"inbox\")) workspace.folders.push({ id: \"system-inbox\", system: \"inbox\", name: \"收件箱\", parentId: null, color: \"stone\", sortIndex: -1, lastOpenedPageId: null, trashedAt: null, trashedByFolderId: null, createdAt: time, updatedAt: time });\n  workspace.pages = workspace.pages.map((page) => ({ ...page, inboxedAt: page.inboxedAt ?? null }));\n  const ui = workspace.ui || {};\n  workspace.ui = { ...ui, firedReminderIds: Array.isArray(ui.firedReminderIds) ? ui.firedReminderIds : [], reminderLog: Array.isArray(ui.reminderLog) ? ui.reminderLog : [], lastReminderCheckAt: ui.lastReminderCheckAt ?? null };\n  workspace.schemaVersion = 15;\n  return workspace;\n}\n\nexport function migratePageVersions(input) {\n  const previous = migrateInbox(input);\n  if (Number(previous.schemaVersion) >= 16) return previous;\n  return { ...copyJson(previous), schemaVersion: 16, pageVersions: Array.isArray(previous.pageVersions) ? copyJson(previous.pageVersions) : [] };\n}\n" }],
  ["src/domain/statusGroups.js", { sha256: "DA9DF1AFA2C60768A87D4CB3FC7A86431948E2F336067D20A8873CADD052FD2A", source: "import { copyJson } from \"./blockDocument.js\";\n\nexport const STATUS_GROUPS = [\"todo\", \"inProgress\", \"complete\"];\n\nexport function statusOptionGroup(option) {\n  if (STATUS_GROUPS.includes(option?.group)) return option.group;\n  if (option?.id === \"done\" || String(option?.name || \"\").includes(\"完成\")) return \"complete\";\n  if (option?.id === \"doing\" || String(option?.name || \"\").includes(\"进行\")) return \"inProgress\";\n  return \"todo\";\n}\n\nexport function migrateStatusGroups(input) {\n  const workspace = copyJson(input || {});\n  if (Number(workspace.schemaVersion) >= 13) return workspace;\n  for (const source of workspace.dataSources || []) {\n    for (const property of source.properties || []) {\n      if (property.type === \"status\" && Array.isArray(property.options)) property.options = property.options.map((option) => ({ ...option, group: statusOptionGroup(option) }));\n    }\n  }\n  workspace.schemaVersion = 13;\n  return workspace;\n}\n" }],
  ["electron/main/storage/workspaceDb.js", { sha256: "BDE83C039DF69CDDDB063B75814E5DE7641FDBBCA505B8160D5843CB64B7A351", source: "import fs from \"node:fs\";\nimport path from \"node:path\";\nimport { DatabaseSync } from \"node:sqlite\";\nimport { pathToFileURL } from \"node:url\";\nimport { BACKUP_COLLECTIONS, requiredCollections } from \"../../../src/backup/format.js\";\nimport { CURRENT_SCHEMA_VERSION } from \"../../../src/persistence/migrations.js\";\nimport { isPlainObject, isNonEmptyString } from \"../ipc/validate.js\";\nimport { assertPhysicalPath } from \"./dataRoot.js\";\n\nexport const MAX_ENTITY_BYTES = 20 * 1024 * 1024;\nconst COLLECTIONS = new Set(BACKUP_COLLECTIONS);\nconst CORE_FIELDS = new Set([...BACKUP_COLLECTIONS, \"schemaVersion\", \"workspaceId\", \"savedAt\", \"ui\"]);\n\nexport class StorageError extends Error {\n  constructor(code, message) {\n    super(message);\n    this.name = \"StorageError\";\n    this.code = code;\n  }\n}\n\nfunction corrupt(message) {\n  return new StorageError(\"E_CORRUPT\", message);\n}\n\nfunction invalid(message) {\n  return new StorageError(\"E_INVALID_ARGUMENT\", message);\n}\n\nfunction parseJson(value, label, code = \"E_CORRUPT\") {\n  try {\n    return JSON.parse(value);\n  } catch {\n    throw new StorageError(code, `${label}的 JSON 无效`);\n  }\n}\n\nfunction serialize(value, label) {\n  try {\n    const json = JSON.stringify(value);\n    if (typeof json !== \"string\") throw invalid(`${label}无法序列化`);\n    return json;\n  } catch (error) {\n    if (error instanceof StorageError) throw error;\n    throw invalid(`${label}无法序列化`);\n  }\n}\n\nfunction validateEntity(collection, id, json, code = \"E_INVALID_ARGUMENT\") {\n  const reject = (message) => { throw new StorageError(code, message); };\n  if (!COLLECTIONS.has(collection) || !isNonEmptyString(id, 200)) reject(\"实体集合或 ID 无效\");\n  if (typeof json !== \"string\" || Buffer.byteLength(json, \"utf8\") > MAX_ENTITY_BYTES) reject(\"单个实体不能超过 20 MB\");\n  const entity = parseJson(json, \"实体\", code);\n  if (!isPlainObject(entity) || entity.id !== id) reject(\"实体必须是对象，且 ID 必须一致\");\n  return entity;\n}\n\nfunction transaction(db, operation) {\n  db.exec(\"BEGIN IMMEDIATE\");\n  try {\n    const result = operation();\n    db.exec(\"COMMIT\");\n    return result;\n  } catch (error) {\n    try { db.exec(\"ROLLBACK\"); } catch {}\n    throw error;\n  }\n}\n\nfunction coreMeta(workspace, generation) {\n  if (!isPlainObject(workspace) || !Number.isSafeInteger(workspace.schemaVersion) || workspace.schemaVersion < 1 || !isPlainObject(workspace.ui)) throw invalid(\"工作区元数据无效\");\n  if (workspace.workspaceId !== undefined && !isNonEmptyString(workspace.workspaceId, 200)) throw invalid(\"工作区 ID 无效\");\n  if (!isNonEmptyString(generation, 200)) throw invalid(\"工作区代次无效\");\n  const extras = Object.fromEntries(Object.entries(workspace).filter(([key]) => !CORE_FIELDS.has(key)));\n  return new Map([\n    [\"schemaVersion\", serialize(workspace.schemaVersion, \"版本\")],\n    [\"workspaceId\", serialize(workspace.workspaceId ?? null, \"工作区 ID\")],\n    ...(Object.prototype.hasOwnProperty.call(workspace, \"savedAt\") ? [[\"savedAt\", serialize(workspace.savedAt, \"保存时间\")]] : []),\n    [\"ui\", serialize(workspace.ui, \"工作区设置\")],\n    [\"generation\", serialize(generation, \"工作区代次\")],\n    [\"extras\", serialize(extras, \"附加字段\")],\n    [\"collectionOrder\", serialize(Object.fromEntries(BACKUP_COLLECTIONS.map((collection) => [collection, (workspace[collection] || []).map((entity) => entity.id)])), \"集合顺序\")],\n  ]);\n}\n\nfunction workspaceEntities(workspace) {\n  const entities = new Map();\n  for (const collection of BACKUP_COLLECTIONS) {\n    const values = workspace[collection];\n    if (values === undefined && !requiredCollections(workspace.schemaVersion).includes(collection)) continue;\n    if (!Array.isArray(values)) throw invalid(`集合 ${collection} 必须是数组`);\n    const entries = new Map();\n    for (const entity of values) {\n      const json = serialize(entity, \"实体\");\n      validateEntity(collection, entity?.id, json);\n      if (entries.has(entity.id)) throw invalid(\"同一集合不能出现重复 ID\");\n      entries.set(entity.id, json);\n    }\n    entities.set(collection, entries);\n  }\n  return entities;\n}\n\nfunction writeMeta(db, entries) {\n  const statement = db.prepare(\"INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value\");\n  for (const [key, value] of entries) statement.run(key, value);\n}\n\nfunction writeEntities(db, entries, now) {\n  const statement = db.prepare(\"INSERT INTO entities(collection, id, json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at\");\n  for (const [collection, entities] of entries) {\n    for (const [id, json] of entities) {\n      const entity = JSON.parse(json);\n      statement.run(collection, id, json, typeof entity.updatedAt === \"string\" ? entity.updatedAt : now);\n    }\n  }\n}\n\nexport function openWorkspaceDatabase(file, { readOnly = false, immutable } = {}) {\n  const filePath = assertPhysicalPath(file, { allowMissing: !readOnly });\n  if (!readOnly) fs.mkdirSync(path.dirname(filePath), { recursive: true });\n  const walPath = `${filePath}-wal`;\n  if (readOnly && fs.existsSync(walPath)) assertPhysicalPath(walPath, { root: path.dirname(filePath), allowMissing: false });\n  const useImmutable = readOnly && (immutable ?? (!fs.existsSync(walPath) || fs.statSync(walPath).size === 0));\n  const db = new DatabaseSync(useImmutable ? `${pathToFileURL(filePath).href}?immutable=1` : filePath, { readOnly });\n  try {\n    db.exec(\"PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;\");\n    return db;\n  } catch (error) {\n    db.close();\n    throw error;\n  }\n}\n\nexport function quickCheck(db) {\n  try {\n    const problems = db.prepare(\"PRAGMA quick_check\").all().map((row) => Object.values(row)[0]);\n    return problems.length === 1 && problems[0] === \"ok\" ? \"ok\" : problems.join(\"; \") || \"数据库检查没有返回结果\";\n  } catch (error) {\n    return error.message;\n  }\n}\n\nexport function prepareWritable(db) {\n  db.exec(`PRAGMA journal_mode=WAL;\n    PRAGMA synchronous=FULL;\n    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);\n    CREATE TABLE IF NOT EXISTS entities(collection TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(collection, id)) WITHOUT ROWID;\n    CREATE TABLE IF NOT EXISTS assets(sha256 TEXT PRIMARY KEY, size INTEGER NOT NULL, mime TEXT NOT NULL, original_name TEXT, created_at TEXT NOT NULL);`);\n}\n\nexport function readAllRows(db) {\n  try {\n    const meta = new Map();\n    for (const row of db.prepare(\"SELECT key, value FROM meta\").all()) {\n      if (typeof row.key !== \"string\" || typeof row.value !== \"string\" || meta.has(row.key)) throw corrupt(\"数据库元数据无效\");\n      meta.set(row.key, row.value);\n    }\n    const entities = new Map(BACKUP_COLLECTIONS.map((collection) => [collection, new Map()]));\n    for (const row of db.prepare(\"SELECT collection, id, json FROM entities\").all()) {\n      const collection = entities.get(row.collection);\n      if (!collection || collection.has(row.id)) throw corrupt(\"数据库实体集合无效\");\n      if (!isNonEmptyString(row.id, 200) || typeof row.json !== \"string\") throw corrupt(\"数据库实体无效\");\n      collection.set(row.id, row.json);\n    }\n    if (meta.has(\"collectionOrder\")) {\n      const order = parseJson(meta.get(\"collectionOrder\"), \"集合顺序\");\n      if (!isPlainObject(order)) throw corrupt(\"集合顺序无效\");\n      for (const [collection, ids] of Object.entries(order)) {\n        const values = entities.get(collection);\n        if (!values || !Array.isArray(ids) || new Set(ids).size !== ids.length || ids.length !== values.size || ids.some((id) => !isNonEmptyString(id, 200) || !values.has(id))) throw corrupt(\"集合顺序与数据库内容不一致\");\n        entities.set(collection, new Map(ids.map((id) => [id, values.get(id)])));\n      }\n    }\n    return { meta, entities };\n  } catch (error) {\n    if (error instanceof StorageError) throw error;\n    throw corrupt(\"数据库数据无法读取\");\n  }\n}\n\nexport function assembleWorkspace(rows) {\n  const parsed = new Map([...rows.meta].map(([key, value]) => [key, parseJson(value, `元数据 ${key}`)]));\n  const schemaVersion = parsed.get(\"schemaVersion\");\n  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1 || !isPlainObject(parsed.get(\"ui\"))) throw corrupt(\"工作区元数据无效\");\n  if (!isNonEmptyString(parsed.get(\"generation\"), 200)) throw corrupt(\"工作区代次无效\");\n  const workspaceId = parsed.get(\"workspaceId\");\n  if (workspaceId !== null && workspaceId !== undefined && !isNonEmptyString(workspaceId, 200)) throw corrupt(\"工作区 ID 无效\");\n  const extras = parsed.get(\"extras\") ?? {};\n  if (!isPlainObject(extras) || Object.keys(extras).some((key) => CORE_FIELDS.has(key))) throw corrupt(\"工作区附加字段无效\");\n  const workspace = { ...extras, schemaVersion };\n  if (parsed.has(\"savedAt\")) workspace.savedAt = parsed.get(\"savedAt\");\n  if (workspaceId !== null && workspaceId !== undefined) workspace.workspaceId = workspaceId;\n  for (const collection of BACKUP_COLLECTIONS) {\n    const values = rows.entities.get(collection) || new Map();\n    if (values.size || requiredCollections(schemaVersion).includes(collection)) workspace[collection] = [...values].map(([id, json]) => validateEntity(collection, id, json, \"E_CORRUPT\"));\n  }\n  workspace.ui = parsed.get(\"ui\");\n  return workspace;\n}\n\nexport function initializeWorkspace(db, workspace, { generation, now }) {\n  const meta = coreMeta(workspace, generation);\n  const entities = workspaceEntities(workspace);\n  if (db.prepare(\"SELECT COUNT(*) AS count FROM entities\").get().count || db.prepare(\"SELECT COUNT(*) AS count FROM meta\").get().count) throw invalid(\"只能初始化空数据库\");\n  transaction(db, () => {\n    writeMeta(db, meta);\n    writeEntities(db, entities, now);\n  });\n}\n\nexport function writeWorkspaceDiff(db, rows, workspace, { now }) {\n  const generation = parseJson(rows.meta.get(\"generation\"), \"工作区代次\");\n  const meta = coreMeta(workspace, generation);\n  const next = workspaceEntities(workspace);\n  const changed = new Map();\n  const removed = [];\n  for (const collection of BACKUP_COLLECTIONS) {\n    const previous = rows.entities.get(collection) || new Map();\n    const following = next.get(collection) || new Map();\n    const changedCollection = new Map([...following].filter(([id, json]) => previous.get(id) !== json));\n    if (changedCollection.size) changed.set(collection, changedCollection);\n    for (const id of previous.keys()) if (!following.has(id)) removed.push({ collection, id });\n  }\n  const changedMeta = new Map([...meta].filter(([key, value]) => rows.meta.get(key) !== value));\n  if (!changed.size && !removed.length && !changedMeta.size) return { changed: false, savedAt: workspace.savedAt };\n  changedMeta.set(\"savedAt\", serialize(now, \"保存时间\"));\n  transaction(db, () => {\n    writeEntities(db, changed, now);\n    const remove = db.prepare(\"DELETE FROM entities WHERE collection=? AND id=?\");\n    for (const entry of removed) remove.run(entry.collection, entry.id);\n    writeMeta(db, changedMeta);\n  });\n  return { changed: true, savedAt: now };\n}\n\nexport function validateChangeset(changeset, { currentSchemaVersion = CURRENT_SCHEMA_VERSION } = {}) {\n  if (!isPlainObject(changeset) || !isNonEmptyString(changeset.generation, 200) || !Number.isSafeInteger(changeset.schemaVersion) || changeset.schemaVersion < 1 || changeset.schemaVersion > currentSchemaVersion) throw invalid(\"保存批次元数据无效\");\n  if (!Array.isArray(changeset.upserts) || !Array.isArray(changeset.deletes) || changeset.ui !== null && !isPlainObject(changeset.ui)) throw invalid(\"保存批次格式无效\");\n  const touched = new Set();\n  for (const entry of changeset.upserts) {\n    if (!isPlainObject(entry)) throw invalid(\"实体格式无效\");\n    validateEntity(entry.collection, entry.id, entry.json);\n    const key = `${entry.collection}\\0${entry.id}`;\n    if (touched.has(key)) throw invalid(\"一个批次不能重复操作同一实体\");\n    touched.add(key);\n  }\n  for (const entry of changeset.deletes) {\n    if (!isPlainObject(entry) || !COLLECTIONS.has(entry.collection) || !isNonEmptyString(entry.id, 200)) throw invalid(\"删除条目无效\");\n    const key = `${entry.collection}\\0${entry.id}`;\n    if (touched.has(key)) throw invalid(\"一个批次不能重复操作同一实体\");\n    touched.add(key);\n  }\n  if (changeset.ui !== null) serialize(changeset.ui, \"工作区设置\");\n  return changeset;\n}\n\nexport function applyChangeset(db, changeset, { now, expectedGeneration, currentSchemaVersion = CURRENT_SCHEMA_VERSION }) {\n  validateChangeset(changeset, { currentSchemaVersion });\n  if (changeset.generation !== expectedGeneration) throw new StorageError(\"E_CONFLICT\", \"工作区已被恢复，请重新打开后再编辑\");\n  return transaction(db, () => {\n    const currentGeneration = parseJson(db.prepare(\"SELECT value FROM meta WHERE key='generation'\").get()?.value, \"工作区代次\");\n    if (changeset.generation !== currentGeneration) throw new StorageError(\"E_CONFLICT\", \"工作区已被恢复，请重新打开后再编辑\");\n    const previousSchema = parseJson(db.prepare(\"SELECT value FROM meta WHERE key='schemaVersion'\").get()?.value, \"工作区版本\");\n    if (changeset.schemaVersion < previousSchema) throw new StorageError(\"E_CONFLICT\", \"不能使用旧版本覆盖工作区\");\n    const existingOrderJson = db.prepare(\"SELECT value FROM meta WHERE key='collectionOrder'\").get()?.value;\n    const existingOrder = existingOrderJson ? parseJson(existingOrderJson, \"集合顺序\") : Object.fromEntries([...readAllRows(db).entities].map(([collection, values]) => [collection, [...values.keys()]]));\n    const entries = new Map();\n    for (const entry of changeset.upserts) {\n      if (!entries.has(entry.collection)) entries.set(entry.collection, new Map());\n      entries.get(entry.collection).set(entry.id, entry.json);\n    }\n    writeEntities(db, entries, now);\n    const remove = db.prepare(\"DELETE FROM entities WHERE collection=? AND id=?\");\n    for (const entry of changeset.deletes) remove.run(entry.collection, entry.id);\n    const meta = new Map([[\"savedAt\", serialize(now, \"保存时间\")], [\"schemaVersion\", serialize(changeset.schemaVersion, \"版本\")]]);\n    if (changeset.ui !== null) meta.set(\"ui\", serialize(changeset.ui, \"工作区设置\"));\n    const touchedCollections = new Set([...changeset.upserts, ...changeset.deletes].map((entry) => entry.collection));\n    const order = { ...existingOrder };\n    for (const collection of touchedCollections) {\n      const upsertIds = changeset.upserts.filter((entry) => entry.collection === collection).map((entry) => entry.id);\n      const deleted = new Set(changeset.deletes.filter((entry) => entry.collection === collection).map((entry) => entry.id));\n      const retained = (order[collection] || []).filter((id) => !deleted.has(id));\n      const already = new Set(retained);\n      const added = upsertIds.filter((id) => !already.has(id));\n      const live = new Set([...retained, ...added]);\n      if (upsertIds.length === live.size && upsertIds.every((id) => live.has(id))) order[collection] = upsertIds;\n      else order[collection] = [...retained, ...added];\n    }\n    const orderJson = serialize(order, \"集合顺序\");\n    if (orderJson !== existingOrderJson) meta.set(\"collectionOrder\", orderJson);\n    writeMeta(db, meta);\n    return { savedAt: now };\n  });\n}\n\nexport function replaceDatabaseWorkspace(db, workspace, { generation, now }) {\n  const meta = coreMeta(workspace, generation);\n  const entities = workspaceEntities(workspace);\n  transaction(db, () => {\n    db.exec(\"DELETE FROM entities\");\n    if (!meta.has(\"savedAt\")) db.prepare(\"DELETE FROM meta WHERE key='savedAt'\").run();\n    writeEntities(db, entities, now);\n    writeMeta(db, meta);\n  });\n  return { savedAt: workspace.savedAt, generation };\n}\n\nfunction validateAssetRow(row) {\n  if (!isPlainObject(row) || !/^[a-f0-9]{64}$/.test(row.sha256 ?? \"\") || !Number.isSafeInteger(row.size) || row.size < 0\n    || typeof row.mime !== \"string\" || row.mime.length > 200 || /[\\r\\n\\0]/.test(row.mime)\n    || row.originalName !== null && (typeof row.originalName !== \"string\" || row.originalName.length > 255 || /[\\r\\n\\0]/.test(row.originalName))\n    || ![\"string\", \"number\"].includes(typeof row.createdAt)) throw new StorageError(\"E_CORRUPT\", \"附件元数据无效\");\n  return row;\n}\n\nexport function readAssetRows(db) {\n  if (!db) throw new StorageError(\"E_IO\", \"附件数据库尚未就绪\");\n  return db.prepare(\"SELECT sha256, size, mime, original_name, created_at FROM assets\").all().map((row) => validateAssetRow({ sha256: row.sha256, size: row.size, mime: row.mime, originalName: row.original_name, createdAt: row.created_at }));\n}\n\nexport function deleteAssetRows(db, sha256s) {\n  if (!Array.isArray(sha256s) || sha256s.some((sha256) => typeof sha256 !== \"string\" || !/^[a-f0-9]{64}$/.test(sha256))) throw invalid(\"附件标识无效\");\n  return transaction(db, () => {\n    const statement = db.prepare(\"DELETE FROM assets WHERE sha256=?\");\n    return sha256s.reduce((count, sha256) => count + Number(statement.run(sha256).changes), 0);\n  });\n}\n\nexport function restoreAssetRows(db, rows) {\n  if (!Array.isArray(rows)) throw invalid(\"附件元数据无效\");\n  rows.forEach(validateAssetRow);\n  return transaction(db, () => {\n    const existing = db.prepare(\"SELECT size FROM assets WHERE sha256=?\");\n    const statement = db.prepare(\"INSERT OR IGNORE INTO assets(sha256, size, mime, original_name, created_at) VALUES (?, ?, ?, ?, ?)\");\n    for (const row of rows) {\n      const previous = existing.get(row.sha256);\n      if (previous && previous.size !== row.size) throw new StorageError(\"E_CORRUPT\", \"现有附件元数据与回收站不一致\");\n      statement.run(row.sha256, row.size, row.mime, row.originalName, row.createdAt);\n    }\n  });\n}\n\nexport function vacuumInto(db, targetFile) {\n  const target = assertPhysicalPath(targetFile);\n  if (fs.existsSync(target)) throw invalid(\"快照目标文件已存在\");\n  fs.mkdirSync(path.dirname(target), { recursive: true });\n  db.prepare(\"VACUUM INTO ?\").run(target);\n  return target;\n}\n" }],
]);

async function loadFrozenBoundaryModules(paths) {
  const frozenUrls = new Map();
  const sourcesByUrl = new Map();
  for (const [relativePath, frozen] of FROZEN_SOURCES) {
    assert.equal(createHash("sha256").update(frozen.source, "utf8").digest("hex").toUpperCase(), frozen.sha256, `Frozen source hash: ${relativePath}`);
    const originalUrl = new URL(`../${relativePath}`, import.meta.url).href;
    const frozenUrl = `${originalUrl}?workspace-copy-boundaries-before01`;
    frozenUrls.set(originalUrl, frozenUrl);
    sourcesByUrl.set(frozenUrl, frozen.source);
  }
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      if (!sourcesByUrl.has(context.parentURL)) return resolved;
      const original = new URL(resolved.url);
      original.search = "";
      const frozenUrl = frozenUrls.get(original.href);
      return frozenUrl ? { ...resolved, url: frozenUrl } : resolved;
    },
    load(url, context, nextLoad) {
      if (sourcesByUrl.has(url)) return { format: "module", source: sourcesByUrl.get(url), shortCircuit: true };
      return nextLoad(url, context);
    },
  });
  try {
    const results = await Promise.allSettled(paths.map((relativePath) => import(frozenUrls.get(new URL(`../${relativePath}`, import.meta.url).href))));
    const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (failures.length) throw new AggregateError(failures, "Frozen boundary module imports failed");
    return results.map((result) => result.value);
  } finally {
    hooks.deregister();
  }
}

const [beforeNormalize, beforeMigrations, beforeStatusGroups] = await loadFrozenBoundaryModules([
  "src/persistence/normalize.js",
  "src/persistence/migrations.js",
  "src/domain/statusGroups.js",
]);

function assertOwnKeyShape(actual, expected, label = "$", seen = new WeakMap()) {
  if (!expected || typeof expected !== "object") return;
  if (seen.has(expected)) {
    assert.equal(seen.get(expected), actual, `${label}: repeated reference`);
    return;
  }
  seen.set(expected, actual);
  assert.deepStrictEqual(Reflect.ownKeys(actual), Reflect.ownKeys(expected), `${label}: own keys`);
  for (const key of Reflect.ownKeys(expected)) assertOwnKeyShape(actual[key], expected[key], `${label}.${String(key)}`, seen);
}

function assertEquivalent(actual, expected, label) {
  assert.deepStrictEqual(actual, expected, label);
  assertOwnKeyShape(actual, expected, label);
}

function expectedV20Upgrade(expected) {
  if (Number(expected.schemaVersion) >= 20) return expected;
  // Keep the frozen oracle and account for the added schema 20 fields here.
  return {
    ...expected,
    schemaVersion: 20,
    databaseVersions: Array.isArray(expected.databaseVersions) ? expected.databaseVersions : [],
    pages: expected.pages.map((page) => ({
      ...page,
      archivedAt: page.archivedAt || null,
      content: expectedV20BlockDeclarations(page.content),
      ...(page.pageType === "database" && page.databaseSourceId && !page.databaseSourceIds ? { databaseSourceIds: [page.databaseSourceId] } : {}),
    })),
    databaseItems: expected.databaseItems.map((item) => ({ ...item, dependencyIds: Array.isArray(item.dependencyIds) ? item.dependencyIds : [] })),
    syncedSources: (expected.syncedSources ?? []).map((source) => ({ ...source, blocks: expectedV20BlockDeclarations(source.blocks) })),
    pageTemplates: (expected.pageTemplates ?? []).map((template) => ({ ...template, content: expectedV20BlockDeclarations(template.content) })),
    databaseTemplates: (expected.databaseTemplates ?? []).map((template) => ({ ...template, pageContent: expectedV20BlockDeclarations(template.pageContent) })),
  };
}

function snapshotGraph(value, copies = new Map()) {
  if (!value || typeof value !== "object") return value;
  if (copies.has(value)) return copies.get(value);
  const result = value instanceof Date ? new Date(value.getTime()) : Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
  copies.set(value, result);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (Object.hasOwn(descriptor, "value")) descriptor.value = snapshotGraph(descriptor.value, copies);
    Object.defineProperty(result, key, descriptor);
  }
  return result;
}

function collectObjects(value, references = new Set()) {
  if (!value || typeof value !== "object" || references.has(value)) return references;
  references.add(value);
  for (const key of Reflect.ownKeys(value)) collectObjects(value[key], references);
  return references;
}

function freezeGraph(value) {
  for (const reference of collectObjects(value)) Object.freeze(reference);
  return value;
}

function assertDetached(result, inputs, label) {
  const borrowed = new Set();
  for (const input of inputs) collectObjects(input, borrowed);
  for (const reference of collectObjects(result)) assert.equal(borrowed.has(reference), false, `${label}: output retains an input or fallback object`);
}

function compareNormalization(makeCase, label) {
  const run = (normalize) => {
    const value = makeCase();
    const inputBefore = snapshotGraph(value.input);
    const fallbackBefore = snapshotGraph(value.fallbackWorkspace);
    freezeGraph(value.input);
    freezeGraph(value.fallbackWorkspace);
    const ids = [];
    const result = normalize(value.input, {
      fallbackWorkspace: value.fallbackWorkspace,
      now: value.now ?? NOW,
      idFactory(prefix) { ids.push(prefix); return `${prefix}-copy-boundary-${ids.length}`; },
    });
    assertEquivalent(value.input, inputBefore, `${label}: input purity`);
    assertEquivalent(value.fallbackWorkspace, fallbackBefore, `${label}: fallback purity`);
    assertDetached(result, [value.input, value.fallbackWorkspace], label);
    return { result, value, inputBefore, fallbackBefore, ids };
  };
  const expected = run(beforeNormalize.normalizeLoadedWorkspace);
  const actual = run(normalizeLoadedWorkspace);
  const frozen = { ...expected.result };
  const legacy = Number(frozen.schemaVersion) < 20;
  const addsWorkspaceId = legacy && expected.ids.length > 0;
  const loadInput = expected.value.input ?? expected.value.fallbackWorkspace;
  const addsPageVersions = legacy && Number(loadInput?.schemaVersion) >= 16 && !Object.hasOwn(loadInput, "pageVersions");
  // The legacy migration runs before the normalizer appends an injected ID or a missing history collection.
  if (addsWorkspaceId) delete frozen.workspaceId;
  if (addsPageVersions) delete frozen.pageVersions;
  const upgraded = expectedV20Upgrade(frozen);
  const normalizationExpected = {
    ...upgraded,
    ...(addsWorkspaceId ? { workspaceId: expected.result.workspaceId } : {}),
    pageVersions: expected.result.pageVersions,
    databaseVersions: Array.isArray(upgraded.databaseVersions) ? upgraded.databaseVersions : [],
  };
  assertEquivalent(actual.result, normalizationExpected, `${label}: frozen output with current schema`);
  assert.deepStrictEqual(actual.ids, expected.ids, `${label}: ID factory calls`);
  assert.deepStrictEqual(actual.value.trace ?? [], expected.value.trace ?? [], `${label}: toJSON calls`);
  return { actual, expected };
}

function schemaCase(schemaVersion) {
  const input = fullWorkspace();
  input.schemaVersion = schemaVersion;
  input.extension = { nested: [{ schemaVersion }], nonFinite: NaN, absent: undefined, date: new Date(FIXTURE_TIME) };
  input.ui.preferences = { theme: "invalid", defaultFont: "invalid", startPage: "invalid", extension: { nested: ["keep", schemaVersion], absent: undefined } };
  for (const field of ["icon", "iconColor", "cover", "summary", "summaryUpdatedAt", "tags", "createdAt", "updatedAt"]) delete input.pages[0][field];
  input.pages[0].contentRevision = NaN;
  input.pages[0].summarySourceRevision = Infinity;
  input.pages[0].settings = { fontFamily: "invalid", smallText: true, fullWidth: true, locked: true };
  delete input.folders[0].createdAt;
  delete input.folders[0].updatedAt;
  for (const source of input.dataSources) for (const property of source.properties) for (const option of property.options ?? []) delete option.group;
  if (Number(schemaVersion) < 8) {
    input.databaseViews[0].filter = { or: [{ propertyId: "title", operator: "contains", value: "任务" }] };
    delete input.databaseViews[1].filter;
  }
  if (Number(schemaVersion) < 7) {
    input.pages[0].content.push(
      { type: "tabs", props: { tabs: "旧一|旧二", active: 1 }, children: [{ type: "paragraph", content: "旧正文" }] },
      { type: "syncedBlock", props: { syncKey: "legacy-key" }, children: [{ type: "paragraph", content: "版本一" }] },
      { type: "syncedBlock", props: { syncKey: "legacy-key" }, children: [{ type: "paragraph", content: "版本二" }] },
      { type: "databaseView", props: { sourceId: "ds-inline", viewId: "v-inline-table", presentation: "chart" } },
    );
  }
  // History retention has its own regression tests. This fixture tests JSON copying and migration.
  input.pageVersions = [
    createPageVersion(input.pages[1], { id: "pv-retained", reason: "before-edit", now: FIXTURE_TIME }),
  ];
  return { input, fallbackWorkspace: fullWorkspace() };
}

for (let schemaVersion = 1; schemaVersion <= CURRENT_SCHEMA_VERSION + 1; schemaVersion += 1) {
  test(`Stage1 normalization matches frozen output, keys and purity for schema ${schemaVersion}`, () => {
    const { actual } = compareNormalization(() => schemaCase(schemaVersion), `schema ${schemaVersion}`);
    assert.equal(actual.result.schemaVersion, Math.max(CURRENT_SCHEMA_VERSION, schemaVersion));
    assert.deepStrictEqual(actual.ids, ["ws"]);
    assert.equal(actual.result.workspaceId, "ws-copy-boundary-1");
    assert.equal(actual.result.pages[0].icon, "📄");
    assert.equal(actual.result.pages[0].contentRevision, 0);
    assert.equal(actual.result.pages[0].summarySourceRevision, 0);
    assert.equal(actual.result.pages[0].createdAt, FIXTURE_TIME);
    assert.equal(actual.result.ui.preferences.theme, "system");
    assert.equal(actual.result.ui.preferences.defaultFont, "default");
    assert.equal(actual.result.ui.preferences.startPage, "last");
    assert.deepStrictEqual(actual.result.ui.preferences.extension.nested, ["keep", schemaVersion]);
    assert.deepStrictEqual(actual.result.pageVersions.map((version) => version.id), ["pv-retained"]);
    actual.result.pages[0].content[0].content = "changed output";
    actual.result.ui.preferences.extension.nested.push("output-only");
    assertEquivalent(actual.value.input, actual.inputBefore, "mutation does not reach input");
    assertEquivalent(actual.value.fallbackWorkspace, actual.fallbackBefore, "mutation does not reach fallback");
  });
}

test("Stage1 dispatch uses the canonicalized schema for root toJSON in both directions", () => {
  for (const [rawSchema, canonicalSchema] of [[CURRENT_SCHEMA_VERSION, 10], [10, CURRENT_SCHEMA_VERSION], [CURRENT_SCHEMA_VERSION + 1, 1], [1, CURRENT_SCHEMA_VERSION + 1]]) {
    const { actual } = compareNormalization(() => {
      const trace = [];
      const { input, fallbackWorkspace } = schemaCase(rawSchema);
      input.toJSON = function (key) { trace.push(["root", key]); return { ...this, schemaVersion: canonicalSchema }; };
      return { input, fallbackWorkspace, trace };
    }, `root toJSON ${rawSchema} -> ${canonicalSchema}`);
    assert.deepStrictEqual(actual.value.trace, [["root", ""]]);
    assert.equal(actual.result.schemaVersion, Math.max(CURRENT_SCHEMA_VERSION, canonicalSchema));
    assert.equal(actual.value.input.schemaVersion, rawSchema);
    assert.equal(actual.result.folders.some((folder) => folder.system === "inbox"), canonicalSchema < 15);
  }
});

test("Stage1 keeps JSON NaN, Infinity, Date, undefined and string-schema boundaries", () => {
  for (const schemaVersion of [NaN, Infinity, -Infinity, "16", String(CURRENT_SCHEMA_VERSION), String(CURRENT_SCHEMA_VERSION + 1), 0, null, undefined]) {
    const { actual } = compareNormalization(() => schemaCase(schemaVersion), `JSON schema ${String(schemaVersion)}`);
    assert.equal(actual.result.extension.nonFinite, null);
    assert.equal(actual.result.extension.date, FIXTURE_TIME);
    assert.equal(Object.hasOwn(actual.result.extension, "absent"), false);
    assert.equal(actual.result.pages[0].summarySourceRevision, 0);
  }
});

test("Stage1 current/future normalization detaches fallback UI, preferences, pages and folders", () => {
  for (const schemaVersion of [16, CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION + 1]) {
    const { actual } = compareNormalization(() => {
      const fallbackWorkspace = fullWorkspace();
      fallbackWorkspace.ui.preferences = {
        theme: "dark", defaultFont: "mono", startPage: "home",
        extension: { nested: [{ label: "fallback" }], nonFinite: Infinity, date: new Date(FIXTURE_TIME), absent: undefined },
      };
      fallbackWorkspace.ui.extension = { nested: { selected: ["p-a1"] }, absent: undefined };
      return { input: { schemaVersion, savedAt: FIXTURE_TIME }, fallbackWorkspace };
    }, `fallback schema ${schemaVersion}`);
    assert.equal(actual.result.ui.preferences.theme, "dark");
    assert.equal(actual.result.ui.preferences.extension.nonFinite, null);
    assert.equal(actual.result.ui.preferences.extension.date, FIXTURE_TIME);
    assert.equal(Object.hasOwn(actual.result.ui.preferences.extension, "absent"), false);
    assert.equal(Object.hasOwn(actual.result.ui.extension, "absent"), false);
    actual.result.ui.preferences.extension.nested[0].label = "output-only";
    actual.result.ui.extension.nested.selected.push("output-only");
    actual.result.pages[0].content.push({ id: "output-only", type: "paragraph", content: "output-only" });
    actual.result.folders[0].name = "output-only";
    assertEquivalent(actual.value.fallbackWorkspace, actual.fallbackBefore, "fallback stays unchanged after output mutation");
  }
});

test("Stage1 UI wrapper preserves key-sensitive fallback toJSON and omitted own UI", () => {
  for (const schemaVersion of [10, 16, CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION + 1]) for (const omitUi of [false, true]) {
    const { actual } = compareNormalization(() => {
      const trace = [];
      const fallbackWorkspace = fullWorkspace();
      fallbackWorkspace.ui.toJSON = function (key) {
        trace.push(["fallback-ui", key]);
        return omitUi ? undefined : { preferences: { extension: { key } }, selectedPageId: this.selectedPageId };
      };
      return { input: { schemaVersion, savedAt: FIXTURE_TIME }, fallbackWorkspace, trace };
    }, `fallback UI toJSON schema ${schemaVersion}, omit ${omitUi}`);
    assert.deepStrictEqual(actual.value.trace, [["fallback-ui", "ui"]]);
    if (schemaVersion >= 16) assert.equal(Object.hasOwn(actual.result, "ui"), !omitUi);
    if (!omitUi) assert.equal(actual.result.ui.preferences.extension.key, "ui");
  }
});

test("Stage1 fallback preference toJSON receives its nested preferences key after merging defaults", () => {
  const { actual } = compareNormalization(() => {
    const trace = [];
    const fallbackWorkspace = fullWorkspace();
    fallbackWorkspace.ui.preferences = {
      theme: "dark", defaultFont: "invalid", startPage: "invalid", extension: { list: ["keep"] },
      toJSON(key) { trace.push(["preferences", key]); return { key, theme: this.theme, defaultFont: this.defaultFont, startPage: this.startPage, extension: this.extension }; },
    };
    return { input: { schemaVersion: CURRENT_SCHEMA_VERSION, savedAt: FIXTURE_TIME }, fallbackWorkspace, trace };
  }, "fallback preferences toJSON");
  assert.deepStrictEqual(actual.value.trace, [["preferences", "preferences"]]);
  assert.equal(actual.result.ui.preferences.key, "preferences");
  assert.equal(actual.result.ui.preferences.defaultFont, "default");
  assert.equal(actual.result.ui.preferences.startPage, "last");
});

test("Stage1 missing input retains fallback canonicalization and injected ID behavior", () => {
  for (const input of [undefined, null, false, "invalid"]) {
    const { actual } = compareNormalization(() => ({ input, fallbackWorkspace: schemaCase(16).input }), `missing input ${String(input)}`);
    assert.deepStrictEqual(actual.ids, ["ws"]);
    assert.equal(actual.result.extension.nonFinite, null);
    assert.equal(actual.result.extension.date, FIXTURE_TIME);
  }
  const input = schemaCase(16).input;
  input.workspaceId = "existing-workspace";
  const { actual } = compareNormalization(() => ({ input, fallbackWorkspace: fullWorkspace() }), "existing workspace ID");
  assert.deepStrictEqual(actual.ids, []);
  assert.equal(actual.result.workspaceId, "existing-workspace");
  assert.throws(() => normalizeLoadedWorkspace(schemaCase(16).input, { now: NOW }), /缺少工作区 ID 生成器/);
  assert.throws(() => beforeNormalize.normalizeLoadedWorkspace(schemaCase(16).input, { now: NOW }), /缺少工作区 ID 生成器/);
});

const publicMigrators = [
  "migratePhase1", "migratePhase2", "migratePhase3", "migrateWorkspaceShell", "migrateTrashGroups",
  "migrateAssetProvider", "migrateStatusGroups", "migrateNavigationState", "migrateInbox", "migratePageVersions", "upgradeWorkspace",
];

for (const name of publicMigrators) {
  test(`Stage1 public ${name} stays equivalent, fresh and detached`, () => {
    for (const schemaVersion of [1, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION + 1]) {
      const input = schemaCase(schemaVersion).input;
      const inputBefore = snapshotGraph(input);
      freezeGraph(input);
      const expected = beforeMigrations[name](input);
      const actual = migrations[name](input);
      assertEquivalent(actual, name === "upgradeWorkspace" ? expectedV20Upgrade(expected) : expected, `${name} schema ${schemaVersion}`);
      assert.notEqual(actual, input);
      assertDetached(actual, [input], `${name} schema ${schemaVersion}`);
      actual.extension.nested.push("output-only");
      assertEquivalent(input, inputBefore, `${name}: input purity after mutation`);
    }
  });
}

test("Stage1 standalone status-group migrator remains fresh, canonical and detached", () => {
  for (const schemaVersion of [1, 12, 13, 16, 17]) {
    const input = schemaCase(schemaVersion).input;
    const inputBefore = snapshotGraph(input);
    freezeGraph(input);
    const expected = beforeStatusGroups.migrateStatusGroups(input);
    const actual = migrateStatusGroups(input);
    assertEquivalent(actual, expected, `standalone status schema ${schemaVersion}`);
    assertDetached(actual, [input], "standalone status purity");
    actual.dataSources[0].properties.push({ id: "output-only", type: "text" });
    assertEquivalent(input, inputBefore, "standalone status mutation does not reach input");
  }
});

test("Stage1 Phase 2 retains own undefined filter while the Phase 3 JSON boundary removes it", () => {
  const input = fullWorkspace();
  input.schemaVersion = 7;
  for (const view of input.databaseViews) delete view.filter;
  const phase2 = migrations.migratePhase2(input);
  assertEquivalent(phase2, beforeMigrations.migratePhase2(input), "Phase 2 own-key boundary");
  assert.equal(Object.hasOwn(phase2.databaseViews[0], "filter"), true);
  assert.equal(phase2.databaseViews[0].filter, undefined);
  const phase3 = migrations.migratePhase3(phase2);
  assertEquivalent(phase3, beforeMigrations.migratePhase3(phase2), "Phase 3 own-key boundary");
  assert.equal(Object.hasOwn(phase3.databaseViews[0], "filter"), false);
  assert.equal(Object.hasOwn(phase2.databaseViews[0], "filter"), true);
  assert.equal(Object.hasOwn(input.databaseViews[0], "filter"), false);
});
