import { invalidArgument } from "./errors.js";
import { MAX_ITEM_ATTACHMENTS } from "./attachmentFiles.js";
import { normalizeSiteIdentity, parseSiteUrl } from "./siteKey.js";

export const ITEM_TYPES = Object.freeze(["login", "apiKey", "server", "database", "secureNote", "recoveryCodes", "custom"]);
export const FIELD_KINDS = Object.freeze(["text", "secret", "url", "email", "number", "date", "multiline", "totp"]);
export const DEFAULT_SETTINGS = Object.freeze({ autoLockMinutes: 5, clipboardClearSeconds: 30, lockOnMinimize: false, verifyBeforeReveal: false });

const MAX_ITEM_FIELDS = 300;
const MAX_ITEM_CREDENTIALS = 50;
const EXPIRY_FIELD_ALIASES = new Set(["有効期限", "Expiry Date", "Expiration Date"]);
const WEBSITE_LABELS = new Set(["网站", "网站名称", "website"]);
const URL_LABELS = new Set(["url", "网址", "控制台网址"]);
const CREDENTIAL_PREVIEW_LABELS = new Set([
  "用户名", "账号", "账户名", "邮箱", "电子邮箱", "主机", "主机名", "key 名称", "key名称",
  "username", "user name", "email", "e-mail", "host", "hostname", "key name",
]);

export function objectWithKeys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) invalidArgument();
  return value;
}

export function validateString(value, maximum, minimum = 0) {
  if (typeof value !== "string" || [...value].length < minimum || value.length > maximum) invalidArgument();
}

export function validateId(value, field = false) {
  if (typeof value !== "string" || !(field ? /^f_[0-9a-f]{8}$/ : /^vi_[0-9a-f]{32}$/).test(value)) invalidArgument();
}

export function validateCredentialId(value) {
  if (typeof value !== "string" || !/^vc_[0-9a-f]{16,32}$/.test(value)) invalidArgument("密钥编号不正确");
}

export function validateSiteMergeArguments(args) {
  const { targetId, sourceIds } = objectWithKeys(args, ["targetId", "sourceIds"]);
  validateId(targetId);
  if (!Array.isArray(sourceIds) || !sourceIds.length || sourceIds.length > MAX_ITEM_CREDENTIALS ||
      new Set(sourceIds).size !== sourceIds.length || sourceIds.includes(targetId)) invalidArgument("合并条目列表不正确");
  for (const id of sourceIds) validateId(id);
}

export function validateAttachmentId(value) {
  if (typeof value !== "string" || !/^va_[0-9a-f]{32}$/.test(value)) invalidArgument("附件编号不正确");
}

export function validateAttachmentDraftId(value) {
  if (typeof value !== "string" || !/^vad_[0-9a-f]{32}$/.test(value)) invalidArgument("附件选择编号不正确");
}

export function attachmentMetadata({ id, name, size }) {
  return { id, name, size };
}

export function findExpiryField(fields) {
  return fields.find((field) => field.kind === "date" && field.label === "到期日") ??
    fields.find((field) => field.kind === "date" && EXPIRY_FIELD_ALIASES.has(field.label));
}

function expiryTime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(value)) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().startsWith(value.slice(0, 10)) ? time : NaN;
}

function validateDate(value) {
  if (value !== null && !Number.isFinite(expiryTime(value))) invalidArgument("到期日不正确");
}

function validateSite(site) {
  if (site === null) return;
  objectWithKeys(site, ["name", "url", "siteKey"]);
  if (typeof site.name !== "string" || !site.name.trim() || typeof site.siteKey !== "string" || !site.siteKey.trim() ||
      (site.url !== "" && !parseSiteUrl(site.url))) invalidArgument("站点信息不正确");
}

function validateFields(fields, patch) {
  if (!Array.isArray(fields) || fields.length > MAX_ITEM_FIELDS) invalidArgument();
  const ids = new Set();
  for (const field of fields) {
    objectWithKeys(field, patch ? ["id", "label", "kind", "value", "sensitive", "keepValue"] : ["label", "kind", "value", "sensitive"]);
    validateString(field.label, 100, 1);
    if (!FIELD_KINDS.includes(field.kind) || typeof field.sensitive !== "boolean") invalidArgument();
    if (field.id !== undefined) {
      validateId(field.id, true);
      if (ids.has(field.id)) invalidArgument("字段重复");
      ids.add(field.id);
    }
    if (field.keepValue !== undefined) {
      if (!patch || !field.id || field.keepValue !== true || field.value !== undefined) invalidArgument();
    } else validateString(field.value, 65536);
  }
}

