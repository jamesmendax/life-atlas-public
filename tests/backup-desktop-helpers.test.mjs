import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { exportFullBackup } from "../electron/main/backup/desktopExport.js";
import { sha256File } from "../electron/main/backup/files.js";
import { createDesktopBackupContext, readClosedBackupWorkspace, readBackupFileWorkspace, assertBackupWorkspaceEqual, assertBackupWorkspaceEntitiesEqual, assertBackupWorkspaceAfterInitialVisit, backupWorkspaceAfterInitialVisit, captureBackupWorkspace, tamperBackupFile } from "./desktop/backup-helpers.mjs";
import { FIXTURE_TIME } from "./fixtures/full-workspace.mjs";
import { REPO_ROOT } from "./desktop/helpers.mjs";
import { processReminders } from "../src/domain/reminders.js";
import { recordVisit } from "../src/domain/recents.js";

test("backup desktop scenarios parse without starting Electron", () => {
  for (const file of ["tests/desktop/backup-helpers.mjs", "tests/desktop/first-run.e2e.mjs", "tests/desktop/backup.e2e.mjs", "tests/desktop/backup-v2.e2e.mjs"]) {
    const result = spawnSync(process.execPath, ["--check", file], { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
  }
  const firstRun = fs.readFileSync(path.join(REPO_ROOT, "tests/desktop/first-run.e2e.mjs"), "utf8");
  const backup = fs.readFileSync(path.join(REPO_ROOT, "tests/desktop/backup.e2e.mjs"), "utf8");
  const encrypted = fs.readFileSync(path.join(REPO_ROOT, "tests/desktop/backup-v2.e2e.mjs"), "utf8");
  assert.equal((firstRun.match(/^test\(/gm) || []).length, 3);
  assert.equal((backup.match(/^test\(/gm) || []).length, 9);
  assert.equal((encrypted.match(/^test\(/gm) || []).length, 7);
  const selected = /^(?:exporting with the vault|the recovery key unlocks|an encrypted backup restores|encrypted export and restore|restoring over an existing vault|scheduled backups run)/;
  const names = [...encrypted.matchAll(/^test\("([^"]+)"/gm)].map((match) => match[1]);
  assert.equal(selected.test(""), false);
  assert.equal(names.filter((name) => selected.test(name)).length, 6);
  assert.equal(selected.test("a full backup restores workspace assets and vault on a new data root"), false);
  assert.equal((encrypted.match(/app\.evaluate\(\(electron, value\) => globalThis\.__lifeAtlasTest\.clock\.set\(value\)/g) || []).length, 2);
  const helper = fs.readFileSync(path.join(REPO_ROOT, "tests/desktop/backup-helpers.mjs"), "utf8");
  assert.equal(helper.includes("page.clock.setFixedTime(clock)"), true);
  assert.equal(helper.includes("page.clock.pauseAt"), false);
});

test("desktop corruption fixtures change exactly one byte and preserve the original", async (context) => {
  const value = await createDesktopBackupContext(context);
  const original = path.join(value.dataRoot, "original.lifeatlas");
  await exportFullBackup({ ...value, db: value.workspaceService.db, workspace: value.workspaceService.readWorkspace(), targetPath: original });
  const before = await sha256File(original);
  const corrupted = path.join(value.dataRoot, "corrupted.lifeatlas");
  await tamperBackupFile(original, corrupted);
  assert.deepEqual(await sha256File(original), before);
  const originalBytes = fs.readFileSync(original);
  const corruptedBytes = fs.readFileSync(corrupted);
  assert.equal(corruptedBytes.length, originalBytes.length);
  let changes = 0;
  for (let index = 0; index < originalBytes.length; index += 1) if (originalBytes[index] !== corruptedBytes[index]) changes += 1;
  assert.equal(changes, 1);
});

test("closed backup comparisons detect entity and UI drift", async (context) => {
  const value = await createDesktopBackupContext(context);
  const expected = value.workspaceService.readWorkspace();
  value.workspaceService.close();
  const actual = readClosedBackupWorkspace(value.dataRoot);
  assertBackupWorkspaceEqual(actual, expected);
  const changed = structuredClone(actual);
  changed.pages[0].title = "changed title";
  assert.throws(() => assertBackupWorkspaceEqual(changed, expected));
  const changedUi = structuredClone(actual);
  changedUi.ui.privateExpanded = !changedUi.ui.privateExpanded;
  assert.throws(() => assertBackupWorkspaceEqual(changedUi, expected));
  const changedVersion = structuredClone(actual);
  changedVersion.schemaVersion += 1;
  assert.throws(() => assertBackupWorkspaceEqual(changedVersion, expected));
});

test("initial backup visits preserve entities and every unrelated UI field", async (context) => {
  const value = await createDesktopBackupContext(context);
  const original = value.workspaceService.readWorkspace();
  original.ui = { ...original.ui, recentVisits: [{ pageId: "p-z1", visitedAt: "2026-09-30T08:00:00.000Z" }], futureUi: { retained: true } };
  const before = structuredClone(original);
  const expected = backupWorkspaceAfterInitialVisit(original);
  assert.deepEqual(original, before);
  assertBackupWorkspaceEntitiesEqual(expected, original);
  assert.equal(expected.ui.activeSection, "private");
  assert.deepEqual(expected.ui.recentVisits[0], { pageId: "p-a1", visitedAt: FIXTURE_TIME });
  assert.deepEqual(expected.ui.futureUi, { retained: true });
  assertBackupWorkspaceAfterInitialVisit(expected, original);
  const changed = structuredClone(expected);
  changed.ui.futureUi.retained = false;
  assert.throws(() => assertBackupWorkspaceAfterInitialVisit(changed, original));
  const changedVisit = structuredClone(expected);
  changedVisit.ui.recentVisits[0].visitedAt = "2026-10-02T08:00:00.000Z";
  assert.throws(() => assertBackupWorkspaceAfterInitialVisit(changedVisit, original));
});

test("backup package comparisons retain the exact export-time UI snapshot", async (context) => {
  const value = await createDesktopBackupContext(context);
  const expected = backupWorkspaceAfterInitialVisit(value.workspaceService.readWorkspace());
  expected.ui.futureUi = { retained: true, order: ["p-a1", "p-z1"] };
  const target = path.join(value.dataRoot, "captured-ui.lifeatlas");
  await exportFullBackup({ ...value, db: value.workspaceService.db, workspace: expected, targetPath: target });
  const actual = await readBackupFileWorkspace(target);
  assertBackupWorkspaceEqual(actual, expected);
  actual.ui.recentVisits = [];
  assert.throws(() => assertBackupWorkspaceEqual(actual, expected));
});

test("backup comparisons default only absent optional collections to empty", async (context) => {
  const value = await createDesktopBackupContext(context);
  const expected = { ...value.workspaceService.readWorkspace(), schemaVersion: 14 };
  delete expected.pageVersions;
  const actual = { ...expected, pageVersions: [] };
  assertBackupWorkspaceEqual(actual, expected);
  assertBackupWorkspaceEqual(expected, actual);
  const unexpected = structuredClone(actual);
  unexpected.pageVersions.push({ id: "version-unexpected", pageId: "p-a1" });
  assert.throws(() => assertBackupWorkspaceEqual(unexpected, expected));
  assert.throws(() => assertBackupWorkspaceEqual({ ...expected, pageVersions: null }, expected));
  assert.throws(() => assertBackupWorkspaceEqual({ ...expected, pageVersions: "" }, expected));
  const missingRequired = structuredClone(actual);
  delete missingRequired.pages;
  assert.throws(() => assertBackupWorkspaceEqual(missingRequired, expected));
  const current = { ...expected, schemaVersion: 16, pageVersions: [] };
  const missingCurrent = structuredClone(current);
  delete missingCurrent.pageVersions;
  assert.throws(() => assertBackupWorkspaceEqual(missingCurrent, current));
  assert.throws(() => assertBackupWorkspaceEqual({ ...actual, futureMetadata: { retained: true } }, expected));
});

test("backup capture awaits the persisted initial visit rather than an async predicate", async (context) => {
  const value = await createDesktopBackupContext(context);
  const before = value.workspaceService.readWorkspace();
  before.ui.recentVisits = [];
  const after = backupWorkspaceAfterInitialVisit(before);
  let reads = 0;
  const page = {
    async evaluate(callback) {
      if (callback.toString().includes("new Date")) return FIXTURE_TIME;
      reads += 1;
      return { ok: true, value: { workspace: structuredClone(reads >= 3 ? after : before) } };
    },
    async waitForFunction() { return { jsonValue: async () => false, dispose: async () => {} }; },
  };
  const actual = await captureBackupWorkspace({ page });
  assertBackupWorkspaceEqual(actual, after);
  assert.equal(reads, 3);
});

test("initial backup startup projects exact reminder classification without dropping UI fields", async (context) => {
  const value = await createDesktopBackupContext(context);
  const original = value.workspaceService.readWorkspace();
  const time = new Date(2026, 9, 1, 16).toISOString();
  const page = original.pages.find((entry) => entry.id === "p-a1");
  page.content = [{ id: "backup-reminder-block", type: "paragraph", content: [
    { type: "dateMention", props: { value: "2026-10-01T15:59", kind: "reminder", reminderId: "backup-missed" } },
    { type: "dateMention", props: { value: "2026-10-01T16:00", kind: "reminder", reminderId: "backup-due" } },
    { type: "dateMention", props: { value: "2026-10-01T16:01", kind: "reminder", reminderId: "backup-future" } },
  ], children: [] }];
  original.ui = { ...original.ui, futureUi: { retained: true }, lastReminderCheckAt: null, reminderLog: [], firedReminderIds: [] };
  const before = structuredClone(original);
  const expected = backupWorkspaceAfterInitialVisit(original, time);
  assert.deepEqual(original, before);
  assertBackupWorkspaceEntitiesEqual(expected, original);
  assert.equal(expected.ui.lastReminderCheckAt, time);
  assert.deepEqual(expected.ui.futureUi, { retained: true });
  const missedAt = new Date(2026, 9, 1, 15, 59).getTime();
  const dueAt = new Date(2026, 9, 1, 16).getTime();
  assert.deepEqual(expected.ui.firedReminderIds, [`backup-missed@${new Date(missedAt).toISOString()}`, `backup-due@${new Date(dueAt).toISOString()}`]);
  assert.deepEqual(expected.ui.reminderLog, [
    { key: `backup-due@${new Date(dueAt).toISOString()}`, fireAt: dueAt, pageId: "p-a1", title: page.title, source: "提及", missed: false, readAt: null },
    { key: `backup-missed@${new Date(missedAt).toISOString()}`, fireAt: missedAt, pageId: "p-a1", title: page.title, source: "提及", missed: true, readAt: null },
  ]);
  assertBackupWorkspaceAfterInitialVisit(expected, original, time);
  for (const field of ["lastReminderCheckAt", "firedReminderIds", "reminderLog", "futureUi"]) {
    const changed = structuredClone(expected);
    delete changed.ui[field];
    assert.throws(() => assertBackupWorkspaceAfterInitialVisit(changed, original, time));
  }
});

test("backup capture waits for reminder startup persistence even when the visit is already saved", async (context) => {
  const value = await createDesktopBackupContext(context);
  const before = value.workspaceService.readWorkspace();
  before.ui = { ...before.ui, recentVisits: [], lastReminderCheckAt: null };
  const visited = { ...before, ui: recordVisit(before.ui, before.ui.selectedPageId, FIXTURE_TIME) };
  const ready = processReminders(visited, { nowMs: Date.parse(FIXTURE_TIME), startedAt: Date.parse(FIXTURE_TIME), initial: true }).workspace;
  let reads = 0;
  const page = { async evaluate(callback) {
    if (callback.toString().includes("new Date")) return FIXTURE_TIME;
    reads += 1;
    return { ok: true, value: { workspace: structuredClone(reads >= 4 ? ready : reads >= 2 ? visited : before) } };
  } };
  const actual = await captureBackupWorkspace({ page });
  assertBackupWorkspaceEqual(actual, ready);
  assert.equal(reads, 4);
});

test("backup capture accepts startup timestamps from the current real-clock launch", async (context) => {
  const value = await createDesktopBackupContext(context);
  const before = value.workspaceService.readWorkspace();
  const startedAt = "2026-11-08T20:20:04.0043250Z";
  const staleTime = "2026-11-08T20:20:04.003Z";
  const reminderTime = "2026-11-08T20:20:05.000Z";
  const visitTime = "2026-11-08T20:20:06.000Z";
  const captureTime = "2026-11-08T20:20:09.052Z";
  before.ui = { ...before.ui, recentVisits: [], lastReminderCheckAt: null, futureUi: { retained: true } };
  const visited = { ...before, ui: recordVisit(before.ui, before.ui.selectedPageId, visitTime) };
  const ready = processReminders(visited, { nowMs: Date.parse(reminderTime), startedAt: Date.parse(startedAt), initial: true }).workspace;
  const snapshots = [
    { ...ready, ui: { ...ready.ui, recentVisits: [{ pageId: before.ui.selectedPageId, visitedAt: staleTime }] } },
    { ...ready, ui: { ...ready.ui, recentVisits: [] } },
    { ...ready, ui: { ...ready.ui, lastReminderCheckAt: staleTime } },
    { ...ready, ui: { ...ready.ui, lastReminderCheckAt: null } },
    ready,
  ];
  let reads = 0;
  const page = { async evaluate(callback) {
    if (callback.toString().includes("new Date")) return captureTime;
    const workspace = snapshots[Math.min(reads, snapshots.length - 1)];
    reads += 1;
    return { ok: true, value: { workspace: structuredClone(workspace) } };
  } };
  const actual = await captureBackupWorkspace({ page, processOwnership: { mainCreatedAt: startedAt } });
  assertBackupWorkspaceEqual(actual, ready);
  assert.equal(reads, snapshots.length);
});

test("backup capture follows a running renderer clock while startup persistence finishes", async (context) => {
  const value = await createDesktopBackupContext(context);
  const before = value.workspaceService.readWorkspace();
  const startedAt = "2026-10-01T08:00:00.000Z";
  const reminderTime = "2026-10-01T08:00:00.250Z";
  const visitTime = "2026-10-01T08:00:02.000Z";
  const visited = { ...before, ui: recordVisit({ ...before.ui, recentVisits: [] }, before.ui.selectedPageId, visitTime) };
  const ready = processReminders(visited, { nowMs: Date.parse(reminderTime), startedAt: Date.parse(startedAt), initial: true }).workspace;
  let reads = 0;
  const page = { async evaluate(callback) {
    if (callback.toString().includes("new Date")) return reads === 1 ? "2026-10-01T08:00:01.000Z" : "2026-10-01T08:00:03.000Z";
    reads += 1;
    return { ok: true, value: { workspace: structuredClone(ready) } };
  } };
  const actual = await captureBackupWorkspace({ page, rendererClock: { mode: "running", time: new Date(startedAt) }, processOwnership: { mainCreatedAt: "2026-11-08T20:20:04.0043250Z" } });
  assertBackupWorkspaceEqual(actual, ready);
  assert.equal(reads, 2);
});

test("backup capture keeps exact startup timestamps for a fixed renderer clock", async (context) => {
  const value = await createDesktopBackupContext(context);
  const before = value.workspaceService.readWorkspace();
  const ready = backupWorkspaceAfterInitialVisit(before);
  const stale = backupWorkspaceAfterInitialVisit(before, "2026-10-01T07:59:59.999Z");
  let reads = 0;
  const page = { async evaluate(callback) {
    if (callback.toString().includes("new Date")) return FIXTURE_TIME;
    reads += 1;
    return { ok: true, value: { workspace: structuredClone(reads === 1 ? stale : ready) } };
  } };
  const actual = await captureBackupWorkspace({ page, rendererClock: { mode: "fixed", time: new Date(FIXTURE_TIME) }, processOwnership: { mainCreatedAt: "2026-11-08T20:20:04.0043250Z" } });
  assertBackupWorkspaceEqual(actual, ready);
  assert.equal(reads, 2);
});
