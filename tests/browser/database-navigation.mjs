const layoutTypes = ["table", "board", "list", "gallery", "calendar", "timeline", "chart", "form", "dashboard", "map", "roadmap"];
const layoutLabels = { table: "表格", board: "看板", list: "列表", gallery: "画廊", calendar: "日历", timeline: "时间线", chart: "图表", form: "表单", dashboard: "仪表盘", map: "地图", roadmap: "时间脉络" };

export function viewSettingsPanel(database) {
  return database.page().getByRole("dialog", { name: "视图设置", exact: true });
}

export async function openViewSettingsSection(database, section) {
  await setViewSettings(database, true);
  const panel = viewSettingsPanel(database);
  const back = panel.getByRole("button", { name: "返回上一级", exact: true });
  while (await back.count()) await back.click();
  if (section) {
    const hasValue = ["布局", "显示属性", "数据源"].includes(section);
    await panel.getByRole("button", { name: hasValue ? new RegExp(`^${section}(?:\\s|$)`) : section, exact: !hasValue }).click();
  }
  return panel;
}

export async function setViewSettings(database, open) {
  if (!open) {
    const panel = viewSettingsPanel(database);
    if (await panel.count()) await panel.getByRole("button", { name: "关闭视图设置", exact: true }).click();
    return;
  }
  const button = database.getByRole("button", { name: "视图设置", exact: true });
  const expanded = await button.getAttribute("aria-expanded") === "true";
  if (expanded === open) return;
  await button.click();
}

export async function chooseSavedView(database, id) {
  const tab = database.locator(`[role="tab"][data-view-id=${JSON.stringify(id)}]`);
  if (await tab.count()) await tab.click();
  else {
    await database.getByRole("button", { name: /^更多\d+个…$/ }).click();
    await database.page().getByRole("dialog", { name: /^全部视图：/ }).locator(`[role="menuitemradio"][data-view-id=${JSON.stringify(id)}]`).click();
  }
}

export async function changeLayout(database, type) {
  const panel = await openViewSettingsSection(database, "布局");
  await panel.getByRole("button", { name: `布局 ${layoutLabels[type]}`, exact: true }).click();
  await setViewSettings(database, false);
}

export async function copyCurrentView(database) {
  const panel = await openViewSettingsSection(database);
  await panel.getByRole("button", { name: "复制当前视图", exact: true }).click();
}

export async function assertSavedViewsAndLayouts(database, fixture, sourceId, assert) {
  const expected = fixture.databaseViews.filter((view) => view.sourceId === sourceId).map((view) => view.id).sort();
  const more = database.getByRole("button", { name: /^更多\d+个…$/ });
  const overflow = await more.count() > 0;
  if (overflow) await more.click();
  const views = overflow ? database.page().getByRole("dialog", { name: /^全部视图：/ }).getByRole("menuitemradio") : database.getByRole("tab");
  assert.equal(await views.count(), expected.length);
  assert.deepEqual((await views.evaluateAll((elements) => elements.map((element) => element.dataset.viewId))).sort(), expected);
  if (overflow) await database.page().keyboard.press("Escape");
  const original = await database.getAttribute("data-view-type");
  const panel = await openViewSettingsSection(database, "布局");
  const options = await panel.locator("button[data-view-type]").evaluateAll((elements) => elements.map((element) => element.dataset.viewType));
  assert.deepEqual([...options].sort(), [...layoutTypes].sort());
  await panel.locator("button[data-view-type]").first().focus();
  await panel.locator("button[data-view-type]").first().press("Home");
  assert.equal(await panel.locator("button[data-view-type][aria-pressed=true]").getAttribute("data-view-type"), options[0]);
  assert.equal(await database.getAttribute("data-view-type"), options[0]);
  for (const type of options.slice(1)) {
    await database.page().keyboard.press("ArrowRight");
    assert.equal(await panel.locator("button[data-view-type][aria-pressed=true]").getAttribute("data-view-type"), type);
    assert.equal(await database.getAttribute("data-view-type"), type);
  }
  await panel.getByRole("button", { name: `布局 ${layoutLabels[original]}`, exact: true }).click();
  await setViewSettings(database, false);
}
