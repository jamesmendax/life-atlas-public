# WP-18 Notion 导出包导入与 Markdown 全量导出

- 规模：L · 前置：WP-17 · 分支：`wp/18-import-export`
- 停止点：步骤 0（理解确认）、步骤 6（导入完成）、步骤 12（收尾）
- 必读：`01-需求与范围.md` 第 3.6 节与第 4 节（只导入本地文件，不连 Notion）；`11-接口契约.md`（`exports.writeMarkdownFolder`）；`09-执行手册.md`；源码 `src/domain/markdownBlocks.js`（WP-13）、`src/domain/pageExport.js`（`pageToMarkdown`、`blockMarkdown`、`inlineMarkdown`）、`src/domain/csv.js`（WP-15）、`src/domain/documentSemantics.js`（`pageSemanticDocument`）、`src/App.jsx`（`createEditorAttachment`）、WP-02 的 `readAttachmentBlob`；`12-视觉规范-墨白.md` 第 0、3、6、7、8 节和 2.7 节列出的参照画面；WP-12 加在 `tests/browser/harness.mjs` 里的 `shootBothModes`

## 0. 一页纸

- **要做到**：① 把 Notion 导出的“Markdown 和 CSV”压缩包导进来（页面层级、正文、数据库和记录、图片附件、页面之间的链接），全部放进一个新的顶层文件夹，不改动现有内容；② 把整个工作区导出成普通的 Markdown 文件夹（数据库导出为 CSV），十年后没有这个软件也能用任何文本编辑器读。
- **交付物**：扩展后的 `markdownBlocks.js`；`src/import/notionImport.js`、`src/import/notionNames.js`；`src/export/markdownExport.js`；`src/components/NotionImportDialog.jsx`、`MarkdownExportDialog.jsx`（墨白样式 `src/ui/themes/mobai/import-export.css`）；主进程 `exports.writeMarkdownFolder`；测试夹具 `tests/fixtures/notion-export.mjs`；单元测试；浏览器场景 `wp18-import-export`；桌面端到端；白天和夜间的截图与对照图。
- **绝对不要**：联网或调用 Notion API；使用任何真实的 Notion 用户数据（夹具全部手写）；导入时修改、替换或合并任何现有实体；导出密钥库、回收站、页面历史、评论；导入 HTML 格式的导出包；把 Markdown 文件夹再导回来（不做）。
- **什么时候停**：步骤 0、步骤 6 之后各停一次；步骤 12 的 wp-check 退出码为 0 或 2 时停。

## 1. 已知事实与说明

| 事实 | 对你的影响 |
| --- | --- |
| Notion 导出对话框的中文选项：导出格式“Markdown 和 CSV”、“包含子页面”、“为子页面创建文件夹” | 导入对话框的说明文字用这些原词，告诉用户怎么导出 |
| Notion 的导出格式没有公开规范。第 2.1 节是总设计师根据公开资料整理的格式；**没有用真实导出包验证过** | 导入器按 2.1 节实现，遇到不认识的内容不报错，列进“无法识别”清单；用户第一次导入真实导出包后，如果清单很长，交回总设计师修订 |
| WP-13 的 `markdownToBlocks` 只支持标题 1–3、列表、待办、引用、代码、行内样式，不支持嵌套、表格、图片、链接 | 2.2 节扩展它，WP-13 的测试必须仍然通过 |
| `createEditorAttachment(file)` 在浏览器和桌面都能把文件存成附件并返回 `{ url }`（WP-04） | 导入图片和文件用它 |
| 2.1、2.5 节的已知答案（日期解析、文件名拆分、文件名清理与去重）总设计师已用参考实现跑过 | 单元测试照抄 |

## 2. 设计要点（规定）

### 2.1 支持的 Notion 导出结构

- 外层是一个 zip；里面可能直接是文件，也可能是若干个 `*.zip` 分卷（如 `Export-<编号>-Part-1.zip`），分卷里才是文件。分卷最多再展开 1 层。全部条目合并成一棵路径树（`/` 分隔）。如果所有路径都在同一个顶层目录下（例如 `Export-abc/`），去掉这一层。
- **名称**：文件和目录名是“标题 + 空格 + 32 位小写十六进制编号 + 扩展名”，编号可能没有。`parseNotionName(name)`（`src/import/notionNames.js`）：

  ```js
  export function parseNotionName(name) {
    const match = /^(.*?)(?:\s+([0-9a-f]{32}))?(_all)?(\.[A-Za-z0-9]+)?$/.exec(name);
    return { title: match[1], notionId: match[2] || null, all: Boolean(match[3]), extension: (match[4] || "").toLowerCase() };
  }
  ```

  已知答案：`项目总览 0123456789abcdef0123456789abcdef.md` → `{ title: "项目总览", notionId: "0123…cdef", all: false, extension: ".md" }`；`任务库 2222222222222222222222222222222b_all.csv` → `all: true, extension: ".csv"`；`没有编号的页面.md` → `notionId: null`；没有扩展名的目录名 → `extension: ""`。
