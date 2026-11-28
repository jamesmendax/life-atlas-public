# WP-19 打包发布与总验收

- 规模：L · 前置：WP-18 · 分支：`wp/19-release`
- 停止点：步骤 0（理解确认）、步骤 1（图标方向闸门）、步骤 9（自动化验收全部完成）、步骤 13（收尾）
- 必读：`01-需求与范围.md` 第 2 节（R1–R8）、第 3 节（功能矩阵）、第 5 节（决策）；`03-密钥库安全设计.md` 第 2 节（防得住和防不住的情况）；`07-验收协议.md`；`09-执行手册.md`；`02-总体架构.md` 第 10、11 节；`docs/blueprint/assets/icons/`；`docs/blueprint/tools/render-icon.mjs`、`png-to-ico.mjs`、`license-report.mjs` 文件开头的说明；WP-05 第 3.5 节（`pre-upgrade` 快照）；WP-11 步骤 6（正式版加固与 `tests/desktop/release-hardening.e2e.mjs`）；`tests/desktop/helpers.mjs`；`tests/vault-plaintext.test.mjs`（WP-06，在普通 Node 里建密钥库的写法）；`tests/desktop/vault.e2e.mjs`（WP-07，打开和解锁密钥库窗口的写法）；`tests/desktop/backup-v2.e2e.mjs`（WP-08，含密钥库导出和确认请求的写法）；`docs/blueprint/reports/` 下全部报告；`12-视觉规范-墨白.md` 第 2、11 节（白天和夜间）；WP-05 加在 `tests/desktop/helpers.mjs` 里的 `shootWindowBothModes`

## 0. 一页纸

