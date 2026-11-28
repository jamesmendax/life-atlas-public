# WP-07 密钥库窗口与交互

- 规模：L · 前置：WP-06 · 分支：`wp/07-vault-window`
- 停止点：步骤 1（对照效果图与理解确认）、步骤 12（收尾）
- 必读：`03-密钥库安全设计.md` 第 2、4、7、8、10、11 节；`11-接口契约.md` 第 1 节（WP-07 的行）、第 2 节；`02-总体架构.md` 第 7 节；`01-需求与范围.md` D-05、D-25；`12-视觉规范-墨白.md` 第 0–8、10 节（尤其第 8 节的锁孔圆盘）；原型 `design/mobai/prototype/index.html`（画面 `vault-setup`、`vault-locked`、`vault`）与截图 `design/mobai/shots/vault-*`；`design/mobai/theme/tokens.css`；`AGENTS.md`；`09-执行手册.md`

## 0. 一页纸

- **要做到**：用户看得见、摸得着的密钥库——侧栏“密钥库”入口打开独立窗口；第一次设置主密码并保存恢复密钥；之后每次解锁；七种条目的新建、查看、编辑、删除；敏感字段默认遮盖、复制后自动清除；两步验证码实时显示；设置里能改主密码、重新生成恢复密钥、重置。
- **交付物**：密钥库窗口（主进程）；`vault.html` 与 `src/vault-ui/`（含墨白样式表 `src/vault-ui/vault.css`）；工作区侧栏入口；`tests/desktop/vault.e2e.mjs`；白天和夜间的截图与对照图。
- **绝对不要**：在步骤 1 停止前写实现代码；让 `src/vault-ui/` 引入编辑器、BlockNote、工作区组件或工作区的 CSS（`src/ui/` 下的任何文件）；在 DOM 里留下未显示的敏感值；在工作区窗口里出现任何主密码输入框；用保险箱门、挂锁剪贴画、黑客绿字这类套路视觉（12 第 8 节规定的锁孔圆盘不算）；加载任何在线字体或图片。
- **什么时候停**：步骤 1 结束停一次（总设计师确认你对效果图的理解）；步骤 12 的 wp-check 退出码为 0 或 2 时停。

## 1. 为什么做

用户要“专门用来存我各种账号以及密钥的地方”，要私密、要输入密码才能进。

## 2. 视觉：墨白（已定）

用户已经选定墨白（`12-视觉规范-墨白.md`）。密钥库窗口照下面三个参照画面做，白天和夜间各一套：

| 画面 | 参照截图 | 原型地址（`design/mobai/prototype/index.html` 后面加） |
| --- | --- | --- |
| 设置主密码（`create-password`） | `design/mobai/shots/vault-setup-light.png`、`vault-setup-dark.png` | `#view=vault-setup&mode=light`（夜间把 `light` 换成 `dark`） |
| 锁屏（`locked`） | `design/mobai/shots/vault-locked-light.png`、`vault-locked-dark.png` | `#view=vault-locked&mode=light` |
| 主界面（`main`，右栏打开一个登录账号） | `design/mobai/shots/vault-light.png`、`vault-dark.png` | `#view=vault&mode=light` |

