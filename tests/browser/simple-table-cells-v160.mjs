import assert from "node:assert/strict";
import { chromium } from "playwright";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { stableJson } from "../../src/domain/blockDocument.js";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";
import { upgradeWorkspace } from "../../src/persistence/migrations.js";

const workspace = coreParityWorkspace();
workspace.ui.selectedPageId = "editor-page";
const doc = workspace.pages.find((page) => page.id === "editor-page");
const cell = (text, props = {}) => ({
  type: "tableCell",
  props,
  content: [{ type: "text", text, styles: {} }],
});
const table = (id, rows, header) => ({
  id,
  type: "table",
  content: { type: "tableContent", columnWidths: [110, 130, 150], ...header, rows: rows.map((cells) => ({ cells })) },
});
doc.content = [
  table("merge-main", [
    [cell("H1"), cell("H2"), cell("H3")],
    [cell("A", { backgroundColor: "blue", textColor: "red" }), cell("B"), cell("C")],
    [cell("D"), cell("E"), cell("F")],
  ], { headerRows: 1 }),
  { id: "merge-sync-ref", type: "syncedBlock", props: { sourceId: "shared-source" } },
  { id: "merge-sync-ref-two", type: "syncedBlock", props: { sourceId: "shared-source" } },
];
const source = workspace.syncedSources.find((entry) => entry.id === "shared-source");
source.blocks = [
  table("merge-source", [[cell("X"), cell("a"), cell("b")], [cell("Y"), cell("c"), cell("d")]], { headerCols: 1 }),
];

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1300, height: 970 } });
  const page = await context.newPage();
  page.setDefaultTimeout(9000);
  const errors = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.error(error.stack); });
  await context.addInitScript(({ seed, key }) => {
    if (!localStorage.getItem("life-atlas.table-test-seeded")) {
      localStorage.setItem(key, JSON.stringify(seed));
      localStorage.setItem("life-atlas.table-test-seeded", "1");
    }
  }, { seed: upgradeWorkspace(workspace), key: workspaceStorageKey });
  await page.goto(process.env.PARITY_BASE_URL || "http://127.0.0.1:5178");
  const normal = page.locator('[data-id="merge-main"] table');
  const sync = (id) => page.locator(`[data-id="${id}"] table`);
  const saved = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), workspaceStorageKey);
  const readTable = (state) => state.pages.find((page) => page.id === doc.id).content.find((block) => block.id === "merge-main");
  const readSource = (state) => state.syncedSources.find((entry) => entry.id === source.id);
  const button = () => page.getByRole("button", { name: "合并单元格", exact: true });
  const row = (table, index) => table.locator("tbody > tr").nth(index);
  const cells = (table, index) => row(table, index).locator("th, td");
  const boundsCenter = async (element) => {
    const box = await element.boundingBox();
    assert.ok(box);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const select = async (first, last) => {
    await first.scrollIntoViewIfNeeded();
    await last.scrollIntoViewIfNeeded();
    const from = await boundsCenter(first);
    const to = await boundsCenter(last);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
  };
  const waitForStorage = async (predicate) => {
    for (let index = 0; index < 55; index++) {
      const state = await saved();
      if (predicate(state)) return state;
      await page.waitForTimeout(100);
    }
    assert.ok(predicate(await saved()), "Table change was not persisted");
  };
  const dialogAction = async (action) => {
    const dialog = page.getByRole("alertdialog", { name: "合并单元格？" });
    await dialog.locator(`[data-la-dialog-${action}]`).click();
    await dialog.waitFor({ state: "hidden" });
  };
  await normal.waitFor();
  await select(cells(normal, 0).first(), cells(normal, 1).nth(1));
  await button().waitFor();
  assert.equal(await button().isDisabled(), true, "Header row boundary blocks merging");

  const beforeCancel = stableJson(readTable(await saved()));
  await select(cells(normal, 2).last(), cells(normal, 1).first());
  await button().click();
  await dialogAction("cancel");
  assert.equal(stableJson(readTable(await saved())), beforeCancel);
  assert.equal(await normal.locator("td.selectedCell").count(), 6);
  await select(cells(normal, 2).last(), cells(normal, 1).first());
  await button().click();
  await dialogAction("confirm");
  await normal.locator('td[rowspan="2"][colspan="3"]').waitFor();
  assert.equal(await cells(normal, 2).count(), 0);
  const state = await waitForStorage((current) => readTable(current).content.rows[2].cells.length === 0);
  const merged = readTable(state).content;
  assert.deepEqual(merged.columnWidths, [110, 130, 150]);
  assert.equal(merged.headerRows, 1);
  assert.deepEqual(merged.rows[1].cells[0].content.map((inline) => inline.text), ["A"]);
  assert.equal(merged.rows[1].cells[0].props.backgroundColor, "blue");
  assert.equal(merged.rows[1].cells[0].props.textColor, "red");

  await page.keyboard.press("Control+z");
  await cells(normal, 2).nth(2).waitFor();
  assert.deepEqual(await cells(normal, 2).allTextContents(), ["D", "E", "F"]);
  await page.keyboard.press("Control+Shift+z");
  await normal.locator('td[rowspan="2"][colspan="3"]').waitFor();
  await waitForStorage((current) => readTable(current).content.rows[2].cells.length === 0);

  await page.reload();
  await normal.locator('td[rowspan="2"][colspan="3"]').waitFor();
  assert.equal(await cells(normal, 2).count(), 0);
  await cells(normal, 1).first().hover();
  await page.locator('button.bn-table-cell-handle:visible').click();
  await page.getByRole("menuitem", { name: "拆分单元格" }).click();
  await cells(normal, 2).last().waitFor();
  assert.deepEqual(await cells(normal, 1).allTextContents(), ["A", "", ""]);
  assert.deepEqual(await cells(normal, 2).allTextContents(), ["", "", ""]);
  await page.keyboard.press("Control+z");
  await normal.locator('td[rowspan="2"][colspan="3"]').waitFor();
  await page.keyboard.press("Control+Shift+z");
  await cells(normal, 2).last().waitFor();

  await select(cells(normal, 1).first(), cells(normal, 1).nth(1));
  await button().click();
  await normal.locator('td[colspan="2"]').waitFor();
  assert.equal(await page.locator("[data-la-dialog]").count(), 0, "Merging an empty covered cell needs no confirmation");
  assert.deepEqual(await cells(normal, 1).allTextContents(), ["A", ""]);
  await page.keyboard.press("Control+z");
  await cells(normal, 1).nth(2).waitFor();

  const canonical = sync("merge-sync-ref");
  const other = sync("merge-sync-ref-two");
  await select(cells(canonical, 0).first(), cells(canonical, 0).nth(1));
  await button().waitFor();
  assert.equal(await button().isDisabled(), true, "Header column boundary blocks merging");
  await select(cells(canonical, 0).first(), cells(canonical, 1).first());
  await button().click();
  await dialogAction("confirm");
  await canonical.locator('th[rowspan="2"]').waitFor();
  await other.locator('th[rowspan="2"]').waitFor();
  const mergedSource = await waitForStorage((current) => readSource(current).blocks[0].content.rows[0].cells[0].props.rowspan === 2);
  assert.equal(readSource(mergedSource).blocks[0].content.headerCols, 1);
  assert.equal(readSource(mergedSource).revision, 1);
  await page.keyboard.press("Control+z");
  await other.locator('th[rowspan="2"]').waitFor({ state: "detached" });
  await page.keyboard.press("Control+Shift+z");
  await other.locator('th[rowspan="2"]').waitFor();
  await waitForStorage((current) => readSource(current).revision === 3);

  await page.reload();
  await canonical.locator('th[rowspan="2"]').waitFor();
  assert.deepEqual(await row(canonical, 1).locator("td").allTextContents(), ["c", "d"]);
  assert.deepEqual(await row(other, 1).locator("td").allTextContents(), ["c", "d"]);

  await page.getByRole("button", { name: "页面操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "锁定页面", exact: true }).click();
  await page.keyboard.press("Escape");
  assert.equal(await normal.evaluate((element) => element.isContentEditable), false);
  await select(cells(normal, 1).first(), cells(normal, 2).last());
  assert.equal(await button().count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS simple-table-cells-v160: cancellation, full-width hard span, history, reload/split, header boundaries, synced projection and locked UI");
} finally {
  await browser.close();
}
