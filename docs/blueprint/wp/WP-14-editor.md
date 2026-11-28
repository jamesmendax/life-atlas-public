# WP-14 编辑器补齐

- 规模：L · 前置：WP-13 · 分支：`wp/14-editor`
- 停止点：步骤 0（理解确认）、步骤 6（斜杠菜单、代码块、公式、导出完成）、步骤 15（收尾）
- 必读：`01-需求与范围.md` 第 3.1、3.2 节；`09-执行手册.md`（特别是 4.5 节）；源码 `src/editor/lifeAtlasSchema.jsx`（`lifeAtlasSchema`、`getLifeAtlasSlashMenuItems`、`filterLifeAtlasSlashMenuItems`、`EquationBlock`、`PageLinkBlock`）、`src/editor/PageEditor.jsx`、`src/editor/Mentions.jsx`、`src/editor/LifeAtlasSideMenuController.jsx`、`src/domain/blockDocument.js`（`cloneBlockDocument`）、`src/domain/pageExport.js`（`blockMarkdown`、`blockHtml`、`inlineMarkdown`、`inlineHtml`）、`tests/editor-blocks.test.mjs`；`12-视觉规范-墨白.md` 第 0、3、4、6、7 节和 2.12 节列出的参照画面；`design/mobai/theme/editor.css`（WP-20 已经给编辑器写好的样式）；WP-12 加在 `tests/browser/harness.mjs` 里的 `shootBothModes`、WP-05 加在 `tests/desktop/helpers.mjs` 里的 `shootWindowBothModes`

## 0. 一页纸

- **要做到**：编辑器的使用方式接近 Notion：斜杠菜单的分组和中文名称与 Notion 一致；数学公式真正排版；代码块有语法高亮和复制按钮；`[[` 与 `+` 链接或新建页面；区块菜单能复制、移动到其他页面、复制区块链接；`Ctrl+D` 复制区块；`Ctrl+F` 页内查找；`Ctrl+/` 快捷键面板；粘贴的远程图片和远程媒体一律不加载；表格支持表头与单元格颜色。
- **交付物**：依赖 `katex@0.19.1`、`@blocknote/code-block@0.54.2`；新文件 `src/editor/slashMenuCatalog.js`、`links.js`、`remoteMedia.js`、`findInPage.js`、`FindBar.jsx`、`shortcuts.js`、`ShortcutPanel.jsx`、`CodeBlockCopyButton.jsx`、`LifeAtlasDragHandleMenu.jsx`、`MoveBlockDialog.jsx`、`InlineEquation.jsx`、`src/domain/blockMoves.js`；改造后的 `lifeAtlasSchema.jsx`、`PageEditor.jsx`、`pageExport.js`；8 个单元测试文件；浏览器场景 `wp14-editor`；桌面端到端 `tests/desktop/editor.e2e.mjs`；墨白样式 `src/ui/themes/mobai/editor-tools.css`；白天和夜间的截图与对照图。
- **绝对不要**：替换 BlockNote 或修改 `node_modules`；复制 Notion 的代码（只参考界面文字与行为）；引入第 0 节以外的依赖（拼音搜索只用 2.1 节写好的别名，不加拼音库）；做按钮块、Mermaid、网页书签、嵌入、评论界面改版、多人光标；用 Electron 的 `webContents.findInPage`（原因见第 1 节）。
- **什么时候停**：步骤 0 后停；步骤 6 后停；步骤 15 的 wp-check 退出码为 0 或 2 时停。

## 1. 已知事实（总设计师 2026-11-01 在本项目的 `node_modules` 和临时目录里逐条核对）

| 事实 | 对你的影响 |
| --- | --- |
| `@blocknote/code-block@0.54.2`（MPL-2.0）导出 `syntaxHighlighter`（放进 `useCreateBlockNote` 的 `extensions`）和 `codeBlockOptions`（`defaultLanguage: "javascript"`、`supportedLanguages` 共 48 种，含 `text`）；高亮用 Shiki 的 JavaScript 正则引擎和预编译语言包，不用 WASM、不用 `eval` | 步骤 3 照 2.3 节做；CSP 不需要任何改动 |
| `supportedLanguages` 包含 javascript、typescript、python、json、shellscript、sql、rust、java，**不包含 go** | AC-14-4 只要求这 8 种 |
| `@blocknote/core` 的 `createCodeBlockSpec(options)` 接受 `defaultLanguage`、`supportedLanguages`、`indentLineWithTab`；有多于 1 种语言时，代码块顶部自动出现原生 `<select>` 语言选择框 | 不需要自己做语言选择 |
| BlockNote 默认的 `heading` 已经是 1–6 级、`allowToggleHeadings` 默认 `true`（有 `isToggleable` 属性）；默认斜杠菜单里有 key 为 `toggle_heading`、`toggle_heading_2`、`toggle_heading_3` 的折叠标题项 | **不要**替换 `heading` 的 spec；折叠标题 4 用 2.2 节的自定义动作 |
| `getDefaultReactSlashMenuItems(editor)` 返回的每一项都有 `key`（`paragraph`、`check_list`、`heading`、`heading_2`、`heading_3`、`heading_4`、`heading_5`、`heading_6`、`toggle_heading`、`toggle_heading_2`、`toggle_heading_3`、`quote`、`toggle_list`、`numbered_list`、`bullet_list`、`code_block`、`divider`、`table`、`image`、`video`、`audio`、`file`、`emoji`）、`icon`、`badge`、`onItemClick` | 2.2 节按 `key` 复用默认项的插入行为和图标 |
| `filterSuggestionItems(items, query)`：标题或任一别名**包含**查询词（不区分大小写）就保留，保持原顺序；在普通 Node 里 `import { filterSuggestionItems } from "@blocknote/core"` 可以直接用 | 单元测试用它验证别名搜索 |
| `SuggestionMenuController` 的 `triggerCharacter` 支持多个字符（例如 `"[["`），多个触发词同时匹配时取最长的；支持 `shouldOpen(tr)`，在插入触发字符**之前**调用，返回 `false` 时不打开 | `[[` 和 `+` 直接用它，不写 ProseMirror 插件 |
| 选中菜单项时 BlockNote 先删除“触发字符 + 查询文字”，再调用该项的 `onItemClick` | 菜单项里不用自己删字符 |
| `editor.getExtension(SuggestionMenu)?.openSuggestionMenu("@", { deleteTriggerCharacter: true, ignoreQueryLength: true })` 可以从代码里打开某个触发词的菜单（`SuggestionMenu` 从 `@blocknote/core/extensions` 导入；默认的“表情”项就是这样打开 `:` 菜单的） | 斜杠菜单“提及”项照这个写法 |
| `BlockNoteView` 默认已经带 `:` 表情选择器（`GridSuggestionMenuController triggerCharacter=":" columns={10} minQueryLength={2}`），表情数据来自本地的 `@emoji-mart/data`（项目已依赖） | 表情**不需要写代码**，只在场景里验证 |
| 编辑器选项 `links.isValidLink(href)` 决定哪些链接能进入文档（粘贴、导入、导出、自动识别）；默认只允许 http/https/ftp/ftps/mailto/tel/callto/sms/cid/xmpp，**`lifeatlas://` 会被丢掉**；文档里写的 `isAllowedUri` 在运行时**没有导出** | 2.6 节自己写 `isAllowedEditorLink` |
| 编辑器选项 `links.onClick(event, editor)`：设置后不再默认 `window.open`，改为调用它 | 2.6 节用它处理区块链接和外部链接 |
| 编辑器选项 `tables: { splitCells, cellBackgroundColor, cellTextColor, headers }`，默认全是 `false`；`headers` 打开后，区块菜单里自动出现“行标题”“列标题” | 2.9 节照做 |
| 编辑器选项 `resolveFileUrl(url) → Promise<string>`：本项目的图片、视频、音频区块用的是 `defaultBlockSpecs` 里 `@blocknote/core` 的实现，设置了 `resolveFileUrl` 时**先等它返回再设置 `src`**。实测（Edge，BlockNote 0.54.2）：打开含 `https://example.com/…` 图片/视频/音频/文件的页面、粘贴含远程 `<img>` 的 HTML，都**没有**任何请求；但**复制**（`Ctrl+A` 再 `Ctrl+C`，或拖动区块）时，BlockNote 生成剪贴板 HTML 会用原地址创建 `<img>`/`<video>`/`<audio>`，浏览器随即请求这些地址 | 2.8 节用它拦下显示时的远程地址；复制时的请求在桌面版由 CSP 挡下（WP-03 第 1 节：只产生控制台 CSP 错误，不进 `webRequest`），第 14 步有专门的用例；浏览器场景里**不要**复制或拖动含远程媒体的区块（浏览器版会真的发请求，harness 把 404 记成错误） |
| 远程视频、音频的占位地址也是 `data:image/svg+xml…`（2.8 节）。工作区 CSP 的 `media-src` 必须包含 `data:`，否则每个这样的区块都会产生一条控制台 CSP 错误（实测）；02 第 7 节的 CSP 已经包含 `data:`（WP-03 照抄） | 不需要改 CSP；如果桌面测试报 “Loading media from 'data:…' violates…”，说明 WP-03 的 CSP 没有照 02 第 7 节写，停下报告 |
| 默认粘贴：`text/plain` 当作 Markdown 解析（`plainTextAsMarkdown` 默认 `true`），`text/html` 转成区块；`<img src>` 变成图片区块 | 粘贴不写代码，只在场景里验证 |
| 区块菜单（拖动手柄菜单）：`<SideMenu dragHandleMenu={组件} />`；组件里用 `<DragHandleMenu>` 包住 `RemoveBlockItem`、`BlockColorsItem`、`TableRowHeaderItem`、`TableColumnHeaderItem` 和自定义项；自定义项写成 `const Components = useComponentsContext(); <Components.Generic.Menu.Item className="bn-menu-item" onClick={…}>文字</Components.Generic.Menu.Item>`；当前区块用 `useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block })` 取得 | 2.6 节照做；这些都从 `@blocknote/react` 导入，`SideMenuExtension` 从 `@blocknote/core/extensions` 导入 |
| `createReactInlineContentSpec` 的 `render` 参数里有 `updateInlineContent(update)` | 行内公式的修改用它 |
| BlockNote 中文字典：文件面板的“嵌入”页签标题 `嵌入`、地址输入框占位文字 `输入图片地址`、按钮 `嵌入图片`/`嵌入视频`/`嵌入音频`/`嵌入文件`；区块菜单 `删除`、`颜色`、`行标题`、`列标题`；侧边按钮 `添加块`、`打开菜单` | 测试里按这些文字找元素 |
| `katex@0.19.1`（MIT）存在；KaTeX 默认 `trust: false`，不会输出可执行的链接或脚本 | 公式用 `dangerouslySetInnerHTML` 显示 KaTeX 输出是安全的 |
| `tests/editor-blocks.test.mjs` 第一个用例检查 `lifeAtlasSchema.jsx` 的源码里包含 `标题 4`、`Callout`、`页面`、`PDF`、`块公式`、`目录`、`面包屑`、`Tabs`、`同步区块`、`数据库 - Inline`、`数据库 - Full page`、`Linked View`、`图表`、`表单`、`Dashboard`，还检查源码里有 `getDefaultReactSlashMenuItems`、`defaultBlockSpecs`、`filterSuggestionItems`、`Array.from({ length: columns }` | 旧标题全部保留为别名；步骤 2 按规定改这个测试的一行 |
| `tests/browser/columns-transform.mjs` 第 81 行用 `/数据库 - Inline/` 在斜杠菜单里找菜单项（这个脚本不在 `core-parity-browser.mjs` 的列表里，平时不运行） | 步骤 2 把它改成 `/数据库 - 行内/` |
| **原有的问题（用户 2026-11-01 报告，总设计师在真实的 Edge 窗口里复现；无头浏览器复现不了）**：斜杠菜单在窗口偏下的位置打开时（例如 900 px 高的窗口里光标在 690 px 处），BlockNote 默认的定位（`autoPlacement` + `size`）先把菜单排在光标上方、高约 650 px，随即挪到光标下方、变矮（189 px）。之后**滚轮和拖滚动条都停在离底部还差“两次高度之差”的地方**：`scrollTop` 停在 2535，最大值是 2997，最后几项永远看不到；`el.scrollTop = el.scrollHeight` 这种代码滚动能到底。窗口高 880、950、1050、1200 px 时都停在同一个 2535。把菜单的 DOM 挪到 `body` 下、切换 `overflow`、加 `will-change`、`contain` 都没用 | 2.2 节最后一段改菜单的定位；步骤 14 用 Electron 的真实窗口验证（用例「slash menu scrolls to the last item anywhere in the window」）。浏览器场景测不出这个问题，不能当证据 |
| Electron 的 `webContents.findInPage` 会把查找框自己输入框里的文字也算作匹配 | 页内查找改用浏览器的 CSS Custom Highlight API（`CSS.highlights`），桌面版和浏览器版同一套代码 |

