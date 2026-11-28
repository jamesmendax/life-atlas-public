import { createDatabaseView } from "../../src/domain/database.js";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { chooseSavedView } from "./database-navigation.mjs";
import { browserScenario, shootBothModes } from "./harness.mjs";

const workspace = coreParityWorkspace();
const statuses = workspace.dataSources[0].properties.find(property => property.id === "status").options;
for (const [index, color] of ["gray", "blue", "green"].entries()) statuses[index].color = color;

const original = { propertyId: "checked", operator: "equals", value: false };
const empty = { propertyId: "amount", operator: "greater_than", value: 10_000 };
function chartView(id, config, filter) {
  return createDatabaseView({ id, name: id, filter, sourceId: "projects", type: "chart",
    config: { chart: { xPropertyId: "status", ...config } } });
}

workspace.databaseViews = [
  chartView("equal", { kind: "bar", aggregation: "count" }, original),
  chartView("unequal", { kind: "bar", aggregation: "count" }),
  chartView("status", { kind: "donut", aggregation: "count" }),
  chartView("signed", { kind: "bar", aggregation: "sum", valuePropertyId: "amount" }, original),
  chartView("average", { kind: "donut", aggregation: "average", valuePropertyId: "amount" }, original),
  chartView("empty", { kind: "bar", aggregation: "count" }, empty),
];
workspace.pages[0].databaseViewId = "equal";
workspace.pages[0].content = [{ id: "chart-readability-db", type: "databaseView", props: {
  sourceId: "projects", viewId: "equal", viewIdsJson: JSON.stringify(workspace.databaseViews.map(view => view.id)),
} }];
const [sample] = workspace.databaseItems;
const samplePage = workspace.pages.find(page => page.id === sample.pageId);
for (const [index, status] of ["todo", "done", "done"].entries()) {
  const id = `extra-chart-${index}`;
  workspace.databaseItems.push({ ...sample, id, pageId: `${id}-page`, values: { ...sample.values, title: id, status, checked: true } });
  workspace.pages.push({ ...samplePage, id: `${id}-page`, title: id, content: [] });
}

await browserScenario("database-chart-readability", async ({ page, check, assert, screenshot }) => {
  const db = page.locator('.database-view[data-source-id="projects"]');
  const bars = db.locator(".db-real-bar-row");
  const ticks = db.locator(".db-real-bar-ticks > span");
  const legend = db.locator(".db-chart-legend-row");
  const barLengths = () => bars.locator(".db-real-bar-track i").evaluateAll(marks => marks.map(mark => Number.parseFloat(mark.style.width)));

  await check("Equal counts have equal half-width bars on an explicit integer axis and keyboard drilldown", async () => {
    await bars.first().waitFor();
    assert.deepEqual(await ticks.allTextContents(), ["0", "1", "2"]);
    assert.deepEqual(await bars.locator("strong").allTextContents(), ["1", "1", "1"]);
    assert.deepEqual(await barLengths(), [50, 50, 50]);
    const bar = db.getByRole("button", { name: "查看原始记录 · 进行中", exact: true });
    await bar.press("Space");
    const details = page.getByRole("dialog", { name: "进行中 · 原始记录", exact: true });
    await details.waitFor();
    assert.deepEqual(await details.locator("tbody td:first-child").allTextContents(), ["Alpha 项目"]);
    await page.keyboard.press("Escape");
    await details.waitFor({ state: "detached" });
    assert.equal(await bar.evaluate(button => button === document.activeElement), true);
    await shootBothModes(page, screenshot, "equal-bars");
  });

  await check("Unequal and signed bars use the same baseline within each chart", async () => {
    await chooseSavedView(db, "unequal");
    assert.deepEqual(await bars.locator("strong").allTextContents(), ["1", "2", "3"]);
    const lengths = await barLengths();
    assert.ok(Math.abs(lengths[1] / lengths[0] - 2) < 0.0001);
    assert.ok(Math.abs(lengths[2] / lengths[0] - 3) < 0.0001);
    await chooseSavedView(db, "signed");
    const positions = await bars.evaluateAll(rows => rows.map(row => {
      const mark = row.querySelector("i");
      return { start: Number.parseFloat(mark.style.left), end: Number.parseFloat(mark.style.left) + Number.parseFloat(mark.style.width), zero: Number.parseFloat(row.querySelector("b[data-zero]").style.left) };
    }));
    assert.ok(positions[0].start === positions[0].zero && positions[0].zero > 0);
    assert.ok(Math.abs(positions[2].end - positions[2].zero) < 0.0001);
    assert.ok(positions.every(position => position.zero === positions[0].zero));
    assert.deepEqual(await bars.locator("strong").allTextContents(), ["120", "80", "-20"]);
  });

  await check("Status donut shows ordered counts, percentages and proportional arcs on wide and narrow surfaces", async () => {
    await chooseSavedView(db, "status");
    assert.equal(await db.locator(".db-real-donut-total strong").innerText(), "6");
    assert.deepEqual(await legend.locator(".db-chart-legend-label").allTextContents(), ["待办", "进行中", "完成"]);
    assert.deepEqual(await legend.locator("strong").allTextContents(), ["2", "1", "3"]);
    assert.deepEqual(await legend.locator(".db-chart-share").allTextContents(), ["33.3%", "16.7%", "50%"]);
    const lengths = await db.locator("path.db-donut-segment").evaluateAll(paths => paths.map(path => path.getTotalLength()));
    assert.ok(Math.abs(lengths[0] / lengths[2] - 2 / 3) < 0.002);
    assert.ok(Math.abs(lengths[1] / lengths[2] - 1 / 3) < 0.002);
    const button = legend.getByText("完成", { exact: true });
    await button.locator("..").press("Enter");
    const details = page.getByRole("dialog", { name: "完成 · 原始记录", exact: true });
    await details.waitFor();
    assert.equal(await details.locator("tbody tr").count(), 3);
    await page.keyboard.press("Escape");
    await details.waitFor({ state: "detached" });
    await shootBothModes(page, screenshot, "status-donut");
    await db.locator(".db-chart-surface").evaluate(surface => { surface.style.inlineSize = "245px"; });
    const graphic = await db.locator(".db-real-donut-graphic").boundingBox();
    const list = await db.locator(".db-chart-legend").boundingBox();
    assert.ok(graphic.y + graphic.height <= list.y);
    assert.ok(await db.locator(".db-chart-surface").evaluate(surface => surface.scrollWidth <= surface.clientWidth));
    await screenshot("status-donut-narrow");
  });

  await check("Non-additive and empty charts display their actual results without shares or fake marks", async () => {
    await chooseSavedView(db, "average");
    assert.equal(await db.locator(".db-donut-segment").count(), 0);
    assert.equal(await db.locator(".db-chart-share").count(), 0);
    assert.deepEqual(await legend.locator("strong").allTextContents(), ["80", "120", "-20"]);
    await chooseSavedView(db, "empty");
    await db.getByText("没有符合当前筛选条件的记录。", { exact: true }).waitFor();
    assert.equal(await bars.count(), 0);
  });
}, { workspace });
