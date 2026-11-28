# WP-04 桌面存储与附件文件化（schema v12）

- 规模：L · 前置：WP-03 · 分支：`wp/04-desktop-storage`
- 停止点：步骤 0（理解确认）、步骤 8（存储内核完成，接入界面之前）、步骤 14（收尾）
- 必读：`09-执行手册.md`、`02-总体架构.md` 第 3、4、5、6、9 节、`11-接口契约.md` 第 1 节（WP-04 的行）、第 4.1–4.2 节、第 5 节；`10-测试夹具规格.md` 第 5 节；源码 `src/main.jsx`、`src/App.jsx`（两个保存 effect、`currentWorkspaceSnapshot`、`createEditorAttachment`、`resolveEditorAttachmentUrl`）、`src/persistence/*`、`src/domain/attachments.js`、`src/components/AppearanceGlyph.jsx`、`src/components/PageCustomizePanel.jsx`、`src/editor/PageEditor.jsx`

## 0. 一页纸

- **要做到**：桌面版的数据保存在 `<DataRoot>\workspace.db`（SQLite），附件存成 `<DataRoot>\assets\` 下的文件并用 `life-asset://` 显示；每次只保存变化的部分；退出时不丢最后的修改；数据库读不出来时绝不覆盖它。这是之后所有功能的地基。
- **交付物**：schema v12；`src/domain/blankWorkspace.js`；`electron/main/storage/` 下的 `workspaceDb.js`、`workspaceService.js`、`snapshots.js`、`assetStore.js`；`electron/main/assetProtocol.js`；IPC 与 preload 新增的 6 个函数；`src/persistence/changeset.js`、`desktopWorkspaceRepository.js`；改造后的 `main.jsx`、`App.jsx`、附件上传；大数据量夹具；单元测试与 `tests/desktop/storage.e2e.mjs`。
- **绝对不要**：引入任何 SQLite npm 包（用 Electron 自带的 `node:sqlite`）；数据库检查失败后执行任何会写文件的操作；改动浏览器模式的存储行为；做首次启动向导、导入、快照列表（WP-05）；把 `data:` 字符串转成附件（WP-05）。
- **什么时候停**：步骤 0 后停；步骤 8 后停；步骤 14 的 wp-check 退出码为 0 或 2 时停。

## 1. 为什么做

浏览器 localStorage 有容量上限、受地址影响、清缓存就没了。桌面版改为数据目录里的 SQLite 数据库，附件存成文件。

## 2. 已知事实（总设计师 2026-11-01 实测）

| 事实 | 影响 |
| --- | --- |
| Node 24.17 自带 `node:sqlite`（SQLite 3.53.0），Electron 44.4.5 主进程里是 3.53.4；`new DatabaseSync(file)`、`exec`、`prepare().run/get/all` 可用；`{ readOnly: true }` 选项可用 | 单元测试直接在普通 Node 里跑主进程存储模块 |
| `PRAGMA journal_mode = WAL` + `PRAGMA synchronous = FULL` 生效；正常 `close()` 后 `-wal` 文件消失 | |
| 对一个被写坏（中间 512 字节改乱）的数据库：能打开，`PRAGMA quick_check` **返回**一条不是 `ok` 的文字（不抛异常）；文件没有被改动 | 先检查、后设置 `journal_mode` |
| 对一个完全不是数据库的文件：能“打开”，执行 `PRAGMA quick_check` 时**抛出** `file is not a database`；文件没有被改动 | 两种情况都要当作“读取失败” |

## 3. 设计要点（规定）

### 3.1 schema v12

- `src/domain/attachments.js`：`allowedProviders` 加入 `"asset"`（否则 `normalizeAttachment` 会把它改成 `"external"`）。
- `src/persistence/migrations.js`：新增 `migrateAssetProvider(input)`：先调用 `migrateTrashGroups`；`schemaVersion >= 12` 直接返回；否则复制一份，**不改任何数据**，只把 `schemaVersion` 设为 12。`CURRENT_SCHEMA_VERSION = 12`；`upgradeWorkspace` 调用它。

### 3.2 新建空白工作区

`src/domain/blankWorkspace.js` 导出 `createBlankWorkspace({ now, idFactory })`，返回 schema 12 的工作区：13 个集合（只有 folders、pages、people 有内容），`people` 里只有 `{ id: "person-local", displayName: "我", local: true, createdAt: now, updatedAt: now }`；`ui = { selectedFolderId: <文件夹 id>, selectedPageId: <页面 id>, expandedFolderIds: [<文件夹 id>], privateExpanded: true, currentPersonId: "person-local", assetPreferences: { recentEmojiIds: [], recentIconIds: [], recentCoverIds: [], favoriteCoverIds: [] } }`；`workspaceId = idFactory("ws")`；`savedAt = now`。

