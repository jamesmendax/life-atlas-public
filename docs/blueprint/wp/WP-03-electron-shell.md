# WP-03 Electron 桌面外壳

- 规模：M · 前置：WP-02 · 分支：`wp/03-electron-shell`
- 停止点：只有收尾（步骤 11）
- 必读：`09-执行手册.md`、`02-总体架构.md` 第 1、2、3（含 3.1）、6、7、8、9、10、11 节、`11-接口契约.md` 第 1 节（WP-03 的行）与第 5 节；`package.json`；`vite.config.mjs`；`src/main.jsx`；`src/styles.css` 第 1 行

## 0. 一页纸

- **要做到**：一个“安全的空壳”桌面版——能开发运行、能打包、加载现有界面、不联网、渲染进程拿不到 Node。存储仍是旧的 localStorage（在桌面版自己的浏览器存储里），WP-04 才换成 SQLite。
- **交付物**：`electron/` 目录（主进程与 preload）；`scripts/desktop-dev.mjs`、`scripts/desktop-build.mjs`；`electron-builder.yml`；去掉在线字体；产品输入对话框 `src/ui/dialogService.js`、`src/ui/DialogHost.jsx`（替换全部 `window.prompt`）；单元测试；`tests/desktop/helpers.mjs` 与 `tests/desktop/shell.e2e.mjs`。
- **绝对不要**：接入 SQLite 或做任何存储改造；做密钥库窗口；加 Electron Fuses；在测试里打开真实对话框或真实浏览器；在 4173/4175 端口启动服务；新增本文件第 3 节步骤 1 以外的依赖。
- **什么时候停**：步骤 11 的 wp-check 退出码为 0 或 2。

## 1. 为什么做

决策 D-01/D-02：产品成为 Electron 桌面应用。本 WP 只搭好外壳，后面 WP-04 起在它上面接存储、备份和密钥库。

## 2. 已知事实（总设计师 2026-11-01 在本机临时项目里实测）

| 事实 | 对你的影响 |
| --- | --- |
| `npm install --save-dev --save-exact electron@44.4.5` 约 15 秒完成，但 **Electron 44 的 npm 包安装时不下载程序本体**，`node_modules/electron/dist` 是空的 | 安装后必须运行 `node node_modules/electron/install.js`，它从本机缓存解压（约 5 秒，不联网）；之后 `node_modules/electron/dist/version` 的内容是 `44.4.5` |
| `electron-builder@26.18.0` 安装约 40 秒；`--win dir` 打包约 10 秒，`--win`（NSIS 安装包 + 目录）约 35 秒，全程使用本机缓存，不需要签名工具 | 照第 3 节命令即可 |
| 命令行的 `--win dir` 会覆盖配置文件里的目标，只出 `win-unpacked` | 测试版用它 |
| `-c.extraMetadata.lifeAtlasFlavor=test` 会把字段写进打包后的 `package.json`，主进程用 `app.getAppPath()` 读得到 | flavor 判断照 02 第 10 节 |
| Playwright 1.63 的 `_electron.launch` 能启动 Electron 44 的开发模式（`electron .`）和打包后的 exe；`electronApp.evaluate` 能读主进程的 `globalThis` | 端到端测试照第 3 节写 |
| `app.setPath("userData"/"sessionData", …)` 在 ready 前调用有效，Chromium 的缓存文件都会写到那里 | 启动顺序照 02 第 3.1 节 |
| 设置环境变量 `APPDATA` **不会**改变 `app.getPath("appData")` | 测试必须用 `LIFE_ATLAS_BOOTSTRAP_DIR`，否则会写进真实的 `%APPDATA%` |
| 主进程里 `node:sqlite` 可用（SQLite 3.53.4） | WP-04 用 |
| 用 02 第 7 节的 CSP 加载现在的界面：界面正常，唯一的错误是 `src/styles.css` 第 1 行从 `fonts.googleapis.com` 加载字体被 CSP 拦下 | 步骤 2 去掉在线字体 |
| CSP 拦下的远程图片**不会**进入 `webRequest`（所以不会出现在 `blocked` 里），但会产生一条控制台错误 “…violates the following Content Security Policy directive…” | 测试里故意插入的远程地址要列入允许的错误（第 3 节步骤 9） |
| Electron 44 的渲染进程里 `window.prompt` 一调用就抛错 `prompt() is not supported.`；`window.confirm`、`window.alert` 可以用，Playwright 的 `page.on("dialog")` 能收到并 `accept()`，但事件里的中文消息是乱码 | 步骤 8 把全部 `window.prompt` 换成产品自己的输入对话框；桌面测试里不要断言原生对话框的消息文字 |
| electron-builder 会把 `package.json` 里 **`dependencies` 的全部包**（连同子依赖）复制进安装包，不管 `files` 怎么写。用本项目现在的依赖实测：`app.asar` 219 MB，另有 34 MB 原生文件（esbuild、rollup、sharp 自带的 libvips，后者是 LGPL-3.0）；把这些包移到 `devDependencies` 后，安装包里只剩我们自己的文件。这些包都是界面或构建工具用的，Vite 已经把界面需要的代码打包进 `dist/client`，运行时用不到 | 步骤 1 第 2 条照做 |

## 3. 执行步骤

