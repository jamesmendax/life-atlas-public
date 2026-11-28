import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TEST_PASSWORD, VAULT_TEST_RUNTIME, createVaultTestContext } from "./fixtures/vault-items.mjs";

test("recovery cards reject internal and hard linked destinations", async (context) => {
  let filePath;
  const { service, dataRoot } = createVaultTestContext(context, { dialogs: { showSaveDialog: async () => ({ canceled: false, filePath }) } });
  const { recoveryKey } = await service.create({ password: TEST_PASSWORD });
  filePath = path.join(dataRoot, "internal.html");
  await assert.rejects(service.saveRecoveryKit(), { code: "E_INVALID_ARGUMENT" }); assert.equal(fs.existsSync(filePath), false);
  const destination = fs.mkdtempSync(path.join(VAULT_TEST_RUNTIME, "recovery-card-"));
  context.after(() => {
    if (!path.resolve(destination).startsWith(`${path.resolve(VAULT_TEST_RUNTIME)}${path.sep}`)) throw new Error("recovery card cleanup escaped runtime");
    fs.rmSync(destination, { recursive: true, force: true });
  });
  const original = path.join(dataRoot, "do-not-overwrite.txt"); fs.writeFileSync(original, "untouched");
  filePath = path.join(destination, "linked.html"); fs.linkSync(original, filePath);
  await assert.rejects(service.saveRecoveryKit(), { code: "E_INVALID_ARGUMENT" }); assert.equal(fs.readFileSync(original, "utf8"), "untouched");
  filePath = path.join(destination, "ordinary.html");
  await service.saveRecoveryKit(); assert.ok(fs.readFileSync(filePath, "utf8").includes(recoveryKey));
});
