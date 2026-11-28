import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { backup } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { fullWorkspace, FIXTURE_TIME } from "./fixtures/full-workspace.mjs";
import { CURRENT_SCHEMA_VERSION } from "../src/persistence/migrations.js";
import { normalizeLoadedWorkspace } from "../src/persistence/normalize.js";
import { createWorkspaceService } from "../electron/main/storage/workspaceService.js";
import { openWorkspaceDatabase, prepareWritable, initializeWorkspace, readAllRows, assembleWorkspace } from "../electron/main/storage/workspaceDb.js";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";

const frozen = JSON.parse(fs.readFileSync(fileURLToPath(new URL("./fixtures/workspace-v10.json", import.meta.url)), "utf8"));
const frozenPageId = frozen.pages[0].id;
const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function fixture(context, options = {}) {
  const dataRoot = createIsolatedDirectory("workspace-service");
  let sequence = 0;
  const service = createWorkspaceService({ dataRoot, now: FIXTURE_TIME, idFactory: (prefix) => `${prefix}-service-${++sequence}`, normalize: normalizeLoadedWorkspace, ...options });
  context.after(() => { service.close(); removeIsolatedDirectory(dataRoot); });
  return { dataRoot, service, file: path.join(dataRoot, "workspace.db") };
}

function seed(file, workspace) {
  const db = openWorkspaceDatabase(file);
  try {
    prepareWritable(db);
    initializeWorkspace(db, workspace, { generation: "gen-service", now: FIXTURE_TIME });
  } finally { db.close(); }
}

function leaveCommittedWal(file, pageId) {
  const moduleUrl = new URL("../electron/main/storage/workspaceDb.js", import.meta.url).href;
  const script = `import { openWorkspaceDatabase, prepareWritable } from ${JSON.stringify(moduleUrl)};
    const db = openWorkspaceDatabase(process.argv[1]);
    prepareWritable(db);
    db.exec("PRAGMA wal_autocheckpoint=0");
    const page = JSON.parse(db.prepare("SELECT json FROM entities WHERE collection='pages' AND id=?").get(process.argv[2]).json);
    page.title = "Committed WAL edit";
    db.prepare("UPDATE entities SET json=? WHERE collection='pages' AND id=?").run(JSON.stringify(page), page.id);
    process.exit(0);`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script, file, pageId], { env: { ...process.env, TEMP: path.dirname(file), TMP: path.dirname(file) }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.statSync(`${file}-wal`).size > 0);
}

