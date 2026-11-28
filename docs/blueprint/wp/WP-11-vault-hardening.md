# WP-11 密钥库加固

- 规模：M · 前置：WP-10 · 分支：`wp/11-vault-hardening`
- 停止点：只有收尾（步骤 9）
- 必读：`03-密钥库安全设计.md` 第 2、4、6、7、8 节；`11-接口契约.md` 第 2 节里标 WP-11 的函数与第 4.9 节；`02-总体架构.md` 第 10 节；`09-执行手册.md`；WP-06/07 的代码；`12-视觉规范-墨白.md` 第 0、3、6、7、8 节（参照画面 `design/mobai/shots/vault-*`）；WP-07 的 `src/vault-ui/vault.css`；WP-05 加在 `tests/desktop/helpers.mjs` 里的 `shootWindowBothModes`

## 0. 一页纸

- **要做到**：长期使用需要的东西——看旧密码的历史、到期提醒、发现弱密码和重复密码、从浏览器导入已有密码、口令短语；以及加固程序本身（Electron Fuses 与 ASAR 完整性，只作用于正式版）。
- **交付物**：历史记录界面与 4 个接口；到期标记与“即将到期”分类；安全检查；浏览器密码 CSV 导入；口令短语生成；正式版加固与验证测试；剪贴板历史的结论；单元测试与端到端测试。
- **绝对不要**：把安全检查结果写到磁盘；让 CSV 内容或密码经过密钥库窗口以外的地方（解析在主进程，预览不含密码）；给测试版加 Fuses（Playwright 会无法启动）；未经二次确认删除用户的 CSV 文件；做 Windows Hello、硬件密钥、自动填充扩展、密码共享、其他密码管理器格式导入。
- **什么时候停**：步骤 9 的 wp-check 退出码为 0 或 2。

## 1. 已知事实（总设计师 2026-11-01 实测）

| 事实 | 影响 |
| --- | --- |
| electron-builder 26.18.0 自带 `electronFuses` 配置；命令行加 `-c.electronFuses.runAsNode=false` 等参数即可，日志里出现 `executing @electron/fuses` | 步骤 6 照做 |
| `@electron/fuses@1.8.0` 的 `getCurrentFuseWire(exe路径)` 返回各 Fuse 的状态：字符 `0`（48）= 关，`1`（49）= 开；按 `FuseV1Options` 的序号：RunAsNode 0、EnableCookieEncryption 1、EnableNodeOptionsEnvironmentVariable 2、EnableNodeCliInspectArguments 3、EnableEmbeddedAsarIntegrityValidation 4、OnlyLoadAppFromAsar 5、LoadBrowserProcessSpecificV8Snapshot 6、GrantFileProtocolExtraPrivileges 7 | 期望值为 `[48, 49, 48, 48, 49, 49, 48, 48]`（前 8 位） |
| 加了 Fuses 的正式版：`ELECTRON_RUN_AS_NODE=1` 不会进入 Node 模式；改 `app.asar` 头部 1 字节，约 0.3 秒退出且输出含 `Integrity`；改主进程代码 1 字节，约 0.3 秒退出且输出含 `ASAR Integrity Violation`；未改动的副本正常运行 | 步骤 6 的测试照做 |
| 加了 Fuses 的程序 Playwright 无法启动（`EnableNodeCliInspectArguments=false`） | 端到端测试只用测试版；正式版只用 `child_process.spawn` 检查 |
| EFF 词表已放在 `docs/blueprint/data/effLargeWordlist.txt`（109242 字节，SHA-256 `1bdd48825a4f4d7af2bc885d764766052335b4c1cfc2f7e414a679404390e3c4`，7776 个不重复的词） | 步骤 5 原样复制 |

**界面样式（墨白，规定）**：本 WP 在密钥库窗口里加的界面（历史记录、到期标记、“即将到期”和“安全检查”分类、CSV 导入预览、口令短语页签、安全说明）照 WP-07 的做法做：

