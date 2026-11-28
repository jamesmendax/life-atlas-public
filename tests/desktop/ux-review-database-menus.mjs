import assert from "node:assert/strict";
import { openViewSettingsSection, setViewSettings } from "../browser/database-navigation.mjs";

const types = ["table", "board", "list", "gallery", "calendar", "timeline", "chart", "form", "dashboard", "map", "roadmap"];
const button = (root, name) => root.getByRole("button", { name, exact: true });
const label = (root, name) => root.getByLabel(name, { exact: true });
const savedView = (state, type) => state.databaseViews.find(view => view.id === "view-" + type);
const rowById = (state, id) => state.databaseItems.find(row => row.id === id);
const viewRows = db => db.locator("tbody tr[data-item-id]").evaluateAll(rows => rows.map(row => row.dataset.itemId));
const projectRows = state => state.databaseItems.filter(row => row.sourceId === "projects");
const modal = (page, name) => page.getByRole("dialog", { name, exact: true });

function readControls(node) {
  return [...node.querySelectorAll("button,select,input,textarea,summary")].filter(element =>
    element.getClientRects().length && !element.closest('[aria-hidden="true"]')
  ).map(element => ({
    name: element.getAttribute("aria-label") || element.innerText?.trim() || element.labels?.[0]?.innerText.trim() || element.placeholder,
    role: element.getAttribute("role") || element.type || element.tagName.toLowerCase(),
    disabled: !!element.disabled,
    ...(element.options ? { options: [...element.options].map(option => option.textContent.trim()) } : {}),
  }));
}

