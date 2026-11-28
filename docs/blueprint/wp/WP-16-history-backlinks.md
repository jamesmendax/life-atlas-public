# WP-16 页面历史与反向链接（schema v16）

- 规模：M · 前置：WP-15 · 分支：`wp/16-history-backlinks`
- 停止点：只有收尾（步骤 9）
- 必读：`02-总体架构.md` 第 4.2 节（`pageVersions` 已登记）；`04-备份与恢复规格.md` 第 2、3 节；`09-执行手册.md`；源码 `src/backup/format.js`（`BACKUP_COLLECTIONS`）、`src/backup/serialize.js`（`filesToWorkspace`）、`src/backup/verify.js`、`src/persistence/workspaceRepository.js`、`src/persistence/normalize.js`、`src/persistence/migrations.js`、`src/domain/trash.js`（`permanentlyDelete`）、`src/domain/integrity.js`、`src/domain/blockDocument.js`（`stableJson`、`walkBlocks`、`expandSyncedBlocks`）、`src/editor/links.js`（`parseBlockLink`，WP-14）、`src/App.jsx`（`updatePage`、`openPageAt`）、`src/components/PageActionsMenu.jsx`；`12-视觉规范-墨白.md` 第 0、3、6、7 节和 2.7 节列出的参照画面；WP-12 加在 `tests/browser/harness.mjs` 里的 `shootBothModes`

## 0. 一页纸

- **要做到**：改错了能找回——每个页面自动保存历史版本，可以预览、对比、恢复；每个页面能看到“哪些页面链接到了我”。
- **交付物**：schema v16（新集合 `pageVersions`）；`src/domain/pageHistory.js`、`src/domain/backlinks.js`；`src/components/PageHistoryDialog.jsx`、`BacklinksPanel.jsx`；备份读写支持新集合；墨白样式 `src/ui/themes/mobai/history.css`；单元测试；浏览器场景 `wp16-history`；桌面端到端；白天和夜间的截图与对照图。
- **绝对不要**：逐字差异对比；整个工作区的版本回滚（快照已经有了）；把数据库关联属性算作反向链接；在浏览器模式下把版本写进 localStorage。
- **什么时候停**：步骤 9 的 wp-check 退出码为 0 或 2。

## 1. 已知事实（总设计师 2026-11-01 核对）

| 事实 | 对你的影响 |
| --- | --- |
| 满配夹具的跨页面引用：p-a1 的段落 `b-a1-p` 提及 p-z1、页面链接块 `b-a1-link` 指向 p-c1；p-z1 的段落 `b-z1-mention` 提及 p-b1；两个同步源里没有提及 | 反向链接的已知答案见 2.5 节 |
| `filesToWorkspace` 按 `BACKUP_COLLECTIONS` 读每个集合的 `.jsonl`；schema 15 及更早的备份里没有 `pageVersions.jsonl` | 2.1 节规定旧备份缺这个文件时按空集合处理 |
| 桌面存储按 `BACKUP_COLLECTIONS` 决定白名单和增量（WP-04），单个实体超过 20 MB 会让整批保存被拒绝 | 超过 5 MB 的版本不生成（2.2 节） |
| 浏览器适配器每次保存都把整个工作区写进 localStorage（约 5 MB 上限） | 浏览器模式下版本只留在内存里 |
| 2.2 节的保留规则和计时规则，总设计师用参考实现跑过 2.2 节列出的全部已知答案 | 单元测试照抄 |

## 2. 设计要点（规定）

### 2.1 schema v16、备份与存储

- `migratePageVersions(input)`（`migrations.js`，链在 `migrateInbox` 之后）：`pageVersions` 不是数组时设为 `[]`；`schemaVersion = 16`；纯函数、幂等。`CURRENT_SCHEMA_VERSION = 16`。
- 版本实体：

  ```js
  { id: "ver-<uuid>", pageId, createdAt, reason,          // reason: "before-edit" | "idle" | "interval" | "pre-restore"
    title, icon, iconColor, cover, settings, content,     // 页面在那个时刻的样子（深拷贝）
    blockCount, sizeBytes }                               // walkBlocks(content).length；上面 6 个字段 JSON 的 UTF-8 字节数
  ```

