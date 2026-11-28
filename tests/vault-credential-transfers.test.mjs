import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeCredentialItems,
  promoteCredentials,
  removeCredentialFromItem,
  splitCredentialItem,
} from "../electron/main/vault/credentialTransfers.js";

const original = "2026-10-25T10:00:00.000Z";
const now = "2026-11-28T10:00:00.000Z";
const itemId = (value) => `vi_${value.toString(16).padStart(32, "0")}`;
const fieldId = (value) => `f_${value.toString(16).padStart(8, "0")}`;
const credentialId = (value) => `vc_${value.toString(16).padStart(16, "0")}`;
const attachmentId = (value) => `va_${value.toString(16).padStart(32, "0")}`;
const image = (id) => `![[vault-image:${id}|image.png|封面]]`;
const file = (id) => `![[vault-file:${id}|说明.pdf]]`;

function field(number, kind, value) {
  return { id: fieldId(number), label: kind, kind, value, sensitive: kind !== "text" };
}

function credential(number, fields, overrides = {}) {
  return {
    id: credentialId(number), label: `凭据 ${number}`, type: "login", expiresAt: null,
    fieldIds: fields.map(({ id }) => id), createdAt: original, updatedAt: original, ...overrides,
  };
}

function attachment(number, contents) {
  const bytes = Buffer.from(contents);
  return { id: attachmentId(number), name: "file.png", size: bytes.length, data: bytes.toString("base64") };
}

function item(number, fields, overrides = {}) {
  return {
    id: itemId(number), title: `站点 ${number}`, type: "login", tags: [], favorite: false,
    fields, history: [], subtitleFieldId: null, expiresAt: null, deletedAt: null,
    createdAt: original, updatedAt: original, ...overrides,
  };
}

function freeze(value) {
  if (value && typeof value === "object") {
    for (const member of Object.values(value)) freeze(member);
    Object.freeze(value);
  }
  return value;
}

test("legacy promotion moves expiry and fingerprint while preserving live fields, history and attachments", () => {
  const secret = field(1, "secret", "  原密钥\n ");
  const source = freeze(item(1, [secret], {
    title: `${"界".repeat(199)}😀`,
    expiresAt: "2027-12-01",
    passwordBoxFingerprint: "a".repeat(64),
    history: [{ fieldId: fieldId(22), value: "历史值", changedAt: original }],
    attachments: [attachment(1, "image")],
  }));
  const promoted = promoteCredentials(source, () => credentialId(1));
  assert.deepEqual(promoted.fields, source.fields);
  assert.deepEqual(promoted.history, source.history);
  assert.deepEqual(promoted.attachments, source.attachments);
  assert.equal(promoted.expiresAt, null);
  assert.equal(Object.hasOwn(promoted, "passwordBoxFingerprint"), false);
  assert.deepEqual(promoted.credentials, [credential(1, [secret], {
    label: "界".repeat(199), expiresAt: source.expiresAt, sourceFingerprints: [source.passwordBoxFingerprint],
  })]);
  assert.deepEqual(promoteCredentials(item(2, []), () => credentialId(2)).credentials, [
    credential(2, [], { label: "站点 2", type: "custom" }),
  ]);
});

test("merge remaps colliding IDs and checks each candidate against the progressive target", () => {
  const targetSecret = field(1, "secret", "target-secret");
  const targetOrphanHistory = { fieldId: fieldId(5), value: "保留历史", changedAt: original };
  const target = freeze(item(1, [targetSecret], {
    credentials: [credential(1, [targetSecret])],
    history: [targetOrphanHistory],
    attachments: [attachment(1, "target-image")],
    tags: Array.from({ length: 50 }, (_, index) => `Tag ${index}`),
    expiresAt: "2027-04-01",
  }));
  const sourceSecret = field(1, "secret", ` \n${image(attachmentId(1))}\n `);
  const sourceNote = field(2, "multiline", `\t${image(attachmentId(1))} \r\n\`\`\`\n${image(attachmentId(1))}\r\n\`\`\`\n末尾 `);
  const duplicateSecret = field(3, "secret", sourceSecret.value);
  const duplicateNote = field(4, "multiline", file(attachmentId(2)));
  const sharedField = field(5, "text", "来源共享副标题");
  const sharedNote = field(6, "multiline", file(attachmentId(3)));
  const source = freeze(item(2, [sharedField, sourceSecret, sourceNote, duplicateSecret, duplicateNote, sharedNote], {
    credentials: [credential(1, [sourceSecret, sourceNote]), credential(2, [duplicateSecret, duplicateNote])],
    history: [
      { fieldId: sourceSecret.id, value: "仍然保留的历史密钥", changedAt: original },
      { fieldId: sourceNote.id, value: `旧笔记\n${file(attachmentId(1))}`, changedAt: original },
      { fieldId: duplicateNote.id, value: "重复凭据的私有备注", changedAt: original },
    ],
    attachments: [attachment(1, "source-image"), attachment(2, "discarded"), attachment(3, "shared"), attachment(4, "unreferenced")],
    tags: ["PasswordBox", "来源标签"], favorite: true, subtitleFieldId: sharedField.id, expiresAt: "2027-03-01",
  }));
  const fieldIds = [fieldId(2), fieldId(7), fieldId(8)];
  const credentialIds = [credentialId(2), credentialId(3)];
  const attachmentIds = [attachmentId(3), attachmentId(5)];
  const seen = [];
  const merged = mergeCredentialItems(target, source, {
    newFieldId: () => fieldIds.shift(), newCredentialId: () => credentialIds.shift(), newAttachmentId: () => attachmentIds.shift(), now,
    isDuplicate(currentTarget, candidateSource, candidate) {
      seen.push(currentTarget.credentials.length);
      const secret = candidateSource.fields.find(({ id, kind }) => candidate.fieldIds.includes(id) && kind === "secret");
      return currentTarget.fields.some(({ kind, value }) => kind === "secret" && value === secret.value);
    },
  });
  assert.deepEqual(seen, [1, 2]);
  assert.deepEqual(merged.credentials.map(({ id, fieldIds }) => [id, fieldIds]), [
    [credentialId(1), [targetSecret.id]], [credentialId(3), [fieldId(7), sourceNote.id]],
  ]);
  assert.deepEqual(merged.fields, [
    targetSecret, { ...sharedField, id: fieldId(8) }, { ...sourceSecret, id: fieldId(7) },
    { ...sourceNote, value: sourceNote.value.replace(image(attachmentId(1)), image(attachmentId(5))) }, sharedNote,
  ]);
  assert.deepEqual(merged.history, [
    targetOrphanHistory, { ...source.history[0], fieldId: fieldId(7) },
    { ...source.history[1], value: `旧笔记\n${file(attachmentId(5))}` },
  ]);
  assert.deepEqual(merged.attachments, [target.attachments[0], { ...source.attachments[0], id: attachmentId(5) }, ...source.attachments.slice(2)]);
  assert.deepEqual(merged.tags, [...target.tags.slice(0, 49), "PasswordBox"]);
  assert.equal(merged.id, target.id);
  assert.equal(merged.favorite, true);
  assert.equal(merged.subtitleFieldId, fieldId(8));
  assert.equal(merged.expiresAt, source.expiresAt);
  assert.equal(merged.updatedAt, now);
});

