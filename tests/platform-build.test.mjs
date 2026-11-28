import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { parseBuildArguments, desktopBuildCommands, RELEASE_FUSES } from "../scripts/desktop-build.mjs";
import { parseDevArguments, waitForOwnedDevelopmentServer } from "../scripts/desktop-dev.mjs";

function developmentChild(context) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  context.after(() => child.stdout.destroy());
  return child;
}

test("desktop build arguments accept only explicit flavors and an exact semantic version", () => {
  assert.deepEqual(parseBuildArguments(["release"]), { flavor: "release", version: null });
  assert.deepEqual(parseBuildArguments(["test", "--version", "0.2.3"]), { flavor: "test", version: "0.2.3" });
  for (const args of [[], ["dev"], ["test", "--version"], ["test", "--version", "1.2"], ["test", "--version", "1.2.3-beta"], ["release", "--other"], ["release", "--version", "1.2.3", "extra"]]) assert.throws(() => parseBuildArguments(args), { exitCode: 64 });
});

test("test packaging stays unfused and only release receives the eight required fuse values", () => {
  const testCommands = desktopBuildCommands({ flavor: "test", version: null });
  const releaseCommands = desktopBuildCommands({ flavor: "release", version: "0.1.0" });
  assert.deepEqual(testCommands[0], ["node_modules/vite/bin/vite.js", "build"]);
  assert.ok(testCommands[1].includes("dir"));
  assert.ok(testCommands[1].includes("-c.directories.output=release/test"));
  assert.ok(testCommands[1].includes("-c.extraMetadata.lifeAtlasFlavor=test"));
  assert.ok(testCommands[1].every((argument) => !argument.includes("electronFuses")));
  assert.ok(releaseCommands[1].includes("-c.directories.output=release/release"));
  assert.ok(releaseCommands[1].includes("-c.extraMetadata.version=0.1.0"));
  assert.deepEqual(Object.values(RELEASE_FUSES).map((value) => value ? 49 : 48), [48, 49, 48, 48, 49, 49, 48, 48]);
  assert.equal(releaseCommands[1].filter((argument) => argument.includes("electronFuses")).length, 8);
  assert.ok(releaseCommands[1].includes("never"));
});

test("desktop development never accepts a custom or protected port", () => {
  assert.deepEqual(parseDevArguments([]), { smoke: false });
  assert.deepEqual(parseDevArguments(["--smoke"]), { smoke: true });
  for (const args of [["--port", "4173"], ["--port=4175"], ["--smoke", "--other"]]) assert.throws(() => parseDevArguments(args), { exitCode: 64 });
});

test("desktop development probes only after its own Vite announces the exact origin", async (context) => {
  const child = developmentChild(context);
  let probes = 0;
  const ready = waitForOwnedDevelopmentServer(child, { attempts: 50, intervalMs: 1, probe: async (origin) => { probes += 1; assert.equal(origin, "http://127.0.0.1:5199"); return true; } });
  child.stdout.write("  ➜  Local: http://127.0.0.1:4173/\n");
  await new Promise((resolve) => setTimeout(resolve, 3));
  assert.equal(probes, 0);
  child.stdout.write("\u001b[32m  ➜  Lo");
  child.stdout.write("cal: http://127.0.0.1:5199/\u001b[39m\n");
  await ready;
  assert.equal(probes, 1);
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.listenerCount("error"), 0);
});

test("desktop development never probes another server when its own port is occupied", async (context) => {
  const child = developmentChild(context);
  let probes = 0;
  const ready = waitForOwnedDevelopmentServer(child, { attempts: 2, intervalMs: 1, probe: async () => { probes += 1; return true; } });
  child.exitCode = 1;
  child.emit("exit", 1);
  await assert.rejects(ready, /本次启动的开发服务已退出/);
  assert.equal(probes, 0);
});

test("desktop development rejects an already exited Vite process", async (context) => {
  const child = developmentChild(context);
  child.exitCode = 1;
  let probes = 0;
  await assert.rejects(waitForOwnedDevelopmentServer(child, { intervalMs: 1, probe: async () => { probes += 1; return true; } }), /本次启动的开发服务已退出/);
  assert.equal(probes, 0);
});

test("desktop development rechecks its owner after an HTTP readiness response", async (context) => {
  const child = developmentChild(context);
  let completeProbe;
  let observedProbe;
  const observed = new Promise((resolve) => { observedProbe = resolve; });
  const ready = waitForOwnedDevelopmentServer(child, { attempts: 2, intervalMs: 1, probe: () => { observedProbe(); return new Promise((resolve) => { completeProbe = resolve; }); } });
  child.stdout.write("  ➜  Local: http://127.0.0.1:5199/\n");
  await observed;
  child.exitCode = 1;
  child.emit("exit", 1);
  completeProbe(true);
  await assert.rejects(ready, /本次启动的开发服务已退出/);
});

test("desktop development times out without accepting an unowned readiness response", async (context) => {
  const child = developmentChild(context);
  let probes = 0;
  await assert.rejects(waitForOwnedDevelopmentServer(child, { attempts: 2, intervalMs: 1, probe: async () => { probes += 1; return true; } }), /未能就绪/);
  assert.equal(probes, 0);
});