- **页面**：每个 `.md` 文件是一个页面。与它同一目录、名称（去掉扩展名后）相同的目录里，放的是它的子页面、图片和数据库。
- **数据库**：`X <编号>.csv`，可能还有 `X <编号>_all.csv`（有 `_all` 时用 `_all`，它包含全部行）。与 CSV 同一目录下名为 `X <编号>`（或 `X`）的目录里，每个 `.md` 是一行的记录页面。CSV 第一列是标题；记录页面和 CSV 行按标题对应（同名的按出现顺序一一对应）；属性值以 CSV 为准。
- **页面正文**（`.md`）：第一行 `# 标题`（用它作页面标题；没有时用文件名里的标题）。记录页面的属性行要跳过（值以 CSV 为准）：从标题的下一行开始，先跳过**最多一个**空行，然后连续的、形如 `属性名: 值` 且“属性名”是这个 CSV 的列名的行全部跳过，遇到第一个不符合的行（通常是空行）为止。普通页面不做这一步。其余内容按 2.2 节转成区块。夹具的记录页面是 `# 任务一` / 空行 / `状态: 进行中` / `截止: …` / 空行 / `任务一的正文。`，处理后正文只剩“任务一的正文。”。
- **链接**：正文里的链接地址是相对路径，经过 URL 编码（`%20` 等），先 `decodeURIComponent` 再按当前文件所在目录解析（支持 `../`）。指向 `.md` → 页面；指向 `.csv` → 数据库；指向其他文件 → 附件。`http:`、`https:`、`mailto:` 原样保留为链接。
- **CSV 的值**：
  - 日期：`parseNotionDate(text)`（`notionNames.js`），支持 `September 19, 2026`、`Sep 19, 2026`、`2026/09/19`、`2026-09-19`、`2026年9月19日`，后面可带时间 `10:00 AM`、`9:05 PM`、`22:30`；范围用 ` → ` 连接。返回 `{ start, end, includeTime, timeZone: null }` 或 `null`。已知答案：

    | 输入 | 结果 |
    | --- | --- |
    | `September 19, 2026` | `{ start: "2026-09-19", end: null, includeTime: false, timeZone: null }` |
    | `Sep 19, 2026 10:00 AM` | `{ start: "2026-09-19T10:00", end: null, includeTime: true, timeZone: null }` |
    | `September 19, 2026 12:30 PM → September 21, 2026 9:05 PM` | `{ start: "2026-09-19T12:30", end: "2026-09-21T21:05", includeTime: true, timeZone: null }` |
    | `September 19, 2026 12:00 AM` | `start: "2026-09-19T00:00"`，`includeTime: true` |
    | `2026年9月19日 → 2026年9月21日` | `{ start: "2026-09-19", end: "2026-09-21", includeTime: false, timeZone: null }` |
    | `2026-09-19 22:30` | `start: "2026-09-19T22:30"`，`includeTime: true` |
    | `February 30, 2026`、`Someday 1, 2026`、空字符串 | `null` |

  - 多选：用 `, ` 分隔（`splitNotionMulti("前端, 后端,前端")` → `["前端", "后端"]`，去重保序）。一列被认作多选的条件 `looksMultiSelect(values)`：至少有一个值拆出 2 个以上的词，且全部值拆出的不同词不超过 30 个。
  - 关联：值形如 `标题 (相对路径.md), 标题2 (相对路径2.md)` 时，按路径找到导入的记录，属性类型为关联（目标是那个数据库）；找不到的部分丢弃并计入“无法识别的值”。
  - 列类型推断顺序：关联（上一条）→ 日期（全部非空值 `parseNotionDate` 成功）→ 多选（`looksMultiSelect`）→ 其余交给 WP-15 的 `inferColumnType`（数字、复选框 `Yes`/`No`、单选、文本）。第一列固定为名称。**日期必须排在多选前面**：`September 19, 2026` 按 `, ` 能拆成两段，先判多选会把日期列认错（夹具的“截止”列就是这样）。
- **HTML 格式**：没有任何 `.md` 和 `.csv`、但有 `.html` 文件时，提示“这是 HTML 格式的导出包。请在 Notion 的导出对话框里把导出格式选为“Markdown 和 CSV”后重新导出。”，不导入。
- **无法识别的文件**：没有被任何页面引用的非 `.md`/`.csv` 文件，以及解析失败的 `.md`/`.csv`，列进“无法识别”清单（路径 + 原因），不导入。

### 2.2 扩展 `markdownToBlocks(text, options = {})`（`src/domain/markdownBlocks.js`）

**签名**：WP-13 的写法是 `markdownToBlocks(text, idFactory = newEntityId)`。本 WP 把第二个参数改成 `options = {}`，`options.idFactory`（默认 `newEntityId`）代替原来的第二个参数，另有 `options.resolveAsset`、`options.resolvePage`（见下表）。为了不改 WP-13 的调用和测试：第二个参数是函数时，当作 `{ idFactory: 第二个参数 }` 处理。导入时（2.3 节）一律传 `{ idFactory, resolveAsset, resolvePage }`，`idFactory` 就是 `buildNotionImport` 收到的那个。

在 WP-13 的基础上增加（WP-13 已有的写法行为不变）：

| 写法 | 区块 |
| --- | --- |
| `#### ` 开头 | 标题 4 |
| 行首缩进（2 个空格、4 个空格或 1 个 Tab 为一级）的列表项、待办 | 作为上一个列表项的子区块 |
| 单独一行 `---`、`***` | 分隔线 |
| 单独一行 `![说明](路径)` | `options.resolveAsset(路径)` 返回 `{ url, kind }`（`kind` 为 `image`/`file`）→ 对应区块（`props.url`、`props.name`=说明或文件名）；返回 `null` → 段落“[图片：说明]” |
| 单独一行 `[文字](路径.md)` 或 `[文字](路径.csv)` | `options.resolvePage(路径)` 返回页面 ID → `pageLink` 区块；返回 `null` → 段落“文字” |
| 单独一行 `[文字](其他文件路径)` | `resolveAsset` → 文件区块；`null` → 段落 |
| `<aside>` … `</aside>` | 标注（`callout`）：第一个字符是 emoji 时作为图标（`props.icon`），其余文字是内容 |
| `$$` 开始、`$$` 结束 | 公式区块（`equation`，内容为中间的文字） |
| 连续的 `\| … \|` 行，第二行是 `\| --- \| … \|` | 表格（`table`，`content: { type: "tableContent", rows: [{ cells: [...] }] }`，第一行是表头 `headerRows: 1`） |
| `<details><summary>标题</summary>` … `</details>` | 折叠列表，中间的内容是子区块 |

