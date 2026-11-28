import { existsSync, writeFileSync } from "node:fs";
import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

// Parent runs this file against its shared browser server; no registry entry added.
const run = process.env.V13_FORMULA_SELECT77_RUN || "prepared01";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid run label");
const ARTICLE58 = 'if(prop("状态") == "Published" and not empty(prop("发布日期")) and dateBetween(now(), prop("发布日期"), "days") <= 21, "SHOW", "HIDE")';
const subreports = [];

for (const type of ["select", "status"]) {
  const name = "LOCAL-NOTION-001/v11-wiki-replica48/formula-select77-browser-" + run + "-" + type;
  if (existsSync(".qa/" + name + ".json")) throw new Error("Preserve previous browser evidence");
  const workspace = coreParityWorkspace();
  const source = workspace.dataSources.find(entry => entry.id === "projects");
  const status = source.properties.find(property => property.id === "status");
  status.type = type;
  status.options = [
    { id: "published77", name: "Published", color: "green", group: "complete" },
    { id: "published-twin77", name: "Published", color: "blue", group: "complete" },
    { id: "archived77", name: "Archived", color: "brown", group: "todo" },
  ];
  source.properties.find(property => property.id === "date").name = "发布日期";
  const formula = source.properties.find(property => property.id === "formula");
  formula.name = "首页近期";
  formula.config.expression = ARTICLE58;
  const item = id => workspace.databaseItems.find(entry => entry.id === id);
  item("alpha").values.status = "published77";
  item("beta").values.status = "archived77";
  item("gamma").values.status = null;
  for (const id of ["alpha", "beta", "gamma"]) {
    item(id).values.date = { start: "2026-11-12", end: null, includeTime: false, timeZone: null };
  }
  for (const [id, title, statusId, start] of [
    ["twin77", "Same label77", "published-twin77", "2026-11-12"],
    ["future77", "Future77", "published77", "2026-11-14"],
  ]) {
    workspace.databaseItems.push({ ...structuredClone(item("alpha")), id, pageId: id + "-page",
      values: { ...structuredClone(item("alpha").values), title, status: statusId, date: { start, end: null, includeTime: false, timeZone: null } } });
    workspace.pages.push({ ...structuredClone(workspace.pages.find(page => page.id === "alpha-page")),
      id: id + "-page", title, content: [] });
  }
  const view = workspace.databaseViews.find(entry => entry.id === "view-table");
  view.visiblePropertyIds = ["title", "status", "date", "formula"];
  view.filter = null;
  view.sorts = [];
  const host = workspace.pages.find(page => page.id === "editor-page");
  host.content = [{ id: "formula-select77", type: "databaseView", props: { sourceId: source.id, viewId: view.id } }];
  host.settings.fullWidth = true;
  workspace.ui.selectedPageId = host.id;
  workspace.ui.preferences = { style: "mobai", theme: "light" };

  subreports.push(await browserScenario(name, async ({ page, check, saved, persisted, assert, screenshot }) => {
    const db = page.locator('[data-id="formula-select77"] .database-view');
    await db.waitFor();
    const row = id => db.locator('tr[data-item-id="' + id + '"]');
    const formulaText = async id => (await row(id).locator('[data-property-id="formula"]').innerText()).trim();
    const sourceFor = state => state.dataSources.find(entry => entry.id === source.id);
    const definition = state => sourceFor(state).properties.find(property => property.id === "formula");
    const dialog = page.getByRole("dialog", { name: "编辑公式属性", exact: true });
    const openFormula = async () => {
      await db.getByRole("button", { name: "编辑 首页近期 属性", exact: true }).click();
      await page.getByRole("menu", { name: "首页近期 属性菜单", exact: true })
        .getByRole("menuitem", { name: "编辑属性…", exact: true }).click();
      await dialog.waitFor();
    };

    await check(type + " original article58 formula shows labels while raw option IDs remain distinct", async () => {
      for (const [id, expected] of [["alpha", "SHOW"], ["beta", "HIDE"], ["gamma", "HIDE"], ["twin77", "SHOW"], ["future77", "SHOW"]]) {
        assert.equal(await formulaText(id), expected);
      }
      assert.equal((await row("alpha").locator('[data-property-id="status"] .db-tag-label').innerText()).trim(), "Published");
      const state = await saved();
      assert.equal(state.databaseItems.find(entry => entry.id === "alpha").values.status, "published77");
      assert.equal(state.databaseItems.find(entry => entry.id === "twin77").values.status, "published-twin77");
      assert.equal(definition(state).config.expression, ARTICLE58);
    });

    await check(type + " actual FormulaEditor preview agrees with the original formula cell", async () => {
      const before = await saved();
      await openFormula();
      assert.equal(await dialog.getByLabel("公式表达式", { exact: true }).inputValue(), ARTICLE58);
      assert.equal((await dialog.locator(".db-formula-preview").innerText()).trim(), "预览（Alpha 项目）：SHOW");
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      const after = await saved();
      assert.deepEqual(after.databaseItems, before.databaseItems);
      assert.deepEqual(after.dataSources, before.dataSources);
    });

    await check(type + " editing a raw choice updates its formula and preserves the source expression", async () => {
      const picker = row("alpha").locator('[data-property-id="status"] .db-option-picker > summary');
      await picker.click();
      await page.locator(".db-option-panel").getByRole("option", { name: "Archived", exact: true }).click();
      await persisted(state => state.databaseItems.find(entry => entry.id === "alpha").values.status === "archived77");
      assert.equal(await formulaText("alpha"), "HIDE");
      await picker.click();
      await page.locator(".db-option-panel").getByRole("option", { name: "Published", exact: true }).first().click();
      const restored = await persisted(state => state.databaseItems.find(entry => entry.id === "alpha").values.status === "published77");
      assert.equal(await formulaText("alpha"), "SHOW");
      assert.equal(definition(restored).config.expression, ARTICLE58);
      assert.equal(restored.databaseItems.find(entry => entry.id === "twin77").values.status, "published-twin77");
    });

    await check(type + " reload retains formula property identity, expression and raw values", async () => {
      const before = await saved();
      await page.reload({ waitUntil: "domcontentloaded" });
      await db.waitFor();
      assert.equal(await formulaText("alpha"), "SHOW");
      assert.equal(await formulaText("future77"), "SHOW");
      const after = await saved();
      assert.equal(definition(after).id, "formula");
      assert.equal(definition(after).config.expression, ARTICLE58);
      assert.deepEqual(after.databaseItems, before.databaseItems);
      assert.deepEqual(after.databaseViews, before.databaseViews);
      await openFormula();
      assert.equal((await dialog.locator(".db-formula-preview").innerText()).trim(), "预览（Alpha 项目）：SHOW");
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await screenshot(type + "-original-formula");
    });
  }, { workspace, now: "2026-11-13T04:34:00.000Z" }));
}

