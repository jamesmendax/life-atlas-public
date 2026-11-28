# WP-06 密钥库加密内核（主进程，无界面）

- 规模：L · 前置：WP-05 · 分支：`wp/06-vault-core`
- 停止点：步骤 0（理解确认）、步骤 8（密码学模块完成）、步骤 16（收尾）
- 必读：`03-密钥库安全设计.md` **全文**（这是本 WP 的规格）；`11-接口契约.md` 第 2 节、第 4.7–4.9 节、第 5 节；`02-总体架构.md` 第 1、2 节；`10-测试夹具规格.md` 第 4 节；`09-执行手册.md`

## 0. 一页纸

- **要做到**：主进程里一个完整、经过测试的密钥库服务——创建、解锁、上锁、条目增删改查、显示/复制字段、TOTP、生成密码、改主密码、恢复密钥找回、重新生成恢复密钥、重置、失败节流、自动上锁计时、剪贴板定时清除、确认请求。全部能在普通 Node 下单元测试。界面在 WP-07。
- **交付物**：依赖 `hash-wasm@4.12.0`；`electron/main/vault/` 下 11 个模块；`electron/main/ipc/vault.js`；`electron/preload/vault.cjs`；`tools/scan-plaintext.mjs`；`tests/fixtures/vault-items.mjs`；快照包含 `vault.db`；单元测试。
- **绝对不要**：替换算法、调低参数、改动 AAD 字符串或头部字段名（03 第 3–7 节是规定）；用 `Math.random`；把任何密码、恢复密钥、条目内容写进日志或磁盘明文；做任何界面；在 release 构建里留下改 KDF 参数或时间的途径；自行增加 03 没写的安全功能。
- **什么时候停**：步骤 0 后停；步骤 8 后停；步骤 16 的 wp-check 退出码为 0 或 2 时停。

## 1. 为什么做

用户要一个“即使软件被入侵也有一定防御性”的地方存账号和密钥。本 WP 只做最核心、最不能出错的部分：主进程里的加密、存储、状态机和全部安全测试。

## 2. 已知事实（总设计师 2026-11-01 实测）

见 03 第 3.1 节与第 4.2 节：Argon2id、HKDF、AES-GCM、TOTP、恢复密钥格式都有已知答案；`hash-wasm@4.12.0` 在 `worker_threads` 里结果一致，正式参数约 0.4 秒；常见密码表已放在 `docs/blueprint/data/commonPasswords.txt`（SHA-256 `60f8bc6795ce51e2dd95247bfbb0cfd86dab5760471e13087dffa4560cc78706`）。

## 3. 模块与函数签名（规定）

全部放 `electron/main/vault/`，除 `ipc/vault.js` 和 preload 外都**不 import electron**；时钟、计时器、随机源、剪贴板、KDF、数据库句柄全部通过参数注入。

