import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

const workspace = coreParityWorkspace();
const target = workspace.pages.find((entry) => entry.id === "editor-page");
workspace.ui = { ...(workspace.ui || {}), selectedPageId: target.id, selectedFolderId: target.folderId, expandedFolderIds: [target.folderId] };
target.settings = { ...(target.settings || {}), presentationMode: "full", fullWidth: true };
target.content = [
  { type: "heading", props: { level: 2 }, content: "精选内容" },
  {
    type: "editorialSection",
    props: {
      sourceId: "projects",
      layout: "cards-3",
      filterJson: JSON.stringify({ kind: "condition", propertyId: "status", operator: "equals", value: "doing" }),
      sortsJson: JSON.stringify([{ propertyId: "amount", direction: "desc" }]),
      limit: 3,
      titlePropertyId: "title",
      eyebrowPropertyId: "status",
      excerptPropertyId: "notes",
      imagePropertyId: "",
    },
  },
  { type: "editorialCard", props: { title: "静态卡片", eyebrow: "随笔 · 7 分钟", excerpt: "可复用静态出版卡片", imageUrl: "", pageId: "", layout: "media-left" } },
];

await browserScenario("notion-replica-editorial", async ({ page, check, saved, assert }) => {
  await check("dynamic editorial section filters the canonical data source", async () => {
    await page.waitForSelector(".life-editorial-section");
    const titles = await page.locator(".life-editorial-section .life-editorial-title").allTextContents();
    assert.deepEqual(titles, ["Alpha 项目"]);
    assert.equal(await page.locator(".life-editorial-section").getAttribute("data-source-id"), "projects");
  });

  await check("static media/text card renders reusable editorial fields", async () => {
    const card = page.locator(".life-editorial-media-left").filter({ hasText: "静态卡片" });
    await card.waitFor();
    assert.match(await card.innerText(), /随笔 · 7 分钟/);
    assert.match(await card.innerText(), /可复用静态出版卡片/);
  });

  await check("reload keeps section binding without duplicating database items", async () => {
    const before = (await saved()).databaseItems.length;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".life-editorial-section");
    const afterState = await saved();
    assert.equal(afterState.databaseItems.length, before);
    assert.equal(afterState.pages.find((entry) => entry.id === "editor-page").content[1].props.sourceId, "projects");
  });
}, { workspace });
