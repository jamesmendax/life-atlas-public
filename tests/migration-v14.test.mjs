import test from "node:test";
import assert from "node:assert/strict";
import { migrateNavigationState, migrateStatusGroups } from "../src/persistence/migrations.js";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";

test("v14 adds navigation state defaults", () => {
  const input = migrateStatusGroups(fullWorkspace());
  const original = structuredClone(input);
  const result = migrateNavigationState(input);
  assert.equal(result.schemaVersion, 14);
  assert.deepEqual(result.ui.recentVisits, []);
  assert.deepEqual(result.ui.favoritePageIds, []);
  assert.equal(result.ui.sidebarWidth, 248);
  assert.deepEqual(input, original);
  assert.deepEqual(result, { ...original, schemaVersion: 14, ui: { ...original.ui, recentVisits: [], favoritePageIds: [], sidebarWidth: 248 } });
});

test("v14 keeps existing valid values", () => {
  const input = migrateStatusGroups(fullWorkspace());
  input.ui = { ...input.ui, recentVisits: [{ pageId: "p-a", visitedAt: "2026-11-01T12:00:00.000Z" }], favoritePageIds: ["p-a"], sidebarWidth: 320, workspaceName: "独立空间", workspaceIcon: "🌿", sidebarCollapsed: true, unknown: { kept: true } };
  assert.deepEqual(migrateNavigationState(input), { ...input, schemaVersion: 14 });
});

test("v14 clamps an invalid sidebar width", () => {
  for (const width of [undefined, null, 199, 481, "248", NaN, Infinity]) {
    assert.equal(migrateNavigationState({ schemaVersion: 13, ui: { sidebarWidth: width, recentVisits: {}, favoritePageIds: false } }).ui.sidebarWidth, 248);
  }
  for (const width of [200, 248, 480]) assert.equal(migrateNavigationState({ schemaVersion: 13, ui: { sidebarWidth: width } }).ui.sidebarWidth, width);
});

test("v14 is idempotent", () => {
  const result = migrateNavigationState(fullWorkspace());
  assert.deepEqual(migrateNavigationState(result), result);
  assert.equal(migrateNavigationState({ schemaVersion: 16, future: true }).schemaVersion, 16);
});
