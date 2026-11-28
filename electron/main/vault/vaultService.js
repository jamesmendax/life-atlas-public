import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes as secureRandomBytes, randomInt as secureRandomInt, timingSafeEqual } from "node:crypto";
import { KDF_PARAMS, deriveKeyArgon2id, hkdfRecoveryKek, aesGcmEncrypt, aesGcmDecrypt, aadPasswordWrap, aadRecoveryWrap } from "./crypto.js";
import { formatRecoveryKey, generateRecoveryKey, lastTwoGroups, normalizeRecoveryText, parseRecoveryKey } from "./recoveryKey.js";
import { checkMasterPassword, loadCommonPasswords } from "./passwordPolicy.js";
import { generatePassword as makePassword } from "./passwordGenerator.js";
import { parseTotpSecret, totpCode } from "./totp.js";
import { openItem, sealItem } from "./itemCodec.js";
import * as store from "./vaultStore.js";
import { VaultError, invalidArgument } from "./errors.js";
import { createClipboardGuard } from "./clipboardGuard.js";
import {
  DEFAULT_SETTINGS, applyItemPatch, attachmentMetadata, derivedItemSite, findExpiryField, maskedItem, summarizeItem, validateAttachmentDraftId,
  validateAttachmentId, validateCredentialId, validateCredentialInput, validateCredentialPatch, validateId, validateItemCredentials,
  validateItemInput, validateItemPatch, validateSettingsPatch, validateSiteMergeArguments, validateString,
} from "./itemModel.js";
import { browserCsvPreview, mapBrowserRows, parseCsv } from "./browserCsv.js";
import { decodePasswordBoxBackup } from "./legacyPasswordBox.js";
import {
  credentialDedupeIdentity, credentialFields, credentialSourceFingerprints, passwordBoxDedupeIdentity, passwordBoxFingerprint, passwordBoxItem,
} from "./passwordBoxItems.js";
import { attachmentReferences, mergeCredentialItems, promoteCredentials, removeCredentialFromItem, splitCredentialItem } from "./credentialTransfers.js";
import { normalizeSiteIdentity } from "./siteKey.js";
import { assertPhysicalPath } from "../storage/dataRoot.js";
import { getMainLocale, tMain } from "../i18n/index.js";
import { MAX_ATTACHED_VAULT_BLOB_BYTES, MAX_ATTACHMENT_BYTES, MAX_ITEM_ATTACHMENT_BYTES, MAX_ITEM_ATTACHMENTS, readAttachmentFile, resolveAttachmentCopyPath, writeAttachmentCopy } from "./attachmentFiles.js";

const describeVaultSetting = {
  autoLockMinutes: (minutes) => tMain("闲置 {minutes} 分钟后自动上锁", { minutes }),
  clipboardClearSeconds: (seconds) => tMain("复制后 {seconds} 秒清除剪贴板", { seconds }),
  lockOnMinimize: (value) => tMain(value ? "开启最小化时上锁" : "关闭最小化时上锁"),
  verifyBeforeReveal: (value) => tMain(value ? "开启查看敏感内容前的主密码验证" : "关闭查看敏感内容前的主密码验证"),
};

const MAX_PASSWORDBOX_BACKUP_BYTES = 64 * 1024 * 1024;

function validateItemAttachments(attachments = []) {
  if (attachments.length > MAX_ITEM_ATTACHMENTS) invalidArgument("每条密钥最多保存 32 个备注附件");
  if (attachments.reduce((sum, file) => sum + file.size, 0) > MAX_ITEM_ATTACHMENT_BYTES) invalidArgument("每条密钥的备注附件合计最多 16 MiB");
}

function keepField({ id, label, kind, sensitive }) {
  return { id, label, kind, sensitive, keepValue: true };
}

function sensitiveFieldsChanged(before, after) {
  const original = new Map(before.filter((field) => field.sensitive).map((field) => [field.id, field.value]));
  const current = after.filter((field) => field.sensitive);
  return original.size !== current.length || current.some(({ id, value }) => original.get(id) !== value);
}

function fingerprintKey(fingerprint, identity) {
  return JSON.stringify([fingerprint, identity.key]);
}

function credentialIndex() {
  const liveKeys = new Set();
  const sourceKeys = new Set();
  return {
    add(item, credential) {
      const identity = credentialDedupeIdentity(item, credential);
      if (identity.hasSecret) liveKeys.add(identity.key);
      for (const fingerprint of credentialSourceFingerprints(item, credential)) sourceKeys.add(fingerprintKey(fingerprint, identity));
    },
    has(identity, fingerprints) {
      return (identity.hasSecret && liveKeys.has(identity.key)) ||
        fingerprints.some((fingerprint) => sourceKeys.has(fingerprintKey(fingerprint, identity)));
    },
  };
}

function isDuplicateCredential(target, source, credential) {
  const index = credentialIndex();
  for (const slot of target.credentials ?? [null]) index.add(target, slot);
  return index.has(credentialDedupeIdentity(source, credential), credentialSourceFingerprints(source, credential));
}

async function readPasswordBoxBackup(filename) {
  const source = assertPhysicalPath(filename, { allowMissing: false });
  const handle = await fs.promises.open(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const initial = await handle.stat();
    if (!initial.isFile() || initial.size < 1 || initial.size > MAX_PASSWORDBOX_BACKUP_BYTES) {
      invalidArgument("请选择小于 64 MiB 的 PasswordBox 加密备份");
    }
    const bytes = Buffer.alloc(initial.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) invalidArgument("读取时备份文件发生变化，请重试");
      offset += bytesRead;
    }
    const final = await handle.stat();
    if (final.size !== initial.size || final.mtimeMs !== initial.mtimeMs) invalidArgument("读取时备份文件发生变化，请重试");
    return bytes.toString("utf8").replace(/^\uFEFF/, "");
  } finally {
    await handle.close();
  }
}

function decodeBase64(value, length) {
  if (typeof value !== "string" || value.length > 8192) throw new Error("invalid encoding");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value || (length && bytes.length !== length)) throw new Error("invalid encoding");
  return bytes;
}

function checkedHeader(header) {
  if (header?.kind !== "life-atlas-vault" || header.formatVersion !== store.VAULT_FORMAT_VERSION || header.padding !== 512 || typeof header.vaultId !== "string" || header.vaultId.length > 100) throw new Error("invalid vault header");
  const kdf = header.kdf;
  if (kdf?.alg !== "argon2id" || kdf.version !== 19 || !Number.isInteger(kdf.memoryKiB) || kdf.memoryKiB < 8192 || kdf.memoryKiB > 131072 || !Number.isInteger(kdf.iterations) || kdf.iterations < 1 || kdf.iterations > 10 || !Number.isInteger(kdf.parallelism) || kdf.parallelism < 1 || kdf.parallelism > 4) throw new Error("invalid vault kdf");
  decodeBase64(kdf.saltB64, 16);
  if (header.wraps?.password?.alg !== "A256GCM" || header.wraps?.recovery?.alg !== "A256GCM" || header.wraps.recovery.kdf !== "hkdf-sha256") throw new Error("invalid vault wraps");
  decodeBase64(header.wraps.password.blobB64, 60);
  decodeBase64(header.wraps.recovery.blobB64, 60);
  decodeBase64(header.wraps.recovery.saltB64, 16);
  return header;
}

export function validateVaultHeader(header) {
  try {
    checkedHeader(header);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(header.vaultId) || typeof header.createdAt !== "string" || !Number.isFinite(Date.parse(header.createdAt))) return false;
    return Object.entries(KDF_PARAMS).every(([key, value]) => header.kdf[key] === value);
  } catch { return false; }
}