- `src/backup/format.js`：`BACKUP_COLLECTIONS` 末尾加 `"pageVersions"`；新增 `COLLECTION_SINCE = { pageVersions: 16 }` 和 `requiredCollections(schemaVersion)`（返回 `BACKUP_COLLECTIONS` 中 `(COLLECTION_SINCE[名称] ?? 0) <= schemaVersion` 的集合）。
- `filesToWorkspace` 与 `verifyPackage`：只要求 `requiredCollections(meta.schemaVersion)` 里的集合文件存在；不要求的集合文件不存在时按空数组处理，存在时照常读取和校验。`04-备份与恢复规格.md` 第 3 节第 6a 条就是这条规则。
- 现有的备份往返测试如果写死了 13 个集合（数字 13 或手写的集合列表），改为使用 `BACKUP_COLLECTIONS`（执行手册 4.5 节第 2 条，报告第 4 节写明）。
- **浏览器适配器**（`workspaceRepository.js`）：保存时写入 `{ ...workspace, pageVersions: [] }`；内存里的工作区保留版本。页面历史对话框在浏览器模式下顶部显示一行提示：“浏览器模式下的历史只保存在本次打开期间，刷新后消失。”
- **永久删除**：`permanentlyDelete(workspace, { pageIds, folderIds })` 同时删除这些页面的全部版本（`trash.js`）。
- **完整性检查**：新增 warning `PAGE_VERSION_ORPHAN`：版本的 `pageId` 对应的页面不存在。
- **加载时清理**：`normalizeLoadedWorkspace` 在清理到期回收站之后调用 `prunePageVersions(workspace.pageVersions, now)`，并删除页面已不存在的版本（桌面版会把清理结果写回数据库，02 第 4.3 节）。

### 2.2 版本的生成与保留（`src/domain/pageHistory.js`，纯函数）

```js
export const IDLE_MS = 120_000;        // 停止编辑 2 分钟
export const INTERVAL_MS = 600_000;    // 连续编辑每 10 分钟
export const MAX_VERSION_BYTES = 5 * 1024 * 1024;

export function pageSnapshotOf(page)               // → { title, icon, iconColor, cover, settings, content }（深拷贝）
export function snapshotSignature(snapshotOrVersion) // → stableJson(上面 6 个字段)
export function createPageVersion(page, { reason, now, id })  // → 版本实体；sizeBytes > MAX_VERSION_BYTES 时返回 null
export function latestVersionOf(versions, pageId)  // → createdAt 最大的版本或 null
export function recordEdit(tracker, nowMs)         // → { dirtySince: tracker?.dirtySince ?? nowMs, lastEditAt: nowMs }
export function dueCapture(tracker, nowMs)         // → "idle" | "interval" | null
export function afterCapture(tracker, reason, nowMs)
export function prunePageVersions(versions, nowMs) // → 保留下来的版本（保持输入顺序）
export function compareBlocks(versionContent, currentContent)  // → { added, removed, changed }
```

- `dueCapture`：`tracker?.dirtySince == null` → `null`；`nowMs - lastEditAt >= IDLE_MS` → `"idle"`；`nowMs - dirtySince >= INTERVAL_MS` → `"interval"`；否则 `null`。
- `afterCapture`：`"idle"` → `{ dirtySince: null, lastEditAt }`；`"interval"` → `{ dirtySince: nowMs, lastEditAt }`。
- **保留规则** `prunePageVersions`（每个页面单独算，按 `createdAt` 从新到旧看；`age = nowMs - createdAt`）：
  1. `age < 7 天`：保留最新的 50 个；
  2. `7 天 ≤ age < 30 天`：每个**本地**日期只保留最新的 1 个；
  3. `30 天 ≤ age < 365 天`：每个 ISO 周只保留最新的 1 个（用本地日期算周）；
  4. `age ≥ 365 天`：每个本地年月只保留最新的 1 个；
  5. 以上结果每页最多 120 个（保留最新的）。