行内新增：`~~删除线~~` → `strike` 样式；`$公式$` → `inlineEquation`（WP-14）；`[文字](路径.md)` → `options.resolvePage` 有结果时为页面提及，否则为普通文字；`[文字](http…)` → 链接（`{ type: "link", href, content: [...] }`）。`options` 不传时，链接一律为普通文字，图片为“[图片：说明]”段落（快速记录就是这样用的）。

### 2.3 导入流程（`src/import/notionImport.js`）

```js
export async function readNotionExport(zipBytes)          // → { entries: Map(path → Uint8Array), problems: [] }（展开分卷、去掉公共顶层目录）
export function planNotionImport(entries)                  // → { pages, databases, assets, unrecognized, counts, errors }（只分析，不改工作区；errors 不为空时不能导入）
export async function buildNotionImport(workspace, plan, { now, idFactory, uploadAttachment, folderName })
  // → { workspace, rootFolderId, report }；uploadAttachment(name, bytes, mime) → Promise<{ url }>
```

- `planNotionImport`：建立页面树、数据库（列、行、记录页面的对应关系）、附件清单（被引用的文件路径、大小）、无法识别清单；`counts = { pages, databases, records, attachments, attachmentBytes }`（`pages` 不含记录页面）。
- `buildNotionImport`：
  1. 新建顶层文件夹 `从 Notion 导入 YYYY-MM-DD`（本地日期；同名已存在时加 ` (2)`、` (3)`…），`sortIndex` 排在现有顶层文件夹之后；
  2. 先上传全部被引用的附件（`uploadAttachment`），得到“路径 → url”；
  3. 建页面：根目录的 `.md` 是这个文件夹里的顶层页面，子页面 `parentPageId` 指向父页面，全部 `folderId` 为新文件夹；正文用 2.2 节转换，`resolvePage` 用“路径 → 新页面 ID”的表，`resolveAsset` 用上一步的表；
  4. 建数据库：每个 CSV 一个整页数据库页面（`pageType: "database"`，标题为 CSV 名称里的标题），放在 CSV 所在位置（父页面的子页面，或文件夹顶层）；数据源属性按 2.1 节推断；每行一条记录 + 记录页面（记录页面正文来自对应的 `.md`，没有就为空段落）；
  5. 页面正文里指向 CSV 的链接区块指向这个数据库页面；
  6. 全部新实体在**一个**新工作区对象里返回；所有 ID 用 `idFactory` 新生成；现有实体的对象引用一个都不变；
  7. `report = { pages, databases, records, attachments, skipped: [{ path, reason }], unrecognizedValues }`。
- **限制**：压缩包超过 1 GB 时拒绝（“文件太大，请在 Notion 里分批导出”）；单个附件超过 1 GB 跳过并计入 `skipped`。

### 2.4 导入界面（`NotionImportDialog.jsx`）

- 入口：工作区菜单“从 Notion 导入…”（放在“导入 CSV…”之后）。
- 第一步：说明文字“在 Notion 里打开“设置 → 导出”（或页面菜单的“导出”），导出格式选“Markdown 和 CSV”，勾选“包含子页面”和“为子页面创建文件夹”，然后把下载的 zip 文件选到这里。”；文件选择 `<input type="file" accept=".zip" aria-label="选择 Notion 导出文件">`。
- 第二步（预览）：`counts` 的 5 个数字（页面、数据库、记录、附件个数、附件总大小）；“无法识别”清单（默认收起，标题“无法识别的文件（N）”）；按钮“导入”。
- 导入中显示“正在导入…”（按钮禁用）；完成后显示报告：“已导入 N 个页面、M 个数据库（K 条记录）、A 个附件”，有跳过的再列出；按钮“打开导入的文件夹”（选中新文件夹）和“关闭”。
- 失败（压缩包损坏等）：显示“无法读取这个文件：<原因>”，不修改任何数据。
- 样式见 2.7 节。

### 2.5 Markdown 全量导出（`src/export/markdownExport.js`）

```js
export function buildMarkdownExport(workspace, { now, appVersion }) // → { files: [{ path, text }], assets: [{ path, sha256?, url }], counts }
```

- **范围**：不在回收站的文件夹、页面、数据库和记录；不导出密钥库、回收站、页面版本、评论、模板。
- **目录结构**（根目录就是导出的文件夹）：
  - `README.md`：导出时间、Life Atlas 版本、页面/数据库/记录/附件数量、目录结构说明、“评论、页面历史、密钥库不在这里；完整数据请用 .lifeatlas 备份”。
  - 文件夹 → 目录（空文件夹不出现）；文件夹里的普通页面 → `<标题>.md`（数据库记录页面不在这里出现，只出现在它所属数据库的目录里）；页面有子页面或拥有行内数据库时 → 再建一个同名目录 `<标题>/` 放它们；
  - 整页数据库页面 `P` → `P.md`（页面正文）、`P.csv`、目录 `P/`（每条记录一个 `<记录标题>.md`）；行内数据库（属于某个页面）→ 放在所属页面的目录里：`<数据库名>.csv` 和 `<数据库名>/`；
  - 附件 → `_assets/<sha256 前 12 位>-<safeFileName(原文件名)>`（浏览器模式的附件没有 sha256，用附件 ID 代替前 12 位）。原文件名必须经过 `safeFileName`：原名里可能有 `:`、`?` 等字符或超过 100 个字符，而 2.6 节的写出会拒绝这样的路径、整个导出失败。
