import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { registerWorkspaceIpc } from "../electron/main/ipc/workspace.js";
import { registerAssetsIpc } from "../electron/main/ipc/assets.js";
import { registerAppIpc } from "../electron/main/ipc/app.js";
import { CURRENT_SCHEMA_VERSION } from "../src/persistence/migrations.js";

function fixture() {
  const handlers = new Map();
  const frame = { routingId: 1, processId: 10, isDestroyed: () => false };
  const contents = { id: 42, mainFrame: frame, isDestroyed: () => false };
  const window = { webContents: contents, isDestroyed: () => false };
  return { ipcMain: { handle: (channel, callback) => handlers.set(channel, callback), removeHandler: (channel) => handlers.delete(channel) }, getWorkspaceWindow: () => window, event: { sender: contents, senderFrame: frame }, contents, handlers };
}

test("workspace IPC checks the exact window and main frame before arguments", async () => {
  const state = fixture();
  let reads = 0;
  registerWorkspaceIpc({ ...state, service: { load: async () => { reads += 1; return { workspace: {}, generation: "gen-test" }; }, applyChanges: async () => ({}), timings: {} } });
  const handler = state.handlers.get("la:workspace:load");
  assert.equal((await handler({ sender: { id: 42 }, senderFrame: state.event.senderFrame }, {})).error.code, "E_FORBIDDEN");
  assert.equal((await handler({ ...state.event, senderFrame: { routingId: 2, processId: 10 } })).error.code, "E_FORBIDDEN");
  assert.equal((await handler(state.event, {})).error.code, "E_INVALID_ARGUMENT");
  assert.equal(reads, 0);
  assert.equal((await handler(state.event)).ok, true);
  assert.equal(reads, 1);
});

test("invalid changesets never reach storage and failed saves never update the test baseline", async () => {
  const state = fixture();
  const hooks = {};
  let writes = 0;
  registerWorkspaceIpc({ ...state, testHooks: hooks, service: { load: async () => ({}), timings: {}, applyChanges: async () => { writes += 1; throw Object.assign(new Error("disk full"), { code: "E_IO" }); } } });
  const handler = state.handlers.get("la:workspace:apply-changes");
  const batch = { generation: "gen-test", schemaVersion: CURRENT_SCHEMA_VERSION, upserts: [{ collection: "vaultItems", id: "item", json: '{"id":"item"}' }], deletes: [], ui: null };
  assert.equal((await handler(state.event, batch)).error.code, "E_INVALID_ARGUMENT");
  assert.equal(writes, 0);
  assert.equal((await handler(state.event, { ...batch, upserts: [] })).error.code, "E_IO");
  assert.equal(writes, 1);
  assert.equal(hooks.lastChangeset, undefined);
});

test("asset IPC accepts only ArrayBuffer and strips internal creation metadata", async () => {
  const state = fixture();
  registerAssetsIpc({ ...state, assetStore: { put: async () => ({ assetId: "a".repeat(64), url: `life-asset://${"a".repeat(64)}`, created: true }) } });
  const handler = state.handlers.get("la:assets:put");
  assert.equal((await handler(state.event, { bytes: new Uint8Array(1), mime: "text/plain", name: "x" })).error.code, "E_INVALID_ARGUMENT");
  const result = await handler(state.event, { bytes: new ArrayBuffer(1), mime: "text/plain", name: "x" });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.value).sort(), ["assetId", "url"]);
});

test("importing an ordinary attachment never marks it as an installed Market package", async () => {
  const state = fixture();
  const received = [];
  registerAssetsIpc({ ...state, assetStore: { put: async ({ mime }) => { received.push(mime); return { assetId: "a".repeat(64) }; } } });
  const put = state.handlers.get("la:assets:put");
  for (const mime of ["application/vnd.life-atlas.component+zip", "Application/Vnd.Life-Atlas.Template+Zip;installed=0", "audio/wav"]) {
    assert.equal((await put(state.event, { bytes: new ArrayBuffer(1), mime, name: "attachment" })).ok, true);
  }
  assert.deepEqual(received, ["application/octet-stream", "application/octet-stream", "audio/wav"]);
});

test("workspace can read only existence and lock state from the vault", async () => {
  const state = fixture();
  registerAppIpc({ ...state, getInfo: () => ({}), nativeTheme: {}, flushController: { acknowledge: () => {} }, dialogs: { openPath: async () => "" }, getDataRoot: () => "D:/test", getVaultStatus: () => ({ exists: true, locked: false, summaries: ["must-not-leak"], password: "must-not-leak" }) });
  const result = await state.handlers.get("la:app:get-vault-status")(state.event);
  assert.deepEqual(result, { ok: true, value: { exists: true, locked: false } });
  assert.ok([...state.handlers.keys()].every((channel) => !channel.startsWith("la:vault:")));
});

test("preloads expose exact named surfaces without a generic IPC or vault bridge", async () => {
  const evaluate = (file) => {
    const exposed = {};
    const listeners = new Map();
    const calls = [];
    const electron = { contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } }, ipcRenderer: { invoke: async (channel, args) => { calls.push({ channel, args }); return { ok: true, value: {} }; }, on: (channel, listener) => listeners.set(channel, listener), removeListener: (channel) => listeners.delete(channel) } };
    vm.runInNewContext(fs.readFileSync(new URL(file, import.meta.url), "utf8"), { require: (name) => { assert.equal(name, "electron"); return electron; } });
    return { exposed, calls, listeners };
  };
  const workspace = evaluate("../electron/preload/workspace.cjs");
  assert.deepEqual(Object.keys(workspace.exposed), ["lifeAtlas"]);
  const api = workspace.exposed.lifeAtlas;
  assert.equal(api.platform, "desktop");
  assert.equal(api.vault, undefined);
  assert.equal(api.invoke, undefined);
  assert.equal(api.ipcRenderer, undefined);
  await api.app.getInfo();
  assert.equal(workspace.calls[0].channel, "la:app:get-info");
  let received;
  const unsubscribe = api.app.onVaultStatusChanged((value) => { received = value; });
  workspace.listeners.get("la:app:vault-status-changed")({ privateEvent: true }, { exists: true, locked: true });
  assert.deepEqual(received, { exists: true, locked: true });
  unsubscribe();
  assert.equal(workspace.listeners.size, 0);
  const setup = evaluate("../electron/preload/setup.cjs");
  assert.deepEqual(Object.keys(setup.exposed), ["lifeAtlasSetup"]);
  assert.equal(setup.exposed.lifeAtlasSetup.workspace, undefined);
});
