import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { upgradeWorkspace } from "../../src/persistence/migrations.js";
import { normalizeLoadedWorkspace } from "../../src/persistence/normalize.js";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";

// Importing this module does not acquire a browser or port. The parent owns
// admission and invokes runV14Wrapper132 only after description130 releases 5178.
export function wrapper132Fixture() {
  const value = coreParityWorkspace();
  const root = value.pages.find(page => page.id === "editor-page");
  root.title = "Research notebook 132";
  root.content = [{ id: "root-text132", type: "paragraph", content: "An independent document remains editable." }];
  const owner = value.pages.find(page => page.id === "database-page");
  owner.title = "Field observations";
  owner.parentPageId = root.id;
  const source = value.dataSources.find(source => source.id === "projects");
  source.title = owner.title;
  source.properties = source.properties.filter(property => ["title", "status", "amount"].includes(property.id));
  source.properties.find(property => property.id === "status").options = [
    { id: "todo", name: "Collected" }, { id: "doing", name: "Developing" }, { id: "done", name: "Reviewed" },
  ];
  const definitions = [
    { id: "alpha", title: "Orchid notes", status: "done", amount: 1 },
    { id: "beta", title: "Canyon notes", status: "doing", amount: 3 },
    { id: "gamma", title: "Harbour notes", status: "done", amount: 2 },
  ];
  for (const definition of definitions) {
    const item = value.databaseItems.find(item => item.id === definition.id);
    item.values = { title: definition.title, status: definition.status, amount: definition.amount };
    const record = value.pages.find(page => page.id === item.pageId);
    record.title = definition.title;
    record.content = [{ id: `${definition.id}-text132`, type: "paragraph", content: `${definition.title}: independent record body.` }];
    record.cover = { kind: "gallery", value: "hokusai-landscape", position: 0 };
  }
  value.attachments = [];
  value.databaseViews = value.databaseViews.filter(view => ["view-table", "view-gallery", "view-board"].includes(view.id));
  const gallery = value.databaseViews.find(view => view.id === "view-gallery");
  Object.assign(gallery, {
    name: "Review collection", filter: { propertyId: "status", operator: "equals", value: "done" },
    sorts: [{ propertyId: "amount", direction: "desc" }], visiblePropertyIds: ["title", "amount"],
    config: { openRecordsIn: "peek", gallery: { cardSize: "small", imageFit: "contain", preview: { kind: "page-cover", propertyId: null }, visiblePropertyIds: ["amount"] } },
  });
  const board = value.databaseViews.find(view => view.id === "view-board");
  Object.assign(board, {
    name: "Stages of observation", filter: null, sorts: [{ propertyId: "amount", direction: "asc" }], groupBy: "status",
    visiblePropertyIds: ["title", "amount"], config: { openRecordsIn: "page", board: { visiblePropertyIds: ["amount"] } },
  });
  const linkedBlock = (id, viewId) => ({ id, type: "databaseView", props: { sourceId: source.id, viewId } });
  const wrapper = (id, title, content, locked = false) => ({
    ...structuredClone(root), id, title, parentPageId: root.id, content,
    settings: { ...root.settings, locked },
  });
  value.pages.push(
    wrapper("gallery-wrapper132", "Reviewed fieldwork", [linkedBlock("gallery-block132", gallery.id)]),
    wrapper("board-wrapper132", "Observation stages", [linkedBlock("board-block132", board.id)]),
    wrapper("locked-wrapper132", "Read-only collection", [linkedBlock("locked-block132", gallery.id)], true),
    wrapper("body-page132", "Analysis beside observations", [
      { id: "body-text132", type: "paragraph", content: "This is meaningful ordinary body, not an imported header description." },
      linkedBlock("body-db132", gallery.id),
    ]),
    wrapper("description-wrapper132", "Described observations", [
      { id: "imported-description132", type: "paragraph", content: [{ type: "text", text: "Imported description: preserve this explanation.", styles: { italic: true } }] },
      linkedBlock("description-db132", board.id),
    ]),
  );
  // A same-title independent source/view catches title-based or canonical aliasing.
  const otherOwner = wrapper("other-owner132", owner.title, []);
  Object.assign(otherOwner, { pageType: "database", databaseSourceId: "other-source132", databaseViewId: "other-view132" });
  value.pages.push(otherOwner);
  value.dataSources.push({ ...structuredClone(source), id: "other-source132", ownerPageId: otherOwner.id });
  value.databaseViews.push({ ...structuredClone(gallery), id: "other-view132", sourceId: "other-source132" });
  value.ui = { ...value.ui, activeSection: "private", selectedPageId: root.id, privateExpanded: true,
    expandedPageIds: [root.id], preferences: { style: "mobai", theme: "system", startPage: "last" } };
  return normalizeLoadedWorkspace(upgradeWorkspace(value), { idFactory: prefix => `${prefix}-wrapper132-fixture` });
}

