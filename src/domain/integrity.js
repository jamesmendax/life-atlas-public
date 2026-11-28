import { walkBlocks } from "./blockDocument.js";
import { attachmentReferences } from "./trash.js";
import { resolveDatabaseOccurrenceViews } from "./databaseOccurrenceViews.js";
import { createRelationValueValidator } from "./relationValidation.js";

function ids(value) {
  return Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
}

function visitInline(value, visit) {
  if (Array.isArray(value)) {
    for (const entry of value) visitInline(entry, visit);
  } else if (value && typeof value === "object") {
    visit(value);
    for (const entry of Object.values(value)) visitInline(entry, visit);
  }
}

export function checkWorkspaceIntegrity(workspace) {
  const collections = {};
  for (const key of ["folders", "pages", "dataSources", "databaseItems", "databaseViews", "relations", "attachments", "people", "discussions", "comments", "syncedSources", "pageTemplates", "databaseTemplates", "pageVersions", "databaseVersions"]) {
    collections[key] = Array.isArray(workspace?.[key]) ? workspace[key] : [];
  }
  const maps = Object.fromEntries(Object.entries(collections).map(([key, entities]) => [key, new Map(entities.map((entity) => [entity.id, entity]))]));
  const problems = [];
  const report = (severity, code, collection, id, detail) => problems.push({ severity, code, collection, id, detail });

  for (const version of collections.pageVersions) {
    if (!maps.pages.has(version.pageId)) report("warning", "PAGE_VERSION_ORPHAN", "pageVersions", version.id, `Missing page: ${version.pageId}`);
  }
  for (const version of collections.databaseVersions) {
    if (!maps.dataSources.has(version.sourceId)) report("warning", "DATABASE_VERSION_ORPHAN", "databaseVersions", version.id, `Missing source: ${version.sourceId}`);
  }

  for (const folder of collections.folders) {
    if (folder.system && (folder.parentId !== null || folder.trashedAt || collections.folders.filter((entry) => entry.system === folder.system).length !== 1)) report("error", "SYSTEM_FOLDER_INVALID", "folders", folder.id, "System folder must be unique, top-level and outside the trash");
    if (folder.parentId && !maps.folders.has(folder.parentId)) report("error", "FOLDER_PARENT_MISSING", "folders", folder.id, `Missing parent folder: ${folder.parentId}`);
    const seen = new Set([folder.id]);
    let ancestorId = folder.parentId;
    while (ancestorId) {
      if (ancestorId === folder.id) {
        report("error", "FOLDER_CYCLE", "folders", folder.id, "Folder ancestry returns to itself");
        break;
      }
      if (seen.has(ancestorId)) break;
      seen.add(ancestorId);
      ancestorId = maps.folders.get(ancestorId)?.parentId;
    }
  }
  for (const page of collections.pages) {
    if (!maps.folders.has(page.folderId)) report(page.trashedAt ? "info" : "error", page.trashedAt ? "TRASHED_PAGE_FOLDER_MISSING" : "PAGE_FOLDER_MISSING", "pages", page.id, `Missing folder: ${page.folderId}`);
    if (!page.trashedAt && page.parentPageId && !maps.pages.has(page.parentPageId)) report("error", "PAGE_PARENT_MISSING", "pages", page.id, `Missing parent page: ${page.parentPageId}`);
    if (page.pageType === "database") {
      const source = maps.dataSources.get(page.databaseSourceId);
      const view = maps.databaseViews.get(page.databaseViewId);
      if (page.databaseSourceId && !source) report("error", "PAGE_DATABASE_SOURCE_MISSING", "pages", page.id, `Missing database source: ${page.databaseSourceId}`);
      if (page.databaseViewId && !view) report("error", "PAGE_DATABASE_VIEW_MISSING", "pages", page.id, `Missing database view: ${page.databaseViewId}`);
      if (source && view && !(Array.isArray(page.databaseSourceIds) ? page.databaseSourceIds : [source.id]).includes(view.sourceId)) report("error", "PAGE_DATABASE_VIEW_SOURCE_MISMATCH", "pages", page.id, `Database view ${view.id} belongs to source ${view.sourceId}, expected: ${source.id}`);
      if (page.databaseSourceIds != null && (!Array.isArray(page.databaseSourceIds) || page.databaseSourceIds[0] !== page.databaseSourceId
        || new Set(page.databaseSourceIds).size !== page.databaseSourceIds.length || page.databaseSourceIds.some((id) => !maps.dataSources.has(id)))) report("error", "PAGE_DATABASE_SOURCES_INVALID", "pages", page.id, "Database container source membership is invalid");
    }
  }
  for (const source of collections.dataSources) {
    if (source.ownerPageId && !maps.pages.has(source.ownerPageId)) report("error", "SOURCE_OWNER_MISSING", "dataSources", source.id, `Missing owner page: ${source.ownerPageId}`);
    for (const property of source.properties || []) {
      if (property.type === "relation" && property.config?.targetSourceId && !maps.dataSources.has(property.config.targetSourceId)) report("error", "RELATION_PROPERTY_TARGET_MISSING", "dataSources", source.id, `Property ${property.id} targets missing source: ${property.config.targetSourceId}`);
    }
  }
  for (const item of collections.databaseItems) {
    if (!maps.dataSources.has(item.sourceId)) report("error", "ITEM_SOURCE_MISSING", "databaseItems", item.id, `Missing source: ${item.sourceId}`);
    if (!maps.pages.has(item.pageId)) report("error", "ITEM_PAGE_MISSING", "databaseItems", item.id, `Missing record page: ${item.pageId}`);
  }
  for (const view of collections.databaseViews) {
    if (!maps.dataSources.has(view.sourceId)) report("error", "VIEW_SOURCE_MISSING", "databaseViews", view.id, `Missing source: ${view.sourceId}`);
  }
  for (const relation of collections.relations) {
    if (!maps.dataSources.has(relation.sourceId) || !maps.dataSources.has(relation.targetSourceId)) report("error", "RELATION_SOURCE_MISSING", "relations", relation.id, `Missing relation source or target: ${relation.sourceId} -> ${relation.targetSourceId}`);
  }
  const propertyCollections = [
    ...collections.databaseItems.map((item) => ({ collection: "databaseItems", entity: item, values: item.values })),
    ...collections.databaseTemplates.map((template) => ({ collection: "databaseTemplates", entity: template, values: template.defaultValues })),
  ];
  const checkRelationValues = createRelationValueValidator(collections.dataSources, collections.relations, collections.databaseItems);
  for (const { collection, entity, values } of propertyCollections) {
    for (const issue of checkRelationValues(entity, values)) {
      report(issue.code === "RELATION_VALUE_MISSING" ? "error" : "warning", issue.code, collection, entity.id, issue.message);
    }
    for (const property of maps.dataSources.get(entity.sourceId)?.properties || []) {
      const targets = { files: [maps.attachments, "FILES_VALUE_MISSING"], people: [maps.people, "PEOPLE_VALUE_MISSING"] }[property.type];
      if (!targets) continue;
      for (const id of ids(values?.[property.id])) {
        if (!targets[0].has(id)) report("error", targets[1], collection, entity.id, `Property ${property.id} references missing value: ${id}`);
      }
    }
  }
  for (const discussion of collections.discussions) {
    if (!maps.pages.has(discussion.pageId)) report("error", "DISCUSSION_PAGE_MISSING", "discussions", discussion.id, `Missing page: ${discussion.pageId}`);
  }
  for (const comment of collections.comments) {
    if (!maps.discussions.has(comment.discussionId)) report("error", "COMMENT_DISCUSSION_MISSING", "comments", comment.id, `Missing discussion: ${comment.discussionId}`);
  }
  for (const template of collections.databaseTemplates) {
    if (!maps.dataSources.has(template.sourceId)) report("error", "DATABASE_TEMPLATE_SOURCE_MISSING", "databaseTemplates", template.id, `Missing source: ${template.sourceId}`);
  }
  for (const collection of ["folders", "pages"]) {
    for (const entity of collections[collection]) {
      for (const [field, targets] of [["trashedByFolderId", maps.folders], ["trashedByPageId", maps.pages]]) {
        const root = targets.get(entity[field]);
        if (entity[field] && (!root || !root.trashedAt)) report("error", "TRASH_GROUP_ROOT_MISSING", collection, entity.id, `${field} points to an unavailable trash root: ${entity[field]}`);
      }
    }
  }
  const documents = [
    ...collections.pages.map((page) => ({ collection: "pages", entity: page, body: page.content })),
    ...collections.pageTemplates.map((template) => ({ collection: "pageTemplates", entity: template, body: template.content })),
    ...collections.databaseTemplates.map((template) => ({ collection: "databaseTemplates", entity: template, body: template.pageContent })),
    ...collections.syncedSources.map((source) => ({ collection: "syncedSources", entity: source, body: source.blocks })),
  ];
  for (const { collection, entity, body } of documents) {
    walkBlocks(body, (block) => {
      const props = block.props || {};
      if (block.type === "syncedBlock" && props.sourceId && !maps.syncedSources.has(props.sourceId)) report("error", "SYNCED_SOURCE_MISSING", collection, entity.id, `Block ${block.id} references missing synced source: ${props.sourceId}`);
      if (["pageLink", "subPage"].includes(block.type) && props.pageId && !maps.pages.has(props.pageId)) report("info", "PAGE_LINK_TARGET_MISSING", collection, entity.id, `Block ${block.id} links to missing page: ${props.pageId}`);
      if (block.type === "databaseView" && props.sourceId && !maps.dataSources.has(props.sourceId)) report("info", "DATABASE_BLOCK_TARGET_MISSING", collection, entity.id, `Block ${block.id} references deleted database: ${props.sourceId}`);
      if (block.type === "databaseView" && Object.hasOwn(props, "viewIdsJson")) {
        const resolved = resolveDatabaseOccurrenceViews(collections, props);
        // Unknown legacy membership is untouched. Report every explicit problem,
        // including references kept in views for inspection by the resolver.
        if (resolved.known) for (const problem of resolved.problems) {
          report("error", `DATABASE_BLOCK_${problem.code}`, collection, entity.id, `Block ${block.id}, ${problem.field}${problem.index === undefined ? "" : `[${problem.index}]`}: ${problem.message}`);
        }
      }
      visitInline(block.content, (entry) => {
        if (entry.type === "pageMention" && entry.props?.pageId && !maps.pages.has(entry.props.pageId)) report("info", "PAGE_MENTION_TARGET_MISSING", collection, entity.id, `Block ${block.id} mentions missing page: ${entry.props.pageId}`);
      });
    });
  }
  const { selectedPageId, selectedBlockId } = workspace?.ui || {};
  if (selectedPageId && selectedBlockId) {
    const page = maps.pages.get(selectedPageId);
    const block = page && !page.trashedAt ? walkBlocks(page.content).find((entry) => entry.id === selectedBlockId && entry.type === "databaseView") : null;
    if (!block) report("warning", "UI_SELECTED_BLOCK_UNAVAILABLE", "ui", selectedBlockId, `Database occurrence ${selectedPageId}/${selectedBlockId} is unavailable; return to its containing page`);
  }
  const referencedAttachments = attachmentReferences(collections);
  for (const attachment of collections.attachments) {
    if (!referencedAttachments.has(attachment.id)) report("info", "ATTACHMENT_UNREFERENCED", "attachments", attachment.id, "Attachment has no workspace references");
  }
  return { ok: !problems.some((problem) => problem.severity === "error"), problems };
}
