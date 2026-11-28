# WP-10 模板库与“软件开发进程”模板（schema v13）

- 规模：M · 前置：WP-09 · 分支：`wp/10-template-gallery`
- 停止点：步骤 6（对照效果图与理解确认）、步骤 10（收尾）
- 必读：`05-时间脉络与开发进程模板.md` 第 5、6 节；`09-执行手册.md`；`10-测试夹具规格.md`；源码 `src/domain/templates.js`、`src/domain/database.js`（`resolvePropertyValue` 的汇总分支、`groupViewItems`、`createRelation`）、`src/domain/databaseProperties.js`（`formatPropertyValue`）、`src/components/PropertyEditor.jsx`（`PropertyConfigDialog` 的选项与汇总设置）、`src/App.jsx`（`updateDatabaseItemValue`、`saveCurrentPageTemplate`、`createPageFromTemplate`、`deletePageTemplate`）、`src/components/PageActionsMenu.jsx`、`src/components/WorkspaceSidebar.jsx`；`12-视觉规范-墨白.md` 第 0、6、7、8 节（模板卡片）；截图 `design/mobai/shots/templates-light.png`、`templates-dark.png` 与原型 `design/mobai/prototype/index.html#view=templates`

## 0. 一页纸

- **要做到**：侧栏有“模板”入口，打开模板库：内置模板与“我的模板”。选“软件开发进程”→ 填项目名、选文件夹、决定是否要示例数据 → 一键生成页面、两张双向关联的数据库和全部视图，默认显示时间脉络；里程碑的“进度”按关联任务的完成情况自动计算；页面操作菜单可以“保存为页面模板…”。
- **交付物**：schema v13（状态分组）；4 种新汇总；双向关联同步；`src/templates/`（注册表、内置模板、实例化、预览插图）；模板库界面与它的墨白样式 `src/ui/themes/mobai/templates.css`；单元测试；浏览器场景 `wp10-templates`；截图。
- **绝对不要**：在步骤 6 停止前写模板库界面；用右侧面板打开模板库（必须是居中对话框）；做其他内置模板；做模板市场或模板文件导入导出；修改时间脉络视图本身（WP-09 已完成）。
- **什么时候停**：步骤 6 结束停一次（总设计师确认你对效果图的理解）；步骤 10 的 wp-check 退出码为 0 或 2 时停。

## 1. 为什么做

用户要一个“像 Notion 一样的模板”来管理软件开发进程，核心是 WP-09 的时间脉络。

## 2. 设计要点（规定）

### 2.1 状态分组（schema v13）

- 迁移 `migrateStatusGroups(input)`（在 `migrations.js`，链在 `migrateAssetProvider` 之后）：每个数据源里 `type === "status"` 的属性，每个选项若没有合法的 `group`（`"todo" | "inProgress" | "complete"`），按 05 第 5 节的规则补上；其他数据一律不动；`schemaVersion = 13`；纯函数、幂等。`CURRENT_SCHEMA_VERSION = 13`。
- 新建状态选项时（`PropertyConfigDialog` 的“添加选项”）默认 `group: "todo"`。
- `PropertyConfigDialog`：属性类型为状态时，每个选项行加一个下拉框“分组”（待办/进行中/完成），`aria-label` 为 `选项分组 <选项名>`。
- `groupViewItems`：按状态属性分组、且 `grouping.order` 为空时，分组顺序为：`todo` 分组的选项（按选项顺序）→ `inProgress` → `complete` → “未分组”。`grouping.order` 不为空时保持现有行为。

### 2.2 新汇总聚合

在 `resolvePropertyValue` 的汇总分支里新增（计算前已经去掉回收站里的记录，WP-01）：

| 聚合 | 计算 | 返回 | 显示（`formatPropertyValue`） |
| --- | --- | --- | --- |
| `percent_checked` | 目标属性是复选框：值为 `true` 的记录数 ÷ 关联记录数 | 0–1 数字；没有关联记录时 `null` | `Math.round(x × 100) + "%"`；`null` 显示空 |
| `percent_complete` | 目标属性是状态：值属于 `complete` 分组的记录数 ÷ 关联记录数 | 同上 | 同上 |
| `count_unique` | 目标属性值（用 `formatPropertyValue` 转成文字后）去重，空值不计 | 整数 | 数字 |
| `date_range` | 目标属性是日期：所有 `start` 的最小值 → 所有 `end`（没有就用 `start`）的最大值 | `{ start, end, includeTime: false, timeZone: null }`；没有日期时 `null` | `"YYYY-MM-DD → YYYY-MM-DD"` |

