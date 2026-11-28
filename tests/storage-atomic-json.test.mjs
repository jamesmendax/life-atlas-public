import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { writeAtomicJson } from "../electron/main/storage/dataRoot.js";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";

function marker(t) {
  const root = createIsolatedDirectory("atomic-json");
  t.after(() => removeIsolatedDirectory(root));
  const file = path.join(root, "marker.json");
  fs.writeFileSync(file, '{"pending":false}');
  return { root, file };
}

test("atomic JSON replacement retries short Windows contention without removing the original", { skip: process.platform !== "win32" }, t => {
  const { root, file } = marker(t);
  const rename = fs.renameSync;
  const lockErrors = ["EPERM", "EBUSY"];
  const sources = new Set();
  t.mock.method(fs, "renameSync", (source, target) => {
    sources.add(source);
    assert.equal(target, file);
    assert.equal(fs.readFileSync(file, "utf8"), '{"pending":false}');
    assert.deepEqual(JSON.parse(fs.readFileSync(source, "utf8")), { pending: true });
    if (lockErrors.length) throw Object.assign(new Error("busy"), { code: lockErrors.shift() });
    rename(source, target);
  });
  writeAtomicJson(file, { pending: true });
  assert.equal(sources.size, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { pending: true });
  assert.deepEqual(fs.readdirSync(root), ["marker.json"]);
});

for (const code of ["EPERM", "EACCES"]) {
  test(`atomic JSON replacement preserves the target and removes staging after ${code}`, t => {
    const { root, file } = marker(t);
    const error = Object.assign(new Error("rename failed"), { code });
    const rename = t.mock.method(fs, "renameSync", () => { throw error; });
    assert.throws(() => writeAtomicJson(file, { pending: true }), expected => expected === error);
    assert.equal(rename.mock.callCount(), process.platform === "win32" && code === "EPERM" ? 4 : 1);
    assert.equal(fs.readFileSync(file, "utf8"), '{"pending":false}');
    assert.deepEqual(fs.readdirSync(root), ["marker.json"]);
  });
}
