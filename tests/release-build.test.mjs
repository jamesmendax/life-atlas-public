import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { parseBuildArguments, desktopBuildCommands, missingDesktopBuildInputs, assertDesktopBuildNoticesVersion, prepareElectronCache, offlineBuildNodeOptions } from "../scripts/desktop-build.mjs";
import { createIsolatedDirectory, removeIsolatedDirectory, TASK_RUNTIME_ROOT } from "./desktop/helpers.mjs";

function generatedNoticesText(version) {
  return `# 第三方软件许可（THIRD_PARTY_NOTICES）\n\nLife Atlas ${version} 使用了下面这些开源软件和数据文件。本文件由 \`docs/blueprint/tools/license-report.mjs\` 生成。\n\n## 程序本体与数据文件\n`;
}

test("install test packaging accepts both option orders only for release", () => {
  const expected = { flavor: "release", version: "0.9.0", installTest: true };
  assert.deepEqual(parseBuildArguments(["release", "--version", "0.9.0", "--install-test"]), expected);
  assert.deepEqual(parseBuildArguments(["release", "--install-test", "--version", "0.9.0"]), expected);
  assert.deepEqual(parseBuildArguments(["release", "--install-test"]), { flavor: "release", version: null, installTest: true });
  for (const args of [["test", "--install-test"], ["release", "--install-test", "--install-test"], ["release", "--version", "1.0.0", "--version", "0.9.0"], ["release", "--install-test", "--version"]]) assert.throws(() => parseBuildArguments(args), { exitCode: 64 });
});

test("install test packaging is isolated from the real app and remains fused", () => {
  const commands = desktopBuildCommands({ flavor: "release", version: "0.9.0", installTest: true });
  for (const argument of ["-c.directories.output=release/install-test-0.9.0", "-c.appId=com.medax.lifeatlas.installtest", "-c.productName=Life Atlas Install Test", "-c.nsis.shortcutName=Life Atlas Install Test", "-c.nsis.createDesktopShortcut=false", "-c.extraMetadata.lifeAtlasFlavor=release"]) assert.ok(commands[1].includes(argument), argument);
  assert.equal(commands[1].filter((argument) => argument.includes("electronFuses")).length, 8);
  assert.equal(commands[1].some((argument) => argument.includes('"Life Atlas Install Test"')), false);
  assert.throws(() => desktopBuildCommands({ flavor: "test", version: null, installTest: true }), { exitCode: 64 });
});

test("install test default version follows the package version", () => {
  const version = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  assert.ok(desktopBuildCommands({ flavor: "release", version: null, installTest: true })[1].includes(`-c.directories.output=release/install-test-${version}`));
});

test("packaging preflight requires both the icon and full third party notices", () => {
  assert.deepEqual(missingDesktopBuildInputs(() => false), ["build/icon.ico", "THIRD_PARTY_NOTICES.md"]);
  assert.deepEqual(missingDesktopBuildInputs((file) => path.basename(file) === "icon.ico"), ["THIRD_PARTY_NOTICES.md"]);
  assert.deepEqual(missingDesktopBuildInputs(() => true), []);
});

