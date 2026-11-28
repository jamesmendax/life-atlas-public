import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { upgradeWorkspace } from "../../src/persistence/migrations.js";
import { createIsolatedDirectory, openPageInSidebar, REPO_ROOT, seedWorkspaceDatabase } from "../desktop/helpers.mjs";
import { startApp, waitFor, closeAppGracefully, readWorkspaceState } from "./helpers.mjs";

export async function databaseFocusScenario(name, scenario, { workspace }) {
  const exe = path.join(REPO_ROOT, "release/release/win-unpacked/Life Atlas.exe");
  const out = await fs.mkdtemp(path.join(REPO_ROOT, ".qa", name + "-release-"));
  const report = {
    exe, asarSha256: createHash("sha256").update(await fs.readFile(path.join(path.dirname(exe), "resources/app.asar"))).digest("hex"),
    runs: [], checks: [], errors: [], passed: false,
  };
  try {
    for (const theme of ["light", "dark"]) {
      const fixture = upgradeWorkspace(structuredClone(workspace));
      fixture.ui.preferences = { ...fixture.ui.preferences, style: "mobai", theme };
      const dataRoot = createIsolatedDirectory(name + "-" + theme);
      await seedWorkspaceDatabase(dataRoot, fixture);
      const run = { theme, dataRoot, closedCleanly: false };
      report.runs.push(run);
      await runTheme(exe, out, report, run, scenario);
    }
    assert.deepEqual(report.errors, []);
    report.passed = true;
  } catch (error) {
    report.error = error.stack;
    throw error;
  } finally {
    await fs.writeFile(path.join(out, "result.json"), JSON.stringify(report, null, 2));
    console.log(out, report.passed);
  }
}

async function runTheme(exe, out, report, run, scenario) {
  const { theme, dataRoot } = run;
  const child = startApp(exe, dataRoot, { args: ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"] });
  let browser, page;
  try {
    const endpoint = await waitFor(() => child.releaseOutput.stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[\w-]+)/u)?.[1], { timeoutMs: 30000 });
    browser = await chromium.connectOverCDP(endpoint);
    page = await waitFor(() => browser.contexts()[0].pages().find(p => p.url() === "app://bundle/index.html"), { timeoutMs: 30000 });
    await page.locator("html[data-la-ready]").waitFor();
    const info = await page.evaluate(() => window.lifeAtlas.app.getInfo());
    assert.equal(info.value.isPackaged, true);
    assert.equal(info.value.flavor, "release");
    assert.equal(path.resolve(info.value.dataRoot), dataRoot);
    const owned = await child.releaseOwnershipReady;
    assert.equal(path.resolve(owned.executablePath), exe);
    run.pid = owned.mainPid;
    page.on("pageerror", error => report.errors.push(error.message));
    const saved = () => page.evaluate(async () => {
      const reply = await window.lifeAtlas.workspace.load();
      if (!reply.ok) throw new Error(reply.error.message);
      return reply.value.workspace;
    });
    const persisted = (predicate) => waitFor(async () => {
      const snapshot = await saved();
      return predicate(snapshot) && snapshot;
    }, { timeoutMs: 10000, intervalMs: 120 });
    await page.locator('html[data-la-ready][data-theme="' + theme + '"]').waitFor();
    await page.bringToFront();
    await openPageInSidebar(page, "项目数据库");
    const check = async (label, verify) => {
      const item = { theme, label, passed: false };
      report.checks.push(item);
      await verify();
      await page.screenshot({ path: path.join(out, theme + "-" + report.checks.length + ".png"), animations: "disabled" });
      item.passed = true;
    };
    const screenshot = label => page.screenshot({ path: path.join(out, theme + "-" + label + ".png"), animations: "disabled" });
    await scenario({ page, check, assert, saved, persisted, screenshot });
  } catch (error) {
    run.error = error.message;
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
    throw error;
  } finally {
    try {
      if (page && !page.isClosed()) await page.evaluate(() => { setTimeout(() => window.close(), 0); }).catch(() => {});
      await waitFor(() => child.exitCode !== null, { timeoutMs: 8000 }).catch(() => {});
      await closeAppGracefully(child);
      run.closedCleanly = child.exitCode === 0;
      assert.ok(run.closedCleanly);
      if (!run.error) {
        const { entities } = readWorkspaceState(dataRoot);
        const row = entities.databaseItems.alpha;
        run.closedDatabase = { status: row.values.status, date: row.values.date.start,
          blocks: entities.pages["database-page"].content.map(({ id, type }) => ({ id, type })) };
        assert.deepEqual(run.closedDatabase, {
          status: "done", date: "2026-09-23", blocks: [{ id: "db-surface", type: "databaseView" }],
        });
      }
    } finally {
      await browser?.close().catch(() => {});
    }
  }
}
