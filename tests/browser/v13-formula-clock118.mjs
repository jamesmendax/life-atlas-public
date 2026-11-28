import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { createProperty } from "../../src/domain/database.js";
import { upgradeWorkspace } from "../../src/persistence/migrations.js";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

// Standalone renderer regression: no server start or core-suite registration.
// harness.mjs supplies the seed/storage conventions, but browserScenario() also
// hashes src/tests and navigates before the callback can install a ticking clock.
// This scoped runner avoids both; it adds no application hooks or source edits.
const BASE = ".qa/LOCAL-NOTION-001/v13-wiki-formula116/clock118";
const BEFORE = Date.parse("2026-11-13T04:00:00.000Z");
const AFTER = Date.parse("2026-11-13T04:02:00.000Z");
const MINUTE = 60_000;
const DAY = 86_400_000;
const DERIVED = ["recent118", "now118", "age118"];
const AGE_MINUTES = 'dateBetween(now(), prop("发布日期"), "minutes")';
const EXPRESSION = `if(prop("状态") == "Published" and not empty(prop("发布日期")) and ${AGE_MINUTES} <= 21 * 1440, "SHOW", "HIDE")`;
const records = [
  { id: "transition118", title: "Before threshold", start: "2026-10-23T04:01", initial: "SHOW" },
  { id: "boundary118", title: "Exactly 21 days", start: "2026-10-23T04:00", initial: "SHOW" },
  { id: "fraction118", title: "21 days plus one minute", start: "2026-10-23T03:59", initial: "HIDE" },
  { id: "fresh118", title: "Recent control", start: "2026-11-12T04:00", initial: "SHOW" },
];

function fixture(surface) {
  const workspace = coreParityWorkspace();
  const source = workspace.dataSources.find((entry) => entry.id === "projects");
  source.properties = [
    createProperty({ id: "title", name: "名称", type: "title" }),
    createProperty({ id: "status", name: "状态", type: "select", options: [{ id: "published118", name: "Published" }] }),
    createProperty({ id: "date", name: "发布日期", type: "date" }),
    createProperty({ id: "recent118", name: "首页近期", type: "formula", config: { expression: EXPRESSION } }),
    createProperty({ id: "now118", name: "Clock observation", type: "formula", config: { expression: 'formatDate(now(), "YYYY-MM-DD[T]HH:mm")' } }),
    createProperty({ id: "age118", name: "Elapsed days", type: "formula", config: { expression: `${AGE_MINUTES} / 1440` } }),
  ];
  const template = workspace.pages.find((entry) => entry.id === "database-page");
  const owner = { ...template, title: `Formula clock118 ${surface}`, content: [],
    ...(surface === "inline" ? { pageType: "page", databaseSourceId: null, databaseViewId: null,
      content: [{ id: "clock118-inline", type: "databaseView", props: { sourceId: source.id, viewId: "view-table" } }] } : {}) };
  workspace.pages = [owner, ...records.map((record) => ({ ...template, id: `${record.id}-page`, title: record.title,
    pageType: "page", databaseSourceId: source.id, databaseViewId: null, content: [] }))];
  workspace.dataSources = [source];
  workspace.databaseViews = workspace.databaseViews.filter((entry) => entry.id === "view-table");
  workspace.databaseViews[0].visiblePropertyIds = source.properties.map((entry) => entry.id);
  workspace.databaseItems = records.map((record) => ({ id: record.id, sourceId: source.id, pageId: `${record.id}-page`,
    parentItemId: null, createdAt: template.createdAt, updatedAt: template.updatedAt, values: {
      title: record.title, status: "published118", date: { start: record.start, end: null, includeTime: true, timeZone: "UTC" },
      recent118: null, now118: null, age118: null,
    } }));
  workspace.relations = []; workspace.attachments = []; workspace.syncedSources = [];
  // Opening the page from Home during setup resets App's section-dependent
  // minute interval five seconds after the existing reminder interval phase.
  workspace.ui = { ...workspace.ui, selectedPageId: owner.id, activeSection: "home", preferences: { style: "mobai", theme: "light" } };
  return upgradeWorkspace(workspace);
}

// Wall-time polling is in Node, never in the paused renderer. Reading the DOM
// does not advance fake time, fire rAF/timers, edit a record, or reload the page.
async function until(read, predicate, label) {
  const deadline = Date.now() + 9000;
  let value;
  do {
    value = await read();
    if (predicate(value)) return value;
    await delay(50);
  } while (Date.now() < deadline);
  throw new Error(`${label}: ${JSON.stringify(value)}`);
}

