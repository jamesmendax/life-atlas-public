import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { crc32 } from "node:zlib";
import { encodeRoadSections, MAX_ROUTE_POINTS, VALID_POINT } from "../../src/domain/tripRoutes.js";
import { isOfflineTripCoordinates, isRd5TileName, planRd5Corridor, rd5TilesAtPoints } from "../../src/domain/tripOfflineRegions.js";

export const TRIP_OFFLINE_RUNTIME_VERSION = "1.7.10";
export const TRIP_OFFLINE_RUNTIME_URL = `https://github.com/abrensch/brouter/releases/download/v${TRIP_OFFLINE_RUNTIME_VERSION}/brouter-${TRIP_OFFLINE_RUNTIME_VERSION}.zip`;
export const TRIP_OFFLINE_SEGMENTS_URL = "https://brouter.de/brouter/segments4/";
export const TRIP_OFFLINE_JAVA_URL = "https://adoptium.net/temurin/releases/?version=17&os=windows";
export const TRIP_OFFLINE_PROFILES = Object.freeze({ drive: "car-fast", bike: "trekking", walk: "hiking-mountain" });

const JAR = `brouter-${TRIP_OFFLINE_RUNTIME_VERSION}-all.jar`;
// Hashes from the verified official 1.7.10 standalone release ZIP.
const RUNTIME_HASHES = Object.freeze({
  [JAR]: "93e9821640093cde82ed470ac8c08ab84fc7ae3b570e30c9ab41d686c7af1d4a",
  "profiles2/lookups.dat": "bf8fc3b2c052b7204e9c5a8d78e4d6ab6b125d3236a943f34583b838c477f419",
  "profiles2/car-fast.brf": "cbcaa6e795e7f1f0b2299569169b34b7821438caa157bf4b6b44d0a8cb2f1cef",
  "profiles2/trekking.brf": "00241f71fe9251d3e38571a4eb296352c7c2451d86eb34e656123820c27b315e",
  "profiles2/hiking-mountain.brf": "691299a5018726e58cd5a97a5f1f96deaa88c6780c9fb8d80d4a2454e58d29f1",
});
const SIGNED_JAVA_FILES = ["bin/java.exe", "bin/jli.dll", "bin/java.dll", "bin/zip.dll", "bin/jimage.dll", "bin/server/jvm.dll"];
const MODULES = "lib/modules";
const PORTABLE_JAVA_MODULES = "9e54569bf517b4e963e15bf2475f5e637a97b7db7890e840cafb25dbef9e875d";
// Eclipse Temurin 17.0.19+10 Windows x64 JDK effective runtime tree.
const PORTABLE_JAVA_TREE = "6260501d49c3e440a4e5db8a142f18c4cd15223e5a578122a40736b0083da6bc";
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const LOOKUP_VERSION = 11;
const MAX_SEGMENT_BYTES = 256 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 640 * 1024 * 1024;
const MAX_DOWNLOAD_TILES = 32;
const MAX_RAW_BYTES = 32 * 1024 * 1024;
const MAX_ROUTE_MS = 180_000;
const execute = promisify(execFile);

function error(code, message, details) {
  return Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
}

function localAbsolute(value) {
  return typeof value === "string" && path.isAbsolute(value) && (process.platform !== "win32" || /^[a-z]:[/\\]/iu.test(value));
}

