# WP-02 完整备份内核与浏览器迁移包

- 规模：M · 前置：WP-01 · 分支：`wp/02-backup-core`
- 停止点：步骤 0（理解确认）、步骤 11（收尾）
- 必读：`09-执行手册.md`、`10-测试夹具规格.md`、`04-备份与恢复规格.md` 第 1、2、3、9 节、`11-接口契约.md` 第 4.3–4.4 节；源码 `src/domain/attachments.js`、`src/persistence/workspaceRepository.js`、`src/persistence/normalize.js`（WP-01 建立）、`src/domain/pageExport.js`（JSZip 用法）、`src/components/WorkspaceSidebar.jsx`、`src/App.jsx`（两个保存 effect、`createEditorAttachment`）

## 0. 一页纸

- **要做到**：浏览器版里点左上角工作区名称 →“备份与恢复…”→“导出完整备份”，下载一个 `.lifeatlas` 文件，里面有全部页面、数据库、设置和 IndexedDB 里的附件；同一个对话框里能“从备份恢复”。这个文件就是用户把现有数据搬到桌面版的唯一通道，也是以后所有备份共用的格式。
- **交付物**：`src/backup/` 下 6 个模块；`attachments.js` 两个新函数；浏览器适配器的“暂停保存”；工作区菜单与“备份与恢复”对话框；6 个测试文件；2 个浏览器场景。
- **绝对不要**：改变 04 第 2 节规定的任何文件名、字段名、排序规则；在恢复中途写入一半数据；恢复时不留恢复前副本；改动页面级导出功能；做任何桌面版功能。
- **什么时候停**：步骤 0 结束停一次；步骤 11 的 wp-check 退出码为 0 或 2 时停。

## 1. 为什么做

用户现在的数据全在浏览器 localStorage 里，**没有任何“备份整个工作区”的入口**（`createWorkspaceBackup` 只在测试里被调用）。桌面版上线前，必须先能把现有数据完整导出成一个文件。

## 2. 完成后（用户看到什么）

- 左上角工作区名称变成一个按钮，点开是一个小菜单，里面有“备份与恢复…”。
- “备份与恢复”对话框：
  - **导出完整备份**：说明“包含所有页面、数据库、附件和设置。建议每周导出一次，保存到另一块硬盘或 U 盘。”，下面一行“桌面版发布后，用这个文件把数据迁移过去。”，按钮“导出”。导出完成后显示“已导出：<文件名>（<大小>）”；有附件找不到二进制时再显示一行“有 N 个附件的文件在浏览器里找不到，已跳过（其余内容完整）”。
  - **从备份恢复**：按钮“选择备份文件…”→ 校验 → 摘要（备份时间、来源、应用版本、页面/数据库/记录/附件数量、附件总大小）→ 红色说明“当前浏览器中的数据将被替换（替换前会保留一份副本）”→ 按钮“恢复”。校验失败时列出具体问题（最多 10 条），不显示“恢复”按钮。
- 对话框遵循现有弹窗的视觉 token；`Esc` 关闭；打开时焦点在“导出”按钮；关闭后焦点回到工作区名称按钮。

## 3. 设计要点（规定）

### 3.1 模块与函数签名

```
src/backup/
  format.js        BACKUP_KIND = "life-atlas-backup"；BACKUP_FORMAT_VERSION = 1；
                   BACKUP_COLLECTIONS（02 第 4.2 节白名单，按那里的顺序）；
                   isSafeBackupPath(path) → boolean；compressionForMime(mime) → "STORE" | "DEFLATE"
  hash.js          sha256Hex(bytes: Uint8Array) → Promise<string>（用 globalThis.crypto.subtle，浏览器和 Node 都能用）
  serialize.js     workspaceToFiles(workspace) → [{ path, bytes }]（workspace/meta.json + 13 个 jsonl）
                   filesToWorkspace(readFile) → workspace（readFile(path) → Uint8Array；JSON 解析失败抛错）
  manifest.js      buildManifest({ createdAt, appVersion, platform, workspace, files, assetEntries, vault }) → manifest
                   validateManifest(manifest, { currentFormatVersion, currentSchemaVersion }) → problems[]
  verify.js        verifyPackage(reader, { currentSchemaVersion }) → Promise<{ ok, problems, manifest, summary }>
  zipBrowser.js    createZipWriter() → { add(path, bytes, { store }), finish() → Promise<Uint8Array> }
                   openZipReader(bytes) → Promise<{ entries() → [path...]（按 zip 内顺序，不含目录条目）, read(path) → Promise<Uint8Array> }>
  browserBackup.js exportBrowserBackup({ workspace, readAttachmentBlob, now, appVersion })
                     → Promise<{ blob, fileName, manifest, skippedAttachmentIds }>
                   inspectBrowserBackup(fileBytes, { fileName, currentSchemaVersion, now })
                     → Promise<{ token, summary, problems }>（有阻断问题时 token 为 null）
                   restoreBrowserBackup(token, { storage, storageKey, legacyKeys, writeAttachmentBlob, now })
                     → Promise<{ workspace }>
                   prunePreRestoreCopies(storage, keep = 3) → 被删除的键数组
```