### 步骤 0：开工准备

```powershell
Set-Location -LiteralPath 'C:\Projects\life-atlas'
git status --porcelain
git switch main
git switch -c wp/03-electron-shell
node docs/blueprint/tools/wp-check.mjs WP-03 --init-report
node docs/blueprint/tools/run-logged.mjs .qa/WP-03/step0-npm-test.log npm test
```

报告第 1 节写理解，并回答：

1. 主进程启动时，为什么必须先设置 `userData` 再请求单实例锁？
2. 打包后的“测试版”和“正式版”有什么区别？端到端测试用哪一个？
3. 测试里遇到确认对话框时，主进程会怎样？

第 0 节步骤 0 改为“完成”，提交 `WP-03: step 0 understanding`（本 WP 不在步骤 0 停）。

### 步骤 1：安装依赖并整理依赖分组

1. 安装（一行一条）：

   ```powershell
   npm install --save-dev --save-exact electron@44.4.5
   npm install --save-dev --save-exact electron-builder@26.18.0
   npm install --save-dev --save-exact @fontsource/dm-sans@5.3.0
   node node_modules/electron/install.js
   node -e "console.log(require('fs').readFileSync('node_modules/electron/dist/version', 'utf8'))"
   ```

   期望最后一条输出 `44.4.5`。`npm install` 失败按执行手册第 7 节处理（重试一次，仍失败就停下报告）。

2. **把现有的 15 个包从 `dependencies` 移到 `devDependencies`**（原因见第 2 节最后一行）。用文件编辑工具打开 `package.json`：把 `"dependencies"` 里的每一行——`@blocknote/core`、`@blocknote/mantine`、`@blocknote/react`、`@emoji-mart/data`、`@mantine/core`、`@mantine/hooks`、`@tabler/icons-react`、`@vitejs/plugin-react`、`html2canvas`、`jspdf`、`jszip`、`react`、`react-dom`、`sharp`、`vite`——原样剪切到 `"devDependencies"` 里，**版本字符串一个字都不改**；`"dependencies"` 留成空对象 `{}`。然后：

   ```powershell
   npm install
   npm ls --omit=dev --depth=0
   ```

   期望 `npm ls` 输出的第二行含 `(empty)`（没有任何运行时依赖）。

3. 确认 `package.json`：`dependencies` 是 `{}`；`devDependencies` 多了 `"electron": "44.4.5"`、`"electron-builder": "26.18.0"`、`"@fontsource/dm-sans": "5.3.0"` 和移过来的 15 个包；没有其他依赖变化。**以后任何 WP 新增界面用的包都用 `--save-dev`**；只有主进程运行时要加载的包（WP-05 的 `yazl`、`yauzl`，WP-06 的 `hash-wasm`）放进 `dependencies`。wp-check 的 K5 会检查这条规则。

4. 新建 `tests/package-layout.test.mjs`，用例 `runtime dependencies are only main process packages`：读取 `package.json`，`Object.keys(pkg.dependencies || {})` 的每一项都属于 `["yazl", "yauzl", "hash-wasm"]`。

提交 `WP-03: add electron tooling and move bundled packages to devDependencies`。

### 步骤 2：去掉在线字体

1. 删除 `src/styles.css` 的第 1 行（`@import url("https://fonts.googleapis.com/…");`），其他不动。
2. 在 `src/main.jsx` 现有的 `import "@blocknote/core/fonts/inter.css";` 下面加 4 行：

   ```js
   import "@fontsource/dm-sans/400.css";
   import "@fontsource/dm-sans/500.css";
   import "@fontsource/dm-sans/600.css";
   import "@fontsource/dm-sans/700.css";
   ```

3. 检查源码里再没有在线字体：

   ```powershell
   git grep -n "fonts.googleapis" -- src index.html
   ```

   期望没有输出。

4. `npm run build` 必须成功。

提交 `WP-03: bundle DM Sans locally instead of loading Google Fonts`。

### 步骤 3：package.json 与打包配置

1. `package.json`：
   - `"version"` 改为 `"0.1.0"`；增加 `"description": "Life Atlas 本地个人工作空间"`、`"author": "Life Atlas"`、`"main": "electron/main/index.js"`；
   - `"scripts"` 增加 4 个（不改已有脚本）：

     ```json
         "desktop:dev": "node scripts/desktop-dev.mjs",
         "desktop:build": "node scripts/desktop-build.mjs release",
         "desktop:build:test": "node scripts/desktop-build.mjs test",
         "test:e2e:desktop": "node --test --test-concurrency=1 --test-reporter=spec \"tests/desktop/*.e2e.mjs\"",
     ```

2. 新建 `electron-builder.yml`，内容正好是：

   ```yaml
   appId: com.medax.lifeatlas
   productName: Life Atlas
   asar: true
   files:
     - dist/client/**
     - electron/**
     - src/**/*.js
     - package.json
   win:
     target:
       - nsis
       - dir
   nsis:
     oneClick: false
     perMachine: false
     allowToChangeInstallationDirectory: true
   ```