- `compareBlocks`：按区块 ID（`walkBlocks` 展开全部层级）比较：`added` = 当前有、版本没有的个数；`removed` = 版本有、当前没有的个数；`changed` = 两边都有但 `stableJson` 不同的个数。
- **已知答案**（单元测试照抄；`now = new Date(2026, 9, 1, 12, 0).getTime()`，`at(y, m, d, h) = new Date(y, m - 1, d, h, 0).toISOString()`，全部版本 `pageId: "p"`）：
  - 版本 v1（`now` 前 1 小时）、v2（前 2 小时）、v3 `at(2026,9,20,10)`、v4 `at(2026,9,20,18)`、v5 `at(2026,9,21,9)`、v6 `at(2026,8,10,9)`、v7 `at(2026,8,12,9)`（与 v6 同一 ISO 周 2026-W33）、v8 `at(2025,8,3,9)`、v9 `at(2025,8,20,9)`、v10 `at(2025,7,1,9)` → 保留 v1、v2、v4、v5、v7、v9、v10。
  - 60 个版本分别在 `now` 前 1–60 分钟 → 保留 50 个，最新的是前 1 分钟那个，最旧的是前 50 分钟那个。
  - 计时：每 30 秒编辑一次，从 0 编辑到 25 分钟，每 30 秒检查一次（先 `recordEdit` 再 `dueCapture`），直到 30 分钟 → 依次得到 10 分钟 `interval`、20 分钟 `interval`、27 分钟 `idle`。
  - 计时：在 0、30、60 秒编辑 → 150 秒时 `dueCapture` 为 `null`，180 秒时为 `"idle"`。

### 2.3 什么时候生成版本（`App.jsx`）

- App 用 `useRef` 保存 `trackers: Map(pageId → tracker)` 和 `editedThisSession: Set(pageId)`（都不保存到工作区）。
- **编辑前版本**：`updatePage` 收到 `title`、`icon`、`iconColor`、`cover`、`settings` 或 `content` 的修改时，如果这个页面不在 `editedThisSession` 里：把它加进去；在同一个 `setWorkspace` 更新函数里，先用修改**之前**的页面生成 `before-edit` 版本（只有当它的 `snapshotSignature` 和该页面最新版本不同、或者还没有任何版本时才生成），再应用修改。版本 ID 在更新函数外面生成。
- 每次这样的修改后 `trackers.set(pageId, recordEdit(旧tracker, Date.now()))`。
- **定时检查**：App 里每 30 秒（`setInterval`）对每个 tracker 调用 `dueCapture`；得到原因时，用当前页面生成该原因的版本（签名和最新版本相同时不生成），然后 `afterCapture`。
- **退出前**：桌面版收到 `app.onFlushRequest`、浏览器版收到 `pagehide` 时，对所有 `dirtySince` 不为空的页面立即按 `idle` 生成版本，然后再保存。
- 生成版本后对该页面的版本调用一次 `prunePageVersions`。
- 版本生成和页面修改一样只是工作区的普通变化，随 450 ms 防抖一起保存。
- 页面在回收站、页面已锁定时，不生成版本（锁定的页面本来也不能编辑）。

### 2.4 恢复与历史对话框

- 纯函数 `restorePageVersion(workspace, { pageId, versionId, now, preRestoreId })`（`pageHistory.js`）：
  1. 用当前页面生成 `pre-restore` 版本（ID 为 `preRestoreId`，总是生成）；
  2. 把页面的 `title`、`icon`、`iconColor`、`cover`、`settings`、`content` 换成版本里的（深拷贝，区块 ID 保持版本里的）；`updatedAt = now`；`contentRevision + 1`；`importRevision = (page.importRevision || 0) + 1`（让编辑器重新挂载，见下一条）；
  3. 页面是数据库记录页面时，同时把记录的名称属性值改成版本的标题；
  4. 版本不存在、页面不存在或在回收站时抛错“无法恢复这个版本”。