test("optional attachment dedupe compares bytes and rewrites only the matching attachment reference", () => {
  const targetNote = field(1, "multiline", image(attachmentId(1)));
  const target = freeze(item(1, [targetNote], { credentials: [credential(1, [targetNote])], attachments: [attachment(1, "same")] }));
  const sourceNote = field(2, "multiline", `${image(attachmentId(2))}\n${file(attachmentId(3))}`);
  const source = freeze(item(2, [sourceNote], {
    credentials: [credential(2, [sourceNote])], attachments: [attachment(2, "same"), attachment(3, "diff")],
  }));
  const merged = mergeCredentialItems(target, source, { now, dedupeAttachmentBytes: true });
  assert.deepEqual(merged.attachments, [target.attachments[0], source.attachments[1]]);
  assert.equal(merged.fields[1].value, `${image(attachmentId(1))}\n${file(attachmentId(3))}`);
});

test("split and delete retain shared attachments and remove only data owned by the selected credential", () => {
  const movedTitle = field(1, "text", "账号");
  const movedNote = field(2, "multiline", `${image(attachmentId(1))}\n${file(attachmentId(2))}`);
  const remainingNote = field(3, "multiline", image(attachmentId(3)));
  const sharedNote = field(4, "multiline", file(attachmentId(2)));
  const moving = credential(1, [movedTitle, movedNote], { type: "apiKey", expiresAt: "2027-03-01" });
  const staying = credential(2, [remainingNote]);
  const source = freeze(item(1, [movedTitle, movedNote, remainingNote, sharedNote], {
    credentials: [moving, staying],
    site: { name: "示例", url: "https://example.invalid/", siteKey: "example.invalid" },
    subtitleFieldId: movedTitle.id,
    expiresAt: "2027-01-01",
    tags: ["站点标签"], favorite: true,
    history: [
      { fieldId: movedNote.id, value: image(attachmentId(5)), changedAt: original },
      { fieldId: remainingNote.id, value: file(attachmentId(2)), changedAt: original },
      { fieldId: fieldId(9), value: "旧版已删除字段的历史", changedAt: original },
    ],
    attachments: Array.from({ length: 5 }, (_, index) => attachment(index + 1, `bytes-${index}`)),
  }));
  const { remaining, created } = splitCredentialItem(source, moving.id, { newItemId: itemId(2), now });
  assert.deepEqual(remaining.fields, [remainingNote, sharedNote]);
  assert.deepEqual(remaining.credentials, [staying]);
  assert.deepEqual(remaining.history, source.history.slice(1));
  assert.deepEqual(remaining.attachments, [source.attachments[1], source.attachments[2], source.attachments[3]]);
  assert.equal(remaining.subtitleFieldId, null);
  assert.equal(remaining.expiresAt, source.expiresAt);
  assert.equal(created.id, itemId(2));
  assert.equal(created.title, moving.label);
  assert.equal(created.type, moving.type);
  assert.equal(created.expiresAt, null);
  assert.deepEqual(created.credentials, [moving]);
  assert.deepEqual(created.fields, [movedTitle, movedNote]);
  assert.deepEqual(created.history, [source.history[0]]);
  assert.deepEqual(created.attachments, [source.attachments[0], source.attachments[1], source.attachments[4]]);
  assert.deepEqual(created.site, source.site);
  assert.deepEqual(created.tags, source.tags);
  assert.equal(created.subtitleFieldId, source.subtitleFieldId);
  assert.deepEqual(removeCredentialFromItem(source, moving.id, now), remaining);
  assert.throws(() => removeCredentialFromItem(source, credentialId(3), now), { code: "E_NOT_FOUND" });
  assert.throws(() => removeCredentialFromItem(remaining, staying.id, now), { code: "E_CONFLICT" });
  assert.throws(() => splitCredentialItem(remaining, staying.id, { newItemId: itemId(3), now }), { code: "E_CONFLICT" });
});