```js
// errors.js
export class VaultError extends Error {}              // constructor(code, message, extra = {})；extra 可含 retryAfterMs、reason

// crypto.js
export const KDF_PARAMS = Object.freeze({ alg: "argon2id", version: 19, memoryKiB: 131072, iterations: 3, parallelism: 1 });
export async function deriveKeyArgon2id(password, salt, params = KDF_PARAMS)   // → Buffer(32)；内部 password.normalize("NFKC")；在 worker 里运行
export function hkdfRecoveryKek(recoveryKeyBytes, salt)                        // → Buffer(32)；crypto.hkdfSync("sha256", …, "life-atlas/vault/v1/recovery-kek", 32)
export function aesGcmEncrypt(key, plaintext, aad)                             // → Buffer(nonce12 ‖ ciphertext ‖ tag16)，nonce 每次 crypto.randomBytes(12)
export function aesGcmDecrypt(key, blob, aad)                                  // → Buffer；认证失败抛 VaultError("E_CORRUPT")
export function aadPasswordWrap(vaultId, kdf)                                  // → Buffer，03 第 5.1 节第一行
export function aadRecoveryWrap(vaultId)                                       // → Buffer，第二行
export function aadItem(vaultId, itemId)                                       // → Buffer，第三行

// kdfWorker.js —— worker_threads 入口：收到 { passwordB64, saltB64, params }，回 { keyB64 } 或 { error }；只做 Argon2id
// deriveKeyArgon2id 每次新建一个 Worker（new URL("./kdfWorker.js", import.meta.url)），拿到结果后 terminate()

// recoveryKey.js
export function generateRecoveryKey(randomBytes)      // → { bytes: Buffer(32), formatted }
export function formatRecoveryKey(bytes)              // → "LA1-…"（03 第 4.2 节）
export function parseRecoveryKey(input)               // → Buffer(32)；任何不合规抛 VaultError("E_INVALID_ARGUMENT", "恢复密钥有误")
export function lastTwoGroups(formatted)              // → "XXXXX-XXXXX"

// passwordPolicy.js
export function loadCommonPasswords(fileText)         // → Set（小写；跳过空行和 # 开头的行）
export function isCommonPassword(password, commonPasswords)   // 03 第 4.1 节规则 3 的判断方法
export function checkMasterPassword(password, commonPasswords)
// → { ok, failures: ["length" | "distinct" | "common" | "pattern"], bits, strength: "weak" | "medium" | "strong" }

// passwordGenerator.js
export function generatePassword(options, randomInt)  // randomInt(min, max) 注入（生产用 crypto.randomInt）；options 见 11 第 4.9 节

// totp.js
export function parseTotpSecret(value)                // → { secretBytes, algorithm, digits, period, issuer, account }；支持 otpauth://totp/… 与裸 Base32
export function totpCode({ secretBytes, algorithm, digits, period }, unixSeconds)   // → 字符串（补前导 0）

// itemCodec.js
export function encodeItem(item)                      // → Buffer：4 字节大端长度 ‖ JSON UTF-8 ‖ 0x00 填充到 512 的整数倍
export function decodeItem(plaintext)                 // → item
export function sealItem(dek, vaultId, item)          // → blob = aesGcmEncrypt(dek, encodeItem(item), aadItem(vaultId, item.id))
export function openItem(dek, vaultId, itemId, blob)  // → item；失败抛 VaultError("E_CORRUPT", "条目已损坏，无法解密")

// vaultStore.js
export function openVaultDatabase(file)               // → db；PRAGMA journal_mode=WAL、synchronous=FULL、secure_delete=ON；建三张表（03 第 5 节）
export function readHeader(db) / writeHeader(db, header)
export function listItemIds(db) / getItemBlob(db, id) / putItemBlob(db, id, blob) / deleteItemBlob(db, id)
export function getState(db, key) / setState(db, key, value)
export function inTransaction(db, fn)                 // BEGIN IMMEDIATE / COMMIT / ROLLBACK
export function vacuumInto(db, targetFile)

// clipboardGuard.js
export function createClipboardGuard({ clipboard, timers, clearAfterMs })
// → { copy(text, { clearAfterMs }) → { clearsInSeconds }, check(), clearIfOwned() }；clipboard 需要 readText/writeText/clear

// confirmRequests.js
export function createConfirmRequests({ verifyPassword, timers, ttlMs = 120000, idFactory, deliver })
// → { request({ kind, title, description }) → Promise<"confirmed" | "cancelled" | "expired">, confirm({ requestId, password }), reject({ requestId }) }
// deliver(request) 把请求推给密钥库窗口（WP-07 接上窗口；本 WP 测试里用假函数）

// vaultService.js
export function createVaultService({ dataRoot, clock, timers, randomBytes, randomInt, deriveKey, clipboard, getSystemIdleSeconds,
                                     logger, commonPasswords, kdfParams = KDF_PARAMS, autoLockCheckMs = 15000, injectFailure })
// → 11 第 2 节列出的全部 WP-06 函数（同名、同参数、同返回值），另加：
//   verifyPassword(password) → Promise<boolean>（共用失败计数与节流）
//   snapshotTo(targetFile)（快照用；密钥库不存在时什么都不做）
//   exportCiphertext() → { header, items: [{ id, blobB64 }], settings }（WP-08 用，本 WP 先实现并测试）
//   closeDatabase()、reopenDatabase()（恢复与重置用）
//   onLocked(callback)、onStatusChanged(callback)
```

