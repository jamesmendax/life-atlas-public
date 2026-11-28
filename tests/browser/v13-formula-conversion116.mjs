import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { upgradeWorkspace } from "../../src/persistence/migrations.js";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";

// Independent UI regression: seed once, then exercise only product callbacks.
// Do not use the shared harness's whole src/tests/assets fingerprint walk.
const run = process.env.V13_FORMULA_CONVERSION116_RUN || "local01";
assert.match(run, /^[a-z0-9-]+$/);
const root = path.resolve(".qa/LOCAL-NOTION-001/v13-wiki-formula116/browser116", run);
mkdirSync(root, { recursive: true });
const reportPath = path.join(root, "report.json");
const put = (name, value) => writeFileSync(path.join(root, name), JSON.stringify(value, null, 2), { flag: "wx" });
const NOW = "2026-11-13T04:34:56.789Z";
const SOURCE_ID = "projects", PROPERTY_ID = "notes", PROPERTY_NAME = "首页近期";
const ARTICLE = 'if(prop("状态") == "Published" and not empty(prop("发布日期")) and dateBetween(now(), prop("发布日期"), "days") <= 21, "SHOW", "HIDE")';
const LIVE = ARTICLE.replace('"Published"', '"Live116"');
const files = [
  "src/App.jsx", "src/components/DatabaseTable.jsx", "src/components/FormulaEditor.jsx",
  "src/components/PropertyEditor.jsx", "src/domain/propertyChanges.js",
  "tests/browser/v13-formula-conversion116.mjs", "tests/fixtures/core-parity-workspace.mjs",
];
const fingerprint = () => {
  const hashes = Object.fromEntries(files.map(file => [file, createHash("sha256").update(readFileSync(file)).digest("hex")]));
  return { scope: "seven named code inputs only; no Wiki/user assets or directory walk", hashes,
    sha256: createHash("sha256").update(JSON.stringify(hashes)).digest("hex") };
};
const beforeSource = fingerprint();
put("source-before.json", beforeSource);
const report = {
  name: "v13-formula-conversion116", run, startedAt: new Date().toISOString(), passed: false,
  sourceFingerprint: beforeSource.sha256, fingerprintScope: beforeSource.scope,
  storageKey: workspaceStorageKey, checks: [], errors: [], screenshots: [], snapshots: [],
  isolation: { base: process.env.PARITY_BASE_URL || "http://127.0.0.1:5178", root, seedWrites: "init script once per fresh context; all later evaluate calls read only" },
  resources: { contextClosed: false, browserClosed: false },
};
assert.equal(new URL(report.isolation.base).origin, "http://127.0.0.1:5178");
const publish = () => writeFileSync(reportPath, JSON.stringify(report, null, 2));
const src = state => state.dataSources.find(source => source.id === SOURCE_ID);
const prop = state => src(state).properties.find(property => property.id === PROPERTY_ID);
const item = (state, id) => state.databaseItems.find(entry => entry.id === id);

function fixture() {
  const state = coreParityWorkspace();
  const source = src(state);
  source.properties = source.properties.filter(property => ["title", "status", "amount", "date", "notes", "formula"].includes(property.id));
  Object.assign(prop(state), { name: PROPERTY_NAME,
    config: { expression: '"OLD-CODE116"', custom: { label: "keep116" }, numberFormat: { format: "number", decimals: 2 } } });
  Object.assign(source.properties.find(property => property.id === "status"), {
    type: "select", options: [{ id: "published116", name: "Published", color: "green" }, { id: "archived116", name: "Archived", color: "brown" }],
  });
  source.properties.find(property => property.id === "date").name = "发布日期";
  Object.assign(source.properties.find(property => property.id === "formula"), {
    name: "引用结果116", config: { expression: 'concat("result116:", prop("首页近期"))' },
  });
  for (const [index, record] of state.databaseItems.filter(entry => entry.sourceId === SOURCE_ID).entries()) {
    record.values = { title: record.values.title, amount: record.values.amount,
      notes: ["HIDE", "SHOW", 'prop("金额") + 116'][index],
      status: index === 1 ? "archived116" : "published116",
      date: index === 2 ? null : { start: "2026-11-12", end: null, includeTime: false, timeZone: null } };
  }
  const partner = state.dataSources.find(entry => entry.id === "partners");
  partner.properties.push({ ...structuredClone(prop(state)), name: "其他源文本116", config: { expression: "other116" } });
  item(state, "partner-one").values.notes = "keep other source116";
  state.databaseViews = state.databaseViews.filter(view => ["view-table", "view-list"].includes(view.id));
  for (const view of state.databaseViews) {
    Object.assign(view, { visiblePropertyIds: source.properties.map(property => property.id), filter: null,
      sorts: [{ propertyId: "amount", direction: "desc" }], groupBy: null,
      config: { table: { columnWidths: { title: 150, status: 110, amount: 100, date: 140, notes: 160, formula: 160 },
        wrapPropertyIds: [PROPERTY_ID], calculations: { notes: "count_all", amount: "sum" } } } });
  }
  state.pages = state.pages.filter(page => page.id !== "editor-page");
  for (const page of state.pages) if (page.id !== "database-page") page.content = [];
  state.pages.find(page => page.id === "database-page").settings.fullWidth = true;
  state.attachments = []; state.syncedSources = []; state.relations = []; state.people = [];
  state.ui = { ...state.ui, selectedPageId: "database-page", currentPersonId: null, preferences: { style: "mobai", theme: "light" } };
  return upgradeWorkspace(state);
}