3. 新建 `scripts/desktop-build.mjs`：用法 `node scripts/desktop-build.mjs release` 或 `test`，后面可以再跟一个可选参数 `--version <x.y.z>`（必须匹配 `/^\d+\.\d+\.\d+$/`；有它时在第 2 步的参数末尾追加 `-c.extraMetadata.version=<x.y.z>`，只改打包出来的程序版本，不改 `package.json`）。其他参数或格式不对时报错退出（退出码 64）。依次：
   1. `spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], { stdio: "inherit" })`；
   2. `spawnSync(process.execPath, ["node_modules/electron-builder/cli.js", "--config", "electron-builder.yml", "--win", ...(flavor === "test" ? ["dir"] : []), "-c.directories.output=release/" + flavor, "-c.extraMetadata.lifeAtlasFlavor=" + flavor], { stdio: "inherit" })`；
   任一步退出码不是 0 就以同样的退出码退出。

### 步骤 4：主进程基础模块（纯逻辑，可单测）

新建下列文件（都不 `import "electron"`，除非写明）：

1. `electron/main/flavor.js`（**可以** import electron）：导出 `flavor`（`"dev"`/`"test"`/`"release"`，规则见 02 第 10 节）、`testHooksEnabled`、`readPackageJson()`。
2. `electron/main/storage/dataRoot.js`：
   - `resolveDataRoot({ env, bootstrapFile, flavor, repoRoot }) → { dataRoot, source }`：顺序 `env.LIFE_ATLAS_DATA_ROOT` → `bootstrapFile` 里的 `dataRoot` → `flavor === "dev"` 时 `<repoRoot>\.devdata` → 都没有返回 `{ dataRoot: null, source: null }`；`source` 取 `"env"`、`"bootstrap"`、`"dev-default"`；
   - `bootstrapFilePath({ appDataDir, env, testHooksEnabled })`：测试钩子开启且有 `LIFE_ATLAS_BOOTSTRAP_DIR` 时用它，否则 `<appDataDir>\Life Atlas\bootstrap.json`；
   - `ensureDataRootMarker(dataRoot, { appVersion, now })`：目录不存在就创建；`life-atlas.root.json` 不存在就写入 02 第 3 节的内容；已存在但 `kind` 不对 → 抛错；
   - `acquireDataRootLock(dataRoot, { pid, appVersion, now, isProcessAlive }) → { ok: true } 或 { ok: false, heldByPid }`：规则见 02 第 3 节；
   - `releaseDataRootLock(dataRoot, pid)`：`.lock` 里的 `pid` 是自己时才删除；
   - `isSyncDrivePath(p)`：02 第 3 节的 5 个关键词，不区分大小写。
3. `electron/main/logger.js`：`createLogger({ logsDir, now })` → `{ log(event, fields) }`；每行一个 JSON：`{ at, event, ...fields }`，写入 `logs\YYYY-MM-DD.log`；创建时删除 14 天前的日志文件；`fields` 只允许字符串 ID、数字、布尔值和错误码（其他类型直接丢弃）。
4. `electron/main/ipc/result.js`：`ok(value)`、`fail(code, message, extra)`；`electron/main/ipc/validate.js`：`isNonEmptyString(value, max)`、`isPlainObject(value)`、`oneOf(value, list)`。
5. `electron/main/appPaths.js`：`resolveAppFile(distDir, requestUrl) → 绝对路径或 null`：只接受 `app://bundle/…`；路径解码后必须仍在 `distDir` 内；`/` 映射到 `index.html`；文件不存在返回 `null`。还有 `contentTypeFor(file)`：`.html .js .mjs .css .svg .png .jpg .jpeg .webp .gif .ico .json .woff .woff2 .wasm .txt` 的标准 MIME，其他 `application/octet-stream`。
6. `electron/main/networkPolicy.js`：`shouldBlockRequest(url, { devOrigin }) → boolean`：`http:`、`https:`、`ws:`、`wss:` 一律阻止，只有 `devOrigin`（如 `http://127.0.0.1:5199`）及其 `ws://` 形式放行。

新建 `tests/desktop-main-units.test.mjs`，用例：

- `resolveDataRoot prefers env, then bootstrap, then the dev default`
- `bootstrapFilePath uses LIFE_ATLAS_BOOTSTRAP_DIR only when test hooks are enabled`
- `ensureDataRootMarker creates the marker once and rejects a foreign marker`
- `acquireDataRootLock reports a live holder and recovers a stale lock`（`isProcessAlive` 用注入的假函数）
- `releaseDataRootLock removes only its own lock`
- `isSyncDrivePath detects the five sync folder names`
- `logger writes one json line per event and drops content fields`（传入 `{ title: { x: 1 } }` 这类对象字段会被丢弃）
- `resolveAppFile refuses traversal and maps the root to index.html`
- `shouldBlockRequest blocks the web and allows only the dev server`

提交 `WP-03: main process helper modules`。

### 步骤 5：协议、安全、窗口与 IPC（需要 Electron 的部分）

1. `electron/main/dialogs.js`：导出 `showMessageBox(window, options)`、`showSaveDialog(window, options)`、`showOpenDialog(window, options)`、`showErrorBox(title, content)`、`openExternal(url)`。测试钩子开启时按 11 第 5 节的 `__lifeAtlasDialogs` 规则工作（`openExternal` 只记录不打开）；否则调用 Electron 的 `dialog` / `shell`。**全项目的主进程代码只通过这个模块使用对话框和 `shell.openExternal`。**
2. `electron/main/protocols.js`：
   - `registerAppScheme()`：`protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }])`（ready 之前调用）；
   - `installAppProtocol(targetSession, { distDir, csp })`：`targetSession.protocol.handle("app", …)`，用 `resolveAppFile`；找不到返回 404；每个响应带 `Content-Type` 与 `X-Content-Type-Options: nosniff`；`.html` 响应额外带 `Content-Security-Policy: <csp>`。