### 3.1 服务的行为（逐条照 03 实现，补充以下细节）

1. **状态**：`absent`（没有 `vault.db` 或没有头部）→ `create` 后 `unlocked`；`locked`；`unlocked`。`recoveryConfirmed` 独立记在 `vault_state`。
2. **待确认的恢复密钥**只存在内存里（`create`、`changePassword`、`unlockWithRecoveryKey`、`regenerateRecoveryKey` 之后），`confirmRecoveryKey` 成功或上锁时 `fill(0)` 并丢弃。
3. **轮换**按 03 第 4 节“轮换”一条实现；在“已重新加密一半条目”之后调用 `injectFailure?.("vault-rotate")`（测试用，抛错时事务回滚）。
4. **节流**按 03 第 4.3 节；`unlock`、`unlockWithRecoveryKey`、`verifyPassword` 都先检查节流，等待期内抛 `VaultError("E_THROTTLED", …, { retryAfterMs })`，**不调用** `deriveKey`。恢复密钥解包失败**不**计入主密码失败次数。
5. **自动上锁**：解锁后每 `autoLockCheckMs` 检查一次：`应用闲置 = now - 最后一次 activity()（或解锁时间）`，`系统闲置 = getSystemIdleSeconds() × 1000`，任一 ≥ `settings.autoLockMinutes × 60000`（测试钩子开启且有 `LIFE_ATLAS_TEST_AUTOLOCK_MS` 时用它）就 `lock("idle")`。
6. **上锁**按 03 第 4 节“上锁”一条；`reason` 取 11 第 2 节 `onLocked` 的值。
7. **条目输入校验**（不通过抛 `E_INVALID_ARGUMENT`）：`type` 是 7 种之一；`title` 1–500 字符；`tags` ≤ 50 个，每个 ≤ 50 字符；`fields` ≤ 100 个；`label` 1–100 字符；`kind` 是 8 种之一；`value` ≤ 65536 字符；`secret`、`totp` 的 `sensitive` 强制为 `true`；`expiresAt` 为 `null` 或 ISO 日期字符串。
8. **修改**按 11 第 4.7 节的 `patch` 规则；敏感字段的值被改动或字段被删除时，把旧值写进 `history`（每个字段最多 10 条，超出删最旧）。
9. **摘要**按 11 第 4.7 节；`host` 用 `new URL(值).hostname`，解析失败为 `null`；`subtitle` 只取不敏感字段。
10. **回收站**：`trashItem` 设 `deletedAt`；解锁时永久删除 `deletedAt` 早于 `now - 30 天` 的条目。
11. **重置**按 03 第 4 节：`confirmPhrase !== "重置我的密钥库"` → `E_INVALID_ARGUMENT`；上锁 → `closeDatabase()` → 把 `vault.db` 移到 `snapshots\<UTC 时间>-vault-reset\vault.db` 并写 `snapshot.json`（`reason: "vault-reset"`、`includesWorkspace: false`、`includesVault: true`）→ 状态变为 `absent`。
12. **设置**：默认值见 11 第 4.8 节；`updateSettings` 校验取值范围；存在 `vault_state.settings`。
13. **日志**：只写事件名与数量，例如 `vault.created`、`vault.unlock.ok`、`vault.unlock.failed`（带 `failedAttempts`）、`vault.locked`（带 `reason`）、`vault.item.created`（带条目 `id`）、`vault.rotated`、`vault.reset`。绝不写标题、字段、密码、恢复密钥。
14. **测试钩子**：`LIFE_ATLAS_TEST_AUTOLOCK_MS`、`LIFE_ATLAS_TEST_CLIPBOARD_MS`、`LIFE_ATLAS_TEST_CONFIRM_TTL_MS` 只由 `ipc/vault.js`（主进程装配处）在测试钩子开启时读取并作为参数传入服务；服务本身不读环境变量。`kdfParams` 只能由单元测试直接传参修改，主进程装配处永远传正式参数。