- **文件名**：`safeFileName(title)`：`\ / : * ? " < > |` 和控制字符换成 `_`，去掉末尾的点和空格，空的用“无标题”，Windows 保留名（`CON`、`PRN`、`AUX`、`NUL`、`COM1`–`COM9`、`LPT1`–`LPT9`，不区分大小写）后面加 `_`，最长 80 个字符。同一目录里重名（不区分大小写）时追加 ` (2)`、` (3)`：`dedupeName("笔记", ".md", used)` 依次得到 `笔记.md`、`笔记 (2).md`、`笔记 (3).md`，`.csv` 与 `.md` 互不影响。已知答案：`safeFileName('a/b:c*?"<>|')` → `a_b_c______`；`safeFileName("con")` → `con_`；`safeFileName("结尾有点. ")` → `结尾有点`；`safeFileName("   ")` → `无标题`。
- **每个 `.md` 的开头**是 YAML 头：

  ```yaml
  ---
  id: <页面 ID>
  created: <createdAt>
  updated: <updatedAt>
  icon: <emoji；图标名写成 icon:名称；上传的图片图标不写>
  tags: [标签1, 标签2]        # 没有标签时不写这一行
  properties:                 # 只有记录页面才有；值是 formatPropertyValue 的文字
    状态: 进行中
  ---
  ```

  YAML 里的字符串一律用双引号，`"` 和 `\` 转义。
- **正文**：`pageToMarkdown(page, { includeTitle: true, workspace, links })` 新增可选参数 `links = { pagePath(pageId), assetPath(url), databasePath(sourceId) }`（都返回从当前文件出发的相对路径或 `null`）。不传 `links` 时输出与现在完全相同（现有测试依赖它）。传了 `links` 时新增：页面提及 → `[标题](相对路径.md)`；页面链接块 → 单独一行 `[→ 标题](相对路径.md)`；图片 → `![名称](相对路径)`；文件/视频/音频/PDF → `[名称](相对路径)`；标注 → `> 图标 文字`；折叠列表和折叠标题 → `<details><summary>标题</summary>` + 空行 + 子内容 + 空行 + `</details>`；多列 → 按列依次输出，每列前加 `<!-- 第 N 栏 -->`；选项卡 → 每个标签输出 `**标签名**` 再输出内容；数据库区块 → `[数据库：名称](相对路径.csv)`；同步区块输出它的内容（`pageSemanticDocument` 已经展开）；目录、路径栏不输出；远程地址保持原样。链接路径里的空格写成 `%20`，其余字符原样。
- **CSV**：列 = 数据源的全部属性（名称属性在第一列，其余按属性顺序）；值 = `formatPropertyValue` 的文字；用 WP-15 的转义规则（含逗号、引号、换行的值加引号）；UTF-8 带 BOM（Excel 能直接打开中文）；行按视图第一个表格视图的排序，没有就按记录创建时间。

### 2.6 导出的写出方式

- **桌面版**：`window.lifeAtlas.exports.writeMarkdownFolder({ files, assets })`（11 第 1 节）。主进程：弹“选择文件夹”→ 在选中的文件夹里新建子目录 `Life Atlas 导出 YYYY-MM-DD HHmm`（已存在时加 ` (2)`）→ 校验每个 `path`（相对路径、用 `/` 分隔、每段不为空且不是 `.` 或 `..`、不含 `\ : * ? " < > |` 和控制字符、每段不超过 100 个字符）→ 写入 `text`（UTF-8）→ 按 `sha256` 从 `assets\` 复制附件 → 返回 `{ folder, fileCount }`。任一路径不合法 → `E_INVALID_ARGUMENT`，不写任何文件。
- **浏览器版**：用 JSZip（`createFolders: false`）打包下载 `Life Atlas 导出 YYYY-MM-DD.zip`；附件用 `readAttachmentBlob` 读取。
- **找不到的附件**（两种模式都一样）：浏览器版 `readAttachmentBlob` 返回空或抛错、桌面版 `assets\` 里没有对应的文件时，跳过这个附件，导出照常完成；完成提示后面加一句“（N 个附件找不到，已跳过）”，桌面版的 `writeMarkdownFolder` 返回值增加 `missingAssets: [path…]`。浏览器场景里附件二进制本来就不存在（`10-测试夹具规格.md` 第 6 节第 4 条），所以检查 4 会走到这条规则。
- **入口**：工作区菜单“导出为 Markdown…”（放在“从 Notion 导入…”之后）→ 对话框显示将导出的数量 → “导出”→ 完成后显示“已导出到 <文件夹>”（桌面）或开始下载（浏览器）。

### 2.7 墨白样式（规定）

- **参照画面**：Notion 导入的预览 `design/mobai/shots/import-light.png`、`import-dark.png`（原型 `design/mobai/prototype/index.html#view=import&mode=light`，夜间把 `light` 换成 `dark`）。原型**只看不改**。
- **样式文件**：新文件 `src/ui/themes/mobai/import-export.css`，在 `src/ui/themes/mobai/index.css` 末尾追加一行 `@import "./import-export.css";`（只能追加，前面的行不动）。导入对话框照原型 `b-more.css` 的 “notion import” 一段（`.import`、`.im-*`）改写：每个选择器前加 `:root[data-style="mobai"] `，变量按 12 第 0 节的对应表换名，只用 `--mb-*` 变量；旧 CSS 里不写颜色（K13）。外壳沿用产品的 `.modal-backdrop` + `.ui-dialog`（WP-20 已写好遮罩、12 px 圆角、`--mb-dlg` 阴影，`.ui-dialog h2` 标题是 16 px 600 `--mb-sans`）。
- **导入对话框**：宽 740 px。
  - 标题栏是“从 Notion 导入”（16 px 600），标题右边隔 24 px 是 3 个编号步骤“1 选择文件”“2 预览”“3 导入”（原型 `.steps`、`.step`：13 px，步骤之间 14 px；当前步骤 500 `--mb-ink`，下面一条 2 px `--mb-ink` 线：`box-shadow: inset 0 -2px 0 var(--mb-ink)`、`padding-bottom: 3px`；做完的步骤 `--mb-muted`；还没到的步骤 `--mb-faint`）。
  - 正文内边距 22 px 24 px 20 px（原型 `.im-body`）。第一步的说明 14 px `--mb-ink-2`，Notion 的原词（“Markdown 和 CSV”“包含子页面”“为子页面创建文件夹”）加粗。
  - 预览页：选中的文件一行（原型 `.im-file`：`--mb-side` 底、圆角 8 px、内边距 10 px 12 px、14 px；左边一个文件图标，文件名 500 `--mb-ink`，右边是大小，13 px `--mb-muted`）；下面隔 18 px 是一张细线卡片，放 5 个数字（原型 `.im-counts`：5 格等宽，一圈 1 px `--mb-line`、圆角 8 px，格与格之间 1 px `--mb-line` 竖线，每格内边距 14 px 16 px 12 px；数字是 `--mb-sans` 28 px 600 `--mb-ink`、`font-variant-numeric: tabular-nums`，附件总大小的单位 13 px 400 `--mb-muted`、离数字 3 px；数字下面隔 8 px 是名称，13 px `--mb-muted`）；再下面隔 18 px 是“无法识别的文件（N）”折叠块（`<details>`，原型 `.im-unknown`：14 px `--mb-ink`，标题前面一个向右的箭头图标，不显示浏览器自带的三角；展开后的清单 13 px `--mb-muted`、左边空 22 px）；再下面隔 14 px 是一行 13 px `--mb-muted` 的说明“导入的内容会放进新文件夹“从 Notion 导入 <今天>”，现有页面不会有任何变化。”；主按钮“导入”在右下角。
  - 完成后的报告同样用这张细线卡片列出数字。
