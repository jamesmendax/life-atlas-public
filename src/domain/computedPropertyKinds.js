import { resolvePropertyValue } from "./databasePropertyValues.js";
import { dateMillis } from "./databaseProperties.js";
import { isDateRollupAggregation, isListRollupAggregation, isNumericRollupAggregation } from "./rollupConfiguration.js";

const snapshots = new WeakMap();

export const isComputedDateValue = value =>
  typeof value?.start === "string" && Number.isFinite(dateMillis(value));

function computedKind(value) {
  if (value == null || value === "" || value?.error) return null;
  if (Array.isArray(value)) return "list";
  if (isComputedDateValue(value)) return "date";
  if (Number.isFinite(value)) return "number";
  if (typeof value === "string") return "text";
  if (typeof value === "boolean") return "boolean";
  return null;
}

function workspaceSnapshot(workspace) {
  const { databaseItems, dataSources, pages, people, relations } = workspace;
  if (!databaseItems?.length) return null;
  const cached = snapshots.get(databaseItems);
  if (cached && cached.dataSources === dataSources && cached.pages === pages &&
    cached.people === people && cached.relations === relations) return cached;

  const bySource = new Map();
  const trashedPages = new Set((pages || []).filter(page => page.trashedAt).map(page => page.id));
  for (const item of databaseItems) {
    if (trashedPages.has(item.pageId)) continue;
    if (!bySource.has(item.sourceId)) bySource.set(item.sourceId, []);
    bySource.get(item.sourceId).push(item);
  }
  const snapshot = { dataSources, pages, people, relations, bySource, kinds: new WeakMap() };
  snapshots.set(databaseItems, snapshot);
  return snapshot;
}

export function computedPropertyKinds(workspace, source, property) {
  if (property?.type === "rollup") {
    const aggregation = property.config?.aggregation;
    if (isNumericRollupAggregation(aggregation)) return new Set(["number"]);
    if (isDateRollupAggregation(aggregation)) return new Set(["date"]);
    if (isListRollupAggregation(aggregation)) return new Set(["list"]);
  }
  if (!workspace || !source || !property) return new Set();
  const snapshot = workspaceSnapshot(workspace);
  if (!snapshot) return new Set();
  const cached = snapshot.kinds.get(property);
  if (cached?.source === source) return cached.kinds;
  const kinds = new Set();
  const now = Date.now();
  for (const item of snapshot.bySource.get(source.id) || []) {
    const kind = computedKind(resolvePropertyValue(workspace, source, item, property, undefined, { now }));
    if (kind) kinds.add(kind);
  }
  snapshot.kinds.set(property, { source, kinds });
  return kinds;
}