export function validateItemInput(input) {
  objectWithKeys(input, ["type", "title", "tags", "favorite", "subtitleFieldId", "expiresAt", "fields", "attachmentDraftId", "site"]);
  if (!ITEM_TYPES.includes(input.type)) invalidArgument();
  validateString(input.title, 500, 1);
  if (input.fields === undefined) invalidArgument();
  validateItemPatch(input, true);
}

function validateAttachmentChanges({ attachmentDraftId, removeAttachmentIds }) {
  if (attachmentDraftId !== undefined) validateAttachmentDraftId(attachmentDraftId);
  if (removeAttachmentIds === undefined) return;
  if (!Array.isArray(removeAttachmentIds) || removeAttachmentIds.length > MAX_ITEM_ATTACHMENTS ||
      new Set(removeAttachmentIds).size !== removeAttachmentIds.length) invalidArgument("附件移除列表不正确");
  for (const id of removeAttachmentIds) validateAttachmentId(id);
}

export function validateItemPatch(patch, creating = false) {
  const normalized = creating ? Object.fromEntries(Object.entries(patch).filter(([key]) => key !== "type")) : patch;
  objectWithKeys(normalized, ["title", "tags", "favorite", "subtitleFieldId", "expiresAt", "fields", "attachmentDraftId", "site", ...(creating ? [] : ["removeAttachmentIds"])]);
  if (normalized.title !== undefined) validateString(normalized.title, 500, 1);
  if (normalized.tags !== undefined && (!Array.isArray(normalized.tags) || normalized.tags.length > 50 || normalized.tags.some((tag) => typeof tag !== "string" || tag.length > 50))) invalidArgument();
  if (normalized.favorite !== undefined && typeof normalized.favorite !== "boolean") invalidArgument();
  if (normalized.subtitleFieldId !== undefined && normalized.subtitleFieldId !== null) validateId(normalized.subtitleFieldId, true);
  if (normalized.expiresAt !== undefined) validateDate(normalized.expiresAt);
  if (normalized.fields !== undefined) validateFields(normalized.fields, !creating);
  if (Object.hasOwn(normalized, "site")) validateSite(normalized.site);
  validateAttachmentChanges(normalized);
}

function validateCredentialDetails(credential, required) {
  if (required || credential.label !== undefined) validateString(credential.label, 200, 1);
  if ((required || credential.type !== undefined) && !ITEM_TYPES.includes(credential.type)) invalidArgument("密钥类型不正确");
  if (credential.expiresAt !== undefined) validateDate(credential.expiresAt);
}

export function validateCredentialInput(credential) {
  objectWithKeys(credential, ["label", "type", "expiresAt", "fields", "attachmentDraftId"]);
  validateCredentialDetails(credential, true);
  validateFields(credential.fields, false);
  if (!credential.fields.length && credential.type !== "custom") invalidArgument("请至少添加一个字段");
  validateAttachmentChanges(credential);
}

export function validateCredentialPatch(patch) {
  objectWithKeys(patch, ["label", "type", "expiresAt", "fields", "attachmentDraftId", "removeAttachmentIds"]);
  validateCredentialDetails(patch, false);
  if (patch.fields !== undefined) validateFields(patch.fields, true);
  validateAttachmentChanges(patch);
}

