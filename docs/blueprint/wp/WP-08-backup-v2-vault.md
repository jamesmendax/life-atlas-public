# WP-08 备份 v2：含密钥库、整包加密、定期备份

- 规模：L · 前置：WP-07 · 分支：`wp/08-backup-v2`
- 停止点：步骤 0（理解确认）、步骤 6（含密钥库的导出/恢复与加密容器完成）、步骤 12（收尾）
- 必读：`04-备份与恢复规格.md` 第 4、5、6、7、9 节；`03-密钥库安全设计.md` 第 3、5、10、12 节；`11-接口契约.md` 第 1 节（`backup.*` 里 WP-08 的行）、第 3 节、第 4.3、4.6 节；WP-05 的 `electron/main/backup/*`；WP-06 的 `vaultService.exportCiphertext`；`09-执行手册.md`；`12-视觉规范-墨白.md` 第 3、6、7 节（参照画面 `design/mobai/shots/backup-*`，原型 `design/mobai/prototype/index.html#view=backup`）；WP-05 的 3.8 节、`src/ui/themes/mobai/backup.css` 和 `tests/desktop/helpers.mjs` 里的 `shootWindowBothModes`

## 0. 一页纸

- **要做到**：用户第四点需求的完整闭环——导出完整备份时可以包含密钥库（始终是密文），可以给整个备份加密；在全新的电脑或数据目录导入后，工作区、附件、密钥库全部还原，用原主密码或恢复密钥解锁后内容完全一致；可以设置每周自动备份到指定文件夹；有一个离线命令行工具，将来应用打不开也能校验和取出数据。
- **交付物**：含密钥库的导出与恢复；`LAENC1` 加密容器（流式）；从快照恢复密钥库；定期备份；`tools/backup-tool.mjs`；对话框里的新选项（墨白样式接着写在 `src/ui/themes/mobai/backup.css`）；单元测试与 `tests/desktop/backup-v2.e2e.mjs`；白天和夜间的截图与对照图。
- **绝对不要**：在任何环节解密或重新加密密钥库条目；让主密码经过工作区窗口；把明文 zip 写到用户选的目标位置；把备份密码写进日志；定期备份删除不是自己生成的文件。
- **什么时候停**：步骤 0 后停；步骤 6 后停；步骤 12 的 wp-check 退出码为 0 或 2 时停。

## 1. 为什么做

用户原话：“导出了这些文件在导入的时候能还原我们原来的数据，并且在导出过程中密钥的部分也是加密的，导入回来的时候也能还原。”

## 2. 设计要点（规定）

### 2.1 导出包含密钥库

`backup.exportFull({ includeVault: true, encryptPassword })` 在主进程里的顺序：

1. 密钥库不存在 → `E_INVALID_ARGUMENT`（“还没有密钥库”）；`recoveryConfirmed` 为假 → `E_LOCKED`（`message: "recovery-unconfirmed"`，界面提示“请先在密钥库里完成恢复密钥确认”）。
2. `confirmRequests.request({ kind: "export-backup", title: "导出完整备份（包含密钥库）", description: "备份中的密钥库仍由你现在的主密码加密。恢复时需要这个主密码或恢复密钥。" })`：`cancelled`/`expired` → `E_CANCELLED`。（确认请求内部用 `verifyPassword` 实际解包 DEK，密码错误时密钥库窗口里会提示并计入失败次数，用户可以重试，直到确认、取消或过期。）
3. 弹“另存为”。
4. `vaultService.exportCiphertext()` → 生成 `vault/vault.json`（04 第 5 节）：`header` 是 `vault_header` 表 `json` 列解析成的对象；`items` 按 `id` 升序，`blobB64` 是 `vault_items.blob` 的 Base64；`state.settings` 是当前设置。manifest 的 `vault = { included: true, vaultId, formatVersion: 1, itemCount }`。
5. 其余同 WP-05 的导出。

### 2.2 整包加密（`electron/main/backup/encryptedContainer.js`，不 import electron）