- **窗口和工具栏**：原型把密钥库画成一扇 1104×720 的窗口。最上面 44 px 那一行，在产品里是**窗口内容最上面的工具栏**（窗口本身用系统标题栏；WP-20 已经去掉菜单栏）：左边 18 px 盾牌图标、14 px 600 的“密钥库”、12 px `--mb-faint` 的“Life Atlas”；解锁以后，中间是搜索框（`aria-label="搜索条目"`；原型 `.vw-search`：最宽 340 px、高 28 px、圆角 6 px，`--mb-field` 底、一圈 1 px `--mb-field-line`，左边一个搜索图标），右边是 12 px `--mb-muted` 的小字“闲置 N 分钟后上锁”（前面一个时钟图标；N 是 `getSettings()` 的 `autoLockMinutes`，静态文字，不做倒计时）和次按钮样子的“上锁”（原型 `.vw-lock-btn`：高 28 px、1 px `--mb-line-2` 描边、14 px 500 的 `--mb-ink` 字，前面一个锁图标，悬停 `--mb-hover` 底）。原型最右边画的三个窗口按钮属于系统标题栏，**不要做**；工具栏左边留 16 px、右边留 12 px。
- **样式文件**：`src/vault-ui/vault.css`（新文件，由 `src/vault-ui/main.jsx` 导入）。开头三段变量：照抄 `design/mobai/theme/tokens.css` 最前面三段里的全部 `--mb-*` 变量（12 第 3 节），就是字体和圆角一段（`--mb-sans`、`--mb-serif`、`--mb-mono`、`--mb-numeral`、`--mb-r1`–`--mb-r4`；少了这一段，文字会退回浏览器的默认字体）、白天一段和夜间一段；前两段的选择器改成 `:root { … }`，夜间一段改成 `@media (prefers-color-scheme: dark) { :root { … } }`，并在 `:root` 里加 `color-scheme: light dark;`。后面的规则照原型改写：`design/mobai/prototype/shared/structure.css` 第 2–8 行的重置规则（`box-sizing`、`html, body`、`button`、`input`）和 “vault window” 一段（三栏网格和各行的 flex 排法）；`b.css` 的“vault window”一段和 `.top-btn`；`b-more.css` 的“separate windows”“vault detail additions”两段，以及 “small parts” 一段的 `.btn-line`、`.btn-sm` 和 “form controls” 一段的 `.step`。变量按 12 第 0 节的对应表换名（`--st-done-dot` 换成 `--mb-u-green`）；蓝底、绿底上的白字照原型写 `#fff`；**不加** `:root[data-style="mobai"]` 前缀（密钥库窗口只有墨白一种风格）；类名可以照抄原型。原型里只用来画“浮在桌面上的一扇窗口”的规则**不要抄**：`body[data-view^="vault"]`、`.la-app`、`.vw-stage`、`.vw` 的宽、高、圆角和阴影、`.win-ctl` 和 `.win-*`；产品里 `.vw` 占满整个窗口（`width: 100vw; height: 100vh`）。
- **字体**：`src/vault-ui/main.jsx` 最前面一行 `import "@fontsource-variable/noto-sans-sc";`（WP-20 已经装好）。密钥库窗口的文字都是 `--mb-sans`，密码、恢复密钥、验证码和条目副标题是 `--mb-mono`，没有衬线字，所以不导入 `@fontsource-variable/noto-serif-sc`。字体文件随构建打包到 `app://bundle`，密钥库 CSP 的 `default-src 'self'` 允许加载。
- **白天和夜间**：只跟随 `prefers-color-scheme`。WP-20 让主进程按用户的偏好设置 `nativeTheme.themeSource`，所以用户在工作区切换模式，密钥库窗口自动跟着变；密钥库窗口里**不放**切换按钮。窗口底色用 WP-20 的 `themeBackgroundColor()`。
- **锁孔圆盘**（12 第 8 节，原型 `.lock-object`）：外径 120 px，下面空 28 px；外圈是 3 px 的细环，底色 `--mb-line`，蓝色（`--mb-accent`）部分 = 主密码框里已输入的字符数 × 30°（最多 12 格，就是整圈），用 CSS 变量传，写在 `.lock-object` 上：`style={{ "--pw": Math.min(password.length, 12) }}`，规则照原型 `.lock-ring`；里面是 96 px 的 `--mb-side` 浅灰圆（`.lock-disc`，`inset: 12px`），中间一个 `--mb-ink` 锁孔（`.keyhole`：18 px 的圆加一个梯形）；解锁成功时给 `.vw-locked` 加 `is-unlocking`（圆盘转 90°、外圈整圈变蓝，700 ms，缓动 `cubic-bezier(.7, 0, .3, 1)`），`transitionend` 之后进入主界面；`prefers-reduced-motion: reduce` 时不等动画，直接进入。
- **主界面的内容以第 6 步为准**：原型左栏只是示意，产品左栏是“全部、收藏、7 种类型（名称用 03 第 6.1 节的界面名称）、“标签”小标题下的标签；底部回收站、设置”。条目行（原型 `.vw-item`：高 52 px、圆角 6 px）左边是标题第一个字的方块（`.mono`：32 px、圆角 6 px、`--mb-hover` 底、15 px 600 的 `--mb-ink` 字，每一行都一样），中间标题（14 px 500）和副标题（12 px 等宽字、`--mb-muted`），右边类型名（12 px `--mb-faint`）；悬停 `--mb-hover` 底，选中的行 `--mb-select` 灰底，不加左边竖线、不加粗（12 第 1 节原则 5）。详情的字段区一行一个字段（原型 `.vw-fields`、`.vw-field`：每行至少 44 px 高，行与行之间 1 px `--mb-line` 细线，第一行上面也有一条；左边 118 px 宽的 14 px `--mb-muted` 标签，右边 14 px `--mb-ink` 的值，敏感值用等宽字），字段顺序就是条目的字段顺序。
- **原型没画的画面**：保存恢复密钥、确认恢复密钥、用恢复密钥找回、重置这 4 个，和“设置主密码”一样居中单列、顶部 3 个编号步骤（找回和重置的步骤文字按各自流程写）；设置画面、新建/编辑条目放在主界面右栏的位置；确认请求框是居中的对话框（12 第 6 节“对话框”：`--mb-scrim` 遮罩，`--mb-raised` 底、圆角 12 px、`--mb-dlg` 阴影，标题 16 px 600，按钮靠右、次按钮在左主按钮在右）。控件只用 12 第 6 节的组件。每个画面在报告第 5 节写一句你是怎么做的。
- **动效**：12 第 10 节；`prefers-reduced-motion: reduce` 时全部动效时长接近 0。

