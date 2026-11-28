# WP-05 首次启动、桌面备份恢复与快照

- 规模：L · 前置：WP-04 · 分支：`wp/05-desktop-backup`
- 停止点：步骤 0（理解确认）、步骤 7（备份与快照内核完成，接入界面之前）、步骤 13（收尾）
- 必读：`09-执行手册.md`、`10-测试夹具规格.md` 第 2、3 节、`04-备份与恢复规格.md` 全文（第 4、5 节本 WP 不做）、`02-总体架构.md` 第 3、4 节、`11-接口契约.md` 第 1 节（`backup.*`、`app.openDataFolder`）、第 3 节、第 4.3–4.5 节、第 5 节；WP-02 的 `src/backup/*`；WP-04 的 `electron/main/storage/*`；`12-视觉规范-墨白.md` 第 0、2、3、6、7、8 节和 3.8 节列出的参照画面；WP-20 的 `electron/main/windows.js`（`themeBackgroundColor()`）

## 0. 一页纸

- **要做到**：用户能真正“搬家”——安装桌面版 → 首次启动向导选数据目录 → 导入浏览器里导出的迁移包 → 开始日常使用。同时桌面版有自己的完整备份、恢复、校验和自动快照。
- **交付物**：`yazl`/`yauzl` 两个依赖；`electron/main/backup/` 下的 `zipNode.js`、`legacyConversion.js`、`desktopExport.js`、`desktopRestore.js`；`snapshots.js` 的保留策略、列表、恢复与定时检查；`pre-upgrade` 快照；首次启动向导（`setup.html`、`src/setup-ui/`（含墨白样式表 `src/setup-ui/setup.css`）、`electron/preload/setup.cjs`）；桌面版“备份与恢复”对话框（墨白样式 `src/ui/themes/mobai/backup.css`）；错误页的两个恢复按钮；单元测试；`tests/desktop/backup.e2e.mjs`、`tests/desktop/first-run.e2e.mjs`；白天和夜间的截图与对照图（3.8 节）。
- **绝对不要**：在任何检查失败后改动当前数据；把 `data:` 转换扩大到第 3.3 节以外的字段；在测试里写真实的 `%APPDATA%` 或 `D:\LifeAtlas`；做密钥库导出、整包加密、定期备份（WP-08）；做合并导入；在旧 CSS（`src/styles.css`、`src/ui/product-system.css` 等）里写颜色（K13 会检查）；让 `src/setup-ui/` 导入工作区的 CSS。
- **什么时候停**：步骤 0 后停；步骤 7 后停；步骤 13 的 wp-check 退出码为 0 或 2 时停。

## 1. 为什么做

完成后用户就能把浏览器里的数据搬进桌面版，并且桌面版有了自己的备份、恢复和自动快照。

## 2. 已知事实（总设计师 2026-11-01 实测）

| 事实 | 影响 |
| --- | --- |
| `yazl@3.3.1`、`yauzl@3.4.0`（都是 MIT）：`zip.addBuffer`/`zip.addFile` 按添加顺序写入，不会产生目录条目；`compress: false` 对应压缩方式 0（STORE）；`yauzl.open(file, { lazyEntries: true, autoClose: false })` 按顺序读条目，`openReadStream` 可以流式计算 5 MB 文件的 SHA-256 | 照第 3.1 节写 |
| 快照保留策略的标准答案：从 2026-01-01 起每天 03:00Z 一个 `daily`（共 305 个），`now = 2026-11-01T12:00:00Z` 时应保留 14 个：`2026-11-01、10-31、10-30、10-29、10-28、10-27、10-26`（最新 7 个）、`10-25、10-18、10-11`（之前 3 周每周最新的）、`09-30、08-31、07-31、06-30`（之前 4 个月每月最新的） | 单元测试直接用这组数据 |

## 3. 设计要点（规定）

### 3.1 主进程 zip 读写（`electron/main/backup/zipNode.js`，不 import electron）

```js
export function createZipFileWriter(targetPath)
// → { addBuffer(path, bytes, { store }), addFile(path, filePath, { store }), finish() → Promise<void>, abort() → Promise<void> }
export function openZipFileReader(filePath)
// → Promise<{ entries() → [path...], read(path) → Promise<Uint8Array>, sha256(path) → Promise<string>, size(path) → number, openStream(path) → Promise<Readable>, close() }>
```

- `store: true` → `compress: false`；其余 `compress: true`。
- reader 打开时就读完目录（`lazyEntries`），`entries()` 按 zip 内顺序返回、跳过以 `/` 结尾的条目；`sha256` 与 `size` 用流计算，不把整个文件读进内存。
- 修改 WP-02 的 `src/backup/verify.js`：reader 有 `sha256`/`size` 方法时优先用它们（浏览器版 reader 没有，行为不变）。

### 3.2 桌面导出（`electron/main/backup/desktopExport.js`）

`exportFullBackup({ db, assetStore, workspace, targetPath, appVersion, now, onProgress, signal })`：

1. 用 `workspaceToFiles(workspace)` 生成 meta 与 JSONL（在内存里），计算它们的 SHA-256。
2. 附件：`assets` 表里的每一行对应一个文件 `assets/<sha256>`（哈希就是文件名，不重新计算）；`assets/index.json` 每行一项（桌面版不写 `legacyAttachmentId`）。
3. `buildManifest`（`platform: "desktop"`，`vault: { included: false }`）。
4. 写到临时文件 `<targetPath>.partial-<8 位随机十六进制>`：先 manifest，再按 `files` 顺序写其余文件（附件用 `addFile` 流式写入）；每写完一个文件调用 `onProgress({ phase: "write", done, total })`。
5. 写完后用 `openZipFileReader` 重新打开，执行 `verifyPackage`；不通过 → 删除临时文件，抛 `StorageError("E_IO", "导出的文件校验失败")`。
6. 改名为 `targetPath`（已存在就覆盖——用户在保存对话框里已经确认过）。
7. `signal.aborted` 时在任意一步停下：删除临时文件，抛 `StorageError("E_CANCELLED")`。

