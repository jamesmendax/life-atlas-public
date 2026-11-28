import { VaultError } from "../vault/errors.js";
import { tMain } from "../i18n/index.js";
import {
  objectWithKeys, validateAttachmentDraftId, validateAttachmentId, validateCredentialId, validateCredentialInput,
  validateCredentialPatch, validateId, validateItemInput, validateItemPatch, validateSettingsPatch, validateSiteMergeArguments, validateString,
} from "../vault/itemModel.js";

export const VAULT_METHODS = Object.freeze([
  "status", "create", "confirmRecoveryKey", "copyPendingRecoveryKey", "saveRecoveryKit", "unlock", "unlockWithRecoveryKey", "lock", "resetVault",
  "list", "getItem", "createItem", "updateItem", "trashItem", "restoreItem", "deleteItemPermanently", "revealField", "copyField", "openFieldUrl", "getTotp",
  "addCredential", "updateCredential", "deleteCredential", "mergeSiteItems", "splitCredential",
  "generatePassword", "changePassword", "regenerateRecoveryKey", "updateSettings", "activity", "confirmRequest", "rejectRequest",
  "getHistory", "revealHistory", "copyHistory", "restoreHistory", "securityReport", "importBrowserCsv", "commitBrowserCsvImport",
  "importPasswordBoxBackup",
  "pickAttachments", "discardAttachmentDraft", "readAttachmentPreview", "saveAttachmentCopy",
]);

export const vaultChannel = (method) => `la:vault:${method.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)}`;

function noArguments(value) {
  if (value !== undefined) objectWithKeys(value, []);
}

function validatePassword(args, keys) {
  objectWithKeys(args, keys);
  for (const key of keys) validateString(args[key], key === "recoveryKey" ? 200 : 4096, 1);
}

function validateFieldArguments(args, withIndex) {
  objectWithKeys(args, withIndex ? ["id", "fieldId", "index"] : ["id", "fieldId"]);
  validateId(args.id); validateId(args.fieldId, true);
  if (withIndex && (!Number.isInteger(args.index) || args.index < 0 || args.index > 9)) throw new VaultError("E_INVALID_ARGUMENT", "历史索引不正确");
}

function validateGenerateOptions(options) {
  if (options?.mode === "passphrase") {
    objectWithKeys(options, ["mode", "words", "separator", "capitalize", "appendNumber"]);
    if (options.words !== undefined && (!Number.isInteger(options.words) || options.words < 4 || options.words > 10)) throw new VaultError("E_INVALID_ARGUMENT", "词数不正确");
    if (options.separator !== undefined && !["-", " ", ".", "_"].includes(options.separator)) throw new VaultError("E_INVALID_ARGUMENT", "分隔符不正确");
    for (const key of ["capitalize", "appendNumber"]) if (options[key] !== undefined && typeof options[key] !== "boolean") throw new VaultError("E_INVALID_ARGUMENT", "生成选项不正确");
  } else {
    objectWithKeys(options, ["mode", "length", "upper", "lower", "digits", "symbols", "excludeAmbiguous"]);
    if (options.mode !== undefined && options.mode !== "random") throw new VaultError("E_INVALID_ARGUMENT", "生成模式不正确");
    if (options.length !== undefined && (!Number.isInteger(options.length) || options.length < 8 || options.length > 128)) throw new VaultError("E_INVALID_ARGUMENT", "长度不正确");
    for (const key of ["upper", "lower", "digits", "symbols", "excludeAmbiguous"]) if (options[key] !== undefined && typeof options[key] !== "boolean") throw new VaultError("E_INVALID_ARGUMENT", "生成选项不正确");
    if (["upper", "lower", "digits", "symbols"].every((key) => options[key] === false)) throw new VaultError("E_INVALID_ARGUMENT", "至少选择一类字符");
  }
}