- 恢复后编辑器必须重新挂载。**不要新增 key，也不要改现有的 key**：`src/App.jsx` 里 `LazyPageEditor` 已经有 `` key={`${page.id}:${page.importRevision || 0}`} ``（页面导入就是靠 `importRevision` 加 1 让编辑器重新挂载的），所以上一条让 `restorePageVersion` 把 `importRevision` 加 1 就够了。`PageDocument` 本身没有 key，保持不变。
- **入口**：页面操作菜单（⋯）加一项“页面历史”。
- **对话框** `src/components/PageHistoryDialog.jsx`：`role="dialog"`、`aria-label="页面历史"`，980×650（窗口小时最大 `94vw` × `90vh`；参照 `design/mobai/shots/history-*`，样式见 2.7 节）；标题栏是“页面历史”（16 px 600）和当前页面的标题（14 px `--mb-muted`），下面左右两栏（左栏 250 px）：
  - 左栏 `role="listbox"`、`aria-label="历史版本"`：该页面的版本按时间从新到旧，每项 `role="option"`，分三行：时间（14 px 500）、原因、`<blockCount> 个区块 · <大小>`（灰色小字）。时间：今天 `今天 HH:mm`、昨天 `昨天 HH:mm`、今年 `M月D日 HH:mm`、其他 `YYYY年M月D日 HH:mm`。原因：`before-edit` 编辑前、`idle` 自动保存、`interval` 编辑中自动保存、`pre-restore` 恢复前。大小：小于 1024 字节写 `N B`，否则 `N.N KB`。默认选中第一项。
  - 右栏：`compareBlocks` 的结果写成“与当前相比：新增 A 个、删除 R 个、修改 C 个区块”（三个都是 0 时写“与当前内容相同”）；下面是版本的图标与标题，再下面是只读预览：`<PageEditor pageId={版本.pageId} key={版本.id} initialContent={版本.content} locked onChange={() => {}} … />`。
  - 右栏底部靠右两个按钮：次按钮“关闭”在左，主按钮“恢复此版本”在右（页面锁定或“与当前内容相同”时禁用）；标题栏不再放关闭按钮。点“恢复此版本”→ `window.confirm("用这个版本替换当前页面？当前内容会先保存为一个版本。")` → `runtime.restorePageVersion(pageId, versionId)` → 关闭对话框 → 右下角提示 2 秒“已恢复到 <时间> 的版本”（`role="status"`）。
  - 没有版本时显示“这个页面还没有历史版本。编辑后会自动保存版本。”。

### 2.5 反向链接（`src/domain/backlinks.js`）

- `extractPageLinks(page, workspace)` → `[{ targetPageId, blockId, kind, snippet }]`：遍历 `expandSyncedBlocks(page.content, workspace)` 的全部区块（含表格单元格里的行内内容）：
  - 行内 `{ type: "pageMention", props.pageId }` → `kind: "mention"`；
  - 行内链接 `{ type: "link", href }` 且 `parseBlockLink(href)` 不为空 → `kind: "blockLink"`，目标是解析出的 `pageId`；
  - 区块 `pageLink`（`props.pageId`）→ `kind: "pageLink"`；区块 `editorialCard`（`props.pageId` 不为空）→ `kind: "editorialCard"`；
  - `snippet` = 该区块的 `inlineSemanticText(block.content, workspace)`，去掉首尾空白，超过 80 个字符时截断并加“…”；没有行内内容的区块为空字符串；
  - 指向自己的链接忽略。
- `createBacklinkIndex()` → 对象，方法：
  - `rebuild(workspace)`：清空后对所有不在回收站的页面调用 `extractPageLinks`；
  - `update(previous, next)`：`previous` 为空时等于 `rebuild(next)`。否则只重算这些源页面（先删掉它们原来的条目）：① `pages` 里对象引用变了、新增或删除的页面；② 如果 `next.syncedSources !== previous.syncedSources`，找出变化的同步源（同一 ID 的对象引用不同、新增或删除），再加上内容里有 `syncedBlock` 引用这些同步源的页面；
  - `backlinksFor(targetPageId, workspace)` → `[{ sourcePageId, links: [{ blockId, kind, snippet }] }]`：跳过在回收站或不存在的源页面；按源页面标题排序。
- 内部维护两张表：`byTarget: Map(目标 → Map(源 → 链接数组))` 和 `bySource: Map(源 → Set(目标))`。
- App 里用一个自定义 hook `useBacklinkIndex(workspace)`：`useRef` 保存索引和上一次的工作区；`workspace` 对象变化时调用 `update(上一次, workspace)` 并更新“上一次”。
- **已知答案**（满配夹具 `upgradeWorkspace(fullWorkspace())`）：
  - `backlinksFor("p-z1")` → 一项：`sourcePageId: "p-a1"`，链接 `{ blockId: "b-a1-p", kind: "mention", snippet: "提及：Z 目标页" }`；
  - `backlinksFor("p-c1")` → 一项：`p-a1`，`{ blockId: "b-a1-link", kind: "pageLink", snippet: "" }`；
  - `backlinksFor("p-b1")` → 一项：`p-z1`，`{ blockId: "b-z1-mention", kind: "mention", snippet: "B 笔记" }`；
  - `backlinksFor("p-a1")` → 空数组。
  （总设计师已核对：`inlineSemanticText` 对页面提及输出页面标题，不加符号；对人员提及才加 `@`。）

### 2.6 反向链接的界面（`src/components/BacklinksPanel.jsx`）

