import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { aadPasswordWrap, aesGcmDecrypt, deriveKeyArgon2id } from "../electron/main/vault/crypto.js";
import { openItem, sealItem } from "../electron/main/vault/itemCodec.js";
import { lastTwoGroups } from "../electron/main/vault/recoveryKey.js";
import { openVaultDatabase, putItemBlob } from "../electron/main/vault/vaultStore.js";
import { RFC_SHA1_BASE32, TEST_PASSWORD, createVaultTestContext } from "./fixtures/vault-items.mjs";

const siteUrl = "https://credentials.example.com/";
const field = (label, kind, value, sensitive = kind === "secret" || kind === "totp") => ({ label, kind, value, sensitive });
const secret = (value) => field("密码", "secret", value);

async function setup(context, options) {
  const fixture = createVaultTestContext(context, options);
  const { recoveryKey } = await fixture.service.create({ password: TEST_PASSWORD });
  fixture.service.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(recoveryKey) });
  const createLogin = (title, account, password, extra = {}) => fixture.service.createItem({
    input: { type: "login", title, fields: [field("网址", "url", siteUrl), field("用户名", "text", account), secret(password)], ...extra },
  }).summary.id;
  return { ...fixture, createLogin };
}

async function fixtureItemCodec(context, { file, service }) {
  const { header: { vaultId, kdf, wraps } } = service.exportCiphertext();
  const kek = await deriveKeyArgon2id(TEST_PASSWORD, Buffer.from(kdf.saltB64, "base64"), kdf);
  let dek;
  try { dek = aesGcmDecrypt(kek, Buffer.from(wraps.password.blobB64, "base64"), aadPasswordWrap(vaultId, kdf)); }
  finally { kek.fill(0); }
  context.after(() => dek.fill(0));
  return {
    read(id) {
      const { blobB64 } = service.exportCiphertext().items.find((entry) => entry.id === id);
      return openItem(dek, vaultId, id, Buffer.from(blobB64, "base64"));
    },
    write(item) {
      const db = openVaultDatabase(file);
      try { putItemBlob(db, item.id, sealItem(dek, vaultId, item)); }
      finally { db.close(); }
    },
  };
}

// Mirrors the 1.6.0 reader's spread of the item followed by masking its old data containers.
function maskAsVersion160(item) {
  const { passwordBoxFingerprint, ...visibleItem } = item;
  return {
    ...visibleItem,
    fields: item.fields.map((field) => field.sensitive ? {
      id: field.id, label: field.label, kind: field.kind, sensitive: true, masked: true, hasValue: Boolean(field.value),
    } : { ...field }),
    history: item.history.map(({ fieldId, changedAt }) => ({ fieldId, changedAt })),
    ...(item.attachments ? { attachments: item.attachments.map(({ id, name, size }) => ({ id, name, size })) } : {}),
  };
}

test("adding a credential preserves legacy field IDs, value history and fingerprints without leaking to old readers", async (context) => {
  const fixture = await setup(context);
  const { service, createLogin } = fixture;
  const codec = await fixtureItemCodec(context, fixture);
  const oldPassword = "Synthetic-Legacy-Previous-74";
  const currentPassword = "Synthetic-Legacy-Current-93";
  const apiKey = "Synthetic-Child-Key-57";
  const privateNote = "Synthetic-Private-Multiline-63";
  const fingerprint = "a".repeat(64);
  const id = createLogin("Legacy slot", "legacy", oldPassword);
  const legacy = codec.read(id);
  const oldField = legacy.fields.find(({ kind }) => kind === "secret");
  service.updateItem({
    id, patch: { fields: legacy.fields.map((entry) => entry.id === oldField.id ? { ...entry, value: currentPassword } : entry) },
  });
  const before = codec.read(id);
  codec.write({ ...before, passwordBoxFingerprint: fingerprint });

  const { summary, credentialId } = service.addCredential({
    id, credential: { label: "API", type: "apiKey", expiresAt: "2027-03-15", fields: [secret(apiKey), field("私密备注", "multiline", privateNote, true)] },
  });
  const item = codec.read(id);
  const [original, added] = item.credentials;
  assert.equal(summary.credentialCount, 2);
  assert.deepEqual(summary.credentialTypes, ["login", "apiKey"]);
  assert.equal(summary.expiresAt, "2027-03-15");
  assert.equal(added.id, credentialId);
  assert.deepEqual(original.fieldIds, before.fields.map(({ id }) => id));
  assert.deepEqual(original.sourceFingerprints, [fingerprint]);
  assert.deepEqual(item.fields.filter(({ id }) => original.fieldIds.includes(id)), before.fields);
  assert.deepEqual(item.history, before.history);
  assert.deepEqual(await service.revealHistory({ id, fieldId: oldField.id, index: 0 }), { value: oldPassword });

  const oldView = maskAsVersion160(item);
  assert.equal(oldView.credentials.length, 2);
  for (const marker of [oldPassword, currentPassword, apiKey, privateNote]) {
    assert.ok(!JSON.stringify(oldView).includes(marker));
    assert.ok(!JSON.stringify(summary).includes(marker));
  }
  const newView = service.getItem({ id }).item;
  assert.ok(!JSON.stringify(newView).includes(fingerprint));
  assert.ok(!Object.hasOwn(item, "passwordBoxFingerprint"));

  const edits = before.fields.map(({ value, ...entry }) => ({ ...entry, keepValue: true }));
  service.updateCredential({ id, credentialId: original.id, patch: { fields: edits } });
  assert.deepEqual(codec.read(id).credentials[0].sourceFingerprints, [fingerprint]);
  const changed = edits.map((entry) => entry.id === oldField.id ? { ...oldField, value: "Synthetic-Rotated-Secret-33" } : entry);
  service.updateCredential({ id, credentialId: original.id, patch: { fields: changed } });
  assert.ok(!codec.read(id).credentials[0].sourceFingerprints?.includes(fingerprint));
});

