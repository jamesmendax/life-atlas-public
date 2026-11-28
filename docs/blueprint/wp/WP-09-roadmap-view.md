# WP-09 时间脉络视图

- 规模：L · 前置：WP-08（技术上只依赖 WP-01 和 WP-20；用户明确要求时可以在 WP-05 之后提前做，见 06 第 2 节）· 分支：`wp/09-roadmap-view`
- 停止点：步骤 1（对照效果图与理解确认）、步骤 11（收尾）
- 必读：`05-时间脉络与开发进程模板.md` 第 1–4 节；`12-视觉规范-墨白.md` 第 0、3、4、6、8、10 节；截图 `design/mobai/shots/timeline-light.png`、`timeline-dark.png` 与原型 `design/mobai/prototype/index.html#view=timeline`；`09-执行手册.md`；源码 `src/domain/viewRegistry.js`、`src/components/DatabaseView.jsx`（`VIEW_ICONS`、视图标签栏、`renderView`）、`src/components/DatabaseBasicViews.jsx`（`DatabaseTimeline`、`DatabaseCalendar` 的拖动与写回）、`src/components/DatabaseWorkSurfaceSettings.jsx`、`src/editor/lifeAtlasSchema.jsx`（`getLifeAtlasSlashMenuItems` 里的数据库视图列表）、`src/ui/themes/mobai/index.css`、`src/ui/themes/mobai/tokens.css`（WP-20）

## 0. 一页纸

- **要做到**：任意数据库都能“添加视图 → 时间脉络”。选好日期属性后，记录按时间画成墨白的“幻灯片式时间脉络”（样子贴近 Notion）：顶部 26 px 粗体月份，中间一条主轴，里程碑是轴上的标记、卡片在轴上方分两层，阶段是轴下方的圆角色条（已完成绿、进行中蓝、未开始灰），红色的今天标线；可以悬停查看、点击打开、拖动改日期、缩放、导出 16:9 的 PNG/SVG 贴进 PPT。
- **交付物**：`src/domain/roadmapLayout.js`、`roadmapEntries.js`、`roadmapExport.js`；`src/components/DatabaseRoadmap.jsx` 与设置面板；墨白样式 `src/ui/themes/mobai/roadmap.css`；单元测试；浏览器场景 `wp09-roadmap`；白天和夜间截图与对照图。
- **绝对不要**：在步骤 1 停止前写实现代码；在旧 CSS 里写颜色、新建颜色变量（只用 `--mb-*`，K13 会检查）；用 canvas 画主视图（只用 SVG，PNG 导出时才栅格化）；引用外部字体或图片；修改现有“时间线”（甘特）视图；做阶段边缘拖拽改时长、纵向时间线、演示模式。
- **什么时候停**：步骤 1 结束停一次（总设计师确认你对效果图的理解）；步骤 11 的 wp-check 退出码为 0 或 2 时停。

## 1. 为什么做

用户要“像 PPT 那样的时间脉络展示”。这是一个新的数据库视图：数据改了，图自动变；同一份数据还能用表格、看板、甘特图看。

## 2. 视觉：墨白“幻灯片式时间脉络”（已定）

用户已经选定墨白。时间脉络长什么样**全部以 05 第 1 节为准**（那里逐项写了刻度、主轴、里程碑、阶段、今天、颜色、悬停），参照截图 `design/mobai/shots/timeline-light.png`、`timeline-dark.png`。原型（`#view=timeline`）里的位置是手工摆的，产品里的位置一律由布局算法算（05 第 3 节）；原型下面的“接下来”列表是页面内容，不属于这个视图。