```js
export const CONTAINER_MAGIC = Buffer.from("LAENC1\0\0", "latin1");
export function isEncryptedContainer(firstBytes)                         // 前 8 字节等于魔数
export async function encryptFileToContainer({ sourceFile, targetFile, key, saltB64, noncePrefix, chunkSize = 1048576, signal, onProgress })
export async function decryptContainerToFile({ sourceFile, targetFile, password, deriveKey, signal })   // → { header }；读头部 → 用头部里的 kdf 参数和盐派生密钥 → 逐块解密
export async function decryptContainerToFileWithKey({ sourceFile, targetFile, key })                  // 测试与已知答案用
```

- 格式严格按 04 第 4 节（头部键顺序、nonce 组成、AAD、最后一块规则）。正式导出时：`saltB64` 为 16 字节随机、`noncePrefix` 为 7 字节随机、`key = deriveKeyArgon2id(备份密码, salt, KDF_PARAMS)`（复用 WP-06 的 worker）。
- 解密时以下任何一种都抛 `VaultError("E_BAD_PASSWORD", "备份密码错误或文件已损坏")`：标签校验失败、魔数不对、头部 JSON 解析失败或字段不对、缺少 `last=1` 的块、`last=1` 之后还有数据、文件在块中间结束。
- 内存：任何时刻只持有一块（1 MiB）的明文和密文。
- 导出流程按 04 第 4 节“不在目标位置留下明文”一条：普通 zip 写到 `<DataRoot>\.staging-export-<时间>\package.zip` → 校验 → 加密到 `<目标>.partial-<随机>` → 流式解密校验哈希 → 改名 → 删除暂存目录。取消或失败时删除所有临时文件。
- 备份密码规则同主密码（03 第 4.1 节，主进程用 WP-06 的 `checkMasterPassword` 判断；不通过返回 `E_INVALID_ARGUMENT`，`message` 列出未通过的规则）。

### 2.3 恢复

- `backup.inspect()`：文件以魔数开头 → 返回 `{ needsPassword: true, inspectId }`（`inspectId` 10 分钟过期）；`backup.inspectWithPassword({ inspectId, password })` → 解密到 `<DataRoot>\.staging-import-<时间>\package.zip` → 按 04 第 3 节检查 → `{ token, summary }`（`summary.encrypted = true`）。`verify` 与 `verifyWithPassword` 同理（只校验，结束后删除暂存）。向导里的 `inspectBackup` 与 `inspectBackupWithPassword` 走同一套代码。
- 摘要里有密钥库时显示“包含密钥库（N 个条目）”和复选框“恢复密钥库”（默认勾选）；当前已有密钥库时加一句“当前密钥库会被备份中的版本替换，当前版本会保存在快照里”。
- `backup.restore({ token, restoreVault: true })`：在 WP-05 的流程里加入密钥库（04 第 7.1 节第 8、9 步）：
  - 暂存目录里用 DELETE 日志模式新建 `vault.db`：写入 `header`（`JSON.stringify` 后存 `json` 列）、全部条目（Base64 解码后存 `blob`）、`vault_state`：`failedAttempts = "0"`、`lockoutUntil = ""`、`recoveryConfirmed = "true"`、`settings` 用包里的；
  - `pre-restore` 快照已经包含当前 `vault.db`（WP-06）；
  - 交换前 `vaultService.lock("restored")` → `closeDatabase()`；交换后 `reopenDatabase()`；推送 `onStatusChanged`；
  - 包里没有密钥库而 `restoreVault` 为真 → `E_INVALID_ARGUMENT`。
- `backup.restoreSnapshot({ id, restoreWorkspace, restoreVault })`：本 WP 实现 `restoreVault: true`（快照里的 `vault.db` 复制到暂存 → 同样的交换）。`vault-reset` 快照只能 `restoreWorkspace: false, restoreVault: true`。对话框里 `vault-reset` 快照的按钮文字为“恢复这个密钥库”。

### 2.4 定期备份

