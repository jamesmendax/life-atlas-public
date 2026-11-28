# WP-17 设置、产品对话框与数据目录

- 规模：M · 前置：WP-16 · 分支：`wp/17-settings`
- 停止点：步骤 0（理解确认）、步骤 13（收尾）
- 必读：`12-视觉规范-墨白.md` 第 6、7 节（设置对话框的参照画面 `design/mobai/shots/settings-*`）；`AGENTS.md`（视觉规则）；`02-总体架构.md` 第 3、5 节；`11-接口契约.md`（`app.changeDataRoot`、`assets.scanUnreferenced`、`assets.moveToTrash`、`assets.listTrash`、`assets.restoreTrash`；第 5 节 `injectFailure("data-root-copy")`）；`09-执行手册.md`（4.5 节）；源码 `src/ui/theme.js`（WP-20）、`src/ui/themes/mobai/index.css`（WP-20）、`src/ui/dialogService.js`、`src/ui/DialogHost.jsx`（WP-03）、`src/editor/shortcuts.js`（WP-14）、`src/main.jsx`、`src/App.jsx`、WP-05 的 `validateFolder`、WP-08 的“备份与恢复”对话框

## 0. 一页纸

- **要做到**：设置对话框（外观里的“模式”和顶栏按钮改的是同一个偏好，WP-20 已经做好白天/夜间切换）；全应用不再出现浏览器原生的确认框和提示框；桌面版可以更换数据目录、清理不再使用的附件（先进附件回收站，30 天后才真正删除）。
- **交付物**：`ui.preferences` 的 `defaultFont`、`startPage` 两项；`src/components/SettingsDialog.jsx` 与它的墨白样式 `src/ui/themes/mobai/settings.css`；全部 `window.confirm`/`window.alert` 换成产品对话框；主进程 `electron/main/dataRootMove.js`、`electron/main/storage/assetCleanup.js`；单元测试；浏览器场景 `wp17-settings`；桌面端到端 `tests/desktop/settings.e2e.mjs`；白天截图一组。
- **绝对不要**：在旧 CSS 里写死颜色（K13 会检查）；修改 `src/ui/themes/mobai/` 里从蓝图复制来的 8 个样式文件（`index.css` 只能在末尾追加 `@import`）；修改 `docs/blueprint/tools/theme-tokens.mjs`；自动删除附件（只能移到附件回收站）；删除或修改旧数据目录里的任何文件；做多语言、自定义主题色。
- **什么时候停**：步骤 0 后停；步骤 13 的 wp-check 退出码为 0 或 2 时停。

## 1. 已知事实（总设计师 2026-11-01 在项目副本里实测）

| 事实 | 对你的影响 |
| --- | --- |
| WP-20 已经把旧 CSS 的颜色换成变量、装好墨白主题（`src/ui/themes/mobai/`）、做好 `ui.preferences.theme` 和顶栏的“切换白天/夜间”按钮 | 本 WP 不再做主题切换；设置里的“模式”调用 WP-20 的同一套函数 |
| 新写的界面样式放在 `src/ui/themes/mobai/` 下的新文件里，在 `index.css` 末尾追加 `@import`；颜色只用 `--mb-*` 变量（12 第 3 节） | 设置对话框照这个做 |
| JS/JSX 里写死的约 115 处颜色都是用户内容（页面图标颜色、封面、记录默认图标颜色）或导出文件的样式 | 不随主题变化，**不要改** |
| WP-03 已经有 `promptDialog`/`confirmDialog`/`alertDialog`（`src/ui/dialogService.js`）和 `DialogHost` | 本 WP 只是把 `window.confirm`/`window.alert` 换掉 |
| Electron 里 `window.confirm` 可以用，Playwright 能收到 `dialog` 事件，但中文消息是乱码 | 换成产品对话框后，测试改为点对话框按钮（2.3 节） |
| WP-05 的首次启动在测试钩子开启时只 `app.exit(0)`、不重启 | 更换数据目录照同样的规则（2.4 节） |

## 2. 设计要点（规定）

### 2.1 偏好