- 位置：页面标题下面那行“创建于 … 修改于 …”（`.page-document-meta`）之后，在 `.page-document-header` 里单独占一行。**不要**放进 `.page-document-meta` 里面：墨白让那一行平时透明、鼠标移到页面头部才出现（WP-20 的 `page.css`），反向链接要一直看得见，和 Notion 一样。
- 数量为 0 时什么都不显示；否则显示按钮 `<N> 个反向链接`（`aria-expanded`，N 是源页面个数；样式见 2.7 节），默认收起。
- 展开后是列表 `aria-label="反向链接"`：每个源页面一行，显示图标、标题（按钮，点击 `openPageAt(源页面ID, 第一条链接的 blockId)`，WP-14）、所在路径（文件夹名用 ` / ` 连接），下面最多 2 条 `snippet`（为空时显示类型名：页面链接块 / 内容卡片）。

### 2.7 墨白样式（规定）

- **参照画面**：页面历史 `design/mobai/shots/history-light.png`、`history-dark.png`（原型 `design/mobai/prototype/index.html#view=history&mode=light`，夜间把 `light` 换成 `dark`）；反向链接按钮的样子见原型 `#view=page` 页面标题下面那一行。原型**只看不改**。
- **样式文件**：新文件 `src/ui/themes/mobai/history.css`，在 `src/ui/themes/mobai/index.css` 末尾追加一行 `@import "./history.css";`（只能追加，前面的行不动）。历史对话框照原型 `b-more.css` 的 “page history” 一段（`.history`、`.hist-*`）改写，反向链接按钮照 “small parts” 一段的 `.meta-links`：每个选择器前加 `:root[data-style="mobai"] `，变量按 12 第 0 节的对应表换名，只用 `--mb-*` 变量；旧 CSS 里不写颜色（K13）。外壳沿用产品的 `.modal-backdrop` + `.ui-dialog`（WP-20 已写好遮罩、12 px 圆角、`--mb-dlg` 阴影，`.ui-dialog h2` 标题是 16 px 600 `--mb-sans`）。
- **左栏**（原型 `.hist-list`、`.hist-item`）：`--mb-side` 底、内边距 8 px、右边 1 px `--mb-line` 竖线；每项内边距 8 px 10 px、圆角 6 px，项与项之间 2 px；悬停 `--mb-hover` 底；选中的一项 `--mb-select` 底（`.hist-item.is-active`），不加左边竖线、不加粗（12 第 1 节原则 5）；时间 14 px 500 `--mb-ink`，原因 12 px `--mb-muted`，大小 12 px `--mb-faint`。
- **右栏**（原型 `.hist-preview`、`.hist-diff`）：内边距 16 px 28 px 20 px；“与当前相比：…”一行 14 px `--mb-muted`，其中“新增 A 个”“删除 R 个”“修改 C 个”三段是 500 `--mb-ink`；这一行下面留 12 px，再画一条 1 px `--mb-line` 细线；只读预览里的编辑器样式由 WP-20 的 `editor.css` 负责，不要另写；按钮照 12 第 6 节。
- 原型的预览里把删除的段落画成红色删除线、新增的段落画成浅蓝底（原型 `.diff-del`、`.diff-add`，不要抄），那是逐段对比的示意：本 WP **不做**逐段标记（第 3 节“不做”），预览就是版本内容本身。
- **反向链接**（原型 `.meta-links`）：按钮高 24 px、左右 8 px、圆角 6 px，透明底、没有描边，13 px `--mb-muted` 字；左边一个 14 px 的 `--mb-muted` 链接图标，图标和文字之间 5 px；悬停 `--mb-hover` 底、文字变 `--mb-ink`。展开后的列表每个源页面一行（图标、标题 14 px 600 `--mb-ink`、路径 12 px `--mb-faint`），下面的摘要 13 px `--mb-ink-2`，行之间 1 px 细线。
- 浏览器模式的提示是原型 `.notice` 的样子（`--mb-side` 底、圆角 8 px、内边距 12 px 14 px、14 px `--mb-ink` 字）；“已恢复到 … 的版本”的提示（原型没有画）：12 第 6 节的悬停提示颜色（`--mb-tooltip-bg` 底、`--mb-tooltip-text` 字），圆角 6 px、内边距 6 px 10 px、13 px，`--mb-pop` 阴影。

## 3. 范围

### 不做

