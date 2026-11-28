# WP-13 快速记录与收件箱（schema v15）

- 规模：M · 前置：WP-12 · 分支：`wp/13-inbox`
- 停止点：只有收尾（步骤 10）
- 必读：`interaction-contract.md`（早期约定：快速记录 → 收件箱 → 归档，是**同一个对象**移动位置，不是复制）；`11-接口契约.md`（`app.notify`、`app.onNotificationClick`、`app.onQuickCapture`、`app.getQuickCaptureShortcutStatus`）；`09-执行手册.md`；源码 `src/App.jsx`（`createPage`、`openPage`）、`src/editor/Mentions.jsx`（`DateMention`、`getMentionMenuItems`）、`src/components/PropertyEditor.jsx`（日期属性的编辑控件）、`src/domain/databaseProperties.js`（`normalizeDate`）、`src/domain/navigation.js`、`src/domain/trash.js`、`src/domain/integrity.js`、`src/search/searchIndex.js`；`12-视觉规范-墨白.md` 第 0、3、6、7 节和 1.7 节列出的参照画面；WP-12 加在 `tests/browser/harness.mjs` 里的 `shootBothModes`

## 0. 一页纸

- **要做到**：随时随手记一条（侧栏按钮、`Ctrl+Shift+N`、桌面版全局快捷键 `Ctrl+Alt+Space`），先进收件箱，之后归档到合适的文件夹；本地提醒（`@提醒` 与日期属性提醒），到点时进收件箱的“提醒”列表，桌面版同时弹系统通知。
- **交付物**：schema v15（系统收件箱文件夹、`inboxedAt`、提醒状态）；`src/domain/markdownBlocks.js`、`inbox.js`、`reminders.js`；快速记录框；收件箱视图（墨白样式 `src/ui/themes/mobai/inbox.css`）；提醒的两个入口与调度；主进程全局快捷键与通知；单元测试；浏览器场景；桌面端到端；白天和夜间的截图与对照图。
- **绝对不要**：把快速记录做成另一种实体（它就是普通页面）；归档时复制页面；让系统文件夹出现在 Private 树里或被删除/移动/改名；做重复提醒、指派给他人、邮件或手机推送、网页剪藏。
- **什么时候停**：步骤 10 的 wp-check 退出码为 0 或 2。

## 1. 设计要点（规定）

### 1.1 schema v15

`migrateInbox(input)`（链在 `migrateNavigationState` 之后）：

- 没有任何 `system === "inbox"` 的文件夹时，加入 `{ id: "system-inbox", system: "inbox", name: "收件箱", parentId: null, color: "stone", sortIndex: -1, lastOpenedPageId: null, trashedAt: null, trashedByFolderId: null, createdAt: T, updatedAt: T }`，`T = workspace.savedAt || "1970-01-01T00:00:00.000Z"`（纯函数，不读系统时间）；
- 每个页面 `inboxedAt` 不存在时设为 `null`；
- `ui.firedReminderIds` 不是数组时 `[]`；`ui.reminderLog` 不是数组时 `[]`；`ui.lastReminderCheckAt` 不存在时 `null`；
- `schemaVersion = 15`；幂等（运行两次只有一个收件箱）。

（02 第 12 节 v15 一行的内容就是这些。）

### 1.2 系统文件夹

- `navigation.js` 的 `childFolders` 跳过 `folder.system` 有值的文件夹（Private 树里看不到收件箱）；文件夹右键菜单对系统文件夹不显示。
- `trash.js` 的 `trashFolder`、`navigation.js` 的 `moveFolder`、`App.jsx` 的 `renameFolder` 遇到系统文件夹抛错“系统文件夹不能删除、移动或改名”；`moveFolder` 的目标也不能是系统文件夹。
- 完整性检查器新增 error `SYSTEM_FOLDER_INVALID`：系统文件夹的 `parentId` 不为 `null`、或在回收站、或同一种 `system` 有多个。
- 搜索：收件箱里页面的路径显示“收件箱”（不是“Private / 收件箱”）。
- 页面“移动到…”的文件夹列表里不出现系统文件夹（归档用收件箱自己的“归档到…”）。

