import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import { assertPhysicalPath, isPathInside } from "./storage/dataRoot.js";
import { StorageError } from "./storage/workspaceDb.js";
import { createLogger } from "./logger.js";
import { validateFolder as validateSetupFolder } from "./setup.js";
import { backupDate, sha256File, syncFile } from "./backup/files.js";
import { tMain } from "./i18n/index.js";

const DEFAULT_SKIP = ["runtime", ".lock"];

function inventory(dataRoot, { skip = DEFAULT_SKIP } = {}) {
  const root = assertPhysicalPath(dataRoot, { allowMissing: false });
  if (!fs.statSync(root).isDirectory()) throw new StorageError("E_INVALID_ARGUMENT", tMain("数据目录必须是文件夹"));
  const skipped = new Set(skip);
  if ([...skipped].some((name) => typeof name !== "string" || path.basename(name) !== name)) throw new StorageError("E_INVALID_ARGUMENT", tMain("复制排除项无效"));
  const files = [];
  const directories = [];
  const visit = (relative = "") => {
    const directory = assertPhysicalPath(path.join(root, relative), { root, allowMissing: false });
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (!relative && skipped.has(entry.name)) continue;
      const name = path.join(relative, entry.name);
      const target = assertPhysicalPath(path.join(root, name), { root, allowMissing: false });
      if (entry.isDirectory()) {
        directories.push(name);
        visit(name);
      } else if (entry.isFile()) files.push(name);
      else throw new StorageError("E_INVALID_ARGUMENT", tMain("数据目录中有链接或不可复制的文件，未切换目录"));
      if (fs.lstatSync(target).isSymbolicLink()) throw new StorageError("E_INVALID_ARGUMENT", tMain("数据目录中不能有链接"));
    }
  };
  visit();
  return { files, directories };
}

function roots(from, to) {
  const source = assertPhysicalPath(from, { allowMissing: false });
  const target = assertPhysicalPath(to);
  if (source === path.parse(source).root || target === path.parse(target).root || isPathInside(source, target, { allowRoot: true }) || isPathInside(target, source, { allowRoot: true })) throw new StorageError("E_INVALID_ARGUMENT", tMain("新旧数据目录不能相同或互相包含"));
  return { source, target };
}

