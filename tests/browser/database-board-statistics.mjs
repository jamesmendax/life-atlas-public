import { boardStatisticsWorkspace } from "../fixtures/board-statistics-workspace.mjs";
import { browserScenario } from "./harness.mjs";

const { workspace, view } = boardStatisticsWorkspace();
await browserScenario("database-board-statistics", async ({ page, check, assert, persisted, screenshot }) => {
  const db = page.locator('.database-view[data-source-id="projects"][data-view-type="board"]');
  const column = key => db.locator(`.db-board-column[data-group-key="${key}"]`);
  const count = key => column(key).locator(":scope > header > .db-board-column-stat");
  const lane = (key, sub) => column(key).locator(`.db-board-lane[data-subgroup-key="${sub}"]`);
  const laneStat = (key, sub) => lane(key, sub).locator("h4 .db-board-column-stat");
  const trigger = db.getByLabel("进行中 分组菜单", { exact: true });
  const dialog = page.getByRole("dialog", { name: "列统计", exact: true });
  const property = dialog.getByRole("combobox", { name: /^统计属性/ });
  const method = dialog.getByRole("combobox", { name: /^统计方法/ });
  const settings = saved => saved.databaseViews.find(entry => entry.id === view.id).config.board;
  const editStat = async () => {
    await trigger.press("Enter");
    await column("doing").getByRole("button", { name: "列统计…", exact: true }).press("Enter");
    await dialog.waitFor();
  };
  const apply = async () => {
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
  };

  await check("Board statistics settings are reachable by keyboard and preserve the other saved board settings", async () => {
    await count("doing").waitFor();
    assert.equal(await count("doing").innerText(), "2");
    assert.equal(await laneStat("doing", "launch").innerText(), "2");
    await editStat();
    assert.equal(await property.evaluate(control => control === document.activeElement), true);
    await property.selectOption("amount");
    assert.equal(await method.inputValue(), "sum");
    await method.selectOption("average");
    await screenshot("settings");
    await apply();
    const saved = await persisted(value => settings(value)?.columnStatistic?.calculation === "average");
    assert.equal(settings(saved).colorColumns, true);
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
    assert.equal(await count("doing").innerText(), "¥2.00");

    await editStat();
    await method.selectOption("max");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(await count("doing").innerText(), "¥2.00");
    await editStat();
    assert.equal(await method.inputValue(), "average");
    await method.selectOption("sum");
    await apply();
    await persisted(value => settings(value)?.columnStatistic?.calculation === "sum");
  });

  await check("Currency totals, zero and empty value survive reload and follow view search", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await count("doing").waitFor();
    assert.equal(await count("doing").innerText(), "¥4.00");
    assert.equal(await count("todo").innerText(), "¥0.00");
    assert.equal(await count("done").innerText(), "—");
    assert.equal(await laneStat("doing", "design").innerText(), "¥12.00");
    assert.equal(await laneStat("doing", "launch").innerText(), "¥4.00");
    await db.getByRole("button", { name: "搜索此视图", exact: true }).click();
    const search = db.getByLabel("在此视图中搜索", { exact: true });
    await search.fill("Alpha 项目");
    await column("doing").getByText("¥12.00", { exact: true }).first().waitFor();
    assert.equal(await count("doing").innerText(), "¥12.00");
    assert.equal(await count("todo").innerText(), "—");
    await search.fill("");
    await screenshot("totals");
  });

  await check("Pointer drag recomputes both the source and destination column and lane", async () => {
    const handle = lane("doing", "launch").getByRole("button", { name: "拖动 印量调整 到其他分组", exact: true });
    const destination = lane("todo", "design").locator("h4");
    await handle.scrollIntoViewIfNeeded();
    const from = await handle.boundingBox(), to = await destination.boundingBox();
    assert.ok(from && to);
    const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 9 });
    await page.mouse.up();
    await persisted(value => {
      const moved = value.databaseItems.find(item => item.id === "adjustment").values;
      return moved.status === "todo" && JSON.stringify(moved.labels) === '["design"]';
    });
    assert.equal(await count("doing").innerText(), "¥12.00");
    assert.equal(await count("todo").innerText(), "-¥8.00");
    assert.equal(await laneStat("todo", "design").innerText(), "-¥8.00");
    assert.equal(await laneStat("doing", "launch").innerText(), "¥12.00");
  });

  await check("A locked page retains visible statistics and removes their editing entry", async () => {
    await page.getByRole("button", { name: "页面操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "锁定页面", exact: true }).click();
    await persisted(value => value.pages.find(page => page.id === "database-page").settings.locked);
    assert.equal(await count("doing").innerText(), "¥12.00");
    assert.equal(await trigger.count(), 0);
  });
}, { workspace, viewport: { width: 1440, height: 1040 } });
