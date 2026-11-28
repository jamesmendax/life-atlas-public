import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTripProvider, registerTripProviderIpc } from "../electron/main/tripProvider.js";

test("personal settings isolate profiles, revoke old grants and recover a corrupt local file", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-trip-profile-"));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const database = new Map();
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const token = randomBytes(32);
      database.set(token.toString("hex"), value);
      return token;
    },
    decryptString: token => database.get(token.toString("hex")),
  };
  const file = path.join(root, "A", "maps", "amap.json");
  const a = createTripProvider({file, safeStorage});
  const b = createTripProvider({file:path.join(root, "B", "maps", "amap.json"), safeStorage});
  const first = randomBytes(16).toString("hex"), replacement = randomBytes(16).toString("hex");
  assert.equal(a.status().configured, false);
  assert.throws(() => a.set({key:"invalid"}), {code:"E_INVALID_ARGUMENT"});
  a.set({key:first});
  assert.equal(b.access().key, "");
  assert.equal(fs.readFileSync(file).includes(first), false);
  const grant = a.access();
  assert.equal(grant.key, first);
  assert.equal(JSON.stringify(a.status()).includes(first), false);
  assert.equal(createTripProvider({file, safeStorage}).access().key, first);
  a.set({key:replacement});
  assert.ok(grant.signal.aborted);
  assert.ok(a.access().revision > grant.revision);
  assert.equal(a.access().key, replacement);
  fs.writeFileSync(file, "bad metadata");
  assert.throws(() => a.status(), {code:"E_CORRUPT"});
  a.set({clear:true});
  assert.equal(a.status().searchProvider, "nominatim");
  assert.equal(a.access().key, "");
  assert.equal(fs.existsSync(file), false);
});

test("only the trusted workspace frame can manage personal map keys", () => {
  const frame = {routingId:1,processId:1}, sender = {id:7,mainFrame:frame};
  const handlers = new Map();
  let calls = 0;
  registerTripProviderIpc({
    ipcMain:{handle:(name, cb) => handlers.set(name,cb)}, getWindow:() => ({webContents:sender}),
    provider:{set:() => { calls++; return {configured:true}; }},
  });
  const update = handlers.get("la:trip:set-provider");
  assert.equal(update({sender,senderFrame:{routingId:2,processId:1}}, {clear:true}).error.code, "E_FORBIDDEN");
  assert.equal(calls,0);
  assert.deepEqual(update({sender,senderFrame:frame}, {clear:true}).value, {configured:true});
});