- 文件夹：名称“我的空间”，`parentId: null`，`sortIndex: 10`，`color: "stone"`。
- 页面：标题“开始使用 Life Atlas”，图标 `"👋"`，放在上面的文件夹里，`settings` 用默认值，正文依次是：
  1. `{ type: "heading", props: { level: 2 }, content: "欢迎" }`
  2. `{ type: "paragraph", content: "这里是你的私人工作空间，所有内容只保存在这台电脑的数据目录里。" }`
  3. `{ type: "checkListItem", props: { checked: false }, content: "输入 / 试试添加标题、待办、表格和数据库" }`
  4. `{ type: "checkListItem", props: { checked: false }, content: "在左上角菜单里找到“备份与恢复”，导出第一份完整备份" }`
  5. `{ type: "checkListItem", props: { checked: false }, content: "打开模板库，试试“软件开发进程”模板" }`
  每个区块的 `id` 用 `idFactory("block")`。

### 3.3 workspace.db 模块（`electron/main/storage/workspaceDb.js`，不 import electron）

```js
export class StorageError extends Error {}            // constructor(code, message)；code 用 02 第 6 节的错误码
export function openWorkspaceDatabase(file)           // → DatabaseSync；只设置 busy_timeout 与 foreign_keys（都不写文件）
export function quickCheck(db)                        // → "ok" 或问题文字；抛异常时返回异常信息
export function prepareWritable(db)                   // 设置 journal_mode=WAL、synchronous=FULL，并 CREATE TABLE IF NOT EXISTS（02 第 4.1 节）
export function readAllRows(db)                       // → { meta: Map<key, 字符串>, entities: Map<collection, Map<id, json字符串>> }
export function assembleWorkspace(rows)               // → workspace；任何 JSON 解析失败抛 StorageError("E_CORRUPT")
export function initializeWorkspace(db, workspace, { generation, now })        // 空库里写入全部内容（一个事务）
export function writeWorkspaceDiff(db, rows, workspace, { now })                // 与 rows 比较，只写变化（一个事务）；有变化时更新 meta.savedAt
export function applyChangeset(db, changeset, { now, expectedGeneration })      // → { savedAt }（一个事务）
export function vacuumInto(db, targetFile)
```

- 集合列表用 `src/backup/format.js` 的 `BACKUP_COLLECTIONS`（只维护一份白名单）。
- workspace 与表的对应：每个集合的每个实体一行（`json = JSON.stringify(实体)`，`updated_at` 取实体的 `updatedAt`，没有就用 `now`）；`meta` 写 `schemaVersion`、`workspaceId`、`savedAt`、`ui`、`generation`、`extras`（值都是 `JSON.stringify` 的结果）。`assembleWorkspace` 反过来组装，形状见 11 第 4.2 节（`extras` 里的字段展开回顶层）。
- 事务：`db.exec("BEGIN IMMEDIATE")` … `db.exec("COMMIT")`；出错 `db.exec("ROLLBACK")` 后重新抛出。
- `applyChangeset` 的校验（任何一条不满足就整批拒绝，抛 `StorageError("E_INVALID_ARGUMENT", …)`，数据库不变）：`collection` 在白名单内；`id` 是 1–200 字符的字符串；`json` 能解析成对象且对象的 `id` 等于 `id`；单个 `json` 不超过 20 MB；`deletes` 同样校验 `collection` 与 `id`；`ui` 为 `null` 或对象。`changeset.generation !== expectedGeneration` → 抛 `StorageError("E_CONFLICT", …)`。

### 3.4 加载流程（`electron/main/storage/workspaceService.js`，不 import electron）

```js
export function createWorkspaceService({ dataRoot, now, idFactory, normalize, createSnapshot, currentSchemaVersion, logger })
// → { load(), applyChanges(changeset), status(), close(), timings: { lastLoadMs, lastApplyMs } }
```

`load()` 严格按顺序：