### 1.3 快速记录

- 入口：侧栏“快速记录”按钮（在“搜索”和“Home”之间）；应用内 `Ctrl+Shift+N`；桌面版全局快捷键 `Ctrl+Alt+Space`（主进程 `globalShortcut.register("Control+Alt+Space", …)`：按下时显示并聚焦工作区窗口，然后发 `la:app:quick-capture`；注册失败不报错，`app.getQuickCaptureShortcutStatus()` 返回 `registered: false`，快速记录框底部显示一行“全局快捷键 Ctrl+Alt+Space 已被其他程序占用”）。
- 快速记录框（`role="dialog"`、`aria-label="快速记录"`；宽 620 px，离窗口顶部 110 px，参照 `design/mobai/shots/capture-*`，样式见 1.7 节）：头部左边灰色小字“快速记录”、右边“保存到 收件箱”；标题（可空，没有框）、正文（多行纯文本，支持第 1.4 节的 Markdown 语法，没有框）；底部一条细线，左边一行灰色小字，右边次按钮“保存并打开”和主按钮“保存”（`Ctrl+Enter`；按钮里的键帽 `Ctrl` `Enter` 加 `aria-hidden="true"`，按钮的名字仍然是“保存”）。底部小字：全局快捷键被占用时是上一条里的那句话，否则是“支持 Markdown：# 标题、- 列表、- [ ] 待办”。`Esc` 关闭（正文不为空时先 `window.confirm("放弃这条记录？")`）。
- 保存：用 `createPage` 的同一套字段建一个普通页面，`folderId = "system-inbox"`，`inboxedAt = 现在`，`content = markdownToBlocks(正文)`；标题为空时取正文第一行的纯文字前 30 个码点，正文也为空时为“无标题记录”。

### 1.4 Markdown 转区块（`src/domain/markdownBlocks.js`，纯函数）

`markdownToBlocks(text)` → BlockNote 区块数组，每块有 `id`（`idFactory` 参数，默认 `newEntityId`）。支持（其余一律当段落）：

| 写法 | 区块 |
| --- | --- |
| `# ` / `## ` / `### ` 开头 | 标题 1/2/3 |
| `- ` 或 `* ` 开头 | 项目符号列表 |
| `1. `（任意数字加点和空格）开头 | 有序列表 |
| `- [ ] ` / `- [x] ` 开头 | 待办（`checked` 为假/真） |
| `> ` 开头 | 引用 |
| 三个反引号起止的多行（第一行可带语言） | 代码块（`language` 为那个词，没有则 `"text"`） |
| 空行 | 分隔段落，不产生空区块 |

行内：`**粗体**`、`*斜体*`、`` `代码` `` 转成带 `styles` 的文字片段；其他字符原样。

### 1.5 收件箱视图

- 侧栏“收件箱”行（在 Home 与 Recents 之间），右侧数字 = 收件箱里的页面数 + 未读提醒数（为 0 时不显示；样式见 1.7 节）。
- 视图两个标签页：
  - **待整理**：`folderId === "system-inbox"` 且不在回收站的页面，按 `inboxedAt` 降序；每行：复选框、标题、摘要、时间；操作：打开、归档到…（选择文件夹对话框，复用 WP-01 的文件夹树样式，不含系统文件夹）、移到回收站。勾选多行后顶部出现“归档到…”批量操作。
  - **提醒**：`ui.reminderLog`（最新在上）；每行：页面标题、提醒时间、来源（“提及”或“<数据库名> · <属性名>”）、`missed` 时显示“错过的提醒”；未读加粗；点击行打开页面并标为已读；顶部“全部标为已读”。
- `src/domain/inbox.js`：`archivePages(workspace, pageIds, targetFolderId, now)` → 把这些页面的 `folderId` 改为目标、`inboxedAt = null`、`updatedAt = now`（**同一个 id**，不复制）；目标不存在、在回收站或是系统文件夹时抛错。

