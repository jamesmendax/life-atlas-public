import test from "node:test";
import assert from "node:assert/strict";
import { assertNoNetworkAndErrors } from "./desktop/helpers.mjs";

const malformed = "life-asset://xyz";
const missing = `life-asset://${"0".repeat(64)}`;
const expected = [{ url: malformed, status: 400, count: 1 }, { url: missing, status: 404, count: 1 }];

function diagnostic(url, status) {
  return { url, status, message: `Failed to load resource: the server responded with a status of ${status} (${status === 400 ? "Bad Request" : "Not Found"})` };
}

function handle({ consoleDetails = [diagnostic(malformed, 400), diagnostic(missing, 404)], page = [], completed = [], blocked = [] } = {}) {
  return { app: { evaluate: async () => ({ completed, blocked }) }, errors: { page, console: consoleDetails.map((event) => event.message), consoleDetails } };
}

test("default desktop error assertions still reject deliberate HTTP errors", async () => {
  await assert.rejects(() => assertNoNetworkAndErrors(handle()), { name: "AssertionError" });
});

test("negative protocol tests consume only one exact URL and status diagnostic each", async () => {
  const state = handle();
  const before = structuredClone(state.errors);
  await assertNoNetworkAndErrors(state, { expectedHttpErrors: expected });
  assert.deepEqual(state.errors, before);
});

test("negative protocol tests reject missing wrong URL and wrong status diagnostics", async () => {
  for (const consoleDetails of [[], [diagnostic(malformed, 400)], [diagnostic("life-asset://other", 400), diagnostic(missing, 404)], [diagnostic(malformed, 404), diagnostic(missing, 404)]]) {
    await assert.rejects(() => assertNoNetworkAndErrors(handle({ consoleDetails }), { expectedHttpErrors: expected }), { name: "AssertionError" });
  }
});

test("negative protocol tests reject duplicate and additional console errors", async () => {
  const baseline = [diagnostic(malformed, 400), diagnostic(missing, 404)];
  for (const extra of [diagnostic(malformed, 400), diagnostic(missing, 404), diagnostic("life-asset://unrequested", 404), { url: "app://bundle/index.js", message: "Unexpected application error" }, { url: malformed, status: 400, message: "A script spoofed HTTP 400" }]) {
    await assert.rejects(() => assertNoNetworkAndErrors(handle({ consoleDetails: [...baseline, extra] }), { expectedHttpErrors: expected }), { name: "AssertionError" });
  }
});

test("negative protocol tests never excuse page or completed and blocked network errors", async () => {
  for (const options of [{ page: ["Unexpected page error"] }, { completed: [{ url: "https://example.com/" }] }, { blocked: [{ url: "https://example.com/" }] }]) {
    await assert.rejects(() => assertNoNetworkAndErrors(handle(options), { expectedHttpErrors: expected }), { name: "AssertionError" });
  }
});

test("negative protocol expectations cannot use duplicate declarations wildcards or relaxed counts", async () => {
  for (const expectedHttpErrors of [[...expected, expected[0]], [{ ...expected[0], count: 0 }], [{ ...expected[0], count: 2 }], [{ ...expected[0], url: "life-asset://*" }], [{ ...expected[0], url: "https://example.com/" }], [{ ...expected[0], status: 500 }]]) {
    await assert.rejects(() => assertNoNetworkAndErrors(handle(), { expectedHttpErrors }), { name: "AssertionError" });
  }
});

test("negative protocol expectations require provenance for every console error", async () => {
  const missingProvenance = handle();
  missingProvenance.errors.console.push("Unexpected unrecorded console error");
  const inconsistentProvenance = handle();
  inconsistentProvenance.errors.console[0] = "Unexpected replaced console error";
  for (const state of [missingProvenance, inconsistentProvenance]) await assert.rejects(() => assertNoNetworkAndErrors(state, { expectedHttpErrors: expected }), { name: "AssertionError" });
});
