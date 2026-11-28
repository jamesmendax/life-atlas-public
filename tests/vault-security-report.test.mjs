import test from "node:test";
import assert from "node:assert/strict";
import { scanPlaintext } from "../tools/scan-plaintext.mjs";
import { lastTwoGroups } from "../electron/main/vault/recoveryKey.js";
import { TEST_PASSWORD, RFC_SHA1_BASE32, createVaultTestContext } from "./fixtures/vault-items.mjs";

async function setup(context) {
  const fixture = createVaultTestContext(context); const created = await fixture.service.create({ password: TEST_PASSWORD }); fixture.service.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(created.recoveryKey) });
  const create = (title, password, totp = "") => fixture.service.createItem({ input: { type: "login", title, tags: [], favorite: false, subtitleFieldId: null, expiresAt: null, fields: [{ label: "密码", kind: "secret", value: password, sensitive: true }, { label: "两步验证", kind: "totp", value: totp, sensitive: true }] } }).summary.id;
  return { ...fixture, create };
}

test("weak passwords have a positive and a negative example", async (context) => {
  const { service, create } = await setup(context); const weak = create("Weak", "123"); const strong = create("Strong", "Lighthouse-Cedar-48"); const report = service.securityReport(); assert.ok(report.weak.includes(weak)); assert.ok(!report.weak.includes(strong));
});

test("reused secrets have a positive and a negative example", async (context) => {
  const { service, create } = await setup(context); const first = create("First", "Shared-Example-48"); const second = create("Second", "Shared-Example-48"); const unique = create("Unique", "Different-Example-73");
  const reused = service.securityReport().reused; assert.deepEqual(new Set(reused[0]), new Set([first, second])); assert.ok(!reused.flat().includes(unique));
});

test("stale passwords have a positive and a negative example", async (context) => {
  const { service, create, fake } = await setup(context); const old = create("Old", "Old-Example-Password-48"); fake.clock.set(fake.clock.now() + 366 * 86400000); const fresh = create("Fresh", "Fresh-Example-Password-73"); const report = service.securityReport(); assert.ok(report.stale.includes(old)); assert.ok(!report.stale.includes(fresh));
});

test("missing totp has a positive and a negative example", async (context) => {
  const { service, create } = await setup(context); const missing = create("Missing", "Example-Password-48"); const present = create("Present", "Example-Password-73", RFC_SHA1_BASE32); const report = service.securityReport(); assert.ok(report.noTotp.includes(missing)); assert.ok(!report.noTotp.includes(present));
});

test("the report is never written to disk", async (context) => {
  const { service, create, dataRoot } = await setup(context); const marker = "LA-MARKER-security-report-plaintext"; create("Item", marker); assert.ok(service.securityReport().noTotp.length > 0); service.lock(); service.closeDatabase(); assert.equal(await scanPlaintext([dataRoot], [marker]), 0);
});