- **样式文件**：新文件 `src/ui/themes/mobai/roadmap.css`，在 `src/ui/themes/mobai/index.css` 末尾追加一行 `@import "./roadmap.css";`。每个选择器前加 `:root[data-style="mobai"] `，只用 `--mb-*` 变量（12 第 0 节有原型变量的对应表；原型 `b.css` 的“timeline”一段可以参考字号和线宽）。
- **SVG 里的颜色**：主视图的 SVG 用 `fill="var(--mb-ink)"` 这样的写法（或者 class + `roadmap.css`），跟着白天/夜间自动变；**不要**在 JSX 里写十六进制颜色。
- **用户颜色**：只有视图设置了“颜色属性”时才用（05 第 1 节“颜色”），变量是 WP-20 已有的 `--mb-u-<颜色>` 和 `--mb-u-<颜色>-bg`。
- **字体**：全部用 `var(--mb-sans)`（刻度数字、卡片标题、阶段名也是，层级靠字号和字重，05 第 1 节）；日期和数字加 `font-variant-numeric: tabular-nums`。不要用 `--mb-serif`。
- **导出图**（步骤 9）：独立的 SVG 文件不能用页面里的 CSS 变量和打包字体，所以颜色写成具体的值、字体写成字体栈（见步骤 9）。

## 3. 第一步：开工与对照效果图

### 步骤 0：开工准备

按执行手册 3.1 节开工（分支 `wp/09-roadmap-view`），生成报告骨架，跑基线 `npm test`。理解题：

1. 一条记录有开始和结束日期，另一条只有一个日期，第三条没有日期——它们分别画成什么？
2. 拖动里程碑时什么时候写入数据？页面锁定时会怎样？
3. 导出的 PNG 是多大尺寸？

提交 `WP-09: step 0 understanding`（本步不停）。

### 步骤 1：对照效果图与理解确认【停止点】

1. 用 Edge 打开原型 `design/mobai/prototype/index.html#view=timeline&mode=light`（夜间把 `light` 换成 `dark`），对照截图 `design/mobai/shots/timeline-light.png`、`timeline-dark.png` 和 05 第 1 节的视觉规定逐条看。原型**只看不改**。
2. 在报告第 3 节写一张表：05 第 1 节“视觉规定”的每一条一行，两列：你打算用什么 SVG 元素画（例如“主轴：两条 `<line>`，今天之前那条 `stroke-width=3`”），用到哪些 `--mb-*` 变量。
3. 用 05 第 6.3 节的 8 条示例数据（D 取 2026-11-01，宽 1200，舒适密度），**手算** 05 第 3 节规则 8 的结果：每个里程碑的 `level` 和 `align`，写进报告第 3 节（步骤 2 的测试会用同样的规则验证你的代码）。
4. 在报告第 1 节接着回答：
   4. 一个阶段没有进度属性，今天正好是它的中间，横条怎么画？设置了进度 30% 呢？
   5. 用户没设“颜色属性”时，时间脉络里会出现哪些颜色？设了以后哪些地方会变？
   6. 导出的 PNG 为什么不能直接用页面里的 CSS 变量和字体？
5. 报告第 0 节步骤 0、1 标为“完成”，提交 `WP-09: step 1 visual mapping`，运行 `node docs/blueprint/tools/wp-check.mjs WP-09 --until 1`，退出码 0 → **停止**。总设计师看过以后，用户会发 `08` 第 3 节“继续 WP-09”。

## 4. 第二步：实现

### 步骤 2：布局算法

按 05 第 3 节实现 `src/domain/roadmapLayout.js`（纯函数；不读 DOM、不读系统时间）：`layoutRoadmap` 和 `splitTickLabel`。卡片、泳道的位置和整体高度严格按 05 第 3 节规则 7–10。

新建 `tests/roadmap-layout.test.mjs`，用例名与断言照抄（日期都按 UTC 零点）：