let browser, context, page;
const bounded = (promise, ms, label) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms); })])
    .finally(() => clearTimeout(timer));
};
const check = async (label, callback) => {
  const result = { label, passed: false, startedAt: new Date().toISOString() };
  report.checks.push(result); publish(); console.log(`CHECK 116: ${label}`);
  await bounded(callback(), 30000, label);
  result.passed = true; result.completedAt = new Date().toISOString(); publish();
};
const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), workspaceStorageKey);
const persisted = async predicate => {
  await page.waitForFunction(({ key }) => {
    const state = JSON.parse(localStorage.getItem(key));
    // Test predicates run in Node below; this only waits for a persisted workspace.
    return Boolean(state);
  }, { key: workspaceStorageKey });
  const deadline = Date.now() + 6000;
  do {
    const state = await saved();
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.fail("Expected product mutation was not persisted within 6 seconds");
};
const snapshot = async name => {
  const state = await saved(); put(`${name}.json`, state); report.snapshots.push(`${name}.json`); publish(); return state;
};
const shoot = async name => {
  await page.screenshot({ path: path.join(root, `${name}.png`), fullPage: true, animations: "disabled" });
  report.screenshots.push(`${name}.png`); publish();
};
const watchdog = setTimeout(() => {
  report.errors.push({ kind: "watchdog", message: "116 exceeded 210 seconds" }); publish();
  void bounded(browser?.close(), 5000, "watchdog close").finally(() => process.exit(2));
}, 210000);

try {
  const runtime = path.join(root, "runtime");
  mkdirSync(runtime, { recursive: true });
  // Node's tmpdir and Playwright's fresh profile both stay inside this task root.
  process.env.TEMP = runtime; process.env.TMP = runtime;
  browser = await chromium.launch({ channel: "msedge", headless: true, artifactsDir: runtime,
    env: { ...process.env, TEMP: runtime, TMP: runtime } });
  context = await browser.newContext({ viewport: { width: 1440, height: 1040 } });
  const seed = fixture(); put("seed.json", seed);
  await context.addInitScript(({ state, key }) => {
    if (!localStorage.getItem("life-atlas.harness.seeded")) {
      localStorage.setItem(key, JSON.stringify(state));
      localStorage.setItem("life-atlas.harness.seeded", "1");
      localStorage.setItem("life-atlas.parity.seeded", "1");
    }
  }, { state: seed, key: workspaceStorageKey });
  page = await context.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  page.setDefaultTimeout(9000); page.setDefaultNavigationTimeout(15000);
  page.on("pageerror", error => { report.errors.push({ kind: "pageerror", message: error.stack }); publish(); });
  page.on("console", message => { if (message.type() === "error") { report.errors.push({ kind: "console", message: message.text() }); publish(); } });
  page.on("response", response => { if (response.status() >= 400) { report.errors.push({ kind: "http", status: response.status(), url: response.url() }); publish(); } });
  await page.goto(report.isolation.base, { waitUntil: "domcontentloaded" });
  const db = page.locator(".database-view").first();
  await db.locator('tr[data-item-id="alpha"]').waitFor();
  const row = id => db.locator(`tr[data-item-id="${id}"]`);
  const text = (id, propertyId = PROPERTY_ID) => row(id).locator(`[data-property-id="${propertyId}"]`).innerText().then(value => value.trim());
  const texts = async (expected, propertyId = PROPERTY_ID) => {
    for (const [id, value] of Object.entries(expected)) {
      await assertEventually(() => text(id, propertyId), value);
    }
  };
  async function assertEventually(read, expected) {
    const deadline = Date.now() + 6000;
    let actual;
    do { actual = await read(); if (actual === expected) return; await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < deadline);
    assert.equal(actual, expected);
  }
  const menu = name => page.getByRole("menu", { name: `${name} 属性菜单`, exact: true });
  const openMenu = async name => { await db.getByRole("button", { name: `编辑 ${name} 属性`, exact: true }).click(); await menu(name).waitFor(); return menu(name); };
  const confirmation = page.getByRole("alertdialog", { name: "更改属性类型", exact: true });
  const requestConversion = async () => {
    const active = await openMenu(PROPERTY_NAME);
    await active.getByRole("menuitem", { name: "更改类型", exact: true }).click();
    await active.getByRole("menuitem", { name: "公式", exact: true }).click();
    await confirmation.waitFor();
  };
  const formulaDialog = page.getByRole("dialog", { name: "编辑公式属性", exact: true });
  const openFormula = async () => {
    const active = await openMenu(PROPERTY_NAME);
    await active.getByRole("menuitem", { name: "编辑属性…", exact: true }).click();
    await formulaDialog.waitFor();
    assert.equal(await formulaDialog.getByLabel("属性名称", { exact: true }).inputValue(), PROPERTY_NAME);
  };
  const preview = value => assertEventually(() => formulaDialog.locator(".db-formula-preview").innerText(), `预览（Alpha 项目）：${value}`);
  const saveExpression = async (expression, value) => {
    await openFormula();
    await formulaDialog.getByLabel("公式表达式", { exact: true }).fill(expression);
    await preview(value);
    await formulaDialog.getByRole("button", { name: "保存属性", exact: true }).click();
    await formulaDialog.waitFor({ state: "detached" });
    return persisted(state => prop(state).config.expression === expression);
  };
  let baseline, converted, configured;

  await check("Seeded text property uses original ID, raw values and cross-source sentinel", async () => {
    // Establish the baseline after the browser repository finishes its initial
    // normalization/save, before any menu or property action is performed.
    await persisted(state => Boolean(state.workspaceId && state.savedAt === NOW
      && state.ui.lastReminderCheckAt === NOW && state.pages.every(page => Object.hasOwn(page, "contentRevision"))
      && state.ui.recentVisits.some(visit => visit.pageId === "database-page" && visit.visitedAt === NOW)));
    baseline = await snapshot("01-baseline");
    assert.equal(prop(baseline).type, "text"); assert.equal(prop(baseline).id, PROPERTY_ID);
    assert.deepEqual(["alpha", "beta", "gamma"].map(id => item(baseline, id).values.notes), ["HIDE", "SHOW", 'prop("金额") + 116']);
    assert.equal(item(baseline, "partner-one").values.notes, "keep other source116");
    assert.equal(await row("alpha").getByLabel("首页近期 · Alpha 项目", { exact: true }).inputValue(), "HIDE");
    assert.equal(src(baseline).properties.length, 6); assert.equal(baseline.databaseItems.length, 4);
  });

  await check("Actual type submenus offer Formula only for text and retain legacy choices", async () => {
    const active = await openMenu(PROPERTY_NAME);
    await active.getByRole("menuitem", { name: "更改类型", exact: true }).click();
    assert.deepEqual(await active.locator(".db-type-submenu [role=menuitem]").allTextContents(), ["数字", "单选", "多选", "状态", "日期", "复选框", "URL", "电子邮件", "电话", "公式"]);
    await page.keyboard.press("Escape");
    for (const name of ["金额", "状态", "发布日期"]) {
      const other = await openMenu(name);
      await other.getByRole("menuitem", { name: "更改类型", exact: true }).click();
      assert.equal(await other.getByRole("menuitem", { name: "公式", exact: true }).count(), 0);
      assert.equal(await other.locator(".db-type-submenu [role=menuitem]").count(), 9);
      await page.keyboard.press("Escape");
    }
    const existing = await openMenu("引用结果116");
    assert.equal(await existing.getByRole("menuitem", { name: "更改类型", exact: true }).count(), 0);
    await page.keyboard.press("Escape");
    assert.deepEqual(await saved(), baseline);
  });

  await check("Pending confirmation and Cancel preserve the complete persisted graph", async () => {
    await requestConversion();
    assert.match(await confirmation.innerText(), /把“首页近期”从文本改为公式/);
    assert.deepEqual(await saved(), baseline);
    await shoot("02-confirmation");
    await confirmation.getByRole("button", { name: "取消", exact: true }).click();
    await confirmation.waitFor({ state: "detached" });
    assert.deepEqual(await snapshot("02-canceled"), baseline);
    await page.reload({ waitUntil: "domcontentloaded" }); await row("alpha").waitFor();
    assert.deepEqual(await snapshot("03-cancel-reloaded"), baseline);
    assert.equal(await row("beta").getByLabel("首页近期 · Beta 项目", { exact: true }).inputValue(), "SHOW");
  });

  await check("Confirm converts in place and clears only target source raw values to null", async () => {
    await requestConversion();
    await confirmation.getByRole("button", { name: "更改类型", exact: true }).click();
    await confirmation.waitFor({ state: "detached" });
    converted = await persisted(state => prop(state).type === "formula");
    const expected = structuredClone(baseline);
    src(expected).updatedAt = NOW;
    Object.assign(prop(expected), { type: "formula", options: [] }); prop(expected).config.expression = "";
    for (const record of expected.databaseItems.filter(entry => entry.sourceId === SOURCE_ID)) {
      record.values[PROPERTY_ID] = null; record.updatedAt = NOW;
    }
    assert.deepEqual(converted, expected);
    assert.deepEqual(src(converted).properties.map(property => property.id), src(baseline).properties.map(property => property.id));
    assert.deepEqual(converted.databaseItems.map(record => [record.id, record.pageId]), baseline.databaseItems.map(record => [record.id, record.pageId]));
    await snapshot("04-converted");
    for (const id of ["alpha", "beta", "gamma"]) {
      assert.equal(await row(id).locator('[data-property-id="notes"] input,[data-property-id="notes"] textarea').count(), 0);
    }
  });

  await check("Same-ID FormulaEditor previews a draft and Cancel leaves conversion unchanged", async () => {
    await openFormula();
    assert.equal(await formulaDialog.getByLabel("公式表达式", { exact: true }).inputValue(), "");
    await formulaDialog.getByLabel("公式表达式", { exact: true }).fill('"DRAFT116"');
    await preview("DRAFT116"); assert.deepEqual(await saved(), converted);
    await shoot("05-draft-preview");
    await formulaDialog.getByRole("button", { name: "取消", exact: true }).click();
    await formulaDialog.waitFor({ state: "detached" });
    assert.deepEqual(await snapshot("05-editor-canceled"), converted);
  });

  await check("Saving original Article expression changes only the existing property config", async () => {
    configured = await saveExpression(ARTICLE, "SHOW");
    const expected = structuredClone(converted); prop(expected).config.expression = ARTICLE; src(expected).updatedAt = NOW;
    assert.deepEqual(configured, expected); assert.equal(prop(configured).id, PROPERTY_ID);
    await texts({ alpha: "SHOW", beta: "HIDE", gamma: "HIDE" });
    await texts({ alpha: "result116:SHOW", beta: "result116:HIDE", gamma: "result116:HIDE" }, "formula");
    await snapshot("06-expression-saved"); await shoot("06-formula-cells");
  });

  await check("Reload retains IDs, empty raw formula values, expression, views and editor preview", async () => {
    await page.reload({ waitUntil: "domcontentloaded" }); await row("alpha").waitFor();
    assert.deepEqual(await snapshot("07-expression-reloaded"), configured);
    await texts({ alpha: "SHOW", beta: "HIDE", gamma: "HIDE" });
    const active = await openMenu(PROPERTY_NAME);
    assert.equal(await active.getByRole("menuitem", { name: "更改类型", exact: true }).count(), 0);
    await page.keyboard.press("Escape");
    await openFormula(); assert.equal(await formulaDialog.getByLabel("公式表达式", { exact: true }).inputValue(), ARTICLE); await preview("SHOW");
    await formulaDialog.getByRole("button", { name: "取消", exact: true }).click();
  });

  await check("Actual select picker changes raw option ID and reevaluates both formula columns", async () => {
    const picker = row("alpha").locator('[data-property-id="status"] .db-option-picker > summary');
    await picker.click(); await page.locator(".db-option-panel").getByRole("option", { name: "Archived", exact: true }).click();
    const changed = await persisted(state => item(state, "alpha").values.status === "archived116");
    const expected = structuredClone(configured); item(expected, "alpha").values.status = "archived116"; item(expected, "alpha").updatedAt = NOW;
    assert.deepEqual(changed, expected); await texts({ alpha: "HIDE" }); await texts({ alpha: "result116:HIDE" }, "formula");
    await snapshot("08-select-changed");
    await picker.click(); await page.locator(".db-option-panel").getByRole("option", { name: "Published", exact: true }).click();
    const restored = await persisted(state => item(state, "alpha").values.status === "published116");
    assert.deepEqual(restored, configured); await texts({ alpha: "SHOW" });
  });

  await check("Editing referenced select label updates formulas while preserving raw IDs and expression", async () => {
    const active = await openMenu("状态"); await active.getByRole("menuitem", { name: "编辑属性…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "编辑单选属性", exact: true }); await dialog.waitFor();
    await dialog.getByLabel("选项 1", { exact: true }).fill("Live116");
    await dialog.getByRole("button", { name: "保存属性", exact: true }).click(); await dialog.waitFor({ state: "detached" });
    const renamed = await persisted(state => src(state).properties.find(property => property.id === "status").options[0].name === "Live116");
    const expected = structuredClone(configured); src(expected).properties.find(property => property.id === "status").options[0].name = "Live116";
    assert.deepEqual(renamed, expected); await texts({ alpha: "HIDE", beta: "HIDE", gamma: "HIDE" });
    await texts({ alpha: "result116:HIDE" }, "formula");
    assert.equal((await row("alpha").locator(".db-tag-label").innerText()).trim(), "Live116");
    configured = renamed; await snapshot("09-label-renamed");
  });

  await check("Editing expression for new label saves on the same property and previews current record", async () => {
    const updated = await saveExpression(LIVE, "SHOW");
    const expected = structuredClone(configured); prop(expected).config.expression = LIVE;
    assert.deepEqual(updated, expected); configured = updated;
    await texts({ alpha: "SHOW", beta: "HIDE", gamma: "HIDE" }); await texts({ alpha: "result116:SHOW" }, "formula");
    await snapshot("10-new-label-expression");
  });

  await check("Final reload preserves complete graph and dynamic select labels with no new property IDs", async () => {
    await page.reload({ waitUntil: "domcontentloaded" }); await row("alpha").waitFor();
    assert.deepEqual(await snapshot("11-final-reloaded"), configured);
    assert.deepEqual(src(configured).properties.map(property => property.id), src(baseline).properties.map(property => property.id));
    assert.deepEqual(["alpha", "beta", "gamma"].map(id => item(configured, id).values.notes), [null, null, null]);
    assert.equal(item(configured, "partner-one").values.notes, "keep other source116");
    await texts({ alpha: "SHOW", beta: "HIDE", gamma: "HIDE" }); await texts({ alpha: "result116:SHOW" }, "formula");
    await openFormula(); assert.equal(await formulaDialog.getByLabel("公式表达式", { exact: true }).inputValue(), LIVE); await preview("SHOW");
    await shoot("11-final-editor-preview"); await formulaDialog.getByRole("button", { name: "取消", exact: true }).click();
  });

  assert.deepEqual(report.errors, []); assert.equal(report.checks.length, 11); assert.ok(report.checks.every(result => result.passed));
  report.passed = true;
} catch (error) {
  report.failure = error.stack; process.exitCode = 1; console.error(error.stack);
  if (page) {
    await bounded(shoot("failure"), 5000, "failure screenshot").catch(() => {});
    report.bodyExcerpt = await bounded(page.locator("body").innerText(), 3000, "body excerpt").then(text => text.slice(-16000)).catch(() => "Renderer unavailable");
    await bounded(snapshot("failure-state"), 3000, "failure snapshot").catch(() => {});
  }
} finally {
  for (const [resource, close] of [["context", () => context?.close()], ["browser", () => browser?.close()]]) {
    await bounded(close(), 20000, `${resource} close`).then(() => { report.resources[`${resource}Closed`] = true; }).catch(error => {
      report.passed = false; report.errors.push({ kind: "close", message: error.message }); process.exitCode = 1;
    });
  }
  const afterSource = fingerprint(); put("source-after.json", afterSource);
  if (beforeSource.sha256 !== afterSource.sha256) { report.passed = false; report.errors.push({ kind: "source-change", message: "Named inputs changed during UI proof" }); process.exitCode = 1; }
  report.resources.runtimeDirectory = path.join(root, "runtime");
  report.completedAt = new Date().toISOString(); publish(); clearTimeout(watchdog);
  console.log(`FORMULA CONVERSION116: ${report.checks.filter(result => result.passed).length}/${report.checks.length} checks passed; errors=${report.errors.length}; passed=${report.passed}; browserClosed=${report.resources.browserClosed}`);
}
