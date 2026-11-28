import { createDatabaseView, createProperty } from "../../src/domain/database.js";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { browserScenario } from "./harness.mjs";
import { chooseSavedView, openViewSettingsSection, setViewSettings } from "./database-navigation.mjs";

const workspace = coreParityWorkspace();
const projects = workspace.dataSources.find(source => source.id === "projects");
const partners = workspace.dataSources.find(source => source.id === "partners");
const field = (id, name, type, config) => createProperty({ id, name, type, config });
projects.properties.push(
  field("derived", "计算日期", "formula", { expression: 'if({{amount}} == 120, dateRange(parseDate("2026-09-26"), parseDate("2026-09-27")), null)' }),
  field("until", "汇总日期", "rollup", { relationPropertyId: "relation", targetPropertyId: "due", aggregation: "earliest_date" }),
  field("date-text", "日期文字", "formula", { expression: '"2026-09-25"' }),
  field("created", "工作日建立时间", "created_time"),
  field("manual-end", "手动结束日期", "date"),
  field("rich-result", "文档链接", "formula", { expression: 'link("公开文档", "https://example.com/")' }),
  field("page-result", "供应方页面", "formula", { expression: "{{relation}}.first()" }),
  field("person-result", "负责人名字", "formula", { expression: "{{people}}.first()" }),
);
const day = start => ({ start, end: null, includeTime: false, timeZone: null });
partners.properties.push(field("due", "到期日", "date"));
workspace.databaseItems.find(item => item.id === "partner-one").values.due = day("2026-09-24");
const alpha = workspace.databaseItems.find(item => item.id === "alpha");
alpha.values.date = day("2026-09-23");
alpha.values["manual-end"] = day("2026-09-28");
alpha.createdAt = "2026-09-25T12:00:00Z";
const calendar = workspace.databaseViews.find(view => view.id === "view-calendar");
calendar.config = { calendar: { datePropertyId: "derived", anchorDate: "2026-09-26", mode: "week" } };
const timeline = workspace.databaseViews.find(view => view.id === "view-timeline");
timeline.config = { timeline: { datePropertyId: "derived", endDatePropertyId: "manual-end", windowStart: "2026-09-21", windowEnd: "2026-10-03", scale: "day" } };
workspace.databaseViews.push(
  createDatabaseView({ id: "calendar-text", sourceId: projects.id, type: "calendar",
    config: { calendar: { ...calendar.config.calendar, datePropertyId: "date-text" } } }),
  createDatabaseView({ id: "timeline-missing", sourceId: projects.id, type: "timeline",
    config: { timeline: { ...timeline.config.timeline, datePropertyId: "previous-date" } } }),
);
const cardProperties = ["rich-result", "page-result", "person-result"];
workspace.databaseViews.find(view => view.id === "view-gallery").config = { gallery: { visiblePropertyIds: cardProperties } };
workspace.databaseViews.find(view => view.id === "view-board").visiblePropertyIds = cardProperties;
const empty = { id: "empty-formulas", title: "空公式库", ownerPageId: "empty-formula-page",
  properties: [field("title", "名称", "title"), field("empty-expression", "空库公式", "formula", { expression: "2 + 2" })] };
workspace.dataSources.push(empty);
workspace.databaseViews.push(createDatabaseView({ id: "empty-formula-view", sourceId: empty.id, type: "table" }));
workspace.pages.push({ ...workspace.pages.find(page => page.id === "database-page"), id: empty.ownerPageId, title: empty.title,
  databaseSourceId: empty.id, databaseViewId: "empty-formula-view" });
const owner = workspace.pages.find(page => page.id === "database-page");
owner.databaseViewId = calendar.id;
owner.content = [{ id: "surface-date-occurrence", type: "databaseView",
  props: { sourceId: projects.id, viewId: calendar.id,
    viewIdsJson: JSON.stringify([calendar.id, timeline.id, "view-board", "view-gallery", "view-table", "calendar-text", "timeline-missing"]) } }];

