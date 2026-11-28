import { answerProductDialog, browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

const workspace = coreParityWorkspace();
const doc = workspace.pages.find((page) => page.id === "editor-page");
const database = workspace.pages.find((page) => page.id === "database-page");
const locked = workspace.pages.find((page) => page.id === "gamma-page");
doc.cover = { kind: "gallery", value: "degas-landscape", position: 50 };
doc.settings.fullWidth = true;
doc.content = [
  { id: "layout", type: "columnList", props: { columns: 2 }, children: [
    { id: "left", type: "column", props: { width: 50, index: 0, count: 2 }, children: [
      { id: "embedded-board", type: "databaseView", props: { sourceId: "projects", viewId: "view-board" } },
    ] },
    { id: "right", type: "column", props: { width: 50, index: 1, count: 2 }, children: [
      { id: "other-column", type: "paragraph", content: "另一栏始终可见" },
    ] },
  ] },
];
database.databaseViewId = "view-board";
locked.settings.locked = true;
locked.cover = { ...doc.cover, position: 25 };
const board = workspace.databaseViews.find((entry) => entry.id === "view-board");
board.visiblePropertyIds = ["notes"];
board.config = { ...board.config, openRecordsIn: "peek" };
workspace.dataSources[0].properties.find((p) => p.id === "status").options.find((o) => o.id === "doing").name = "🟢 进行中";
workspace.ui.selectedPageId = doc.id;
workspace.ui.preferences = { style: "mobai", theme: "system" };

await browserScenario("page-cover-board-actions", async ({ page, assert, check, screenshot, persisted, saved }) => {
  const navigate = (id) => page.getByRole("complementary", { name: "主导航" }).locator('[data-node-id="' + id + '"]').click();
  const cover = page.locator(".page-cover");
  const adjust = cover.getByRole("button", { name: "调整位置", exact: true });
  const slider = cover.getByRole("slider", { name: "封面垂直位置" });
  const getCover = (state) => state.pages.find((p) => p.id === doc.id).cover;
  const openCover = async () => { await cover.hover(); await adjust.click(); await slider.waitFor(); };
  const focusIs = (locator) => locator.evaluate((element) => element === document.activeElement);
  const card = (id) => page.locator('.db-board-card[data-item-id="' + id + '"]');
  await navigate(doc.id);

  await check("Cover drag previews immediately and Escape restores the saved image position", async () => {
    await openCover();
    await cover.locator("img").evaluate((img) => img.decode());
    const bounds = await slider.boundingBox();
    const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 42, { steps: 6 });
    await page.mouse.up();
    const value = Number(await slider.getAttribute("aria-valuenow"));
    assert.ok(value >= 0 && value < 50);
    assert.equal(getCover(await saved()).position, 50);
    await slider.press("Escape");
    await slider.waitFor({ state: "detached" });
    assert.match(await cover.evaluate((el) => el.style.backgroundPosition), /50%$/);
    assert.equal(await focusIs(adjust), true);
  });

  await check("Cover keyboard and Save persist both the zero boundary and an adjusted position after reload", async () => {
    await openCover();
    await slider.press("Home");
    await slider.press("Enter");
    await persisted((state) => getCover(state).position === 0);
    await page.reload();
    await cover.waitFor();
    assert.match(await cover.evaluate((el) => el.style.backgroundPosition), / 0%$/);
    await openCover();
    await slider.press("ArrowUp");
    await slider.press("Shift+ArrowUp");
    assert.equal(Number(await slider.getAttribute("aria-valuenow")), 11);
    await screenshot("cover-reposition");
    await cover.getByRole("button", { name: "保存位置", exact: true }).click();
    const state = await persisted((snapshot) => getCover(snapshot).position === 11);
    assert.deepEqual(getCover(state), { ...doc.cover, position: 11 });
  });

  await check("An embedded Board scrolls internally, reveals both ends and preserves the neighbouring column", async () => {
    const strip = page.locator(".db-board-view");
    await strip.scrollIntoViewIfNeeded();
    const size = await strip.evaluate((el) => ({ width: el.clientWidth, full: el.scrollWidth }));
    assert.ok(size.full > size.width);
    const frame = page.locator(".db-board-scroll-frame");
    await page.waitForFunction(() => document.querySelector(".db-board-scroll-frame")?.dataset.overflowEnd === "true");
    assert.equal(await frame.getAttribute("data-overflow-start"), "false");
    const right = page.getByText("另一栏始终可见", { exact: true });
    const before = await right.boundingBox();
    await strip.evaluate((el) => el.scrollTo({ left: el.scrollWidth, behavior: "instant" }));
    await page.waitForFunction(() => document.querySelector(".db-board-scroll-frame")?.dataset.overflowEnd === "false");
    assert.equal(await frame.getAttribute("data-overflow-start"), "true");
    assert.equal((await right.boundingBox()).x, before.x);
    await strip.evaluate((el) => el.scrollTo({ left: 0, behavior: "instant" }));
  });

  await navigate(database.id);
  const alpha = card("alpha");
  const pencil = alpha.getByRole("button", { name: /^编辑标题 / });
  const menu = alpha.getByRole("button", { name: /记录操作$/ });
  const title = alpha.getByRole("textbox", { name: "记录标题" });
  const openMenu = async () => { await alpha.hover(); await menu.click(); };
  await check("Board headers stay compact, card tools appear on hover, and Escape cancels inline rename", async () => {
    const tag = page.locator('.db-board-column[data-group-key="doing"] > header .db-status-tag');
    assert.equal(await tag.evaluate((el) => getComputedStyle(el).fontSize), "12px");
    assert.equal(await tag.locator("i:visible").count(), 0);
    await alpha.hover();
    assert.equal(await pencil.isVisible(), true);
    assert.equal(await pencil.evaluate((el) => getComputedStyle(el.parentElement).opacity), "1");
    await screenshot("board-tools");
    await pencil.click();
    await title.fill("放弃这个草稿");
    await title.press("Escape");
    await title.waitFor({ state: "detached" });
    assert.equal(await alpha.getByRole("button", { name: "Alpha 项目", exact: true }).count(), 1);
    assert.equal(await focusIs(pencil), true);
    assert.equal(await card("gamma").getByRole("button", { name: /^编辑标题 / }).count(), 0);
  });
  await check("Enter updates the canonical item and its record page, preserving the other fields", async () => {
    const old = (await saved()).databaseItems.find((item) => item.id === "alpha");
    await pencil.click();
    await title.fill("新的记录标题");
    await title.press("Enter");
    const state = await persisted((s) => s.pages.find((p) => p.id === "alpha-page").title === "新的记录标题");
    assert.deepEqual(state.databaseItems.find((i) => i.id === "alpha").values, { ...old.values, title: "新的记录标题" });
  });
  await check("Card menu closes with Escape, opens an explicit side preview and moves the record", async () => {
    await openMenu();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "卡片操作" }).waitFor({ state: "detached" });
    assert.equal(await focusIs(menu), true);
    await openMenu();
    await page.getByRole("button", { name: "在侧边预览中打开", exact: true }).click();
    const preview = page.locator(".record-peek.is-side");
    await preview.waitFor();
    assert.equal(await preview.getByRole("textbox", { name: "记录标题" }).inputValue(), "新的记录标题");
    await page.keyboard.press("Escape");
    await preview.waitFor({ state: "detached" });
    assert.equal(await focusIs(menu), true);
    await openMenu();
    await page.getByRole("combobox", { name: "移动 新的记录标题 到分组" }).selectOption("todo");
    await persisted((s) => s.databaseItems.find((i) => i.id === "alpha").values.status === "todo");
    assert.equal(await page.locator('.db-board-column[data-group-key="todo"]').locator('[data-item-id="alpha"]').count(), 1);
  });
  await check("Duplicate makes a separate record and deletion uses the existing reversible trash action", async () => {
    const prior = new Set((await saved()).databaseItems.map((item) => item.id));
    await openMenu();
    await page.getByRole("button", { name: "复制记录", exact: true }).click();
    const state = await persisted((s) => s.databaseItems.some((i) => !prior.has(i.id)));
    const duplicate = state.databaseItems.find((i) => !prior.has(i.id));
    assert.notEqual(duplicate.pageId, "alpha-page");
    assert.equal(duplicate.values.status, "todo");
    const copiedCard = card(duplicate.id);
    await copiedCard.hover();
    await copiedCard.getByRole("button", { name: /记录操作$/ }).click();
    await page.getByRole("button", { name: "移到回收站", exact: true }).click();
    await answerProductDialog(page);
    const after = await persisted((s) => Boolean(s.pages.find((p) => p.id === duplicate.pageId)?.trashedAt));
    assert.equal(Boolean(after.pages.find((p) => p.id === "alpha-page").trashedAt), false);
  });
}, { workspace, viewport: { width: 1440, height: 900 } });
