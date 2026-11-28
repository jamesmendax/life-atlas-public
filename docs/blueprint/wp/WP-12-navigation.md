# WP-12 导航补齐（schema v14）

- 规模：M · 前置：WP-11 · 分支：`wp/12-navigation`
- 停止点：只有收尾（步骤 12）
- 必读：`01-需求与范围.md` 第 3.4 节与 D-04；`AGENTS.md`（侧栏与 Folder/Page 规则）；`11-接口契约.md`（`app.onNavigate`）；`09-执行手册.md`；源码 `src/App.jsx`（第 174–192 行的 `recentItems`、`teamspaces`、`sectionMeta`；`HomeView`、`RecentsView`、`TeamspacesView`；`openPage`、`openFolder`；`ContextMenu`）、`src/components/WorkspaceSidebar.jsx`、`src/components/WorkspaceTopbar.jsx`、`src/components/PageActionsMenu.jsx`；`12-视觉规范-墨白.md` 第 0、3、6、7、8 节和 1.5 节列出的参照画面；WP-20 加的顶栏“切换白天/夜间”按钮（`WorkspaceTopbar.jsx` 的 `header-theme-toggle`）和场景 `tests/browser/wp20-mobai.mjs`

## 0. 一页纸

- **要做到**：侧栏和首页不再有假数据和空按钮——真实的最近访问、收藏、首页、工作区菜单、Private“更多”菜单、侧栏拖拽、后退/前进、可调宽度和折叠的侧栏；移除 Teamspaces。
- **交付物**：schema v14；`src/domain/recents.js`、`favorites.js`、`home.js`、`navigationHistory.js`；改造后的侧栏、首页、最近访问、工作区菜单、顶栏（墨白样式 `src/ui/themes/mobai/home.css`、`navigation.css`）；单元测试；浏览器场景 `wp12-navigation`；桌面端到端用例（鼠标侧键）；白天和夜间的截图与对照图。
- **绝对不要**：在菜单里放还没实现的菜单项；做多标签页或新窗口打开页面；做设置页（WP-17）或快速记录与收件箱（WP-13）；新增依赖（拖拽用浏览器原生的 HTML5 拖放）；去掉、移动或改名顶栏的“切换白天/夜间”按钮（WP-20）；在旧 CSS 里写颜色（K13 会检查）。
- **什么时候停**：步骤 12 的 wp-check 退出码为 0 或 2。

## 1. 设计要点（规定）

### 1.1 schema v14

`migrateNavigationState(input)`（链在 `migrateStatusGroups` 之后）：`ui.recentVisits` 不是数组时设为 `[]`；`ui.favoritePageIds` 不是数组时设为 `[]`；`ui.sidebarWidth` 不是 200–480 的数字时设为 `248`；其他不动；`schemaVersion = 14`。`ui.workspaceName`（默认 `"medax的工作空间"`）、`ui.workspaceIcon`（默认 `null`）、`ui.sidebarCollapsed`（默认 `false`）不进迁移，读取时补默认值。

### 1.2 侧栏顺序（从上到下）

工作区菜单 → 搜索 →（WP-13 的“快速记录”）→ Home →（WP-13 的“收件箱”）→ Recents → 收藏（有收藏时才显示）→ Private → 底部组：模板、密钥库、回收站。

### 1.3 纯函数

```js
// src/domain/recents.js
export function recordVisit(ui, pageId, visitedAt)          // → 新 ui：同一页面只保留最新一次，最新在前，最多 100 条
export function recentGroups(workspace, nowMs)              // → [{ label: "今天"|"昨天"|"过去 7 天"|"更早", entries: [{ pageId, title, icon, iconColor, path, visitedAt }] }]
                                                            //   跳过不存在或在回收站的页面；空分组不返回；按本地日期分组
// src/domain/favorites.js
export function toggleFavorite(ui, pageId)                  // → 新 ui
export function moveFavorite(ui, pageId, toIndex)           // → 新 ui
export function favoritePages(workspace)                    // → 页面数组（按收藏顺序，跳过不存在或在回收站的）
// src/domain/home.js
export function greeting(nowMs)                             // 本地时间 5:00–10:59 “早上好”，11:00–17:59 “下午好”，其余“晚上好”
export function upcomingRecords(workspace, todayString, days = 7)
// → [{ date, title, sourceTitle, pageId }]：所有数据源的日期属性里，start 在 [今天, 今天+days) 的记录（页面不在回收站），按日期升序，同一天按标题
// src/domain/navigationHistory.js
export function createHistory()                             // → { entries: [], index: -1 }
export function pushLocation(history, location)             // location: { section, pageId?, folderId? }；与当前位置相同则不变；截断“前进”部分；最多 50 条
export function goBack(history, isValid) / goForward(history, isValid)   // → { history, location | null }；跳过 isValid(location) 为假的条目
```

