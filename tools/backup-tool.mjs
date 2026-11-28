import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { Writable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { assertPhysicalPath, isPathInside } from "../electron/main/storage/dataRoot.js";
import { StorageError } from "../electron/main/storage/workspaceDb.js";
import { verifyBackupFile } from "../electron/main/backup/inspection.js";
import { isEncryptedContainer, decryptContainerToFile } from "../electron/main/backup/encryptedContainer.js";
import { createStagingDirectory, removeScopedDirectory } from "../electron/main/backup/files.js";
import { openZipFileReader } from "../electron/main/backup/zipNode.js";
import { deriveKeyArgon2id, aesGcmDecrypt, aadPasswordWrap } from "../electron/main/vault/crypto.js";
import { openItem } from "../electron/main/vault/itemCodec.js";

const HELP = `Life Atlas 离线备份工具（普通 Node 24，无需 Electron）
verify <备份文件>                              校验完整性并输出 JSON 报告
extract <备份文件> <输出目录>                  导出 workspace/ 和 assets/，不导出密钥库明文
vault-decrypt <备份文件> <输出文件> --i-understand-plaintext
                                              明文导出全部密钥条目，输出目录必须已存在
--help                                        显示此帮助

密码输入不会回显。自动化可使用 LIFE_ATLAS_BACKUP_PASSWORD、LIFE_ATLAS_MASTER_PASSWORD。
环境变量设置可能会留在命令历史里，平时不要用；工具不会打印密码。
格式依据：docs/blueprint/04-备份与恢复规格.md 与 docs/blueprint/03-密钥库安全设计.md。
退出码：成功 0；校验发现问题 1；参数或密码错误 2。
`;

async function readSecret(name, prompt) {
  const supplied = process.env[name];
  if (supplied !== undefined) return supplied;
  const muted = new Writable({ write(chunk, encoding, callback) { callback(); } });
  muted.isTTY = Boolean(process.stdin.isTTY);
  muted.columns = process.stderr.columns ?? 80;
  process.stderr.write(prompt);
  const input = readline.createInterface({ input: process.stdin, output: muted, terminal: Boolean(process.stdin.isTTY) });
  try {
    return await new Promise((resolve, reject) => {
      let answered = false;
      input.once("close", () => { if (!answered) reject(new StorageError("E_INVALID_ARGUMENT", "未输入密码")); });
      input.question("", (value) => { answered = true; resolve(value); });
    });
  } finally { input.close(); muted.end(); process.stderr.write("\n"); }
}

async function plaintextSource(sourceFile, credential, temporaryRoot) {
  const descriptor = fs.openSync(sourceFile, "r");
  const first = Buffer.alloc(8);
  try { fs.readSync(descriptor, first, 0, 8, 0); } finally { fs.closeSync(descriptor); }
  if (!isEncryptedContainer(first)) return { file: sourceFile, encrypted: false };
  const directory = createStagingDirectory(temporaryRoot, ".staging-backup-tool-");
  const file = path.join(directory, "package.zip");
  try {
    const password = await credential("LIFE_ATLAS_BACKUP_PASSWORD", "请输入备份密码（不回显）：");
    await decryptContainerToFile({ sourceFile, targetFile: file, password, deriveKey: deriveKeyArgon2id });
    return { file, encrypted: true, directory };
  } catch (error) { removeScopedDirectory(directory, temporaryRoot); throw error; }
}

async function extractPackage(file, outputDirectory, manifest) {
  const root = assertPhysicalPath(path.resolve(outputDirectory));
  const existed = fs.existsSync(root);
  if (existed && (!fs.statSync(root).isDirectory() || fs.readdirSync(root).length)) throw new StorageError("E_INVALID_ARGUMENT", "输出目录必须是新目录或空目录");
  const files = manifest.files.filter((entry) => entry.path.startsWith("workspace/") || entry.path.startsWith("assets/"));
  const targets = files.map((entry) => ({ entry, target: assertPhysicalPath(path.join(root, ...entry.path.split("/")), { root }) }));
  const created = [];
  const directories = new Set();
  let reader;
  try {
    fs.mkdirSync(root, { recursive: true });
    reader = await openZipFileReader(file);
    for (const { entry, target } of targets) {
      let directory = path.dirname(target);
      while (isPathInside(root, directory) && !fs.existsSync(directory)) { directories.add(directory); directory = path.dirname(directory); }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const descriptor = fs.openSync(target, "wx");
      fs.closeSync(descriptor);
      created.push(target);
      const hash = createHash("sha256");
      let size = 0;
      const meter = new Transform({ transform(bytes, encoding, callback) { size += bytes.length; hash.update(bytes); callback(null, bytes); } });
      await pipeline(await reader.openStream(entry.path), meter, fs.createWriteStream(target, { flags: "r+" }));
      if (size !== entry.size || hash.digest("hex") !== entry.sha256) throw new StorageError("E_CORRUPT", "备份内容在校验后发生变化");
    }
    return { folder: root, fileCount: created.length };
  } catch (error) {
    for (const target of created.reverse()) { try { fs.unlinkSync(assertPhysicalPath(target, { root })); } catch {} }
    for (const directory of [...directories].sort((first, second) => second.length - first.length)) { try { fs.rmdirSync(assertPhysicalPath(directory, { root })); } catch {} }
    if (!existed) { try { fs.rmdirSync(root); } catch {} }
    throw error;
  } finally { reader?.close(); }
}

async function decryptVault(file, outputFile, credential) {
  const target = assertPhysicalPath(path.resolve(outputFile));
  const parent = assertPhysicalPath(path.dirname(target), { allowMissing: false });
  if (!fs.statSync(parent).isDirectory() || fs.existsSync(target)) throw new StorageError("E_INVALID_ARGUMENT", "输出目录必须已存在，输出文件不能已存在");
  const reader = await openZipFileReader(file);
  let kek;
  let dek;
  let output;
  let created = false;
  let complete = false;
  try {
    const bytes = await reader.read("vault/vault.json");
    if (!bytes) throw new StorageError("E_INVALID_ARGUMENT", "备份中没有密钥库");
    const vault = JSON.parse(Buffer.from(bytes).toString("utf8"));
    const password = await credential("LIFE_ATLAS_MASTER_PASSWORD", "请输入密钥库主密码（不回显）：");
    kek = await deriveKeyArgon2id(password, Buffer.from(vault.header.kdf.saltB64, "base64"), vault.header.kdf);
    try { dek = aesGcmDecrypt(kek, Buffer.from(vault.header.wraps.password.blobB64, "base64"), aadPasswordWrap(vault.header.vaultId, vault.header.kdf)); }
    catch { throw new StorageError("E_BAD_PASSWORD", "主密码错误或备份已损坏"); }
    if (dek.length !== 32) throw new StorageError("E_BAD_PASSWORD", "主密码错误或备份已损坏");
    const items = vault.items.map((entry) => openItem(dek, vault.header.vaultId, entry.id, Buffer.from(entry.blobB64, "base64")));
    output = Buffer.from(JSON.stringify(items, null, 2), "utf8");
    const descriptor = fs.openSync(target, "wx", 0o600);
    created = true;
    try { fs.writeFileSync(descriptor, output); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    complete = true;
    return { filePath: target, itemCount: items.length };
  } finally { reader.close(); kek?.fill(0); dek?.fill(0); output?.fill(0); if (created && !complete && fs.existsSync(target)) fs.unlinkSync(assertPhysicalPath(target, { root: parent })); }
}

export async function runBackupTool(args, { stdout = process.stdout, stderr = process.stderr, credential = readSecret, temporaryRoot = os.tmpdir() } = {}) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) { stdout.write(HELP); return 0; }
  const command = args[0];
  if (!["verify", "extract", "vault-decrypt"].includes(command) || command === "verify" && args.length !== 2 || command === "extract" && args.length !== 3 || command === "vault-decrypt" && (args.length !== 4 || args[3] !== "--i-understand-plaintext")) { stderr.write("参数错误。使用 --help 查看说明；vault-decrypt 必须显式确认明文风险。\n"); return 2; }
  if (command === "vault-decrypt") stderr.write("警告：输出文件是明文密码，用完请立即安全删除。\n");
  let source;
  let temporary;
  try {
    const file = assertPhysicalPath(path.resolve(args[1]), { allowMissing: false });
    temporary = assertPhysicalPath(temporaryRoot);
    source = await plaintextSource(file, credential, temporary);
    const report = await verifyBackupFile(source.file, { fileName: path.basename(file), encrypted: source.encrypted });
    if (command === "verify" || !report.ok) stdout.write(`${JSON.stringify({ ok: report.ok, problems: report.problems, summary: report.summary }, null, 2)}\n`);
    if (!report.ok) return 1;
    if (command === "extract") stdout.write(`${JSON.stringify(await extractPackage(source.file, args[2], report.manifest))}\n`);
    if (command === "vault-decrypt") {
      if (!report.manifest.vault.included) throw new StorageError("E_INVALID_ARGUMENT", "备份中没有密钥库");
      stdout.write(`${JSON.stringify(await decryptVault(source.file, args[2], credential))}\n`);
    }
    return 0;
  } catch (error) {
    if (error?.code === "E_CORRUPT") {
      stdout.write(`${JSON.stringify({ ok: false, problems: [{ code: "CORRUPT", path: null, detail: "备份内容已损坏或在校验后发生变化" }], summary: null }, null, 2)}\n`);
      return 1;
    }
    stderr.write(error?.code === "E_BAD_PASSWORD" ? "密码错误或备份已损坏。\n" : "参数无效、文件无法读取或操作未完成。\n");
    return 2;
  }
  finally { if (source?.directory) removeScopedDirectory(source.directory, temporary); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) runBackupTool(process.argv.slice(2)).then((code) => { process.exitCode = code; }, () => { process.stderr.write("备份工具未完成。\n"); process.exitCode = 2; });
