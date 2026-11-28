import test from "node:test";
import assert from "node:assert/strict";
import { BASE_BACKUP_COLLECTIONS, BACKUP_COLLECTIONS, requiredCollections, isSafeBackupPath, compressionForMime } from "../src/backup/format.js";
import { sha256Hex } from "../src/backup/hash.js";
import { PNG_1X1_BASE64 } from "./fixtures/full-workspace.mjs";

test("backup collections follow the architecture whitelist", () => {
  assert.deepEqual(BASE_BACKUP_COLLECTIONS, ["folders", "pages", "dataSources", "databaseItems", "databaseViews", "relations", "syncedSources", "attachments", "people", "pageTemplates", "databaseTemplates", "discussions", "comments"]);
  assert.deepEqual(requiredCollections(10), BASE_BACKUP_COLLECTIONS);
  assert.deepEqual(requiredCollections(16), [...BASE_BACKUP_COLLECTIONS, "pageVersions"]);
  assert.deepEqual(requiredCollections(19), [...BASE_BACKUP_COLLECTIONS, "pageVersions"]);
  assert.deepEqual(requiredCollections(20), [...BASE_BACKUP_COLLECTIONS, "pageVersions", "databaseVersions"]);
  assert.deepEqual(BACKUP_COLLECTIONS, requiredCollections(20));
});
test("safe backup paths accept the documented shapes", () => {
  for (const filePath of ["manifest.json", "workspace/entities/pages.jsonl", `assets/${"a".repeat(64)}`]) assert.equal(isSafeBackupPath(filePath), true);
});
test("unsafe backup paths are rejected", () => {
  for (const filePath of ["../evil.txt", "/abs", "assets\\evil", "C:/x", "assets/../x", "", "assets//x", "assets/%2e%2e/x", null]) assert.equal(isSafeBackupPath(filePath), false);
});
test("compression follows the mime table", () => {
  for (const mime of ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "audio/ogg", "application/pdf", "application/zip"]) assert.equal(compressionForMime(mime), "STORE");
  for (const mime of ["image/svg+xml", "application/json", "text/plain", "application/pdf-not-really"]) assert.equal(compressionForMime(mime), "DEFLATE");
});
test("sha256Hex matches the known PNG fixture hash", async () => {
  assert.equal(await sha256Hex(Buffer.from(PNG_1X1_BASE64, "base64")), "c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77");
});