## 3. 第一步：开工与对照效果图

### 步骤 0：开工准备

按执行手册 3.1 节开工（分支 `wp/07-vault-window`），生成报告骨架，跑基线 `npm test`。理解题：

1. 工作区窗口能拿到密钥库的哪些信息？
2. 敏感字段在什么情况下可以出现在 DOM 里？“出现在 DOM 里”包括哪些地方？
3. 用户在工作区窗口导出含密钥库的备份时，主密码在哪里输入？

提交 `WP-07: step 0 understanding`（本步不停）。

### 步骤 1：对照效果图与理解确认【停止点】

1. 用 Edge 打开第 2 节表格里的三个原型地址，`mode=light` 和 `mode=dark` 都看一遍，再对照 `design/mobai/shots/` 里的 6 张截图。原型**只看不改**。
2. 在报告第 3 节写一张表，密钥库的每个画面一行：`intro`、`create-password`、`show-recovery-key`、`confirm-recovery-key`、`locked`、`recover-with-key`、`reset`、`settings`、`main`、`edit-item`、确认请求框。三列：照哪个原型画面做（没画的写“无，按第 2 节”）；用到 12 第 6 节的哪些组件；原型里有、但本 WP 不做或做法不同的东西（例如三个窗口按钮、左栏的分类）。
3. 在报告第 1 节接着回答：
   4. 密钥库窗口的颜色写在哪个文件里？它怎么知道现在是白天还是夜间？
   5. 锁孔圆盘外圈亮多少由什么决定？解锁成功时圆盘怎么变化？用户打开“减少动态效果”时呢？
   6. 产品左栏有哪些项？原型左栏和它不一样时以哪份文件为准？
4. 报告第 0 节步骤 0、1 标为“完成”，提交 `WP-07: step 1 visual mapping`，运行 `node docs/blueprint/tools/wp-check.mjs WP-07 --until 1`，退出码 0 → **停止**。总设计师看过表格后，用户会发 `08` 第 3 节“继续 WP-07”。

## 4. 第二步：实现

### 步骤 2：密钥库窗口（主进程）

1. `electron/main/windows.js` 增加 `createVaultWindow({ preload })`：内容区 1104×720（`useContentSize: true`，和原型一样大），最小 900×600，标题“密钥库”，`backgroundColor: themeBackgroundColor()`（WP-20）；`webPreferences` 照 02 第 7 节，另加 `partition: "vault"`；创建后立即 `setContentProtection(true)`；加载 `app://bundle/vault.html`（开发地址时为 `<LIFE_ATLAS_DEV_URL>/vault.html`）；导航白名单只允许 `vault.html`；同一时间只有一个密钥库窗口，已存在时 `show()` + `focus()`。
2. `session.fromPartition("vault")` 上**再装一次**：`installAppProtocol`（CSP 用 02 第 7 节的密钥库版本，常量 `VAULT_CSP` 放 `security.js`）、`installSessionSecurity`（网络拦截；权限一律拒绝，连 `clipboard-sanitized-write` 也不允许——复制由主进程完成）。
3. 把窗口的 `webContents.id` 交给 WP-06 的 `registerVaultIpc` 的 `getVaultWindowId`；窗口关闭时 `getVaultWindowId` 返回 `null`。
4. 上锁触发：窗口 `closed` → `lock("window-closed")`；`powerMonitor` 的 `lock-screen` → `lock("system-lock")`、`suspend` → `lock("suspend")`；`before-quit` → `lock("app-quit")`；设置了“最小化时上锁”时窗口 `minimize` → `lock("minimized")`。
5. 服务装配：`clipboard` 用 Electron 的 `clipboard`；`getSystemIdleSeconds` 用 `powerMonitor.getSystemIdleTime()`；`clock` 在测试钩子开启时用 `__lifeAtlasTest.clock`；`confirmRequests.deliver` 打开/聚焦密钥库窗口后 `webContents.send("la:vault:confirm-request", 请求)`（窗口还没加载完时等 `did-finish-load` 再发）。
6. 工作区窗口的接口（11 第 1 节）：`la:app:open-vault-window`、`la:app:get-vault-status`；`onVaultStatusChanged` 用 `la:app:vault-status-changed` 事件，在服务的 `onStatusChanged` 回调里推送。preload `workspace.cjs` 增加这 3 个函数。