- **要做到**：做出可以长期安装使用的 1.0.0 正式版（有图标、中文安装界面、卸载不删数据），用自动化测试证明安装、升级、卸载不丢数据，性能达标，全流程没有明文泄露和网络请求；写好用户手册和总验收报告；最后由用户亲手做一遍 6 步验收。
- **交付物**：版本号 1.0.0；`build/icon.svg`、`build/icons/`、`build/icon.ico`；`build/installer.nsh`；`electron-builder.yml` 与 `scripts/desktop-build.mjs` 的修改；`THIRD_PARTY_NOTICES.md`（随安装包发布）；`tests/fixtures/release-workspace.mjs`、`tests/desktop/seed-vault.mjs`、`tests/release/helpers.mjs`；3 个测试文件 `tests/release/installer-lifecycle.e2e.mjs`、`performance.e2e.mjs`、`security-sweep.e2e.mjs`；截图脚本 `tests/release/manual-screenshots.e2e.mjs`；`docs/用户手册.md` 与 `docs/manual-images/`；`docs/blueprint/reports/FINAL-ACCEPTANCE.md`。
- **绝对不要**：增加任何功能；改变产品行为（只有影响数据安全的缺陷可以修，见第 6 节）；代码签名、自动更新、联网；安装、升级或卸载**真实的** Life Atlas（自动化测试只用名字不同的“安装测试版”，见 2.3 节）；读写用户真实的数据目录、`%APPDATA%\Life Atlas\`；双击运行正式版安装包；修改 `docs/blueprint/` 下除 `reports/WP-19-report.md`、`reports/FINAL-ACCEPTANCE.md` 以外的文件。
- **什么时候停**：步骤 0、步骤 1、步骤 9 之后各停一次；步骤 13 的 wp-check 退出码为 0 或 2 时停。

## 1. 已知事实（总设计师 2026-11-01 在本机临时项目里实测）

| 事实 | 对你的影响 |
| --- | --- |
| electron-builder 的 NSIS 安装包（`oneClick: false`、`perMachine: false`）支持静默安装：`"<安装包>" /S /D=<目录>`（`/D=` 必须是最后一个参数，路径不加引号，路径里不能有空格），退出码 0，约 5 秒 | 2.3 节的测试照这个写；临时目录用 `os.tmpdir()` |
| 在已安装的目录上再静默运行新版本安装包（只加 `/S`）会**原地升级**：同一个目录，`app.getVersion()` 变成新版本 | 升级测试照这个写 |
| 静默卸载 `"<目录>\Uninstall <产品名>.exe" /S`：进程很快返回，但文件要再过几秒才删完（实测约 6 秒）；删完后安装目录、开始菜单快捷方式、注册表卸载项都没了；`%APPDATA%` 下的文件夹**保留**（`deleteAppDataOnUninstall: false`） | 测试里轮询“exe 不存在”最多 60 秒 |
| 每个安装在 `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<编号>` 下有一项：`DisplayName` 是 `<产品名> <版本>`，`DisplayVersion` 是版本，`QuietUninstallString` 是 `"<目录>\Uninstall <产品名>.exe" /currentuser /S` | 测试按 `DisplayName` 前缀查找 |
| `-c.extraMetadata.version=0.9.0` 同时改变打包后 `app.getVersion()` 和安装包文件名（`<产品名> Setup 0.9.0.exe`） | 旧版本安装包这样造 |
| `taskkill /PID <主进程 pid>`（**不加** `/F`）会让 Electron 正常退出：`before-quit`、`will-quit` 都触发，退出码 0 | 不能用 Playwright 的正式版用它关闭（退出时会保存并删除 `.lock`） |
| `win.icon` 用 `.png` 时 electron-builder 会**联网下载**图标转换工具；用 `.ico` 不需要 | 图标一律用 `render-icon.mjs` 生成的 `build/icon.ico` |
| `nsis.include` 里的 `!macro customUnInit` + `MessageBox … /SD IDOK`：手动卸载时弹出说明；静默卸载（包括升级时旧版本的自动卸载，它带 `/S`）不会卡住 | 2.3 节的卸载提示照抄 |
| electron-builder 调用 makensis 时带 `-INPUTCHARSET UTF8`，`installer.nsh` 用普通 UTF-8 保存即可 | 不需要 BOM |
| `extraFiles: [{ from: THIRD_PARTY_NOTICES.md, to: THIRD_PARTY_NOTICES.md }]` 会把文件放在 exe 旁边 | 许可证文件这样随安装包发布 |
| `license-report.mjs` 在本项目现在的依赖上运行：106 个包，0 个需要处理；带 LGPL 组件的 `sharp` 只用于生成封面，按构建工具排除 | 步骤 4 期望 `problems=0` |
| 加了 Fuses 的正式版不能用 Playwright 启动；`LIFE_ATLAS_DATA_ROOT` 在正式版里仍然有效（它不是测试钩子，02 第 3 节） | 安装、升级测试用 `child_process.spawn` 加这个环境变量启动，绝不读取真实数据目录 |
| `pre-upgrade` 快照在渲染进程第一次调用 `workspace.load()` 时创建（WP-05 第 3.5 节），也就是窗口打开后几秒内；日志里有 `app.start`、`window.created`（WP-03） | 升级测试等到日志出现 `window.created` 后再等 8 秒，然后正常关闭，关闭后再检查 |

## 2. 设计要点（规定）

### 2.1 版本号

`package.json` 的 `"version"` 改为 `"1.0.0"`。“关于 Life Atlas”里显示的就是它（`app.getVersion()`）。

### 2.2 图标（视觉闸门）

- 总设计师准备了 3 个方向：`docs/blueprint/assets/icons/icon-A.svg`（「墨页」：深色底上一张纸页和一张紫色衬页）、`icon-B.svg`（「星图」：深靛色底上连成星座的知识节点）、`icon-C.svg`（「时间线」：浅纸色底上带节点和卡片的 PPT 式时间线）；对照图 `docs/blueprint/assets/icons/icon-directions.png`（各尺寸在深色、浅色任务栏上的效果）。
- 用户选定后：把选中的 SVG **原样**复制为 `build/icon.svg`，然后运行 `node docs/blueprint/tools/render-icon.mjs build/icon.svg build/icons`，再把 `build/icons/icon.ico` 复制为 `build/icon.ico`。`build/` 目录整个提交（图标是源文件，不是构建产物）。
- 不要修改 SVG；用户要求修改时，把修改意见写进报告第 5 节，停下等总设计师出新稿。

### 2.3 安装包与“安装测试版”

- `electron-builder.yml`：把 `win:` 和 `nsis:` 两段整体换成下面的内容，并在文件末尾加上 `extraFiles:` 段；`appId`、`productName`、`asar`、`files` 不动：

  ```yaml
  extraFiles:
    - from: THIRD_PARTY_NOTICES.md
      to: THIRD_PARTY_NOTICES.md
  win:
    icon: build/icon.ico
    target:
      - nsis
      - dir
  nsis:
    oneClick: false
    perMachine: false
    allowToChangeInstallationDirectory: true
    createDesktopShortcut: true
    createStartMenuShortcut: true
    shortcutName: Life Atlas
    installerLanguages:
      - zh_CN
    language: "2052"
    include: build/installer.nsh
    deleteAppDataOnUninstall: false
  ```

- `build/installer.nsh`（照抄，UTF-8 保存）：

  ```nsis
  !macro customUnInit
    MessageBox MB_OK|MB_ICONINFORMATION "卸载只会删除 Life Atlas 程序。你的数据目录（全部页面、附件、密钥库和快照）不会被删除。以后重新安装时选择同一个数据目录，就能继续使用。" /SD IDOK
  !macroend
  ```

- `scripts/desktop-build.mjs` 已经支持 `--version <x.y.z>`（WP-03）；再增加一个**可选**参数（只能跟在 `release` 后面，可以和 `--version` 同时用，顺序不限；其他组合仍然以退出码 64 退出）：
  - `--install-test`：追加 `-c.appId=com.medax.lifeatlas.installtest`、`-c.productName=Life Atlas Install Test`、`-c.nsis.shortcutName=Life Atlas Install Test`、`-c.nsis.createDesktopShortcut=false`，并把输出目录改为 `release/install-test-<版本>`（版本 = `--version` 的值，没有时用 `package.json` 的版本）。
  - 打包前检查 `build/icon.ico` 和 `THIRD_PARTY_NOTICES.md` 都存在，缺任何一个就打印“缺少 <文件>，先运行 WP-19 步骤 2/4”并以退出码 65 退出。
  - 参数在 `spawnSync` 的参数数组里原样传（`"-c.productName=Life Atlas Install Test"` 是一个元素，不要自己加引号）。
- **为什么要“安装测试版”**：用户在 WP-05 之后已经装了 Life Atlas 并在用。安装测试版的 appId、产品名、快捷方式名都不同，exe 叫 `Life Atlas Install Test.exe`，所以静默安装、升级、卸载它不会碰到用户装的那一份；它和正式版用同一份代码、同一套安装配置。真实的 0.x → 1.0.0 升级由用户在第 2.9 节亲手做。
- 安装测试版启动时一律设置 `LIFE_ATLAS_DATA_ROOT=<临时数据目录>`，所以不会读取 `%APPDATA%\Life Atlas\bootstrap.json`，也不会打开用户的数据。

### 2.4 测试辅助代码

- `tests/fixtures/release-workspace.mjs`（导出 `releaseWorkspace()`）：`const full = upgradeWorkspace(fullWorkspace())`、`const big = upgradeWorkspace(bigWorkspace())`；结果以 `full` 为底，`BACKUP_COLLECTIONS` 里的每个集合都是 `full[c]` 加上 `big[c]` 里 **ID 不在 `full[c]` 里**的实体（`const ids = new Set(full[c].map((entity) => entity.id)); [...full[c], ...big[c].filter((entity) => !ids.has(entity.id))]`）。必须这样去重：`upgradeWorkspace` 会给两个夹具各加一个固定 ID 的系统收件箱文件夹 `system-inbox`（WP-13），直接拼接会出现重复 ID 和两个收件箱（完整性检查报 `SYSTEM_FOLDER_INVALID`）；`ui`、`workspaceId` 用 `full` 的；再把 `big-p-4321`、`big-p-17`、`big-p-2500` 三个页面的标题改为 `性能检索目标一`、`性能检索目标二`、`性能检索目标三`。
- `tests/desktop/seed-vault.mjs`（导出 `async seedVault(dataRoot, { password, inputs })` → `{ recoveryKey }`）：按 `tests/vault-plaintext.test.mjs` 的写法在普通 Node 里创建 `createVaultService`（正式 KDF 参数、真实的 `vaultStore`）；`create({ password })` → `confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(recoveryKey) })` → 对 `inputs` 逐个 `createItem({ input })` → `lock()` → `closeDatabase()`；返回创建时得到的恢复密钥。
- `tests/release/helpers.mjs`，导出（照这些签名实现）：

  ```js
  export const INSTALL_TEST_NAME = "Life Atlas Install Test";
  export function installTestInstaller(version)        // → release\install-test-<version>\Life Atlas Install Test Setup <version>.exe 的绝对路径；不存在就抛错“先运行 node scripts/desktop-build.mjs release --install-test …”
  export function uninstallEntries(namePrefix)         // → [{ DisplayName, DisplayVersion, QuietUninstallString }]（下面的 PowerShell 写法）
  export async function runSilent(exe, args, { timeoutMs = 120000 } = {})   // spawn 并等待退出 → 退出码
  export async function waitFor(check, { timeoutMs, intervalMs = 500, message })  // 轮询 check() 直到为真，超时抛错 message
  export function startApp(exe, dataRoot)              // spawn(exe, [], { env: { ...process.env, LIFE_ATLAS_DATA_ROOT: dataRoot } }) → child
  export async function closeAppGracefully(child)      // spawnSync("taskkill", ["/PID", String(child.pid)]) → 等 exit 最多 15 秒；超时就 taskkill /F 并抛错“应用没有正常退出”
  export function logEvents(dataRoot)                  // 读 <dataRoot>\logs\*.log 的每一行 JSON → 数组
  export function readWorkspaceState(dataRoot)         // 只读打开 workspace.db（node:sqlite 的 new DatabaseSync(file, { readOnly: true })）→ { meta: { 键: JSON.parse(值) }, entities: { 集合: { id: JSON.parse(json) } } }；只在应用关闭后调用
  export function readVaultRows(dataRoot)              // 只读打开 vault.db → 头部表和条目表的全部行（按 id 排序）
  export function snapshotDirs(dataRoot)               // <dataRoot>\snapshots 下的目录名数组（排序）
  export async function treeHash(dir)                  // 目录下全部文件 “相对路径\0SHA-256\n” 排序后的 SHA-256（规则同 docs/blueprint/tools/tree-hash.mjs）
  ```

  `uninstallEntries` 的写法（照抄；`$_` 在 JS 模板字符串里不会被替换）：

  ```js
  const script = `Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -like '${namePrefix}*' } | Select-Object DisplayName, DisplayVersion, QuietUninstallString | ConvertTo-Json -Compress`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" });
  const text = result.stdout.trim();
  return text ? [].concat(JSON.parse(text)) : [];
  ```

- `package.json` 增加脚本 `"test:release": "node --test --test-concurrency=1 --test-reporter=spec \"tests/release/*.e2e.mjs\""`。`tests/release/` 不在 `npm test` 和 `npm run test:e2e:desktop` 的范围里（它们很慢，还会安装程序），只在本 WP 里显式运行。

### 2.5 安装、升级、卸载测试（`tests/release/installer-lifecycle.e2e.mjs`）

一个用例 `the install test build installs upgrades and uninstalls without touching data`，按顺序：

1. **前提**：`uninstallEntries("Life Atlas Install Test")` 不为空时（上次失败留下的），对每一项运行它的 `QuietUninstallString`（拆成 exe 和参数）并等 exe 消失，日志里写一行 `cleaned leftover install`。Windows 进程里有 `Life Atlas Install Test.exe` 在运行时，测试失败并提示“先关闭安装测试版”。
2. **准备**：`root = fs.mkdtempSync(path.join(os.tmpdir(), "la-release-"))`；`dataRoot = root\data`；`installDir = root\app`（不要预先创建）。`seedWorkspaceDatabase(dataRoot, upgradeWorkspace(fullWorkspace()))`；再用 `createAssetStore` 放入 `fullWorkspaceAttachmentBytes()` 里的 3 个附件；`seedVault(dataRoot, { password: "Release-Test-Pass-2026!", inputs: vaultItemInputs(createMarkers()) })`。
3. **安装 0.9.0**：`runSilent(installTestInstaller("0.9.0"), ["/S", `/D=${installDir}`])` 退出码 0；`installDir\Life Atlas Install Test.exe` 存在；`uninstallEntries` 正好一项，`DisplayVersion === "0.9.0"`；读取安装后 exe 的 Fuse 状态（`getCurrentFuseWire`，同 WP-11），前 8 位等于 `[48, 49, 48, 48, 49, 49, 48, 48]`。
4. **用 0.9.0 打开数据**：`startApp` → 等 `logEvents` 出现 `window.created`（最多 30 秒）→ 再等 8 秒 → `closeAppGracefully` → `dataRoot\.lock` 不存在 → `readWorkspaceState(dataRoot).meta.lastAppVersion === "0.9.0"`。记下 `before = { entities, vault: readVaultRows(dataRoot), assets: <assets 目录的 treeHash>, snapshots: snapshotDirs(dataRoot) }`。
5. **升级到 1.0.0**：`runSilent(installTestInstaller(package.json 的版本), ["/S"])` 退出码 0；`uninstallEntries` 仍是一项，`DisplayVersion === "1.0.0"`；exe 还在同一个 `installDir`。
6. **用 1.0.0 打开同一份数据**：同第 4 步启动、等待、关闭 → `meta.lastAppVersion === "1.0.0"`；`snapshotDirs` 比 `before.snapshots` 多出一个以 `-pre-upgrade` 结尾的目录，里面的 `snapshot.json` 的 `files` 同时有 `workspace.db` 和 `vault.db`；`entities` 与 `before.entities` 深度相等；`readVaultRows` 与 `before.vault` 深度相等；`assets` 的 `treeHash` 不变。
7. **卸载**：`const dataHash = await treeHash(dataRoot)` → `runSilent(installDir\Uninstall Life Atlas Install Test.exe, ["/S"])` → `waitFor(() => !fs.existsSync(exe), { timeoutMs: 60000 })` → 再等 2 秒 → `uninstallEntries` 为空；开始菜单里没有 `Life Atlas Install Test.lnk`（`%APPDATA%\Microsoft\Windows\Start Menu\Programs\`）；`treeHash(dataRoot) === dataHash`（卸载没动数据）。
8. **清理**（放在 `finally` 里）：`spawnSync("taskkill", ["/F", "/IM", "Life Atlas Install Test.exe"])`（只结束这个名字的进程）；删除 `root`；如果存在就删除 `%APPDATA%\Life Atlas Install Test` 文件夹——只删这一个名字完全相同的文件夹，它是测试自己产生的，这是执行手册第 8 节第 1 条的唯一例外。

每一步都 `console.log` 一行 `LIFECYCLE <步骤> <结果>`，便于在日志里核对。

### 2.6 性能预算（`tests/release/performance.e2e.mjs`，测试版打包程序 + Playwright）

一个用例 `release performance stays within budget`：

1. `dataRoot` 用临时目录；`seedWorkspaceDatabase(dataRoot, releaseWorkspace())`。
2. **1 GB 附件**：用 `openWorkspaceDatabase` + `prepareWritable` 打开 `dataRoot\workspace.db`，`createAssetStore({ assetsDir: dataRoot\assets, db, now })`；`i` 从 0 到 3：`bytes = fixtureBytes("release-big-" + i, 256 * 1024 * 1024)` → `put({ bytes, mime: "video/mp4", name: "大附件-" + i + ".mp4" })`（一次只生成一个，用完就释放）；然后用 `readAllRows` + `assembleWorkspace` 读出工作区，加 4 个附件实体（`provider: "asset"`，`storageKey` 与 `checksum` 都是 sha256）和一个放在 `f-z` 的页面“大附件”（4 个 `file` 区块，`props.url` 为 `life-asset://<sha256>`），用 `writeWorkspaceDiff` 写回，关闭数据库。
3. **冷启动**：`t0 = Date.now()` → `launchApp({ packaged: true, dataRoot })` → 等 `html[data-la-ready="1"]` → `RELEASE_STARTUP_MS = Date.now() - t0`，要求 < 4000。
4. **全局搜索**：对 3 个目标页面各测一次，取中位数。每次：`Ctrl+K` 打开搜索 → 在页面里执行下面的计时代码 → `RELEASE_SEARCH_MS` < 200：

   ```js
   const ms = await page.evaluate(async (text) => {
     const dialog = document.querySelector('[aria-label="全局搜索"]');
     const input = dialog.querySelector("input");
     const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
     const start = performance.now();
     setValue.call(input, text);
     input.dispatchEvent(new Event("input", { bubbles: true }));
     return await new Promise((resolve) => {
       const tick = () => [...dialog.querySelectorAll('[role="option"]')].some((el) => el.textContent.includes(text)) ? resolve(performance.now() - start) : requestAnimationFrame(tick);
       tick();
     });
   }, "性能检索目标一");
   ```