### 3.2 IPC 与 preload

- `electron/main/ipc/vault.js` 导出 `registerVaultIpc({ ipcMain, service, confirmRequests, getVaultWindowId })`：为 11 第 2 节里标为 WP-06 的每个函数注册 `la:vault:<短横线名>`；每个处理函数第一步 `if (event.sender.id !== getVaultWindowId()) return fail("E_FORBIDDEN", "只接受密钥库窗口的调用")`，第二步校验参数，第三步调用服务；`VaultError` 转成 `{ ok: false, error: { code, message, retryAfterMs? } }`。本 WP 还没有密钥库窗口，`getVaultWindowId` 返回 `null`。
- 事件：`onLocked`、`onConfirmRequest` 用 `webContents.send("la:vault:locked" / "la:vault:confirm-request", …)` 推给密钥库窗口（窗口在 WP-07）。
- `electron/preload/vault.cjs`：按 11 第 2 节暴露 `window.lifeAtlasVault` 的 WP-06 函数（WP-11 的函数不加）。

### 3.3 快照包含密钥库

`electron/main/storage/snapshots.js` 的 `createSnapshot` 增加：`vaultService` 存在且有 `vault.db` 时，`daily`、`pre-upgrade`、`manual`、`pre-restore` 快照同时调用 `vaultService.snapshotTo(<快照目录>\vault.db)`，`snapshot.json` 的 `includesVault: true`。

### 3.4 明文扫描工具

`tools/scan-plaintext.mjs`：用法 `node tools/scan-plaintext.mjs <目录或文件…> --markers <标记文件>`（标记文件每行一个标记）。递归扫描所有文件；每个文件按 1 MiB 分块读取，相邻块重叠“最长标记字节数 − 1”，搜索每个标记的 UTF-8 与 UTF-16LE 两种字节形式；扩展名 `.zip` 或 `.lifeatlas` 且以 `PK\x03\x04` 开头的文件，除了扫描原始字节，还用 `yauzl` 逐个条目解压后扫描。输出每个命中：`文件\t偏移\t编码\t标记前 12 个字符`（zip 条目写成 `包路径!条目路径`）；没有命中退出码 0，有命中退出码 1，参数错误退出码 2。

## 4. 范围

### 必做

第 3 节全部；第 5 节全部步骤。

### 不做

- 任何界面、密钥库窗口、侧栏入口（WP-07）。
- 备份里的密钥库、从快照恢复密钥库（WP-08）。
- 口令短语生成、历史记录界面、到期提醒、安全检查、浏览器 CSV 导入、Fuses（WP-11）。
- 03 没写的任何安全功能（Windows Hello、硬件密钥等）。

## 5. 执行步骤

### 步骤 0：开工准备【停止点】

按执行手册 3.1 节开工（分支 `wp/06-vault-core`），生成报告骨架，跑基线 `npm test`。理解题：

1. 用户改主密码时，DEK、两个包裹、条目密文、恢复密钥分别发生什么变化？为什么恢复密钥也要换？
2. 恢复密钥在磁盘上的什么地方保存？
3. 连续输错 7 次主密码后，第 8 次要等多久？等待期间会不会运行 Argon2id？
4. 单元测试里允许把 Argon2id 内存调到 8192 KiB 吗？通过什么方式？端到端测试呢？

提交 `WP-06: step 0 understanding`，运行 `node docs/blueprint/tools/wp-check.mjs WP-06 --until 0`，退出码 0 → **停止**。

### 步骤 1：依赖与数据文件

```powershell
npm install --save-exact hash-wasm@4.12.0
Copy-Item -LiteralPath 'docs\blueprint\data\commonPasswords.txt' -Destination 'electron\main\vault\commonPasswords.txt'
Get-FileHash -Algorithm SHA256 -LiteralPath 'electron\main\vault\commonPasswords.txt'
```