- 设置文件 `<DataRoot>\backup-schedule.json`：`{ enabled, folder, weekday, hour, keepLast, includeVault, encrypt, encryptedPasswordB64, lastRunAt, lastResult }`；`getSchedule` 返回 11 第 4.6 节的形状（不含 `encryptedPasswordB64`）。
- `setSchedule(...)` 校验：`folder` 必须是已存在、可写、**不在数据目录内**的绝对路径（否则 `E_INVALID_ARGUMENT`：“定期备份要放在数据目录以外的地方”）；`weekday` 0–6；`hour` 0–23；`keepLast` 1–52；`includeVault` 从 `false` 变为 `true` 时先发确认请求（`kind: "schedule-backup"`，标题“开启定期备份（包含密钥库）”），不确认就返回 `E_CANCELLED` 且不保存；`encryptPassword` 不为 `null` 时按备份密码规则检查，然后 `safeStorage.encryptString(password)` 的 Base64 存入 `encryptedPasswordB64`（`safeStorage.isEncryptionAvailable()` 为假 → `E_IO`：“这台电脑无法安全保存备份密码”）；`encrypt` 为假时清除 `encryptedPasswordB64`。
- 触发：启动 2 分钟后检查一次，之后每小时一次（时钟取 `__lifeAtlasTest.clock` 或真实时钟）：计算“最近一次计划时间”= 不晚于现在、星期为 `weekday`、本地时间 `hour:00` 的那个时刻；`lastRunAt` 为空或早于它 → 执行一次。
- 执行：导出到 `<folder>\Life-Atlas-自动备份-YYYYMMDD-HHmm.lifeatlas`（本地时间）；`includeVault` 为真时直接复制密文（不再询问，这是 04 第 5 节第 2 条的唯一例外）；`encrypt` 为真时用 `safeStorage.decryptString` 取出备份密码加密；成功后按文件名降序只保留最新 `keepLast` 个**名字完全匹配** `^Life-Atlas-自动备份-\d{8}-\d{4}\.lifeatlas$` 的文件；写 `lastRunAt`、`lastResult`；失败时 `lastResult = { ok: false, at, message }`，写日志。
- 提示：`lastResult.ok === false` 时，工作区左上角的工作区按钮上显示一个小红点，直到用户打开“备份与恢复”对话框（对话框打开时显示失败原因）。渲染进程在窗口获得焦点时和每 60 秒调用一次 `backup.getStatus()` 来判断。
- 测试钩子：`__lifeAtlasTest.schedule.checkNow()` 立即执行一次检查（11 第 5 节，本 WP 加入）。

### 2.5 离线工具 `tools/backup-tool.mjs`

普通 Node 24 运行，不依赖 Electron（可以 import `src/backup/*`、`electron/main/backup/encryptedContainer.js`、`electron/main/backup/zipNode.js`、`electron/main/vault/*` 里的纯模块）：

```
node tools/backup-tool.mjs verify  <备份文件>                                     校验完整性，输出 report JSON；加密包会提示输入备份密码
node tools/backup-tool.mjs extract <备份文件> <输出目录>                           取出 workspace/ 与 assets/（不含密钥库明文）
node tools/backup-tool.mjs vault-decrypt <备份文件> <输出文件> --i-understand-plaintext
                                                                                 输入主密码后把密钥库解密成 JSON 数组（明文！）
node tools/backup-tool.mjs --help
```

- 密码输入不回显（`readline` + 把输出静音）；也可以用环境变量 `LIFE_ATLAS_BACKUP_PASSWORD`、`LIFE_ATLAS_MASTER_PASSWORD` 提供（给自动化测试用，`--help` 里写明“会留在命令历史里，平时不要用”）。
- `vault-decrypt` 没有 `--i-understand-plaintext` 时拒绝运行（退出码 2），有的话先打印醒目警告“输出文件是明文密码，用完请立即安全删除”；输出目录不存在时报错，不自动创建。
- `--help` 写明：格式依据是 `docs/blueprint/04-备份与恢复规格.md` 与 `docs/blueprint/03-密钥库安全设计.md`。
- 退出码：成功 0；校验发现问题 1；参数或密码错误 2。

### 2.6 界面（“备份与恢复”对话框）