### 1.4 行为

- **最近访问**：`openPage` 后 1 秒，如果当前页面仍是它，调用 `recordVisit`。Recents 视图用 `recentGroups`：每行图标、标题、路径、时间（今天和昨天写 `HH:mm`，其他写 `M月D日`）；点击打开。删除 `recentItems` 常量。
- **收藏**：页面操作菜单（⋯）增加“添加到收藏 / 从收藏移除”；侧栏页面右键菜单增加同名项；侧栏“收藏”分组列出 `favoritePages`，可以拖动排序，右键菜单有“上移”“下移”（键盘可用的替代方式）。
- **首页**（`HomeView` 改写，没有内容的区块不渲染）：
  1. 刊头（12 第 8 节）：居中，第一行是今天的日期“<M>月<D>日 星期<X>”（例如“11月1日 星期日”，写成 `<div class="home-date">`），下面是问候 `<greeting>，<workspaceName>`，再下面是一行灰色说明“未来 7 天有 <N> 件事到期。”（N 是第 4 项“即将到来”的条数，为 0 时不显示这一行）；
  2. 最近访问：最近 6 个页面排成一排小卡片（图标、标题、修改时间；原型一排正好 6 张）；
  3. 收藏：最多 8 个；
  4. 即将到来：`upcomingRecords` 的结果，每行日期、标题、数据库名称，点击打开记录页面；
  5. 快速操作：“新建页面”（放到当前选中的文件夹，没有就第一个顶层文件夹）、“打开模板库”；桌面版且 `backup.getStatus().lastFullBackupAt` 为空或早于 7 天前时，加一行“已经 N 天没有导出完整备份了”（为空时“还没有导出过完整备份”）和“立即备份”按钮（打开“备份与恢复”对话框）。
- **工作区菜单**（左上角按钮的菜单，WP-02 起只有“备份与恢复…”；参照 `design/mobai/shots/menu-*`）：头部显示图标与名称，下面一条细线；菜单项依次为“重命名工作区…”（对话框：名称 1–60 字符 + 图标（一个 emoji，可留空））、“备份与恢复…”、“打开数据目录”（只在桌面版出现）、“关于 Life Atlas”（对话框：应用版本；桌面版另有 Electron/Chrome/Node 版本与数据目录；第三方组件与许可证列表：React（MIT）、BlockNote（MPL-2.0）、Mantine（MIT）、Tabler Icons（MIT）、JSZip（MIT）、jsPDF（MIT）、html2canvas（MIT）、Electron（MIT）、DM Sans 字体（OFL-1.1）、思源黑体和思源宋体（Noto Sans SC、Noto Serif SC 字体，OFL-1.1）、hash-wasm（MIT）、yazl/yauzl（MIT）、SecLists 常见密码表（MIT）、EFF 口令词表（CC BY 3.0 US））。工作区图标为空时头像显示名称的第一个字。“备份与恢复…”之前和“关于 Life Atlas”之前各有一条分隔线（`role="separator"`，不是菜单项）；“关于”对话框里的版本和许可证列表用网格表格（12 第 8 节的“表格”，样式见 1.5 节）。
- **Private“更多”菜单**（现在没有动作的那个 `⋯`）：新建页面、新建文件夹（顶层）、展开全部、折叠全部。
- **侧栏拖拽**（浏览器原生 HTML5 拖放）：页面行和文件夹行 `draggable`；`dataTransfer` 用类型 `application/x-life-atlas-node`，值 `JSON.stringify({ kind, id })`；
  - 拖到文件夹行的中间区域（行高的 25%–75%）→ 移入该文件夹（页面改 `folderId`；文件夹用 WP-01 的 `moveFolder`，非法目标 `dropEffect = "none"` 并显示禁止光标）；
  - 拖到同一文件夹内某行的上 25% 或下 25% → 在它之前或之后插入（只允许同类同级），落下后把这一组兄弟的 `sortIndex` 重排为 10、20、30…；
  - 文件夹拖到“Private”标题行 → 移到顶层；
  - 拖动时显示 2 px 的插入线或目标高亮；`Esc` 取消（原生行为）。
  - 键盘替代：页面和文件夹右键菜单里的“移动到…”（已有）。