- `format.js`、`hash.js`、`serialize.js`、`manifest.js`、`verify.js` 是纯逻辑：不碰 DOM、不碰 IndexedDB、不读系统时间，WP-05 的桌面版直接复用。`reader` 只要求有 `entries()` 和 `read(path)` 两个方法（WP-05 会提供基于 yauzl 的实现）。
- `isSafeBackupPath`：只允许 04 第 2.1 节规定的字符；不能为空、不能以 `/` 开头、不能含 `..` 段、反斜杠或 `:`。
- `compressionForMime`：04 第 2 节列出的 MIME 返回 `"STORE"`，其余 `"DEFLATE"`。JSON 文件一律 DEFLATE。
- JSZip 写入一律带 `{ createFolders: false }`；`entries()` 跳过以 `/` 结尾的条目。

### 3.2 导出规则

1. 输入的 `workspace` 必须是“当前保存时写入的那个对象”（见 3.5 第 1 条）。
2. `workspaceToFiles`：
   - `workspace/meta.json`：`{ schemaVersion, workspaceId, savedAt, ui, extras }`，`extras` 是 `workspace` 里除了 13 个白名单集合与 `schemaVersion`、`workspaceId`、`savedAt`、`ui` 以外的其他顶层字段（原样）；
   - 13 个 `workspace/entities/<collection>.jsonl`：缺少的集合当作空数组，生成 0 字节文件。
3. 附件：对 `workspace.attachments` 中 `provider === "local-ref"` 的每一项，用 `readAttachmentBlob(storageKey)` 读二进制：
   - 读到：算 SHA-256，`assets/<sha256>`（同一内容只放一份），`assets/index.json` 加一项 `{ sha256, size, mime, originalName: name, createdAt, legacyAttachmentId: id }`；
   - 读不到：跳过，把附件 id 放进 `skippedAttachmentIds`（附件元数据仍在 `attachments.jsonl` 里）。
   - 其他 provider（`external`、`builtin`）没有二进制，不处理。
4. manifest：`app = { name: "Life Atlas", version: <package.json 的 version，构建时用 import.meta.env 或常量注入>, platform: "browser" }`；`vault = { included: false }`；`files` 按 path 升序列出除 manifest 外的每个文件；`counts` 统计 folders、pages、dataSources、databaseItems、attachments。
5. 写 zip：先 `manifest.json`，再按 `files` 的顺序写其余文件。
6. 文件名：`Life-Atlas-备份-YYYYMMDD-HHmm.lifeatlas`（`now` 的本地时间）。

### 3.3 校验规则

`verifyPackage` 严格按 04 第 3 节第 1–7 条的顺序检查（浏览器版没有加密容器和密钥库，第 7 条只在包里出现 `vault/vault.json` 时检查结构）。问题代码用 11 第 4.4 节的那一组。`ok` = 没有 `EXTRA_FILE` 以外的问题。

### 3.4 浏览器内恢复

`restoreBrowserBackup(token, …)` 的步骤，**顺序不能变**：

1. 取出 `inspectBrowserBackup` 保存在内存里的解析结果（`token` 10 分钟过期、只能用一次；过期或无效 → 抛错“备份已过期，请重新选择文件”）。
2. 恢复前副本：读出当前存储里的原始字符串（`storage.getItem(storageKey)`；没有就依次看 `legacyKeys`，取第一个有值的）；有值就写到键 `life-atlas.workspace.pre-restore-<now 的 ISO 时间，冒号和点换成短横线>`，然后 `prunePreRestoreCopies(storage, 3)`。写入失败（例如存储已满）→ 抛错“浏览器存储空间不足，无法保留恢复前副本。当前数据没有改动。”，结束。
3. 附件：对 `assets/index.json` 的每一项，`writeAttachmentBlob(legacyAttachmentId, new Blob([bytes], { type: mime }))`。任一失败 → 抛错，结束（这一步之前和此时，当前工作区都还没有被改动）。
4. 工作区：`storage.setItem(storageKey, JSON.stringify({ ...upgradeWorkspace(恢复出的工作区), schemaVersion: CURRENT_SCHEMA_VERSION }))`。失败 → 抛错，结束（`setItem` 失败不会写入一半）。
5. 返回 `{ workspace }`。调用方随后 `location.reload()`。

