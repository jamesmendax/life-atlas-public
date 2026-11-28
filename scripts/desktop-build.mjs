import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { assertPhysicalPath, isPathInside } from "../electron/main/storage/dataRoot.js";
import { RUNTIME_ROOT } from "./runtime-paths.mjs";
import { checkMarketDistribution } from "./check-market-distribution.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const RELEASE_FUSES = Object.freeze({
  runAsNode: false,
  enableCookieEncryption: true,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  enableEmbeddedAsarIntegrityValidation: true,
  onlyLoadAppFromAsar: true,
  loadBrowserProcessSpecificV8Snapshot: false,
  grantFileProtocolExtraPrivileges: false,
});

export function parseBuildArguments(args) {
  const [flavor, ...rest] = args;
  const reject = () => { throw Object.assign(new Error("用法：node scripts/desktop-build.mjs <release|test> [--version x.y.z] [--install-test]"), { exitCode: 64 }); };
  if (!["release", "test"].includes(flavor)) reject();
  let version = null;
  let installTest = false;
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--version" && !version && /^\d+\.\d+\.\d+$/.test(rest[index + 1] || "")) version = rest[++index];
    else if (rest[index] === "--install-test" && flavor === "release" && !installTest) installTest = true;
    else reject();
  }
  return { flavor, version, ...(installTest ? { installTest: true } : {}) };
}

export function desktopBuildCommands({ flavor, version, installTest = false }) {
  if (installTest && flavor !== "release") throw Object.assign(new Error("安装测试版必须使用 release 构建"), { exitCode: 64 });
  const output = installTest ? `install-test-${version || JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8")).version}` : flavor;
  const build = ["node_modules/vite/bin/vite.js", "build"];
  const packageApp = ["node_modules/electron-builder/cli.js", "--config", "electron-builder.yml", "--win", ...(flavor === "test" ? ["dir"] : []), `-c.directories.output=release/${output}`, `-c.extraMetadata.lifeAtlasFlavor=${flavor}`, `-c.electronDownload.cache=${path.join(RUNTIME_ROOT, "electron-cache")}`, "-c.npmRebuild=false", "--publish", "never"];
  if (version) packageApp.push(`-c.extraMetadata.version=${version}`);
  if (installTest) packageApp.push("-c.appId=com.medax.lifeatlas.installtest", "-c.productName=Life Atlas Install Test", "-c.nsis.shortcutName=Life Atlas Install Test", "-c.nsis.createDesktopShortcut=false");
  if (flavor === "release") for (const [name, value] of Object.entries(RELEASE_FUSES)) packageApp.push(`-c.electronFuses.${name}=${value}`);
  return [build, packageApp];
}

export function missingDesktopBuildInputs(exists = fs.existsSync) {
  return ["build/icon.ico", "THIRD_PARTY_NOTICES.md"].filter((file) => !exists(path.join(PROJECT_ROOT, file)));
}

export function assertDesktopBuildNoticesVersion(noticesText, sourceVersion) {
  const reject = (message) => { throw Object.assign(new Error(`THIRD_PARTY_NOTICES.md ${message}，先运行 WP-19 步骤 4`), { exitCode: 65 }); };
  if (typeof sourceVersion !== "string" || !sourceVersion || /\s/.test(sourceVersion)) reject("无法读取源码 package.json 版本");
  if (typeof noticesText !== "string") reject("内容缺失或无效");
  const lines = noticesText.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0] !== "# 第三方软件许可（THIRD_PARTY_NOTICES）" || lines[1] !== "") reject("文件头不是 license-report 生成格式");
  const declaration = /^Life Atlas (\S+) 使用了下面这些开源软件和数据文件。(?:本文件|npm 包及其许可证清单)由 `docs\/blueprint\/tools\/license-report\.mjs` 生成。$/.exec(lines[2] || "");
  if (!declaration) reject("版本声明缺失或格式无效");
  if (declaration[1] !== sourceVersion) reject(`声明版本 ${declaration[1]} 与源码 package.json 版本 ${sourceVersion} 不一致`);
  return declaration[1];
}

export function offlineBuildNodeOptions(guardPath) {
  return `--require="${guardPath.replaceAll("\\", "/")}"`;
}