`backup.exportFull`（IPC）：弹“另存为”（`dialogs.showSaveDialog`，默认路径 `<DataRoot>\backups\Life-Atlas-备份-YYYYMMDD-HHmm.lifeatlas`，`backups` 目录不存在时先创建，过滤器 `{ name: "Life Atlas 备份", extensions: ["lifeatlas"] }`）→ 取消返回 `E_CANCELLED` → 导出前先让渲染进程 flush（复用 WP-04 的 flush 机制）→ 用当前数据库读出的工作区导出 → 成功后 `meta.lastFullBackupAt = now`。进度通过 `la:backup:progress` 事件推送；`backup.cancel({ jobId })` 触发 `signal`。

### 3.3 浏览器迁移包的转换（`electron/main/backup/legacyConversion.js`，不 import electron，纯函数 + 回调）

`convertBrowserPackage(workspace, assetIndex, { putAsset })` → `{ workspace, report }`，严格按 04 第 7.3 节：

1. 对 `assetIndex` 里带 `legacyAttachmentId` 的项：附件实体 `{ provider: "local-ref", storageKey: <id> }` → `{ provider: "asset", storageKey: <sha256>, checksum: <sha256> }`；区块 `props.url` 里以 `#life-attachment=<id>` 结尾的地址 → `life-asset://<sha256>`（用 `attachmentIdFromUrl` 解析）。
2. 04 第 7.3 节第 2 条**列出的字段**里的 `data:<mime>;base64,<数据>` → 解码 → `const { url } = await putAsset(bytes, { mime, name })` → 替换为 `url`。
3. `report = { convertedAttachments, convertedDataUrls, leftovers: [{ collection, id, field }] }`，`leftovers` 是第 2 条同一批字段里仍然残留 `data:…;base64` 或 `#life-attachment=` 的位置（正常应为空）。

### 3.4 桌面恢复（`electron/main/backup/desktopRestore.js`）

```js
export async function inspectBackupFile(filePath, { currentSchemaVersion, now })   // → { token, summary } 或 { problems }
export async function restoreFromToken(token, context)                             // → { restoredAt }
export async function restoreFromSnapshot(snapshotId, { restoreWorkspace, restoreVault }, context)
```

`context` 提供：`dataRoot`、`workspaceService`（能关闭/重新打开）、`createSnapshot`、`now`、`idFactory`、`logger`、`injectFailure(name)`（测试钩子开启时才有效）。

恢复备份严格按 04 第 7.1 节第 5–11 步：

- `.staging-<时间>` 里建库：`PRAGMA journal_mode = DELETE`；写入实体与 meta（新 `generation`，`lastFullBackupAt`、`lastAppVersion` 沿用当前库的值）；旧 schema 先迁移（`normalizeLoadedWorkspace`）；`platform === "browser"` 时执行 3.3 的转换，`putAsset` 把文件写进**正式** `assets\`、把行写进**暂存库**的 `assets` 表；备份里的附件同样复制进正式 `assets\`、行写进暂存库；`PRAGMA integrity_check` 必须为 `ok`；数量与 manifest 一致（迁移导致的合法差异写进日志）。
- 交换严格按 04 第 7.1 节第 9 步。在“把暂存文件移入”之前调用 `injectFailure("restore-swap")`（测试用）。
- 当前数据库处于“只读错误”状态时（WP-04），旧文件不删除，改名为 `workspace.db.corrupt-<时间>` 留在数据目录里。
- 成功后：`workspaceService` 重新打开新库；向工作区窗口发 `reload`（`webContents.reload()`）；在 `logs\` 写一条 `backup.restore` 记录（时间、来源文件名、结果、各集合数量）。
- `inspect` 返回的 `token` 一次性，10 分钟过期（时间来自 `context.now`）。

从快照恢复：同样的“暂存 → 校验 → 交换”，暂存库来自快照里的 `workspace.db` 副本（复制后改写 `generation`）；恢复前先做 `pre-restore` 快照；`restoreVault` 在 WP-06 之前没有 `vault.db` 可恢复，传 `true` 返回 `E_INVALID_ARGUMENT`。

### 3.5 快照服务（扩展 `electron/main/storage/snapshots.js`）

- `listSnapshots(dataRoot)` → 11 第 4.5 节的数组（读每个目录的 `snapshot.json`；读不到的目录跳过并写日志）。
- `selectSnapshotsToDelete(snapshots, now)`：纯函数，严格按 04 第 6 节的保留策略，返回要删除的 `id` 数组。
- `applyRetention(dataRoot, now)`：删除上一步选出的目录。
- `checkDailySnapshot({ … })`：最新的 `daily` 早于 `now - 20 小时`（或者没有）就创建一个 `daily` 快照，然后对快照里的 `workspace.db` 执行 `PRAGMA integrity_check`，结果写进 `snapshot.json` 的 `integrity`；`failed` 时写错误日志。“备份与恢复”对话框打开时，只要列表里有 `integrity: "failed"` 的快照，就在对话框顶部显示红色提示“数据库完整性检查未通过，请立即导出完整备份”（本 WP 不新增推送事件）。随后 `applyRetention`。
- 定时：主进程启动 60 秒后执行一次 `checkDailySnapshot`，之后每小时一次（时间来自 `__lifeAtlasTest.clock` 或真实时钟）。测试钩子 `__lifeAtlasTest.snapshots.checkNow()` 立即执行一次。
- `pre-upgrade`：在 WP-04 的加载流程第 3 步之后、第 4 步之前加入：`meta.lastAppVersion` 存在且不等于当前版本 → `createSnapshot({ reason: "pre-upgrade" })`；写回时把 `meta.lastAppVersion` 更新为当前版本（不存在时直接写入，不做快照）。

### 3.6 首次启动向导

- 触发：02 第 3.1 节第 2 步解析不到数据目录（没有环境变量，也没有有效的 bootstrap）。设置了 `LIFE_ATLAS_DATA_ROOT` 或 bootstrap 有效时，**永远不显示向导**；数据目录里没有 `workspace.db` 就按 WP-04 新建空白工作区。
- 向导窗口：入口 `setup.html`（Vite 多页面：`vite.config.mjs` 的 `build.rollupOptions.input` 增加 `setup: "setup.html"`，保留 `index.html`），preload `electron/preload/setup.cjs`（暴露 11 第 3 节的 6 个函数），安全参数与工作区窗口相同，导航白名单只允许 `app://bundle/setup.html`。窗口内容区 980×640（`useContentSize: true`，和原型 `.vw-wizard` 一样大，3.8 节），不可调整大小，标题“欢迎使用 Life Atlas”，`backgroundColor: themeBackgroundColor()`（WP-20）。
- 界面（`src/setup-ui/`，React，不引入 BlockNote，也不导入工作区的任何 CSS；样式和布局见 3.8 节）两步：
  1. **选择数据目录**：显示 `getDefaults().suggestedDataRoot`；按钮“更改…”（`chooseFolder`）；路径变化时调用 `validateFolder` 并显示结果（`ok` 灰色小字、`warning` 浅黄底提示框加警告图标（原型 `.wiz-warn`，颜色见 3.8 节）、`error` 危险色小字）；`error` 时“下一步”禁用。`existing-data-root` 时按钮文字改为“打开这个数据目录”，点击直接 `finish({ dataRoot, start: "blank" })`。
  2. **开始方式**：两个选项按钮“新建空白工作区”“从备份恢复…”。后者调用 `inspectBackup()` → 显示摘要（字段同 11 第 4.3 节）→ “恢复”→ `finish({ dataRoot, start: "restore", token })`；有问题时列出问题（最多 10 条）。
