import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { verifyPackage } from "../../../src/backup/verify.js";
import { CURRENT_SCHEMA_VERSION } from "../../../src/persistence/migrations.js";
import { parseJsonBytes } from "../../../src/backup/serialize.js";
import { assertPhysicalPath } from "../storage/dataRoot.js";
import { StorageError } from "../storage/workspaceDb.js";
import { deriveKeyArgon2id } from "../vault/crypto.js";
import { validateVaultHeader } from "../vault/index.js";
import { validateSettingsPatch } from "../vault/itemModel.js";
import { isEncryptedContainer, decryptContainerToFile } from "./encryptedContainer.js";
import { openZipFileReader } from "./zipNode.js";
import { backupDate, createStagingDirectory, removeScopedDirectory, sha256File } from "./files.js";
import { ASSISTANT_ARCHIVE_PATH, validateAssistantArchive } from "./assistantArchive.js";
import { tMain } from "../i18n/index.js";

const TTL_MS = 600000;
const detailTemplates = [
  [/^(?<file>.+):(?<line>\d+) 不是有效 JSON$/su, "{file}:{line} 不是有效 JSON"],
  [/^(?<file>.+):(?<line>\d+) 缺少字符串 id$/su, "{file}:{line} 缺少字符串 id"],
  [/^(?<file>.+):(?<line>\d+) 含重复 id$/su, "{file}:{line} 含重复 id"],
  [/^工作区集合顺序包含未知集合 (?<collection>.*)$/su, "工作区集合顺序包含未知集合 {collection}"],
  [/^工作区集合顺序缺少 (?<collection>.*)$/su, "工作区集合顺序缺少 {collection}"],
  [/^集合 (?<collection>.*) 的顺序 ID 无效$/su, "集合 {collection} 的顺序 ID 无效"],
  [/^集合 (?<collection>.*) 的顺序包含重复 ID$/su, "集合 {collection} 的顺序包含重复 ID"],
  [/^集合 (?<collection>.*) 的顺序与实体数量不符$/su, "集合 {collection} 的顺序与实体数量不符"],
  [/^集合 (?<collection>.*) 的顺序包含未知 ID$/su, "集合 {collection} 的顺序包含未知 ID"],
];
function localizeDetail(detail) {
  for (const [pattern, source] of detailTemplates) {
    const match = pattern.exec(detail);
    if (match) return tMain(source, match.groups);
  }
  return tMain(detail);
}
const publicProblems = (problems) => problems.map((problem) => ({ ...problem, detail: localizeDetail(problem.detail) }));
const publicReport = ({ ok, problems, summary }) => ({ ok, problems: publicProblems(problems), summary });

export async function verifyBackupFile(filePath, { currentSchemaVersion = CURRENT_SCHEMA_VERSION, fileName = path.basename(filePath), encrypted = false } = {}) {
  let reader;
  try { reader = await openZipFileReader(filePath); }
  catch { return { ok: false, problems: [{ code: "NOT_ZIP", path: null, detail: "无法读取 ZIP 备份文件" }], summary: null, manifest: null }; }
  try {
    const checkedFiles = new Map();
    const report = await verifyPackage({
      ...reader,
      async read(entry) {
        const bytes = await reader.read(entry);
        if (entry === ASSISTANT_ARCHIVE_PATH || entry === "assets/index.json") checkedFiles.set(entry, bytes);
        return bytes;
      },
    }, { currentSchemaVersion, fileName, encrypted });
    if (report.ok && report.manifest.files.some(({ path }) => path === ASSISTANT_ARCHIVE_PATH)) {
      try {
        if (report.summary.platform !== "desktop") throw new Error("invalid platform");
        const archive = parseJsonBytes(checkedFiles.get(ASSISTANT_ARCHIVE_PATH));
        const assets = parseJsonBytes(checkedFiles.get("assets/index.json"));
        validateAssistantArchive(archive, assets);
      } catch {
        report.ok = false;
        report.problems = [{ code: "BAD_ASSISTANT", path: ASSISTANT_ARCHIVE_PATH, detail: "备份中的助手对话或附件索引无效" }, ...report.problems].slice(0, 50);
      }
    }
    if (report.ok && report.manifest.vault.included) {
      try {
        const vault = parseJsonBytes(await reader.read("vault/vault.json"));
        if (!validateVaultHeader(vault.header)) throw new Error("invalid vault header");
        validateSettingsPatch(vault.state.settings);
        for (const item of vault.items) if (Buffer.from(item.blobB64, "base64").toString("base64") !== item.blobB64) throw new Error("invalid vault ciphertext");
      } catch {
        report.ok = false;
        report.problems.push({ code: "BAD_VAULT", path: "vault/vault.json", detail: "密钥库头部、设置或密文格式无效" });
        report.problems = report.problems.slice(0, 50);
      }
    }
    return report;
  } finally { reader.close(); }
}