### 1.6 本地提醒

- **提及提醒**：`DateMention` 的 `propSchema` 增加 `reminderId: { default: "" }`；提及菜单增加一项“提醒”（分组“日期”）：弹一个小框，`<input type="datetime-local">`，确定后插入 `{ type: "dateMention", props: { value: "<YYYY-MM-DDTHH:mm>", kind: "reminder", reminderId: "rem-<uuid>" } }`；显示为“⏰ M月D日 HH:mm”。
- **日期属性提醒**：日期值对象增加可选字段 `reminder: { offset, id }`，`offset` 取 `"atTime"`、`"5m"`、`"1h"`、`"1d"` 之一，`id` 为 `"rem-<uuid>"`；`normalizeDate` 已经保留未知字段，确认后不需要改；`PropertyEditor` 的日期编辑控件旁加一个下拉框“提醒”（无 / 准时 / 提前 5 分钟 / 提前 1 小时 / 提前 1 天），`aria-label` 为 `提醒 · <记录标题>`。（WP-15 重做日期编辑器时必须保留这个功能。）
- **计算**（`src/domain/reminders.js`，纯函数）：
  - `collectReminders(workspace)` → `[{ key, reminderId, fireAt, pageId, title, source }]`：提及提醒的 `fireAt` = `value` 按本地时间解析；属性提醒的基准时间 = 日期的 `start`（`includeTime` 为真时含时间，否则本地 09:00），再减去 `offset`；`key = reminderId + "@" + new Date(fireAt).toISOString()`（改了时间就是新的 key）；页面在回收站的跳过。
  - `dueReminders(reminders, { nowMs, firedKeys })` → `fireAt <= nowMs` 且 `key` 不在 `firedKeys` 里的。
- **调度**（`App.jsx`）：启动时与之后每 30 秒检查一次：
  - 启动时：`fireAt` 早于本次启动时间的到期提醒，作为 `missed: true` 写进 `ui.reminderLog`，不发系统通知；
  - 运行中到期的：写进 `ui.reminderLog`（`missed: false`），桌面版调用 `window.lifeAtlas.app.notify({ title: 页面标题, body: "提醒时间 " + 时间, pageId })`；
  - 每次都把处理过的 `key` 加进 `ui.firedReminderIds`（只保留最近 1000 个），并更新 `ui.lastReminderCheckAt`；
  - `reminderLog` 每条：`{ key, pageId, title, fireAt, source, missed, readAt: null }`，最多保留 500 条。
- **主进程通知**：`la:app:notify` → `new Notification({ title, body })`，点击时显示并聚焦工作区窗口，发 `la:app:notification-click` `{ pageId }`；渲染进程收到后打开页面并把对应提醒标为已读。测试钩子开启时不真正显示通知，只记录到 `globalThis.__lifeAtlasTest.notifications`（数组，11 第 5 节本 WP 加入）；`__lifeAtlasTest.clickNotification(index)` 模拟点击。

### 1.7 墨白样式（规定）

