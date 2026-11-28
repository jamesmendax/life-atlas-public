import fs from "node:fs";
import assert from "node:assert/strict";
import { assertTestPath } from "../desktop/helpers.mjs";

function archiveHeader(descriptor) {
  const prefix = Buffer.alloc(16);
  assert.equal(fs.readSync(descriptor, prefix, 0, prefix.length, 0), prefix.length, "ASAR header is truncated");
  const headerSize = prefix.readUInt32LE(4);
  const jsonSize = prefix.readUInt32LE(12);
  assert.ok(headerSize >= 8 && headerSize <= 8 * 1024 * 1024, "ASAR header size is invalid");
  assert.ok(jsonSize > 0 && jsonSize <= headerSize - 8, "ASAR JSON size is invalid");
  const bytes = Buffer.alloc(jsonSize);
  assert.equal(fs.readSync(descriptor, bytes, 0, bytes.length, 16), bytes.length);
  return { bytes, header: JSON.parse(bytes.toString("utf8")), contentOffset: headerSize + 8 };
}

function mutateByte(descriptor, offset, before, after) {
  assert.notEqual(before, after);
  assert.equal(fs.writeSync(descriptor, Buffer.from([after]), 0, 1, offset), 1);
  fs.fsyncSync(descriptor);
  return { offset, before, after };
}

export function tamperAsarHeader(file) {
  const descriptor = fs.openSync(assertTestPath(file), "r+");
  try {
    const { bytes } = archiveHeader(descriptor);
    const match = /"size"\s*:\s*(\d)/.exec(bytes.toString("utf8"));
    assert.ok(match, "ASAR header has no size field");
    const digitIndex = Buffer.byteLength(bytes.toString("utf8").slice(0, match.index + match[0].length - 1));
    const before = bytes[digitIndex];
    return mutateByte(descriptor, 16 + digitIndex, before, before === 57 ? 56 : before + 1);
  } finally { fs.closeSync(descriptor); }
}

export function tamperAsarMain(file) {
  const descriptor = fs.openSync(assertTestPath(file), "r+");
  try {
    const { header, contentOffset } = archiveHeader(descriptor);
    const main = header.files?.electron?.files?.main?.files?.["index.js"];
    assert.ok(main && !main.unpacked && !main.link, "Main process must be inside ASAR");
    const relativeOffset = Number(main.offset);
    assert.ok(Number.isSafeInteger(relativeOffset) && relativeOffset >= 0);
    assert.ok(Number.isSafeInteger(main.size) && main.size > 0 && main.size <= 10 * 1024 * 1024);
    const bytes = Buffer.alloc(main.size);
    assert.equal(fs.readSync(descriptor, bytes, 0, bytes.length, contentOffset + relativeOffset), bytes.length);
    const marker = Buffer.from("requestSingleInstanceLock");
    const markerOffset = bytes.indexOf(marker);
    assert.ok(markerOffset >= 0, "Main process mutation target is absent");
    return mutateByte(descriptor, contentOffset + relativeOffset + markerOffset, marker[0], "R".charCodeAt(0));
  } finally { fs.closeSync(descriptor); }
}
