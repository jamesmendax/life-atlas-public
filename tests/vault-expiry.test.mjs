import test from "node:test";
import assert from "node:assert/strict";
import { expiryState } from "../src/vault-ui/expiry.js";

test("expiry states at 29 days 31 days and past", () => {
  assert.equal(expiryState("2026-12-06", "2026-11-07"), "soon");
  assert.equal(expiryState("2026-12-08", "2026-11-07"), "none");
  assert.equal(expiryState("2026-11-06", "2026-11-07"), "expired");
  assert.equal(expiryState(null, "2026-11-07"), "none");
  assert.equal(expiryState("2026-11-07T23:59:59.000Z", "2026-11-07"), "soon");
});