- `ui.preferences` 在 WP-20 里已经有 `theme`（`"system" | "light" | "dark"`，默认 `"system"`）。本 WP 再加两项：`defaultFont: "default" | "serif" | "mono"`（默认 `"default"`）、`startPage: "last" | "home"`（默认 `"last"`）；和 WP-20 一样在 `normalizeLoadedWorkspace` 返回之前补默认值，不认识的值改成默认值，不升 schema 版本。
- 设置对话框的“模式”和顶栏按钮读写的是同一个 `ui.preferences.theme`；选项文字用 `THEME_LABELS`（WP-20 的 `src/ui/theme.js`）。

### 2.2 白天模式的回归检查

- 浏览器场景的检查 2（步骤 11）会在白天模式下检查这些容器的背景亮度（相对亮度，`0.2126R + 0.7152G + 0.0722B`，按 sRGB 线性化计算）≥ 0.75：`.workspace-sidebar`、`.workspace-pane`、`.page-document`、`.db-table`、`.ui-popover`（打开任意一个时）、`.ui-dialog`（打开设置对话框时）；以及这些文字的亮度 ≤ 0.35：页面标题输入框、侧栏当前页面行、表格单元格文字。透明背景沿父元素向上找第一个不透明的背景。
- 不满足时**不要改任何主题文件或旧 CSS 去凑数**：截图放 `.qa/WP-17/`，在报告第 7 节写清是哪个元素、实测亮度多少，由总设计师处理。

### 2.3 产品对话框替换原生对话框

- 把 `src/` 下（包括 `src/vault-ui/`）全部 `window.confirm(…)` 换成 `await confirmDialog({ title, message, confirmLabel, danger })`，`window.alert(…)` 换成 `await alertDialog({ title, message })`。`message` 用原来的文字；`title` 用简短的动作名（例如“移到回收站”“永久删除”“删除文件夹”“删除属性”“更改属性类型”“恢复页面版本”“放弃记录”）；`confirmLabel` 一律与 `title` 相同；做完以后找不回原样的操作（永久删除、清空回收站、删除属性、更改属性类型（转换会丢掉转不过去的值）、放弃记录）加 `danger: true`；移到回收站、删除文件夹（整组进回收站）、恢复页面版本（会先存一个“恢复前”版本）都能找回，不加 `danger`。所在函数改成 `async`。
- 密钥库窗口是另一个 React 应用：在 `src/vault-ui` 的根组件里也渲染一次 `DialogHost`（同一个组件文件，样式用密钥库自己的 CSS 变量包一层 `.vault-dialog-scope`，不引入工作区的主题变量）。
- 新建 `tests/no-native-dialogs.test.mjs`：`source never calls window confirm or alert`（读取 `src/` 下全部 `.js`/`.jsx`，不包含 `window.confirm`、`window.alert`、`window.prompt`）。
- **测试改动**（执行手册 4.5 节第 1 条：操作方式变了，断言不变；报告第 4 节逐条写明）：
  1. `tests/browser/harness.mjs` 增加并导出：

     ```js
     export async function answerProductDialog(page, { accept = true, optional = false } = {}) {
       const dialog = page.locator("[data-la-dialog]").last();
       try { await dialog.waitFor({ state: "visible", timeout: optional ? 1000 : 5000 }); }
       catch (error) { if (optional) return false; throw error; }
       await dialog.locator(accept ? "[data-la-dialog-confirm]" : "[data-la-dialog-cancel]").click();
       await dialog.waitFor({ state: "detached" });
       return true;
     }
     ```

     `tests/desktop/helpers.mjs` 增加同样的函数（参数是 `handle.page` 或密钥库窗口的 page）。
  2. 在 `tests/` 里查找全部用到原生对话框的地方：`git grep -n "\"dialog\"" -- tests`。对每一处：删掉 `page.on("dialog", …)`/`page.once("dialog", …)`/`waitForEvent("dialog")` 那一行，在**会弹出确认框的那个操作之后**加 `await answerProductDialog(page);`（原来是 `dismiss()` 的改成 `{ accept: false }`）。不确定某个操作会不会弹框时（例如 `phase1-editor` 里删除带文字的标签），用 `{ optional: true }`。
  3. 已知需要改的地方（以 `git grep` 的结果为准，这里列出总设计师预计的）：`phase1-editor`（删除当前标签、删除同步源）、`wp01-integrity`（移到回收站、永久删除、清空回收站、删除文件夹）、`wp13-inbox`（放弃记录）、`wp15-database`（更改类型、删除属性、批量移到回收站）、`wp16-history`（恢复此版本），以及桌面端到端里密钥库“永久删除”（WP-07）和“恢复为当前值”（WP-11）。

