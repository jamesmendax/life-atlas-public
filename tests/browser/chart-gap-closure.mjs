import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabaseView } from "../../src/domain/database.js";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { chooseSavedView } from "./database-navigation.mjs";
import { browserScenario } from "./harness.mjs";

const run = process.env.LIFE_ATLAS_CHART_REVIEW_RUN || "";
if (!/^[a-z0-9-]*$/.test(run)) throw new Error("Invalid chart QA run label.");
const evidence = path.resolve(".qa/view-gap-closure", `chart-exports${run ? `-${run}` : ""}`);
await mkdir(evidence, { recursive: true });
export const chartGapClosureWorkspace = coreParityWorkspace();
const workspace = chartGapClosureWorkspace;
const pageSeed = workspace.pages.find(page => page.id === "database-page");
const kinds = ["line", "column", "bar", "donut", "number"];
const dateBucket = { xPropertyId: "date", groupPropertyId: "status", dateInterval: "month", sort: "category_asc" };
const views = kinds.map(kind => createDatabaseView({ id: `closure-${kind}`, name: `验收-${kind}`, sourceId: "projects", type: "chart",
  config: { chart: { kind, ...(kind === "donut" ? { xPropertyId: "status" } : dateBucket),
    aggregation: kind === "line" ? "sum" : "count", valuePropertyId: kind === "line" ? "amount" : null } },
}));
workspace.databaseViews.push(...views);
pageSeed.databaseViewId = views[0].id;
pageSeed.settings = { ...pageSeed.settings, fullWidth: true, presentationMode: "full" };
pageSeed.content = [{ id: "chart-closure-db", type: "databaseView", props: {
  sourceId: "projects", viewId: views[0].id, viewIdsJson: JSON.stringify(views.map(view => view.id)),
} }];
const [alpha, beta, gamma] = workspace.databaseItems;
function values(date, amount, status) { return { date: { start: date, includeTime: false }, amount, status }; }
Object.assign(alpha.values, values("2026-01-02", 10, "doing"));
Object.assign(beta.values, values("2026-01-19", 5, "todo"));
Object.assign(gamma.values, values("2026-02-08", -14, "doing"));
for (const [id, title, date, amount, status] of [
  ["march", "三月项目", "2026-03-08", 7, "todo"], ["empty", "空值项目", "2026-02-20", null, "doing"],
]) {
  workspace.databaseItems.push({ ...alpha, id, pageId: `${id}-page`, values: { ...alpha.values, title, ...values(date, amount, status) } });
  workspace.pages.push({ ...workspace.pages.find(page => page.id === alpha.pageId), id: `${id}-page`, title, content: [] });
}