1. `workspace.db` 不存在 → 打开（会新建）→ `prepareWritable` → `initializeWorkspace(db, createBlankWorkspace({ now, idFactory }), { generation: idFactory("gen"), now })`。
2. 存在 → `openWorkspaceDatabase` → `quickCheck` 不是 `"ok"` → **关闭连接**，进入“只读错误”状态，返回 `E_CORRUPT`。**在这之前不能调用 `prepareWritable`。**
3. `prepareWritable` → `readAllRows` → `assembleWorkspace`（失败 → 关闭连接，进入“只读错误”状态）。
4. `schemaVersion < currentSchemaVersion` → `createSnapshot({ reason: "pre-migration" })`。
5. `normalized = normalize(workspace, { fallbackWorkspace: workspace, now, idFactory })`（传入的就是 `normalizeLoadedWorkspace`）。
6. `writeWorkspaceDiff(db, rows, normalized, { now })`。
7. 返回 `{ workspace: normalized, generation }`，记录 `timings.lastLoadMs`。

“只读错误”状态下：`load()` 一律返回 `E_CORRUPT`，`applyChanges()` 一律返回 `E_CORRUPT`，不再打开数据库，**不修改任何文件**。

`applyChanges(changeset)`：调用 `applyChangeset`，记录 `timings.lastApplyMs`。

### 3.5 快照基础函数（`electron/main/storage/snapshots.js`，不 import electron）

`createSnapshot({ dataRoot, reason, databases, appVersion, schemaVersion, counts, now })`：`databases` 是 `[{ name: "workspace.db", db }]`；在 `snapshots\<UTC 时间 YYYY-MM-DDTHH-mm-ss-SSSZ>-<原因>\` 里对每个库执行 `vacuumInto`，然后写 `snapshot.json`（04 第 6 节的字段，`integrity` 本 WP 不写）。返回 `{ id: 目录名, path }`。保留策略、列表、恢复都在 WP-05。

### 3.6 附件（`electron/main/storage/assetStore.js` 与 `electron/main/assetProtocol.js`）

```js
// assetStore.js（不 import electron）
export function createAssetStore({ assetsDir, db, now })
// → { put({ bytes, mime, name }) → { assetId, url, created }, get(sha256) → 元数据或 null, filePath(sha256) }
```

- `put`：严格按 02 第 5 节；`bytes` 超过 1 GB 抛 `StorageError("E_INVALID_ARGUMENT")`；写临时文件 `<目标>.tmp-<8 位随机十六进制>` 再改名；`INSERT OR IGNORE INTO assets`。
- `assetProtocol.js`（可以 import electron）导出：
  - `parseAssetUrl(url)`：只接受 `life-asset://<64 位小写十六进制>`（结尾可以有一个 `/`），否则返回 `null`；
  - `parseRangeHeader(value, size)`：只支持单段 `bytes=start-end`、`bytes=start-`、`bytes=-suffix`，返回 `{ start, end }`，格式错误或越界返回 `"invalid"`，没有该头返回 `null`；
  - `installAssetProtocol(targetSession, { assetStore })`：`protocol.handle("life-asset", …)`：地址格式不对 → 400；查不到元数据或文件 → 404；`Range` 无效 → 416；有效 → 206 + `Content-Range`；否则 200。响应头：`Content-Type`（`text/html` 改为 `text/plain`）、`Content-Length`、`Accept-Ranges: bytes`、`X-Content-Type-Options: nosniff`、`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:`。响应体用 `Readable.toWeb(fs.createReadStream(file, { start, end }))`。
- `registerAppScheme()`（WP-03 的函数）里一并注册 `{ scheme: "life-asset", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }`。

### 3.7 IPC、preload 与退出保存

- `electron/main/ipc/workspace.js`：`la:workspace:load`、`la:workspace:apply-changes`（参数先做 3.3 的校验，再调用服务；`StorageError` 转成 `{ ok: false, error: { code, message } }`）。
- `electron/main/ipc/assets.js`：`la:assets:put`（`bytes` 必须是 `ArrayBuffer`，`mime` ≤ 200 字符，`name` ≤ 255 字符）。
- `electron/main/ipc/app.js` 增加 `la:app:open-data-folder`（经 `dialogs.js` 调用 `shell.openPath`；测试钩子开启时只记录到 `__lifeAtlasDialogs.calls`）。
- `electron/preload/workspace.cjs` 增加：`app.onFlushRequest(callback)`、`app.flushDone()`、`app.openDataFolder()`、`workspace.load()`、`workspace.applyChanges(changeset)`、`assets.put(args)`。
- **退出保存**：工作区窗口的 `close` 事件与 `app` 的 `before-quit`：第一次触发时 `preventDefault()`，向窗口发 `la:app:flush-request`，等 `la:app:flush-done` 或 3 秒超时，然后真正关闭/退出（用一个标志避免重复）。
- 测试钩子开启时把 `service.timings` 挂到 `globalThis.__lifeAtlasTest.storageTimings`。

### 3.8 渲染进程

