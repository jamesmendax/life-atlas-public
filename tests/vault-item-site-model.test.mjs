import test from "node:test";
import assert from "node:assert/strict";
import {
  applyItemPatch, derivedItemSite, maskedItem, summarizeItem, validateCredentialId, validateCredentialInput,
  validateCredentialPatch, validateItemCredentials, validateItemInput, validateItemPatch, validateSiteMergeArguments,
} from "../electron/main/vault/itemModel.js";

const itemId = (index) => `vi_${index.toString(16).padStart(32, "0")}`;
const credentialId = (index) => `vc_${index.toString(16).padStart(16, "0")}`;
const fieldId = (index) => `f_${index.toString(16).padStart(8, "0")}`;
const now = "2026-11-27T12:00:00.000Z";
const field = (index, label, kind, value, sensitive = false) => ({ id: fieldId(index), label, kind, value, sensitive });
const slot = (index, type, indexes, expiresAt = null) => ({
  id: credentialId(index), label: `Key ${index}`, type, expiresAt, fieldIds: indexes.map(fieldId), createdAt: now, updatedAt: now,
});

function item(fields, additions = {}) {
  return {
    id: itemId(1), type: "login", title: "Personal account", tags: [], favorite: false, fields, subtitleFieldId: null,
    expiresAt: null, history: [], deletedAt: null, createdAt: now, updatedAt: now, ...additions,
  };
}

test("legacy site metadata is derived from public fields without mutating the saved item", () => {
  const legacy = item([
    field(1, "url", "url", "https://secret.example.com", true),
    field(2, "控制台网址", "text", "https://console.example.co.jp"),
    field(3, "网站", "text", " Example "),
  ]);
  assert.deepEqual(derivedItemSite(legacy), { name: "Example", url: "https://console.example.co.jp/", siteKey: "example.co.jp" });
  assert.equal(derivedItemSite({ ...legacy, type: "secureNote" }), null);
  assert.equal(derivedItemSite({ ...legacy, site: null }), null);
  assert.equal(derivedItemSite(item([field(1, "网站", "text", "https://console.example.co.jp")])).siteKey, "example.co.jp");
  const summary = summarizeItem(legacy);
  assert.equal(summary.siteKey, "example.co.jp");
  assert.equal(summary.credentialCount, 1);
  assert.deepEqual(summary.credentialTypes, ["login"]);
  assert.deepEqual(summary.credentials, []);
  assert.equal(Object.hasOwn(legacy, "site"), false);
  assert.equal(Object.hasOwn(maskedItem(legacy), "site"), false);
});

test("group summaries scope previews and TOTP to their credentials and use the earliest expiry", () => {
  const grouped = item([
    field(1, "用户名", "secret", "neverExposeSecret", true),
    field(2, "用户名", "text", "neverExposeSensitiveName", true),
    field(3, "用户名", "text", "alice"),
    field(4, "两步验证", "totp", "neverExposeTotp", true),
    field(5, "备注", "multiline", "neverPreviewNote"),
    field(6, "Key 名称", "text", "Staging"),
    field(7, "Host", "text", "login.internal"),
  ], {
    site: { name: "Example", url: "", siteKey: "site:example" },
    subtitleFieldId: fieldId(2),
    expiresAt: "2026-12-31",
    credentials: [slot(1, "login", [1, 2, 3, 4], "2026-12-20"), slot(2, "apiKey", [5, 6], "2026-12-10"), slot(3, "login", [7])],
  });
  const summary = summarizeItem(grouped);
  assert.equal(summary.subtitle, null);
  assert.equal(summary.siteName, "Example");
  assert.equal(summary.expiresAt, "2026-12-10");
  assert.equal(summary.credentialCount, 3);
  assert.deepEqual(summary.credentialTypes, ["login", "apiKey"]);
  assert.deepEqual(summary.credentials.map(({ preview, hasTotp }) => ({ preview, hasTotp })), [
    { preview: "alice", hasTotp: true }, { preview: "Staging", hasTotp: false }, { preview: "login.internal", hasTotp: false },
  ]);
  assert.doesNotMatch(JSON.stringify(summary), /never(Expose|Preview)/);
});