- `validateFolder` 的规则（主进程，按顺序判断，返回第一个命中的）：
  1. 不是绝对路径 → `error`/`not-writable`，“请选择一个完整的文件夹路径”；
  2. 打包版且在 `path.dirname(process.execPath)` 之内 → `error`/`inside-install`，“数据目录不能放在程序安装目录里”；
  3. 存在且有 `life-atlas.root.json` → `ok`/`existing-data-root`，“这里已经是 Life Atlas 数据目录，将直接打开它”；
  4. 存在、不是空目录、没有标记文件 → `error`/`not-empty`，“这个文件夹里已有其他文件，请选择空文件夹或新建一个”；
  5. 命中同步盘规则 → `warning`/`sync-drive`，02 第 3 节的提示原文；
  6. 存在但无法写入（试写并删除一个临时文件）→ `error`/`not-writable`，“这个文件夹不能写入”；
  7. 不存在 → `ok`/`missing`，“将创建这个文件夹”；
  8. 其余（空目录）→ `ok`/`empty`。
- `finish({ dataRoot, start, token })`：再校验一次（`error` → `E_INVALID_ARGUMENT`）→ 创建目录与标记文件 → `start === "restore"`：用 3.4 的流程恢复到这个目录（没有旧数据，跳过 `pre-restore` 与旧文件处理）；`start === "blank"`：目录里已有 `workspace.db` 就**不做任何改动**，否则由 `workspaceService` 新建空白工作区 → 写 `bootstrap.json` → 删除 `<临时目录>\life-atlas-setup\` → 生产环境 `app.relaunch(); app.exit(0)`；**测试钩子开启时只 `app.exit(0)`，不 relaunch**（测试自己再启动一次）。

### 3.7 桌面版“备份与恢复”对话框

在 WP-02 的 `BackupDialog` 里按平台显示（`window.lifeAtlas?.platform === "desktop"`）：

1. **导出完整备份**：显示“上次导出：<日期>”或“还没有导出过完整备份”；超过 7 天显示“已经 N 天没有导出备份了”；按钮“导出…”；导出中显示进度“正在导出（已处理 X / Y 个文件）”与“取消”按钮。
2. **从备份恢复…**：`backup.inspect()` → 摘要 → 红色说明“当前数据将被替换。替换前会自动保存快照，可以随时撤回。”→ “恢复”（先 `window.confirm` 同样的话）→ `backup.restore({ token, restoreVault: false })`。
3. **校验备份文件…**：`backup.verify()` → 显示“完整”或问题列表。
4. **快照**：列表（时间、原因中文名（daily 每日、pre-upgrade 升级前、pre-migration 迁移前、pre-restore 恢复前、manual 手动、vault-reset 重置密钥库前）、大小、`integrity === "failed"` 时红色“完整性检查未通过”）、“立即创建快照”、每行“恢复到此快照”（确认后 `restoreSnapshot({ id, restoreWorkspace: true, restoreVault: false })`）。原因中文名：`daily` 每日、`pre-upgrade` 升级前、`pre-migration` 迁移前、`pre-restore` 恢复前、`manual` 手动、`vault-reset` 重置密钥库前。底部说明“快照和数据在同一块硬盘上，硬盘损坏时快照也会丢失，请定期导出完整备份。”
5. **打开数据目录**：`app.openDataFolder()`。

WP-04 的错误页增加两个按钮：“从快照恢复”（打开一个只有快照列表的对话框）、“从备份恢复”（走第 2 条）。

渲染进程收到 `applyChanges` 返回 `E_CONFLICT` 时：放弃本地增量，`location.reload()`。

### 3.8 墨白样式（规定）

用户选定了墨白（`12-视觉规范-墨白.md`）。本 WP 的两个界面照下面的参照画面做，白天和夜间各一套：

| 界面 | 参照截图 | 原型地址（`design/mobai/prototype/index.html` 后面加） |
| --- | --- | --- |
| 首次启动向导 | `design/mobai/shots/wizard-light.png`、`wizard-dark.png` | `#view=wizard&mode=light`（夜间把 `light` 换成 `dark`） |
| 备份与恢复（“导出备份”页） | `design/mobai/shots/backup-light.png`、`backup-dark.png` | `#view=backup&mode=light` |

动手前用 Edge 打开这两个原型地址，白天、夜间都看一遍。原型**只看不改**。

**首次启动向导**