5. **打开页面**：紧接着每次搜索，`t1 = Date.now()` → 输入框按 `Enter` → 等 `.life-editor[data-page-id="<目标页面 ID>"] .bn-block-content` 出现 → 3 次的中位数 `RELEASE_OPEN_PAGE_MS` < 300。
6. **空闲内存**：等 10 秒 → `handle.app.evaluate(({ app }) => app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0))`（单位 KB）÷ 1024 → `RELEASE_IDLE_MEMORY_MB` < 600。
7. **完整备份导出**：`queueDialogResponse(handle, "showSaveDialog", <临时目录>\release-backup.lifeatlas)` → 记下 `backup.getStatus()` 的 `lastFullBackupAt` → 工作区菜单“备份与恢复…”→ 在“导出备份”页点“导出…”（不含密钥库：这个数据目录没有密钥库）→ `t2 = Date.now()` → 轮询 `window.lifeAtlas.backup.getStatus()` 直到 `lastFullBackupAt` 变化（最多 5 分钟）→ `RELEASE_BACKUP_MS` < 120000；文件大小 > 1 GB。
8. 每个数字都 `console.log("<名字>=<值>")`；任何一项超出预算都让断言失败（不要放宽数字）。

### 2.7 安全总检（`tests/release/security-sweep.e2e.mjs`，测试版打包程序 + Playwright）