- “导出备份”页：复选框“包含密钥库（仍由你的主密码加密）”——存在密钥库时默认勾选，不存在时禁用并显示“还没有密钥库”；点“导出…”后若包含密钥库，对话框显示“请在密钥库窗口中输入主密码确认”（工作区窗口里**没有**任何主密码输入框）。复选框“加密整个备份”——勾选后出现两个备份密码输入框和规则说明，以及醒目的提示“忘记备份密码，这个备份就无法打开。备份密码不会保存在任何地方。”
- “从备份恢复”页：加密包先出现备份密码输入框；摘要显示密钥库信息与“恢复密钥库”复选框。
- 新增“定期备份”选项卡（只在桌面版出现，放在 WP-05 的“快照”后面）：开关、文件夹（“选择…”调用 `chooseScheduleFolder`）、星期、时间、保留份数、“包含密钥库（仍是密文）”、“加密整个备份”（勾选后输入备份密码，并说明“备份密码会加密保存在这台电脑上，用于自动备份”）、上次运行时间与结果。
- **墨白样式**：对话框的结构 WP-05 的 3.8 节已经定好；本 WP 的样式接着写在 `src/ui/themes/mobai/backup.css` 末尾，规则相同（选择器前加 `:root[data-style="mobai"] `，变量按 12 第 0 节换名，只用 `--mb-*` 变量，旧 CSS 里不写颜色）。
  - 勾选“加密整个备份”以后的“导出备份”页就是参照图 `design/mobai/shots/backup-*`：两个备份密码框是 12 第 6 节的输入框（加 WP-20 的 `.mb-field` 类就是这个样子：`--mb-field` 底、一圈 1 px `--mb-field-line`、圆角 6 px，聚焦时 `--mb-focus` 光圈；高度照原型 `.input` 设成 32 px），排成原型的 `.field-row`（左边 110 px 的 14 px `--mb-muted` 标签、右边输入框、下面一行 12 px `--mb-faint` 说明）；“忘记备份密码……”这句提示用原型 `.notice` 的样子（`--mb-side` 底、圆角 8 px、14 px `--mb-ink` 字，左边 18 px `--mb-muted` 警告图标）。
  - 复选框、开关、下拉框都用 12 第 6 节的样子：复选框照 WP-20 `editor.css` 里待办复选框的规则画（16 px、圆角 3 px、1.5 px 描边，勾选后 `--mb-accent` 底加白色对勾）；开关 30×18（原型 `.switch`：关 `rgba(135, 131, 120, 0.3)`、开 `--mb-accent`，14 px 白色圆钮；这几个写死的颜色是 12 第 6 节规定的，照抄）；下拉框照原型 `.select`（高 30 px、1 px `--mb-line-2` 描边、圆角 6 px、右边一个小箭头，悬停 `--mb-hover` 底）。“定期备份”页的星期、时间、保留份数三个下拉框排成一行，文件夹路径用 13 px 的等宽字（原型 `.input-path`），后面是小号次按钮“选择…”（原型 `.btn-line.btn-sm`：高 24 px、13 px 字）；上次运行失败时用危险色写原因。
  - 工作区按钮上的小红点（2.4 节）：8 px 圆点，颜色 `--mb-danger`。
  - 密钥库窗口里的确认框沿用 WP-07 的样式，本 WP 不改 `src/vault-ui/vault.css`。

## 3. 范围

### 必做

第 2 节全部；第 4 节全部步骤。

### 不做

- 合并导入；云端备份；在备份里解密或重新加密密钥库（永远不做）。

## 4. 执行步骤

### 步骤 0：开工准备【停止点】

按执行手册 3.1 节开工（分支 `wp/08-backup-v2`），生成报告骨架，跑基线 `npm test`。理解题：

1. 导出含密钥库的备份时，密钥库条目在哪一步被解密？
2. 加密导出时，明文 zip 出现在哪里？为什么不能写到用户选的文件夹里？
3. 定期备份为什么只在开启时问一次主密码？备份密码存在哪里、怎么保护？
4. 恢复一个包含密钥库的备份后，密钥库处于什么状态？用什么能打开它？

提交 `WP-08: step 0 understanding`，运行 `node docs/blueprint/tools/wp-check.mjs WP-08 --until 0`，退出码 0 → **停止**。

### 步骤 1：加密容器

按 2.2 实现 `encryptedContainer.js`。新建 `tests/backup-encrypted-container.test.mjs`：

- `container bytes match the four reference vectors`（04 第 4 节的已知答案，用 `encryptFileToContainer` 传入固定的 key、salt、noncePrefix、`chunkSize: 16`）
- `round trip restores the exact bytes for many sizes`（0、1、16、17、1 MiB、1 MiB + 1、3 MiB 字节）
- `a wrong key is rejected`
- `one flipped byte anywhere is rejected`（头部、第一块、最后一块各一次）
- `a truncated last chunk is rejected`（去掉最后一块）
- `appended data after the last chunk is rejected`
- `chunks out of order are rejected`（交换第 1、2 块）
- `memory stays flat while encrypting a large file`（200 MB 文件，`process.memoryUsage().rss` 峰值增加 < 100 MB）

