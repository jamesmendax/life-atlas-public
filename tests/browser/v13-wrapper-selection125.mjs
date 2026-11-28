import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { upgradeWorkspace } from "../../src/persistence/migrations.js";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";

// Standard core runner owns 5178. Match the selection harness's fresh Edge
// context and seed-once contract, keeping failure artifacts in this run only.
const name = "v13-wrapper-selection125";
const run = process.env.V13_WRAPPER_SELECTION125_RUN || `run-${Date.now()}`;
assert.match(run, /^[a-z0-9-]+$/);
const base = new URL(process.env.PARITY_BASE_URL || "http://127.0.0.1:5178");
assert.equal(base.href, "http://127.0.0.1:5178/");
const directory = path.resolve(".qa/LOCAL-NOTION-001/v13-wiki-navigation122/selection125", run);
assert.equal(existsSync(directory), false, "Preserve every previous run");
mkdirSync(directory, { recursive: true });
const put = (file, value) => writeFileSync(path.join(directory, file), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const report = {
  name, run, startedAt: new Date().toISOString(), passed: false, checks: [], errors: [],
  storageKey: workspaceStorageKey, screenshots: [], observations: [],
  isolation: { base: base.origin, seed: "synthetic core fixture once; later evaluate calls read only", viewport: { width: 1440, height: 1040 } },
  resources: { contextClosed: false, browserClosed: false },
};
const publish = () => {
  const text = JSON.stringify(report, null, 2) + "\n";
  writeFileSync(path.join(directory, "report.json"), text);
  // This standard summary path is explicitly parent-owned/authorized.
  writeFileSync(`.qa/${name}.json`, text);
};
publish();
put("inspected-inputs.json", [
  "src/editor/PageEditor.jsx", "src/editor/LayoutTrailingExtension.js", "src/domain/navigation.js",
  "tests/browser/database-initial-selection-v10.mjs", "tests/browser/database-click-selection-v10.mjs",
  "tests/browser/harness.mjs", "tests/browser/v13-wrapper-selection125.mjs",
].map(file => ({ file, bytes: statSync(file).size, modifiedAt: statSync(file).mtime.toISOString() })));
put("initial-selection-source.json", {
  file: "src/editor/PageEditor.jsx", firstLine: 170,
  text: readFileSync("src/editor/PageEditor.jsx", "utf8").split(/\r?\n/).slice(169, 178).join("\n"),
});

const ids = { root: "editor-page", wrapper: "wrapper-page125", block: "wrapper-db125", source: "projects", table: "view-table", list: "view-list" };
const workspace = coreParityWorkspace();
const rootPage = workspace.pages.find(page => page.id === ids.root);
const canonical = workspace.pages.find(page => page.id === "database-page");
const source = workspace.dataSources.find(entry => entry.id === ids.source);
source.title = canonical.title = "文章";
source.ownerPageId = canonical.id;
source.properties = source.properties.filter(property => ["title", "status", "amount"].includes(property.id));
canonical.parentPageId = ids.root;
rootPage.title = "Wiki 导航125";
rootPage.content = [
  { id: "start125", type: "paragraph", content: "从另一个普通页面用侧栏打开 View of 文章。" },
  { id: "canonical-link125", type: "pageLink", props: { pageId: canonical.id, label: "文章" } },
  { id: "wrapper-link125", type: "pageLink", props: { pageId: ids.wrapper, label: "文章" } },
];
const wrapper = {
  ...structuredClone(rootPage), id: ids.wrapper, title: "文章", parentPageId: ids.root, sortIndex: 30,
  content: [{ id: ids.block, type: "databaseView", props: { sourceId: ids.source, viewId: ids.table } }],
};
delete wrapper.pageType;
delete wrapper.databaseSourceId;
delete wrapper.databaseViewId;
workspace.pages.push(wrapper);
const modelItem = workspace.databaseItems.find(item => item.id === "alpha");
const modelRecordPage = workspace.pages.find(page => page.id === modelItem.pageId);
for (let index = 4; index <= 10; index += 1) {
  const id = `article125-${index}`;
  const title = `Article ${index}`;
  workspace.databaseItems.push({ ...structuredClone(modelItem), id, pageId: `${id}-page`, values: { title, status: "todo", amount: index } });
  workspace.pages.push({ ...structuredClone(modelRecordPage), id: `${id}-page`, title, parentPageId: canonical.id,
    content: [{ id: `${id}-body`, type: "paragraph", content: title }] });
}
workspace.databaseViews = workspace.databaseViews.filter(view => [ids.table, ids.list].includes(view.id));
for (const view of workspace.databaseViews) Object.assign(view, {
  name: view.type === "table" ? "全部文章" : "文章列表", visiblePropertyIds: ["title", "status", "amount"],
  filter: null, sorts: [], groupBy: null,
});
workspace.ui = { ...workspace.ui, activeSection: "private", selectedPageId: ids.root, privateExpanded: true,
  expandedPageIds: [ids.root], preferences: { style: "mobai", theme: "light" } };
const seed = upgradeWorkspace(workspace);
put("fixture-shape.json", {
  wrapper: seed.pages.find(page => page.id === ids.wrapper),
  canonical: { id: canonical.id, pageType: canonical.pageType }, sourceOwner: source.ownerPageId,
  itemCount: seed.databaseItems.filter(item => item.sourceId === ids.source).length,
  initialPageId: seed.ui.selectedPageId, note: "One normal wrapper, one databaseView block, zero paragraphs; no native DB copied",
});

let browser, context, page;
const bounded = (promise, ms, label) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms); })])
    .finally(() => clearTimeout(timer));
};
const check = async (label, callback) => {
  const item = { label, passed: false, startedAt: new Date().toISOString() };
  report.checks.push(item); publish(); console.log(`CHECK 125: ${label}`);
  try { await bounded(callback(), 20000, label); item.passed = true; }
  catch (error) { item.error = error.stack; console.error(error.stack); }
  item.completedAt = new Date().toISOString(); publish();
};
const editorSelector = `.life-editor[data-page-id="${ids.wrapper}"] .bn-editor`;
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const snapshot = async label => {
  await settle();
  const value = await page.evaluate(({ selector, blockId, storageKey }) => {
    const root = document.querySelector(selector);
    const db = root?.querySelector(`[data-id="${blockId}"] section.database-view`);
    const editor = root?.pmViewDesc?.node.type.schema.cached.blockNoteEditor;
    if (!root || !db || !editor) throw new Error("Sole wrapper PageEditor/database unavailable");
    const describe = element => element ? {
      tag: element.tagName, className: element.className, blockId: element.closest("[data-id]")?.dataset.id || null,
      ariaLabel: element.getAttribute("aria-label"), inDatabase: db.contains(element), containsDatabase: element.contains(db),
      focused: element === document.activeElement, focusVisible: element.matches(":focus-visible"),
    } : null;
    const css = (element, pseudo) => {
      const style = getComputedStyle(element, pseudo);
      return Object.fromEntries(["content", "position", "inset", "pointerEvents", "backgroundColor", "boxShadow", "outlineStyle", "outlineWidth", "outlineColor", "outlineOffset"].map(key => [key, style[key]]));
    };
    const selection = editor.prosemirrorState.selection;
    const selected = [...root.querySelectorAll(".ProseMirror-selectednode")].map(element => ({
      ...describe(element), css: css(element), children: [...element.children].map(child => ({ ...describe(child), css: css(child), after: css(child, "::after") })),
    }));
    const dom = window.getSelection();
    let coversDatabase = false;
    if (dom?.rangeCount && !dom.isCollapsed) {
      const range = dom.getRangeAt(0), dbRange = document.createRange(); dbRange.selectNodeContents(db);
      coversDatabase = range.compareBoundaryPoints(Range.START_TO_START, dbRange) <= 0 && range.compareBoundaryPoints(Range.END_TO_END, dbRange) >= 0;
    }
    const saved = JSON.parse(localStorage.getItem(storageKey));
    return {
      title: document.querySelector(".page-title-input")?.value,
      blocks: editor.document.map(block => ({ id: block.id, type: block.type, props: block.props })),
      pm: { type: selection.constructor.name, json: selection.toJSON(), nodeType: selection.node?.type.name || null,
        empty: selection.empty, focused: editor.prosemirrorView.hasFocus() },
      selected, database: { ...describe(db), css: css(db), after: css(db, "::after") },
      active: { ...describe(document.activeElement), css: css(document.activeElement) },
      dom: { type: dom?.type, collapsed: dom?.isCollapsed, textLength: dom?.toString().length || 0, coversDatabase },
      selectedPageId: saved?.ui?.selectedPageId || null,
    };
  }, { selector: editorSelector, blockId: ids.block, storageKey: workspaceStorageKey });
  put(`${label}.json`, value); report.observations.push({ label, pm: value.pm, selected: value.selected.map(item => item.className) });
  await page.screenshot({ path: path.join(directory, `${label}.png`), animations: "disabled" });
  report.screenshots.push(`${label}.png`); publish(); return value;
};
const assertSoleWrapper = value => {
  assert.deepEqual(value.blocks.map(block => [block.id, block.type]), [[ids.block, "databaseView"]], "Normal wrapper has exactly one DB block and no appended paragraph");
  assert.equal(value.title, "文章", "Actual page title differs from its View of sidebar label");
};
const initial = [], reopen = [];
const watchdog = setTimeout(async () => {
  report.errors.push({ kind: "watchdog", message: "Scenario exceeded 150 seconds" }); publish();
  await bounded(browser?.close(), 5000, "watchdog browser close").catch(() => {});
  process.exit(2);
}, 150000);
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  context = await browser.newContext({ viewport: report.isolation.viewport });
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && url.origin !== base.origin) {
      report.errors.push({ kind: "outside-request", url: url.href }); return route.abort();
    }
    return route.continue();
  });
  await context.addInitScript(({ key, seed }) => {
    if (!localStorage.getItem("life-atlas.harness.seeded")) {
      localStorage.setItem(key, JSON.stringify(seed));
      localStorage.setItem("life-atlas.harness.seeded", "1");
      localStorage.setItem("life-atlas.parity.seeded", "1");
    }
  }, { key: workspaceStorageKey, seed });
  page = await context.newPage(); page.setDefaultTimeout(9000); page.setDefaultNavigationTimeout(15000);
  page.on("pageerror", error => report.errors.push({ kind: "pageerror", message: error.stack }));
  page.on("console", message => { if (message.type() === "error") report.errors.push({ kind: "console", message: message.text() }); });
  page.on("response", response => { if (response.status() >= 400) report.errors.push({ kind: "http", status: response.status(), url: response.url() }); });
  await page.goto(base.href, { waitUntil: "domcontentloaded" });
  const sidebar = page.getByRole("complementary", { name: "主导航" });
  const wrapperRow = sidebar.locator(`[data-node-id="${ids.wrapper}"]`);
  const rootButton = sidebar.locator(`[data-node-id="${ids.root}"] > .sidebar-page-main`);
  const db = page.locator(`${editorSelector} [data-id="${ids.block}"] section.database-view`);
  const openWrapper = async () => {
    await wrapperRow.locator(":scope > .sidebar-page-main").click();
    await db.locator(".db-table tbody tr[data-item-id]").first().waitFor();
  };
  await check("Faithful normal wrapper reached by sidebar from another page", async () => {
    await page.locator(`.life-editor[data-page-id="${ids.root}"] .bn-editor`).waitFor();
    assert.equal(await wrapperRow.getAttribute("aria-label"), "View of 文章");
    assert.notEqual(seed.pages.find(entry => entry.id === ids.wrapper).pageType, "database");
    await openWrapper(); initial.push(await snapshot("01-initial"));
    await page.waitForTimeout(350); initial.push(await snapshot("02-initial-stable"));
    initial.forEach(assertSoleWrapper);
    assert.equal(await db.locator(".db-table tbody tr[data-item-id]").count(), 10);
  });
  await check("Ordinary leave and reopen without any editor input", async () => {
    await rootButton.click(); await page.locator(`.life-editor[data-page-id="${ids.root}"] .bn-editor`).waitFor();
    await openWrapper(); reopen.push(await snapshot("03-reopen"));
    await page.waitForTimeout(350); reopen.push(await snapshot("04-reopen-stable"));
    reopen.forEach(assertSoleWrapper);
  });
  await check("Normal DB search, view switch, settings and record peek work", async () => {
    const original = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), workspaceStorageKey);
    const native = () => page.evaluate(selector => document.querySelector(selector).pmViewDesc.node.type.schema.cached.blockNoteEditor.document, editorSelector);
    const originalNative = await native();
    await db.getByRole("button", { name: "搜索此视图", exact: true }).click();
    const search = db.getByRole("textbox", { name: "在此视图中搜索", exact: true });
    await search.fill("Alpha");
    await page.waitForFunction(selector => document.querySelectorAll(`${selector} .db-table tbody tr[data-item-id]`).length === 1, editorSelector);
    assert.equal(await db.locator('.db-table tbody tr[data-item-id="alpha"]').count(), 1);
    await search.press("Escape");
    await db.getByRole("tab", { name: "文章列表", exact: true }).click(); await db.locator(".db-list-row").first().waitFor();
    await db.getByRole("tab", { name: "全部文章", exact: true }).click(); await db.locator(".db-table").waitFor();
    await db.getByRole("button", { name: "视图设置", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "视图设置", exact: true }); await settings.waitFor();
    await settings.getByRole("button", { name: "关闭视图设置", exact: true }).click(); await settings.waitFor({ state: "hidden" });
    // The normal Open control is hover-revealed; do not force-click hidden UI.
    await db.locator('.db-table tr[data-item-id="alpha"] .db-title-control').hover();
    await db.getByRole("button", { name: "打开 Alpha 项目", exact: true }).click();
    const peek = page.getByRole("dialog", { name: "记录预览", exact: true }); await peek.waitFor();
    assert.equal(await peek.getByRole("textbox", { name: "记录标题", exact: true }).inputValue(), "Alpha 项目");
    await peek.getByRole("button", { name: "关闭预览", exact: true }).click(); await peek.waitFor({ state: "hidden" });
    assert.equal(await db.locator(".db-table tbody tr[data-item-id]").count(), 10);
    await page.waitForFunction(({ key, pageId, viewId }) => JSON.parse(localStorage.getItem(key)).pages.find(entry => entry.id === pageId).content[0]?.props.viewId === viewId,
      { key: workspaceStorageKey, pageId: ids.wrapper, viewId: ids.table });
    const after = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), workspaceStorageKey);
    assert.deepEqual(await native(), originalNative, "View switching preserves the native sole wrapper after switching back");
    const ownership = pages => pages.map(({ id, title, folderId, parentPageId, pageType, databaseSourceId, databaseViewId }) => ({ id, title, folderId, parentPageId, pageType, databaseSourceId, databaseViewId }));
    assert.deepEqual(ownership(after.pages), ownership(original.pages), "Controls preserve page identity/title/ownership");
    for (const key of ["dataSources", "databaseItems", "databaseViews"]) assert.deepEqual(after[key], original[key], `${key} preserved after returning to original view`);
    assertSoleWrapper(await snapshot("05-controls-returned"));
  });
  // Assert only after all untouched initial/reopen evidence and controls are saved.
  for (const [label, values] of [["Initial navigation", initial], ["Reopen navigation", reopen]]) {
    await check(`${label} has no whole DB selected-node decoration`, async () => {
      assert.equal(values.length, 2, "Both immediate and stable observations exist");
      for (const value of values) {
        assert.equal(value.selected.filter(node => node.containsDatabase || node.inDatabase).length, 0,
          `${label}: .ProseMirror-selectednode must not decorate the untouched database; PM=${JSON.stringify(value.pm)}`);
        assert.equal(value.dom.coversDatabase, false, "Normal navigation must not select the entire DB DOM contents");
      }
    });
  }
  await check("Zero captured browser, console, HTTP or outside-request errors", async () => assert.deepEqual(report.errors, []));
  report.exactSymptomReproduced = [...initial, ...reopen].some(value => value.pm.nodeType === "databaseView" && value.selected.some(node => node.containsDatabase));
  report.passed = report.checks.every(item => item.passed);
  report.outcome = report.exactSymptomReproduced ? "RED: untouched sole normal wrapper has DB NodeSelection and selected-node decoration" : report.passed ? "Scope passes: exact symptom not reproduced" : "Setup/control failure; not evidence of exact symptom";
} catch (error) {
  report.failure = error.stack; console.error(error.stack);
  put("failed-setup.json", { error: error.stack, at: new Date().toISOString() });
  if (page) await bounded(page.screenshot({ path: path.join(directory, "failed-setup.png"), animations: "disabled" }), 5000, "setup screenshot").catch(() => {});
} finally {
  for (const [kind, resource] of [["context", context], ["browser", browser]]) {
    if (!resource) continue;
    await bounded(resource.close(), 15000, `${kind} close`).then(() => { report.resources[`${kind}Closed`] = true; }).catch(error => {
      report.passed = false; report.errors.push({ kind: "close", resource: kind, message: error.message });
    });
  }
  report.completedAt = new Date().toISOString(); report.exitCode = report.passed ? 0 : 1;
  publish(); clearTimeout(watchdog); process.exitCode = report.exitCode;
  console.log(`WRAPPER SELECTION125: ${report.checks.filter(item => item.passed).length}/${report.checks.length} checks; exit=${report.exitCode}; contextClosed=${report.resources.contextClosed}; browserClosed=${report.resources.browserClosed}; ${directory}`);
}
