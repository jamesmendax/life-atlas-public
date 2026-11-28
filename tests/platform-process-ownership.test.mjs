import test from "node:test";
import assert from "node:assert/strict";
import { selectOwnedTestProcesses } from "./desktop/helpers.mjs";

const executablePath = "D:\\application-development\\life-atlas\\node_modules\\electron\\dist\\electron.exe";
const runtimeDir = "D:\\AI\\codex\\notion\\.harness\\local-notion\\runtime\\ownership-test\\runtime";
const createdAt = "2026-11-07T07:00:00.0000000Z";
const ownership = { mainPid: 200, launcherPid: 100, executablePath, runtimeDir, mainCreatedAt: createdAt, launcherCreatedAt: createdAt };

function records() {
  return [
    { pid: 100, parentPid: 50, executablePath: "C:\\Windows\\System32\\cmd.exe", createdAt, commandLine: `cmd.exe /d /s /c "${executablePath}" --inspect=0` },
    { pid: 200, parentPid: 100, executablePath, createdAt, commandLine: `"${executablePath}" --inspect=0` },
    { pid: 300, parentPid: 200, executablePath, createdAt, commandLine: `"${executablePath}" --type=renderer --user-data-dir="${runtimeDir}"` },
    { pid: 400, parentPid: 200, executablePath, createdAt, commandLine: `"${executablePath}" --type=gpu-process --user-data-dir="${runtimeDir}"` },
    { pid: 5196, parentPid: 50, executablePath: "D:\\unowned\\designer.exe", createdAt, commandLine: "designer --port5196" },
  ];
}

test("test cleanup distinguishes the Windows launcher from the actual Electron main PID", () => {
  assert.deepEqual(selectOwnedTestProcesses(records(), ownership).map((entry) => entry.pid), [200, 400, 300, 100]);
});

test("test cleanup never includes an unrelated designer process", () => {
  assert.equal(selectOwnedTestProcesses(records(), ownership).some((entry) => entry.pid === 5196), false);
});

test("test cleanup refuses reused main and launcher PIDs", () => {
  for (const pid of [100, 200]) {
    const input = records().map((entry) => entry.pid === pid ? { ...entry, createdAt: "2026-11-07T08:00:00.0000000Z" } : entry);
    assert.throws(() => selectOwnedTestProcesses(input, ownership), /PID was reused/);
  }
});

test("test cleanup refuses changed executables and unowned child runtime paths", () => {
  const executableChanged = records().map((entry) => entry.pid === 300 ? { ...entry, executablePath: "D:\\unowned\\electron.exe" } : entry);
  assert.throws(() => selectOwnedTestProcesses(executableChanged, ownership), /Unexpected process/);
  for (const value of [`${runtimeDir}-other`, "C:\\Users\\medax\\AppData\\Roaming\\Life Atlas", "D:\\unowned\\runtime"]) {
    const input = records().map((entry) => entry.pid === 300 ? { ...entry, commandLine: `"${executablePath}" --type=renderer --user-data-dir="${value}"` } : entry);
    assert.throws(() => selectOwnedTestProcesses(input, ownership), /unowned runtime/);
  }
});

test("test cleanup refuses children older than the recorded main process", () => {
  const input = records().map((entry) => entry.pid === 300 ? { ...entry, createdAt: "2026-11-07T06:00:00.0000000Z" } : entry);
  assert.throws(() => selectOwnedTestProcesses(input, ownership), /predates/);
});

test("test cleanup reaps only verified descendants when the actual main process already exited", () => {
  const input = records().filter((entry) => entry.pid !== 200);
  assert.deepEqual(selectOwnedTestProcesses(input, ownership).map((entry) => entry.pid), [400, 300, 100]);
});

test("test cleanup refuses a different launcher parent and ambiguous process inventories", () => {
  const differentParent = records().map((entry) => entry.pid === 200 ? { ...entry, parentPid: 999 } : entry);
  assert.throws(() => selectOwnedTestProcesses(differentParent, ownership), /launcher changed/);
  assert.throws(() => selectOwnedTestProcesses([...records(), records()[1]], ownership), /Duplicate process/);
});

test("test cleanup diagnoses an unexpected child without exposing process command lines", () => {
  const secret = "LIFE_ATLAS_SYNTHETIC_COMMAND_LINE_SECRET";
  const candidate = { ...records()[2], executablePath: "D:\\unowned\\designer.exe", createdAt: "2026-11-07T06:00:00.0000000Z", commandLine: `designer.exe --user-data-dir="${runtimeDir}" --synthetic-secret=${secret}` };
  const input = records().filter((entry) => entry.pid !== ownership.mainPid).map((entry) => entry.pid === candidate.pid ? candidate : entry);
  assert.throws(() => selectOwnedTestProcesses(input, ownership), (error) => {
    assert.match(error.message, /^Unexpected process in the test Electron tree\nLIFE_ATLAS_TEST_PROCESS_OWNERSHIP /);
    const diagnostic = JSON.parse(error.message.split("\nLIFE_ATLAS_TEST_PROCESS_OWNERSHIP ")[1].split("\n", 1)[0]);
    assert.deepEqual(diagnostic.expected, ownership);
    assert.equal(diagnostic.mainPresent, false);
    assert.equal(diagnostic.launcherPresent, true);
    assert.deepEqual(diagnostic.candidate, { pid: candidate.pid, parentPid: candidate.parentPid, executablePath: candidate.executablePath, createdAt: candidate.createdAt, runtimeDir });
    assert.equal(diagnostic.parent, null);
    assert.equal(error.message.includes(secret), false);
    assert.equal(error.message.includes("commandLine"), false);
    return true;
  });
});

test("test cleanup bounds ownership failure diagnostics to the relevant process identities", () => {
  const longPath = `D:\\unowned\\${"process-path".repeat(1000)}`;
  const input = records().map((entry) => entry.pid === 300 ? { ...entry, executablePath: longPath, commandLine: `designer.exe --user-data-dir="${longPath}"` } : entry);
  assert.throws(() => selectOwnedTestProcesses(input, ownership), (error) => {
    const diagnostic = JSON.parse(error.message.split("\nLIFE_ATLAS_TEST_PROCESS_OWNERSHIP ")[1].split("\n", 1)[0]);
    assert.equal(diagnostic.mainPresent, true);
    assert.equal(diagnostic.launcherPresent, true);
    assert.equal(diagnostic.parent.pid, ownership.mainPid);
    assert.equal(diagnostic.parent.createdAt, ownership.mainCreatedAt);
    assert.equal(diagnostic.candidate.executablePath.length, 512);
    assert.equal(diagnostic.candidate.runtimeDir.length, 512);
    assert.ok(error.message.length < 4000);
    assert.equal(error.message.includes("5196"), false);
    return true;
  });
});