一个用例 `a full release session leaves no plaintext and makes no network requests`：

1. `markers = createMarkers()`；`seedWorkspaceDatabase(dataRoot, upgradeWorkspace(fullWorkspace()))`；`const { recoveryKey } = await seedVault(dataRoot, { password: MASTER, inputs: vaultItemInputs(markers) })`，`MASTER = "Release-Sweep-Pass-2026!"`。
2. `launchApp({ packaged: true, dataRoot, env: { LIFE_ATLAS_TEST_CLIPBOARD_MS: "1500" } })`。
3. 打开密钥库窗口并解锁（写法照 `tests/desktop/vault.e2e.mjs`）；打开任意一个条目，点一个敏感字段的“显示”，再点另一个字段的“复制”；等 2 秒（剪贴板被清除）；上锁。
4. 导出完整备份（**包含密钥库**，不加密整包）到 `<临时目录>\sweep-plain.lifeatlas`；再导出一次（包含密钥库，**加密整个备份**，备份密码 `BACKUP = "Sweep-Backup-Pass-2026!"`）到 `sweep-encrypted.lifeatlas`。确认请求在密钥库窗口里输入 `MASTER` 确认（写法照 `tests/desktop/backup-v2.e2e.mjs`）。
5. 导出为 Markdown（WP-18）到 `<临时目录>\sweep-markdown`。
6. `__lifeAtlasTest.snapshots.checkNow()`（产生一个含 `vault.db` 的每日快照）。
7. `assertNoNetworkAndErrors(handle)`；`closeApp(handle, { keepDirs: true })`。
8. 写标记文件：全部 `markers.all()`、`MASTER`、`BACKUP`、`recoveryKey`，每行一个；运行 `node tools/scan-plaintext.mjs <dataRoot> <两个备份文件> <sweep-markdown 目录> --markers <标记文件>`，退出码必须是 0（输出整体打印到测试日志）。
9. 最后删除临时目录。

