import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";
import { tamperAsarHeader, tamperAsarMain } from "./release/asar-tamper.mjs";

function fixtureArchive() {
  const content = Buffer.from("const 描述 = 'local'; app.requestSingleInstanceLock();", "utf8");
  const header = Buffer.from(JSON.stringify({ files: { "先读.txt": { size: 0, offset: "0" }, electron: { files: { main: { files: { "index.js": { size: content.length, offset: "0" } } } } } } }));
  const headerSize = 8 + Math.ceil(header.length / 4) * 4;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(headerSize, 4);
  prefix.writeUInt32LE(headerSize - 4, 8);
  prefix.writeUInt32LE(header.length, 12);
  return Buffer.concat([prefix, header, Buffer.alloc(headerSize - 8 - header.length), content]);
}

for (const [label, mutate] of [["header", tamperAsarHeader], ["main process", tamperAsarMain]]) {
  test(`the release ${label} probe changes exactly one intended archive byte`, () => {
    const root = createIsolatedDirectory("asar-tamper-unit");
    try {
      const file = path.join(root, "app.asar");
      const original = fixtureArchive();
      fs.writeFileSync(file, original);
      const change = mutate(file);
      const modified = fs.readFileSync(file);
      assert.equal(modified.length, original.length);
      const differences = [];
      for (let index = 0; index < original.length; index += 1) if (original[index] !== modified[index]) differences.push(index);
      assert.deepEqual(differences, [change.offset]);
      assert.equal(original[change.offset], change.before);
      assert.equal(modified[change.offset], change.after);
      const contentOffset = 8 + original.readUInt32LE(4);
      if (label === "header") {
        assert.ok(change.offset >= 16 && change.offset < contentOffset);
        assert.deepEqual(modified.subarray(contentOffset), original.subarray(contentOffset));
      } else {
        assert.equal(change.offset, original.indexOf("requestSingleInstanceLock", contentOffset));
        assert.deepEqual(modified.subarray(0, contentOffset), original.subarray(0, contentOffset));
      }
    } finally { removeIsolatedDirectory(root); }
  });
}

test("release mutation probes reject a distribution outside the owned runtime", () => {
  const original = path.resolve("release/release/win-unpacked/resources/app.asar");
  assert.throws(() => tamperAsarHeader(original), /runtime/);
  assert.throws(() => tamperAsarMain(original), /runtime/);
});

test("release mutation probes leave a truncated archive untouched", () => {
  const root = createIsolatedDirectory("asar-tamper-unit");
  try {
    const file = path.join(root, "bad.asar");
    const original = Buffer.from("not an archive");
    fs.writeFileSync(file, original);
    assert.throws(() => tamperAsarHeader(file));
    assert.deepEqual(fs.readFileSync(file), original);
    assert.throws(() => tamperAsarMain(file));
    assert.deepEqual(fs.readFileSync(file), original);
  } finally { removeIsolatedDirectory(root); }
});