### 2.4 更换数据目录（桌面版，`electron/main/dataRootMove.js`）

`app.changeDataRoot()` 的流程（主进程，按顺序；任一步失败都回到“继续使用旧目录”）：

1. `dialogs.showOpenDialog`（`properties: ["openDirectory", "createDirectory"]`），取消 → 返回 `{ changed: false }`。
2. 用 WP-05 的 `validateFolder` 检查：只接受 `ok` 的 `empty` 或 `missing`，以及 `warning` 的 `sync-drive`；其他（包括 `existing-data-root`）用 `dialogs.showMessageBox` 提示原因后返回 `{ changed: false }`。新目录不能在旧目录里面，旧目录也不能在新目录里面。
3. `dialogs.showMessageBox` 确认：`message` “把数据复制到新的文件夹？”，`detail` “<新目录>\n\n复制完成后应用会重启并使用新文件夹。原来的文件夹会保留，确认无误后可以自己删除。”（同步盘时再加一段同步盘提示），按钮 `["复制并重启", "取消"]`，`cancelId: 1`。
4. 请求渲染进程立即保存（`flush`，最多等 3 秒）→ 密钥库上锁 → 停止快照和定期备份计时器 → 关闭数据库（先 `PRAGMA wal_checkpoint(TRUNCATE)`）。
5. 复制旧目录下的全部文件和子目录到新目录，**跳过** `runtime\` 和 `.lock`；复制完逐个文件比较 SHA-256（流式计算），全部一致才继续。测试钩子 `injectFailure("data-root-copy")` 让这一步抛错一次。
6. 原子写入 `bootstrap.json`（先写 `bootstrap.json.tmp` 再改名）为 `{ "dataRoot": "<新目录>" }`。
7. 写日志 `data-root.moved`（只记录两个路径）；生产环境 `app.relaunch(); app.exit(0)`；**测试钩子开启时只 `app.exit(0)`**（测试自己再启动）。
- 第 5 步或第 6 步失败：删除新目录里本次复制的全部内容（新目录本来是空的或不存在），重新打开旧目录的数据库、恢复计时器，`dialogs.showMessageBox` 提示“更换数据目录失败：<原因>。继续使用原来的文件夹。”，返回 `{ changed: false }`。旧目录在任何情况下都不修改（除了正常运行时本来就会写的数据库）。

### 2.5 附件清理（桌面版，`electron/main/storage/assetCleanup.js`）

- 纯函数（普通 Node 可测）：
  - `collectAssetReferences(jsonTexts)` → `Set<sha256>`：在每段文字里找全部 `life-asset://<64 位小写十六进制>`（区块、图标、封面、页面版本都用这种地址）；
  - `collectAttachmentReferences(attachments, jsonTexts)` → `Set<sha256>`：数据库的“文件”属性存的是**附件 ID**（例如满配夹具 `i-1.files = ["att-file"]`），不是 `life-asset://` 地址，所以要单独找。`attachments` 是附件实体数组，`jsonTexts` 是**除附件实体以外**的全部实体 JSON；对每个 `provider === "asset"` 且 `storageKey` 是 64 位小写十六进制的附件，只要某段文字包含 `JSON.stringify(附件.id)`（带双引号的 ID，例如 `"att-file"`），就把它的 `storageKey` 加进结果。附件实体本身存在、但没有别的实体提到它的 ID（例如 `att-orphan`），不算引用；
  - `unreferencedAssets(assetRows, referenced)` → 不在 `referenced` 里的行；
  - `trashBatchId(nowMs, randomHex4)` → `YYYYMMDD-HHmmss-<4 位十六进制>`（UTC 时间）；
  - `expiredBatches(batches, nowMs)` → `createdAt` 早于 30 天前的批次。