test("masked items expose credential references and omit fingerprints, history values, and attachment bytes", () => {
  const grouped = item([
    field(1, "密码", "secret", "private-field", true),
    { ...field(2, "用户名", "text", "public-user"), extra: "private-field-property" },
  ], {
    credentials: [{ ...slot(1, "login", [1, 2]), sourceFingerprints: ["private-source-fingerprint"], formerValue: "private-slot-property" }],
    history: [{ fieldId: fieldId(1), value: "private-history-value", changedAt: now }],
    attachments: [{ id: "va_00000000000000000000000000000001", name: "picture.png", size: 16, data: "private-attachment-bytes" }],
    site: { name: "Example", url: "", siteKey: "site:example", extra: "private-site-property" },
    passwordBoxFingerprint: "private-fingerprint",
    extra: "private-item-property",
  });
  const result = maskedItem(grouped);
  assert.doesNotMatch(JSON.stringify(result), /private-|Fingerprint/);
  assert.deepEqual(result.credentials, [slot(1, "login", [1, 2])]);
  assert.deepEqual(result.fields[0], { id: fieldId(1), label: "密码", kind: "secret", sensitive: true, masked: true, hasValue: true });
  assert.equal(result.fields[1].value, "public-user");
});

test("model validates public site edits, private ownership, and aggregate slot and field limits", () => {
  const publicField = { label: "用户名", kind: "text", value: "alice", sensitive: false };
  const site = { name: "Example", url: "https://example.com", siteKey: "example.com" };
  validateItemInput({ title: "Example", type: "login", fields: Array(300).fill(publicField), site });
  validateItemPatch({ site: null });
  validateCredentialInput({ label: "custom", type: "custom", fields: [] });
  validateCredentialPatch({ fields: [{ ...publicField, id: fieldId(1), value: undefined, keepValue: true }] });
  validateCredentialId(credentialId(1));
  validateSiteMergeArguments({ targetId: itemId(1), sourceIds: [itemId(2)] });
  assert.throws(() => validateItemInput({ title: "Example", type: "login", fields: Array(301).fill(publicField) }), { code: "E_INVALID_ARGUMENT" });
  assert.throws(() => validateItemPatch({ site: { ...site, url: "https://user:secret@example.com" } }), { code: "E_INVALID_ARGUMENT" });
  assert.throws(() => validateItemPatch({ credentials: [] }), { code: "E_INVALID_ARGUMENT" });
  assert.throws(() => validateCredentialInput({ label: "login", type: "login", fields: [] }), { code: "E_INVALID_ARGUMENT" });
  assert.throws(() => validateCredentialPatch({ expiresAt: "2026-02-30" }), { code: "E_INVALID_ARGUMENT" });
  assert.throws(() => validateSiteMergeArguments({ targetId: itemId(1), sourceIds: [itemId(2), itemId(2)] }), { code: "E_INVALID_ARGUMENT" });
  assert.throws(() => validateSiteMergeArguments({ targetId: itemId(1), sourceIds: [itemId(1)] }), { code: "E_INVALID_ARGUMENT" });

  const fields = Array.from({ length: 300 }, (_, index) => field(index + 1, "username", "text", "alice"));
  const credentials = Array.from({ length: 50 }, (_, index) => slot(index + 1, "login", [index + 1]));
  validateItemCredentials(item(fields, { site, credentials }));
  const invalidCredentials = [
    [...credentials, slot(51, "login", [51])],
    [slot(1, "login", [1]), slot(2, "login", [1])],
    [slot(1, "login", [1, 1])],
    [slot(1, "login", [301])],
    [slot(1, "login", [1]), slot(1, "login", [2])],
    [{ ...slot(1, "login", [1]), fields: [publicField] }],
  ];
  for (const invalid of invalidCredentials) {
    assert.throws(() => validateItemCredentials(item(fields, { credentials: invalid })), { code: "E_INVALID_ARGUMENT" });
  }
});

test("flattened slot patches keep history and protect a retained secret when the field kind changes", () => {
  const grouped = item([
    field(1, "API Key", "secret", "old-value", true),
    field(2, "保存的密钥", "secret", "keep-value", true),
    field(3, "到期日", "date", "2026-12-17"),
  ], { type: "apiKey", credentials: [slot(1, "apiKey", [1, 2]), slot(2, "custom", [3])] });
  const updated = applyItemPatch(grouped, { fields: [
    { ...grouped.fields[0], value: "new-value" },
    { id: fieldId(2), label: "新的名称", kind: "text", sensitive: false, keepValue: true },
    grouped.fields[2],
  ] }, { now, createFieldId: () => fieldId(4) });
  assert.equal(updated.expiresAt, null);
  assert.deepEqual(updated.fields[2], grouped.fields[2]);
  assert.deepEqual(updated.history, [{ fieldId: fieldId(1), value: "old-value", changedAt: now }]);
  assert.equal(updated.fields[1].sensitive, true);
  assert.equal(updated.fields[1].value, "keep-value");
  assert.doesNotMatch(JSON.stringify(maskedItem(updated)), /keep-value/);
});
