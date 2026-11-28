import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { test } from "node:test";
import { lastTwoGroups } from "../electron/main/vault/recoveryKey.js";
import { createVaultTestContext, TEST_PASSWORD, vaultItemInputs } from "./fixtures/vault-items.mjs";

const sourcePassword = "PasswordBox fixture only · 不用于日常";
const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=";
const entry = {
  id: "old-synthetic-01",
  title: "迁移测试",
  website: "示例网站",
  url: "https://example.invalid/",
  username: "fixture-account",
  secret: "  synthetic-only \r\n 测试 🔑 ",
  notes: "旧备注",
  tags: ["示例"],
  expiresAt: "2027-01-01",
  sourceText: " 原始 OCR ",
  imageDataUrl: `data:image/png;base64,${image}`,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function seal(key, content) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  return {
    iv: iv.toString("base64"),
    data: Buffer.concat([cipher.update(content), cipher.final(), cipher.getAuthTag()]).toString("base64"),
  };
}

function fixtureBackup(file, entries) {
  const salt = randomBytes(16);
  const dataKey = randomBytes(32);
  const passwordKey = pbkdf2Sync(sourcePassword, salt, 600000, 32, "sha256");
  fs.writeFileSync(file, JSON.stringify({
    kind: "encrypted-key-vault-backup",
    meta: {
      version: 1, kdf: "PBKDF2-SHA256", iterations: 600000, salt: salt.toString("base64"),
      passwordWrappedKey: seal(passwordKey, dataKey),
    },
    cipher: seal(dataKey, Buffer.from(JSON.stringify({ version: 1, entries }))),
  }));
}

async function ready(context) {
  let selected;
  const { service, file, open } = createVaultTestContext(context, {
    dialogs: { showOpenDialog: async () => selected ? { filePaths: [selected] } : { canceled: true } },
  });
  const recovery = await service.create({ password: TEST_PASSWORD });
  service.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(recovery.recoveryKey) });
  const backupPath = path.join(path.dirname(file), "passwordbox-fixture.json");
  return { service, open, file, backupPath, choose: (filename) => { selected = filename; } };
}

test("merges without altering existing items, preserves sensitive fields and image, and deduplicates reimports", async (context) => {
  const { service, open, file, backupPath, choose } = await ready(context);
  const unrelated = vaultItemInputs()[0];
  unrelated.fields.find(({ kind }) => kind === "url").value = "https://unrelated.invalid/";
  const original = service.createItem({ input: unrelated }).summary;
  const originalBefore = service.getItem({ id: original.id }).item;
  fixtureBackup(backupPath, [entry]);
  choose(backupPath);
  assert.deepEqual(await service.importPasswordBoxBackup({ password: sourcePassword }), {
    total: 1, importedCount: 1, createdCount: 1, mergedCount: 0, duplicateCount: 0,
  });
  assert.deepEqual(service.getItem({ id: original.id }).item, originalBefore);
  const imported = service.list().summaries.find(({ id }) => id !== original.id);
  const item = service.getItem({ id: imported.id }).item;
  assert.equal(item.createdAt, entry.createdAt);
  assert.equal(item.updatedAt, entry.updatedAt);
  assert.equal(imported.expiresAt, entry.expiresAt);
  assert.equal(item.credentials[0].expiresAt, entry.expiresAt);
  assert.deepEqual(item.tags, ["PasswordBox", "示例"]);
  assert.equal(item.passwordBoxFingerprint, undefined);
  const secret = item.fields.find(({ label }) => label === "密钥");
  assert.equal(secret.masked, true);
  assert.equal(secret.value, undefined);
  assert.equal((await service.revealField({ id: item.id, fieldId: secret.id })).value, entry.secret);
  const notes = item.fields.find(({ label }) => label === "原备注");
  assert.equal(notes.masked, true);
  assert.equal((await service.revealField({ id: item.id, fieldId: notes.id })).value, entry.notes);
  const [attachment] = item.attachments;
  assert.equal(attachment.data, undefined);
  assert.equal((await service.readAttachmentPreview({ id: item.id, attachmentId: attachment.id })).dataUrl, entry.imageDataUrl);
  assert.deepEqual(await service.importPasswordBoxBackup({ password: sourcePassword }), {
    total: 1, importedCount: 0, createdCount: 0, mergedCount: 0, duplicateCount: 1,
  });
  await service.lock();
  service.closeDatabase();
  assert.equal(fs.readFileSync(file).includes(Buffer.from("synthetic-only")), false);
  const reopened = open();
  await reopened.unlock({ password: TEST_PASSWORD });
  assert.equal(reopened.list().summaries.length, 2);
});