提交 `WP-07: vault window and session hardening`。

### 步骤 3：入口构建

- `vault.html`（项目根目录，结构同 `index.html`，`<title>密钥库</title>`），入口 `src/vault-ui/main.jsx`；`vite.config.mjs` 的 `build.rollupOptions.input` 增加 `vault: "vault.html"`。
- `src/vault-ui/` 只允许 import：`react`、`react-dom`、`@tabler/icons-react`、`@fontsource-variable/noto-sans-sc`、`@fontsource-variable/noto-serif-sc`，以及 `src/vault-ui/` 内部文件（包括 `vault.css`）。新建 `tests/vault-ui-boundaries.test.mjs`：
  - `vault ui imports only allowed modules`（扫描 `src/vault-ui/` 下所有 `.js`/`.jsx` 的 `import` 语句）
  - `vault ui never touches browser storage`（S15：源码里不出现 `localStorage`、`sessionStorage`、`indexedDB`、`document.cookie`、`caches.`）
- `npm run build` 后 `dist/client/vault.html` 必须存在。

提交 `WP-07: vault entry point`。

### 步骤 4：界面状态机

`src/vault-ui/App.jsx` 用一个 `screen` 状态管理画面：`loading` → 根据 `status()` 进入 `intro`（不存在）或 `locked`（已存在且上锁）或 `main`（已解锁）。其余画面：`create-password`、`show-recovery-key`、`confirm-recovery-key`、`recover-with-key`、`reset`、`settings`；`edit-item` 是主界面上的覆盖层；确认请求框是**最上层**的覆盖层，任何画面都能出现。

- 收到 `onLocked` → 用一个递增的 `key` 重建整个已解锁界面的根组件，回到 `locked`（保证内存里的界面状态全部丢弃）。
- `unlock` 返回 `requiresRecoveryKeyRegeneration: true` → 直接进入“重新生成恢复密钥”流程（要求再输入一次主密码 → `regenerateRecoveryKey` → `show-recovery-key` → `confirm-recovery-key`），完成前不显示任何条目。
- 每次用户操作（点击、键盘）调用 `activity()`，最多每 15 秒一次。
- 所有文案中文；所有按钮有可读的 `aria-label` 或文字。

### 步骤 5：首次设置、锁屏、找回、重置

严格按 03 第 11 节第 1–4 条：

- 设置主密码（照原型 `vault-setup`）：顶部 3 个编号步骤“1 设置主密码”“2 保存恢复密钥”“3 确认恢复密钥”（原型 `.setup-steps` 里的 `.step`：13 px `--mb-faint`，当前步骤是 `--mb-ink`、500 字重、下面一条 2 px `--mb-ink` 线）；两个密码框是 12 第 6 节的输入框（原型 `.setup-form .lock-field`：宽 320 px、高 34 px、圆角 6 px，`--mb-field` 底、一圈 1 px `--mb-field-line`，左边一个钥匙图标，聚焦时 `--mb-focus` 光圈）；强度条 3 段（每段 26×4 px、圆角 2 px、间隔 3 px；弱 1 段、中 2 段、强 3 段亮成 `--mb-u-green`，其余 `--mb-line-2`，旁边写 12 px `--mb-muted` 的“弱”“中”“强”）；两次输入不一致时第二个框下面写 12 px `--mb-danger` 的“两次输入不一致”；4 条规则逐条显示打勾状态（满足的是 16 px 的 `--mb-u-green` 绿色圆点、里面一个白色对勾，文字 `--mb-ink`；没满足的是 1.5 px `--mb-line-2` 细线的空心圆，文字 `--mb-muted`），文字依次是“至少 12 个字符”“至少 5 个不同字符”“不是常见密码（提交时检查）”“不是简单序列或重复”；规则 1、2、4 满足且两次输入一致时“下一步”才可点（“下一步”是蓝色主按钮，原型 `.lock-submit`；不可点时 40% 透明，原型 `.lock-submit.is-disabled`）。规则 1、2、4 与强度估算在 `src/vault-ui/passwordRules.js` 里实现（与 03 第 4.1 节完全相同，输入时实时显示）；规则 3（常见密码）只由主进程在 `create`/`changePassword` 时判断，失败返回 `E_INVALID_ARGUMENT`，界面上规则 3 那一行显示“不是常见密码（提交时检查）”，提交失败时把这一行标红（`--mb-danger`）。
- 恢复密钥画面：大号等宽字体按组显示；按钮“保存恢复卡”（`saveRecoveryKit`）、“复制”（`copyPendingRecoveryKey`）；提示“请离线保存，不要存在这台电脑上”；“我已保存，下一步”。
- 确认画面：输入最后两组；错误时提示“和恢复密钥的最后两组不一致”。
- 锁屏（照原型 `vault-locked`）：锁孔圆盘（第 2 节）；26 px 700 的“密钥库已上锁”（原型 `.lock-title`）；一句 14 px `--mb-muted` 的说明“输入主密码解锁。N 分钟没有操作会自动上锁。”；主密码框（12 第 6 节的输入框，原型 `.lock-field`：宽 280 px，其余同上面设置主密码的输入框）自动聚焦，回车或蓝色主按钮“解锁”（原型 `.lock-submit`：高 34 px、`--mb-accent` 底、14 px 500 白字，悬停 `--mb-accent-hover`）解锁；错误提示写在密码框下面（12 px `--mb-danger`）；`E_THROTTLED` 时显示倒计时并禁用解锁按钮；下面两个链接“忘记主密码？使用恢复密钥”（14 px `--mb-muted`，下划线是 `--mb-line-2`）和小一号的“忘记了主密码和恢复密钥？重置密钥库”（12 px `--mb-faint`）。
- 找回：输入恢复密钥 → 新主密码 → 新恢复密钥 → 确认。
- 重置：说明文字 → 输入“重置我的密钥库”→ 10 秒倒计时后按钮可点 → `resetVault` → 回到 `intro`。

