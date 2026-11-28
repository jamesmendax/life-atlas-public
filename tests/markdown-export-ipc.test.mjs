import test from "node:test";
import assert from "node:assert/strict";
import { registerExportsIpc } from "../electron/main/ipc/exports.js";

function fixture() {
  const handlers = new Map();
  const frame = { routingId: 1, processId: 10, isDestroyed: () => false };
  const contents = { id: 42, mainFrame: frame, isDestroyed: () => false };
  const window = { webContents: contents, isDestroyed: () => false };
  const calls = [];
  const dispose = registerExportsIpc({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), removeHandler: (channel) => handlers.delete(channel) }, getWorkspaceWindow: () => window, assetStore: {}, dialogs: { showOpenDialog: async (...args) => { calls.push(args); return { canceled: true, filePaths: [] }; } } });
  return { event: { sender: contents, senderFrame: frame }, frame, contents, window, calls, handlers, dispose, invoke: (...args) => handlers.get("la:exports:write-markdown-folder")(...args) };
}

test("Markdown export IPC rejects other windows and subframes before opening dialogs", async () => {
  const state = fixture();
  for (const event of [{ sender: { id: 42 }, senderFrame: state.frame }, { sender: state.contents, senderFrame: { ...state.frame, routingId: 2 } }]) {
    assert.equal((await state.invoke(event, { files: [], assets: [] })).error.code, "E_FORBIDDEN");
  }
  assert.deepEqual(state.calls, []);
});

test("Markdown export validates every path before asking for a destination", async () => {
  const state = fixture();
  for (const payload of [null, [], { files: [{ path: "safe.md", text: "Safe" }, { path: "../outside.md", text: "No" }], assets: [] }, { files: [], assets: [{ path: "assets/file", sha256: "http://example.com" }] }]) {
    assert.equal((await state.invoke(state.event, payload)).error.code, "E_INVALID_ARGUMENT");
  }
  assert.deepEqual(state.calls, []);
});

test("Markdown export cancellation is explicit and does not create output", async () => {
  const state = fixture();
  const result = await state.invoke(state.event, { files: [{ path: "页面.md", text: "# 页面" }], assets: [] });
  assert.equal(result.error.code, "E_CANCELLED");
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0][0], state.window);
  assert.deepEqual(state.calls[0][1].properties, ["openDirectory", "createDirectory"]);
  state.dispose();
  assert.equal(state.handlers.size, 0);
});
