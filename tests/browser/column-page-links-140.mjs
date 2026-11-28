import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { browserScenario } from "./harness.mjs";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";

const workspace = coreParityWorkspace();
workspace.ui.selectedPageId = "editor-page";
const home = workspace.pages.find(page => page.id === "editor-page");
const target = workspace.pages.find(page => page.id === "partner-page");
target.title = "领域与资源";
const long = { ...target, id: "long-title", title: "长期项目和阅读笔记 · ArchiveOfResearchReferences" };
workspace.pages.push(long);
const link = (id, page) => ({ id, type: "pageLink", props: { pageId: page.id, label: page.title } });
workspace.syncedSources[0].blocks = [link("narrow-link", target), link("long-link", long)];
home.content = [
  { id: "columns", type: "columnList", props: { columns: 2 }, children: [
    { id: "nav-column", type: "column", props: { width: 24, index: 0, count: 2 }, children: [{ id: "synced-nav", type: "syncedBlock", props: { sourceId: workspace.syncedSources[0].id } }] },
    { id: "content-column", type: "column", props: { width: 76, index: 1, count: 2 }, children: [link("wide-link", target)] },
  ] },
  link("ordinary-link", target),
];

async function measure(button) {
  return button.evaluate(node => {
    const label = node.querySelector("span");
    const box = label.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(label);
    return { lines: new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size,
      labelWidth: Math.round(box.width), rowWidth: Math.round(node.getBoundingClientRect().width),
      overflow: label.scrollWidth > label.clientWidth + 1, badge: getComputedStyle(node.querySelector("small")).display };
  });
}

await browserScenario("column-page-links-140", async ({ page, context, seed, check, persisted, assert }) => {
  const button = id => page.locator(`.bn-block-outer[data-id="${id}"] .life-page-link-block`).first();
  const narrow = button("narrow-link");
  await check("the narrow synced navigation recovers title space while normal rows retain their layout", async () => {
    await narrow.waitFor();
    assert.ok(await narrow.getByText(target.title).isVisible());
    const compact = await measure(narrow);
    const wide = await measure(button("wide-link"));
    const ordinary = await measure(button("ordinary-link"));
    assert.equal(compact.badge, "none", JSON.stringify(compact));
    assert.notEqual(wide.badge, "none");
    assert.notEqual(ordinary.badge, "none");
    assert.equal(compact.lines, 1, JSON.stringify(compact));
    // Reapply the pre-1.4.0 row geometry to the same live DOM and font.
    const baseline = await page.addStyleTag({ content: `[data-id="narrow-link"] .life-page-link-block { grid-template-columns:24px minmax(0,1fr) auto!important; gap:5px!important; padding-inline:7px!important; } [data-id="narrow-link"] .life-page-link-block small { display:block!important; }` });
    const previous = await measure(narrow);
    await baseline.evaluate(node => node.remove());
    assert.ok(compact.labelWidth >= previous.labelWidth + 20, JSON.stringify({ previous, compact }));
    assert.ok(previous.lines > compact.lines, JSON.stringify({ previous, compact }));
    console.log("same-row layout", JSON.stringify({ previous, compact, wide, ordinary }));
  });
  await check("long titles wrap within the row and keyboard activation opens the intended page", async () => {
    const row = button("long-link");
    const metrics = await measure(row);
    assert.ok(metrics.lines > 1 && !metrics.overflow, JSON.stringify(metrics));
    assert.equal(await row.getAttribute("title"), long.title);
    assert.equal(await row.getByText(long.title, { exact: true }).count(), 1);
    assert.equal(await page.getByRole("button", { name: long.title, exact: true }).and(row).count(), 1);
    await row.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    assert.ok(await row.evaluate(node => node.matches(":focus-visible") && getComputedStyle(node).outlineStyle === "solid"));
    await page.keyboard.press("Enter");
    await persisted(value => value.ui.selectedPageId === "long-title");
  });
  await check("touch navigation keeps a full hit target and opens the page in one tap", async () => {
    const touch = await context.browser().newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true });
    try {
      await touch.addInitScript(({ key, seed }) => localStorage.setItem(key, JSON.stringify(seed)), { key: workspaceStorageKey, seed });
      const tablet = await touch.newPage();
      await tablet.goto(page.url());
      const row = tablet.locator('.bn-block-outer[data-id="narrow-link"] .life-page-link-block').first();
      await row.waitFor();
      assert.ok(await row.evaluate(node => matchMedia("(pointer: coarse)").matches && node.getBoundingClientRect().height >= 44));
      await row.tap();
      await tablet.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.ui?.selectedPageId === "partner-page", workspaceStorageKey);
    } finally { await touch.close(); }
  });
}, { workspace, viewport: { width: 1280, height: 900 } });