test("editing one credential distinguishes keepValue from clearing a value and deleting it removes only its fields and history", async (context) => {
  const { service, createLogin } = await setup(context);
  const id = createLogin("Two logins", "original", "Synthetic-Original-Secret");
  const originalFields = service.getItem({ id }).item.fields;
  const { credentialId } = service.addCredential({ id, credential: { label: "Second", type: "login", fields: [secret("Synthetic-Child-Secret")] } });
  const item = service.getItem({ id }).item;
  const [original, added] = item.credentials;
  const [fieldId] = added.fieldIds;
  const { label, kind, sensitive } = item.fields.find((entry) => entry.id === fieldId);
  const edit = (change) => ({ id: fieldId, label, kind, sensitive, ...change });
  const unchanged = service.exportCiphertext();
  assert.throws(() => service.updateCredential({
    id, credentialId, patch: { fields: [edit({ keepValue: true }), { ...edit({ keepValue: true }), id: original.fieldIds[0] }] },
  }), { code: "E_INVALID_ARGUMENT" });
  assert.deepEqual(service.exportCiphertext(), unchanged);

  const updated = service.updateCredential({ id, credentialId, patch: { label: "Second renamed", fields: [edit({ keepValue: true })] } });
  assert.equal(updated.summary.credentials.find((credential) => credential.id === credentialId).label, "Second renamed");
  assert.deepEqual(await service.revealField({ id, fieldId }), { value: "Synthetic-Child-Secret" });
  assert.deepEqual(service.getHistory({ id, fieldId }).entries, []);
  service.updateCredential({ id, credentialId, patch: { fields: [edit({ value: "" })] } });
  assert.deepEqual(await service.revealField({ id, fieldId }), { value: "" });
  assert.deepEqual(await service.revealHistory({ id, fieldId, index: 0 }), { value: "Synthetic-Child-Secret" });

  const result = service.deleteCredential({ id, credentialId });
  assert.equal(result.summary.credentialCount, 1);
  const remaining = service.getItem({ id }).item;
  assert.deepEqual(remaining.fields, originalFields);
  assert.deepEqual(remaining.history, []);
  assert.throws(() => service.deleteCredential({ id, credentialId: original.id }), { code: "E_CONFLICT" });
  assert.throws(() => service.splitCredential({ id, credentialId: original.id }), { code: "E_CONFLICT" });
});

