import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createVaultTestContext, TEST_PASSWORD, createMarkers, vaultTenItems, vaultItemInputs } from "./fixtures/vault-items.mjs";
import { lastTwoGroups } from "../electron/main/vault/recoveryKey.js";

test("reopening an installed restored vault pushes only locked existence status", async (context) => {
  const original = createVaultTestContext(context);
  const { recoveryKey } = await original.service.create({ password: TEST_PASSWORD });
  original.service.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(recoveryKey) });
  original.service.createItem({ input: vaultItemInputs()[0] });
  original.service.lock();
  original.service.closeDatabase();
  const restored = createVaultTestContext(context);
  const statuses = [];
  const unsubscribe = restored.service.onStatusChanged((status) => statuses.push(status));
  context.after(unsubscribe);
  assert.equal(restored.service.status().exists, false);
  fs.copyFileSync(original.file, restored.file);
  restored.service.reopenDatabase();
  assert.deepEqual(statuses, [{ exists: true, locked: true }]);
  await restored.service.unlock({ password: TEST_PASSWORD });
  assert.equal(restored.service.list().summaries.length, 1);
  assert.deepEqual(statuses.at(-1), { exists: true, locked: false });
});

test("ten vault backup inputs retain seven original types and unique tracked markers", () => {
  const markers = createMarkers();
  const inputs = vaultTenItems(markers);
  assert.equal(inputs.length, 10);
  assert.deepEqual(inputs.slice(0, 7).map((input) => input.type), ["login", "apiKey", "server", "database", "secureNote", "recoveryCodes", "custom"]);
  assert.deepEqual(inputs.slice(7).map((input) => input.type), ["login", "secureNote", "custom"]);
  assert.equal(inputs[7].favorite, true);
  assert.match(inputs[8].title, /中文备份 · Unicode/);
  assert.deepEqual(inputs[9].tags, ["测试", "备份"]);
  const serialized = JSON.stringify(inputs);
  assert.equal(new Set(markers.all()).size, markers.all().length);
  for (const marker of markers.all()) assert.ok(serialized.includes(marker));
});
