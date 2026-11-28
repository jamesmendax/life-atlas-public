import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { VAULT_METHODS, registerVaultIpc, vaultChannel } from "../electron/main/ipc/vault.js";

const documented = [
  "status", "create", "confirmRecoveryKey", "copyPendingRecoveryKey", "saveRecoveryKit", "unlock", "unlockWithRecoveryKey", "lock", "resetVault",
  "list", "getItem", "createItem", "updateItem", "addCredential", "updateCredential", "deleteCredential", "mergeSiteItems", "splitCredential",
  "trashItem", "restoreItem", "deleteItemPermanently", "revealField", "copyField", "openFieldUrl", "getTotp",
  "generatePassword", "changePassword", "regenerateRecoveryKey", "updateSettings", "activity", "confirmRequest", "rejectRequest",
  "getHistory", "revealHistory", "copyHistory", "restoreHistory", "securityReport", "importBrowserCsv", "commitBrowserCsvImport", "importPasswordBoxBackup",
  "pickAttachments", "discardAttachmentDraft", "readAttachmentPreview", "saveAttachmentCopy",
];

function setup(getTheme) {
  const handlers = new Map(); const calls = []; const service = Object.fromEntries(documented.map((method) => [method, (args) => { calls.push({ method, args }); return {}; }]));
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler), removeHandler: (channel) => handlers.delete(channel) };
  registerVaultIpc({ ipcMain, service, confirmRequests: { confirm: service.confirmRequest, reject: service.rejectRequest }, getVaultWindowId: () => 8, getTheme });
  return { handlers, calls };
}

test("every documented vault channel is registered", () => {
  const { handlers } = setup(); assert.deepEqual([...handlers.keys()].sort(), documented.map(vaultChannel).sort()); assert.deepEqual([...VAULT_METHODS].sort(), documented.sort());
});

test("calls from other windows are forbidden", async () => {
  const { handlers, calls } = setup();
  for (const handler of handlers.values()) assert.equal((await handler({ sender: { id: 3 } }, {})).error.code, "E_FORBIDDEN");
  assert.equal(calls.length, 0);
});

test("invalid arguments are rejected before reaching the service", async () => {
  const { handlers, calls } = setup(); const frame = { routingId: 1, processId: 2 }; const event = { sender: { id: 8, mainFrame: frame }, senderFrame: frame };
  for (const [method, args] of [["unlock", { password: 1 }], ["updateItem", { id: "not-id", patch: {} }], ["createItem", { input: { type: "unknown" } }], ["updateSettings", { patch: { autoLockMinutes: 2 } }], ["revealField", { id: "vi_" + "0".repeat(32), fieldId: "wrong" }], ["generatePassword", { options: { length: 2 } }], ["status", { extra: true }], ["commitBrowserCsvImport", { importId: "a", rowIndexes: [0, 0], deleteSourceFile: true }]]) assert.equal((await handlers.get(vaultChannel(method))(event, args)).error.code, "E_INVALID_ARGUMENT");
  assert.equal(calls.length, 0);
});

test("subframes cannot use the vault bridge", async () => {
  const { handlers, calls } = setup();
  const result = await handlers.get("la:vault:status")({ sender: { id: 8, mainFrame: { routingId: 1, processId: 2 } }, senderFrame: { routingId: 4, processId: 2 } });
  assert.equal(result.error.code, "E_FORBIDDEN"); assert.equal(calls.length, 0);
});

test("PasswordBox import accepts only the password from the vault main frame", async () => {
  const { handlers, calls } = setup();
  const method = "importPasswordBoxBackup";
  const handler = handlers.get(vaultChannel(method));
  const frame = { routingId: 1, processId: 2 };
  const event = { sender: { id: 8, mainFrame: frame }, senderFrame: frame };
  const password = " Synthetic fixture 密码 ";
  assert.equal((await handler({ ...event, senderFrame: { ...frame, routingId: 4 } }, { password })).error.code, "E_FORBIDDEN");
  for (const args of [{}, { password: "" }, { password: "x".repeat(4097) }, { password, filePath: "backup.json" }, { password, entries: [] }]) {
    assert.equal((await handler(event, args)).error.code, "E_INVALID_ARGUMENT");
  }
  assert.equal(calls.length, 0);
  assert.ok((await handler(event, { password })).ok);
  assert.deepEqual(calls, [{ method, args: { password } }]);
});