- `src/persistence/changeset.js`：

  ```js
  export function createChangeTracker(savedWorkspace)
  // → { diff(nextWorkspace) → { upserts, deletes, ui }, commit(nextWorkspace), isEmpty(diff) }
  ```

  每个集合按 `id` 建 `Map(id → 实体对象引用)`；`diff` 时**按引用比较**：新增或引用变了 → upsert（`json = JSON.stringify(实体)`）；旧的有、新的没有 → delete；`ui` 用 `JSON.stringify` 比较，不同时返回新 `ui`，相同为 `null`。集合列表用 `BACKUP_COLLECTIONS`。
- `src/persistence/desktopWorkspaceRepository.js`：

  ```js
  export function createDesktopWorkspaceRepository(bridge)   // bridge 就是 window.lifeAtlas
  // → { kind: "desktop", load() → Promise<workspace>, save(snapshot) → Promise<{ savedAt } | null> }
  ```

  `load` 调用 `bridge.workspace.load()`，失败时抛出带 `code` 的错误；成功后用结果建 tracker、记下 `generation`。`save`：`diff` 为空返回 `null`；否则 `applyChanges({ generation, schemaVersion: CURRENT_SCHEMA_VERSION, ...diff })`，成功后 `commit`，失败时**不** `commit`（下次 diff 会带上这次没保存的改动）并抛错。
- `src/main.jsx`：启动时先渲染启动画面 `<div className="app-boot">正在打开工作区…</div>`；根据 `window.lifeAtlas?.platform === "desktop"` 选择适配器；`await repository.load(seedWorkspace)`（浏览器适配器是同步的，`await` 照样可用）；成功后渲染 `<React.StrictMode><App repository={repository} initialWorkspace={workspace} /></React.StrictMode>`；`code === "E_CORRUPT"` 时渲染错误页（新组件 `src/components/StorageErrorPage.jsx`）：标题“数据无法读取”，正文“为保护原始数据，应用没有做任何修改。你可以从快照或备份恢复。”，按钮“打开数据目录”（调用 `window.lifeAtlas.app.openDataFolder()`）。快照与恢复按钮在 WP-05 加。
- `src/App.jsx`：
  - 删除模块顶层的 `const repository = createBrowserWorkspaceRepository();`，`App` 改为接收 `{ repository, initialWorkspace }`；删除 `useState(() => repository.load(seedWorkspace))`；
  - 保存：保留 450 ms 防抖；实际保存用 `repository.save(latestSnapshotRef.current)`（`latestSnapshotRef.current = currentWorkspaceSnapshot()` 每次渲染更新）并 `await`；失败时桌面版显示“保存失败，正在重试”并在 3 秒后再保存一次（再失败继续每 3 秒重试），浏览器版保持现有的“保存失败”；
  - `beforeunload` 同步保存只在浏览器模式注册；桌面模式改为 `window.lifeAtlas.app.onFlushRequest(async () => { 立即保存; window.lifeAtlas.app.flushDone(); })`；
  - 首次渲染后 `document.documentElement.dataset.laReady = "1"`；
  - 删除 WP-03 的开发预览提示条（以及它的 `data-testid`）。

### 3.9 附件上传（桌面模式）

| 入口 | 现在 | 桌面模式改为 |
| --- | --- | --- |
| 编辑器图片/文件/视频/音频/PDF 上传（`createEditorAttachment`） | `persistBrowserAttachment` → `blob:…#life-attachment=<id>` | `assets.put` → 区块 `url = life-asset://<sha256>`；新增附件实体 `{ id: "attachment-<uuid>", name, mime, size, provider: "asset", storageKey: <sha256>, checksum: <sha256>, externalUrl: null, metadata: {}, createdAt, updatedAt }` |
| 页面图标上传、封面上传（`PageCustomizePanel` 的 `uploadIcon`/`uploadCover`） | `readAsDataURL` → `data:` 字符串 | 新 prop `uploadImage(file) → Promise<url>`：桌面用 `assets.put` 返回 `life-asset://…`；浏览器沿用 `readAsDataURL` |
| 显示 | `AppearanceGlyph` 只把 `data:image/` 当图片 | `life-asset://` 同样当图片；`PageCustomizePanel` 与 `App.jsx` 里判断“上传的图标”的两处 `startsWith("data:image/")` 同样接受 `life-asset://` |

- 上传前检查大小：超过 1 GB → `window.alert("单个文件不能超过 1 GB")` 并放弃；超过 200 MB → `window.confirm("这个文件超过 200 MB，确定要上传吗？")`。
- 桌面模式下 `resolveEditorAttachmentUrl` 不需要做任何事（`life-asset://` 地址是固定的），保持浏览器模式原样。