`PropertyConfigDialog` 的“计算”下拉框加入这 4 项，选项文字依次为“已勾选百分比”“完成百分比”“去重计数”“日期范围”（值用英文键）。

### 2.3 双向关联

- 现状（总设计师已核对源码）：`createRelation` 有 `reciprocalPropertyId` 字段，但没有任何代码在一侧改动时同步另一侧。
- 新增 `src/domain/database.js`：`applyRelationChange(workspace, { itemId, propertyId, nextIds, now })` → 新工作区：
  1. 设置该记录该属性的值为 `nextIds`（去重、去掉不存在的 ID）；
  2. 找到 `relations` 里 `sourceId === 该记录的数据源 && propertyId === 该属性` 的关联定义；有 `reciprocalPropertyId` 时：对**新增**的每个目标记录，把 `itemId` 加进它的反向属性值；对**移除**的每个目标记录，从它的反向属性值里删掉 `itemId`；
  3. 所有改动在返回的同一个工作区对象里，受影响记录的 `updatedAt = now`。
- `App.jsx` 的 `updateDatabaseItemValue`：属性类型为 `relation` 时改为在 `setWorkspace` 的同一个更新函数里调用 `applyRelationChange`（不能分两次 `setWorkspace`）。

### 2.4 模板系统

```
src/templates/
  dates.js                       localDateString(ms) → "YYYY-MM-DD"（本地日期）；addDays(dateString, n)
  registry.js                    BUILTIN_TEMPLATES = [softwareDevRoadmap]；getBuiltinTemplate(id)
  instantiate.js                 instantiateTemplate(workspace, template, { now, idFactory, projectName, folderId, includeSampleData }) → { workspace, rootPageId }
  builtin/softwareDevRoadmap.js  05 第 6.4 节的对象；build(context) 返回 05 第 6.2、6.3 节的全部实体
  previews.jsx                   TemplatePreview({ previewId, size })：按模板的 preview 字段画预览图（见下）
```

- `build` 里所有 ID 都用 `context.idFactory(前缀)` 生成；所有日期都用 `localDateString(context.now)` 加减天数；页面放进 `folderId`；记录页面放在同一个文件夹；数据源 A 的“任务”与 B 的“所属阶段”互为反向（两条 `relations`，`reciprocalPropertyId` 互相指向）；数据源 A 的“进度”是汇总：关联“任务”→ 属性“状态”→ `percent_complete`。
- 视图与配置严格按 05 第 6.2 节；时间脉络视图的 `markerMap` 按 05 第 6.2 节；页面正文 5 个部分顺序正确，数据库块引用对应的数据源和视图（“进行中”“版本记录”两块用关联视图 `linked: true`，带筛选/排序）。
- `instantiateTemplate`：调用 `build`，把结果合并进工作区副本，调用 `checkWorkspaceIntegrity`；有任何 `error` 就抛错并且不返回新工作区。
- 预览图：模板对象的 `preview` 字段是字符串 `"roadmap-thumb"`（模板保持为纯数据，12 第 9 节）。`previews.jsx` 里 `roadmap-thumb` 画一张缩略时间脉络：照原型 `design/mobai/prototype/app-b.js` 的 `roadmapThumb()` 写成内联 SVG（`viewBox="0 0 320 180"`，3 个月份数字、3 条月份竖线、主轴和今天之前的粗线、3 个菱形、1 个蓝色圆点（重大节点）、5 段阶段横条、今天竖线），用 class 上色，规则照原型 `b-more.css` 的 `.thumb-*` 写在 `templates.css` 里、只用 `--mb-*` 变量，所以白天和夜间都对：`thumb-num` 月份数字（`--mb-sans` 600 18 px，详情里的大图 17 px，`fill: var(--mb-ink)`）；`thumb-grid` 月份竖线（1 px `--mb-line`）；`thumb-axis` 主轴（1 px `--mb-line-2`）；`thumb-done` 今天之前的粗线（3 px `--mb-ink`）；`thumb-ms` 菱形（填 `--mb-paper`、1.5 px `--mb-ink` 描边；日期已过的再加 `is-done`，填 `--mb-ink`）；`thumb-major` 重大节点（`--mb-accent` 实心圆）；`thumb-phase` 阶段横条（`--mb-tag-gray`；已完成的再加 `is-done`，填 `--mb-u-green`）；`thumb-today` 今天竖线（1.5 px `--mb-today`）。`size` 为 `"card"`（模板卡片）或 `"large"`（详情）。“我的模板”没有 `preview`，画原型 `.tpl-cover-text` 那样的 3 条横线。
- 页面图标用 `icon:calendar-event`（图标库里没有这个 id 时用 `icon:timeline-event`，在报告第 5 节写明）。