export async function databaseMenuPaths({ page, db, check, nav, frame, persist, saved, until, openDb }) {
  const settings = section => openViewSettingsSection(db, section);
  const closeSettings = () => setViewSettings(db, false);
  const confirmFocus = locator => until(() => locator.evaluate(element => document.activeElement === element));
  const peek = () => modal(page, "记录预览");
  const propertyMenu = async name => {
    await button(db, "编辑 " + name + " 属性").click();
    return page.getByRole("menu", { name: name + " 属性菜单", exact: true });
  };

  await check("view-create", "从可见入口逐一新建十一种布局并核验不同视图 ID", async () => {
    await nav("table");
    const expected = ["表格", "看板", "列表", "画廊", "日历", "时间线", "图表", "表单", "仪表盘", "地图", "时间脉络"];
    const opener = button(db, "添加视图");
    const picker = modal(page, "添加视图");
    const initial = (await saved()).databaseViews.filter(v => v.sourceId === "projects").length;
    await opener.click();
    const available = (await picker.evaluate(readControls)).map(entry => entry.name);
    await button(picker, "关闭添加视图").click();
    await confirmFocus(opener);
    assert.equal((await saved()).databaseViews.filter(v => v.sourceId === "projects").length, initial);
    const created = [];
    for (const [index, display] of expected.entries()) {
      if (index === 0) {
        await db.getByRole("button", { name: /^更多\d+个…$/u }).click();
        await page.getByRole("menuitem", { name: "新建视图", exact: true }).click();
      } else await opener.click();
      await button(picker, display).click();
      const configuration = modal(page, "新建视图");
      const name = "走查新建 · " + display;
      await label(configuration, "视图名称").fill(name);
      await button(configuration, "完成").click();
      const state = await persist(s => s.databaseViews.some(v => v.name === name));
      const view = state.databaseViews.find(v => v.name === name);
      assert.equal(view.type, types[index]);
      assert.equal(view.id, await db.getAttribute("data-view-id"));
      assert.equal(view.sourceId, "projects");
      created.push({ id: view.id, type: view.type, name: view.name });
    }
    assert.equal(new Set(created.map(v => v.id)).size, types.length);
    const final = (await saved()).databaseViews.filter(v => v.sourceId === "projects").length;
    assert.equal(final, initial + types.length);
    return { available, initial, final, created };
  });

  await check("view-copy", "复制并改名，保留原视图，检查可见管理入口", async () => {
    await nav("table");
    const source = savedView(await saved(), "table");
    let main = await settings();
    const settingsEntries = await main.evaluate(readControls);
    await button(main, "复制当前视图").click();
    const state = await persist(s => s.databaseViews.some(v => v.name === "表格 副本"));
    const copy = state.databaseViews.find(v => v.name === "表格 副本");
    assert.notEqual(copy.id, source.id);
    assert.equal(copy.sourceId, source.sourceId);
    assert.deepEqual(copy.visiblePropertyIds, source.visiblePropertyIds);
    await confirmFocus(db.locator('[role=tab][aria-selected=true]'));
    main = await settings();
    await label(main, "视图名称").fill("独立命名的副本");
    await closeSettings();
    await nav("board");
    const more = db.getByRole("button", { name: /^更多\d+个…$/u });
    await more.click();
    const menu = page.getByRole("dialog", { name: /^全部视图：/u });
    const overflowEntries = await menu.evaluate(readControls);
    await label(menu, "搜索视图").fill("独立命名的副本");
    await label(menu, "搜索视图").press("Enter");
    await until(() => db.getAttribute("data-view-id").then(id => id === copy.id));
    const result = await persist(s => s.databaseViews.find(v => v.id === copy.id)?.name === "独立命名的副本");
    assert.equal(savedView(result, "table").name, "表格");
    return { copyId: copy.id, originalId: source.id, settingsEntries, overflowEntries,
      deleteActions: [...settingsEntries, ...overflowEntries].filter(entry => /删除视图|删除当前视图|移除视图/u.test(entry.name || "")) };
  });

  await check("new-options", "通过更多新建选项分别创建模板记录和空白记录", async () => {
    await nav("list");
    const opener = button(db, "更多新建选项");
    await opener.click();
    const menu = modal(page, "更多新建选项");
    const choices = await menu.evaluate(readControls);
    await button(menu, "走查记录模板").click();
    await peek().waitFor();
    assert.equal(await label(peek(), "记录标题").inputValue(), "来自走查模板");
    const templateState = await persist(s => projectRows(s).some(r => r.values.title === "来自走查模板" && r.values.amount === 752));
    const fromTemplate = projectRows(templateState).find(r => r.values.title === "来自走查模板");
    const content = templateState.pages.find(p => p.id === fromTemplate.pageId).content;
    assert.ok(JSON.stringify(content).includes("隔离模板正文"));
    await button(peek(), "关闭预览").click();
    const before = projectRows(templateState).length;
    await opener.click();
    await button(menu, "空白记录").click();
    const title = label(peek(), "记录标题");
    await title.fill("更多选项中的空白记录");
    await title.press("Escape");
    const state = await persist(s => projectRows(s).length === before + 1 && projectRows(s).some(r => r.values.title === "更多选项中的空白记录"));
    return { choices, templateId: fromTemplate.id, amount: fromTemplate.values.amount, blankId: projectRows(state).find(r => r.values.title === "更多选项中的空白记录").id };
  });

  await check("nested-query", "嵌套 AND/OR、多级排序顺序与删除", async () => {
    await nav("table");
    const betaChecked = db.locator('tr[data-item-id="beta"] td[data-property-id="checked"] input[type="checkbox"]');
    await betaChecked.check();
    const before = await persist(s => rowById(s, "beta").values.checked === true);
    const expected = projectRows(before).filter(r =>
      !r.values.checked && (Number(r.values.amount) > 20 || r.values.title.includes("Gamma 项目"))
    ).map(r => r.id).sort();
    assert.ok(expected.includes("alpha") && expected.includes("gamma") && !expected.includes("beta"));
    let panel = await settings("筛选");
    const root = panel.locator('fieldset[data-filter-path="root"]');
    await button(root.locator(":scope > .db-filter-actions"), "+ 条件组").click();
    const subgroup = panel.locator('fieldset[data-filter-path="0"]');
    await label(subgroup, "筛选逻辑 0").selectOption("or");
    await button(subgroup, "+ 条件").click();
    await label(subgroup, "筛选属性 0.0").selectOption("amount");
    await label(subgroup, "筛选操作 0.0").selectOption("greater_than");
    await label(subgroup, "筛选值 0.0").fill("20");
    await button(subgroup, "+ 条件").click();
    await label(subgroup, "筛选值 0.1").fill("Gamma 项目");
    await button(root.locator(":scope > .db-filter-actions"), "+ 条件").click();
    await label(panel, "筛选属性 1").selectOption("checked");
    await label(panel, "筛选操作 1").selectOption("unchecked");
    await closeSettings();
    await until(async () => (await viewRows(db)).length === expected.length);
    const actual = (await viewRows(db)).sort();
    assert.deepEqual(actual, expected);
    const filtered = await persist(s => savedView(s, "table").filter?.children?.[0]?.op === "or");
    panel = await settings("筛选");
    await button(panel.locator('fieldset[data-filter-path="0"]'), "删除组").click();
    await button(panel, "清除筛选").click();
    await closeSettings();
    await persist(s => !savedView(s, "table").filter);
    await betaChecked.uncheck();
    panel = await settings("排序");
    await button(panel, "+ 添加排序").click();
    await label(panel, "排序属性 1").selectOption("status");
    await button(panel, "+ 添加排序").click();
    await label(panel, "排序属性 2").selectOption("amount");
    await label(panel, "排序方向 2").selectOption("desc");
    await button(panel, "排序 2 上移").click();
    const reordered = await persist(s => savedView(s, "table").sorts?.[0]?.propertyId === "amount" && savedView(s, "table").sorts?.[1]?.propertyId === "status");
    await closeSettings();
    const ordered = (await viewRows(db)).slice(0, 5);
    const amounts = ordered.map(id => Number(rowById(reordered, id).values.amount || 0));
    assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a));
    panel = await settings("排序");
    await button(panel, "排序 1 下移").click();
    await button(panel, "删除排序 2").click();
    await button(panel, "删除排序 1").click();
    await closeSettings();
    await persist(s => savedView(s, "table").sorts.length === 0);
    return { filter: savedView(filtered, "table").filter, filteredIds: actual, excludedByRoot: "beta", order: savedView(reordered, "table").sorts, firstFive: ordered, firstAmounts: amounts };
  });

  await check("group-admin", "隐藏/恢复实体分组、改变列序、设置/移除子分组", async () => {
    await nav("board");
    let panel = await settings("分组");
    await label(panel, "一级分组").selectOption("status");
    const entry = panel.locator(".db-group-order > div").filter({ has: panel.page().getByText("待办", { exact: true }) });
    await entry.getByRole("checkbox").uncheck();
    await closeSettings();
    await until(() => db.locator('.db-board-column[data-group-key="todo"]').count().then(n => n === 0));
    panel = await settings("分组");
    const todo = panel.locator(".db-group-order > div").filter({ hasText: "待办" });
    await todo.getByRole("checkbox").check();
    await button(todo, "↓").click();
    await closeSettings();
    panel = await settings("子分组");
    await label(panel, "二级分组").selectOption("people");
    const arranged = await persist(s => savedView(s, "board").grouping?.order?.[1] === "todo" && savedView(s, "board").grouping?.secondaryPropertyId === "people");
    await label(panel, "二级分组").selectOption("");
    await closeSettings();
    const ids = await db.locator(".db-board-column").evaluateAll(els => els.map(el => el.dataset.groupKey));
    assert.ok(ids.indexOf("doing") < ids.indexOf("todo"));
    await persist(s => !savedView(s, "board").grouping.secondaryPropertyId && !savedView(s, "board").grouping.hiddenGroupKeys.includes("todo"));
    return { savedOrder: savedView(arranged, "board").grouping.order, visibleColumns: ids, removedSecondary: true };
  });

  await check("header-actions", "列菜单换行/移动、列尾统计与确认取消保护原字段", async () => {
    await nav("table");
    let menu = await propertyMenu("金额");
    const entries = await menu.evaluate(readControls);
    await menu.getByRole("menuitemcheckbox", { name: "换行显示" }).click();
    menu = await propertyMenu("金额");
    await menu.getByRole("menuitem", { name: "向右移动", exact: true }).click();
    const moved = await persist(s => savedView(s, "table").visiblePropertyIds[3] === "amount" && savedView(s, "table").config.table.wrapPropertyIds.includes("amount"));
    const statistic = button(db, "金额 统计");
    await statistic.click();
    const statMenu = page.getByRole("menu", { name: "金额 统计菜单", exact: true });
    const choices = await statMenu.evaluate(readControls);
    const sum = choices.find(entry => ["总和", "求和"].includes(entry.name));
    assert.ok(sum, JSON.stringify(choices));
    await statMenu.getByRole("menuitemradio", { name: sum.name }).click();
    await until(() => statistic.locator("strong").count().then(n => n === 1));
    const result = await statistic.locator("strong").innerText();
    const expected = projectRows(moved).reduce((total, row) => total + Number(row.values.amount || 0), 0);
    assert.equal(Number(result.replaceAll(",", "")), expected);
    menu = await propertyMenu("金额");
    await menu.getByRole("menuitem", { name: "删除属性", exact: true }).click();
    const confirmation = page.getByRole("alertdialog").or(modal(page, "删除属性"));
    await button(confirmation, "取消").click();
    assert.ok((await saved()).dataSources.find(source => source.id === "projects").properties.some(p => p.id === "amount"));
    return { entries, calculations: choices, movedIds: savedView(moved, "table").visiblePropertyIds.slice(0, 5), sum: expected, cancelledDeletion: "amount" };
  });

  await check("property-options", "状态字段新增选项、编辑内层颜色/分组、移除临时选项", async () => {
    await nav("table");
    const menu = await propertyMenu("状态");
    await menu.getByRole("menuitem", { name: "编辑属性…", exact: true }).click();
    const panel = modal(page, "编辑状态属性");
    await button(panel, "在待办添加选项").click();
    const field = label(panel, "待办新选项名称");
    await field.fill("验收临时状态");
    await field.press("Enter");
    await button(panel, "编辑选项 验收临时状态").click();
    const details = await panel.evaluate(readControls);
    await label(panel, "选项分组").selectOption("complete");
    await panel.locator('button[data-color="purple"]').click();
    const options = state => state.dataSources.find(source => source.id === "projects").properties.find(p => p.id === "status").options;
    const edited = await persist(s => options(s).some(option => option.name === "验收临时状态" && option.group === "complete" && option.color === "purple"));
    const option = options(edited).find(o => o.name === "验收临时状态");
    await button(panel, "删除选项").click();
    await page.keyboard.press("Escape");
    await persist(s => !options(s).some(o => o.id === option.id));
    return { details, option, final: "temporary option removed" };
  });

  await check("csv", "导入 CSV 的可见文件入口、预览、映射和落盘数据", async () => {
    await nav("table");
    let panel = await settings();
    await button(panel, "导入 CSV").click();
    let csv = modal(page, "导入 CSV");
    await button(csv, "取消").click();
    panel = await settings();
    await button(panel, "导入 CSV").click();
    csv = modal(page, "导入 CSV");
    const pending = page.waitForEvent("filechooser");
    await label(csv, "选择 CSV 文件").click();
    const chooser = await pending;
    await chooser.setFiles({ name: "走查.csv", mimeType: "text/csv", buffer: Buffer.from("名称,金额,忽略项\r\n隔离导入记录,171.5,额外内容\r\n", "utf8") });
    await label(csv, "文件编码").selectOption("utf-8");
    await label(csv, "第一行是表头").uncheck();
    await label(csv, "第一行是表头").check();
    await label(csv, "对应属性 名称").selectOption("title");
    await label(csv, "对应属性 金额").selectOption("amount");
    await label(csv, "对应属性 忽略项").selectOption("");
    const preview = await csv.locator(".db-csv-preview tbody tr").allInnerTexts();
    assert.equal(preview.length, 1);
    await button(csv, "导入 1 条记录").click();
    const status = await csv.getByRole("status").innerText();
    assert.ok(status.includes("已导入 1 条记录"));
    await button(csv, "完成").click();
    const state = await persist(s => projectRows(s).some(r => r.values.title === "隔离导入记录" && r.values.amount === 171.5));
    return { preview, status, row: projectRows(state).find(r => r.values.title === "隔离导入记录").values, selection: "visible file input, Playwright chooser supplies synthetic bytes" };
  });

  await check("record-layers", "记录预览标题、正文焦点、内部多选/日期编辑和完整页", async () => {
    await nav("gallery");
    const card = db.locator('[data-item-id="alpha"] .db-gallery-open');
    await card.press("Enter");
    const panel = peek();
    const title = label(panel, "记录标题");
    await confirmFocus(title);
    await title.press("Enter");
    const bodyFocus = await until(() => page.evaluate(() => document.activeElement?.closest(".bn-editor")?.className || false));
    await panel.locator('[data-property-id="labels"] summary').click();
    const options = panel.locator('[data-property-id="labels"]');
    await options.getByRole("checkbox", { name: "标签: 发布", exact: true }).check();
    await page.keyboard.press("Escape");
    const date = panel.locator('[data-property-id="date"]');
    await date.locator("summary").click();
    await date.getByRole("switch", { name: "日期 包含时间" }).check();
    await label(date, "日期 时区").fill("Asia/Shanghai");
    await label(date, "提醒 · 日期").selectOption("1h");
    await label(date, "日期 时区").press("Escape");
    const modified = await persist(s => rowById(s, "alpha").values.labels.includes("launch") && rowById(s, "alpha").values.date.timeZone === "Asia/Shanghai" && rowById(s, "alpha").values.date.reminder?.offset === "1h");
    await button(panel, "打开完整页面").click();
    assert.equal(await label(page, "页面标题").inputValue(), "Alpha 项目");
    await openDb();
    return { bodyFocus, values: { labels: rowById(modified, "alpha").values.labels, date: rowById(modified, "alpha").values.date }, returned: await db.getAttribute("data-source-id") };
  });

  for (const type of types) {
    await check("layout-" + type, "布局与下拉选项盘点和一次配置落盘 · " + type, async () => {
      await nav(type);
      const panel = await settings("布局");
      const controls = await panel.evaluate(readControls);
      const viewOf = state => savedView(state, type);
      let matches;
      if (type === "table" || type === "list") {
        const key = type === "table" ? "showDataSourceTitle" : "showPageIcon";
        await label(panel, type === "table" ? "显示数据源标题" : "显示页面图标").uncheck();
        matches = v => v.config[key] === false;
      } else if (type === "board") {
        await label(panel, "卡片内容换行").check();
        await label(panel, "按分组着色列").check();
        matches = v => v.config.board?.wrapAllContent && v.config.board.colorColumns;
      } else if (type === "gallery") {
        await button(panel, "画廊预览").click();
        await panel.getByRole("menuitemradio", { name: "附件属性" }).click();
        await button(panel, "画廊附件属性").click();
        await panel.getByRole("menuitemradio", { name: "附件", exact: true }).click();
        await button(panel, "画廊卡片大小").click();
        await panel.getByRole("menuitemradio", { name: "小", exact: true }).click();
        matches = v => v.config.gallery?.preview?.propertyId === "files" && v.config.gallery.cardSize === "small";
      } else if (type === "calendar") {
        await label(panel, "日历模式").selectOption("week");
        await label(panel, "日历每周开始日").selectOption("0");
        await label(panel, "显示周末").uncheck();
        matches = v => v.config.calendar?.mode === "week" && v.config.calendar.startOfWeek === 0 && v.config.calendar.showWeekends === false;
      } else if (type === "timeline") {
        await label(panel, "时间线设置比例").selectOption("quarter");
        await label(panel, "时间线窗口开始").fill("2026-09-01");
        await label(panel, "时间线窗口结束").fill("2026-12-01");
        matches = v => v.config.timeline?.scale === "quarter" && v.config.timeline.windowEnd === "2026-12-01";
      } else if (type === "chart") {
        await label(panel, "图表类型").selectOption("donut");
        await label(panel, "图表聚合").selectOption("average");
        await label(panel, "图表分组").selectOption("status");
        matches = v => v.config.chart?.kind === "donut" && v.config.chart.aggregation === "average" && v.config.chart.groupPropertyId === "status";
      } else if (type === "form") {
        await label(panel, "提交成功提示").fill("走查表单已提交");
        await label(panel, "匿名记录提交者").check();
        await label(panel, "说明 必填").check();
        await button(panel, "上移 说明").click();
        matches = v => v.config.form?.anonymous && v.config.form.successMessage === "走查表单已提交" && v.config.form.fields.find(f => f.propertyId === "notes")?.required;
      } else if (type === "dashboard") {
        await button(panel, "＋ 列表").click();
        const groups = panel.locator("details.db-widget-setting");
        const count = await groups.count();
        await groups.last().locator("summary").click();
        await label(panel, "组件 " + count + " 标题").fill("走查仪表盘列表");
        await label(panel, "组件 " + count + " 宽度").selectOption("small");
        await label(panel, "组件 " + count + " 记录数").fill("5");
        await button(panel, "上移组件 " + count).click();
        matches = v => v.config.dashboard?.widgets?.[count - 2]?.title === "走查仪表盘列表" && v.config.dashboard.widgets[count - 2].limit === 5;
      } else if (type === "map") {
        await label(panel, "地图地点属性").selectOption("place");
        await label(panel, "地图标记名称").selectOption("notes");
        matches = v => v.config.map?.placePropertyId === "place" && v.config.map.labelPropertyId === "notes";
      } else {
        await label(panel, "时间脉络密度").selectOption("compact");
        await label(panel, "时间脉络刻度").selectOption("month");
        await label(panel, "时间脉络颜色属性").selectOption("status");
        matches = v => v.config.roadmap?.density === "compact" && v.config.roadmap.colorPropertyId === "status" && v.config.roadmap.scale === "month";
      }
      await closeSettings();
      const state = await persist(s => matches(viewOf(s)));
      await frame();
      return { controls, persisted: viewOf(state).config, renderedSurface: await db.locator(".db-view-body").evaluate(node => node.firstElementChild?.className) };
    });
  }
}

