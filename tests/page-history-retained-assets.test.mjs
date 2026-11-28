import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fullWorkspace, FIXTURE_TIME } from "./fixtures/full-workspace.mjs";
import { createPageVersion } from "../src/domain/pageHistory.js";
import { permanentlyDelete } from "../src/domain/trash.js";
import { normalizeLoadedWorkspace } from "../src/persistence/normalize.js";
import { createWorkspaceService } from "../electron/main/storage/workspaceService.js";

const DAY = 86400000;

function sameDayVersions(page) {
  const historicalDay = new Date(Date.parse(FIXTURE_TIME) - 10 * DAY);
  const noon = historicalDay.setHours(12, 0, 0, 0);
  return [
    createPageVersion({ ...page, title: "Earlier draft" }, { id: "pv-same-day-earlier", reason: "interval", now: noon - 1000 }),
    createPageVersion({ ...page, title: "Later draft" }, { id: "pv-same-day-later", reason: "idle", now: noon }),
  ];
}

test("permanent deletion retains media and synced sources still referenced by page history", () => {
  const workspace = fullWorkspace();
  const original = workspace.pages.find((page) => page.id === "p-b1");
  workspace.pageVersions = [createPageVersion({ ...original, id: "p-a1" }, { id: "ver-with-assets", reason: "idle", now: FIXTURE_TIME })];
  const next = permanentlyDelete(workspace, { pageIds: ["p-b1"] });
  assert.ok(next.attachments.some((attachment) => attachment.id === "att-img"));
  assert.ok(next.pageVersions.some((version) => version.id === "ver-with-assets"));
  assert.ok(next.syncedSources.some((source) => source.id === "sync-shared"));
});

test("loading preserves distinct historical snapshots and orphan records without mutating input", () => {
  const workspace = fullWorkspace();
  const time = Date.parse(FIXTURE_TIME);
  const page = workspace.pages.find((entry) => entry.id === "p-a1-child");
  workspace.pageVersions = [
    ...Array.from({ length: 60 }, (_, index) => createPageVersion(page, { id: `ver-${index}`, reason: "interval", now: time - index * 60000 })),
    ...sameDayVersions(page),
  ];
  workspace.pageVersions.push(createPageVersion({ ...page, id: "missing" }, { id: "orphan", reason: "idle", now: time }));
  workspace.pageVersions.push({ ...workspace.pageVersions[0], id: "unknown-date", createdAt: "unknown" });
  const before = structuredClone(workspace);
  const next = normalizeLoadedWorkspace(workspace, { now: time, idFactory: (prefix) => `${prefix}-retention-test` });
  assert.deepEqual(next.pageVersions, before.pageVersions);
  assert.deepEqual(workspace, before);
});

test("an app upgrade and later SQLite loads preserve historical rows verbatim", async (context) => {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const dataRoot = fs.mkdtempSync(path.join(tempRoot, "life-atlas-history-upgrade-"));
  context.after(() => {
    assert.equal(path.dirname(fs.realpathSync(dataRoot)), tempRoot);
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  const now = FIXTURE_TIME;
  const workspace = normalizeLoadedWorkspace(fullWorkspace(), { now, idFactory: () => "ws-history-upgrade" });
  const page = workspace.pages.find((entry) => entry.id === "p-a1-child");
  workspace.pageVersions = sameDayVersions(page);
  const [legacyVersion] = workspace.pageVersions;
  delete legacyVersion.pageType;
  delete legacyVersion.databaseSourceId;
  delete legacyVersion.databaseViewId;

  const readRows = (service) => service.db.prepare("SELECT id, json FROM entities WHERE collection='pageVersions' ORDER BY id").all();
  const previous = createWorkspaceService({ dataRoot, now, appVersion: "1.0.1" });
  let beforeRows;
  try {
    await previous.load();
    previous.replaceWorkspace(workspace);
    beforeRows = readRows(previous);
  } finally { previous.close(); }

  let upgrades = 0;
  const beforeUpgrade = ({ previousAppVersion, workspace: saved }) => {
    upgrades += 1;
    assert.equal(previousAppVersion, "1.0.1");
    assert.deepEqual(saved.pageVersions, workspace.pageVersions);
  };
  const upgraded = createWorkspaceService({ dataRoot, now, appVersion: "1.0.3", beforeUpgrade });
  try {
    assert.deepEqual((await upgraded.load()).workspace.pageVersions, workspace.pageVersions);
    assert.deepEqual(readRows(upgraded), beforeRows);
    assert.equal(upgraded.getMeta("lastAppVersion"), "1.0.3");
  } finally { upgraded.close(); }

  const later = new Date(Date.parse(now) + 40 * DAY).toISOString();
  const reopened = createWorkspaceService({ dataRoot, now: later, appVersion: "1.0.3", beforeUpgrade });
  try {
    assert.deepEqual((await reopened.load()).workspace.pageVersions, workspace.pageVersions);
    assert.deepEqual(readRows(reopened), beforeRows);
    assert.equal(upgrades, 1);
  } finally { reopened.close(); }
});