### 2.5 模板库界面（墨白，已定）

照截图 `design/mobai/shots/templates-light.png`、`templates-dark.png` 做（原型 `#view=templates`）：居中的大对话框（`role="dialog"`、`aria-modal="true"`、`aria-label="模板库"`），1080×690（窗口小时 `min(1080px, 94vw)` × `min(690px, 90vh)`）；`Esc` 关闭，打开时焦点在分类列表的第一项，关闭后焦点回到侧栏“模板”行。

| 区域 | 规定 |
| --- | --- |
| 标题栏 | 48 px，下面 1 px `--mb-line` 细线（原型 `.dialog-bar`：左内边距 20 px、右内边距 10 px）：左边 16 px 600 的“模板库”，右上角关闭（28×28 的图标按钮，`aria-label="关闭模板库"`） |
| 左栏 188 px（`--mb-side` 侧栏色，内边距 10 px 8 px） | 分类“全部”“开发”“我的模板”：每行高 30 px、左右 8 px、圆角 6 px，14 px 500 `--mb-side-text`，右边是数量（12 px `--mb-faint`）；悬停 `--mb-hover` 底；当前分类 `--mb-select` 底、`--mb-ink` 字，不加粗（12 第 1 节原则 5） |
| 中栏 300 px（内边距 12 px，右边 1 px `--mb-line` 细线） | 模板卡片（12 第 8 节，原型 `.tpl-item`）：每张内边距 8 px 8 px 10 px、圆角 10 px，卡片之间 8 px，悬停 `--mb-hover` 底；上面 16:9 的预览是一张白卡片（`--mb-raised` 底、`--mb-card` 阴影、圆角 6 px），下面 14 px 600 模板名（上面空 8 px）和 12 px `--mb-muted` 一行说明（“我的模板”写“我的模板，M月D日保存”）；选中的卡片是 `--mb-accent-soft` 浅蓝底加 2 px 蓝色内框（`box-shadow: inset 0 0 0 2px rgba(var(--mb-accent-rgb), 0.6)`） |
| 右栏（详情，内边距 22 px 30 px） | 预览区（高 190 px，`--mb-side` 底，圆角 8 px，大号预览图）；24 px 700 模板名（上面空 16 px）；14 px `--mb-muted` 说明（行高 1.6）；“包含的内容”标签（原型 `.tpl-includes`：没有颜色的标签，`--mb-tag-default` 底、`--mb-tag-default-text` 字，高 24 px、左右 8 px、圆角 4 px、13 px，前面一个图标，标签之间 6 px）；表单；底部按钮靠右：次按钮“取消”、主按钮“使用模板”（高 32 px，间隔 8 px） |

“包含的内容”（软件开发进程，4 个标签，每个前面一个图标）：`项目页面`（`file-text`）、`里程碑与阶段数据库（4 个视图）`（`database`）、`任务数据库（3 个视图）`（`database`）、`示例数据（可选）`（`sparkles`）。

“使用模板”表单（原型 `.form`、`.field-row`：每行左边标签、右边控件，标签列 110 px、14 px `--mb-muted`，标签和控件隔 14 px，行之间 12 px）：“项目名称”（12 第 6 节的输入框，加上 WP-20 `base.css` 里的 `.mb-field` 类：`--mb-field` 底、一圈 1 px `--mb-field-line`、圆角 6 px，聚焦时 `--mb-focus` 光圈；高 32 px；`aria-label="项目名称"`，默认“新项目”，1–100 字符）；“放在”（12 第 6 节的下拉框，高 30 px，`aria-label="放在"`，前面一个文件夹图标，选项显示完整路径，默认当前选中的文件夹，没有时为第一个顶层文件夹）；“包含示例数据”（12 第 6 节的开关，`role="switch"`、`aria-label="包含示例数据"`，默认打开，开关下面一行 12 px `--mb-faint` 的提示“先放几条示例里程碑和任务，熟悉以后可以删掉”）。