- **参照画面**：快速记录框 `design/mobai/shots/capture-light.png`、`capture-dark.png`（原型 `design/mobai/prototype/index.html#view=capture&mode=light`，夜间把 `light` 换成 `dark`）。原型**只看不改**。
- **样式文件**：新文件 `src/ui/themes/mobai/inbox.css`，在 `src/ui/themes/mobai/index.css` 末尾追加一行 `@import "./inbox.css";`（只能追加，前面的行不动）。快速记录框照原型 `b-more.css` 的 “quick capture” 一段（`.capture`、`.cap-*`）改写：每个选择器前加 `:root[data-style="mobai"] `，变量按 12 第 0 节的对应表换名，只用 `--mb-*` 变量（白字除外，写 `#fff`，和 WP-20 `base.css` 的主按钮一样）；旧 CSS 里不写颜色（K13）。外壳沿用产品的 `.modal-backdrop` + `.ui-dialog`（WP-20 已写好 12 px 圆角、阴影和遮罩）；框本身照原型 `.capture`：宽 620 px、离窗口顶部 110 px、内边距 16 px 20 px 14 px；这个框的遮罩比普通对话框淡一半（原型 `.scrim-light`：`color-mix(in srgb, var(--mb-scrim) 50%, transparent)`）。
- **头部**（原型 `.cap-head`）：左边“快速记录”14 px 600 `--mb-muted`；右边“保存到”13 px `--mb-muted`，后面的“收件箱”是一个小块：高 24 px、左右 8 px、圆角 6 px、`--mb-hover` 底、`--mb-ink` 字，前面一个 `IconInbox` 图标。
- **标题和正文**（原型 `.cap-title`、`.cap-text`）：标题 24 px 700（`--mb-sans`，行高 1.3），离头部 14 px；正文 16 px、行高 1.5、最矮 96 px，离标题 6 px；都是 `--mb-ink`，都没有边框和底色，聚焦时也不画框。
- **底部**（原型 `.cap-foot`）：上面 1 px `--mb-line` 细线，细线和这一行之间 12 px；左边的小字 12 px `--mb-faint`；两个按钮隔 8 px，都是 28 px 高：“保存并打开”是次按钮（原型 `.btn-line`：圆角 6 px、1 px `--mb-line-2` 描边）；“保存”是 Notion 蓝主按钮（原型 `.btn-primary`：`--mb-accent` 底、白字（`#fff`）14 px 500、圆角 6 px，悬停 `--mb-accent-hover`），按钮里的键帽 `Ctrl` `Enter` 是 12 px 白字、`opacity: 0.75`。
- **侧栏**：“快速记录”行（图标 `IconPencil`）和其他导航行一样；“收件箱”行（图标 `IconInbox`）右边的数字是原型 `b.css` 的 `.nav-badge`：红色小胶囊，高 18 px、最窄 18 px、左右 5 px、圆角 9 px，`--mb-today` 底，白色（`#fff`）11 px 600 数字，居中。
- **收件箱视图**没有单独的效果图：标题区和 WP-20 的文件夹视图一样（`design/mobai/product-shots/folder-*`）；“待整理”“提醒”是 12 第 6 节的文字选项卡；列表和 WP-20 文件夹视图的笔记行一样（`views.css` 的 `.folder-note-row` 等：一行一条、圆角 6 px，悬停 `--mb-hover` 灰底），勾选的行 `--mb-select` 底；时间 12 px `--mb-muted`、`tabular-nums`；勾选多行后出现的批量操作条在列表上方，“归档到…”是主按钮；未读提醒加粗；“错过的提醒”是 12 第 6 节的标签。
- **`@提醒` 的时间小框、日期属性的“提醒”下拉框**：12 第 6 节的输入框和下拉框。

## 2. 执行步骤

### 步骤 0：开工准备

按执行手册 3.1 节开工（分支 `wp/13-inbox`），生成报告骨架，跑基线 `npm test`。理解题：

1. 归档一条快速记录后，它的页面 ID 变不变？
2. 应用关闭期间到点的提醒，下次启动时会怎样？会弹系统通知吗？
3. 把一个日期属性提醒从 9:00 改到 10:00，会不会再提醒一次？

提交 `WP-13: step 0 understanding`（本步不停）。

### 步骤 1：schema v15 与系统文件夹规则

按 1.1、1.2 实现。新建 `tests/migration-v15.test.mjs`（直接调用 `migrateInbox`）：`v15 creates exactly one inbox`、`v15 adds inbox and reminder fields`、`v15 is idempotent`、`v15 does not read the clock`（两次调用、不同时间，结果深度相等）。新建 `tests/system-folders.test.mjs`：`system folders are hidden from the private tree`、`system folders cannot be trashed moved renamed or used as a move target`、`integrity reports an invalid system folder`、`search shows the inbox path`。提交 `WP-13: schema v15 and system folders`。

### 步骤 2：Markdown 转区块