function clearCopiedTarget(receipt) {
  const root = assertPhysicalPath(receipt.target, { allowMissing: false });
  for (const relative of [...receipt.files].reverse()) {
    const file = assertPhysicalPath(path.join(root, relative), { root });
    if (!isPathInside(root, file)) throw new StorageError("E_IO", tMain("复制清理路径超出新目录"));
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  for (const relative of [...receipt.directories].reverse()) {
    const directory = assertPhysicalPath(path.join(root, relative), { root });
    if (!isPathInside(root, directory)) throw new StorageError("E_IO", tMain("复制清理路径超出新目录"));
    if (fs.existsSync(directory)) fs.rmdirSync(directory);
  }
}

export async function copyDataRoot(from, to, { skip = DEFAULT_SKIP, injectFailure } = {}) {
  const { source, target } = roots(from, to);
  if (fs.existsSync(target) && (!fs.statSync(target).isDirectory() || fs.readdirSync(target).length)) throw new StorageError("E_INVALID_ARGUMENT", tMain("新数据目录必须为空"));
  const contents = inventory(source, { skip });
  fs.mkdirSync(target, { recursive: true });
  const receipt = { target, files: [], directories: [] };
  let injected = false;
  try {
    for (const relative of contents.directories) {
      fs.mkdirSync(assertPhysicalPath(path.join(target, relative), { root: target }));
      receipt.directories.push(relative);
    }
    for (const relative of contents.files) {
      const input = assertPhysicalPath(path.join(source, relative), { root: source, allowMissing: false });
      const output = assertPhysicalPath(path.join(target, relative), { root: target });
      const writer = fs.createWriteStream(output, { flags: "wx", highWaterMark: 64 * 1024 });
      await once(writer, "open");
      receipt.files.push(relative);
      await pipeline(fs.createReadStream(input, { highWaterMark: 64 * 1024 }), writer);
      syncFile(output);
      if (!injected) { injected = true; injectFailure?.("data-root-copy"); }
    }
    if (!injected) injectFailure?.("data-root-copy");
    return receipt;
  } catch (error) {
    try { clearCopiedTarget(receipt); } catch { throw new StorageError("E_IO", tMain("复制失败，未切换目录；新目录中的可恢复副本已保留")); }
    throw error?.code?.startsWith("E_") ? error : new StorageError("E_IO", tMain("复制数据目录失败，原目录未删除"));
  }
}

export async function verifyCopy(from, to, { skip = DEFAULT_SKIP } = {}) {
  const { source, target } = roots(from, to);
  const original = inventory(source, { skip });
  const copied = inventory(target, { skip });
  if (JSON.stringify(original) !== JSON.stringify(copied)) throw new StorageError("E_IO", tMain("复制后的文件和目录清单不一致"));
  for (const relative of original.files) {
    const before = await sha256File(assertPhysicalPath(path.join(source, relative), { root: source, allowMissing: false }));
    const after = await sha256File(assertPhysicalPath(path.join(target, relative), { root: target, allowMissing: false }));
    if (before.sha256 !== after.sha256 || before.size !== after.size) throw new StorageError("E_IO", tMain("复制后的文件校验失败：{relative}", { relative }));
  }
  return { fileCount: original.files.length };
}

function writeBootstrapAtomic(file, bytes) {
  const target = assertPhysicalPath(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = assertPhysicalPath(`${target}.tmp`, { root: path.dirname(target) });
  let created = false;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx");
    created = true;
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, target);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (created && fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function writeMigrationLog({ from, to, now }) {
  const logsDir = assertPhysicalPath(path.join(to, "runtime", "migration-logs"), { root: to });
  createLogger({ logsDir, now }).log("data-root.moved", { from, to });
}

function includeMigrationRuntime(receipt) {
  const runtime = assertPhysicalPath(path.join(receipt.target, "runtime"), { root: receipt.target });
  if (!fs.existsSync(runtime)) return;
  const contents = inventory(runtime, { skip: [] });
  receipt.files.push(...contents.files.map((name) => path.join("runtime", name)));
  receipt.directories.push("runtime", ...contents.directories.map((name) => path.join("runtime", name)));
}

export function createDataRootMoveService({ dataRoot, bootstrapFile, dialogs, getWindow = () => undefined, validateFolder = validateSetupFolder, requestFlush, lockVault, stopTimers, closeDatabases, reopenDatabases, restartTimers, now = Date.now, injectFailure, testHooksEnabled = false, relaunch = () => {}, exit = () => {}, writeBootstrap = writeBootstrapAtomic, writeMigrationLog: writeAudit = writeMigrationLog } = {}) {
  const source = assertPhysicalPath(dataRoot, { allowMissing: false });
  const bootstrap = assertPhysicalPath(bootstrapFile);
  let pending;
  const change = async () => {
    const selection = await dialogs.showOpenDialog(getWindow(), { title: tMain("更换 Life Atlas 数据目录"), properties: ["openDirectory", "createDirectory"] });
    if (selection?.canceled || !selection?.filePaths?.[0]) return { changed: false };
    let target;
    let validation;
    try {
      target = roots(source, selection.filePaths[0]).target;
      validation = validateFolder({ path: target });
      if (!(validation.level === "ok" && ["empty", "missing"].includes(validation.kind) || validation.level === "warning" && validation.kind === "sync-drive")) throw new StorageError("E_INVALID_ARGUMENT", validation.message || tMain("请选择空文件夹或新文件夹"));
    } catch (error) {
      await dialogs.showMessageBox(getWindow(), { type: "warning", message: tMain(error.message), buttons: [tMain("返回")], defaultId: 0, cancelId: 0 });
      return { changed: false };
    }
    const warning = validation.kind === "sync-drive" ? `\n\n${validation.message}` : "";
    const confirmed = await dialogs.showMessageBox(getWindow(), { type: "question", message: tMain("把数据复制到新的文件夹？"), detail: tMain("{target}\n\n复制完成后应用会重启并使用新文件夹。原来的文件夹会保留，确认无误后可以自己删除。{warning}", { target, warning }), buttons: [tMain("复制并重启"), tMain("取消")], defaultId: 0, cancelId: 1 });
    if (confirmed?.response !== 0) return { changed: false };
    const previousBootstrap = fs.existsSync(bootstrap) ? fs.readFileSync(assertPhysicalPath(bootstrap, { allowMissing: false })) : null;
    let pauseAttempted = false;
    let closeAttempted = false;
    let committed = false;
    let receipt;
    try {
      if (typeof requestFlush !== "function" || await requestFlush() === false) throw new StorageError("E_IO", tMain("保存尚未完成，未开始更换目录"));
      await lockVault?.();
      pauseAttempted = true;
      await stopTimers?.();
      closeAttempted = true;
      await closeDatabases?.();
      receipt = await copyDataRoot(source, target, { injectFailure });
      await verifyCopy(source, target);
      await writeBootstrap(bootstrap, Buffer.from(JSON.stringify({ dataRoot: target }), "utf8"));
      committed = true;
      await writeAudit({ from: source, to: target, now: backupDate(now).toISOString() });
      if (!testHooksEnabled) relaunch(target);
      exit(0);
      return { changed: true };
    } catch (error) {
      try {
        if (committed) {
          if (previousBootstrap === null) fs.unlinkSync(assertPhysicalPath(bootstrap, { allowMissing: false }));
          else writeBootstrapAtomic(bootstrap, previousBootstrap);
          committed = false;
        }
        if (receipt) { includeMigrationRuntime(receipt); clearCopiedTarget(receipt); }
        if (closeAttempted) await reopenDatabases?.();
        if (pauseAttempted) await restartTimers?.();
      } catch {
        throw new StorageError("E_IO", tMain("更换目录未完成，原目录和可恢复副本未删除；请重新打开应用检查"));
      }
      await dialogs.showMessageBox(getWindow(), { type: "error", message: tMain("更换数据目录失败：{error}。继续使用原来的文件夹。", { error: tMain(error.message || "无法复制或保存配置") }), buttons: [tMain("继续使用原目录")], defaultId: 0, cancelId: 0 });
      return { changed: false };
    }
  };
  return {
    changeDataRoot() {
      if (pending) return Promise.reject(new StorageError("E_CONFLICT", tMain("正在更换数据目录，请稍候")));
      pending = change().finally(() => { pending = undefined; });
      return pending;
    },
  };
}
