import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { releaseTestFiles, runReleaseTests } from "../scripts/run-release-tests.mjs";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";

const originalFiles = [
  "tests/release/installer-lifecycle.e2e.mjs",
  "tests/release/manual-screenshots.e2e.mjs",
  "tests/release/performance.e2e.mjs",
  "tests/release/security-sweep.e2e.mjs",
];
const owner = "/root/release_failfast_fresh";
const runnerUrl = new URL("../scripts/run-release-tests.mjs", import.meta.url);

function fixture(context, { failFile = null, extraFiles = [], missingFiles = [] } = {}) {
  const root = createIsolatedDirectory("release-failfast-test");
  console.log(`RELEASE_FAILFAST_OWNED ${JSON.stringify({ owner, actionId: "A-RELEASE-FAILFAST01", root, pid: process.pid })}`);
  context.after(() => {
    removeIsolatedDirectory(root);
    assert.equal(fs.existsSync(root), false);
    console.log(`RELEASE_FAILFAST_CLEANED ${JSON.stringify({ owner, root })}`);
  });
  fs.mkdirSync(path.join(root, "tests", "release"), { recursive: true });
  fs.writeFileSync(path.join(root, "trace.txt"), "");
  for (const file of [...originalFiles, ...extraFiles].filter((value) => !missingFiles.includes(value))) {
    const source = [
      'import test from "node:test";',
      'import assert from "node:assert/strict";',
      'import fs from "node:fs";',
      `const file = ${JSON.stringify(file)};`,
      'const trace = new URL("../../trace.txt", import.meta.url);',
      'fs.appendFileSync(trace, `start ${file}\n`);',
      'console.log(`SYNTHETIC_RELEASE_START ${file} pid=${process.pid}`);',
      'test(`synthetic ${file}`, () => {',
      '  console.log(`SYNTHETIC_RELEASE_STDOUT ${file}`);',
      '  console.error(`SYNTHETIC_RELEASE_STDERR ${file}`);',
      `  assert.notEqual(file, ${JSON.stringify(failFile)}, "intentional synthetic file failure");`,
      '  fs.appendFileSync(trace, `end ${file}\n`);',
      '});',
    ].join("\n");
    fs.writeFileSync(path.join(root, file), source);
  }
  return root;
}

function trace(root) {
  return fs.readFileSync(path.join(root, "trace.txt"), "utf8").trim().split("\n").filter(Boolean);
}

function completed(files) {
  return files.flatMap((file) => [`start ${file}`, `end ${file}`]);
}

function runFixture(root) {
  const source = [
    'import { spawn } from "node:child_process";',
    `import { runReleaseTests } from ${JSON.stringify(runnerUrl.href)};`,
    'const spawnProcess = (command, args, options) => {',
    '  const child = spawn(command, args, options);',
    '  console.log(`RELEASE_FAILFAST_LAUNCH ${JSON.stringify({ command, args, ...options, pid: child.pid })}`);',
    '  return child;',
    '};',
    'process.exitCode = await runReleaseTests({ root: process.env.RELEASE_RUNNER_FIXTURE_ROOT, spawnProcess });',
  ].join("\n");
  const env = { ...process.env, RELEASE_RUNNER_FIXTURE_ROOT: root };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: root,
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
  assert.equal(result.error, undefined, result.stderr);
  assert.equal(result.signal, null, result.stderr);
  const launches = result.stdout.split("\n").filter((line) => line.startsWith("RELEASE_FAILFAST_LAUNCH ")).map((line) => JSON.parse(line.slice("RELEASE_FAILFAST_LAUNCH ".length)));
  for (const launch of launches) {
    assert.equal(launch.command, process.execPath);
    assert.deepEqual(launch.args.slice(0, -1), ["--test", "--test-concurrency=1", "--test-reporter=spec"]);
    assert.equal(launch.cwd, root);
    assert.equal(launch.stdio, "inherit");
    assert.equal(launch.windowsHide, true);
    assert.ok(Number.isInteger(launch.pid) && launch.pid > 0);
  }
  const output = result.stdout + result.stderr;
  const markers = output.split(/\r?\n/).filter((line) => line.startsWith("SYNTHETIC_RELEASE_"));
  console.log(`RELEASE_FAILFAST_SUBPROCESS ${JSON.stringify({ owner, root, runnerPid: result.pid, status: result.status, signal: result.signal, launches, markers, trace: trace(root) })}`);
  return { ...result, output, launches };
}

async function injectedResult(context, code, signal) {
  const root = fixture(context);
  const launches = [];
  const exitCode = await runReleaseTests({ root, spawnProcess: (command, args, options) => {
    launches.push({ command, args, options });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", code, signal));
    return child;
  } });
  assert.equal(launches.length, 1);
  assert.equal(launches[0].args.at(-1), originalFiles[0]);
  assert.deepEqual(trace(root), []);
  return exitCode;
}