**防止被旧界面覆盖**：浏览器适配器（`createBrowserWorkspaceRepository`）新增 `suspendSaves()` 与 `resumeSaves()`。暂停期间 `save()` 直接返回 `null`、不写存储。对话框在调用 `restoreBrowserBackup` **之前**调用 `suspendSaves()`；恢复失败时调用 `resumeSaves()`；恢复成功后不恢复保存，直接 `location.reload()`（这样页面卸载时的 `beforeunload` 保存也不会写回旧数据）。

### 3.5 界面接线

1. `App.jsx`：把两个保存 effect 里重复构造的对象提取成一个函数 `currentWorkspaceSnapshot()`（返回 `{ ...workspace, schemaVersion: workspaceSchemaVersion, folders, pages, dataSources, databaseItems, databaseViews, relations, ui: { ...workspaceUi, assetPreferences, expandedFolderIds: Array.from(expanded), selectedFolderId, selectedPageId, privateExpanded } }`），两个 effect 和导出都用它。
2. `normalizeLoadedWorkspace` 增加 `idFactory` 参数：结果缺少 `workspaceId` 时设为 `idFactory("ws")`；浏览器适配器传入 `(prefix) => prefix + "-" + crypto.randomUUID()`。
3. `src/domain/attachments.js` 新增导出 `readBrowserAttachmentBlob(id)`（IndexedDB 读不到时再查内存表，都没有返回 `null`）与 `writeBrowserAttachmentBlob(id, blob)`（写 IndexedDB；不可用时写内存表）。现有函数不改。
4. `WorkspaceSidebar.jsx`：顶部 `.workspace-switcher` 改为 `<button type="button" aria-haspopup="menu" aria-expanded={…}>`，点开一个 `role="menu"` 的小菜单（样式复用 `ui-popover ui-menu`），本 WP 只有一项 `<button role="menuitem">备份与恢复…</button>`。`Esc` 或点击外部关闭菜单。新增 prop `onOpenBackup`。
5. 新建 `src/components/BackupDialog.jsx`（按第 2 节的界面），props：`{ getWorkspaceSnapshot, repository, onClose }`。导出用 `<a download>` 触发下载（与 `pageExport.js` 的做法一致）；选择文件用隐藏的 `<input type="file" accept=".lifeatlas,application/zip">`，并给它 `aria-label="选择备份文件"`；“恢复”按钮点击后先 `window.confirm("当前浏览器中的数据将被替换（替换前会保留一份副本）。确定恢复吗？")`。

## 4. 范围

### 必做

第 3 节全部；第 5 节全部步骤。

### 不做

- 桌面版任何东西、流式 zip、密钥库、整包加密、快照、定期备份、合并导入（WP-05/08）。
- 在浏览器里把 `data:` 转成附件文件（WP-05 导入时做）。
- 修改现有页面级导出功能。
- 工作区菜单里的其他菜单项（WP-12）。

## 5. 执行步骤

### 步骤 0：开工准备【停止点】

```powershell
Set-Location -LiteralPath 'C:\Projects\life-atlas'
git status --porcelain
git switch main
git switch -c wp/02-backup-core
node docs/blueprint/tools/wp-check.mjs WP-02 --init-report
node docs/blueprint/tools/run-logged.mjs .qa/WP-02/step0-npm-test.log npm test
```

报告第 1 节写“我的理解”，并回答理解题：

1. 浏览器恢复的 5 个步骤里，哪一步之后当前工作区才第一次被改动？如果第 3 步失败，用户的数据是什么状态？
2. 为什么恢复前必须调用 `suspendSaves()`，恢复成功后为什么不调用 `resumeSaves()`？
3. 一个附件在 IndexedDB 里找不到二进制，导出会怎样？
4. 两个附件内容完全相同时，zip 里有几个附件文件？`assets/index.json` 里有几项？