提交 `WP-08: encrypted backup container`。

### 步骤 2：含密钥库的导出

按 2.1 实现。新建 `tests/backup-vault-export.test.mjs`（普通 Node；用 WP-06 的服务，KDF 用注入的 8192 KiB）：

- `vault ciphertext is copied without decryption`（AC-08-3：包里 `vault/vault.json` 的 `header` 与 `vault.db` 头部深度相等；每个 `blobB64` 解码后与 `vault_items.blob` 逐字节相等；导出过程中服务的 DEK 没有被使用——用一个计数的 `openItem` 替身断言调用次数为 0）
- `export with vault requires a confirmed request`（`cancelled`、`expired` 都不生成文件）
- `export is refused while the recovery key is unconfirmed`
- `manifest records the vault`

提交 `WP-08: export with vault`。

### 步骤 3：加密导出与解密导入

按 2.2、2.3 实现（`inspectWithPassword`、`verifyWithPassword`、暂存目录）。新建 `tests/backup-encrypted-flow.test.mjs`：

- `encrypted export leaves no plaintext zip outside the data root`（导出到另一个临时目录：目标目录里只有最终的 `.lifeatlas`；暂存目录已删除；用 `tools/scan-plaintext.mjs` 扫描目标文件，工作区页面标题标记命中 0）
- `encrypted packages need the right password`（错误密码 `E_BAD_PASSWORD`；正确密码得到摘要且 `encrypted === true`）
- `staging files are removed after inspect expires or restore finishes`

提交 `WP-08: encrypted export and import`。

### 步骤 4：恢复密钥库

按 2.3 实现。新建 `tests/backup-vault-restore.test.mjs`：

- `vault restore round trips every item`（B1 完整版：满配工作区 + 10 个条目（`vaultTenItems`，在 `tests/fixtures/vault-items.mjs` 追加）→ 导出（含密钥库）→ 新数据目录恢复 → 同一主密码解锁 → 每个条目逐字段相等）
- `the recovery key also unlocks the restored vault`
- `restoring over an existing vault keeps the old one in the pre-restore snapshot`
- `throttle counters are reset by restore`
- `restoring a vault reset snapshot brings the old vault back`

提交 `WP-08: restore vault from backup and snapshot`。

### 步骤 5：B6 与 B7

新建 `tests/backup-b6-b7.test.mjs`：

- `encrypted round trip matches the plain round trip`（B6：加密导出 → 恢复 → 与步骤 4 同样逐项一致）
- `tampered encrypted packages are rejected`（改 1 字节、截掉最后一块、末尾追加数据）
- `no marker appears in plain or encrypted packages`（B7 / S1：两种包都用 `tools/scan-plaintext.mjs` 扫描，密钥库标记命中 0；加密包额外断言工作区页面标题标记命中 0）

提交 `WP-08: b6 and b7`。

### 步骤 6：检查点【停止点】

`node docs/blueprint/tools/run-logged.mjs .qa/WP-08/step6-npm-test.log npm test` 全部通过后提交 `WP-08: vault backup checkpoint`，运行 `node docs/blueprint/tools/wp-check.mjs WP-08 --until 6`，退出码 0 → **停止**。

### 步骤 7：定期备份

按 2.4 实现。新建 `tests/backup-schedule.test.mjs`（假时钟、假 `safeStorage`、临时文件夹）：

- `the next run is due at the weekly slot`（周日 20:00：周日 19:59 不执行，20:00 执行，执行后同一周不再执行，下周日 20:00 再执行）
- `a missed slot runs at the next check after startup`
- `keepLast removes only automatic backups`（目录里放 10 个自动备份文件和 2 个别的 `.lifeatlas` 文件，`keepLast: 8` → 删掉 2 个最旧的自动备份，另外 2 个文件不动）
- `enabling vault backups asks for confirmation once`
- `the backup password is stored only through safeStorage`（`backup-schedule.json` 里没有明文密码；假 `safeStorage` 被调用）
- `failures are recorded and reported once`
- `folders inside the data root are rejected`

提交 `WP-08: scheduled backups`。