（`electron\main\vault\` 不存在时先 `New-Item -ItemType Directory -Force -Path 'electron\main\vault' | Out-Null`。）哈希必须是 `60F8BC6795CE51E2DD95247BFBB0CFD86DAB5760471E13087DFFA4560CC78706`（PowerShell 显示为大写）。提交 `WP-06: add hash-wasm and the common password list`。

### 步骤 2：crypto.js 与 kdfWorker.js

按第 3 节实现。新建 `tests/vault-crypto.test.mjs`：

- `argon2id matches the reference vector`（03 第 3.1 节，p=1 与 p=4 两个）
- `argon2id matches node crypto for random inputs`（3 组；`crypto.argon2Sync` 不存在时 `test.skip` 是**不允许**的——改为在用例里 `console.log("argon2Sync unavailable, cross-check not run")` 并直接通过）
- `argon2id runs in a worker without blocking the event loop`（正式参数；派生期间每 10 ms 记录一次计时器延迟，最大延迟 < 100 ms；打印 `WP06_KDF_MS=`）
- `hkdf matches the two reference vectors`
- `aes-gcm matches the reference layout`（03 第 3.1 节的固定 key/nonce 向量：用一个可注入 nonce 的内部辅助函数验证；生产函数仍然随机 nonce）
- `aes-gcm rejects a flipped byte and a wrong aad`
- `aad strings match the specification byte for byte`

提交 `WP-06: vault crypto primitives`。

### 步骤 3：recoveryKey.js

新建 `tests/vault-recovery-key.test.mjs`：

- `recovery key format matches the two reference vectors`
- `one thousand generated keys parse back`
- `single character changes are detected`（对 200 个随机密钥，每个随机改 1 个字符成另一个字母表字符，至少 99% 被判定为“恢复密钥有误”）
- `O I and L are normalized`
- `wrong length, bad characters and non-zero padding bits are rejected`
- `lastTwoGroups returns groups ten and eleven`

提交 `WP-06: recovery key format`。

### 步骤 4：passwordPolicy.js

新建 `tests/vault-password-policy.test.mjs`：

- `twelve code points are required`（11 个失败、12 个通过，中文按码点计数）
- `five distinct characters are required`
- `common passwords and padded common passwords are rejected`（03 第 4.1 节规则 3 的 7 个已知答案：前 3 个只因规则 3 失败，后 4 个不因规则 3 失败）
- `sequences and repeats are rejected`（`123456789012`、`abcdefghijkl`、`qwertyuiopas`、`lkjihgfedcba`、`abcabcabcabc`）
- `strength matches the four reference values`（03 第 4.1 节）

提交 `WP-06: master password policy`。

### 步骤 5：passwordGenerator.js

新建 `tests/vault-password-generator.test.mjs`：

- `length bounds are enforced`（7 与 129 抛错，8 与 128 可以）
- `every selected class appears at least once`（1000 次）
- `ambiguous characters are excluded on request`
- `the random source is injectable`（注入固定序列得到固定结果）

提交 `WP-06: password generator`。

### 步骤 6：totp.js

新建 `tests/vault-totp.test.mjs`：

- `rfc 6238 vectors match for sha1 sha256 and sha512`（03 第 3.1 节的 18 个值）
- `otpauth links are parsed with defaults`（缺省 SHA1/6/30；`issuer` 参数与路径前缀；`period=60`、`digits=8`、`algorithm=SHA256`）
- `bare base32 secrets are accepted`（含空格和小写）
- `invalid secrets are rejected`

提交 `WP-06: totp`。

### 步骤 7：itemCodec.js

新建 `tests/vault-item-codec.test.mjs`：

- `sealed blobs are 28 plus a multiple of 512 bytes`（JSON 长度 1、507、508、1000、5000 字节的条目，blob 长度分别为 28+512、28+512、28+1024、28+1024、28+5120）
- `open returns the exact item`
- `a blob opened under another item id fails`（S3 的基础）
- `a flipped byte fails with a readable error`

提交 `WP-06: item codec`。

### 步骤 8：密码学模块检查点【停止点】

`node docs/blueprint/tools/run-logged.mjs .qa/WP-06/step8-npm-test.log npm test` 全部通过后提交 `WP-06: crypto checkpoint`，运行 `node docs/blueprint/tools/wp-check.mjs WP-06 --until 8`，退出码 0 → **停止**。

### 步骤 9：vaultStore.js 与夹具

1. 按第 3 节实现 `vaultStore.js`。
2. 新建 `tests/fixtures/vault-items.mjs`：导出 `createMarkers()`（`next()` 返回 `"LA-MARKER-" + crypto.randomBytes(8).toString("hex")`，`all()` 返回已生成的全部标记）和 `vaultItemInputs(markers)`：7 种类型各一个 `input`，03 第 6.1 节的每个预设字段都有值且值里含一个新标记；标题也含标记；`login` 的两步验证字段值为 `otpauth://totp/<标记>?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=<标记>`。
3. 新建 `tests/vault-store.test.mjs`：
   - `vault database uses wal, full sync and secure delete`
   - `header items and state round trip`
   - `a failed transaction leaves the database unchanged`

