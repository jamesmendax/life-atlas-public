import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BACKUP_FORMAT_VERSION } from "../src/backup/format.js";
import { CURRENT_SCHEMA_VERSION } from "../src/persistence/migrations.js";
import { CONTAINER_MAGIC, ENCRYPTED_CONTAINER_FORMAT_VERSION } from "../electron/main/backup/encryptedContainer.js";
import { KDF_PARAMS } from "../electron/main/vault/crypto.js";
import { VAULT_FORMAT_VERSION } from "../electron/main/vault/vaultStore.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixtures = path.join(root, "tests/fixtures/compatibility");
const manifests = fs.readdirSync(fixtures, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => JSON.parse(fs.readFileSync(path.join(fixtures, entry.name, "fixture.json"), "utf8")));

const args = process.argv.slice(2);
if (args.length) {
  assert.ok(args.length === 2 && args[0] === "--baseline" && /^[0-9a-f]{40,64}$/i.test(args[1]), "Expected --baseline <commit>");
  const paths = ["tests/fixtures/compatibility", ":(exclude)tests/fixtures/compatibility/README.md", ":(exclude,glob)tests/fixtures/compatibility/*/generate.mjs"];
  const diff = spawnSync("git", ["diff", "--name-only", "--no-renames", "--diff-filter=CDMRTUXB", args[1], "HEAD", "--", ...paths], { cwd: root, encoding: "utf8" });
  if (diff.error) throw diff.error;
  assert.equal(diff.status, 0, diff.stderr);
  assert.equal(diff.stdout.trim(), "", `已发行版本的兼容样本被修改或删除。请添加新的样本目录。\n${diff.stdout}`);
}

const matchesWriter = manifests.some(({ formats }) =>
  formats.workspaceSchemaVersion === CURRENT_SCHEMA_VERSION && formats.backupManifestVersion === BACKUP_FORMAT_VERSION &&
  formats.vault.formatVersion === VAULT_FORMAT_VERSION && formats.encryptedContainer.formatVersion === ENCRYPTED_CONTAINER_FORMAT_VERSION &&
  formats.encryptedContainer.magicHex === CONTAINER_MAGIC.toString("hex") &&
  Object.entries(KDF_PARAMS).every(([key, value]) => formats.encryptedContainer.kdf[key] === value && formats.vault.kdf[key] === value));
assert.ok(matchesWriter, "当前写入格式缺少冻结样本。请保留原有样本，添加能验证新格式的备份与密钥库。");

const names = ["legacy-data-compatibility.test.mjs", "storage-format-preflight.test.mjs", "snapshot-compatibility.test.mjs", "assistant-config-compatibility.test.mjs", "legacy-conversion.test.mjs",
  ...fs.readdirSync(path.join(root, "tests")).filter((name) => /^migration-v\d+\.test\.mjs$/.test(name)).sort()];
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...names.map((name) => path.join("tests", name))], { cwd: root, stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
