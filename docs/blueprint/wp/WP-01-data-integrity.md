# WP-01 数据完整性修复（schema v11）

- 规模：M · 前置：WP-00 · 分支：`wp/01-integrity`
- 停止点：步骤 0（理解确认）、步骤 12（收尾）
- 必读：`09-执行手册.md`、`10-测试夹具规格.md`、`02-总体架构.md` 第 4.3、12 节；源码 `src/App.jsx`（下文点名的函数）、`src/domain/pageActions.js`、`src/domain/navigation.js`、`src/domain/database.js`、`src/domain/databaseProperties.js`（`mentionLabel`、`formatPropertyValue`）、`src/components/TrashView.jsx`、`src/components/WorkspaceSidebar.jsx`、`src/components/DatabaseView.jsx`、`src/editor/lifeAtlasSchema.jsx`（`PageLinkBlock`）、`src/persistence/migrations.js`、`src/persistence/workspaceRepository.js`、`src/search/searchIndex.js`、`tests/trash.test.mjs`

## 0. 一页纸

- **要做到**：文件夹和页面进回收站后整组可以原样恢复；永久删除会把依附的数据一并清理干净；在回收站里的内容不在任何视图、搜索、汇总里出现；文件夹可以移动。
- **交付物**：schema v11 迁移；`src/domain/trash.js`、`src/domain/integrity.js`、`src/persistence/normalize.js`；`moveFolder`；改造后的回收站界面与右键菜单；两个夹具文件；7 个新测试文件；浏览器场景 `wp01-integrity`。
- **绝对不要**：删除或改写任何已有数据的迁移；在迁移里删除数据；改动 `tests/trash.test.mjs` 等已有测试的断言；做侧栏拖拽、数据库“删除行”按钮、自定义确认对话框（都在后面的 WP）。
- **什么时候停**：步骤 0 结束停一次（等用户确认理解）；步骤 12 的 wp-check 退出码为 0 或 2 时停。

## 1. 为什么做

这是一个要用 10～20 年的资料库，现在有会丢数据的缺陷：

- 删除文件夹会**直接永久删除**整棵子树和里面所有页面，不进回收站（`App.jsx` 的 `deleteFolder`）。
- 永久删除页面时不清理它拥有的数据库、记录、视图、关联、讨论，留下悬空数据。
- 记录页面被移到回收站后，汇总、关联、搜索仍然算上它。
- 父页面进回收站时，它的子页面没有跟着处理。
- 没有“移动文件夹”。

## 2. 完成后（用户看到什么）

- 右键文件夹 → “移到回收站”：文件夹和里面的一切进入回收站，回收站里只显示一行“A 项目 · 包含 3 个文件夹、6 个页面”。点“恢复”，一切回到原处。
- 永久删除（手动、清空回收站、30 天到期）会把依附的数据库、记录、视图、关联、讨论、只被它们使用的同步区块与附件记录一起清掉；别的页面里指向它们的链接显示“已删除”，不报错。
- 在回收站里的记录不在任何视图、搜索、汇总、关联显示里出现，恢复后全部回来。
- 右键文件夹 → “移动到…”：可以移到别的文件夹或顶层，不能移进自己或自己的子文件夹。

## 3. 数据规则（规定）

### 3.1 新字段（schema v11）

| 实体 | 字段 | 含义 |
| --- | --- | --- |
| Folder | `trashedAt`（字符串或 `null`） | 进回收站时间 |
| Folder | `trashedByFolderId`（字符串或 `null`） | 因为哪个文件夹被删而一起进来；**组根**为 `null` |
| Page | `trashedByFolderId`（字符串或 `null`） | 同上 |
| Page | `trashedByPageId`（字符串或 `null`） | 因为哪个页面被删而一起进来；组根为 `null` |

迁移 `migrateTrashGroups`（10 → 11）：只补这些字段的默认值 `null`（页面已有的 `trashedAt` 保持原值），**不删除、不修改任何其他数据**；纯函数、幂等。已经在回收站里的页面（`trashedAt` 有值）迁移后自然成为自己的组根。

### 3.2 “拥有的后代页面”

`ownedDescendantPageIds(workspace, rootPageIds)` 返回集合 R 的闭包（**不含**根本身）：反复加入 ① `parentPageId` 属于“根 ∪ R”的页面，② `ownerPageId` 属于“根 ∪ R”的数据源的全部记录页面（`databaseItems[].pageId`），直到不再增加。

### 3.3 进回收站

- **文件夹 F**：F 及所有后代文件夹中**尚未在回收站**的，设 `trashedAt = now`、`updatedAt = now`；F 自己的 `trashedByFolderId = null`，其余设 `trashedByFolderId = F.id`。这些文件夹里**尚未在回收站**的页面，以及这些页面拥有的后代页面中尚未在回收站的，设 `trashedAt = now`、`updatedAt = now`、`trashedByFolderId = F.id`。
- **页面 P**：P 设 `trashedAt = now`、`updatedAt = now`（两个 `trashedBy*` 为 `null`）；P 拥有的后代中尚未在回收站的，设 `trashedAt = now`、`updatedAt = now`、`trashedByPageId = P.id`。
- 已经单独在回收站里的成员保持原样（它们是自己的组根）。
- 被移进回收站的文件夹和页面：`folders[].lastOpenedPageId` 指向它们的置空；`ui.selectedPageId`、`ui.selectedFolderId` 指向它们的置空。