- 失败信息、HTML 包的提示用危险色文字。
- **Markdown 导出对话框**没有单独的效果图：和导入对话框同样的外壳、宽度、标题栏和按钮位置，将导出的数量用同样的细线卡片（一个数字一格）。

## 3. 范围

### 不做

- 连接 Notion API；HTML 格式导出包；把 Markdown 文件夹再导回。
- 导入 Notion 的评论、页面权限、成员；导入后保持 Notion 的数据库视图配置（只建一个表格视图）。

## 4. 执行步骤

### 步骤 0：开工准备【停止点】

按执行手册 3.1 节开工（分支 `wp/18-import-export`），生成报告骨架，跑基线 `npm test` 与 `npm run test:parity:browser`。在报告第 1 节回答理解题：

1. 导入一个 Notion 导出包后，工作区里原来的页面会不会有任何变化？导入的内容放在哪里？
2. `任务库 xxx.csv` 和 `任务库 xxx_all.csv` 都存在时用哪个？为什么？
3. Markdown 导出里，一条数据库记录的属性值写在哪两个地方？
4. 为什么导出的 CSV 要带 BOM？

提交 `WP-18: step 0 understanding`，运行 `node docs/blueprint/tools/wp-check.mjs WP-18 --until 0`，退出码 0 → **停止**。

### 步骤 1：测试夹具

新建 `tests/fixtures/notion-export.mjs`，导出 `notionExportFiles()`（返回 `{ 路径: 字符串或 Uint8Array }`）和 `async buildNotionExportZip({ split = true } = {})`（用 JSZip 生成：`split` 为真时外层 zip 里放两个分卷 `Export-test-Part-1.zip`、`Export-test-Part-2.zip`，否则直接放文件；全部放在顶层目录 `Export-test/` 下）。内容（照抄，`I0 = "0123456789abcdef0123456789abcdef"`、`I1 = "1111111111111111111111111111111a"`、`I2 = "2222222222222222222222222222222b"`、`I3 = "3333333333333333333333333333333c"`，行页面编号为 `"4444444444444444444444444444440" + 序号`）：

- 分卷 1：
  - `项目总览 ${I0}.md`：`# 项目总览` / 空行 / `欢迎来到项目。` / 空行 / `## 本周` / 空行 / `- [ ] 写周报` / `- [x] 开会` / 空行 / `> 一句引用` / 空行 / 三个反引号加 `js` / `const x = 1;` / 三个反引号 / 空行 / `![架构图](项目总览%20${I0}/架构图.png)` / 空行 / `[会议记录](项目总览%20${I0}/会议记录%20${I1}.md)` / 空行 / `<aside>` / `💡 提示：这是一个标注` / `</aside>` / 空行 / `$$` / `E = mc^2` / `$$` / 空行 / `| 名称 | 数量 |` / `| --- | --- |` / `| 苹果 | 3 |` / 空行 / `[任务库](项目总览%20${I0}/任务库%20${I2}.csv)`（每个“/”是换行）；
  - `项目总览 ${I0}/架构图.png`：`new Uint8Array(Buffer.from(PNG_1X1_BASE64, "base64"))`（`PNG_1X1_BASE64` 从 `tests/fixtures/full-workspace.mjs` 导入，解码后 70 字节）；
  - `项目总览 ${I0}/会议记录 ${I1}.md`：`# 会议记录` / 空行 / `回到[项目总览](../项目总览%20${I0}.md)。` / 空行 / `- 第一条` / `    - 子条目` / 空行 / `[说明文件](会议记录%20${I1}/说明.pdf)`（Notion 把页面自己的附件放在与页面同名的目录里）；
  - `项目总览 ${I0}/会议记录 ${I1}/说明.pdf`：`fixtureBytes("notion-pdf", 2048)`；
  - `项目总览 ${I0}/任务库 ${I2}.csv`：表头 `名称,状态,截止,标签,完成` 加前 4 行；
  - `项目总览 ${I0}/任务库 ${I2}_all.csv`：表头加全部 5 行：`任务一,进行中,"September 19, 2026","前端, 后端",Yes`、`任务二,完成,"September 20, 2026 10:00 AM",前端,No`、`任务三,进行中,,后端,No`、`任务四,完成,"September 21, 2026 → September 23, 2026",,Yes`、`任务五,进行中,"Sep 25, 2026",前端,No`；
  - `项目总览 ${I0}/任务库 ${I2}/任务一 44444444444444444444444444444401.md` … 共 5 个：`# 任务N` / 空行 / `状态: …` / `截止: …` / 空行 / `任务N的正文。`；
  - `readme.txt`：`这是一个不认识的文件`。
