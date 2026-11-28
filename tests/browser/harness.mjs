import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";
import { upgradeWorkspace } from "../../src/persistence/migrations.js";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

export async function shootBothModes(page, screenshot, label, { keepVisible } = {}) {
  for (const mode of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: mode });
    const deadline = Date.now() + 5000;
    while ((await page.evaluate(() => document.documentElement.dataset.theme)) !== mode) {
      if (Date.now() > deadline) throw new Error(`没有切换到 ${mode}：外观偏好是不是被改成了“白天”或“夜间”？`);
      await page.waitForTimeout(100);
    }
    if (keepVisible) await page.locator(keepVisible).first().waitFor({ state: "visible" });
    await page.waitForTimeout(200);
    await screenshot(`${label}-${mode}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

export function sourceFingerprint() {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else files.push(file);
    }
  };
  walk("src"); walk("tests");
  files.push("package.json", "package-lock.json");
  const hash = createHash("sha256");
  for (const file of files.sort()) { hash.update(file.replaceAll("\\", "/")); hash.update(readFileSync(file)); }
  return hash.digest("hex");
}

export async function answerProductDialog(page, { accept = true, optional = false } = {}) {
  const dialog = page.locator("[data-la-dialog]").last();
  try { await dialog.waitFor({ state: "visible", timeout: optional ? 1000 : 5000 }); }
  catch (error) { if (optional) return false; throw error; }
  await dialog.locator(accept ? "[data-la-dialog-confirm]" : "[data-la-dialog-cancel]").click();
  await dialog.waitFor({ state: "detached" });
  return true;
}

export async function browserScenario(name, scenario, options = {}) {
  const reportPath = `.qa/${name}.json`;
  mkdirSync(path.dirname(reportPath), { recursive: true });
  const startedAt = new Date().toISOString();
  const report = { name, startedAt, sourceFingerprint: sourceFingerprint(), passed: false, checks: [], screenshots: [], errors: [], storageKey: workspaceStorageKey };
  let browser, page;
  const publish = () => writeFileSync(reportPath, JSON.stringify(report, null, 2));
  const bounded = (promise, ms, label) => { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms); })]).finally(() => clearTimeout(timer)); };
  const watchdog = setTimeout(async () => {
    report.errors.push({ kind: "watchdog", message: "Scenario exceeded 210 seconds" }); publish();
    await bounded(browser?.close(), 5000, "close").catch(() => {});
    process.exit(2);
  }, 210000);
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const context = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 1040 }, acceptDownloads: true });
    const seed = options.legacyStorageKey ? options.workspace : upgradeWorkspace(options.workspace || coreParityWorkspace());
    await context.addInitScript(({ seed, key, markParity }) => {
      if (!localStorage.getItem("life-atlas.harness.seeded")) {
        localStorage.setItem(key, JSON.stringify(seed));
        localStorage.setItem("life-atlas.harness.seeded", "1");
        if (markParity) localStorage.setItem("life-atlas.parity.seeded", "1");
      }
    }, { seed, key: options.legacyStorageKey || workspaceStorageKey, markParity: options.markParity !== false });
    page = await context.newPage();
    if (options.now) await page.clock.setFixedTime(new Date(options.now));
    page.setDefaultTimeout(9000);
    page.setDefaultNavigationTimeout(15000);
    page.on("pageerror", (error) => { report.errors.push({ kind: "pageerror", message: error.stack }); publish(); });
    page.on("console", (message) => {
      if (message.type() === "error") { report.errors.push({ kind: "console", message: message.text().slice(0, 5000) }); publish(); }
    });
    page.on("response", (response) => {
      if (response.status() >= 400) { report.errors.push({ kind: "http", status: response.status(), url: response.url() }); publish(); }
    });
    await page.goto(process.env.PARITY_BASE_URL || "http://127.0.0.1:5178", { waitUntil: "domcontentloaded" });
    const check = async (label, callback) => {
      console.log(`CHECK ${name}: ${label}`);
      const item = { label, startedAt: new Date().toISOString(), passed: false };
      report.checks.push(item); publish();
      await bounded(callback(), 30000, label);
      item.passed = true; item.completedAt = new Date().toISOString(); publish();
    };
    const screenshot = async (label) => {
      const file = `.qa/${name}-${label}.png`;
      await bounded(page.screenshot({ path: file, fullPage: true, animations: "disabled" }), 12000, "screenshot");
      report.screenshots.push(file); publish();
    };
    const saved = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), workspaceStorageKey);
    const persisted = async (predicate, arg) => {
      await page.waitForFunction(({ key, expression, arg }) => {
        // The test serializes an assertion predicate only; application formulas
        // never use evaluation. Use ordinary fixture-specific checks instead.
        return Boolean(localStorage.getItem(key)) && document.visibilityState === "visible";
      }, { key: workspaceStorageKey }, { timeout: 2000 });
      const until = Date.now() + 6000;
      let value;
      do {
        value = await saved();
        if (predicate(value, arg)) return value;
        await new Promise((resolve) => setTimeout(resolve, 150));
      } while (Date.now() < until);
      assert.ok(predicate(value, arg), "Expected mutation was not persisted within 6 seconds");
      return value;
    };
    await scenario({ page, context, check, screenshot, saved, persisted, assert, seed });
    assert.deepEqual(report.errors, [], "Browser console, page and HTTP errors must be empty");
    assert.ok(report.checks.length > 0 && report.checks.every((item) => item.passed));
    report.passed = true;
    console.log(`PASS ${name}: ${report.checks.length} checks`);
  } catch (error) {
    report.failure = error.stack;
    console.error(`FAIL ${name}: ${error.stack}`);
    if (page) {
      await bounded(page.screenshot({ path: `.qa/${name}-failure.png`, fullPage: true }), 5000, "failure screenshot").catch(() => {});
      report.bodyExcerpt = await bounded(page.locator("body").innerText(), 3000, "body excerpt").then((text) => text.slice(-18000)).catch(() => "Renderer unavailable");
    }
    process.exitCode = 1;
  } finally {
    await bounded(browser?.close(), 20000, "browser close").catch((error) => { report.passed = false; report.errors.push({ kind: "close", message: error.message }); process.exitCode = 1; });
    report.completedAt = new Date().toISOString(); publish(); clearTimeout(watchdog);
  }
  return report;
}