3. `electron/main/security.js`：
   - `WORKSPACE_CSP`：02 第 7 节工作区 CSP 的原文；
   - `installSessionSecurity(targetSession, { devOrigin, logger, networkLog })`：`webRequest.onBeforeRequest` 用 `shouldBlockRequest` 取消并记录（`networkLog.blocked.push({ url, at })`、`logger.log("network.blocked", { host })`）；`webRequest.onCompleted` 把 http(s)/ws(s) 的完成请求记到 `networkLog.completed`；`setPermissionRequestHandler` 与 `setPermissionCheckHandler`：只允许 `clipboard-sanitized-write`，其余一律拒绝；`will-download`：只接受 `blob:` 与 `data:` 来源；
   - `installContentsGuards(contents, { allowedPrefix, onExternalUrl })`：`will-navigate` 到 `allowedPrefix` 以外的地址一律 `preventDefault()`，其中 http(s) 地址交给 `onExternalUrl(url)`；`setWindowOpenHandler(({ url }) => { 若是 http(s)，调用 onExternalUrl(url)；return { action: "deny" }; })`。
4. `electron/main/externalLinks.js`：`confirmAndOpenExternal(window, url)`：只接受 `http:`、`https:`、`mailto:`；用 `dialogs.showMessageBox` 弹框（`type: "question"`、`buttons: ["打开", "取消"]`、`defaultId: 1`、`cancelId: 1`、`message: "在浏览器中打开这个网址？"`、`detail: <完整网址>`）；选“打开”才 `dialogs.openExternal(url)`；返回 `{ opened }`。
5. `electron/main/windows.js`：`createWorkspaceWindow({ preload, url })`：1440×900，最小 960×600，`webPreferences` 严格照 02 第 7 节；`ready-to-show` 再显示；`installContentsGuards`，`allowedPrefix` 为加载用的地址前缀（`app://bundle/index.html` 或开发地址）。
6. `electron/main/ipc/app.js`：注册 `la:app:get-info`（返回 11 第 1 节规定的字段）与 `la:app:open-external`（参数校验：`url` 是 ≤ 2048 字符的字符串；调用 `confirmAndOpenExternal`）。发送方必须是工作区窗口。
7. `electron/main/testHooks.js`：`installTestHooks()`：创建 `globalThis.__lifeAtlasNetworkLog = { blocked: [], completed: [] }`、`globalThis.__lifeAtlasDialogs = { queue: { showMessageBox: [], showSaveDialog: [], showOpenDialog: [] }, calls: [] }`。只在 `testHooksEnabled` 时调用。
8. `electron/preload/workspace.cjs`：`contextBridge.exposeInMainWorld("lifeAtlas", { platform: "desktop", app: { getInfo: () => ipcRenderer.invoke("la:app:get-info"), openExternal: (args) => ipcRenderer.invoke("la:app:open-external", args) } })`。不暴露其他任何东西。

### 步骤 6：启动顺序

新建 `electron/main/index.js`，严格按 02 第 3.1 节的 11 步（本 WP 的第 9 步：有数据目录就创建工作区窗口；没有数据目录时 `dialogs.showErrorBox("未找到数据目录", "请设置 LIFE_ATLAS_DATA_ROOT，或等待首次启动向导（下一阶段提供）。")` 后退出）。补充：

- 加载地址：`flavor === "dev"` 且设置了 `LIFE_ATLAS_DEV_URL` → 用它（`devOrigin` 就是它的 origin）；否则 `app://bundle/index.html`，`distDir = path.join(app.getAppPath(), "dist", "client")`。
- 开发冒烟：`flavor === "dev"` 且 `LIFE_ATLAS_DEV_SMOKE === "1"` 时，窗口 `did-finish-load` 后 1 秒在标准输出打印 `LIFE_ATLAS_DEV_SMOKE_OK` 并退出（退出码 0）。
- 日志：`createLogger({ logsDir: <DataRoot>\logs })`，记录 `app.start`（带 `flavor`）、`window.created`、`app.quit`。
- 退出：`before-quit` 时 `releaseDataRootLock`。

验证（开发模式，从构建产物加载）：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-03/build.log npm run build
$env:LIFE_ATLAS_DATA_ROOT = "$env:TEMP\life-atlas-wp03-manual"
node docs/blueprint/tools/run-logged.mjs .qa/WP-03/manual-start.log node -e "const { spawnSync } = require('child_process'); const r = spawnSync(require('electron'), ['.'], { env: { ...process.env, LIFE_ATLAS_DEV_SMOKE: '1' }, timeout: 60000 }); console.log('exit', r.status);"
Remove-Item Env:LIFE_ATLAS_DATA_ROOT
```

注意：上面没有设置 `LIFE_ATLAS_DEV_URL`，所以 `LIFE_ATLAS_DEV_SMOKE` 在 `app://` 加载完成后同样生效（冒烟规则只看 flavor 和这个变量）。期望日志里有 `exit 0`。

