import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createBackupService } from "../electron/main/backup/index.js";
import { exportFullBackup } from "../electron/main/backup/desktopExport.js";
import { createDialogs } from "../electron/main/dialogs.js";
import { scanPlaintext } from "../tools/scan-plaintext.mjs";
import { sha256File } from "../electron/main/backup/files.js";
import { createDesktopBackupContext, backupVaultFactory, seedBackupVault, readBackupVaultState } from "./desktop/backup-helpers.mjs";
import { REPO_ROOT } from "./desktop/helpers.mjs";
import { runBackupTool } from "../tools/backup-tool.mjs";

const backupPassword = "Backup-Pass-2026!";

async function fixture(context, { encrypted = false } = {}) {
  const value = await createDesktopBackupContext(context, { vaultService: backupVaultFactory({ production: true }) });
  const seeded = await seedBackupVault(value.vaultService);
  const dialogs = createDialogs({ testHooksEnabled: true });
  const filePath = path.join(value.dataRoot, "tool-source.lifeatlas");
  dialogs.state.queue.showSaveDialog.push(filePath);
  const service = createBackupService({ ...value, dialogs, requestFlush: async () => true, requestConfirmation: async () => "confirmed" });
  await service.exportFull({ includeVault: true, encryptPassword: encrypted ? backupPassword : null });
  await service.stop();
  const temporaryRoot = path.join(value.dataRoot, "tool-temp");
  fs.mkdirSync(temporaryRoot);
  const run = (args, extra = {}) => spawnSync(process.execPath, ["tools/backup-tool.mjs", ...args], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, TEMP: temporaryRoot, TMP: temporaryRoot, LIFE_ATLAS_MASTER_PASSWORD: seeded.password, LIFE_ATLAS_BACKUP_PASSWORD: backupPassword, ...extra } });
  return { ...value, seeded, filePath, temporaryRoot, run };
}

test("verify reports ok and problems with exit codes", async (context) => {
  const value = await fixture(context);
  const valid = value.run(["verify", value.filePath]);
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).ok, true);
  const badFile = path.join(value.dataRoot, "not-zip.lifeatlas");
  fs.writeFileSync(badFile, "not a ZIP backup");
  const invalid = value.run(["verify", badFile]);
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(invalid.stdout).ok, false);
  assert.equal(JSON.parse(invalid.stdout).problems[0].code, "NOT_ZIP");
  assert.equal(value.run(["verify"]).status, 2);
});

test("extract writes workspace and assets without vault plaintext", async (context) => {
  const value = await fixture(context);
  const output = path.join(value.dataRoot, "extract-output");
  const result = value.run(["extract", value.filePath, output]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(output, "workspace", "meta.json")), true);
  assert.equal(fs.existsSync(path.join(output, "assets", "index.json")), true);
  assert.equal(fs.existsSync(path.join(output, "vault")), false);
  for (const entry of value.assetStore.list()) assert.deepEqual(await sha256File(path.join(output, "assets", entry.sha256)), await sha256File(value.assetStore.filePath(entry.sha256)));
  assert.equal(await scanPlaintext([output], value.seeded.markers), 0);
  const kept = path.join(output, "keep.txt");
  fs.writeFileSync(kept, "preserve");
  assert.equal(value.run(["extract", value.filePath, output]).status, 2);
  assert.equal(fs.readFileSync(kept, "utf8"), "preserve");
});

test("vault-decrypt refuses without the acknowledgement flag", async (context) => {
  const value = await fixture(context);
  const output = path.join(value.dataRoot, "plaintext.json");
  const result = value.run(["vault-decrypt", value.filePath, output]);
  assert.equal(result.status, 2);
  assert.equal(fs.existsSync(output), false);
});