### 2.8 许可证与第三方声明

- 运行 `node docs/blueprint/tools/license-report.mjs` 生成项目根目录的 `THIRD_PARTY_NOTICES.md`（提交到仓库，并随安装包发布，见 2.3 节）。期望 `problems=0`；不是 0 时停下报告（不要自己换依赖）。
- “关于 Life Atlas”对话框（WP-12）末尾加一行小字：“完整的第三方许可证见安装目录里的 THIRD_PARTY_NOTICES.md”。

### 2.9 用户手册（`docs/用户手册.md`）与截图

- 面向用户，通俗中文，不写代码和技术细节。按下表的章节顺序写，每章必须包含“必须写到”列的全部内容；截图放 `docs/manual-images/`，在手册里用相对路径 `manual-images/<截图名>-light.png` 引用（每个画面有白天、夜间两张，见本节最后一条）。

  | 章 | 标题 | 必须写到 | 截图 |
  | --- | --- | --- | --- |
  | 1 | 安装与第一次打开 | 双击安装包、可以选安装位置；第一次打开要选“数据目录”（建议 `D:\LifeAtlas`；不要放在 OneDrive 等同步盘里；不能放在程序安装目录里）；已经有数据目录时选它直接打开 | `first-run.png` |
  | 2 | 从浏览器版搬到桌面版 | 在浏览器版用平时的地址打开 → 导出完整备份；桌面版第一次打开选“从备份恢复”；确认无误前不要清理浏览器数据 | `restore-from-backup.png` |
  | 3 | 日常备份 | 自动快照（每日、升级前、迁移前、恢复前）放在数据目录里，硬盘坏了快照也会没；所以要定期导出完整备份到另一块硬盘或 U 盘；建议开启“定期备份”；“校验备份”可以检查备份文件有没有损坏 | `backup-dialog.png` |
  | 4 | 在新电脑上恢复 | 安装 → 第一次打开选“从备份恢复”→ 选 `.lifeatlas` 文件 → 加密的备份要输入备份密码 → 密钥库用原来的主密码解锁 | — |
  | 5 | 密钥库 | 主密码的规则；恢复密钥要打印或抄在纸上，不要只存在电脑里；忘了主密码用恢复密钥；**两者都丢了就无法打开，这是设计如此**；闲置、锁屏、睡眠时自动上锁；复制的内容会自动从剪贴板清除；截图和录屏看不到密钥库窗口；导入浏览器导出的密码 CSV 后要删除那个 CSV 文件 | `vault-lock.png`、`vault-main.png`（虚构条目） |
  | 6 | 软件开发进程模板与时间脉络 | 模板库 → 软件开发进程 → 输入项目名 → 生成；时间脉络视图：拖动改日期、缩放、导出 PNG/SVG（16:9，可以直接贴进 PPT） | `template-gallery.png`、`roadmap.png` |
  | 7 | 页面与编辑器 | 斜杠菜单 `/`、`[[` 链接页面、`@` 提及、页面历史、反向链接、外部图片不显示（双击用浏览器打开） | `slash-menu.png` |
  | 8 | 数据库 | 点单元格编辑、底部统计、点标题打开中心预览、导入 CSV | `database-table.png` |
  | 9 | 快速记录与收件箱 | `Ctrl+Shift+N`、全局快捷键 `Ctrl+Alt+Space`、归档到文件夹、本地提醒 | `quick-capture.png` |
  | 10 | 导入 Notion、导出 Markdown | Notion 里怎么导出（“Markdown 和 CSV”、勾选“包含子页面”和“为子页面创建文件夹”）；导入的内容放在新文件夹里；导出 Markdown 用来长期保存 | — |
  | 11 | 设置与外观 | 界面风格是“墨白”；模式有跟随系统、白天、夜间三种（设置里的“模式”，或顶栏的“切换白天/夜间”按钮）；更换数据目录（旧目录会保留）；清理未使用的附件（30 天内可以恢复） | `settings.png` |
  | 12 | 快捷键 | 表格，内容就是 `src/editor/shortcuts.js` 的 `SHORTCUTS` | — |
  | 13 | 常见问题 | 数据目录在哪（设置 → 数据）；卸载会不会删数据（不会）；出现“数据无法读取”怎么办（从快照或备份恢复）；为什么没有云同步和 AI（本软件完全不联网）；全局快捷键被别的软件占用怎么办 | — |