**主进程依赖守卫**：安装包里只有 `dependencies` 里的包（步骤 1），主进程一旦加载了别的包（例如通过 `src/domain/pageExport.js` 间接加载 `jszip`），打包版启动就会报 “Cannot find module”。新建 `tests/main-process-imports.test.mjs`（照抄）：

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRIES = ["electron/main/index.js", "electron/preload/workspace.cjs", "electron/preload/vault.cjs", "electron/preload/setup.cjs"];
const ALLOWED = new Set(["electron", "yazl", "yauzl", "hash-wasm", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const SPECIFIER = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|export\s[^'"]*?from\s*|require\s*\(\s*)['"]([^'"]+)['"]|new\s+URL\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url/g;

function collectImports() {
  const seen = new Set();
  const found = [];
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const match of fs.readFileSync(file, "utf8").matchAll(SPECIFIER)) {
      const spec = match[1] ?? match[2];
      if (!spec.startsWith(".")) { found.push({ spec, file }); continue; }
      let target = path.resolve(path.dirname(file), spec);
      if (!fs.existsSync(target)) target = [".js", ".mjs", ".cjs"].map((ext) => target + ext).find((candidate) => fs.existsSync(candidate)) || target;
      if (fs.existsSync(target) && fs.statSync(target).isFile()) visit(target);
      else found.push({ spec: `（找不到的相对路径）${spec}`, file });
    }
  };
  for (const entry of ENTRIES) if (fs.existsSync(path.join(root, entry))) visit(path.join(root, entry));
  return { seen, found };
}

test("main process code only loads packages that ship with the app", () => {
  const { seen, found } = collectImports();
  assert.ok(seen.size > 0, "electron/main/index.js 不存在");
  const packageName = (spec) => spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
  const bad = found.filter(({ spec }) => !ALLOWED.has(spec) && !ALLOWED.has(packageName(spec)));
  assert.deepEqual(bad.map(({ spec, file }) => `${spec} ← ${path.relative(root, file)}`), []);
});
```

这个测试以后每个 WP 都会随 `npm test` 运行。它失败时，说明主进程（或它加载的 `src/` 模块）用到了不在安装包里的包：把主进程需要的那部分纯逻辑挪到不依赖这些包的模块里，**不要**把包加进 `dependencies`，也不要改这个测试。

提交 `WP-03: electron main process, preload and startup order`。

### 步骤 7：开发脚本

新建 `scripts/desktop-dev.mjs`：

1. 端口固定 `5199`（不要用 5178、4173、4175）。启动 `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5199 --strictPort`。
2. 每 300 ms 用 `fetch("http://127.0.0.1:5199")` 探测，最多 30 次；就绪后启动 Electron：`spawn(require("electron") 的路径, ["."], { stdio: "inherit", env: { ...process.env, LIFE_ATLAS_DEV_URL: "http://127.0.0.1:5199" } })`（ESM 里用 `import electronPath from "electron"`）。
3. 带参数 `--smoke` 时，给 Electron 的环境变量再加 `LIFE_ATLAS_DEV_SMOKE: "1"`。
4. 任一子进程退出时结束另一个，并以 Electron 的退出码退出。只结束自己启动的进程。

验证：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-03/desktop-dev-smoke.log npm run desktop:dev -- --smoke
```

期望日志里有 `LIFE_ATLAS_DEV_SMOKE_OK`，最后一行 `exit=0`。

提交 `WP-03: desktop dev script`。

### 步骤 8：渲染进程的改动（预览提示条与输入对话框）