### 步骤 8：离线工具

按 2.5 实现。新建 `tests/backup-tool.test.mjs`（用 `child_process.spawnSync(process.execPath, ["tools/backup-tool.mjs", …])`，密码通过环境变量提供）：

- `verify reports ok and problems with exit codes`
- `extract writes workspace and assets without vault plaintext`
- `vault-decrypt refuses without the acknowledgement flag`（退出码 2，没有输出文件）
- `vault-decrypt writes every item with the right master password`
- `help mentions the format documents`

提交 `WP-08: offline backup tool`。

### 步骤 9：界面

按 2.6 实现（以及 2.4 的红点；样式按 2.6 节最后一条写在 `backup.css`）。浏览器模式的对话框不变。提交 `WP-08: backup dialog options`。

### 步骤 10：端到端测试

新建 `tests/desktop/backup-v2.e2e.mjs`，用例名照抄：

- `exporting with the vault asks in the vault window only`（AC-08-2：工作区窗口 DOM 里没有任何 `input[type=password]`；确认框出现在密钥库窗口；错误密码、取消、超时（`LIFE_ATLAS_TEST_CONFIRM_TTL_MS: "3000"`）三种情况都不生成文件；错误密码计入失败次数）
- `a full backup restores workspace assets and vault on a new data root`（AC-08-1：界面上导出（含密钥库）→ 新数据目录用向导“从备份恢复”→ 解锁 → 条目逐字段相等；工作区与附件同 WP-05 的比较）
- `the recovery key unlocks a restored vault`（AC-08-4）
- `an encrypted backup restores with its password`（AC-08-5 端到端部分）
- `encrypted export and restore of one gigabyte stay within memory budget`（AC-08-7：同 WP-05 的 1 GB 附件制作方法；导出与恢复两个阶段的 `peakRss - baselineRss` 都 < 300 MB；打印 `WP08_EXPORT_PEAK_MB=`、`WP08_RESTORE_PEAK_MB=`）
- `restoring over an existing vault keeps a snapshot`（AC-08-8）
- `scheduled backups run and clean up`（AC-08-9 端到端部分：`setSchedule`（包含密钥库，需要在密钥库窗口确认；加密，备份密码 `Backup-Pass-2026!`）→ `clock.set` 到计划时间之后 → `schedule.checkNow()` → 文件夹里出现自动备份文件，能用这个备份密码解密；`backup-schedule.json` 里搜索不到 `Backup-Pass-2026!`）

运行：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-08/build.log npm run build
node docs/blueprint/tools/run-logged.mjs .qa/WP-08/desktop-build-test.log npm run desktop:build:test
node docs/blueprint/tools/run-logged.mjs .qa/WP-08/desktop-e2e.log npm run test:e2e:desktop
```

提交 `WP-08: backup v2 e2e tests`。

### 步骤 11：截图与备份建议

截图：白天、夜间各一张，用 WP-05 的 `shootWindowBothModes`，放 `.qa/WP-08/shots/`，文件名 `<画面>-<light|dark>.png`（工作区窗口 1440×900，密钥库窗口是它自己的大小）。画面：`export-with-vault`（含“请在密钥库窗口中输入主密码确认”）、`vault-confirm-export`（密钥库窗口里的确认框）、`backup`（“导出备份”页，勾选“加密整个备份”并填好两个备份密码，和参照图是同一个画面）、`restore-summary-vault`、`schedule-settings`。然后生成对照图：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-08/compare.log node docs/blueprint/tools/compare-shots.mjs docs/blueprint/design/mobai/shots .qa/WP-08/shots --only backup --out .qa/WP-08/compare
```

退出码 0。对话框背后的页面和参照图不同，差异占比只供参考；把 `summary.md` 复制进报告第 3 节，并写出你看到的不同之处（布局、字体、颜色、线条）。

报告最后加一节“给用户的备份建议”：多久导出一次（每周，以及重要修改之后）；存在哪里（另一块硬盘或 U 盘；同步盘可以放加密的备份）；主密码与恢复密钥怎么保管（恢复卡打印或抄在纸上，与备份分开放）；在新电脑上怎么恢复（安装 → 向导选目录 → 从备份恢复 → 用原主密码解锁密钥库）。

### 步骤 12：收尾【停止点】