test("vault-decrypt writes every item with the right master password", async (context) => {
  const value = await fixture(context);
  const output = path.join(value.dataRoot, "plaintext.json");
  const expected = await readBackupVaultState(value.vaultService, value.seeded.ids);
  const result = value.run(["vault-decrypt", value.filePath, output, "--i-understand-plaintext"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /输出文件是明文密码/);
  const items = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(items.length, 10);
  for (const entry of expected.items) {
    const item = items.find((candidate) => candidate.id === entry.id);
    for (const key of ["id", "type", "title", "tags", "favorite", "subtitleFieldId", "expiresAt", "deletedAt", "createdAt", "updatedAt"]) assert.deepEqual(item[key], entry[key], key);
    for (const field of entry.fields) {
      const actual = item.fields.find((candidate) => candidate.id === field.id);
      for (const key of ["id", "label", "kind", "sensitive", "value"]) assert.deepEqual(actual[key], field[key], key);
      assert.deepEqual(item.history.filter((history) => history.fieldId === field.id).map(({ changedAt, value: fieldValue }) => ({ changedAt, value: fieldValue })), field.history.map(({ changedAt, value: fieldValue }) => ({ changedAt, value: fieldValue })));
    }
  }
  assert.equal(result.stdout.includes(value.seeded.password), false);
  assert.equal(result.stderr.includes(value.seeded.password), false);
  assert.equal(value.run(["vault-decrypt", value.filePath, output, "--i-understand-plaintext"]).status, 2);
});

test("help mentions the format documents", () => {
  const result = spawnSync(process.execPath, ["tools/backup-tool.mjs", "--help"], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /04-备份与恢复规格\.md/);
  assert.match(result.stdout, /03-密钥库安全设计\.md/);
  assert.match(result.stdout, /LIFE_ATLAS_BACKUP_PASSWORD/);
  assert.match(result.stdout, /LIFE_ATLAS_MASTER_PASSWORD/);
  assert.match(result.stdout, /命令历史/);
});

test("wrong credentials and missing output parents do not produce plaintext", async (context) => {
  const value = await fixture(context);
  const output = path.join(value.dataRoot, "wrong.json");
  const wrong = value.run(["vault-decrypt", value.filePath, output, "--i-understand-plaintext"], { LIFE_ATLAS_MASTER_PASSWORD: "wrong-master-credential" });
  assert.equal(wrong.status, 2);
  assert.equal(fs.existsSync(output), false);
  const missing = path.join(value.dataRoot, "missing", "plaintext.json");
  assert.equal(value.run(["vault-decrypt", value.filePath, missing, "--i-understand-plaintext"]).status, 2);
  assert.equal(fs.existsSync(path.dirname(missing)), false);
});

test("the ordinary Node tool verifies encrypted backups and cleans decrypted staging", async (context) => {
  const value = await fixture(context, { encrypted: true });
  const result = value.run(["verify", value.filePath]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).summary.encrypted, true);
  assert.deepEqual(fs.readdirSync(value.temporaryRoot), []);
  const wrong = value.run(["verify", value.filePath], { LIFE_ATLAS_BACKUP_PASSWORD: "wrong-backup-credential" });
  assert.equal(wrong.status, 2);
  assert.deepEqual(fs.readdirSync(value.temporaryRoot), []);
});

test("a source changed during extraction returns an integrity exit code and removes partial files", async (context) => {
  const value = await fixture(context);
  const workspace = value.workspaceService.readWorkspace();
  workspace.pages[0].title = "changed after verification";
  const replacement = path.join(value.dataRoot, "replacement.lifeatlas");
  await exportFullBackup({ ...value, db: value.workspaceService.db, workspace, targetPath: replacement });
  const output = path.join(value.dataRoot, "changed-extraction");
  const originalMkdir = fs.mkdirSync;
  let changed = false;
  let written = "";
  fs.mkdirSync = (directory, ...args) => {
    if (path.resolve(directory) === path.resolve(output) && !changed) { changed = true; fs.copyFileSync(replacement, value.filePath); }
    return originalMkdir(directory, ...args);
  };
  let code;
  try { code = await runBackupTool(["extract", value.filePath, output], { stdout: { write: (text) => { written += text; } }, stderr: { write() {} }, temporaryRoot: value.temporaryRoot }); }
  finally { fs.mkdirSync = originalMkdir; }
  assert.equal(changed, true);
  assert.equal(code, 1);
  assert.equal(JSON.parse(written).ok, false);
  assert.equal(JSON.parse(written).problems[0].code, "CORRUPT");
  assert.equal(fs.existsSync(output), false);
});
