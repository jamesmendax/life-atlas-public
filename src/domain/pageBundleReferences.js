import { walkBlocks } from "./blockDocument.js";
import { attachmentIdFromUrl, attachmentUrlWithId } from "./attachments.js";
import { assetHashFromUrl } from "./attachmentUrls.js";
import { serializeDatabaseOccurrenceSourceIds, serializeDatabaseOccurrenceViewIds } from "./databaseOccurrenceViews.js";
import { detachWorkflowHistory } from "./taskRecurrence.js";
import { remapFormulaSources } from "./formula/relatedPropertyReferences.js";
import { parseBlockLink } from "../editor/links.js";

const propertyTargets = new Map([["relation", "databaseItems"], ["people", "people"], ["files", "attachments"]]);

// Operates on an isolated JSON copy. Both export and import use the same typed
// references. Source-local property IDs, option IDs, and ordinary text stay intact.
export function visitBundleReferences(collection, entity, context) {
  const { ref, sources, importing } = context;
  const field = (object, key, target) => {
    if (typeof object?.[key] === "string" && object[key]) object[key] = ref(target, object[key]);
  };
  const values = (object, key, target) => {
    if (!target || !object || !Object.hasOwn(object, key)) return;
    if (Array.isArray(object[key])) object[key] = object[key].map(id => typeof id === "string" ? ref(target, id) : id);
    else field(object, key, target);
  };
  function keys(object, key, target) {
    const dictionary = object?.[key];
    if (dictionary && typeof dictionary === "object" && !Array.isArray(dictionary)) {
      object[key] = Object.fromEntries(Object.entries(dictionary).map(([id, value]) => [ref(target, id), value]));
    }
  }
  function media(object, key) {
    const url = object?.[key];
    if (typeof url !== "string") return;
    const attachmentId = attachmentIdFromUrl(url);
    if (attachmentId) {
      const mapped = ref("attachments", attachmentId);
      if (mapped !== attachmentId) object[key] = attachmentUrlWithId(url, mapped);
    } else {
      const attachment = context.assets.get(assetHashFromUrl(url));
      if (attachment) ref("attachments", attachment.id);
    }
  }
  function appearance(object) {
    media(object, "icon");
    if (typeof object?.cover === "string") media(object, "cover");
    else media(object?.cover, "value");
  }
  function databaseAction(action) {
    if (!["createRecord", "updateRecord"].includes(action?.type)) return;
    const target = sources.get(action.targetSourceId);
    // An incomplete imported action must never write into an unrelated local
    // database which happens to have the same ID as an omitted dependency.
    let missingDependency = false;
    function actionField(object, key, collection) {
      if (!object || !collection || !Object.hasOwn(object, key)) return;
      const remap = id => {
        if (typeof id !== "string" || !id) return id;
        const mapped = ref(collection, id);
        if (importing && id === mapped) missingDependency = true;
        return mapped;
      };
      object[key] = Array.isArray(object[key]) ? object[key].map(remap) : remap(object[key]);
    }
    actionField(action, "targetSourceId", "dataSources");
    actionField(action, "templateId", "databaseTemplates");
    for (const property of target?.properties || []) actionField(action.values, property.id, propertyTargets.get(property.type));
    if (missingDependency) action.targetSourceId = "";
  }
  function inline(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "pageMention") field(node.props, "pageId", "pages");
    if (node.type === "userMention") field(node.props, "personId", "people");
    if (node.type === "link") {
      const address = parseBlockLink(node.href);
      if (address) {
        const pageId = ref("pages", address.pageId);
        if (importing) {
          const blockId = context.blockIds.get(address.pageId)?.get(address.blockId) || address.blockId;
          node.href = `lifeatlas://page/${pageId}${blockId ? `#block-${blockId}` : ""}`;
        }
      } else media(node, "href");
    }
    for (const child of Object.values(node)) inline(child);
  }
  function filter(rule, source) {
    if (!rule || typeof rule !== "object") return;
    const property = source?.properties?.find(property => property.id === rule.propertyId);
    if (rule.operator === "equals" || rule.operator === "not_equals") values(rule, "value", propertyTargets.get(property?.type));
    for (const group of [rule.children, rule.and, rule.or]) if (Array.isArray(group)) group.forEach(child => filter(child, source));
  }
  function jsonProperty(props, key, visit) {
    if (typeof props?.[key] !== "string" || !props[key]) return;
    let parsed;
    try { parsed = JSON.parse(props[key]); } catch { return; }
    const before = JSON.stringify(parsed);
    visit(parsed);
    if (importing && before !== JSON.stringify(parsed)) props[key] = JSON.stringify(parsed);
  }
  function document(blocks) {
    walkBlocks(blocks, block => {
      const props = block.props;
      if (["pageLink", "subPage", "editorialCard"].includes(block.type)) field(props, "pageId", "pages");
      if (block.type === "syncedBlock") field(props, "sourceId", "syncedSources");
      if (block.type === "editorialSection") {
        const source = sources.get(props?.sourceId);
        field(props, "sourceId", "dataSources");
        jsonProperty(props, "filterJson", rule => filter(rule, source));
        jsonProperty(props, "fallbackJson", cards => {
          if (!Array.isArray(cards)) return;
          for (const card of cards) {
            field(card, "pageId", "pages");
            field(card, "itemId", "databaseItems");
            media(card, "imageUrl");
          }
        });
      }
      if (block.type === "databaseView") {
        // Keep malformed declarations visible without treating them as ownership.
        if (typeof props?.sourceIdsJson === "string" && props.sourceIdsJson) {
          let ids;
          try {
            ids = JSON.parse(props.sourceIdsJson);
            serializeDatabaseOccurrenceSourceIds(ids);
          } catch { ids = null; }
          if (ids?.[0] === props.sourceId) {
            const mapped = ids.map(id => ref("dataSources", id));
            if (importing) props.sourceIdsJson = serializeDatabaseOccurrenceSourceIds(mapped);
          }
        }
        field(props, "sourceId", "dataSources");
        field(props, "viewId", "databaseViews");
        // Source declarations above establish the dependency graph. View IDs
        // outside that graph stay inspectable and never pull in foreign sources.
        if (importing && typeof props?.viewIdsJson === "string") {
          let ids;
          try {
            ids = JSON.parse(props.viewIdsJson);
            serializeDatabaseOccurrenceViewIds(ids);
          } catch { ids = null; }
          if (ids) props.viewIdsJson = serializeDatabaseOccurrenceViewIds(ids.map(id => ref("databaseViews", id)));
        }
      }
      field(props, "attachmentId", "attachments");
      media(props, "url");
      media(props, "imageUrl");
      inline(block.content);
    });
  }

  const source = sources.get(entity.sourceId);
  if (collection === "pages") {
    appearance(entity);
    field(entity, "databaseSourceId", "dataSources");
    values(entity, "databaseSourceIds", "dataSources");
    field(entity, "databaseViewId", "databaseViews");
    field(entity, "parentDatabaseItemId", "databaseItems");
    document(entity.content);
  } else if (collection === "syncedSources") {
    document(entity.blocks);
    if (importing && Array.isArray(entity.migratedReferences)) {
      entity.migratedReferences = entity.migratedReferences.filter(address => context.blockIds.has(address.pageId));
      for (const address of entity.migratedReferences) {
        address.blockId = context.blockIds.get(address.pageId).get(address.blockId) || address.blockId;
        field(address, "pageId", "pages");
      }
    }
  } else if (collection === "dataSources") {
    field(entity, "ownerPageId", "pages");
    const layoutViews = entity.recordLayout?.views;
    for (const view of Array.isArray(layoutViews) ? layoutViews : []) {
      field(view, "sourceId", "dataSources");
      field(view, "viewId", "databaseViews");
    }
    for (const property of entity.properties || []) {
      if (property.type === "relation") field(property.config, "targetSourceId", "dataSources");
      if (property.type === "formula" && property.config?.expression) {
        property.config.expression = remapFormulaSources(property.config.expression, id => ref("dataSources", id));
      }
      if (property.type === "button") databaseAction(property.config?.action);
      if (property.type === "status") databaseAction(property.config?.statusAction?.action);
    }
  } else if (collection === "relations") {
    field(entity, "sourceId", "dataSources");
    field(entity, "targetSourceId", "dataSources");
  } else if (collection === "databaseItems" || collection === "databaseTemplates") {
    field(entity, "sourceId", "dataSources");
    const propertyValues = collection === "databaseItems" ? entity.values : entity.defaultValues;
    for (const property of source?.properties || []) values(propertyValues, property.id, propertyTargets.get(property.type));
    if (collection === "databaseItems") {
      values(entity, "dependencyIds", "databaseItems");
      detachWorkflowHistory(entity, source);
      field(entity, "pageId", "pages");
      field(entity, "parentItemId", "databaseItems");
      field(entity.submission, "personId", "people");
      field(entity.submission, "viewId", "databaseViews");
    } else {
      document(entity.pageContent);
      appearance(entity.pageAppearance);
    }
  } else if (collection === "databaseViews") {
    field(entity, "sourceId", "dataSources");
    filter(entity.filter, source);
    const settings = entity.config?.[entity.type];
    if (entity.type === "dashboard") {
      for (const widget of settings?.widgets || []) {
        field(widget, "sourceId", "dataSources");
        field(widget, "viewId", "databaseViews");
      }
      for (const rule of settings?.globalFilters || []) {
        filter(rule, source);
        keys(rule, "mappings", "dataSources");
      }
    }
    if (["table", "gallery"].includes(entity.type)) values(settings, "manualOrder", "databaseItems");
    if (entity.type === "gallery") keys(settings, "imagePositions", "databaseItems");
  }
}
