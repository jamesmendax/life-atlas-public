import { createHash } from "node:crypto";
import { MAX_ATTACHMENT_BYTES } from "./attachmentFiles.js";
import { invalidArgument } from "./errors.js";
import { derivedItemSite, validateItemInput } from "./itemModel.js";
import { credentialSecretSignature, normalizeAccount, normalizeDedupeScope, normalizeSiteIdentity, parseSiteUrl } from "./siteKey.js";

const imageExtensions = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
const knownFields = new Set(["id", "title", "website", "url", "username", "secret", "notes", "tags", "expiresAt", "imageDataUrl", "sourceText", "createdAt", "updatedAt"]);

export function passwordBoxFingerprint(entry) {
  const fields = Object.keys(entry).sort().map((key) => [key, entry[key]]);
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

const accountLabels = new Set([
  "用户名", "用户", "账号", "账户", "账户名", "邮箱", "电子邮箱", "username", "account", "email",
  "key 名称", "key名称", "key name",
]);
const websiteLabels = new Set(["网站", "网站名称", "website"]);
const urlLabels = new Set(["网址", "控制台网址", "url"]);

export function credentialFields(item, credential) {
  if (!credential) return item.fields;
  const fieldsById = new Map(item.fields.map((field) => [field.id, field]));
  return credential.fieldIds.map((id) => fieldsById.get(id)).filter(Boolean);
}

function dedupeIdentity({ url, website, title, siteKey }, account, fields) {
  const scope = normalizeDedupeScope({ url, website, title, siteKey });
  const signature = credentialSecretSignature(fields);
  const secretCount = fields.filter((field) => field.kind === "secret" && field.value !== "").length;
  const key = createHash("sha256").update(JSON.stringify([scope, normalizeAccount(account), secretCount, signature])).digest("hex");
  return { key, hasSecret: secretCount > 0 };
}

export function passwordBoxDedupeIdentity(entry, site) {
  return dedupeIdentity(
    { url: entry.url, website: entry.website, title: entry.title || "未命名密钥", siteKey: site?.siteKey },
    entry.username,
    [{ kind: "secret", value: entry.secret }],
  );
}

export function credentialDedupeIdentity(item, credential) {
  const fields = credentialFields(item, credential);
  const visibleFields = fields.filter((field) => !field.sensitive && field.value.trim() !== "");
  const site = derivedItemSite(item);
  const url = visibleFields.find((field) =>
    (field.kind === "url" || urlLabels.has(field.label.trim().toLowerCase())) && parseSiteUrl(field.value))?.value;
  const website = visibleFields.find((field) => websiteLabels.has(field.label.trim().toLowerCase()))?.value;
  const account = visibleFields.find((field) => field.kind === "email" || accountLabels.has(field.label.trim().toLowerCase()));
  const title = !site && item.credentials?.length === 1 ? item.title : credential?.label ?? item.title;
  const localSite = normalizeSiteIdentity({ url, website, title });
  return dedupeIdentity(
    { url: url ?? (website ? undefined : site?.url), website, title, siteKey: localSite?.siteKey ?? site?.siteKey },
    account?.value,
    fields,
  );
}

export function credentialSourceFingerprints(item, credential) {
  if (credential) return credential.sourceFingerprints ?? [];
  return item.passwordBoxFingerprint ? [item.passwordBoxFingerprint] : [];
}

function originalImage(value, newAttachmentId, detectImageMime) {
  if (!value) return null;
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4) invalidArgument("有原图格式不支持或超过 8 MiB，整批未导入");
  const [, mime, encoded] = match;
  const bytes = Buffer.from(encoded, "base64");
  try {
    if (bytes.length > MAX_ATTACHMENT_BYTES || bytes.toString("base64") !== encoded || detectImageMime(bytes) !== mime) {
      invalidArgument("有原图格式不支持或超过 8 MiB，整批未导入");
    }
    return { id: newAttachmentId(), name: `PasswordBox.${imageExtensions[mime]}`, size: bytes.length, data: encoded };
  } finally {
    bytes.fill(0);
  }
}

function sourceTimestamp(value, fallback) {
  return value && Number.isFinite(Date.parse(value)) ? value : fallback;
}

export function passwordBoxItem(entry, { id, newFieldId, newCredentialId, newAttachmentId, detectImageMime, timestamp, fingerprint, site = normalizeSiteIdentity(entry) }) {
  const image = originalImage(entry.imageDataUrl, newAttachmentId, detectImageMime);
  const fields = [];
  function field(label, kind, value, sensitive = false) {
    if (value || label === "密钥") fields.push({ label, kind, value, sensitive });
  }
  field("网站", "text", entry.website);
  field("网址", "url", entry.url);
  field("用户名", "text", entry.username);
  field("密钥", "secret", entry.secret, true);
  field("原备注", "multiline", entry.notes, true);
  field("OCR 原文", "multiline", entry.sourceText, true);
  if (image) field("原图", "multiline", `![[vault-image:${image.id}|${image.name}]]`);
  const tags = [...new Set(["PasswordBox", ...(entry.tags ?? [])])];
  const retainedTags = tags.filter((tag) => tag.length <= 50).slice(0, 50);
  if (retainedTags.length !== tags.length) field("原标签", "multiline", JSON.stringify(entry.tags), true);
  const extraFields = Object.entries(entry).filter(([key]) => !knownFields.has(key));
  if (extraFields.length) field("原条目的其他字段", "multiline", JSON.stringify(Object.fromEntries(extraFields)), true);
  const input = {
    title: entry.title || "未命名密钥",
    type: normalizeAccount(entry.username) ? "login" : "custom",
    site,
    expiresAt: entry.expiresAt || null,
    tags: retainedTags,
    fields,
  };
  validateItemInput(input);
  const createdAt = sourceTimestamp(entry.createdAt, timestamp);
  const updatedAt = sourceTimestamp(entry.updatedAt, timestamp);
  const storedFields = fields.map((data) => ({ ...data, id: newFieldId() }));
  return {
    ...input,
    id,
    favorite: false,
    subtitleFieldId: null,
    history: [],
    deletedAt: null,
    createdAt,
    updatedAt,
    expiresAt: null,
    fields: storedFields,
    credentials: [{
      id: newCredentialId(), label: input.title.slice(0, 200).replace(/[\uD800-\uDBFF]$/, ""), type: input.type, expiresAt: input.expiresAt,
      fieldIds: storedFields.map((field) => field.id), sourceFingerprints: [fingerprint], createdAt, updatedAt,
    }],
    ...(image ? { attachments: [image] } : {}),
  };
}