export function prepareElectronCache({ cacheRoot, version, checksums }) {
  if (!/^\d+\.\d+\.\d+$/.test(version || "")) throw new TypeError("Electron 缓存版本无效");
  const absolute = path.resolve(cacheRoot);
  if (!isPathInside(RUNTIME_ROOT, absolute)) throw new Error("构建缓存必须位于任务 runtime 内");
  const directory = assertPhysicalPath(absolute, { allowMissing: false });
  const fileName = `electron-v${version}-win32-x64.zip`;
  const expected = checksums?.[fileName];
  if (!/^[a-f0-9]{64}$/i.test(expected || "")) throw new Error("缺少已安装 Electron 包提供的 SHA-256");
  const cacheKey = createHash("sha256").update(`https://github.com/electron/electron/releases/download/v${version}`).digest("hex");
  const file = assertPhysicalPath(path.join(directory, cacheKey, fileName), { root: directory, allowMissing: false });
  const digest = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (digest !== expected.toLowerCase()) throw new Error("Electron 离线缓存校验失败，拒绝下载替代文件");
  const checksumFile = assertPhysicalPath(path.join(directory, `SHASUMS256.txt-${version}`), { root: directory });
  fs.writeFileSync(checksumFile, `${digest} *${fileName}\n`, "utf8");
  return { cacheRoot: directory, file, sha256: digest, checksumFile };
}

function runBuild(args) {
  let options;
  try { options = parseBuildArguments(args); } catch (error) { console.error(error.message); return error.exitCode || 64; }
  const missing = missingDesktopBuildInputs();
  if (missing.length) { for (const file of missing) console.error(`缺少 ${file}，先运行 WP-19 步骤 2/4`); return 65; }
  try {
    const sourcePackage = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"));
    const noticesText = fs.readFileSync(path.join(PROJECT_ROOT, "THIRD_PARTY_NOTICES.md"), "utf8");
    assertDesktopBuildNoticesVersion(noticesText, sourcePackage.version);
  } catch (error) { console.error(error.message); return 65; }
  const runtime = assertPhysicalPath(RUNTIME_ROOT);
  if (options.flavor === "release") {
    const check = spawnSync(process.execPath, ["scripts/check-data-compatibility.mjs"], { cwd: PROJECT_ROOT, stdio: "inherit", windowsHide: true });
    if (check.error) console.error(check.error.message);
    if (check.status !== 0) return check.status ?? 1;
  }
  fs.mkdirSync(runtime, { recursive: true });
  const electronPackage = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "node_modules/electron/package.json"), "utf8"));
  const checksums = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "node_modules/electron/checksums.json"), "utf8"));
  const cache = prepareElectronCache({ cacheRoot: path.join(runtime, "electron-cache"), version: electronPackage.version, checksums });
  console.log(`OFFLINE_BUILD_CACHE ${JSON.stringify(cache)}`);
  const temp = fs.mkdtempSync(path.join(runtime, "desktop-build-"));
  try {
    const guard = path.join(PROJECT_ROOT, "scripts/offline-build-preload.cjs");
    for (const command of desktopBuildCommands(options)) {
      const result = spawnSync(process.execPath, command, { cwd: PROJECT_ROOT, stdio: "inherit", windowsHide: true, env: { ...process.env, TEMP: temp, TMP: temp, ELECTRON_BUILDER_CACHE: path.join(runtime, "builder-cache"), ELECTRON_DOWNLOAD_CACHE_MODE: "0", NODE_OPTIONS: offlineBuildNodeOptions(guard) } });
      if (result.error) { console.error(result.error.message); return 1; }
      if (result.status !== 0) return result.status ?? 1;
    }
    const builtVersion = options.version || JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8")).version;
    const output = options.installTest ? `install-test-${builtVersion}` : options.flavor;
    console.log("MARKET_DISTRIBUTION", JSON.stringify(checkMarketDistribution(path.join(PROJECT_ROOT, "release", output, "win-unpacked"))));
    return 0;
  } finally {
    const target = assertPhysicalPath(temp, { root: runtime });
    if (!isPathInside(runtime, target)) throw new Error("构建临时目录不在任务 runtime 内");
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runBuild(process.argv.slice(2));
