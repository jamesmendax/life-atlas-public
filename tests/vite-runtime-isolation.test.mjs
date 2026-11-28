import test from "node:test";
import assert from "node:assert/strict";
import config from "../vite.config.mjs";

test("development watcher excludes guarded browser profiles and QA output", () => {
  assert.ok(config.server.watch.ignored.includes("**/.qa/**"));
});