function inside(root, file) {
  const relative = path.relative(root, file);
  return Boolean(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function resolvedSelection(selected) {
  if (!localAbsolute(selected)) throw error("E_INVALID_ARGUMENT", "请选择本机文件夹");
  const root = await fs.realpath(selected).catch(() => null);
  if (!localAbsolute(root) || !(await fs.stat(root)).isDirectory()) throw error("E_NOT_FOUND", "找不到所选文件夹");
  return root;
}

async function isScopedFile(root, file) {
  try {
    return (await fs.lstat(file)).isFile() && inside(root, await fs.realpath(file));
  } catch { return false; }
}

async function isScopedDirectory(root, directory) {
  try {
    return (await fs.lstat(directory)).isDirectory() && inside(root, await fs.realpath(directory));
  } catch { return false; }
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}

async function verifyBRouter(directory) {
  return (await Promise.all(Object.entries(RUNTIME_HASHES).map(async ([name, hash]) => {
    const file = path.join(directory, name);
    return await isScopedFile(directory, file) && await sha256(file).catch(() => null) === hash;
  }))).every(Boolean);
}

function childEnvironment(cwd) {
  const env = { TMP: cwd, TEMP: cwd };
  for (const name of ["SystemRoot", "windir", "SystemDrive"]) if (process.env[name]) env[name] = process.env[name];
  return env;
}

async function javaIdentities(directory) {
  const names = [...SIGNED_JAVA_FILES, MODULES];
  const files = names.map(name => path.join(directory, name));
  if (!(await Promise.all(files.map(file => isScopedFile(directory, file)))).every(Boolean)) return null;
  return Object.fromEntries(await Promise.all(files.map(async (file, index) => [names[index], await sha256(file)])));
}

async function isSystemJava(directory) {
  const roots = [...new Set([process.env.ProgramFiles, process.env.ProgramW6432, process.env["ProgramFiles(x86)"]])];
  return (await Promise.all(roots.filter(localAbsolute).map(async root => {
    const relative = path.relative(await fs.realpath(root).catch(() => root), directory);
    return /^(?:Eclipse Adoptium|Microsoft)[\\/](?:jdk|jre)-?\d[^\\/]*$/iu.test(relative);
  }))).some(Boolean);
}

async function trustedJavaLayout(directory, hashes) {
  if ((await fs.realpath(directory).catch(() => null)) !== directory) return false;
  if (await isSystemJava(directory)) return true;
  if (hashes[MODULES] !== PORTABLE_JAVA_MODULES) return false;
  const tree = createHash("sha256");
  async function add(name) {
    const file = path.join(directory, name);
    const info = await fs.lstat(file);
    if (info.isDirectory()) {
      if (!await isScopedDirectory(directory, file)) throw new Error("Unscoped Java directory");
      for (const entry of (await fs.readdir(file)).sort()) await add(`${name}/${entry}`);
    } else {
      if (!await isScopedFile(directory, file)) throw new Error("Unscoped Java file");
      tree.update(`${name}\0${await sha256(file)}\n`);
    }
  }
  for (const name of ["bin", "conf", "lib", "release"]) await add(name);
  return tree.digest("hex") === PORTABLE_JAVA_TREE;
}

async function verifyJavaPublisher(directory, cwd) {
  const windows = process.env.SystemRoot;
  if (process.platform !== "win32" || !localAbsolute(windows)) throw error("E_FORBIDDEN", "此离线路网运行时需要 Windows");
  const powershell = path.join(windows, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const signatureScript = [
    "$ErrorActionPreference = 'Stop'",
    "$publisher = $null",
    `foreach ($name in @(${SIGNED_JAVA_FILES.map(name => `'${name}'`).join(",")})) {`,
    "$cert = Get-AuthenticodeSignature -LiteralPath ([IO.Path]::Combine($env:LIFE_ATLAS_JAVA_CHECK, $name))",
    "if ($cert.Status -ne 'Valid') { exit 2 }",
    "$subject = $cert.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)",
    "if ($subject -notin @('Eclipse.org Foundation, Inc.', 'Microsoft Corporation')) { exit 2 }",
    "if ($publisher -and $publisher -ne $subject) { exit 2 }",
    "$publisher = $subject",
    "}",
    "[Console]::Write($publisher)",
  ].join("\n");
  return (await execute(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", signatureScript], {
    shell: false, cwd, windowsHide: true, timeout: 20000, maxBuffer: 32 * 1024,
    env: { ...childEnvironment(cwd), LIFE_ATLAS_JAVA_CHECK: directory },
  })).stdout.trim();
}

async function segmentHeader(file) {
  const handle = await fs.open(file, "r");
  try {
    const { size } = await handle.stat();
    if (size < 312 || size > MAX_SEGMENT_BYTES) return false;
    const header = Buffer.alloc(200);
    if ((await handle.read(header, 0, header.length, 0)).bytesRead !== 200 || header.readUInt16BE(0) !== LOOKUP_VERSION) return false;
    let previousOffset = 200;
    for (let i = 0; i < header.length; i += 8) {
      const offset = header.readUIntBE(i + 2, 6);
      if (offset < previousOffset || offset + 112 > size) return false;
      previousOffset = offset;
    }
    const footer = Buffer.alloc(12);
    if ((await handle.read(footer, 0, footer.length, previousOffset)).bytesRead !== footer.length) return false;
    const checksum = (~crc32(header)) >>> 0;
    const expected = footer.readUInt32BE(8);
    return checksum === expected || ((checksum ^ 2) >>> 0) === expected;
  } finally { await handle.close(); }
}

async function installSegment(source, target) {
  if (!await segmentHeader(source).catch(() => false)) throw error("E_IO", `路网分片不完整或与本版本不兼容（${path.basename(target)}）`);
  await fs.rename(source, target);
}

function parseTrack(bytes, maxPoints) {
  const feature = JSON.parse(bytes.toString("utf8")).features?.find(item => item.geometry?.type === "LineString");
  const props = feature?.properties;
  const length = Number(props?.["track-length"]), duration = Number(props?.["total-time"]);
  const coordinates = feature?.geometry.coordinates;
  if (props?.creator !== `BRouter-${TRIP_OFFLINE_RUNTIME_VERSION}` || !Number.isFinite(length) || length < 0
      || !Number.isFinite(duration) || duration < 0 || !Array.isArray(coordinates) || !coordinates.length
      || (coordinates.length === 1 && (length !== 0 || duration !== 0))) {
    throw error("E_IO", "离线引擎返回的道路轨迹不完整");
  }
  if (coordinates.length > maxPoints) throw error("E_TOO_LARGE", "离线路线轨迹超过 100000 点，请拆分行程后重试");
  const points = coordinates.map(([lon, lat]) => [lat, lon]);
  if (!points.every(VALID_POINT)) throw error("E_IO", "离线引擎返回的道路坐标无效");
  if (points.length === 1) points.push(points[0]);
  const sections = encodeRoadSections(points);
  if (!sections.length) throw error("E_IO", "离线引擎返回的道路轨迹为空");
  return {
    leg: { meters: Math.round(length), seconds: Math.round(duration), ...(sections.length === 1 ? { line: sections[0] } : { sections }) },
    points,
    rawPointCount: coordinates.length,
    rawSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function corridor(coords) {
  if (!isOfflineTripCoordinates(coords)) throw error("E_INVALID_ARGUMENT", "离线路线需要至少两个有效的 WGS84 站点");
  return planRd5Corridor(coords);
}

export function createTripOfflineRouter({ dataDir, fetchSegment = globalThis.fetch }) {
  if (!localAbsolute(dataDir)) throw new TypeError("Offline route data needs a local absolute path");
  const shutdown = new AbortController();
  let layout;
  let busy = false;
  let verifiedJava;

  async function prepareLayout() {
    await fs.mkdir(dataDir, { recursive: true });
    const root = await fs.realpath(dataDir);
    if (!localAbsolute(root)) throw error("E_IO", "离线路网需要本机存储");
    const segmentDir = path.join(root, "segments4"), runtimeDir = path.join(root, `brouter-${TRIP_OFFLINE_RUNTIME_VERSION}`);
    await fs.mkdir(segmentDir, { recursive: true });
    if (!await isScopedDirectory(root, segmentDir)) throw error("E_IO", "离线路网目录无法使用");
    for (const name of await fs.readdir(root)) {
      if (!/^(?:runtime-stage|java-check|segments-import|segments-download|route)-[A-Za-z0-9]{6}$/u.test(name)) continue;
      const staged = path.join(root, name);
      if (await isScopedDirectory(root, staged)) await fs.rm(staged, { recursive: true, force: true }).catch(() => {});
    }
    return { root, segmentDir, runtimeDir, javaFile: path.join(root, "java.json") };
  }

  function getLayout() {
    layout ??= prepareLayout().catch(cause => { layout = undefined; throw cause; });
    return layout;
  }

  async function exclusive(action) {
    if (shutdown.signal.aborted) throw error("E_CANCELLED", "离线路网正在关闭");
    if (busy) throw error("E_THROTTLED", "正在处理另一项离线路线任务，请稍后重试");
    busy = true;
    try { return await action(await getLayout()); }
    catch (cause) {
      if (/^E_/u.test(cause.code ?? "")) throw cause;
      throw error("E_IO", "无法完成离线路线任务，请检查本机文件或稍后重试");
    } finally { busy = false; }
  }

  async function readJava({ root, javaFile }) {
    if (!await isScopedFile(root, javaFile)) return null;
    try {
      const { size } = await fs.stat(javaFile);
      if (size > 8192) return null;
      const settings = JSON.parse(await fs.readFile(javaFile, "utf8"));
      if (!localAbsolute(settings.home) || ![...SIGNED_JAVA_FILES, MODULES].every(name => HASH_PATTERN.test(settings.hashes?.[name]))) return null;
      if (verifiedJava?.record === JSON.stringify(settings)) {
        // Content identity is rechecked before every execution.
        return await isScopedFile(settings.home, path.join(settings.home, SIGNED_JAVA_FILES[0])) ? settings : null;
      }
      const hashes = await javaIdentities(settings.home);
      if (!hashes || Object.entries(hashes).some(([name, hash]) => settings.hashes[name] !== hash)) return null;
      if (!await trustedJavaLayout(settings.home, hashes)) return null;
      verifiedJava = { record: JSON.stringify(settings) };
      return settings;
    } catch { return null; }
  }

  async function readStatus(dirs, requiredTiles, recommendedTiles = []) {
    const { segmentDir, runtimeDir, root } = dirs;
    const [entries, configured, java] = await Promise.all([
      fs.readdir(segmentDir, { withFileTypes: true }),
      isScopedDirectory(root, runtimeDir).then(scoped => scoped && verifyBRouter(runtimeDir)),
      readJava(dirs),
    ]);
    const installedTiles = [];
    for (const entry of entries) {
      if (entry.isFile() && isRd5TileName(entry.name) && await segmentHeader(path.join(segmentDir, entry.name)).catch(() => false)) installedTiles.push(entry.name);
    }
    installedTiles.sort();
    const installedSet = new Set(installedTiles);
    const missingTiles = requiredTiles.filter(tile => !installedSet.has(tile));
    const missingRecommendedTiles = recommendedTiles.filter(tile => !installedSet.has(tile));
    return {
      ready: Boolean(configured && java && installedTiles.length && !missingTiles.length), configured, javaReady: Boolean(java),
      version: TRIP_OFFLINE_RUNTIME_VERSION, profiles: TRIP_OFFLINE_PROFILES, installedTiles, requiredTiles, missingTiles, recommendedTiles, missingRecommendedTiles,
      runtimeUrl: TRIP_OFFLINE_RUNTIME_URL, segmentsUrl: TRIP_OFFLINE_SEGMENTS_URL, javaUrl: TRIP_OFFLINE_JAVA_URL,
    };
  }

  async function status({ coords } = {}) {
    const required = coords === undefined ? [] : corridor(coords);
    const recommended = coords === undefined ? [] : planRd5Corridor(coords, true).filter(tile => !required.includes(tile));
    return readStatus(await getLayout(), required, recommended);
  }

  async function configure(selected) {
    return exclusive(async dirs => {
      const root = await resolvedSelection(selected);
      const nested = path.join(root, `brouter-${TRIP_OFFLINE_RUNTIME_VERSION}`);
      const selectedRoot = await isScopedDirectory(root, nested) ? nested : root;
      if (!await verifyBRouter(selectedRoot)) throw error("E_IO", `请选择从官方发布包解压的 BRouter ${TRIP_OFFLINE_RUNTIME_VERSION} 文件夹`);
      if (await isScopedDirectory(dirs.root, dirs.runtimeDir) && await verifyBRouter(dirs.runtimeDir)) return readStatus(dirs, []);
      const stage = await fs.mkdtemp(path.join(dirs.root, "runtime-stage-"));
      try {
        await fs.mkdir(path.join(stage, "profiles2"));
        for (const name of Object.keys(RUNTIME_HASHES)) await fs.copyFile(path.join(selectedRoot, name), path.join(stage, name), constants.COPYFILE_EXCL);
        if (!await verifyBRouter(stage)) throw error("E_IO", "BRouter 文件在复制期间发生变化，请重新选择");
        const existing = await fs.lstat(dirs.runtimeDir).catch(() => null);
        if (existing) {
          if (!await isScopedDirectory(dirs.root, dirs.runtimeDir)) throw error("E_IO", "BRouter 运行目录无法使用");
          // Replace only known runtime files, and leave any unrelated files untouched.
          const profileDir = path.join(dirs.runtimeDir, "profiles2");
          await fs.mkdir(profileDir, { recursive: true });
          if (!await isScopedDirectory(dirs.runtimeDir, profileDir)) throw error("E_IO", "BRouter 配置目录无法使用");
          for (const name of Object.keys(RUNTIME_HASHES)) await fs.rename(path.join(stage, name), path.join(dirs.runtimeDir, name));
        } else {
          await fs.rename(stage, dirs.runtimeDir);
        }
      } finally { await fs.rm(stage, { recursive: true, force: true }); }
      return readStatus(dirs, []);
    });
  }

  async function configureJava(selected) {
    return exclusive(async dirs => {
      const home = await resolvedSelection(selected);
      const hashes = await javaIdentities(home);
      if (!hashes) throw error("E_NOT_FOUND", "请选择包含 bin 与 lib 文件夹的 Windows Java 17 或更新版本目录");
      if (!await trustedJavaLayout(home, hashes)) {
        throw error("E_FORBIDDEN", "请选择正式安装在 Program Files 的 Temurin 或 Microsoft Java 17 或更新版本");
      }
      const releasePath = path.join(home, "release");
      if (!await isScopedFile(home, releasePath) || (await fs.stat(releasePath)).size > 64 * 1024) throw error("E_IO", "找不到 Java 版本信息");
      const version = /^JAVA_VERSION="(\d+)[^"\r\n]*"/mu.exec(await fs.readFile(releasePath, "utf8"));
      if (!version || Number(version[1]) < 17) throw error("E_FORBIDDEN", "BRouter 需要 Java 17 或更新版本");
      const working = await fs.mkdtemp(path.join(dirs.root, "java-check-"));
      try {
        const publisher = await verifyJavaPublisher(home, working).catch(() => null);
        if (!publisher) throw error("E_FORBIDDEN", "无法验证 Java 的 Windows 签名，请选用正式 Temurin 或 Microsoft Java 安装");
        const javaVersion = await execute(path.join(home, SIGNED_JAVA_FILES[0]), ["-version"], {
          shell: false, cwd: working, windowsHide: true, timeout: 10000, maxBuffer: 32 * 1024, env: childEnvironment(working),
        });
        if (!/version "(?:1[7-9]|[2-9]\d)(?:[.+"-])/u.test(javaVersion.stderr)) throw error("E_FORBIDDEN", "需要 Java 17 或更新版本");
        const settings = { home, hashes };
        const staged = path.join(working, "java.json");
        await fs.writeFile(staged, JSON.stringify(settings), { flag: "wx" });
        await fs.rename(staged, dirs.javaFile);
        verifiedJava = { record: JSON.stringify(settings) };
      } finally { await fs.rm(working, { recursive: true, force: true }); }
      return readStatus(dirs, []);
    });
  }

  async function importSegments(selected) {
    return exclusive(async dirs => {
      const source = await resolvedSelection(selected);
      const files = (await fs.readdir(source, { withFileTypes: true })).filter(entry => entry.isFile() && isRd5TileName(entry.name));
      if (!files.length) throw error("E_NOT_FOUND", "所选文件夹中没有 BRouter .rd5 路网分片");
      const importedTiles = [];
      const working = await fs.mkdtemp(path.join(dirs.root, "segments-import-"));
      try {
        for (const { name } of files) {
          const original = path.join(source, name), target = path.join(dirs.segmentDir, name);
          if (!await isScopedFile(source, original) || (await fs.stat(original)).size > MAX_SEGMENT_BYTES) throw error("E_TOO_LARGE", `无法读取路网分片（${name}）`, { importedTiles });
          const staged = path.join(working, name);
          await fs.copyFile(original, staged, constants.COPYFILE_EXCL);
          try { await installSegment(staged, target); }
          catch (cause) {
            throw error("E_IO", cause.code === "E_IO" ? cause.message : `无法保存路网分片（${name}）`, { importedTiles });
          }
          importedTiles.push(name);
        }
      } finally { await fs.rm(working, { recursive: true, force: true }); }
      return { ...await readStatus(dirs, []), importedTiles };
    });
  }

  async function downloadSegments({ coords } = {}, { signal, onProgress, includeAdjacent = false } = {}) {
    const required = corridor(coords);
    const recommended = planRd5Corridor(coords, true).filter(tile => !required.includes(tile));
    return exclusive(async dirs => {
      const coverage = await readStatus(dirs, required, recommended);
      const missingTiles = [...coverage.missingTiles, ...(includeAdjacent ? coverage.missingRecommendedTiles : [])];
      if (missingTiles.length > MAX_DOWNLOAD_TILES) throw error("E_TOO_LARGE", "本次所需路网分片超过 32 个，请分段准备", { missingTiles });
      const downloadedTiles = [], unavailableTiles = [];
      let totalReceived = 0;
      const working = await fs.mkdtemp(path.join(dirs.root, "segments-download-"));
      try {
        for (const [index, tile] of missingTiles.entries()) {
          try {
            const timeout = AbortSignal.timeout(120_000);
            const requestSignal = AbortSignal.any(signal ? [signal, shutdown.signal, timeout] : [shutdown.signal, timeout]);
            const response = await fetchSegment(new URL(tile, TRIP_OFFLINE_SEGMENTS_URL).toString(), {
              signal: requestSignal, redirect: "error", credentials: "omit",
              headers: { "User-Agent": "LifeAtlas-TripItinerary (https://github.com/jamesmendax/life-atlas-public)" },
            });
            if (response.status === 404) {
              await response.body?.cancel();
              unavailableTiles.push(tile);
              continue;
            }
            const contentLength = Number(response.headers.get("content-length"));
            const totalBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null;
            if (!response.ok || !response.body || totalBytes > MAX_SEGMENT_BYTES || totalReceived + totalBytes > MAX_DOWNLOAD_BYTES) {
              await response.body?.cancel();
              if (totalBytes > MAX_SEGMENT_BYTES || totalReceived + totalBytes > MAX_DOWNLOAD_BYTES) throw error("E_TOO_LARGE", "超过本次路网下载上限，请分段准备");
              throw error(response.status === 429 ? "E_THROTTLED" : "E_IO", "官方路网分片暂时无法下载");
            }
            const staged = path.join(working, tile);
            let bytes = 0, lastReported = 0;
            function progress() {
              try { onProgress?.({ tile, index: index + 1, total: missingTiles.length, bytes, totalBytes }); }
              catch { /* A closed progress view does not interrupt a download. */ }
            }
            const count = new Transform({ transform(chunk, _, done) {
              bytes += chunk.length;
              totalReceived += chunk.length;
              if (bytes > MAX_SEGMENT_BYTES || totalReceived > MAX_DOWNLOAD_BYTES) return done(error("E_TOO_LARGE", "超过本次路网下载上限，请分段准备"));
              if (bytes - lastReported >= 1024 * 1024) { lastReported = bytes; progress(); }
              done(null, chunk);
            } });
            progress();
            await pipeline(Readable.fromWeb(response.body), count, createWriteStream(staged, { flags: "wx" }), { signal: requestSignal });
            if (totalBytes !== null && totalBytes !== bytes) throw error("E_IO", "路网分片下载不完整");
            await installSegment(staged, path.join(dirs.segmentDir, tile));
            downloadedTiles.push(tile);
            progress();
          } catch (cause) {
            const cancelled = signal?.aborted || shutdown.signal.aborted;
            const code = cancelled ? "E_CANCELLED" : /^E_/u.test(cause.code ?? "") ? cause.code : "E_IO";
            const message = cancelled ? "已取消下载，保留已完整准备的路网分片" : /^E_/u.test(cause.code ?? "") ? cause.message : `未能下载路网分片（${tile}）`;
            throw error(code, message, { downloadedTiles, unavailableTiles, missingTiles: missingTiles.filter(name => !downloadedTiles.includes(name)) });
          }
        }
      } finally { await fs.rm(working, { recursive: true, force: true }); }
      return { ...await readStatus(dirs, required, recommended), downloadedTiles, unavailableTiles };
    });
  }

  async function route({ mode, coords } = {}) {
    if (!Object.hasOwn(TRIP_OFFLINE_PROFILES, mode)) throw error("E_FORBIDDEN", "离线路网支持驾车、骑行和步行");
    const required = corridor(coords);
    const recommended = planRd5Corridor(coords, true).filter(tile => !required.includes(tile));
    return exclusive(async dirs => {
      const coverage = await readStatus(dirs, required, recommended);
      const details = { requiredTiles: required, missingTiles: coverage.missingTiles, missingRecommendedTiles: coverage.missingRecommendedTiles };
      if (!coverage.configured || !coverage.javaReady) throw error("E_NOT_FOUND", "请在设置中配置 BRouter 和已验证的 Java 运行时", details);
      if (coverage.missingTiles.length) throw error("E_NOT_FOUND", "离线路线沿途还缺少路网分片", details);
      const java = await readJava(dirs);
      const currentHashes = java && await javaIdentities(java.home);
      if (!currentHashes || Object.entries(currentHashes).some(([name, hash]) => java.hashes[name] !== hash)
          || !await trustedJavaLayout(java.home, currentHashes).catch(() => false)) {
        verifiedJava = undefined;
        throw error("E_NOT_FOUND", "Java 运行文件已变化，请重新验证离线路线运行时", details);
      }
      const working = await fs.mkdtemp(path.join(dirs.root, "route-"));
      try {
        const profile = TRIP_OFFLINE_PROFILES[mode];
        const executable = path.join(java.home, SIGNED_JAVA_FILES[0]);
        const legs = [], rawSha256 = [], usedTiles = new Set();
        const deadline = Date.now() + MAX_ROUTE_MS;
        let pointCount = 0;
        for (let index = 1; index < coords.length; index++) {
          const pair = [coords[index - 1], coords[index]];
          const lonlats = pair.map(([lat, lon]) => `${lon === 180 ? -180 : lon},${lat}`).join("|");
          const query = `lonlats=${lonlats}&profile=${profile}&alternativeidx=0&format=geojson`;
          const remaining = deadline - Date.now();
          if (remaining < 1000) throw error("E_IO", "本机离线路线计算超时，请拆分行程后重试");
          const prefix = `leg-${index}-`;
          const output = path.join(working, `${prefix}0.geojson`);
          const result = await execute(executable, [
            "-Xms32m", "-Xmx768m", "-Dfile.encoding=UTF-8", `-Duser.home=${working}`, `-Djava.io.tmpdir=${working}`,
            `-DmaxRunningTime=${Math.min(150, Math.floor(remaining / 1000))}`,
            "-cp", path.relative(working, path.join(dirs.runtimeDir, JAR)), "btools.server.BRouter", dirs.segmentDir, path.join(dirs.runtimeDir, "profiles2"), query, prefix,
          ], { shell: false, cwd: working, windowsHide: true, timeout: remaining, maxBuffer: 1024 * 1024, env: childEnvironment(working), signal: shutdown.signal })
            .catch(cause => {
              if (shutdown.signal.aborted) throw error("E_CANCELLED", "离线路网正在关闭");
              if (cause.killed) throw error("E_IO", "本机离线路线计算超时，请拆分行程后重试");
              throw error("E_IO", "本机 BRouter 未能完成路线计算");
            });
          const outputInfo = await fs.stat(output).catch(() => null);
          if (!outputInfo?.isFile()) {
            const missing = [...new Set(`${result.stdout}\n${result.stderr}`.match(/[EW]\d{1,3}_[NS]\d{1,2}\.rd5/gu) ?? [])]
              .filter(tile => isRd5TileName(tile) && !coverage.installedTiles.includes(tile)).sort();
            throw error("E_NOT_FOUND", missing.length ? "这条路线需要补充沿途路网分片" : "已准备的路网中未找到可通行的路线，请检查站点或补充绕行区域",
              { requiredTiles: [...new Set([...required, ...missing])].sort(), missingTiles: missing, missingRecommendedTiles: coverage.missingRecommendedTiles });
          }
          if (outputInfo.size > MAX_RAW_BYTES) throw error("E_TOO_LARGE", "离线路线数据过大，请拆分行程后重试");
          const track = parseTrack(await fs.readFile(output), MAX_ROUTE_POINTS - pointCount);
          legs.push(track.leg);
          rawSha256.push(track.rawSha256);
          pointCount += track.rawPointCount;
          for (const tile of rd5TilesAtPoints(track.points)) usedTiles.add(tile);
        }
        return { legs, provenance: {
          provider: "brouter", engineVersion: TRIP_OFFLINE_RUNTIME_VERSION, profile,
          tiles: [...usedTiles].sort(), requiredTiles: required, rawSha256,
          attribution: "© OpenStreetMap contributors", dataLicense: "ODbL-1.0",
        } };
      } finally { await fs.rm(working, { recursive: true, force: true }); }
    });
  }

  return { status, configure, configureJava, importSegments, downloadSegments, route, close: () => shutdown.abort() };
}