test("cancellation, wrong password, and a failed later record leave the vault unchanged", async (context) => {
  const { service, backupPath, choose } = await ready(context);
  const original = service.createItem({ input: vaultItemInputs()[0] }).summary;
  assert.deepEqual(await service.importPasswordBoxBackup({ password: sourcePassword }), { cancelled: true });
  fixtureBackup(backupPath, [entry, { ...entry, id: "late-invalid", secret: "different secret", expiresAt: "definitely-not-a-date" }]);
  choose(backupPath);
  await assert.rejects(service.importPasswordBoxBackup({ password: "wrong fixture password" }), { code: "E_INVALID_ARGUMENT" });
  await assert.rejects(service.importPasswordBoxBackup({ password: sourcePassword }), { code: "E_INVALID_ARGUMENT" });
  assert.deepEqual(service.list().summaries, [original]);
  assert.equal(service.exportCiphertext().items.length, 1);
});

test("deduplicates by current scope, normalized account and exact secret without writing duplicate metadata", async (context) => {
  const { service, backupPath, choose } = await ready(context);
  const first = { ...entry, secret: "Exact\r\n令", username: "  Owner@Example.test  " };
  const duplicate = {
    ...first, id: "different-id", title: "different title", updatedAt: "2026-02-10T00:00:00.000Z",
    username: "owner@example.test", notes: "ignore this different duplicate note", tags: ["忽略此标签"],
  };
  const differingCase = { ...first, id: "case", title: "Different case", secret: "exact\r\n令" };
  const differingWhitespace = { ...first, id: "space", title: "Different whitespace", secret: "Exact\n令 " };
  fixtureBackup(backupPath, [first, duplicate, differingCase, differingWhitespace]);
  choose(backupPath);
  assert.deepEqual(await service.importPasswordBoxBackup({ password: sourcePassword }), {
    total: 4, importedCount: 3, createdCount: 1, mergedCount: 2, duplicateCount: 1,
  });
  const [summary] = service.list().summaries;
  const { item } = service.getItem({ id: summary.id });
  assert.equal(summary.credentialCount, 3);
  assert.equal(item.attachments.length, 1);
  assert.deepEqual(item.tags, ["PasswordBox", "示例"]);
  for (const [index, original] of [first, differingCase, differingWhitespace].entries()) {
    const fields = item.fields.filter((field) => item.credentials[index].fieldIds.includes(field.id));
    const password = fields.find((field) => field.kind === "secret");
    const notes = fields.find((field) => field.label === "原备注");
    const imageField = fields.find((field) => field.label === "原图");
    assert.equal((await service.revealField({ id: item.id, fieldId: password.id })).value, original.secret);
    assert.equal((await service.revealField({ id: item.id, fieldId: notes.id })).value, original.notes);
    assert.ok(imageField.value.includes(item.attachments[0].id));
  }
  const before = service.exportCiphertext();
  fixtureBackup(backupPath, [duplicate]);
  assert.deepEqual(await service.importPasswordBoxBackup({ password: sourcePassword }), {
    total: 1, importedCount: 0, createdCount: 0, mergedCount: 0, duplicateCount: 1,
  });
  assert.deepEqual(service.exportCiphertext(), before);
});

test("recognizes existing manual and CSV credentials and allows reimport after trashing", async (context) => {
  const { service, backupPath, choose } = await ready(context);
  const manual = service.createItem({
    input: { type: "login", title: "Manual", fields: [
      { kind: "url", label: "网址", value: "https://manual.invalid/path", sensitive: false },
      { kind: "email", label: "邮箱", value: "OWNER@example.invalid", sensitive: false },
      { kind: "secret", label: "密码", value: "exact manual password", sensitive: true },
      { kind: "multiline", label: "备注", value: "original manual note", sensitive: false },
    ] },
  }).summary;
  const csvPath = path.join(path.dirname(backupPath), "synthetic-browser.csv");
  fs.writeFileSync(csvPath, "name,url,username,password,note\nCSV,https://csv.invalid/login,user,exact CSV password,original CSV note\n");
  choose(csvPath);
  const { importId } = await service.importBrowserCsv();
  await service.commitBrowserCsvImport({ importId, rowIndexes: [0] });
  fixtureBackup(backupPath, [
    { ...entry, url: "https://manual.invalid", username: "  owner@example.invalid ", secret: "exact manual password" },
    { ...entry, id: "csv", url: "https://csv.invalid/other", username: "user", secret: "exact CSV password" },
  ]);
  choose(backupPath);
  let before = service.exportCiphertext();
  assert.deepEqual(await service.importPasswordBoxBackup({ password: sourcePassword }), {
    total: 2, importedCount: 0, createdCount: 0, mergedCount: 0, duplicateCount: 2,
  });
  assert.deepEqual(service.exportCiphertext(), before);
  service.trashItem({ id: manual.id });
  before = service.exportCiphertext().items.find(({ id }) => id === manual.id);
  assert.deepEqual(await service.importPasswordBoxBackup({ password: sourcePassword }), {
    total: 2, importedCount: 1, createdCount: 1, mergedCount: 0, duplicateCount: 1,
  });
  assert.deepEqual(service.exportCiphertext().items.find(({ id }) => id === manual.id), before);
});