- 截图脚本 `tests/release/manual-screenshots.e2e.mjs`（测试版打包程序 + Playwright；工作区窗口 1440×900，向导和密钥库窗口是它们自己的大小）：用满配夹具，按上表的截图名依次进入界面，每个画面用 WP-05 的 `shootWindowBothModes(handle, page, "docs/manual-images", <截图名去掉 .png>)` 白天、夜间各截一张（文件名 `<截图名>-light.png`、`<截图名>-dark.png`）。手册正文引用白天那张；第 11 章把 `settings-light.png` 和 `settings-dark.png` 都放上，让用户看到两种模式；`first-run.png` 用 `launchApp({ dataRoot: null })`（首次启动向导）；密钥库截图用 `seedVault` 建的**虚构**条目（不要用 `vaultItemInputs` 的标记值，自己写 3 个虚构条目，例如“示例邮箱”“示例服务器”“示例 API Key”，值都写成 `示例-不是真的`）。

### 2.10 总验收报告（`docs/blueprint/reports/FINAL-ACCEPTANCE.md`）

照下面的结构写（各节都必须有；表格每一行都要填）：

```markdown
# Life Atlas 1.0.0 总验收报告

## 1. 用户需求逐条对照
| 编号 | 需求（01 第 2 节） | 由哪些 WP 实现 | 证据（测试文件和用例名、截图、日志） | 结论 |
（R1–R8 各一行）

## 2. 功能矩阵最终状态
（把 01 第 3 节每张表里优先级为 P0、P1 的每一行抄过来，加一列“最终状态”：已完成 / 未完成（原因），再加一列“证据”）

## 3. 性能实测
| 项目 | 预算 | 实测 | 结论 |
（2.6 节的 5 项，数字来自 .qa/WP-19/test-release.log）

## 4. 安全总检
| 检查 | 结果 | 证据 |
（明文扫描、网络请求、Fuses 与 ASAR 完整性（WP-11 的 release-hardening 与 2.5 节第 3 步）、许可证检查）

## 5. 安装与升级
（2.5 节每一步的 LIFECYCLE 日志行）

## 6. 已知限制
（如实写：03 第 2 节里防不住的情况逐条抄过来；所有 WP 报告第 6、7 节里还没解决的问题；01 第 3 节里“暂不排期”的功能）

## 7. 用户亲手验收（由用户填写）
（照 2.11 节的 6 步列成表格，结论一栏留空给用户）

## 8. 后续建议
```

### 2.11 用户亲手验收清单（写进 FINAL-ACCEPTANCE 第 7 节，由用户自己做）

1. 先在现在用的 Life Atlas 里导出一份完整备份（包含密钥库），存到另一块硬盘或 U 盘。
2. 双击 `release\release\Life Atlas Setup 1.0.0.exe`：安装界面是中文，可以选择安装位置；装完后桌面和开始菜单都有“Life Atlas”。
3. 打开 Life Atlas：原来的页面和数据都在；工作区菜单 → 备份与恢复 → 快照列表最上面有一个“升级前”的快照。
4. 工作区菜单 → 关于 Life Atlas：版本是 1.0.0。
5. 打开密钥库，用主密码解锁，条目都在。
6. （可选）在 Windows 设置 → 应用里卸载 Life Atlas：会提示“不会删除数据目录”；卸载后数据目录还在；重新安装并选择同一个数据目录，一切都在。

## 3. 范围

### 不做

- 代码签名证书、自动更新、应用商店发布（自动更新需要联网，永远不做）。
- 任何新功能。发现的缺陷：影响数据安全的就地修复（第 6 节），其余写进总验收报告第 8 节。

## 4. 执行步骤

### 步骤 0：开工准备【停止点】

按执行手册 3.1 节开工（分支 `wp/19-release`），生成报告骨架，跑基线：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-19/step0-npm-test.log npm test
```

在报告第 1 节回答理解题：

1. 为什么自动化测试要用“安装测试版”而不是直接安装正式版？
2. 升级测试怎样证明“数据没有变”？分别比较了哪些东西？
3. 为什么安装测试版启动时必须设置 `LIFE_ATLAS_DATA_ROOT`？
4. 性能预算有哪 5 项？超出预算时你该怎么做？

提交 `WP-19: step 0 understanding`，运行 `node docs/blueprint/tools/wp-check.mjs WP-19 --until 0`，退出码 0 → **停止**。

### 步骤 1：图标方向闸门【停止点】

本步不写代码。在报告第 5 节写一行“等待用户选择图标方向（A 墨页 / B 星图 / C 时间线），对照图：docs/blueprint/assets/icons/icon-directions.png”，第 0 节步骤 1 标为“完成”，提交 `WP-19: icon direction gate`，运行 `node docs/blueprint/tools/wp-check.mjs WP-19 --until 1`，退出码 0 → **停止**，在回复的“需要用户做的事”里写：“请打开 docs/blueprint/assets/icons/icon-directions.png，选择 A、B 或 C”。

### 步骤 2：图标

用户选定后（用户的原话写进报告第 5 节），按 2.2 节生成图标：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-19/render-icon.log node docs/blueprint/tools/render-icon.mjs build/icon.svg build/icons
```