提交 `WP-06: vault store and fixtures`。

### 步骤 10：vaultService.js

按第 3 节与 3.1 实现。新建 `tests/vault-service.test.mjs`（除特别说明外用 `kdfParams: { ...KDF_PARAMS, memoryKiB: 8192 }` 加快速度；假时钟、假计时器、假剪贴板）：

- `create lock unlock round trip with official parameters`（**这一条用正式参数**；头部字段名与 03 第 5 节完全一致；`kdf` 是正式值；条目逐字段一致）
- `create starts in the recovery unconfirmed state`（`status().recoveryConfirmed === false`；`list()` 抛 `E_LOCKED`，`reason: "recovery-unconfirmed"`；确认最后两组后正常）
- `unlock after a restart without confirmation requires regeneration`（新建服务实例模拟重启 → `unlock` 返回 `requiresRecoveryKeyRegeneration: true`、`summaries: []` → `regenerateRecoveryKey` → 确认 → 正常）
- `tampering with an item blob affects only that item`（S2）
- `swapping two blobs breaks both`（S3）
- `tampering with the header fails unlock`（S4：改 `kdf.memoryKiB`；改 `wraps.password.blobB64` 的 1 个字符）
- `throttling follows the formula and skips the kdf`（S8：第 5、6、7、10 次失败后的 `retryAfterMs` 分别为 30000、60000、120000、900000；等待期内 `deriveKey` 调用次数不变；新建服务实例后节流仍在）
- `recovery key paths`（S9：校验位错 → 立即拒绝且没调用 HKDF；格式正确但不是本库的 → `E_BAD_PASSWORD`；正确 → 强制设新密码并返回新恢复密钥）
- `changing the password rotates keys`（S10：旧密码失败、新密码成功、旧恢复密钥失败、新恢复密钥成功、条目逐字段一致）
- `old wraps cannot decrypt rotated items`（S16 前半：保存改密码前的 `vault.db` 副本，用旧密码解出旧 DEK，解当前库的任何条目都失败）
- `a failed rotation leaves the vault byte for byte unchanged`（S16 后半：`injectFailure("vault-rotate")` → `vault.db` 的内容与之前相同（关闭后比较 SHA-256）、旧密码仍能解锁）
- `idle and system idle both lock the vault`（S6 单元版：假时钟推进超过 5 分钟 → 上锁，DEK 缓冲区全为 0，`list()` 抛 `E_LOCKED`；`getSystemIdleSeconds` 返回 301 也上锁）
- `history keeps ten values per sensitive field`
- `trash older than thirty days is purged on unlock`（29 天的保留，31 天的删除）
- `summaries never include sensitive values`
- `reset moves the vault into a snapshot and keeps it usable`（重置后 `status().exists === false`；`snapshots\*-vault-reset\vault.db` 存在；用一个新服务实例指向那个文件，用旧密码能解锁）
- `settings are validated and persisted`

提交 `WP-06: vault service`。

### 步骤 11：剪贴板与确认请求

