import { requiredCollections, isSafeBackupPath } from "./format.js";
import { sha256Hex } from "./hash.js";
import { parseJsonBytes, parseJsonl, readCollectionOrder, restoreCollectionOrder } from "./serialize.js";
import { validateManifest, manifestSummary, COUNT_COLLECTIONS } from "./manifest.js";

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const hashPattern = /^[a-f0-9]{64}$/;
function validBase64(value, expectedLength) {
  if (typeof value !== "string" || !value || value.length % 4 !== 0) return false;
  try {
    const decoded = atob(value);
    return btoa(decoded) === value && (expectedLength === undefined || decoded.length === expectedLength);
  } catch { return false; }
}

export function validateVaultBackupHeader(header) {
  if (!isObject(header) || header.kind !== "life-atlas-vault" || header.formatVersion !== 1 || header.padding !== 512
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(header.vaultId ?? "")
    || typeof header.createdAt !== "string" || !Number.isFinite(Date.parse(header.createdAt))) return false;
  const kdf = header.kdf;
  if (kdf?.alg !== "argon2id" || kdf.version !== 19 || kdf.memoryKiB !== 131072 || kdf.iterations !== 3 || kdf.parallelism !== 1 || !validBase64(kdf.saltB64, 16)) return false;
  const passwordWrap = header.wraps?.password;
  const recoveryWrap = header.wraps?.recovery;
  return passwordWrap?.alg === "A256GCM" && validBase64(passwordWrap.blobB64, 60)
    && recoveryWrap?.alg === "A256GCM" && recoveryWrap.kdf === "hkdf-sha256" && validBase64(recoveryWrap.saltB64, 16) && validBase64(recoveryWrap.blobB64, 60);
}

export function validateVaultExport(vault, manifest) {
  if (!isObject(vault) || vault.kind !== "life-atlas-vault-export" || vault.formatVersion !== 1 || !validateVaultBackupHeader(vault.header)
    || vault.header.vaultId !== manifest.vault?.vaultId || !Array.isArray(vault.items) || !isObject(vault.state?.settings)) return false;
  if (manifest.vault.itemCount !== vault.items.length) return false;
  const ids = new Set();
  for (const item of vault.items) {
    if (!isObject(item) || typeof item.id !== "string" || !item.id || ids.has(item.id) || !validBase64(item.blobB64)) return false;
    const byteLength = item.blobB64.length / 4 * 3 - (item.blobB64.endsWith("==") ? 2 : item.blobB64.endsWith("=") ? 1 : 0);
    if (byteLength < 28) return false;
    ids.add(item.id);
  }
  return true;
}