1. 开发预览提示条：`window.lifeAtlas?.platform === "desktop"` 时，在 `App` 根元素最上方显示一行低调提示（复用现有的次要文字样式，不要新视觉风格）：`开发预览：桌面存储将在下一阶段接入，请不要在这里录入真实数据。`（WP-04 会删除它）。给这个元素加 `data-testid="desktop-preview-banner"`。
2. 浏览器模式行为完全不变（`window.lifeAtlas` 不存在时什么都不做）。
3. **产品输入对话框**（第 2 节：Electron 里 `window.prompt` 会抛错）。新建两个文件：
   - `src/ui/dialogService.js`（不依赖 React）：

     ```js
     let host = null;
     export function setDialogHost(next) { host = next; }
     function requireHost() {
       if (!host) throw new Error("对话框还没有准备好");
       return host;
     }
     // → Promise<string | null>；用户取消时为 null
     export function promptDialog({ title, label, defaultValue = "", placeholder = "", confirmLabel = "确定", validate } = {}) {
       return requireHost().prompt({ title, label, defaultValue, placeholder, confirmLabel, validate });
     }
     // 下面两个先写好，WP-17 用它们替换 window.confirm 和 window.alert
     export function confirmDialog({ title, message, confirmLabel = "确定", cancelLabel = "取消", danger = false } = {}) {
       return requireHost().confirm({ title, message, confirmLabel, cancelLabel, danger });
     }
     export function alertDialog({ title, message, confirmLabel = "知道了" } = {}) {
       return requireHost().alert({ title, message, confirmLabel });
     }
     ```

   - `src/ui/DialogHost.jsx`：在 `App` 根元素里渲染一次；挂载时 `setDialogHost({ prompt, confirm, alert })`，卸载时 `setDialogHost(null)`；内部用一个队列，一次只显示一个对话框，用现有的 `.ui-dialog` 样式：
     - 输入框：`<form role="dialog" aria-modal="true" aria-label={title} data-la-dialog="prompt">`，标题、`<input aria-label={label} autoFocus>`（初始值 `defaultValue`）、`validate(值)` 返回的错误显示在输入框下方（`role="alert"`，有错误时“确定”不可用）、按钮“取消”（`data-la-dialog-cancel`）和确认按钮（`type="submit"`，`data-la-dialog-confirm`）。`Enter` 提交，`Esc` 取消（结果为 `null`）。
     - 确认框：`role="alertdialog"`、`aria-label={title}`、`data-la-dialog="confirm"`；说明文字；两个按钮带同样的 `data-la-dialog-cancel` / `data-la-dialog-confirm`；`danger` 为真时确认按钮用红色（`is-danger`），初始焦点在“取消”上，否则在确认按钮上；`Esc` 等于取消（结果为 `false`）。
     - 提示框：`role="alertdialog"`、`data-la-dialog="alert"`，只有一个按钮（`data-la-dialog-confirm`）。
   - 把 `src/` 里全部 `window.prompt` 换成 `await promptDialog({ … })`（所在的处理函数改成 `async`；原来的 `title` 参数作为 `label`，`title` 用同样的文字）：`src/components/DatabaseView.jsx`（重命名数据源）、`src/components/PropertyEditor.jsx`（新建成员、重命名成员、添加链接附件的地址和名称，共 4 处）、`src/editor/lifeAtlasSchema.jsx`（Callout 图标）、`src/editor/Mentions.jsx`（选择日期、补全日期，2 处）。用 `git grep -n "window.prompt" -- src` 确认一处都不剩。
   - 新建 `tests/no-native-prompt.test.mjs`：`source never calls window prompt`（读取 `src/` 下全部 `.js`/`.jsx`，不包含 `window.prompt`）。

提交 `WP-03: desktop preview banner and product prompt dialog`。

### 步骤 9：端到端测试框架与用例

1. 新建 `tests/desktop/helpers.mjs`，导出：
   - `REPO_ROOT`；`PACKAGED_EXE = <REPO_ROOT>\release\test\win-unpacked\Life Atlas.exe`；
   - `async launchApp({ packaged = false, dataRoot, bootstrapDir, env = {} } = {})`：`dataRoot` 未传时新建临时目录（`fs.mkdtempSync(path.join(os.tmpdir(), "life-atlas-test-"))`），传 `null` 表示**不设置** `LIFE_ATLAS_DATA_ROOT`（同时从继承来的 `process.env` 副本里删掉它）；`bootstrapDir` 未传时同样新建临时目录；环境变量固定加 `LIFE_ATLAS_TEST: "1"`、`LIFE_ATLAS_BOOTSTRAP_DIR`；`packaged` 为假时 `executablePath` 用 `electron` 包导出的路径、`args: [REPO_ROOT]`，为真时用 `PACKAGED_EXE`、`args: []`；拿到 `firstWindow()`；记录 `pageerror` 和控制台 error；返回 `{ app, page, dataRoot, bootstrapDir, errors }`；
   - `async closeApp(handle, { keepDirs = false } = {})`：关闭应用并删除两个临时目录；
   - `async readNetworkLog(handle)`、`async queueDialogResponse(handle, kind, response)`、`async readDialogCalls(handle)`（都通过 `handle.app.evaluate`）；
   - `async seedBrowserStorageWorkspace(handle, workspace)`（只在 WP-03 阶段使用，WP-04 改为数据库夹具）：`await handle.app.context().addInitScript(([key, json]) => { if (!sessionStorage.getItem("la-e2e-seeded")) { localStorage.setItem(key, json); sessionStorage.setItem("la-e2e-seeded", "1"); } }, [workspaceStorageKey, JSON.stringify(workspace)])`，然后 `await handle.page.reload()`。不要用“先 `localStorage.setItem` 再刷新”的做法：刷新前页面的 `beforeunload` 保存会把旧数据写回去；`workspaceStorageKey` 从 `src/persistence/workspaceRepository.js` 导入；
   - `async assertNoNetworkAndErrors(handle, { allowedUrls = [] } = {})`：`completed` 里不能有任何 http(s)/ws(s)；`blocked` 里只能有 `allowedUrls` 开头的地址；控制台 error 和 `pageerror` 里只能出现包含 `allowedUrls` 之一的消息；
   - 运行前检查 `dist/client/index.html` 存在，不存在时抛错“请先运行 npm run build”；`packaged` 为真时检查 exe 存在，不存在时抛错“请先运行 npm run desktop:build:test”。