test("an empty data root gets the blank workspace", async (context) => {
  const { service } = fixture(context);
  const result = await service.load();
  assert.equal(result.workspace.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(result.workspace.folders.filter((folder) => !folder.system).length, 1);
  assert.equal(result.workspace.folders.filter((folder) => folder.system === "inbox").length, 1);
  assert.equal(result.workspace.folders.length, 2);
  const inbox = result.workspace.folders.find((folder) => folder.system === "inbox");
  assert.equal(inbox.id, "system-inbox");
  assert.equal(inbox.name, "收件箱");
  assert.equal(result.workspace.pages[0].title, "开始使用 Life Atlas");
  assert.equal(result.workspace.pages[0].content.length, 5);
  assert.match(result.generation, /^gen-/);
});

test("a schema 10 database is snapshotted, migrated and written back", async (context) => {
  let observed;
  const { service, file, dataRoot } = fixture(context, {
    beforeMigration: async (args) => {
      assert.equal(args.workspace.schemaVersion, 10);
      const snapshotDir = path.join(args.dataRoot, "snapshots", "test-pre-migration");
      fs.mkdirSync(snapshotDir, { recursive: true });
      observed = path.join(snapshotDir, "workspace.db");
      await backup(args.databases[0].db, observed);
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
  });
  seed(file, frozen);
  const result = await service.load();
  assert.equal(result.workspace.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(fs.existsSync(observed), true);
  assert.equal(path.dirname(path.dirname(observed)), path.join(dataRoot, "snapshots"));
  const snapshot = openWorkspaceDatabase(observed, { readOnly: true });
  try { assert.deepEqual(assembleWorkspace(readAllRows(snapshot)), frozen); } finally { snapshot.close(); }
  assert.deepEqual(service.readWorkspace(), result.workspace);
  assert.equal(service.getMeta("generation"), "gen-service");
});

test("normalization results are written back", async (context) => {
  const { service, file } = fixture(context);
  const workspace = normalizeLoadedWorkspace(fullWorkspace(), { fallbackWorkspace: fullWorkspace(), now: FIXTURE_TIME, idFactory: () => "ws-normalization" });
  delete workspace.pages[0].settings;
  delete workspace.pages[0].summaryUpdatedAt;
  seed(file, workspace);
  const result = await service.load();
  assert.equal(typeof result.workspace.pages[0].settings, "object");
  assert.equal(typeof result.workspace.pages[0].summaryUpdatedAt, "string");
  assert.deepEqual(service.readWorkspace(), result.workspace);
});

test("a corrupted database enters read-only error mode and is never modified", async (context) => {
  const { service, file } = fixture(context);
  fs.writeFileSync(file, "this is corrupt", "utf8");
  const before = sha256(file);
  await assert.rejects(service.load(), { code: "E_CORRUPT" });
  await assert.rejects(service.load(), { code: "E_CORRUPT" });
  await assert.rejects(service.applyChanges({}), { code: "E_CORRUPT" });
  assert.deepEqual(service.status(), { loaded: false, readOnlyError: true });
  assert.equal(sha256(file), before);
  assert.equal(fs.existsSync(`${file}-wal`), false);
});

test("timings record load and apply durations", async (context) => {
  const { service } = fixture(context);
  const result = await service.load();
  await service.applyChanges({ generation: result.generation, schemaVersion: CURRENT_SCHEMA_VERSION, upserts: [], deletes: [], ui: { ...result.workspace.ui, privateExpanded: false } });
  assert.ok(service.timings.lastLoadMs > 0);
  assert.ok(service.timings.lastApplyMs > 0);
});

test("invalid stored JSON is checked before writable pragmas", async (context) => {
  const { service, file } = fixture(context);
  seed(file, normalizeLoadedWorkspace(fullWorkspace(), { fallbackWorkspace: fullWorkspace(), now: FIXTURE_TIME, idFactory: () => "ws-json" }));
  const db = openWorkspaceDatabase(file);
  db.prepare("UPDATE entities SET json=? WHERE collection='pages' AND id='p-a1'").run("{");
  db.close();
  const before = sha256(file);
  await assert.rejects(service.load(), { code: "E_CORRUPT" });
  assert.equal(sha256(file), before);
  assert.equal(fs.existsSync(`${file}-wal`), false);
});

test("failed or missing migration snapshots leave the database untouched", async (context) => {
  const first = fixture(context);
  seed(first.file, frozen);
  const firstBefore = sha256(first.file);
  await assert.rejects(first.service.load(), { code: "E_IO" });
  assert.equal(sha256(first.file), firstBefore);
  assert.equal(fs.existsSync(`${first.file}-wal`), false);
  const second = fixture(context, { beforeMigration: async () => { await Promise.resolve(); throw Object.assign(new Error("snapshot failed"), { code: "E_IO" }); } });
  seed(second.file, frozen);
  const secondBefore = sha256(second.file);
  await assert.rejects(second.service.load(), { code: "E_IO" });
  assert.equal(sha256(second.file), secondBefore);
  assert.equal(fs.existsSync(`${second.file}-wal`), false);
});

test("replacing a workspace changes generation and rejects stale saves", async (context) => {
  const { service } = fixture(context);
  const before = await service.load();
  const workspace = { ...before.workspace, pages: before.workspace.pages.map((page) => ({ ...page, title: "恢复后" })) };
  const replacement = service.replaceWorkspace(workspace);
  assert.notEqual(replacement.generation, before.generation);
  await assert.rejects(service.applyChanges({ generation: before.generation, schemaVersion: CURRENT_SCHEMA_VERSION, upserts: [], deletes: [], ui: null }), { code: "E_CONFLICT" });
  assert.deepEqual(service.readWorkspace(), workspace);
});

test("restore suspension rejects saves until writes resume", async (context) => {
  const { service } = fixture(context);
  const before = await service.load();
  const changeset = { generation: before.generation, schemaVersion: CURRENT_SCHEMA_VERSION, upserts: [], deletes: [], ui: { ...before.workspace.ui, privateExpanded: false } };
  service.suspendWrites();
  await assert.rejects(service.applyChanges(changeset), { code: "E_CONFLICT" });
  assert.deepEqual(service.readWorkspace(), before.workspace);
  service.resumeWrites();
  await service.applyChanges(changeset);
  assert.equal(service.readWorkspace().ui.privateExpanded, false);
});

test("reopen clears a corrupt latch only after an explicit replacement", async (context) => {
  const { service, file } = fixture(context);
  fs.writeFileSync(file, "not a database");
  await assert.rejects(service.load(), { code: "E_CORRUPT" });
  fs.unlinkSync(file);
  const workspace = normalizeLoadedWorkspace(fullWorkspace(), { fallbackWorkspace: fullWorkspace(), now: FIXTURE_TIME, idFactory: () => "ws-recovered" });
  seed(file, workspace);
  await assert.rejects(service.load(), { code: "E_CORRUPT" });
  const result = await service.reopen();
  assert.deepEqual(service.status(), { loaded: true, readOnlyError: false });
  assert.deepEqual(result.workspace, workspace);
  assert.equal(result.generation, "gen-service");
});

test("an application upgrade is snapshotted before the original database is written", async (context) => {
  let originalHash;
  let snapshotFile;
  let observed = 0;
  const { service, file, dataRoot } = fixture(context, {
    appVersion: "0.1.0",
    beforeUpgrade: async (args) => {
      observed += 1;
      assert.equal(args.reason, "pre-upgrade");
      assert.equal(args.appVersion, "0.1.0");
      assert.equal(args.previousAppVersion, "0.0.9");
      assert.equal(args.schemaVersion, CURRENT_SCHEMA_VERSION);
      assert.equal(sha256(file), originalHash);
      assert.equal(fs.existsSync(`${file}-wal`), false);
      snapshotFile = path.join(dataRoot, "snapshots", "upgrade", "workspace.db");
      fs.mkdirSync(path.dirname(snapshotFile), { recursive: true });
      await backup(args.databases[0].db, snapshotFile);
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(sha256(file), originalHash);
    },
  });
  const workspace = normalizeLoadedWorkspace(fullWorkspace(), { fallbackWorkspace: fullWorkspace(), now: FIXTURE_TIME, idFactory: () => "ws-upgrade" });
  seed(file, workspace);
  const prior = openWorkspaceDatabase(file);
  prior.prepare("INSERT INTO meta(key,value) VALUES ('lastAppVersion',?)").run(JSON.stringify("0.0.9"));
  prior.close();
  originalHash = sha256(file);
  const result = await service.load();
  assert.equal(observed, 1);
  assert.deepEqual(result.workspace, workspace);
  assert.equal(service.getMeta("lastAppVersion"), "0.1.0");
  const snapshot = openWorkspaceDatabase(snapshotFile, { readOnly: true });
  try {
    assert.equal(JSON.parse(snapshot.prepare("SELECT value FROM meta WHERE key='lastAppVersion'").get().value), "0.0.9");
    assert.deepEqual(assembleWorkspace(readAllRows(snapshot)), workspace);
  } finally { snapshot.close(); }
});

test("fresh and unchanged application versions do not create upgrade snapshots", async (context) => {
  let snapshots = 0;
  const { service } = fixture(context, { appVersion: "0.1.0", beforeUpgrade: async () => { snapshots += 1; } });
  await service.load();
  assert.equal(service.getMeta("lastAppVersion"), "0.1.0");
  await service.reopen();
  assert.equal(snapshots, 0);
});

test("missing and failed upgrade snapshots preserve the database and app version", async (context) => {
  const workspace = normalizeLoadedWorkspace(fullWorkspace(), { fallbackWorkspace: fullWorkspace(), now: FIXTURE_TIME, idFactory: () => "ws-upgrade-failure" });
  for (const beforeUpgrade of [undefined, async () => { throw Object.assign(new Error("snapshot failed"), { code: "E_IO" }); }]) {
    const { service, file } = fixture(context, { appVersion: "0.1.0", beforeUpgrade });
    seed(file, workspace);
    const prior = openWorkspaceDatabase(file);
    prior.prepare("INSERT INTO meta(key,value) VALUES ('lastAppVersion',?)").run(JSON.stringify("0.0.9"));
    prior.close();
    const originalHash = sha256(file);
    await assert.rejects(service.load(), { code: "E_IO" });
    assert.equal(sha256(file), originalHash);
    assert.equal(fs.existsSync(`${file}-wal`), false);
    assert.deepEqual(service.status(), { loaded: false, readOnlyError: false });
  }
});

test("failed migration inspection never mutates original crash WAL files", async (context) => {
  let inspected = false;
  const { service, file, dataRoot } = fixture(context, {
    beforeMigration: async ({ databases, workspace }) => {
      inspected = true;
      assert.equal(workspace.pages.find((page) => page.id === frozenPageId).title, "Committed WAL edit");
      assert.equal(assembleWorkspace(readAllRows(databases[0].db)).pages.find((page) => page.id === frozenPageId).title, "Committed WAL edit");
      throw Object.assign(new Error("snapshot failed"), { code: "E_IO" });
    },
  });
  seed(file, frozen);
  leaveCommittedWal(file, frozenPageId);
  const original = new Map([file, `${file}-wal`, `${file}-shm`].map((target) => [target, sha256(target)]));
  await assert.rejects(service.load(), { code: "E_IO" });
  assert.equal(inspected, true);
  for (const [target, hash] of original) assert.equal(sha256(target), hash);
  assert.deepEqual(fs.readdirSync(path.join(dataRoot, "runtime")), []);
});

test("committed crash WAL edits survive checked migration and its snapshot", async (context) => {
  let snapshotFile;
  const { service, file, dataRoot } = fixture(context, {
    beforeMigration: async ({ databases }) => {
      snapshotFile = path.join(dataRoot, "snapshots", "crash", "workspace.db");
      fs.mkdirSync(path.dirname(snapshotFile), { recursive: true });
      await backup(databases[0].db, snapshotFile);
    },
  });
  seed(file, frozen);
  leaveCommittedWal(file, frozenPageId);
  const result = await service.load();
  assert.equal(result.workspace.pages.find((page) => page.id === frozenPageId).title, "Committed WAL edit");
  const snapshot = openWorkspaceDatabase(snapshotFile, { readOnly: true });
  try {
    const original = assembleWorkspace(readAllRows(snapshot));
    assert.equal(original.schemaVersion, 10);
    assert.equal(original.pages.find((page) => page.id === frozenPageId).title, "Committed WAL edit");
  } finally { snapshot.close(); }
  service.close();
  assert.equal(fs.existsSync(`${file}-wal`), false);
});

test("a busy checkpoint cannot silently close the workspace connection", async (context) => {
  const { service, file } = fixture(context);
  const before = await service.load();
  service.db.exec("PRAGMA busy_timeout=20");
  const reader = openWorkspaceDatabase(file, { readOnly: true, immutable: false });
  try {
    reader.exec("BEGIN");
    reader.prepare("SELECT value FROM meta WHERE key='ui'").get();
    await service.applyChanges({ generation: before.generation, schemaVersion: CURRENT_SCHEMA_VERSION, upserts: [], deletes: [], ui: { ...before.workspace.ui, privateExpanded: false } });
    assert.throws(() => service.checkpoint(), { code: "E_IO" });
    assert.throws(() => service.close(), { code: "E_IO" });
    assert.deepEqual(service.status(), { loaded: true, readOnlyError: false });
    reader.exec("ROLLBACK");
  } finally { reader.close(); }
  service.close();
  assert.deepEqual(service.status(), { loaded: false, readOnlyError: false });
});