export async function verifyPackage(reader, { currentSchemaVersion, fileName = null, encrypted = false } = {}) {
  const problems = [];
  let manifest = null;
  let blocking = false;
  const add = (code, path, detail) => {
    if (code !== "EXTRA_FILE") blocking = true;
    if (problems.length < 50) problems.push({ code, path, detail });
    else if (code !== "EXTRA_FILE" && problems.every((problem) => problem.code === "EXTRA_FILE")) problems[49] = { code, path, detail };
  };
  const result = () => ({ ok: !blocking, problems, manifest, summary: manifestSummary(manifest, { fileName, encrypted }) });
  let entries;
  try { entries = (await reader.entries()).filter((entry) => !entry.endsWith("/")); } catch {
    add("NOT_ZIP", null, "无法读取 ZIP 文件");
    return result();
  }
  if (entries[0] !== "manifest.json") {
    add("MANIFEST_NOT_FIRST", "manifest.json", "备份清单必须是第一个文件");
    return result();
  }
  try { manifest = parseJsonBytes(await reader.read("manifest.json")); } catch {
    add("BAD_MANIFEST", "manifest.json", "备份清单不是有效 JSON");
    return result();
  }
  for (const problem of validateManifest(manifest, { currentSchemaVersion })) add(problem.code, problem.path, problem.detail);
  if (problems.length) return result();
  const entrySet = new Set(entries);
  for (const entry of entries) if (!isSafeBackupPath(entry)) add("BAD_PATH", entry, "压缩包文件路径不安全");
  if (entrySet.size !== entries.length) add("BAD_MANIFEST", "manifest.json", "压缩包含重复文件名");
  const listed = new Map(manifest.files.map((file) => [file.path, file]));
  const metaPath = "workspace/meta.json";
  const collections = requiredCollections(manifest.workspace.schemaVersion);
  const entityFiles = new Map(collections.map((name) => [`workspace/entities/${name}.jsonl`, name]));
  for (const filePath of [metaPath, "assets/index.json", ...entityFiles.keys(), ...(manifest.vault.included ? ["vault/vault.json"] : [])]) {
    if (!listed.has(filePath)) add("MISSING_FILE", filePath, "清单缺少必需文件");
  }
  for (const entry of entries) if (entry !== "manifest.json" && !listed.has(entry)) add("EXTRA_FILE", entry, "忽略清单以外的文件");
  const smallFiles = new Map();
  const lineCounts = new Map();
  let collectionOrder = null;
  // Read the order first so each JSONL collection can be checked as it is parsed.
  const filesToCheck = [listed.get(metaPath), ...manifest.files.filter((file) => file.path !== metaPath)].filter(Boolean);
  for (const file of filesToCheck) {
    if (!isSafeBackupPath(file.path)) continue;
    if (!entrySet.has(file.path)) { add("MISSING_FILE", file.path, "文件不存在"); continue; }
    let bytes;
    try {
      if (reader.stat && file.path.startsWith("assets/") && file.path !== "assets/index.json") {
        const actual = await reader.stat(file.path);
        if (actual.size !== file.size) add("SIZE_MISMATCH", file.path, "文件大小不符");
        if (actual.sha256 !== file.sha256) add("HASH_MISMATCH", file.path, "文件 SHA-256 不符");
      } else {
        bytes = await reader.read(file.path);
        if (bytes.byteLength !== file.size) add("SIZE_MISMATCH", file.path, "文件大小不符");
        if (await sha256Hex(bytes) !== file.sha256) add("HASH_MISMATCH", file.path, "文件 SHA-256 不符");
      }
    } catch { add("MISSING_FILE", file.path, "无法读取文件"); continue; }
    if (/^assets\/[a-f0-9]{64}$/.test(file.path) && file.path.slice(7) !== file.sha256) add("HASH_MISMATCH", file.path, "附件文件名与 SHA-256 不符");
    if (file.path === metaPath) {
      let meta;
      try { meta = parseJsonBytes(bytes); }
      catch { add("BAD_MANIFEST", metaPath, "工作区元数据不是有效 JSON"); continue; }
      if (!isObject(meta) || meta.schemaVersion !== manifest.workspace.schemaVersion || meta.workspaceId !== manifest.workspace.workspaceId || !isObject(meta.ui) || !isObject(meta.extras)) {
        add("BAD_MANIFEST", metaPath, "工作区元数据与清单不符");
        continue;
      }
      try { collectionOrder = readCollectionOrder(meta, collections); }
      catch (error) { add("BAD_COLLECTION_ORDER", metaPath, error.message); }
    } else if (file.path.endsWith(".jsonl")) {
      let entities;
      try { entities = parseJsonl(bytes, file.path); }
      catch (error) { add("BAD_JSONL", file.path, error.message); continue; }
      lineCounts.set(file.path, entities.length);
      const collection = entityFiles.get(file.path);
      if (collectionOrder && collection) {
        try { restoreCollectionOrder(entities, collectionOrder[collection], collection); }
        catch (error) { add("BAD_COLLECTION_ORDER", metaPath, error.message); }
      }
    } else if (["assets/index.json", "vault/vault.json"].includes(file.path)) smallFiles.set(file.path, bytes);
  }
  for (const collection of COUNT_COLLECTIONS) {
    const filePath = `workspace/entities/${collection}.jsonl`;
    if (lineCounts.has(filePath) && lineCounts.get(filePath) !== manifest.workspace.counts[collection]) add("COUNT_MISMATCH", filePath, "实体数量与清单不符");
  }
  try {
    const assets = parseJsonBytes(smallFiles.get("assets/index.json"));
    if (!Array.isArray(assets)) throw new Error("附件索引不是数组");
    const unique = new Map();
    const legacyIds = new Set();
    for (const asset of assets) {
      if (!isObject(asset) || !hashPattern.test(asset.sha256 ?? "") || !Number.isSafeInteger(asset.size) || asset.size < 0 || typeof asset.mime !== "string" || typeof asset.originalName !== "string") throw new Error("附件索引含无效条目");
      if (asset.legacyAttachmentId != null && (typeof asset.legacyAttachmentId !== "string" || !asset.legacyAttachmentId || legacyIds.has(asset.legacyAttachmentId))) throw new Error("附件索引含重复或无效标识");
      legacyIds.add(asset.legacyAttachmentId);
      const assetFile = listed.get(`assets/${asset.sha256}`);
      if (!assetFile) add("MISSING_FILE", `assets/${asset.sha256}`, "附件索引引用的文件未列入清单");
      else if (assetFile.size !== asset.size) add("SIZE_MISMATCH", `assets/${asset.sha256}`, "附件索引大小与清单不符");
      unique.set(asset.sha256, asset.size);
    }
    if (unique.size !== manifest.assets.count || [...unique.values()].reduce((total, size) => total + size, 0) !== manifest.assets.totalBytes) add("COUNT_MISMATCH", "assets/index.json", "附件数量或总大小不符");
  } catch (error) { add("BAD_MANIFEST", "assets/index.json", error.message); }
  if (smallFiles.has("vault/vault.json")) {
    try { if (!manifest.vault.included || !validateVaultExport(parseJsonBytes(smallFiles.get("vault/vault.json")), manifest)) add("BAD_VAULT", "vault/vault.json", "密钥库密文结构无效"); } catch { add("BAD_VAULT", "vault/vault.json", "密钥库密文不是有效 JSON"); }
  }
  return result();
}