test("credential mutations accept only validated arguments from the vault main frame", async () => {
  const { handlers, calls } = setup();
  const frame = { routingId: 1, processId: 2 };
  const event = { sender: { id: 8, mainFrame: frame }, senderFrame: frame };
  const subframe = { ...event, senderFrame: { ...frame, routingId: 4 } };
  const id = "vi_" + "0".repeat(32);
  const otherId = "vi_" + "1".repeat(32);
  const credentialId = "vc_" + "2".repeat(16);
  const attachmentId = "va_" + "3".repeat(32);
  const attachmentDraftId = "vad_" + "4".repeat(32);
  const field = { label: "密码", kind: "secret", sensitive: true };
  const credential = { label: "工作账号", type: "login", expiresAt: "2027-01-01", fields: [{ ...field, value: "Synthetic secret" }], attachmentDraftId };
  const patch = { fields: [{ ...field, id: "f_01234567", keepValue: true }], removeAttachmentIds: [attachmentId] };
  const validCalls = [
    ["addCredential", { id, credential }],
    ["updateCredential", { id, credentialId, patch }],
    ["deleteCredential", { id, credentialId }],
    ["mergeSiteItems", { targetId: id, sourceIds: [otherId] }],
    ["splitCredential", { id, credentialId }],
  ];
  const invalidCalls = [
    ["addCredential", { id, credential: { ...credential, sourceFingerprints: ["synthetic"] } }],
    ["addCredential", { id, credential: { ...credential, attachmentDraftId: "fixture.png" } }],
    ["updateCredential", { id, credentialId, patch: { ...patch, fields: [{ ...patch.fields[0], value: "" }] } }],
    ["updateCredential", { id, credentialId, patch: { attachments: [{ id: attachmentId, data: "aabb" }] } }],
    ["deleteCredential", { id, credentialId: "f_01234567" }],
    ["mergeSiteItems", { targetId: id, sourceIds: [] }],
    ["mergeSiteItems", { targetId: id, sourceIds: [id] }],
    ["mergeSiteItems", { targetId: id, sourceIds: [otherId, otherId] }],
    ["mergeSiteItems", { targetId: id, sourceIds: [credentialId] }],
    ["mergeSiteItems", { targetId: id, sourceIds: new Array(51).fill(otherId) }],
    ["splitCredential", { id, credentialId, newId: otherId }],
  ];
  for (const [method, args] of validCalls) assert.equal((await handlers.get(vaultChannel(method))(subframe, args)).error.code, "E_FORBIDDEN");
  for (const [method, args] of invalidCalls) assert.equal((await handlers.get(vaultChannel(method))(event, args)).error.code, "E_INVALID_ARGUMENT");
  assert.deepEqual(calls, []);
  for (const [method, args] of validCalls) assert.ok((await handlers.get(vaultChannel(method))(event, args)).ok);
  assert.deepEqual(calls, validCalls.map(([method, args]) => ({ method, args })));
});

test("the native theme snapshot is supplied only to the vault main frame", async () => {
  let reads = 0;
  const { handlers } = setup(() => { reads++; return "dark"; });
  const handler = handlers.get(vaultChannel("status"));
  const frame = { routingId: 1, processId: 2 };
  assert.equal((await handler({ sender: { id: 7, mainFrame: frame }, senderFrame: frame })).error.code, "E_FORBIDDEN");
  assert.equal(reads, 0);
  assert.deepEqual(await handler({ sender: { id: 8, mainFrame: frame }, senderFrame: frame }), { ok: true, value: { theme: "dark" } });
  assert.equal(reads, 1);
});

