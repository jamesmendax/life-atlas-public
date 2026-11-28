import { stableJson, walkBlocks } from "./blockDocument.js";
import { summarizeText } from "./content.js";
import { plainTextFromMaterialized } from "./documentSemantics.js";

const typeLabels = {
  paragraph: "空段落", heading: "标题", bulletListItem: "列表项", numberedListItem: "编号列表项",
  checkListItem: "待办事项", toggleListItem: "折叠内容", codeBlock: "代码", table: "表格", divider: "分割线",
  image: "图片", audio: "音频", video: "视频", file: "文件", pdf: "PDF", databaseView: "数据库视图",
  syncedBlock: "同步区块", tabs: "选项卡", tabPanel: "选项卡内容", columnList: "分栏", column: "栏",
};

function blockIndex(content) {
  const entries = new Map();
  let index = 0;
  walkBlocks(content, (block, parent) => {
    if (typeof block.id !== "string" || !block.id) return;
    const { children, ...own } = block;
    entries.set(block.id, entries.has(block.id) ? null : { own, parent, index: index++ });
  });
  return entries;
}

function blockSnippet(entry) {
  const block = entry.own;
  const text = plainTextFromMaterialized([block]) || [block.props?.caption, block.props?.name, block.props?.label]
    .find((value) => typeof value === "string" && value.trim());
  return text ? summarizeText(text, 82) : typeLabels[block.type] || "区块";
}

// The longest increasing subsequence keeps relative order while ignoring additions,
// removals and records reparented between the two versions.
function unchangedSiblingOrder(entries) {
  const tails = [];
  const previous = [];
  entries.forEach(({ index }, position) => {
    let low = 0, high = tails.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (entries[tails[middle]].index < index) low = middle + 1;
      else high = middle;
    }
    previous[position] = low ? tails[low - 1] : -1;
    tails[low] = position;
  });
  const unchanged = new Set();
  for (let cursor = tails.at(-1); cursor >= 0; cursor = previous[cursor]) unchanged.add(entries[cursor].id);
  return unchanged;
}

export function pageHistoryBlockDifferences(versionContent, currentContent) {
  const before = blockIndex(versionContent);
  const after = blockIndex(currentContent);
  const ambiguous = new Set([...before, ...after].flatMap(([id, entry]) => entry ? [] : [id]));
  const moved = new Set();
  const siblingGroups = new Map();
  for (const [id, current] of after) {
    const previous = before.get(id);
    if (!previous || !current) continue;
    const oldParentId = previous.parent?.id ?? null;
    const newParentId = current.parent?.id ?? null;
    if ((previous.parent && (!oldParentId || ambiguous.has(oldParentId))) || (current.parent && (!newParentId || ambiguous.has(newParentId)))) continue;
    if (oldParentId !== newParentId) { moved.add(id); continue; }
    if (!siblingGroups.has(newParentId)) siblingGroups.set(newParentId, []);
    siblingGroups.get(newParentId).push({ id, index: previous.index });
  }
  for (const siblings of siblingGroups.values()) {
    const unchanged = unchangedSiblingOrder(siblings);
    for (const { id } of siblings) if (!unchanged.has(id)) moved.add(id);
  }
  const counts = { added: 0, removed: 0, changed: 0, moved: 0 };
  const differences = [];
  for (const [id, current] of after) {
    if (ambiguous.has(id)) continue;
    const previous = before.get(id);
    const categories = [];
    if (!previous) categories.push("added");
    else if (stableJson(previous.own) !== stableJson(current.own)) categories.push("changed");
    if (moved.has(id)) categories.push("moved");
    if (!categories.length) continue;
    for (const category of categories) counts[category] += 1;
    differences.push({ id, categories, before: previous ? blockSnippet(previous) : null, current: blockSnippet(current) });
  }
  for (const [id, previous] of before) {
    if (ambiguous.has(id) || after.has(id)) continue;
    counts.removed += 1;
    differences.push({ id, categories: ["removed"], before: blockSnippet(previous), current: null });
  }
  return { differences, counts, ambiguousIds: [...ambiguous] };
}

export function pageHistoryOriginLabel(version) {
  if (version?.origin === "manual") return "本机手动保存";
  if (version?.origin === "local-action") return "本机操作";
  if (version?.reason === "pre-restore") return "本机恢复操作";
  return "来源未知";
}
