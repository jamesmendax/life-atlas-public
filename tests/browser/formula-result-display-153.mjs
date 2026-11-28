import { createProperty, projectViewItems, resolvePropertyValue } from "../../src/domain/database.js";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { chooseSavedView } from "./database-navigation.mjs";
import { browserScenario } from "./harness.mjs";

const workspace = coreParityWorkspace();
const source = workspace.dataSources.find(entry => entry.id === "projects");
const view = workspace.databaseViews.find(entry => entry.id === "view-table");
const budget = source.properties.find(property => property.id === "amount");
budget.name = "Budget";
const finance = source.properties.find(property => property.id === "formula");
finance.name = "Trip Finance";
finance.config.expression = [
  'if(prop("Budget") == 0, "No budget", style(',
  '"💰 𝗕𝘂𝗱𝗴𝗲𝘁: $" + style(format(prop("Budget")), "purple") +',
  '"\\n💸 𝗦𝗽𝗲𝗻𝘁: $" + style(format(prop("Expense")), "purple") +',
  '"\\n🟢 𝗥𝗲𝗺𝗮𝗶𝗻𝗶𝗻𝗴: $" + style(format(prop("Budget") - prop("Expense")), "purple") +',
  '"\\n📊 𝗨𝘀𝗮𝗴𝗲: " + style(format(round(prop("Expense") / prop("Budget") * 100)), "purple") + "%", "b"))',
].join(" ");
const cost = createProperty({
  id: "cost", name: "Line Cost", type: "formula", config: { expression: 'if(prop("Budget") == 2700, 6.3, 3 * 2.1)' },
});
source.properties.push(
  cost,
  createProperty({ id: "expense", name: "Expense", type: "number" }),
  createProperty({ id: "raw-number", name: "Raw Number", type: "number" }),
  createProperty({ id: "long-formula", name: "Single Line", type: "formula", config: { expression: 'style("' + "Single line ".repeat(18) + '", "b")' } }),
);
workspace.databaseItems.find(item => item.id === "partner-one").values.rating = 3 * 2.1;

for (const [id, title, amount, expense] of [
  ["alpha", "Japan Adventure 2025", 2500, 370], ["beta", "Singapore Business Trip", 2700, 800], ["gamma", "New trip", 0, 0],
]) {
  const item = workspace.databaseItems.find(entry => entry.id === id);
  Object.assign(item.values, { title, amount, expense, status: "doing", "raw-number": 3 * 2.1, notes: "Long text ".repeat(15) });
  workspace.pages.find(page => page.id === item.pageId).title = title;
}
view.visiblePropertyIds = ["title", "formula", "long-formula", "notes", "amount", "cost", "rollup", "raw-number"];
view.config.table = {
  columnWidths: { title: 200, formula: 200, "long-formula": 110, notes: 110, amount: 110, cost: 120, rollup: 130, "raw-number": 175 },
};
view.filter = { propertyId: "status", operator: "equals", value: "doing" };
const scaleView = { ...view, id: "view-formula-scale", name: "Virtual trips", filter: null };
workspace.databaseViews = [view, scaleView];
workspace.pages.find(page => page.id === source.ownerPageId).content = [{
  id: "trip-occurrence", type: "databaseView",
  props: { sourceId: source.id, viewId: view.id, viewIdsJson: JSON.stringify([view.id, scaleView.id]) },
}];
workspace.ui.preferences = { theme: "light", style: "mobai" };
const seed = workspace.databaseItems.find(item => item.id === "alpha");
const pageSeed = workspace.pages.find(page => page.id === seed.pageId);
for (let index = 3; index <= 260; index++) {
  const id = "trip-" + index;
  workspace.databaseItems.push({
    ...seed, id, pageId: id + "-page", values: { ...seed.values, title: id, status: "todo", amount: index % 4 ? 0 : 2500 },
  });
  workspace.pages.push({ ...pageSeed, id: id + "-page", title: id, content: [] });
}