- 样式追加在 WP-07 的 `src/vault-ui/vault.css` 末尾（先写一行注释 `/* WP-11 */`）：规则照原型改写时变量按 12 第 0 节换名，**不加** `:root[data-style="mobai"]` 前缀，只用 `vault.css` 开头定义的 `--mb-*` 变量；白天和夜间跟随 `prefers-color-scheme`（WP-07）。
- 控件只用 12 第 6 节的组件；CSV 预览是 12 第 8 节的网格表格（表头上下和每行下面 1 px `--mb-line` 横线，列之间 1 px `--mb-line` 竖线，最左、最右不画线；表头 14 px 400 `--mb-muted`，不加类型图标；每行高 34 px、左右内边距 8 px、14 px 字）；安全检查的列表和条目列表一样一行一条（原型 `.vw-item`），四个分组标题是 12 px 500 `--mb-faint` 的小标题（原型 `.vw-cats-label` 的样子）；时间、数量用 `tabular-nums`。
- 到期标记不用黄色，用 12 第 6 节的标签（高 20 px、左右 6 px、圆角 3 px、12 px 字，没有描边）：“即将到期”是 `--mb-tag-default` 底、`--mb-tag-default-text` 字，前面一个沙漏图标；“已过期”是同样的标签，换成 `--mb-tag-red` 底、`--mb-tag-red-text` 字。
- 历史记录的每一行：修改时间用 `--mb-sans`、`tabular-nums`（14 px 500，和原型页面历史 `.hist-item b` 一样），“显示”“复制”“恢复为当前值”是小号次按钮（原型 `.btn-line.btn-sm`：高 24 px、13 px 字、1 px `--mb-line-2` 描边）；显示出来的旧值用等宽字。
- 口令短语和密码生成器原来的页签一样，是文字选项卡（12 第 6 节）；生成的短语用等宽字。
- 这些画面原型里都没画：每个画面在报告第 5 节写一句你是按 12 的哪几条做的。

## 2. 执行步骤

### 步骤 0：开工准备

按执行手册 3.1 节开工（分支 `wp/11-vault-hardening`），生成报告骨架，跑基线 `npm test`。理解题：

1. 为什么测试版不能加 Fuses？正式版的加固怎么验证？
2. 浏览器导出的 CSV 里的密码，在导入过程中出现在哪些地方？
3. 安全检查的结果保存在哪里？

提交 `WP-11: step 0 understanding`（本步不停）。

### 步骤 1：历史记录

1. 主进程 `vaultService` 增加 `getHistory`、`revealHistory`、`copyHistory`、`restoreHistory`（11 第 2 节）：`entries` 按 `changedAt` 降序，`index` 是在该字段历史数组里的位置；`restoreHistory` 把那条旧值设为当前值，当前值按规则进入历史（每字段最多 10 条）。`ipc/vault.js` 与 `preload/vault.cjs` 增加这 4 个函数。
2. 界面：详情里敏感字段下方“历史记录（N）”，展开后每条显示修改时间与“显示”“复制”“恢复为当前值”（恢复前 `window.confirm`）；显示的旧值同样 20 秒或失焦后遮盖。
3. 新建 `tests/vault-history.test.mjs`：
   - `three password changes leave three history entries`
   - `restoring an old value adds the current one to history`
   - `history keeps only the ten newest values`

提交 `WP-11: vault field history`。

### 步骤 2：到期提醒

- 摘要里已有 `expiresAt`。界面：`expiresAt` 在今天起 30 天内的条目显示“即将到期”标签，已过期显示“已过期”标签（样式见第 1 节最后的“界面样式”）；左栏新增分类“即将到期”（包含即将到期和已过期的，非回收站）。
- 判断逻辑写成纯函数 `src/vault-ui/expiry.js`：`expiryState(expiresAt, todayString)` → `"none" | "soon" | "expired"`（`todayString` 是 `YYYY-MM-DD` 本地日期）。界面传入 `Date.now()` 对应的本地日期；单元测试传入固定日期。
- 提醒只出现在密钥库窗口里，不发到工作区或系统通知。
- 新建 `tests/vault-expiry.test.mjs`：`expiry states at 29 days 31 days and past`（29 天 → `soon`，31 天 → `none`，昨天 → `expired`，`null` → `none`）。

提交 `WP-11: expiry markers`。

### 步骤 3：安全检查

- 主进程 `vaultService.securityReport()`：只在已解锁时可用，结果只在内存里，不写任何文件。四项：
  - `weak`：`type === "login"` 的条目里，第一个 `kind === "secret"` 字段的值不满足 03 第 4.1 节规则 1–4 中任意一条（用 `checkMasterPassword`）；
  - `reused`：所有条目里所有 `secret` 字段，值的 SHA-256 相同的分成一组（组内至少 2 个不同条目）；
  - `stale`：`login` 条目的第一个 `secret` 字段，“最近一次修改时间”（该字段历史里最新的 `changedAt`，没有历史就用条目的 `createdAt`）早于 365 天前；
  - `noTotp`：`login` 条目里没有任何有值的 `totp` 字段。