- 逐字差异对比、整个工作区的版本回滚（快照已经有了）。
- 数据库关联属性计入反向链接。
- 手动“保存版本”按钮。
- 在历史预览里逐段标出删除和新增的段落（原型里的红色删除线和蓝色浅底只是示意）。

## 4. 执行步骤

### 步骤 0：开工准备

按执行手册 3.1 节开工（分支 `wp/16-history-backlinks`），生成报告骨架，跑基线 `npm test`。理解题（写在报告第 1 节）：

1. 一个页面一直没人动，今天打开后删光了全部内容，过了 3 分钟。历史里有哪些版本？能恢复原来的内容吗？
2. 浏览器模式下刷新页面后，历史版本还在吗？桌面版呢？
3. 页面 A 提及了页面 B，A 被移到回收站后，B 的反向链接数是多少？

提交 `WP-16: step 0 understanding`（本步不停）。

### 步骤 1：schema v16、备份与存储

按 2.1 节实现。新建 `tests/migration-v16.test.mjs`（直接调用 `migratePageVersions`）：`v16 adds an empty page version list`、`v16 keeps existing versions`、`v16 is idempotent`。新建 `tests/page-versions-storage.test.mjs`：

- `page versions round trip through a backup`：满配夹具加 3 个版本 → `workspaceToFiles` → `filesToWorkspace` → `pageVersions` 逐个深度相等。
- `older backups without page versions still restore`：用 schema 15 的元数据、文件里没有 `pageVersions.jsonl` → `filesToWorkspace` 成功，`pageVersions` 为 `[]`；`verifyPackage` 没有 `MISSING_FILE`。
- `schema 16 backups must contain page versions`：schema 16 的包缺这个文件 → `verifyPackage` 报 `MISSING_FILE`。
- `browser storage does not keep page versions`：用浏览器适配器保存一个带 2 个版本的工作区 → localStorage 里的 JSON 的 `pageVersions` 是空数组；内存里的对象不变。
- `permanently deleting a page removes its versions`：`permanentlyDelete(w, { pageIds: ["p-b-solo"], folderIds: [] })` 后没有 `pageId === "p-b-solo"` 的版本；`checkWorkspaceIntegrity` 没有 error。
- `orphan versions are reported`：一个指向不存在页面的版本 → warning `PAGE_VERSION_ORPHAN`。

提交 `WP-16: schema v16 and page version storage`。

### 步骤 2：版本纯函数

按 2.2 节实现。新建 `tests/page-history.test.mjs`：

- `retention keeps the specified versions`（2.2 节第一组已知答案）
- `retention keeps fifty recent versions`（第二组）
- `continuous editing captures two interval versions and one idle version`（第三组）
- `idle capture waits two minutes`（第四组）
- `identical snapshots share a signature`：同一页面生成两次快照，`snapshotSignature` 相同；改一个字后不同。
- `oversized pages do not create versions`：内容 JSON 超过 5 MB 时 `createPageVersion` 返回 `null`。
- `block comparison counts added removed and changed blocks`：版本 `[a, b, c]`、当前 `[a, b′, d]`（`b′` 是改了文字的 `b`）→ `{ added: 1, removed: 1, changed: 1 }`。
- `restoring a version saves the current state first`：`restorePageVersion` 后版本数加 1（多一个 `pre-restore`），页面内容等于被恢复的版本，`importRevision` 比恢复前大 1，记录页面的名称属性也同步。

提交 `WP-16: page history functions`。

### 步骤 3：自动生成版本

按 2.3 节实现。提交 `WP-16: automatic page versions`。

### 步骤 4：历史对话框与恢复

按 2.4、2.7 节实现。提交 `WP-16: page history dialog`。

### 步骤 5：反向链接纯函数

按 2.5 节实现。新建 `tests/backlinks.test.mjs`：

