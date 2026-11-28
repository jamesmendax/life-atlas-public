import { browserScenario } from "./harness.mjs";
import { fullWorkspace } from "../fixtures/full-workspace.mjs";

process.env.PARITY_BASE_URL = "http://127.0.0.1:5178";

function fixture() {
  const workspace = fullWorkspace();
  const parent = workspace.pages.find((page) => page.id === "p-a1");
  const child = workspace.pages.find((page) => page.id === "p-a1-child");
  parent.content.push(
    { id: "v7-parent-rich", type: "paragraph", content: [
      { type: "text", text: "父页加粗", styles: { bold: true } },
      { type: "link", href: "https://example.org/parent", content: [{ type: "text", text: "父页链接", styles: { italic: true } }] },
    ], children: [] },
    { id: "v7-parent-child-link", type: "pageLink", props: { pageId: child.id, label: child.title }, content: [], children: [] },
  );
  child.content = [{ id: "v7-child-rich", type: "paragraph", content: [
    { type: "text", text: "子页加粗", styles: { bold: true } },
    { type: "link", href: "https://example.org/child", content: [{ type: "text", text: "子页链接", styles: { italic: true } }] },
  ], children: [] }];
  return workspace;
}

function withoutFields(value, fields) {
  const copy = structuredClone(value);
  for (const field of fields) delete copy[field];
  return copy;
}

async function runRoute(name, route) {
  return browserScenario(name, async ({ page, check, saved, persisted, assert }) => {
    const sidebar = page.getByRole("complementary", { name: "主导航" });
    const row = (id) => sidebar.locator(`[data-node-id="${id}"]`);
    await sidebar.waitFor();
    await page.waitForTimeout(900);
    const before = await saved();
    const originalParent = before.pages.find((item) => item.id === "p-a1");
    const originalChild = before.pages.find((item) => item.id === "p-a1-child");
    assert.ok(originalParent && originalChild);
    assert.equal(originalChild.parentPageId, originalParent.id);

    function checkMove(actual) {
      const parent = actual.pages.find((item) => item.id === "p-a1");
      const child = actual.pages.find((item) => item.id === "p-a1-child");
      assert.ok(parent && child, "parent and child identities must survive");
      assert.equal(parent.folderId, "f-z");
      assert.deepEqual(withoutFields(parent, ["folderId", "sortIndex", "updatedAt"]), withoutFields(originalParent, ["folderId", "sortIndex", "updatedAt"]));
      assert.deepEqual(withoutFields(child, ["folderId", "updatedAt"]), withoutFields(originalChild, ["folderId", "updatedAt"]));
      assert.equal(child.parentPageId, parent.id);
      assert.equal(parent.trashedAt, null);
      assert.equal(child.trashedAt, null);
      assert.deepEqual(actual.pages.filter((item) => ![parent.id, child.id].includes(item.id)), before.pages.filter((item) => ![parent.id, child.id].includes(item.id)));
      assert.deepEqual(actual.folders.map((item) => withoutFields(item, ["lastOpenedPageId", "updatedAt"])), before.folders.map((item) => withoutFields(item, ["lastOpenedPageId", "updatedAt"])));
      for (const collection of ["dataSources", "databaseItems", "databaseViews", "relations", "syncedSources", "attachments", "people", "pageTemplates", "databaseTemplates", "discussions", "comments", "pageVersions"]) {
        assert.deepEqual(actual[collection], before[collection], collection);
      }
    }

    await check(`${route}: move preserves content, ownership and unrelated entities`, async () => {
      if (route === "menu") {
        await row("p-a1").click({ button: "right" });
        await page.locator(".sidebar-context-menu").getByRole("menuitem", { name: "移动到…", exact: true }).click();
        const modal = page.locator(".page-move-modal");
        await modal.getByLabel("目标文件夹", { exact: true }).selectOption("f-z");
        await modal.getByRole("button", { name: "移动页面", exact: true }).click();
      } else {
        await row("p-a1").dragTo(row("f-z"));
      }
      checkMove(await persisted((value) => value.pages.find((item) => item.id === "p-a1")?.folderId === "f-z"));
    });
    await check(`${route}: move survives reload`, async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await sidebar.waitFor();
      checkMove(await saved());
    });
    await check(`${route}: trashing old folder keeps moved parent and child accessible`, async () => {
      await row("f-a").locator(".tree-folder-main").click({ button: "right" });
      await page.locator(".sidebar-context-menu").getByRole("menuitem", { name: "移到回收站", exact: true }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "移到回收站", exact: true }).click();
      const result = await persisted((value) => Boolean(value.folders.find((item) => item.id === "f-a")?.trashedAt));
      const parent = result.pages.find((item) => item.id === "p-a1");
      const child = result.pages.find((item) => item.id === "p-a1-child");
      console.log(`PAGE_MOVE_TRASH_RESULT ${JSON.stringify({ route, parent: { id: parent?.id, folderId: parent?.folderId, trashedAt: parent?.trashedAt }, child: { id: child?.id, folderId: child?.folderId, parentPageId: child?.parentPageId, trashedAt: child?.trashedAt, trashedByFolderId: child?.trashedByFolderId } })}`);
      await row("p-a1").click();
      const childLink = page.locator('.life-editor[data-page-id="p-a1"] .life-page-link-block').filter({ hasText: "A 子页面" });
      await childLink.waitFor();
      const disabled = await childLink.isDisabled();
      console.log(`PAGE_MOVE_CHILD_LINK ${JSON.stringify({ route, disabled, text: await childLink.innerText() })}`);
      assert.equal(parent?.trashedAt, null, "moved parent must stay live when old folder is trashed");
      assert.equal(child?.trashedAt, null, "owned child must stay live when old folder is trashed");
      assert.equal(child?.parentPageId, parent.id);
      assert.equal(disabled, false, "child link must remain accessible from parent");
      await childLink.click();
      await page.locator('.life-editor[data-page-id="p-a1-child"]').waitFor();
      assert.match(await page.locator('.life-editor[data-page-id="p-a1-child"]').innerText(), /子页加粗/);
    });
  }, { workspace: fixture(), viewport: { width: 1440, height: 900 } });
}

const artifactRun = process.env.PAGE_MOVE_ARTIFACT_RUN || "01";
for (const [name, route] of [[`v7-page-move-menu${artifactRun}`, "menu"], [`v7-page-move-drag${artifactRun}`, "drag"]]) {
  await runRoute(name, route);
}
