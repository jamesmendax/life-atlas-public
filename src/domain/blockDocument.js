// Shared document traversal. Containers keep ordinary BlockNote children; canonical
// synced sources are deliberately resolved separately (never silently duplicated).
export const copyJson = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
export const newEntityId = (prefix = "block") => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;

export function walkBlocks(blocks, visit, parent = null, depth = 0) {
  if (depth > 128) throw new Error("Document nesting exceeds 128 levels");
  const result = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || typeof block !== "object") continue;
    visit?.(block, parent);
    result.push(block, ...walkBlocks(block.children, visit, block, depth + 1));
  }
  return result;
}

export function mapBlocks(blocks, transform, path = [], depth = 0) {
  if (depth > 128) throw new Error("Document nesting exceeds 128 levels");
  return (Array.isArray(blocks) ? blocks : []).map((input, index) => {
    if (!input || typeof input !== "object") return input;
    const block = copyJson(input);
    const location = [...path, index];
    if (Array.isArray(block.children)) block.children = mapBlocks(block.children, transform, location, depth + 1);
    return transform(block, location);
  });
}

export function blockContext(blocks, id, parent = null) {
  for (const block of blocks || []) {
    if (block.id === id) return { block, parent };
    const nested = blockContext(block.children, id, block);
    if (nested) return nested;
  }
  return null;
}

export function createTabPanel(label = "新标签", idFactory = newEntityId) {
  return {
    id: idFactory("panel"), type: "tabPanel",
    props: { tabId: idFactory("tab"), label, icon: "" },
    children: [{ id: idFactory("block"), type: "paragraph", content: "" }],
  };
}

export function createTabsDocument(labels = ["概览", "笔记", "资料"], idFactory = newEntityId) {
  const children = (labels.length ? labels : ["概览"]).map((label) => createTabPanel(label, idFactory));
  return { id: idFactory("tabs"), type: "tabs", props: { activeTabId: children[0].props.tabId }, children };
}

export function changeTab(input, action) {
  const tabs = copyJson(input);
  tabs.children = Array.isArray(tabs.children) ? tabs.children : [];
  const index = tabs.children.findIndex((panel) => panel.props?.tabId === action.tabId);
  switch (action.type) {
    case "activate":
      if (index >= 0) tabs.props.activeTabId = action.tabId;
      break;
    case "rename":
      if (index >= 0) tabs.children[index].props.label = String(action.label || "新标签").slice(0, 120);
      break;
    case "add": {
      const panel = createTabPanel(action.label || "新标签");
      tabs.children.push(panel);
      tabs.props.activeTabId = panel.props.tabId;
      break;
    }
    case "move": {
      const target = Math.max(0, Math.min(tabs.children.length - 1, index + Number(action.offset || 0)));
      if (index >= 0 && target !== index) {
        const [panel] = tabs.children.splice(index, 1);
        tabs.children.splice(target, 0, panel);
      }
      break;
    }
    case "delete":
      if (index >= 0 && tabs.children.length > 1) {
        tabs.children.splice(index, 1);
        if (tabs.props.activeTabId === action.tabId) tabs.props.activeTabId = tabs.children[Math.min(index, tabs.children.length - 1)].props.tabId;
      }
      break;
    default: break;
  }
  if (!tabs.children.length) tabs.children = [createTabPanel()];
  if (!tabs.children.some((panel) => panel.props.tabId === tabs.props.activeTabId)) tabs.props.activeTabId = tabs.children[0].props.tabId;
  return tabs;
}

// A copied document gets fresh block AND tab IDs. Synced source IDs, mention
// targets and database source IDs remain references, not silently cloned data.
export function cloneBlockDocument(blocks, idFactory = newEntityId) {
  const tabIds = new Map();
  let result = mapBlocks(blocks, (block) => {
    block.id = idFactory("block");
    if (block.type === "tabPanel") {
      const old = block.props?.tabId;
      const next = idFactory("tab");
      tabIds.set(old, next);
      block.props = { ...block.props, tabId: next };
    }
    return block;
  });
  result = mapBlocks(result, (block) => {
    if (block.type === "tabs") block.props = { ...block.props, activeTabId: tabIds.get(block.props?.activeTabId) || block.children?.[0]?.props?.tabId || "" };
    return block;
  });
  return result;
}

export function ensureBlockIds(blocks, prefix = "document") {
  return mapBlocks(blocks, (block, path) => ({ ...block, id: block.id || `${prefix}:${path.join(".")}` }));
}

// Canonical JSON is used for no-op detection and conservative migration grouping.
// Unlike a short content hash, this cannot merge divergent payloads on collision.
export function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

export function sourceReferences(blocks) {
  return walkBlocks(blocks).filter((block) => block.type === "syncedBlock" && block.props?.sourceId).map((block) => block.props.sourceId);
}

// Expansion is for export/search only. Editing always targets the canonical store.
export function expandSyncedBlocks(blocks, workspace, ancestry = new Set()) {
  return mapBlocks(blocks, (block) => {
    if (block.type !== "syncedBlock" || !block.props?.sourceId) return block;
    const source = workspace?.syncedSources?.find((entry) => entry.id === block.props.sourceId);
    if (!source || source.deletedAt || ancestry.has(source.id)) {
      return { ...block, children: [{ type: "paragraph", content: source?.deletedAt ? "[同步源已删除]" : "[同步内容不可用]" }] };
    }
    const next = new Set(ancestry);
    next.add(source.id);
    return { ...block, children: expandSyncedBlocks(source.blocks, workspace, next) };
  });
}