export async function runV14Wrapper132({ run = process.env.V14_WRAPPER132_RUN || `run-${Date.now()}` } = {}) {
  assert.match(run, /^[a-z0-9-]+$/);
  const base = new URL(process.env.PARITY_BASE_URL || "http://127.0.0.1:5178");
  assert.equal(base.href, "http://127.0.0.1:5178/");
  const directory = path.resolve(".qa/LOCAL-NOTION-001/v14-linked-view129/wrapper132", run);
  assert.equal(existsSync(directory), false, "Preserve every previous RED and GREEN run");
  mkdirSync(directory, { recursive: true });
  const seed = wrapper132Fixture();
  const report = { name: "v14-wrapper132", run, passed: false, checks: [], errors: [], screenshots: [],
    startedAt: new Date().toISOString(), resources: { browserClosed: false, contextClosed: false },
    limitations: ["Browser reload is not native EXE restart evidence", "Imported descriptions need provenance; the unmarked description case is deliberately RED-capable", "Embedded standalone occurrence navigation and tab membership are outside this scenario"] };
  const put = (name, value) => writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + "\n");
  const publish = () => put("report.json", report);
  put("fixture.json", seed); publish();
  let browser, context, page;
  const bounded = (promise, ms, label) => {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms); })])
      .finally(() => clearTimeout(timer));
  };
  const check = async (label, callback) => {
    const item = { label, passed: false }; report.checks.push(item); publish();
    console.log(`CHECK wrapper132: ${label}`);
    try { await bounded(callback(), 20000, label); item.passed = true; }
    catch (error) { item.error = error.stack; console.error(error.stack); }
    publish();
  };
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin === base.origin || ["data:", "blob:"].includes(url.protocol)) return route.continue();
      report.errors.push({ kind: "unexpected-network", url: url.href }); publish(); return route.abort();
    });
    await context.addInitScript(({ seed, key }) => {
      if (!localStorage.getItem("life-atlas.harness.seeded")) {
        localStorage.setItem(key, JSON.stringify(seed));
        localStorage.setItem("life-atlas.harness.seeded", "1");
        localStorage.setItem("life-atlas.parity.seeded", "1");
      }
    }, { seed, key: workspaceStorageKey });
    page = await context.newPage(); page.setDefaultTimeout(5000);
    page.on("pageerror", error => { report.errors.push({ kind: "pageerror", message: error.stack }); publish(); });
    page.on("console", message => { if (message.type() === "error") { report.errors.push({ kind: "console", message: message.text() }); publish(); } });
    await page.goto(base.href, { waitUntil: "domcontentloaded" });
    const sidebar = page.getByRole("complementary", { name: "主导航" });
    const open = async id => {
      await sidebar.locator(`[data-node-id="${id}"] > .sidebar-page-main`).click();
      await page.waitForFunction(({ id, titles }) => document.querySelector("[data-linked-wrapper-page-id]")?.dataset.linkedWrapperPageId === id
        || document.querySelector(".page-title-input")?.value === titles[id],
        { id, titles: Object.fromEntries(seed.pages.map(page => [page.id, page.title])) });
    };
    const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), workspaceStorageKey);
    const settleSaved = async id => {
      await page.waitForFunction(({ key, id }) => JSON.parse(localStorage.getItem(key))?.ui.selectedPageId === id, { key: workspaceStorageKey, id });
      await page.waitForFunction(() => document.querySelector(".save-state")?.textContent === "已保存");
      return saved();
    };
    const preserved = async (id, label) => {
      const actual = await settleSaved(id); put(`saved-${label}.json`, actual);
      for (const key of Object.keys(seed).filter(key => !["ui", "folders", "updatedAt"].includes(key))) assert.deepEqual(actual[key], seed[key], key);
      const withoutLastOpened = folders => folders.map(({ lastOpenedPageId, ...folder }) => folder);
      assert.deepEqual(withoutLastOpened(actual.folders), withoutLastOpened(seed.folders), "Only existing folder lastOpenedPageId may change");
      assert.deepEqual(Object.keys(actual.ui).sort(), Object.keys(seed.ui).sort(), "No persisted navigation field may be added");
    };
    const database = () => page.locator(".page-full-database > section.database-view.is-full-page");
    const exact = async (wrapperId, viewId, type) => {
      const db = database(); assert.equal(await db.count(), 1, "Wrapper must render a single standalone database");
      assert.equal(await page.locator(`.life-editor[data-page-id="${wrapperId}"]`).count(), 0, "Wrapper must not be a sole database editor block");
      assert.equal(await db.getAttribute("data-source-id"), "projects");
      assert.equal(await db.getAttribute("data-view-id"), viewId); assert.equal(await db.getAttribute("data-view-type"), type);
      assert.equal(await db.locator(`[role="tab"][data-view-id="${viewId}"][aria-selected="true"]`).count(), 1);
      assert.equal(await sidebar.locator(`[data-node-id="${wrapperId}"].is-selected`).count(), 1);
      assert.equal(await sidebar.locator('[data-node-id="database-page"].is-selected').count(), 0);
      return db;
    };
    await check("Different-title gallery wrapper keeps wrapper identity, exact source/view and configured projection", async () => {
      await open("gallery-wrapper132"); const db = await exact("gallery-wrapper132", "view-gallery", "gallery");
      assert.deepEqual(await db.locator(".db-gallery-card").evaluateAll(cards => cards.map(card => card.dataset.itemId)), ["gamma", "alpha"]);
      assert.equal(await db.locator(".db-gallery-view").getAttribute("data-card-size"), "small");
      assert.equal(await db.locator(".db-gallery-preview").first().evaluate(element => getComputedStyle(element).backgroundSize), "contain");
      assert.deepEqual(await db.locator('.db-gallery-card[data-item-id="gamma"] [data-property-id]').evaluateAll(elements => elements.map(element => element.dataset.propertyId)), ["amount"]);
      await preserved("gallery-wrapper132", "gallery-open");
    });
    await check("Search, view settings and record peek retain controls and focus without domain writes", async () => {
      await open("gallery-wrapper132"); const db = await exact("gallery-wrapper132", "view-gallery", "gallery");
      await db.getByRole("button", { name: "搜索此视图", exact: true }).click();
      const search = db.getByRole("textbox", { name: "在此视图中搜索" }); await search.fill("Orchid");
      assert.deepEqual(await db.locator(".db-gallery-card").evaluateAll(cards => cards.map(card => card.dataset.itemId)), ["alpha"]);
      await search.press("Escape");
      await db.getByRole("button", { name: "视图设置", exact: true }).click();
      await page.getByRole("dialog", { name: "视图设置", exact: true }).waitFor(); await page.keyboard.press("Escape");
      assert.equal(await db.getByRole("button", { name: "视图设置", exact: true }).evaluate(element => element === document.activeElement), true);
      const card = db.locator('.db-gallery-card[data-item-id="alpha"] .db-gallery-open'); await card.click();
      await page.getByRole("button", { name: "关闭预览", exact: true }).click();
      assert.equal(await card.evaluate(element => element === document.activeElement), true);
      await preserved("gallery-wrapper132", "controls");
    });
    await check("Temporary tab selection and explicit same-wrapper reopening return to the referenced saved view", async () => {
      await open("gallery-wrapper132"); const db = await exact("gallery-wrapper132", "view-gallery", "gallery");
      await db.locator('[role="tab"][data-view-id="view-board"]').click();
      assert.equal(await db.getAttribute("data-view-id"), "view-board"); await preserved("gallery-wrapper132", "temporary-tab");
      await open("gallery-wrapper132"); await exact("gallery-wrapper132", "view-gallery", "gallery");
      await preserved("gallery-wrapper132", "reopened");
    });
    await check("Different-title board wrapper has exact groups/cards and returns from record Back/Forward", async () => {
      await open("board-wrapper132"); const db = await exact("board-wrapper132", "view-board", "board");
      const groups = await db.locator(".db-board-column").evaluateAll(columns => Object.fromEntries(columns.map(column => [column.dataset.groupKey, [...column.querySelectorAll(".db-board-card-open strong")].map(title => title.textContent)])));
      assert.deepEqual(groups.doing, ["Canyon notes"]); assert.deepEqual(groups.done, ["Orchid notes", "Harbour notes"]);
      await db.getByRole("button", { name: "Canyon notes", exact: true }).click(); await settleSaved("beta-page");
      await page.getByRole("button", { name: "后退", exact: true }).click(); await exact("board-wrapper132", "view-board", "board");
      await page.getByRole("button", { name: "前进", exact: true }).click(); await settleSaved("beta-page");
      await page.getByRole("button", { name: "后退", exact: true }).click(); await preserved("board-wrapper132", "history");
    });
    await check("Locked wrapper keeps lock and exact saved view through local tab choice/reopening", async () => {
      await open("locked-wrapper132"); const db = await exact("locked-wrapper132", "view-gallery", "gallery");
      assert.equal(await page.locator(".page-title-input").getAttribute("readonly"), "");
      assert.equal(await db.getByRole("button", { name: "新建记录", exact: true }).count(), 0);
      assert.equal(await db.getByRole("button", { name: "视图设置", exact: true }).count(), 0);
      await db.locator('[role="tab"][data-view-id="view-board"]').click(); await open("locked-wrapper132");
      await exact("locked-wrapper132", "view-gallery", "gallery"); await preserved("locked-wrapper132", "locked");
    });
    await check("Meaningful other body and unrelated pages stay in their editors intact; canonical table remains canonical", async () => {
      await open("body-page132"); assert.equal(await database().count(), 0);
      assert.match(await page.locator('.life-editor[data-page-id="body-page132"]').innerText(), /meaningful ordinary body/);
      await preserved("body-page132", "ordinary-body");
      await open("editor-page"); assert.equal(await database().count(), 0);
      assert.match(await page.locator('.life-editor[data-page-id="editor-page"]').innerText(), /independent document/);
      await open("database-page"); assert.equal(await database().getAttribute("data-view-id"), "view-table");
      await preserved("database-page", "canonical");
    });
    await check("Imported header description survives in standalone presentation (unmarked provenance remains a distinct gap)", async () => {
      await open("description-wrapper132"); await exact("description-wrapper132", "view-board", "board");
      assert.match(await page.locator(".page-document").innerText(), /Imported description: preserve this explanation\./);
      await preserved("description-wrapper132", "description");
    });
    await check("Reload reconstructs wrapper identity/layout with existing UI keys and unchanged domains", async () => {
      await open("gallery-wrapper132"); await preserved("gallery-wrapper132", "before-reload"); await page.reload({ waitUntil: "domcontentloaded" });
      await exact("gallery-wrapper132", "view-gallery", "gallery"); await preserved("gallery-wrapper132", "reload");
      const file = path.join(directory, "wrapper-light.png"); await page.screenshot({ path: file, animations: "disabled" }); report.screenshots.push(file);
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      const dark = path.join(directory, "wrapper-dark.png"); await page.screenshot({ path: dark, animations: "disabled" }); report.screenshots.push(dark);
    });
    assert.deepEqual(report.errors, [], "No external network, page or console errors");
    report.passed = report.checks.length === 8 && report.checks.every(check => check.passed);
  } catch (error) { report.errors.push({ kind: "scenario", message: error.stack }); }
  finally {
    if (page && !report.passed) await bounded(page.screenshot({ path: path.join(directory, "failure.png"), animations: "disabled" }), 5000, "failure screenshot").catch(() => {});
    await bounded(context?.close(), 10000, "context close").then(() => { report.resources.contextClosed = true; }).catch(error => report.errors.push({ kind: "close", message: error.message }));
    await bounded(browser?.close(), 10000, "browser close").then(() => { report.resources.browserClosed = true; }).catch(error => report.errors.push({ kind: "close", message: error.message }));
    if (report.errors.length) report.passed = false; report.completedAt = new Date().toISOString(); publish();
  }
  if (!report.passed) process.exitCode = 1;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await runV14Wrapper132();