- `backlinks match the fixture`（2.5 节已知答案）
- `synced content counts for every page that shows it`：在 `sync-shared` 的段落里加一个指向 p-c1 的提及 → `backlinksFor("p-c1")` 的源页面是 p-a1、p-b1、p-z1。
- `block links count as backlinks`：在 p-z1 加一个链接 `lifeatlas://page/p-c1#block-b-c1-p` → p-c1 的源页面多了 p-z1，`kind === "blockLink"`。
- `content cards count as backlinks`：在 p-b1 正文末尾加 `{ id: "b-card", type: "editorialCard", props: { title: "卡片", eyebrow: "", excerpt: "", imageUrl: "", pageId: "p-c1", layout: "card" }, content: [], children: [] }` → `backlinksFor("p-c1")` 里有源页面 p-b1、`kind === "editorialCard"`、`blockId === "b-card"`、`snippet === ""`；再加一个 `pageId: ""` 的内容卡片 → 结果不变。
- `trashed sources are hidden and come back after restore`：`trashPage(w, "p-a1", NOW)` → `backlinksFor("p-z1")` 为空；恢复后回来。
- `incremental updates match a full rebuild`：对满配夹具做 5 次不同的修改（改正文、删除提及、加页面、删页面、改同步源），每次 `update` 后的 `backlinksFor`（全部页面）与新建索引 `rebuild` 的结果深度相等。
- `updating one page in a large workspace is fast`：`bigWorkspace({ pages: 5000, records: 0 })` 先 `rebuild`；改一个页面加一个提及 → `update` 5 次取中位数 < 20 ms，`backlinksFor` < 5 ms；`console.log("WP16_BACKLINK_UPDATE_MS=" + 中位数)`。

提交 `WP-16: backlink index`。

### 步骤 6：反向链接界面

按 2.6、2.7 节实现。提交 `WP-16: backlinks panel`。

### 步骤 7：浏览器场景

新建 `tests/browser/wp16-history.mjs`（种子：满配夹具；`browserScenario` 的第三个参数加 `viewport: { width: 1440, height: 900 }`；下面说的“截图 `x`”一律写成 WP-12 的 `await shootBothModes(page, screenshot, "x")`，白天、夜间各一张）。注意：浏览器模式下版本**不写进** localStorage，所以检查版本一律通过“页面历史”对话框，不要用 `saved()` 找版本。场景开头依次执行：

```js
page.on("dialog", (dialog) => dialog.accept());
await page.clock.install({ time: new Date(2026, 9, 1, 9, 0) });
await page.reload();                                   // 让 App 的 30 秒定时器使用假时钟
await page.locator('html[data-la-ready="1"]').waitFor();
```

检查项（标题照抄）：

1. `Editing creates a before-edit version and an idle version`：打开“A 子页面”，正文末尾输入“第一次修改”→ 打开页面历史 → 列表只有 1 项“编辑前”→ 关闭 → `page.clock.fastForward("02:30")` → 再打开页面历史 → 2 项，第一项是“自动保存”→ 关闭。
2. `The history dialog previews and compares versions`：打开页面历史 → 选第二项（编辑前）→ 右栏有“与当前相比：”字样，预览里有“子页面正文”、没有“第一次修改”；截图 `history`（加 `{ keepVisible: '[aria-label="页面历史"]' }`，和参照图同名）。
3. `Restoring a version brings back the old content and keeps a pre-restore copy`：选“编辑前”→“恢复此版本”→ 编辑器里有“子页面正文”、没有“第一次修改”；再次打开页面历史 → 3 项，第一项是“恢复前”。
4. `Backlinks list the pages that link here`：打开“Z 目标页”→ 有按钮“1 个反向链接”→ 展开后有“A 概览”和摘要“提及：Z 目标页”；截图 `backlinks`；点“A 概览”→ 打开 A 概览。
5. `New links and trashed sources update the count`：在“B 笔记”正文里输入 `@Z 目标` 并选择“Z 目标页”→ 回到“Z 目标页”→ 显示“2 个反向链接”；把“A 概览”移到回收站 → 显示“1 个反向链接”。
6. `Browser mode keeps history only for the session`：刷新页面 → 打开“B 笔记”（检查 5 刚编辑过它，刷新前它有版本；“A 子页面”已经随 A 概览进了回收站，不要用它）→ 页面历史为空，并显示浏览器模式提示。

