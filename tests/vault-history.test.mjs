import test from "node:test";
import assert from "node:assert/strict";
import { lastTwoGroups } from "../electron/main/vault/recoveryKey.js";
import { TEST_PASSWORD, createVaultTestContext, vaultItemInputs } from "./fixtures/vault-items.mjs";

async function ready(context) {
  const { service } = createVaultTestContext(context); const created = await service.create({ password: TEST_PASSWORD }); service.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(created.recoveryKey) });
  const id = service.createItem({ input: vaultItemInputs()[0] }).summary.id; const item = service.getItem({ id }).item; const fieldId = item.fields.find((field) => field.kind === "secret").id;
  const change = (value) => service.updateItem({ id, patch: { fields: item.fields.map((field) => ({ id: field.id, label: field.label, kind: field.kind, sensitive: field.sensitive, ...(field.id === fieldId ? { value } : { keepValue: true }) })) } });
  return { service, id, fieldId, change };
}

test("three password changes leave three history entries", async (context) => {
  const { service, id, fieldId, change } = await ready(context); for (const value of ["first", "second", "third"]) change(value);
  const result = service.getHistory({ id, fieldId }); assert.equal(result.entries.length, 3); assert.equal((await service.revealHistory({ id, fieldId, index: result.entries[0].index })).value, "second");
  assert.ok(result.entries.every((entry) => !Object.hasOwn(entry, "value")));
});

test("restoring an old value adds the current one to history", async (context) => {
  const { service, id, fieldId, change } = await ready(context); change("first"); change("second");
  service.restoreHistory({ id, fieldId, index: 1 }); assert.equal((await service.revealField({ id, fieldId })).value, "first"); assert.equal(service.getHistory({ id, fieldId }).entries.length, 3);
  assert.equal((await service.revealHistory({ id, fieldId, index: 2 })).value, "second");
});

test("history keeps only the ten newest values", async (context) => {
  const { service, id, fieldId, change } = await ready(context); for (let index = 0; index < 25; index += 1) change(`value-${index}`);
  assert.equal(service.getHistory({ id, fieldId }).entries.length, 10); assert.equal((await service.revealHistory({ id, fieldId, index: 0 })).value, "value-14");
});
