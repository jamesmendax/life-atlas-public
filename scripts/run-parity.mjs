import { spawn } from "node:child_process";
import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";

const stage = process.argv[2] || "phase1";
const scenarios = {
  phase1: ["phase1-database", "phase1-editor", "phase1-migration"],
  phase2: ["phase2-work-surfaces", "phase2-query-formula"],
  phase3: ["phase3-workspace"],
};
if (!scenarios[stage]) throw new Error(`Unknown stage: ${stage}`);
const run = (args, env = process.env) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { stdio: "inherit", env });
  child.on("error", reject);
  child.on("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${args.join(" ")} failed: exit=${code}, signal=${signal || "none"}`)));
});
const base = process.env.PARITY_BASE_URL || "http://127.0.0.1:5178";
let server;
const report = { stage, startedAt: new Date().toISOString(), passed: false, scenarios: scenarios[stage] };
mkdirSync(".qa", { recursive: true });
try {
  const tests = readdirSync("tests").filter((file) => file.endsWith(".test.mjs")).map((file) => `tests/${file}`);
  await run(["--test", "--test-reporter=spec", ...tests]);
  const available = async () => { try { return (await fetch(base, { signal: AbortSignal.timeout(1200) })).ok; } catch { return false; } };
  if (!await available()) {
    const url = new URL(base);
    if (url.hostname !== "127.0.0.1") throw new Error("Auto-start is limited to an explicit loopback test server");
    server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", url.port || "5178", "--strictPort"], { stdio: "inherit" });
    let ready = false;
    for (let attempt = 0; attempt < 30 && server.exitCode === null; attempt++) { if (await available()) { ready = true; break; } await new Promise((resolve) => setTimeout(resolve, 300)); }
    if (!ready) throw new Error("Owned test server did not become ready");
  }
  for (const scenario of scenarios[stage]) {
    const file = `tests/browser/${scenario}.mjs`;
    assert.ok(existsSync(file), `Required scenario is missing: ${file}`);
    await run([file], { ...process.env, PARITY_BASE_URL: base });
    const result = JSON.parse(readFileSync(`.qa/${scenario}.json`, "utf8"));
    assert.equal(result.passed, true, `${scenario} did not pass`);
    assert.ok(result.checks.length && result.checks.every((check) => check.passed));
    assert.deepEqual(result.errors, []);
  }
  report.passed = true;
  console.log(`PARITY ${stage}: all unit regressions and ${scenarios[stage].length} actual-browser scenarios passed.`);
} catch (error) {
  report.failure = error.stack;
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  // Only an owned child created above is stopped. A reused live dev server is
  // never killed, restarted, or otherwise managed by the test runner.
  server?.kill();
  report.completedAt = new Date().toISOString();
  writeFileSync(`.qa/${stage}-gate.json`, JSON.stringify(report, null, 2));
}