加入场景列表，单独运行，日志 `.qa/WP-16/browser-wp16.log`。通过后生成对照图：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-16/compare.log node docs/blueprint/tools/compare-shots.mjs docs/blueprint/design/mobai/shots .qa --prefix wp16-history- --only history --out .qa/WP-16/compare
```

退出码 0。版本列表和预览的内容与原型不同，原型里的逐段标记本 WP 也不做（2.7 节），差异占比只供参考；把 `summary.md` 复制进报告第 3 节，并写出你看到的不同之处。提交 `WP-16: history browser scenario`。

### 步骤 8：桌面端到端

新建 `tests/desktop/history.e2e.mjs`：

- `page versions survive a restart`：满配夹具 → 打开“A 子页面”输入“桌面修改”→ `closeApp(handle, { keepDirs: true })`（退出前的保存会按 2.3 节生成 `idle` 版本，不需要假时钟）→ 用同一个 `dataRoot` 和 `bootstrapDir` 再 `launchApp` → 打开“A 子页面”的页面历史 → 有“自动保存”和“编辑前”两项。
- `restoring on desktop is saved to the database`：接着上一个用例的数据目录（或重新做一遍上一个用例的准备）：恢复“编辑前”版本 → 关闭 → 重启 → 页面里有“子页面正文”、没有“桌面修改”，页面历史第一项是“恢复前”。

运行：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-16/build.log npm run build
node docs/blueprint/tools/run-logged.mjs .qa/WP-16/desktop-build-test.log npm run desktop:build:test
node docs/blueprint/tools/run-logged.mjs .qa/WP-16/desktop-e2e.log npm run test:e2e:desktop
```

全部通过后提交 `WP-16: history desktop tests`。

### 步骤 9：收尾【停止点】

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-16/npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-16/browser-all.log npm run test:parity:browser
```

填完报告（第 3 节写出 `WP16_BACKLINK_UPDATE_MS`）；第 0 节全部“完成”；提交 `WP-16: complete report`；运行 `node docs/blueprint/tools/wp-check.mjs WP-16 --browser --desktop`，退出码 0 或 2 → 停止。

## 5. 验收标准

| 编号 | 标准 | 证据 |
| --- | --- | --- |
| AC-16-1 | 计时规则：停止编辑 2 分钟生成 `idle`；连续编辑 25 分钟得到 2 个 `interval`；内容没变不生成；第一次编辑前保存 `before-edit` | `tests/page-history.test.mjs`；场景检查 1 |
| AC-16-2 | 保留规则的两组已知答案通过；超过 5 MB 不生成 | `tests/page-history.test.mjs` |
| AC-16-3 | 历史对话框：列表、预览、对比；恢复后内容正确且多一个 `pre-restore` 版本；桌面版重启后仍在 | 场景检查 2、3；「restoring on desktop is saved to the database」 |
| AC-16-4 | 永久删除页面时删除它的版本；孤立版本报 warning | `tests/page-versions-storage.test.mjs` |
| AC-16-5 | 反向链接：四种来源（提及、页面链接块、区块链接、内容卡片）和同步内容都能识别；回收站里的源页面不计入；增量更新与全量重建结果一致 | `tests/backlinks.test.mjs`；场景检查 4、5 |
| AC-16-6 | `pageVersions` 进入备份并往返一致；旧备份（schema ≤ 15）没有这个文件也能恢复；浏览器模式不写进 localStorage | `tests/page-versions-storage.test.mjs`；场景检查 6 |
| AC-16-7 | 5,000 页面时，改一个页面后反向链接更新 < 20 ms（报告写实测值） | `tests/backlinks.test.mjs` 最后一个用例 |
| AC-16-8 | 迁移 15→16 纯函数、幂等 | `tests/migration-v16.test.mjs` |
| AC-16-9 | 视觉：页面历史和反向链接照墨白做（2.7 节）；截图：页面历史对话框、反向链接展开，白天和夜间各一张；页面历史与参照图并排对照 | `.qa/wp16-history-*.png`；`.qa/WP-16/compare/summary.md`；报告第 3 节 |
| AC-16-10 | G1–G9 | `.qa/WP-16/wp-check.md` |

## 6. 卡点处理

| 情况 | 做法 |
| --- | --- |
| 恢复后编辑器仍显示旧内容 | 检查 `restorePageVersion` 返回的页面 `importRevision` 是否加了 1，以及 `LazyPageEditor` 的 key 是否仍是 `` `${page.id}:${page.importRevision || 0}` `` |
| 只读预览改动了版本内容 | 预览的 `onChange` 必须是空函数；`PageEditor` 修复附件地址时会调用 `updateBlock`，这只改编辑器里的内容，不会写回版本 |
| `page.clock` 让编辑器或保存卡住 | 先 `page.clock.install` 再打开页面；只在需要推进时间时 `fastForward`（与 WP-13 相同） |
| 备份往返测试因为多了一个集合而失败 | 按 2.1 节最后一条改成使用 `BACKUP_COLLECTIONS`，断言内容不变 |
| 反向链接在大工作区里很慢 | 确认 `update` 只重算引用变了的页面，而不是每次 `rebuild` |
