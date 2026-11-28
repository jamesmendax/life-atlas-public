import fs from "node:fs";
import path from "node:path";
import { assertPhysicalPath, writeAtomicJson } from "./dataRoot.js";
import { deleteAssetRows, StorageError } from "./workspaceDb.js";

export const componentMime = "application/vnd.life-atlas.component+zip";
export const templateMime = "application/vnd.life-atlas.template+zip";
export const marketMimes = [componentMime, templateMime];
const inactiveMime = (mime) => `${mime};installed=0`;
const hashPattern = /^[0-9a-f]{64}$/u;

function isOrdinaryReference(value, sha256) {
  const url = `life-asset://${sha256}`;
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (typeof current === "string") {
      if (current.includes(url)) return true;
    } else if (current && typeof current === "object") {
      if (current.provider === "asset" && current.storageKey === sha256) return true;
      for (const [field, child] of Object.entries(current)) {
        // A removed widget keeps its exact URL and its state so the same SHA
        // reconnects it. A real file/link attachment still needs the archive.
        if (current.type === "marketComponent" && field === "props" && child?.url === url) {
          for (const [key, entry] of Object.entries(child)) if (key !== "url") pending.push(entry);
        } else pending.push(child);
      }
    }
  }
  return false;
}

export function createMarketArchiveRemoval({ root, connection, assetFile, verifyAsset, visitSnapshots, additionalReferences }) {
  const registry = assertPhysicalPath(path.join(root, "market-retained"), { root });
  const marker = (hash) => assertPhysicalPath(path.join(registry, hash + ".json"), { root: registry });
  const ordinary = (db, hash) => [...(additionalReferences?.() ?? [])].includes(hash)
    || db.prepare("SELECT json FROM entities WHERE instr(json, ?)>0").all(hash).some(({ json }) => isOrdinaryReference(JSON.parse(json), hash));

  async function remove(record, { reclaim = false } = {}) {
    const { sha256, mime, size } = record;
    if (!hashPattern.test(sha256 ?? "") || !marketMimes.includes(mime) || !Number.isSafeInteger(size) || size < 1) throw new StorageError("E_INVALID_ARGUMENT", "市集下载记录无效。");
    const file = assetFile(sha256);
    const mark = marker(sha256);
    const rowFor = (db) => db.prepare("SELECT mime,size FROM assets WHERE sha256=?").get(sha256);
    const row = rowFor(connection());
    if (reclaim && row && row.mime !== inactiveMime(mime)) {
      if (fs.existsSync(mark)) fs.unlinkSync(mark);
      return;
    }
    if (!reclaim && (row?.mime !== mime || row.size !== size)) throw new StorageError("E_CONFLICT", "该下载已发生变化，请刷新后再试。");
    const exists = fs.existsSync(file);
    if (exists) await verifyAsset(file, { sha256, size });
    const db = connection();
    if (rowFor(db)?.mime !== row?.mime) throw new StorageError("E_CONFLICT", "下载状态已发生变化，请重试。");
    const retainedForAttachments = ordinary(db, sha256);
    let retainedForSnapshots = false;
    visitSnapshots((snapshot) => { if (!retainedForSnapshots && rowFor(snapshot)) retainedForSnapshots = true; });
    const retained = retainedForAttachments || retainedForSnapshots;
    if (!exists && retained) throw new StorageError("E_CORRUPT", "快照或附件所需的市集文件缺失。");
    // Persist the pending deletion first. After a restart the periodic storage
    // cleanup can finish it, but never deletes a package which was reinstalled.
    if (!fs.existsSync(mark)) {
      fs.mkdirSync(registry, { recursive: true });
      writeAtomicJson(mark, { sha256, mime, size });
    }
    if (retainedForAttachments && row) db.prepare("UPDATE assets SET mime=? WHERE sha256=?").run(inactiveMime(mime), sha256);
    else if (row) deleteAssetRows(db, [sha256]);
    if (!retained) {
      if (exists) fs.unlinkSync(file);
      fs.unlinkSync(mark);
    }
    return { removed: true, sha256, size, releasedBytes: !retained && exists ? size : 0, retainedBytes: retained ? size : 0, retainedForAttachments, retainedForSnapshots };
  }

  async function reclaim() {
    const records = new Map();
    if (fs.existsSync(registry)) {
      for (const entry of fs.readdirSync(registry)) {
        const hash = entry.endsWith(".json") && entry.slice(0, -5);
        if (!hash || !hashPattern.test(hash)) continue;
        const record = JSON.parse(fs.readFileSync(marker(hash), "utf8"));
        if (record?.sha256 !== hash) throw new StorageError("E_CORRUPT", "市集回收记录无效。");
        records.set(hash, record);
      }
    }
    // An ordinary attachment retained in a restored backup may predate this
    // device's registry. Its portable MIME records its uninstalled status.
    for (const mime of marketMimes) for (const row of connection().prepare("SELECT sha256,size FROM assets WHERE mime=?").all(inactiveMime(mime))) records.set(row.sha256, { ...row, mime });
    for (const record of records.values()) await remove(record, { reclaim: true });
  }
  return { remove, reclaim };
}
