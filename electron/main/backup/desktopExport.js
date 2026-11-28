import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { workspaceToFiles, jsonBytes } from "../../../src/backup/serialize.js";
import { buildManifest, WORKSPACE_RESCUE_SCOPE } from "../../../src/backup/manifest.js";
import { shouldStoreAsset } from "../../../src/backup/format.js";
import { verifyPackage } from "../../../src/backup/verify.js";
import { CURRENT_SCHEMA_VERSION } from "../../../src/persistence/migrations.js";
import { assertPhysicalPath } from "../storage/dataRoot.js";
import { StorageError, validateWorkspaceSnapshot } from "../storage/workspaceDb.js";
import { isNonEmptyString, isPlainObject } from "../ipc/validate.js";
import { createZipFileWriter, openZipFileReader } from "./zipNode.js";
import { backupDate, checkCancelled } from "./files.js";
import { ASSISTANT_ARCHIVE_PATH, validateAssistantArchive } from "./assistantArchive.js";

export async function exportFullBackup({ db, assetStore, workspace, conversations, vaultExport = null, ...options }) {
  checkCancelled(options.signal);
  const files = workspaceToFiles(workspace);
  const rows = assetStore?.list?.() ?? db.prepare("SELECT sha256, size, mime, original_name AS originalName, created_at AS createdAt FROM assets ORDER BY sha256").all();
  const assetEntries = rows.map((row) => ({ sha256: row.sha256, size: row.size, mime: row.mime, originalName: row.originalName ?? "", createdAt: row.createdAt }));
  files.push({ path: "assets/index.json", bytes: jsonBytes(assetEntries) });
  const assistantArchive = conversations?.exportBackup();
  if (assistantArchive?.conversations.length) {
    validateAssistantArchive(assistantArchive, assetEntries);
    files.push({ path: ASSISTANT_ARCHIVE_PATH, bytes: jsonBytes(assistantArchive) });
  }
  for (const asset of assetEntries) {
    if (!assetStore?.filePath) throw new StorageError("E_INVALID_ARGUMENT", "附件文件服务不可用");
    files.push({ path: `assets/${asset.sha256}`, filePath: assetStore.filePath(asset.sha256), size: asset.size, sha256: asset.sha256, mime: asset.mime });
  }
  const vault = vaultExport ? { included: true, vaultId: vaultExport.header.vaultId, formatVersion: 1, itemCount: vaultExport.items.length } : { included: false };
  if (vaultExport) files.push({ path: "vault/vault.json", bytes: jsonBytes({ kind: "life-atlas-vault-export", formatVersion: 1, header: vaultExport.header, items: vaultExport.items, state: { settings: vaultExport.settings } }) });
  return writeDesktopBackup({ ...options, workspace, files, assetEntries, vault });
}

export function validateWorkspaceRescue(workspace) {
  if (!isPlainObject(workspace) || workspace.schemaVersion !== CURRENT_SCHEMA_VERSION || !isNonEmptyString(workspace.workspaceId, 200) || !isPlainObject(workspace.ui)) {
    throw new StorageError("E_INVALID_ARGUMENT", "当前工作区的救援数据无效");
  }
  validateWorkspaceSnapshot(workspace);
}

export function exportWorkspaceRescue({ workspace, ...options }) {
  const files = workspaceToFiles(workspace);
  files.push({ path: "assets/index.json", bytes: jsonBytes([]) });
  return writeDesktopBackup({ ...options, workspace, files, scope: WORKSPACE_RESCUE_SCOPE });
}

async function writeDesktopBackup({ targetPath, appVersion, now, onProgress, signal, workspace, files, assetEntries, vault, scope, createWriter = createZipFileWriter, openReader = openZipFileReader, verify = verifyPackage }) {
  checkCancelled(signal);
  const target = assertPhysicalPath(targetPath);
  const temporary = assertPhysicalPath(`${target}.partial-${randomBytes(4).toString("hex")}`);
  const manifest = await buildManifest({ createdAt: backupDate(now).toISOString(), appVersion, platform: "desktop", workspace, files, assetEntries, vault, scope });
  const byPath = new Map(files.map((entry) => [entry.path, entry]));
  let done = 0;
  let writer;
  let reader;
  let abortPromise;
  const abort = () => {
    if (writer && !abortPromise) abortPromise = writer.abort().catch(() => {});
  };
  try {
    checkCancelled(signal);
    writer = createWriter(temporary, { onEntry: () => {
      checkCancelled(signal);
      done += 1;
      onProgress?.({ phase: "write", done, total: manifest.files.length + 1 });
      checkCancelled(signal);
    } });
    signal?.addEventListener("abort", abort, { once: true });
    writer.addBuffer("manifest.json", jsonBytes(manifest));
    for (const entry of manifest.files) {
      checkCancelled(signal);
      const file = byPath.get(entry.path);
      if (file.filePath) writer.addFile(file.path, file.filePath, { store: shouldStoreAsset(file.mime) });
      else writer.addBuffer(file.path, file.bytes);
    }
    await writer.finish();
    checkCancelled(signal);
    onProgress?.({ phase: "verify", done: 0, total: 1 });
    reader = await openReader(temporary);
    const report = await verify(reader, { currentSchemaVersion: CURRENT_SCHEMA_VERSION });
    reader.close();
    reader = undefined;
    if (!report.ok) throw new StorageError("E_IO", "导出的文件校验失败");
    checkCancelled(signal);
    fs.renameSync(temporary, target);
    return { filePath: target, manifest };
  } catch (error) {
    reader?.close();
    if (writer) await writer.abort().catch(() => {});
    await abortPromise;
    if (fs.existsSync(assertPhysicalPath(temporary))) fs.unlinkSync(temporary);
    checkCancelled(signal);
    throw error?.code?.startsWith("E_") ? error : new StorageError("E_IO", "导出失败，未替换目标文件");
  } finally { signal?.removeEventListener("abort", abort); }
}