### 3.4 回收站里显示什么

`listTrashGroups(workspace, now)` 只返回组根：`trashedAt` 不为空且两个 `trashedBy*` 都为空的文件夹和页面，按 `trashedAt` 降序。每组：

```js
{ kind: "folder" | "page", id, name, path, trashedAt, daysRemaining, folderCount, pageCount }
// name：文件夹名或页面标题（空标题用“无标题页面”）
// path：组根所在位置，“Private”加上祖先文件夹名，用“ / ”连接（不论祖先是否在回收站）
// folderCount：组内文件夹数（含组根）；pageCount：组内页面数（含记录页面）
// daysRemaining：沿用 pageActions.js 的 trashDaysRemaining 规则
```

界面每行显示：名称、原位置、删除时间、剩余天数、“包含 N 个文件夹、M 个页面”（`folderCount = 0` 时只写“M 个页面”）。操作：恢复、永久删除。顶部“清空回收站”。

### 3.5 恢复

- 恢复组根 R：清除 R 和所有 `trashedByFolderId === R.id`（文件夹组）或 `trashedByPageId === R.id`（页面组）成员的三个回收站字段，`updatedAt = now`。
- **恢复位置**：
  - 文件夹组根：原父文件夹存在且不在回收站 → 原位；否则 → 顶层（`parentId = null`）。
  - 页面组根：原文件夹存在且不在回收站 → 原文件夹；否则 → 第一个不在回收站的顶层文件夹（按 `compareNavigationOrder` 排序）；**一个都没有**时，新建文件夹“我的空间”（ID 由 `idFactory("folder")` 生成）并恢复到那里。这是新行为，替换现在 `restoreTrashedPage` 里“弹提示然后放弃”的做法。
  - 页面组根的 `parentPageId` 指向的页面不存在或仍在回收站 → 把 `parentPageId` 设为 `null`（变成文件夹里的顶层页面）。
- 恢复后在侧栏展开并选中恢复的对象（文件夹组选中文件夹；页面组打开页面）。
- 恢复前后（忽略三个回收站字段与 `updatedAt`；以及上一条规则改动的 `folderId`/`parentId`/`parentPageId`）实体必须深度相等。

### 3.6 在回收站期间的可见性

| 位置 | 规则 |
| --- | --- |
| 侧栏树、文件夹视图、侧栏计数 | 不显示在回收站的文件夹和页面；侧栏底部计数只数不在回收站的；回收站行上的数字改为“回收站组数” |
| 全局搜索 | 不返回：在回收站的文件夹和页面；页面在回收站的记录；页面在回收站（或已不存在）的讨论的评论 |
| 数据库视图（所有类型） | 不显示页面在回收站的记录（`projectViewItems` 已经这样做，保持） |
| 汇总计算 | 忽略页面在回收站的关联记录（数据仍保存在值里，恢复后自动回来） |
| 关联属性的显示文字 | 同上，忽略页面在回收站的记录 |
| 数据源所在页面（`ownerPageId`）在回收站 | 引用它的数据库块（包括关联视图）显示轻量提示“数据源所在页面在回收站中”，不显示记录，不报错 |
| 页面提及、页面链接块指向在回收站的页面 | 显示“<标题>（在回收站）”，点击不打开 |
| 页面提及、页面链接块指向已不存在的页面 | 显示“已删除的页面”，点击不打开 |
| 数据库块的 `sourceId` 指向已不存在的数据源 | 显示“数据库已删除”，不显示数据源选择器 |

### 3.7 永久删除（手动、清空回收站、30 天到期）

`permanentlyDelete(workspace, { pageIds, folderIds })`，记被删除的页面集合为 P、文件夹集合为 F：

1. 删除 F、P。
2. `ownerPageId ∈ P` 的数据源（集合 S）删除；`sourceId ∈ S` 的视图、数据库模板删除；`sourceId ∈ S` 或 `targetSourceId ∈ S` 的关联定义（`relations`）删除；其他数据源里 `config.targetSourceId ∈ S` 的关联属性，把 `config.targetSourceId` 设为 `null`（属性本身保留）。
3. `sourceId ∈ S` 或 `pageId ∈ P` 的记录删除（集合 I）；其他记录的关联属性值里移除 I 中的 ID。
4. `pageId ∈ P` 的讨论删除，它们的评论删除。
5. 同步区块源：**被 P 中页面引用过**、而且在剩余的页面（包括仍在回收站的页面）、页面模板、数据库模板、其他同步区块源里都不再被引用的，删除。原本就没人引用的不动。
6. 附件元数据：**被 P 中页面或 I 中记录引用过**、而且在剩余工作区里不再被引用的，删除（二进制不在本 WP 处理）。原本就没人引用的不动。附件的“引用”指：区块 `props.url` 里的 `#life-attachment=<id>`（用 `attachmentIdFromUrl` 解析）、区块 `props.attachmentId`、`files` 类型属性值里的附件 ID。
7. `folders[].lastOpenedPageId ∈ P` 置空；`ui.selectedPageId ∈ P`、`ui.selectedFolderId ∈ F` 时置空；`ui.expandedFolderIds` 移除 F。
8. 剩余页面正文里指向被删对象的数据库块、页面链接、提及：**不改写正文**，渲染时按 3.6 显示占位。
9. 仍在回收站、但所在文件夹已被永久删除的页面：保持在回收站，`folderId` 不改（恢复时按 3.5 找新位置）。
10. 到期清理：`purgeExpiredTrashGroups(workspace, now)`：`trashedAt` 距 `now` 已满 30 天（`isTrashExpired` 的规则）的组根，整组按以上规则永久删除。
11. “清空回收站”：所有组整组永久删除。