- **后退 / 前进**：`App` 维护 `navigationHistory`；`openPage`、`openFolder`、切换到 Home/Recents/回收站时 `pushLocation`（模板库、搜索等对话框不算）；顶栏最左侧两个按钮（`aria-label` 为“后退”“前进”，不可用时禁用；图标是向左、向右的箭头）；快捷键 `Alt+←`/`Alt+→` 与 `Ctrl+[`/`Ctrl+]`；桌面版：主进程给工作区窗口监听 `app-command`，`browser-backward`/`browser-forward` 时发 `la:app:navigate`，preload 增加 `app.onNavigate(callback)`（11 第 1 节）。顶栏右边 `.header-actions` 里 WP-20 加的“切换白天/夜间”按钮（`header-theme-toggle`，`aria-label="切换白天/夜间"`，在搜索按钮前面）原样保留，WP-20 的场景 `wp20-mobai` 必须仍然通过。
- **侧栏宽度与折叠**：侧栏右边缘 4 px 的拖动条（`role="separator"`，`aria-orientation="vertical"`，`aria-label="调整侧栏宽度"`），拖动范围 200–480 px，松手时写入 `ui.sidebarWidth`；`Ctrl+\` 切换 `ui.sidebarCollapsed`；折叠后左上角保留一个“展开侧栏”按钮。
- **移除 Teamspaces**（D-04）：删除 `teamspaces` 常量、`TeamspacesView`、`sectionMeta.teamspaces`、`activeSection === "teamspaces"` 分支、侧栏的 Teamspaces 行和“medax的工作空间 总部”行。总设计师已核对：现有测试里没有任何关于 Teamspaces 的断言。

### 1.5 墨白样式（规定）

- **参照画面**：主页 `design/mobai/shots/home-light.png`、`home-dark.png`（原型 `design/mobai/prototype/index.html#view=home&mode=light`，夜间把 `light` 换成 `dark`）；工作区菜单 `menu-light.png`、`menu-dark.png`（`#view=menu`）。侧栏、顶栏原有的部分 WP-20 的主题已经做好（`design/mobai/product-shots/`），本 WP 新加的东西照这些画面补。原型**只看不改**。
- **样式文件**：主页写在新文件 `src/ui/themes/mobai/home.css`；其余（顶栏的后退/前进、收藏分组、侧栏宽度拖动条、拖拽的插入线、工作区菜单头部、“重命名工作区”“关于”对话框里的内容）写在新文件 `src/ui/themes/mobai/navigation.css`；在 `src/ui/themes/mobai/index.css` 末尾追加两行 `@import "./home.css";`、`@import "./navigation.css";`（只能追加，前 8 行不动，WP-20 的 `tests/theme-files.test.mjs` 会检查）。规则照原型 `b-more.css` 的 “home”“dialogs, scrims, menus”“small parts” 几段改写：每个选择器前加 `:root[data-style="mobai"] `，变量按 12 第 0 节的对应表换名，只用 `--mb-*` 变量；旧 CSS 里不写颜色（K13）。
- **主页的类名一律用 `home-` 开头**：原型的 `.home` 改叫 `.home-page`，`.recent-row`、`.recent-card`、`.recent-icon` 改叫 `.home-recent-row`、`.home-recent-card`、`.home-recent-icon`，`.list`、`.list-row` 改叫 `.home-list`、`.home-list-row`，`.actions` 改叫 `.home-actions`，`.notice` 改叫 `.home-notice`；`.home-masthead`、`.home-date`、`.home-hello`、`.home-section`、`.home-title`、`.home-title-gap`、`.home-cols` 照抄。原因：旧的 `src/styles.css` 给 `.home-view` 写了两栏网格，WP-20 的 `views.css` 给 `.recent-card` 定了 10 px 圆角和阴影，`.page-view h1` 是 40 px 的 `!important`——所以新首页的外层**不要**再用 `.home-view`、`.page-view`、`.page-heading`。
- **主页的细节**（数值照原型 `b-more.css` 的 “home” 一段）：`.home-page` 最宽 900 px、水平居中，内边距 64 px 48 px 90 px。刊头居中，下面没有分隔线：日期 14 px `--mb-muted`，和问候隔 8 px；问候 30 px 700（行高 1.25）；灰色说明 14 px `--mb-muted`，和问候隔 6 px。每个区块上面空 32 px；区块标题（“最近访问”“即将到来”“收藏”“快速操作”）是 14 px 500 `--mb-muted` 的小字，下面没有线，离内容 10 px；标题右边一行 12 px `--mb-faint` 的附注照原型写：“最近访问”是 `IconClock` 图标加“按时间排列”，“即将到来”是“未来 7 天”，“收藏”是“<N> 个页面”。“最近访问”是一排 6 张小卡片（`.home-recent-row`：6 等分，间隔 12 px）：每张最矮 136 px、圆角 12 px、`--mb-raised` 底、`--mb-card` 阴影，左右和底部内边距 12 px；顶部一条 42 px 高的 `--mb-side` 色块（`.home-recent-card::before`）；26 px 的页面图标压在色块下沿（`.home-recent-icon` 的 `margin: -14px 0 4px`）；下面是 14 px 600 `--mb-ink` 的标题和贴着卡片底边的 12 px `--mb-faint` 时间；悬停时阴影外再加一圈极淡的线（`0 0 0 1px rgba(var(--mb-ink-rgb), 0.08)`）。再下面分左右两栏（`.home-cols`：宽度 1.25 : 1，间隔 36 px）：左栏“即将到来”，右栏“收藏”，“快速操作”接在“收藏”下面、隔 24 px（`.home-title-gap`）。“即将到来”“收藏”是悬停有 `--mb-hover` 灰底的列表（`.home-list-row`：高 36 px、左右 8 px、圆角 6 px，行之间没有线）；“即将到来”每行的日期 13 px `--mb-muted`、宽 62 px、`tabular-nums`，标题 14 px 500 `--mb-ink`（太长时显示省略号），数据库名称 12 px `--mb-muted`；“收藏”每行前面是 18 px 的页面图标。“新建页面”“打开模板库”是次按钮（原型 `.btn-line`：高 28 px、圆角 6 px、1 px `--mb-line-2` 描边，前面分别是 `IconPlus`、`IconTemplate` 图标），两个按钮隔 8 px；“已经 N 天没有导出完整备份了”一行是原型的 `.notice`（`--mb-side` 底、圆角 8 px、内边距 12 px 14 px，前面一个 `IconArchive` 图标），“立即备份”是原型的 `.btn-link`（14 px `--mb-accent` 蓝字，靠右，悬停加下划线）。
- **顶栏的后退/前进**：按钮类名 `header-nav-button ui-icon-button`，样式和 WP-20 的 `.header-theme-toggle` 一样（28×28、圆角 6 px、透明底、`--mb-muted`，悬停时 `--mb-hover` 底、`--mb-ink` 字；原型 `.top-btn`），图标是 18 px 的 `IconChevronLeft`、`IconChevronRight`（原型 `.hist`），禁用时 `opacity: 0.35`；两个按钮之间 2 px，后面隔 8 px 是路径。
- **工作区菜单**（原型 `.ws-menu`）：用产品现有的 `ui-popover ui-menu`（WP-20 已经写好底色、阴影、10 px 圆角和菜单项）；本 WP 只补宽度 280 px、头部、菜单项的图标和分隔线。头部照原型 `.menu-head`：内边距 8 px 8 px 10 px，下面 1 px `--mb-line` 细线，和第一项隔 4 px；工作区图标和侧栏里 WP-20 的 `.workspace-avatar` 一样（22 px、圆角 4 px 的 `--mb-ink` 底方块，`--mb-paper` 色 12 px 600 字），和名称隔 10 px；名称 14 px 600 `--mb-ink`。每个菜单项前面一个 17 px 的 `--mb-muted` 图标（照原型：“重命名工作区…”`IconPencil`、“备份与恢复…”`IconArchive`、“打开数据目录”`IconFolderOpen`、“关于 Life Atlas”`IconInfoCircle`）。分隔线照原型 `.menu-sep`：1 px `--mb-line`，上下各 4 px。
- **拖拽**：插入线 2 px `--mb-accent`（和 WP-15 拖动列时的插入线一样）；拖到文件夹行中间时整行 `--mb-accent-soft` 浅蓝底，不加描边；侧栏宽度拖动条平时看不见，悬停时显示 2 px `--mb-line-2` 竖线，拖动时变成 `--mb-accent`；折叠后的“展开侧栏”按钮和后退/前进按钮同样式。
- **收藏分组**的小标题沿用“Private”分组标题的类名（WP-20 的 `shell.css` 已经写好）。
- **Recents 视图**：沿用现在的 `.recents-view` 外层和 `.recent-list`/`.recent-card` 行（WP-20 已经写好样式）；新增的分组标题（“今天”“昨天”……）和主页的 `.home-title` 一样：14 px 500 `--mb-muted`，下面没有线，离下面的行 10 px。
- **对话框**（“重命名工作区…”“关于 Life Atlas”）：外壳沿用产品的 `.modal-backdrop` + `.ui-dialog`（WP-20 已写好遮罩、12 px 圆角、阴影和 16 px 600 的标题）；输入框是 12 第 6 节的输入框（加上 WP-20 `base.css` 里的 `.mb-field` 类：`--mb-field` 底、一圈 1 px `--mb-field-line`、圆角 6 px，聚焦时 `--mb-focus` 光圈），高 32 px；“关于”里的版本和许可证列表是 12 第 8 节的网格表格：表头和每一行之间 1 px `--mb-line` 横线，列之间 1 px 竖线，第一列左边、最后一列右边不画线；表头 14 px 400 `--mb-muted`，每行高 34 px、左右 8 px、14 px `--mb-ink`（和原型 `.db-table` 一样，没有属性类型图标）；按钮靠右，次按钮在左、主按钮在右（WP-20 `base.css` 的 `.ghost-button`、`.primary-button` 已经是这个样子：高 32 px，主按钮是 Notion 蓝）。