填完报告（第 3 节写出两个内存峰值实测值）；第 0 节全部“完成”；提交 `WP-08: complete report`；运行：

```powershell
node docs/blueprint/tools/wp-check.mjs WP-08 --browser --desktop
```

退出码 0 或 2 → 停止。

## 5. 验收标准

| 编号 | 标准 | 证据 |
| --- | --- | --- |
| AC-08-1 | B1 完整版：满配工作区 + 10 个条目 → 导出（含密钥库）→ 新数据目录恢复 → 工作区逐实体相等、附件哈希相等、同一主密码解锁后每个条目逐字段相等 | `tests/backup-vault-restore.test.mjs`；「a full backup restores workspace assets and vault…」 |
| AC-08-2 | 导出含密钥库时：确认框只在密钥库窗口出现（工作区窗口没有密码输入框）；错误、取消、超时都不生成文件；错误计入失败次数 | 「exporting with the vault asks in the vault window only」；`tests/backup-vault-export.test.mjs` |
| AC-08-3 | 备份里的 `header` 与 `vault.db` 深度相等，条目密文逐字节相等，导出过程没有解密任何条目 | 「vault ciphertext is copied without decryption」 |
| AC-08-4 | 恢复后用恢复密钥也能解锁 | 「the recovery key also unlocks…」；「the recovery key unlocks a restored vault」 |
| AC-08-5 | B6：加密容器与 4 个已知答案一致；错误密码被拒；正确密码恢复后逐项一致；改字节、截尾、追加、乱序都被拒 | `tests/backup-encrypted-container.test.mjs`；`tests/backup-b6-b7.test.mjs` |
| AC-08-6 | B7 / S1：两种包的密钥库标记命中 0；加密包里工作区标记也命中 0；加密导出不在目标目录留明文 | `tests/backup-b6-b7.test.mjs`；`tests/backup-encrypted-flow.test.mjs` |
| AC-08-7 | 1 GB 附件的加密导出与恢复：主进程内存峰值增加都 < 300 MB（报告写实测值） | 「encrypted export and restore of one gigabyte…」 |
| AC-08-8 | 恢复时已有的密钥库被保存在 `pre-restore` 快照里；`vault-reset` 快照可以恢复 | `tests/backup-vault-restore.test.mjs`；「restoring over an existing vault keeps a snapshot」 |
| AC-08-9 | 定期备份：计划时间、错过后补跑、只清理自动备份文件、开启时确认一次、备份密码只经 `safeStorage` 保存、失败提示 | `tests/backup-schedule.test.mjs`；「scheduled backups run and clean up」 |
| AC-08-10 | 离线工具三个命令在普通 Node 下可用；`vault-decrypt` 缺少确认参数时拒绝运行 | `tests/backup-tool.test.mjs` |
| AC-08-11 | 截图 5 个画面 × 白天/夜间共 10 张齐全；“导出备份”页与参照图 `backup-*` 并排对照；新界面只用 `--mb-*` 变量 | `.qa/WP-08/shots/*.png`；`.qa/WP-08/compare/summary.md`；报告第 3 节 |
| AC-08-12 | G1–G9 | `.qa/WP-08/wp-check.md` |

## 6. 卡点处理

| 情况 | 做法 |
| --- | --- |
| 已知答案对不上 | 先检查头部 JSON 的键顺序和有没有空格；再检查 nonce 是不是 `前缀 7 字节 ‖ 块序号 4 字节大端 ‖ last 1 字节`；AAD 是不是“魔数 + 长度 + 头部”的 SHA-256 |
| `safeStorage.isEncryptionAvailable()` 在测试里为假 | 单元测试用假 `safeStorage`；端到端测试在本机 Windows 上应为真，如果为假就停下报告 |
| 1 GB 测试磁盘空间不够 | 加密导出需要约 3 倍空间（暂存 zip + 加密文件 + 恢复暂存）；先 `Get-PSDrive` 看剩余空间，不够就停下报告，不要缩小测试 |
| 恢复后密钥库窗口仍显示旧条目 | 交换前没有 `lock("restored")`，或者窗口没有处理 `onLocked` 重建界面 |
| 对话框的新控件在夜间还是白底或看不清 | 样式没写在 `src/ui/themes/mobai/backup.css`，或者写死了颜色；改用 `--mb-*` 变量 |