### 步骤 6：主界面与详情

- 左栏：全部、收藏、7 种类型、“标签”小标题下的标签（从摘要里收集），每项右边是数量；底部“回收站”“设置”。上锁用顶部工具栏的“上锁”按钮（第 2 节）。
- 中栏：顶部一行（原型 `.vw-list-head`，高 40 px）是 16 px 600 的当前分类名、12 px `--mb-faint` 的“N 个条目”和蓝色主按钮“新建”（原型 `.vw-new`：高 28 px、`--mb-accent` 底、14 px 500 白字）；排序（最近修改 / 名称）；条目行（第 2 节：标题第一个字的方块、标题、副标题、类型名；到期标记在 WP-11）。搜索框在顶部工具栏（按标题、副标题、标签、主机名过滤摘要）。
- 右栏：`getItem` 的详情；不敏感字段显示值；敏感字段显示 `••••••••` + “显示”“复制”；“显示”调用 `revealField`，20 秒后或窗口失焦（`window` 的 `blur`）时重新遮盖，并把值从 DOM 里移除；“复制”调用 `copyField`，字段下方出现一条 120 px 宽、4 px 高的进度条（原型 `.copy-clear`、`.copy-bar`：底色 `--mb-line`，进度 `--mb-accent`）和 12 px `--mb-muted` 的“已复制，N 秒后清除剪贴板”（N 来自返回值，进度条在 N 秒内从满到空）；TOTP 字段显示 22 px 500 的等宽大数字（`--mb-mono`，3 位一组，组间空 10 px）和一个 24 px 的蓝色细圆环倒计时（原型 `.totp-ring`：2 px 的环，剩余时间占的部分是 `--mb-accent`、其余 `--mb-line`，中间是 10 px 600 的 `--mb-accent` 剩余秒数），每次倒计时结束调用 `getTotp`；网址字段有“打开”（`openFieldUrl`）。
- **DOM 里的秘密**：未显示的敏感值不能出现在任何地方（文本、`value` 属性与属性值、`title`、`aria-*`、隐藏元素、`data-*`）。

### 步骤 7：编辑与新建

- 表单：类型（新建时选，预设字段按 03 第 6.1 节）、标题、标签、收藏、字段列表（每行：标签、类型、敏感开关、值；可增删、上移下移）、内嵌密码生成器（长度滑块 8–128、四个字符类开关、排除易混字符、“生成”“使用”）。
- 编辑已有条目时，敏感字段的输入框默认为空，占位文字“保持不变（点“显示”可查看）”；用户没有输入新值、也没有点过“显示”时，保存时传 `keepValue: true`（11 第 4.7 节）。
- 保存调用 `createItem`/`updateItem`；删除调用 `trashItem`；回收站里可以“恢复”和“永久删除”（后者需要 `window.confirm`）。

### 步骤 8：设置与确认请求框