export function validateItemCredentials(item) {
  if (Object.hasOwn(item, "site")) validateSite(item.site);
  if (!Array.isArray(item.fields) || item.fields.length > MAX_ITEM_FIELDS) invalidArgument("条目字段超出限制");
  const fieldIds = new Set();
  for (const field of item.fields) {
    validateId(field?.id, true);
    if (fieldIds.has(field.id)) invalidArgument("字段重复");
    fieldIds.add(field.id);
  }
  if (!Object.hasOwn(item, "credentials")) return;
  if (!Array.isArray(item.credentials) || !item.credentials.length || item.credentials.length > MAX_ITEM_CREDENTIALS) invalidArgument("条目密钥数量不正确");
  const credentialIds = new Set();
  const claimedFieldIds = new Set();
  for (const credential of item.credentials) {
    objectWithKeys(credential, ["id", "label", "type", "expiresAt", "fieldIds", "sourceFingerprints", "createdAt", "updatedAt"]);
    validateCredentialId(credential.id);
    if (credentialIds.has(credential.id)) invalidArgument("密钥重复");
    credentialIds.add(credential.id);
    validateCredentialDetails(credential, true);
    if (credential.expiresAt === undefined) invalidArgument("到期日不正确");
    for (const timestamp of [credential.createdAt, credential.updatedAt]) {
      if (typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp))) invalidArgument("密钥时间不正确");
    }
    if (credential.sourceFingerprints !== undefined) {
      if (!Array.isArray(credential.sourceFingerprints)) invalidArgument("来源指纹不正确");
      for (const fingerprint of credential.sourceFingerprints) {
        if (typeof fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(fingerprint)) invalidArgument("来源指纹不正确");
      }
    }
    if (!Array.isArray(credential.fieldIds) || (!credential.fieldIds.length && credential.type !== "custom")) invalidArgument("密钥字段列表不正确");
    for (const id of credential.fieldIds) {
      if (!fieldIds.has(id) || claimedFieldIds.has(id)) invalidArgument("密钥字段不存在或重复");
      claimedFieldIds.add(id);
    }
  }
}

export function validateSettingsPatch(patch, { requireValues = false } = {}) {
  objectWithKeys(patch, Object.keys(DEFAULT_SETTINGS));
  if (requireValues && (!Object.keys(patch).length || Object.values(patch).some((value) => value === undefined))) invalidArgument("请提供需要调整的密钥库设置");
  if (patch.autoLockMinutes !== undefined && ![1, 5, 15, 30, 60].includes(patch.autoLockMinutes)) invalidArgument();
  if (patch.clipboardClearSeconds !== undefined && ![10, 30, 60, 90].includes(patch.clipboardClearSeconds)) invalidArgument();
  for (const key of ["lockOnMinimize", "verifyBeforeReveal"]) if (patch[key] !== undefined && typeof patch[key] !== "boolean") invalidArgument();
}

function isSensitiveField(field) {
  return field.sensitive || field.kind === "secret" || field.kind === "totp";
}

function normalizedLabel(field) {
  return field.label.trim().toLowerCase();
}

export function derivedItemSite(item) {
  if (Object.hasOwn(item, "site")) return item.site;
  if (item.type === "secureNote") return null;

  const visible = item.fields.filter((field) => !isSensitiveField(field));
  const url = visible.find((field) => (field.kind === "url" ||
    (field.kind === "text" && URL_LABELS.has(normalizedLabel(field)))) && parseSiteUrl(field.value));
  const website = visible.find((field) => field.kind === "text" &&
    WEBSITE_LABELS.has(normalizedLabel(field)) && field.value.trim());
  return normalizeSiteIdentity({ url: url?.value ?? website?.value, website: website?.value, title: item.title });
}

function hasTotp(fields) {
  return fields.some((field) => field.kind === "totp" && Boolean(field.value));
}

function summarizeCredential(credential, fieldsById) {
  const fields = credential.fieldIds.map((id) => fieldsById.get(id)).filter(Boolean);
  const preview = fields.find((field) => !isSensitiveField(field) && field.value.trim() &&
    (field.kind === "email" || (["text", "url"].includes(field.kind) && CREDENTIAL_PREVIEW_LABELS.has(normalizedLabel(field)))));
  return {
    id: credential.id, label: credential.label, type: credential.type, preview: preview?.value ?? null,
    expiresAt: credential.expiresAt, hasTotp: hasTotp(fields),
  };
}

function earliestExpiry(item, credentials) {
  let earliest = null;
  let earliestTime = Infinity;
  for (const { expiresAt } of [item, ...credentials]) {
    const time = expiryTime(expiresAt);
    if (time < earliestTime) {
      earliest = expiresAt;
      earliestTime = time;
    }
  }
  return earliest;
}

