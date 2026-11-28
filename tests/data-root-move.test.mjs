import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { copyDataRoot, verifyCopy, createDataRootMoveService } from "../electron/main/dataRootMove.js";
import { createDialogs } from "../electron/main/dialogs.js";
import { validateFolder } from "../electron/main/setup.js";
import { sha256File } from "../electron/main/backup/files.js";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";
import { registerAppIpc } from "../electron/main/ipc/app.js";

function fixture(context) {
  const root = createIsolatedDirectory("data-root-move-test");
  context.after(() => removeIsolatedDirectory(root));
  const from = path.join(root, "old");
  const to = path.join(root, "new");
  fs.mkdirSync(path.join(from, "assets", "ab"), { recursive: true });
  fs.mkdirSync(path.join(from, "snapshots", "one"), { recursive: true });
  fs.mkdirSync(path.join(from, "empty"));
  fs.mkdirSync(path.join(from, "runtime"));
  fs.writeFileSync(path.join(from, "workspace.db"), "test database bytes");
  fs.writeFileSync(path.join(from, "assets", "ab", "asset"), "test asset bytes");
  fs.writeFileSync(path.join(from, "snapshots", "one", "workspace.db"), "test snapshot bytes");
  fs.writeFileSync(path.join(from, "runtime", "profile"), "runtime bytes");
  fs.writeFileSync(path.join(from, ".lock"), "lock bytes");
  return { root, from, to };
}

function moveFixture(context, overrides = {}) {
  const state = fixture(context);
  const bootstrapFile = path.join(state.root, "bootstrap.json");
  const originalBootstrap = Buffer.from(`${JSON.stringify({ dataRoot: state.from }, null, 2)}\n`);
  fs.writeFileSync(bootstrapFile, originalBootstrap);
  const dialogState = { queue: { showOpenDialog: [[state.to]], showMessageBox: [0], showSaveDialog: [] }, calls: [] };
  const dialogs = createDialogs({ testHooksEnabled: true, state: dialogState });
  const sequence = [];
  const service = createDataRootMoveService({
    dataRoot: state.from, bootstrapFile, dialogs, now: "2026-11-01T09:30:05.000Z", testHooksEnabled: true,
    validateFolder: (input) => validateFolder(input),
    requestFlush: async () => { sequence.push("flush"); return true; },
    lockVault: () => sequence.push("lock"),
    stopTimers: async () => sequence.push("stop"),
    closeDatabases: async () => sequence.push("close"),
    reopenDatabases: async () => sequence.push("reopen"),
    restartTimers: () => sequence.push("restart"),
    relaunch: () => sequence.push("relaunch"),
    exit: (code) => sequence.push(`exit:${code}`),
    ...overrides,
  });
  return { ...state, bootstrapFile, originalBootstrap, dialogState, sequence, service };
}

test("copying skips runtime and the lock file", async (context) => {
  const state = fixture(context);
  const receipt = await copyDataRoot(state.from, state.to);
  assert.equal(receipt.files.length, 3);
  assert.equal(fs.existsSync(path.join(state.to, "runtime")), false);
  assert.equal(fs.existsSync(path.join(state.to, ".lock")), false);
  assert.equal(fs.statSync(path.join(state.to, "empty")).isDirectory(), true);
  assert.equal(fs.readFileSync(path.join(state.from, "runtime", "profile"), "utf8"), "runtime bytes");
  assert.equal(fs.readFileSync(path.join(state.from, ".lock"), "utf8"), "lock bytes");
  assert.deepEqual(await verifyCopy(state.from, state.to), { fileCount: 3 });
});

test("verification detects a changed byte", async (context) => {
  const state = fixture(context);
  await copyDataRoot(state.from, state.to);
  const target = path.join(state.to, "assets", "ab", "asset");
  const content = fs.readFileSync(target);
  content[0] ^= 1;
  fs.writeFileSync(target, content);
  await assert.rejects(() => verifyCopy(state.from, state.to), { code: "E_IO" });
  assert.equal(fs.readFileSync(path.join(state.from, "assets", "ab", "asset"), "utf8"), "test asset bytes");
});