## 4. 范围

### 必做

第 3 节全部；第 5 节全部步骤。

### 不做

- 首次启动向导、导入迁移包、桌面导出/恢复、快照列表与保留策略、`pre-upgrade` 快照（WP-05）。
- 把 `data:` 字符串转换为附件（WP-05 导入时做）。
- 远程图片的“外部链接”卡片样式（WP-14）。
- 附件清理（WP-17）。

## 5. 执行步骤

### 步骤 0：开工准备【停止点】

按执行手册 3.1 节开工（分支 `wp/04-desktop-storage`），生成报告骨架，跑基线 `npm test`（日志 `.qa/WP-04/step0-npm-test.log`）。报告第 1 节写理解并回答：

1. 数据库检查失败后，哪些操作是禁止的？为什么 `journal_mode` 要在检查之后才设置？
2. 渲染进程保存失败时，未保存的改动在哪里？下一次保存会不会丢掉它们？
3. 桌面版第一次打开一个全新的数据目录时，工作区里有什么内容？
4. 迁移到 v12 会改动哪些数据？

提交 `WP-04: step 0 understanding`，运行 `node docs/blueprint/tools/wp-check.mjs WP-04 --until 0`，退出码 0 → **停止**。

### 步骤 1：schema v12

按 3.1 实现。新建 `tests/migration-v12.test.mjs`，用例：

（直接调用 `migrateAssetProvider`，不要用 `upgradeWorkspace`，见执行手册 4.2 节。）

- `v12 keeps asset providers intact`（`normalizeAttachment({ provider: "asset", storageKey: "a".repeat(64) })` 的 `provider === "asset"`）
- `v12 only bumps the schema version`（`migrateAssetProvider(满配夹具)` 与 `migrateTrashGroups(满配夹具)` 相比，除 `schemaVersion`（12 对 11）外深度相等）
- `v12 is idempotent`

提交 `WP-04: schema v12 asset provider`。

### 步骤 2：空白工作区

按 3.2 实现。新建 `tests/blank-workspace.test.mjs`，用例：

- `blank workspace has one folder and the welcome page`（标题、5 个区块的类型与文字逐个断言）
- `blank workspace passes the integrity checker`（`checkWorkspaceIntegrity().ok === true`）
- `blank workspace contains no seed sample data`（没有 `workspaceSeed.js` 里的任何页面标题）

提交 `WP-04: blank workspace`。

### 步骤 3：workspaceDb.js

按 3.3 实现。新建 `tests/desktop-workspace-db.test.mjs`（每个用例在临时目录里建库，结束时关闭连接再删除目录），用例：

- `a new database uses WAL and synchronous FULL`（`PRAGMA journal_mode` 为 `wal`，`PRAGMA synchronous` 为 `2`）
- `full fixture round-trips through the database`（`initializeWorkspace` 写入 `upgradeWorkspace(fullWorkspace())`，`assembleWorkspace(readAllRows(db))` 与原对象深度相等）
- `applyChangeset writes only the given entities and the ui`
- `applyChangeset rejects the whole batch on any invalid entry`（6 种：不在白名单、空 id、201 字符 id、坏 JSON、id 不一致、超过 20 MB；每种之后数据库内容不变）
- `applyChangeset rejects a stale generation with E_CONFLICT`
- `writeWorkspaceDiff writes nothing when nothing changed`（`savedAt` 不变）
- `quickCheck reports a corrupted page without changing the file`（照第 2 节的方法改乱 8192 起的 512 字节；前后 SHA-256 相同）
- `quickCheck reports a non-database file without changing it`

提交 `WP-04: workspace database module`。

### 步骤 4：快照基础函数

按 3.5 实现。新建 `tests/desktop-snapshots-basic.test.mjs`：

- `createSnapshot writes a readable copy and snapshot.json`（副本能用 `assembleWorkspace` 读出相同内容；`snapshot.json` 有 `createdAt`、`reason`、`appVersion`、`schemaVersion`、`counts`、`files`，`files` 里的 `sha256` 正确）

提交 `WP-04: basic snapshot`。

### 步骤 5：加载流程

按 3.4 实现。新建 `tests/desktop-workspace-service.test.mjs`：