- `assets.scanUnreferenced()`：引用来源 = 当前 `workspace.db` 的全部实体 JSON（包括回收站里的页面和全部页面版本）+ `snapshots\` 下每个快照里的 `workspace.db`（只读打开，读全部实体 JSON）。对每一个库（当前库和每个快照库分别算）：被引用的哈希 = `collectAssetReferences(这个库的全部实体 JSON)` ∪ `collectAttachmentReferences(这个库的附件实体, 这个库除附件以外的实体 JSON)`；最后把所有库的结果合并。任何一个快照读不出来时整个扫描返回 `E_IO`（见第 6 节）。返回 `assets` 表里没有被引用的行（`{ sha256, size, mime, originalName, createdAt }`），按 `createdAt` 升序。
- `assets.moveToTrash({ sha256s })`：再扫描一次引用（期间新被引用的跳过）→ 新建 `<DataRoot>\asset-trash\<trashId>\`，把文件移进去（文件名就是 sha256），写 `index.json`（`{ createdAt, items: [行…] }`）→ 从 `assets` 表删除这些行 → 返回 `{ trashId, movedCount }`。
- `assets.listTrash()` → 每个批次 `{ trashId, createdAt, count, sizeBytes, expiresAt }`（`expiresAt = createdAt + 30 天`）。
- `assets.restoreTrash({ trashId })`：文件移回 `assets\<前两位>\<sha256>`（目标已存在时只删除回收站里的这份）→ 行写回 `assets` 表 → 删除批次目录 → `{ restoredCount }`。
- 到期删除：启动时和每次“每日快照检查”时删除 `expiredBatches` 的目录（时间取 `__lifeAtlasTest.clock`，与快照相同）。
- 浏览器模式没有附件存储，设置里不显示这一块。

### 2.6 设置对话框（`src/components/SettingsDialog.jsx`）

- 打开方式：工作区菜单“设置…”（放在菜单最上面，“重命名工作区…”之前）；快捷键 `Ctrl+,`；`src/editor/shortcuts.js` 增加一项 `{ id: "settings", group: "导航", keys: "Ctrl+,", description: "打开设置", verify: "按下后出现设置对话框" }`。
- 结构：`role="dialog"`、`aria-label="设置"`，940×640 px（窗口小时宽 `min(940px, 94vw)`、高 `min(640px, 90vh)`），和 Notion 的设置一样：左边 220 px 分区列表（`role="tablist"`、`aria-orientation="vertical"`，侧栏色；顶部一行 12 px `--mb-faint` 的“设置”；每个分区是 30 px 高的一行，17 px 图标加 14 px 500 的名称，选中时 `--mb-select` 底、`--mb-ink` 字），右边内容：顶部 56 px 一行是分区名（16 px 600）和关闭按钮；下面每个设置占一行，左边是名称（14 px `--mb-ink`）和一行说明（12 px `--mb-muted`），右边是控件，行与行之间 1 px `--mb-line` 细线（参照 `design/mobai/shots/settings-*`，原型 `#view=settings`）。
- 样式写在新文件 `src/ui/themes/mobai/settings.css`，在 `src/ui/themes/mobai/index.css` 末尾追加一行 `@import "./settings.css";`。照原型 `design/mobai/prototype/b-more.css` 里 `settings` 一段（`.settings`、`.set-*`、`.choice*`、`.style-mini*`、`.seg`、`.font-*`）改写：每个选择器前加 `:root[data-style="mobai"] `，变量按 12 第 0 节的对应表换名。
- 分区依次：
  1. **外观**（每行的说明文字照原型：风格“界面的整体样式”、模式“白天和夜间”、默认字体“每个页面也可以单独改”）：“风格”一张小样卡片“墨白”（选中、只读，蓝色外框和右下角蓝色对勾，说明文字“简洁黑白，接近 Notion”；以后加钛白时这里才变成可以选的多张卡片，12 第 9 节）；“模式”是分段选择（`role="radiogroup"`、`aria-label="模式"`，三个 `role="radio"` 按钮依次是“跟随系统”“白天”“夜间”，文字取 `THEME_LABELS`，图标与顶栏按钮相同；点一下立即生效并保存到 `ui.preferences.theme`，顶栏按钮的图标同步变化）；“新页面的默认字体”是三个“文 Aa”按钮（`role="radiogroup"`、`aria-label="默认字体"`：默认 / 衬线 / 等宽，“文 Aa”分别用 `--mb-sans`、`--mb-serif`、`--mb-mono` 写，下面一行 12 px 的名称；选中的是 `--mb-accent-soft` 底、`--mb-accent` 字，和页面菜单里的三个“Ag”一样；之后新建的页面 `settings.fontFamily` 用它）；“启动时打开”是下拉框（`<select aria-label="启动时打开">`，选项“上次打开的页面”“Home”，值 `last` / `home`；`home` 时启动后显示 Home）。
  2. **工作区**：名称（`aria-label="工作区名称"`）和图标（`aria-label="工作区图标"`），与 WP-12 的“重命名工作区…”改的是同一份数据。
  3. **数据**（只在桌面版出现）：数据目录路径（只读文字）、按钮“打开数据目录”、按钮“更换数据目录…”（调用 `app.changeDataRoot()`）；“附件清理”：按钮“查找未使用的附件”→ 列表（每行复选框 `aria-label="选择 <文件名>"`、文件名、大小、上传时间）+“全选”+“移到附件回收站”（`confirmDialog`，`danger: true`）；“附件回收站”：每个批次一行（时间、数量、大小、“<N> 天后删除”）和按钮“恢复”。
  4. **备份**：上次完整备份时间（`backup.getStatus()`；从未备份时写“还没有导出过完整备份”）、定期备份的状态一行（已开启：“每周<星期> <小时>:00 备份到 <文件夹>”；未开启：“未开启”）、按钮“打开备份与恢复…”（打开 WP-08 的对话框）。浏览器模式只有最后这个按钮。
  5. **密钥库**：按钮“打开密钥库设置”（桌面版调用 `app.openVaultWindow({ section: "settings" })`；浏览器模式显示“仅桌面版可用”）。工作区窗口不读取任何密钥库设置数据。
  6. **快捷键**：只读列表，内容就是 `SHORTCUTS`（与快捷键面板同一份数据）。
  7. **关于**：与 WP-12 的“关于 Life Atlas”对话框内容相同（复用同一个组件）。