第 0 节步骤 0 改成“完成”，提交 `WP-02: step 0 understanding`，运行 `node docs/blueprint/tools/wp-check.mjs WP-02 --until 0`，退出码 0 → **停止**。

### 步骤 1：format.js 与 hash.js

按 3.1 实现。新建 `tests/backup-format.test.mjs`，用例：

- `backup collections follow the architecture whitelist`（13 个，顺序与 02 第 4.2 节相同）
- `safe backup paths accept the documented shapes`（`manifest.json`、`workspace/entities/pages.jsonl`、`assets/<64 位十六进制>` 为真）
- `unsafe backup paths are rejected`（`../evil.txt`、`/abs`、含反斜杠的路径、`C:/x`、`assets/../x`、空字符串都为假）
- `compression follows the mime table`
- `sha256Hex matches the known PNG fixture hash`（对 `PNG_1X1_BASE64` 解码后的字节，结果为 `c414cd0e…7ce77`）

提交 `WP-02: backup format constants and hashing`。

### 步骤 2：serialize.js

按 3.2 第 2 条实现。新建 `tests/backup-serialize.test.mjs`，用例（用 `upgradeWorkspace(fullWorkspace())`）：

- `workspaceToFiles writes meta and one jsonl per collection`（14 个文件，路径正确，空集合是 0 字节）
- `jsonl lines are sorted by id and end with a newline`
- `filesToWorkspace restores every collection deeply equal`（含时间字段）
- `unknown top-level fields round-trip through extras`

提交 `WP-02: workspace serialization`。

### 步骤 3：manifest.js 与 verify.js

按 3.1、3.3 实现。新建 `tests/backup-verify.test.mjs`（B4）。先写一个测试辅助函数：用满配夹具和 `fullWorkspaceAttachmentBytes()` 通过 `exportBrowserBackup` 生成一个包的字节（步骤 4 完成后才能用，所以本步骤的测试可以先用 `workspaceToFiles` + `buildManifest` + `createZipWriter` 手工拼包）。用例：

- `a well formed package verifies ok`
- `tampered manifest is rejected`（manifest 不是合法 JSON → `BAD_MANIFEST`）
- `one changed byte in a jsonl file is rejected`（`HASH_MISMATCH`，path 指向该文件）
- `one changed byte in an asset is rejected`（`HASH_MISMATCH`）
- `a missing file is rejected`（`MISSING_FILE`）
- `a traversal path is rejected`（manifest 的 `files` 里加 `../evil.txt` → `BAD_PATH`）
- `a newer format version is rejected`（`formatVersion: 2` → `FORMAT_TOO_NEW`）
- `a newer schema version is rejected`（`SCHEMA_TOO_NEW`）
- `manifest must be the first entry`（`MANIFEST_NOT_FIRST`）
- `count mismatch is rejected`（`COUNT_MISMATCH`）
- `extra files only produce a warning`（`EXTRA_FILE`，`ok === true`）

提交 `WP-02: manifest and package verification`。

### 步骤 4：zipBrowser.js 与导出

按 3.1、3.2 实现 `zipBrowser.js` 与 `exportBrowserBackup`。新建 `tests/backup-roundtrip.test.mjs`（B1 浏览器变体，用内存版 `readAttachmentBlob`：`(id) => bytes.has(id) ? new Blob([bytes.get(id)]) : null`）。用例：

- `manifest is the first entry and lists every file with correct hashes`（AC-02-1：逐项断言字段齐全、`files` 覆盖所有文件、每个 `sha256` 正确、附件文件名等于其 SHA-256、zip 里没有目录条目）
- `export then parse returns every entity deeply equal`（B1：13 个集合逐实体深度相等，含时间字段；`ui` 相等）
- `attachment bytes survive the round trip`（3 个附件字节相等，`legacyAttachmentId` 正确）
- `missing attachment bytes are skipped and reported`（去掉 att-file 的字节 → `skippedAttachmentIds` 为 `["att-file"]`，包仍然校验通过）
- `identical attachment contents are stored once`（造两个内容相同的附件 → zip 里 1 个文件，index 里 2 项，`manifest.assets.count === 1`）

提交 `WP-02: browser export`。

### 步骤 5：检查与恢复

按 3.4 实现 `inspectBrowserBackup`、`restoreBrowserBackup`、`prunePreRestoreCopies`，以及浏览器适配器的 `suspendSaves()`/`resumeSaves()`。新建 `tests/backup-browser-restore.test.mjs`（用一个内存版 storage：`getItem/setItem/removeItem/key/length`，可以模拟 `setItem` 抛错；内存版 `writeAttachmentBlob`）。用例：