- **样式文件** `src/setup-ui/setup.css`（新文件，由 `src/setup-ui/main.jsx` 导入）。开头三段变量：照抄 `design/mobai/theme/tokens.css` 最前面三段里的全部 `--mb-*` 变量，就是字体和圆角一段（`--mb-sans`、`--mb-serif`、`--mb-mono`、`--mb-numeral`、`--mb-r1`–`--mb-r4`；少了这一段，文字会退回浏览器的默认字体）、白天一段和夜间一段；前两段的选择器改成 `:root { … }`，夜间一段改成 `@media (prefers-color-scheme: dark) { :root { … } }`，并在 `:root` 里加 `color-scheme: light dark;`。后面的规则照原型改写：`design/mobai/prototype/shared/structure.css` 第 2–8 行的重置规则（`box-sizing`、`html, body`、`button`、`input`）；`b-more.css` 的 “separate windows: wizard and vault setup” 一段里向导用到的部分（`.wizard`、`.wiz-*`）、“small parts” 一段的 `.btn-line`、“form controls” 一段的 `.field-row`、“backup” 一段的 `.booktabs` 和 `.bt-row`（后两处给恢复摘要用）；`b.css` 的 `.btn-primary`。变量按 12 第 0 节的对应表换名；`.wiz-warn` 里写死的颜色也换成变量：底色 `--mb-u-yellow-bg`、文字 `--mb-tag-yellow-text`、图标 `--mb-u-yellow`；蓝底上的白字照原型写 `#fff`；**不加** `:root[data-style="mobai"]` 前缀（向导窗口只有墨白一种风格）；类名可以照抄原型。
- **字体**：`src/setup-ui/main.jsx` 最前面一行 `import "@fontsource-variable/noto-sans-sc";`（WP-20 已经装好）。向导里的文字都是 `--mb-sans`，路径是 `--mb-mono`，没有衬线字，所以不导入 `@fontsource-variable/noto-serif-sc`。
- **白天和夜间**：只跟随 `prefers-color-scheme`（由 WP-20 的 `nativeTheme.themeSource` 决定；第一次启动时还没有工作区偏好，就跟随 Windows）。向导里**不放**切换按钮。
- **窗口**：原型把向导画成一扇浮在灰底上的 980×640 窗口。最上面 44 px 那一行只有应用名和三个窗口按钮，产品里**不做**（窗口用系统标题栏，WP-20 已经去掉菜单栏）；窗口内容就是原型的 `.wizard` 两栏，产品里 `.wizard` 占满整个窗口（`height: 100vh`），左栏的侧栏色一直铺到窗口底部；右栏内容放不下时（恢复摘要加问题列表）在右栏里滚动（`.wiz-main` 加 `overflow: auto`）。
- **左栏** 300 px（原型 `.wiz-side`：`--mb-side` 底，上下 36 px、左右 28 px 内边距，右边不画线）：黑色方块 Logo（40 px、圆角 8 px，`--mb-ink` 底、`--mb-paper` 字，里面是 20 px 600 的“L”）、24 px 700 的“Life Atlas”、一行 14 px `--mb-muted` 的“你的笔记、数据库和密钥都只保存在这台电脑上。”、编号步骤“1 选择数据目录”“2 开始方式”（每行高 34 px、圆角 6 px、14 px 500；编号是 22 px 的圆圈，平时是 1 px `--mb-line-2` 细线、字是 `--mb-muted`；当前步骤整行 `--mb-select` 灰底、字是 `--mb-ink`，编号圆圈是 `--mb-accent` 蓝底白字；当前步骤不加粗）。
- **右栏**（原型 `.wiz-main`：上 44 px、左右 48 px、下 30 px 内边距）：28 px 700 的大标题（第一步“把数据放在哪里？”，第二步“从哪里开始？”）和一行 14 px `--mb-muted` 说明。第一步的数据目录是一张 `.wiz-option` 卡片（路径用 14 px 500 的等宽字，下面一行 13 px `--mb-muted` 是 `validateFolder` 的结果文字），这张卡片一直是选中的样子（`.wiz-option.is-active`：2 px `--mb-accent` 外框、`--mb-accent-soft` 浅蓝底；只有这一个选项，不放单选圆点），卡片右边是次按钮“更改…”；`warning` 时卡片下面出现 `.wiz-warn` 提示框（浅黄底、黄色警告图标）；按钮在右下角，主按钮（“下一步”，`existing-data-root` 时是“打开这个数据目录”）在最右，是 12 第 6 节的蓝色主按钮（高 32 px）。
- 第二步的“新建空白工作区”“从备份恢复…”是两张没有选中状态的 `.wiz-option` 卡片（1 px `--mb-line-2` 细线、圆角 10 px，悬停 `--mb-hover-soft` 底），都是 `<button>`（加 `width: 100%; text-align: left`），`aria-label` 就是标题文字，说明文字（“一个空的工作区”“选择浏览器版或桌面版导出的 .lifeatlas 文件”）用 `aria-describedby` 关联——测试按按钮名找它们。这两张卡片的标题不是路径，用 14 px 500 的 `--mb-sans`（原型的 `.wiz-option b` 是等宽字，第二张卡片靠 `.wiz-option:nth-child(4) b` 改回无衬线；这个选择器不要照抄，给标题加一个自己的类）。恢复摘要的样子和下面“从备份恢复”页的摘要相同，问题列表用危险色。

**备份与恢复对话框**