“我的模板”：列出 `pageTemplates`（名称、“我的模板，M月D日保存”）；详情的预览区显示前 5 个区块的纯文字（只读，第一行加粗 600）；表单只有“放在”；按钮“删除模板”（次按钮，放在左边）、“取消”、“使用模板”（调用现有 `instantiatePageTemplate`）。“删除模板”先 `await confirmDialog({ title: "删除模板", message: "删除“<名称>”？删除后不能恢复。", confirmLabel: "删除模板", danger: true })`（WP-03 的 `src/ui/dialogService.js`）。

样式写在新文件 `src/ui/themes/mobai/templates.css`，在 `index.css` 末尾追加 `@import "./templates.css";`；照原型 `b-more.css` 的“template gallery”一段改写：每个选择器前加 `:root[data-style="mobai"] `，变量按 12 第 0 节的表换名。

页面操作菜单（`PageActionsMenu`）新增“保存为页面模板…”：`await promptDialog({ title: "保存为页面模板", label: "模板名称", defaultValue: 页面标题, validate: (value) => value.trim() ? null : "请输入模板名称" })`（WP-03 的 `src/ui/dialogService.js`；不能用 `window.prompt`，Electron 不支持）→ 结果不为 `null` 时调用现有 `saveCurrentPageTemplate`。

侧栏：在“密钥库”上面加一行“模板”（图标 `IconTemplate`），底部组顺序为：模板、密钥库、回收站。

## 3. 范围

### 必做

第 2 节全部；第 4 节全部步骤。

### 不做

- 其他内置模板（读书笔记、周计划等）。
- 模板在线市场、导入导出模板文件。
- 重做“工作区工具”面板（保持原样）。

## 4. 执行步骤

### 步骤 0：开工准备

按执行手册 3.1 节开工（分支 `wp/10-template-gallery`），生成报告骨架，跑基线 `npm test`。理解题：

1. 一个状态选项叫“已延期”，迁移后属于哪个分组？为什么？（提示：看 05 第 5 节的判断顺序；模板里的“已延期”是模板自己指定为 `inProgress` 的）
2. 在“任务 A”的“所属阶段”里加入“开发 v1”，“开发 v1”的“任务”属性会怎样？
3. 同一个模板用两次，两套数据会共享任何 ID 吗？

提交 `WP-10: step 0 understanding`（本步不停）。

### 步骤 1：状态分组与迁移

按 2.1 实现。新建 `tests/migration-v13.test.mjs`：

（直接调用 `migrateStatusGroups`，见执行手册 4.2 节。）

- `v13 assigns groups by id and name`（`done` → complete；名称含“完成” → complete；`doing` → inProgress；名称含“进行” → inProgress；其他 → todo；已有合法 `group` 不变；非法 `group` 被纠正）
- `v13 touches only status options`（与 `migrateAssetProvider` 的结果相比，除状态选项和 `schemaVersion` 外深度相等）
- `v13 is idempotent`
- `board columns follow status groups`（`groupViewItems` 的顺序：待办 → 进行中 → 完成 → 未分组）

提交 `WP-10: schema v13 status groups`。

### 步骤 2：新汇总

按 2.2 实现。新建 `tests/rollup-aggregations.test.mjs`（用满配夹具再加属性）：

- `percent_checked counts true checkboxes`（i-3 关联 i-1（完成=true）、i-2（false）→ 0.5，显示 `50%`）
- `percent_complete uses the complete group`
- `count_unique ignores empty values`
- `date_range spans the earliest start and latest end`
- `empty relations give null and blank display`
- `records in trash are ignored`（把 p-rec-2 放进回收站后 i-3 的完成百分比变化正确）

提交 `WP-10: rollup aggregations`。

### 步骤 3：双向关联

先写测试确认现状（预期失败的断言**不要**提交成 skip，直接实现后让它通过）。按 2.3 实现。新建 `tests/relation-sync.test.mjs`：

- `adding a relation updates the reciprocal side`（i-4 的 `rel-back` 加入 i-1 → i-1 的 `rel-to-full` 里出现 i-4）
- `removing a relation updates the reciprocal side`
- `both sides change in one workspace update`（返回的工作区里两条记录都变了，原工作区对象没有被修改）
- `relations without a reciprocal property only change one side`
- `deleting one side cleans the other`（复用 WP-01 的永久删除：删掉 i-2 的页面后，i-3、i-4 的 `rel-back` 里没有 i-2）

提交 `WP-10: bidirectional relations`。

### 步骤 4：模板注册、内置模板与实例化