## 2. 执行步骤

### 步骤 0：开工准备

按执行手册 3.1 节开工（分支 `wp/12-navigation`），生成报告骨架，跑基线 `npm test`。理解题：

1. 打开一个页面后立刻切走，它会出现在最近访问里吗？
2. 把文件夹 A 拖到它自己的子文件夹上会怎样？
3. 后退时遇到一个已经进了回收站的页面会怎样？

提交 `WP-12: step 0 understanding`（本步不停）。

### 步骤 1：schema v14

按 1.1 实现。新建 `tests/migration-v14.test.mjs`（直接调用 `migrateNavigationState`）：`v14 adds navigation state defaults`、`v14 keeps existing valid values`、`v14 clamps an invalid sidebar width`、`v14 is idempotent`。提交 `WP-12: schema v14`。

### 步骤 2：纯函数

按 1.3 实现 4 个模块。新建 `tests/navigation-domain.test.mjs`：

- `recordVisit keeps the newest visit per page and at most one hundred`
- `recentGroups splits today yesterday last week and earlier and skips trashed pages`（用固定的 `nowMs`，构造 4 个分组各一条，再加一条在回收站的）
- `favorites toggle and reorder`
- `greeting follows the local hour`（5:00、10:59、11:00、17:59、18:00、4:59）
- `upcoming records include the next seven days only`（3 天后的记录出现，10 天后的不出现，回收站里的不出现）
- `history push back and forward skip invalid locations`

