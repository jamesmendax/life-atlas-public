import { createHash } from "node:crypto";
import { VaultError } from "./errors.js";

const attachmentToken = /^(!\[\[vault-(?:image|file):)(va_[0-9a-f]{32})(\|[^\]]*\]\])$/;

// Keep the note's original whitespace and line endings, and skip closed code and callout blocks.
function visitAttachmentTokens(value, visit) {
  if (!value.includes("![[vault-")) return value;
  const lines = value.split(/(\r\n?|\n)/);
  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === "```" || trimmed === ":::callout") {
      const closing = trimmed === "```" ? "```" : ":::";
      let end = index + 2;
      while (end < lines.length && lines[end].trim() !== closing) end += 2;
      if (end < lines.length) { index = end; continue; }
    }
    const token = attachmentToken.exec(trimmed);
    if (token) {
      const [, prefix, id, suffix] = token;
      const replacement = visit(id);
      if (replacement && replacement !== id) lines[index] = line.replace(trimmed, `${prefix}${replacement}${suffix}`);
    }
  }
  return lines.join("");
}

export function attachmentReferences(fields, history = []) {
  const ids = new Set();
  const noteFieldIds = new Set();
  const collect = (id) => { ids.add(id); };
  for (const field of fields) {
    if (field.kind !== "multiline") continue;
    noteFieldIds.add(field.id);
    visitAttachmentTokens(field.value, collect);
  }
  for (const entry of history) {
    if (noteFieldIds.has(entry.fieldId)) visitAttachmentTokens(entry.value, collect);
  }
  return ids;
}

export function promoteCredentials(item, newCredentialId) {
  if (item.credentials?.length) return item;
  const { passwordBoxFingerprint, ...legacy } = item;
  const cutsSurrogatePair = /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(item.title.slice(199, 201));
  return {
    ...legacy,
    expiresAt: null,
    credentials: [{
      id: newCredentialId(),
      label: item.title.slice(0, cutsSurrogatePair ? 199 : 200),
      type: item.fields.length ? item.type : "custom",
      expiresAt: item.expiresAt ?? null,
      fieldIds: item.fields.map(({ id }) => id),
      ...(passwordBoxFingerprint ? { sourceFingerprints: [passwordBoxFingerprint] } : {}),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }],
  };
}

function remapConflictingIds(existingIds, sourceIds, newId) {
  const existing = new Set(existingIds);
  const reserved = new Set([...existing, ...sourceIds]);
  return (id) => {
    if (!existing.has(id)) { existing.add(id); return id; }
    let replacement;
    do { replacement = newId(); } while (reserved.has(replacement));
    reserved.add(replacement);
    existing.add(replacement);
    return replacement;
  };
}

function mergeTags(targetTags, sourceTags) {
  const tags = [...new Set([...targetTags, ...sourceTags])];
  if (tags.indexOf("PasswordBox") >= 50) return [...tags.slice(0, 49), "PasswordBox"];
  return tags.slice(0, 50);
}

function attachmentDigest(attachment) {
  const bytes = Buffer.from(attachment.data, "base64");
  try { return createHash("sha256").update(bytes).digest("hex"); }
  finally { bytes.fill(0); }
}

function sameAttachmentBytes(first, second) {
  if (first.size !== second.size) return false;
  if (first.data === second.data) return true;
  const firstBytes = Buffer.from(first.data, "base64");
  const secondBytes = Buffer.from(second.data, "base64");
  try { return firstBytes.equals(secondBytes); }
  finally { firstBytes.fill(0); secondBytes.fill(0); }
}

function mergeAttachments(target, source, retainedReferences, sourceReferences, { newAttachmentId, dedupeAttachmentBytes }) {
  const attachments = [...(target.attachments ?? [])];
  const sourceAttachments = source.attachments ?? [];
  const remapId = remapConflictingIds(attachments.map(({ id }) => id), sourceAttachments.map(({ id }) => id), newAttachmentId);
  const remappedIds = new Map();
  const byDigest = new Map();
  const addToIndex = (digest, attachment) => {
    const matches = byDigest.get(digest) ?? [];
    byDigest.set(digest, [...matches, attachment]);
  };
  if (dedupeAttachmentBytes) {
    for (const attachment of attachments) addToIndex(attachmentDigest(attachment), attachment);
  }
  for (const attachment of sourceAttachments) {
    if (sourceReferences.has(attachment.id) && !retainedReferences.has(attachment.id)) continue;
    const digest = dedupeAttachmentBytes ? attachmentDigest(attachment) : null;
    const same = byDigest.get(digest)?.find((existing) => sameAttachmentBytes(existing, attachment));
    if (same) { remappedIds.set(attachment.id, same.id); continue; }
    const id = remapId(attachment.id);
    const transferred = { ...attachment, id };
    remappedIds.set(attachment.id, id);
    attachments.push(transferred);
    if (digest) addToIndex(digest, transferred);
  }
  return { attachments, remappedIds };
}