export function validateVaultArguments(method, args) {
  if (["status", "copyPendingRecoveryKey", "saveRecoveryKit", "lock", "list", "activity", "securityReport", "importBrowserCsv"].includes(method)) return noArguments(args);
  if (["create", "unlock", "regenerateRecoveryKey", "importPasswordBoxBackup"].includes(method)) return validatePassword(args, ["password"]);
  if (method === "changePassword") return validatePassword(args, ["currentPassword", "newPassword"]);
  if (method === "unlockWithRecoveryKey") return validatePassword(args, ["recoveryKey", "newPassword"]);
  if (method === "confirmRecoveryKey") { objectWithKeys(args, ["lastTwoGroups"]); validateString(args.lastTwoGroups, 100, 1); return; }
  if (method === "resetVault") { objectWithKeys(args, ["confirmPhrase"]); if (args.confirmPhrase !== "重置我的密钥库") throw new VaultError("E_INVALID_ARGUMENT", "确认短语不正确"); return; }
  if (["getItem", "trashItem", "restoreItem", "deleteItemPermanently"].includes(method)) { objectWithKeys(args, ["id"]); validateId(args.id); return; }
  if (["revealField", "copyField", "openFieldUrl", "getTotp", "getHistory"].includes(method)) return validateFieldArguments(args, false);
  if (["revealHistory", "copyHistory", "restoreHistory"].includes(method)) return validateFieldArguments(args, true);
  if (method === "createItem") { objectWithKeys(args, ["input"]); validateItemInput(args.input); return; }
  if (method === "updateItem") { objectWithKeys(args, ["id", "patch"]); validateId(args.id); validateItemPatch(args.patch); return; }
  if (method === "addCredential") {
    objectWithKeys(args, ["id", "credential"]);
    validateId(args.id);
    validateCredentialInput(args.credential);
    return;
  }
  if (["updateCredential", "deleteCredential", "splitCredential"].includes(method)) {
    objectWithKeys(args, method === "updateCredential" ? ["id", "credentialId", "patch"] : ["id", "credentialId"]);
    validateId(args.id);
    validateCredentialId(args.credentialId);
    if (method === "updateCredential") validateCredentialPatch(args.patch);
    return;
  }
  if (method === "mergeSiteItems") return validateSiteMergeArguments(args);
  if (method === "pickAttachments") {
    if (args === undefined) return;
    objectWithKeys(args, ["draftId", "filter"]);
    if (args.draftId !== undefined) validateAttachmentDraftId(args.draftId);
    if (args.filter !== undefined && args.filter !== "images") throw new VaultError("E_INVALID_ARGUMENT", "附件筛选类型不正确");
    return;
  }
  if (method === "discardAttachmentDraft") {
    objectWithKeys(args, ["draftId", "attachmentId"]);
    validateAttachmentDraftId(args.draftId);
    if (args.attachmentId !== undefined) validateAttachmentId(args.attachmentId);
    return;
  }
  if (method === "readAttachmentPreview" || method === "saveAttachmentCopy") {
    objectWithKeys(args, ["id", "draftId", "attachmentId"]);
    if (Boolean(args.id) === Boolean(args.draftId)) throw new VaultError("E_INVALID_ARGUMENT", "请指定已保存条目或草稿附件");
    if (args.id !== undefined) validateId(args.id);
    if (args.draftId !== undefined) validateAttachmentDraftId(args.draftId);
    validateAttachmentId(args.attachmentId);
    return;
  }
  if (method === "updateSettings") { objectWithKeys(args, ["patch"]); validateSettingsPatch(args.patch); return; }
  if (method === "generatePassword") { objectWithKeys(args, ["options"]); validateGenerateOptions(args.options); return; }
  if (["confirmRequest", "rejectRequest"].includes(method)) {
    objectWithKeys(args, method === "confirmRequest" ? ["requestId", "password"] : ["requestId"]);
    validateString(args.requestId, 200, 1);
    if (method === "confirmRequest") validateString(args.password, 4096, 1);
    return;
  }
  if (method === "commitBrowserCsvImport") {
    objectWithKeys(args, ["importId", "rowIndexes", "deleteSourceFile"]);
    validateString(args.importId, 200, 1);
    if (!Array.isArray(args.rowIndexes) || args.rowIndexes.length > 100000 || args.rowIndexes.some((index) => !Number.isInteger(index) || index < 0) || new Set(args.rowIndexes).size !== args.rowIndexes.length || typeof args.deleteSourceFile !== "boolean") throw new VaultError("E_INVALID_ARGUMENT", "导入选项不正确");
  }
}

export function registerVaultIpc({ ipcMain, service, confirmRequests, getVaultWindowId, getTheme }) {
  for (const method of VAULT_METHODS) {
    ipcMain.handle(vaultChannel(method), async (event, args) => {
      const senderId = getVaultWindowId();
      if (typeof senderId !== "number" || event.sender.id !== senderId) return { ok: false, error: { code: "E_FORBIDDEN", message: tMain("只接受密钥库窗口的调用") } };
      const frame = event.senderFrame;
      const mainFrame = event.sender.mainFrame;
      if (!frame || !mainFrame || event.sender.isDestroyed?.() || frame.isDestroyed?.() || frame.routingId !== mainFrame.routingId || frame.processId !== mainFrame.processId) return { ok: false, error: { code: "E_FORBIDDEN", message: tMain("只接受密钥库主框架的调用") } };
      try {
        validateVaultArguments(method, args);
        const value = method === "confirmRequest" ? await confirmRequests.confirm(args) : method === "rejectRequest" ? await confirmRequests.reject(args) : await service[method](args);
        return { ok: true, value: method === "status" && getTheme ? { ...value, theme: getTheme() } : value };
      } catch (error) {
        if (error instanceof VaultError) return { ok: false, error: { code: error.code, message: tMain(error.message), ...(error.code === "E_THROTTLED" ? { retryAfterMs: error.retryAfterMs } : {}) } };
        return { ok: false, error: { code: "E_IO", message: tMain("密钥库操作失败") } };
      }
    });
  }
  return () => { for (const method of VAULT_METHODS) ipcMain.removeHandler(vaultChannel(method)); };
}