提交 `WP-12: navigation domain functions`。

### 步骤 3：移除 Teamspaces 与侧栏顺序

按 1.4 最后一条与 1.2 实现。新建 `tests/navigation-no-teamspaces.test.mjs`：`teamspaces is gone from the app and the sidebar`（读取 `src/App.jsx` 与 `src/components/WorkspaceSidebar.jsx` 源码，不包含 `Teamspaces`、`团队空间`、`teamspaces`）。提交 `WP-12: remove teamspaces`。

### 步骤 4：最近访问与收藏

按 1.4 前两条实现。提交 `WP-12: real recents and favorites`。

### 步骤 5：首页

按 1.4 第 3 条和 1.5 节实现（样式写在 `home.css`）。提交 `WP-12: home view`。

### 步骤 6：工作区菜单与 Private 更多菜单

按 1.4 第 4、5 条和 1.5 节实现。提交 `WP-12: workspace and private menus`。

### 步骤 7：侧栏拖拽

按 1.4 第 6 条和 1.5 节的“拖拽”实现。提交 `WP-12: sidebar drag and drop`。

### 步骤 8：后退与前进

按 1.4 第 7 条实现（含主进程 `app-command` 与 preload `app.onNavigate`；按钮样式见 1.5 节）。提交 `WP-12: back and forward navigation`。

