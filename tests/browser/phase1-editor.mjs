import { readFileSync } from "node:fs";
import { answerProductDialog, browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { walkBlocks } from "../../src/domain/blockDocument.js";

const workspace = coreParityWorkspace();
workspace.ui.selectedPageId = "editor-page";
await browserScenario("phase1-editor", async ({ page, check, screenshot, saved, persisted, assert }) => {
  const header = () => page.locator(".life-tabs-header").first();
  const tab = (name) => header().getByRole("tab", { name, exact: true });
  const menuAction = async (name) => {
    const details = header().locator(".life-tab-menu");
    if (!await details.getAttribute("open").then((value) => value !== null)) await details.locator("summary").click();
    await details.getByRole("button", { name, exact: true }).click();
    if (name === "删除当前标签") await answerProductDialog(page, { optional: true });
  };
  const block = (id) => page.locator(`[data-id="${id}"] .bn-block-content`).first();
  const current = (value) => value.pages.find((entry) => entry.id === "editor-page");
  const sourceMenu = async (reference, name) => {
    const menu = reference.locator("header details").first();
    if (await menu.getAttribute("open") === null) await menu.locator("summary").click();
    await menu.getByRole("button", { name, exact: true }).click();
    if (name === "删除同步源") await answerProductDialog(page, { optional: true });
  };

  await check("Tabs retain mixed children, edit content and provide keyboard-selected native panels", async () => {
    await header().waitFor();
    assert.equal(await header().getByRole("tab").count(), 3);
    await block("tab-p").fill("计划正文已在真实编辑器修改");
    await tab("任务").click();
    await block("tab-check").waitFor({ state: "visible" });
    assert.equal(await block("tab-p").isVisible(), false);
    const checkbox = page.locator('[data-id="tab-check"] input[type="checkbox"]').first();
    await checkbox.check();
    await tab("任务").press("ArrowRight");
    await page.locator('[data-id="tab-db"] .database-view').first().waitFor();
    await tab("资料").press("Home");
    assert.equal(await block("tab-p").isVisible(), true);
    const state = await persisted((value) => walkBlocks(current(value).content).find((entry) => entry.id === "tab-check")?.props.checked);
    assert.match(JSON.stringify(current(state).content), /计划正文已在真实编辑器修改/);
    await screenshot("mixed-tabs");
  });

  await check("Tabs add rename reorder copy and delete preserve fresh IDs and never leave zero panels", async () => {
    await header().getByRole("button", { name: "添加标签页", exact: true }).click();
    await menuAction("重命名标签");
    await header().getByLabel("标签名称", { exact: true }).fill("验收标签");
    await header().getByRole("button", { name: "保存", exact: true }).click();
    await menuAction("向左移动");
    assert.deepEqual(await header().getByRole("tab").allTextContents(), ["计划", "任务", "验收标签", "资料"]);
    await menuAction("复制标签容器");
    await page.locator(".life-tabs-header").nth(1).waitFor();
    let state = await persisted((value) => current(value).content.filter((entry) => entry.type === "tabs").length === 2);
    const [first, second] = current(state).content.filter((entry) => entry.type === "tabs");
    const ids = new Set(walkBlocks([first]).map((entry) => entry.id));
    assert.ok(walkBlocks([second]).every((entry) => !ids.has(entry.id)));
    assert.notEqual(first.props.activeTabId, second.props.activeTabId);
    await menuAction("删除当前标签");
    assert.equal(await header().getByRole("tab").count(), 3);
    await menuAction("删除当前标签"); await menuAction("删除当前标签");
    assert.equal(await header().getByRole("tab").count(), 1);
    const details = header().locator(".life-tab-menu");
    if (await details.getAttribute("open") === null) await details.locator("summary").click();
    assert.equal(await details.getByRole("button", { name: "删除当前标签", exact: true }).isDisabled(), true);
    await details.locator("summary").click();
  });

  await check("Canonical references synchronize both directions and unlink creates an independent copy", async () => {
    const a = page.locator('[data-id="sync-main"] .life-synced-source').first();
    const b = page.locator('[data-id="sync-second"] .life-synced-source').first();
    await a.locator('.life-synced-editor [data-content-type="paragraph"]').fill("共享内容第一次更新");
    await page.waitForFunction(() => document.querySelector('[data-id="sync-second"] .life-synced-editor')?.textContent.includes("共享内容第一次更新"));
    await b.locator('.life-synced-editor [data-content-type="paragraph"]').fill("共享内容第二次更新");
    await page.waitForFunction(() => document.querySelector('[data-id="sync-main"] .life-synced-editor')?.textContent.includes("共享内容第二次更新"));
    await sourceMenu(b, "取消同步并保留副本");
    assert.equal(await page.locator('[data-id="sync-second"] .life-synced-source').count(), 0);
    await a.locator('.life-synced-editor [data-content-type="paragraph"]').fill("同步源最终内容");
    const state = await persisted((value) => JSON.stringify(value.syncedSources[0].blocks).includes("同步源最终内容"));
    assert.match(JSON.stringify(current(state).content), /共享内容第二次更新/);
    await sourceMenu(a, "在下方添加引用");
    await persisted((value) => walkBlocks(current(value).content).filter((entry) => entry.type === "syncedBlock").length >= 3);
  });

  await check("Deleting a source shows recoverable unavailable references, and restore revives canonical content", async () => {
    const a = page.locator('[data-id="sync-main"] .life-synced-source').first();
    await sourceMenu(a, "删除同步源");
    await a.getByText("内容源不可用", { exact: true }).waitFor();
    await persisted((value) => Boolean(value.syncedSources[0].deletedAt));
    await sourceMenu(a, "恢复同步源");
    await a.locator('.life-synced-editor [data-content-type="paragraph"]').waitFor();
    assert.match(await a.innerText(), /同步源最终内容/);
  });

  await check("At-menu inserts real atomic Page User and Date mentions, not styled plain text", async () => {
    const target = block("insert-line");
    await target.click();
    await page.keyboard.type("@Alpha");
    await page.getByRole("option").filter({ hasText: "Alpha 项目" }).first().click();
    await page.keyboard.type("@周宁");
    await page.getByRole("option").filter({ hasText: "周宁" }).first().click();
    await page.keyboard.type("@2026-10-02");
    await page.getByRole("option").filter({ hasText: "2026-10-02" }).first().click();
    const state = await persisted((value) => JSON.stringify(walkBlocks(current(value).content).find((entry) => entry.id === "insert-line")?.content).includes("2026-10-02"));
    const content = walkBlocks(current(state).content).find((entry) => entry.id === "insert-line").content;
    assert.ok(content.some((entry) => entry.type === "pageMention" && entry.props.pageId === "alpha-page"));
    assert.ok(content.some((entry) => entry.type === "userMention" && entry.props.personId === "person-b"));
    assert.ok(content.some((entry) => entry.type === "dateMention" && entry.props.value === "2026-10-02"));
  });

  await check("Reload retains edited tabs, atomic mentions, independent copy and canonical source identity", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await header().waitFor();
    assert.equal(await page.locator(".life-tabs-header").count(), 2);
    assert.match(await page.locator('[data-id="sync-main"] .life-synced-editor').first().innerText(), /同步源最终内容/);
    assert.match(await block("insert-line").innerText(), /2026-10-02/);
    const state = await saved();
    assert.equal(state.syncedSources.filter((entry) => entry.id === "shared-source").length, 1);
    assert.match(JSON.stringify(current(state).content), /共享内容第二次更新/);
    await screenshot("reload");
  });

  await check("Native BlockNote side menu stays reachable from the second column with a real stepped mouse path", async () => {
    assert.equal(await page.locator(".life-column-add").count(), 0);
    assert.equal(
      await page.getByRole("button", { name: "在此栏添加区块", exact: true }).count(),
      0,
    );
    const actions = page.locator('.life-editor[data-page-id="editor-page"] > .bn-container > .bn-root > .life-block-actions');
    const targetId = "column-check-b-text";
    const target = page.locator(`.bn-block-outer[data-id="${targetId}"] .bn-block-content`).first();
    await target.scrollIntoViewIfNeeded();
    const targetBox = await target.boundingBox();
    assert.ok(targetBox);

    const start = {
      x: targetBox.x + Math.min(18, targetBox.width / 4),
      y: targetBox.y + Math.min(16, targetBox.height / 2),
    };
    // Playwright can jump from (0,0) directly to the target without producing
    // the small in-block mouse movement BlockNote's hover observer sees during
    // normal use. Explicitly enter the block and move by one pixel so this
    // regression exercises the native Side Menu itself, independent of the
    // now-removed custom column + button.
    await target.hover();
    await page.mouse.move(start.x, start.y);
    await page.mouse.move(start.x + 1, start.y);
    await page.waitForFunction(
      (id) =>
        document.querySelector(`.life-editor[data-page-id="editor-page"] > .bn-container > .bn-root > .life-block-actions[data-block-id="${id}"] [data-test="dragHandleAdd"]`),
      targetId,
    );

    const plus = actions.locator('[data-test="dragHandleAdd"]').first();
    const plusBox = await plus.boundingBox();
    assert.ok(plusBox);
    const destination = {
      x: plusBox.x + plusBox.width / 2,
      y: plusBox.y + plusBox.height / 2,
    };

    for (let step = 1; step <= 14; step += 1) {
      const ratio = step / 14;
      await page.mouse.move(
        start.x + (destination.x - start.x) * ratio,
        start.y + (destination.y - start.y) * ratio,
      );
      const active = await actions
        .first()
        .getAttribute("data-block-id");
      assert.equal(active, targetId);
      assert.equal(await plus.isVisible(), true);
    }

    // Return to the same block and prove the six-dot drag handle is reachable
    // through the same real pointer path. This specifically guards the user's
    // reported "+ / six dots" native BlockNote affordance, not our column +
    // shortcut.
    await page.mouse.move(start.x, start.y);
    const dragHandle = actions.locator('[data-test="dragHandle"]').first();
    await dragHandle.waitFor();
    const dragBox = await dragHandle.boundingBox();
    assert.ok(dragBox);
    const dragDestination = {
      x: dragBox.x + dragBox.width / 2,
      y: dragBox.y + dragBox.height / 2,
    };
    for (let step = 1; step <= 14; step += 1) {
      const ratio = step / 14;
      await page.mouse.move(
        start.x + (dragDestination.x - start.x) * ratio,
        start.y + (dragDestination.y - start.y) * ratio,
      );
      const active = await actions
        .first()
        .getAttribute("data-block-id");
      assert.equal(active, targetId);
      assert.equal(await dragHandle.isVisible(), true);
    }

    // Re-enter the block and native + before activating it.
    await page.mouse.move(start.x, start.y);
    await page.mouse.move(destination.x, destination.y);

    const before = await saved();
    const beforeList = walkBlocks(current(before).content).find((entry) => entry.id === "column-check");
    const beforeFirstCount = beforeList.children[0].children.length;
    const beforeSecondCount = beforeList.children[1].children.length;
    await page.mouse.down();
    await page.mouse.up();
    await page.getByRole("option").first().waitFor();
    await page.keyboard.press("Escape");

    const state = await persisted((value) => {
      const list = walkBlocks(current(value).content).find((entry) => entry.id === "column-check");
      return list?.children?.[1]?.children?.length === beforeSecondCount + 1;
    });
    const list = walkBlocks(current(state).content).find((entry) => entry.id === "column-check");
    assert.equal(list.children[0].children.length, beforeFirstCount);
    assert.equal(list.children[1].children.length, beforeSecondCount + 1);

    const resizer = page.locator(
      '.bn-block-outer[data-id="column-check-a"] .life-column-resizer',
    );
    const resizerBox = await resizer.boundingBox();
    assert.ok(resizerBox);
    const resizerHit = await page.evaluate(
      ({ x, y }) =>
        Boolean(
          document
            .elementFromPoint(x, y)
            ?.closest?.(".life-column-resizer"),
        ),
      {
        x: resizerBox.x + resizerBox.width / 2,
        y: resizerBox.y + Math.min(30, resizerBox.height / 2),
      },
    );
    assert.equal(resizerHit, true);
  });

  await check("Native JSON download includes canonical closure and UI import preserves content without overwriting original dependencies", async () => {
    await page.getByRole("button", { name: "页面操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "导出页面", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "导出页面", exact: true });
    await dialog.getByLabel("导出格式", { exact: true }).selectOption("json");
    const pending = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "导出", exact: true }).click();
    const download = await pending;
    const file = ".qa/phase1-editor-native.json";
    await download.saveAs(file);
    const bundle = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(bundle.kind, "life-atlas-page");
    assert.equal(bundle.related.syncedSources.length, 1);
    assert.ok(bundle.related.databaseItems.length >= 4);
    await page.locator('.page-import-input').setInputFiles(file);
    const state = await persisted((value) => value.syncedSources.length === 2 && value.pages.find((entry) => entry.id === "editor-page").importRevision > 0);
    assert.equal(state.syncedSources.find((entry) => entry.id === "shared-source").revision, bundle.related.syncedSources[0].revision);
    const refs = walkBlocks(current(state).content).filter((entry) => entry.type === "syncedBlock");
    assert.ok(refs.every((entry) => entry.props.sourceId !== "shared-source"));
    await page.locator(".life-synced-editor").first().waitFor({ state: "attached" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".life-tabs-header").first().waitFor();
    assert.match(await page.locator(".life-synced-editor").last().innerText(), /同步源最终内容/);
    await screenshot("native-roundtrip");
  });
}, { workspace });