await browserScenario("computed-calendar-and-formula", async ({ page, check, assert, saved, persisted }) => {
  const database = page.locator('section.database-view[data-source-id="projects"]');
  const choose = id => chooseSavedView(database, id);
  const calendarDays = () => database.locator('.db-calendar-cell [data-item-id="alpha"]')
    .evaluateAll(nodes => nodes.map(node => node.closest(".db-calendar-cell").dataset.date));
  const goLayout = () => openViewSettingsSection(database, "布局");
  const closeLayout = () => setViewSettings(database, false);
  const selection = (state, view, key) => state.databaseViews.find(entry => entry.id === view.id).config[key];
  const bar = () => database.locator('.db-timeline-bar[data-item-id="alpha"]');
  const optionIds = control => control.locator("option").evaluateAll(nodes => nodes.map(node => node.value));

  await check("calendar selects and reads typed formula, rollup and timestamps without writing their results", async () => {
    await database.getByRole("grid", { name: "数据库日历" }).waitFor();
    assert.deepEqual(await calendarDays(), ["2026-09-26", "2026-09-27"]);
    assert.equal(await database.locator('.db-calendar-chip[data-item-id="alpha"]').getAttribute("draggable"), "false");
    assert.equal(await database.locator(".db-calendar-add, .db-cal-range-edge").count(), 0);
    await database.getByRole("button", { name: "未安排 (2)" }).click();
    const unscheduled = page.getByRole("dialog", { name: "未安排的记录" });
    assert.equal(await unscheduled.locator('[draggable="true"]').count(), 0);
    assert.equal(await unscheduled.getByLabel(/^设置/).count(), 0);
    await page.keyboard.press("Escape");
    const panel = await goLayout();
    const date = panel.getByLabel("日历日期属性", { exact: true });
    const options = await optionIds(date);
    for (const id of ["date", "derived", "until", "created"]) assert.ok(options.includes(id), id);
    assert.equal(options.includes("date-text"), false);
    await date.selectOption("until");
    await persisted(state => selection(state, calendar, "calendar").datePropertyId === "until");
    assert.deepEqual(await calendarDays(), ["2026-09-24"]);
    await date.selectOption("created");
    assert.deepEqual(await calendarDays(), ["2026-09-25"]);
    await date.selectOption("date");
    await closeLayout();
    assert.deepEqual(await calendarDays(), ["2026-09-23"]);
    assert.equal(await database.locator('.db-calendar-chip[data-item-id="alpha"]').getAttribute("draggable"), "true");
    assert.ok(await database.locator(".db-calendar-add").count());
    const handle = database.getByRole("button", { name: "拖动 Alpha 项目 到其他日期" });
    const target = database.locator('.db-calendar-cell[data-date="2026-09-22"]');
    const [from, to] = await Promise.all([handle.boundingBox(), target.boundingBox()]);
    assert.ok(from && to);
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
    await page.mouse.up();
    await persisted(state => state.databaseItems.find(item => item.id === "alpha").values.date.start === "2026-09-22");
    assert.deepEqual(await calendarDays(), ["2026-09-22"]);
  });

  await check("timeline reads a separate end date and only adjusts editable edges", async () => {
    await choose(timeline.id);
    assert.equal(await bar().getAttribute("title"), "2026-09-26 → 2026-09-28");
    assert.equal(await bar().getAttribute("draggable"), "false");
    assert.equal(await bar().getByRole("button", { name: /开始日期|拖动/ }).count(), 0);
    await bar().getByRole("button", { name: /结束日期/ }).press("ArrowRight");
    let state = await persisted(value => value.databaseItems.find(item => item.id === "alpha").values["manual-end"].start === "2026-09-29");
    assert.equal(state.databaseItems.find(item => item.id === "alpha").values.derived, undefined);
    assert.equal(await bar().getAttribute("title"), "2026-09-26 → 2026-09-29");
    const panel = await goLayout();
    const start = panel.getByLabel("时间线日期属性", { exact: true });
    const end = panel.getByLabel("时间线结束日期属性", { exact: true });
    assert.ok((await optionIds(end)).includes("until"));
    assert.equal((await optionIds(end)).includes("derived"), false);
    await start.selectOption("date");
    await end.selectOption("until");
    await closeLayout();
    assert.equal(await bar().getAttribute("title"), "2026-09-22 → 2026-09-24");
    assert.equal(await bar().getByRole("button", { name: /结束日期|拖动/ }).count(), 0);
    await bar().getByRole("button", { name: /开始日期/ }).press("ArrowRight");
    state = await persisted(value => value.databaseItems.find(item => item.id === "alpha").values.date.start === "2026-09-23");
    assert.equal(state.databaseItems.find(item => item.id === "alpha").values.until, undefined);
    assert.equal(await bar().getAttribute("title"), "2026-09-23 → 2026-09-24");
    const reopened = await saved();
    assert.equal(selection(reopened, timeline, "timeline").endDatePropertyId, "until");
    const editablePanel = await goLayout();
    await editablePanel.getByLabel("时间线结束日期属性", { exact: true }).selectOption("manual-end");
    await closeLayout();
    assert.equal(await bar().getAttribute("draggable"), "true");
    await bar().getByRole("button", { name: "Alpha 项目 后移一天", exact: true }).click();
    await persisted(value => {
      const { values } = value.databaseItems.find(item => item.id === "alpha");
      return values.date.start === "2026-09-24" && values["manual-end"].start === "2026-09-30";
    });
  });

  await check("gallery and board render typed links and labels outside card buttons", async () => {
    for (const type of ["board", "gallery"]) {
      await choose("view-" + type);
      const card = database.locator(`.db-${type}-card[data-item-id="alpha"]`);
      const link = card.getByRole("link", { name: "公开文档" });
      assert.equal(await link.getAttribute("href"), "https://example.com/");
      assert.equal(await link.evaluate(element => Boolean(element.closest("button"))), false);
      assert.equal(await card.getByRole("button", { name: "供应方一", exact: true }).count(), 1);
      assert.match(await card.innerText(), /林初/);
    }
  });

  await check("an explicit unusable field stays selected without falling back to the manual date", async () => {
    await choose("calendar-text");
    assert.deepEqual(await calendarDays(), []);
    assert.ok(await database.getByRole("button", { name: "未安排 (3)" }).isVisible());
    assert.equal(await database.locator(".db-calendar-add").count(), 0);
    await choose("timeline-missing");
    assert.match(await database.locator(".db-surface-message").innerText(), /所选开始日期属性不可用/);
    assert.equal(await bar().count(), 0);
  });

  await check("a populated database keeps the valid live preview and surfaces invalid syntax", async () => {
    await choose("view-table");
    await database.getByRole("button", { name: "编辑 双倍金额 属性", exact: true }).click();
    await page.getByRole("menu", { name: "双倍金额 属性菜单", exact: true }).getByRole("menuitem", { name: "编辑属性…" }).click();
    const dialog = page.getByRole("dialog", { name: "编辑公式属性", exact: true });
    assert.match(await dialog.getByRole("status").innerText(), /240/);
    await dialog.getByLabel("公式表达式").fill("(");
    assert.match(await dialog.getByRole("status").innerText(), /错误|应该/);
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
  });

  await check("an empty database reports formula syntax, blocks a bad save and accepts a blank formula", async () => {
    const sidebar = page.locator(".workspace-sidebar");
    await sidebar.locator('.sidebar-page-row[data-node-id="empty-formula-page"] .sidebar-page-main').click();
    const table = page.locator('section.database-view[data-source-id="empty-formulas"]');
    await table.getByRole("button", { name: "编辑 空库公式 属性", exact: true }).click();
    await page.getByRole("menu", { name: "空库公式 属性菜单", exact: true }).getByRole("menuitem", { name: "编辑属性…" }).click();
    const dialog = page.getByRole("dialog", { name: "编辑公式属性", exact: true });
    const expression = dialog.getByLabel("公式表达式", { exact: true });
    const save = dialog.getByRole("button", { name: "保存属性", exact: true });
    const storedExpression = state => state.dataSources.find(source => source.id === empty.id).properties.find(property => property.id === "empty-expression").config.expression;
    await expression.fill("@");
    assert.equal(await expression.getAttribute("aria-invalid"), "true");
    assert.match(await dialog.getByRole("status").innerText(), /第 1 个字符/);
    if (await save.isEnabled()) await save.click();
    assert.equal(await dialog.isVisible(), true);
    assert.equal(storedExpression(await saved()), "2 + 2");
    await expression.fill("");
    assert.equal(await expression.getAttribute("aria-invalid"), "false");
    assert.match(await dialog.getByRole("status").innerText(), /没有记录/);
    await save.click();
    await dialog.waitFor({ state: "detached" });
    await persisted(state => storedExpression(state) === "");
  });
}, { workspace, now: new Date(2026, 8, 26, 12).toISOString() });