- **样式文件** `src/ui/themes/mobai/backup.css`（新文件），在 `src/ui/themes/mobai/index.css` 末尾追加一行 `@import "./backup.css";`（只能追加，前 8 行不动，WP-20 的 `tests/theme-files.test.mjs` 会检查）。规则照原型 `b-more.css` 的 “backup” 一段（`.backup`、`.bk-*`、`.booktabs`、`.bt-row`、`.keyhole-sm`）、“form controls” 一段（其中的 `.switch` 留给 WP-08）和 “home” 一段里的 `.notice` 改写：每个选择器前加 `:root[data-style="mobai"] `，变量按 12 第 0 节的对应表换名，颜色只用 `--mb-*` 变量；旧 CSS 里不写任何颜色（K13）。
- **外壳**沿用产品现有的写法：`<div className="modal-backdrop">` 里放 `<div className="ui-dialog backup-dialog">`（WP-20 的主题已经给这两个类写好 `--mb-scrim` 遮罩、`--mb-raised` 底、12 px 圆角、`--mb-dlg` 阴影和 16 px 600 的标题）。原型的 `.dialog`、`.scrim` 只是原型里的定位写法，不要抄。
- **结构**：宽 740 px；标题栏“备份与恢复”；下面是文字选项卡（`role="tablist"`，12 第 6 节）：“导出备份”“从备份恢复”“快照”（浏览器模式只有前两个）。每页是 `role="tabpanel"`，**几页都一直渲染**，不是当前页的加 `hidden` 属性——WP-02 的场景用 `setInputFiles` 选文件，隐藏的“选择备份文件”输入框必须一直在页面上。选好备份文件以后（浏览器的文件框，或桌面版 `backup.inspect()` 返回以后）自动切到“从备份恢复”页；打开对话框时在“导出备份”页，焦点仍在“导出”（桌面版“导出…”）按钮上（WP-02 场景检查 1）。`←`/`→` 在选项卡之间切换。
- **“导出备份”页**：左边是一个 48 px、圆角 12 px 的 `--mb-side` 浅灰方块，中间一个 `--mb-ink` 小锁孔（`.bk-mark` 里放 `.keyhole-sm`）；右边 18 px 600 的标题“导出完整备份”和一段 14 px `--mb-muted` 说明；下面是一张细线卡片（`.booktabs`：圆角 8 px、一圈 1 px `--mb-line`；参照图里格子之间没有竖线，不要照原型 CSS 的注释加），里面一行 `.bt-row` 写当前的页面、数据库、记录、附件数量（名称 13 px `--mb-muted`，数字 20 px 600、`tabular-nums`）；“上次导出：…”或“还没有导出过完整备份”放在原型 `.bk-last` 的位置（12 px `--mb-faint`）；超过 7 天的提醒用原型 `.notice` 的样子（`--mb-side` 底、圆角 8 px、左边 18 px `--mb-muted` 图标）；按钮在右下角。桌面版的“打开数据目录”是这一页左下角的次按钮。
- **“从备份恢复”页**：“从备份恢复…”“校验备份文件…”两个按钮；摘要分两块：数量（页面、数据库、记录、附件）放在和“导出备份”页一样的细线卡片里（`.booktabs` + `.bt-row`），其余字段每项一行，排成原型 `.field-row` 的样子（左边 110 px 的 14 px `--mb-muted` 名称，右边 14 px `--mb-ink` 的值）；“当前数据将被替换……”是危险色文字。**“快照”页**：上面是“立即创建快照”；快照列表是 12 第 8 节的网格表格（表头上下和每行下面 1 px `--mb-line` 横线，列之间 1 px `--mb-line` 竖线，最左、最右不画线；表头 14 px 400 `--mb-muted`，不加类型图标；每行高 34 px、左右内边距 8 px、14 px 字，悬停 `--mb-hover-soft` 底），时间用 `tabular-nums`，原因、大小用 `--mb-muted`，`integrity === "failed"` 的一行用危险色写“完整性检查未通过”；最下面一行 12 px `--mb-faint` 的说明小字。
- WP-02 的 `tests/browser/wp02-backup.mjs` **不改**也必须通过（上面的规则就是为它定的）。本 WP 新写的测试先点选项卡再操作。

**其他**

- 错误页的两个按钮用 12 第 6 节的主按钮和次按钮。
- 向导和对话框里说“红色”的地方一律是 12 第 3 节的危险色（`--mb-danger`）；黄色只用于向导的同步盘提示（`.wiz-warn`），其他状态不用黄色或绿色。

## 4. 范围

### 必做

第 3 节全部；第 5 节全部步骤。

### 不做

- 密钥库导出/恢复、整包加密、定期自动导出到文件夹（WP-08）。
- 合并导入（D-08）。
- 附件清理（WP-17）。

## 5. 执行步骤

### 步骤 0：开工准备【停止点】

按执行手册 3.1 节开工（分支 `wp/05-desktop-backup`），生成报告骨架，跑基线 `npm test`（日志 `.qa/WP-05/step0-npm-test.log`）。理解题：

1. 恢复备份时，附件文件写进哪里？附件表的行写进哪里？为什么不一样？
2. 交换数据库文件之前，为什么必须先做 WAL 检查点并关闭全部连接？
3. 设置了 `LIFE_ATLAS_DATA_ROOT` 但目录里没有 `workspace.db`，启动时会看到什么？
4. 用 2.1 的那组快照数据，`selectSnapshotsToDelete` 会保留哪几个？

提交 `WP-05: step 0 understanding`，运行 `node docs/blueprint/tools/wp-check.mjs WP-05 --until 0`，退出码 0 → **停止**。

### 步骤 1：依赖

```powershell
npm install --save-exact yazl@3.3.1 yauzl@3.4.0
```

只多这两个依赖。提交 `WP-05: add yazl and yauzl`。

### 步骤 2：主进程 zip 读写

按 3.1 实现。新建 `tests/desktop-zip-node.test.mjs`：

- `writer keeps entry order and never writes directory entries`
- `store and deflate follow the option`（读回的条目压缩方式分别为 0 和 8）
- `reader hashes large entries by streaming`（5 MB 条目的 `sha256` 正确）
- `verifyPackage accepts the node reader`（用 WP-02 浏览器导出的包字节写成文件，用 node reader 校验通过；再把 `tests/backup-verify.test.mjs` 的 11 种损坏情况各取一种用 node reader 跑一遍，结果代码相同）

提交 `WP-05: node zip reader and writer`。

### 步骤 3：浏览器迁移包转换

按 3.3 实现。新建 `tests/legacy-conversion.test.mjs`（起点：`upgradeWorkspace(fullWorkspace())` + WP-02 导出逻辑产生的 `assets/index.json`；`putAsset` 用一个内存假实现，返回 `life-asset://<sha256>`）：