test("credential attachment drafts commit with their fields, and deletion preserves a shared reference", async (context) => {
  let filePaths;
  const { service, createLogin, dataRoot } = await setup(context, { dialogs: { showOpenDialog: () => ({ filePaths }) } });
  const id = createLogin("Attachment site", "original", "Synthetic-Original-Secret");
  filePaths = ["first.txt", "shared.txt"].map((name) => path.join(dataRoot, name));
  for (const filename of filePaths) fs.writeFileSync(filename, path.basename(filename));
  const { draftId: attachmentDraftId, attachments } = await service.pickAttachments();
  const [exclusive, shared] = attachments;
  const note = field("备注", "multiline", `![[vault-file:${exclusive.id}|first.txt]]\n![[vault-file:${shared.id}|shared.txt]]`);
  const { credentialId } = service.addCredential({ id, credential: { label: "Second", type: "custom", attachmentDraftId, fields: [note] } });
  assert.deepEqual(service.getItem({ id }).item.attachments, attachments);
  assert.throws(() => service.discardAttachmentDraft({ draftId: attachmentDraftId }), { code: "E_NOT_FOUND" });

  service.addCredential({ id, credential: { label: "Third", type: "custom", fields: [{ ...note, value: `![[vault-file:${shared.id}|shared.txt]]` }] } });
  const { credentials } = service.getItem({ id }).item;
  const [noteId] = credentials.find((credential) => credential.id === credentialId).fieldIds;
  filePaths = [path.join(dataRoot, "replacement.txt")];
  fs.writeFileSync(filePaths[0], "replacement fixture");
  const replacementDraft = await service.pickAttachments();
  const [replacement] = replacementDraft.attachments;
  service.updateCredential({
    id, credentialId, patch: {
      fields: [{ ...note, id: noteId, value: `![[vault-file:${replacement.id}|replacement.txt]]\n![[vault-file:${shared.id}|shared.txt]]` }],
      attachmentDraftId: replacementDraft.draftId,
      removeAttachmentIds: [exclusive.id],
    },
  });
  assert.deepEqual(service.getItem({ id }).item.attachments, [shared, replacement]);
  service.deleteCredential({ id, credentialId });
  assert.deepEqual(service.getItem({ id }).item.attachments, [shared]);
});

test("merging remaps collisions and splitting transfers the correct fields, history and attachment references", async (context) => {
  const fixture = await setup(context);
  const { service, createLogin } = fixture;
  const codec = await fixtureItemCodec(context, fixture);
  const targetId = createLogin("Target", "target-user", "Synthetic-Target-Secret", { tags: ["target"] });
  const sourceId = createLogin("Source", "source-user", "Synthetic-Source-Secret", { tags: ["source"], favorite: true });
  const duplicateId = createLogin("Duplicate source", "target-user", "Synthetic-Target-Secret");
  const sharedFieldId = "f_abcdef01";
  const sharedCredentialId = "vc_" + "1".repeat(16);
  const sharedAttachmentId = "va_" + "2".repeat(32);
  for (const id of [targetId, sourceId]) {
    const item = codec.read(id);
    const name = `${item.title}.png`;
    const bytes = Buffer.from(`Synthetic attachment ${item.title}`);
    item.fields.find(({ kind }) => kind === "secret").id = sharedFieldId;
    item.fields.push({
      ...field("附件引用", "multiline", `![[vault-image:${sharedAttachmentId}|${name}]]\n![[vault-file:${sharedAttachmentId}|${name}]]`),
      id: "f_abcdef02",
    });
    item.history = [{ fieldId: sharedFieldId, value: `Synthetic historical ${item.title}`, changedAt: item.createdAt }];
    item.attachments = [{ id: sharedAttachmentId, name, size: bytes.length, data: bytes.toString("base64") }];
    item.credentials = [{
      id: sharedCredentialId, type: "login", label: item.title, expiresAt: null,
      fieldIds: item.fields.map(({ id }) => id), createdAt: item.createdAt, updatedAt: item.updatedAt,
    }];
    codec.write(item);
  }
  const beforeTarget = codec.read(targetId);
  const beforeSource = codec.read(sourceId);
  const merged = service.mergeSiteItems({ targetId, sourceIds: [sourceId, duplicateId] });
  assert.equal(merged.mergedItemsCount, 2);
  assert.equal(merged.summary.credentialCount, 2);
  assert.equal(merged.summary.favorite, true);
  assert.deepEqual(merged.summary.tags, ["target", "source"]);
  assert.deepEqual(service.list().summaries.map(({ id }) => id), [targetId]);
  for (const id of [sourceId, duplicateId]) assert.throws(() => service.getItem({ id }), { code: "E_NOT_FOUND" });

  const combined = codec.read(targetId);
  const [target, source] = combined.credentials;
  const sourceFields = combined.fields.filter(({ id }) => source.fieldIds.includes(id));
  const sourceFieldId = sourceFields.find(({ kind }) => kind === "secret").id;
  const sourceAttachmentId = combined.attachments.find(({ name }) => name === "Source.png").id;
  assert.deepEqual(target, beforeTarget.credentials[0]);
  assert.notEqual(source.id, target.id);
  assert.notEqual(sourceFieldId, sharedFieldId);
  assert.notEqual(sourceAttachmentId, sharedAttachmentId);
  assert.equal(sourceFields.find(({ kind }) => kind === "multiline").value, `![[vault-image:${sourceAttachmentId}|Source.png]]\n![[vault-file:${sourceAttachmentId}|Source.png]]`);
  assert.deepEqual(combined.history, [...beforeTarget.history, { ...beforeSource.history[0], fieldId: sourceFieldId }]);

  const beforeSplit = service.exportCiphertext();
  const beforeSplitList = service.list();
  const db = openVaultDatabase(fixture.file);
  try {
    db.exec(`CREATE TRIGGER reject_new_vault_item BEFORE INSERT ON vault_items
      WHEN NOT EXISTS (SELECT 1 FROM vault_items WHERE id = NEW.id)
      BEGIN SELECT RAISE(ABORT, 'synthetic split write failure'); END`);
    assert.throws(() => service.splitCredential({ id: targetId, credentialId: source.id }), /synthetic split write failure/);
    assert.deepEqual(service.exportCiphertext(), beforeSplit);
    assert.deepEqual(service.list(), beforeSplitList);
  } finally {
    try { db.exec("DROP TRIGGER IF EXISTS reject_new_vault_item"); }
    finally { db.close(); }
  }

  const { summary, createdSummary } = service.splitCredential({ id: targetId, credentialId: source.id });
  assert.equal(summary.credentialCount, 1);
  assert.equal(createdSummary.credentialCount, 1);
  assert.notEqual(createdSummary.id, targetId);
  assert.equal(createdSummary.siteKey, summary.siteKey);
  assert.deepEqual(createdSummary.tags, summary.tags);
  const updated = codec.read(targetId);
  const split = codec.read(createdSummary.id);
  assert.deepEqual(updated.fields, beforeTarget.fields);
  assert.deepEqual(updated.history, beforeTarget.history);
  assert.deepEqual(updated.attachments, beforeTarget.attachments);
  assert.deepEqual(split.fields, sourceFields);
  assert.deepEqual(split.history, [{ ...beforeSource.history[0], fieldId: sourceFieldId }]);
  assert.deepEqual(split.attachments, [{ ...beforeSource.attachments[0], id: sourceAttachmentId }]);
});

