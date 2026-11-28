import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { dataSourceById, itemsForSource, projectViewItems, resolvePropertyValue, searchViewItems } from "../src/domain/database.js";
import { comparablePropertyValue } from "../src/domain/databaseProperties.js";
import { bigWorkspace } from "./fixtures/big-workspace.mjs";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";
import { upgradeWorkspace } from "../src/persistence/migrations.js";

function referenceProjection(workspace, view) {
  const source = dataSourceById(workspace, view?.sourceId);
  if (!source) return [];
  const pages = new Map();
  for (const page of workspace?.pages || []) if (!pages.has(page.id)) pages.set(page.id, page);
  let items = itemsForSource(workspace, source.id).filter((item) => !pages.get(item.pageId)?.trashedAt).filter((item) => {
    if (!view.filter) return true;
    const property = source.properties.find((candidate) => candidate.id === view.filter.propertyId);
    const value = property ? resolvePropertyValue(workspace, source, item, property) : null;
    return view.filter.operator === "equals" ? value === view.filter.value : true;
  });
  const sorts = Array.isArray(view?.sorts) ? view.sorts : [];
  if (sorts.length) {
    items = items.map((item, originalIndex) => ({ item, originalIndex })).sort((leftEntry, rightEntry) => {
      const leftItem = leftEntry.item, rightItem = rightEntry.item;
      for (const sort of sorts) {
        const property = source.properties.find((candidate) => candidate.id === sort.propertyId);
        const left = comparablePropertyValue(workspace, property, property ? resolvePropertyValue(workspace, source, leftItem, property) : null);
        const right = comparablePropertyValue(workspace, property, property ? resolvePropertyValue(workspace, source, rightItem, property) : null);
        if (left === null || right === null) {
          if (left !== right) return left === null ? 1 : -1;
          continue;
        }
        const order = typeof left === "string" && typeof right === "string"
          ? left.localeCompare(right)
          : Number(left > right) - Number(left < right);
        if (order) return sort.direction === "desc" ? -order : order;
      }
      return leftEntry.originalIndex - rightEntry.originalIndex;
    }).map((entry) => entry.item);
  }
  return items;
}

function performanceWorkspace() {
  const workspace = bigWorkspace({ pages: 0, records: 10000 });
  const view = { ...workspace.databaseViews[0], filter: { kind: "condition", propertyId: "status", operator: "equals", value: "doing" }, sorts: [{ propertyId: "amount", direction: "desc" }] };
  return { workspace, view };
}

test("projecting ten thousand records stays fast", () => {
  const { workspace, view } = performanceWorkspace();
  const timings = [];
  for (let run = 0; run < 3; run++) {
    const started = performance.now();
    const result = projectViewItems(workspace, view);
    timings.push(performance.now() - started);
    assert.equal(result.length, 3333);
    assert.equal(result[0].values.amount, 9997);
  }
  const median = timings.sort((left, right) => left - right)[1];
  console.log(`WP15_PROJECT_MS=${median}`);
  assert.ok(median < 300, `Projection median ${median} ms must be below 300 ms`);
});

test("cached projection agrees with reference filtering and sorting", () => {
  const { workspace, view } = performanceWorkspace();
  const ids = items => items.map(item => item.id);
  assert.deepEqual(ids(projectViewItems(workspace, view)), ids(referenceProjection(workspace, view)));
  for (const direction of ["asc", "desc"]) {
    const sorted = { ...view, filter: null, sorts: [{ propertyId: "status", direction }, { propertyId: "amount", direction }] };
    assert.deepEqual(ids(projectViewItems(workspace, sorted)), ids(referenceProjection(workspace, sorted)));
  }
});

test("view search matches titles text and option names", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  const source = dataSourceById(workspace, "ds-inline");
  const items = itemsForSource(workspace, source.id);
  assert.deepEqual(searchViewItems(workspace, source, items, "任务一").map((item) => item.id), ["i-1"]);
  assert.deepEqual(searchViewItems(workspace, source, items, "进行中").map((item) => item.id), ["i-2"]);
  assert.equal(searchViewItems(workspace, source, items, ""), items);
});