- `L1 distant milestones alternate levels and flip at the right edge`：3 个里程碑 2026-01-01、2026-06-01、2026-12-01，宽 1200，舒适密度 → `level` 依次 `1`、`0`、`1`，`align` 依次 `"start"`、`"start"`、`"end"`（第三个靠右会超出 `axis.x1`，所以放到连线左边）；`levels === 2`。
- `L2 same day milestones fill both sides then stack upward`：6 个里程碑都在 2026-03-10，id 为 `m1`…`m6`，宽 1200 → `m1 1/start`、`m2 0/start`、`m3 1/end`、`m4 0/end`、`m5 2/start`、`m6 2/end`（写法是 `level/align`）；`levels === 3`；`m5.card.y === m1.card.y − 76`。
- `L3 overlapping phases use separate lanes and touching phases share one`：`p1` 01-01→02-01、`p2` 01-15→03-01、`p3` 03-01→04-01、`p4` 04-01→05-01（都在 2026 年）→ 泳道 `0、1、0、0`。
- `L4 tick units match the reference table`：下表 9 种情况（输入是一个阶段条目，从“开始”到“结束”，`zoom: 1`）的 `unit`、`step`、刻度数、第一个与最后一个刻度文字逐项相等（总设计师按 05 第 3 节实算）：

  | 跨度 | 宽度 | unit | step | 刻度数 | 第一个 | 最后一个 |
  | --- | --- | --- | --- | --- | --- | --- |
  | 2026-03-02 → 2026-03-12 | 600 | week | 1 | 2 | 3月2日 | 3月9日 |
  | 同上 | 1200 | day | 2 | 8 | 2月28日 | 3月14日 |
  | 同上 | 2400 | day | 1 | 17 | 2月27日 | 3月15日 |
  | 2026-01-15 → 2026-07-15 | 600 | month | 2 | 3 | 2026年3月 | 7月 |
  | 同上 | 1200 | month | 1 | 6 | 2026年2月 | 7月 |
  | 同上 | 2400 | week | 2 | 14 | 1月19日 | 7月20日 |
  | 2025-01-01 → 2028-01-01 | 600 | year | 1 | 4 | 2025年 | 2028年 |
  | 同上 | 1200 | month | 6 | 7 | 2025年1月 | 2028年1月 |
  | 同上 | 2400 | month | 2 | 19 | 2025年1月 | 2028年1月 |

- `L5 today appears only inside the domain`
- `L6 entries without dates go to unscheduled`
- `L7 zero and one entry do not throw`（一个条目时 `domain` 前后各 7 天）
- `L8 layout is deterministic and order independent`（同一输入两次深度相等；打乱输入顺序结果相同）
- `L9 five hundred entries lay out within fifty milliseconds`（打印 `WP09_LAYOUT_MS=`）
- `cards stay inside the axis bounds and connectors still hit the node`：2 个里程碑 2026-01-01、2026-01-31，宽 400 → 第一个 `1/start`、第二个 `0/end`；每张卡片 `card.x ≥ axis.x0` 且 `card.x + card.width ≤ axis.x1`；`align === "start"` 时 `card.x === x + 10`，`"end"` 时 `card.x + card.width === x − 10`。
- `L10 phase fill and past milestones follow now`：阶段 2026-01-01 → 2026-01-11，`now` = 2026-01-06 零点（UTC）→ `progress: null` 时 `fill === 0.5`，`progress: 0.2` 时 `fill === 0.2`；里程碑 2026-01-03 的 `past === true`、2026-01-09 的 `past === false`。
- `L11 vertical positions follow the density`：阶段 2026-01-01 → 2026-01-20，里程碑 2026-01-05、2026-01-15，宽 1200，舒适密度 → `axis.y === 256`、层 0 卡片 `card.y === 174`、层 1 `card.y === 98`、阶段 `y === 292`、`height === 384`；紧凑密度 → `axis.y === 224`、层 0 `card.y === 158`、层 1 `card.y === 98`。
- `tick labels split into numeral unit and note`：`"3月9日"` → `{ numeral: "9", unit: "日", note: "3月", small: false }`；`"7月"` → `{ numeral: "7", unit: "月", note: "", small: false }`；`"2026年3月"` → `{ numeral: "3", unit: "月", note: "2026", small: false }`；`"2026 Q3"` → `{ numeral: "3", unit: "季度", note: "2026", small: false }`；`"2028年"` → `{ numeral: "2028", unit: "年", note: "", small: true }`。

提交 `WP-09: roadmap layout`。

### 步骤 3：条目转换