- 分卷 2：
  - `个人笔记 ${I3}.md`：`# 个人笔记` / 空行 / `**重要**：记得~~买菜~~。` / 空行 / `![照片](个人笔记%20${I3}/照片.jpg)`；
  - `个人笔记 ${I3}/照片.jpg`：`fixtureBytes("notion-jpg", 4096)`。
- 再导出 `async buildHtmlExportZip()`：只有一个 `页面 ${I0}.html`（内容 `<html><body>页面</body></html>`）。

提交 `WP-18: notion export fixture`。

### 步骤 2：名称与日期工具

按 2.1、2.5 节实现 `notionNames.js`（`parseNotionName`、`parseNotionDate`、`splitNotionMulti`、`looksMultiSelect`）和 `safeFileName`、`dedupeName`（放 `src/export/markdownExport.js`）。新建 `tests/notion-names.test.mjs`：

- `notion file names split title id and extension`（2.1 节的 4 个例子）
- `notion dates parse the known formats`（2.1 节日期表的全部行）
- `multi select values split and dedupe`
- `file names are made safe and unique`（2.5 节的 4 个例子和去重例子）

提交 `WP-18: notion names and safe file names`。

### 步骤 3：扩展 Markdown 转区块

按 2.2 节实现。在 `tests/markdown-blocks.test.mjs` 末尾**新增**用例（原有用例一个字都不改）：

- `nested list items become children`
- `tables become table blocks with a header row`
- `asides become callouts with their emoji icon`
- `equations details dividers and level four headings are parsed`
- `images and page links use the resolvers and fall back to text`
- `inline strike equations and links are styled`

提交 `WP-18: richer markdown to blocks`。

### 步骤 4：导入的读取与分析

按 2.3 节实现 `readNotionExport` 和 `planNotionImport`。新建 `tests/notion-import.test.mjs`，本步写这几个用例：

- `split exports are merged and the top folder is removed`：`buildNotionExportZip({ split: true })` 与 `{ split: false }` 读出的路径集合相同，都不以 `Export-test/` 开头。
- `the plan counts pages databases records and attachments`：`counts` 为 `{ pages: 3, databases: 1, records: 5, attachments: 3, attachmentBytes: 70 + 2048 + 4096 }`（`PNG_1X1` 是 70 字节）。
- `unrecognized files are listed`：清单里有 `readme.txt`。
- `html exports are refused with guidance`：`buildHtmlExportZip()` 的分析结果 `errors` 有一条，信息以“这是 HTML 格式的导出包”开头。

提交 `WP-18: notion export reading and planning`。

### 步骤 5：生成导入的工作区

按 2.3 节实现 `buildNotionImport`。在 `tests/notion-import.test.mjs` 里继续加：

- `imported pages keep the hierarchy and titles`：新文件夹名为 `从 Notion 导入 <今天>`；有 3 个普通页面：项目总览、个人笔记（顶层）、会议记录（`parentPageId` 是项目总览）；标题没有编号。
- `page content becomes blocks`：项目总览的区块类型依次包含 `paragraph`、`heading`（level 2）、2 个 `checkListItem`（第二个 `checked: true`）、`quote`、`codeBlock`（`language: "js"`）、`image`（`url` 是上传后的地址）、`pageLink`（指向会议记录）、`callout`（`icon: "💡"`）、`equation`、`table`、`pageLink`（指向任务库数据库页面）；会议记录里有指向项目总览的 `pageMention`、带一个子区块的 `bulletListItem`、`file` 区块。
- `the database uses the all csv and inferred types`：数据源有 5 条记录；属性类型：名称 `title`、状态 `select`（选项“进行中”“完成”）、截止 `date`、标签 `multi_select`（选项“前端”“后端”）、完成 `checkbox`；任务二的截止 `start === "2026-09-20T10:00"`，任务四的截止有 `end === "2026-09-23"`；每条记录页面的正文是“任务N的正文。”。
- `existing entities are untouched`：导入前后，满配夹具的每个集合里原有的实体逐个 `===`（对象引用相同）；`checkWorkspaceIntegrity` 没有 error。
- `a second import gets a numbered folder name`：同一天导入两次，第二个文件夹名以 ` (2)` 结尾。

提交 `WP-18: notion import build`。

### 步骤 6：导入界面【停止点】