## 2. 设计要点（规定，照做）

### 2.1 斜杠菜单目录 `src/editor/slashMenuCatalog.js`（新文件，照抄全部内容）

标题与描述参考 Notion 中文界面（`D:\opencode\notion-re\schema\messages.zh-CN.json` 的 `newBlock.*` 与 `action.section.*`），媒体类的描述改成了本地版本。

```js
// 斜杠菜单目录（WP-14）。只有数据，没有 JSX，单元测试直接导入。
// defaultKey：复用 BlockNote 默认菜单项（getDefaultReactSlashMenuItems 返回项的 key）的插入行为和图标。
// action：由 lifeAtlasSchema.jsx 里的 createSlashActions 实现。
// 别名里保留了旧标题（Callout、Tabs、Linked View 等），旧的搜索习惯和现有测试都依赖它们。
export const SLASH_GROUP_ORDER = ["基本区块", "媒体", "数据库", "高级区块", "行内"];

const entry = (id, group, title, subtext, aliases, target) => ({ id, group, title, subtext, aliases, ...target });

export const SLASH_MENU_CATALOG = [
  entry("text", "基本区块", "文本", "从纯文本开始撰写", ["text", "p", "paragraph", "wb", "段落"], { defaultKey: "paragraph" }),
  entry("page", "基本区块", "页面", "在此页面中嵌入子页面", ["page", "ym", "子页面", "link page"], { action: "subPage" }),
  entry("todo", "基本区块", "待办事项", "使用待办清单追踪任务", ["todo", "checkbox", "dbsx", "待办", "复选框", "清单"], { defaultKey: "check_list" }),
  entry("h1", "基本区块", "标题 1", "大型版块标题", ["h1", "#", "bt1", "heading 1", "一级标题"], { defaultKey: "heading" }),
  entry("h2", "基本区块", "标题 2", "中型版块标题", ["h2", "##", "bt2", "heading 2", "二级标题"], { defaultKey: "heading_2" }),
  entry("h3", "基本区块", "标题 3", "小型版块标题", ["h3", "###", "bt3", "heading 3", "三级标题"], { defaultKey: "heading_3" }),
  entry("h4", "基本区块", "标题 4", "较小的版块标题", ["h4", "####", "bt4", "heading 4", "四级标题"], { defaultKey: "heading_4" }),
  entry("table", "基本区块", "表格", "将简易的内容表格添加到你的页面", ["table", "bg", "简易表格"], { defaultKey: "table" }),
  entry("bullet", "基本区块", "项目符号列表", "创建简单的项目符号列表", ["bullet", "ul", "xmfh", "无序列表"], { defaultKey: "bullet_list" }),
  entry("numbered", "基本区块", "有序列表", "创建带序号的列表", ["numbered", "ol", "yxlb", "编号列表"], { defaultKey: "numbered_list" }),
  entry("toggle", "基本区块", "折叠列表", "折叠列表可以隐藏或显示内部内容", ["toggle", "zdlb", "折叠", "展开"], { defaultKey: "toggle_list" }),
  entry("quote", "基本区块", "引用", "摘取引用", ["quote", "yy"], { defaultKey: "quote" }),
  entry("divider", "基本区块", "分隔线", "在视觉上分隔区块", ["divider", "hr", "fgx", "---"], { defaultKey: "divider" }),
  entry("link-to-page", "基本区块", "链接到页面", "链接到现有页面", ["link to page", "ljdym", "页面链接"], { action: "linkToPage" }),
  entry("callout", "基本区块", "标注", "醒目显示文字", ["callout", "Callout", "bz", "提示"], { action: "callout" }),
  entry("th1", "基本区块", "折叠标题 1", "将内容隐藏在大标题内", ["th1", "zdbt1", "toggle heading 1"], { defaultKey: "toggle_heading" }),
  entry("th2", "基本区块", "折叠标题 2", "将内容隐藏在中等标题内", ["th2", "zdbt2", "toggle heading 2"], { defaultKey: "toggle_heading_2" }),
  entry("th3", "基本区块", "折叠标题 3", "将内容隐藏在小标题内", ["th3", "zdbt3", "toggle heading 3"], { defaultKey: "toggle_heading_3" }),
  entry("th4", "基本区块", "折叠标题 4", "将内容隐藏在较小的标题内", ["th4", "zdbt4", "toggle heading 4"], { action: "toggleHeading4" }),

  entry("image", "媒体", "图片", "上传本地图片", ["image", "img", "tp", "图像", "照片"], { defaultKey: "image" }),
  entry("video", "媒体", "视频", "上传本地视频", ["video", "sp"], { defaultKey: "video" }),
  entry("audio", "媒体", "音频", "上传本地音频", ["audio", "yp", "声音", "音乐"], { defaultKey: "audio" }),
  entry("file", "媒体", "文件", "上传文件附件", ["file", "wj", "附件"], { defaultKey: "file" }),
  entry("pdf", "媒体", "PDF", "嵌入本地 PDF", ["pdf", "文档"], { action: "pdf" }),
  entry("code", "媒体", "代码", "获取代码段", ["code", "dm", "代码块", "pre"], { defaultKey: "code_block" }),

  entry("view-table", "数据库", "表格视图", "向新建或现有数据源添加表格视图", ["table view", "bgst"], { action: "view:table" }),
  entry("view-board", "数据库", "看板视图", "创建看板数据库视图", ["board", "board view", "kanban", "kbst"], { action: "view:board" }),
  entry("view-gallery", "数据库", "画廊视图", "创建画廊数据库视图", ["gallery", "gallery view", "hlst"], { action: "view:gallery" }),
  entry("view-list", "数据库", "列表视图", "创建列表数据库视图", ["list view", "lbst"], { action: "view:list" }),
  entry("view-calendar", "数据库", "日历视图", "创建日历数据库视图", ["calendar", "calendar view", "rlst"], { action: "view:calendar" }),
  entry("view-timeline", "数据库", "时间轴视图", "创建时间轴数据库视图", ["timeline", "timeline view", "gantt", "sjzst"], { action: "view:timeline" }),
  entry("view-roadmap", "数据库", "时间脉络", "像幻灯片一样按时间展示里程碑和阶段", ["roadmap", "sjml", "里程碑"], { action: "view:roadmap" }),
  entry("view-map", "数据库", "地图视图", "创建地图数据库视图", ["map", "map view", "dtst"], { action: "view:map" }),
  entry("view-chart", "数据库", "图表", "分组、聚合并可视化数据", ["chart", "bar", "line", "donut", "tb"], { action: "view:chart" }),
  entry("view-form", "数据库", "表单", "用表单新增数据库记录", ["form", "bd"], { action: "view:form" }),
  entry("view-dashboard", "数据库", "管理面板视图", "创建管理面板数据库视图", ["dashboard", "Dashboard", "仪表盘", "glmbst"], { action: "view:dashboard" }),
  entry("database-inline", "数据库", "数据库 - 行内", "将新的行内数据库添加到此页面", ["database", "db", "数据库 - Inline", "sjkhn"], { action: "inlineDatabase" }),
  entry("database-full", "数据库", "数据库 - 整页", "将新数据库添加为子页面", ["full page database", "db", "数据库 - Full page", "整页数据库", "sjkzy"], { action: "fullPageDatabase" }),
  entry("linked-view", "数据库", "数据源的链接视图", "将现有数据源的视图添加到此页面", ["linked view", "Linked View", "linked database", "关联视图", "sjyljst"], { action: "linkedView" }),

  entry("toc", "高级区块", "目录", "显示页面大纲", ["toc", "table of contents", "ml", "大纲"], { action: "toc" }),
  entry("equation", "高级区块", "公式区块", "显示独立的数学公式", ["math", "latex", "equation", "$$", "gsqk", "块公式", "公式"], { action: "equation" }),
  entry("breadcrumb", "高级区块", "路径栏", "显示当前页面的位置", ["breadcrumb", "ljl", "面包屑", "路径"], { action: "breadcrumb" }),
  entry("synced", "高级区块", "同步区块", "跨页面同步内容", ["synced", "tbqk", "同步"], { action: "syncedBlock" }),
  entry("tabs", "高级区块", "选项卡", "在选项卡中整理内容", ["tabs", "Tabs", "xxk", "标签页"], { action: "tabs" }),
  ...[2, 3, 4, 5].map((count) => entry(`columns-${count}`, "高级区块", `${count} 列`, `创建 ${count} 列区块`, [`col${count}`, `${count} columns`, `${count}l`, "分栏", "columns"], { action: `columns:${count}` })),
  entry("editorial-card", "高级区块", "Editorial Card", "图片、标签、标题与摘要的编辑卡片", ["editorial", "card", "内容卡片"], { action: "editorialCard" }),
  entry("editorial-3-cards", "高级区块", "Editorial 3 Cards", "三栏出版卡片布局", ["editorial grid", "三栏卡片"], { action: "editorial3Cards" }),
  entry("editorial-media-text", "高级区块", "Editorial Media / Text", "媒体左置、文字右置卡片", ["media text", "图文"], { action: "editorialMediaText" }),
  entry("editorial-section", "高级区块", "Editorial Section", "绑定数据源并按筛选、排序、数量渲染出版卡片", ["dynamic editorial", "动态首页", "精选内容"], { action: "editorialSection" }),

  entry("mention", "行内", "提及", "提及人员、页面或日期", ["@", "mention", "tj", "提及人员", "提及页面", "日期", "提醒", "person", "date", "reminder"], { action: "openMentionMenu" }),
  entry("inline-equation", "行内", "行内公式", "在文字中插入数学公式", ["inline math", "inline equation", "hngs", "$"], { action: "inlineEquation" }),
  entry("emoji", "行内", "表情", "插入表情符号", ["emoji", "bq", "表情符号", ":"], { defaultKey: "emoji" }),
];

// 斜杠菜单右边显示的 Markdown 快捷写法（墨白，12 第 7 节；2.2 节放进菜单项的 badge）。
// 只列 BlockNote 0.54.2 真有的输入规则；没有快捷写法的项右边什么都不显示。
export const SLASH_MARKDOWN_HINTS = {
  todo: "[]", h1: "#", h2: "##", h3: "###", h4: "####",
  bullet: "-", numbered: "1.", quote: ">", divider: "---", code: "```",
};
```

规则：

1. 菜单项的顺序就是这个数组的顺序；同一分组的项连续排列（BlockNote 按相邻的 `group` 显示分组标题）。
2. 动态项“引用同步内容 N”（现有代码，每个未删除的同步源一项）放在“高级区块”分组的**最后**（`Editorial Section` 之后），`group` 改为 `"高级区块"`，其他不变。
3. BlockNote 默认菜单项**只**通过 `defaultKey` 出现；目录里没有的默认项（`heading_5`、`heading_6`）不出现在菜单里（Markdown 快捷输入 `##### ` 仍然可用，不用管）。
4. `SLASH_MARKDOWN_HINTS` 只是菜单右边显示的提示（总设计师已在 `@blocknote/core` 0.54.2 的源码里核对过，这些输入规则都存在）。

