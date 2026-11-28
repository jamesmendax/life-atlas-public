import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

const workspace = coreParityWorkspace();
const view = workspace.databaseViews.find(view => view.id === "view-table");
view.visiblePropertyIds = ["title", "notes", "amount", "status", "date", "labels"];
view.config = { ...view.config, table: { wrapPropertyIds: ["title", "notes"], columnWidths: { title: 160, notes: 140 } } };
workspace.ui.preferences = { theme: "light", style: "mobai" };
const seed = workspace.databaseItems.find(item => item.id === "alpha");
const pageSeed = workspace.pages.find(page => page.id === seed.pageId);
workspace.databaseItems = workspace.databaseItems.filter(item => item.sourceId !== "projects");
for (let index = 0; index < 650; index++) {
  const id = "wrapped-" + String(index).padStart(3, "0");
  const title = index % 3 ? id : id + " detail".repeat(22);
  workspace.databaseItems.push({ ...seed, id, pageId: id + "-p", values: { ...seed.values, title, notes: index % 3 === 2 ? "场馆改期，需确认新的预订日期。".repeat(6) : "备注" } });
  workspace.pages.push({ ...pageSeed, id: id + "-p", title, content: [] });
}
await browserScenario("wrapped-table-window", async ({ page, check, assert }) => {
  const container = page.locator(".db-table-scroll.is-wrapped-virtual").first();
  const records = container.locator("tbody tr[data-item-id]");
  const row = index => container.locator(`tr[data-layout-index="${index}"]`);
  await check("650 mixed-height records stay bounded with multiline content visible", async () => {
    await row(0).waitFor();
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll(".is-wrapped-virtual tr[data-item-id]")];
      return rows.length > 2 && rows.some(row => row.offsetHeight > 60);
    });
    assert.ok(await records.count() < 55);
    assert.ok(await row(0).evaluate(node => node.offsetHeight) > await row(1).evaluate(node => node.offsetHeight));
    const memo = row(2).locator('td[data-property-id="notes"] textarea');
    assert.ok(await memo.evaluate(node => node.offsetHeight > 60 && node.scrollHeight <= node.clientHeight + 1));
  });
  await check("Scrollbar jumps reach the real last row, yield a keyboard-editable neighbor and return to the first", async () => {
    await container.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await row(649).waitFor();
    await page.waitForFunction(() => {
      const container = document.querySelector(".is-wrapped-virtual");
      const last = container.querySelector("tr[data-layout-index='649']");
      return last && last.getBoundingClientRect().bottom <= container.getBoundingClientRect().bottom + 2;
    });
    await row(649).locator('td[data-property-id="title"]').focus();
    await page.keyboard.press("ArrowUp");
    await page.waitForFunction(() => document.activeElement.closest("tr")?.dataset.layoutIndex === "648");
    assert.ok(await records.count() < 55);
    await container.evaluate(node => { node.scrollTop = 0; });
    await row(0).waitFor();
    assert.equal(await row(649).count(), 0);
  });
  await check("Resizing a scrolled wrapped table retains the first visible record", async () => {
    const atHeader = node => {
      const headerEdge = node.querySelector("thead").getBoundingClientRect().bottom;
      return [...node.querySelectorAll("tr[data-item-id]")].find(row => row.getBoundingClientRect().bottom > headerEdge + 1)?.dataset.itemId;
    };
    const settle = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));
    await container.evaluate(node => { node.scrollTop = node.scrollHeight / 2; });
    await settle();
    const before = await container.evaluate(atHeader);
    assert.ok(before);
    await page.setViewportSize({ width: 1080, height: 760 });
    await settle();
    assert.equal(await container.evaluate(atHeader), before);
    await container.evaluate(node => { node.scrollTop = 0; });
    await row(0).waitFor();
  });
  await check("A column width change remeasures wrapped titles and row creation at the end focuses the returned title", async () => {
    const before = await row(0).evaluate(node => node.offsetHeight);
    const handle = container.getByRole("separator", { name: "调整 名称 列宽" });
    for (let index = 0; index < 8; index++) await handle.press("ArrowRight");
    await page.waitForFunction(before => document.querySelector(".is-wrapped-virtual tr[data-layout-index='0']").offsetHeight < before, before);
    await container.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await row(649).waitFor();
    await container.getByRole("button", { name: "新建页面" }).click();
    const editing = container.locator(".db-title-editor");
    await editing.waitFor();
    assert.equal(await editing.evaluate(node => node === document.activeElement), true);
    assert.ok(await records.count() < 55);
  });
}, { workspace });