- `inspect returns a summary for a valid package`（字段与 11 第 4.3 节一致，`encrypted === false`、`platform === "browser"`）
- `inspect returns problems and no token for a broken package`
- `restore writes a pre-restore copy, attachments and then the workspace`（检查顺序：用会记录调用顺序的假 storage）
- `restore keeps at most three pre-restore copies`（先放 4 个旧副本键，恢复后只剩最新 3 个）
- `restore leaves current data untouched when the pre-restore copy cannot be written`
- `restore leaves current data untouched when an attachment write fails`
- `a token can be used only once and expires after ten minutes`（用注入的 `now`）
- `suspended repository saves do nothing`（`suspendSaves()` 后 `save()` 返回 `null`，存储里的值不变；`resumeSaves()` 后恢复正常）
- `schema 10 package restores and upgrades`（B3：用 `tests/fixtures/workspace-v10.json` 做成包 → 恢复 → 存储里的工作区 `schemaVersion === CURRENT_SCHEMA_VERSION`，页面数不少）

提交 `WP-02: browser inspect and restore`。

### 步骤 6：workspaceId

按 3.5 第 2 条修改 `normalizeLoadedWorkspace`。在 `tests/normalize.test.mjs` 追加用例：

- `normalize adds a workspaceId only when missing`（没有时用 `idFactory("ws")`；已有时保持不变）

提交 `WP-02: workspace id`。

### 步骤 7：附件读写函数与 App 快照函数

按 3.5 第 1、3 条修改 `attachments.js` 与 `App.jsx`。`npm test` 全部通过后提交 `WP-02: attachment blob access and workspace snapshot`。

### 步骤 8：工作区菜单与对话框

按 3.5 第 4、5 条和第 2 节实现。手动用浏览器场景验证（步骤 9）。提交 `WP-02: backup dialog`。

### 步骤 9：浏览器场景（功能）

新建 `tests/browser/wp02-backup.mjs`。种子：`fullWorkspace()`，并在里面加一个标题为 `RESTORE-MARKER-` + 8 位随机十六进制的页面（放在 `f-z` 里）。场景开始时用 `page.evaluate` 把 `att-img` 的字节写进 IndexedDB（数据库 `life-atlas.attachments.v1`、对象仓库 `blobs`、键 `att-img`、值为 `image/png` 的 Blob）。检查项（标题照抄）：

1. `Backup dialog opens from the workspace menu with keyboard focus`：点工作区名称按钮 → 菜单项“备份与恢复…”→ 对话框出现，`document.activeElement` 是“导出”按钮 → 按 `Esc` 关闭 → 焦点回到工作区名称按钮。截图 `backup-dialog`（截图前再打开一次）。
2. `Export downloads a complete package`：点“导出”→ `page.waitForEvent("download")` → 保存到 `.qa/WP-02/scenario-export.lifeatlas` → 在 Node 里用 `openZipReader` 读取：第一个条目是 `manifest.json`、`app.platform === "browser"`、`files` 里有 `assets/c414cd0e…7ce77`、`pages.jsonl` 包含标记标题。
3. `Restore replaces data from the package`：`page.evaluate` 删除所有以 `life-atlas.workspace` 开头的 localStorage 键（**保留** `life-atlas.harness.seeded`）并删除 IndexedDB 数据库 `life-atlas.attachments.v1` → 刷新 → 侧栏里**没有**标记页面 → 打开对话框 → `setInputFiles` 选择刚才导出的文件 → 出现摘要（截图 `restore-summary`）→ 点“恢复”（先注册 `page.once("dialog", (d) => d.accept())`）→ 等待页面重新加载 → 侧栏里有标记页面 → 打开“B 笔记”，页面里的图片元素加载成功（`naturalWidth === 1`）。截图 `after-restore`。
4. `Restore keeps a pre-restore copy`：`localStorage` 里恰好有 1 个以 `life-atlas.workspace.pre-restore-` 开头的键。

在 `tests/core-parity-browser.mjs` 的 `scenarios` 末尾加入 `"wp02-backup"`。用 `PARITY_ONLY` 单独运行并保存日志 `.qa/WP-02/browser-wp02.log`。提交 `WP-02: browser scenario for backup and restore`。

### 步骤 10：浏览器场景（性能）

