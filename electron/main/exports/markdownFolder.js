import fs from "node:fs";
import path from "node:path";
import { assertPhysicalPath, DataRootError } from "../storage/dataRoot.js";
import { tMain } from "../i18n/index.js";

export function validateMarkdownExportPath(value) {
  if (typeof value !== "string" || !value || value.startsWith("/") || /[\\:*?"<>|\u0000-\u001f\u007f]/.test(value)) return false;
  return value.split("/").every((segment) => segment && segment !== "." && segment !== ".." && Array.from(segment).length <= 100 && !/[. ]$/.test(segment) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment));
}

export function validateMarkdownExportPayload(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.files) || !Array.isArray(payload.assets)) throw new DataRootError("E_INVALID_ARGUMENT", "导出文件清单无效");
  const entries = [...payload.files, ...payload.assets];
  const names = new Set();
  for (const entry of entries) {
    if (!entry || !validateMarkdownExportPath(entry.path)) throw new DataRootError("E_INVALID_ARGUMENT", "导出路径无效");
    const key = entry.path.toLowerCase();
    if (names.has(key)) throw new DataRootError("E_INVALID_ARGUMENT", "导出文件路径重复");
    names.add(key);
  }
  for (const entry of entries) {
    const segments = entry.path.toLowerCase().split("/");
    segments.pop();
    while (segments.length) {
      if (names.has(segments.join("/"))) throw new DataRootError("E_INVALID_ARGUMENT", "导出文件与目录冲突");
      segments.pop();
    }
  }
  if (payload.files.some((file) => typeof file.text !== "string") || payload.assets.some((asset) => asset.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(asset.sha256))) throw new DataRootError("E_INVALID_ARGUMENT", "导出文件内容或附件标识无效");
  return payload;
}

function exportFolderName(now) {
  const date = new Date(typeof now === "function" ? now() : now);
  if (Number.isNaN(date.getTime())) throw new DataRootError("E_INVALID_ARGUMENT", "导出时间无效");
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const time = `${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
  return tMain("Life Atlas 导出 {day} {time}", { day, time });
}

export async function writeMarkdownFolder(payload, { directory, assetStore, now = () => new Date().toISOString() } = {}) {
  validateMarkdownExportPayload(payload);
  const selected = assertPhysicalPath(directory, { allowMissing: false });
  if (!fs.statSync(selected).isDirectory()) throw new DataRootError("E_INVALID_ARGUMENT", "请选择一个文件夹");
  const name = exportFolderName(now);
  let folder;
  let number = 1;
  for (;;) {
    folder = assertPhysicalPath(path.join(selected, `${name}${number === 1 ? "" : ` (${number})`}`), { root: selected });
    try { await fs.promises.mkdir(folder); break; }
    catch (issue) { if (issue.code !== "EEXIST") throw issue; number += 1; }
  }
  const targetFor = async (filePath) => {
    const target = assertPhysicalPath(path.join(folder, ...filePath.split("/")), { root: folder });
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    return assertPhysicalPath(target, { root: folder });
  };
  for (const file of payload.files) await fs.promises.writeFile(await targetFor(file.path), file.text, { encoding: "utf8", flag: "wx" });
  const missingAssets = [];
  let copiedAssets = 0;
  for (const asset of payload.assets) {
    if (!asset.sha256 || typeof assetStore?.filePath !== "function") { missingAssets.push(asset.path); continue; }
    const source = assertPhysicalPath(assetStore.filePath(asset.sha256));
    try {
      const stat = await fs.promises.lstat(source);
      if (!stat.isFile()) throw new DataRootError("E_IO", "附件文件无效");
      await fs.promises.copyFile(source, await targetFor(asset.path), fs.constants.COPYFILE_EXCL);
      copiedAssets += 1;
    } catch (issue) {
      if (issue.code !== "ENOENT") throw issue;
      missingAssets.push(asset.path);
    }
  }
  return { folder, fileCount: payload.files.length + copiedAssets, missingAssets };
}
