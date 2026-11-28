import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export class DataRootError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DataRootError";
    this.code = code;
  }
}

export function assertAbsolutePath(value) {
  if (typeof value !== "string" || !value || /[\0-\x1f]/.test(value) || !path.isAbsolute(value)) {
    throw new DataRootError("E_INVALID_ARGUMENT", "必须使用绝对路径");
  }
  const absolute = path.resolve(value);
  const parsed = path.parse(absolute);
  const segments = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  if (segments.some((segment) => /[:<>"|?*]/.test(segment) || /[ .]$/.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) {
    throw new DataRootError("E_INVALID_ARGUMENT", "路径包含不安全的名称");
  }
  return absolute;
}

export function isPathInside(root, target, { allowRoot = false } = {}) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (allowRoot && relative === "") || Boolean(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function assertPhysicalPath(value, { root, allowMissing = true } = {}) {
  const absolute = assertAbsolutePath(value);
  if (root && !isPathInside(assertAbsolutePath(root), absolute, { allowRoot: true })) {
    throw new DataRootError("E_INVALID_ARGUMENT", "路径超出允许的目录");
  }
  const parsed = path.parse(absolute);
  let current = parsed.root;
  const segments = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT" && allowMissing) return absolute;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new DataRootError("E_INVALID_ARGUMENT", "不能使用符号链接或 junction 路径");
    if (current !== absolute && !stat.isDirectory()) throw new DataRootError("E_INVALID_ARGUMENT", "路径的父级不是目录");
  }
  return absolute;
}

function readJson(filePath) {
  assertPhysicalPath(filePath, { allowMissing: false });
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeExclusive(filePath, value) {
  const descriptor = fs.openSync(filePath, "wx");
  try {
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2), "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

export function resolveDataRoot({ env = process.env, bootstrapFile, flavor, repoRoot }) {
  if (env.LIFE_ATLAS_DATA_ROOT) return { dataRoot: assertPhysicalPath(env.LIFE_ATLAS_DATA_ROOT), source: "env" };
  if (bootstrapFile && fs.existsSync(bootstrapFile)) {
    let bootstrap;
    try {
      bootstrap = readJson(bootstrapFile);
    } catch {
      throw new DataRootError("E_CORRUPT", "数据目录配置无法读取");
    }
    if (bootstrap?.dataRoot) return { dataRoot: assertPhysicalPath(bootstrap.dataRoot), source: "bootstrap" };
  }
  if (flavor === "dev") return { dataRoot: assertPhysicalPath(path.join(assertAbsolutePath(repoRoot), ".devdata")), source: "dev-default" };
  return { dataRoot: null, source: null };
}

export function bootstrapFilePath({ appDataDir, getAppDataDir, env = process.env, testHooksEnabled }) {
  let directory;
  if (testHooksEnabled && env.LIFE_ATLAS_BOOTSTRAP_DIR) {
    directory = assertPhysicalPath(env.LIFE_ATLAS_BOOTSTRAP_DIR);
  } else if (env.LIFE_ATLAS_DATA_ROOT) {
    const dataRoot = assertPhysicalPath(env.LIFE_ATLAS_DATA_ROOT);
    directory = assertPhysicalPath(path.join(dataRoot, "runtime", "bootstrap"), { root: dataRoot });
  } else {
    directory = path.join(assertAbsolutePath(appDataDir ?? getAppDataDir?.()), "Life Atlas");
  }
  return path.join(directory, "bootstrap.json");
}

export function ensureDataRootMarker(dataRoot, { appVersion, now }) {
  const directory = assertPhysicalPath(dataRoot);
  if (directory === path.parse(directory).root) throw new DataRootError("E_INVALID_ARGUMENT", "数据目录不能是磁盘根目录");
  const existed = fs.existsSync(directory);
  if (existed && !fs.statSync(directory).isDirectory()) throw new DataRootError("E_INVALID_ARGUMENT", "数据目录不可用");
  fs.mkdirSync(directory, { recursive: true });
  const markerFile = path.join(directory, "life-atlas.root.json");
  if (!fs.existsSync(markerFile)) {
    if (existed && fs.readdirSync(directory).length) throw new DataRootError("E_INVALID_ARGUMENT", "目录不是空目录，也不是 Life Atlas 数据目录");
    const marker = { kind: "life-atlas-data-root", formatVersion: 1, createdAt: now, createdByAppVersion: appVersion };
    try {
      writeExclusive(markerFile, marker);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  let marker;
  try {
    marker = readJson(markerFile);
  } catch {
    throw new DataRootError("E_CORRUPT", "数据目录标记无法读取");
  }
  if (marker?.kind !== "life-atlas-data-root" || marker.formatVersion !== 1) throw new DataRootError("E_INVALID_ARGUMENT", "目录不属于 Life Atlas");
  return marker;
}

export function acquireDataRootLock(dataRoot, { pid, appVersion, now, isProcessAlive }) {
  const directory = assertPhysicalPath(dataRoot, { allowMissing: false });
  const lockFile = path.join(directory, ".lock");
  const record = { pid, startedAt: now, appVersion };
  let staleRecovered = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      writeExclusive(lockFile, record);
      return staleRecovered ? { ok: true, staleRecovered: true } : { ok: true };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    assertPhysicalPath(lockFile, { root: directory, allowMissing: false });
    let existing;
    try {
      existing = readJson(lockFile);
    } catch (error) {
      if (error instanceof DataRootError) throw error;
      existing = null;
    }
    if (existing?.pid === pid) return { ok: true };
    if (Number.isInteger(existing?.pid) && existing.pid > 0 && isProcessAlive(existing.pid)) return { ok: false, heldByPid: existing.pid };
    fs.unlinkSync(lockFile);
    staleRecovered = true;
  }
  throw new DataRootError("E_IO", "无法取得数据目录锁");
}

export function releaseDataRootLock(dataRoot, pid) {
  const directory = assertPhysicalPath(dataRoot, { allowMissing: false });
  const lockFile = path.join(directory, ".lock");
  if (!fs.existsSync(lockFile)) return false;
  const existing = readJson(lockFile);
  if (existing.pid !== pid) return false;
  fs.unlinkSync(lockFile);
  return true;
}

export function isSyncDrivePath(value) {
  return typeof value === "string" && /onedrive|dropbox|google drive|icloud|坚果云/i.test(value);
}

const renameWait = new Int32Array(new SharedArrayBuffer(4));
const renameRetryDelays = [5, 10, 20];

export function writeAtomicJson(filePath, value) {
  const absolute = assertPhysicalPath(filePath);
  const directory = path.dirname(absolute);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${absolute}.tmp-${randomBytes(8).toString("hex")}`;
  try {
    writeExclusive(temporary, value);
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(temporary, absolute);
        return;
      } catch (error) {
        // Windows can briefly deny replacement while another handle is closing.
        const delay = renameRetryDelays[attempt];
        if (process.platform !== "win32" || delay === undefined || !["EPERM", "EBUSY"].includes(error.code)) throw error;
        Atomics.wait(renameWait, 0, 0, delay);
        assertPhysicalPath(temporary, { allowMissing: false });
        assertPhysicalPath(absolute);
      }
    }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