把 `build/icons/icon.ico` 复制为 `build/icon.ico`。提交 `WP-19: application icon`。

### 步骤 3：版本、安装配置与打包脚本

按 2.1、2.3 节修改 `package.json` 的版本、`electron-builder.yml`、新建 `build/installer.nsh`、修改 `scripts/desktop-build.mjs`；按 2.8 节第 2 条给“关于”加一行。提交 `WP-19: version installer config and build options`。

### 步骤 4：第三方声明

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-19/license-report.log node docs/blueprint/tools/license-report.mjs
```

期望日志里 `problems=0`、`exit=0`。提交 `WP-19: third party notices`（包括根目录的 `THIRD_PARTY_NOTICES.md`）。

### 步骤 5：测试辅助代码

按 2.4 节新建 `tests/fixtures/release-workspace.mjs`、`tests/desktop/seed-vault.mjs`、`tests/release/helpers.mjs`，增加 `test:release` 脚本。新建 `tests/release-fixtures.test.mjs`（会被 `npm test` 运行）：

- `release workspace merges both fixtures without duplicate ids`：每个集合的 ID 都不重复；每个集合的长度 = `full[c].length` + `big[c]` 里 ID 不在 `full[c]` 里的个数（`pages` 一项不少：两个夹具的页面 ID 本来就不重复）；`folders` 里 `system === "inbox"` 的正好 1 个；3 个目标页面的标题正确；`checkWorkspaceIntegrity` 没有 error。
- `the vault seed helper creates a locked confirmed vault`：在临时目录 `seedVault` → `vault.db` 存在；用新的 `createVaultService` 读 `status()`：`exists: true`、`locked: true`、`recoveryConfirmed: true`。（本用例用正式 KDF 参数，较慢是正常的。）

提交 `WP-19: release test helpers`。

### 步骤 6：打包全部安装包

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-19/build-release.log npm run desktop:build
node docs/blueprint/tools/run-logged.mjs .qa/WP-19/build-test.log npm run desktop:build:test
node docs/blueprint/tools/run-logged.mjs .qa/WP-19/build-install-test-090.log node scripts/desktop-build.mjs release --install-test --version 0.9.0
node docs/blueprint/tools/run-logged.mjs .qa/WP-19/build-install-test-100.log node scripts/desktop-build.mjs release --install-test
```

四条都 `exit=0`；`release\release\Life Atlas Setup 1.0.0.exe`、`release\install-test-0.9.0\Life Atlas Install Test Setup 0.9.0.exe`、`release\install-test-1.0.0\Life Atlas Install Test Setup 1.0.0.exe` 都存在；`release\release\win-unpacked\THIRD_PARTY_NOTICES.md` 存在。把正式版安装包的大小与 SHA-256 写进报告第 3 节（`Get-FileHash -Algorithm SHA256 -LiteralPath '<路径>'`），报告第 0 节步骤 6 标为“完成”，提交 `WP-19: build all installers`（只有报告的变化也要提交）。

### 步骤 7：安装、升级、卸载测试

按 2.5 节新建 `tests/release/installer-lifecycle.e2e.mjs`。单独运行：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-19/installer-lifecycle.log node --test --test-reporter=spec tests/release/installer-lifecycle.e2e.mjs
```

通过后提交 `WP-19: installer lifecycle test`。

### 步骤 8：性能、安全总检与手册截图

按 2.6、2.7 节新建 `tests/release/performance.e2e.mjs`、`tests/release/security-sweep.e2e.mjs`，按 2.9 节新建 `tests/release/manual-screenshots.e2e.mjs`。运行：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-19/test-release.log npm run test:release
```

全部通过（`docs/manual-images/` 里有 2.9 节表格列出的 11 个画面，白天、夜间各一张，共 22 张）后提交 `WP-19: release performance security and screenshots`。

### 步骤 9：自动化验收检查点【停止点】

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-19/step9-npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-19/step9-browser.log npm run test:parity:browser
node docs/blueprint/tools/run-logged.mjs .qa/WP-19/step9-desktop-e2e.log npm run test:e2e:desktop
```

三条都 `exit=0` 后，报告第 3 节写出 2.6 节的 5 个实测数字、步骤 6 的安装包大小与 SHA-256；第 0 节步骤 1–9 标为“完成”；提交 `WP-19: automated acceptance checkpoint`，运行 `node docs/blueprint/tools/wp-check.mjs WP-19 --until 9`，退出码 0 → **停止**。

### 步骤 10：用户手册

按 2.9 节写 `docs/用户手册.md`。写完逐章对照“必须写到”一列自查，在报告第 5 节列出每章的自查结果（“第 N 章：全部写到”或“缺……”）。提交 `WP-19: user manual`。

### 步骤 11：总验收报告

按 2.10、2.11 节写 `docs/blueprint/reports/FINAL-ACCEPTANCE.md`。数字和证据都从日志与报告里抄，不要凭记忆写。提交 `WP-19: final acceptance report`。

### 步骤 12：确认没有写死的颜色

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-19/theme-tokens-step12.log node docs/blueprint/tools/theme-tokens.mjs --report .qa/WP-19/theme-tokens-step12.md
```

