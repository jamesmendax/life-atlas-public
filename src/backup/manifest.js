import { BACKUP_KIND, BACKUP_FORMAT_VERSION, isSafeBackupPath, requiredCollections } from "./format.js";
import { sha256Hex } from "./hash.js";

export const COUNT_COLLECTIONS = Object.freeze(["folders", "pages", "dataSources", "databaseItems", "attachments"]);
export const WORKSPACE_RESCUE_SCOPE = "workspace-rescue";
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const hashPattern = /^[a-f0-9]{64}$/;

export async function buildManifest({ createdAt, appVersion, platform, workspace, files, assetEntries = [], vault = { included: false }, scope }) {
  const uniqueAssets = new Map(assetEntries.map((entry) => [entry.sha256, entry.size]));
  const entries = await Promise.all(files.map(async (file) => ({
    path: file.path,
    size: file.size ?? file.bytes.byteLength,
    sha256: file.sha256 ?? await sha256Hex(file.bytes),
  })));
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return {
    kind: BACKUP_KIND,
    formatVersion: BACKUP_FORMAT_VERSION,
    ...(scope ? { scope } : {}),
    createdAt,
    app: { name: "Life Atlas", version: appVersion, platform },
    workspace: {
      schemaVersion: workspace.schemaVersion,
      workspaceId: workspace.workspaceId,
      counts: Object.fromEntries(COUNT_COLLECTIONS.map((collection) => [collection, (workspace[collection] ?? []).length])),
    },
    assets: { count: uniqueAssets.size, totalBytes: [...uniqueAssets.values()].reduce((total, size) => total + size, 0) },
    vault: vault.included ? { included: true, vaultId: vault.vaultId, formatVersion: vault.formatVersion, itemCount: vault.itemCount } : { included: false },
    files: entries,
  };
}

export function validateManifest(manifest, { currentFormatVersion = BACKUP_FORMAT_VERSION, currentSchemaVersion } = {}) {
  const problems = [];
  const add = (code, detail, path = "manifest.json") => problems.push({ code, path, detail });
  if (!isObject(manifest) || manifest.kind !== BACKUP_KIND) {
    add("BAD_MANIFEST", "不是 Life Atlas 备份清单");
    return problems;
  }
  if (!Number.isInteger(manifest.formatVersion) || manifest.formatVersion < 1) add("BAD_MANIFEST", "格式版本无效");
  else if (manifest.formatVersion > currentFormatVersion) add("FORMAT_TOO_NEW", "这个备份来自更新版本的 Life Atlas，请先升级应用");
  if (!isObject(manifest.workspace) || !Number.isInteger(manifest.workspace.schemaVersion) || manifest.workspace.schemaVersion < 1) add("BAD_MANIFEST", "工作区版本无效");
  else if (manifest.workspace.schemaVersion > currentSchemaVersion) add("SCHEMA_TOO_NEW", "这个备份来自更新版本的 Life Atlas，请先升级应用");
  if (!manifest.createdAt || !Number.isFinite(Date.parse(manifest.createdAt))) add("BAD_MANIFEST", "备份时间无效");
  if (!isObject(manifest.app) || manifest.app.name !== "Life Atlas" || typeof manifest.app.version !== "string" || !["desktop", "browser"].includes(manifest.app.platform)) add("BAD_MANIFEST", "应用信息无效");
  if (typeof manifest.workspace?.workspaceId !== "string" || !manifest.workspace.workspaceId) add("BAD_MANIFEST", "工作区标识缺失");
  if (!COUNT_COLLECTIONS.every((name) => isCount(manifest.workspace?.counts?.[name]))) add("BAD_MANIFEST", "工作区计数无效");
  if (!isObject(manifest.assets) || !isCount(manifest.assets.count) || !isCount(manifest.assets.totalBytes)) add("BAD_MANIFEST", "附件计数无效");
  if (!isObject(manifest.vault) || typeof manifest.vault.included !== "boolean") add("BAD_MANIFEST", "密钥库声明无效");
  else if (manifest.vault.included && (typeof manifest.vault.vaultId !== "string" || !manifest.vault.vaultId || manifest.vault.formatVersion !== 1 || !isCount(manifest.vault.itemCount))) add("BAD_VAULT", "密钥库声明无效");
  if (manifest.scope !== undefined && (manifest.scope !== WORKSPACE_RESCUE_SCOPE || manifest.app?.platform !== "desktop" || manifest.assets?.count !== 0 || manifest.vault?.included !== false)) add("BAD_MANIFEST", "救援文件范围无效");
  if (!Array.isArray(manifest.files)) add("BAD_MANIFEST", "文件清单缺失");
  else {
    const seen = new Set();
    const rescueFiles = manifest.scope === WORKSPACE_RESCUE_SCOPE ? new Set(["workspace/meta.json", "assets/index.json", ...requiredCollections(manifest.workspace?.schemaVersion).map((collection) => `workspace/entities/${collection}.jsonl`)]) : null;
    for (const file of manifest.files) {
      if (!isObject(file)) { add("BAD_MANIFEST", "文件描述无效"); continue; }
      if (!isSafeBackupPath(file.path)) add("BAD_PATH", "文件路径不安全", String(file.path ?? ""));
      if (file.path === "manifest.json" || seen.has(file.path)) add("BAD_MANIFEST", "清单包含重复文件或自身", file.path);
      if (!isCount(file.size) || !hashPattern.test(file.sha256 ?? "")) add("BAD_MANIFEST", "文件大小或校验值无效", file.path);
      if (rescueFiles && !rescueFiles.has(file.path)) add("BAD_MANIFEST", "文件超出救援范围", file.path);
      seen.add(file.path);
    }
  }
  return problems.slice(0, 50);
}

export function manifestSummary(manifest, { fileName = null, encrypted = false } = {}) {
  if (!manifest?.workspace || !manifest?.app) return null;
  return {
    createdAt: manifest.createdAt,
    platform: manifest.app.platform,
    appVersion: manifest.app.version,
    formatVersion: manifest.formatVersion,
    schemaVersion: manifest.workspace.schemaVersion,
    ...(manifest.scope ? { scope: manifest.scope } : {}),
    counts: manifest.workspace.counts,
    assets: manifest.assets,
    vault: { included: manifest.vault?.included === true, itemCount: manifest.vault?.included ? manifest.vault.itemCount : null },
    encrypted,
    fileName,
  };
}