- `an empty data root gets the blank workspace`
- `a schema 10 database is snapshotted, migrated and written back`（用 `tests/fixtures/workspace-v10.json` 建库 → `load()` → 出现一个 `-pre-migration` 快照目录；返回的 `schemaVersion === CURRENT_SCHEMA_VERSION`；再打开数据库读出的也是它——不要写死 12，以后的 WP 会继续升级版本）
- `normalization results are written back`（库里放一个缺少页面默认字段的页面 → `load()` 后数据库里该页面已有默认字段）
- `a corrupted database enters read-only error mode and is never modified`（`load()` 返回 `E_CORRUPT`；`applyChanges()` 返回 `E_CORRUPT`；文件 SHA-256 不变；目录里没有新增 `-wal`）
- `timings record load and apply durations`

提交 `WP-04: workspace service load flow`。

### 步骤 6：附件存储与协议辅助函数

按 3.6 实现 `assetStore.js` 和 `assetProtocol.js` 里的两个纯函数。新建 `tests/desktop-asset-store.test.mjs`：

- `put stores the file under its sha256 once`（同一内容 `put` 两次：只有一个文件，第二次 `created === false`）
- `put rejects files over 1 GB`（用一个假的 `bytes` 对象，`byteLength` 设为 1 GB + 1，不要真的分配内存）
- `parseAssetUrl accepts only 64 lowercase hex digits`
- `parseRangeHeader handles the three single-range forms and rejects the rest`

提交 `WP-04: asset store`。

### 步骤 7：changeset.js 与桌面适配器

按 3.8 前两条实现。新建 `tests/changeset.test.mjs`：

- `diff is empty when nothing changed`
- `diff contains added, changed and deleted entities only`
- `ui changes are detected by value`
- `commit moves the baseline`
- `desktop repository keeps unsaved changes after a failed save`（用假 bridge：第一次 `applyChanges` 失败，第二次成功；第二次的 changeset 同时包含两次的改动）
- `desktop repository sends the loaded generation`

提交 `WP-04: change tracker and desktop repository`。

### 步骤 8：存储内核检查点【停止点】

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-04/step8-npm-test.log npm test
```

全部通过后，报告第 0 节步骤 1–8 改为“完成”，提交 `WP-04: storage core checkpoint`，运行：

```powershell
node docs/blueprint/tools/wp-check.mjs WP-04 --until 8
```

退出码 0 → **停止**，等用户确认后继续步骤 9。

### 步骤 9：主进程接线

1. `electron/main/index.js`：在 02 第 3.1 节第 9 步“创建工作区窗口”之前创建 `assetStore` 与 `workspaceService`（`normalize` 传 `normalizeLoadedWorkspace`，`createSnapshot` 传一个调用 3.5 函数的包装，`idFactory = (prefix) => prefix + "-" + crypto.randomUUID()`）；在默认会话上 `installAssetProtocol`；注册 3.7 的 IPC；实现 3.7 的退出保存；`before-quit` 最后关闭数据库。
2. `electron/preload/workspace.cjs`：按 3.7 增加 6 个函数（形状与 11 第 1 节一致）。
3. 测试钩子：3.7 最后一条。

提交 `WP-04: wire storage into the main process`。

### 步骤 10：渲染进程接线

按 3.8 后两条改 `src/main.jsx`、`src/App.jsx`，新建 `src/components/StorageErrorPage.jsx`。浏览器模式必须完全不变：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-04/step10-npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-04/step10-browser.log npm run test:parity:browser
```

都必须 `exit=0`。提交 `WP-04: async repository boot and desktop saving`。

### 步骤 11：附件上传

按 3.9 实现。提交 `WP-04: file-based attachments in desktop mode`。

### 步骤 12：大数据量夹具

按 `10-测试夹具规格.md` 第 5 节新建 `tests/fixtures/big-workspace.mjs`，ID 规则：顶层文件夹 `big-f-0`…`big-f-9`，子文件夹 `big-f-<i>-<j>`（j 为 0–49）；普通页面 `big-p-<n>`，按 n 依次轮流放进 500 个子文件夹；整页数据库页面 `big-db-page`（在 `big-f-0`），数据源 `big-ds`（属性 `title`/标题、`status`/状态（选项 todo/doing/done）、`amount`/数字、`due`/日期）和它的表格视图 `big-view`（`createDatabaseView({ id: "big-view", sourceId: "big-ds", name: "表格", type: "table" })`，`big-db-page.databaseViewId = "big-view"`；没有视图时整页数据库只显示“此数据源还没有视图”，WP-15 的性能测试会看不到任何行）；记录 `big-i-<n>` 与记录页面 `big-r-<n>`（都在 `big-f-0`）；时间从 `FIXTURE_TIME` 起每个实体加 1 秒。新建 `tests/fixture-big-workspace.test.mjs`：

- `big fixture has the requested sizes and is deterministic`（默认 5000 页面 + 20000 记录；两次调用 `JSON.stringify` 相等；`pages.length === 25001`）

