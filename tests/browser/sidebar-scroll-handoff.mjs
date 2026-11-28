import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createBlankWorkspace } from "../../src/domain/blankWorkspace.js";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";

const client = path.resolve(process.argv[2] || "dist/client");
const evidence = path.resolve(process.argv[3] || ".qa/sidebar-scroll-handoff");
const origin = "https://sidebar-scroll-fixture.invalid";
const outerSelector = ".workspace-sidebar > nav.sidebar-nav";
const innerSelector = outerSelector + " > section.private-nav-group > div.private-sidebar-tree";
const viewport = { width: 1440, height: 600 };
const tolerance = 2;
const cases = [
  { name: "inside-down", side: "middle", deltas: [72], expected: [72, 0] },
  { name: "inside-up", side: "middle", deltas: [-72], expected: [-72, 0] },
  { name: "bottom-remainder", side: "bottom", gap: 18, deltas: [82] },
  { name: "top-remainder", side: "top", gap: 18, deltas: [-82] },
  { name: "bottom-burst", side: "bottom", gap: 40, deltas: [17, 17, 17, 17, 17], interval: [8, 16, 8, 16] },
  { name: "top-burst", side: "top", gap: 40, deltas: [-17, -17, -17, -17, -17], interval: [8, 16, 8, 16] },
  { name: "ctrl-wheel-bypass", side: "bottom", gap: 18, deltas: [82], modifier: "Control" },
];
let sequence = 0;
const fixture = createBlankWorkspace({ now: "2026-11-24T00:00:00.000Z", idFactory: (kind) => "scroll-" + kind + "-" + ++sequence });
const firstPage = fixture.pages[0];
fixture.pages.push(...Array.from({ length: 74 }, (_, i) => ({
  ...firstPage, id: "scroll-synthetic-page-" + i, title: "合成目录页面 " + String(i + 1).padStart(2, "0"),
  sortIndex: firstPage.sortIndex + 10 * (i + 1),
  content: [{ id: "scroll-synthetic-block-" + i, type: "paragraph", content: "" }],
})));
fixture.ui.activeSection = "private";
const shortFixture = { ...fixture, pages: fixture.pages.slice(0, 5),
  ui: { ...fixture.ui, favoritePageIds: fixture.pages.slice(0, 5).map(({ id }) => id) } };
await fs.access(path.join(client, "index.html"));
await fs.mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });

try {
  const context = await browser.newContext({ viewport });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const file = path.resolve(client, "." + decodeURIComponent(url.pathname));
    if (path.relative(client, file).startsWith("..")) return route.abort();
    try { await route.fulfill({ path: file }); }
    catch { await route.fulfill({ status: 404 }); }
  });
  await context.addInitScript(({ key, long, short }) => {
    localStorage.setItem(key, JSON.stringify(location.search === "?short" ? short : long));
  }, { key: workspaceStorageKey, long: fixture, short: shortFixture });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin + "/index.html");
  const inner = page.locator(innerSelector);
  await inner.getByText("合成目录页面 01", { exact: true }).waitFor();
  assert.equal(await inner.locator(".page-tree-row").count(), fixture.pages.length);

  const dimensions = await page.evaluate(({ outerSelector, innerSelector }) => {
    const [outer, inner] = [outerSelector, innerSelector].map((selector) => document.querySelector(selector));
    const describe = (element) => ({
      height: element.clientHeight, scrollHeight: element.scrollHeight, maxTop: element.scrollHeight - element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
    });
    return { outer: describe(outer), inner: describe(inner), contains: outer.contains(inner) };
  }, { outerSelector, innerSelector });
  assert.equal(dimensions.contains, true);
  assert.ok(dimensions.inner.maxTop > 500 && dimensions.outer.maxTop > 40, JSON.stringify(dimensions));

  await page.evaluate(({ outerSelector, innerSelector }) => {
    const [outer, inner] = [outerSelector, innerSelector].map((selector) => document.querySelector(selector));
    const probe = { outer, inner, events: [] };
    document.addEventListener("wheel", (event) => {
      const sample = { t: performance.now(), delta: event.deltaY, trusted: event.isTrusted, inTree: inner.contains(event.target), ctrl: event.ctrlKey };
      probe.events.push(sample);
      setTimeout(() => { sample.prevented = event.defaultPrevented; }, 0);
    }, { capture: true, passive: true });
    for (const [name, element] of [["inner", inner], ["outer", outer]]) {
      element.addEventListener("scroll", () => probe.events.push({ t: performance.now(), name, top: element.scrollTop }));
    }
    window.__sidebarScrollHandoff = probe;
  }, { outerSelector, innerSelector });

  const results = [];
  const stable = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  for (const trial of cases) {
    // Move out and wait for the previous gesture to unlatch only between trials.
    await page.mouse.move(310, 70);
    await new Promise((resolve) => setTimeout(resolve, 550));
    const position = await page.evaluate(({ side, gap }) => {
      const { outer, inner } = window.__sidebarScrollHandoff;
      const maximum = (element) => element.scrollHeight - element.clientHeight;
      outer.scrollTop = Math.round(maximum(outer) / 2);
      inner.scrollTop = side === "bottom" ? maximum(inner) - gap : side === "top" ? gap : Math.round(maximum(inner) / 2);
      const clip = outer.getBoundingClientRect();
      const box = inner.getBoundingClientRect();
      const target = { x: box.left + 42, y: (Math.max(box.top, clip.top) + Math.min(box.bottom, clip.bottom)) / 2 };
      return { ...target, inner: inner.scrollTop, outer: outer.scrollTop, outerMax: maximum(outer) };
    }, trial);
    await stable();
    await page.mouse.move(position.x, position.y);
    assert.equal(await page.evaluate(({ x, y }) => window.__sidebarScrollHandoff.inner.contains(document.elementFromPoint(x, y)), position), true);
    await page.evaluate(() => { window.__sidebarScrollHandoff.events.length = 0; });
    if (trial.modifier) await page.keyboard.down(trial.modifier);
    try {
      for (let i = 0; i < trial.deltas.length; i += 1) {
        await page.mouse.wheel(0, trial.deltas[i]);
        if (trial.interval?.[i]) await new Promise((resolve) => setTimeout(resolve, trial.interval[i]));
      }
    } finally {
      if (trial.modifier) await page.keyboard.up(trial.modifier);
    }
    const events = await page.evaluate(async () => {
      await new Promise((resolve) => setTimeout(resolve, 130));
      const { inner, outer, events } = window.__sidebarScrollHandoff;
      return { inner: inner.scrollTop, outer: outer.scrollTop, events };
    });
    const delta = trial.deltas.reduce((sum, value) => sum + value, 0);
    const direction = Math.sign(delta);
    const remainder = Math.min(Math.abs(delta) - (trial.gap ?? 0), direction > 0 ? position.outerMax - position.outer : position.outer);
    const expected = trial.modifier ? [] : trial.expected || [direction * trial.gap, direction * remainder];
    const actual = [events.inner - position.inner, events.outer - position.outer];
    const wheels = events.events.filter((event) => event.trusted);
    const firstOuter = events.events.find((event) => event.name === "outer" && Math.abs(event.top - position.outer) > tolerance);
    const firstWheel = wheels[0]?.t ?? 0;
    let delivered = 0;
    const crossingIndex = trial.expected ? -1 : trial.deltas.findIndex((value) => (delivered += Math.abs(value)) > trial.gap);
    const handoffMs = firstOuter ? Math.round(firstOuter.t - firstWheel) : undefined;
    const boundaryMs = firstOuter && wheels[crossingIndex] ? Math.round(firstOuter.t - wheels[crossingIndex].t) : undefined;
    const passed = wheels.length === trial.deltas.length && wheels.every((event, i) => event.inTree && event.delta === trial.deltas[i])
      && (trial.modifier ? wheels.every((event) => event.ctrl && event.prevented === false)
        : actual.every((value, i) => Math.abs(value - expected[i]) <= tolerance));
    results.push({
      name: trial.name, position, actual, expected, passed, crossingWheel: crossingIndex + 1, handoffMs, boundaryMs,
      events: events.events.map(({ t, ...event }) => ({ ...event, elapsedMs: Math.round(t - firstWheel) })),
    });
  }
  const shortPage = await context.newPage({ viewport: { width: 1440, height: 430 } });
  await shortPage.setViewportSize({ width: 1440, height: 430 });
  shortPage.on("pageerror", (error) => errors.push(error.message));
  await shortPage.goto(origin + "/index.html?short");
  await shortPage.locator(innerSelector).getByText("合成目录页面 01", { exact: true }).waitFor();
  const shortStart = await shortPage.evaluate(({ innerSelector, outerSelector }) => {
    const inner = document.querySelector(innerSelector);
    const outer = document.querySelector(outerSelector);
    const maximum = outer.scrollHeight - outer.clientHeight;
    const clip = outer.getBoundingClientRect();
    outer.scrollTop = Math.min(maximum - 60, Math.max(0, inner.getBoundingClientRect().top - clip.top - 40));
    const box = inner.getBoundingClientRect();
    const x = box.left + 35;
    const y = (Math.max(box.top, clip.top) + Math.min(box.bottom, clip.bottom)) / 2;
    let wheel;
    document.addEventListener("wheel", (event) => {
      wheel = { trusted: event.isTrusted, inTree: inner.contains(event.target), delta: event.deltaY };
      setTimeout(() => { wheel.prevented = event.defaultPrevented; }, 0);
    }, { capture: true, passive: true, once: true });
    window.__shortTree = { inner, outer, wheel: () => wheel };
    return { x, y, innerRoom: inner.scrollHeight - inner.clientHeight, outerRoom: maximum - outer.scrollTop, start: outer.scrollTop };
  }, { innerSelector, outerSelector });
  assert.equal(shortStart.innerRoom, 0, JSON.stringify(shortStart));
  assert.ok(shortStart.outerRoom >= 60, JSON.stringify(shortStart));
  await shortPage.mouse.move(shortStart.x, shortStart.y);
  await shortPage.mouse.wheel(0, 60);
  const shortEnd = await shortPage.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 130));
    const { inner, outer, wheel } = window.__shortTree;
    return { inner: inner.scrollTop, outer: outer.scrollTop, wheel: wheel() };
  });
  const shortActual = [shortEnd.inner, shortEnd.outer - shortStart.start];
  results.push({ name: "short-tree-native-outer", position: shortStart, actual: shortActual, expected: [0, 60], events: [shortEnd.wheel],
    passed: shortActual[0] === 0 && Math.abs(shortActual[1] - 60) <= tolerance && shortEnd.wheel?.trusted
      && shortEnd.wheel.inTree && shortEnd.wheel.delta === 60 && shortEnd.wheel.prevented === false });
  await shortPage.close();
  const result = { client, viewport, selectors: { outerSelector, innerSelector }, dimensions, results, errors,
    passed: results.every(({ passed }) => passed) && !errors.length };
  await fs.writeFile(path.join(evidence, "result.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
  await page.screenshot({ path: path.join(evidence, "sidebar.png") });
  for (const trial of results) console.log(`${trial.passed ? "PASS" : "FAIL"} ${trial.name} expected ${trial.expected.join("/")} actual ${trial.actual.join("/")} after-first-ms ${trial.handoffMs ?? "none"} after-boundary-ms ${trial.boundaryMs ?? "none"}`);
  console.log("SIDEBAR_SCROLL_HANDOFF_RESULT", path.join(evidence, "result.json"));
  assert.ok(result.passed, JSON.stringify({ failures: results.filter(({ passed }) => !passed).map(({ name }) => name), errors }));
} finally { await browser.close(); }