`src/domain/roadmapEntries.js`：`roadmapEntries(workspace, source, items, config)` → 05 第 3 节注释里的条目形状。规则：日期值用 `normalizeDate`；只有 `start` 的是里程碑（`end = null`）；`end` 小于 `start` 时交换；`color` 取颜色属性当前值对应选项的 `color`（没有则 `"default"`）；`marker` 取 `markerMap[标记属性选项 id]`，缺省 `"diamond"`（05 第 2 节）；`subtitle` 用 `formatPropertyValue`；`progress`：数字或汇总结果，> 1 时除以 100，限制在 0–1，非数字为 `null`；`statusLabel` 是颜色属性的选项名称。页面在回收站的记录不出现（`items` 已经由 `projectViewItems` 过滤，再保险判断一次）。

新建 `tests/roadmap-entries.test.mjs`：

- `ranges become phases and single dates become milestones`
- `colors markers subtitles and progress are mapped`（进度 62 → 0.62；0.5 → 0.5；“abc” → null）
- `records in trash are excluded`

提交 `WP-09: roadmap entries`。

### 步骤 4：视图注册

1. `src/domain/viewRegistry.js`：`VIEW_REGISTRY` 加 `roadmap: { label: "时间脉络", description: "像幻灯片一样按时间展示里程碑和阶段" }`；`normalizeViewConfig` 增加 `roadmap` 分支，按 05 第 2 节补默认值并保留未知字段（`scale` 不合法时为 `"auto"`、`density` 不合法时为 `"comfortable"`、`zoom` 取 1、1.5、2、3、4 之一否则为 1、`markerMap` 只保留合法形状）。
2. `src/components/DatabaseView.jsx`：`VIEW_ICONS` 加 `roadmap: IconTimelineEvent`（从 `@tabler/icons-react` 导入）；`renderView` 的 `switch` 加 `case "roadmap"`。
3. `src/editor/lifeAtlasSchema.jsx`：`getLifeAtlasSlashMenuItems` 里的视图类型数组加入 `"roadmap"`。
4. 新建视图时（标签栏点“时间脉络”或斜杠菜单）：如果数据源有日期属性，`datePropertyId` 自动设为第一个日期属性。
5. **已知会受影响的两个已有断言**（总设计师已核对，这是规格内的变化，按执行手册 4.5 节第 2 条修改，并写进报告第 4 节）：
   - `tests/database.test.mjs` 里 `assert.deepEqual(DATABASE_VIEW_TYPES, [...])` 那一行：数组末尾加 `"roadmap"`；
   - `tests/browser/phase1-database.mjs` 第一个检查里 `assert.equal(await db.getByRole("tab").count(), 10)`：`10` 改为 `11`（检查标题、循环的 10 种类型、`databaseViews.length` 的断言都不改）。
   除这两处外不要改任何已有测试。
6. 在 `tests/database-views.test.mjs` 旁边新建 `tests/roadmap-view-config.test.mjs`：
   - `roadmap is registered with its label`
   - `roadmap config gets defaults and keeps unknown fields`

提交 `WP-09: register the roadmap view`。

### 步骤 5：墨白样式

新建 `src/ui/themes/mobai/roadmap.css` 并在 `index.css` 末尾追加 `@import "./roadmap.css";`（第 2 节）。不新建颜色变量：墨白的颜色和用户内容颜色都已经在 WP-20 的 `tokens.css` 里。

### 步骤 6：渲染组件

`src/components/DatabaseRoadmap.jsx`：

- 用 `ResizeObserver` 量容器宽度，调用 `layoutRoadmap({ entries, width, now: Date.now(), config })`，用 SVG 画出全部图形，样式严格照 05 第 1 节和截图 `timeline-*`。
- 根元素 `data-testid="roadmap-view"`；每个条目元素带 `data-entry-id`、`data-kind="phase|milestone"`、`tabIndex={0}`、`role="button"`、`aria-label="<标题>，<日期范围>"`。
- 工具条：“适应全部”“放大”“缩小”“今天”“导出”；放大后容器横向滚动。
- 没选日期属性：内联提示“选择一个日期属性来生成时间脉络”+ 一个日期属性下拉框（选中后写入视图配置）。
- 没有带日期的记录：提示“还没有带日期的记录”+“新建记录”按钮。
- 底部“未排期 N 条”，点开是紧凑列表，点击打开记录。

