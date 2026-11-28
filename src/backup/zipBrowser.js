import JSZip from "jszip";
import { isSafeBackupPath } from "./format.js";

function zipFilePaths(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.byteLength - 22;
  while (end >= Math.max(0, bytes.byteLength - 65557) && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0 || end < bytes.byteLength - 65557) throw new Error("ZIP 目录缺失");
  const total = view.getUint16(end + 10, true);
  if (view.getUint16(end + 4, true) !== 0 || total === 65535) throw new Error("此 ZIP 请在桌面版中打开");
  let offset = view.getUint32(end + 16, true);
  const files = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let index = 0; index < total; index += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error("ZIP 目录损坏");
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > end) throw new Error("ZIP 目录损坏");
    const filePath = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (!filePath.endsWith("/")) files.push({ filePath, offset: view.getUint32(offset + 42, true) });
    offset = nextOffset;
  }
  return files.sort((left, right) => left.offset - right.offset).map((file) => file.filePath);
}

export function createZipWriter() {
  const zip = new JSZip();
  return {
    add(filePath, bytes, { store = false } = {}) {
      if (!isSafeBackupPath(filePath)) throw new Error("备份文件路径不安全");
      zip.file(filePath, bytes, { createFolders: false, compression: store ? "STORE" : "DEFLATE" });
    },
    finish() { return zip.generateAsync({ type: "uint8array", compressionOptions: { level: 6 } }); },
  };
}

export async function openZipReader(bytes) {
  const paths = zipFilePaths(bytes);
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.values(zip.files).filter((file) => !file.dir);
  const byPath = new Map(files.map((file) => [file.unsafeOriginalName ?? file.name, file]));
  return {
    entries() { return [...paths]; },
    async read(filePath) {
      const file = byPath.get(filePath);
      if (!file) throw new Error(`备份缺少 ${filePath}`);
      return file.async("uint8array");
    },
  };
}