### 2.2 菜单构建（改写 `lifeAtlasSchema.jsx` 的 `getLifeAtlasSlashMenuItems`）

```jsx
import { SuggestionMenu } from "@blocknote/core/extensions";
import { SLASH_MENU_CATALOG, SLASH_MARKDOWN_HINTS } from "./slashMenuCatalog.js";

export function getLifeAtlasSlashMenuItems(editor, runtime) {
  const defaultsByKey = new Map(getDefaultReactSlashMenuItems(editor).map((item) => [item.key, item]));
  const actions = createSlashActions(editor, runtime);   // { [action]: { icon, run } }
  const items = [];
  for (const entry of SLASH_MENU_CATALOG) {
    const base = entry.defaultKey ? defaultsByKey.get(entry.defaultKey) : null;
    const action = entry.action ? actions[entry.action] : null;
    if (!base && !action) continue;                      // 当前 schema 没有这种区块时跳过
    items.push({
      key: entry.id, title: entry.title, subtext: entry.subtext, aliases: entry.aliases, group: entry.group,
      icon: action ? action.icon : base.icon,
      badge: SLASH_MARKDOWN_HINTS[entry.id],   // 墨白：右边显示 Markdown 快捷写法（2.1 节），不再显示 BlockNote 默认的 Ctrl-Alt-1 一类徽标
      onItemClick: action ? action.run : base.onItemClick,
    });
  }
  const synced = /* 现有的“引用同步内容 N”生成代码，group 改为 "高级区块" */;
  const lastAdvanced = items.findLastIndex((item) => item.group === "高级区块");
  items.splice(lastAdvanced + 1, 0, ...synced);
  return items;
}
```

`createSlashActions(editor, runtime)` 写在同一个文件里，返回下表的对象。“现有代码”指现在 `getLifeAtlasSlashMenuItems` 里同名菜单项的 `onItemClick` 与 `icon`，原样搬过来（`createDatabase`、`createDataView`、`layoutBlock` 等辅助函数保留，它们也是现有测试检查的源码）。

| action | icon | run |
| --- | --- | --- |
| `subPage` | `<IconPageBreak size={18} />` | 现有“页面”项的代码 |
| `linkToPage` | `<IconLink size={18} />` | `insertOrUpdateBlockForSlashMenu(editor, { type: "pageLink", props: { pageId: "", label: "" } })`（空的页面链接块会显示 2.4 节的页面选择框） |
| `callout` | `<IconBlockquote size={18} />` | 现有“Callout”项的代码 |
| `toggleHeading4` | `<span className="slash-text-icon">H4</span>` | `insertOrUpdateBlockForSlashMenu(editor, { type: "heading", props: { level: 4, isToggleable: true } })` |
| `pdf` | `<IconFileTypePdf size={18} />` | 现有“PDF”项的代码 |
| `view:<type>`（10 种） | `chart` 用 `<IconChartBar size={18} />`，`form` 用 `<IconForms size={18} />`，`dashboard` 用 `<IconLayoutDashboard size={18} />`，`roadmap` 用 `<IconTimeline size={18} />`，其余 `<IconDatabase size={18} />` | `createDataView("<type>")`（现有函数，行为不变） |
| `inlineDatabase` | `<IconDatabase size={18} />` | `createDatabase("table")` |
| `fullPageDatabase` | `<IconTable size={18} />` | `runtime?.createFullPageDatabase?.()` |
| `linkedView` | `<IconLink size={18} />` | 现有“Linked View”项的代码 |
| `toc`、`breadcrumb`、`syncedBlock`、`tabs` | 现有图标 | 现有代码 |
| `equation` | `<IconMath size={18} />` | `insertOrUpdateBlockForSlashMenu(editor, { type: "equation", content: "" })`（插入后进入编辑状态，见 2.3 节） |
| `columns:<n>` | 现有图标规则 | `insertOrUpdateBlockForSlashMenu(editor, layoutBlock(n))` |
| `editorialCard`、`editorial3Cards`、`editorialMediaText`、`editorialSection` | 现有图标 | 现有代码 |
| `openMentionMenu` | `<IconAt size={18} />` | `editor.getExtension(SuggestionMenu)?.openSuggestionMenu("@", { deleteTriggerCharacter: true, ignoreQueryLength: true })` |
| `inlineEquation` | `<IconMath size={18} />` | 打开行内公式对话框（2.3 节），确定后 `editor.insertInlineContent([{ type: "inlineEquation", props: { expression } }, " "])` |

`filterLifeAtlasSlashMenuItems` 保持现在的写法（`filterSuggestionItems(getLifeAtlasSlashMenuItems(editor, runtime), query)`）。

**菜单的位置和高度**（修第 1 节最后那个滚不到底的问题）：新建 `src/editor/suggestionMenuFloating.js`（照抄下面的全部内容），导出 `SUGGESTION_MENU_FLOATING`；`PageEditor.jsx`、`EditorContainers.jsx` 里所有 `SuggestionMenuController`（`/`、`@`、`[[`、`+`）都加 `floatingUIOptions={SUGGESTION_MENU_FLOATING}`（BlockNote 0.54.2 会把其中的 `useFloatingOptions` 合并进它自己的设置，后写的覆盖先写的）。代码按这几条规则写成：

1. 菜单每次打开时**只决定一次**放在光标下面还是上面：按光标所在行的屏幕位置算可用空间（各减 10 px 间距和 10 px 边距），下面 ≥ 240 px 或者不比上面少就放下面（`bottom-start`），否则放上面（`top-start`）；打开期间**不再翻转**。光标位置还没算出来时（参考矩形的宽、高、x、y 都是 0）不做决定，等下一次。
2. 高度 `maxHeight = min(这一边的可用空间, 400 px)`；横向用 `shift` 保持在窗口里。决定之前菜单高度是 0、`visibility: hidden`，所以不会先在错误的位置闪一下。
3. 用 `@floating-ui/react@0.27.20` 的 `offset`、`shift`、`size`（步骤 1 安装；它本来就是 BlockNote 0.54.2 的依赖，版本相同，不会多装一份）。“只决定一次”是一个自己的 middleware：用 `WeakMap` 以 `elements.floating`（每次打开都是新的元素）为键记住第一次的决定，之后每次都 `return { reset: { placement: 记住的那一边 } }`（已经是那一边时 `return {}`）。

```js
import { offset, shift, size } from "@floating-ui/react";

// 斜杠菜单等弹出菜单的位置和高度（WP-14 第 2.2 节）。
// BlockNote 默认用 autoPlacement + size：菜单先排在光标上方、变高，接着又挪到下方、变矮；
// 真实的 Chromium 窗口里，滚动范围停在第一次的高度，滚轮和拖滚动条都滚不到底。
// 这里在菜单每次打开时只决定一次放上面还是下面，之后不再翻转；光标位置算出来之前高度是 0。
const MAX_HEIGHT = 400;
const GAP = 10;
const decided = new WeakMap();

const decideOnce = {
  name: "lifeAtlasDecideOnce",
  fn({ placement, elements }) {
    const rect = elements.reference.getBoundingClientRect();
    const floating = elements.floating;
    if (!rect.width && !rect.height && !rect.x && !rect.y) {
      floating.dataset.laReady = "0";
      return {};
    }
    let side = decided.get(floating);
    if (!side) {
      const viewport = document.documentElement.clientHeight;
      const below = viewport - rect.bottom - GAP * 2;
      const above = rect.top - GAP * 2;
      side = below >= 240 || below >= above ? "bottom-start" : "top-start";
      decided.set(floating, side);
    }
    floating.dataset.laReady = "1";
    return placement === side ? {} : { reset: { placement: side } };
  },
};

export const SUGGESTION_MENU_FLOATING = {
  useFloatingOptions: {
    placement: "bottom-start",
    middleware: [
      offset(GAP),
      decideOnce,
      shift({ padding: GAP }),
      size({
        padding: GAP,
        apply({ availableHeight, elements }) {
          const ready = elements.floating.dataset.laReady === "1";
          elements.floating.style.maxHeight = `${ready ? Math.max(0, Math.min(MAX_HEIGHT, availableHeight)) : 0}px`;
          elements.floating.style.visibility = ready ? "" : "hidden";
        },
      }),
    ],
  },
};
```

总设计师 2026-11-06 在项目副本里用这份代码试过（光标在 900 px 高窗口的 150、420、690 px 处各打开一次）：菜单高度不超过 400 px，滚轮能滚到最后一项，`@` 菜单照常打开，没有页面错误。这是无头浏览器里试的，而无头浏览器复现不了原来的问题，所以它**不能**当作修好的证据；证据是步骤 14 的真实窗口用例。

写完先跑步骤 14 的「slash menu scrolls to the last item anywhere in the window」。还是滚不到底时按第 6 节卡点表里这一行的顺序换做法，直到这个用例通过；报告第 5 节写清楚最后用的是哪种做法（AC-14-14）。

### 2.3 公式

- **公式区块**：类型仍是 `equation`，`content: "plain"`（区块文字就是 LaTeX 源码），`propSchema` 不变。`render: ({ block, editor, contentRef })`：
  - 源码 `source` = 区块 `content` 里各文字片段的 `text` 拼起来；
  - 上方显示排版结果：`<div className="life-equation-rendered" contentEditable={false} onClick={() => editor.setTextCursorPosition(block, "end")} dangerouslySetInnerHTML={{ __html: katex.renderToString(source || "\\square", { displayMode: true, throwOnError: false, output: "html" }) }} />`；
  - 下方是可编辑的源码 `<code ref={contentRef} className="life-equation-source" />`，只有光标在本区块里时显示（用 `useEditorSelectionChange(() => setEditing(editor.getTextCursorPosition().block.id === block.id), editor)` 维护 `editing`；不显示时加类名 `is-collapsed`，CSS 用 `height: 0; overflow: hidden`，**不要**用 `display: none`，ProseMirror 需要这个元素）；
  - 源码为空时，排版结果位置显示灰色文字“输入 LaTeX 公式”；
  - `throwOnError: false` 时 KaTeX 把错误公式显示成红色源码，不抛异常。