### 步骤 7：交互

- 悬停：高亮条目与连线，浮层显示完整名称、日期范围、状态、进度。
- 点击（或 `Enter`）：调用 `onOpenItemPage(item.pageId)`。
- 拖动：里程碑节点水平拖动改日期，阶段段水平拖动同时平移开始与结束；按天吸附（换算用当前布局的“每天像素”）；拖动中只更新界面，**松手时**才调用一次 `onUpdateItemValue(itemId, datePropertyId, 新日期值)`（日期值形状与现有日历视图写回一致，保留 `includeTime`、`timeZone`）；拖动中按 `Esc` 取消；`runtime.locked` 为真时不能拖，光标 `not-allowed`。
- 键盘：`Tab` 按排序后的顺序移动焦点。

### 步骤 8：设置面板

`src/components/DatabaseWorkSurfaceSettings.jsx` 新增 `RoadmapSettings`（风格照抄现有 `TimelineSettings`）：日期属性、颜色属性（单选或状态）、标记属性（单选）+ 每个选项的形状下拉框、副标题属性、进度属性（数字、汇总、公式）、刻度（自动/周/月/季度/年）、密度（舒适/紧凑）、显示今天。在 `DatabaseView.jsx` 的设置面板里 `view.type === "roadmap"` 时显示它。

### 步骤 9：导出

`src/domain/roadmapExport.js`：

- `buildRoadmapSvg({ layout, title, rangeLabel, background, mode })` → SVG 字符串：`viewBox="0 0 1920 1080"`；用宽度 1920 − 160 重新布局（调用方负责）；顶部 120 px 放标题和时间范围；图形和界面里一样（05 第 1 节）；样式全部内联（不引用 class、不用 CSS 变量、不引用外部字体文件）；`background` 取 `"white"`、`"transparent"`、`"theme"`；`mode` 是当前的 `"light"` 或 `"dark"`。
- 颜色：文件里一个常量 `EXPORT_COLORS = { light: {…}, dark: {…} }`，值照抄 `src/ui/themes/mobai/tokens.css` 白天和夜间两段的 `--mb-paper`、`--mb-ink`、`--mb-muted`、`--mb-faint`、`--mb-line`、`--mb-line-2`、`--mb-accent`、`--mb-today`、9 种 `--mb-u-<颜色>`（不要 `-bg`）和 9 种 `--mb-tag-<颜色>`（不要 `-text`）。`"white"` 和 `"transparent"` 用 `light`（白色背景画一个 `--mb-paper` 的矩形，透明就不画）；`"theme"` 用 `mode` 那一套，背景是那一套的 `paper`。
- 字体栈只有一个（数字也用它）：`"Segoe UI Variable Text", "Segoe UI", "Noto Sans SC", "Microsoft YaHei UI", sans-serif`。PNG 栅格化时 SVG 用不到页面里打包的字体，会用系统里装的同名字体（总设计师 2026-11-06 确认这台电脑装有 Segoe UI Variable 和 Noto Sans SC；别的电脑没有 Noto Sans SC 时中文退到微软雅黑，这是允许的）。
- `svgToPngBlob(svgString, { scale: 2 })`：浏览器里用 `Image` + `canvas` 栅格化，输出 3840×2160 的 PNG。
- 文件名 `<数据库名>-时间脉络-YYYYMMDD.png` 或 `.svg`（本地日期），用 `<a download>` 下载（桌面版的 `will-download` 已接受 `blob:`）。
- 新建 `tests/roadmap-export.test.mjs`：
  - `svg export is well formed and contains every title`（用 `DOMParser` 不可用时，用一个简单的标签配对检查加 `includes` 检查标题）
  - `svg export uses the fixed slide size and inline styles only`（含 `viewBox="0 0 1920 1080"`，不含 `class=`、`url(http`、`@import`）
  - `file names use the database name and local date`

提交（步骤 5–9 可以分多次）`WP-09: roadmap rendering, interaction, settings and export`。