- `local attachments become content addressed assets`（att-img、att-file 的 provider、storageKey、checksum 正确；att-orphan 也转换——它有字节）
- `attachment urls in blocks are rewritten`（p-b1 的图片块 `url === "life-asset://c414cd0e…7ce77"`）
- `data urls in icons and covers become assets`（p-c1 的 `icon`、p-z1 的 `cover.value` 都以 `life-asset://` 开头）
- `data urls in ordinary text are left alone`（先在 p-a1 加一个正文为 `data:image/png;base64,AAAA` 的段落，转换后这段文字原样不变）
- `the report lists no leftovers`

提交 `WP-05: browser package conversion`。

### 步骤 4：桌面导出

按 3.2 实现 `exportFullBackup`。先在 `tests/desktop/helpers.mjs`（普通 Node 也能用的部分）加 `seedDesktopFullWorkspace(dataRoot, { large = false } = {})`：把满配夹具（`large` 为真时先 `withLargeAttachment`）转成桌面形态——每个附件写进 `assets\` 与 `assets` 表，实体改为 `provider: "asset"`、`storageKey`/`checksum` 为 SHA-256，区块 `url` 改为 `life-asset://<sha256>`——再用 `seedWorkspaceDatabase` 写库；返回转换后的工作区对象。新建 `tests/desktop-export.test.mjs`（普通 Node，直接调用模块）：

- `export writes a package that verifies and round-trips`（读回后 13 个集合深度相等，附件哈希相等）
- `export streams large attachments`（`large: true`，包里有 21 MB 的 `assets/59b2d823…4c17`）
- `cancel removes the partial file`（在 `onProgress` 第一次回调里触发 abort → 目标文件和 `.partial-*` 都不存在 → 抛 `E_CANCELLED`）
- `a failed verification removes the partial file`（用一个会在写完后改坏临时文件的测试替身）

提交 `WP-05: desktop export`。

### 步骤 5：桌面恢复

按 3.4 实现。新建 `tests/desktop-restore.test.mjs`（普通 Node；用 WP-04 的 `createWorkspaceService` 和临时目录）：

- `restore replaces the workspace and keeps every entity`（B1 桌面版：导出 → 另一个数据目录 → `inspect` → `restore` → 深度相等，含时间字段；`generation` 变了）
- `restore converts a browser package`（B2：用 WP-02 的 `exportBrowserBackup` 在 Node 里生成浏览器迁移包 → 恢复 → 04 第 7.3 节第 2 条列出的字段里没有 `data:…;base64` 与 `#life-attachment=`；附件文件都在 `assets\` 里）
- `restore upgrades a schema 10 package`（B3：用 `workspace-v10.json` 生成的包）
- `broken packages never touch current data`（B4：各种损坏，当前 `workspace.db` 的 SHA-256 不变）
- `a failure during swap leaves current data unchanged`（B5：`injectFailure("restore-swap")` → 数据库文件 SHA-256 与恢复前相同，`.staging-*` 与 `*.replaced-*` 都已清理）
- `restore makes a pre-restore snapshot first`
- `a corrupted current database is kept aside after restore`（当前库写坏 → 恢复成功 → 数据目录里有 `workspace.db.corrupt-*`）
- `restoring a snapshot brings back the earlier state`
- `tokens are single use and expire after ten minutes`
- `wal and shm files must be gone before swapping`（用一个保持打开的额外连接制造 `-wal`，恢复应返回 `E_IO` 且数据不变）

提交 `WP-05: desktop restore`。

### 步骤 6：快照服务

按 3.5 实现。新建 `tests/desktop-snapshots.test.mjs`：

- `retention keeps the documented fourteen daily snapshots`（第 2 节的标准答案，逐个日期比较）
- `retention keeps ten snapshots per non-daily reason`（12 个 `pre-restore` 按时间编号 00–11 → 保留 02–11）
- `vault-reset snapshots are never deleted`
- `daily snapshot is created only after twenty hours`（假时钟：19 小时不建，21 小时建）
- `daily snapshot records an integrity result`
- `pre-upgrade snapshot appears when the app version changes`（`meta.lastAppVersion = "0.0.9"`，当前 `0.1.0` → 有 `-pre-upgrade` 快照，之后 `lastAppVersion === "0.1.0"`；`lastAppVersion` 不存在时没有快照）
- `listSnapshots reads snapshot.json and skips broken folders`

提交 `WP-05: snapshot service`。

### 步骤 7：备份与快照内核检查点【停止点】

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-05/step7-npm-test.log npm test
```

全部通过后提交 `WP-05: backup core checkpoint`，运行 `node docs/blueprint/tools/wp-check.mjs WP-05 --until 7`，退出码 0 → **停止**。

### 步骤 8：IPC 与主进程接线

1. `electron/main/ipc/backup.js`：注册 11 第 1 节标注 WP-05 的全部 `backup.*` 函数（`includeVault` 必须为 `false`、`encryptPassword` 必须为 `null`、`restoreVault` 必须为 `false`，否则 `E_INVALID_ARGUMENT`）；`backup.getStatus()` 的 `schedule` 返回 `null`。
2. `electron/preload/workspace.cjs` 增加 `backup.*` 与 `backup.onProgress`。
3. `index.js`：启动定时快照检查；`pre-upgrade` 写在 `workspaceService.load` 里（3.5）。
4. 测试钩子：`__lifeAtlasTest.clock`、`__lifeAtlasTest.memory`、`__lifeAtlasTest.snapshots.checkNow()`、`injectFailure`（11 第 5 节）。
5. 渲染进程：`desktopWorkspaceRepository` 遇到 `E_CONFLICT` 时抛出带 `code` 的错误，`App.jsx` 的保存逻辑看到 `E_CONFLICT` 就 `location.reload()`。

提交 `WP-05: backup ipc and main process wiring`。

### 步骤 9：首次启动向导

按 3.6、3.8 节实现（主进程 `electron/main/setup.js` + `ipc/setup.js`、preload、`setup.html`、`src/setup-ui/`（含 `setup.css`）、`vite.config.mjs` 多页面）。`npm run build` 后 `dist/client/setup.html` 必须存在。提交 `WP-05: first run wizard`。

### 步骤 10：桌面版对话框与错误页