- **行内公式**：新文件 `src/editor/InlineEquation.jsx`，`createReactInlineContentSpec({ type: "inlineEquation", propSchema: { expression: { default: "" } }, content: "none" }, { render, toExternalHTML })`；加入 `lifeAtlasSchema` 的 `inlineContentSpecs`。`render` 显示 `katex.renderToString(expression, { displayMode: false, throwOnError: false })`，外层 `<span className="life-inline-equation" contentEditable={false}>`；点击打开同一个对话框编辑，确定后 `updateInlineContent({ type: "inlineEquation", props: { expression: 新值 } })`。
- **行内公式对话框**（同一文件导出 `InlineEquationDialog`）：居中小对话框，标题“行内公式”，`<textarea aria-label="LaTeX 公式">`，下方实时预览，按钮“取消”“确定”；`Ctrl+Enter` 确定，`Esc` 取消；空公式时“确定”不可用。
- **样式**：`src/main.jsx` 里在 `import "./ui/theme-tokens.css";` 那一行**之后**加 `import "katex/dist/katex.min.css";`（`theme-tokens.css` 必须是第一个导入、墨白的 `index.css` 必须在所有样式表之后，WP-20 的 `tests/theme-files.test.mjs` 会检查；字体文件由 Vite 打包到本地，不引用任何网络地址）。公式的墨白样式见 2.12 节。

### 2.4 `[[`、`+` 与页面选择框

- **`[[`**：`PageEditor.jsx` 加 `<SuggestionMenuController triggerCharacter="[[" getItems={(query) => getPageLinkMenuItems(editor, query, databaseRuntime)} />`。`getPageLinkMenuItems` 写在 `Mentions.jsx`：
  - 页面项：所有不在回收站的页面，`{ title: 页面标题 || "无标题页面", group: "页面", subtext: 所在文件夹名称, aliases: [page.id], onItemClick: 插入 pageMention }`（插入方式与现有 `@` 菜单相同：`editor.insertInlineContent([{ type: "pageMention", props: { pageId, labelSnapshot: 标题 } }, " "])`）；
  - 查询词去掉首尾空格后不为空时，最后加一项 `{ title: "新建页面「<查询词>」", group: "新页面", onItemClick: () => { const created = runtime?.createSubPage?.(查询词); if (created) 插入指向 created.pageId 的 pageMention } }`；
  - 返回 `filterSuggestionItems(页面项, query)` 再接上“新建页面”项（“新建页面”项不参与过滤）。
- **`+`**：`<SuggestionMenuController triggerCharacter="+" shouldOpen={(tr) => tr.selection.$from.parent.type.name === "paragraph" && tr.selection.$from.parent.textContent === ""} getItems={(query) => getPlusMenuItems(editor, query, databaseRuntime)} />`。`getPlusMenuItems`（`Mentions.jsx`）：
  - 第一项 `{ title: query.trim() ? "新建子页面「<查询词>」" : "新建子页面", group: "新建", onItemClick: () => { const created = runtime?.createSubPage?.(query.trim() || "新页面"); if (created) insertOrUpdateBlockForSlashMenu(editor, { type: "pageLink", props: { pageId: created.pageId, label: created.title } }); } }`；
  - 其后是匹配查询词的页面（排除当前页面 `runtime.pageId` 和回收站里的），最多 10 个，`group: "链接到页面"`，点击插入 `pageLink` 块。
- **页面选择框**：`PageLinkBlock` 在 `pageId` 为空时渲染 `<div className="life-page-link-picker" contentEditable={false}>`：一个 `<input aria-label="搜索要链接的页面" autoFocus>`（`onKeyDown` 里先 `event.stopPropagation()`，和 `EditorContainers.jsx` 第 75 行的写法一样），下面是最多 8 个匹配的页面按钮（排除当前页面和回收站里的；空查询时按 `updatedAt` 降序取前 8 个）；点击后 `editor.updateBlock(block, { props: { pageId, label: 标题 } })`。`pageId` 不为空时保持现有的显示方式。

### 2.5 代码块

- `lifeAtlasSchema` 的 `blockSpecs` 在 `...defaultBlockSpecs` 之后加 `codeBlock: createCodeBlockSpec({ ...codeBlockOptions, defaultLanguage: "text" })`（`createCodeBlockSpec` 从 `@blocknote/core` 导入，`codeBlockOptions` 从 `@blocknote/code-block` 导入）。
- `PageEditor.jsx` 的 `useCreateBlockNote` 的 `extensions` 改为 `[TabPanelsExtension, ColumnWidthsExtension, syntaxHighlighter]`。
- **复制按钮** `src/editor/CodeBlockCopyButton.jsx`：放在 `BlockNoteView` 的子元素里。监听编辑器容器的 `mouseover`：`event.target.closest('[data-content-type="codeBlock"]')` 找到代码块时，在它右上角（容器内绝对定位）显示 `<button aria-label="复制代码">复制</button>`；点击时用 `closest(".bn-block-outer").dataset.id` 取区块 ID → `editor.getBlock(id)` → 拼出文字 → `navigator.clipboard.writeText(文字)` → 按钮文字变成“已复制”1.5 秒。鼠标离开代码块 300 ms 后隐藏。
- 代码块在 Markdown 导出时已经输出带语言的围栏（现有代码），本 WP 只补测试。

### 2.6 区块菜单、`Ctrl+D`、移动与区块链接

- **区块菜单**：新文件 `src/editor/LifeAtlasDragHandleMenu.jsx`，按第 1 节的写法组合，从上到下：`删除`（`RemoveBlockItem`）、`复制`、`移动到…`、`复制区块链接`、`颜色`（`BlockColorsItem`）、`行标题`、`列标题`（两个表头项只对表格显示，组件自己会判断）。`LifeAtlasSideMenuController.jsx` 里 `return <SideMenu />;` 改为 `return <SideMenu dragHandleMenu={LifeAtlasDragHandleMenu} />;`，其他不动。
- **复制**（菜单项和 `Ctrl+D` 相同）：选中了多个区块时复制全部选中的区块（`editor.getSelection()?.blocks`），否则复制当前区块（菜单里是菜单所属的区块，快捷键是光标所在区块）；`const copies = cloneBlockDocument(blocks)`（现有函数，新 ID、子区块一起复制、选项卡 ID 也换新）；`editor.insertBlocks(copies, blocks[blocks.length - 1], "after")`。
- **`Ctrl+D`**：`PageEditor.jsx` 外层 `div` 加 `onKeyDownCapture`：`(event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "d"` 时 `preventDefault()`、`stopPropagation()`，执行复制。页面锁定（`locked`）时什么都不做。
- **移动到…**：打开 `src/editor/MoveBlockDialog.jsx`：标题“移动到”，搜索框 `aria-label="搜索目标页面"`，下方页面列表（排除当前页面和回收站里的页面；空查询时按 `updatedAt` 降序取前 20 个；有查询时标题包含查询词的全部页面），每行显示标题和所在路径；点击一行即执行移动并关闭；`Esc` 关闭。执行移动（在同一个点击处理函数里依次做两件事，React 会把它们合并成一次渲染，450 ms 后一起保存）：
  1. `runtime.appendBlocksToPage(targetPageId, blocks)`：App 里实现为 `setWorkspace((current) => appendBlocksToPage(current, { pageId: targetPageId, blocks, now: new Date().toISOString() }))`；
  2. `editor.removeBlocks(blocks)`（当前页面的内容随后经 `onChange` 更新）。
  
  `appendBlocksToPage` 是 `src/domain/blockMoves.js` 的纯函数：目标页面的 `content` 末尾追加 `blocks`（**保留原 ID**，因为是移动不是复制），`updatedAt = now`、`contentRevision + 1`；目标页面不存在或在回收站时抛错 `目标页面不存在或已在回收站`。
- **复制区块链接**：`navigator.clipboard.writeText(\`lifeatlas://page/${pageId}#block-${blockId}\`)`，然后在页面右下角显示 2 秒提示“已复制区块链接”（`role="status"`）。
- **链接规则** `src/editor/links.js`（纯函数，新文件）：

  ```js
  const ALLOWED_SCHEMES = /^(?:https?|ftps?|mailto|tel|callto|sms|cid|xmpp):/i;
  const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
  const BLOCK_LINK = /^lifeatlas:\/\/page\/([A-Za-z0-9_-]{1,200})(?:#block-([A-Za-z0-9_-]{1,200}))?$/;

  export function isAllowedEditorLink(href) {
    const value = String(href ?? "").trim();
    if (BLOCK_LINK.test(value)) return true;
    return ALLOWED_SCHEMES.test(value) || !ANY_SCHEME.test(value);   // 没有协议的相对地址也允许
  }

  export function parseBlockLink(href) {
    const match = BLOCK_LINK.exec(String(href ?? "").trim());
    return match ? { pageId: match[1], blockId: match[2] || null } : null;
  }
  ```

- **点击链接**：`useCreateBlockNote` 加选项 `links: { isValidLink: isAllowedEditorLink, onClick: handleLinkClick }`。`handleLinkClick(event)`：取 `event.target.closest("a[href]")` 的 `href`；
  - 是区块链接 → `databaseRuntime?.openPageAt?.(pageId, blockId)`，返回 `true`；
  - 以 `http:`、`https:`、`mailto:` 开头 → 桌面版 `window.lifeAtlas.app.openExternal({ url: href })`（主进程会先确认），浏览器版 `window.open(href, "_blank", "noopener,noreferrer")`，返回 `true`；
  - 其他 → 返回 `false`。
  
  页面锁定（编辑器不可编辑）时 BlockNote 不调用 `onClick`：在 `PageEditor` 外层 `div` 的 `onClickCapture` 里，`locked` 为真且点到 `a[href]` 时 `preventDefault()`，再按上面同样的规则处理。
- **打开并定位**：App 新增 `openPageAt(pageId, blockId)`：先 `openPage(pageId)`（同一页面也照常调用），再把 `{ pageId, blockId }` 存进状态 `pendingBlockFocus`；`PageDocument` 把它传给 `PageEditor` 的新参数 `focusBlockId`。`PageEditor` 在 `editor` 创建后和 `focusBlockId` 变化时：`requestAnimationFrame` 里找 `.bn-block-outer[data-id="<blockId>"]`（用 `CSS.escape`），找到就 `scrollIntoView({ block: "center" })` 并加类名 `is-link-target`，1200 ms 后去掉，然后调用 `onBlockFocused()` 让 App 清空 `pendingBlockFocus`；找不到就只清空，不报错。样式（写在 2.12 节的 `editor-tools.css`）：`:root[data-style="mobai"] .is-link-target > .bn-block { background: var(--mb-accent-soft); border-radius: var(--mb-r2); transition: background 0.3s; }`。

### 2.7 页内查找（`Ctrl+F`，桌面版和浏览器版相同）

- **入口**：App 的全局 `keydown`（和现有 `Ctrl+K` 写在一起）：`(event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f"` 且当前显示的是页面时，`preventDefault()` 并打开查找条；查找条已打开时把焦点放回输入框并全选。
- **查找范围**：当前页面的 `<article className="page-document">`（页面标题是 `<input>`，不在查找范围内）。
- **纯函数** `src/editor/findInPage.js`：

  ```js
  export function findTextMatches(texts, query) {
    const needle = String(query ?? "");
    if (!needle.trim()) return [];
    const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
    const matches = [];
    texts.forEach((text, unit) => {
      for (const match of String(text).matchAll(pattern)) matches.push({ unit, start: match.index, end: match.index + match[0].length });
    });
    return matches;
  }
  ```