### 3.8 完整性检查器

`src/domain/integrity.js`：`checkWorkspaceIntegrity(workspace) → { ok, problems: [{ severity, code, collection, id, detail }] }`，`ok` 表示没有 `error`。

| 代码 | 级别 | 条件 |
| --- | --- | --- |
| `FOLDER_PARENT_MISSING` | error | 文件夹 `parentId` 不为空且找不到 |
| `FOLDER_CYCLE` | error | 沿 `parentId` 向上会回到自己 |
| `PAGE_FOLDER_MISSING` | error | **不在回收站**的页面 `folderId` 找不到 |
| `PAGE_PARENT_MISSING` | error | 不在回收站的页面 `parentPageId` 不为空且找不到 |
| `SOURCE_OWNER_MISSING` | error | 数据源 `ownerPageId` 不为空且找不到 |
| `ITEM_SOURCE_MISSING` | error | 记录 `sourceId` 找不到 |
| `ITEM_PAGE_MISSING` | error | 记录 `pageId` 找不到 |
| `VIEW_SOURCE_MISSING` | error | 视图 `sourceId` 找不到 |
| `RELATION_SOURCE_MISSING` | error | 关联定义的 `sourceId` 或 `targetSourceId` 找不到 |
| `RELATION_PROPERTY_TARGET_MISSING` | error | 关联属性 `config.targetSourceId` 不为空且找不到 |
| `RELATION_VALUE_MISSING` | error | 关联属性值里有找不到的记录 ID |
| `FILES_VALUE_MISSING` | error | `files` 属性值里有找不到的附件 ID |
| `PEOPLE_VALUE_MISSING` | error | `people` 属性值里有找不到的人员 ID |
| `DISCUSSION_PAGE_MISSING` | error | 讨论 `pageId` 找不到 |
| `COMMENT_DISCUSSION_MISSING` | error | 评论 `discussionId` 找不到 |
| `SYNCED_SOURCE_MISSING` | error | 任何页面（含回收站里的）、模板里的同步区块 `props.sourceId` 找不到 |
| `DATABASE_TEMPLATE_SOURCE_MISSING` | error | 数据库模板 `sourceId` 找不到 |
| `TRASH_GROUP_ROOT_MISSING` | error | `trashedByFolderId`/`trashedByPageId` 指向的对象不存在或不在回收站 |
| `PAGE_MENTION_TARGET_MISSING` | info | 页面提及指向找不到的页面 |
| `PAGE_LINK_TARGET_MISSING` | info | 页面链接块（`pageLink`）或 `subPage` 块指向找不到的页面 |
| `DATABASE_BLOCK_TARGET_MISSING` | info | 数据库块 `sourceId` 不为空且找不到 |
| `TRASHED_PAGE_FOLDER_MISSING` | info | 在回收站的页面 `folderId` 找不到 |
| `ATTACHMENT_UNREFERENCED` | info | 附件没有被任何地方引用（引用的定义见 3.7 第 6 条） |

工作区加载后（浏览器与将来的桌面都一样）运行一次；有 error 时 `console.warn("Life Atlas integrity", { 代码: 数量, … })`，**不自动修复、不删除任何东西**。

### 3.9 移动文件夹

- 领域函数（放 `src/domain/navigation.js`）：`moveFolder(workspace, folderId, targetParentId, now)`，`targetParentId` 为 `null` 表示顶层。以下情况抛错（错误信息照抄）：
  - 目标是自己或自己的后代：`不能把文件夹移动到它自己或它的子文件夹里`；
  - 目标文件夹不存在或在回收站：`目标文件夹不可用`；
  - 文件夹自己不存在或在回收站：`文件夹不可用`。
  成功时更新 `parentId`、`sortIndex`（目标下现有子文件夹最大 `sortIndex` + 10，没有子文件夹时为 10）、`updatedAt = now`，返回新工作区。
- 文件夹右键菜单新增“移动到…”（在“重命名”下面），弹出“移动文件夹”对话框，风格与现有 `PageMoveModal` 相同：标签“目标位置”的下拉框，第一项“Private 顶层”，其余为所有不在回收站的文件夹（显示完整路径，排序同 `PageMoveModal`）；自己和后代显示为禁用；目标等于当前位置时“移动文件夹”按钮禁用。
- 右键菜单里“删除文件夹”改名为“移到回收站”，确认文案：`将文件夹「X」及其中的 N 个页面移到回收站？30 天内可以恢复。`（N = 这次会进回收站的页面数）。

## 4. 范围

### 必做

第 3 节全部规则；第 5 节全部步骤。

### 不做

- 侧栏拖拽移动（WP-12）。
- 数据库表格里的“删除行”按钮界面（WP-15）；本 WP 只保证记录页面进回收站后的行为正确。
- 附件二进制清理（WP-17）。
- 自定义确认对话框样式（继续用现有 `window.confirm`）。
- 任何其他界面美化。