按 3.7、3.8 节实现（样式写在 `src/ui/themes/mobai/backup.css`）。浏览器模式的对话框只有“导出备份”“从备份恢复”两个选项卡，内容与 WP-02 相同；`tests/browser/wp02-backup.mjs` 不改也必须通过。提交 `WP-05: desktop backup dialog`。

### 步骤 11：端到端测试

先在 `tests/desktop/helpers.mjs` 增加并导出下面这个函数（照抄；后面的 WP 也用它）。本 WP 的截图都用它截，放 `.qa/WP-05/shots/`：

```js
// 白天、夜间各截一张：<dir>/<name>-light.png 和 <name>-dark.png（12 第 11 节）。
// WP-20 让 nativeTheme.themeSource 决定所有窗口的模式；工作区偏好是“跟随系统”（默认）时，工作区窗口也跟着变。
export async function shootWindowBothModes(handle, page, dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  for (const mode of ["light", "dark"]) {
    await handle.app.evaluate(({ nativeTheme }, value) => { nativeTheme.themeSource = value; }, mode);
    const deadline = Date.now() + 5000;   // 在 Node 这边等：测试里装了 page.clock 时，页面里的计时器是假的
    while ((await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)) !== (mode === "dark")) {
      if (Date.now() > deadline) throw new Error(`窗口没有切换到 ${mode}`);
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(dir, `${name}-${mode}.png`) });
  }
  await handle.app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = "system"; });
}
```

（`helpers.mjs` 已经导入了 `fs`、`path` 就直接用；没有就在文件开头补 `import fs from "node:fs";`、`import path from "node:path";`。）

新建 `tests/desktop/first-run.e2e.mjs`（`launchApp({ dataRoot: null })`，`LIFE_ATLAS_BOOTSTRAP_DIR` 为空的临时目录），用例：

- `wizard creates a blank workspace in the chosen folder`：出现向导窗口；`queueDialogResponse(handle, "showOpenDialog", { canceled: false, filePaths: [新临时目录] })` 后点“更改…”→ 显示“将创建这个文件夹”→“下一步”→“新建空白工作区”→ 应用退出（退出码 0）→ bootstrap 目录里有 `bootstrap.json`，内容指向该目录 → 用同一个 `LIFE_ATLAS_BOOTSTRAP_DIR`、不设 `LIFE_ATLAS_DATA_ROOT` 再启动 → 打开“开始使用 Life Atlas”。截图（向导窗口）：第一步显示“将创建这个文件夹”时 `shootWindowBothModes(handle, 向导窗口的 page, ".qa/WP-05/shots", "wizard")`（和参照图同名），第二步截 `wizard-start`。
- `wizard folder rules are enforced`：分别选择“已有其他文件的文件夹”（`error`，“下一步”禁用）、“已有标记文件的数据目录”（`ok`，按钮“打开这个数据目录”）、路径里带 `OneDrive` 的新文件夹（`warning`，仍可下一步）。
- `wizard restores a browser migration package`：在 Node 里用 `exportBrowserBackup` 生成满配夹具的迁移包（含 3 个附件字节）→ 向导里选目录 → “从备份恢复…”（`showOpenDialog` 队列放入包路径）→ 摘要里来源显示“浏览器”→“恢复”→ 退出后再启动 → “B 笔记”的图片能显示、“C 深层”的图标是图片、“Z 目标页”有封面；用 Node 读 `workspace.db`，04 第 7.3 节第 2 条的字段里没有 `data:…;base64` 与 `#life-attachment=`。截图 `after-migration`（`shootWindowBothModes`）。

新建 `tests/desktop/backup.e2e.mjs`，用例：

- `export and restore keep every entity and asset`（B1：`seedDesktopFullWorkspace(root1, { large: true })` → 启动 → 打开“备份与恢复”→ 截图 `backup`（“导出备份”页，和参照图同名）→“导出…”（`showSaveDialog` 队列放入路径）→ 关闭 → 用全新的 `root2` 启动 → “从备份恢复…”→ 恢复 → 关闭 → 用 Node 比较两个库：13 个集合深度相等，`assets\` 里所有文件哈希相同）
- `restore makes a snapshot and old windows cannot overwrite`（恢复前出现 `-pre-restore` 快照；恢复前在渲染进程里保存一个旧 changeset 的副本，恢复后直接调用 `applyChanges(旧 changeset)` → `E_CONFLICT`）
- `broken packages are rejected with readable reasons`（B4：改坏 1 字节的包 → 对话框列出问题，没有“恢复”按钮；数据库 SHA-256 不变）
- `injected swap failure keeps data unchanged`（B5）
- `verify reports a damaged file`（导出的文件“校验”为完整；改 1 字节后“校验”指出哪个文件）
- `export of one gigabyte stays within memory budget`（往 `assets\` 写 4 个 256 MB 文件——每个文件是 `fixtureBytes("big-<k>", 1048576)` 重复 256 次——并在库里登记 → `__lifeAtlasTest.memory.start()` → 导出 → `stop()` → `peakRss - baselineRss < 300 * 1024 * 1024`，打印 `WP05_EXPORT_PEAK_MB=`；再导出一次并在进度回调第一次出现后点“取消”→ 目标目录里没有 `.partial-*`）
- `daily snapshots follow the clock`（`clock.set` 到 21 小时后 → `snapshots.checkNow()` → 有新的 `daily`；列表在对话框的“快照”页里显示“每日”；截图 `backup-snapshots`）
- `restore is recorded in the log without content`（`logs\` 里有 `backup.restore` 一行，不包含任何页面标题）
- `error page offers snapshot and backup recovery`（写坏数据库 → 错误页有“从快照恢复”“从备份恢复”两个按钮；从快照恢复后能正常打开工作区）

运行：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-05/build.log npm run build
node docs/blueprint/tools/run-logged.mjs .qa/WP-05/desktop-build-test.log npm run desktop:build:test
node docs/blueprint/tools/run-logged.mjs .qa/WP-05/desktop-e2e.log npm run test:e2e:desktop
```