test("deduplicates PasswordBox keys against native API key names", async (context) => {
  const { service, backupPath, choose } = await ready(context);
  const url = "https://api.example.invalid/";
  const records = ["Key 名称", "Key名称", "Key Name"].map((label, index) => {
    const username = `prod-gateway-0${index + 1}`;
    const secret = `synthetic-api-key-${index + 1}`;
    service.createItem({ input: {
      type: "apiKey",
      title: `Native API key ${index + 1}`,
      fields: [
        { label, kind: "text", value: username, sensitive: false },
        { label: "API Key", kind: "secret", value: secret, sensitive: true },
        { label: "控制台网址", kind: "url", value: url, sensitive: false },
      ],
    } });
    return { ...entry, id: `imported-key-${index + 1}`, url, username, secret, imageDataUrl: "" };
  });
  const before = service.exportCiphertext();
  fixtureBackup(backupPath, records);
  choose(backupPath);
  assert.deepEqual(await service.importPasswordBoxBackup({ password: sourcePassword }), {
    total: 3, importedCount: 0, createdCount: 0, mergedCount: 0, duplicateCount: 3,
  });
  assert.deepEqual(service.exportCiphertext(), before);
});

test("groups related hosts while keeping private tenants and distinct local ports separate", async (context) => {
  const { service, backupPath, choose } = await ready(context);
  const manual = service.createItem({
    input: { type: "login", title: "OpenAI original", fields: [
      { kind: "url", label: "网址", value: "https://openai.com", sensitive: false },
      { kind: "text", label: "用户名", value: entry.username, sensitive: false },
      { kind: "secret", label: "密码", value: "old value", sensitive: true },
    ] },
  }).summary;
  const { item } = service.getItem({ id: manual.id });
  const oldId = item.fields.find(({ kind }) => kind === "secret").id;
  service.updateItem({
    id: manual.id,
    patch: { fields: item.fields.map(({ id, label, kind, sensitive }) => ({
      id, label, kind, sensitive, ...(id === oldId ? { value: entry.secret } : { keepValue: true }),
    })) },
  });
  const existingHistory = service.getHistory({ id: manual.id, fieldId: oldId });
  fixtureBackup(backupPath, [
    "https://platform.openai.com", "https://a.github.io", "https://b.github.io",
    "http://localhost:3000", "http://localhost:8080",
  ].map((url, index) => ({ ...entry, id: String(index), url, imageDataUrl: "" })));
  choose(backupPath);
  assert.deepEqual(await service.importPasswordBoxBackup({ password: sourcePassword }), {
    total: 5, importedCount: 5, createdCount: 4, mergedCount: 1, duplicateCount: 0,
  });
  const collected = service.list().summaries;
  assert.deepEqual(collected.map(({ siteKey }) => siteKey).sort(), [
    "a.github.io", "b.github.io", "localhost:3000", "localhost:8080", "openai.com",
  ]);
  const grouped = service.getItem({ id: manual.id }).item;
  assert.equal(grouped.credentials.length, 2);
  assert.ok(grouped.credentials[0].fieldIds.includes(oldId));
  assert.deepEqual(service.getHistory({ id: manual.id, fieldId: oldId }), existingHistory);
  assert.equal((await service.revealHistory({ id: manual.id, fieldId: oldId, index: 0 })).value, "old value");
});

test("an exact backup can restore a different old secret after the imported slot was edited", async (context) => {
  const { service, backupPath, choose } = await ready(context);
  fixtureBackup(backupPath, [entry]);
  choose(backupPath);
  await service.importPasswordBoxBackup({ password: sourcePassword });
  const [{ id }] = service.list().summaries;
  const { item } = service.getItem({ id });
  const [slot] = item.credentials;
  service.updateCredential({
    id, credentialId: slot.id,
    patch: { fields: item.fields.map(({ id: fieldId, label, kind, sensitive }) => ({
      id: fieldId, label, kind, sensitive, ...(kind === "secret" ? { value: "new password" } : { keepValue: true }),
    })) },
  });
  assert.deepEqual(await service.importPasswordBoxBackup({ password: sourcePassword }), {
    total: 1, importedCount: 1, createdCount: 0, mergedCount: 1, duplicateCount: 0,
  });
  assert.equal(service.getItem({ id }).item.credentials.length, 2);
});