## 5. 执行步骤

时间约定：测试里用 `NOW = "2026-10-02T08:00:00.000Z"`（夹具时间 + 1 天）作为删除时间；`DAY = 86400000`。

### 步骤 0：开工准备【停止点】

```powershell
Set-Location -LiteralPath 'C:\Projects\life-atlas'
git status --porcelain
git switch main
git switch -c wp/01-integrity
node docs/blueprint/tools/wp-check.mjs WP-01 --init-report
node docs/blueprint/tools/run-logged.mjs .qa/WP-01/step0-npm-test.log npm test
```

基线测试必须 0 失败（WP-00 之后是 20 个文件、93 个用例）。然后在报告第 1 节写“我的理解”，并回答 4 道理解题：

1. 删除文件夹“A 项目”时，A 里面一个早就单独删除的页面 X 会怎样？之后恢复 A，X 会怎样？
2. 永久删除一个拥有行内数据库的页面后，**其他**数据库里关联到这些记录的值会怎样？
3. 记录页面在回收站时，计数汇总会不会算上它？恢复之后呢？
4. 迁移 10 → 11 会删除或修改哪些数据？

报告第 0 节把步骤 0 改成“完成”，然后：

```powershell
git add -A
git commit -m "WP-01: step 0 understanding"
node docs/blueprint/tools/wp-check.mjs WP-01 --until 0
```

退出码 0 → **停止**，等用户确认后再做步骤 1。

### 步骤 1：冻结 schema 10 夹具（必须在改迁移代码之前）

```powershell
node --input-type=module -e "import fs from 'node:fs'; import { coreParityWorkspace } from './tests/fixtures/core-parity-workspace.mjs'; import { upgradeWorkspace } from './src/persistence/migrations.js'; fs.writeFileSync('tests/fixtures/workspace-v10.json', JSON.stringify(upgradeWorkspace(coreParityWorkspace()), null, 2) + '\n');"
node -e "const w = require('./tests/fixtures/workspace-v10.json'); console.log(w.schemaVersion, w.pages.length, w.databaseItems.length, w.databaseViews.length)"
```

期望第二条输出 `10 6 4 10`。这个文件以后**永远不要重新生成**。

新建 `tests/fixture-workspace-v10.test.mjs`，用例：

- `v10 fixture stays frozen at schema 10`：读取 JSON，断言 `schemaVersion === 10`、`pages.length === 6`、`databaseItems.length === 4`、`databaseViews.length === 10`。

提交：`WP-01: freeze schema 10 fixture`。

### 步骤 2：满配夹具

把 `10-测试夹具规格.md` 第 2 节的代码**原样**保存为 `tests/fixtures/full-workspace.mjs`。

新建 `tests/fixture-full-workspace.test.mjs`，用例（断言 10 第 2.1 节表格里的事实）：

- `full fixture has the documented collection counts`
- `full fixture attachment bytes match the documented hashes`
- `full fixture is deterministic and returns fresh objects`（两次调用 `JSON.stringify` 相等，且修改一次的结果不影响下一次）
- `full fixture search baseline returns 27 documents`（`buildSearchDocuments(w.folders, w.pages, w)` 长度 27；搜索“深层”的结果 id 依次为 `page:p-c1`、`comment:cm-1`、`comment:cm-2`）

提交：`WP-01: add full workspace fixture`。

### 步骤 3：迁移 10 → 11

修改 `src/persistence/migrations.js`：

1. 在 `migrateWorkspaceShell` 后面新增并导出：

   ```js
   export function migrateTrashGroups(input) {
     const shell = migrateWorkspaceShell(input);
     if (Number(shell.schemaVersion) >= 11) return shell;
     const workspace = copyJson(shell);
     workspace.folders = (workspace.folders || []).map((folder) => ({ ...folder, trashedAt: folder.trashedAt ?? null, trashedByFolderId: folder.trashedByFolderId ?? null }));
     workspace.pages = (workspace.pages || []).map((page) => ({ ...page, trashedAt: page.trashedAt ?? null, trashedByFolderId: page.trashedByFolderId ?? null, trashedByPageId: page.trashedByPageId ?? null }));
     workspace.schemaVersion = 11;
     return workspace;
   }
   ```

2. `CURRENT_SCHEMA_VERSION` 改为 `11`；`upgradeWorkspace` 改为调用 `migrateTrashGroups`。
3. 其他迁移函数一个字都不改。

注意：浏览器存储键会变成 `life-atlas.workspace.v11`，旧的 `v10` 键原样保留（现有代码就是这样设计的，不要改）。

新建 `tests/migration-v11.test.mjs`，用例：

（这些用例都直接调用 `migrateTrashGroups`，不要用 `upgradeWorkspace`，见执行手册 4.2 节。）

- `v11 adds trash group fields with null defaults`
- `v11 keeps every collection count and entity id`（用满配夹具，比较迁移前后每个集合的 id 列表）
- `v11 is idempotent`（`migrateTrashGroups(migrateTrashGroups(w))` 与 `migrateTrashGroups(w)` 深度相等）
- `v11 upgrades the frozen v10 fixture`（结果 `schemaVersion === 11`）
- `v11 keeps an already trashed page as its own group root`（`p-b-solo` 迁移后 `trashedAt` 不变，两个 `trashedBy*` 为 `null`）