按 2.4 实现。新建 `tests/template-software-dev.test.mjs`（`now` 固定为 `Date.parse("2026-11-01T10:00:00+08:00")`，`idFactory` 用计数器）：

- `the project page has the five parts in order`（标注块文字、4 个标题 2 的文字、4 个数据库块引用正确）
- `milestones data source matches the specification`（9 个属性的名称、类型；“类型”4 个选项的名称与颜色；“状态”5 个选项的名称、颜色、分组；“任务”关联与“进度”汇总的配置）
- `tasks data source matches the specification`（8 个属性；“优先级”“标签”选项与颜色）
- `views and roadmap configuration match the specification`（A 的 4 个视图、B 的 3 个视图；时间脉络的日期/颜色/标记/副标题/进度属性与 `markerMap`）
- `sample data uses dates relative to today`（8 条里程碑与阶段的日期与 05 第 6.3 节一致，D = `2026-11-01`；8 条任务的关联分布）
- `progress shows 100 percent and 33 percent`（“需求与规划”的进度 `formatPropertyValue` 为 `100%`，“原型与设计”为 `33%`）
- `without sample data both sources are empty and views still work`
- `two instances share no ids and stay independent`
- `the merged workspace passes the integrity checker`

提交 `WP-10: software development template`。

### 步骤 5：预览插图

按 2.4 写 `src/templates/previews.jsx` 和它在 `templates.css` 里的规则。提交 `WP-10: template preview art`。

### 步骤 6：对照效果图与理解确认【停止点】

1. 用 Edge 打开原型 `design/mobai/prototype/index.html#view=templates&mode=light` 和 `mode=dark`，对照截图 `design/mobai/shots/templates-light.png`、`templates-dark.png`。原型**只看不改**。
2. 在报告第 3 节写一张表：2.5 节表格的每个区域和表单的每一行各一行，两列：你打算用的组件和 class；原型里有、但和 2.5 节写的不一样的地方（以 2.5 节为准）。
3. 在报告第 1 节接着回答：
   4. 预览图为什么不能做成一张固定颜色的 `.svg` 文件？
   5. “我的模板”的详情和内置模板的详情有哪些不同？
4. 报告第 0 节步骤 0–6 标为“完成”，提交 `WP-10: step 6 visual mapping`，运行 `node docs/blueprint/tools/wp-check.mjs WP-10 --until 6`，退出码 0 → **停止**。总设计师看过以后，用户会发 `08` 第 3 节“继续 WP-10”。

### 步骤 7：模板库界面

按 2.5 实现：`src/components/TemplateGallery.jsx`（样式在 `templates.css`）；侧栏“模板”行；页面操作菜单“保存为页面模板…”。“使用模板”成功后：关闭对话框，打开生成的项目页面，展开它所在的文件夹。提交 `WP-10: template gallery`。

### 步骤 8：浏览器场景

新建 `tests/browser/wp10-templates.mjs`（种子：满配夹具）。检查项（标题照抄）：

1. `The template gallery opens from the sidebar and closes with Escape`：打开后选中“软件开发进程”，截图 `templates-light`（白天，见本步最后一段）。
2. `Using the software template creates the project page with a roadmap`：选“软件开发进程”→ 项目名称填“Life Atlas 桌面版”、文件夹选“Z 其他”、保持“包含示例数据”→“使用模板”→ 打开了标题为“Life Atlas 桌面版 · 开发进程”的页面 → 页面里有 `data-testid="roadmap-view"`，其中 8 个 `[data-entry-id]` → 截图 `project-light`。
3. `The generated project survives a reload`：刷新后页面和 8 个条目仍在；用 `saved()` 断言两个数据源、7 个视图、8+8 条记录存在。
4. `Progress rollups show 100 and 33 percent`：在“里程碑与阶段”的表格视图里，“需求与规划”的进度是 `100%`，“原型与设计”是 `33%`。
5. `Without sample data the views show empty states`：再用一次模板，关掉“包含示例数据”开关 → 时间脉络显示“还没有带日期的记录”。
6. `A page can be saved as a template and reused`：在“A 概览”页面用“保存为页面模板…”存为“概览模板”（出现输入对话框 `[data-la-dialog="prompt"]`，输入框填“概览模板”，点 `[data-la-dialog-confirm]`）→ 模板库“我的模板”里出现 → 使用到“空文件夹”→ 新页面的正文与“A 概览”相同、区块 ID 不同。截图 `mine-light`。