- `Esc` 或右上角“关闭”（`aria-label="关闭设置"`）关闭。

## 3. 范围

### 不做

- 多语言（只做中文）、自定义主题色、第二套风格（钛白）。
- 自动删除附件（只进附件回收站，30 天后删除）。

## 4. 执行步骤

### 步骤 0：开工准备【停止点】

按执行手册 3.1 节开工（分支 `wp/17-settings`），生成报告骨架，跑基线：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-17/step0-npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-17/step0-browser.log npm run test:parity:browser
```

在报告第 1 节回答理解题：

1. 设置里的“模式”改的是工作区里的哪个字段？顶栏的“切换白天/夜间”按钮改的又是哪个？
2. 设置对话框的样式写在哪个文件里？能不能改 `src/ui/themes/mobai/shell.css`？
3. 更换数据目录时复制失败了，用户的数据在哪里？旧目录被改动了吗？
4. 一个附件只在 5 天前的快照里用到，清理时会列出它吗？

提交 `WP-17: step 0 understanding`，运行 `node docs/blueprint/tools/wp-check.mjs WP-17 --until 0`，退出码 0 → **停止**。

### 步骤 1：偏好的另外两项

按 2.1 节给 `ui.preferences` 补 `defaultFont`、`startPage` 的默认值。在 `tests/theme.test.mjs`（WP-20 建立）末尾**新增**：

- `preferences get font and start page defaults`：没有这两项的工作区经过 `normalizeLoadedWorkspace` 后是 `"default"` 和 `"last"`；`{ defaultFont: "serif", startPage: "home" }` 保持不变；不认识的值变回默认值；`theme` 不受影响。

提交 `WP-17: font and start page preferences`。

### 步骤 2：确认颜色变量没有遗漏

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-17/theme-tokens-recheck.log node docs/blueprint/tools/theme-tokens.mjs --report .qa/WP-17/theme-tokens-recheck.md
```