运行 `npm test`。已有测试里如果有断言“当前 schema 版本就是 10”的，**不要改它**，停下报告（总设计师核对过：现有测试只断言 `migrateWorkspaceShell` 产生 10，这个仍然成立）。

提交：`WP-01: schema v11 trash group fields`。

### 步骤 4：回收站领域函数

新建 `src/domain/trash.js`，导出（全部纯函数，不读系统时间，不修改输入）：

```js
export function ownedDescendantPageIds(workspace, rootPageIds)        // → Set（3.2）
export function trashFolder(workspace, folderId, now)                 // → workspace（3.3）
export function trashPage(workspace, pageId, now)                     // → workspace（3.3）
export function trashGroupMembers(workspace, { kind, id })            // → { folderIds: [...], pageIds: [...] }（含组根）
export function listTrashGroups(workspace, now)                       // → 数组（3.4）
export function restoreTrashGroup(workspace, { kind, id }, { now, idFactory })  // → { workspace, restored: { kind, id, folderId } }（3.5）
export function permanentlyDelete(workspace, { pageIds, folderIds })  // → workspace（3.7）
export function deleteTrashGroupPermanently(workspace, { kind, id })  // → workspace（整组）
export function emptyTrash(workspace)                                 // → workspace（所有组）
export function purgeExpiredTrashGroups(workspace, now)               // → workspace（3.7 第 10 条）
export function pageAvailability(workspace, pageId)                   // → "ok" | "trashed" | "missing"
export function attachmentReferences(workspace)                       // → Set<附件ID>（3.7 第 6 条的引用定义）
export function syncedSourceReferences(workspace)                     // → Set<同步源ID>（页面、模板、同步源里的 syncedBlock）
```

- `now` 是 ISO 字符串；`idFactory(prefix)` 返回新 ID。
- `pageActions.js` 里现有的 `movePageToTrash`、`purgeExpiredTrash(pages, now)` 等函数**保留不动**（`tests/trash.test.mjs` 在测它们）。

新建 `tests/trash-groups.test.mjs`，用 `upgradeWorkspace(fullWorkspace())` 作为起点 `w`。用例与断言（照抄名字）：

- `trashFolder marks the whole subtree and keeps the solo page as its own root`：`trashFolder(w, "f-a", NOW)` 后，f-a 的 `trashedByFolderId === null`，f-b、f-c 的 `trashedByFolderId === "f-a"`；p-a1、p-a1-child、p-b1、p-c1、p-rec-1、p-rec-2 的 `trashedAt === NOW` 且 `trashedByFolderId === "f-a"`；p-b-solo 的 `trashedAt` 仍是 `SOLO_TRASHED_AT` 且两个 `trashedBy*` 为 `null`；p-z1、p-db、p-rec-3、p-rec-4 的 `trashedAt === null`。
- `listTrashGroups shows one row per group with counts`：上一步之后返回两组，依次为 `{ kind: "folder", id: "f-a", name: "A 项目", path: "Private", folderCount: 3, pageCount: 6, daysRemaining: 30 }` 与 `{ kind: "page", id: "p-b-solo", name: "B 单独删除的页", path: "Private / A 项目 / B 资料", folderCount: 0, pageCount: 1, daysRemaining: 27 }`（只比较这些字段）。
- `restoring the folder group returns every member unchanged`：恢复 f-a 后，与 `w` 相比，所有实体在忽略三个回收站字段和 `updatedAt` 后深度相等；p-b-solo 仍在回收站。
- `trashPage takes owned record pages along`：`trashPage(w, "p-b1", NOW)` 后，p-rec-1、p-rec-2 的 `trashedByPageId === "p-b1"`；恢复 p-b1 组后全部回来。
- `trashPage takes child pages along`：`trashPage(w, "p-a1", NOW)` 后 p-a1-child 的 `trashedByPageId === "p-a1"`。
- `restoring a page whose folder is gone falls back to the first top-level folder`：先 `trashFolder(w, "f-a", NOW)`，再 `deleteTrashGroupPermanently(…, { kind: "folder", id: "f-a" })`，再恢复 p-b-solo → 它的 `folderId === "f-z"`。
- `restoring creates a folder when no top-level folder is left`：构造一个只有 1 个顶层文件夹的工作区，页面单独进回收站后把文件夹整组永久删除，再恢复页面 → 新建了名为“我的空间”的文件夹，页面在里面。
- `restoring a child page whose parent is still in trash makes it a top-level page`：先 `trashPage(w, "p-a1-child", NOW)`，再 `trashPage(…, "p-a1", NOW)`，只恢复 p-a1-child → 它的 `parentPageId === null`、`folderId === "f-a"`。
- `permanent delete of the folder group cleans every dependent record`：`trashFolder(w, "f-a", NOW)` 后整组永久删除，断言剩余的：folders 为 `f-z, f-empty`；pages 为 `p-b-solo, p-z1, p-db, p-rec-3, p-rec-4`；dataSources 为 `ds-full`，且其属性 `rel-back` 的 `config.targetSourceId === null`；databaseItems 为 `i-3, i-4`，二者的 `rel-back` 值都是 `[]`；databaseViews 为 `v-full-table`；relations 为空；syncedSources 为 `sync-shared`；attachments 为 `att-orphan`；pageTemplates 为 `tpl-1`；databaseTemplates 为空；discussions 与 comments 为空；`ui.selectedPageId === null`、`ui.selectedFolderId === null`、`ui.expandedFolderIds` 为空数组。
- `permanent delete keeps pre-existing orphans`：上一条结果里 `att-orphan` 仍在；再造一个没人引用的同步源，永久删除别的页面后它仍在。
- `purge removes groups after 30 days and keeps younger ones`：`trashFolder(w, "f-a", NOW)` 后，`purgeExpiredTrashGroups(…, NOW + 29 天)` → f-a 组还在、p-b-solo 已被永久删除（它已满 30 天）；`purgeExpiredTrashGroups(…, NOW + 31 天)` → 回收站为空，f-a 的成员都不存在。
- `emptyTrash deletes every group`。
- `pageAvailability reports ok, trashed and missing`。

