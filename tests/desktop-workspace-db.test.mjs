import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fullWorkspace, FIXTURE_TIME } from "./fixtures/full-workspace.mjs";
import { upgradeWorkspace, CURRENT_SCHEMA_VERSION } from "../src/persistence/migrations.js";
import { initializeWorkspace, openWorkspaceDatabase, prepareWritable, readAllRows, assembleWorkspace, applyChangeset, writeWorkspaceDiff, quickCheck, vacuumInto, MAX_ENTITY_BYTES } from "../electron/main/storage/workspaceDb.js";
import { createChangeTracker } from "../src/persistence/changeset.js";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";

const NEXT_TIME = "2026-10-01T08:00:01.000Z";
const hash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function database(context, { seed = true } = {}) {
  const directory = createIsolatedDirectory("workspace-db");
  let db = openWorkspaceDatabase(path.join(directory, "workspace.db"));
  prepareWritable(db);
  const workspace = { ...upgradeWorkspace(fullWorkspace()), workspaceId: "ws-database-test" };
  if (seed) initializeWorkspace(db, workspace, { generation: "gen-test", now: FIXTURE_TIME });
  context.after(() => { if (db) db.close(); removeIsolatedDirectory(directory); });
  return { directory, workspace, get db() { return db; }, close() { db.close(); db = undefined; }, reopen() { db = openWorkspaceDatabase(path.join(directory, "workspace.db")); return db; } };
}

function changes(upserts = [], deletes = [], ui = null) {
  return { generation: "gen-test", schemaVersion: CURRENT_SCHEMA_VERSION, upserts, deletes, ui };
}