2. 新建 `tests/desktop/shell.e2e.mjs`（`node:test` 写法；每个用例自己 `launchApp`/`closeApp`；每个用例最后都调用 `assertNoNetworkAndErrors`）。用例名照抄：
   - `window loads the existing interface`：等到侧栏出现（`.workspace-sidebar`）和 `data-testid="desktop-preview-banner"`；截图 `.qa/WP-03/desktop-window.png`（1440×900）。
   - `renderer has no node access`：`typeof require`、`typeof process`、`typeof module` 都是 `"undefined"`；`window.lifeAtlas.platform === "desktop"`；`window.lifeAtlasVault === undefined`。
   - `app documents carry the exact workspace CSP`：渲染进程里 `fetch("app://bundle/index.html")` 的 `content-security-policy` 响应头与 02 第 7 节工作区 CSP 原文完全相同。
   - `navigation and new windows are blocked`：`location.href = "https://example.com/"` 之后 1 秒地址仍以 `app://bundle/index.html` 开头；`window.open("https://example.com/")` 返回 `null` 且 `BrowserWindow.getAllWindows().length === 1`；`navigator.mediaDevices.getUserMedia({ audio: true })` 被拒绝。`allowedUrls: ["https://example.com/"]`。
   - `remote content never reaches the network`：用 `seedBrowserStorageWorkspace` 放入 `upgradeWorkspace(fullWorkspace())`，并在 p-a1 的正文末尾加一个 `{ id: "b-remote-img", type: "image", props: { url: "https://example.com/a.png", name: "remote", caption: "" } }`；依次打开“Z 目标页”“B 笔记”“A 概览”三个页面（A 概览含远程图片），在“A 概览”正文末尾输入 `/` 打开斜杠菜单再按 `Escape`；`completed` 里没有任何 http(s) 请求。`allowedUrls: ["https://example.com/a.png"]`。
   - `external links ask before opening`：`page.evaluate(() => { const a = document.createElement("a"); a.href = "https://example.com/x"; document.body.appendChild(a); a.click(); a.remove(); })` → 等 1 秒 → `readDialogCalls` 里有一次 `showMessageBox`，`options.detail` 是 `https://example.com/x`，因为队列为空按“取消”处理，所以没有 `openExternal` 记录；再 `queueDialogResponse(handle, "showMessageBox", { response: 0 })` 后重复点击 → 出现一次 `openExternal` 记录，网址相同。`allowedUrls: ["https://example.com/x"]`。
   - `second instance exits and keeps one window`：在第一个实例运行时，用 `child_process.spawn` 以**相同的** `LIFE_ATLAS_DATA_ROOT` 再启动一次（开发模式：`electron` 路径 + `[REPO_ROOT]`），5 秒内退出；第一个实例仍然只有 1 个窗口。
   - `session data stays inside the data root`：`app.getPath("userData")`、`app.getPath("sessionData")` 都等于 `<dataRoot>\runtime`，`app.getPath("crashDumps")` 等于 `<dataRoot>\runtime\crashes`；`bootstrapDir` 是空目录。
   - `packaged build disables devtools and spellcheck`：`launchApp({ packaged: true })`；主进程里对窗口调用 `webContents.openDevTools()` 后 `isDevToolsOpened() === false`；`webContents.getLastWebPreferences().spellcheck === false`；`app.getInfo()` 返回的 `flavor === "test"`、`isPackaged === true`。
   - `the packaged app contains only runtime files`（不启动应用，只读文件）：读取 `release\test\win-unpacked\resources\app.asar` 的目录表——
     ```js
     const bytes = fs.readFileSync(asarPath);
     const headerSize = bytes.readUInt32LE(12);
     const header = JSON.parse(bytes.subarray(16, 16 + headerSize).toString("utf8"));
     ```
     `Object.keys(header.files)` 的每一项都属于 `["dist", "electron", "src", "package.json", "node_modules"]`；如果有 `node_modules`，`Object.keys(header.files.node_modules.files)` 的每一项都属于 `["yazl", "yauzl", "hash-wasm", "buffer-crc32", "pend"]`；`app.asar` 小于 80 MB；`resources\app.asar.unpacked` 不存在。
   - `prompts use the product dialog on desktop`：用 `seedBrowserStorageWorkspace` 放入 `upgradeWorkspace(fullWorkspace())`；打开“整页项目库”→ 点 `aria-label="数据源 整页项目库"` 的按钮 → “重命名数据源”→ 出现 `[data-la-dialog="prompt"]` → 输入框填“改名测试”→ 点 `[data-la-dialog-confirm]` → 数据源按钮的文字变为“改名测试”；没有 `pageerror`（不会出现 `prompt() is not supported`）。
3. 打包测试版并运行：

   ```powershell
   node docs/blueprint/tools/run-logged.mjs .qa/WP-03/desktop-build-test.log npm run desktop:build:test
   node docs/blueprint/tools/run-logged.mjs .qa/WP-03/desktop-e2e.log npm run test:e2e:desktop
   ```

   期望都 `exit=0`。

提交 `WP-03: desktop e2e harness and shell tests`。