提交：`WP-01: trash group domain functions`。

### 步骤 5：完整性检查器

新建 `src/domain/integrity.js`，按 3.8 的表格逐条实现（`collection` 写实体所在集合名，`id` 写实体 ID，`detail` 写一句英文或中文说明）。

新建 `tests/integrity.test.mjs`，用例：

- `fixture baseline is ok with one unreferenced attachment`：满配夹具 `ok === true`，`problems` 只有一条 `info`/`ATTACHMENT_UNREFERENCED`（id `att-orphan`）。
- `every error code is detected`：对满配夹具逐一制造 3.8 表格里每种 error（每种一个小改动），断言对应代码出现且 `ok === false`。
- `after permanent delete only info problems remain`：步骤 4 “permanent delete of the folder group…” 的结果 `ok === true`，并且 info 里有 `TRASHED_PAGE_FOLDER_MISSING`（p-b-solo）、`DATABASE_BLOCK_TARGET_MISSING`（p-z1）、`PAGE_MENTION_TARGET_MISSING`（p-z1）。

提交：`WP-01: workspace integrity checker`。

### 步骤 6：回收站期间的可见性

逐个文件修改（只改下面写到的地方）：

1. `src/domain/navigation.js`：`childFolders` 只返回 `!folder.trashedAt` 的文件夹。
2. `src/search/searchIndex.js` 的 `buildSearchDocuments`：
   - 文件夹文档跳过 `trashedAt` 有值的；
   - 记录文档跳过页面在回收站或页面不存在的记录；
   - 评论文档跳过“讨论不存在、讨论的页面不存在或页面在回收站”的评论。
3. `src/domain/database.js` 的 `resolvePropertyValue`（汇总分支）：计算前从 `relatedIds` 里去掉“记录不存在或记录页面在回收站”的 ID。
4. `src/domain/databaseProperties.js`：
   - `formatPropertyValue` 的关联分支：同样忽略这些记录；
   - `mentionLabel` 的页面提及：页面不存在 → `已删除的页面`；页面在回收站 → `<标题>（在回收站）`。
5. `src/editor/lifeAtlasSchema.jsx` 的 `PageLinkBlock`：页面不存在显示 `已删除的页面`；在回收站显示 `<标题>（在回收站）`；这两种情况点击不调用 `openPage`。
6. `src/components/DatabaseView.jsx` 的 `DatabaseView`：
   - `sourceId` 不为空但找不到数据源 → 渲染 `<div className="database-view database-view-empty">数据库已删除</div>`（不显示数据源选择器）；`sourceId` 为空时保持现有的选择器；
   - 数据源的 `ownerPageId` 页面在回收站 → 渲染 `<div className="database-view database-view-empty">数据源所在页面在回收站中</div>`。
7. `src/components/WorkspaceSidebar.jsx`：底部计数只数不在回收站的文件夹；回收站行的数字改为 `listTrashGroups(...)` 的组数（需要把 workspace 或组数作为新 prop 传入）。

新建 `tests/trash-visibility.test.mjs`，用例（起点：`trashFolder(w, "f-a", NOW)` 或 `trashPage(w, "p-b1", NOW)`）：

- `trashed folders and pages disappear from navigation helpers`
- `search hides trashed folders, pages, records and their comments`：f-a 进回收站后搜索“深层”结果为空；搜索“任务一”结果为空；搜索“记录上的评论”结果为空。
- `rollups and relation labels ignore records in trash`：p-b1 进回收站后，i-3 的 `task-count` 为 0、i-4 为 0；`formatPropertyValue` 显示 i-3 的 `rel-back` 为空字符串；恢复后 i-3 = 2、i-4 = 1。
- `views hide records whose page is in trash`：p-b1 进回收站后，`v-inline-table` 的 `projectViewItems` 为空。
- `mentions show trashed and deleted states`：`mentionLabel` 对在回收站的 p-b1 返回 `B 笔记（在回收站）`，对不存在的页面返回 `已删除的页面`。

提交：`WP-01: hide trashed content from views, search and rollups`。

### 步骤 7：加载规范化提取为共用模块

1. 新建 `src/persistence/normalize.js`，导出 `normalizeLoadedWorkspace(input, { fallbackWorkspace, now })`：把 `workspaceRepository.js` 里 `migrateWorkspace` 的逻辑原样搬过来，改两处：
   - 不再调用 `purgeExpiredTrash(migratedPages, Date.now())`；
   - 在 `upgradeWorkspace(...)` 得到结果之后，调用 `purgeExpiredTrashGroups(result, now)` 并返回它。
   `now` 是参数（毫秒数或 ISO 字符串都接受），函数里不出现 `Date.now()`、`new Date()`。