- **DOM 部分**（同一文件）：
  - `collectFindUnits(root)`：用 `document.createTreeWalker(root, NodeFilter.SHOW_TEXT)` 遍历文字节点；跳过父元素满足 `closest("script, style, input, textarea, select, option, [data-find-ignore]")` 的，跳过 `!node.parentElement.checkVisibility()` 的（折叠起来的内容找不到，这是允许的）；每个节点的“单元元素” = `node.parentElement.closest(".bn-inline-content, td, th, li, p, h1, h2, h3, h4, button, a, label, [data-find-unit]") || node.parentElement`；同一单元元素的节点按出现顺序拼成一个单元 `{ element, text, nodes: [{ node, start }] }`。
  - `createRanges(units, matches)`：把每个匹配的 `start`/`end` 换算成所在文字节点和偏移，生成 `Range`。
  - 高亮：`CSS.highlights.set("la-find", new Highlight(...ranges))`，当前项 `CSS.highlights.set("la-find-active", new Highlight(ranges[active]))`；关闭时两个都 `delete`。样式（写在 `editor-tools.css`）：`:root[data-style="mobai"] ::highlight(la-find) { background-color: var(--mb-u-yellow-bg); }`、`:root[data-style="mobai"] ::highlight(la-find-active) { background-color: rgba(var(--mb-accent-rgb), 0.3); }`（全部匹配是荧光笔黄，当前这一个是浅一些的 Notion 蓝；总设计师已在 Edge 里实测 `::highlight()` 能用 `var()` 取到这两个颜色）。
  - 当前项滚动到可见：`ranges[active].startContainer.parentElement.scrollIntoView({ block: "center" })`。
- **查找条** `src/editor/FindBar.jsx`：固定在 `workspace-pane` 右上角（`position: absolute; top: 12px; right: 16px; z-index: 50`），带 `data-find-ignore`；内容：`<div role="search" aria-label="页内查找">`、输入框 `aria-label="查找内容"`、计数 `<span data-testid="find-count">`（有匹配时“当前序号/总数”，如 `1/3`；没有匹配时 `0/0`，输入框加 `aria-invalid="true"`）、按钮 `aria-label="上一个匹配"`、`aria-label="下一个匹配"`、`aria-label="关闭查找"`。
- **键盘**：输入框里 `Enter` 下一个、`Shift+Enter` 上一个、`Esc` 关闭；到最后一个再“下一个”回到第一个。
- **内容变化**：查找条打开期间用 `MutationObserver`（`subtree`、`childList`、`characterData`）监视范围，变化后 200 ms 重新查找，当前序号超出总数时改为最后一个。切换页面时关闭查找条。

### 2.8 远程媒体与粘贴

- `src/editor/remoteMedia.js`（纯函数，新文件）：

  ```js
  export function isRemoteUrl(url) {
    return /^https?:\/\//i.test(String(url ?? "").trim());
  }

  export function remotePlaceholderDataUrl(url) {
    let host = "未知地址";
    try { host = new URL(url).host || host; } catch { /* 保持默认 */ }
    const safeHost = host.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
    // 占位图是一张图片，用不了主题变量：透明底、中灰虚线框和中灰文字，白天和夜间都看得清（墨白）。
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200" viewBox="0 0 640 200"><rect x="1" y="1" width="638" height="198" rx="6" fill="none" stroke="#8b8d93" stroke-width="1.5" stroke-dasharray="6 5"/><text x="320" y="92" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#8b8d93">外部内容（未加载）</text><text x="320" y="128" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#8b8d93">${safeHost}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  export async function resolveEditorFileUrl(url) {
    return isRemoteUrl(url) ? remotePlaceholderDataUrl(url) : url;
  }
  ```

- `useCreateBlockNote` 加选项 `resolveFileUrl: resolveEditorFileUrl`。`life-asset:`、`blob:`、`data:` 和其他地址原样返回。
- 图片区块显示占位图；视频和音频区块会显示一个无法播放的播放器（这是允许的，重点是不发请求）；文件区块照常显示文件名。
- **打开原地址**：`PageEditor` 外层 `div` 加 `onDoubleClick`：`event.target.closest(".bn-block-outer")` 对应的区块 `props.url` 是远程地址时，桌面版调用 `window.lifeAtlas.app.openExternal({ url })`，浏览器版 `window.open(url, "_blank", "noopener,noreferrer")`。
- 粘贴：不写代码（第 1 节）；粘贴进来的远程图片同样经过 `resolveFileUrl`。

### 2.9 表格与表情

- `useCreateBlockNote` 加选项 `tables: { headers: true, cellBackgroundColor: true, cellTextColor: true, splitCells: false }`（不允许合并单元格：Notion 的简易表格也不能合并，Markdown 也表示不了）。
- 表情：默认已有，不写代码。

### 2.10 快捷键面板（`Ctrl+/`）

- `src/editor/shortcuts.js`（照抄；WP-17 的设置页也读它）：

  ```js
  export const SHORTCUTS = [
    { id: "search", group: "导航", keys: "Ctrl+K", description: "搜索", verify: "按下后出现搜索对话框" },
    { id: "quick-capture", group: "导航", keys: "Ctrl+Shift+N", description: "快速记录", verify: "按下后出现快速记录框" },
    { id: "back", group: "导航", keys: "Alt+←", description: "后退", verify: "依次打开两个页面后按下，回到第一个页面" },
    { id: "forward", group: "导航", keys: "Alt+→", description: "前进", verify: "后退之后按下，回到第二个页面" },
    { id: "toggle-sidebar", group: "导航", keys: "Ctrl+\\", description: "折叠或展开侧栏", verify: "按下后侧栏折叠，再按一次展开" },
    { id: "shortcuts", group: "导航", keys: "Ctrl+/", description: "快捷键面板", verify: "按下后出现快捷键面板" },
    { id: "find", group: "页面", keys: "Ctrl+F", description: "页内查找", verify: "按下后出现查找条" },
    { id: "undo", group: "编辑", keys: "Ctrl+Z", description: "撤销", verify: "输入文字后按下，文字消失" },
    { id: "redo", group: "编辑", keys: "Ctrl+Shift+Z", description: "重做", verify: "撤销之后按下，文字恢复" },
    { id: "bold", group: "编辑", keys: "Ctrl+B", description: "粗体", verify: "选中文字后按下，文字变为粗体" },
    { id: "italic", group: "编辑", keys: "Ctrl+I", description: "斜体", verify: "选中文字后按下，文字变为斜体" },
    { id: "underline", group: "编辑", keys: "Ctrl+U", description: "下划线", verify: "选中文字后按下，文字带下划线" },
    { id: "duplicate", group: "编辑", keys: "Ctrl+D", description: "复制当前区块", verify: "按下后当前区块下方出现一份副本" },
    { id: "slash", group: "插入", keys: "/", description: "斜杠菜单", verify: "在空行输入后出现斜杠菜单" },
    { id: "mention", group: "插入", keys: "@", description: "提及人员、页面或日期", verify: "输入后出现提及菜单" },
    { id: "page-link", group: "插入", keys: "[[", description: "链接页面", verify: "输入后出现页面菜单" },
    { id: "plus", group: "插入", keys: "+", description: "在空行开头新建或链接页面", verify: "在空行开头输入后出现页面菜单" },
    { id: "emoji", group: "插入", keys: ":", description: "表情（再输入至少两个字母）", verify: "输入 :sm 后出现表情网格" },
  ];
  ```

- `src/editor/ShortcutPanel.jsx`：居中对话框，标题“快捷键”，按 `group` 分组（顺序：导航、页面、编辑、插入），每行左边 `description`、右边按键（每个键一个 `<kbd>`）；`Esc` 或点遮罩关闭。App 的全局 `keydown` 里 `Ctrl+/` 打开或关闭它。样式见 2.12 节。

### 2.11 导出（`pageExport.js`）

- 标题：`blockMarkdown` 和 `blockHtml` 里 `Math.min(3, …)` 改为 `Math.min(4, …)`（1–4 级标题输出 `#`–`####` 和 `<h1>`–`<h4>`）；折叠标题按普通标题输出。
- 公式区块：Markdown 输出 `$$\n<源码>\n$$`；HTML 输出 `katex.renderToString(源码, { displayMode: true, throwOnError: false, output: "mathml" })`。
- 行内公式：`inlineMarkdown` 输出 `$<expression>$`；`inlineHtml` 输出 `katex.renderToString(expression, { displayMode: false, throwOnError: false, output: "mathml" })`。
- KaTeX 输出的 MathML 浏览器可以直接显示，HTML 导出不需要额外的样式或字体。

### 2.12 墨白样式（规定）

- **参照画面**：斜杠菜单 `design/mobai/shots/slash-light.png`、`slash-dark.png`（原型 `design/mobai/prototype/index.html#view=slash&mode=light`，夜间把 `light` 换成 `dark`）；编辑器区块的样子见 `design/mobai/product-shots/sample-page-*`（WP-20 装上主题后的示例页面）。原型**只看不改**。
- **样式文件**：本 WP 新写的样式全部放进新文件 `src/ui/themes/mobai/editor-tools.css`，在 `src/ui/themes/mobai/index.css` 末尾追加一行 `@import "./editor-tools.css";`（只能追加，前面的行不动）。每个选择器前加 `:root[data-style="mobai"] `，只用 `--mb-*` 变量；旧 CSS 里不写颜色（K13）。WP-20 的 `editor.css` 已经写好的规则（区块、引用、表格、标注，以及斜杠菜单的底色、字体和选中色）不要再写一遍，只补下面这些。
- **斜杠菜单**（原型 `b-more.css` 的 “slash menu” 一段）：WP-20 的 `editor.css` 已经把菜单做成 Notion 的样子：宽 324 px，一行一项、行高 30 px，左边 22 px 图标没有外框，说明文字（`subtext`）只给读屏软件，右边的 Markdown 快捷写法（2.2 节放进 `badge`）是 12 px `--mb-faint` 字。这些**不要再写**。本 WP 只补菜单底部一行键盘提示，用 CSS 写，不改组件（照抄；总设计师 2026-11-06 在项目副本里白天、夜间都试过：菜单滚动时这一行一直贴在菜单底边，滚到底时最后一项完整露在它上面）：

  ```css
  :root[data-style="mobai"] .bn-container .bn-suggestion-menu::after {
    content: "↑↓ 选择　　Enter 插入　　Esc 关闭"; position: sticky; bottom: -4px; display: block;
    margin: 4px -4px -4px; padding: 8px 12px; border-top: 1px solid var(--mb-line);
    background: var(--mb-raised); color: var(--mb-faint); font: 12px/1 var(--mb-sans);
  }
  ```

  `bottom` 和 `margin` 的 `-4px` 抵消的是 WP-20 给菜单的 4 px 内边距，两边要一起改。`@`、`[[`、`+` 菜单用的是同一个组件，也会有这一行，这是允许的。