- 设置画面：自动上锁时间、剪贴板清除时间、最小化时上锁、显示密码前验证（`updateSettings`）；“修改主密码”（当前密码 + 新密码两次 → `changePassword` → 显示新恢复密钥 → 确认）；“重新生成恢复密钥”；“安全说明”（03 第 2 节的通俗版：把表格改写成“防得住 / 防不住”两个列表，每条一句话）；“重置密钥库”。
- 确认请求框：收到 `onConfirmRequest` 时显示在最上层：标题、说明、主密码框、“确认”“取消”；`confirmRequest`/`rejectRequest`；错误密码显示“主密码不正确”；`E_THROTTLED` 显示等待时间。确认只校验密码，不改变上锁状态。
- 快捷键：`Ctrl+L` 上锁、`Ctrl+F` 聚焦搜索、`Ctrl+N` 新建。

提交（步骤 4–8 可以分多次提交）`WP-07: vault ui …`。

### 步骤 9：工作区侧栏入口

`src/components/WorkspaceSidebar.jsx`：在 Private 分组下面、回收站上面加一行“密钥库”（和“回收站”行用同样的类名；`locked` 时图标为闭锁、解锁时为开锁；行的右边是 12 px 400 `--mb-faint` 的小字“已上锁”/“已解锁”（原型 `.vault-state`，靠右），不用彩色圆点；参照 `design/mobai/shots/page-light.png` 左下角）；这行右边小字的样式写在新文件 `src/ui/themes/mobai/vault-entry.css`（`index.css` 末尾追加 `@import "./vault-entry.css";`，选择器加 `:root[data-style="mobai"] ` 前缀，只用 `--mb-*` 变量）；点击调用 `window.lifeAtlas.app.openVaultWindow()`；状态来自 `getVaultStatus()` 并订阅 `onVaultStatusChanged`。浏览器模式下这一行禁用，`title` 为“仅桌面版可用”。WP-10 会在它上面加“模板”行。

提交 `WP-07: vault entry in the sidebar`。

### 步骤 10：端到端测试

新建 `tests/desktop/vault.e2e.mjs`。打开密钥库窗口的方法：在工作区窗口点侧栏“密钥库”，然后 `const vaultPage = await handle.app.waitForEvent("window")`。剪贴板用 `handle.app.evaluate(({ clipboard }) => clipboard.readText())` 读取。启动时环境变量加 `LIFE_ATLAS_TEST_AUTOLOCK_MS: "2000"`、`LIFE_ATLAS_TEST_CLIPBOARD_MS: "1500"`、`LIFE_ATLAS_TEST_CONFIRM_TTL_MS: "3000"`（只在需要的用例里加）。用例名照抄：

- `first run sets a password and confirms the recovery key`（AC-07-2：规则逐条打勾；“保存恢复卡”时 `showSaveDialog` 队列放入临时路径，文件被写出；输错最后两组被拒；输对后进入空密钥库）
- `all seven item types can be created edited trashed restored and deleted`（AC-07-3）
- `unrevealed secrets are absent from the dom`（AC-07-4：未显示时 `document.documentElement.outerHTML` 和所有 `input`/`textarea` 的 `.value` 都不含敏感值；点“显示”后出现；`vaultPage.evaluate(() => window.dispatchEvent(new Event("blur")))` 后消失；另起一段等待 21 秒后也消失）
- `copied secrets are cleared from the clipboard`（AC-07-5：复制后剪贴板是该值；1.5 秒后被清除；第二次复制后立刻用 `clipboard.writeText("其他内容")` 覆盖，到时**不**清除）
- `idle vault locks itself`（AC-07-6：2 秒后回到锁屏，DOM 里没有任何条目标题；在密钥库窗口里调用 `window.lifeAtlasVault.list()` 返回 `E_LOCKED`；关闭窗口再打开需要解锁）
- `throttling shows a countdown`（AC-07-7：连续 5 次错误后出现倒计时，解锁按钮禁用）
- `recovery and password changes rotate keys`（AC-07-8：用恢复密钥找回并设置新主密码、确认新恢复密钥；修改主密码；重新生成恢复密钥后旧恢复密钥失效）
- `workspace window has no vault access`（AC-07-9：工作区窗口 `window.lifeAtlasVault === undefined`；`getVaultStatus()` 只有 `exists`、`locked` 两个键；工作区窗口执行 `location.href = "app://bundle/vault.html"` 后地址不变）
- `vault window is content protected and uses a memory session`（AC-07-10 与 AC-07-18：`BrowserWindow.isContentProtected` 存在时为 `true`，不存在时断言 `setContentProtection` 被调用过——在 `createVaultWindow` 里测试钩子开启时把调用记到 `__lifeAtlasTest.contentProtected`；`session.fromPartition("vault").isPersistent() === false`）
- `nothing secret reaches the disk after a ui session`（AC-07-11：完整走一遍界面流程并退出后，用 `tools/scan-plaintext.mjs` 扫描整个数据目录（含 `runtime\`），退出码 0）
- `the vault never touches the network`（AC-07-12：全流程后网络日志里没有任何请求）
- `totp codes follow the injected clock`（AC-07-13：`__lifeAtlasTest.clock.set(59000)` 后显示 `287082`（RFC 6238 SHA1 的 8 位值 `94287082` 的后 6 位——条目用 6 位）；推进 30 秒后自动刷新为新值）
- `keyboard alone can unlock create copy and lock`（AC-07-15）
- `confirm requests appear in the vault window`（AC-07-16：用 `handle.app.evaluate(() => globalThis.__lifeAtlasTest.requestConfirmation({ kind: "export-backup", title: "导出完整备份（包含密钥库）", description: "测试" }))` 发起（写成 `const pending = handle.app.evaluate(…)`，**不要**立刻 `await`，先去密钥库窗口里操作，再 `await pending` 拿结果）；已锁和已解锁两种状态下都出现确认框；正确密码 → `confirmed` 且上锁状态不变；错误密码计入失败次数；取消 → `cancelled`；3 秒不操作 → `expired`）
- `an unconfirmed recovery key forces regeneration`（AC-07-17：创建后不确认就关闭窗口 → 再打开并解锁 → 进入重新生成流程，确认前看不到条目）
- `reset is reachable from the lock screen`（锁屏点“重置密钥库”→ 输入短语 → 等 10 秒 → 重置 → 回到首次设置画面；`snapshots\*-vault-reset\vault.db` 存在）

每个用例最后调用 `assertNoNetworkAndErrors`（工作区窗口和密钥库窗口都要检查）。

运行：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-07/build.log npm run build
node docs/blueprint/tools/run-logged.mjs .qa/WP-07/desktop-build-test.log npm run desktop:build:test
node docs/blueprint/tools/run-logged.mjs .qa/WP-07/desktop-e2e.log npm run test:e2e:desktop
```