const run = process.env.FORMULA_CLOCK118_RUN || `run-${Date.now()}`;
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Use a unique lowercase formula-clock118 run label");
const url = new URL(process.env.PARITY_BASE_URL || "http://127.0.0.1:5178");
assert.match(url.href, /^http:\/\/(?:127\.0\.0\.1|localhost):5178(?:\/|$)/,
  "Parent must provide the isolated 5178 renderer after 116 releases it");
const directory = path.resolve(BASE, run);
if (existsSync(directory)) throw new Error(`Preserve earlier run evidence: ${directory}`);
mkdirSync(directory, { recursive: true });
const publish = (file, value) => writeFileSync(path.join(directory, file), JSON.stringify(value, null, 2) + "\n");
const report = { name: "v13-formula-clock118", startedAt: new Date().toISOString(), passed: false,
  baseUrl: url.href, storageKey: workspaceStorageKey, sourceFingerprint: null,
  sourceFingerprintReason: "Source/user assets are not rehashed in this independent task",
  contract: "Formula clock measured in complete minutes with an elapsed-day display", scenarios: [] };

async function scenario(surface) {
  const output = { surface, passed: false, checks: [], samples: [], errors: [], mainFrameNavigations: 0 };
  report.scenarios.push(output);
  let browser, page;
  const temporary = path.join(directory, `${surface}-temporary`);
  mkdirSync(temporary);
  const previousTemp = { TEMP: process.env.TEMP, TMP: process.env.TMP };
  // Keep Playwright's generated profile/artifacts in this owned synthetic run.
  process.env.TEMP = temporary; process.env.TMP = temporary;
  const flush = () => publish("result.json", report);
  const check = async (label, callback) => {
    const item = { label, passed: false };
    output.checks.push(item); flush();
    console.log(`CHECK clock118 ${surface}: ${label}`);
    await callback(); item.passed = true; flush();
  };
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1040 }, timezoneId: "UTC", colorScheme: "light" });
    const seed = fixture(surface);
    publish(`${surface}-fixture.json`, seed);
    await context.addInitScript(({ seed, key }) => {
      if (!localStorage.getItem("life-atlas.harness.seeded")) {
        localStorage.setItem(key, JSON.stringify(seed));
        localStorage.setItem("life-atlas.harness.seeded", "1");
        localStorage.setItem("life-atlas.parity.seeded", "1");
      }
    }, { seed, key: workspaceStorageKey });
    page = await context.newPage();
    page.setDefaultTimeout(9000); page.setDefaultNavigationTimeout(15000);
    page.on("pageerror", (error) => { output.errors.push({ kind: "pageerror", message: error.stack }); flush(); });
    page.on("console", (message) => {
      if (message.type() === "error") { output.errors.push({ kind: "console", message: message.text() }); flush(); }
    });
    page.on("response", (response) => {
      if (response.status() >= 400) { output.errors.push({ kind: "http", status: response.status(), url: response.url() }); flush(); }
    });
    page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) output.mainFrameNavigations++; });
    const selector = surface === "inline" ? '[data-id="clock118-inline"] .database-view' : '.page-document .database-view';
    const db = page.locator(selector);
    const savedRaw = () => page.evaluate((key) => localStorage.getItem(key), workspaceStorageKey);
    const cells = () => db.evaluate((element) => Array.from(element.querySelectorAll("tr[data-item-id]")).map((row) => {
      const text = (id) => row.querySelector(`[data-property-id="${id}"] .db-readonly-cell`)?.textContent?.trim() ?? null;
      return { id: row.dataset.itemId, recent: text("recent118"), now: text("now118"), age: text("age118") };
    }));
    const checkRaw = (raw) => {
      const state = JSON.parse(raw);
      assert.ok(state.savedAt, "Read actual repository output, not only the init-script seed");
      assert.equal(state.databaseItems.length, records.length);
      for (const record of records) {
        const item = state.databaseItems.find((entry) => entry.id === record.id);
        assert.ok(item, `Persisted ${record.id} exists`);
        for (const propertyId of DERIVED) {
          assert.ok(Object.hasOwn(item.values, propertyId), `${record.id}.${propertyId} remains present`);
          assert.equal(item.values[propertyId], null, `${record.id}.${propertyId} is derived; raw remains null`);
        }
      }
      assert.deepEqual(state.databaseItems, seed.databaseItems);
      assert.deepEqual(state.dataSources, seed.dataSources);
      assert.deepEqual(state.databaseViews, seed.databaseViews);
      return state;
    };
    const assertCells = (displayed, initial, start, end) => {
      assert.deepEqual(displayed.map((entry) => entry.id).sort(), records.map((entry) => entry.id).sort());
      for (const record of records) {
        const row = displayed.find((entry) => entry.id === record.id);
        assert.match(row.now ?? "", /^2026-11-13T04:\d{2}$/);
        const observedTime = Date.parse(`${row.now}:00Z`);
        assert.ok(observedTime >= start && observedTime <= end, `${record.id}: ${row.now} is in the tick window`);
        const days = (observedTime - Date.parse(`${record.start}:00Z`)) / DAY;
        assert.ok(Number.isFinite(Number(row.age)) && Math.abs(Number(row.age) - days) < 1e-10,
          `${record.id}: displayed elapsed days ${row.age}, expected ${days}`);
        assert.equal(row.recent, initial ? record.initial : record.id === "fresh118" ? "SHOW" : "HIDE", record.id);
      }
    };
    const capture = async (label) => {
      const raw = await savedRaw();
      const sample = { label, wallTime: await page.evaluate(() => Date.now()), cells: await cells(), persisted: checkRaw(raw) };
      output.samples.push(sample); publish(`${surface}-${label}.json`, sample); flush();
      return { sample, raw };
    };

    let baseline;
    await check("Clock is installed before App timers; bootstrap and repository autosave settle before observations", async () => {
      // Use the installed Playwright contract: install slightly earlier and let
      // initial loading timers run normally, then pause. setFixedTime() would
      // freeze Date while leaving real timers running and cannot prove refresh.
      await page.clock.install({ time: new Date(BEFORE - 5 * MINUTE) });
      await page.goto(url.href, { waitUntil: "domcontentloaded" });
      await page.locator('html[data-la-ready="1"]').waitFor({ state: "attached" });
      await until(savedRaw, (raw) => Boolean(JSON.parse(raw)?.savedAt), "Initial repository save did not settle");
      assert.ok(await page.evaluate(() => Date.now()) < BEFORE - 5000, "Bootstrap overran the controlled initial time");
      await page.clock.pauseAt(new Date(BEFORE - 5000));
      await page.clock.runFor(5000);
      assert.equal(Date.parse(JSON.parse(await savedRaw()).ui.lastReminderCheckAt), BEFORE - 5000,
        "Reminder phase must be observed from actual persisted state before resetting the minute timer");
      // Setup navigation only, using the existing sidebar. No property edits,
      // custom timer wrappers, callback invocation, or suppressed App timers.
      await page.getByRole("treeitem", { name: seed.pages[0].title, exact: true })
        .locator("button.sidebar-page-main").click({ force: true });
      assert.equal(await page.evaluate(() => Date.now()), BEFORE);
      // Pump initial inline renderer/rAF work; ordinary Node polling alone
      // cannot settle a newly mounted editor while its fake rAF is paused.
      await until(async () => {
        await page.clock.runFor(20);
        return await db.count() ? cells() : [];
      }, (rows) => rows.length === records.length && rows.every((row) => row.now === "2026-11-13T04:00"),
      "Initial displayed now() did not settle");
      await page.clock.runFor(2000);
      const elapsed = await page.evaluate(() => Date.now()) - BEFORE;
      assert.ok(elapsed < 25_000, "Bootstrap must finish before the first phased reminder tick");
      // Reminder checks run at +25s/+55s; drain their +55s autosave before
      // observing the +60s minute tick. This is a four-second isolated window.
      await page.clock.runFor(56_000 - elapsed);
      await until(() => page.locator(".save-state").innerText(), (text) => text.trim() === "已保存", "Initial autosave is pending");
      baseline = await capture("before");
      assert.equal(Date.parse(baseline.sample.persisted.ui.lastReminderCheckAt), BEFORE + 55_000);
      assertCells(baseline.sample.cells, true, BEFORE, BEFORE);
      assert.ok(Number(baseline.sample.cells.find((row) => row.id === "transition118").age) < 21);
      assert.equal(Number(baseline.sample.cells.find((row) => row.id === "boundary118").age), 21);
      assert.ok(Number(baseline.sample.cells.find((row) => row.id === "fraction118").age) > 21);
      await page.screenshot({ path: path.join(directory, `${surface}-before.png`), animations: "disabled" });
    });

    await check("Moving wall time past the threshold without firing timers leaves actual displayed cells unchanged", async () => {
      await page.clock.setSystemTime(new Date(AFTER));
      assert.equal(await page.evaluate(() => Date.now()), AFTER);
      await delay(150); // Node settle only: no renderer timers, rAF or mutations.
      const frozen = await capture("wall-time-only");
      assert.deepEqual(frozen.sample.cells, baseline.sample.cells, "Date change alone must not manufacture a renderer refresh");
      assert.equal(frozen.raw, baseline.raw, "No edits or persistence writes during wall-time-only observation");
    });

    let tick;
    await check("The existing App minute timer refreshes the clock, elapsed days and threshold results without edits or reload", async () => {
      await page.clock.runFor(4100); // +60s minute callback and 100ms rAF settle; next reminder is +85s.
      assert.equal(await page.evaluate(() => Date.now()), AFTER + 4100);
      await until(cells, (rows) => rows.length === records.length && rows.every((row) => row.now !== "2026-11-13T04:00"),
        "App minute timer did not reach displayed formula cells (App.jsx -> DatabaseView/DatabaseTable, or inline runtime context)");
      tick = await capture("minute-tick");
      assertCells(tick.sample.cells, false, AFTER, AFTER);
      assert.equal(tick.raw, baseline.raw, "Timer-derived display changes must not rewrite persisted raw data");
      assert.equal(tick.sample.persisted.ui.lastReminderCheckAt, baseline.sample.persisted.ui.lastReminderCheckAt,
        "The 30-second reminder loop did not drive this observed refresh");
      assert.equal(output.mainFrameNavigations, 1, "One initial navigation; no reload or page change");
      await page.screenshot({ path: path.join(directory, `${surface}-minute-tick.png`), animations: "disabled" });
    });

    await check("A second minute updates displayed time again while every actual persisted derived raw value stays null", async () => {
      // Drain the next two reminder checks/autosaves before the next minute.
      // At +115s the formula still sees 04:02; at +120s only App's minute
      // callback advances the displayed minute to 04:03.
      await page.clock.runFor(55_900);
      assert.equal(await page.evaluate(() => Date.now()), AFTER + MINUTE);
      const beforeSecond = await capture("before-second-minute");
      assert.deepEqual(beforeSecond.sample.cells, tick.sample.cells);
      assert.equal(Date.parse(beforeSecond.sample.persisted.ui.lastReminderCheckAt), AFTER + 59_000);
      await page.clock.runFor(4100);
      assert.equal(await page.evaluate(() => Date.now()), AFTER + MINUTE + 4100);
      await until(cells, (rows) => rows.length === records.length && rows.every((row) =>
        row.now !== tick.sample.cells.find((before) => before.id === row.id)?.now), "Second App minute did not refresh displayed cells");
      const next = await capture("second-minute-tick");
      assertCells(next.sample.cells, false, AFTER + MINUTE, AFTER + MINUTE);
      for (const row of next.sample.cells) {
        const previous = tick.sample.cells.find((entry) => entry.id === row.id);
        assert.equal(Date.parse(`${row.now}:00Z`) - Date.parse(`${previous.now}:00Z`), MINUTE);
        assert.ok(Math.abs(Number(row.age) - Number(previous.age) - MINUTE / DAY) < 1e-10);
      }
      assert.equal(next.raw, beforeSecond.raw, "The isolated minute tick stores no derived result and performs no workspace save");
      assert.equal(next.sample.persisted.ui.lastReminderCheckAt, beforeSecond.sample.persisted.ui.lastReminderCheckAt);
      // UI reminder metadata/savedAt legitimately change between the isolated
      // windows. All authored data, property IDs and raw values stay identical.
      for (const collection of ["databaseItems", "dataSources", "databaseViews", "pages", "folders", "relations"]) {
        assert.deepEqual(next.sample.persisted[collection], baseline.sample.persisted[collection], collection);
      }
      assert.equal(output.mainFrameNavigations, 1);
      assert.deepEqual(output.errors, []);
    });
    output.passed = output.checks.length === 4 && output.checks.every((entry) => entry.passed);
  } catch (error) {
    output.failure = error.stack; process.exitCode = 1;
    console.error(`FAIL clock118 ${surface}: ${error.stack}`);
    if (page) {
      await page.screenshot({ path: path.join(directory, `${surface}-failure.png`), timeout: 5000 }).catch(() => {});
    }
  } finally {
    try { await browser?.close(); }
    catch (error) { output.passed = false; output.errors.push({ kind: "close", message: error.message }); process.exitCode = 1; }
    for (const name of ["TEMP", "TMP"]) {
      if (previousTemp[name] === undefined) delete process.env[name]; else process.env[name] = previousTemp[name];
    }
    output.completedAt = new Date().toISOString(); flush();
  }
}

await scenario("full-page");
await scenario("inline");
report.completedAt = new Date().toISOString();
report.passed = report.scenarios.length === 2 && report.scenarios.every((entry) => entry.passed && entry.errors.length === 0);
publish("result.json", report);
if (!report.passed) process.exitCode = 1;
console.log(`FORMULA CLOCK118: 2 surfaces / ${report.scenarios.reduce((sum, entry) => sum + entry.checks.length, 0)} checks, passed=${report.passed}`);