- **代码块**：BlockNote 的默认样式把代码高亮写成 `.shiki { color: var(--shiki-dark); }`（它的代码块原来总是黑底；总设计师核对过 `@blocknote/core` 0.54.2 的 `Block.css`）。墨白白天的代码块是浅灰底，所以白天要换成浅色主题的颜色：`:root[data-style="mobai"][data-theme="light"] .life-editor .shiki { color: var(--shiki-light); }`（夜间不用写）。代码块左上角的语言选择框：WP-20 已经写好（`--mb-muted` 色、12 px、透明底、没有边框），只补里面的 `option`：`--mb-raised` 底、`--mb-ink` 字。复制按钮（`aria-label="复制代码"`，只在鼠标停在代码块上时出现，见 2.5 节）：高 24 px、左右 8 px、圆角 6 px、透明底、没有边框、`12px var(--mb-sans)`、`--mb-muted` 字，悬停时 `--mb-hover` 底、`--mb-ink` 字（Notion 代码块右上角的“复制”就是这样）。
- **公式**（原型 `b.css` 的 `.b-equation`）：WP-20 已经去掉了 `.life-equation-block` 的外框、悬停时是 `--mb-hover` 底，不要再写。排版结果 `.life-equation-rendered` 居中、上下内边距 14 px / 10 px、`--mb-ink` 色，公式字号 `1.3em`（约 21 px，写在 `.life-equation-rendered .katex`）；源码 `.life-equation-source` 展开时 `--mb-paper-2` 底、圆角 4 px、`13.6px/1.6 var(--mb-mono)`（和代码块一样）；“输入 LaTeX 公式”占位用 `--mb-faint`；KaTeX 的错误文字用危险色 `.katex-error { color: var(--mb-danger) !important; }`（KaTeX 把错误颜色写在行内样式里，所以要 `!important`）。行内公式 `.life-inline-equation` 悬停时 `--mb-hover` 底、圆角 3 px。
- **对话框**（行内公式、移动到、快捷键面板）：外壳沿用产品的 `.modal-backdrop` + `.ui-dialog`（WP-20 已写好遮罩、12 px 圆角、阴影和 16 px 粗体标题）。行内公式的 `textarea` 是 12 第 6 节的输入框、等宽字，下面的预览 `--mb-paper-2` 底、圆角 4 px；“移动到”的搜索框是 12 第 6 节的输入框，页面列表每行高 36 px、圆角 6 px、悬停 `--mb-hover` 底，标题 14 px `--mb-ink`、下面的路径 12 px `--mb-faint`；快捷键面板按分组排，分组标题是菜单的分组标题样式（12 px 500 `--mb-muted`），每行高 32 px，左边 14 px 说明、右边键帽（12 第 6 节：12 px，1 px `--mb-line-2` 描边、4 px 圆角），行之间 1 px `--mb-line` 细线。按钮靠右，次按钮在左、主按钮在右。
- **页面选择框** `.life-page-link-picker`：12 第 6 节的菜单样子（`--mb-raised` 底、`--mb-pop` 阴影、圆角 10 px、内边距 4 px）；顶部的输入框是 12 第 6 节的输入框；下面的页面按钮和菜单项一样（高 30 px、圆角 6 px、悬停 `--mb-hover` 底）。
- **查找条**：12 第 6 节“菜单 / 弹出层”的样子（`--mb-raised` 底、`--mb-pop` 阴影、圆角 10 px）；输入框是 12 第 6 节的输入框；计数用 `tabular-nums`、12 px `--mb-muted`，没有匹配时用危险色；三个按钮 28×28、圆角 6 px、`--mb-muted`，悬停 `--mb-hover` 底、`--mb-ink`。
- **提示**（“已复制区块链接”）：12 第 6 节的悬停提示颜色（`--mb-tooltip-bg` 底、`--mb-tooltip-text` 字），圆角 6 px、内边距 6 px 10 px、13 px，`--mb-pop` 阴影。

## 3. 范围

### 不做

- 按钮块、Mermaid、网页书签、嵌入、评论界面改版、多人协作光标。
- 合并单元格。
- 替换 BlockNote 或修改 `node_modules`。

## 4. 执行步骤

### 步骤 0：开工准备【停止点】

按执行手册 3.1 节开工（分支 `wp/14-editor`），生成报告骨架，跑基线：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-14/step0-npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-14/step0-browser.log npm run test:parity:browser
```

在报告第 1 节回答理解题：

1. 斜杠菜单里输入 `bt1`，第一项是什么？输入 `th2` 呢？输入 `Callout` 呢？
2. 正文里有一张 `https://example.com/a.png` 的图片，编辑器会不会发出网络请求？为什么？
3. “移动到…”一个区块后，这个区块的 ID 变不变？目标页面里多出的区块和原来是不是同一个 ID？
4. 为什么页内查找不用 Electron 的 `findInPage`？

提交 `WP-14: step 0 understanding`，运行 `node docs/blueprint/tools/wp-check.mjs WP-14 --until 0`，退出码 0 → **停止**，按执行手册 6.2 节回复。

### 步骤 1：依赖

```powershell
npm install --save-dev --save-exact katex@0.19.1 @blocknote/code-block@0.54.2 @floating-ui/react@0.27.20
```

`package.json` 的 `devDependencies` 只多这三项（它们是界面用的包，由 Vite 打包，不能放进 `dependencies`，见 02 第 11 节）；`package-lock.json` 一起提交。提交 `WP-14: add katex and blocknote code-block`。

### 步骤 2：斜杠菜单

1. 新建 `src/editor/slashMenuCatalog.js`（2.1 节，照抄）。
2. 按 2.2 节改写 `getLifeAtlasSlashMenuItems`，加 `createSlashActions`。
3. 按规定修改两个现有测试（执行手册 4.5 节第 2 条，报告第 4 节写明）：
   - `tests/editor-blocks.test.mjs`：在 `const schema = …` 那一行后面加一行 `const slashCatalog = fs.readFileSync(path.join(root, "src", "editor", "slashMenuCatalog.js"), "utf8");`；把第一个用例里的 `assert.ok(schema.includes(label), label);` 改成 `assert.ok(schema.includes(label) || slashCatalog.includes(label), label);`。其他一个字都不改。
   - `tests/browser/columns-transform.mjs`：`/数据库 - Inline/` 改成 `/数据库 - 行内/`。其他不改。