await browserScenario("formula-result-display-153", async ({ page, check, screenshot, assert, persisted }) => {
  const db = page.locator('section.database-view[data-source-id="projects"]');
  const scroll = db.locator(".db-table-scroll");
  const row = index => db.locator('tr[data-layout-index="' + index + '"]');
  const cell = (index, propertyId) => row(index).locator('td[data-property-id="' + propertyId + '"]');
  const result = (index, propertyId) => cell(index, propertyId).locator(".db-readonly-cell");
  const financeWidth = db.getByRole("separator", { name: "调整 Trip Finance 列宽" });

  await check("Four styled finance paragraphs are fully readable at 200px in the standard table", async () => {
    await row(0).waitFor();
    await page.evaluate(() => document.fonts.ready.then(() => true));
    assert.equal(await scroll.evaluate(node => node.classList.contains("is-virtual")), false);
    assert.equal(await financeWidth.getAttribute("aria-valuenow"), "200");
    const lines = [
      ["💰 𝗕𝘂𝗱𝗴𝗲𝘁: $2500", "💸 𝗦𝗽𝗲𝗻𝘁: $370", "🟢 𝗥𝗲𝗺𝗮𝗶𝗻𝗶𝗻𝗴: $2130", "📊 𝗨𝘀𝗮𝗴𝗲: 15%"],
      ["💰 𝗕𝘂𝗱𝗴𝗲𝘁: $2700", "💸 𝗦𝗽𝗲𝗻𝘁: $800", "🟢 𝗥𝗲𝗺𝗮𝗶𝗻𝗶𝗻𝗴: $1900", "📊 𝗨𝘀𝗮𝗴𝗲: 30%"],
    ];
    for (const [index, expected] of lines.entries()) {
      const value = result(index, "formula");
      assert.equal(await value.textContent(), expected.join("\n"));
      const bounds = await value.evaluate(node => {
        const box = node.getBoundingClientRect();
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        const tops = [];
        let paragraph = 0;
        let clipped = false;
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
          let offset = 0;
          for (const [index, part] of text.data.split("\n").entries()) {
            if (index) paragraph++;
            if (part) {
              const range = document.createRange();
              range.setStart(text, offset);
              range.setEnd(text, offset + part.length);
              for (const rect of range.getClientRects()) {
                tops[paragraph] ??= rect.top;
                clipped ||= rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1;
              }
            }
            offset += part.length + 1;
          }
        }
        const css = getComputedStyle(node);
        const segments = [...node.children].map(segment => {
          const style = getComputedStyle(segment);
          return { text: segment.textContent, weight: Number(style.fontWeight), color: style.color };
        });
        return { width: box.width, tops, clipped, whiteSpace: css.whiteSpace, segments };
      });
      assert.ok(Math.abs(bounds.width - 200) <= 1, "Actual cell width is 200px within its border");
      assert.equal(bounds.whiteSpace, "pre-wrap");
      assert.equal(bounds.tops.length, 4);
      assert.ok(bounds.tops.every((top, index) => index === 0 || top > bounds.tops[index - 1]));
      assert.equal(bounds.clipped, false);
      assert.ok(bounds.segments.every(segment => segment.weight >= 700));
      const colored = bounds.segments.filter(segment => /^\d+$/.test(segment.text));
      assert.equal(colored.length, 4);
      assert.ok(colored.every(segment => segment.color !== bounds.segments[0].color));
    }
    await screenshot("trip-finance-at-200px");
  });

  await check("Only authored newlines expand the row and the floating-point tail is display-only", async () => {
    const single = await result(2, "long-formula").evaluate(node => ({
      whiteSpace: getComputedStyle(node).whiteSpace,
      textOverflow: getComputedStyle(node).textOverflow,
      overflows: node.scrollWidth > node.clientWidth,
    }));
    assert.deepEqual(single, { whiteSpace: "nowrap", textOverflow: "ellipsis", overflows: true });
    assert.equal(await cell(2, "notes").locator("input").inputValue(), "Long text ".repeat(15));
    assert.ok(await row(0).evaluate(node => node.offsetHeight) > await row(2).evaluate(node => node.offsetHeight) + 50);
    assert.equal(await result(0, "cost").textContent(), "6.3");
    assert.equal(await result(1, "cost").textContent(), "6.3");
    assert.equal(await result(0, "rollup").textContent(), "6.3");
    assert.equal(await cell(0, "raw-number").locator("button").textContent(), "6.300000000000001");
    const raw = resolvePropertyValue(workspace, source, seed, cost);
    assert.equal(raw, 6.300000000000001);
    const sorted = projectViewItems(workspace, { ...view, sorts: [{ propertyId: cost.id, direction: "asc" }] });
    assert.equal(sorted[0].id, "beta");
    const threshold = projectViewItems(workspace, { ...view, filter: { propertyId: cost.id, operator: "greater_than", value: 6.3 } });
    assert.ok(threshold.some(item => item.id === "alpha") && !threshold.some(item => item.id === "beta"));
  });

  await check("Mixed virtual rows remeasure after resizing and updates, and remain keyboard navigable", async () => {
    await chooseSavedView(db, scaleView.id);
    await db.locator(".is-wrapped-virtual").waitFor();
    assert.ok(await scroll.locator("tr[data-item-id]").count() < 55);
    const before = await row(0).evaluate(node => node.offsetHeight);
    for (let index = 0; index < 10; index++) await financeWidth.press("ArrowLeft");
    await page.waitForFunction(before => document.querySelector('tr[data-layout-index="0"]').offsetHeight > before, before);
    const budgetEditor = page.getByRole("textbox", { name: "Budget · Japan Adventure 2025" });
    await cell(0, "amount").getByRole("button").click();
    await budgetEditor.fill("0");
    await budgetEditor.press("Enter");
    await persisted(state => state.databaseItems.find(item => item.id === "alpha").values.amount === 0);
    assert.equal(await result(0, "formula").textContent(), "No budget");
    assert.equal(await row(0).evaluate(node => node.offsetHeight), await row(2).evaluate(node => node.offsetHeight));
    await cell(0, "amount").getByRole("button").click();
    await budgetEditor.fill("2500");
    await budgetEditor.press("Enter");
    await persisted(state => state.databaseItems.find(item => item.id === "alpha").values.amount === 2500);
    assert.ok(await row(0).evaluate(node => node.offsetHeight) > before);
    await scroll.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await row(260).waitFor();
    await page.waitForFunction(() => {
      const scroll = document.querySelector(".db-table-scroll.is-wrapped-virtual");
      return scroll.querySelector('tr[data-layout-index="260"]')?.getBoundingClientRect().bottom <= scroll.getBoundingClientRect().bottom + 2;
    });
    assert.ok(await row(260).evaluate(node => node.offsetHeight) > await row(259).evaluate(node => node.offsetHeight) + 50);
    await cell(260, "formula").focus();
    await page.keyboard.press("ArrowUp");
    await page.waitForFunction(() => document.activeElement.closest("tr")?.dataset.layoutIndex === "259");
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(() => document.activeElement.closest("tr")?.dataset.layoutIndex === "260");
    assert.ok(await scroll.locator("tr[data-item-id]").count() < 55);
    await scroll.evaluate(node => { node.scrollTop = 0; });
    await row(0).waitFor();
    assert.equal(await row(260).count(), 0);
  });
}, { workspace });