function summaryHost(url, site) {
  if (url) {
    try {
      return new URL(url.value).hostname;
    } catch {
      return parseSiteUrl(site?.url)?.hostname ?? null;
    }
  }
  return parseSiteUrl(site?.url)?.hostname ?? null;
}

export function summarizeItem(item) {
  const subtitle = item.fields.find((field) => field.id === item.subtitleFieldId && !isSensitiveField(field));
  const url = item.fields.find((field) => field.kind === "url" && !isSensitiveField(field));
  const site = derivedItemSite(item);
  const fieldsById = new Map(item.fields.map((field) => [field.id, field]));
  const credentials = (item.credentials ?? []).map((credential) => summarizeCredential(credential, fieldsById));
  return {
    id: item.id, type: item.type, title: item.title, tags: [...item.tags], favorite: item.favorite,
    subtitle: subtitle?.value ?? null, host: summaryHost(url, site),
    updatedAt: item.updatedAt, expiresAt: earliestExpiry(item, credentials), hasTotp: hasTotp(item.fields), deletedAt: item.deletedAt,
    siteKey: site?.siteKey ?? null, siteName: site?.name ?? null, siteUrl: site?.url ?? null,
    credentialCount: item.credentials?.length ?? 1,
    credentialTypes: item.credentials ? [...new Set(credentials.map(({ type }) => type))] : [item.type],
    credentials,
  };
}

export function maskedItem(item) {
  return {
    id: item.id, type: item.type, title: item.title, tags: [...item.tags], favorite: item.favorite,
    subtitleFieldId: item.subtitleFieldId, expiresAt: item.expiresAt, deletedAt: item.deletedAt, createdAt: item.createdAt, updatedAt: item.updatedAt,
    ...(Object.hasOwn(item, "site") ? {
      site: item.site === null ? null : { name: item.site.name, url: item.site.url, siteKey: item.site.siteKey },
    } : {}),
    ...(item.credentials ? { credentials: item.credentials.map(({ id, label, type, expiresAt, fieldIds, createdAt, updatedAt }) => ({
      id, label, type, expiresAt, fieldIds: [...fieldIds], createdAt, updatedAt,
    })) } : {}),
    fields: item.fields.map(({ id, label, kind, sensitive, value }) => isSensitiveField({ kind, sensitive }) ?
      { id, label, kind, sensitive: true, masked: true, hasValue: Boolean(value) } : { id, label, kind, sensitive, value }),
    history: item.history.map(({ fieldId, changedAt }) => ({ fieldId, changedAt })),
    ...(item.attachments ? { attachments: item.attachments.map(attachmentMetadata) } : {}),
  };
}

export function applyItemPatch(item, patch, { now, createFieldId }) {
  validateItemPatch(patch);
  const previousFields = new Map(item.fields.map((field) => [field.id, field]));
  const fields = patch.fields === undefined ? item.fields.map((field) => ({ ...field })) : patch.fields.map((field) => {
    const previous = field.id ? previousFields.get(field.id) : null;
    if (field.id && !previous) invalidArgument("字段不存在");
    return {
      id: field.id || createFieldId(), label: field.label, kind: field.kind,
      sensitive: isSensitiveField(field) || (field.keepValue === true && isSensitiveField(previous)),
      value: field.keepValue === true ? previous.value : field.value,
    };
  });
  const history = [...item.history];
  for (const previous of item.fields) {
    const next = fields.find((field) => field.id === previous.id);
    if (isSensitiveField(previous) && (!next || next.value !== previous.value)) history.push({ fieldId: previous.id, value: previous.value, changedAt: now });
  }
  const counts = new Map();
  const retained = history.slice().reverse().filter((entry) => {
    const count = (counts.get(entry.fieldId) || 0) + 1;
    counts.set(entry.fieldId, count);
    return count <= 10;
  }).reverse();
  const result = { ...item, ...patch, fields, history: retained, updatedAt: now };
  if (result.subtitleFieldId && !fields.some((field) => field.id === result.subtitleFieldId && !isSensitiveField(field))) result.subtitleFieldId = null;
  if (item.type === "apiKey" && !item.credentials && patch.expiresAt === undefined && patch.fields !== undefined) {
    const expiry = findExpiryField(fields);
    if (expiry?.value) { validateDate(expiry.value); result.expiresAt = expiry.value; }
  }
  return result;
}