期望 `replaced=0`、`leftovers=0`（WP-20 之后的每个 WP 都应该这样）。不为 0 时说明之前的 WP 漏了：运行一次 `--write`，在报告第 5 节写明替换了哪几个文件，提交 `WP-17: convert leftover colors`；为 0 时本步不提交。

### 步骤 3：白天模式回归检查

按 2.2 节，在浏览器里（Playwright 新开的浏览器，5178 端口）切到白天模式，逐个打开：首页、页面（含代码块和公式）、表格、看板、日历、时间脉络、模板库、搜索、页面历史、确认对话框，和 `design/mobai/shots/` 里对应的画面对照。看不清或明显不同的地方按 2.2 节写进报告第 7 节，**不改样式**。本步不提交代码；把对照结论写进报告第 5 节后提交 `WP-17: daytime regression notes`。

### 步骤 4：替换原生对话框

按 2.3 节实现（代码 + `no-native-dialogs` 测试 + 测试改动）。

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-17/step4-npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-17/step4-browser.log npm run test:parity:browser
```

都通过后提交 `WP-17: product dialogs everywhere`。

### 步骤 5：附件清理的纯函数

按 2.5 节实现纯函数。新建 `tests/asset-cleanup.test.mjs`：

- `asset references are found in any json text`：`A = "a".repeat(64)`、`B = "b".repeat(64)`、`C = "C".repeat(64)`；两段文字 `` `{"x":"life-asset://${A}","y":"life-asset://${B}"}` `` 和 `` `{"z":"life-asset://${A}","w":"life-asset://${C}"}` ``（共 4 个地址：A 出现两次，大写的 C 不算）→ 结果正好是 `{A, B}`。
- `attachments referenced by id keep their files`：`F = "f".repeat(64)`、`O = "0".repeat(64)`；附件 `[{ id: "att-file", provider: "asset", storageKey: F }, { id: "att-orphan", provider: "asset", storageKey: O }, { id: "att-web", provider: "indexeddb", storageKey: "att-web" }]`，文字 `['{"values":{"files":["att-file"]}}']` → 结果正好是 `{F}`。
- `unreferenced assets exclude every referenced hash`。
- `trash batch ids use utc time`：`trashBatchId(Date.UTC(2026, 10, 1, 9, 30, 5), "a1b2")` → `"20261101-093005-a1b2"`。
- `batches expire after thirty days`：29 天的不过期，31 天的过期。

提交 `WP-17: asset cleanup functions`。

### 步骤 6：附件清理的主进程与界面

按 2.5 节实现 4 个 IPC 函数和到期删除（设置界面在步骤 9）。提交 `WP-17: asset cleanup service`。

### 步骤 7：更换数据目录

按 2.4 节实现。新建 `tests/data-root-move.test.mjs`（用临时目录，直接调用 `dataRootMove.js` 里不依赖 Electron 的复制和校验函数，例如 `copyDataRoot(from, to, { skip })` 与 `verifyCopy(from, to)`）：

- `copying skips runtime and the lock file`
- `verification detects a changed byte`
- `a failed copy leaves the target empty`

提交 `WP-17: change data root`。

### 步骤 8：启动页与默认字体

按 2.6 节“外观”的后两项实现。提交 `WP-17: start page and default font`。

### 步骤 9：设置对话框

按 2.6 节实现；工作区菜单的期望列表变了，按规定修改 `tests/browser/wp12-navigation.mjs` 检查 5 的期望列表（在最前面加“设置…”，执行手册 4.5 节第 2 条，报告第 4 节写明）。提交 `WP-17: settings dialog`。

### 步骤 10：确认没有新写死的颜色

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-17/theme-tokens-final-check.log node docs/blueprint/tools/theme-tokens.mjs --report .qa/WP-17/theme-tokens-final-check.md
```

期望 `replaced=0`、`leftovers=0`（工具不检查 `src/ui/themes/`，`settings.css` 不算）。不为 0 说明步骤 3–9 在旧 CSS 里写了颜色：打开报告看是哪几行，把这些规则移到 `settings.css` 并改用 `--mb-*` 变量（**不要**用 `--write`），重新运行直到为 0，提交 `WP-17: move new colors into the theme`。

### 步骤 11：浏览器场景