期望 `replaced=0`、`leftovers=0`（本 WP 不加任何界面，应该为 0）。不为 0 时**不要**用 `--write`：打开报告看是哪几行、是哪个 WP 留下的，写进报告第 7 节并停下报告；为 0 时本步不提交。

### 步骤 13：收尾【停止点】

填完报告；第 0 节全部“完成”；提交 `WP-19: complete report`；运行 `node docs/blueprint/tools/wp-check.mjs WP-19 --browser --desktop`，退出码 0 或 2 → 停止。回复的“需要用户做的事”写：“请按 docs/blueprint/reports/FINAL-ACCEPTANCE.md 第 7 节做 6 步亲手验收”。

## 5. 验收标准

| 编号 | 标准 | 证据 |
| --- | --- | --- |
| AC-19-1 | 图标按用户选定的方向生成：7 个尺寸的 PNG 和多尺寸 `icon.ico`；正式版 exe 和安装包使用它 | `build/icons/`；`.qa/WP-19/render-icon.log`；`.qa/WP-19/build-release.log` |
| AC-19-2 | 正式版、测试版、两个安装测试版都能打包；正式版安装包的大小与 SHA-256 已记录；`THIRD_PARTY_NOTICES.md` 随程序发布 | `.qa/WP-19/build-*.log`；报告第 3 节 |
| AC-19-3 | 安装测试版：静默安装、Fuse 状态正确、0.9.0 → 1.0.0 原地升级、升级前快照（含工作区与密钥库）、升级后工作区实体、密钥库行、附件文件全部不变、卸载后数据目录哈希不变且卸载项和快捷方式都被删除 | 「the install test build installs upgrades and uninstalls without touching data」；`.qa/WP-19/installer-lifecycle.log` |
| AC-19-4 | 性能预算 5 项全部达标（冷启动 < 4 s、搜索 < 200 ms、打开页面 < 300 ms、空闲内存 < 600 MB、1 GB 完整备份 < 2 分钟），报告写实测值 | 「release performance stays within budget」；`.qa/WP-19/test-release.log` |
| AC-19-5 | 安全总检：整个数据目录、两个备份包、Markdown 导出里明文扫描 0 命中；全程没有网络请求和控制台错误；许可证检查 0 个需要处理 | 「a full release session leaves no plaintext and makes no network requests」；`.qa/WP-19/license-report.log` |
| AC-19-6 | 全量回归全部通过：`npm test`、全部浏览器场景、全部桌面端到端（含 WP-11 的正式版加固测试）、`npm run test:release` | `.qa/WP-19/step9-*.log`；`.qa/WP-19/test-release.log` |
| AC-19-7 | 用户手册 13 章齐全，每章覆盖“必须写到”的全部内容；11 个画面的截图（白天、夜间各一张）来自 1.0.0，手册里引用白天那张，第 11 章两种都有 | `docs/用户手册.md`；`docs/manual-images/`；报告第 5 节的逐章自查 |
| AC-19-8 | 总验收报告 8 节齐全：R1–R8 每条有证据，P0/P1 功能逐行有最终状态，性能与安全数字与日志一致，已知限制如实列出 | `docs/blueprint/reports/FINAL-ACCEPTANCE.md` |
| AC-19-9 | G1–G9 | `.qa/WP-19/wp-check.md` |

## 6. 卡点处理

| 情况 | 做法 |
| --- | --- |
| 打包日志里出现下载（`downloading`、`fetch`）或打包失败提示缺少图标工具 | 检查 `win.icon` 是不是 `build/icon.ico`（不能是 png）；仍有下载就停下报告完整日志 |
| 静默安装退出码不是 0 | 确认 `/D=` 是最后一个参数、路径没有空格和引号；确认没有安装测试版在运行；仍失败就停下报告 |
| 升级后 `entities` 不相等 | 打印不相等的集合和 ID；如果差异只在 `meta` 里的 `savedAt`、`lastAppVersion`，说明比较时没有排除 meta（实体比较不含 meta）；其他差异是**数据安全缺陷**，停下报告，不要改测试 |
| 没有出现 `-pre-upgrade` 快照 | 确认第 4 步关闭后 `meta.lastAppVersion` 确实是 `0.9.0`；确认 1.0.0 的 `app.getVersion()` 是 `1.0.0`（看安装包文件名）；仍没有就是缺陷，停下报告 |
| 性能某一项超出预算 | 连续跑 3 次记录每次的数字；仍超出就在报告第 7 节写清是哪一项、实测多少，停止（wp-check 退出码 2），不要放宽预算，也不要为了性能改功能 |
| 明文扫描有命中 | 这是安全缺陷：记录命中的文件和偏移，停下报告，不要删除命中的文件来“通过” |
| `license-report` 报告需要处理的包 | 停下报告包名和许可证，不要自己替换或删除依赖 |
| 测试结束后留下了安装测试版 | 运行它的 `QuietUninstallString`；只处理 `DisplayName` 以 `Life Atlas Install Test` 开头的项，**绝不**碰 `Life Atlas <版本>` |
| 发现影响数据安全的缺陷（数据丢失、明文落盘、升级破坏数据） | 允许在本 WP 修复：写一个能复现它的测试，修好，在报告第 5 节写明；其他缺陷只记入总验收报告第 8 节 |
