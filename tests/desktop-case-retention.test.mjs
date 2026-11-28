import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { _electron } from "playwright";
import { createBackupDesktopCase } from "./desktop/backup-helpers.mjs";
import { launchApp, removeIsolatedDirectory } from "./desktop/helpers.mjs";

async function preparedCase(retainOnFailure) {
  let cleanup;
  let state;
  const stop = new Error("fixture preparation stops before any launch");
  await assert.rejects(createBackupDesktopCase({ after(callback) { cleanup = callback; } }, {
    retainOnFailure,
    prepare(value) { state = value; throw stop; },
  }), (error) => error === stop);
  return { cleanup, state, roots: [state.dataRoot, state.bootstrapDir] };
}

test("backup cases retain incomplete evidence and clean only after explicit completion", async () => {
  const { cleanup, state, roots } = await preparedCase(true);
  try {
    await cleanup();
    for (const root of roots) assert.equal(fs.existsSync(root), true);
    state.complete();
    await cleanup();
    for (const root of roots) assert.equal(fs.existsSync(root), false);
  } finally {
    for (const root of roots) if (fs.existsSync(root)) removeIsolatedDirectory(root);
  }
});

test("backup case retention is opt in and preserves existing cleanup behavior", async () => {
  const { cleanup, roots } = await preparedCase(false);
  await cleanup();
  for (const root of roots) assert.equal(fs.existsSync(root), false);
});

test("a failed Electron launch preserves its isolated startup evidence", async (context) => {
  const messages = [];
  const failure = new Error("synthetic launch failure before process creation");
  context.mock.method(_electron, "launch", async () => { throw failure; });
  context.mock.method(console, "log", (value) => messages.push(value));
  let roots = [];
  try {
    await assert.rejects(launchApp(), (error) => error === failure);
    const message = messages.find((value) => value.startsWith("LIFE_ATLAS_TEST_STARTUP_RETAINED "));
    assert.ok(message);
    roots = Object.values(JSON.parse(message.slice("LIFE_ATLAS_TEST_STARTUP_RETAINED ".length)));
    assert.equal(roots.length, 3);
    for (const root of roots) assert.equal(fs.existsSync(root), true);
  } finally {
    context.mock.restoreAll();
    for (const root of roots) if (fs.existsSync(root)) removeIsolatedDirectory(root);
  }
});