test("the installer localizes its custom strings and the uninstaller preserves application data", () => {
  const yaml = fs.readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8");
  assert.match(yaml, /deleteAppDataOnUninstall: false/);
  const configuredLanguages = yaml.match(/^  installerLanguages:\s*\r?\n((?:    - \w+\r?\n)+)/m);
  assert.deepEqual(configuredLanguages?.[1].match(/\w+/g), ["zh_CN", "ja_JP", "en_US"]);
  assert.doesNotMatch(yaml, /^  language:/m);
  const script = fs.readFileSync(new URL("../build/installer.nsh", import.meta.url), "utf8");
  for (const message of ["atlasKeepDataNotice", "atlasRuntimeReadWarning", "atlasMarkdownPreviewName"]) {
    const languageIds = [...script.matchAll(new RegExp(`^ +LangString ${message} \\$\\{(LANG_\\w+)\\} ".+"\\r?$`, "gm"))].map(([, id]) => id);
    assert.deepEqual(languageIds, ["LANG_SIMPCHINESE", "LANG_JAPANESE", "LANG_ENGLISH"], message);
  }
  assert.ok(script.includes('LangString atlasKeepDataNotice ${LANG_SIMPCHINESE} "卸载只会删除 Life Atlas 程序。你的数据目录（全部页面、附件、密钥库和快照）不会被删除。以后重新安装时选择同一个数据目录，就能继续使用。"'));
  assert.match(script, /MessageBox MB_OK\|MB_ICONINFORMATION "\$\(atlasKeepDataNotice\)" \/SD IDOK/);
  assert.match(script, /DetailPrint "\$\(atlasRuntimeReadWarning\)"/);
  assert.equal([...script.matchAll(/WriteRegStr[^\n]+"\$\(atlasMarkdownPreviewName\)"/g)].length, 2);
  assert.doesNotMatch(script, /RMDir|Delete\s/i);
});

test("desktop packaging selects the physical artifact cache without reinstalling dependencies", () => {
  for (const flavor of ["release", "test"]) {
    const commands = desktopBuildCommands({ flavor, version: null });
    assert.ok(commands[1].includes(`-c.electronDownload.cache=${path.join(TASK_RUNTIME_ROOT, "electron-cache")}`));
    assert.ok(commands[1].includes("-c.npmRebuild=false"));
  }
  const source = fs.readFileSync(new URL("../scripts/desktop-build.mjs", import.meta.url), "utf8");
  assert.match(source, /ELECTRON_DOWNLOAD_CACHE_MODE: "0"/);
});