新建 `tests/vault-clipboard-confirm.test.mjs`：

- `clipboard is cleared when it still holds the copied value`（S7 单元版）
- `clipboard is kept when the user copied something else`
- `confirm with the right password resolves confirmed and keeps the lock state`
- `confirm with a wrong password counts a failure`（与解锁共用计数）
- `reject resolves cancelled and expiry resolves expired`（假计时器）
- `a request id works only once`

提交 `WP-06: clipboard guard and confirm requests`。

### 步骤 12：IPC 与 preload

按 3.2 实现。新建 `tests/vault-ipc.test.mjs`（用假的 `ipcMain`：记录 `handle(channel, fn)`，再用假事件 `{ sender: { id } }` 调用）：

- `every documented vault channel is registered`（与 11 第 2 节里 WP-06 的函数一一对应）
- `calls from other windows are forbidden`（S5：`sender.id` 不是密钥库窗口 → `E_FORBIDDEN`，且服务方法没有被调用）
- `invalid arguments are rejected before reaching the service`
- `preload exposes exactly the documented functions`（读取 `electron/preload/vault.cjs` 源码，断言暴露的函数名集合与 11 第 2 节 WP-06 部分一致）

提交 `WP-06: vault ipc and preload`。

### 步骤 13：快照包含密钥库

按 3.3 实现；在 `tests/desktop-snapshots.test.mjs` 追加：

- `snapshots include the encrypted vault when it exists`（`includesVault === true`；快照里的 `vault.db` 用原密码能解锁）

提交 `WP-06: snapshots include vault.db`。

### 步骤 14：明文扫描工具

按 3.4 实现。新建 `tests/scan-plaintext.test.mjs`：

- `finds utf8 and utf16le markers and exits with 1`
- `finds markers across chunk boundaries`（标记正好跨越 1 MiB 边界）
- `scans inside zip entries`（用 yazl 造一个 DEFLATE 压缩的 zip）
- `exits with 0 when nothing is found`

提交 `WP-06: plaintext scanner`。

### 步骤 15：完整流程明文扫描