test("a new database uses WAL and synchronous FULL", (context) => {
  const fixture = database(context, { seed: false });
  assert.equal(fixture.db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
  assert.equal(fixture.db.prepare("PRAGMA synchronous").get().synchronous, 2);
  assert.equal(fixture.db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
});

test("full fixture round-trips through the database", (context) => {
  const fixture = database(context);
  assert.deepEqual(assembleWorkspace(readAllRows(fixture.db)), fixture.workspace);
  fixture.close();
  assert.deepEqual(assembleWorkspace(readAllRows(fixture.reopen())), fixture.workspace);
});

test("applyChangeset writes only the given entities and the ui", (context) => {
  const fixture = database(context);
  const before = fixture.db.prepare("SELECT collection, id, json, updated_at FROM entities").all();
  const page = { ...fixture.workspace.pages[0], title: "已修改", updatedAt: NEXT_TIME };
  const result = applyChangeset(fixture.db, changes([{ collection: "pages", id: page.id, json: JSON.stringify(page) }], [], { selectedPageId: page.id }), { now: NEXT_TIME, expectedGeneration: "gen-test" });
  assert.deepEqual(result, { savedAt: NEXT_TIME });
  const after = fixture.db.prepare("SELECT collection, id, json, updated_at FROM entities").all();
  assert.deepEqual(after.filter((entry) => entry.id !== page.id || entry.collection !== "pages"), before.filter((entry) => entry.id !== page.id || entry.collection !== "pages"));
  const saved = assembleWorkspace(readAllRows(fixture.db));
  assert.equal(saved.pages[0].title, page.title);
  assert.deepEqual(saved.ui, { selectedPageId: page.id });
});

test("applyChangeset rejects the whole batch on any invalid entry", (context) => {
  const fixture = database(context);
  const original = readAllRows(fixture.db);
  const valid = { collection: "pages", id: fixture.workspace.pages[0].id, json: JSON.stringify({ ...fixture.workspace.pages[0], title: "不得保存" }) };
  const invalid = [
    { collection: "vaultItems", id: "page", json: '{"id":"page"}' },
    { collection: "pages", id: "", json: '{"id":""}' },
    { collection: "pages", id: "a".repeat(201), json: JSON.stringify({ id: "a".repeat(201) }) },
    { collection: "pages", id: "broken", json: "{" },
    { collection: "pages", id: "mismatch", json: '{"id":"other"}' },
    { collection: "pages", id: "large", json: JSON.stringify({ id: "large", body: "x".repeat(MAX_ENTITY_BYTES) }) },
  ];
  for (const entry of invalid) {
    assert.throws(() => applyChangeset(fixture.db, changes([valid, entry]), { now: NEXT_TIME, expectedGeneration: "gen-test" }), { code: "E_INVALID_ARGUMENT" });
    assert.deepEqual(readAllRows(fixture.db), original);
  }
  for (const entry of [{ collection: "pages", id: "" }, { collection: "not-a-collection", id: "p" }]) {
    assert.throws(() => applyChangeset(fixture.db, changes([valid], [entry]), { now: NEXT_TIME, expectedGeneration: "gen-test" }), { code: "E_INVALID_ARGUMENT" });
    assert.deepEqual(readAllRows(fixture.db), original);
  }
});

test("applyChangeset rejects a stale generation with E_CONFLICT", (context) => {
  const fixture = database(context);
  const before = readAllRows(fixture.db);
  assert.throws(() => applyChangeset(fixture.db, { ...changes(), generation: "gen-old" }, { now: NEXT_TIME, expectedGeneration: "gen-test" }), { code: "E_CONFLICT" });
  assert.deepEqual(readAllRows(fixture.db), before);
});

test("writeWorkspaceDiff writes nothing when nothing changed", (context) => {
  const fixture = database(context);
  const before = readAllRows(fixture.db);
  const changesBefore = fixture.db.prepare("SELECT total_changes() AS count").get().count;
  assert.deepEqual(writeWorkspaceDiff(fixture.db, before, fixture.workspace, { now: NEXT_TIME }), { changed: false, savedAt: FIXTURE_TIME });
  assert.equal(fixture.db.prepare("SELECT total_changes() AS count").get().count, changesBefore);
  assert.deepEqual(readAllRows(fixture.db), before);
});

test("quickCheck reports a corrupted page without changing the file", (context) => {
  const fixture = database(context);
  fixture.close();
  const file = path.join(fixture.directory, "workspace.db");
  const bytes = fs.readFileSync(file);
  assert.ok(bytes.length > 8704);
  bytes.fill(0xff, 8192, 8704);
  fs.writeFileSync(file, bytes);
  const before = hash(file);
  const db = openWorkspaceDatabase(file, { readOnly: true });
  try { assert.notEqual(quickCheck(db), "ok"); } finally { db.close(); }
  assert.equal(hash(file), before);
  assert.equal(fs.existsSync(`${file}-wal`), false);
});

test("quickCheck reports a non-database file without changing it", (context) => {
  const directory = createIsolatedDirectory("non-database");
  context.after(() => removeIsolatedDirectory(directory));
  const file = path.join(directory, "workspace.db");
  fs.writeFileSync(file, "definitely not a database", "utf8");
  const before = hash(file);
  const db = openWorkspaceDatabase(file, { readOnly: true });
  try { assert.notEqual(quickCheck(db), "ok"); } finally { db.close(); }
  assert.equal(hash(file), before);
});

test("collection order survives prepending, deletion and a restart", (context) => {
  const fixture = database(context);
  const added = { ...fixture.workspace.pages[0], id: "new-prepended", title: "最前" };
  const next = { ...fixture.workspace, pages: [added, ...fixture.workspace.pages.slice(1).reverse()] };
  const diff = createChangeTracker(fixture.workspace).diff(next);
  assert.equal(diff.upserts.filter((entry) => entry.collection === "pages").length, next.pages.length);
  applyChangeset(fixture.db, { generation: "gen-test", schemaVersion: CURRENT_SCHEMA_VERSION, ...diff }, { now: NEXT_TIME, expectedGeneration: "gen-test" });
  fixture.close();
  const actual = assembleWorkspace(readAllRows(fixture.reopen()));
  assert.deepEqual(actual.pages, next.pages);
  assert.equal("collectionOrder" in actual, false);
});

test("extra top-level fields and source timestamps remain exact", (context) => {
  const fixture = database(context, { seed: false });
  const workspace = { ...fixture.workspace, extensionData: { unknown: ["保留", { value: 42 }] }, collectionOrder: "user-owned-extra" };
  initializeWorkspace(fixture.db, workspace, { generation: "gen-test", now: NEXT_TIME });
  assert.deepEqual(assembleWorkspace(readAllRows(fixture.db)), workspace);
  const copied = path.join(fixture.directory, "copy.db");
  vacuumInto(fixture.db, copied);
  const copy = openWorkspaceDatabase(copied, { readOnly: true });
  try { assert.deepEqual(assembleWorkspace(readAllRows(copy)), workspace); } finally { copy.close(); }
});
