import { browserScenario, shootBothModes } from "./harness.mjs";
import { fullWorkspace } from "../fixtures/full-workspace.mjs";
import { assertSavedViewsAndLayouts } from "./database-navigation.mjs";

await browserScenario("wp20-refinements", async ({ page, check, screenshot, persisted, assert }) => {
  const openPage = async (id) => {
    await page.locator(`.workspace-sidebar .page-tree-row[data-node-id="${id}"]`).click();
    await page.locator(".page-document > .life-editor .bn-editor").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
  };
  const documentWidths = () => page.locator(".page-document").evaluate((element) => {
    const editor = element.querySelector(".bn-editor");
    const style = getComputedStyle(editor);
    return [element.querySelector(":scope > .page-document-header").getBoundingClientRect().width,
      element.querySelector(".life-editor").getBoundingClientRect().width,
      editor.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)];
  });
  const setPresentation = async (name) => {
    await page.getByRole("button", { name: "页面操作", exact: true }).click();
    await page.getByRole("menuitem", { name, exact: true }).click();
    await page.keyboard.press("Escape");
  };

  await check("Ordinary document content uses the specified responsive reading width", async () => {
    await openPage("p-a1");
    assert.deepEqual(await documentWidths(), [708, 708, 708]);
    await page.setViewportSize({ width: 1080, height: 900 });
    assert.deepEqual(await documentWidths(), [680, 680, 680]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await check("Full width remains optional and returning to default restores 708 pixels", async () => {
    await setPresentation("全宽");
    await persisted((workspace) => workspace.pages.find((entry) => entry.id === "p-a1").settings.fullWidth);
    assert.ok((await documentWidths()).every((width) => width > 708));
    await setPresentation("默认宽");
    await persisted((workspace) => !workspace.pages.find((entry) => entry.id === "p-a1").settings.fullWidth);
    assert.deepEqual(await documentWidths(), [708, 708, 708]);
    await shootBothModes(page, screenshot, "reading-column");
  });

  await check("Inline table overflow and all eleven view tabs stay discoverable and keyboard reachable", async () => {
    await openPage("p-b1");
    const database = page.locator('.database-view[data-source-id="ds-inline"]');
    const scroller = database.locator(".db-table-scroll");
    await scroller.waitFor();
    await assertSavedViewsAndLayouts(database, fullWorkspace(), "ds-inline", assert);
    assert.equal(await database.locator(".db-view-tabs").evaluate((element) => getComputedStyle(element).flexWrap), "nowrap");
    assert.equal(await scroller.evaluate((element) => getComputedStyle(element).scrollbarWidth), "auto");
    assert.ok(await scroller.evaluate((element) => element.scrollWidth > element.clientWidth));
    const scrollRight = database.getByRole("button", { name: "向右查看更多属性", exact: true });
    const scrollLeft = database.getByRole("button", { name: "向左查看更多属性", exact: true });
    assert.equal(await scrollRight.isEnabled(), true);
    assert.equal(await scrollLeft.isEnabled(), false);
    const cells = database.locator("tbody tr[data-item-id]").first().locator("td[data-property-id]");
    const properties = await cells.evaluateAll((elements) => elements.map((element) => element.dataset.propertyId));
    await cells.first().focus();
    for (const property of properties.slice(1)) {
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction((propertyId) => document.activeElement?.dataset.propertyId === propertyId, property);
    }
    assert.ok(await scroller.evaluate((element) => element.scrollLeft > 0));
    const visibility = await cells.last().evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const viewport = element.closest(".db-table-scroll").getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, viewportLeft: viewport.left, viewportRight: viewport.right,
        visible: bounds.left >= viewport.left - 1 && bounds.right <= viewport.right + 1 };
    });
    assert.equal(visibility.visible, true, JSON.stringify(visibility));
    await shootBothModes(page, screenshot, "inline-right-edge");
    await scrollLeft.click();
    await scrollLeft.click();
    await page.waitForFunction(() => document.querySelector('.database-view[data-source-id="ds-inline"] .db-table-scroll').scrollLeft === 0);
    assert.equal(await scrollLeft.isEnabled(), false);
    await page.locator(".page-title-input").focus();
    await shootBothModes(page, screenshot, "inline-scrollbar");
  });

  await check("Trash retention and deletion information remain readable in both modes", async () => {
    await page.getByRole("complementary", { name: "主导航" }).getByRole("button", { name: /回收站/ }).click();
    for (const mode of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, mode);
      const measurements = await page.evaluate(() => {
        const luminance = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number).map((channel) => value.startsWith("color(srgb ") ? channel : channel / 255)
          .map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
          .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
        const background = luminance(getComputedStyle(document.querySelector(".workspace-scroll")).backgroundColor);
        return [".trash-eyebrow", ".trash-header p", ".trash-row-copy span", ".trash-row-copy small", ".trash-restore-button", ".trash-delete-button", ".trash-empty-button"].map((selector) => {
          const style = getComputedStyle(document.querySelector(selector));
          const foreground = luminance(style.color);
          return { selector, fontSize: parseFloat(style.fontSize), contrast: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) };
        });
      });
      for (const item of measurements) {
        assert.ok(item.fontSize >= 12, `${mode} ${item.selector} is at least 12px`);
        assert.ok(item.contrast >= 4.5, `${mode} ${item.selector} reaches 4.5:1, got ${item.contrast}`);
      }
      await screenshot(`trash-readable-${mode}`);
    }
  });
}, { workspace: fullWorkspace(), now: "2026-10-02T08:00:00.000Z", viewport: { width: 1440, height: 900 } });