const checks = subreports.flatMap(report => report.checks.map(check => ({ ...check, scenario: report.name })));
const errors = subreports.flatMap(report => [
  ...report.errors.map(error => ({ ...error, scenario: report.name })),
  ...(report.failure ? [{ kind: "scenario", message: report.failure, scenario: report.name }] : []),
]);
const sourceFingerprint = subreports[0]?.sourceFingerprint || null;
if (subreports.some(report => report.sourceFingerprint !== sourceFingerprint)) {
  errors.push({ kind: "fingerprint", message: "Formula select/status scenarios used different source fingerprints" });
}
const aggregate = {
  name: "v13-formula-select77",
  startedAt: subreports[0]?.startedAt,
  completedAt: subreports.at(-1)?.completedAt,
  passed: subreports.length === 2 && checks.length === 8 && Boolean(sourceFingerprint)
    && subreports.every(report => report.passed && report.checks.length === 4 && report.checks.every(check => check.passed))
    && errors.length === 0,
  checks,
  errors,
  storageKey: subreports[0]?.storageKey || null,
  sourceFingerprint,
  subreports,
};
writeFileSync(".qa/v13-formula-select77.json", JSON.stringify(aggregate, null, 2));
if (!aggregate.passed) process.exitCode = 1;
console.log("FORMULA SELECT77: " + subreports.length + " scenarios / " + checks.length + " checks, passed=" + aggregate.passed + ", errors=" + errors.length);
