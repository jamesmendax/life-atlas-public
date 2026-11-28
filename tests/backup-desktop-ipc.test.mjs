import test from "node:test";
import assert from "node:assert/strict";
import { registerBackupIpc } from "../electron/main/ipc/backup.js";
import { registerSetupIpc } from "../electron/main/ipc/setup.js";

function ipcFixture() {
  const handlers = new Map();
  const sent = [];
  const frame = { routingId: 4, processId: 6 };
  const window = { webContents: { id: 9, mainFrame: frame, send: (channel, value) => sent.push({ channel, value }) } };
  const event = { sender: window.webContents, senderFrame: frame };
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler), removeHandler: (channel) => handlers.delete(channel) };
  return { handlers, sent, window, event, ipcMain };
}

test("backup IPC validates the owning main frame before all arguments", async () => {
  const value = ipcFixture();
  let progress;
  let calls = 0;
  const service = Object.fromEntries(["getStatus", "exportFull", "exportRescue", "cancel", "inspect", "inspectScheduled", "inspectWithPassword", "restore", "verify", "verifyWithPassword", "listSnapshots", "createSnapshot", "createWorkspaceSnapshot", "restoreSnapshot", "getSchedule", "chooseScheduleFolder", "setSchedule", "runScheduleNow", "updateWorkspaceSchedule"].map((name) => [name, async () => { calls += 1; return { method: name }; }]));
  service.onProgress = (callback) => { progress = callback; return () => { progress = undefined; }; };
  const dispose = registerBackupIpc({ ipcMain: value.ipcMain, service, getWorkspaceWindow: () => value.window });
  assert.equal(value.handlers.size, 19);
  for (const handler of value.handlers.values()) {
    assert.equal((await handler({ ...value.event, sender: { id: 9 } }, null)).error.code, "E_FORBIDDEN");
    assert.equal((await handler({ ...value.event, senderFrame: { routingId: 44, processId: 6 } }, null)).error.code, "E_FORBIDDEN");
    assert.equal((await handler(value.event, null)).error.code, "E_INVALID_ARGUMENT");
  }
  assert.equal(calls, 0);
  assert.equal((await value.handlers.get("la:backup:export-full")(value.event, { includeVault: false, encryptPassword: null })).ok, true);
  const exportRescue = value.handlers.get("la:backup:export-rescue");
  assert.deepEqual((await exportRescue(value.event, { workspace: { workspaceId: "workspace-session" } })).value, { method: "exportRescue" });
  assert.equal((await exportRescue(value.event, { workspace: {}, targetPath: "renderer-chosen-path" })).error.code, "E_INVALID_ARGUMENT");
  assert.equal((await value.handlers.get("la:backup:restore")(value.event, { token: "restore_token", restoreVault: false })).ok, true);
  assert.equal((await value.handlers.get("la:backup:restore-snapshot")(value.event, { id: "snapshot", restoreWorkspace: false, restoreVault: false })).error.code, "E_INVALID_ARGUMENT");
  const setSchedule = value.handlers.get("la:backup:set-schedule");
  const schedule = { enabled: true, folder: "folder", weekday: 0, hour: 20, keepLast: 8, includeVault: false, encryptPassword: null };
  assert.equal((await setSchedule(value.event, { ...schedule, weekday: 7 })).error.code, "E_INVALID_ARGUMENT");
  assert.equal((await setSchedule(value.event, { ...schedule, destination: "__proto__" })).error.code, "E_INVALID_ARGUMENT");
  assert.equal((await setSchedule(value.event, { ...schedule, destination: "google-drive" })).ok, true);
  for (const [action, method] of [["inspect-scheduled", "inspectScheduled"], ["run-schedule-now", "runScheduleNow"]]) {
    const handler = value.handlers.get(`la:backup:${action}`);
    assert.deepEqual((await handler(value.event)).value, { method });
    assert.equal((await handler(value.event, { folder: "untrusted-folder" })).error.code, "E_INVALID_ARGUMENT");
  }
  const workspaceSnapshot = value.handlers.get("la:backup:create-workspace-snapshot");
  assert.deepEqual((await workspaceSnapshot(value.event)).value, { method: "createWorkspaceSnapshot" });
  assert.equal((await workspaceSnapshot(value.event, { includeVault: true })).error.code, "E_INVALID_ARGUMENT");
  const workspaceSchedule = value.handlers.get("la:backup:update-workspace-schedule");
  assert.deepEqual((await workspaceSchedule(value.event, { hour: 9 })).value, { method: "updateWorkspaceSchedule" });
  for (const patch of [{ includeVault: true, hour: 9 }, { encryptPassword: null }, { folder: 1 }, { keepLast: -1 }, {}]) {
    assert.equal((await workspaceSchedule(value.event, patch)).error.code, "E_INVALID_ARGUMENT");
  }
  const result = { jobId: "backup-1", kind: "export", phase: "write", done: 1, total: 20 };
  progress(result);
  assert.deepEqual(value.sent, [{ channel: "la:backup:progress", value: result }]);
  dispose();
  assert.equal(value.handlers.size, 0);
  assert.equal(progress, undefined);
});

test("setup IPC exposes only the six specified setup operations", async () => {
  const value = ipcFixture();
  let calls = 0;
  const service = Object.fromEntries(["getDefaults", "chooseFolder", "validateFolder", "inspectBackup", "inspectBackupWithPassword", "finish"].map((name) => [name, async () => { calls += 1; return { method: name }; }]));
  const dispose = registerSetupIpc({ ipcMain: value.ipcMain, service, getSetupWindow: () => value.window });
  assert.equal(value.handlers.size, 6);
  for (const handler of value.handlers.values()) {
    assert.equal((await handler({ ...value.event, sender: { id: 9 } }, null)).error.code, "E_FORBIDDEN");
    assert.equal((await handler({ ...value.event, senderFrame: { routingId: 5, processId: 6 } }, null)).error.code, "E_FORBIDDEN");
    assert.equal((await handler(value.event, null)).error.code, "E_INVALID_ARGUMENT");
  }
  assert.equal(calls, 0);
  assert.equal((await value.handlers.get("la:setup:finish")(value.event, { dataRoot: "chosen", start: "restore" })).error.code, "E_INVALID_ARGUMENT");
  assert.equal((await value.handlers.get("la:setup:finish")(value.event, { dataRoot: "chosen", start: "restore", token: "restore_token" })).ok, true);
  assert.equal((await value.handlers.get("la:setup:get-defaults")(value.event)).ok, true);
  dispose();
  assert.equal(value.handlers.size, 0);
});
