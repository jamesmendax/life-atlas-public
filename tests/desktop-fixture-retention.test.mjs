import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createDesktopBackupContext } from "./desktop/backup-helpers.mjs";
import { removeIsolatedDirectory } from "./desktop/helpers.mjs";

async function fixtureCase(context, options = {}) {
  const cleanups = [];
  let finished = false;
  let fixture;
  context.after(async () => {
    if (!finished) for (const cleanup of cleanups) await cleanup();
    if (fixture && fs.existsSync(fixture.dataRoot)) removeIsolatedDirectory(fixture.dataRoot);
  });
  fixture = await createDesktopBackupContext({ after(cleanup) { cleanups.push(cleanup); } }, { seed: false, ...options });
  return {
    ...fixture,
    async finish() {
      for (const cleanup of cleanups) await cleanup();
      finished = true;
    },
  };
}

test("backup fixtures keep default cleanup behavior", async (context) => {
  const fixture = await fixtureCase(context);
  assert.equal(fs.existsSync(fixture.dataRoot), true);
  await fixture.finish();
  assert.equal(fs.existsSync(fixture.dataRoot), false);
});

test("opt-in backup fixtures retain an incomplete source", async (context) => {
  const fixture = await fixtureCase(context, { retainOnFailure: true });
  await fixture.finish();
  assert.equal(fs.existsSync(fixture.dataRoot), true);
});

test("completed opt-in backup fixtures clean their source", async (context) => {
  const fixture = await fixtureCase(context, { retainOnFailure: true });
  fixture.complete();
  await fixture.finish();
  assert.equal(fs.existsSync(fixture.dataRoot), false);
});