- 界面：左栏“安全检查”，四个分组标题后面显示数量，点击条目跳到详情。
- 新建 `tests/vault-security-report.test.mjs`：每项各一个正例、一个反例；`the report is never written to disk`（生成报告后关闭服务，扫描数据目录里没有报告里出现过的条目 ID 以外的内容——用一个独特的密码作为标记，扫描命中 0）。

提交 `WP-11: security report`。

### 步骤 4：浏览器密码 CSV 导入

- 主进程 `electron/main/vault/browserCsv.js`（不 import electron）：
  - `parseCsv(text)`：RFC 4180（逗号分隔、双引号包裹、`""` 表示一个引号、引号内可以有逗号和换行；去掉开头的 UTF-8 BOM；`\r\n` 与 `\n` 都接受）；
  - `mapBrowserRows(rows)`：第一行是表头。Chrome/Edge 表头含 `name,url,username,password`（可能还有 `note`）；Firefox 表头含 `url,username,password,httpRealm,formActionOrigin,guid,timeCreated,timeLastUsed,timePasswordChanged`（带引号）。按列名取值（不按位置）；识别不了表头 → 抛 `E_INVALID_ARGUMENT`（“不是浏览器导出的密码文件”）。每行得到 `{ name, url, username, password, note }`，`name` 为空时用 `url` 的主机名，再为空用“未命名”。
- `importBrowserCsv()`：主进程弹“打开”（`.csv`），读文件（UTF-8），解析，结果暂存在内存（`importId`，10 分钟过期），返回 `{ importId, total, preview }`——`preview` 只有前 20 行，每行 `{ rowIndex, name, url, username, hasPassword, note }`，**没有密码**。
- `commitBrowserCsvImport({ importId, rowIndexes, deleteSourceFile })`：把选中的行导入为 `login` 条目（标题 = `name`；字段：网址、用户名、密码（敏感）、备注；标签 `["导入"]`）；`deleteSourceFile` 为真时先用 `dialogs.showMessageBox` 二次确认（“确定删除 <文件名>？删除后无法恢复。”，按钮“删除”“保留”），确认才删除；返回 `{ importedCount, deletedSourceFile }`；完成后清掉内存里的解析结果。
- 界面：设置页“从浏览器导入密码…”→ 预览表格（密码列显示 `••••`）→ 勾选行（默认全选）→ “导入”→ 完成后提示“CSV 文件里是明文密码，建议删除”和复选框“导入后删除这个 CSV 文件”（默认不勾选）。
- 夹具：`tests/fixtures/browser-passwords/chrome.csv`、`edge.csv`、`firefox.csv`，各 5 行虚构数据，至少包含：带逗号的备注、带引号的名称、备注里有换行、中文用户名、空的 `name`。
- 新建 `tests/vault-browser-csv.test.mjs`：
  - `chrome edge and firefox exports are recognised`
  - `quotes commas newlines and chinese survive parsing`
  - `previews never contain passwords`
  - `selected rows are imported as login items tagged import`
  - `the source file is deleted only after a second confirmation`（假 `showMessageBox`：选“保留”不删，选“删除”才删）

提交 `WP-11: browser password csv import`。

### 步骤 5：口令短语

```powershell
Copy-Item -LiteralPath 'docs\blueprint\data\effLargeWordlist.txt' -Destination 'electron\main\vault\effLargeWordlist.txt'
Get-FileHash -Algorithm SHA256 -LiteralPath 'electron\main\vault\effLargeWordlist.txt'
```

哈希必须是 `1BDD48825A4F4D7AF2BC885D764766052335B4C1CFC2F7E414A679404390E3C4`。

- `passwordGenerator.js` 增加 `mode: "passphrase"`（11 第 4.9 节）：`words` 4–10（默认 5），每个词用 `randomInt(0, 7776)` 从词表取；`separator` 取 `"-"`、`" "`、`"."`、`"_"` 之一；`capitalize` 为真时每个词首字母大写；`appendNumber` 为真时在最后一个词后面接一个 `randomInt(10, 100)` 的两位数。
- 界面：密码生成器增加“口令短语”页签。
- “关于”（密钥库设置页底部）写明：口令短语词表来自 Electronic Frontier Foundation 的 EFF Large Wordlist，许可证 CC BY 3.0 US。
- 新建 `tests/vault-passphrase.test.mjs`：
  - `word list has 7776 unique words`
  - `options control words separator capitals and number`
  - `ten thousand phrases only use listed words`

提交 `WP-11: passphrase generator`。

### 步骤 6：正式版加固

