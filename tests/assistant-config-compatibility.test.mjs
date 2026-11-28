import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAssistantConfig } from "../electron/main/assistant/config.js";

const syntheticCiphertext = Buffer.from("synthetic OS keystore blob");
const legacy = { baseUrl: "https://model.example.test", model: "demo", encryptedKey: syntheticCiphertext.toString("base64"), configurationId: "12345678-1234-1234-1234-123456789abc" };
const osStore = {
  isEncryptionAvailable: () => true,
  decryptString(ciphertext) { assert.deepEqual(ciphertext, syntheticCiphertext); return "synthetic-credential"; },
  encryptString() { throw new Error("An upgrade must preserve the original ciphertext"); },
};

function example(t, bytes) {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "life-atlas-provider-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "provider.json");
  fs.writeFileSync(file, bytes);
  return { file, config: createAssistantConfig({ configDirectory: directory, safeStorage: osStore }) };
}

test("APEX unversioned provider settings retain the original operating-system credential", (t) => {
  const original = JSON.stringify(legacy);
  const { file, config } = example(t, original);
  assert.equal(config.getProvider().key, "synthetic-credential");
  assert.equal(fs.readFileSync(file, "utf8"), original);
  config.configure({ baseUrl: legacy.baseUrl, model: "another-demo" });
  const updated = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(updated.formatVersion, 1);
  assert.equal(updated.encryptedKey, legacy.encryptedKey);
  assert.equal(config.getProvider().key, "synthetic-credential");
});

for (const [label, bytes, code] of [
  ["unknown format", JSON.stringify({ ...legacy, formatVersion: 99 }), "E_UNSUPPORTED_VERSION"],
  ["damaged JSON", JSON.stringify(legacy).slice(0, -1), "E_CORRUPT"],
]) {
  test(`AI settings leave the credential file intact on ${label}`, (t) => {
    const { file, config } = example(t, bytes);
    assert.throws(() => config.getConfig(), { code });
    assert.throws(() => config.configure({ baseUrl: legacy.baseUrl, model: "demo", clearApiKey: true }), { code });
    assert.equal(fs.readFileSync(file, "utf8"), bytes);
  });
}