新建 `tests/browser/wp17-settings.mjs`（种子：满配夹具，另给 `ds-full` 加一个日期属性 `launch`“发布日期”，i-3 为 `2026-09-10`、i-4 为 `2026-10-20`，用来截时间脉络）。检查项（标题照抄）：

1. `Mode switches immediately and persists`：`Ctrl+,` 打开设置 → “模式”选“白天”→ `document.documentElement.dataset.theme === "light"`，`.bn-container` 的 `data-color-scheme` 是 `light`，顶栏按钮的 `title` 是“外观：白天”→ 刷新后仍是白天；选“跟随系统”并 `page.emulateMedia({ colorScheme: "dark" })` → 变成夜间；`emulateMedia({ colorScheme: "light" })` → 变成白天。
2. `Daytime has no dark surfaces`：白天模式下按 2.2 节的规则检查亮度（容器、文字），全部满足；把每个元素的实测亮度 `console.log` 出来。
3. `Daytime screenshots cover the main surfaces`：白天模式下截图（1440×900）：`light-sidebar-page`（“A 概览”）、`light-table`、`light-board`、`light-calendar`、`light-roadmap`（“整页项目库”视图标签栏点“时间脉络”后截，截完切回“表格”）、`light-templates`、`light-search`、`light-settings`、`light-confirm`（任意一个确认框）、`light-history`（页面历史）、`light-code-equation`（含代码块和公式的页面）。
4. `Settings sections all do something`：外观的三项各改一次并验证效果（默认字体：新建页面的 `settings.fontFamily`；启动时打开：改成 Home 后刷新显示 Home）；工作区名称改为“设置改名”→ 侧栏同步；快捷键分区的行数等于 `SHORTCUTS.length`；关于分区有版本号；浏览器模式下没有“数据”分区，“密钥库”分区显示“仅桌面版可用”。
5. `Product dialogs replace native dialogs`：把一个页面移到回收站 → 出现 `[data-la-dialog="confirm"]`，焦点在确认按钮“移到回收站”上（移到回收站可以撤销，不是 `danger`，按 WP-03 的规则初始焦点在确认按钮上）→ 按 `Esc` → 页面仍在；再来一次点确认 → 页面进入回收站；整个场景里没有触发任何原生 `dialog` 事件（`page.on("dialog")` 计数为 0）。

加入场景列表，单独运行，日志 `.qa/WP-17/browser-wp17.log`。提交 `WP-17: settings browser scenario`。

### 步骤 12：桌面端到端

新建 `tests/desktop/settings.e2e.mjs`：

- `system theme follows the operating system`：偏好设为“跟随系统”→ `handle.app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = "light"; })` → 渲染进程 `data-theme === "light"`；改回 `"dark"` → `dark`。
- `changing the data root copies verifies and restarts`：满配夹具 + 一个附件；`dialogs` 队列放入新目录路径和“复制并重启”（`response: 0`）→ 在设置里点“更换数据目录…”→ 应用退出 → 新目录里每个文件的 SHA-256 与旧目录相同（不含 `runtime`、`.lock`）、`bootstrap.json` 指向新目录、旧目录的文件一个都没少 → 用 `launchApp({ dataRoot: null, bootstrapDir: 同一个 })` 再启动 → 打开的是新目录（`app.getInfo().dataRoot`），内容完整。
- `a failed data root copy keeps the old folder`：`injectFailure("data-root-copy")` → 同样的操作 → 出现失败提示（`readDialogCalls` 里有 `showMessageBox`，`message` 以“更换数据目录失败”开头）→ 应用仍在运行、仍用旧目录；新目录是空的；`bootstrap.json` 没变。
- `asset cleanup only offers unreferenced files and can restore them`：准备 5 个附件：A 被页面引用、B 只在页面版本里引用、C 只在快照里引用（先引用、`backup.createSnapshot()`、再删掉引用）、D 没有引用、E 只被一条数据库记录的“文件”属性引用（值是 E 的附件 ID）→ “查找未使用的附件”只列出 D → 移到附件回收站 → `assets\` 里没有 D、`asset-trash\` 里有 → “恢复”→ D 回来 → 再移一次 → `__lifeAtlasTest.clock.advance(31 天)` → `__lifeAtlasTest.snapshots.checkNow()` → 批次目录被删除。
- `vault dialogs use the product dialog`：密钥库里永久删除一个条目 → 出现 `[data-la-dialog="confirm"]` → 确认后条目消失。

运行：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-17/build.log npm run build
node docs/blueprint/tools/run-logged.mjs .qa/WP-17/desktop-build-test.log npm run desktop:build:test
node docs/blueprint/tools/run-logged.mjs .qa/WP-17/desktop-e2e.log npm run test:e2e:desktop
```