提交 `WP-04: big workspace fixture`。

### 步骤 13：端到端测试

1. `tests/desktop/helpers.mjs` 增加 `async seedWorkspaceDatabase(dataRoot, workspace)`：在普通 Node 里用 `workspaceDb.js` 建 `<dataRoot>\workspace.db`（写入前先用 `normalizeLoadedWorkspace` 规范化，`generation` 用 `"gen-e2e"`），并用 `ensureDataRootMarker` 建标记文件。删除 WP-03 的 `seedBrowserStorageWorkspace`，并把 `tests/desktop/shell.e2e.mjs` 里用到它的用例改为在 `launchApp` 之前调用 `seedWorkspaceDatabase`（只改准备数据的方式，断言不变；在报告第 4 节写明）。WP-03 用例里对开发预览提示条的等待改为等待 `html[data-la-ready="1"]`。
2. 新建 `tests/desktop/storage.e2e.mjs`，用例名照抄：
   - `fresh data root opens the blank workspace`：侧栏只有“我的空间”和“开始使用 Life Atlas”；退出后用 Node 打开 `workspace.db`，`quickCheck === "ok"`。
   - `edits survive a restart`：新建文件夹、新建页面并输入正文、新建整页数据库并加 3 条记录 → 关闭 → 用同一数据目录重新启动 → 全部还在且内容一致。
   - `saving sends only the changed page`：编辑一个页面的正文 → 等到“已保存” → 用主进程钩子读最近一次 changeset 的大小（在 `ipc/workspace.js` 里测试钩子开启时把 `{ upserts: 数量, deletes: 数量, hasUi }` 记到 `globalThis.__lifeAtlasTest.lastChangeset`）：`upserts === 1`（该页面）。
   - `closing right after typing still saves`：输入后立刻 `closeApp`（不等防抖）→ 重启 → 内容还在。
   - `a killed process keeps committed data`：输入 A，等到“已保存” → 输入 B → `handle.app.process().kill()` → 重启 → A 一定在；`quickCheck === "ok"`；旧 `.lock` 被识别为过期锁（日志里有 `lock.stale-recovered`）。
   - `uploaded files become content addressed assets`：在页面里上传一张 PNG 和一个 PDF（用 `page.setInputFiles` 驱动编辑器的文件选择）→ `assets\` 下出现以 SHA-256 命名的文件；区块 `url` 以 `life-asset://` 开头；再上传同一张 PNG，文件数不变；重启后图片 `naturalWidth > 0`。
   - `icon and cover uploads are stored as assets`：上传页面图标和封面 → 用 Node 读 `workspace.db` 的全部 `json`，没有新出现的 `data:image/…;base64`。
   - `asset protocol validates requests`：渲染进程里 `fetch("life-asset://xyz")` 状态 400；`fetch("life-asset://" + "0".repeat(64))` 状态 404；对一个已上传的 HTML 文件（先上传 `test.html`），响应的 `content-type` 以 `text/plain` 开头，带 `x-content-type-options: nosniff` 和 CSP；带 `Range: bytes=0-9` 时状态 206、长度 10。
   - `a schema 10 database is migrated with a snapshot`：用 `workspace-v10.json` 直接写成 schema 10 的数据库（`seedWorkspaceDatabase` 加一个跳过规范化的参数）→ 启动 → `snapshots\` 下有一个以 `-pre-migration` 结尾的目录 → 界面能打开“编辑器验收”页面。
   - `a corrupted database shows the error page and stays untouched`：建一个正常库后把它改坏 → 启动 → 出现“数据无法读取” → 等 10 秒 → 文件 SHA-256 与启动前相同。
   - `large workspaces open within budget`：`seedWorkspaceDatabase` 写入 `bigWorkspace()` → 从调用 `launchApp` 到出现 `html[data-la-ready="1"]` 的毫秒数 < 3000；修改一个页面标题后 `storageTimings.lastApplyMs < 50`。两个数字都 `console.log` 出来（`WP04_STARTUP_MS=`、`WP04_APPLY_MS=`），报告里写实测值。
   - `invalid changesets are rejected by the main process`：在渲染进程里直接调用 `window.lifeAtlas.workspace.applyChanges(...)`：不在白名单的集合、201 字符的 id、超过 20 MB 的实体，都返回 `{ ok: false, error: { code: "E_INVALID_ARGUMENT" } }`。
3. 运行：

   ```powershell
   node docs/blueprint/tools/run-logged.mjs .qa/WP-04/build.log npm run build
   node docs/blueprint/tools/run-logged.mjs .qa/WP-04/desktop-build-test.log npm run desktop:build:test
   node docs/blueprint/tools/run-logged.mjs .qa/WP-04/desktop-e2e.log npm run test:e2e:desktop
   ```

提交 `WP-04: desktop storage e2e tests`。

### 步骤 14：收尾【停止点】

填完报告（第 3 节写出 `WP04_STARTUP_MS` 与 `WP04_APPLY_MS` 的实测值）；第 0 节全部“完成”；提交 `WP-04: complete report`；运行：

```powershell
node docs/blueprint/tools/wp-check.mjs WP-04 --browser --desktop
```

退出码 0 或 2 → 停止。

## 6. 验收标准

| 编号 | 标准 | 证据 |
| --- | --- | --- |
| AC-04-1 | 全新数据目录：出现“我的空间 / 开始使用 Life Atlas”，没有示例数据；`workspace.db` 的 `quick_check = ok` | 「fresh data root opens the blank workspace」；`tests/blank-workspace.test.mjs` |
| AC-04-2 | 新建文件夹、页面、正文、数据库和 3 条记录 → 重启 → 全部还在 | 「edits survive a restart」 |
| AC-04-3 | 增量保存：编辑一个页面只发送该页面；changeset 的新增/修改/删除/无变化都有单元测试 | 「saving sends only the changed page」；`tests/changeset.test.mjs` |
| AC-04-4 | 输入后立即关闭窗口 → 重启后内容在 | 「closing right after typing still saves」 |
| AC-04-5 | 强杀主进程后已保存的内容还在，数据库完好，过期锁被自动恢复 | 「a killed process keeps committed data」 |
| AC-04-6 | 上传图片和 PDF：按 SHA-256 存成文件、`life-asset://` 引用、重复上传只存一份、重启后能显示 | 「uploaded files become content addressed assets」；`tests/desktop-asset-store.test.mjs` |
| AC-04-7 | 页面图标、封面存为附件文件，数据库里没有新的 `data:…;base64` | 「icon and cover uploads are stored as assets」 |
| AC-04-8 | `life-asset://` 的 400/404/206、`nosniff`、CSP、`text/html` → `text/plain` | 「asset protocol validates requests」 |
| AC-04-9 | schema 10 的数据库启动时自动做 `pre-migration` 快照并迁移到 v12 | 「a schema 10 database is migrated with a snapshot」；`tests/desktop-workspace-service.test.mjs` |
| AC-04-10 | 写坏的数据库：显示错误页；10 秒后文件 SHA-256 不变 | 「a corrupted database shows the error page and stays untouched」；单元测试 |
| AC-04-11 | 5,000 页面 + 20,000 记录：启动到可交互 < 3 秒；单页编辑一次保存在主进程 < 50 ms（报告写实测值） | 「large workspaces open within budget」 |
| AC-04-12 | 主进程拒绝不在白名单的集合、超长 id、超过 20 MB 的实体 | 「invalid changesets are rejected by the main process」；`tests/desktop-workspace-db.test.mjs` |
| AC-04-13 | 迁移 v12 只改版本号、幂等；空白工作区通过完整性检查 | `tests/migration-v12.test.mjs`；`tests/blank-workspace.test.mjs` |
| AC-04-14 | 浏览器模式所有测试仍通过；G1–G9 | `.qa/WP-04/step10-browser.log`；`.qa/WP-04/wp-check.md` |

## 7. 卡点处理

| 情况 | 做法 |
| --- | --- |
| 主进程 `import` `src/persistence/normalize.js` 报错 | 看是哪个文件引入了 `.jsx`、CSS 或浏览器全局对象；把纯逻辑拆到 `.js` 里，不要在主进程里加浏览器模拟 |
| `node:sqlite` 报 `ExperimentalWarning` | 正常，忽略；不要因为它换别的 SQLite 包 |
| 编辑器的上传按钮在测试里找不到文件选择框 | 斜杠菜单插入“图片”区块后，BlockNote 会显示上传面板；用 `page.waitForEvent("filechooser")` 拿到选择框再 `setFiles` |
| 启动超过 3 秒 | 先用 `console.time` 在主进程和渲染进程分段计时（读库、组装、规范化、首屏渲染），把各段时间写进报告第 6 节；不要为了达标去掉 `quick_check` 或写回步骤；仍超标就把 AC-04-11 标为“未通过”并在第 7 节写清各段耗时 |
| 强杀后重启报“数据目录正在使用” | 你的 `.lock` 过期判断不对：检查 `isProcessAlive` 的实现（`process.kill(pid, 0)` 抛 `ESRCH` 才算已退出） |
