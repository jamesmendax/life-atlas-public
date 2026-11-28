import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { canEditDatabaseSource, canEditDatabaseItems } from "../src/domain/databaseWriteAccess.js";
import { dataSourceById, updateDatabaseView as updateDatabaseViewRecord } from "../src/domain/database.js";
import { updateTableItemsProperty } from "../src/domain/tableRecordActions.js";
import { executeDatabaseAction } from "../src/domain/databaseActions.js";
import { createAutosaveController } from "../src/persistence/autosaveController.js";

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
function callback(name, dependencies) {
  const declaration = app.match(new RegExp(`^  ((?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^  \\})`, "m"));
  assert.ok(declaration, `App callback ${name} must be present`);
  return new Function(...Object.keys(dependencies), `return (${declaration[1]});`)(...Object.values(dependencies));
}
function fixture() {
  return {
    folders: [{ id: "folder" }], ui: {},
    pages: ["owner", "one-page", "two-page"].map(id => ({ id, title: id, folderId: "folder", content: [], archivedAt: null })),
    dataSources: [{ id: "source", ownerPageId: "owner", title: "Ledger", properties: [
      { id: "title", name: "Title", type: "title" }, { id: "amount", name: "Amount", type: "number" },
    ] }],
    databaseItems: ["one", "two"].map(id => ({ id, sourceId: "source", pageId: `${id}-page`, values: { title: id, amount: 1 } })),
    databaseViews: [{ id: "table", sourceId: "source", name: "Table", type: "table", config: {}, sorts: [] }], relations: [],
  };
}
const archived = (state, id) => ({ ...state, pages: state.pages.map(page => page.id === id ? { ...page, archivedAt: "2026-11-27T12:00:00Z" } : page) });

test("source and record writes follow inherited archive state without treating references as ownership", () => {
  const state = fixture();
  assert.ok(canEditDatabaseSource(state, "source"));
  assert.ok(canEditDatabaseItems(state, "source", ["one", "two"]));
  const ownArchive = archived(state, "owner");
  assert.equal(canEditDatabaseSource(ownArchive, "source"), false);
  assert.equal(canEditDatabaseItems(ownArchive, "source", ["one"]), false);
  const recordArchive = archived(state, "one-page");
  assert.ok(canEditDatabaseSource(recordArchive, "source"));
  assert.equal(canEditDatabaseItems(recordArchive, "source", ["one"]), false);
  assert.ok(canEditDatabaseItems(recordArchive, "source", ["two"]));
});

test("queued App metadata writes recheck an owner archived after the user event", () => {
  const state = fixture(), queue = [];
  const dependencies = { setWorkspace: update => queue.push(update), canEditDatabaseSource,
    dataSourceById, updateDatabaseViewRecord, initialViewConfig: () => assert.fail("Type did not change"), ensureMapPlaceProperty: value => value };
  callback("renameDatabaseSource", dependencies)("source", "Changed");
  callback("updateDatabaseView", dependencies)("table", { name: "Changed" });
  const changedOwner = archived(state, "owner");
  for (const update of queue) assert.equal(update(changedOwner), changedOwner);
  assert.equal(queue[0](state).dataSources[0].title, "Changed");
  assert.equal(queue[1](state).databaseViews[0].name, "Changed");
});

test("bulk writes keep archived records intact and reject an archived owning source", () => {
  const state = archived(fixture(), "one-page");
  const command = { sourceId: "source", itemIds: ["one", "two"], propertyId: "amount", value: 7 };
  const changed = updateTableItemsProperty(state, command);
  assert.equal(changed.databaseItems[0], state.databaseItems[0]);
  assert.equal(changed.databaseItems[1].values.amount, 7);
  const sourceArchived = archived(state, "owner");
  assert.equal(updateTableItemsProperty(sourceArchived, command), sourceArchived);
});

test("App bulk callbacks cannot apply a queued ordinary edit after the source was archived", () => {
  const state = fixture(), queue = [];
  const update = callback("updateDatabaseItemsProperty", { currentWorkspaceSnapshot: () => state, dataSourceById,
    canEditDatabaseSource, hasStatusWorkflow: () => false, setWorkspace: transform => queue.push(transform), updateTableItemsProperty });
  update("source", ["one", "two"], "amount", 8);
  assert.equal(queue.length, 1);
  const sourceArchived = archived(state, "owner");
  assert.equal(queue[0](sourceArchived), sourceArchived);
  assert.equal(queue[0](state).databaseItems[0].values.amount, 8);
});

test("database actions refuse an archived target before adding records or changing the source", () => {
  const state = fixture();
  state.pages.push({ id: "target-owner", folderId: "folder", title: "Archive", content: [], archivedAt: "2026-11-27T12:00:00Z" });
  state.dataSources.push({ id: "target", ownerPageId: "target-owner", properties: [{ id: "title", type: "title", name: "Title" }] });
  const before = JSON.stringify(state);
  assert.throws(() => executeDatabaseAction(state, { sourceItemId: "one", operationId: "archive-action",
    action: { type: "createRecord", targetSourceId: "target", title: "Should not be created" } }), /归档/);
  assert.equal(JSON.stringify(state), before);
});

test("permanent deletion replaces the live synced sources when their database members changed", () => {
  const original = { ...fixture(), syncedSources: [{ id: "sync", revision: 1, blocks: [] }] };
  const next = { ...original, syncedSources: [{ id: "sync", revision: 2, blocks: [{ id: "cleaned", type: "paragraph", content: "Surviving source" }] }] };
  const calls = [];
  const apply = callback("applyPermanentDeletion", {
    snapshotRef: { current: original }, syncedStore: { replaceAll: value => calls.push(["sync", value]) },
    setWorkspace: value => calls.push(["workspace", value]),
    setSelectedPageId: () => {}, setSelectedFolderId: () => {}, setExpanded: () => {},
  });
  apply(next);
  assert.deepEqual(calls, [["sync", next.syncedSources], ["workspace", next]]);
  calls.length = 0;
  apply(original);
  assert.deepEqual(calls, [["workspace", original]]);
});

test("restoring history awaits its new snapshot and reports that snapshot's write failure", async () => {
  for (const fail of [false, true]) {
    const initial = { revision: 1 }, restored = { revision: 2 }, writes = [];
    let snapshot = initial;
    const controller = createAutosaveController({ save: async value => {
      writes.push(value);
      return fail && value === restored ? { ok: false, error: { message: "synthetic write failure" } } : { ok: true };
    } });
    try {
      controller.update(initial); await controller.flush();
      const restore = callback("restoreDatabaseHistory", {
        currentWorkspaceSnapshot: () => snapshot,
        previewDatabaseRestore: () => ({ ok: true, expectedSignature: "version-signature" }),
        assertDatabaseRestoreAttachments: async () => {}, restoreDatabaseVersion: () => restored, makeId: () => "version-id",
        commitDatabaseCommand: execute => { const result = execute(snapshot); snapshot = result.workspace; return result; },
        saveController: { current: controller }, flushWorkspace: () => controller.flush(),
      });
      if (fail) await assert.rejects(() => restore("source", "version", "version-signature"), /synthetic write failure/);
      else await restore("source", "version", "version-signature");
      assert.deepEqual(writes, [initial, restored]);
    } finally { controller.dispose(); }
  }
});