按 1.4 实现。新建 `tests/markdown-blocks.test.mjs`：每种写法一个用例（用例名 `markdown <写法> becomes <区块>`，共 7 个），加 `inline bold italic and code become styled text`、`blank lines do not create empty blocks`。提交 `WP-13: markdown to blocks`。

### 步骤 3：快速记录

按 1.3 实现（渲染进程部分；全局快捷键在步骤 7）。提交 `WP-13: quick capture dialog`。

### 步骤 4：收件箱视图与归档

按 1.5 实现。新建 `tests/inbox.test.mjs`：`archiving keeps the page id and clears inboxedAt`、`batch archiving moves every selected page`、`archiving into a system folder or trashed folder is refused`。提交 `WP-13: inbox view and archiving`。

### 步骤 5：两个提醒入口

按 1.6 前两条实现。提交 `WP-13: reminder entry points`。

### 步骤 6：提醒计算与调度

按 1.6 后两条（渲染进程部分）实现。新建 `tests/reminders.test.mjs`（固定时区无关：用 `new Date(2026, 10, 5, 9, 0).getTime()` 这类本地时间构造期望值）：

- `mention reminders fire at their local time`
- `property reminders apply the offset and a 9 am default`
- `changing the time creates a new key`
- `due reminders skip fired keys`
- `reminders on trashed pages are ignored`

提交 `WP-13: reminder scheduling`。

### 步骤 7：主进程全局快捷键与通知

按 1.3 第 1 条与 1.6 最后一条实现主进程部分与 preload 的 4 个函数（11 第 1 节）。`app.on("will-quit")` 里 `globalShortcut.unregisterAll()`。提交 `WP-13: global shortcut and notifications`。

### 步骤 8：浏览器场景

新建 `tests/browser/wp13-inbox.mjs`（种子：满配夹具；`browserScenario` 的第三个参数加 `viewport: { width: 1440, height: 900 }`）。下面说的“截图 `x`”一律写成 WP-12 的 `await shootBothModes(page, screenshot, "x")`，白天、夜间各一张。检查项：

1. `Quick capture works from the sidebar and the keyboard`：侧栏按钮打开、输入标题与带 Markdown 的正文，截图 `capture`（加 `{ keepVisible: '[aria-label="快速记录"]' }`，和参照图同名），`Ctrl+Enter` 保存；再用 `Ctrl+Shift+N` 打开一次、只写正文保存（标题取正文前 30 个字）。
2. `Saved notes are inbox pages with converted blocks`：用 `saved()` 断言新页面在 `system-inbox`、`inboxedAt` 有值、正文区块类型正确。
3. `Archiving moves the same page and updates the count`：归档到“Z 其他”→ 同一个 id 的页面 `folderId === "f-z"`、`inboxedAt === null`；收件箱计数减 1；批量归档两条。截图 `inbox-pending`。
4. `The inbox is searchable and hidden from the private tree`。
5. `A mention reminder fires and opens its page`：用 `page.clock.install({ time: … })` 控制页面时间；插入一个 1 分钟后的 `@提醒` → `page.clock.fastForward("01:05")` → “提醒”标签页出现这一条 → 点击打开页面。截图 `inbox-reminders`。

加入场景列表；单独运行，日志 `.qa/WP-13/browser-wp13.log`。通过后生成对照图：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-13/compare.log node docs/blueprint/tools/compare-shots.mjs docs/blueprint/design/mobai/shots .qa --prefix wp13-inbox- --only capture --out .qa/WP-13/compare
```

退出码 0。背后的页面和输入的文字与原型不同，差异占比只供参考；把 `summary.md` 复制进报告第 3 节，并写出你看到的不同之处（布局、字体、颜色、线条）。收件箱视图没有参照图，由总设计师直接看截图。提交 `WP-13: inbox browser scenario`。

### 步骤 9：桌面端到端

新建 `tests/desktop/inbox.e2e.mjs`：

- `the global shortcut opens quick capture`：`handle.app.evaluate` 里直接调用主进程注册时保存的快捷键回调（在 `index.js` 里测试钩子开启时把回调挂到 `globalThis.__lifeAtlasTest.triggerQuickCapture`，11 第 5 节本 WP 加入）→ 快速记录框出现。
- `due reminders send a desktop notification and clicking opens the page`：提醒调度在渲染进程里，用的是渲染进程的 `Date.now()`，所以本用例用 Playwright 的 `page.clock`（`handle.page.clock.install(…)` 后 `fastForward`）把时间推过提醒时间 → `__lifeAtlasTest.notifications` 里有一条 → `clickNotification(0)` → 页面被打开。
- `missed reminders appear once after a restart`：设置一个已过去的提醒并保存 → 关闭 → 重启 → “提醒”里有一条“错过的提醒”，`notifications` 为空 → 再重启一次，仍然只有一条。

运行：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-13/desktop-build-test.log npm run desktop:build:test
node docs/blueprint/tools/run-logged.mjs .qa/WP-13/desktop-e2e.log npm run test:e2e:desktop
```

