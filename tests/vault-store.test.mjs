import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { VAULT_TEST_RUNTIME } from "./fixtures/vault-items.mjs";
import * as store from "../electron/main/vault/vaultStore.js";

function setup(context) {
  fs.mkdirSync(VAULT_TEST_RUNTIME, { recursive: true });
  const directory = fs.mkdtempSync(path.join(VAULT_TEST_RUNTIME, "store-"));
  const file = path.join(directory, "vault.db"); const db = store.openVaultDatabase(file);
  context.after(() => { db.close(); if (!path.resolve(directory).startsWith(`${path.resolve(VAULT_TEST_RUNTIME)}${path.sep}`)) throw new Error("unsafe cleanup"); fs.rmSync(directory, { recursive: true, force: true }); });
  return { db, file };
}

test("vault database uses wal, full sync and secure delete", (context) => {
  const { db } = setup(context);
  assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
  assert.equal(db.prepare("PRAGMA synchronous").get().synchronous, 2);
  assert.equal(db.prepare("PRAGMA secure_delete").get().secure_delete, 1);
});

test("header items and state round trip", (context) => {
  const { db } = setup(context); const header = { kind: "test" }; const blob = Buffer.from("ciphertext");
  store.writeHeader(db, header); store.putItemBlob(db, "id", blob); store.setState(db, "state", "value");
  assert.deepEqual(store.readHeader(db), header); assert.deepEqual(store.getItemBlob(db, "id"), blob); assert.deepEqual(store.listItemIds(db), ["id"]); assert.equal(store.getState(db, "state"), "value");
});

test("a failed transaction leaves the database unchanged", (context) => {
  const { db, file } = setup(context); store.writeHeader(db, { before: true }); db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const before = fs.readFileSync(file);
  assert.throws(() => store.inTransaction(db, () => { store.writeHeader(db, { after: true }); store.putItemBlob(db, "id", Buffer.from("changed")); throw new Error("fail"); }));
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); assert.deepEqual(fs.readFileSync(file), before); assert.deepEqual(store.listItemIds(db), []);
});
