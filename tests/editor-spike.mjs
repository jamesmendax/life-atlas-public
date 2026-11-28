import { chromium } from "playwright";
import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { legacyWorkspace } from "./fixtures/workspace-v6-parity.mjs";
import { migratePhase1 } from "../src/persistence/migrations.js";
import { createTabsDocument } from "../src/domain/blockDocument.js";

const mode = process.argv[2] || "plain";
const base = process.env.PARITY_BASE_URL || "http://127.0.0.1:5178";
mkdirSync(".qa", { recursive: true });
const path = `.qa/editor-spike-${mode}`;
writeFileSync(`${path}.jsonl`, "");
const record = (kind, data) => {
  const value = { time: new Date().toISOString(), kind, data };
  appendFileSync(`${path}.jsonl`, JSON.stringify(value) + "\n");
  if (!["console", "script"].includes(kind)) console.log(JSON.stringify(value));
};
let browser;
const timeout = (promise, ms, label) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms); })]).finally(() => clearTimeout(timer));
};
const watchdog = setTimeout(async () => { record("watchdog", mode); await timeout(browser?.close(), 5000, "close").catch(() => {}); process.exit(2); }, 65000);
let session;
const scripts = new Map();
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const workspace = migratePhase1(legacyWorkspace());
  workspace.folders[0].parentId = null;
  workspace.ui.expandedFolderIds = ["folder"];
  workspace.pages[0].title = `Editor spike: ${mode}`;
  const tabs = createTabsDocument(["Overview", "Notes", "Files"]);
  tabs.children[0].children = [{ id: "qa-alpha", type: "paragraph", content: "Alpha panel text" }];
  tabs.children[1].children = [{ id: "qa-beta", type: "checkListItem", props: { checked: true }, content: "Beta checklist" }];
  tabs.children[2].children = [{ id: "qa-gamma", type: "paragraph", content: "Gamma panel text" }];
  const refs = ["a", "b"].map((id) => ({ id: `qa-sync-${id}`, type: "syncedBlock", props: { sourceId: "qa-source" } }));
  workspace.pages[0].content = [
    ...(mode === "tabs" || mode === "all" ? [tabs] : []),
    ...(mode === "sync" || mode === "all" ? refs : []),
    { id: "qa-trailing", type: "paragraph", content: "Mention target: " },
  ];
  workspace.syncedSources = [{ id: "qa-source", revision: 0, blocks: [{ id: "qa-canonical-p", type: "paragraph", content: "Canonical initial text" }], createdAt: "2026-09-01T09:00:00Z", updatedAt: "2026-09-01T09:00:00Z" }];
  workspace.dataSources = []; workspace.databaseItems = []; workspace.databaseViews = [];
  await context.addInitScript((data) => { if (!localStorage.getItem("life-atlas.spike.seeded")) { localStorage.setItem("life-atlas.workspace.v7", JSON.stringify(data)); localStorage.setItem("life-atlas.spike.seeded", "1"); } }, workspace);
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  page.on("console", (message) => { if (["error", "warning"].includes(message.type())) record("console", { type: message.type(), text: message.text().slice(0, 3000) }); });
  page.on("pageerror", (error) => record("pageerror", error.stack));
  page.on("response", (response) => { if (response.status() >= 400) record("http", { url: response.url(), status: response.status() }); });
  session = await context.newCDPSession(page);
  session.on("Debugger.scriptParsed", (event) => scripts.set(event.scriptId, event.url));
  session.on("Debugger.paused", (event) => record("paused-stack", event.callFrames.slice(0, 24).map((frame) => ({ fn: frame.functionName, location: frame.location, url: scripts.get(frame.location.scriptId) || frame.url }))));
  await session.send("Debugger.enable");
  record("navigate", mode);
  await timeout(page.goto(base, { waitUntil: "domcontentloaded" }), 15000, "navigate");
  record("dom-loaded", mode);
  await timeout(page.locator(".life-editor .bn-editor").first().waitFor({ state: "visible" }), 18000, "editor visible");
  const summary = await timeout(page.evaluate(() => ({
    tabs: [...document.querySelectorAll('[role="tab"]')].map((element) => ({ text: element.textContent, selected: element.getAttribute("aria-selected") })),
    panels: [...document.querySelectorAll('[role="tabpanel"]')].map((element) => ({ id: element.id, hidden: element.hidden, text: element.textContent })),
    synced: [...document.querySelectorAll(".life-synced-editor .bn-editor")].map((element) => element.innerText),
  })), 6000, "summary");
  record("mounted", summary);
  if (mode === "tabs" || mode === "all") {
    await page.getByRole("tab", { name: "Notes", exact: true }).click();
    await page.getByRole("tabpanel").filter({ hasText: "Beta checklist" }).waitFor({ state: "visible" });
    await page.getByRole("tab", { name: "Notes", exact: true }).press("ArrowRight");
    await page.getByRole("tabpanel").filter({ hasText: "Gamma panel text" }).waitFor({ state: "visible" });
    record("tabs-interaction", "click Notes + ArrowRight Files passed");
  }
  if (mode === "sync" || mode === "all") {
    const editors = page.locator(".life-synced-editor .bn-editor");
    await editors.nth(0).locator('[data-content-type="paragraph"]').fill("Synced edit A");
    await page.waitForFunction(() => [...document.querySelectorAll(".life-synced-editor .bn-editor")].every((element) => element.innerText.includes("Synced edit A")));
    await editors.nth(1).locator('[data-content-type="paragraph"]').fill("Synced edit B");
    await page.waitForFunction(() => [...document.querySelectorAll(".life-synced-editor .bn-editor")].every((element) => element.innerText.includes("Synced edit B")));
    record("sync-interaction", "A to B + B to A passed");
  }
  await delay(500);
  await timeout(page.screenshot({ path: `${path}.png`, fullPage: true }), 6000, "screenshot");
  await timeout(page.reload({ waitUntil: "domcontentloaded" }), 12000, "reload");
  await page.locator(".life-editor .bn-editor").first().waitFor({ state: "visible" });
  if (mode === "sync" || mode === "all") await page.waitForFunction(() => [...document.querySelectorAll(".life-synced-editor .bn-editor")].every((element) => element.innerText.includes("Synced edit B")));
  record("PASS", mode);
} catch (error) {
  record("FAIL", error.stack);
  process.exitCode = 1;
  if (session) {
    await timeout(session.send("Debugger.pause"), 2000, "debugger pause").catch((failure) => record("debugger-error", failure.message));
    await delay(250);
    await timeout(session.send("Runtime.terminateExecution"), 2000, "terminate test renderer").catch(() => {});
  }
} finally {
  await timeout(browser?.close(), 5000, "browser close").catch((error) => record("close-error", error.message));
  clearTimeout(watchdog);
}
