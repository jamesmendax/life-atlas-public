import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { closeApp, createIsolatedDirectory, launchApp, removeIsolatedDirectory } from "./desktop/helpers.mjs";

test("desktop startup overlaps ownership collection but awaits verification before returning", () => {
  const body = launchApp.toString();
  const capture = body.indexOf("ownershipResult = captureOwnership()");
  const load = body.indexOf("if (deferred) await app.evaluate");
  const verified = body.indexOf("const ownership = await ownershipResult");
  const returned = body.indexOf("return { app, page");
  assert.ok(capture >= 0 && capture < load);
  assert.ok(load < verified && verified < returned);
  assert.match(body, /if \(!ownership\.ok\) throw ownership\.error/);
  assert.match(body, /if \(ownershipResult\) await ownershipResult/);
  assert.match(body, /if \(!processOwnership\) await captureOwnership/);
});

test("asynchronous ownership collection uses the same exact Windows identity query", () => {
  const source = fs.readFileSync(new URL("./desktop/helpers.mjs", import.meta.url), "utf8");
  assert.match(source, /execFileSync\(\.\.\.windowsProcessQuery\(pids\)\)/);
  assert.match(source, /execFile\(\.\.\.windowsProcessQuery\(pids\),/);
  assert.match(source, /const records = await readWindowsProcessRecordsAsync\(\[\.\.\.new Set\(\[identity\.mainPid, launcherPid\]\)\]\)/);
  assert.match(source, /assert\.ok\(main && launcher,/);
  assert.match(source, /selectOwnedTestProcesses\(records, ownership\)/);
});

test("normal self-exit cleanup uses the launcher captured before Playwright disconnected", async (context) => {
  const dataRoot = createIsolatedDirectory("closed-handle-data");
  const bootstrapDir = createIsolatedDirectory("closed-handle-bootstrap");
  const tempDir = createIsolatedDirectory("closed-handle-temp");
  context.after(() => {
    for (const directory of [dataRoot, bootstrapDir, tempDir]) if (fs.existsSync(directory)) removeIsolatedDirectory(directory);
  });
  context.mock.method(console, "log", () => {});
  let closeCalls = 0;
  const handle = {
    launcherProcess: { pid: 101, exitCode: 0, signalCode: null },
    app: {
      process() { throw new Error("The closed Playwright channel no longer resolves its process object"); },
      async close() { closeCalls += 1; },
    },
    dataRoot,
    bootstrapDir,
    tempDir,
  };
  await closeApp(handle, { keepDirs: true });
  assert.equal(closeCalls, 0);
  for (const directory of [dataRoot, bootstrapDir, tempDir]) assert.equal(fs.existsSync(directory), true);
  await closeApp(handle);
  for (const directory of [dataRoot, bootstrapDir, tempDir]) assert.equal(fs.existsSync(directory), false);
});
