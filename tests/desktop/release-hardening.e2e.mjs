import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getCurrentFuseWire } from "@electron/fuses";
import { REPO_ROOT, assertTestPath, createIsolatedDirectory, removeIsolatedDirectory } from "./helpers.mjs";
import { assertPhysicalPath } from "../../electron/main/storage/dataRoot.js";
import { startApp, closeAppGracefully, logEvents, waitFor } from "../release/helpers.mjs";
import { tamperAsarHeader, tamperAsarMain } from "../release/asar-tamper.mjs";

const RELEASE_ROOT = path.join(REPO_ROOT, "release/release/win-unpacked");
const RELEASE_EXE = path.join(RELEASE_ROOT, "Life Atlas.exe");

function requireRelease() {
  if (!fs.existsSync(RELEASE_EXE)) throw new Error("请先运行 npm run desktop:build");
  return assertPhysicalPath(RELEASE_EXE, { root: RELEASE_ROOT, allowMissing: false });
}

async function withRelease(label, { copy = false } = {}, callback) {
  const original = requireRelease();
  const root = createIsolatedDirectory(`release-hardening-${label}`);
  let child;
  let reconciled = false;
  let succeeded = false;
  try {
    const destination = assertTestPath(path.join(root, "app"));
    if (copy) fs.cpSync(RELEASE_ROOT, destination, { recursive: true, errorOnExist: true, force: false, filter: (source) => Boolean(assertPhysicalPath(source, { root: RELEASE_ROOT, allowMissing: false })) });
    const executable = copy ? path.join(destination, "Life Atlas.exe") : original;
    const dataRoot = assertTestPath(path.join(root, "data"));
    let output = "";
    const start = (options = {}) => {
      assert.equal(child, undefined, "Only one process belongs to each release probe");
      child = startApp(executable, dataRoot, options);
      child.stdout?.on("data", (bytes) => { output += bytes.toString(); });
      child.stderr?.on("data", (bytes) => { output += bytes.toString(); });
      return child;
    };
    await callback({ root, executable, dataRoot, start, output: () => output });
    if (child) await closeAppGracefully(child);
    reconciled = true;
    succeeded = true;
  } finally {
    try {
      if (child && !reconciled) await closeAppGracefully(child);
    } finally {
      if (succeeded) removeIsolatedDirectory(root);
      else console.log(`RELEASE_HARDENING_RETAINED ${root}`);
    }
  }
}

test("release fuses are set as designed", async () => {
  const wire = await getCurrentFuseWire(requireRelease());
  const states = Array.from({ length: 8 }, (_, index) => wire[index]);
  console.log(`RELEASE_FUSES ${JSON.stringify(states)}`);
  assert.deepEqual(states, [48, 49, 48, 48, 49, 49, 48, 48]);
});

test("the release build ignores ELECTRON_RUN_AS_NODE", { timeout: 60000 }, async () => {
  await withRelease("node-mode", {}, async ({ dataRoot, start, output }) => {
    const child = start({ args: ["-e", "console.log('NODE_MODE_ACTIVE')"], env: { ELECTRON_RUN_AS_NODE: "1" } });
    await delay(8000);
    assert.equal(child.exitCode, null, "The release must remain an application, not run the Node expression");
    assert.equal(child.signalCode, null);
    assert.doesNotMatch(output(), /NODE_MODE_ACTIVE/);
    assert.ok(logEvents(dataRoot).some((event) => event.event === "window.created"));
  });
});

for (const [name, label, mutate, diagnostic] of [
  ["a tampered asar header stops the app", "header", tamperAsarHeader, /Integrity/],
  ["tampered main process code stops the app", "main", tamperAsarMain, /ASAR Integrity Violation/],
]) {
  test(name, { timeout: 60000 }, async () => {
    await withRelease(label, { copy: true }, async ({ executable, start, output }) => {
      const change = mutate(path.join(path.dirname(executable), "resources/app.asar"));
      console.log(`RELEASE_TAMPER ${label} ${JSON.stringify(change)}`);
      const started = Date.now();
      const child = start();
      await waitFor(() => child.exitCode !== null || child.signalCode !== null, { timeoutMs: 3000, intervalMs: 25, message: "篡改副本未在三秒内退出" });
      assert.ok(Date.now() - started < 3000, "Tampered application exceeded the original three-second limit");
      assert.notEqual(child.exitCode, 0);
      assert.match(output(), diagnostic);
      console.log(`RELEASE_TAMPER_EXIT ${label} code=${child.exitCode} signal=${child.signalCode || "none"} ${output().trim()}`);
    });
  });
}

test("an untouched copy keeps running", { timeout: 60000 }, async () => {
  await withRelease("untouched", { copy: true }, async ({ dataRoot, start }) => {
    const child = start();
    await delay(5000);
    assert.equal(child.exitCode, null);
    assert.equal(child.signalCode, null);
    assert.ok(logEvents(dataRoot).some((event) => event.event === "window.created"));
  });
});
