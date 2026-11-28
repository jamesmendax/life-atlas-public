import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { assertSavedViewsAndLayouts, changeLayout, chooseSavedView, copyCurrentView, openViewSettingsSection, setViewSettings, viewSettingsPanel } from "./database-navigation.mjs";

await browserScenario("phase1-database", async ({ page, check, screenshot, saved, persisted, assert }) => {
  const db = page.locator('section.database-view[data-source-id="projects"]');
  const choose = async (type) => { await chooseSavedView(db, `view-${type}`); await page.waitForFunction((type) => document.querySelector('section.database-view[data-source-id="projects"]')?.getAttribute("data-view-type") === type, type); };
  const settings = (open) => setViewSettings(db, open);
  const panel = viewSettingsPanel(db);
  const alpha = () => db.locator('tr[data-item-id="alpha"]');
  const editText = async (locator, text) => { await locator.fill(text); await locator.press("Tab"); };

  await check("All ten registered views render the same original source and rows", async () => {
    await db.waitFor({ state: "visible" });
    await assertSavedViewsAndLayouts(db, coreParityWorkspace(), "projects", assert);
    for (const type of ["table", "board", "list", "gallery", "calendar", "timeline", "chart", "form", "dashboard", "map"]) await choose(type);
    const state = await persisted((value) => value.pages.find((entry) => entry.id === "database-page").databaseViewId === "view-map");
    assert.equal(state.dataSources.length, 2);
    assert.equal(state.databaseItems.length, 4);
    assert.equal(state.databaseViews.length, 10);
    assert.equal(await db.locator("[data-map-marker]").count(), 3);
    await screenshot("offline-map");
  });

  await check("URL Email Phone and People values edit and persist with human names", async () => {
    await choose("table");
    await editText(alpha().getByLabel("链接 · Alpha 项目", { exact: true }), "https://example.org/updated");
    await editText(alpha().getByLabel("邮箱 · Alpha 项目", { exact: true }), "edited@example.org");
    await editText(alpha().getByLabel("电话 · Alpha 项目", { exact: true }), "+49 30 555999");
    await alpha().locator('[data-property-id="people"] summary').click();
    await alpha().getByLabel("负责人 · Alpha 项目: 周宁", { exact: true }).check();
    const state = await persisted((value) => value.databaseItems.find((item) => item.id === "alpha").values.people.length === 2);
    const values = state.databaseItems.find((item) => item.id === "alpha").values;
    assert.equal(values.url, "https://example.org/updated");
    assert.equal(values.email, "edited@example.org");
    assert.equal(values.phone, "+49 30 555999");
    assert.deepEqual(values.people, ["person-a", "person-b"]);
    assert.match(await alpha().locator('[data-property-id="people"]').innerText(), /林初.*周宁/s);
    await alpha().locator('[data-property-id="people"] summary').click();
  });

  await check("Files, zero-coordinate Place, date range and checkbox share typed value editors", async () => {
    assert.match(await alpha().locator('[data-property-id="files"]').innerText(), /设计说明\.pdf/);
    await alpha().locator('[data-property-id="files"] summary').click();
    await alpha().getByLabel("附件 · Alpha 项目: 设计说明.pdf", { exact: true }).uncheck();
    await alpha().getByLabel("附件 · Alpha 项目: 设计说明.pdf", { exact: true }).check();
    await alpha().locator('[data-property-id="files"] summary').click();
    await alpha().locator('[data-property-id="place"] summary').click();
    await editText(alpha().getByLabel("地点 · Alpha 项目 名称", { exact: true }), "验收地点");
    await editText(alpha().getByLabel("地点 · Alpha 项目 纬度", { exact: true }), "0");
    await editText(alpha().getByLabel("地点 · Alpha 项目 经度", { exact: true }), "0");
    await alpha().locator('[data-property-id="date"] summary').click();
    await alpha().getByLabel("日期 · Alpha 项目 开始", { exact: true }).fill("2026-09-20");
    await alpha().getByLabel("日期 · Alpha 项目 开始", { exact: true }).press("Escape");
    await alpha().getByLabel("确认 · Alpha 项目", { exact: true }).check();
    const state = await persisted((value) => value.databaseItems.find((item) => item.id === "alpha").values.checked === true);
    const value = state.databaseItems.find((item) => item.id === "alpha").values;
    assert.equal(value.place.latitude, 0); assert.equal(value.place.longitude, 0); assert.equal(value.place.name, "验收地点");
    assert.equal(value.date.start, "2026-09-20"); assert.equal(value.date.end, "2026-09-21");
    assert.deepEqual(value.files, ["attachment-reference"]);
  });

  await check("A property can be created and configured without changing existing IDs", async () => {
    await openViewSettingsSection(db, "添加属性");
    await panel.getByRole("button", { name: "URL", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "编辑URL属性", exact: true });
    await dialog.getByLabel("属性名称").fill("发布链接");
    const state = await persisted((value) => value.dataSources[0].properties.some((property) => property.name === "发布链接"));
    assert.equal(state.dataSources[0].properties.find((property) => property.name === "发布链接").type, "url");
    assert.equal(state.dataSources[0].properties.find((property) => property.name === "名称").id, "title");
    await page.keyboard.press("Escape");
  });

  await check("Chart configuration produces number, line and donut projections over the same rows", async () => {
    await choose("chart"); await openViewSettingsSection(db, "布局");
    await panel.getByLabel("图表类型", { exact: true }).selectOption("number");
    await panel.getByLabel("图表聚合", { exact: true }).selectOption("average");
    await db.locator(".db-number-chart strong").waitFor();
    assert.equal(await db.locator(".db-number-chart strong").innerText(), "60");
    await panel.getByLabel("图表类型", { exact: true }).selectOption("line");
    assert.equal(await db.locator(".db-real-line-chart circle").count(), 3);
    await panel.getByLabel("图表类型", { exact: true }).selectOption("donut");
    assert.equal(await db.locator(".db-donut-segment").count(), 2);
    await panel.getByLabel("图表类型", { exact: true }).selectOption("bar");
    await settings(false); await screenshot("chart");
  });

  await check("Form rejects missing title, creates one typed row and retains submitter metadata", async () => {
    await choose("form");
    await db.getByRole("button", { name: "提交记录", exact: true }).click();
    assert.match(await db.locator(".db-field-error").first().innerText(), /必填/);
    assert.equal((await saved()).databaseItems.length, 4);
    await editText(db.getByLabel("名称", { exact: true }), "表单验收记录");
    await editText(db.getByLabel("金额", { exact: true }), "33");
    await editText(db.getByLabel("邮箱", { exact: true }), "form@example.org");
    await db.getByRole("button", { name: "提交记录", exact: true }).click();
    await db.getByRole("status").waitFor();
    const state = await persisted((value) => value.databaseItems.length === 5);
    const item = state.databaseItems.find((entry) => entry.values.title === "表单验收记录");
    assert.ok(item); assert.equal(item.sourceId, "projects"); assert.equal(item.values.amount, 33); assert.equal(item.values.email, "form@example.org");
    assert.equal(item.submission.personId, "person-local"); assert.equal(item.submission.anonymous, false);
    assert.ok(state.pages.some((entry) => entry.id === item.pageId));
    await screenshot("form-success");
  });

  await check("Dashboard widget settings change layout and metrics without copying records", async () => {
    await choose("dashboard"); await openViewSettingsSection(db, "布局");
    await panel.getByRole("button", { name: "＋ 指标", exact: true }).click();
    const details = panel.locator(".db-widget-setting").last();
    await details.locator("summary").click();
    await editText(details.getByLabel("组件 4 标题", { exact: true }), "验收总额");
    await details.getByLabel("组件 4 聚合", { exact: true }).selectOption("sum");
    await details.getByLabel("组件 4 数值属性", { exact: true }).selectOption("amount");
    await settings(false);
    const widget = db.locator(".db-configured-widget").filter({ has: page.getByRole("heading", { name: "验收总额", exact: true }) });
    assert.equal(await widget.locator(".db-dashboard-metric strong").innerText(), "213");
    await screenshot("dashboard");
  });

  await check("Map selection keyboard pan zoom and view copy persist independently", async () => {
    await choose("map");
    await db.getByRole("button", { name: "定位 Gamma 项目", exact: true }).press("Enter");
    assert.match(await db.locator(".db-map-selection").innerText(), /Gamma 项目/);
    await db.getByRole("button", { name: "地图放大", exact: true }).click();
    await db.locator(".db-offline-map").press("ArrowRight");
    await persisted((value) => value.databaseViews.find((entry) => entry.id === "view-map").config.map.center[0] > 0);
    await copyCurrentView(db);
    const state = await persisted((value) => value.databaseViews.length === 11);
    assert.equal(state.databaseItems.length, 5); assert.equal(state.dataSources.length, 2);
    const copy = state.databaseViews.at(-1); assert.equal(copy.type, "map"); assert.equal(copy.sourceId, "projects");
    await changeLayout(db, "table");
    const changed = await persisted((value) => value.databaseViews.at(-1).type === "table");
    assert.equal(changed.databaseViews.find((entry) => entry.id === "view-map").type, "map");
    await page.reload({ waitUntil: "domcontentloaded" }); await db.waitFor();
    assert.equal(await db.getAttribute("data-view-id"), copy.id);
    assert.equal(await db.getAttribute("data-view-type"), "table");
    const reloaded = await saved(); assert.equal(reloaded.databaseItems.find((item) => item.id === "alpha").values.place.latitude, 0);
    await choose("table"); await screenshot("table");
  });

  await check("Record page exposes shared typed properties and editing updates the same row", async () => {
    await db.locator('tr[data-item-id="alpha"] td[data-property-id="title"]').hover();
    await db.getByRole("button", { name: "打开 Alpha 项目", exact: true }).click();
    const properties = page.getByLabel("记录属性", { exact: true });
    await properties.waitFor();
    assert.match(await properties.innerText(), /林初.*周宁/s);
    await editText(properties.getByLabel("邮箱", { exact: true }), "record@example.org");
    const state = await persisted((value) => value.databaseItems.find((entry) => entry.id === "alpha").values.email === "record@example.org");
    assert.equal(state.databaseItems.length, 5);
    await screenshot("record");
  });
});
