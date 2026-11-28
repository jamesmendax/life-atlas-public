import test from "node:test";
import assert from "node:assert/strict";
import { registerAppIpc } from "../electron/main/ipc/app.js";
import { createConfirmRequests } from "../electron/main/vault/confirmRequests.js";
import { DEFAULT_SETTINGS } from "../electron/main/vault/itemModel.js";
import { lastTwoGroups } from "../electron/main/vault/recoveryKey.js";
import { TEST_PASSWORD, createVaultTestContext } from "./fixtures/vault-items.mjs";

const requestedSettings = { autoLockMinutes: 15, clipboardClearSeconds: 60, lockOnMinimize: true, verifyBeforeReveal: true };

function workspaceChannel(requestVaultPreferences) {
  const handlers = new Map();
  const senderFrame = { routingId: 1, processId: 5 };
  const sender = { id: 46, mainFrame: senderFrame };
  registerAppIpc({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, getWorkspaceWindow: () => ({ webContents: sender }), requestVaultPreferences });
  const handle = handlers.get("la:app:request-vault-preferences");
  return { handle, main: { sender, senderFrame } };
}

async function unlockedVault(context) {
  let confirmRequests;
  let delivered = Promise.withResolvers();
  const fixture = createVaultTestContext(context, { requestConfirmation: (request) => confirmRequests.request(request) });
  const { service, fake } = fixture;
  confirmRequests = createConfirmRequests({ verifyPassword: service.verifyPassword, clock: fake.clock, timers: fake.timers, deliver: (request) => delivered.resolve(request) });
  const { recoveryKey } = await service.create({ password: TEST_PASSWORD });
  service.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(recoveryKey) });
  return { service, confirmRequests, nextConfirmation: async () => {
    const request = await delivered.promise;
    delivered = Promise.withResolvers();
    return request;
  } };
}

test("only the workspace main frame can request specifically typed vault preferences", async () => {
  const seen = [];
  const { handle, main } = workspaceChannel(({ patch }) => { seen.push(patch); return { changed: patch }; });
  assert.equal((await handle({ sender: { id: main.sender.id }, senderFrame: main.senderFrame }, { patch: requestedSettings })).error.code, "E_FORBIDDEN");
  assert.equal((await handle({ ...main, senderFrame: { routingId: 9, processId: 5 } }, { patch: requestedSettings })).error.code, "E_FORBIDDEN");
  for (const invalid of [
    undefined, { patch: [] }, { patch: {} }, { patch: null }, { patch: requestedSettings, password: TEST_PASSWORD },
    { patch: { autoLockMinutes: 2 } }, { patch: { clipboardClearSeconds: "60" } }, { patch: { lockOnMinimize: 1 } },
    { patch: { verifyBeforeReveal: undefined } }, { patch: { attachments: true } },
  ]) assert.equal((await handle(main, invalid)).error.code, "E_INVALID_ARGUMENT");
  assert.deepEqual(seen, []);
  assert.deepEqual(await handle(main, { patch: requestedSettings }), { ok: true, value: { changed: requestedSettings } });
  assert.deepEqual(seen, [requestedSettings]);
});

test("the vault shows the requested values and persists them only after the correct master password", async (context) => {
  const { service, confirmRequests, nextConfirmation } = await unlockedVault(context);
  const { handle, main } = workspaceChannel(service.requestVaultPreferences);
  const updates = [];
  const unsubscribe = service.onSettingsChanged((value) => updates.push(value));
  const pending = handle(main, { patch: requestedSettings });
  const prompt = await nextConfirmation();
  assert.equal(prompt.kind, "change-vault-preferences");
  assert.equal(prompt.title, "调整密钥库设置");
  for (const text of ["15 分钟", "60 秒", "开启最小化时上锁", "开启查看敏感内容前的主密码验证"]) assert.ok(prompt.description.includes(text));
  assert.ok(!JSON.stringify(prompt).includes(TEST_PASSWORD));
  assert.deepEqual(service.status().settings, DEFAULT_SETTINGS);
  await assert.rejects(confirmRequests.confirm({ requestId: prompt.requestId, password: "incorrect fixture password" }), { code: "E_BAD_PASSWORD" });
  assert.deepEqual(service.status().settings, DEFAULT_SETTINGS);
  assert.deepEqual(updates, []);
  await confirmRequests.confirm({ requestId: prompt.requestId, password: TEST_PASSWORD });
  assert.deepEqual(await pending, { ok: true, value: { changed: requestedSettings } });
  assert.deepEqual(updates, [requestedSettings]);
  unsubscribe();
  await service.lock();
  await service.unlock({ password: TEST_PASSWORD });
  assert.deepEqual(service.status().settings, requestedSettings);
});

test("canceling and a lock-and-unlock cycle keep pending preferences from being committed", async (context) => {
  const { service, confirmRequests, nextConfirmation } = await unlockedVault(context);
  const { handle, main } = workspaceChannel(service.requestVaultPreferences);
  const rejected = handle(main, { patch: { lockOnMinimize: true } });
  confirmRequests.reject({ requestId: (await nextConfirmation()).requestId });
  assert.equal((await rejected).error.code, "E_CANCELLED");

  const stale = handle(main, { patch: { autoLockMinutes: 1 } });
  const prompt = await nextConfirmation();
  await service.lock();
  const locked = await handle(main, { patch: { verifyBeforeReveal: true } });
  assert.equal(locked.error.code, "E_LOCKED");
  assert.match(locked.error.message, /本机密钥库解锁/);
  await service.unlock({ password: TEST_PASSWORD });
  await confirmRequests.confirm({ requestId: prompt.requestId, password: TEST_PASSWORD });
  assert.equal((await stale).error.code, "E_LOCKED");
  assert.deepEqual(service.status().settings, DEFAULT_SETTINGS);
});