4. 新建 `tests/slash-menu.test.mjs`（导入 `SLASH_MENU_CATALOG`、`SLASH_GROUP_ORDER`、`SLASH_MARKDOWN_HINTS` 和 `@blocknote/core` 的 `filterSuggestionItems`）：
   - `slash menu groups follow the specified order`：目录里各项 `group` 去掉相邻重复后，正好等于 `SLASH_GROUP_ORDER`。
   - `slash menu titles match the table`：`SLASH_MENU_CATALOG.map((item) => item.title)` 深度等于 2.1 节代码里按顺序排列的全部标题（在测试里写出完整数组）。
   - `english aliases find their blocks`：`h1`→标题 1、`todo`→待办事项、`code`→代码、`table`→表格、`quote`→引用、`roadmap`→时间脉络，都是 `filterSuggestionItems(SLASH_MENU_CATALOG, 查询)[0].title`。
   - `pinyin initials find their blocks`：`bt1`→标题 1、`dbsx`→待办事项、`dm`→代码、`zdbt2`→折叠标题 2、`sjml`→时间脉络。
   - `old titles stay searchable as aliases`：`Callout`→标注、`Tabs`→选项卡、`Linked View`→数据源的链接视图、`Dashboard`→管理面板视图、`数据库 - Inline`→数据库 - 行内、`数据库 - Full page`→数据库 - 整页、`块公式`→公式区块、`面包屑`→路径栏。
   - `every entry has exactly one target`：每项有且只有 `defaultKey` 和 `action` 之一；`id` 不重复。
   - `editorial blocks come last in the advanced group`：“高级区块”里最后 4 项的标题依次是 `Editorial Card`、`Editorial 3 Cards`、`Editorial Media / Text`、`Editorial Section`。
   - `markdown hints belong to catalog entries`：`SLASH_MARKDOWN_HINTS` 的每个键都是 `SLASH_MENU_CATALOG` 里某一项的 `id`，每个值都是不为空的字符串。

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-14/step2-npm-test.log npm test
```

全部通过后提交 `WP-14: slash menu catalog`。

### 步骤 3：代码块

按 2.5 节实现（spec、扩展、复制按钮；样式按 2.12 节）。`npm run build` 通过后提交 `WP-14: code block highlighting and copy`。

### 步骤 4：公式

按 2.3 节实现公式区块、行内公式和对话框（样式按 2.12 节）。`npm run build` 通过后提交 `WP-14: katex equations`。

### 步骤 5：导出

按 2.11 节修改 `pageExport.js`。新建两个测试文件：

`tests/equation-export.test.mjs`：

- `equation blocks export to markdown and mathml`：页面内容 `[{ id: "eq", type: "equation", props: {}, content: [{ type: "text", text: "x^2", styles: {} }], children: [] }]` → `pageToMarkdown` 包含 `$$\nx^2\n$$`；`pageToStandaloneHtml` 包含 `<math`。
- `inline equations export to markdown and mathml`：段落里一个 `{ type: "inlineEquation", props: { expression: "a+b" } }` → Markdown 包含 `$a+b$`；HTML 包含 `<math`。
- `invalid latex does not throw during export`：源码 `\\frac{` → 两种导出都不抛异常。

`tests/editor-export-new-blocks.test.mjs`：

- `headings one to four export with matching hashes`：1–4 级标题分别输出 `# `、`## `、`### `、`#### ` 开头的行，HTML 有 `<h4>`。
- `toggle headings export as markdown headings`：`props: { level: 2, isToggleable: true }` 输出 `## ` 开头。
- `code blocks keep their language`：`{ type: "codeBlock", props: { language: "python" }, content: [{ type: "text", text: "print(1)", styles: {} }] }` 输出 "```python\nprint(1)\n```"。

提交 `WP-14: export headings and equations`。

### 步骤 6：前半部分检查点【停止点】

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-14/step6-npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-14/step6-build.log npm run build
node docs/blueprint/tools/run-logged.mjs .qa/WP-14/step6-browser.log npm run test:parity:browser
```

三个都通过后，报告第 0 节步骤 1–6 标为“完成”，提交 `WP-14: first half checkpoint`，运行 `node docs/blueprint/tools/wp-check.mjs WP-14 --until 6`，退出码 0 → **停止**。

### 步骤 7：`[[`、`+` 与页面选择框

按 2.4 节实现。提交 `WP-14: double brackets plus menu and page picker`。

### 步骤 8：区块菜单、复制、移动与区块链接

按 2.6 节实现。新建两个测试文件：

`tests/editor-links.test.mjs`：

- `lifeatlas page links are allowed`：`lifeatlas://page/p-a1#block-b-a1-h` 和 `lifeatlas://page/p-a1` 为真。
- `javascript links are rejected`：`javascript:alert(1)`、`JAVASCRIPT:alert(1)`、`data:text/html,x`、`file:///C:/a` 为假。
- `relative and web links stay allowed`：`https://example.com`、`mailto:a@b.c`、`#section`、`docs/a.md` 为真。
- `block links parse page and block ids`：解析结果 `{ pageId: "p-a1", blockId: "b-a1-h" }`；没有 `#block-` 时 `blockId` 为 `null`。
- `malformed block links are rejected`：`lifeatlas://page/`、`lifeatlas://page/a b`、`lifeatlas://other/x` 解析为 `null`。

`tests/block-moves.test.mjs`（`fullWorkspace()` 经 `upgradeWorkspace` 后使用）：

- `appending blocks keeps their ids and children`：把带一个子区块的区块追加到 `p-z1` → `p-z1` 的最后一个区块 ID 和子区块 ID 不变，`updatedAt` 等于传入的 `now`，`contentRevision` 加 1；其他页面的对象引用不变。
- `appending to a missing or trashed page is refused`：目标 `p-missing` 和 `p-b-solo` 都抛错 `目标页面不存在或已在回收站`。
- `duplicating a block gives fresh ids to it and its children`：`cloneBlockDocument` 结果的全部 ID（含子区块）都和原来不同，内容相同。

提交 `WP-14: block menu duplicate move and links`。

### 步骤 9：页内查找

按 2.7 节实现。新建 `tests/find-in-page.test.mjs`（只测 `findTextMatches`）：

- `matches are case insensitive and stay inside one unit`：`findTextMatches(["Alpha alpha", "ALPHA"], "alpha")` 返回 3 个；`findTextMatches(["ab", "c"], "bc")` 返回 0 个。
- `regular expression characters are literal`：`findTextMatches(["a.b axb"], "a.b")` 只返回 1 个，`start` 为 0。
- `an empty query finds nothing`：`""` 和 `"   "` 都返回空数组。

提交 `WP-14: find in page`。

### 步骤 10：快捷键面板

按 2.10 节实现。新建 `tests/shortcuts.test.mjs`：

- `every shortcut has a description and a verification note`：每项的 `group`、`keys`、`description`、`verify` 都是非空字符串，`group` 只能是导航、页面、编辑、插入之一。
- `no shortcut is listed twice`：`id` 和 `keys` 都不重复。

提交 `WP-14: shortcut panel`。

### 步骤 11：远程媒体

按 2.8 节实现。新建 `tests/remote-media.test.mjs`：

- `remote urls become a local placeholder`：`resolveEditorFileUrl("https://example.com/a.png")` 以 `data:image/svg+xml` 开头；`http://` 同样。
- `local asset blob and data urls pass through`：`life-asset://` 加 64 个 `a`、`blob:http://127.0.0.1:5178/x`、`data:image/png;base64,AA==` 原样返回。
- `the placeholder shows the host name and escapes it`：“解码”指 `decodeURIComponent(结果.slice("data:image/svg+xml;charset=utf-8,".length))`。`remotePlaceholderDataUrl("https://example.com/a.png")` 解码后包含 `example.com` 和 `外部内容（未加载）`；`https://a"b.example/x`（`new URL` 能解析，主机名是 `a"b.example`）解码后包含 `a&quot;b.example`，不包含 `a"b`；`https://exa mple.com/x`（主机名里有空格，`new URL` 会抛错，总设计师已在 Node 24.17 实测）解码后包含 `未知地址`。

提交 `WP-14: remote media placeholders`。

### 步骤 12：表格选项

按 2.9 节实现。提交 `WP-14: table header and color options`。

### 步骤 13：浏览器场景

新建 `tests/browser/wp14-editor.mjs`（种子：`fullWorkspace()`；`context.grantPermissions(["clipboard-read", "clipboard-write"])`；`browserScenario` 的第三个参数加 `viewport: { width: 1440, height: 900 }`）。下面说的“截图 `x`”一律写成 WP-12 的 `await shootBothModes(page, screenshot, "x")`，白天、夜间各一张。除第 1 项外，检查都在“A 子页面”（`p-a1-child`）里进行。下文说的“新起一行”“空行”一律用这个函数得到（写在场景文件里，照抄）：

```js
// 在当前页面正文的末尾得到一个空段落，并把光标放进去。
// 总设计师 2026-11-01 实测 BlockNote 0.54.2：最后一个区块不是空段落时，正文末尾有一个 .bn-trailing-block，
// 点它就会插入一个真正的空段落并把光标放进去；最后一个区块是代码块、页面链接、表格时也一样。
async function newEmptyLine(page) {
  const trailing = page.locator(".bn-editor .bn-trailing-block");
  if (await trailing.count()) { await trailing.last().click(); return; }
  await page.locator(".bn-editor > .bn-block-group > .bn-block-outer").last().locator(".bn-inline-content").first().click();
}
```

不要用“点击最后一个区块再按 `Enter`”的办法：最后一个区块是代码块时 `Enter` 只会在代码里换行，是页面链接时点击会跳到别的页面。也不要在含远程媒体的区块上按 `Ctrl+C` 或拖动它们（第 1 节：浏览器版会真的去请求远程地址）。检查项（标题照抄）：

1. `Slash menu shows the specified groups and finds blocks by alias`：打开“A 概览”，`await newEmptyLine(page)`，输入 `/` → 分组标题（`.bn-suggestion-menu-label`）按顺序是 `SLASH_GROUP_ORDER`，截图 `slash`（加 `{ keepVisible: ".bn-suggestion-menu" }`，和参照图同名）；再依次输入步骤 2 的 6 个英文别名和 5 个拼音别名：每次先按 `Escape`（菜单关闭，但打过的字还留在这一行），再按 `Shift+Home`、`Backspace` 清空这一行，然后输入 `/<别名>`，第一个选项（`[role="option"]` 的第一个）的文字包含期望的标题。最后同样按 `Escape`、`Shift+Home`、`Backspace` 清空这一行。
2. `Toggle headings fold and unfold`：`/th2` 回车，输入“折叠段”，`Enter` 后 `Tab` 输入“里面的内容”；点击该标题的 `.bn-toggle-button` → “里面的内容”不可见；再点 → 可见；`saved()` 里该标题 `props.isToggleable === true`、`level === 2`，“里面的内容”是它的子区块。
3. `Equations render and survive errors`：`/公式区块` 回车，输入 `\int_0^1 x^2 dx` → 出现 `.life-equation-rendered .katex`；截图 `equation`；把源码改成 `\frac{` → 页面上出现 KaTeX 的错误样式元素（`.katex-error`），没有 `pageerror`；`/行内公式` 回车，在对话框输入 `a^2+b^2`，`Ctrl+Enter` → 正文里出现 `.life-inline-equation .katex`。
4. `Code blocks highlight eight languages and copy`：插入 8 个代码块，每个用代码块顶部的 `<select>` 执行 `selectOption({ label })` 选一种语言，`label` 依次为 `JavaScript`、`TypeScript`、`Python`、`JSON`、`Shell`、`SQL`、`Rust`、`Java`（`codeBlockOptions` 里的显示名），每个输入一行该语言的代码（如 `const a = 1;`、`let b: number = 2;`、`print(1)`、`{"a": 1}`、`echo hi`、`SELECT 1;`、`fn main() {}`、`class A {}`），每个都等到代码里出现带 `style` 颜色的 `span`；把鼠标移到代码块上，点“复制代码” → `navigator.clipboard.readText()` 等于代码块文字。截图 `code-block`。
5. `Double brackets and plus create links`：输入 `[[Z 目标` → 选“Z 目标页” → 正文出现指向 `p-z1` 的页面提及；输入 `[[新页面X` → 选“新建页面「新页面X」” → `saved()` 里多了标题为“新页面X”、`parentPageId === "p-a1-child"` 的页面，正文有指向它的提及；截图 `double-bracket`（在选择之前截，加 `{ keepVisible: ".bn-suggestion-menu" }`）；空行输入 `+` → 选“新建子页面” → 出现页面链接块；在空行输入 `/链接到页面` 回车 → 页面选择框里输入“C 深层”并点击 → 链接块显示“C 深层”。
6. `Duplicate move and link blocks`：输入段落“移动我”，按 `Ctrl+D` → 下面出现第二个“移动我”，两个 ID 不同；打开第二个的区块菜单（悬停后点“打开菜单”）→“移动到…”→ 搜“Z 目标页”并点击 → `persisted()` 里 `p-z1` 最后一个区块文字是“移动我”且 ID 与移动前相同，`p-a1-child` 里只剩一个“移动我”；对剩下的“移动我”点“复制区块链接”→ 剪贴板是 `lifeatlas://page/p-a1-child#block-<它的 ID>`；到“B 笔记”新起一行，按第 9 项的方法派发一个只有 `text/html` 的粘贴事件，内容 `<p><a href="<剪贴板里的地址>">跳转</a></p>` → `saved()` 里这一段有一个 `href` 等于该地址的链接（说明 `isValidLink` 放行了它）→ 点击“跳转” → 打开“A 子页面”，该区块带 `is-link-target` 类名。
7. `Find in page counts and moves between matches`：在“A 子页面”输入三行“查找词一”“第二个查找词”“查找词”；按 `Ctrl+F` → 输入“查找词” → `find-count` 显示 `1/3`，`CSS.highlights.get("la-find").size === 3`；`Enter` → `2/3`；`Shift+Enter` → `1/3`；输入“不存在的词” → `0/0`；`Esc` → 查找条消失，`CSS.highlights.has("la-find") === false`。截图 `find-bar`（`1/3` 时截，加 `{ keepVisible: '[role="search"]' }`）。
8. `The shortcut panel lists only working shortcuts`：`Ctrl+/` 打开面板，截图 `shortcuts`；面板里的行数等于 `SHORTCUTS.length`；关闭后逐项按 `verify` 触发并检查效果：`search`、`quick-capture`、`back`、`toggle-sidebar`、`find`、`undo`、`redo`、`bold`、`italic`、`duplicate`、`slash`、`page-link`（12 项，每项一段代码，检查完恢复原状，例如关闭对话框、再按一次 `Ctrl+\`）。
9. `Markdown and HTML paste become blocks`：在空行用 `page.evaluate` 派发一个 `paste` 事件（`new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })`，`dt = new DataTransfer()`），`text/plain` 为 `"## 粘贴标题\n\n- 列表一\n- 列表二\n\n```js\nconst x = 1;\n```"` → 出现 2 级标题、2 个项目符号、1 个 `language === "js"` 或 `"javascript"` 的代码块；再派发一个只有 `text/html` 的事件，内容 `<p>网页段落</p><img src="https://example.com/x.png">` → 出现段落和图片区块，图片的 `src` 以 `data:image/svg+xml` 开头。
10. `Emoji picker inserts an emoji`：输入 `:sm` → 出现表情网格（`.bn-grid-suggestion-menu`）→ 按 `Enter` → 段落里多了一个表情字符，`:sm` 文字不在了。
11. `Tables offer header rows and cell colors`：插入表格 → 打开表格区块菜单 → 有“行标题”和“列标题”；点“行标题”→ `saved()` 里表格的 `content.headerRows === 1`。
12. `Existing editor features still work`：在“A 子页面”插入 2 列、选项卡、同步区块、`@` 提及各一次，每种只检查 `saved()` 里出现了对应类型的区块或行内内容（详细行为已由 `phase1-editor` 场景覆盖）。

截图都在上面的检查里白天、夜间各截一张，不再另外单独截一组。

加入 `tests/core-parity-browser.mjs` 的 `scenarios` 末尾，单独运行：

```powershell
$env:PARITY_ONLY = "wp14-editor"
node docs/blueprint/tools/run-logged.mjs .qa/WP-14/browser-wp14.log npm run test:parity:browser
Remove-Item Env:PARITY_ONLY
```

通过后生成对照图：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-14/compare.log node docs/blueprint/tools/compare-shots.mjs docs/blueprint/design/mobai/shots .qa --prefix wp14-editor- --only slash --out .qa/WP-14/compare
```

退出码 0。原型的斜杠菜单只画了几项、背后的页面也不同，差异占比只供参考；把 `summary.md` 复制进报告第 3 节，并写出你看到的不同之处。其余截图没有参照图：对照 `design/mobai/product-shots/sample-page-*` 看区块的样子是否一致，也写进报告第 3 节。提交 `WP-14: editor browser scenario`。

### 步骤 14：桌面端到端

新建 `tests/desktop/editor.e2e.mjs`（每个用例：临时数据目录 → `seedWorkspaceDatabase(dataRoot, 工作区)` → `launchApp({ dataRoot })`；最后 `assertNoNetworkAndErrors`）：

- `remote media never reaches the network`：工作区 = `upgradeWorkspace(fullWorkspace())`，并在 `p-a1-child` 的内容末尾加 4 个区块：`image`（`https://example.com/a.png`）、`video`（`https://example.com/a.mp4`）、`audio`（`https://example.com/a.mp3`）、`file`（`https://example.com/a.pdf`）；打开“A 子页面”，等 4 个区块都出现；再按第 13 步第 9 项的方法粘贴含 `<img src="https://example.com/x.png">` 的 HTML；等 2 秒 → `readNetworkLog` 的 `completed` 和 `blocked` 里都没有包含 `example.com` 的地址。`allowedUrls: []`。
- `copying remote media stays on this computer`：同上一个用例的工作区；打开“A 子页面”，点击文字“子页面正文”，按 `Ctrl+A`、`Ctrl+C`，等 2 秒 → `readNetworkLog` 的 `completed` 里没有包含 `example.com` 的地址（复制时 BlockNote 会用原地址生成剪贴板 HTML，第 1 节；桌面版的 CSP 必须把它们挡下）。`allowedUrls: ["https://example.com/a.png", "https://example.com/a.mp4", "https://example.com/a.mp3", "https://example.com/a.pdf"]`（CSP 拦截会产生包含这些地址的控制台错误，这是预期的）。
- `code highlighting and equations work under the desktop CSP`：插入 JavaScript 代码块并输入 `const a = 1;` → 出现带颜色的 `span`；插入公式区块 `\frac{1}{2}` → 出现 `.katex`；输入 `:sm` → 出现表情网格；控制台没有任何 `Content Security Policy` 错误（由 `assertNoNetworkAndErrors` 检查）。截图 `desktop-editor`（WP-05 的 `shootWindowBothModes`，放 `.qa/WP-14/shots/`，白天、夜间各一张）。
- `slash menu scrolls to the last item anywhere in the window`（第 1 节最后一行的问题，必须在 Electron 的真实窗口里测）：工作区 = `upgradeWorkspace(fullWorkspace())`；`handle.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))`；打开“A 概览”，在最后一个区块下方 20 px 处单击（得到一个空行，光标在窗口下半部分），输入 `/`，等 500 ms。断言写成一个函数，下面三种操作各用一次：菜单 `.bn-suggestion-menu` 的下边不超出窗口；`scrollTop ≥ scrollHeight − clientHeight − 1`；最后一个 `[role="option"]` 完整地在菜单的可见区域里。三种操作：① 鼠标移到菜单中间，`page.mouse.wheel(0, 200)` 40 次（每次间隔 50 ms）；② 先 `scrollTop = 0`，再从滚动条顶部（菜单右边往里 4 px、顶部往下 16 px）按住，每次 4 px 拖到菜单底部，松开；③ 按 `Escape` 关掉菜单，滚动页面让“A 概览”的第一个区块在窗口上方 150 px 处，在它的行尾按 `End`、`Enter`、输入 `/`（菜单在光标下面、空间充足），再做一次 ①。打开菜单时用 `ResizeObserver` 记下菜单高度变化了几次，`console.log` 输出 `WP14_SLASH_RESIZES=`。
- `double clicking remote media asks before opening`：同第一个用例的工作区；`queueDialogResponse(handle, "showMessageBox", { response: 0 })` → 双击图片占位图 → `readDialogCalls` 里有一次 `showMessageBox`（`options.detail` 是 `https://example.com/a.png`）和一次 `openExternal`（地址相同）。

运行：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-14/build.log npm run build
node docs/blueprint/tools/run-logged.mjs .qa/WP-14/desktop-build-test.log npm run desktop:build:test
node docs/blueprint/tools/run-logged.mjs .qa/WP-14/desktop-e2e.log npm run test:e2e:desktop
```

全部通过后提交 `WP-14: editor desktop tests`。

### 步骤 15：收尾【停止点】

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-14/npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-14/browser-all.log npm run test:parity:browser
```

填完报告；第 0 节全部“完成”；提交 `WP-14: complete report`；运行 `node docs/blueprint/tools/wp-check.mjs WP-14 --browser --desktop`，退出码 0 或 2 → 停止。

## 5. 验收标准

| 编号 | 标准 | 证据 |
| --- | --- | --- |
| AC-14-1 | 斜杠菜单分组、顺序、标题与 2.1 节一致；英文别名 6 个、拼音首字母 5 个、旧标题 8 个搜索用例都通过 | `tests/slash-menu.test.mjs`；场景检查 1；`.qa/wp14-editor-slash-*.png` |
| AC-14-2 | 折叠标题可以创建、折叠、展开；1–4 级标题与折叠标题导出为对应的 Markdown 标题 | 场景检查 2；`tests/editor-export-new-blocks.test.mjs` |
| AC-14-3 | 公式区块与行内公式用 KaTeX 排版；错误公式不崩溃；Markdown 与 MathML 导出正确 | 场景检查 3；`tests/equation-export.test.mjs` |
| AC-14-4 | 代码块高亮 JavaScript、TypeScript、Python、JSON、Shell、SQL、Rust、Java；复制按钮把代码放进剪贴板；桌面版 CSP 下高亮正常 | 场景检查 4；「code highlighting and equations work under the desktop CSP」 |
| AC-14-5 | `[[` 插入页面提及和新建子页面；`+` 新建子页面；“链接到页面”的页面选择框可用 | 场景检查 5 |
| AC-14-6 | `Ctrl+D` 复制（新 ID）；移动到其他页面后原 ID 保留、两页内容都正确；复制区块链接后点击能跳转并高亮 | 场景检查 6；`tests/block-moves.test.mjs`；`tests/editor-links.test.mjs` |
| AC-14-7 | 页内查找的计数、上一个/下一个、无匹配、关闭都正确 | 场景检查 7；`tests/find-in-page.test.mjs` |
| AC-14-8 | 快捷键面板列出的就是 `SHORTCUTS`；其中 12 项逐项触发验证 | 场景检查 8；`tests/shortcuts.test.mjs` |
| AC-14-9 | 粘贴 Markdown 和 HTML 变成区块，远程图片显示占位图 | 场景检查 9 |
| AC-14-10 | 远程图片、视频、音频、文件和粘贴进来的远程图片，在桌面版打开和粘贴时不产生任何请求（包括被拦截的请求）；复制含远程媒体的区块时没有任何请求真正发出；双击占位图经确认后才打开 | 「remote media never reaches the network」；「copying remote media stays on this computer」；「double clicking remote media asks before opening」；`tests/remote-media.test.mjs` |
| AC-14-11 | 表情选择器可用；表格可设置行标题 | 场景检查 10、11 |
| AC-14-12 | 现有编辑器功能与全部现有测试仍然通过；只改了步骤 2 规定的两行测试 | 场景检查 12；`.qa/WP-14/npm-test.log`；`.qa/WP-14/browser-all.log`；报告第 4 节 |
| AC-14-13 | 视觉：新界面照墨白做（2.12 节）；截图：斜杠菜单、公式、代码块、`[[` 菜单、查找条、快捷键面板、桌面编辑器，白天和夜间各一张；斜杠菜单与参照图并排对照；白天的代码高亮用的是浅色主题的颜色 | `.qa/wp14-editor-*.png`；`.qa/WP-14/shots/desktop-editor-*.png`；`.qa/WP-14/compare/summary.md`；报告第 3 节 |
| AC-14-14 | 斜杠菜单在窗口任何位置打开，滚轮和拖滚动条都能滚到最后一项（真实窗口里测） | 「slash menu scrolls to the last item anywhere in the window」；报告第 5 节写明用的做法 |
| AC-14-15 | G1–G9 | `.qa/WP-14/wp-check.md` |

## 6. 卡点处理

| 情况 | 做法 |
| --- | --- |
| `createCodeBlockSpec`、`syntaxHighlighter` 或其他 BlockNote 接口的用法和本文件不一致 | 以 `node_modules/@blocknote/*/types/src/` 里的 `.d.ts` 为准，改成能用的写法，写进报告第 5 节；行为要求不变 |
| 加了 `codeBlock` 的 spec 后旧页面的代码块不显示 | 旧数据的 `language` 可能是空字符串或不在列表里的值：在 `normalizeLoadedWorkspace` 之外不要改数据，改为把 `defaultLanguage` 设成 `"text"` 并确认 `text` 在 `supportedLanguages` 里；仍不行就停下报告 |
| 「slash menu scrolls to the last item…」失败：滚轮或拖滚动条停在离底部几百 px 的地方 | 按这个顺序换做法，每换一种都重跑这个用例：① 检查 2.2 节的 `floatingUIOptions` 真的传给了全部 4 个 `SuggestionMenuController`，并看 `WP14_SLASH_RESIZES`：打开后高度还在变，说明菜单先按别的位置排了一次；② 在自己的 middleware 里，光标位置没算出来之前把 `maxHeight` 设成 `0px` 并 `visibility: hidden`，决定以后再显示；③ 给 `SuggestionMenuController` 传自己的 `suggestionMenuComponent`（照抄 BlockNote 默认菜单的结构和类名，样式不变），列表外层的 `key` 用当前 `maxHeight` 取整，高度一变就换一个新的滚动元素；④ 最后才用：在菜单上加不被动的 `wheel` 监听，`preventDefault()` 后自己改 `scrollTop`（只能修滚轮，拖滚动条要另外处理，写进报告第 7 节）。不要改测试去绕开 |
| 选中 `[[` 菜单项后留下了 `[[` 字符 | 说明菜单是用 `openSuggestionMenu` 打开的而不是输入触发的；`[[` 必须由 `SuggestionMenuController triggerCharacter="[["` 处理，不要自己写输入监听 |
| `+` 在非空行也会弹出菜单 | 检查 `shouldOpen` 是否传给了 `SuggestionMenuController`，判断条件照抄 2.4 节 |
| 代码高亮在桌面版报 CSP 错误 | 停下报告，**不要**放宽 CSP |
| `CSS.highlights` 是 `undefined` | Electron 44 和 Playwright 的 Edge 都支持；出现这种情况说明代码跑在了别的环境里，停下报告 |
| 现有浏览器场景因为斜杠菜单标题变化而失败 | 先确认失败的是“用标题找菜单项”的代码；只允许把找法改成新标题（执行手册 4.5 节第 1 条），断言不变，报告第 4 节写明 |
| 区块菜单里看不到“行标题”“列标题” | 只有表格区块才显示；确认 `tables.headers` 为 `true` |
| 白天的代码块里有的字看不清（浅色的字） | 漏了 2.12 节 `data-theme="light"` 的 `.shiki` 规则：BlockNote 默认用深色主题的高亮颜色 |
| `tests/theme-files.test.mjs` 报 `main.jsx` 的导入顺序不对 | `katex.min.css` 要放在 `theme-tokens.css` 那一行之后（2.3 节），墨白的 `index.css` 仍然在最后 |
| 切换模式后斜杠菜单或查找条关掉了，`keepVisible` 等不到 | 这个画面改成分两次截：`page.emulateMedia({ colorScheme: "light" })` 后打开，`screenshot("<名字>-light")`，关掉；`emulateMedia({ colorScheme: "dark" })` 后再打开，`screenshot("<名字>-dark")`；最后切回 `light`；写进报告第 5 节 |
