import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { encryptFileToContainer, decryptContainerToFileWithKey } from "../electron/main/backup/encryptedContainer.js";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";

const key = Buffer.alloc(32, 0x42);
const saltB64 = Buffer.alloc(16, 0x24).toString("base64");
const noncePrefix = Buffer.from([1, 2, 3, 4, 5, 6, 7]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function directory(context) {
  const root = createIsolatedDirectory("container");
  context.after(() => removeIsolatedDirectory(root));
  return root;
}

async function encrypted(root, bytes, name = "fixture", chunkSize = 16) {
  const sourceFile = path.join(root, `${name}.bin`);
  const targetFile = path.join(root, `${name}.lifeatlas`);
  fs.writeFileSync(sourceFile, bytes);
  await encryptFileToContainer({ sourceFile, targetFile, key, saltB64, noncePrefix, chunkSize });
  return { sourceFile, targetFile };
}

test("container bytes match the four reference vectors", async (context) => {
  const root = directory(context);
  const cases = [
    [Buffer.alloc(0), 282, "63ff8495143fc3fae6f1a7a0ea49dca004498c46bd653bceef5af3ab32645fd3"],
    [Buffer.from("life atlas"), 292, "7e1d839180c99f974dba4d2b2c8ec055d82c49710335b62704b1b4cc3f94c418"],
    [Buffer.alloc(16, 0x61), 314, "1263fee660ec2f46da9eae7cc2567fe40ae7ec8e523ed96bc3bbf76eb52688d8"],
    [Buffer.alloc(20, 0x62), 318, "d218d218c7a61765491ab7b8c399e59e9e6e56cc1a23977aaeb67a6d46dca9b4"],
  ];
  for (let index = 0; index < cases.length; index += 1) {
    const [bytes, size, expected] = cases[index];
    const { targetFile } = await encrypted(root, bytes, `kat-${index}`);
    const actual = fs.readFileSync(targetFile);
    assert.equal(actual.length, size);
    assert.equal(hash(actual), expected);
  }
});

test("round trip restores the exact bytes for many sizes", async (context) => {
  const root = directory(context);
  for (const size of [0, 1, 16, 17, 1048576, 1048577, 3 * 1048576]) {
    const bytes = Buffer.alloc(size, 0xa7);
    const { targetFile } = await encrypted(root, bytes, `size-${size}`, 1048576);
    const restored = path.join(root, `restored-${size}.bin`);
    await decryptContainerToFileWithKey({ sourceFile: targetFile, targetFile: restored, key });
    assert.deepEqual(fs.readFileSync(restored), bytes);
  }
});

test("a wrong key is rejected", async (context) => {
  const root = directory(context);
  const { targetFile } = await encrypted(root, Buffer.from("a secret payload"));
  const restored = path.join(root, "wrong.bin");
  await assert.rejects(decryptContainerToFileWithKey({ sourceFile: targetFile, targetFile: restored, key: Buffer.alloc(32, 0x43) }), { code: "E_BAD_PASSWORD" });
  assert.equal(fs.existsSync(restored), false);
});

test("one flipped byte anywhere is rejected", async (context) => {
  const root = directory(context);
  const { targetFile } = await encrypted(root, Buffer.alloc(80, 0x33));
  const original = fs.readFileSync(targetFile);
  const offset = 12 + original.readUInt32BE(8);
  for (const position of [0, 8, 30, offset + 1, original.length - 1]) {
    const bytes = Buffer.from(original);
    bytes[position] ^= 1;
    const tampered = path.join(root, `tampered-${position}.lifeatlas`);
    fs.writeFileSync(tampered, bytes);
    const restored = path.join(root, `tampered-${position}.bin`);
    await assert.rejects(decryptContainerToFileWithKey({ sourceFile: tampered, targetFile: restored, key }), { code: "E_BAD_PASSWORD" });
    assert.equal(fs.existsSync(restored), false);
  }
});

test("a truncated last chunk is rejected", async (context) => {
  const root = directory(context);
  const { targetFile } = await encrypted(root, Buffer.alloc(32, 0x33));
  const bytes = fs.readFileSync(targetFile);
  fs.writeFileSync(targetFile, bytes.subarray(0, bytes.length - 16));
  await assert.rejects(decryptContainerToFileWithKey({ sourceFile: targetFile, targetFile: path.join(root, "truncated.bin"), key }), { code: "E_BAD_PASSWORD" });
});

test("appended data after the last chunk is rejected", async (context) => {
  const root = directory(context);
  const { targetFile } = await encrypted(root, Buffer.from("short"));
  fs.appendFileSync(targetFile, Buffer.from("extra"));
  await assert.rejects(decryptContainerToFileWithKey({ sourceFile: targetFile, targetFile: path.join(root, "appended.bin"), key }), { code: "E_BAD_PASSWORD" });
});

test("chunks out of order are rejected", async (context) => {
  const root = directory(context);
  const { targetFile } = await encrypted(root, Buffer.alloc(40, 0x33));
  const bytes = fs.readFileSync(targetFile);
  const offset = 12 + bytes.readUInt32BE(8);
  fs.writeFileSync(targetFile, Buffer.concat([bytes.subarray(0, offset), bytes.subarray(offset + 32, offset + 64), bytes.subarray(offset, offset + 32), bytes.subarray(offset + 64)]));
  await assert.rejects(decryptContainerToFileWithKey({ sourceFile: targetFile, targetFile: path.join(root, "swapped.bin"), key }), { code: "E_BAD_PASSWORD" });
});

test("memory stays flat while encrypting a large file", async (context) => {
  const root = directory(context);
  const sourceFile = path.join(root, "200mb.bin");
  const descriptor = fs.openSync(sourceFile, "wx");
  const block = Buffer.alloc(1048576, 0x6a);
  try { for (let index = 0; index < 200; index += 1) fs.writeSync(descriptor, block); }
  finally { fs.closeSync(descriptor); }
  const baseline = process.memoryUsage().rss;
  let peak = baseline;
  const sample = () => { peak = Math.max(peak, process.memoryUsage().rss); };
  const interval = setInterval(sample, 10);
  try {
    await encryptFileToContainer({ sourceFile, targetFile: path.join(root, "200mb.lifeatlas"), key, saltB64, noncePrefix, onProgress: sample });
    sample();
    console.log(`WP08_CONTAINER_PEAK_MB=${((peak - baseline) / 1048576).toFixed(2)}`);
    assert.ok(peak - baseline < 100 * 1048576, `RSS increased ${(peak - baseline) / 1048576} MiB`);
  } finally { clearInterval(interval); }
});
