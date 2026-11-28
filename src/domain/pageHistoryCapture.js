import { stableJson } from "./blockDocument.js";
import { derivePageSummary } from "./content.js";
import { afterCapture, createPageVersion, dueCapture, latestVersionOf, snapshotSignature } from "./pageHistory.js";

export const VERSIONED_PAGE_FIELDS = Object.freeze(["title", "icon", "iconColor", "cover", "settings", "content", "pageType", "databaseSourceId", "databaseViewId"]);
const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function isTrackedPageEdit(page, patch) {
  return Boolean(page && !page.trashedAt && !page.settings?.locked && VERSIONED_PAGE_FIELDS.some((field) => owns(patch, field) && stableJson(patch[field]) !== stableJson(page[field])));
}

function addVersion(workspace, page, { reason, now, id }) {
  const versions = workspace.pageVersions || [];
  const latest = latestVersionOf(versions, page.id);
  if (latest && snapshotSignature(latest) === snapshotSignature(page)) return workspace;
  const version = createPageVersion(page, { reason, now, id });
  if (!version) return workspace;
  return { ...workspace, pageVersions: [...versions, version] };
}

export function applyTrackedPageEdit(workspace, { pageId, patch, now, beforeEditId = null }) {
  const page = workspace.pages.find((entry) => entry.id === pageId);
  if (!page || page.trashedAt || !Object.keys(patch).some((field) => stableJson(patch[field]) !== stableJson(page[field]))) return workspace;
  const time = new Date(now).toISOString();
  const captured = beforeEditId && isTrackedPageEdit(page, patch) ? addVersion(workspace, page, { reason: "before-edit", now, id: beforeEditId }) : workspace;
  const nextPatch = { ...patch };
  if (owns(patch, "content")) {
    const revision = (page.contentRevision || 0) + 1;
    Object.assign(nextPatch, { contentRevision: revision, summary: derivePageSummary({ ...page, content: patch.content }, 96, workspace), summarySourceRevision: revision, summaryUpdatedAt: time });
  }
  const updated = { ...page, ...nextPatch, updatedAt: time };
  return {
    ...captured,
    pages: captured.pages.map((entry) => entry.id === pageId ? updated : entry),
    databaseItems: owns(patch, "title") ? (captured.databaseItems || []).map((item) => {
      if (item.pageId !== pageId) return item;
      const property = captured.dataSources?.find((source) => source.id === item.sourceId)?.properties.find((entry) => entry.type === "title");
      return property ? { ...item, values: { ...item.values, [property.id]: updated.title }, updatedAt: time } : item;
    }) : captured.databaseItems,
  };
}

export function captureTrackedPageVersions(workspace, captures, now) {
  return captures.reduce((current, capture) => {
    const page = current.pages.find((entry) => entry.id === capture.pageId);
    if (!page || page.trashedAt || page.settings?.locked) return current;
    return addVersion(current, page, { ...capture, now });
  }, workspace);
}

export function planTrackedPageCaptures(trackers, now, { flush = false, idFactory } = {}) {
  const nextTrackers = new Map(trackers);
  const captures = [];
  for (const [pageId, tracker] of trackers) {
    const reason = flush && tracker.dirtySince != null ? "idle" : dueCapture(tracker, now);
    if (!reason) continue;
    captures.push({ pageId, reason, id: idFactory("ver") });
    nextTrackers.set(pageId, afterCapture(tracker, reason, now));
  }
  return { captures, trackers: nextTrackers };
}