1. `scripts/desktop-build.mjs`：`release` 时在 electron-builder 参数里追加 7 个：`-c.electronFuses.runAsNode=false`、`-c.electronFuses.enableCookieEncryption=true`、`-c.electronFuses.enableNodeOptionsEnvironmentVariable=false`、`-c.electronFuses.enableNodeCliInspectArguments=false`、`-c.electronFuses.enableEmbeddedAsarIntegrityValidation=true`、`-c.electronFuses.onlyLoadAppFromAsar=true`、`-c.electronFuses.grantFileProtocolExtraPrivileges=false`。`test` 时**不加**。
2. 依赖：`npm install --save-dev --save-exact @electron/fuses@1.8.0`（只用于测试里读取 Fuse 状态）。
3. 新建 `tests/desktop/release-hardening.e2e.mjs`（运行前检查 `release\release\win-unpacked\Life Atlas.exe` 存在，不存在就让测试失败并提示先运行 `npm run desktop:build`；不用 Playwright）：
   - `release fuses are set as designed`：`getCurrentFuseWire` 前 8 位等于 `[48, 49, 48, 48, 49, 49, 48, 48]`。
   - `the release build ignores ELECTRON_RUN_AS_NODE`：`spawn(exe, ["-e", "console.log('NODE_MODE_ACTIVE')"], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", LIFE_ATLAS_DATA_ROOT: 临时目录 } })`，8 秒后结束它；输出里**没有** `NODE_MODE_ACTIVE`。
   - `a tampered asar header stops the app`：把 `win-unpacked` 复制到临时目录，改 `resources\app.asar` 头部里第一个 `"size":` 后面的一个数字 → 启动，3 秒内退出、退出码不是 0、输出含 `Integrity`。
   - `tampered main process code stops the app`：复制后改 `app.asar` 里 `requestSingleInstanceLock` 这个字符串的第一个字节 → 3 秒内退出、输出含 `ASAR Integrity Violation`。
   - `an untouched copy keeps running`：复制后不改，5 秒后进程仍在运行，然后结束它。
   每个用例结束时结束自己启动的进程、删除临时目录。
4. 运行：

   ```powershell
   node docs/blueprint/tools/run-logged.mjs .qa/WP-11/desktop-build-release.log npm run desktop:build
   node docs/blueprint/tools/run-logged.mjs .qa/WP-11/release-hardening.log node --test --test-reporter=spec tests/desktop/release-hardening.e2e.mjs
   ```

提交 `WP-11: release fuses and asar integrity`。

### 步骤 7：Windows 剪贴板历史

目标：复制的密码不进入 Windows 剪贴板历史（`Win+V`）和云剪贴板。Windows 的约定是在剪贴板里同时放上格式 `ExcludeClipboardContentFromMonitorProcessing`，或 `CanIncludeInClipboardHistory` 与 `CanUploadToCloudClipboard`（值为 4 字节的 0）。

1. 在 `clipboardGuard.js` 里尝试：先 `clipboard.writeText(value)`，再用 `clipboard.writeBuffer(格式名, Buffer.alloc(4))` 写入上面的格式；写完后用 `clipboard.availableFormats()` 和 `clipboard.readText()` 检查：文字还在、格式也在。
2. 如果写入其他格式会把文字清掉（`readText()` 变空），说明 Electron 不能在同一次写入里放多种格式：放弃这个做法，恢复成只写文字。
3. 结论写进报告第 6 节（做到了 / 做不到 + 依据：你运行的代码与 `availableFormats()` 的输出）。
4. 不论结论如何，密钥库“安全说明”里加一段：“Windows 的‘剪贴板历史’（Win+V）可能会另存一份你复制的密码。建议在 系统设置 → 系统 → 剪贴板 里关闭‘剪贴板历史记录’和‘跨设备同步’。”（做到了排除时，改为“Life Atlas 复制的密码已标记为不进入剪贴板历史，但仍建议……”）
5. 测试：做到了 → 在 `tests/desktop/vault.e2e.mjs` 加用例 `copied secrets are excluded from clipboard history`（断言格式存在）；做不到 → 加用例 `the security notes explain clipboard history`（断言安全说明里有这段文字）。

提交 `WP-11: clipboard history handling`。

### 步骤 8：端到端测试与截图

在 `tests/desktop/vault.e2e.mjs` 追加：

- `history shows and restores old passwords`
- `expiring items are flagged and listed`（创建一个 `expiresAt` 为 10 天后的 API 密钥条目 → 列表里有“即将到期”，左栏“即将到期”里有它）
- `security check lists weak reused stale and missing totp`
- `browser csv import previews without passwords and imports`（预览时密钥库窗口 DOM 里没有夹具里的任何密码；导入数量正确）
- `passphrases can be generated in the editor`