export function createVaultService({
  dataRoot, clock = Date, timers = globalThis, randomBytes = secureRandomBytes, randomInt = secureRandomInt,
  deriveKey = deriveKeyArgon2id, clipboard = { readText: () => "", writeText: () => {}, clear: () => {} }, createClipboardItem,
  getSystemIdleSeconds = () => 0, logger, commonPasswords, kdfParams = KDF_PARAMS, autoLockCheckMs = 15000,
  injectFailure, dialogs, openExternal, requestConfirmation, autoLockMs, clipboardClearMs, appVersion = "0.0.0",
}) {
  if (typeof dataRoot !== "string" || !path.isAbsolute(dataRoot)) invalidArgument("数据目录必须是绝对路径");
  const file = path.join(dataRoot, "vault.db");
  const common = commonPasswords || loadCommonPasswords(fs.readFileSync(new URL("./commonPasswords.txt", import.meta.url), "utf8"));
  const lockedListeners = new Set();
  const statusListeners = new Set();
  const settingsListeners = new Set();
  const imports = new Map();
  const guard = createClipboardGuard({ clipboard, createClipboardItem, timers, clearAfterMs: clipboardClearMs ?? DEFAULT_SETTINGS.clipboardClearSeconds * 1000, logger: log });
  const openExistingDatabase = () => fs.existsSync(file) ? store.openVaultDatabase(file, { checkHeader: checkedHeader }) : null;
  let db = openExistingDatabase();
  let dek = null;
  let pendingRecovery = null;
  let summaries = new Map();
  let lastActivity = 0;
  let idleTimer = null;
  let epoch = 0;
  let authTail = Promise.resolve();
  let attachmentDraft = null;
  let pickingAttachments = false;

  const now = () => Number(typeof clock?.now === "function" ? clock.now() : clock());
  const timestamp = () => new Date(now()).toISOString();
  const header = () => db ? store.readHeader(db) : null;
  const settings = () => db ? { ...DEFAULT_SETTINGS, ...JSON.parse(store.getState(db, "settings") || "{}") } : { ...DEFAULT_SETTINGS };
  const recoveryConfirmed = () => db && store.getState(db, "recoveryConfirmed") === "true";
  const exists = () => Boolean(header());
  const retryAfter = () => Math.max(0, Date.parse(db ? store.getState(db, "lockoutUntil") || "" : "") - now()) || 0;
  const fieldId = () => `f_${randomBytes(4).toString("hex")}`;
  const newCredentialId = () => `vc_${randomBytes(12).toString("hex")}`;
  const newAttachmentId = () => `va_${randomBytes(16).toString("hex")}`;
  const newItemId = () => `vi_${randomBytes(16).toString("hex")}`;

  function uniqueFieldIds(item) {
    const used = new Set([
      ...(item?.fields ?? []).map(({ id }) => id),
      ...(item?.history ?? []).map(({ fieldId: id }) => id),
    ]);
    return () => {
      let id;
      do { id = fieldId(); } while (used.has(id));
      used.add(id);
      return id;
    };
  }

  function newFields(fields, createFieldId) {
    return fields.map((field) => ({
      ...field,
      id: createFieldId(),
      sensitive: field.sensitive || field.kind === "secret" || field.kind === "totp",
    }));
  }

  function log(event, details = {}) {
    try {
      if (typeof logger === "function") logger(event, details);
      else logger?.info?.(event, details);
    } catch {}
  }

  function status() {
    return { exists: exists(), locked: !dek, recoveryConfirmed: Boolean(recoveryConfirmed()), retryAfterMs: retryAfter() || null, settings: settings() };
  }

  function emitStatus() {
    const current = status();
    for (const callback of statusListeners) callback({ exists: current.exists, locked: current.locked });
  }

  function assertUnlocked(allowUnconfirmed = false) {
    if (!dek) throw new VaultError("E_LOCKED", "locked", { reason: "locked" });
    if (!allowUnconfirmed && !recoveryConfirmed()) throw new VaultError("E_LOCKED", "recovery-unconfirmed", { reason: "recovery-unconfirmed" });
  }

  function checkEpoch(expected) {
    if (expected !== epoch || !db) throw new VaultError("E_LOCKED", "locked");
  }

  function checkThrottle() {
    const retryAfterMs = retryAfter();
    if (retryAfterMs) throw new VaultError("E_THROTTLED", "请稍后再试", { retryAfterMs });
  }

  function passwordFailure() {
    const failures = Number(store.getState(db, "failedAttempts") || "0") + 1;
    store.inTransaction(db, () => {
      store.setState(db, "failedAttempts", failures);
      store.setState(db, "lockoutUntil", failures >= 5 ? new Date(now() + Math.min(30000 * 2 ** Math.min(failures - 5, 30), 900000)).toISOString() : "");
    });
    log("vault.unlock.failed", { failedAttempts: failures });
    emitStatus();
  }

  function passwordSuccess() {
    store.inTransaction(db, () => { store.setState(db, "failedAttempts", 0); store.setState(db, "lockoutUntil", ""); });
  }

  function serialAuth(operation) {
    const result = authTail.then(operation);
    authTail = result.catch(() => {});
    return result;
  }

  async function unwrapPassword(password, expected) {
    validateString(password, 4096);
    checkThrottle();
    const current = header();
    if (!current) throw new VaultError("E_NOT_FOUND", "尚未创建密钥库");
    let kek;
    try {
      checkedHeader(current);
      kek = await deriveKey(password.normalize("NFKC"), decodeBase64(current.kdf.saltB64, 16), current.kdf);
      checkEpoch(expected);
      return aesGcmDecrypt(kek, decodeBase64(current.wraps.password.blobB64, 60), aadPasswordWrap(current.vaultId, current.kdf));
    } catch (error) {
      if (error instanceof VaultError && ["E_LOCKED", "E_IO", "E_THROTTLED", "E_NOT_FOUND"].includes(error.code)) throw error;
      checkEpoch(expected);
      passwordFailure();
      throw new VaultError("E_BAD_PASSWORD", "密码错误或密钥库文件已被修改");
    } finally { kek?.fill(0); }
  }

  function assertPasswordPolicy(password) {
    validateString(password, 4096);
    const policy = checkMasterPassword(password, common);
    if (!policy.ok) {
      const ruleLabels = { length: "至少 12 个字符", distinct: "至少 5 种不同字符", common: "不能使用常见密码", pattern: "不能使用重复或连续字符" };
      const rules = getMainLocale().startsWith("zh-")
        ? policy.failures.join(",")
        : policy.failures.map((rule) => tMain(ruleLabels[rule] ?? rule)).join(tMain("；"));
      invalidArgument(tMain("主密码不符合规则：{rules}", { rules }));
    }
  }

  async function makeHeader(password, vaultId, createdAt, nextDek, recovery) {
    const salt = randomBytes(16);
    const recoverySalt = randomBytes(16);
    let passwordKek;
    let recoveryKek;
    try {
      passwordKek = await deriveKey(password.normalize("NFKC"), salt, kdfParams);
      recoveryKek = hkdfRecoveryKek(recovery.bytes, recoverySalt);
      return {
        kind: "life-atlas-vault", formatVersion: store.VAULT_FORMAT_VERSION, vaultId, createdAt,
        kdf: { ...kdfParams, saltB64: salt.toString("base64") },
        wraps: {
          password: { alg: "A256GCM", blobB64: aesGcmEncrypt(passwordKek, nextDek, aadPasswordWrap(vaultId, kdfParams)).toString("base64") },
          recovery: { alg: "A256GCM", kdf: "hkdf-sha256", saltB64: recoverySalt.toString("base64"), blobB64: aesGcmEncrypt(recoveryKek, nextDek, aadRecoveryWrap(vaultId)).toString("base64") },
        }, padding: 512,
      };
    } finally { passwordKek?.fill(0); recoveryKek?.fill(0); }
  }

  function clearImports() {
    for (const pending of imports.values()) {
      timers.clearTimeout(pending.timeout);
      pending.rows.length = 0;
    }
    imports.clear();
  }

  function clearAttachmentDraft() {
    for (const file of attachmentDraft?.files ?? []) file.blob.fill(0);
    attachmentDraft = null;
  }

  function lock(reason = "manual") {
    epoch += 1;
    dek?.fill(0); dek = null;
    pendingRecovery?.fill(0); pendingRecovery = null;
    summaries.clear();
    clearImports();
    clearAttachmentDraft();
    if (idleTimer !== null) timers.clearInterval(idleTimer);
    idleTimer = null;
    const cleanup = guard.clearIfOwned().then(() => ({}));
    cleanup.catch(() => { log("vault.clipboard.cleanup.failed", { errorCode: "E_IO" }); });
    log("vault.locked", { reason });
    for (const callback of lockedListeners) callback({ reason });
    emitStatus();
    return cleanup;
  }

  function startIdleTimer() {
    if (idleTimer !== null) timers.clearInterval(idleTimer);
    lastActivity = now();
    idleTimer = timers.setInterval(() => {
      const threshold = autoLockMs ?? settings().autoLockMinutes * 60000;
      if (dek && (now() - lastActivity >= threshold || getSystemIdleSeconds() * 1000 >= threshold)) lock("idle");
    }, autoLockCheckMs);
    idleTimer?.unref?.();
  }

  function fullItem(id) {
    assertUnlocked();
    const blob = store.getItemBlob(db, id);
    if (!blob) throw new VaultError("E_NOT_FOUND", "条目不存在");
    return openItem(dek, header().vaultId, id, blob);
  }

  function activeItem(id) {
    validateId(id);
    const item = fullItem(id);
    if (item.deletedAt) throw new VaultError("E_CONFLICT", "请先将条目从回收站恢复");
    return item;
  }

  function rebuildSummaries() {
    summaries.clear();
    if (!recoveryConfirmed()) return;
    store.inTransaction(db, () => {
      for (const id of store.listItemIds(db)) {
        let item;
        try { item = openItem(dek, header().vaultId, id, store.getItemBlob(db, id)); } catch (error) {
          if (error.code === "E_CORRUPT") { log("vault.item.corrupt", { id }); continue; }
          throw error;
        }
        if (item.deletedAt && Date.parse(item.deletedAt) < now() - 30 * 86400000) store.deleteItemBlob(db, id);
        else summaries.set(id, summarizeItem(item));
      }
    });
  }

  function writeItem(item, enforceBudget = false) {
    validateItemCredentials(item);
    const blob = sealItem(dek, header().vaultId, item);
    if (enforceBudget && store.otherItemBlobBytes(db, item.id) + blob.length > MAX_ATTACHED_VAULT_BLOB_BYTES) {
      invalidArgument("密钥库条目密文总量超过 64 MiB，请先释放空间");
    }
    store.putItemBlob(db, item.id, blob);
    const summary = summarizeItem(item);
    summaries.set(item.id, summary);
    return { summary: structuredClone(summary) };
  }

  // The caller holds the SQLite transaction; publish summaries only after it commits.
  function writeItemSet(changes, removedIds, createdIds) {
    if (!changes.size && !removedIds.length) return new Map();
    const vaultId = header().vaultId;
    const replacements = [...changes.values()].map((item) => {
      validateItemCredentials(item);
      validateItemAttachments(item.attachments);
      return { item, blob: sealItem(dek, vaultId, item), summary: summarizeItem(item) };
    });
    let totalBytes = store.otherItemBlobBytes(db, "");
    for (const id of [...removedIds, ...changes.keys()]) {
      if (!createdIds.has(id)) totalBytes -= store.getItemBlob(db, id)?.length ?? 0;
    }
    for (const { blob } of replacements) totalBytes += blob.length;
    if (totalBytes > MAX_ATTACHED_VAULT_BLOB_BYTES) invalidArgument("密钥库条目密文总量超过 64 MiB");
    for (const id of removedIds) store.deleteItemBlob(db, id);
    for (const { item, blob } of replacements) {
      if (createdIds.has(item.id)) store.insertItemBlob(db, item.id, blob);
      else store.putItemBlob(db, item.id, blob);
    }
    return new Map(replacements.map(({ item, summary }) => [item.id, summary]));
  }

  function publishItemSet(changed, removedIds = []) {
    for (const id of removedIds) summaries.delete(id);
    for (const [id, summary] of changed) summaries.set(id, summary);
  }

  async function create({ password }) {
    assertPasswordPolicy(password);
    const expected = epoch;
    return serialAuth(async () => {
      if (!db) db = openExistingDatabase();
      if (exists()) throw new VaultError("E_CONFLICT", "密钥库已存在");
      if (!db) db = store.openVaultDatabase(file);
      const nextDek = randomBytes(32);
      const recovery = generateRecoveryKey(randomBytes);
      try {
        const uuidBytes = randomBytes(16);
        uuidBytes[6] = (uuidBytes[6] & 15) | 64;
        uuidBytes[8] = (uuidBytes[8] & 63) | 128;
        const hex = uuidBytes.toString("hex");
        const vaultId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        const createdHeader = await makeHeader(password, vaultId, timestamp(), nextDek, recovery);
        checkEpoch(expected);
        store.inTransaction(db, () => {
          store.writeHeader(db, createdHeader);
          store.setState(db, "failedAttempts", 0); store.setState(db, "lockoutUntil", "");
          store.setState(db, "recoveryConfirmed", "false"); store.setState(db, "settings", JSON.stringify(DEFAULT_SETTINGS));
        });
        dek = nextDek; pendingRecovery = recovery.bytes;
        startIdleTimer(); emitStatus(); log("vault.created");
        return { recoveryKey: recovery.formatted };
      } catch (error) {
        nextDek.fill(0); recovery.bytes.fill(0);
        throw error instanceof VaultError ? error : new VaultError("E_IO", "无法创建密钥库");
      }
    });
  }

  function confirmRecoveryKey({ lastTwoGroups: entered }) {
    assertUnlocked(true);
    if (!pendingRecovery) throw new VaultError("E_NOT_FOUND", "需要重新生成恢复密钥");
    const expected = normalizeRecoveryText(lastTwoGroups(formatRecoveryKey(pendingRecovery)));
    const actual = normalizeRecoveryText(entered);
    if (actual.length !== expected.length || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) invalidArgument("和恢复密钥的最后两组不一致");
    store.setState(db, "recoveryConfirmed", "true");
    pendingRecovery.fill(0); pendingRecovery = null;
    rebuildSummaries(); emitStatus();
    return {};
  }

  function unlock({ password }) {
    const expected = epoch;
    return serialAuth(async () => {
      const unlockedDek = await unwrapPassword(password, expected);
      try { checkEpoch(expected); } catch (error) { unlockedDek.fill(0); throw error; }
      clearAttachmentDraft();
      dek?.fill(0); dek = unlockedDek;
      passwordSuccess(); rebuildSummaries(); startIdleTimer(); emitStatus(); log("vault.unlock.ok");
      return { summaries: structuredClone([...summaries.values()]), requiresRecoveryKeyRegeneration: !recoveryConfirmed() };
    });
  }

  function verifyPassword(password) {
    const expected = epoch;
    return serialAuth(async () => {
      try {
        const verifiedDek = await unwrapPassword(password, expected);
        verifiedDek.fill(0);
        passwordSuccess();
        return true;
      } catch (error) {
        if (error.code === "E_BAD_PASSWORD") return false;
        throw error;
      }
    });
  }

  async function rotate(password, oldDek, expected) {
    const oldHeader = header();
    const nextDek = randomBytes(32);
    const recovery = generateRecoveryKey(randomBytes);
    try {
      const nextHeader = await makeHeader(password, oldHeader.vaultId, oldHeader.createdAt, nextDek, recovery);
      checkEpoch(expected);
      const ids = store.listItemIds(db);
      store.inTransaction(db, () => {
        let processed = 0;
        for (const id of ids) {
          const item = openItem(oldDek, oldHeader.vaultId, id, store.getItemBlob(db, id));
          store.putItemBlob(db, id, sealItem(nextDek, oldHeader.vaultId, item));
          processed += 1;
          if (processed === Math.ceil(ids.length / 2)) injectFailure?.("vault-rotate");
        }
        if (!ids.length) injectFailure?.("vault-rotate");
        store.writeHeader(db, nextHeader);
        store.setState(db, "recoveryConfirmed", "false");
        store.setState(db, "failedAttempts", 0); store.setState(db, "lockoutUntil", "");
      });
      clearAttachmentDraft();
      dek?.fill(0); pendingRecovery?.fill(0);
      dek = nextDek; pendingRecovery = recovery.bytes; summaries.clear();
      startIdleTimer(); emitStatus(); log("vault.rotated", { itemCount: ids.length });
      return { recoveryKey: recovery.formatted };
    } catch {
      nextDek.fill(0); recovery.bytes.fill(0);
      throw new VaultError("E_IO", "密钥轮换失败，原密钥库保持不变");
    }
  }

  function changePassword({ currentPassword, newPassword }) {
    assertUnlocked(); assertPasswordPolicy(newPassword);
    const expected = epoch;
    return serialAuth(async () => {
      const verifiedDek = await unwrapPassword(currentPassword, expected);
      try { return await rotate(newPassword, verifiedDek, expected); } finally { verifiedDek.fill(0); }
    });
  }

  function regenerateRecoveryKey({ password }) {
    assertUnlocked(true);
    const expected = epoch;
    return serialAuth(async () => {
      const verifiedDek = await unwrapPassword(password, expected);
      try { return await rotate(password, verifiedDek, expected); } finally { verifiedDek.fill(0); }
    });
  }

  function unlockWithRecoveryKey({ recoveryKey, newPassword }) {
    checkThrottle();
    assertPasswordPolicy(newPassword);
    const bytes = parseRecoveryKey(recoveryKey);
    const expected = epoch;
    return serialAuth(async () => {
      let recoveryKek;
      let verifiedDek;
      try {
        checkThrottle();
        const current = checkedHeader(header());
        recoveryKek = hkdfRecoveryKek(bytes, decodeBase64(current.wraps.recovery.saltB64, 16));
        try { verifiedDek = aesGcmDecrypt(recoveryKek, decodeBase64(current.wraps.recovery.blobB64, 60), aadRecoveryWrap(current.vaultId)); }
        catch { throw new VaultError("E_BAD_PASSWORD", "恢复密钥不属于这个密钥库，或文件已被修改"); }
        checkEpoch(expected);
        return await rotate(newPassword, verifiedDek, expected);
      } finally { bytes.fill(0); recoveryKek?.fill(0); verifiedDek?.fill(0); }
    });
  }

  function createItem({ input }) {
    assertUnlocked(); validateItemInput(input);
    const createdAt = timestamp();
    const item = {
      id: newItemId(), type: input.type, title: input.title, tags: [...(input.tags || [])], favorite: input.favorite ?? false,
      fields: newFields(input.fields, uniqueFieldIds()),
      subtitleFieldId: input.subtitleFieldId ?? null, history: [], expiresAt: input.expiresAt ?? null, deletedAt: null, createdAt, updatedAt: createdAt,
    };
    if (input.site !== undefined) item.site = input.site;
    else if (item.type !== "secureNote") {
      const site = derivedItemSite(item);
      if (site) item.site = site;
    }
    if (item.subtitleFieldId && !item.fields.some((field) => field.id === item.subtitleFieldId && !field.sensitive)) invalidArgument("副标题字段不存在或敏感");
    if (item.type === "apiKey" && input.expiresAt === undefined) {
      const expiry = findExpiryField(item.fields);
      if (expiry?.value) { validateItemPatch({ expiresAt: expiry.value }); item.expiresAt = expiry.value; }
    }
    const result = writeItemAttachmentChanges(item, input.attachmentDraftId); log("vault.item.created", { id: item.id }); return result;
  }

  function updateItem({ id, patch }) {
    assertUnlocked(); validateItemPatch(patch);
    const { attachmentDraftId, removeAttachmentIds, ...itemPatch } = patch;
    const item = fullItem(id);
    if (item.deletedAt && (attachmentDraftId || removeAttachmentIds?.length)) throw new VaultError("E_CONFLICT", "请先恢复条目再编辑备注附件");
    if (item.credentials && itemPatch.fields) {
      const ownedIds = new Set(item.credentials.flatMap(({ fieldIds }) => fieldIds));
      const submittedIds = new Set(itemPatch.fields.map(({ id }) => id));
      itemPatch.fields = [...itemPatch.fields, ...item.fields.filter(({ id }) => ownedIds.has(id) && !submittedIds.has(id)).map(keepField)];
    }
    const next = applyItemPatch(item, itemPatch, { now: timestamp(), createFieldId: uniqueFieldIds(item) });
    if (itemPatch.fields) {
      if (item.credentials) {
        next.credentials = item.credentials.map((credential) => {
          if (!sensitiveFieldsChanged(credentialFields(item, credential), credentialFields(next, credential))) return credential;
          const { sourceFingerprints, ...current } = credential;
          return { ...current, updatedAt: next.updatedAt };
        });
      } else if (item.passwordBoxFingerprint && sensitiveFieldsChanged(item.fields, next.fields)) delete next.passwordBoxFingerprint;
    }
    let safeRemoveIds = removeAttachmentIds;
    if (item.credentials && removeAttachmentIds?.length) {
      const ownedIds = new Set(item.credentials.flatMap(({ fieldIds }) => fieldIds));
      const ownedFields = next.fields.filter(({ id: fid }) => ownedIds.has(fid));
      const protectedRefs = attachmentReferences(ownedFields, next.history);
      safeRemoveIds = removeAttachmentIds.filter((attachment) => !protectedRefs.has(attachment));
    }
    return writeItemAttachmentChanges(next, attachmentDraftId, safeRemoveIds);
  }

  function addCredential({ id, credential }) {
    validateCredentialInput(credential);
    const item = promoteCredentials(activeItem(id), newCredentialId);
    const updatedAt = timestamp();
    const fields = newFields(credential.fields, uniqueFieldIds(item));
    const slot = {
      id: newCredentialId(), label: credential.label, type: credential.type, expiresAt: credential.expiresAt ?? null,
      fieldIds: fields.map(({ id: field }) => field), createdAt: updatedAt, updatedAt,
    };
    const next = { ...item, fields: [...item.fields, ...fields], credentials: [...item.credentials, slot], updatedAt };
    const result = writeItemAttachmentChanges(next, credential.attachmentDraftId, [], true);
    return { ...result, credentialId: slot.id };
  }

  function updateCredential({ id, credentialId, patch }) {
    validateCredentialId(credentialId);
    validateCredentialPatch(patch);
    const item = activeItem(id);
    const slot = item.credentials?.find(({ id: candidate }) => candidate === credentialId);
    if (!slot) throw new VaultError("E_NOT_FOUND", "密钥不存在");
    const ownedIds = new Set(slot.fieldIds);
    const updatedAt = timestamp();
    const { fields, attachmentDraftId, removeAttachmentIds, ...metadata } = patch;
    let next = { ...item, updatedAt };
    let nextSlot = { ...slot, ...metadata, updatedAt };
    if (fields !== undefined) {
      if (fields.some(({ id: field }) => field !== undefined && !ownedIds.has(field))) invalidArgument("字段不属于当前密钥");
      const firstOwned = item.fields.findIndex(({ id: field }) => ownedIds.has(field));
      const insertionPoint = firstOwned < 0 ? item.fields.length : firstOwned;
      const preceding = item.fields.slice(0, insertionPoint).map(keepField);
      const following = item.fields.slice(insertionPoint).filter(({ id: field }) => !ownedIds.has(field)).map(keepField);
      next = applyItemPatch(item, { fields: [...preceding, ...fields, ...following] }, { now: updatedAt, createFieldId: uniqueFieldIds(item) });
      const updatedFields = next.fields.slice(insertionPoint, insertionPoint + fields.length);
      nextSlot = { ...nextSlot, fieldIds: updatedFields.map(({ id: field }) => field) };
      if (sensitiveFieldsChanged(credentialFields(item, slot), updatedFields)) delete nextSlot.sourceFingerprints;
    }
    next.credentials = item.credentials.map((credential) => credential.id === credentialId ? nextSlot : credential);
    const sharedFields = next.fields.filter(({ id: field }) => !nextSlot.fieldIds.includes(field));
    const sharedReferences = removeAttachmentIds?.length ? attachmentReferences(sharedFields, next.history) : new Set();
    return writeItemAttachmentChanges(next, attachmentDraftId, removeAttachmentIds?.filter((attachment) => !sharedReferences.has(attachment)), true);
  }

  function deleteCredential({ id, credentialId }) {
    validateCredentialId(credentialId);
    return writeItem(removeCredentialFromItem(activeItem(id), credentialId, timestamp()), true);
  }

  function mergeSiteItems(args) {
    assertUnlocked();
    validateSiteMergeArguments(args);
    const { targetId, sourceIds } = args;
    const changed = store.inTransaction(db, () => {
      const target = activeItem(targetId);
      let merged = { ...target, site: derivedItemSite(target) };
      const updatedAt = timestamp();
      for (const id of sourceIds) {
        merged = mergeCredentialItems(merged, activeItem(id), {
          newFieldId: fieldId, newCredentialId, newAttachmentId, isDuplicate: isDuplicateCredential, now: updatedAt,
        });
      }
      return writeItemSet(new Map([[targetId, merged]]), sourceIds, new Set());
    });
    publishItemSet(changed, sourceIds);
    return { summary: structuredClone(changed.get(targetId)), mergedItemsCount: sourceIds.length };
  }

  function splitCredential({ id, credentialId }) {
    assertUnlocked();
    validateCredentialId(credentialId);
    const createdId = newItemId();
    const changed = store.inTransaction(db, () => {
      const item = activeItem(id);
      const { remaining, created } = splitCredentialItem({ ...item, site: derivedItemSite(item) }, credentialId, {
        newItemId: createdId, now: timestamp(),
      });
      return writeItemSet(new Map([[id, remaining], [createdId, created]]), [], new Set([createdId]));
    });
    publishItemSet(changed);
    return { summary: structuredClone(changed.get(id)), createdSummary: structuredClone(changed.get(createdId)) };
  }

  function attachmentDraftAad(vaultId, draftId, attachmentId) {
    return Buffer.from(`LA-VAULT-1|attachment-draft|${vaultId}|${draftId}|${attachmentId}`, "utf8");
  }

  function getAttachmentDraft(draftId) {
    validateAttachmentDraftId(draftId);
    if (attachmentDraft?.id !== draftId) throw new VaultError("E_NOT_FOUND", "附件选择已失效，请重新选择文件");
    return attachmentDraft;
  }

  function writeItemAttachmentChanges(item, draftId, removeIds = [], enforceBudget = false) {
    if (!draftId && !removeIds.length) return writeItem(item, enforceBudget);
    const previous = item.attachments ?? [];
    const removed = new Set(removeIds);
    if (removeIds.some((id) => !previous.some((file) => file.id === id))) throw new VaultError("E_NOT_FOUND", "要移除的附件已不存在");
    const kept = previous.filter((file) => !removed.has(file.id));
    const added = draftId ? getAttachmentDraft(draftId).files : [];
    validateItemAttachments([...kept, ...added]);
    const vaultId = header().vaultId;
    const additions = added.map((file) => {
      const bytes = aesGcmDecrypt(dek, file.blob, attachmentDraftAad(vaultId, draftId, file.id));
      try { return { ...attachmentMetadata(file), data: bytes.toString("base64") }; }
      finally { bytes.fill(0); }
    });
    item.attachments = [...kept, ...additions];
    const result = writeItem(item, enforceBudget || additions.length > 0);
    if (draftId) clearAttachmentDraft();
    return result;
  }

  function checkAttachmentSession(expected, key) {
    checkEpoch(expected);
    assertUnlocked();
    if (dek !== key) throw new VaultError("E_LOCKED", "locked");
  }

  function detectSafeImageMime(bytes) {
    if (!bytes || bytes.length < 12) return null;
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38
      && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return "image/gif";
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
    return null;
  }

  async function pickAttachments({ draftId, filter } = {}) {
    assertUnlocked();
    if (pickingAttachments) throw new VaultError("E_CONFLICT", "正在选择备注附件");
    const previous = draftId ? getAttachmentDraft(draftId) : null;
    const expected = epoch;
    const key = dek;
    const checkSession = () => checkAttachmentSession(expected, key);
    const added = [];
    let committed = false;
    pickingAttachments = true;
    try {
      const dialogOptions = filter === "images"
        ? { title: tMain("选择加密图片"), properties: ["openFile", "multiSelections"], filters: [{ name: tMain("图片文件"), extensions: ["png", "jpg", "jpeg", "webp", "gif"] }] }
        : { title: tMain("选择备注附件"), properties: ["openFile", "multiSelections"] };
      const selected = await dialogs?.showOpenDialog(dialogOptions);
      checkSession();
      if (!selected || selected.canceled || !selected.filePaths?.length) return { cancelled: true };
      const existing = previous?.files ?? [];
      if (existing.length + selected.filePaths.length > MAX_ITEM_ATTACHMENTS) invalidArgument("每次编辑最多选择 32 个备注附件");
      const id = previous?.id ?? `vad_${randomBytes(16).toString("hex")}`;
      const vaultId = header().vaultId;
      let remaining = MAX_ITEM_ATTACHMENT_BYTES - existing.reduce((sum, file) => sum + file.size, 0);
      for (const source of selected.filePaths) {
        const { name, bytes } = await readAttachmentFile(source, remaining, checkSession);
        try {
          checkSession();
          const attachmentId = `va_${randomBytes(16).toString("hex")}`;
          added.push({ id: attachmentId, name, size: bytes.length, blob: aesGcmEncrypt(key, bytes, attachmentDraftAad(vaultId, id, attachmentId)) });
          remaining -= bytes.length;
        } finally { bytes.fill(0); }
      }
      if (previous && previous !== attachmentDraft) throw new VaultError("E_NOT_FOUND", "附件选择已失效，请重新选择文件");
      if (!previous) clearAttachmentDraft();
      const files = [...existing, ...added];
      attachmentDraft = { id, files };
      committed = true;
      return { draftId: id, attachments: files.map(attachmentMetadata) };
    } finally {
      pickingAttachments = false;
      if (!committed) for (const file of added) file.blob.fill(0);
    }
  }

  function discardAttachmentDraft({ draftId, attachmentId }) {
    assertUnlocked();
    const draft = getAttachmentDraft(draftId);
    if (attachmentId === undefined) { clearAttachmentDraft(); return {}; }
    validateAttachmentId(attachmentId);
    const file = draft.files.find((entry) => entry.id === attachmentId);
    if (!file) throw new VaultError("E_NOT_FOUND", "附件不存在");
    file.blob.fill(0);
    attachmentDraft = { id: draftId, files: draft.files.filter((entry) => entry.id !== attachmentId) };
    return { attachments: attachmentDraft.files.map(attachmentMetadata) };
  }

  function findAttachment({ id, draftId, attachmentId }) {
    validateAttachmentId(attachmentId);
    if (Boolean(id) === Boolean(draftId)) invalidArgument("请指定已保存条目或草稿附件");
    const files = draftId ? getAttachmentDraft(draftId).files : fullItem(id).attachments;
    const attachment = files?.find((file) => file.id === attachmentId);
    if (!attachment) throw new VaultError("E_NOT_FOUND", "附件不存在");
    return attachment;
  }

  function readAttachmentBytes(source) {
    const attachment = findAttachment(source);
    if (source.draftId) {
      return aesGcmDecrypt(dek, attachment.blob, attachmentDraftAad(header().vaultId, source.draftId, attachment.id));
    }
    if (!Number.isSafeInteger(attachment.size) || attachment.size < 0 || attachment.size > MAX_ATTACHMENT_BYTES
      || typeof attachment.data !== "string" || attachment.data.length !== Math.ceil(attachment.size / 3) * 4) {
      throw new VaultError("E_CORRUPT", "附件内容已损坏");
    }
    const bytes = Buffer.from(attachment.data, "base64");
    if (bytes.length !== attachment.size) {
      bytes.fill(0);
      throw new VaultError("E_CORRUPT", "附件内容已损坏");
    }
    return bytes;
  }

  function readAttachmentPreview(source) {
    assertUnlocked();
    const bytes = readAttachmentBytes(source);
    try {
      const mimeType = detectSafeImageMime(bytes);
      if (!mimeType) return { previewable: false };
      return { previewable: true, mimeType, dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}` };
    } finally {
      bytes.fill(0);
    }
  }

  async function saveAttachmentCopy(source) {
    assertUnlocked();
    const expected = epoch;
    const key = dek;
    await verifyReveal({ title: "保存备注附件副本" });
    checkAttachmentSession(expected, key);
    const { name } = findAttachment(source);
    const result = await dialogs?.showSaveDialog({ title: tMain("保存备注附件的明文副本"), defaultPath: name });
    checkAttachmentSession(expected, key);
    if (!result || result.canceled || !result.filePath) return { cancelled: true };
    const target = resolveAttachmentCopyPath(result.filePath, dataRoot);
    const bytes = readAttachmentBytes(source);
    try {
      writeAttachmentCopy(target, bytes);
      return { saved: true };
    } finally { bytes.fill(0); }
  }

  function setDeleted(id, deletedAt) {
    const item = fullItem(id); item.deletedAt = deletedAt; item.updatedAt = timestamp(); writeItem(item); return {};
  }

  function deleteItemPermanently({ id }) {
    const item = fullItem(id);
    if (!item.deletedAt) throw new VaultError("E_CONFLICT", "请先把条目移到回收站");
    store.deleteItemBlob(db, id); summaries.delete(id); return {};
  }

  function getField(id, requestedFieldId) {
    const field = fullItem(id).fields.find((entry) => entry.id === requestedFieldId);
    if (!field) throw new VaultError("E_NOT_FOUND", "字段不存在");
    return field;
  }

  async function verifyReveal({ title = "显示或复制敏感字段" } = {}) {
    assertUnlocked();
    if (!settings().verifyBeforeReveal) return;
    if (!requestConfirmation) throw new VaultError("E_IO", "主密码确认暂不可用");
    const expected = epoch;
    const result = await requestConfirmation({ kind: "reveal-field", title: tMain(title), description: tMain("请在密钥库窗口再次输入主密码。") });
    checkEpoch(expected); assertUnlocked();
    if (result !== "confirmed") throw new VaultError("E_CANCELLED", "未完成主密码确认");
  }

  async function revealField({ id, fieldId: requestedFieldId }) {
    await verifyReveal(); return { value: getField(id, requestedFieldId).value };
  }

  async function copyValue(value, expected, allowUnconfirmed = false) {
    checkEpoch(expected); assertUnlocked(allowUnconfirmed);
    const result = await guard.copy(value, { clearAfterMs: clipboardClearMs ?? settings().clipboardClearSeconds * 1000 });
    checkEpoch(expected); assertUnlocked(allowUnconfirmed);
    return result;
  }

  async function copyField({ id, fieldId: requestedFieldId }) {
    const expected = epoch;
    await verifyReveal();
    checkEpoch(expected);
    const field = getField(id, requestedFieldId);
    if (field.kind === "totp") {
      const parsed = parseTotpSecret(field.value);
      let code;
      try { code = totpCode(parsed, now() / 1000); }
      finally { parsed.secretBytes.fill(0); }
      return copyValue(code, expected);
    }
    return copyValue(field.value, expected);
  }

  async function openFieldUrl({ id, fieldId: requestedFieldId }) {
    const expected = epoch;
    const field = getField(id, requestedFieldId);
    if (field.kind !== "url") invalidArgument("只能打开网址字段");
    let url;
    try { url = new URL(field.value); } catch { invalidArgument("网址不正确"); }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) invalidArgument("只支持没有凭据的 HTTP 或 HTTPS 网址");
    const answer = await dialogs?.showMessageBox({
      type: "question", title: tMain("在系统浏览器打开"),
      message: tMain("是否打开 {hostname}？", { hostname: url.hostname }),
      buttons: [tMain("打开"), tMain("取消")], defaultId: 1, cancelId: 1,
    });
    checkEpoch(expected); assertUnlocked();
    if (answer?.response !== 0) return { opened: false };
    if (!openExternal) throw new VaultError("E_IO", "系统浏览器不可用");
    await openExternal(url.href); return { opened: true };
  }

  function getTotp({ id, fieldId: requestedFieldId }) {
    const field = getField(id, requestedFieldId);
    if (field.kind !== "totp") invalidArgument("字段不是两步验证");
    const parsed = parseTotpSecret(field.value);
    try {
      const unixSeconds = Math.floor(now() / 1000);
      return { code: totpCode(parsed, unixSeconds), periodSeconds: parsed.period, validForSeconds: parsed.period - unixSeconds % parsed.period };
    } finally { parsed.secretBytes.fill(0); }
  }

  function historyEntries(id, requestedFieldId) {
    return fullItem(id).history.filter((entry) => entry.fieldId === requestedFieldId);
  }

  function getHistory({ id, fieldId: requestedFieldId }) {
    return { entries: historyEntries(id, requestedFieldId).map((entry, index) => ({ index, changedAt: entry.changedAt })).sort((first, second) => second.changedAt.localeCompare(first.changedAt) || second.index - first.index) };
  }

  function selectedHistory(id, requestedFieldId, index) {
    if (!Number.isInteger(index) || index < 0 || index > 9) invalidArgument();
    const entry = historyEntries(id, requestedFieldId)[index];
    if (!entry) throw new VaultError("E_NOT_FOUND", "历史记录不存在");
    return entry;
  }

  async function revealHistory({ id, fieldId: requestedFieldId, index }) {
    await verifyReveal(); return { value: selectedHistory(id, requestedFieldId, index).value };
  }

  async function copyHistory({ id, fieldId: requestedFieldId, index }) {
    const expected = epoch;
    await verifyReveal();
    checkEpoch(expected);
    return copyValue(selectedHistory(id, requestedFieldId, index).value, expected);
  }

  function copyPendingRecoveryKey() {
    assertUnlocked(true);
    if (!pendingRecovery) throw new VaultError("E_NOT_FOUND", "没有待确认的恢复密钥");
    return copyValue(formatRecoveryKey(pendingRecovery), epoch, true);
  }

  function restoreHistory({ id, fieldId: requestedFieldId, index }) {
    const value = selectedHistory(id, requestedFieldId, index).value;
    const item = fullItem(id);
    const existsInCurrent = item.fields.some((field) => field.id === requestedFieldId);
    if (!existsInCurrent) throw new VaultError("E_NOT_FOUND", "字段已经删除，无法恢复为当前值");
    const fields = item.fields.map((field) => field.id === requestedFieldId ? { ...field, value } : { ...field, keepValue: true });
    for (const field of fields) if (field.keepValue) delete field.value;
    return updateItem({ id, patch: { fields } });
  }

  function securityReport() {
    assertUnlocked();
    const weak = new Set(); const stale = new Set(); const noTotp = new Set(); const values = new Map();
    for (const id of store.listItemIds(db)) {
      let item;
      try { item = fullItem(id); } catch (error) { if (error.code === "E_CORRUPT") continue; throw error; }
      if (item.deletedAt) continue;
      for (const credential of item.credentials ?? [null]) {
        const fields = credentialFields(item, credential);
        const secrets = fields.filter((field) => field.kind === "secret");
        for (const value of new Set(secrets.map((field) => field.value).filter((value) => value !== ""))) {
          const signature = createHash("sha256").update(value, "utf16le").digest("hex");
          if (!values.has(signature)) values.set(signature, []);
          values.get(signature).push(id);
        }
        if ((credential?.type ?? item.type) !== "login") continue;
        const password = secrets[0];
        if (!checkMasterPassword(password?.value ?? "", common).ok) weak.add(id);
        const lastChange = item.history.filter((entry) => entry.fieldId === password?.id).map((entry) => entry.changedAt).sort().at(-1) ||
          credential?.createdAt || item.createdAt;
        if (Date.parse(lastChange) < now() - 365 * 86400000) stale.add(id);
        if (!fields.some((field) => field.kind === "totp" && field.value)) noTotp.add(id);
      }
    }
    return { weak: [...weak], reused: [...values.values()].filter((group) => group.length >= 2), stale: [...stale], noTotp: [...noTotp] };
  }

  async function saveRecoveryKit() {
    assertUnlocked(true);
    if (!pendingRecovery) throw new VaultError("E_NOT_FOUND", "没有待保存的恢复密钥");
    const expected = epoch;
    const result = await dialogs?.showSaveDialog({ title: tMain("保存恢复卡"), defaultPath: tMain("Life-Atlas-恢复卡.html"), filters: [{ name: tMain("HTML 恢复卡"), extensions: ["html"] }] });
    if (!result || result.canceled || !result.filePath) return { cancelled: true };
    checkEpoch(expected);
    const target = path.resolve(result.filePath);
    const relative = path.relative(path.resolve(dataRoot), target);
    const parent = fs.realpathSync(path.dirname(target));
    const realTarget = path.join(parent, path.basename(target));
    const realRelative = path.relative(fs.realpathSync(dataRoot), realTarget);
    if ((!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)) || (!realRelative.startsWith(`..${path.sep}`) && realRelative !== ".." && !path.isAbsolute(realRelative)) || /OneDrive|Dropbox|Google Drive|iCloud|坚果云/i.test(`${target}|${realTarget}`)) invalidArgument("恢复卡不要放在这台电脑的数据目录或同步盘里，建议打印或存到 U 盘");
    const destination = fs.lstatSync(realTarget, { throwIfNoEntry: false });
    if (destination && (!destination.isFile() || destination.isSymbolicLink() || destination.nlink > 1)) invalidArgument("恢复卡不能保存到链接文件，请选择普通文件或新文件名");
    const escape = (text) => String(text).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
    const formatted = formatRecoveryKey(pendingRecovery);
    const current = header();
    const translated = (source, params) => escape(tMain(source, params));
    const html = `<!doctype html><html lang="${escape(getMainLocale())}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${translated("Life Atlas 恢复卡")}</title>`
      + "<style>body{font:16px/1.6 sans-serif;max-width:760px;margin:48px auto;padding:24px}pre{font:24px/1.8 monospace;white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{margin:0}}</style>"
      + `<h1>${translated("Life Atlas 密钥库恢复卡")}</h1><pre>${escape(formatted)}</pre>`
      + `<p>${translated("创建日期：{date}", { date: current.createdAt })}<br>${translated("密钥库：{vault}", { vault: current.vaultId.slice(0, 8) })}</p>`
      + `<h2>${translated("请离线保存")}</h2>`
      + `<p>${translated("忘记主密码时，在 Life Atlas 密钥库锁屏选择“使用恢复密钥”，输入本卡密钥并设置新主密码。每次修改主密码或重新生成恢复密钥后，本卡失效，请保存新的恢复卡。")}</p>`
      + `<p>${translated("建议打印或存到 U 盘；不要放在这台电脑的数据目录或同步盘。拥有此卡的人可以解开密钥库。")}</p></html>`;
    fs.writeFileSync(realTarget, html, { encoding: "utf8", mode: 0o600 });
    return { filePath: target };
  }

  async function importBrowserCsv() {
    assertUnlocked();
    const expected = epoch;
    const result = await dialogs?.showOpenDialog({ title: tMain("从浏览器导入密码"), properties: ["openFile"], filters: [{ name: tMain("浏览器密码 CSV"), extensions: ["csv"] }] });
    if (!result || result.canceled || !result.filePaths?.length) return { cancelled: true };
    checkEpoch(expected); assertUnlocked();
    const source = fs.realpathSync(result.filePaths[0]);
    if (fs.statSync(source).size > 64 * 1024 * 1024) invalidArgument("CSV 文件过大");
    const rows = mapBrowserRows(parseCsv(fs.readFileSync(source, "utf8")));
    const importId = `import_${randomBytes(16).toString("hex")}`;
    const timeout = timers.setTimeout(() => { const pending = imports.get(importId); if (pending) pending.rows.length = 0; imports.delete(importId); }, 600000);
    timeout?.unref?.();
    imports.set(importId, { source, rows, timeout });
    return { importId, total: rows.length, preview: browserCsvPreview(rows) };
  }

  async function importPasswordBoxBackup({ password }) {
    assertUnlocked();
    validateString(password, 4096, 1);
    const expected = epoch;
    const key = dek;
    const result = await dialogs?.showOpenDialog({
      title: tMain("选择 PasswordBox 加密备份"),
      properties: ["openFile"],
      filters: [{ name: tMain("PasswordBox 加密备份"), extensions: ["json"] }],
    });
    if (!result || result.canceled || !result.filePaths?.length) return { cancelled: true };
    checkAttachmentSession(expected, key);
    let backup;
    try {
      backup = await readPasswordBoxBackup(result.filePaths[0]);
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new VaultError("E_IO", "无法读取所选备份");
    }
    checkAttachmentSession(expected, key);
    let entries;
    try {
      ({ entries } = await decodePasswordBoxBackup(backup, password));
    } catch {
      throw new VaultError("E_INVALID_ARGUMENT", "无法解开旧保险箱。请核对旧主密码和备份文件。");
    } finally {
      password = null;
    }
    try {
      checkAttachmentSession(expected, key);
      const timestampAtImport = timestamp();
      let createdCount = 0;
      let mergedCount = 0;
      let duplicateCount = 0;
      const changed = store.inTransaction(db, () => {
        const index = credentialIndex();
        const siteTargets = new Map();
        const staged = new Map();
        const createdIds = new Set();
        for (const id of store.listItemIds(db)) {
          const existing = fullItem(id);
          if (existing.deletedAt) continue;
          const siteKey = derivedItemSite(existing)?.siteKey;
          if (siteKey && !siteTargets.has(siteKey)) siteTargets.set(siteKey, id);
          for (const credential of existing.credentials ?? [null]) index.add(existing, credential);
        }
        for (const entry of entries) {
          const fingerprint = passwordBoxFingerprint(entry);
          const site = normalizeSiteIdentity(entry);
          if (index.has(passwordBoxDedupeIdentity(entry, site), [fingerprint])) {
            duplicateCount += 1;
            continue;
          }
          const item = passwordBoxItem(entry, {
            id: newItemId(),
            newFieldId: uniqueFieldIds(),
            newCredentialId,
            newAttachmentId,
            detectImageMime: detectSafeImageMime,
            timestamp: timestampAtImport,
            fingerprint,
            site,
          });
          const targetId = site && siteTargets.get(site.siteKey);
          if (targetId) {
            const target = staged.get(targetId) ?? activeItem(targetId);
            const merged = mergeCredentialItems({ ...target, site: derivedItemSite(target) }, item, {
              newFieldId: fieldId, newCredentialId, newAttachmentId, now: timestampAtImport, dedupeAttachmentBytes: true,
            });
            staged.set(targetId, merged);
            mergedCount += 1;
          } else {
            staged.set(item.id, item);
            createdIds.add(item.id);
            if (site) siteTargets.set(site.siteKey, item.id);
            createdCount += 1;
          }
          index.add(item, item.credentials[0]);
        }
        return writeItemSet(staged, [], createdIds);
      });
      publishItemSet(changed);
      return { total: entries.length, importedCount: createdCount + mergedCount, createdCount, mergedCount, duplicateCount };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new VaultError("E_IO", "旧保险箱导入失败，未写入任何条目");
    } finally {
      entries.length = 0;
    }
  }

  async function commitBrowserCsvImport({ importId, rowIndexes, deleteSourceFile = false }) {
    assertUnlocked();
    const pending = imports.get(importId);
    if (!pending) throw new VaultError("E_NOT_FOUND", "导入预览已过期或已完成");
    if (!Array.isArray(rowIndexes) || rowIndexes.some((index) => !Number.isInteger(index) || index < 0 || index >= pending.rows.length) || new Set(rowIndexes).size !== rowIndexes.length || typeof deleteSourceFile !== "boolean") invalidArgument();
    const inputRows = rowIndexes.map((index) => pending.rows[index]);
    const inputs = inputRows.map((row) => ({ type: "login", title: row.name, tags: ["导入"], favorite: false, subtitleFieldId: null, expiresAt: null, fields: [
      { label: "网址", kind: "url", value: row.url, sensitive: false }, { label: "用户名", kind: "text", value: row.username, sensitive: false },
      { label: "密码", kind: "secret", value: row.password, sensitive: true }, { label: "备注", kind: "multiline", value: row.note, sensitive: false },
    ] }));
    inputs.forEach(validateItemInput);
    const before = new Map(summaries);
    try {
      store.inTransaction(db, () => { for (const input of inputs) createItem({ input }); });
    } catch (error) { summaries = before; throw error instanceof VaultError ? error : new VaultError("E_IO", "密码导入失败，密钥库保持不变"); }
    imports.delete(importId); timers.clearTimeout(pending.timeout);
    const expected = epoch;
    let deletedSourceFile = false;
    try {
      if (deleteSourceFile) {
        const response = await dialogs?.showMessageBox({
          type: "warning", title: tMain("删除明文 CSV"),
          message: tMain("确定删除 {filename}？删除后无法恢复。", { filename: path.basename(pending.source) }),
          buttons: [tMain("删除"), tMain("保留")], defaultId: 1, cancelId: 1,
        });
        checkEpoch(expected);
        if (response?.response === 0) { fs.unlinkSync(pending.source); deletedSourceFile = true; }
      }
      return { importedCount: inputs.length, deletedSourceFile };
    } finally { pending.rows.length = 0; }
  }

  function closeDatabase() {
    if (!db) return;
    const result = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (result.busy !== 0) throw new VaultError("E_IO", "密钥库仍被占用，无法安全关闭");
    db.close(); db = null;
    if (fs.existsSync(`${file}-wal`) || fs.existsSync(`${file}-shm`)) throw new VaultError("E_IO", "密钥库仍有未关闭的连接");
  }

  function reopenDatabase() {
    if (!db) db = openExistingDatabase();
    emitStatus();
    return {};
  }

  function resetVault({ confirmPhrase }) {
    if (confirmPhrase !== "重置我的密钥库") invalidArgument("确认短语不正确");
    if (!exists()) throw new VaultError("E_NOT_FOUND", "尚未创建密钥库");
    const current = header();
    const itemCount = store.listItemIds(db).length;
    const cleanup = lock("reset");
    const snapshotId = `${timestamp().replace(/[:.]/g, "-")}-vault-reset`;
    const destination = path.join(dataRoot, "snapshots", snapshotId);
    if (fs.existsSync(destination)) throw new VaultError("E_IO", "重置快照已存在，请稍后重试");
    closeDatabase();
    const archivedFile = path.join(destination, "vault.db");
    const metadataFile = path.join(destination, "snapshot.json");
    let createdDestination = false;
    let moved = false;
    try {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.mkdirSync(destination); createdDestination = true;
      fs.renameSync(file, archivedFile); moved = true;
      const size = fs.statSync(archivedFile).size;
      const sha256 = createHash("sha256").update(fs.readFileSync(archivedFile)).digest("hex");
      fs.writeFileSync(metadataFile, JSON.stringify({ id: snapshotId, createdAt: timestamp(), reason: "vault-reset", appVersion, schemaVersion: null, counts: { vaultItems: itemCount }, files: [{ name: "vault.db", size, sha256 }], integrity: null, sizeBytes: size, includesWorkspace: false, includesVault: true, vaultId: current.vaultId }), { encoding: "utf8", flag: "wx" });
    } catch {
      if (moved && !fs.existsSync(file)) {
        try { fs.renameSync(archivedFile, file); moved = false; } catch {}
      }
      if (createdDestination && !moved) {
        try { if (fs.existsSync(metadataFile)) fs.unlinkSync(metadataFile); fs.rmdirSync(destination); } catch {}
      }
      reopenDatabase(); throw new VaultError("E_IO", "重置密钥库失败，旧文件已保留");
    }
    log("vault.reset"); emitStatus(); return cleanup.then(() => ({}));
  }

  function updateSettings({ patch }) {
    assertUnlocked(); validateSettingsPatch(patch);
    const next = { ...settings(), ...patch };
    store.setState(db, "settings", JSON.stringify(next));
    emitStatus();
    for (const callback of settingsListeners) callback({ ...next });
    return { settings: next };
  }

  async function requestVaultPreferences({ patch }) {
    validateSettingsPatch(patch, { requireValues: true });
    const expected = epoch;
    const key = dek;
    const checkSession = () => {
      if (!key || key !== dek || expected !== epoch || !recoveryConfirmed()) {
        throw new VaultError("E_LOCKED", "请先在本机密钥库解锁并完成恢复密钥确认，再重试。");
      }
    };
    checkSession();
    if (!requestConfirmation) throw new VaultError("E_IO", "主密码确认暂不可用");
    const requested = { ...patch };
    const descriptions = Object.entries(describeVaultSetting)
      .filter(([setting]) => Object.hasOwn(requested, setting))
      .map(([setting, describe]) => describe(requested[setting]));
    const result = await requestConfirmation({
      kind: "change-vault-preferences", title: tMain("调整密钥库设置"),
      description: tMain("AI 助手请求调整以下设置。{settings}。请输入密钥库主密码确认。", { settings: descriptions.join(tMain("。")) }),
    });
    checkSession();
    if (result !== "confirmed") throw new VaultError("E_CANCELLED", "密钥库设置修改已取消");
    updateSettings({ patch: requested });
    return { changed: requested };
  }

  function snapshotTo(targetFile) {
    if (!exists()) return;
    try { store.vacuumInto(db, targetFile); } catch { throw new VaultError("E_IO", "无法创建密钥库快照"); }
  }

  function exportCiphertext() {
    if (!exists()) return null;
    return { header: header(), items: store.listItemIds(db).map((id) => ({ id, blobB64: store.getItemBlob(db, id).toString("base64") })), settings: settings() };
  }

  return {
    status, create, confirmRecoveryKey, unlock, unlockWithRecoveryKey, lock, resetVault, changePassword, regenerateRecoveryKey,
    list: () => { assertUnlocked(); return { summaries: structuredClone([...summaries.values()]) }; },
    getItem: ({ id }) => ({ item: maskedItem(fullItem(id)) }), createItem, updateItem, pickAttachments, discardAttachmentDraft, readAttachmentPreview, saveAttachmentCopy,
    addCredential, updateCredential, deleteCredential, mergeSiteItems, splitCredential,
    trashItem: ({ id }) => setDeleted(id, timestamp()), restoreItem: ({ id }) => setDeleted(id, null), deleteItemPermanently,
    revealField, copyField, openFieldUrl, getTotp,
    generatePassword: ({ options }) => { assertUnlocked(); return { value: makePassword(options, randomInt) }; },
    copyPendingRecoveryKey,
    saveRecoveryKit, updateSettings, requestVaultPreferences, activity: () => { assertUnlocked(true); lastActivity = now(); return {}; },
    getHistory, revealHistory, copyHistory, restoreHistory, securityReport, importBrowserCsv, commitBrowserCsvImport, importPasswordBoxBackup,
    verifyPassword, snapshotTo, exportCiphertext, closeDatabase, reopenDatabase,
    onLocked: (callback) => { lockedListeners.add(callback); return () => lockedListeners.delete(callback); },
    onStatusChanged: (callback) => { statusListeners.add(callback); return () => statusListeners.delete(callback); },
    onSettingsChanged: (callback) => { settingsListeners.add(callback); return () => settingsListeners.delete(callback); },
  };
}
