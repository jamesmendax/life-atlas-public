import { copyJson, mapBlocks, stableJson, walkBlocks } from "./blockDocument.js";
import { derivePageSummary } from "./content.js";
import { defaultPageSettings } from "./pageActions.js";

export const IDLE_MS = 120000;
export const INTERVAL_MS = 600000;
export const MAX_VERSION_BYTES = 5 * 1024 * 1024;

const DAY_MS = 86400000;
const encoder = new TextEncoder();
const millisecondsOf = (value) => typeof value === "number" ? value : new Date(value).getTime();
const DECLARATION_FIELDS = ["pageType", "databaseSourceId", "databaseViewId", "databaseSourceIds"];

export function pageSnapshotOf(page) {
  return copyJson({
    title: page?.title ?? "",
    icon: page?.icon ?? null,
    iconColor: page?.iconColor ?? null,
    cover: page?.cover ?? null,
    settings: page?.settings ?? defaultPageSettings,
    content: page?.content ?? [],
    // New ordinary snapshots declare nulls; legacy absence is handled on restore.
    ...Object.fromEntries(DECLARATION_FIELDS.map((field) => [field, Object.hasOwn(page ?? {}, field) ? page[field] ?? null : null])),
  });
}

export function snapshotSignature(snapshotOrVersion) {
  return stableJson(pageSnapshotOf(snapshotOrVersion));
}

export function pageRestoreSnapshotOf(page, version) {
  const snapshot = pageSnapshotOf(version);
  // A stored legacy version cannot replace declarations it never recorded.
  for (const field of DECLARATION_FIELDS) {
    if (Object.hasOwn(version, field)) continue;
    if (Object.hasOwn(page, field)) snapshot[field] = copyJson(page[field]);
    else delete snapshot[field];
  }
  if (!Object.hasOwn(version, "databaseSourceIds") && Object.hasOwn(version, "databaseSourceId")
    && version.databaseSourceId !== page.databaseSourceId) snapshot.databaseSourceIds = version.databaseSourceId ? [version.databaseSourceId] : null;
  return snapshot;
}

export const HISTORY_DATABASE_SCOPE = "记录和视图设置保留当前数据库中的内容。";

export function pageHistoryPreview(version) {
  const declaresDatabase = version?.pageType === "database" && Boolean(version.databaseSourceId);
  const reference = (block, label, detail) => ({
    id: block.id, type: "callout", props: { icon: "↗", tone: "gray" }, content: label + " · " + detail, children: block.children,
  });
  let matchedDeclaration = false;
  const content = mapBlocks(version?.content, block => {
    if (block.type === "databaseView") {
      const wholePage = declaresDatabase && !matchedDeclaration && block.props?.sourceId === version.databaseSourceId
        && block.props?.viewId === version.databaseViewId;
      if (wholePage) matchedDeclaration = true;
      return reference(block, wholePage ? "整页数据库" : "数据库视图", "此版本保存了引用。" + HISTORY_DATABASE_SCOPE);
    }
    if (block.type === "syncedBlock") {
      return reference(block, "同步区块", "此版本保存了引用。同步正文由原来源管理。");
    }
    if (block.type === "editorialSection" && block.props?.sourceId) {
      // When a section has stored cards, the existing editor can render those
      // with the live data source disconnected from this preview.
      try {
        const cards = JSON.parse(block.props.fallbackJson || "[]");
        if (Array.isArray(cards) && cards.length) return { ...block, props: { ...block.props, sourceId: "" } };
      } catch { /* Fall through to the reference preview. */ }
      return reference(block, "数据库内容区", "此版本保存了引用。" + HISTORY_DATABASE_SCOPE);
    }
    return block;
  });
  return { content, detachedDatabase: declaresDatabase && !matchedDeclaration };
}

export function comparePageVersion(page, version) {
  const current = pageSnapshotOf(page);
  const restored = pageSnapshotOf(pageRestoreSnapshotOf(page, version));
  const changedFields = Object.keys(current).filter((field) => stableJson(current[field]) !== stableJson(restored[field]));
  return { identical: changedFields.length === 0, changedFields };
}

export function createPageVersion(page, { reason, now, id }) {
  const snapshot = pageSnapshotOf(page);
  const sizeBytes = encoder.encode(JSON.stringify(snapshot)).byteLength;
  if (sizeBytes > MAX_VERSION_BYTES) return null;
  return { id, pageId: page.id, createdAt: new Date(now).toISOString(), reason, ...snapshot, blockCount: walkBlocks(snapshot.content).length, sizeBytes };
}

export function latestVersionOf(versions, pageId) {
  let latest = null;
  let latestAt = -Infinity;
  for (const version of versions || []) {
    const createdAt = millisecondsOf(version?.createdAt);
    if (version?.pageId === pageId && createdAt > latestAt) { latest = version; latestAt = createdAt; }
  }
  return latest;
}

export function recordEdit(tracker, nowMs) {
  return { dirtySince: tracker?.dirtySince ?? nowMs, lastEditAt: nowMs };
}

export function dueCapture(tracker, nowMs) {
  if (tracker?.dirtySince == null) return null;
  if (nowMs - tracker.lastEditAt >= IDLE_MS) return "idle";
  if (nowMs - tracker.dirtySince >= INTERVAL_MS) return "interval";
  return null;
}

