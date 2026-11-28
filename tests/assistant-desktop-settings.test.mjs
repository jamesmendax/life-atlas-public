import assert from "node:assert/strict";
import test from "node:test";
import { desktopToolNames, executeDesktopTool } from "../src/assistant/desktopTools.js";
import { workspaceToolParameters } from "../src/assistant/toolCatalog.js";

const ok = (value) => ({ ok: true, value });
const cleanSchedule = { enabled: false, folder: null, weekday: 0, hour: 20, keepLast: 8, includeVault: false, encrypt: false };
function harness(initial = {}) {
  const calls = [];
  let schedule = { ...cleanSchedule, ...initial };
  const api = {
    app: {
      async openVaultWindow(args) { calls.push(["vault", args]); return ok({}); },
      async requestVaultPreferences(args) { calls.push(["vault-preferences", args]); return ok({ changed: true }); },
      async changeDataRoot() { calls.push(["move"]); return ok({ changed: false }); },
    },
    backup: {
      async getSchedule() { return ok({ schedule }); },
      async chooseScheduleFolder() { calls.push(["folder"]); return ok({ folder: "X:/user-selected" }); },
      async updateWorkspaceSchedule(input) { calls.push(["save", input]); schedule = { ...schedule, ...input }; return ok({ schedule }); },
      async createSnapshot() { assert.fail("manual snapshot includes vault"); },
      async createWorkspaceSnapshot() { calls.push(["snapshot"]); return ok({ snapshot: { path: "internal/test-fixture" } }); },
    },
  };
  const run = (name, args, options = {}) => executeDesktopTool(name, args, { api,
    openPane: (...args) => calls.push(["pane", ...args]), flushWorkspace: async () => { calls.push(["flush"]); return ok({}); }, ...options });
  return { calls, api, run };
}

test("assistant edits the native weekly schedule without leaking local paths or overriding unrelated protection", async () => {
  const h = harness();
  const result = await h.run("update_backup_schedule", { enabled: true, weekday: 5, hour: 18, keep_last: 4 });
  assert.equal(result.ok, true);
  assert.deepEqual(h.calls.map(([op]) => op), ["folder", "save"]);
  assert.equal(h.calls[1][1].folder, "X:/user-selected");
  assert.deepEqual(h.calls[1][1], { enabled: true, weekday: 5, hour: 18, keepLast: 4, folder: "X:/user-selected" });
  assert.deepEqual(result.schedule, { enabled: true, weekday: 5, hour: 18, keep_last: 4, has_folder: true, encrypted: false });
  const inspected = await h.run("read_backup_settings", {});
  assert.deepEqual(inspected.schedule, result.schedule);
  assert.equal(JSON.stringify(inspected).includes("user-selected"), false);
  const encrypted = harness({ encrypt: true, folder: "X:/private", enabled: true });
  const updated = await encrypted.run("update_backup_schedule", { hour: 11 });
  assert.equal(updated.ok && updated.schedule.encrypted, true);
  assert.deepEqual(encrypted.calls, [["save", { hour: 11 }]]);
  const protectedSchedule = harness({ encrypt: true, folder: "X:/private", includeVault: true, enabled: true });
  assert.equal((await protectedSchedule.run("update_backup_schedule", { hour: 11 })).ok, false);
  const visible = await protectedSchedule.run("read_backup_settings", {});
  assert.equal(visible.ok, true);
  assert.equal(JSON.stringify(visible).includes("vault"), false);
  assert.deepEqual(protectedSchedule.calls, []);
});

test("invalid and cancelled native tool requests leave settings alone", async () => {
  const h = harness();
  for (const [tool, args] of [
    ["update_backup_schedule", { hour: 25 }],
    ["update_backup_schedule", { password: "fixture" }],
    ["update_backup_schedule", { include_vault: true }],
    ["create_workspace_snapshot", { include_vault: true }],
    ["open_settings", { section: "vault" }],
    ["choose_data_location", {}],
    ["update_vault_preferences", { auto_lock_minutes: 15 }],
  ]) assert.equal((await h.run(tool, args)).ok, false);
  assert.deepEqual(h.calls, []);
  h.api.backup.chooseScheduleFolder = async () => ok({ cancelled: true });
  assert.equal((await h.run("update_backup_schedule", { enabled: true })).ok, false);
  assert.deepEqual(h.calls, []);
});

test("ordinary desktop tools expose no vault actions and use the workspace-only snapshot", async () => {
  const h = harness();
  assert.equal(desktopToolNames.has("update_vault_preferences"), false);
  assert.equal(workspaceToolParameters("open_settings").properties.section.enum.includes("vault"), false);
  assert.equal((await h.run("open_settings", { section: "shortcuts" })).ok, true);
  assert.equal((await h.run("open_settings", { section: "backup" })).ok, true);
  assert.equal((await h.run("create_workspace_snapshot", {}, { signal: AbortSignal.abort() })).ok, false);
  const created = await h.run("create_workspace_snapshot", {});
  assert.equal(created.ok, true);
  assert.equal(JSON.stringify(created).includes("test-fixture"), false);
  assert.deepEqual(h.calls, [["pane", "shortcuts"], ["pane", "backup"], ["flush"], ["snapshot"]]);
});