test("an over-limit merge rolls back source deletion, target ciphertext and cached summaries", async (context) => {
  const { service, createLogin } = await setup(context);
  const targetId = createLogin("Target", "a", "fixture-initial");
  for (let index = 0; index < 48; index += 1) {
    service.addCredential({ id: targetId, credential: { label: `Slot ${index}`, type: "apiKey", fields: [secret(`fixture-key-${index}`)] } });
  }
  const first = createLogin("First source", "b", "fixture-next");
  const second = createLogin("Second source", "c", "fixture-over-limit");
  const previousBlobs = service.exportCiphertext();
  const previousList = service.list();
  assert.throws(() => service.mergeSiteItems({ targetId, sourceIds: [first, second] }), { code: "E_INVALID_ARGUMENT" });
  assert.deepEqual(service.exportCiphertext(), previousBlobs);
  assert.deepEqual(service.list(), previousList);
  assert.equal(service.mergeSiteItems({ targetId, sourceIds: [first] }).summary.credentialCount, 50);
  assert.throws(() => service.addCredential({ id: targetId, credential: { label: "Over limit", type: "apiKey", fields: [secret("fixture-key-over-limit")] } }), { code: "E_INVALID_ARGUMENT" });
});

test("security reports evaluate each login and detect same-item reuse across distinct credentials", async (context) => {
  const { service, createLogin, fake } = await setup(context);
  const shared = "Synthetic-Shared-Secret-68";
  const apiFields = [secret(shared), field("Token", "secret", shared)];
  const createApi = (title, fields) => service.createItem({ input: { type: "apiKey", title, fields } }).summary.id;
  const siteId = createApi("Mixed credentials", apiFields);
  const freshSiteId = createApi("Fresh login later", [secret("Synthetic-Unique-Key-83")]);
  assert.deepEqual(service.securityReport().reused, []);
  service.addCredential({ id: siteId, credential: { label: "Login", type: "login", fields: [secret(shared), field("两步验证", "totp", RFC_SHA1_BASE32)] } });
  service.addCredential({ id: siteId, credential: { label: "Weak", type: "login", fields: [secret("123")] } });
  service.addCredential({ id: siteId, credential: { label: "Also weak", type: "login", fields: [secret("456")] } });
  const trashed = createLogin("Deleted duplicate", "deleted", shared);
  service.trashItem({ id: trashed });
  fake.clock.set(fake.clock.now() + 366 * 86400000);
  service.addCredential({ id: freshSiteId, credential: { label: "New login", type: "login", fields: [secret("Synthetic-Fresh-Secret-49"), field("两步验证", "totp", RFC_SHA1_BASE32)] } });
  assert.deepEqual(service.securityReport(), { weak: [siteId], reused: [[siteId, siteId]], stale: [siteId], noTotp: [siteId] });
});
