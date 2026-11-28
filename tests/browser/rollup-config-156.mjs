import { createProperty } from "../../src/domain/database.js";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { browserScenario } from "./harness.mjs";

const workspace = coreParityWorkspace();
const partnerSource = workspace.dataSources.find(source => source.id === "partners");
const partner = workspace.databaseItems.find(item => item.id === "partner-one");
partnerSource.properties.push(
  createProperty({ id: "approved", name: "已确认", type: "checkbox" }),
  createProperty({ id: "delivery", name: "交付日期", type: "date" }),
  createProperty({ id: "subjects", name: "主题", type: "multi_select", options: [
    { id: "first", name: "历史" }, { id: "second", name: "科幻" },
  ] }),
);
partner.values.delivery = { start: "2026-09-12", end: "2026-09-15", includeTime: false, timeZone: null };
partner.values.subjects = ["first", "second"];

await browserScenario("rollup-config-156", async ({ page, check, assert, persisted, saved }) => {
  const database = page.locator('.database-view[data-source-id="projects"]');
  const editor = page.getByRole("dialog", { name: "编辑汇总属性", exact: true });
  const field = database.locator('tr[data-item-id="alpha"] td[data-property-id="rollup"]');
  const target = editor.getByLabel("汇总目标属性");
  const calculation = editor.getByLabel("汇总计算");
  const readConfig = state => state.dataSources.find(source => source.id === "projects").properties.find(property => property.id === "rollup").config;
  const openEditor = async () => {
    await database.getByRole("button", { name: "编辑 供应方评分 属性", exact: true }).click();
    await page.getByRole("menu", { name: "供应方评分 属性菜单", exact: true }).getByRole("menuitem", { name: "编辑属性…" }).click();
    await editor.waitFor();
  };
  const save = async () => {
    await editor.getByRole("button", { name: "保存属性", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
  };
  await check("checkbox reducers are labeled, selected and persisted with an initially absent checkbox", async () => {
    await openEditor();
    assert.equal(await calculation.inputValue(), "average");
    await target.selectOption("approved");
    assert.equal(await calculation.inputValue(), "show");
    assert.deepEqual(await calculation.locator('option[value="checked"], option[value="unchecked"], option[value$="_checked"], option[value$="_unchecked"]').allTextContents(),
      ["已勾选数量", "未勾选数量", "已勾选百分比", "未勾选百分比"]);
    await calculation.selectOption({ label: "已勾选数量" });
    await save();
    assert.deepEqual(readConfig(await persisted(state => readConfig(state).aggregation === "checked")), {
      relationPropertyId: "relation", targetPropertyId: "approved", aggregation: "checked",
    });
    assert.equal(await field.innerText(), "0");
    await page.reload();
    await openEditor();
    assert.equal(await target.inputValue(), "approved");
    assert.equal(await calculation.inputValue(), "checked");
  });
  await check("date reducers follow the target and persist a scalar end date", async () => {
    await target.selectOption("delivery");
    assert.equal(await calculation.inputValue(), "show");
    assert.deepEqual(await calculation.locator('option[value="earliest_date"], option[value="latest_date"], option[value="date_range"]').allTextContents(),
      ["最早日期", "最晚日期", "日期范围"]);
    assert.equal(await calculation.locator('option[value="checked"]').count(), 0);
    await calculation.selectOption({ label: "最晚日期" });
    await save();
    assert.deepEqual(readConfig(await persisted(state => readConfig(state).aggregation === "latest_date")), {
      relationPropertyId: "relation", targetPropertyId: "delivery", aggregation: "latest_date",
    });
    assert.equal(await field.innerText(), "2026-09-15");
    await page.reload();
    assert.equal(await field.innerText(), "2026-09-15");
    assert.equal(readConfig(await saved()).aggregation, "latest_date");
  });
  await check("value counts, unique labels and nonempty percentage use separate saved aggregations", async () => {
    await openEditor();
    await target.selectOption("subjects");
    const expected = [
      ["count_all", "全部计数"], ["count_values", "值计数"], ["not_empty", "非空记录计数"],
      ["empty", "空值记录计数"], ["unique", "唯一值计数"], ["show_unique", "显示唯一值"],
      ["percent_empty", "空值百分比"], ["percent_not_empty", "非空百分比"],
    ];
    for (const [value, label] of expected) assert.equal(await calculation.locator(`option[value="${value}"]`).textContent(), label);
    for (const [value, display] of [
      ["count_all", "1"], ["count_values", "2"], ["show_unique", "历史, 科幻"], ["percent_not_empty", "100%"],
    ]) {
      await calculation.selectOption(value);
      await save();
      assert.equal(readConfig(await persisted(state => readConfig(state).aggregation === value)).targetPropertyId, "subjects");
      assert.equal(await field.innerText(), display);
      await page.reload();
      assert.equal(await field.innerText(), display);
      await openEditor();
      assert.equal(await calculation.inputValue(), value);
    }
  });
}, { workspace });