按 2.4、2.7 节实现对话框和入口；工作区菜单的期望列表变了，按规定修改 `tests/browser/wp12-navigation.mjs` 检查 5 的期望列表（在“导入 CSV…”之后加“从 Notion 导入…”，执行手册 4.5 节第 2 条，报告第 4 节写明）。

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-18/step6-npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-18/step6-browser.log npm run test:parity:browser
```

都通过后，报告第 0 节步骤 1–6 标为“完成”，提交 `WP-18: notion import dialog`，运行 `node docs/blueprint/tools/wp-check.mjs WP-18 --until 6`，退出码 0 → **停止**。

### 步骤 7：Markdown 导出的生成

按 2.5 节实现 `buildMarkdownExport` 和 `pageToMarkdown` 的 `links` 参数。新建 `tests/markdown-export.test.mjs`（满配夹具 `upgradeWorkspace(fullWorkspace())`）：

- `the export tree follows folders pages and databases`：`files` 的路径里有 `README.md`、`A 项目/A 概览.md`、`A 项目/A 概览/A 子页面.md`、`A 项目/B 资料/B 笔记.md`、`A 项目/B 资料/B 笔记/行内任务.csv`、`A 项目/B 资料/B 笔记/行内任务/任务一.md`、`A 项目/B 资料/C 细节/C 深层.md`、`Z 其他/Z 目标页.md`、`Z 其他/整页项目库.md`、`Z 其他/整页项目库.csv`、`Z 其他/整页项目库/项目甲.md`；没有“B 单独删除的页”；没有任何路径以 `vault` 开头。
- `front matter and relative links are correct`：`A 概览.md` 以 `---\nid: "p-a1"` 开头；正文里有 `[Z 目标页](../Z%20其他/Z%20目标页.md)` 和 `[→ C 深层](B%20资料/C%20细节/C%20深层.md)`（相对 `A 项目/` 目录；以实际计算的相对路径为准，但必须能从这个文件找到目标文件——测试里用 `path.posix.join(path.posix.dirname(当前文件), decodeURIComponent(链接))` 验证目标在 `files` 里）。
- `database csv files carry every property`：`整页项目库.csv` 第一行（去掉 BOM）是 `名称,评分,任务,任务数`；项目甲那一行包含 `5` 和 `2`。
- `attachments are listed under assets`：`assets` 里有 `att-img` 对应的条目，路径以 `_assets/` 开头；`B 笔记.md` 里的图片链接指向它。
- `the vault trash versions and comments are not exported`：`files` 的全部文字里没有“早就单独删除了”“第一条评论”，也没有任何密钥库的明文标记（`tools/scan-plaintext.mjs` 的标记列表，0 命中）。
- `exporting without links keeps the old single page output`：对 `A 概览` 调用不带 `links` 的 `pageToMarkdown`，结果与本 WP 之前（`main` 分支上的实现）相同——把旧实现复制一份到测试里作为参照。

提交 `WP-18: markdown export build`。

### 步骤 8：Markdown 导出的写出与界面

按 2.6 节实现主进程 `exports.writeMarkdownFolder`、preload 函数、浏览器下载和对话框（样式按 2.7 节）；工作区菜单再加“导出为 Markdown…”（同样修改 `wp12-navigation` 检查 5 的期望列表）。新建 `tests/markdown-export-paths.test.mjs`（直接测主进程的路径校验函数，不需要 Electron）：

- `export paths must stay inside the folder`：`../a.md`、`/a.md`、`a\b.md`、`a/./b.md`、`a/:b.md`、空段 `a//b.md` 全部不合法；`A 项目/A 概览.md`、`_assets/0123456789ab-图.png` 合法。

提交 `WP-18: markdown export writing`。

### 步骤 9：浏览器场景

新建 `tests/browser/wp18-import-export.mjs`（种子：满配夹具；`browserScenario` 的第三个参数加 `viewport: { width: 1440, height: 900 }`；下面说的“截图 `x`”一律写成 WP-12 的 `await shootBothModes(page, screenshot, "x")`，白天、夜间各一张）。检查项（标题照抄）：

1. `A notion export is previewed and imported`：工作区菜单“从 Notion 导入…”→ `setInputFiles` 选 `buildNotionExportZip()` 生成的文件（`name: "notion.zip"`）→ 预览显示 3 个页面、1 个数据库、5 条记录、3 个附件 → 截图 `import`（加 `{ keepVisible: ".ui-dialog" }`，和参照图同名）→ “导入”→ 显示“已导入 3 个页面、1 个数据库（5 条记录）、3 个附件”→ 侧栏出现“从 Notion 导入 <今天>”。
2. `Imported content looks right`：打开“项目总览”→ 有标注、公式（`.katex`）、表格、代码块、图片；点“会议记录”页面链接 → 打开会议记录；打开任务库 → 5 行，“标签”列有“前端”“后端”标签；截图 `notion-imported`。
3. `Html exports are refused`：选 `buildHtmlExportZip()` → 显示“这是 HTML 格式的导出包…”，没有“导入”按钮。
4. `The workspace exports to a markdown zip`：工作区菜单“导出为 Markdown…”→“导出”→ 等待下载（`page.waitForEvent("download")`）→ 用 JSZip 打开下载的文件 → 有 `README.md`、`A 项目/A 概览.md`；`A 概览.md` 的文字里有 `id: "p-a1"`；截图 `markdown-export`（对话框）。