export async function verifyChartGapClosure({ page, check, assert, persisted }, { downloadFiles = true } = {}) {
  const db = page.locator('.database-view[data-source-id="projects"]');
  const lineChart = () => db.locator(".db-chart-line");
  const configuration = db.getByRole("button", { name: "配置图表", exact: true });
  const saveDialog = page.getByRole("dialog", { name: "保存图表", exact: true });
  const chartConfig = (saved, kind = "line") => saved.databaseViews.find(view => view.id === `closure-${kind}`).config.chart;
  const saveButton = () => db.getByRole("button", { name: "保存图表…", exact: true });
  const capture = name => db.screenshot({ path: path.join(evidence, name), animations: "disabled" });

  await check("Category visibility and cumulative plotted options persist across reload", async () => {
    await lineChart().waitFor();
    await configuration.click();
    await db.getByLabel("图表累计", { exact: true }).check();
    await db.getByLabel("图表平滑折线", { exact: true }).check();
    await db.getByLabel("图表渐变面积", { exact: true }).check();
    await db.getByText("分类与系列可见性", { exact: true }).click();
    await db.getByRole("checkbox", { name: "显示分类 2026年2月", exact: true }).uncheck();
    assert.deepEqual(await db.locator(".db-cartesian-categories li").allTextContents(), ["2026年1月", "2026年3月"]);
    const saved = await persisted(value => chartConfig(value).hiddenCategories?.length === 1);
    assert.equal(chartConfig(saved).smoothLine, true);
    assert.equal(chartConfig(saved).gradientArea, true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await lineChart().waitFor();
    assert.deepEqual(await db.locator(".db-cartesian-categories li").allTextContents(), ["2026年1月", "2026年3月"]);
    await configuration.click();
    await db.getByText("分类与系列可见性", { exact: true }).click();
    await db.getByRole("checkbox", { name: "显示分类 2026年2月", exact: true }).check();
    const curves = db.locator(".db-cartesian-lines .db-cartesian-line");
    assert.match(await curves.first().getAttribute("d"), / C/);
    assert.ok(await db.locator(".db-cartesian-area").count() >= 1);
    assert.equal(await db.getByRole("button", { name: "查看原始记录 · 2026年3月 / 进行中", exact: true }).getAttribute("aria-description"), "金额 -4");
    await db.getByRole("button", { name: "隐藏系列 待办", exact: true }).click();
    assert.equal(await db.locator('.db-cartesian-line[data-series="待办"]').count(), 0);
    await persisted(value => chartConfig(value).hiddenSeries?.length === 1);
    await db.getByRole("checkbox", { name: "显示系列 待办", exact: true }).check();
    assert.equal(await db.locator('.db-cartesian-line[data-series="待办"]').count(), 1);
    await capture("line-options.png");
    await configuration.click();
    await capture("line-screen.png");
  });

  if (downloadFiles) await check("All five chart types download well-formed vector SVG and raster PNG, and supply PNG to clipboard", async () => {
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "write", { configurable: true, value: async entries => {
        const image = await entries[0].getType("image/png");
        const bitmap = await createImageBitmap(image);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const visible = pixels.some((value, index) => index % 4 === 3 && value > 0);
        globalThis.chartCopied = { width: bitmap.width, height: bitmap.height, bytes: image.size, visible };
        bitmap.close();
      } });
    });
    for (const kind of kinds) {
      if (kind !== "line") await chooseSavedView(db, `closure-${kind}`);
      await saveButton().click();
      await saveDialog.waitFor();
      await saveDialog.getByLabel("图表背景", { exact: true }).selectOption("transparent");
      await saveDialog.locator("img").evaluate(image => image.decode());
      let pngSize;
      for (const extension of ["svg", "png"]) {
        const download = page.waitForEvent("download");
        await saveDialog.getByRole("button", { name: `下载 ${extension.toUpperCase()}`, exact: true }).click();
        const result = await download;
        const file = path.join(evidence, `${kind}.${extension}`);
        await result.saveAs(file);
        assert.equal(await result.failure(), null);
        const data = await readFile(file);
        if (extension === "svg") {
          const svg = data.toString("utf8");
          const validation = await page.evaluate(raw => {
            const document = new DOMParser().parseFromString(raw, "image/svg+xml");
            return { good: !document.querySelector("parsererror") && document.documentElement.localName === "svg",
              marks: document.querySelectorAll("path,rect,circle,line").length, title: document.querySelector("title")?.textContent };
          }, svg);
          assert.equal(validation.good, true);
          assert.equal(validation.title, `验收-${kind}`);
          assert.ok(kind === "number" ? svg.includes("条记录") : validation.marks > 0);
          assert.doesNotMatch(svg, /foreignObject|<script|href=|NaN/);
          if (kind === "line") assert.match(svg, /linearGradient[\s\S]* C/);
        } else {
          assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
          pngSize = [data.readUInt32BE(16), data.readUInt32BE(20)];
          assert.ok(pngSize[0] > 300 && pngSize[1] > 200 && data.length > 1500);
        }
        await saveDialog.getByRole("status").filter({ hasText: `已保存 ${extension.toUpperCase()}` }).waitFor();
      }
      await saveDialog.getByRole("button", { name: "复制为 PNG", exact: true }).click();
      await saveDialog.getByRole("status").filter({ hasText: "已复制 PNG" }).waitFor();
      const copied = await page.evaluate(() => globalThis.chartCopied);
      assert.deepEqual([copied.width, copied.height], pngSize);
      assert.ok(copied.visible && copied.bytes > 1500);
      if (kind === "donut") await saveDialog.screenshot({ path: path.join(evidence, "export-dialog.png"), animations: "disabled" });
      await saveDialog.getByRole("button", { name: "关闭对话框", exact: true }).click();
    }
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "write", { configurable: true, value: async entries => {
        await entries[0].getType("image/png");
        throw new Error("Denied by the isolated clipboard fixture.");
      } });
    });
    await saveButton().click();
    await saveDialog.getByRole("button", { name: "复制为 PNG", exact: true }).click();
    await saveDialog.getByRole("alert").filter({ hasText: "未能复制 PNG" }).waitFor();
    await saveDialog.getByRole("button", { name: "关闭对话框", exact: true }).click();
  });

  await check("Cumulative drilldown contains contributing records and saves a matching table view", async () => {
    await chooseSavedView(db, "closure-line");
    const mark = db.getByRole("button", { name: "查看原始记录 · 2026年3月 / 进行中", exact: true });
    await mark.press("Enter");
    const drilldown = page.getByRole("dialog", { name: "2026年3月 / 进行中 · 原始记录", exact: true });
    await drilldown.waitFor();
    assert.deepEqual(await drilldown.locator("tbody td:first-child").allTextContents(), ["Alpha 项目", "Gamma 项目"]);
    await drilldown.getByRole("button", { name: "另存为表格视图", exact: true }).click();
    await persisted(value => value.databaseViews.some(view => view.config?.chartSlice?.bucketKeys?.length === 3));
    const table = db.locator(".db-table");
    await table.waitFor();
    assert.deepEqual(await table.locator("tbody tr[data-item-id]").evaluateAll(rows => rows.map(row => row.dataset.itemId)), ["alpha", "gamma"]);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await browserScenario("view-gap-closure/chart-gap-closure", verifyChartGapClosure, { workspace, viewport: { width: 1440, height: 1050 } });
}