export function afterCapture(tracker, reason, nowMs) {
  return { dirtySince: reason === "idle" ? null : nowMs, lastEditAt: tracker?.lastEditAt };
}

function localWeekOf(date) {
  const thursday = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const year = thursday.getUTCFullYear();
  const week = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7);
  return `${year}-W${week}`;
}

export function prunePageVersions(versions, nowMs) {
  const input = Array.isArray(versions) ? versions : [];
  const byPage = new Map();
  input.forEach((version, index) => {
    const createdAt = millisecondsOf(version?.createdAt);
    if (!version || !Number.isFinite(createdAt)) return;
    if (!byPage.has(version.pageId)) byPage.set(version.pageId, []);
    byPage.get(version.pageId).push({ version, createdAt, index });
  });
  const retained = new Set();
  for (const candidates of byPage.values()) {
    const days = new Set();
    const weeks = new Set();
    const months = new Set();
    let recent = 0;
    let total = 0;
    candidates.sort((first, second) => second.createdAt - first.createdAt || first.index - second.index);
    for (const candidate of candidates) {
      if (total >= 120) break;
      const age = millisecondsOf(nowMs) - candidate.createdAt;
      let keep = false;
      if (age < 7 * DAY_MS) {
        keep = recent < 50;
        recent += 1;
      } else {
        const date = new Date(candidate.createdAt);
        const bucket = age < 30 * DAY_MS ? days : age < 365 * DAY_MS ? weeks : months;
        const key = age < 30 * DAY_MS ? `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}` : age < 365 * DAY_MS ? localWeekOf(date) : `${date.getFullYear()}-${date.getMonth() + 1}`;
        keep = !bucket.has(key);
        bucket.add(key);
      }
      if (keep) { retained.add(candidate.index); total += 1; }
    }
  }
  return input.filter((version, index) => retained.has(index));
}

export function compareBlocks(versionContent, currentContent) {
  const before = new Map(walkBlocks(versionContent).map((block) => [block.id, block]));
  const current = new Map(walkBlocks(currentContent).map((block) => [block.id, block]));
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [id, block] of current) {
    if (!before.has(id)) added += 1;
    else if (stableJson(block) !== stableJson(before.get(id))) changed += 1;
  }
  for (const id of before.keys()) if (!current.has(id)) removed += 1;
  return { added, removed, changed };
}

function blockPositions(content) {
  const positions = new Map();
  let order = 0;
  walkBlocks(content, (block, parent) => {
    if (typeof block.id !== "string" || !block.id) return;
    // Ambiguous legacy IDs are not reliable evidence of a move.
    positions.set(block.id, positions.has(block.id) ? null : {
      parentId: parent?.id ?? null,
      hasParent: parent !== null,
      order: order++,
    });
  });
  return positions;
}

export function countMovedBlocks(versionContent, currentContent) {
  const before = blockPositions(versionContent);
  const after = blockPositions(currentContent);
  const ranksByParent = new Map();
  let moved = 0;
  for (const [id, current] of after) {
    const previous = before.get(id);
    if (!previous || !current) continue;
    if (previous.hasParent && !before.get(previous.parentId)) continue;
    if (current.hasParent && !after.get(current.parentId)) continue;
    if (previous.parentId !== current.parentId) {
      moved += 1;
      continue;
    }
    if (!ranksByParent.has(current.parentId)) ranksByParent.set(current.parentId, []);
    ranksByParent.get(current.parentId).push(previous.order);
  }
  // The longest increasing subsequence is the portion that kept its relative
  // sibling order. Added and removed siblings do not count as moves.
  for (const ranks of ranksByParent.values()) {
    const tails = [];
    for (const rank of ranks) {
      let low = 0, high = tails.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (tails[mid] < rank) low = mid + 1;
        else high = mid;
      }
      tails[low] = rank;
    }
    moved += ranks.length - tails.length;
  }
  return moved;
}

export function restorePageVersion(workspace, { pageId, versionId, now, preRestoreId }) {
  const page = workspace.pages?.find((entry) => entry.id === pageId);
  const version = workspace.pageVersions?.find((entry) => entry.id === versionId && entry.pageId === pageId);
  if (!page || !version || page.trashedAt || page.settings?.locked) throw new Error("无法恢复这个版本");
  const before = createPageVersion(page, { reason: "pre-restore", now, id: preRestoreId });
  if (!before) throw new Error("当前页面过大，无法保存恢复前版本");
  const updatedAt = new Date(now).toISOString();
  const snapshot = pageRestoreSnapshotOf(page, version);
  const restored = { ...page, ...snapshot, updatedAt, contentRevision: (page.contentRevision || 0) + 1, importRevision: (page.importRevision || 0) + 1 };
  const next = {
    ...workspace,
    pages: workspace.pages.map((entry) => entry.id === pageId ? restored : entry),
    pageVersions: [...(workspace.pageVersions || []), before],
    databaseItems: (workspace.databaseItems || []).map((item) => {
      if (item.pageId !== pageId) return item;
      const title = workspace.dataSources?.find((source) => source.id === item.sourceId)?.properties?.find((property) => property.type === "title");
      return title ? { ...item, values: { ...item.values, [title.id]: restored.title }, updatedAt } : item;
    }),
  };
  return { ...next, pages: next.pages.map((entry) => entry === restored ? { ...restored, summary: derivePageSummary(restored, 96, next), summarySourceRevision: restored.contentRevision, summaryUpdatedAt: updatedAt } : entry) };
}
