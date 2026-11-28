import test from "node:test";
import assert from "node:assert/strict";
import { upgradeWorkspace, CURRENT_SCHEMA_VERSION } from "../src/persistence/migrations.js";
import { createBrowserWorkspaceRepository, workspaceStorageKey } from "../src/persistence/workspaceRepository.js";
import { workspaceToFiles, filesToWorkspace, jsonBytes, parseJsonBytes } from "../src/backup/serialize.js";
import { verifyPackage } from "../src/backup/verify.js";
import { createPageVersion } from "../src/domain/pageHistory.js";
import { permanentlyDelete } from "../src/domain/trash.js";
import { checkWorkspaceIntegrity } from "../src/domain/integrity.js";
import { fullWorkspace, FIXTURE_TIME } from "./fixtures/full-workspace.mjs";
import { backupFixture, memoryReader, memoryStorage } from "./fixtures/backup-helpers.mjs";

const versionsFile = "workspace/entities/pageVersions.jsonl";
const now = Date.parse(FIXTURE_TIME);

function workspaceWithVersions() {
  const workspace = { ...upgradeWorkspace(fullWorkspace()), schemaVersion: 16, workspaceId: "ws-history-storage", savedAt: FIXTURE_TIME };
  workspace.pageVersions = [
    createPageVersion(workspace.pages.find((page) => page.id === "p-a1-child"), { id: "pv-01", now: now - 3600000, reason: "before-edit" }),
    createPageVersion(workspace.pages.find((page) => page.id === "p-a1-child"), { id: "pv-02", now: now - 1800000, reason: "idle" }),
    createPageVersion(workspace.pages.find((page) => page.id === "p-b-solo"), { id: "pv-03", now: now - 900000, reason: "interval" }),
  ];
  return workspace;
}

test("page versions round trip through a backup", () => {
  const workspace = workspaceWithVersions();
  const before = structuredClone(workspace);
  const files = new Map(workspaceToFiles(workspace).map((file) => [file.path, file.bytes]));
  assert.ok(files.has(versionsFile));
  const restored = filesToWorkspace((filePath) => files.get(filePath));
  assert.equal(restored.pageVersions.length, 3);
  for (const [index, version] of workspace.pageVersions.entries()) assert.deepEqual(restored.pageVersions[index], version);
  assert.deepEqual(workspace, before);
});

test("older backups without page versions still restore", async () => {
  const workspace = { ...workspaceWithVersions(), schemaVersion: 15, pageVersions: [] };
  const fixture = await backupFixture({ workspace });
  assert.equal(fixture.files.has(versionsFile), false);
  assert.equal(parseJsonBytes(fixture.files.get("workspace/meta.json")).schemaVersion, 15);
  const restored = filesToWorkspace((filePath) => fixture.files.get(filePath));
  assert.deepEqual(restored.pageVersions, []);
  const report = await verifyPackage(memoryReader(fixture.files), { currentSchemaVersion: CURRENT_SCHEMA_VERSION });
  assert.equal(report.ok, true, JSON.stringify(report.problems));
  assert.equal(report.problems.some((problem) => problem.code === "MISSING_FILE"), false);
});

test("schema 16 backups must contain page versions", async () => {
  const fixture = await backupFixture({ workspace: workspaceWithVersions() });
  assert.ok(fixture.files.has(versionsFile));
  const files = new Map(fixture.files);
  files.delete(versionsFile);
  const manifest = parseJsonBytes(files.get("manifest.json"));
  manifest.files = manifest.files.filter((file) => file.path !== versionsFile);
  files.set("manifest.json", jsonBytes(manifest));
  const report = await verifyPackage(memoryReader(files), { currentSchemaVersion: CURRENT_SCHEMA_VERSION });
  assert.equal(report.ok, false);
  assert.ok(report.problems.some((problem) => problem.code === "MISSING_FILE" && problem.path === versionsFile), JSON.stringify(report.problems));
  assert.throws(() => filesToWorkspace((filePath) => files.get(filePath)), /pageVersions/);
});

test("browser storage does not keep page versions", () => {
  const workspace = workspaceWithVersions();
  workspace.pageVersions = workspace.pageVersions.slice(0, 2);
  const before = structuredClone(workspace);
  const storage = memoryStorage();
  const repository = createBrowserWorkspaceRepository(storage, { now: () => now });
  const saved = repository.save(workspace);
  assert.equal(saved.ok, true);
  const stored = JSON.parse(storage.getItem(workspaceStorageKey));
  assert.deepEqual(stored.pageVersions, []);
  assert.equal(workspace.pageVersions.length, 2);
  assert.deepEqual(workspace, before);
});

test("permanently deleting a page removes its versions", () => {
  const workspace = workspaceWithVersions();
  const before = structuredClone(workspace);
  assert.ok(workspace.pageVersions.some((version) => version.pageId === "p-b-solo"));
  const deleted = permanentlyDelete(workspace, { pageIds: ["p-b-solo"], folderIds: [] });
  assert.equal(deleted.pageVersions.some((version) => version.pageId === "p-b-solo"), false);
  assert.deepEqual(deleted.pageVersions, workspace.pageVersions.filter((version) => version.pageId !== "p-b-solo"));
  const integrity = checkWorkspaceIntegrity(deleted);
  assert.equal(integrity.ok, true, JSON.stringify(integrity.problems));
  assert.equal(integrity.problems.some((problem) => problem.severity === "error"), false);
  assert.deepEqual(workspace, before);
});

test("orphan versions are reported", () => {
  const workspace = workspaceWithVersions();
  const orphan = { ...workspace.pageVersions[0], id: "pv-orphan", pageId: "missing-page" };
  workspace.pageVersions.push(orphan);
  const before = structuredClone(workspace);
  const report = checkWorkspaceIntegrity(workspace);
  assert.equal(report.ok, true);
  assert.ok(report.problems.some((problem) => problem.severity === "warning" && problem.code === "PAGE_VERSION_ORPHAN" && problem.collection === "pageVersions" && problem.id === orphan.id), JSON.stringify(report.problems));
  assert.deepEqual(workspace, before);
});