### 步骤 10：正式版打包

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-03/desktop-build-release.log npm run desktop:build
Get-FileHash -Algorithm SHA256 -LiteralPath 'release\release\Life Atlas Setup 0.1.0.exe'
(Get-Item -LiteralPath 'release\release\Life Atlas Setup 0.1.0.exe').Length
```

把安装包的大小与 SHA-256 写进报告第 3 节。**不要**运行安装包。

### 步骤 11：收尾【停止点】

1. 浏览器模式不受影响：`node docs/blueprint/tools/run-logged.mjs .qa/WP-03/browser-all.log npm run test:parity:browser` 必须 `exit=0`。
2. 填完报告；第 0 节全部“完成”；提交 `WP-03: complete report`。
3. 运行：

   ```powershell
   node docs/blueprint/tools/wp-check.mjs WP-03 --browser --desktop
   ```

   退出码 0 或 2 → 停止。

## 4. 范围

### 必做

第 3 节全部步骤。

### 不做

- SQLite、附件文件化、首次启动向导、备份恢复的桌面实现（WP-04/05）。
- 密钥库窗口（WP-07）；`vault.html`、`setup.html` 入口（WP-05/07）。
- Electron Fuses、ASAR 完整性（WP-11）、代码签名、自动更新（永远不做）、正式图标（WP-19）。
- 修改现有界面功能（第 3 节步骤 2、8 除外）。

## 5. 验收标准

| 编号 | 标准 | 证据 |
| --- | --- | --- |
| AC-03-1 | 桌面窗口加载现有界面（侧栏可见、预览提示条可见）；`npm run desktop:dev -- --smoke` 成功 | `tests/desktop/shell.e2e.mjs`「window loads the existing interface」；`.qa/WP-03/desktop-window.png`；`.qa/WP-03/desktop-dev-smoke.log` |
| AC-03-2 | 测试版与正式版都能打包；正式版安装包的大小与 SHA-256 已记录；端到端测试用测试版 exe 启动成功 | `.qa/WP-03/desktop-build-test.log`、`.qa/WP-03/desktop-build-release.log`；「packaged build disables devtools and spellcheck」 |
| AC-03-3 | 渲染进程没有 Node；`window.lifeAtlas.platform === "desktop"`；没有 `window.lifeAtlasVault` | 「renderer has no node access」 |
| AC-03-4 | `app://` 的文档响应带 CSP 头，内容与 02 第 7 节完全一致 | 「app documents carry the exact workspace CSP」 |
| AC-03-5 | 导航、新窗口、媒体权限都被拒绝 | 「navigation and new windows are blocked」 |
| AC-03-6 | 打开多个页面、斜杠菜单、远程图片之后，没有任何完成的 http(s) 请求 | 「remote content never reaches the network」 |
| AC-03-7 | 打包版打不开开发者工具；拼写检查关闭；flavor 为 `test` | 「packaged build disables devtools and spellcheck」 |
| AC-03-8 | 同一数据目录的第二个实例 5 秒内退出，始终只有一个窗口 | 「second instance exits and keeps one window」 |
| AC-03-9 | userData、sessionData、crashDumps 都在 `<DataRoot>\runtime` 里；bootstrap 目录没有被写入 | 「session data stays inside the data root」 |
| AC-03-10 | 外部链接经主进程确认框；取消时不打开，确认时调用一次 `openExternal` | 「external links ask before opening」 |
| AC-03-11 | 源码里没有在线字体；界面仍使用 DM Sans（本地文件） | 步骤 2 的 `git grep` 输出（贴进报告）；`npm run build` 产物里有 `dm-sans` 字体文件 |
| AC-03-12 | 主进程辅助模块的单元测试全部通过 | `tests/desktop-main-units.test.mjs` |
| AC-03-13 | 浏览器模式不受影响；G1–G9 | `.qa/WP-03/browser-all.log`；`.qa/WP-03/wp-check.md` |
| AC-03-14 | 源码里没有 `window.prompt`；桌面版的输入对话框可用 | `tests/no-native-prompt.test.mjs`；「prompts use the product dialog on desktop」 |
| AC-03-15 | `dependencies` 为空，15 个界面与构建用的包已原样移到 `devDependencies`；安装包里只有运行时文件（没有界面依赖、构建工具和原生二进制）；主进程只加载随安装包发布的包 | `tests/package-layout.test.mjs`；`tests/main-process-imports.test.mjs`；「the packaged app contains only runtime files」 |

## 6. 卡点处理

| 情况 | 做法 |
| --- | --- |
| `node_modules/electron/dist` 不存在或运行 Electron 时提示下载 | 运行 `node node_modules/electron/install.js`；仍失败就停下报告完整输出 |
| electron-builder 报错要下载东西（例如 winCodeSign） | 先在 `electron-builder.yml` 的 `win:` 下加 `signAndEditExecutable: false` 再试一次，并写进报告第 5 节；仍失败就停下 |
| `_electron.launch` 超时 | 确认没有残留的 Electron 进程占用同一个数据目录（每个用例用新临时目录）；确认 `dist/client` 已构建；仍超时就停下，附 `.qa/WP-03/desktop-e2e.log` |
| 测试时弹出了真实的对话框 | 你绕过了 `electron/main/dialogs.js`，改为通过它调用 |
| CSP 报 `script-src` 违规（不是远程图片） | 说明某个依赖用了 `eval`/`new Function`；停下报告是哪个文件，不要放宽 CSP |
| `webContents.getLastWebPreferences` 不存在 | 改为断言 `webContents.session.getSpellCheckerLanguages()` 返回空数组，并写进报告第 5 节 |
| 端口 5199 被占用 | 不要换端口；`Get-NetTCPConnection -LocalPort 5199` 看是谁占用，是你之前启动的 node 就结束它，否则停下报告 |