2. `workspaceRepository.js` 删除本地的 `migrateWorkspace`，`load` 里三处调用改为 `normalizeLoadedWorkspace(x, { fallbackWorkspace, now: Date.now() })`。其他代码不动。
3. 新建 `tests/normalize.test.mjs`，用例：
   - `normalize fills page defaults like the old browser loader`
   - `normalize purges expired trash groups using the injected now`
   - `normalize is deterministic for identical inputs`
4. 已有的 `tests/workspace-persistence.test.mjs` 必须全部仍然通过。

提交：`WP-01: shared normalizeLoadedWorkspace`。

### 步骤 8：移动文件夹

1. 在 `src/domain/navigation.js` 实现并导出 `moveFolder`（3.9）。
2. 新建 `tests/folder-move.test.mjs`，用例：
   - `moveFolder rejects moving a folder into itself`
   - `moveFolder rejects moving a folder into its descendant`
   - `moveFolder moves to top level and appends the sort index`（把 f-b 移到顶层 → `parentId === null`、`sortIndex === 40`）
   - `moveFolder rejects a trashed target`
3. 界面（`src/App.jsx`）：
   - `ContextMenu` 的文件夹菜单：在“重命名”下面加 `<button type="button" role="menuitem" onClick={() => onAction("move-folder", menu)}>移动到…</button>`；把“删除文件夹”的文字改为“移到回收站”；页面菜单里的“删除页面”也改为“移到回收站”（动作名 `delete-folder`、`delete-page` 不变）；
   - `showContextMenu` 里文件夹菜单高度 `228` 改为 `256`；
   - 新增状态 `const [moveFolderTargetId, setMoveFolderTargetId] = useState(null);`，`handleContextAction` 里 `action === "move-folder"` 时设置它；
   - 新增组件 `FolderMoveModal`（紧挨着 `PageMoveModal` 写，结构照抄它）：标题“移动文件夹”，说明“选择「X」的新位置。”，`<label className="field-label" htmlFor="folder-move-target">目标位置</label>` + `<select id="folder-move-target">`，选项值 `""` 表示“Private 顶层”；提交按钮文字“移动文件夹”；
   - 提交时调用 `moveFolder`，成功后展开目标文件夹及其祖先；失败时 `window.alert(错误信息)`。

提交：`WP-01: move folder`。

### 步骤 9：接入 App 与回收站界面

修改 `src/App.jsx`（函数名 `restoreTrashedPage`、`permanentlyDeleteTrashedPage`、`emptyTrash` **必须保留**，`tests/trash.test.mjs` 会检查它们存在）。从 `trash.js` 导入时给同名函数起别名，避免冲突：`import { emptyTrash as emptyAllTrashGroups, … } from "./domain/trash.js";`。

1. `deleteFolder(id)`：改为“移到回收站”——计算 N（这次会进回收站的页面数），确认文案用 3.9 的原文，确认后 `setWorkspace((current) => trashFolder(current, id, new Date().toISOString()))`；若当前选中的文件夹或页面进了回收站，清空选中并选中被删文件夹的父文件夹（没有父文件夹就选第一个顶层文件夹）。
2. `deletePage(id)` 与 `trashCurrentPage()`：改为调用 `trashPage(...)`，确认文案不变。
3. `restoreTrashedPage(group)`：参数改为回收站组 `{ kind, id }`；调用 `restoreTrashGroup(current, group, { now, idFactory: makeId })`；然后按 `restored` 展开并选中（文件夹组 → `openFolder`，页面组 → `openPage`）。
4. `permanentlyDeleteTrashedPage(group)`：确认文案 `永久删除「名称」？此操作无法撤回。`，确认后 `deleteTrashGroupPermanently(...)`；如果当前选中的页面或文件夹被删除，清空 React 状态 `selectedPageId`/`selectedFolderId` 并从 `expanded` 移除被删的文件夹。
5. `emptyTrash()`：确认文案 `永久删除回收站中的全部内容（N 组）？此操作无法撤回。`，确认后调用 `emptyAllTrashGroups(current)`；同样清理 React 状态。
6. 工作区初次加载后运行一次 `checkWorkspaceIntegrity`，有 error 时按 3.8 输出 `console.warn`（只运行一次，用 `useEffect(…, [])`）。
7. `TrashView` 改为接收 `groups`（`listTrashGroups(workspace, Date.now())` 的结果）、`folders`、`onRestore(group)`、`onDeletePermanently(group)`、`onEmptyTrash()`；每行按 3.4 显示；文件夹组用文件夹标记（`folder-marker`），页面组用页面图标。保留页面里现有的文字“30 天”“恢复”“永久删除”“清空回收站”。

运行 `npm test`，全部通过后提交：`WP-01: wire trash groups into the app`。

### 步骤 10：浏览器场景

新建 `tests/browser/wp01-integrity.mjs`，用满配夹具 `{ workspace: fullWorkspace() }`。每次会弹出 `window.confirm` 之前先注册 `page.once("dialog", (dialog) => dialog.accept())`。检查项（标题照抄）：