截图（整个场景的视口是 1440×900：`browserScenario` 的第三个参数加 `viewport: { width: 1440, height: 900 }`，09 第 4.3 节）：场景开始时点顶栏 `.header-theme-toggle`（WP-20）直到 `document.documentElement.dataset.theme === "light"`，上面的截图都是白天；场景最后切到夜间（再点到 `"dark"`），重新打开模板库、选中“软件开发进程”截 `templates-dark`，再打开生成的项目页面截 `project-dark`。然后：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-10/compare.log node docs/blueprint/tools/compare-shots.mjs docs/blueprint/design/mobai/shots .qa --prefix wp10-templates- --only templates --out .qa/WP-10/compare
```

退出码 0；把 `summary.md` 复制进报告第 3 节，逐张写出和参照图的不同之处（参照图的“我的模板”是另外两个，项目名称是“Life Atlas 2.0”，这些不算）。

加入场景列表；单独运行并保存日志 `.qa/WP-10/browser-wp10.log`。提交 `WP-10: template browser scenario`。

### 步骤 9：全量回归

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-10/npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-10/browser-all.log npm run test:parity:browser
```

### 步骤 10：收尾【停止点】

填完报告；第 0 节全部“完成”；提交 `WP-10: complete report`；运行 `node docs/blueprint/tools/wp-check.mjs WP-10 --browser`，退出码 0 或 2 → 停止。

## 5. 验收标准

| 编号 | 标准 | 证据 |
| --- | --- | --- |
| AC-10-1 | 迁移 12→13：纯函数、幂等；默认分组规则每个分支都有测试；只动状态选项 | `tests/migration-v13.test.mjs` |
| AC-10-2 | 四种新汇总的计算与显示（含空关联、回收站记录被忽略） | `tests/rollup-aggregations.test.mjs` |
| AC-10-3 | 双向关联：添加/移除两侧同步、一次更新完成、删除一侧后另一侧被清理 | `tests/relation-sync.test.mjs` |
| AC-10-4 | 模板生成的结构与 05 第 6.2 节逐项一致（页面 5 部分、两个数据源的属性/选项/颜色/分组、7 个视图与时间脉络配置） | `tests/template-software-dev.test.mjs` 前 4 个用例 |
| AC-10-5 | 示例数据日期与 05 第 6.3 节一致；进度 100% 与 33% | 「sample data uses dates relative to today」「progress shows 100 percent and 33 percent」；场景检查 4 |
| AC-10-6 | 不勾选示例数据：两个数据源都没有记录，视图显示空状态 | 「without sample data…」；场景检查 5 |
| AC-10-7 | 同一模板用两次：ID 不重复、互不影响、完整性检查通过 | 「two instances share no ids…」「the merged workspace passes…」 |
| AC-10-8 | 浏览器场景：侧栏“模板”→ 选模板 → 填表 → 生成并打开页面 → 时间脉络 8 个条目 → 刷新后仍在 | 场景检查 1–3 |
| AC-10-9 | 保存为页面模板 → “我的模板”出现 → 使用 → 内容一致且 ID 全新 | 场景检查 6 |
| AC-10-10 | 视觉：模板库照墨白做（2.5 节），白天和夜间与参照图并排对照一致；预览图随模式变化；截图：模板库（白天/夜间）、我的模板、生成后的项目页面（白天/夜间） | `.qa/WP-10/compare/`；`.qa/wp10-templates-templates-light.png`、`-templates-dark.png`、`-mine-light.png`、`-project-light.png`、`-project-dark.png`；报告第 3 节 |
| AC-10-11 | G1–G9 | `.qa/WP-10/wp-check.md` |

## 6. 卡点处理

| 情况 | 做法 |
| --- | --- |
| 进度不是 33% | “原型与设计”关联 3 个任务：已完成 1、进行中 2 → 1/3；检查任务的状态选项分组是不是 `complete` 只有“已完成”和“已取消”（任务数据源没有“已取消”） |
| 模板的日期在测试里差一天 | 用 `localDateString` 统一计算，测试也用它；不要混用 `toISOString().slice(0, 10)` |
| 迁移后某个已有测试断言 `schemaVersion === 12` | 只有断言“当前版本号”的地方需要随版本变化；按执行手册 4.5 节第 2 条修改并在报告第 4 节写明；断言历史迁移步骤结果（如 `migrateWorkspaceShell` 得到 10）的不要改 |
| 找不到 `IconTemplate` | 用 `@tabler/icons-react` 里的 `IconLayoutGrid`，写进报告第 5 节 |
