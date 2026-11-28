import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

const workspace = coreParityWorkspace();
const page = workspace.pages.find((entry) => entry.id === "editor-page");
workspace.ui = { ...(workspace.ui || {}), selectedPageId: "editor-page", selectedFolderId: page.folderId, expandedFolderIds: [page.folderId] };
page.settings = { ...(page.settings || {}), presentationMode: "full", fullWidth: true };
page.content = [
  {
    type: "columnList",
    props: { columns: 3 },
    children: [
      { type: "column", props: { width: 33.33, index: 0, count: 3 }, children: [{ type: "heading", props: { level: 3 }, content: "A" }] },
      { type: "column", props: { width: 32.67, index: 1, count: 3 }, children: [{ type: "paragraph", content: "B" }] },
      { type: "column", props: { width: 34, index: 2, count: 3 }, children: [{ type: "paragraph", content: "C" }] },
    ],
  },
  {
    type: "callout",
    props: { icon: "✦", tone: "brown" },
    content: "维护这个空间",
    children: [
      { type: "paragraph", content: "第一层说明" },
      { type: "paragraph", content: "第二层状态" },
    ],
  },
];

await browserScenario("notion-replica-structure", async ({ page, check, saved, assert }) => {
  await check("decimal column weights are rendered from document data", async () => {
    await page.waitForSelector(".life-column-marker");
    const values = await page.locator(".life-column-marker").evaluateAll((els) => els.map((el) => ({
      width: el.getAttribute("data-column-width"),
      grow: el.closest(".bn-block-outer")?.style.flexGrow,
    })));
    assert.deepEqual(values.map((v) => v.width), ["33.33", "32.67", "34"]);
    assert.deepEqual(values.map((v) => v.grow), ["33.33", "32.67", "34"]);
  });

  await check("brown callout retains nested child blocks", async () => {
    await page.waitForSelector(".life-callout-brown");
    assert.equal(await page.locator(".life-callout-brown").count(), 1);
    assert.match(await page.locator(".page-document").innerText(), /第一层说明/);
    assert.match(await page.locator(".page-document").innerText(), /第二层状态/);
  });

  await check("reload preserves decimal ratios and callout tone", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".life-column-marker");
    const state = await saved();
    const columns = state.pages.find((entry) => entry.id === "editor-page").content[0].children;
    assert.deepEqual(columns.map((entry) => entry.props.width), [33.33, 32.67, 34]);
    assert.equal(state.pages.find((entry) => entry.id === "editor-page").content[1].props.tone, "brown");
  });
}, { workspace });