提交 `WP-07: vault e2e tests`。

### 步骤 11：截图

新建 `tests/desktop/vault-screens.e2e.mjs`，用例 `vault screens in daytime and at night`：先用密钥库接口建好和原型一样的虚构条目（`design/mobai/prototype/shared/content.js` 的 `vault` 一段：7 个条目的标题、类型、副标题；GitHub 带网址、用户名、密码和两步验证），然后两种模式各截一套，模式用 `handle.app.evaluate(({ nativeTheme }, mode) => { nativeTheme.themeSource = mode; }, "light")`（夜间传 `"dark"`）切换，截图用密钥库窗口的 `page.screenshot()`，放 `.qa/WP-07/shots/`，文件名 `<画面>-<light|dark>.png`：

- 有参照图的 3 个画面，名字和参照图一样：`vault-setup`（第二个框输入一半、两次不一致）、`vault-locked`、`vault`（选中 GitHub、刚复制过密码）；
- 其余 6 个：`vault-recovery-key`、`vault-detail-revealed`、`vault-edit`、`vault-settings`、`vault-confirm-request`、`vault-reset`。

然后生成对照图：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-07/compare.log node docs/blueprint/tools/compare-shots.mjs docs/blueprint/design/mobai/shots .qa/WP-07/shots --only vault-setup,vault-locked,vault --out .qa/WP-07/compare
```

退出码 0。原型的截图是 1440×900、窗口浮在中间，你的截图只有窗口内容，所以差异占比没有参考意义；把 `summary.md` 复制进报告第 3 节，并逐张写出你看到的不同之处（布局、字体、颜色、线条）。提交 `WP-07: vault screenshots`。

### 步骤 12：收尾【停止点】

浏览器场景必须仍然通过（侧栏改动）：`node docs/blueprint/tools/run-logged.mjs .qa/WP-07/browser-all.log npm run test:parity:browser`。填完报告；第 0 节全部“完成”；提交 `WP-07: complete report`；运行：

```powershell
node docs/blueprint/tools/wp-check.mjs WP-07 --browser --desktop
```

退出码 0 或 2 → 停止。

## 5. 范围

### 必做

第 3、4 节全部。

### 不做

- 备份导出里的密钥库（WP-08）。
- 历史记录界面、到期提醒、安全检查、浏览器 CSV 导入、口令短语、Fuses（WP-11）。
- 把密钥库条目接入全局搜索、页面提及、页面嵌入——**永远不做**（D-05）。

## 6. 验收标准

| 编号 | 标准 | 证据 |
| --- | --- | --- |
| AC-07-1 | 视觉：密钥库照墨白做，设置主密码、锁屏、主界面与参照图并排对照一致（白天和夜间）；颜色只来自 `vault.css` 的变量，随系统模式切换；步骤 1 的对照表写在报告第 3 节 | `.qa/WP-07/compare/`；`.qa/WP-07/shots/`；报告第 3、5 节 |
| AC-07-2 | 首次流程：主密码规则逐条显示 → 恢复卡保存 → 输错最后两组被拒、输对后进入 | 「first run sets a password and confirms the recovery key」 |
| AC-07-3 | 七种类型各新建一条（含自定义字段、标记敏感）；编辑、移到回收站、恢复、永久删除都可用 | 「all seven item types…」 |
| AC-07-4 | 未显示时 DOM 与输入框的值里没有敏感值；显示后出现；失焦与 20 秒后消失 | 「unrevealed secrets are absent from the dom」 |
| AC-07-5 | S7：复制后到时清除；中途复制别的内容则不清除 | 「copied secrets are cleared from the clipboard」 |
| AC-07-6 | S6：闲置到时回到锁屏，DOM 中没有条目标题，`list()` 返回 `E_LOCKED`；关窗口后再开要解锁 | 「idle vault locks itself」 |
| AC-07-7 | 节流在界面上显示倒计时，期间解锁按钮禁用 | 「throttling shows a countdown」 |
| AC-07-8 | 恢复密钥找回、修改主密码、重新生成恢复密钥都会轮换密钥，旧恢复密钥失效 | 「recovery and password changes rotate keys」 |
| AC-07-9 | S5：工作区窗口没有 `lifeAtlasVault`，只能拿到 `{ exists, locked }`，不能导航到 `vault.html` | 「workspace window has no vault access」 |
| AC-07-10 | S13：密钥库窗口开启了截图保护 | 「vault window is content protected…」 |
| AC-07-11 | S1：完整界面流程结束并退出后，扫描整个数据目录（含 `runtime\`）命中 0 | 「nothing secret reaches the disk after a ui session」 |
| AC-07-12 | S14：密钥库全流程网络请求 0；S15：`src/vault-ui/` 源码检查通过，只 import 允许的模块 | 「the vault never touches the network」；`tests/vault-ui-boundaries.test.mjs` |
| AC-07-13 | TOTP 码按注入的时钟计算，倒计时结束自动刷新 | 「totp codes follow the injected clock」 |
| AC-07-14 | 截图 9 个画面 × 白天/夜间共 18 张齐全，对照图 6 张 | `.qa/WP-07/shots/*.png`；`.qa/WP-07/compare/summary.md` |
| AC-07-15 | 只用键盘完成：解锁 → 新建登录条目 → 复制密码 → 上锁 | 「keyboard alone…」 |
| AC-07-16 | 确认请求在密钥库窗口出现，已锁/已解锁都能完成，四种结果正确 | 「confirm requests appear in the vault window」 |
| AC-07-17 | 恢复密钥未确认时强制重新生成，确认前看不到条目 | 「an unconfirmed recovery key forces regeneration」 |
| AC-07-18 | 密钥库窗口的会话 `isPersistent() === false` | 「vault window is content protected and uses a memory session」 |
| AC-07-19 | 锁屏可以进入重置，旧密钥库保存在 `vault-reset` 快照里 | 「reset is reachable from the lock screen」 |
| AC-07-20 | G1–G9 | `.qa/WP-07/wp-check.md` |

## 7. 卡点处理

| 情况 | 做法 |
| --- | --- |
| `waitForEvent("window")` 等不到密钥库窗口 | 先确认工作区窗口里点击的是侧栏“密钥库”行；再确认主进程 `createVaultWindow` 被调用（日志里有 `vault.window.created`） |
| 密钥库窗口白屏 | 多半是 `vault` 会话上没有注册 `app://` 协议（02 第 7 节：要再注册一次） |
| 某个细节原型里没画 | 按第 2 节和 12 第 6 节选最朴素的做法，写进报告第 5 节；不要自己发明新样式 |
| 密钥库窗口的字体没有生效（标题的 `font-family` 不是以 `"Segoe UI Variable Text"` 开头，或者中文不是思源黑体） | 先确认 `vault.css` 开头抄了 tokens.css 的字体一段（有 `--mb-sans`）、`src/vault-ui/main.jsx` 导入了 `@fontsource-variable/noto-sans-sc`、`npm run build` 后 `dist/client/assets/` 里有 `noto-sans-sc-*.woff2`；再看控制台有没有 CSP 报错 |
| 复制到剪贴板后读不到 | 用主进程 `clipboard.readText()` 读，不要在渲染进程用 `navigator.clipboard` |
| 等待 21 秒的用例太慢 | 这是规定的验收方式，保留 |