新建 `tests/vault-plaintext.test.mjs`（**正式 KDF 参数**；真实的 `vaultStore`；临时数据目录里同时放一个 `logs\` 并让服务的 logger 写进去）：

- `no marker reaches the disk after a full session`（S1 + AC-06-14：创建 → 确认恢复密钥 → 7 种条目各一个（`vaultItemInputs`）→ 修改其中 3 个的敏感字段 → 删除 1 个 → 改主密码 → 确认新恢复密钥 → 上锁 → `closeDatabase()` → 用 `tools/scan-plaintext.mjs` 扫描整个临时数据目录，退出码 0；标记文件里包含全部标记、新旧主密码和两把恢复密钥的文本）

提交 `WP-06: full session plaintext scan`。

### 步骤 16：收尾【停止点】

1. `node docs/blueprint/tools/run-logged.mjs .qa/WP-06/npm-test.log npm test`；报告第 3 节写出 `WP06_KDF_MS` 的实测值。
2. 填完报告；第 0 节全部“完成”；提交 `WP-06: complete report`。
3. `node docs/blueprint/tools/wp-check.mjs WP-06 --desktop`，退出码 0 或 2 → 停止。

## 6. 验收标准

| 编号 | 标准 | 证据 |
| --- | --- | --- |
| AC-06-1 | S11：Argon2id、HKDF、AES-GCM 已知答案一致；与 `crypto.argon2Sync` 交叉验证一致（不可用时输出写明） | `tests/vault-crypto.test.mjs` |
| AC-06-2 | S12：TOTP 18 个已知值一致；`otpauth://` 解析覆盖各参数与缺省值 | `tests/vault-totp.test.mjs` |
| AC-06-3 | 创建 → 上锁 → 解锁：条目逐字段一致；头部字段名与 03 第 5 节一致；`kdf` 为正式值 | `tests/vault-service.test.mjs`「create lock unlock round trip…」 |
| AC-06-4 | S1：完整流程后扫描数据目录（含 `vault.db`、`-wal`、`logs\`）命中 0 | `tests/vault-plaintext.test.mjs` |
| AC-06-5 | S2、S3、S4 结果符合 03 第 8 节；其他条目不受影响 | `tests/vault-service.test.mjs` |
| AC-06-6 | S5：非密钥库窗口的调用返回 `E_FORBIDDEN`；参数不合法返回 `E_INVALID_ARGUMENT`；preload 只暴露规定的函数 | `tests/vault-ipc.test.mjs` |
| AC-06-7 | S8：第 5、6、7、10 次失败后的等待时间正确；等待期内不调用 KDF；重启后节流仍在 | 「throttling follows the formula…」 |
| AC-06-8 | S9、S10、S16：恢复密钥三种情况、改密码后的轮换、旧包裹无法解密新条目、轮换失败时原样不变 | `tests/vault-service.test.mjs` |
| AC-06-9 | 恢复密钥：两个已知答案、1000 次往返、单字符改动检出率 ≥ 99%、O/I/L 纠正、补位比特检查 | `tests/vault-recovery-key.test.mjs` |
| AC-06-10 | 主密码规则 4 条的边界与强度已知答案 | `tests/vault-password-policy.test.mjs` |
| AC-06-11 | S6、S7（假时钟/假剪贴板）：闲置与系统闲置都会上锁、DEK 清零；剪贴板到时清除、被覆盖则不清除 | `tests/vault-service.test.mjs`、`tests/vault-clipboard-confirm.test.mjs` |
| AC-06-12 | Argon2id 在 worker 中执行：主线程最大延迟 < 100 ms；正式参数耗时 < 2 秒（报告写实测值） | 「argon2id runs in a worker…」 |
| AC-06-13 | 条目密文长度都是 `28 + 512 × k` | `tests/vault-item-codec.test.mjs` |
| AC-06-14 | 日志里没有任何条目内容、密码、恢复密钥 | `tests/vault-plaintext.test.mjs`（扫描包含 `logs\`） |
| AC-06-15 | 密钥库回收站 30 天清理；历史每字段最多 10 条 | `tests/vault-service.test.mjs` |
| AC-06-16 | 确认请求：正确/错误密码、取消、过期、一次性 | `tests/vault-clipboard-confirm.test.mjs` |
| AC-06-17 | 恢复密钥未确认时条目接口返回 `E_LOCKED`（`recovery-unconfirmed`）；重启后必须重新生成 | `tests/vault-service.test.mjs` |
| AC-06-18 | 重置：旧 `vault.db` 进入 `vault-reset` 快照且仍可用旧密码打开 | 「reset moves the vault into a snapshot…」 |
| AC-06-19 | 快照包含加密的 `vault.db` | `tests/desktop-snapshots.test.mjs`「snapshots include the encrypted vault…」 |
| AC-06-20 | 明文扫描工具支持 UTF-8/UTF-16LE、跨块、zip 条目 | `tests/scan-plaintext.test.mjs` |
| AC-06-21 | G1–G9 | `.qa/WP-06/wp-check.md` |

## 7. 卡点处理

| 情况 | 做法 |
| --- | --- |
| 已知答案对不上 | 不要改测试里的期望值。逐项检查：盐是不是按 ASCII 字节、密码是否做了 NFKC、输出长度是否 32、HKDF 的 `info` 是否逐字一致 |
| worker 里 `import "hash-wasm"` 失败 | 确认 worker 文件是 ESM（`.js` 且 `package.json` 有 `"type": "module"`），用 `new URL("./kdfWorker.js", import.meta.url)` 创建 |
| 正式参数单元测试太慢 | 只有 3 个用例必须用正式参数（第 3 节说明）；其他用例用注入的 8192 KiB |
| 单字符改动检出率略低于 99% | 2 字节校验的理论漏检率约 1/65536；如果低于 99%，说明解析时没有校验补位比特或校验位计算错了 |
| 不确定某个错误该用哪个错误码 | 用 03 和 11 写明的；没写明的写进报告第 5 节，选最接近的一个 |
