import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BACKUP_COLLECTIONS } from "../src/backup/format.js";
import { checkWorkspaceIntegrity } from "../src/domain/integrity.js";
import { upgradeWorkspace } from "../src/persistence/migrations.js";
import { createVaultService } from "../electron/main/vault/index.js";
import { KDF_PARAMS } from "../electron/main/vault/crypto.js";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";
import { seedVault } from "./desktop/seed-vault.mjs";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";
import { bigWorkspace } from "./fixtures/big-workspace.mjs";
import { releaseWorkspace } from "./fixtures/release-workspace.mjs";
import { createMarkers, TEST_PASSWORD, vaultItemInputs } from "./fixtures/vault-items.mjs";

test("release workspace merges both fixtures without duplicate ids", () => {
  const full = upgradeWorkspace(fullWorkspace());
  const big = upgradeWorkspace(bigWorkspace());
  const workspace = releaseWorkspace();
  for (const collection of BACKUP_COLLECTIONS) {
    const fullIds = new Set(full[collection].map((entity) => entity.id));
    const additions = big[collection].filter((entity) => !fullIds.has(entity.id));
    const expectedIds = [...fullIds, ...additions.map((entity) => entity.id)];
    const actualIds = workspace[collection].map((entity) => entity.id);
    assert.equal(workspace[collection].length, full[collection].length + additions.length, collection);
    assert.equal(new Set(actualIds).size, actualIds.length, `${collection}: duplicate ids`);
    assert.deepEqual(actualIds, expectedIds, `${collection}: exact ordered union`);
    assert.deepEqual(workspace[collection].slice(0, full[collection].length), full[collection], `${collection}: preserved full fixture`);
  }
  assert.equal(workspace.pages.length, full.pages.length + big.pages.length);
  assert.equal(workspace.folders.filter((folder) => folder.system === "inbox").length, 1);
  for (const [id, title] of [["big-p-4321", "性能检索目标一"], ["big-p-17", "性能检索目标二"], ["big-p-2500", "性能检索目标三"]]) {
    assert.equal(workspace.pages.find((page) => page.id === id)?.title, title);
  }
  const metadata = (value) => Object.fromEntries(Object.entries(value).filter(([name]) => !BACKUP_COLLECTIONS.includes(name)));
  assert.deepEqual(metadata(workspace), metadata(full));
  assert.deepEqual(workspace.ui, full.ui);
  assert.equal(workspace.workspaceId, full.workspaceId);
  const integrity = checkWorkspaceIntegrity(workspace);
  assert.deepEqual(integrity.problems.filter((problem) => problem.severity === "error"), []);
  assert.equal(integrity.ok, true);
});

test("the vault seed helper creates a locked confirmed vault", { timeout: 120000 }, async (context) => {
  const dataRoot = createIsolatedDirectory("release-fixture-vault");
  context.diagnostic(`dataRoot=${dataRoot}`);
  context.after(() => removeIsolatedDirectory(dataRoot));
  const inputs = vaultItemInputs(createMarkers());
  const result = await seedVault(dataRoot, { password: TEST_PASSWORD, inputs });
  assert.deepEqual(Object.keys(result), ["recoveryKey"]);
  assert.equal(typeof result.recoveryKey, "string");
  assert.ok(result.recoveryKey.length > 20);
  assert.equal(fs.existsSync(path.join(dataRoot, "vault.db")), true);
  const service = createVaultService({ dataRoot });
  try {
    const status = service.status();
    assert.equal(status.exists, true);
    assert.equal(status.locked, true);
    assert.equal(status.recoveryConfirmed, true);
    const ciphertext = service.exportCiphertext();
    const { saltB64, ...kdf } = ciphertext.header.kdf;
    assert.deepEqual(kdf, KDF_PARAMS);
    assert.equal(Buffer.from(saltB64, "base64").length, 16);
    assert.equal(ciphertext.items.length, inputs.length);
    assert.throws(() => service.list(), { code: "E_LOCKED" });
  } finally { service.lock("app-quit"); service.closeDatabase(); }
});
