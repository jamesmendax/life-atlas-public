import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

const workspace = coreParityWorkspace();
workspace.ui.selectedPageId = "editor-page";
workspace.ui.preferences = { style: "mobai", theme: "system" };
workspace.pages.find((p) => p.id === "editor-page").content = ["sync-a", "sync-b"].map((id) => ({
  id, type: "syncedBlock", props: { sourceId: "shared-source" },
}));
workspace.syncedSources[0].blocks = [
  { id: "shared-first", type: "paragraph", content: "共享第一行" },
  { id: "shared-second", type: "paragraph", content: "共享第二行" },
];

await browserScenario("compact-synced-source", async ({ page, check, assert, persisted }) => {
  await page.getByRole("complementary", { name: "主导航" }).locator('[data-node-id="editor-page"]').click();
  const sources = page.locator('.life-synced-source[data-source-id="shared-source"]');
  const first = sources.first();
  const trigger = first.locator('summary[aria-label="同步内容操作"]');
  await check("Compact references retain enough room for two lines in both themes", async () => {
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme });
      await page.waitForFunction((v) => document.documentElement.dataset.theme === v, colorScheme);
      await page.mouse.move(0, 0);
      assert.ok((await first.boundingBox()).height <= 72);
      assert.equal(await first.evaluate((el) => getComputedStyle(el).boxShadow), "none");
      assert.equal(await first.locator("header").evaluate((el) => getComputedStyle(el).position), "absolute");
    }
  });
  await check("Keyboard and pointer expose the floating action menu without growing the source", async () => {
    const initial = (await first.boundingBox()).height;
    await first.hover();
    await trigger.focus();
    await trigger.press("Enter");
    const add = first.getByRole("button", { name: "在下方添加引用" });
    assert.equal(await add.isVisible(), true);
    assert.ok(Math.abs((await first.boundingBox()).height - initial) < 1);
    await page.keyboard.press("Escape");
    assert.equal(await first.locator("details").getAttribute("open"), null);
    await trigger.click();
    await add.click();
    await page.waitForFunction(() => document.querySelectorAll(".life-synced-source").length === 3);
  });
  await check("A reference edit is shared and an unsynced local copy no longer follows the source", async () => {
    const edit = first.locator(".bn-editor [data-content-type=paragraph]").first();
    await edit.click();
    await page.keyboard.press("End");
    await page.keyboard.insertText("：已同步");
    await persisted((s) => JSON.stringify(s.syncedSources[0].blocks).includes("已同步"));
    await page.waitForFunction(() => [...document.querySelectorAll(".life-synced-source")].every((el) => el.textContent.includes("已同步")));
    await first.hover();
    await trigger.click();
    await first.getByRole("button", { name: "取消同步并保留副本" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".life-synced-source").length === 2);
    const state = await persisted((s) => s.pages.find((p) => p.id === "editor-page").content.filter((b) => b.type === "syncedBlock").length === 2);
    assert.ok(JSON.stringify(state.pages.find((p) => p.id === "editor-page").content.filter((b) => b.type !== "syncedBlock")).includes("已同步"));
  });
}, { workspace, viewport: { width: 1440, height: 900 } });