export function mergeCredentialItems(targetItem, sourceItem, {
  newFieldId, newCredentialId, newAttachmentId, isDuplicate, now, dedupeAttachmentBytes = false,
}) {
  const target = promoteCredentials(targetItem, newCredentialId);
  const source = promoteCredentials(sourceItem, newCredentialId);
  const sourceFields = new Map(source.fields.map((field) => [field.id, field]));
  const sourceOwnedIds = new Set(source.credentials.flatMap(({ fieldIds }) => fieldIds));
  const remapFieldId = remapConflictingIds(
    [...target.fields.map(({ id }) => id), ...target.history.map(({ fieldId }) => fieldId)],
    [...sourceFields.keys(), ...source.history.map(({ fieldId }) => fieldId)],
    newFieldId,
  );
  const remapCredentialId = remapConflictingIds(
    target.credentials.map(({ id }) => id), source.credentials.map(({ id }) => id), newCredentialId,
  );
  const fieldIds = new Map();
  let currentTarget = target;
  for (const credential of source.credentials) {
    if (isDuplicate?.(currentTarget, source, credential)) continue;
    const fields = credential.fieldIds.map((oldId) => {
      const id = remapFieldId(oldId);
      fieldIds.set(oldId, id);
      return { ...sourceFields.get(oldId), id };
    });
    const transferred = { ...credential, id: remapCredentialId(credential.id), fieldIds: fields.map(({ id }) => id) };
    currentTarget = {
      ...currentTarget,
      fields: [...currentTarget.fields, ...fields],
      credentials: [...currentTarget.credentials, transferred],
    };
  }

  const retainedFields = source.fields.filter(({ id }) => fieldIds.has(id) || !sourceOwnedIds.has(id));
  const retainedHistory = source.history.filter(({ fieldId }) => fieldIds.has(fieldId) || !sourceOwnedIds.has(fieldId));
  const retainedReferences = attachmentReferences(retainedFields, retainedHistory);
  const sourceReferences = attachmentReferences(source.fields, source.history);
  const { attachments, remappedIds } = mergeAttachments(
    target, source, retainedReferences, sourceReferences, { newAttachmentId, dedupeAttachmentBytes },
  );
  const replaceAttachmentId = (id) => remappedIds.get(id);
  for (const { id } of retainedFields) {
    if (!fieldIds.has(id)) fieldIds.set(id, remapFieldId(id));
  }
  const noteFieldIds = new Set(retainedFields.filter(({ kind }) => kind === "multiline").map(({ id }) => id));
  const fields = retainedFields.map((field) => ({
    ...field,
    id: fieldIds.get(field.id),
    value: noteFieldIds.has(field.id) ? visitAttachmentTokens(field.value, replaceAttachmentId) : field.value,
  }));
  const history = retainedHistory.map((entry) => {
    if (!fieldIds.has(entry.fieldId)) fieldIds.set(entry.fieldId, remapFieldId(entry.fieldId));
    return {
      ...entry,
      fieldId: fieldIds.get(entry.fieldId),
      value: noteFieldIds.has(entry.fieldId) ? visitAttachmentTokens(entry.value, replaceAttachmentId) : entry.value,
    };
  });
  const expiresAt = [target.expiresAt, source.expiresAt]
    .filter((value) => value && Number.isFinite(Date.parse(value)))
    .sort((first, second) => Date.parse(first) - Date.parse(second))[0] ?? null;
  return {
    ...currentTarget,
    fields: [...target.fields, ...fields],
    history: [...target.history, ...history],
    ...(target.attachments || attachments.length ? { attachments } : {}),
    subtitleFieldId: target.subtitleFieldId ?? fieldIds.get(source.subtitleFieldId) ?? null,
    tags: mergeTags(target.tags, source.tags),
    favorite: target.favorite || source.favorite,
    expiresAt,
    updatedAt: now,
  };
}

function detachCredential(item, credentialId, now, conflictMessage) {
  const credentials = item.credentials ?? [];
  if (credentials.length <= 1) throw new VaultError("E_CONFLICT", conflictMessage);
  const credential = credentials.find(({ id }) => id === credentialId);
  if (!credential) throw new VaultError("E_NOT_FOUND", "密钥不存在");
  const ownedIds = new Set(credential.fieldIds);
  const fields = item.fields.filter(({ id }) => ownedIds.has(id));
  const history = item.history.filter(({ fieldId }) => ownedIds.has(fieldId));
  const remainingFields = item.fields.filter(({ id }) => !ownedIds.has(id));
  const remainingHistory = item.history.filter(({ fieldId }) => !ownedIds.has(fieldId));
  const movedReferences = attachmentReferences(fields, history);
  const remainingReferences = attachmentReferences(remainingFields, remainingHistory);
  const remaining = {
    ...item,
    credentials: credentials.filter(({ id }) => id !== credentialId),
    fields: remainingFields,
    history: remainingHistory,
    subtitleFieldId: ownedIds.has(item.subtitleFieldId) ? null : item.subtitleFieldId,
    ...(item.attachments ? { attachments: item.attachments.filter(({ id }) => !movedReferences.has(id) || remainingReferences.has(id)) } : {}),
    updatedAt: now,
  };
  return { remaining, credential, fields, history, movedReferences };
}

export function splitCredentialItem(item, credentialId, { newItemId, now }) {
  const { remaining, credential, fields, history, movedReferences } = detachCredential(item, credentialId, now, "站点至少有两把密钥才能拆分");
  const attachments = item.attachments?.filter(({ id }) => movedReferences.has(id)) ?? [];
  const subtitleFieldId = fields.some(({ id }) => id === item.subtitleFieldId) ? item.subtitleFieldId : null;
  const created = {
    id: typeof newItemId === "function" ? newItemId() : newItemId,
    type: credential.type,
    title: credential.label,
    tags: [...item.tags],
    favorite: item.favorite,
    ...(item.site !== undefined ? { site: item.site } : {}),
    credentials: [credential],
    fields,
    history,
    subtitleFieldId,
    ...(attachments.length ? { attachments } : {}),
    expiresAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  return { remaining, created };
}

export function removeCredentialFromItem(item, credentialId, now) {
  return detachCredential(item, credentialId, now, "站点至少保留一把密钥，如需移除请将整个条目移到回收站").remaining;
}