test("a failed copy leaves the target empty", async (context) => {
  const state = fixture(context);
  fs.mkdirSync(state.to);
  let copied = false;
  await assert.rejects(() => copyDataRoot(state.from, state.to, { injectFailure(name) { assert.equal(name, "data-root-copy"); copied = fs.readdirSync(state.to).length > 0; throw new Error("injected copy failure"); } }), { code: "E_IO" });
  assert.equal(copied, true);
  assert.deepEqual(fs.readdirSync(state.to), []);
  assert.equal(fs.existsSync(path.join(state.from, "workspace.db")), true);
});

test("copying rejects nested roots nonempty targets and symbolic links", async (context) => {
  const state = fixture(context);
  await assert.rejects(() => copyDataRoot(state.from, path.join(state.from, "nested")), { code: "E_INVALID_ARGUMENT" });
  await assert.rejects(() => copyDataRoot(state.from, state.root), { code: "E_INVALID_ARGUMENT" });
  fs.mkdirSync(state.to);
  fs.writeFileSync(path.join(state.to, "existing"), "preserve me");
  await assert.rejects(() => copyDataRoot(state.from, state.to), { code: "E_INVALID_ARGUMENT" });
  assert.equal(fs.readFileSync(path.join(state.to, "existing"), "utf8"), "preserve me");
  const link = path.join(state.from, "linked");
  fs.symlinkSync(path.join(state.from, "assets"), link, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(() => copyDataRoot(state.from, path.join(state.root, "another")), { code: "E_INVALID_ARGUMENT" });
  fs.unlinkSync(link);
});

test("folder validation is shared with setup and rejects existing roots", async (context) => {
  const state = fixture(context);
  assert.deepEqual(validateFolder({ path: state.to }).level, "ok");
  assert.equal(validateFolder({ path: state.from }).kind, "not-empty");
  fs.writeFileSync(path.join(state.from, "life-atlas.root.json"), "{}");
  assert.equal(validateFolder({ path: state.from }).kind, "existing-data-root");
  assert.equal(validateFolder({ path: "relative" }).level, "error");
});

test("successful root changes preserve every old hash and log only in new runtime", async (context) => {
  const state = moveFixture(context);
  const before = await sha256File(path.join(state.from, "workspace.db"));
  assert.deepEqual(await state.service.changeDataRoot(), { changed: true });
  assert.deepEqual(state.sequence, ["flush", "lock", "stop", "close", "exit:0"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(state.bootstrapFile, "utf8")), { dataRoot: state.to });
  assert.deepEqual(await verifyCopy(state.from, state.to), { fileCount: 3 });
  assert.deepEqual(await sha256File(path.join(state.from, "workspace.db")), before);
  assert.equal(fs.existsSync(path.join(state.from, "logs")), false);
  const logs = fs.readdirSync(path.join(state.to, "runtime", "migration-logs"));
  assert.deepEqual(logs, ["2026-11-01.log"]);
  const record = JSON.parse(fs.readFileSync(path.join(state.to, "runtime", "migration-logs", logs[0]), "utf8"));
  assert.deepEqual(record, { at: "2026-11-01T09:30:05.000Z", event: "data-root.moved", from: state.from, to: state.to });
  assert.equal(fs.existsSync(`${state.bootstrapFile}.tmp`), false);
});

test("failed root copies restore databases timers and exact bootstrap bytes", async (context) => {
  const state = moveFixture(context, { injectFailure: () => { throw new Error("copy failed"); } });
  assert.deepEqual(await state.service.changeDataRoot(), { changed: false });
  assert.deepEqual(state.sequence, ["flush", "lock", "stop", "close", "reopen", "restart"]);
  assert.deepEqual(fs.readFileSync(state.bootstrapFile), state.originalBootstrap);
  assert.deepEqual(fs.readdirSync(state.to), []);
  assert.ok(state.dialogState.calls.some((call) => call.kind === "showMessageBox" && call.options.message.startsWith("更换数据目录失败")));
});

test("failed bootstrap writes leave the copy empty and the old root usable", async (context) => {
  const state = moveFixture(context, { writeBootstrap: () => { throw new Error("bootstrap failed"); } });
  assert.deepEqual(await state.service.changeDataRoot(), { changed: false });
  assert.deepEqual(state.sequence, ["flush", "lock", "stop", "close", "reopen", "restart"]);
  assert.deepEqual(fs.readFileSync(state.bootstrapFile), state.originalBootstrap);
  assert.deepEqual(fs.readdirSync(state.to), []);
  assert.equal(fs.readFileSync(path.join(state.from, "workspace.db"), "utf8"), "test database bytes");
});

test("failed migration logging rolls the committed bootstrap back", async (context) => {
  const state = moveFixture(context, { writeMigrationLog: () => { throw new Error("migration audit failed"); } });
  assert.deepEqual(await state.service.changeDataRoot(), { changed: false });
  assert.deepEqual(fs.readFileSync(state.bootstrapFile), state.originalBootstrap);
  assert.deepEqual(fs.readdirSync(state.to), []);
  assert.equal(state.sequence.includes("exit:0"), false);
  assert.deepEqual(state.sequence.slice(-2), ["reopen", "restart"]);
});

test("cancelled selection and failed flush never stop the active storage", async (context) => {
  const cancelled = moveFixture(context);
  cancelled.dialogState.queue.showOpenDialog = [];
  assert.deepEqual(await cancelled.service.changeDataRoot(), { changed: false });
  assert.deepEqual(cancelled.sequence, []);
  const blocked = moveFixture(context, { requestFlush: async () => false });
  assert.deepEqual(await blocked.service.changeDataRoot(), { changed: false });
  assert.deepEqual(blocked.sequence, []);
  assert.deepEqual(fs.readFileSync(blocked.bootstrapFile), blocked.originalBootstrap);
  assert.equal(fs.existsSync(blocked.to), false);
});

test("production root changes relaunch while immutable test mode only exits", async (context) => {
  const state = moveFixture(context, { testHooksEnabled: false });
  assert.deepEqual(await state.service.changeDataRoot(), { changed: true });
  assert.deepEqual(state.sequence.slice(-2), ["relaunch", "exit:0"]);
});

test("change root IPC only accepts its workspace main frame and no arguments", async () => {
  const handlers = new Map();
  const frame = { routingId: 1, processId: 10, isDestroyed: () => false };
  const contents = { id: 42, mainFrame: frame, isDestroyed: () => false };
  const window = { webContents: contents, isDestroyed: () => false };
  let changes = 0;
  registerAppIpc({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, getWorkspaceWindow: () => window, changeDataRoot: () => { changes += 1; return { changed: false }; } });
  const handler = handlers.get("la:app:change-data-root");
  const event = { sender: contents, senderFrame: frame };
  assert.equal((await handler({ sender: { id: 42 }, senderFrame: frame }, {})).error.code, "E_FORBIDDEN");
  assert.equal((await handler(event, {})).error.code, "E_INVALID_ARGUMENT");
  assert.deepEqual(await handler(event), { ok: true, value: { changed: false } });
  assert.equal(changes, 1);
});

test("root changes await vault cleanup before stopping storage and copying files", async (context) => {
  const cleanup = Promise.withResolvers();
  const state = moveFixture(context, { lockVault: () => { state.sequence.push("lock"); return cleanup.promise; } });
  context.after(() => cleanup.resolve());
  const changing = state.service.changeDataRoot();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(state.sequence, ["flush", "lock"]);
  assert.equal(fs.existsSync(state.to), false);
  assert.deepEqual(fs.readFileSync(state.bootstrapFile), state.originalBootstrap);
  cleanup.resolve();
  assert.deepEqual(await changing, { changed: true });
  assert.deepEqual(state.sequence, ["flush", "lock", "stop", "close", "exit:0"]);
});
