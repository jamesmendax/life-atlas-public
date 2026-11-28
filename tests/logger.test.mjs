import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "../electron/main/logger.js";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";

function fixture(context) {
  const directory = createIsolatedDirectory("logger-test");
  context.after(() => removeIsolatedDirectory(directory));
  const logger = createLogger({ logsDir: directory, now: "2026-11-01T09:30:05.000Z" });
  return { logger, records: () => fs.readFileSync(path.join(directory, "2026-11-01.log"), "utf8").trim().split("\n").map((line) => JSON.parse(line)) };
}

test("data root move audit permits exactly two bounded paths", (context) => {
  const state = fixture(context);
  state.logger.log("data-root.moved", { from: "D:/old-root", to: "D:/new-root", content: "never log", password: "never log", count: 2, errorCode: "E_IO" });
  assert.deepEqual(state.records(), [{ at: "2026-11-01T09:30:05.000Z", event: "data-root.moved", from: "D:/old-root", to: "D:/new-root" }]);
});

test("other log events reject path from and to fields", (context) => {
  const state = fixture(context);
  state.logger.log("backup.export", { path: "D:/private", from: "D:/private", to: "D:/private", count: 2, errorCode: "E_IO", content: "never log", password: "never log" });
  state.logger.log("backup.export", { from: 2, to: true, path: false });
  assert.deepEqual(state.records(), [{ at: "2026-11-01T09:30:05.000Z", event: "backup.export", count: 2, errorCode: "E_IO" }, { at: "2026-11-01T09:30:05.000Z", event: "backup.export" }]);
});

test("move audit rejects missing overlong and multiline paths", (context) => {
  const state = fixture(context);
  for (const from of [undefined, "", "D:/bad\rline", "D:/bad\nline", "D:/bad\0line", "D:/" + "a".repeat(32768)]) assert.throws(() => state.logger.log("data-root.moved", { from, to: "D:/new" }), TypeError);
  for (const to of [undefined, "", "D:/bad\rline", "D:/bad\nline", "D:/bad\0line", "D:/" + "a".repeat(32768)]) assert.throws(() => state.logger.log("data-root.moved", { from: "D:/old", to }), TypeError);
});
