import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { KDF_PARAMS } from "../electron/main/vault/crypto.js";
import { lastTwoGroups } from "../electron/main/vault/recoveryKey.js";
import { VAULT_TEST_RUNTIME, TEST_PASSWORD, NEXT_PASSWORD, createMarkers, createVaultTestContext, vaultItemInputs } from "./fixtures/vault-items.mjs";

test("no marker reaches the disk after a full session", async (context) => {
  const markers = createMarkers();
  const fixture = createVaultTestContext(context, { kdfParams: KDF_PARAMS, logger: (event, data) => { fs.mkdirSync(path.join(fixture.dataRoot, "logs"), { recursive: true }); fs.appendFileSync(path.join(fixture.dataRoot, "logs", "events.log"), JSON.stringify({ event, ...data }) + "\n"); } });
  const { service, dataRoot } = fixture; const created = await service.create({ password: TEST_PASSWORD }); service.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(created.recoveryKey) });
  const summaries = vaultItemInputs(markers).map((input) => service.createItem({ input }).summary);
  for (const summary of summaries.slice(0, 3)) {
    const item = service.getItem({ id: summary.id }).item; const secret = item.fields.find((field) => field.sensitive);
    service.updateItem({ id: item.id, patch: { fields: item.fields.map((field) => ({ id: field.id, label: field.label, kind: field.kind, sensitive: field.sensitive, ...(field.id === secret.id ? { value: markers.next() } : { keepValue: true }) })) } });
  }
  service.trashItem({ id: summaries[0].id }); const changed = await service.changePassword({ currentPassword: TEST_PASSWORD, newPassword: NEXT_PASSWORD }); service.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(changed.recoveryKey) });
  service.snapshotTo(path.join(dataRoot, "snapshots", "manual", "vault.db")); service.lock(); service.closeDatabase();
  const markerFile = path.join(VAULT_TEST_RUNTIME, `scan-${path.basename(dataRoot)}.txt`); fs.writeFileSync(markerFile, [...markers.all(), TEST_PASSWORD, NEXT_PASSWORD, created.recoveryKey, changed.recoveryKey].join("\n"));
  context.after(() => fs.unlinkSync(markerFile));
  const scanned = spawnSync(process.execPath, ["tools/scan-plaintext.mjs", dataRoot, "--markers", markerFile], { encoding: "utf8" }); assert.equal(scanned.status, 0, scanned.stdout + scanned.stderr);
});