### 步骤 10：浏览器场景与截图

新建 `tests/browser/wp09-roadmap.mjs`。种子：在满配夹具里加一个整页数据库页面“路线图测试”，数据源属性为 05 第 6.2 节的“里程碑与阶段”（名称、类型、时间、状态、版本），记录为 05 第 6.3 节的 8 条（D 取场景运行当天的本地日期）。检查项（标题照抄）：

1. `A roadmap view can be added and picks the first date property`：打开“路线图测试”→ 视图标签栏点“时间脉络”→ 出现 `data-testid="roadmap-view"`，里面有 8 个 `[data-entry-id]`。
2. `Hover shows the full details`：悬停“功能冻结”→ 浮层里有名称和日期；其他条目的不透明度是 `0.4`。截图 `hover-light`（白天）。
3. `Clicking an entry opens its record page`。
4. `Dragging a milestone changes its date by whole days and persists`：把“功能冻结”节点向右拖 3 天的像素距离 → 松手后用 `persisted` 断言该记录的日期 `start` 增加了 3 天 → 刷新后仍然如此。
5. `Locked pages cannot drag`：页面设为锁定后拖动，日期不变。
6. `Export produces a 3840 by 2160 png and a valid svg`：点“导出”→ PNG：下载文件以 PNG 魔数 `89 50 4E 47` 开头，用 Node 读 IHDR 得到宽 3840、高 2160；SVG：含 8 个条目标题；三种背景选项各导出一次；导出过程没有网络请求（harness 已记录 HTTP 错误；另外断言 `page.on("request")` 没有出现 `http` 开头的非 `127.0.0.1:5178` 地址）。把导出的 PNG 存为 `.qa/WP-09/export-sample.png`。
7. `Keyboard focus follows time order and Escape cancels a drag`。
8. `Empty states and the unscheduled list are shown`：清空日期属性 → 出现“选择一个日期属性来生成时间脉络”；有一条没有日期的记录时底部出现“未排期 1 条”。
9. `Five hundred entries render within budget`：另一个 500 条记录的数据源，首次渲染时间 < 300 ms（`performance.now()` 从切换视图到 `roadmap-view` 里出现全部条目），打印 `WP09_RENDER_MS=`。

场景末尾截图（整个场景的视口是 1440×900：`browserScenario` 的第三个参数加 `viewport: { width: 1440, height: 900 }`，09 第 4.3 节；“路线图测试”页面滚动到顶部）：点顶栏 `.header-theme-toggle`（WP-20）直到 `document.documentElement.dataset.theme === "light"`，截 `timeline-light`；再点到 `"dark"`，截 `timeline-dark`。然后生成对照图：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-09/compare.log node docs/blueprint/tools/compare-shots.mjs docs/blueprint/design/mobai/shots .qa --prefix wp09-roadmap- --only timeline --out .qa/WP-09/compare
```

退出码 0。参照图用的是另一份数据，差异占比没有参考意义；把 `summary.md` 复制进报告第 3 节，逐张写出字体、线宽、颜色、刻度文字和参照图有什么不同。

加入 `tests/core-parity-browser.mjs` 的场景列表；单独运行并保存日志 `.qa/WP-09/browser-wp09.log`。提交 `WP-09: roadmap browser scenario`。

### 步骤 11：收尾【停止点】

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-09/npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-09/browser-all.log npm run test:parity:browser
```

填完报告（第 3 节写出 `WP09_LAYOUT_MS`、`WP09_RENDER_MS`）；第 0 节全部“完成”；提交 `WP-09: complete report`；运行 `node docs/blueprint/tools/wp-check.mjs WP-09 --browser`，退出码 0 或 2 → 停止。

## 5. 范围

### 必做

第 3、4 节全部。

### 不做

- 阶段边缘拖拽改时长、纵向时间线、演示模式（05 第 4 节末尾）。
- 修改现有“时间线”（甘特）视图。
- 状态分组、新汇总方式、模板（WP-10）。

## 6. 验收标准