test("attachment channels accept IDs from the vault main frame and reject file paths and bytes", async () => {
  const { handlers, calls } = setup();
  const frame = { routingId: 1, processId: 2 };
  const event = { sender: { id: 8, mainFrame: frame }, senderFrame: frame };
  const id = `vi_${"0".repeat(32)}`;
  const attachmentId = `va_${"1".repeat(32)}`;
  const draftId = `vad_${"2".repeat(32)}`;
  for (const [method, args] of [
    ["pickAttachments", { path: "any.txt" }],
    ["pickAttachments", { filter: "executable" }],
    ["discardAttachmentDraft", { draftId: "bad-id" }],
    ["readAttachmentPreview", { attachmentId }],
    ["readAttachmentPreview", { id, draftId, attachmentId }],
    ["readAttachmentPreview", { id, attachmentId, filePath: "any.png" }],
    ["saveAttachmentCopy", { id, attachmentId, filePath: "any.txt" }],
    ["saveAttachmentCopy", { attachmentId }],
    ["saveAttachmentCopy", { id, draftId, attachmentId }],
    ["saveAttachmentCopy", { draftId, attachmentId, filePath: "any.txt" }],
    ["updateItem", { id, patch: { attachments: [{ id: attachmentId, data: "aabb" }] } }],
    ["updateItem", { id, patch: { removeAttachmentIds: [attachmentId, attachmentId] } }],
    ["createItem", { input: { type: "secureNote", title: "fixture", fields: [], removeAttachmentIds: [attachmentId] } }],
  ]) assert.equal((await handlers.get(vaultChannel(method))(event, args)).error.code, "E_INVALID_ARGUMENT");
  assert.equal(calls.length, 0);
  for (const [method, args] of [
    ["pickAttachments", { draftId }],
    ["pickAttachments", { draftId, filter: "images" }],
    ["discardAttachmentDraft", { draftId, attachmentId }],
    ["readAttachmentPreview", { id, attachmentId }],
    ["readAttachmentPreview", { draftId, attachmentId }],
    ["saveAttachmentCopy", { id, attachmentId }],
    ["saveAttachmentCopy", { draftId, attachmentId }],
    ["createItem", { input: { type: "secureNote", title: "fixture", fields: [], attachmentDraftId: draftId } }],
    ["updateItem", { id, patch: { attachmentDraftId: draftId, removeAttachmentIds: [attachmentId] } }],
  ]) assert.ok((await handlers.get(vaultChannel(method))(event, args)).ok);
  assert.equal(calls.length, 9);
});

test("preload exposes exactly the documented functions", async () => {
  let api;
  const invokes = [], subscriptions = [], removals = [];
  vm.runInNewContext(fs.readFileSync(new URL("../electron/preload/vault.cjs", import.meta.url), "utf8"), { require: () => ({
    contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, "lifeAtlasVault"); api = value; } },
    ipcRenderer: {
      invoke: async (channel) => { invokes.push(channel); return { ok: true, value: {} }; },
      on: (channel, listener) => subscriptions.push({ channel, listener }),
      removeListener: (channel, listener) => removals.push({ channel, listener }),
    },
  }) });
  assert.deepEqual(Object.keys(api).sort(), [...documented, "locale", "getContrastPreference", "onContrastPreferenceChanged", "onLocked", "onSettingsChanged", "onThemeChanged", "onConfirmRequest"].sort());
  assert.deepEqual(Object.keys(api.locale).sort(), ["get", "onChanged"]);
  assert.equal(Object.isFrozen(api.locale), true);
  for (const method of documented) await api[method]({});
  await api.getContrastPreference();
  await api.locale.get();
  assert.deepEqual(invokes.sort(), [...documented.map(vaultChannel), "la:appearance:get-contrast", "la:locale:get"].sort());
  const unsubscribe = api.onContrastPreferenceChanged(() => {});
  const unsubscribeLocale = api.locale.onChanged(() => {});
  assert.deepEqual(subscriptions.map(({ channel }) => channel), ["la:appearance:contrast-changed", "la:locale:changed"]);
  unsubscribe();
  unsubscribeLocale();
  assert.deepEqual(removals, subscriptions);
});