截图：白天、夜间各一张，用 WP-05 的 `shootWindowBothModes`（传密钥库窗口的 page），放 `.qa/WP-11/shots/`，文件名 `<画面>-<light|dark>.png`：`vault-history`、`vault-expiring`、`vault-security-check`、`vault-csv-preview`、`vault-passphrase`、`vault-security-notes`。这 6 个画面没有参照图，由总设计师直接看截图。

运行（顺序与 wp-check 相同）：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-11/build.log npm run build
node docs/blueprint/tools/run-logged.mjs .qa/WP-11/desktop-build-test.log npm run desktop:build:test
node docs/blueprint/tools/run-logged.mjs .qa/WP-11/desktop-build-release.log npm run desktop:build
node docs/blueprint/tools/run-logged.mjs .qa/WP-11/desktop-e2e.log npm run test:e2e:desktop
```

提交 `WP-11: vault hardening e2e tests`。

### 步骤 9：收尾【停止点】

填完报告；第 0 节全部“完成”；提交 `WP-11: complete report`；运行 `node docs/blueprint/tools/wp-check.mjs WP-11 --desktop`，退出码 0 或 2 → 停止。

## 3. 范围

### 不做

- Windows Hello、硬件密钥、浏览器自动填充扩展、密码共享。
- 导入其他密码管理器格式（1Password、Bitwarden 等）。
- 数据密钥轮换的单独入口（WP-06 里改主密码、重新生成恢复密钥时已经轮换）。

## 4. 验收标准

| 编号 | 标准 | 证据 |
| --- | --- | --- |
| AC-11-1 | 修改密码 3 次后历史有 3 条；恢复旧值后当前值正确且历史 +1；超过 10 条只保留最新 10 条 | `tests/vault-history.test.mjs`；「history shows and restores old passwords」 |
| AC-11-2 | 到期状态在 29 天、31 天、已过期时正确；“即将到期”分类可用 | `tests/vault-expiry.test.mjs`；「expiring items are flagged and listed」 |
| AC-11-3 | 安全检查四项各有正反例；结果不写入任何文件 | `tests/vault-security-report.test.mjs`；「security check…」 |
| AC-11-4 | 三种浏览器 CSV 夹具都能正确解析（引号、逗号、换行、中文）；预览中没有密码；导入数量正确；删除 CSV 需要二次确认 | `tests/vault-browser-csv.test.mjs`；「browser csv import…」 |
| AC-11-5 | 口令短语：词数、分隔符、大写、数字选项正确；1 万次生成中每个词都来自词表；“关于”里有 EFF 署名 | `tests/vault-passphrase.test.mjs`；`.qa/WP-11/shots/vault-security-notes-*.png` |
| AC-11-6 | 正式版：Fuse 状态与设计一致；`ELECTRON_RUN_AS_NODE` 无效；改 asar 头部或主进程代码后应用拒绝运行；未改动的副本正常运行 | `tests/desktop/release-hardening.e2e.mjs`；`.qa/WP-11/release-hardening.log` |
| AC-11-7 | 测试版没有 Fuses，现有端到端测试全部仍通过 | `.qa/WP-11/desktop-e2e.log` |
| AC-11-8 | 剪贴板历史的结论与依据写在报告第 6 节；安全说明里有对应文字 | 报告；`.qa/WP-11/shots/vault-security-notes-*.png`；对应的端到端用例 |
| AC-11-9 | 截图 6 个画面 × 白天/夜间共 12 张齐全；新界面照第 1 节的“界面样式”做，只用 `vault.css` 的变量；报告第 5 节逐个画面写了做法 | `.qa/WP-11/shots/*.png`；报告第 5 节 |
| AC-11-10 | G1–G9 | `.qa/WP-11/wp-check.md` |

## 5. 卡点处理

| 情况 | 做法 |
| --- | --- |
| Fuse 状态读出来全是默认值 | 你读的不是加了 Fuses 的那个 exe，或者打包时没带 `-c.electronFuses.*` 参数；看 `.qa/WP-11/desktop-build-release.log` 里有没有 `executing @electron/fuses` |
| 篡改测试里应用没有退出 | 先确认 Fuse 状态测试通过；再确认改的是复制出来的 `app.asar`，不是 `release\release` 里的原件 |
| Firefox 的 CSV 表头带引号识别不了 | 表头也要经过 `parseCsv` 去掉引号后再比较列名 |
| 把 CSV 密码显示在了界面上 | 预览只能用 `hasPassword` |
