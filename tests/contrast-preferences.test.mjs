import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createContrastPreferences, registerContrastReadIpc } from "../electron/main/contrastPreferences.js";

test("contrast remembers only its enum and broadcasts independently of theme or vault data", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contrast-160-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "contrast.json"), changes = [];
  const preferences = createContrastPreferences(file, (value) => changes.push(value));
  assert.deepEqual(preferences.get(), { preference: "system" });
  preferences.set("high");
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { preference: "high" });
  assert.deepEqual(createContrastPreferences(file).get(), { preference: "high" });
  assert.deepEqual(changes, [{ preference: "high" }]);
  assert.throws(() => preferences.set({ vault: "data" }), /无效/);
  assert.equal(fs.existsSync(file + ".pending"), false);
});

test("isolated windows can read the contrast enum without opening a vault or workspace data channel", () => {
  const handlers = new Map(), frame = { routingId: 1, processId: 2 };
  const contents = { id: 3, mainFrame: frame, isDestroyed: () => false };
  const window = { webContents: contents, isDestroyed: () => false };
  registerContrastReadIpc({ ipcMain: { handle: (name, callback) => handlers.set(name, callback) }, getWindows: () => [window], preferences: { get: () => ({ preference: "high" }) } });
  const read = handlers.get("la:appearance:get-contrast");
  assert.deepEqual(read({ sender: contents, senderFrame: frame }), { ok: true, value: { preference: "high" } });
  assert.equal(read({ sender: { id: 4 }, senderFrame: frame }).error.code, "E_FORBIDDEN");
  assert.equal(read({ sender: contents, senderFrame: { ...frame, routingId: 9 } }).error.code, "E_FORBIDDEN");
  assert.equal(read({ sender: contents, senderFrame: frame }, { path: "private" }).error.code, "E_INVALID_ARGUMENT");
  assert.deepEqual([...handlers.keys()], ["la:appearance:get-contrast"]);
});