### 步骤 9：侧栏宽度与折叠

按 1.4 第 8 条实现。提交 `WP-12: resizable and collapsible sidebar`。

### 步骤 10：浏览器场景

先在 `tests/browser/harness.mjs` 增加并导出下面这个函数（照抄；后面的 WP 也用它）：

```js
// 白天、夜间各截一张，标签后面加 -light / -dark（12 第 11 节）。只在偏好是“跟随系统”（默认）时用；截完回到白天。
// keepVisible：切换模式后先确认这个元素（例如打开着的菜单）仍然可见，再截图。
export async function shootBothModes(page, screenshot, label, { keepVisible } = {}) {
  for (const mode of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: mode });
    const deadline = Date.now() + 5000;   // 在 Node 这边等：场景里装了 page.clock 时，页面里的计时器是假的
    while ((await page.evaluate(() => document.documentElement.dataset.theme)) !== mode) {
      if (Date.now() > deadline) throw new Error(`没有切换到 ${mode}：外观偏好是不是被改成了“白天”或“夜间”？`);
      await page.waitForTimeout(100);
    }
    if (keepVisible) await page.locator(keepVisible).first().waitFor({ state: "visible" });
    await page.waitForTimeout(200);
    await screenshot(`${label}-${mode}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}
```

新建 `tests/browser/wp12-navigation.mjs`（种子：满配夹具，`ui.workspaceName` 不设置，用默认值；`browserScenario` 的第三个参数加 `viewport: { width: 1440, height: 900 }`，和参照图一样大）。下面说的“截图 `x`”一律写成 `await shootBothModes(page, screenshot, "x")`，白天、夜间各一张。检查项（标题照抄）：

1. `Sidebar has no teamspaces and follows the new order`：按顺序读取侧栏各区的可见文字，断言顺序；没有“Teamspaces”。截图 `sidebar`。
2. `Recents records real visits in order and drops trashed pages`：依次打开“A 概览”“B 笔记”“Z 目标页”各停留 1.5 秒 → Recents 视图第一条是“Z 目标页”、第三条是“A 概览”→ 刷新后仍然如此 → 把“B 笔记”移到回收站 → Recents 里没有它。截图 `recents`。
3. `Favorites can be added removed reordered and survive reload`。
4. `Home shows real recents favorites and upcoming records`：先给 `ds-inline` 的两条记录设置截止日期为 3 天后和 10 天后 → Home“即将到来”里只有 3 天后的那条；没有收藏时没有“收藏”区块。截图 `home`。
5. `Renaming the workspace updates the sidebar and the greeting`；菜单里只有 1.4 第 4 条列出的项（浏览器模式下没有“打开数据目录”；分隔线不是菜单项）。菜单打开时截图 `menu`（加 `{ keepVisible: '[role="menu"]' }`，和参照图同名）。
6. `Private more menu actions work`（4 项各验证一次结果）。
7. `Drag and drop moves and reorders and refuses invalid targets`：用 `locator.dragTo`：页面拖进别的文件夹；同一文件夹里两个页面换顺序；文件夹 B 拖进 Z；文件夹 A 拖到它的子文件夹 C 上（没有变化）；刷新后保持。
8. `Back and forward work with buttons and shortcuts`。
9. `Sidebar width and collapse persist`。

加入场景列表，单独运行，日志 `.qa/WP-12/browser-wp12.log`。通过后生成对照图（主页、工作区菜单有参照图）：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-12/compare.log node docs/blueprint/tools/compare-shots.mjs docs/blueprint/design/mobai/shots .qa --prefix wp12-navigation- --only home,menu --out .qa/WP-12/compare
```

退出码 0。工作区里的页面和原型的示例数据不同，差异占比只供参考；把 `summary.md` 复制进报告第 3 节，并逐张写出你看到的不同之处（布局、字体、颜色、线条）。提交 `WP-12: navigation browser scenario`。

### 步骤 11：桌面端到端

在 `tests/desktop/` 新建 `navigation.e2e.mjs`：

- `mouse side buttons go back and forward`：依次打开两个页面 → `handle.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit("app-command", { preventDefault() {} }, "browser-backward"))` → 回到第一个页面 → 再发 `browser-forward` → 回到第二个页面。
- `the workspace menu offers the data folder on desktop`（点“打开数据目录”后 `__lifeAtlasDialogs.calls` 里有一次 `openPath`）。