全部通过后提交 `WP-17: settings desktop tests`。

### 步骤 13：收尾【停止点】

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-17/npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-17/browser-all.log npm run test:parity:browser
```

填完报告；第 0 节全部“完成”；提交 `WP-17: complete report`；运行 `node docs/blueprint/tools/wp-check.mjs WP-17 --browser --desktop`，退出码 0 或 2 → 停止。

## 5. 验收标准

| 编号 | 标准 | 证据 |
| --- | --- | --- |
| AC-17-1 | 设置里的“模式”与顶栏按钮是同一个偏好，切换立即生效并保存；跟随系统时随系统切换（浏览器用 `emulateMedia`，桌面用 `nativeTheme`） | 场景检查 1；「system theme follows the operating system」 |
| AC-17-2 | 颜色变量没有遗漏：`replaced=0`、`leftovers=0` | `.qa/WP-17/theme-tokens-recheck.log`；`.qa/WP-17/theme-tokens-final-check.log` |
| AC-17-3 | 白天模式的亮度检查全部满足；11 张白天截图与 `design/mobai/shots/` 对照没有深色残留或看不清的文字；发现的问题逐条写在报告第 7 节 | 场景检查 2、3；`.qa/wp17-settings-light-*.png`；报告第 5、7 节 |
| AC-17-4 | 源码里没有 `window.confirm`、`window.alert`、`window.prompt`；工作区和密钥库都用产品对话框；测试改动只涉及 2.3 节规定的那几类 | `tests/no-native-dialogs.test.mjs`；场景检查 5；「vault dialogs use the product dialog」；报告第 4 节 |
| AC-17-5 | 设置对话框每一项都有实际作用，没有占位项 | 场景检查 4 |
| AC-17-6 | 更换数据目录：成功（逐文件哈希一致、旧目录完整保留、重启后用新目录）与失败（继续用旧目录、新目录为空、bootstrap 不变）都通过 | 「changing the data root…」「a failed data root copy…」；`tests/data-root-move.test.mjs` |
| AC-17-7 | 附件清理：被页面、页面版本、快照、数据库文件属性引用的附件不列出；移到附件回收站后可恢复；30 天后删除 | 「asset cleanup only offers…」；`tests/asset-cleanup.test.mjs` |
| AC-17-8 | G1–G9 | `.qa/WP-17/wp-check.md` |

## 6. 卡点处理

| 情况 | 做法 |
| --- | --- |
| 运行工具后夜间外观变了（现有场景截图或断言失败） | 停下报告，不要手改 CSS 去“修正”。附上失败的场景和截图 |
| 工具报告里有无法换算的颜色 | 按报告的说明改成十六进制或 `rgb()` 写法后重新运行，或在那一行末尾加 `/* theme-keep */` |
| 白天模式下某个区域背景仍是深色 | 多半是 JSX 里的内联样式或第三方组件：截图写进报告第 7 节，不要改主题文件（2.2 节） |
| 换成产品对话框后某个场景卡住 | 是漏了 `answerProductDialog`：看卡住前最后一个操作是不是会弹确认框 |
| 更换数据目录后测试找不到应用窗口 | 测试钩子开启时应用会直接退出（不重启），测试要自己再 `launchApp`（2.4 节第 7 步） |
| 快照里的 `workspace.db` 打不开 | 只读打开（`node:sqlite` 的 `readOnly: true`）；仍打不开时 `scanUnreferenced` 返回 `E_IO`，信息“快照 <快照ID> 无法读取，为安全起见暂不清理附件”——**不能**跳过这个快照继续扫描（否则可能把它引用的附件当成没人用） |
