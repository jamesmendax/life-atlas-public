import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { installTestHooks } from "../electron/main/testHooks.js";
import { resolveFlavor, areTestHooksEnabled } from "../electron/main/flavor.js";
import { createIsolatedDirectory, removeIsolatedDirectory, isolatedElectronEnv } from "./desktop/helpers.mjs";

function preserveHookGlobals(context) {
  const names = ["__lifeAtlasTest", "__lifeAtlasNetworkLog", "__lifeAtlasDialogs"];
  const previous = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  context.after(() => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
}

test("test startup clock preserves the real injected clock when no override exists", (context) => {
  preserveHookGlobals(context);
  let current = 1000;
  const hooks = installTestHooks({ enabled: true, now: () => current, env: {} });
  assert.equal(hooks.clock.now(), 1000);
  current = 2000;
  assert.equal(hooks.clock.now(), 2000);
  assert.equal(globalThis.__lifeAtlasTest, hooks);
});

test("test startup clock uses a finite valid epoch before any service can load", (context) => {
  preserveHookGlobals(context);
  for (const value of [0, -1, Date.parse("2026-10-01T08:00:00.000Z"), 8640000000000000, -8640000000000000]) {
    const hooks = installTestHooks({ enabled: true, now: () => { throw new Error("Startup override must precede the real clock"); }, env: { LIFE_ATLAS_TEST_CLOCK_MS: String(value) } });
    assert.equal(hooks.clock.now(), value);
    assert.equal(new Date(hooks.clock.now()).getTime(), value);
  }
});

test("test startup clock rejects invalid epochs without installing partial globals", (context) => {
  preserveHookGlobals(context);
  const baseline = installTestHooks({ enabled: true, now: () => 1000, env: {} });
  const network = globalThis.__lifeAtlasNetworkLog;
  const dialogs = globalThis.__lifeAtlasDialogs;
  for (const value of ["", " ", "NaN", "Infinity", "-Infinity", "invalid", "8640000000000001", "-8640000000000001", "2026-10-01T08:00:00.000Z", null, 1000]) {
    assert.throws(() => installTestHooks({ enabled: true, env: { LIFE_ATLAS_TEST_CLOCK_MS: value } }), { name: "TypeError", message: "测试时间无效" });
    assert.equal(globalThis.__lifeAtlasTest, baseline);
    assert.equal(globalThis.__lifeAtlasNetworkLog, network);
    assert.equal(globalThis.__lifeAtlasDialogs, dialogs);
  }
});

test("release and unauthorized flavors never read the test startup clock environment", (context) => {
  preserveHookGlobals(context);
  const sentinel = {};
  globalThis.__lifeAtlasTest = sentinel;
  for (const [isPackaged, packageJson, authorized] of [[true, { lifeAtlasFlavor: "release" }, "1"], [true, { lifeAtlasFlavor: "dev" }, "1"], [true, { lifeAtlasFlavor: "test" }, "0"], [false, {}, "0"]]) {
    const flavor = resolveFlavor({ isPackaged, packageJson });
    const env = { LIFE_ATLAS_TEST: authorized, get LIFE_ATLAS_TEST_CLOCK_MS() { throw new Error("Unauthorized clock environment was read"); } };
    assert.equal(installTestHooks({ enabled: areTestHooksEnabled(flavor, env), env }), null);
    assert.equal(globalThis.__lifeAtlasTest, sentinel);
  }
});

test("only authorized unpackaged and test flavors accept the startup clock", (context) => {
  preserveHookGlobals(context);
  const instant = Date.parse("2026-10-01T08:00:00.000Z");
  for (const [isPackaged, packageJson] of [[false, {}], [true, { lifeAtlasFlavor: "test" }]]) {
    const env = { LIFE_ATLAS_TEST: "1", LIFE_ATLAS_TEST_CLOCK_MS: String(instant) };
    const flavor = resolveFlavor({ isPackaged, packageJson });
    const hooks = installTestHooks({ enabled: areTestHooksEnabled(flavor, env), env });
    assert.equal(hooks.clock.now(), instant);
  }
});

test("isolated Electron tests do not inherit another test startup clock", (context) => {
  const directory = createIsolatedDirectory("clock-env");
  const previous = process.env.LIFE_ATLAS_TEST_CLOCK_MS;
  context.after(() => {
    if (previous === undefined) delete process.env.LIFE_ATLAS_TEST_CLOCK_MS;
    else process.env.LIFE_ATLAS_TEST_CLOCK_MS = previous;
    removeIsolatedDirectory(directory);
  });
  process.env.LIFE_ATLAS_TEST_CLOCK_MS = "1000";
  const options = { dataRoot: directory, bootstrapDir: directory, tempDir: directory };
  assert.equal(isolatedElectronEnv(options).LIFE_ATLAS_TEST_CLOCK_MS, undefined);
  assert.equal(isolatedElectronEnv({ ...options, env: { LIFE_ATLAS_TEST_CLOCK_MS: "2000" } }).LIFE_ATLAS_TEST_CLOCK_MS, "2000");
});

test("test clock mutations reject invalid dates and preserve their last valid time", (context) => {
  preserveHookGlobals(context);
  const hooks = installTestHooks({ enabled: true, now: () => 1000, env: {} });
  hooks.clock.set(2000);
  hooks.clock.advance(-500);
  assert.equal(hooks.clock.now(), 1500);
  for (const value of [NaN, Infinity, -Infinity, 8640000000000001, "1000", null]) {
    assert.throws(() => hooks.clock.set(value), { name: "TypeError", message: "测试时间无效" });
    assert.equal(hooks.clock.now(), 1500);
  }
  for (const value of [NaN, Infinity, -Infinity, 8640000000000000, "1000", null]) {
    assert.throws(() => hooks.clock.advance(value), { name: "TypeError", message: "测试时间无效" });
    assert.equal(hooks.clock.now(), 1500);
  }
});

test("main test service adapters call the exact snapshot and backup schedule services only with hooks", async () => {
  const source = fs.readFileSync(new URL("../electron/main/index.js", import.meta.url), "utf8");
  const block = source.match(/if \(testHooks\) \{\s+testHooks\.requestConfirmation[\s\S]*?\n  \}/)?.[0];
  assert.ok(block, "Main service test adapters must stay inside the test hook guard");
  assert.equal(source.match(/testHooks\.schedule\s*=/g)?.length, 1);
  let snapshotChecks = 0;
  let scheduleChecks = 0;
  const expectedSnapshot = { created: true, id: "snapshot-test" };
  const expectedSchedule = { ran: true, filePath: "task-owned-scheduled-backup.lifeatlas" };
  const requestConfirmation = () => "confirmed";
  const services = { requestConfirmation, snapshotService: { checkNow: async () => { snapshotChecks += 1; return expectedSnapshot; } }, backupService: { schedule: { checkNow: async () => { scheduleChecks += 1; return expectedSchedule; } } } };
  const hooks = {};
  vm.runInNewContext(block, { testHooks: hooks, ...services });
  assert.equal(hooks.requestConfirmation, requestConfirmation);
  assert.equal(await hooks.snapshots.checkNow(), expectedSnapshot);
  assert.equal(await hooks.schedule.checkNow(), expectedSchedule);
  assert.equal(snapshotChecks, 1);
  assert.equal(scheduleChecks, 1);
  vm.runInNewContext(block, { testHooks: null });
  assert.equal(snapshotChecks, 1);
  assert.equal(scheduleChecks, 1);
});