然后生成对照图：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-05/compare.log node docs/blueprint/tools/compare-shots.mjs docs/blueprint/design/mobai/shots .qa/WP-05/shots --only wizard,backup --out .qa/WP-05/compare
```

退出码 0。向导截图只有窗口内容（参照图是 1440×900、窗口浮在中间），备份对话框背后的页面也和参照图不同，所以差异占比没有参考意义；把 `summary.md` 复制进报告第 3 节，并逐张写出你看到的不同之处（布局、字体、颜色、线条）。

提交 `WP-05: desktop backup and first run e2e tests`。

### 步骤 12：搬家操作说明

在报告最后加一节“给用户的搬家操作说明”，按实际界面写：安装（`release\release\Life Atlas Setup 0.1.0.exe`）→ 首次启动选数据目录（建议 `D:\LifeAtlas`）→“从备份恢复…”选 WP-02 时导出的文件 → 检查页面、数据库、图片 → 之后每周“导出完整备份”到另一块硬盘或 U 盘 → 确认无误之前不要清理浏览器数据。

### 步骤 13：收尾【停止点】

填完报告（第 3 节写出 `WP05_EXPORT_PEAK_MB` 实测值）；第 0 节全部“完成”；提交 `WP-05: complete report`；运行：

```powershell
node docs/blueprint/tools/wp-check.mjs WP-05 --browser --desktop
```

退出码 0 或 2 → 停止。

## 6. 验收标准

| 编号 | 标准 | 证据 |
| --- | --- | --- |
| AC-05-1 | 首次启动向导两种路径都能完成；目录规则逐条有测试；测试不写真实 `%APPDATA%` | `tests/desktop/first-run.e2e.mjs`；截图 `.qa/WP-05/shots/wizard-*.png` |
| AC-05-2 | B1（不含密钥库）：满配夹具（含 21 MB 附件）导出 → 新数据目录恢复 → 逐实体深度相等、附件哈希相等 | `tests/desktop-restore.test.mjs`；「export and restore keep every entity and asset」 |
| AC-05-3 | B2：浏览器迁移包导入后正文、数据库一致，图片/图标/封面能显示，指定字段里没有残留 | `tests/legacy-conversion.test.mjs`；「wizard restores a browser migration package」；`.qa/WP-05/shots/after-migration-*.png` |
| AC-05-4 | B3：schema 10 的包导入后迁移到当前版本 | `tests/desktop-restore.test.mjs`「restore upgrades a schema 10 package」 |
| AC-05-5 | B4：各种损坏都被拒绝，当前数据文件 SHA-256 不变 | `tests/desktop-restore.test.mjs`；「broken packages are rejected with readable reasons」 |
| AC-05-6 | B5：交换步骤注入失败 → 数据与恢复前完全一致；`-wal` 残留时拒绝交换 | `tests/desktop-restore.test.mjs`；「injected swap failure keeps data unchanged」 |
| AC-05-7 | 恢复前自动出现 `pre-restore` 快照；恢复后旧窗口的保存返回 `E_CONFLICT` | 「restore makes a snapshot and old windows cannot overwrite」 |
| AC-05-8 | 导出 1 GB 附件时主进程内存峰值增加 < 300 MB（报告写实测值）；导出可取消且不留临时文件 | 「export of one gigabyte stays within memory budget」；`tests/desktop-export.test.mjs` |
| AC-05-9 | 快照：保留策略与第 2 节标准答案一致；每日触发条件、`pre-upgrade`、完整性检查结果、从快照恢复都正确 | `tests/desktop-snapshots.test.mjs`；「daily snapshots follow the clock」 |
| AC-05-10 | “校验备份文件”：完整的判定为完整，改 1 字节后指出文件 | 「verify reports a damaged file」 |
| AC-05-11 | 恢复记录写入 `logs\`，不含页面内容 | 「restore is recorded in the log without content」 |
| AC-05-12 | 数据库读不出时，错误页可以从快照或备份恢复；损坏的旧文件被保留 | 「error page offers snapshot and backup recovery」；「a corrupted current database is kept aside after restore」 |
| AC-05-13 | 视觉：向导和“备份与恢复”对话框照墨白做（3.8 节），白天和夜间的截图齐全，与参照图 `wizard-*`、`backup-*` 并排对照；向导和对话框随模式切换；WP-02 的浏览器场景不改仍然通过 | `.qa/WP-05/shots/`；`.qa/WP-05/compare/summary.md`；报告第 3 节；`.qa/WP-05/wp-check.md`（浏览器场景） |
| AC-05-14 | G1–G9 | `.qa/WP-05/wp-check.md` |

## 7. 卡点处理

| 情况 | 做法 |
| --- | --- |
| 测试里向导结束后进程没有退出 | 检查测试钩子开启时是否跳过了 `app.relaunch()` 并调用了 `app.exit(0)` |
| 交换时报文件被占用（`EBUSY`/`EPERM`） | 说明还有连接没关：检查 `workspaceService` 的关闭顺序与 `wal_checkpoint`；不要用重试循环掩盖 |
| 1 GB 测试太慢（超过 10 分钟） | 先确认生成测试文件时没有逐字节计算；仍然太慢就把用时写进报告第 6 节，不要缩小文件 |
| 内存峰值超标 | 检查附件是否用了 `addFile`（流式）而不是 `addBuffer`；检查导出后的校验是否用了流式 `sha256` |
| 摘要里来源显示不对 | `summary.platform` 来自 manifest 的 `app.platform`，界面显示“桌面”或“浏览器” |
| 向导或对话框在夜间还是白色 | 向导：夜间变量要写在 `setup.css` 的 `@media (prefers-color-scheme: dark)` 里，测试里要先用 `shootWindowBothModes` 设好 `nativeTheme.themeSource`；对话框：样式要写在 `src/ui/themes/mobai/backup.css`，并且 `index.css` 末尾导入了它 |
| WP-02 的场景因为选项卡失败 | 先确认几页都一直渲染（不是当前页的只加 `hidden`）、选好文件后自动切到“从备份恢复”、打开时焦点在“导出”上；仍失败就停下报告，不要改 `wp02-backup.mjs` |
