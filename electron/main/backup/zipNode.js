import fs from "node:fs";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";
import yauzl from "yauzl";
import { isSafeBackupPath } from "../../../src/backup/format.js";
import { assertPhysicalPath } from "../storage/dataRoot.js";
import { StorageError } from "../storage/workspaceDb.js";
import { syncFile } from "./files.js";

export function createZipFileWriter(targetPath, { onEntry } = {}) {
  const target = assertPhysicalPath(targetPath);
  const zip = new yazl.ZipFile();
  const output = fs.createWriteStream(target, { flags: "wx" });
  const streams = new Set();
  const paths = new Set();
  let closed = false;
  let ending = false;
  let created = false;
  let failure;
  output.once("open", () => { created = true; });
  const completion = pipeline(zip.outputStream, output);
  completion.catch(() => {});
  const fail = (error) => {
    if (failure) return;
    failure = error;
    for (const stream of streams) stream.destroy(error);
    zip.outputStream.destroy(error);
  };
  zip.on("error", fail);
  const add = (entryPath, open, options = {}) => {
    if (closed || ending || !isSafeBackupPath(entryPath) || entryPath.endsWith("/") || paths.has(entryPath)) throw new StorageError("E_INVALID_ARGUMENT", "ZIP 条目路径无效或重复");
    paths.add(entryPath);
    zip.addReadStreamLazy(entryPath, { compress: options.store !== true }, (callback) => {
      if (failure) { callback(failure); return; }
      let stream;
      try { stream = open(); } catch (error) { callback(error); return; }
      streams.add(stream);
      stream.on("error", fail);
      stream.once("close", () => streams.delete(stream));
      stream.once("end", () => {
        try { onEntry?.(entryPath); } catch (error) { fail(error); }
      });
      callback(null, stream);
    });
  };
  return {
    addBuffer(entryPath, bytes, options) {
      const buffer = bytes instanceof ArrayBuffer ? Buffer.from(bytes) : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      add(entryPath, () => Readable.from([buffer]), options);
    },
    addFile(entryPath, filePath, options) {
      const file = assertPhysicalPath(filePath, { allowMissing: false });
      if (!fs.statSync(file).isFile()) throw new StorageError("E_IO", "ZIP 来源不是文件");
      add(entryPath, () => fs.createReadStream(file, { highWaterMark: 64 * 1024 }), options);
    },
    async finish() {
      if (closed) throw new StorageError("E_CANCELLED", "ZIP 写入已取消");
      if (!ending) { ending = true; zip.end(); }
      await completion;
      syncFile(target);
      closed = true;
    },
    async abort() {
      fail(new StorageError("E_CANCELLED", "ZIP 写入已取消"));
      await completion.catch(() => {});
      closed = true;
      if (created && fs.existsSync(assertPhysicalPath(target))) fs.unlinkSync(target);
    },
  };
}

export async function openZipFileReader(filePath) {
  const file = assertPhysicalPath(filePath, { allowMissing: false });
  const zip = await yauzl.openPromise(file, { autoClose: false, lazyEntries: true, decodeStrings: false, validateEntrySizes: true });
  const ordered = [];
  const byPath = new Map();
  const stats = new Map();
  const streams = new Set();
  let closed = false;
  let failure;
  zip.on("error", (error) => { failure = error; for (const stream of streams) stream.destroy(error); });
  try {
    for await (const entry of zip.eachEntry()) {
      const name = new TextDecoder("utf-8", { fatal: true }).decode(entry.fileName);
      if (name.endsWith("/")) continue;
      ordered.push(name);
      if (!byPath.has(name)) byPath.set(name, entry);
    }
  } catch (error) { zip.close(); throw error; }
  const openStream = async (entryPath) => {
    if (closed || failure) throw failure || new StorageError("E_IO", "ZIP 文件已关闭");
    const entry = byPath.get(entryPath);
    if (!entry) throw new StorageError("E_NOT_FOUND", "ZIP 条目不存在");
    const stream = await zip.openReadStreamPromise(entry);
    streams.add(stream);
    stream.once("close", () => streams.delete(stream));
    return stream;
  };
  const stat = async (entryPath) => {
    if (!stats.has(entryPath)) stats.set(entryPath, (async () => {
      const hash = createHash("sha256");
      let size = 0;
      for await (const bytes of await openStream(entryPath)) { size += bytes.length; hash.update(bytes); }
      return { size, sha256: hash.digest("hex") };
    })());
    return stats.get(entryPath);
  };
  return {
    entries: () => [...ordered],
    size: (entryPath) => byPath.get(entryPath)?.uncompressedSize,
    sha256: async (entryPath) => (await stat(entryPath)).sha256,
    stat,
    openStream,
    async read(entryPath) {
      const chunks = [];
      for await (const bytes of await openStream(entryPath)) chunks.push(bytes);
      return Buffer.concat(chunks);
    },
    close() {
      if (closed) return;
      closed = true;
      for (const stream of streams) stream.destroy();
      zip.close();
    },
  };
}
