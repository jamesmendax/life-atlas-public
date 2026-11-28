import test from "node:test";
import assert from "node:assert/strict";
import config from "../vite.config.mjs";

test("desktop fonts remain local files under the vault self-only CSP", () => {
  assert.equal(config.build.assetsInlineLimit, 0);
  assert.deepEqual(Object.keys(config.build.rollupOptions.input), ["index", "vault", "setup", "markdown-preview"]);
});