export async function databaseRepairPaths({ page, db, check, nav, frame, until, persist, saved, file }) {
  await check("repair-side", "侧窗外可看见并直接点击来源数据库控件", async () => {
    await nav("board");
    const card = db.locator('.db-board-card[data-item-id="alpha"]');
    await card.hover();
    await card.locator(".db-board-move-menu").click();
    await button(modal(page, "卡片操作"), "在侧边预览中打开").click();
    const side = page.getByRole("region", { name: "记录侧边预览", exact: true });
    await side.waitFor();
    const geometry = await db.evaluate(root => {
      const pane = document.querySelector('.record-peek.is-side').getBoundingClientRect();
      const records = [...root.querySelectorAll(".db-board-card-open, .db-navigation-row button[role=tab]")];
      const exposed = [];
      for (const element of records) {
        const rect = element.getBoundingClientRect();
        const left = Math.max(0, rect.left), right = Math.min(pane.left, rect.right);
        const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
        if (right - left < 16 || bottom - top < 12) continue;
        const x = (left + right) / 2, y = (top + bottom) / 2;
        if (element.contains(document.elementFromPoint(x, y))) {
          const copy = element.cloneNode(true);
          copy.querySelectorAll('[aria-hidden="true"]').forEach(child => child.remove());
          exposed.push({ x, y, title: copy.textContent.trim(), role: element.getAttribute("role") });
        }
      }
      return { viewport: [innerWidth, innerHeight], pane: { x: pane.x, width: pane.width }, exposed };
    });
    await page.screenshot({path: file("repair-side-open-" + geometry.viewport[0]), animations: "disabled"});
    assert.ok(geometry.exposed.length, JSON.stringify(geometry));
    const target = geometry.exposed[0];
    await page.mouse.click(target.x, target.y);
    await side.waitFor({ state: "detached" });
    if (target.role === "tab") {
      assert.equal(await db.getByRole("tab", { selected: true }).innerText(), target.title);
    } else {
      const record = modal(page, "记录预览");
      await record.waitFor();
      assert.equal(await label(record, "记录标题").inputValue(), target.title);
      await button(record, "关闭预览").click();
    }
    return geometry;
  });

  await check("repair-calendar", "紧凑月历标题获得两字宽空间且截断时可发现全名", async () => {
    await nav("calendar");
    const records = db.locator(".db-calendar-record");
    const observed = [];
    for (const record of await records.all()) {
      await record.scrollIntoViewIfNeeded();
      await page.mouse.move(1, 1);
      const geometry = await record.evaluate(node => {
        const text = node.querySelector(".db-calendar-record-title");
        const font = getComputedStyle(text);
        const canvas = document.createElement("canvas").getContext("2d");
        canvas.font = font.font || [font.fontSize, font.fontFamily].join(" ");
        return { title: text.textContent, visible: text.clientWidth, desired: canvas.measureText(text.textContent).width,
          twoCharacters: canvas.measureText("北城").width, clipped: text.scrollWidth > text.clientWidth + 1 || text.scrollHeight > text.clientHeight + 1 };
      });
      assert.ok(geometry.visible + 1 >= Math.min(geometry.desired, geometry.twoCharacters), JSON.stringify(geometry));
      if (geometry.clipped) {
        await record.hover();
        await until(() => record.evaluate((node, title) => {
          const expanded = node.querySelector(".db-calendar-record-title");
          return expanded.scrollWidth <= expanded.clientWidth + 1 && expanded.scrollHeight <= expanded.clientHeight + 1
            || [node, ...node.querySelectorAll("[title]"), node.closest("[title]")].some(el => el?.getAttribute("title") === title)
            || [...document.querySelectorAll('[role="tooltip"]')].some(el => el.getClientRects().length && el.textContent.includes(title));
        }, geometry.title), "悬停时无法获得完整日历记录名称：" + geometry.title);
      }
      await record.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await until(() => record.evaluate(node => document.activeElement === node));
      assert.equal(await db.getByRole("button", { name: geometry.title, exact: true }).count(), 1);
      const focusText = await record.locator(".db-calendar-record-title").evaluate(el => ({ width: el.clientWidth, height: el.clientHeight, fullHeight: el.scrollHeight }));
      assert.ok(focusText.height + 1 >= focusText.fullHeight, JSON.stringify({ geometry, focusText }));
      geometry.focused = focusText;
      observed.push(geometry);
    }
    assert.ok(observed.length >= 3);
    const alpha = db.locator(".db-calendar-chip").filter({ has: page.getByRole("button", { name: "Alpha 项目", exact: true }) });
    const picker = alpha.locator(".db-date-picker");
    const trigger = picker.locator("summary");
    await alpha.hover();
    await trigger.click();
    const startField = label(picker, "移动 Alpha 项目 开始");
    const initial = rowById(await saved(), "alpha").values.date;
    assert.equal(await startField.inputValue(), initial.start);
    await startField.press("Escape");
    await until(() => trigger.evaluate(el => document.activeElement === el && !el.parentElement.open));
    await trigger.press("Enter");
    await startField.waitFor();
    const width = await page.evaluate(() => innerWidth);
    await page.screenshot({path: file("repair-calendar-picker-" + width), animations: "disabled"});
    const changed = initial.start === "2026-09-22" ? "2026-09-18" : "2026-09-22";
    await button(picker, changed).click();
    const moved = await persist(s => rowById(s, "alpha").values.date.start === changed);
    const dateCell = db.locator('.db-calendar-cell[data-date="' + initial.start + '"]');
    await alpha.dragTo(dateCell, {targetPosition: {x: 13, y: 13}});
    const restored = await persist(s => rowById(s, "alpha").values.date.start === initial.start);
    assert.deepEqual(rowById(restored, "alpha").values.date, initial);
    return { observed, keyboardCheck: "focused full title, pointer and keyboard date picker", initial, moved: rowById(moved, "alpha").values.date, restored: rowById(restored, "alpha").values.date };
  });

  await check("repair-scroll", "标准页与整页首屏均能用鼠标来回水平滚动", async () => {
    await nav("table");
    const table = db.locator(".db-table-scroll");
    const result = [];
    for (const mode of ["所在页面", "数据库整页"]) {
      if (mode === "数据库整页") {
        await button(db, "以整页打开").click();
        await page.getByRole("article", { name: "数据库整页" }).waitFor();
      }
      const toolbar = db.locator(".db-navigation-row");
      await toolbar.scrollIntoViewIfNeeded();
      const point = await toolbar.boundingBox();
      await page.mouse.move(point.x + 12, point.y + point.height / 2);
      await page.mouse.wheel(0, -4000);
      await until(() => toolbar.evaluate(el => (el.closest(".workspace-scroll")?.scrollTop || 0) <= 1));
      await frame();
      const position = () => table.evaluate(el => ({ x: el.scrollLeft, y: el.closest(".workspace-scroll")?.scrollTop || 0 }));
      const hit = name => db.evaluate((root, accessibleName) => {
        const controls = [...root.querySelectorAll("button")].filter(b => b.getAttribute("aria-label") === accessibleName);
        for (const el of controls) {
          const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
          if (!el.disabled && el.contains(document.elementFromPoint(x, y))) return { x, y };
        }
        return null;
      }, name);
      const before = await position();
      const right = await hit("向右查看更多属性");
      assert.ok(right, mode + "首屏无可点击的向右滚动按钮");
      const width = await page.evaluate(() => innerWidth);
      await page.screenshot({path: file("repair-scroll-" + mode + "-" + width), animations: "disabled"});
      await page.mouse.click(right.x, right.y);
      const after = await until(async () => { const p = await position(); return p.x > before.x && p; });
      assert.ok(Math.abs(after.y - before.y) <= 2, JSON.stringify({ before, after }));
      const left = await hit("向左查看更多属性");
      assert.ok(left, mode + "向右后没有可点击的向左按钮");
      await page.mouse.click(left.x, left.y);
      await until(async () => Math.abs((await position()).x - before.x) <= 2);
      result.push({ mode, before, after, restored: await position(), right, left });
      if (mode === "数据库整页") await button(page, "返回所在页面").click();
    }
    return result;
  });
}