| 编号 | 标准 | 证据 |
| --- | --- | --- |
| AC-09-1 | 视觉：时间脉络照墨白的幻灯片式时间脉络做（05 第 1 节），白天和夜间截图与参照图并排对照一致；颜色只用 `--mb-*` 变量；步骤 1 的对照表与手算结果写在报告第 3 节 | `.qa/WP-09/compare/`；`.qa/wp09-roadmap-timeline-light.png`、`-dark.png`；报告第 3 节 |
| AC-09-2 | L1：远离的里程碑层 1/0/1 交替，靠右边的卡片放到连线左边 | `tests/roadmap-layout.test.mjs`「L1…」 |
| AC-09-3 | L2：同一天 6 个里程碑先占满两层的两边，再往上叠；L10、L11、刻度文字拆分 | 「L2…」「L10…」「L11…」「tick labels split…」 |
| AC-09-4 | L3：重叠阶段分泳道，首尾相接的同泳道 | 「L3…」 |
| AC-09-5 | L4：9 种宽度 × 跨度组合的刻度单位、步长、数量、首尾文字与参考表完全一致 | 「L4…」 |
| AC-09-6 | L5–L7：今天在/不在范围；无日期进未排期；零条和一条不报错 | 「L5…」「L6…」「L7…」 |
| AC-09-7 | L8：结果确定、与输入顺序无关 | 「L8…」 |
| AC-09-8 | L9：500 条布局 < 50 ms；浏览器中 500 条首次渲染 < 300 ms（报告写实测值） | 「L9…」；场景检查 9 |
| AC-09-9 | 浏览器场景：新建视图 → 自动选日期属性 → 悬停 → 点击打开 → 拖动按天改日期并持久化 → 锁定后不能拖 | 场景检查 1–5 |
| AC-09-10 | 导出：PNG 3840×2160、SVG 合法且含全部标题、三种背景生效、无网络请求 | 场景检查 6；`tests/roadmap-export.test.mjs`；`.qa/WP-09/export-sample.png` |
| AC-09-11 | 键盘：Tab 按时间顺序、Enter 打开、拖动中 Esc 取消 | 场景检查 7 |
| AC-09-12 | 空状态与未排期列表符合 05 第 4 节 | 场景检查 8 |
| AC-09-13 | 截图：白天、夜间、悬停、导出成品 | `.qa/wp09-roadmap-timeline-light.png`、`.qa/wp09-roadmap-timeline-dark.png`、`.qa/wp09-roadmap-hover-light.png`、`.qa/WP-09/export-sample.png` |
| AC-09-14 | 视图注册与配置默认值；条目转换规则 | `tests/roadmap-view-config.test.mjs`；`tests/roadmap-entries.test.mjs` |
| AC-09-15 | G1–G9 | `.qa/WP-09/wp-check.md` |

## 7. 卡点处理

| 情况 | 做法 |
| --- | --- |
| L4 的某一行对不上 | 不要改期望值。检查：日期是否按 UTC 零点解析；留白是否 `max(3 天, 5% 跨度)`；`maxTicks` 是否用 `floor((宽度 − 48) / 110)`；周是否从 1970-01-05（周一）起算序号 |
| 拖动后日期差了一天 | 时区问题：拖动换算全部用 UTC 日期，写回时再格式化成 `YYYY-MM-DD` |
| PNG 栅格化时报“画布被污染” | SVG 里引用了外部资源；全部改成内联 |
| 月份数字或文字不是无衬线字体 | 主视图检查 `getComputedStyle` 的 `font-family` 是否以 `"Segoe UI Variable Text"` 开头（`--mb-sans`）；导出图检查字体栈有没有照步骤 9 写 |
| L11 的数字对不上 | 不要改期望值：对照 05 第 3 节规则 9–10 一项一项算（卡片高度、层间距 12、顶部 96、泳道 56） |
| ResizeObserver 在测试里不触发 | 给容器一个确定宽度后再断言；不要在测试里 mock 掉布局 |
| 除步骤 4 第 5 条列出的两处以外，还有已有测试因为新视图类型失败 | 停下报告失败的测试与原因，不要自己改 |