1. `Folder moves to trash as one group`：侧栏右键“A 项目”→“移到回收站”→ 侧栏不再有“A 项目”→ 打开“回收站”→ 有 2 行，其中一行含“A 项目”和“包含 3 个文件夹、6 个页面”，另一行含“B 单独删除的页”。截图 `trash-folder-group`。
2. `Search hides trashed content`：`Ctrl+K` 搜索“深层”→ 没有任何结果项。
3. `Restoring the folder group brings content back after reload`：在“A 项目”行点“恢复”→ 侧栏出现“A 项目”→ 刷新页面 → 打开“C 深层”，正文含“深层正文”。截图 `after-restore`。
4. `Folder moves into another folder but not into its own child`：右键“B 资料”→“移动到…”→ 下拉框里“C 细节”那一项是禁用的 → 选“Private / Z 其他”→ 点“移动文件夹”→ 刷新后用 `saved()` 断言 `f-b` 的 `parentId === "f-z"`。
5. `Permanently deleted targets render as placeholders`：右键“B 笔记”→ 移到回收站 → 回收站里对“B 笔记”点“永久删除”→ 打开“Z 目标页”→ 页面里出现“数据库已删除”和“已删除的页面”。

在 `tests/core-parity-browser.mjs` 的 `scenarios` 数组末尾加入 `"wp01-integrity"`。只跑这个场景：

```powershell
$env:PARITY_ONLY = "wp01-integrity"
node docs/blueprint/tools/run-logged.mjs .qa/WP-01/browser-wp01.log npm run test:parity:browser
Remove-Item Env:PARITY_ONLY
```

提交：`WP-01: browser scenario for trash groups and folder move`。

### 步骤 11：全量回归

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-01/npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-01/browser-all.log npm run test:parity:browser
```

两个都必须 `exit=0`；浏览器日志里 7 个场景都是 `PASS`。

### 步骤 12：收尾【停止点】

1. 填完报告第 2–7 节；第 0 节所有步骤改为“完成”。
2. `git add -A`，`git commit -m "WP-01: complete report"`。
3. 运行：

   ```powershell
   node docs/blueprint/tools/wp-check.mjs WP-01 --browser
   ```

   退出码 0 或 2 → 停止，按执行手册第 6.2 节回复。

## 6. 验收标准

| 编号 | 标准 | 证据 |
| --- | --- | --- |
| AC-01-1 | 删除文件夹 A：组内成员标记正确、单独删除的页面保持独立；回收站两行、计数正确；恢复后与删除前深度相等（忽略回收站字段与 `updatedAt`） | `tests/trash-groups.test.mjs` 前 3 个用例 |
| AC-01-2 | 删除页面会带走子页面与它拥有的记录页面；恢复后全部回来；三种恢复位置规则都有测试 | `tests/trash-groups.test.mjs` 第 4–8 个用例 |
| AC-01-3 | 回收站期间：导航、搜索、视图、汇总、关联文字、提及都按 3.6 处理；恢复后回来 | `tests/trash-visibility.test.mjs` |
| AC-01-4 | 永久删除整组后剩余数据与步骤 4 列出的完全一致，预先存在的孤立数据不受影响，完整性检查只剩 info | `tests/trash-groups.test.mjs`「permanent delete…」两个用例；`tests/integrity.test.mjs` |
| AC-01-5 | 30 天到期清理：29 天与 31 天两个时间点的结果正确；加载规范化使用注入的 `now` | `tests/trash-groups.test.mjs`「purge…」；`tests/normalize.test.mjs` |
| AC-01-6 | `moveFolder` 的 3 种拒绝与 1 种成功；浏览器里移动后刷新仍在新位置 | `tests/folder-move.test.mjs`；场景检查 4 |
| AC-01-7 | 迁移 10→11 纯函数、幂等、数量与 ID 不变，冻结的 v10 夹具可升级；已有迁移测试全部通过 | `tests/migration-v11.test.mjs`；`tests/fixture-workspace-v10.test.mjs` |
| AC-01-8 | 浏览器场景 5 项检查全部通过；截图 `.qa/wp01-integrity-trash-folder-group.png`、`.qa/wp01-integrity-after-restore.png` | `.qa/WP-01/browser-all.log` 与截图 |
| AC-01-9 | 正文指向已删除对象时显示占位，页面没有 `pageerror` | 场景检查 5（harness 断言没有错误） |
| AC-01-10 | 满配夹具与 10 第 2.1 节的事实一致 | `tests/fixture-full-workspace.test.mjs` |
| AC-01-11 | G1–G9 | `.qa/WP-01/wp-check.md` |

## 7. 卡点处理

| 情况 | 做法 |
| --- | --- |
| 步骤 1 的输出不是 `10 6 4 10` | 停下报告（说明代码在 WP-00 之后被改过） |
| 步骤 3 后某个已有测试因为 schema 版本变化失败 | 停下报告失败的用例名，不要改那个测试 |
| 步骤 4 的某个预期结果和你的实现不一致，而你认为规格错了 | 按规格实现；在报告第 6 节写明你的理由，由总设计师判断 |
| `tests/trash.test.mjs` 因为函数名或文案变化失败 | 你改名或改文案了：恢复原来的函数名和文案（第 9 步第 1 段已经规定） |
| 浏览器场景找不到右键菜单项 | 用 `page.getByRole("menuitem", { name: "移到回收站" })` 定位；仍找不到就截图写进报告第 7 节 |