运行：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-12/desktop-build-test.log npm run desktop:build:test
node docs/blueprint/tools/run-logged.mjs .qa/WP-12/desktop-e2e.log npm run test:e2e:desktop
```

提交 `WP-12: navigation desktop tests`。

### 步骤 12：收尾【停止点】

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-12/npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-12/browser-all.log npm run test:parity:browser
```

填完报告；第 0 节全部“完成”；提交 `WP-12: complete report`；运行 `node docs/blueprint/tools/wp-check.mjs WP-12 --browser --desktop`，退出码 0 或 2 → 停止。

## 3. 范围

### 不做

- 多标签页、新窗口打开页面（暂不排期）。
- 设置页（WP-17）、快速记录与收件箱（WP-13）。
- 新增拖拽依赖。

## 4. 验收标准

| 编号 | 标准 | 证据 |
| --- | --- | --- |
| AC-12-1 | 侧栏没有 Teamspaces 相关元素；顺序符合 1.2 | 场景检查 1；`tests/navigation-no-teamspaces.test.mjs`；`.qa/wp12-navigation-sidebar-*.png` |
| AC-12-2 | 最近访问记录真实访问（停留 > 1 秒）、顺序正确、刷新后仍在、删除后不再显示 | 场景检查 2；`tests/navigation-domain.test.mjs` |
| AC-12-3 | 收藏的添加、移除、拖拽排序、刷新后保留 | 场景检查 3 |
| AC-12-4 | Home 各区块数据正确（3 天后的出现、10 天后的不出现）；没有数据的区块不渲染 | 场景检查 4；`tests/navigation-domain.test.mjs` |
| AC-12-5 | 工作区改名后侧栏与问候同步；菜单中没有未实现的项 | 场景检查 5 |
| AC-12-6 | Private 更多菜单 4 项都可用 | 场景检查 6 |
| AC-12-7 | 拖拽：页面移入文件夹、同级排序、文件夹移入文件夹、拖到自己的子级被拒绝；刷新后保持 | 场景检查 7 |
| AC-12-8 | 后退/前进按钮与两组快捷键正确；桌面版鼠标侧键可用 | 场景检查 8；`tests/desktop/navigation.e2e.mjs` |
| AC-12-9 | 侧栏宽度拖动与 `Ctrl+\` 折叠可用并持久化 | 场景检查 9 |
| AC-12-10 | 迁移 13→14 纯函数、幂等 | `tests/migration-v14.test.mjs` |
| AC-12-11 | 视觉：主页、工作区菜单照墨白做（1.5 节）；截图：侧栏（有收藏）、Home、Recents、工作区菜单，白天和夜间各一张；Home 和工作区菜单与参照图并排对照；顶栏的“切换白天/夜间”按钮还在原位，`wp20-mobai` 场景仍然通过 | `.qa/wp12-navigation-*.png`；`.qa/WP-12/compare/summary.md`；报告第 3 节；`.qa/WP-12/browser-all.log` |
| AC-12-12 | G1–G9 | `.qa/WP-12/wp-check.md` |

## 5. 卡点处理

| 情况 | 做法 |
| --- | --- |
| `locator.dragTo` 在原生拖放上不生效 | 先确认行元素有 `draggable="true"`，并且 `dragover` 里调用了 `event.preventDefault()`；仍不行就用 `page.dispatchEvent` 依次派发 `dragstart`/`dragover`/`drop`（带同一个 `DataTransfer`），写进报告第 5 节 |
| 重排 `sortIndex` 让其他已有测试的顺序断言失败 | 只在拖放落下时重排；其他操作不要改 `sortIndex` |
| 删除 `TeamspacesView` 后编译报错 | 还有地方引用了 `teamspaces` 或 `IconStack2` 等只给它用的图标，一并清理 |
| 新首页整页被分成两栏（刊头和“最近访问”也挤到一边），或问候的字号不对 | 外层用了旧的 `.home-view`、`.page-view` 或 `.page-heading`：按 1.5 节改用 `home-` 开头的类名 |
| `shootBothModes` 报“没有切换到 light/dark” | 场景里把外观偏好改成了“白天”或“夜间”，`emulateMedia` 就不起作用；本场景不要改外观偏好 |
