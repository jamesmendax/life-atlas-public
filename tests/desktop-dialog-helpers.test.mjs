import test from "node:test";
import assert from "node:assert/strict";
import { answerProductDialog } from "./desktop/helpers.mjs";

function dialogFixture({ missing = false, remainsAttached = false, clickError = null } = {}) {
  const target = { isConnected: true };
  const underlying = { isConnected: true };
  const calls = [];
  const missingError = new Error("The requested dialog is absent");
  const handle = { async dispose() { calls.push("dispose"); } };
  const dialog = {
    async waitFor(options) {
      calls.push({ waitFor: options });
      if (options.state === "visible" && missing) throw missingError;
      if (options.state === "detached" && underlying.isConnected) throw new Error("The live last locator now resolves to the underlying settings dialog");
    },
    async elementHandle() { calls.push("capture"); return handle; },
    locator(selector) {
      return { async click() {
        calls.push({ click: selector });
        if (clickError) throw clickError;
        target.isConnected = remainsAttached;
      } };
    },
  };
  const page = {
    locator(selector) {
      assert.equal(selector, "[data-la-dialog]");
      return { last: () => dialog };
    },
    async waitForFunction(predicate, selected, options) {
      assert.equal(selected, handle);
      assert.equal(options, undefined, "The existing default timeout must not be widened");
      calls.push("wait-original-element");
      assert.equal(typeof predicate(target), "boolean");
      if (!predicate(target)) throw new Error("The original dialog remains attached");
    },
  };
  return { page, calls, target, underlying, missingError };
}

test("answering a nested dialog waits for the originally selected element", async () => {
  const fixture = dialogFixture();
  assert.equal(await answerProductDialog(fixture.page), true);
  assert.equal(fixture.target.isConnected, false);
  assert.equal(fixture.underlying.isConnected, true);
  assert.deepEqual(fixture.calls, [
    { waitFor: { state: "visible", timeout: 5000 } },
    "capture",
    { click: "[data-la-dialog-confirm]" },
    "wait-original-element",
    "dispose",
  ]);
});

test("cancelling a nested dialog preserves the underlying dialog", async () => {
  const fixture = dialogFixture();
  assert.equal(await answerProductDialog(fixture.page, { accept: false }), true);
  assert.equal(fixture.underlying.isConnected, true);
  assert.deepEqual(fixture.calls.find((entry) => entry.click), { click: "[data-la-dialog-cancel]" });
  assert.equal(fixture.calls.at(-1), "dispose");
});

test("a dialog answer cannot pass while the original element remains attached", async () => {
  const fixture = dialogFixture({ remainsAttached: true });
  await assert.rejects(answerProductDialog(fixture.page), /The original dialog remains attached/);
  assert.equal(fixture.target.isConnected, true);
  assert.equal(fixture.calls.at(-1), "dispose");
});

test("the captured dialog handle is released when clicking fails", async () => {
  const clickError = new Error("The confirmation action failed");
  const fixture = dialogFixture({ clickError });
  await assert.rejects(answerProductDialog(fixture.page), (error) => error === clickError);
  assert.equal(fixture.calls.includes("wait-original-element"), false);
  assert.equal(fixture.calls.at(-1), "dispose");
});

test("an absent optional dialog keeps the original short wait", async () => {
  const fixture = dialogFixture({ missing: true });
  assert.equal(await answerProductDialog(fixture.page, { optional: true }), false);
  assert.deepEqual(fixture.calls, [{ waitFor: { state: "visible", timeout: 1000 } }]);
});

test("an absent required dialog keeps the original failure and wait", async () => {
  const fixture = dialogFixture({ missing: true });
  await assert.rejects(answerProductDialog(fixture.page), (error) => error === fixture.missingError);
  assert.deepEqual(fixture.calls, [{ waitFor: { state: "visible", timeout: 5000 } }]);
});