新建 `tests/browser/wp02-backup-performance.mjs`：种子是在 `fullWorkspace()` 基础上增加到 200 个页面（每页 5 个段落）的工作区；场景开始时往 IndexedDB 写入 3 个各 5 MB 的附件（内容用确定性字节，例如重复的 0–255），并在工作区 `attachments` 里加上对应的 3 条 `local-ref` 元数据。检查项：

- `Export of 200 pages and 15 MB of attachments finishes within 10 seconds`：从点击“导出”到收到下载事件的毫秒数 < 10000，并 `console.log("WP02_EXPORT_MS=" + 毫秒数)`。

加入场景列表末尾 `"wp02-backup-performance"`，单独运行一次，日志 `.qa/WP-02/browser-wp02-performance.log`。提交 `WP-02: export performance scenario`。

### 步骤 11：收尾【停止点】

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-02/npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-02/browser-all.log npm run test:parity:browser
```

都必须 `exit=0`。填完报告；报告最后加一节“给用户的操作说明”：照抄并按实际界面校对 `08-交给GPT的提示词.md` 第 7.1 节的步骤（用平时完全相同的地址打开浏览器版、导出、把文件存到项目目录以外并再复制一份）。第 0 节全部“完成”，提交 `WP-02: complete report`，然后：

```powershell
node docs/blueprint/tools/wp-check.mjs WP-02 --browser
```

退出码 0 或 2 → 停止。

## 6. 验收标准

| 编号 | 标准 | 证据 |
| --- | --- | --- |
| AC-02-1 | 生成的包完全符合 04 第 2 节：manifest 第一个、字段齐全、`files` 覆盖所有文件且 SHA-256 正确、附件文件名等于 SHA-256、没有目录条目 | `tests/backup-roundtrip.test.mjs`「manifest is the first entry…」 |
| AC-02-2 | B1（浏览器变体）：满配夹具导出 → 解析 → 13 个集合逐实体深度相等（含时间字段），附件字节相等 | `tests/backup-roundtrip.test.mjs` |
| AC-02-3 | B3：schema 10 的包可以恢复并升级到当前版本 | `tests/backup-browser-restore.test.mjs`「schema 10 package…」 |
| AC-02-4 | B4：11 种损坏或越界情况全部给出正确的问题代码；多余文件只是警告 | `tests/backup-verify.test.mjs` |
| AC-02-5 | 浏览器场景：导出 → 清空（保留 harness 标记）→ 刷新后标记页面消失 → 恢复 → 标记页面回来、图片能显示 | 场景 `wp02-backup` 检查 2、3；截图 `.qa/wp02-backup-backup-dialog.png`、`.qa/wp02-backup-restore-summary.png`、`.qa/wp02-backup-after-restore.png` |
| AC-02-6 | 恢复前副本存在且最多保留 3 个；三种失败情况都不改动当前数据 | `tests/backup-browser-restore.test.mjs`；场景检查 4 |
| AC-02-7 | 对话框键盘可用（打开时焦点、`Esc`、焦点归还） | 场景检查 1 |
| AC-02-8 | 200 个页面 + 15 MB 附件的导出 < 10 秒（报告写出实测毫秒数） | `.qa/WP-02/browser-wp02-performance.log` 里的 `WP02_EXPORT_MS=` |
| AC-02-9 | 暂停保存期间 `save()` 不写存储；恢复成功后页面重新加载，旧界面没有写回旧数据 | `tests/backup-browser-restore.test.mjs`「suspended repository…」；场景检查 3 |
| AC-02-10 | G1–G9 | `.qa/WP-02/wp-check.md` |

## 7. 卡点处理

| 情况 | 做法 |
| --- | --- |
| Node 里 `crypto.subtle` 不可用 | 不会发生（Node 24 自带）；如果报错，停下附错误信息报告 |
| JSZip 生成的 zip 里仍有目录条目 | 检查每次 `zip.file` 都带了 `createFolders: false` |
| 场景里删除 IndexedDB 卡住 | 先关闭页面里打开的连接：删除前刷新到一个空白页面（`about:blank`），删除后再 `goto` 回来 |
| 下载事件拿不到 | 确认导出用的是 `<a download>` 并且 `harness` 的浏览器上下文 `acceptDownloads: true`（现有 harness 已开启） |
| 性能超过 10 秒 | 先用浏览器性能分析找出最慢的一步写进报告；常见原因是对大附件用了 base64 或逐字节循环。不能通过降低附件大小来达标 |