提交 `WP-13: inbox desktop tests`。

### 步骤 10：收尾【停止点】

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-13/npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-13/browser-all.log npm run test:parity:browser
```

填完报告；第 0 节全部“完成”；提交 `WP-13: complete report`；运行 `node docs/blueprint/tools/wp-check.mjs WP-13 --browser --desktop`，退出码 0 或 2 → 停止。

## 3. 范围

### 不做

- 重复提醒、提醒指派给他人、邮件/手机推送（都需要联网或多人）。
- 网页剪藏。

## 4. 验收标准

| 编号 | 标准 | 证据 |
| --- | --- | --- |
| AC-13-1 | 快速记录三种入口都可用（全局快捷键在桌面端到端里由主进程触发验证） | 场景检查 1；「the global shortcut opens quick capture」 |
| AC-13-2 | 保存的记录是收件箱里的普通页面；Markdown 正文转成对应区块；空标题规则正确 | 场景检查 2；`tests/markdown-blocks.test.mjs` |
| AC-13-3 | 归档：同一个 ID 移到目标文件夹、`inboxedAt` 清除、计数减少；批量归档可用 | 场景检查 3；`tests/inbox.test.mjs` |
| AC-13-4 | 收件箱页面能被搜到、路径为“收件箱”；系统文件夹不在 Private 树中，不能删/移/改名 | 场景检查 4；`tests/system-folders.test.mjs` |
| AC-13-5 | `@提醒` 与日期属性提醒按时触发并进入“提醒”列表；桌面版发系统通知；点击打开页面 | `tests/reminders.test.mjs`；场景检查 5；「due reminders send a desktop notification…」 |
| AC-13-6 | 关闭期间到点的提醒在启动后作为“错过的提醒”出现一次，不重复，不发通知 | 「missed reminders appear once after a restart」 |
| AC-13-7 | 迁移 14→15 纯函数、幂等（只有一个收件箱）、不读时钟 | `tests/migration-v15.test.mjs` |
| AC-13-8 | 视觉：快速记录框和收件箱照墨白做（1.7 节）；截图：快速记录框、收件箱两个标签页，白天和夜间各一张；快速记录框与参照图并排对照 | `.qa/wp13-inbox-capture-*.png`、`.qa/wp13-inbox-inbox-pending-*.png`、`.qa/wp13-inbox-inbox-reminders-*.png`；`.qa/WP-13/compare/summary.md`；报告第 3 节 |
| AC-13-9 | G1–G9 | `.qa/WP-13/wp-check.md` |

## 5. 卡点处理

| 情况 | 做法 |
| --- | --- |
| 改 `DateMention` 的 `propSchema` 后旧文档里的日期提及出错 | 新属性必须有默认值 `""`，旧数据没有这个属性时 BlockNote 会用默认值；如果仍报错，停下报告 |
| `page.clock` 让编辑器卡住 | 先 `page.clock.install` 再打开页面；只在需要推进时间时 `fastForward` |
| 全局快捷键在测试机上注册失败 | 这是允许的情况（会显示“已被占用”）；测试用 `triggerQuickCapture` 钩子直接触发回调，不依赖真实按键 |