test("offline Electron cache validates the installed package checksum before seeding metadata", (context) => {
  const cacheRoot = createIsolatedDirectory("build-cache-test");
  context.after(() => removeIsolatedDirectory(cacheRoot));
  const version = "44.4.5";
  const fileName = `electron-v${version}-win32-x64.zip`;
  const cacheKey = createHash("sha256").update(`https://github.com/electron/electron/releases/download/v${version}`).digest("hex");
  const directory = path.join(cacheRoot, cacheKey);
  fs.mkdirSync(directory);
  const bytes = Buffer.from("synthetic-cache-archive");
  fs.writeFileSync(path.join(directory, fileName), bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  assert.throws(() => prepareElectronCache({ cacheRoot, version, checksums: { [fileName]: "0".repeat(64) } }), /缓存校验失败/);
  assert.equal(fs.existsSync(path.join(cacheRoot, `SHASUMS256.txt-${version}`)), false);
  const result = prepareElectronCache({ cacheRoot, version, checksums: { [fileName]: sha256 } });
  assert.equal(result.sha256, sha256);
  assert.equal(fs.readFileSync(result.checksumFile, "utf8"), `${sha256} *${fileName}\n`);
  assert.throws(() => prepareElectronCache({ cacheRoot: path.dirname(TASK_RUNTIME_ROOT), version, checksums: {} }), /任务 runtime/);
});

test("offline packaging guard rejects Node network APIs before connecting", () => {
  const guard = new URL("../scripts/offline-build-preload.cjs", import.meta.url);
  const source = "const assert=require('node:assert/strict');for(const [module,name] of [['node:http','get'],['node:https','request'],['node:net','connect'],['node:tls','connect'],['node:dgram','createSocket']]) assert.throws(()=>require(module)[name]('https://example.invalid'),/Offline desktop build refused/);assert.rejects(()=>fetch('https://example.invalid'),/Offline desktop build refused/);";
  const result = spawnSync(process.execPath, ["--require", fileURLToPath(guard), "-e", source], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OFFLINE_BUILD_NETWORK_GUARD enabled/);
});

test("offline packaging guard also rejects direct UDP and DNS transports", () => {
  const guard = fileURLToPath(new URL("../scripts/offline-build-preload.cjs", import.meta.url));
  const source = `
    const assert = require("node:assert/strict");
    const dgram = require("node:dgram");
    const dns = require("node:dns");
    const dnsPromises = require("node:dns/promises");
    const socket = new dgram.Socket("udp4");
    assert.throws(() => socket.send(Buffer.from("blocked"), 53, "192.0.2.1"), /Offline desktop build refused/);
    assert.throws(() => socket.connect(53, "192.0.2.1"), /Offline desktop build refused/);
    try { socket.close(); } catch (error) { assert.equal(error.code, "ERR_SOCKET_DGRAM_NOT_RUNNING"); }
    for (const target of [dns, new dns.Resolver()]) {
      for (const name of ["lookup", "lookupService", "resolve", "resolve4", "resolve6", "reverse"]) {
        if (typeof target[name] === "function") assert.throws(() => target[name]("example.invalid", () => {}), /Offline desktop build refused/);
      }
    }
    (async () => {
      for (const target of [dnsPromises, new dnsPromises.Resolver()]) {
        for (const name of ["lookup", "lookupService", "resolve", "resolve4", "resolve6", "reverse"]) {
          if (typeof target[name] === "function") await assert.rejects(() => target[name]("example.invalid"), /Offline desktop build refused/);
        }
      }
      console.log("UDP_DNS_REFUSED");
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ["--require", guard, "-e", source], { encoding: "utf8", windowsHide: true, timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /UDP_DNS_REFUSED/);
});

test("offline packaging guard preserves child stdio and fork IPC pipes", (context) => {
  const directory = createIsolatedDirectory("build-ipc-test");
  context.after(() => removeIsolatedDirectory(directory));
  const guard = fileURLToPath(new URL("../scripts/offline-build-preload.cjs", import.meta.url));
  const childFile = path.join(directory, "child.cjs");
  fs.writeFileSync(childFile, 'process.on("message", (message) => { process.send({ received: message }); process.disconnect(); });', "utf8");
  const source = `
    const assert = require("node:assert/strict");
    const { spawnSync, fork } = require("node:child_process");
    const child = spawnSync(process.execPath, ["--require", ${JSON.stringify(guard)}, "-e", 'process.stdout.write("STDIO_OK")'], { encoding: "utf8", windowsHide: true });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /STDIO_OK/);
    const worker = fork(${JSON.stringify(childFile)}, [], { execArgv: ["--require", ${JSON.stringify(guard)}], stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
    let received = false;
    worker.on("message", (message) => { assert.deepEqual(message, { received: "local-pipe" }); received = true; });
    worker.on("error", (error) => { throw error; });
    worker.on("exit", (code) => { assert.equal(code, 0); assert.equal(received, true); console.log("FORK_IPC_OK"); });
    worker.send("local-pipe");
  `;
  const result = spawnSync(process.execPath, ["--require", guard, "-e", source], { encoding: "utf8", windowsHide: true, timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /FORK_IPC_OK/);
});

test("offline build NODE_OPTIONS loads native Windows paths and paths with spaces", (context) => {
  const directory = createIsolatedDirectory("build-node-options");
  context.after(() => removeIsolatedDirectory(directory));
  const guard = fileURLToPath(new URL("../scripts/offline-build-preload.cjs", import.meta.url));
  const spacedDirectory = path.join(directory, "guard assets 示例");
  fs.mkdirSync(spacedDirectory);
  const copiedGuard = path.join(spacedDirectory, "offline-build-preload.cjs");
  fs.copyFileSync(guard, copiedGuard, fs.constants.COPYFILE_EXCL);
  const source = 'const assert = require("node:assert/strict"); assert.throws(() => require("node:https").get("https://example.invalid"), /Offline desktop build refused/); console.log("NODE_OPTIONS_GUARD_ACTIVE");';
  for (const guardPath of [guard, copiedGuard]) {
    const result = spawnSync(process.execPath, ["-e", source], { encoding: "utf8", windowsHide: true, timeout: 10000, env: { ...process.env, NODE_OPTIONS: offlineBuildNodeOptions(guardPath) } });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /OFFLINE_BUILD_NETWORK_GUARD enabled/);
    assert.match(result.stdout, /NODE_OPTIONS_GUARD_ACTIVE/);
  }
});

test("offline desktop compiler inherits only the build-owned guard without heap overrides", (context) => {
  const directory = createIsolatedDirectory("build-options-inheritance");
  context.after(() => removeIsolatedDirectory(directory));
  const guard = fileURLToPath(new URL("../scripts/offline-build-preload.cjs", import.meta.url));
  const child = path.join(directory, "nested-options.mjs");
  fs.writeFileSync(child, 'console.log(JSON.stringify({ nodeOptions: process.env.NODE_OPTIONS }));', { flag: "wx" });
  const source = 'const { spawnSync } = require("node:child_process"); const result = spawnSync(process.execPath, [process.argv[1]], { encoding: "utf8", windowsHide: true }); if (result.error) throw result.error; process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exitCode = result.status ?? 1;';
  const options = offlineBuildNodeOptions(guard);
  const result = spawnSync(process.execPath, ["-e", source, child], { encoding: "utf8", windowsHide: true, timeout: 10000, env: { ...process.env, NODE_OPTIONS: options } });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const inherited = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(inherited.nodeOptions, options, "The actual compiler subprocess must inherit the build-owned options");
  assert.equal(inherited.nodeOptions, `--require="${guard.replaceAll("\\", "/")}"`);
  assert.match(result.stdout, /OFFLINE_BUILD_NETWORK_GUARD enabled/);
});

test("third party notices accept the current source package version", () => {
  const version = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  assert.equal(assertDesktopBuildNoticesVersion(generatedNoticesText(version), version), version);
});

test("third party notices accept CRLF and UTF8 BOM without changing the version", () => {
  const notices = generatedNoticesText("1.0.0");
  for (const text of [notices.replaceAll("\n", "\r\n"), `\uFEFF${notices}`, `\uFEFF${notices.replaceAll("\n", "\r\n")}`]) assert.equal(assertDesktopBuildNoticesVersion(text, "1.0.0"), "1.0.0");
});

test("third party notices reject missing content and a missing version declaration", () => {
  for (const text of [undefined, null, "", "\n", "# 第三方软件许可（THIRD_PARTY_NOTICES）\n\n## 程序本体与数据文件\n"]) assert.throws(() => assertDesktopBuildNoticesVersion(text, "1.0.0"), { exitCode: 65 });
});

test("third party notices reject a wrong generated heading or declaration", () => {
  const notices = generatedNoticesText("1.0.0");
  for (const text of [notices.replace("第三方软件许可", "第三方声明"), notices.replace("# 第三方软件许可（THIRD_PARTY_NOTICES）\n\n", ""), notices.replace("使用了下面这些开源软件和数据文件", "是当前版本"), notices.replace("docs/blueprint/tools/license-report.mjs", "other-generator.mjs")]) assert.throws(() => assertDesktopBuildNoticesVersion(text, "1.0.0"), { exitCode: 65 });
});

test("third party notices reject stale versions and matching later mentions", () => {
  for (const version of ["0.1.0", "1.0.1", "11.0.0", "1.0.00", "1.0.0-beta.1"]) assert.throws(() => assertDesktopBuildNoticesVersion(generatedNoticesText(version), "1.0.0"), { exitCode: 65, message: /声明版本 .* 与源码 package\.json 版本 1\.0\.0 不一致/ });
  assert.throws(() => assertDesktopBuildNoticesVersion(`${generatedNoticesText("0.1.0")}\n${generatedNoticesText("1.0.0")}`, "1.0.0"), { exitCode: 65 });
});

test("third party notices reject a missing source package version", () => {
  for (const version of [undefined, null, "", " ", "1.0.0\n", 100]) assert.throws(() => assertDesktopBuildNoticesVersion(generatedNoticesText("1.0.0"), version), { exitCode: 65, message: /源码 package\.json 版本/ });
});

test("synthetic packaging version overrides keep notices tied to the source version", () => {
  const sourceVersion = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  for (const args of [["release", "--version", "0.9.0"], ["release", "--install-test", "--version", "0.9.0"], ["test", "--version", "0.9.0"]]) {
    const commands = desktopBuildCommands(parseBuildArguments(args));
    assert.ok(commands[1].includes("-c.extraMetadata.version=0.9.0"));
    assert.equal(assertDesktopBuildNoticesVersion(generatedNoticesText(sourceVersion), sourceVersion), sourceVersion);
  }
});

test("packaging rejects stale notices before runtime cache and child process side effects", () => {
  const source = fs.readFileSync(new URL("../scripts/desktop-build.mjs", import.meta.url), "utf8");
  const start = source.indexOf("function runBuild(args) {");
  const end = source.indexOf("\nif (process.argv[1]", start);
  assert.ok(start >= 0 && end > start, "The actual build entry point must be available for the preflight regression");
  const reads = [];
  const effects = [];
  const errors = [];
  let missing = [];
  let noticesText = generatedNoticesText("0.1.0");
  let incompatible = false;
  const stopAtSetup = (name) => () => { effects.push(name); throw new Error("BUILD_SETUP_REACHED"); };
  const runBuild = runInNewContext(`(${source.slice(start, end)})`, {
    parseBuildArguments,
    missingDesktopBuildInputs: () => missing,
    assertDesktopBuildNoticesVersion,
    path,
    PROJECT_ROOT: path.resolve(fileURLToPath(new URL("../", import.meta.url))),
    RUNTIME_ROOT: TASK_RUNTIME_ROOT,
    process: { execPath: process.execPath },
    fs: {
      readFileSync(file, encoding) {
        assert.equal(encoding, "utf8");
        const name = path.basename(file);
        reads.push(name);
        if (name === "package.json") return JSON.stringify({ version: "1.0.0" });
        if (name === "THIRD_PARTY_NOTICES.md") return noticesText;
        throw new Error(`Unexpected preflight read: ${name}`);
      },
      mkdirSync: stopAtSetup("mkdir"),
      mkdtempSync: stopAtSetup("temporary-directory"),
      rmSync: stopAtSetup("remove"),
    },
    assertPhysicalPath: (dir) => incompatible ? dir : stopAtSetup("physical-runtime")(),
    prepareElectronCache: stopAtSetup("cache"),
    desktopBuildCommands: stopAtSetup("build-commands"),
    spawnSync: (executable, args) => {
      assert.equal(executable, process.execPath);
      assert.deepEqual(Array.from(args), ["scripts/check-data-compatibility.mjs"]);
      effects.push("compatibility-check");
      return { status: 42 };
    },
    console: { error: (message) => errors.push(message), log: stopAtSetup("build-log") },
  });
  for (const text of [generatedNoticesText("0.1.0"), "", generatedNoticesText("1.0.0").replace("第三方软件许可", "第三方声明")]) {
    noticesText = text;
    reads.length = 0;
    assert.equal(runBuild(["release", "--install-test", "--version", "0.9.0"]), 65);
    assert.deepEqual(reads, ["package.json", "THIRD_PARTY_NOTICES.md"]);
    assert.deepEqual(effects, []);
  }
  missing = ["THIRD_PARTY_NOTICES.md"];
  reads.length = 0;
  assert.equal(runBuild(["test"]), 65);
  assert.deepEqual(reads, []);
  assert.deepEqual(effects, []);
  assert.match(errors.at(-1), /缺少 THIRD_PARTY_NOTICES\.md/);
  missing = [];
  noticesText = generatedNoticesText("1.0.0");
  for (const args of [["test"], ["release"], ["release", "--install-test", "--version", "0.9.0"]]) {
    reads.length = 0;
    effects.length = 0;
    assert.throws(() => runBuild(args), /BUILD_SETUP_REACHED/);
    assert.deepEqual(reads, ["package.json", "THIRD_PARTY_NOTICES.md"]);
    assert.deepEqual(effects, ["physical-runtime"]);
  }
  incompatible = true;
  effects.length = 0;
  assert.equal(runBuild(["release"]), 42);
  assert.deepEqual(effects, ["compatibility-check"]);
});