test("release discovery preserves all four original files in glob order", () => {
  assert.deepEqual(releaseTestFiles(), originalFiles);
});

test("release runner executes every file sequentially and preserves its output", (context) => {
  const root = fixture(context);
  const result = runFixture(root);
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.launches.map((launch) => launch.args.at(-1)), originalFiles);
  assert.deepEqual(trace(root), completed(originalFiles));
  for (const file of originalFiles) {
    assert.ok(result.output.includes(`SYNTHETIC_RELEASE_STDOUT ${file}`));
    assert.ok(result.output.includes(`SYNTHETIC_RELEASE_STDERR ${file}`));
  }
  assert.match(result.stdout, /\[test:release\] complete files=4/);
});

test("release runner does not launch later files after the first file fails", (context) => {
  const root = fixture(context, { failFile: originalFiles[0] });
  const result = runFixture(root);
  assert.equal(result.status, 1, result.output);
  assert.deepEqual(result.launches.map((launch) => launch.args.at(-1)), originalFiles.slice(0, 1));
  assert.deepEqual(trace(root), [`start ${originalFiles[0]}`]);
  assert.match(result.output, /intentional synthetic file failure/);
  assert.doesNotMatch(result.output, /\[test:release\] complete/);
});

test("release runner does not launch later files after a middle file fails", (context) => {
  const root = fixture(context, { failFile: originalFiles[1] });
  const result = runFixture(root);
  assert.equal(result.status, 1, result.output);
  assert.deepEqual(result.launches.map((launch) => launch.args.at(-1)), originalFiles.slice(0, 2));
  assert.deepEqual(trace(root), [...completed(originalFiles.slice(0, 1)), `start ${originalFiles[1]}`]);
  assert.match(result.output, /intentional synthetic file failure/);
  assert.doesNotMatch(result.output, /\[test:release\] complete/);
});

test("release runner includes newly added release files in sorted order", (context) => {
  const addedFile = "tests/release/future-check.e2e.mjs";
  const files = [...originalFiles, addedFile].sort();
  const root = fixture(context, { extraFiles: [addedFile] });
  const result = runFixture(root);
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.launches.map((launch) => launch.args.at(-1)), files);
  assert.deepEqual(trace(root), completed(files));
  assert.match(result.stdout, /\[test:release\] complete files=5/);
});

test("release runner propagates a nonzero child status and stops", async (context) => {
  assert.equal(await injectedResult(context, 23, null), 23);
});

test("release runner treats a child signal as failure and stops", async (context) => {
  assert.equal(await injectedResult(context, 0, "SIGTERM"), 1);
});

test("release runner stops when spawning the child emits an error", async (context) => {
  const root = fixture(context);
  const launches = [];
  const exitCode = await runReleaseTests({ root, spawnProcess: (command, args, options) => {
    launches.push(args);
    return spawn(path.join(root, "nonexistent-node.exe"), args, options);
  } });
  assert.equal(exitCode, 1);
  assert.deepEqual(launches.map((args) => args.at(-1)), originalFiles.slice(0, 1));
  assert.deepEqual(trace(root), []);
});

test("release runner stops when spawning the child throws", async (context) => {
  const root = fixture(context);
  let launches = 0;
  const exitCode = await runReleaseTests({ root, spawnProcess: () => {
    launches += 1;
    throw new Error("synthetic spawn failure");
  } });
  assert.equal(exitCode, 1);
  assert.equal(launches, 1);
  assert.deepEqual(trace(root), []);
});

test("release runner rejects an indeterminate child exit without continuing", async (context) => {
  assert.equal(await injectedResult(context, null, null), 1);
});

test("release runner refuses missing original files and an empty release directory", async (context) => {
  for (const missingFiles of [[originalFiles[3]], originalFiles]) {
    const root = fixture(context, { missingFiles });
    assert.throws(() => releaseTestFiles(root), /Missing required release tests/);
    let launches = 0;
    const exitCode = await runReleaseTests({ root, spawnProcess: () => { launches += 1; } });
    assert.equal(exitCode, 1);
    assert.equal(launches, 0);
    assert.deepEqual(trace(root), []);
  }
});

test("release runner waits for child close before starting the next file", async (context) => {
  const root = fixture(context);
  const children = [];
  const launches = [];
  const pending = runReleaseTests({ root, spawnProcess: (command, args) => {
    launches.push(args.at(-1));
    const child = new EventEmitter();
    children.push(child);
    return child;
  } });
  assert.equal(launches.length, 1);
  children[0].emit("exit", 0, null);
  await Promise.resolve();
  assert.equal(launches.length, 1);
  for (let index = 0; index < originalFiles.length; index += 1) {
    children[index].emit("close", 0, null);
    await Promise.resolve();
    assert.equal(launches.length, Math.min(index + 2, originalFiles.length));
  }
  assert.equal(await pending, 0);
  assert.deepEqual(launches, originalFiles);
  assert.deepEqual(trace(root), []);
});