export function createBackupInspector({ dataRoot, currentSchemaVersion = CURRENT_SCHEMA_VERSION, now = Date.now, deriveKey = deriveKeyArgon2id, timers = globalThis } = {}) {
  const tokens = new Map();
  const requests = new Map();
  let pruneTimer;
  const time = (override) => backupDate(override ?? now).getTime();
  const discard = (record) => {
    if (record?.stagingDirectory) removeScopedDirectory(record.stagingDirectory, record.stagingRoot);
  };
  const prune = (override) => {
    const current = time(override);
    for (const registry of [tokens, requests]) for (const [id, record] of registry) if (record.expiresAt <= current) { registry.delete(id); discard(record); }
  };
  const inspected = async (filePath, options = {}) => {
    prune(options.now);
    const file = assertPhysicalPath(filePath, { allowMissing: false });
    const fileName = options.fileName ?? path.basename(file);
    const fingerprint = await sha256File(file);
    const report = await verifyBackupFile(file, { currentSchemaVersion: options.currentSchemaVersion ?? currentSchemaVersion, fileName, encrypted: options.encrypted === true });
    if (options.verifyOnly) return { report: publicReport(report) };
    if (!report.ok) return { problems: publicProblems(report.problems), summary: report.summary };
    const token = `restore_${randomBytes(16).toString("hex")}`;
    tokens.set(token, { filePath: file, fileName, fingerprint, report, expiresAt: time(options.now) + TTL_MS, stagingDirectory: options.stagingDirectory, stagingRoot: options.stagingRoot });
    return { token, summary: report.summary };
  };
  const inspectFile = async (filePath, options = {}) => {
    prune(options.now);
    const file = assertPhysicalPath(filePath, { allowMissing: false });
    const descriptor = fs.openSync(file, "r");
    const first = Buffer.alloc(8);
    try { fs.readSync(descriptor, first, 0, 8, 0); } finally { fs.closeSync(descriptor); }
    if (!isEncryptedContainer(first)) return inspected(file, options);
    const inspectId = `inspect_${randomBytes(16).toString("hex")}`;
    requests.set(inspectId, { filePath: file, fileName: path.basename(file), fingerprint: await sha256File(file), expiresAt: time(options.now) + TTL_MS, verifyOnly: options.verifyOnly === true });
    return { needsPassword: true, inspectId };
  };
  const withPassword = async ({ inspectId, password }, options = {}) => {
    prune(options.now);
    const record = requests.get(inspectId);
    if (!record || record.verifyOnly !== (options.verifyOnly === true)) throw new StorageError("E_INVALID_ARGUMENT", "备份检查已过期，请重新选择文件");
    if (typeof password !== "string") throw new StorageError("E_INVALID_ARGUMENT", "请输入备份密码");
    const fingerprint = await sha256File(record.filePath);
    if (fingerprint.sha256 !== record.fingerprint.sha256 || fingerprint.size !== record.fingerprint.size) throw new StorageError("E_CORRUPT", "备份文件在选择后发生变化，请重新选择");
    const root = assertPhysicalPath(options.dataRoot ?? dataRoot);
    const stagingDirectory = createStagingDirectory(root, ".staging-import-");
    const filePath = path.join(stagingDirectory, "package.zip");
    try {
      await decryptContainerToFile({ sourceFile: record.filePath, targetFile: filePath, password, deriveKey });
      const result = await inspected(filePath, { ...options, fileName: record.fileName, encrypted: true, stagingDirectory, stagingRoot: root });
      requests.delete(inspectId);
      if (options.verifyOnly || !result.token) removeScopedDirectory(stagingDirectory, root);
      return result;
    } catch (error) { removeScopedDirectory(stagingDirectory, root); throw error; }
  };
  return {
    inspectFile,
    inspectWithPassword: (args, options) => withPassword(args, options),
    verifyWithPassword: (args, options) => withPassword(args, { ...options, verifyOnly: true }),
    consumeToken(token, options = {}) {
      prune(options.now);
      const record = tokens.get(token);
      if (!record) throw new StorageError("E_INVALID_ARGUMENT", "恢复令牌已使用或过期，请重新选择备份");
      tokens.delete(token);
      return record;
    },
    release: discard,
    prune,
    start() { if (pruneTimer === undefined) { pruneTimer = timers.setInterval(() => prune(), 60000); pruneTimer?.unref?.(); } },
    stop() {
      if (pruneTimer !== undefined) timers.clearInterval(pruneTimer);
      pruneTimer = undefined;
      for (const record of tokens.values()) discard(record);
      tokens.clear();
      requests.clear();
    },
  };
}