加入场景列表，单独运行，日志 `.qa/WP-18/browser-wp18.log`。通过后生成对照图：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-18/compare.log node docs/blueprint/tools/compare-shots.mjs docs/blueprint/design/mobai/shots .qa --prefix wp18-import-export- --only import --out .qa/WP-18/compare
```

退出码 0。背后的页面和文件名与原型不同，差异占比只供参考；把 `summary.md` 复制进报告第 3 节，并写出你看到的不同之处（布局、字体、颜色、线条）。提交 `WP-18: import export browser scenario`。

### 步骤 10：桌面端到端

新建 `tests/desktop/import-export.e2e.mjs`：

- `notion import stores attachments in the asset store`：种子用 `seedDesktopFullWorkspace(dataRoot)`（WP-05）→ 导入 `buildNotionExportZip()` → 夹具里 3 个附件（`架构图.png`、`说明.pdf`、`照片.jpg`）的 SHA-256 在数据目录 `assets\<前两位>\<sha256>` 下都存在，`assets` 表里也各有一行。**按哈希断言，不要按文件数量断言**：附件按内容去重，`架构图.png` 和满配夹具的 `att-img` 是同样的 70 个字节，所以文件总数只多 2 个。关闭重启后“项目总览”的图片仍能显示（`life-asset://` 地址，`naturalWidth > 0`）。
- `markdown export writes a readable folder`：`queueDialogResponse(handle, "showOpenDialog", [临时目录])` →“导出为 Markdown…”→“导出”→ 临时目录下有 `Life Atlas 导出 …` 子目录，里面的文件数等于对话框显示的数量；`_assets` 里的图片字节与原附件 SHA-256 相同；把 `A 项目/A 概览.md` 和 `Z 其他/整页项目库.csv` 的前 20 行复制进报告第 3 节（AC-18-6 的证据）。

运行：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-18/build.log npm run build
node docs/blueprint/tools/run-logged.mjs .qa/WP-18/desktop-build-test.log npm run desktop:build:test
node docs/blueprint/tools/run-logged.mjs .qa/WP-18/desktop-e2e.log npm run test:e2e:desktop
```

全部通过后提交 `WP-18: import export desktop tests`。

### 步骤 11：确认没有新写死的颜色

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-18/theme-tokens-step11.log node docs/blueprint/tools/theme-tokens.mjs --report .qa/WP-18/theme-tokens-step11.md
```

期望 `replaced=0`、`leftovers=0`（工具不检查 `src/ui/themes/`，`import-export.css` 不算）。不为 0 说明本 WP 在旧 CSS 里写了颜色：打开报告看是哪几行，把这些规则移到 `import-export.css` 并改用 `--mb-*` 变量（**不要**用 `--write`），重新运行直到为 0，提交 `WP-18: move new colors into the theme`；为 0 时本步不提交。

### 步骤 12：收尾【停止点】

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-18/npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-18/browser-all.log npm run test:parity:browser
```

填完报告；第 0 节全部“完成”；提交 `WP-18: complete report`；运行 `node docs/blueprint/tools/wp-check.mjs WP-18 --browser --desktop`，退出码 0 或 2 → 停止。

## 5. 验收标准

| 编号 | 标准 | 证据 |
| --- | --- | --- |
| AC-18-1 | 导入夹具后：页面层级、标题（无编号）、正文区块、数据库属性类型与 5 行数据、图片和文件、页面互链全部正确 | `tests/notion-import.test.mjs`；场景检查 1、2 |
| AC-18-2 | 分卷被合并；HTML 格式包被识别并提示；无法识别的文件被列出 | `tests/notion-import.test.mjs`；场景检查 3 |
| AC-18-3 | 导入不改动任何现有实体（对象引用相同）；`checkWorkspaceIntegrity` 没有 error；第二次导入得到带编号的新文件夹 | `tests/notion-import.test.mjs` |
| AC-18-4 | 名称、日期、文件名的已知答案全部通过；Markdown 转区块的新写法都有测试，WP-13 的原有测试仍然通过 | `tests/notion-names.test.mjs`；`tests/markdown-blocks.test.mjs` |
| AC-18-5 | Markdown 导出：目录结构、文件名去重、YAML 头、相对链接、附件、CSV 内容逐项正确；回收站、评论、密钥库不出现；不带 `links` 时单页导出输出不变 | `tests/markdown-export.test.mjs` |
| AC-18-6 | 导出的 Markdown 用普通编辑器可读（报告附 2 个导出文件的原文片段）；桌面版写出的文件和附件完整 | 报告第 3 节；「markdown export writes a readable folder」 |
| AC-18-7 | 导出路径校验拒绝所有越界写法 | `tests/markdown-export-paths.test.mjs` |
| AC-18-8 | 视觉：两个对话框照墨白做（2.7 节）；截图：Notion 导入预览、导入后的页面、Markdown 导出对话框，白天和夜间各一张；导入预览与参照图并排对照；旧 CSS 里没有新写死的颜色 | `.qa/wp18-import-export-*.png`；`.qa/WP-18/compare/summary.md`；报告第 3 节；`.qa/WP-18/theme-tokens-step11.log` |
| AC-18-9 | G1–G9 | `.qa/WP-18/wp-check.md` |

## 6. 卡点处理

| 情况 | 做法 |
| --- | --- |
| 夹具里的某种写法在 2.2 节没有规定 | 按最接近的规则处理并写进报告第 5 节；不要扩大到 2.2 节以外的语法 |
| 大附件导致浏览器内存不足 | 浏览器模式的导入限制在 200 MB 以内（超过时提示“请使用桌面版导入”）；桌面版仍按 1 GB |
| 相对链接的计算对不上 | 用 `path.posix.relative(path.posix.dirname(当前文件), 目标文件)`，再把每一段 `encodeURIComponent` 后把 `%2F` 换回 `/`——注意这会把中文也编码；本 WP 规定只把空格编码成 `%20`，其他字符原样（2.5 节），测试里按同样的规则解码 |
| `checkWorkspaceIntegrity` 报导入后的数据有错 | 先看是哪个实体缺字段（页面、记录页面的默认字段要和 `createPage`、`makeDatabaseItemPage` 一致）；不要改完整性检查器 |
