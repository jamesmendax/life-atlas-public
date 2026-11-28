import { existsSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { browserScenario } from "./harness.mjs";
import { fullWorkspace, FIXTURE_TIME } from "../fixtures/full-workspace.mjs";
import { createDatabaseView, createProperty } from "../../src/domain/database.js";
import { checkWorkspaceIntegrity } from "../../src/domain/integrity.js";

const name = "v13-nested-sidebar91";
const run = process.env.SIDEBAR91_RUN || `run-${Date.now()}`;
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Use a unique sidebar91 run name");
const directory = path.resolve(".qa/LOCAL-NOTION-001/v11-wiki-replica48/sidebar91", run);
const publish = (file, value) => writeFileSync(path.join(directory, file), JSON.stringify(value, null, 2) + "\n");

// Extend the shared full fixture; every source, full database and record retains
// a valid owner. These are synthetic identities, never imported/native counts.
const workspace = fullWorkspace();
const ids = {
  root: "wiki-root91", child: "wiki-child91", grandchild: "wiki-grandchild91",
  databaseA: "wiki-database-a91", databaseB: "wiki-database-b91", wrapper: "wiki-wrapper91",
  reference: "wiki-unrelated91", sourceA: "wiki-source-a91", sourceB: "wiki-source-b91",
  viewA: "wiki-view-a91", viewB: "wiki-view-b91", otherView: "wiki-other-view91",
  aliasA: "wiki-alias-a91", aliasDuplicate: "wiki-alias-duplicate91", aliasOther: "wiki-alias-other91",
  toggle: "wiki-collapsed-toggle91", wrapperBlock: "wiki-wrapper-block91",
};
const titles = {
  root: "Wiki 根页面91", child: "普通子页面91 · 足够长的页面标题用于窄窗口侧栏省略与展开验证",
  grandchild: "孙页面91", database: "同名资料库91", wrapper: "同名资料库91", reference: "外部引用页面91",
};
const aliasLabel = `View of ${titles.database}`;
// More than twenty real entries exercise the tail of an uncapped sidebar tree.
const tailAliases = Array.from({ length: 16 }, (_, index) => `wiki-tail-alias91-${index + 1}`);
const paragraph = (id, content) => ({ id, type: "paragraph", content });
const databaseBlock = (id, viewId = ids.viewA) => ({ id, type: "databaseView", props: { sourceId: ids.sourceA, viewId } });
const modelPage = workspace.pages.find((entry) => entry.id === "p-a1-child");
const makePage = (id, title, content, extra = {}) => ({
  ...structuredClone(modelPage), id, title, folderId: "f-a", parentPageId: null,
  icon: "📄", iconColor: null, cover: null, summary: "", sortIndex: 50, content,
  ...extra,
});
workspace.pages.push(
  makePage(ids.root, titles.root, [
    paragraph("wiki-intro91", "Synthetic nested sidebar ownership and block identity fixture"),
    { id: "wiki-child-link91", type: "pageLink", props: { pageId: ids.child, label: titles.child } },
    // Neither an unrelated structural link nor an inline mention owns a page.
    { id: "wiki-unrelated-link91", type: "pageLink", props: { pageId: ids.reference, label: titles.reference } },
    paragraph("wiki-inline-reference91", [{ type: "pageMention", props: { pageId: ids.reference, labelSnapshot: titles.reference } }]),
    databaseBlock(ids.aliasA),
    { id: ids.toggle, type: "toggleListItem", content: "初始折叠的视图容器91", children: [databaseBlock(ids.aliasDuplicate)] },
    databaseBlock(ids.aliasOther, ids.otherView),
    ...tailAliases.map((id) => databaseBlock(id)),
  ], { icon: "📚" }),
  makePage(ids.child, titles.child, [paragraph("wiki-child-body91", "实际普通子页面正文91")], { parentPageId: ids.root, icon: "📝", sortIndex: 10 }),
  makePage(ids.grandchild, titles.grandchild, [paragraph("wiki-grandchild-body91", "实际孙页面正文91")], { parentPageId: ids.child, icon: "🌱", sortIndex: 10 }),
  makePage(ids.databaseA, titles.database, [], { parentPageId: ids.root, pageType: "database", databaseSourceId: ids.sourceA, databaseViewId: ids.viewA, icon: "🧪", sortIndex: 20 }),
  makePage(ids.databaseB, titles.database, [], { parentPageId: ids.root, pageType: "database", databaseSourceId: ids.sourceB, databaseViewId: ids.viewB, icon: "icon:database", sortIndex: 30 }),
  // The raw wrapper title equals its source title; its sidebar label is View of.
  makePage(ids.wrapper, titles.wrapper, [databaseBlock(ids.wrapperBlock)], { parentPageId: ids.root, sortIndex: 40 }),
  makePage(ids.reference, titles.reference, [paragraph("wiki-reference-body91", "独立根页面，不属于 Wiki 根页面91")], { folderId: "f-z", sortIndex: 50 }),
);
for (const [sourceId, pageId, viewId] of [[ids.sourceA, ids.databaseA, ids.viewA], [ids.sourceB, ids.databaseB, ids.viewB]]) {
  workspace.dataSources.push({ id: sourceId, title: titles.database, ownerPageId: pageId, properties: [createProperty({ id: "title", name: "名称", type: "title" })], createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME });
  workspace.databaseViews.push({ ...createDatabaseView({ id: viewId, sourceId, name: "同名视图91", type: "table", visiblePropertyIds: ["title"] }), createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME });
  for (let index = 1; index <= 2; index += 1) {
    const recordPageId = `${pageId}-record-${index}`;
    const recordTitle = `隐藏于侧栏的记录91 ${sourceId} ${index}`;
    workspace.pages.push(makePage(recordPageId, recordTitle, [paragraph(`${recordPageId}-body`, recordTitle)], { parentPageId: pageId, databaseSourceId: sourceId }));
    workspace.databaseItems.push({ id: `${sourceId}-item-${index}`, sourceId, pageId: recordPageId, parentItemId: null, values: { title: recordTitle }, createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME });
  }
}
workspace.databaseViews.push({ ...createDatabaseView({ id: ids.otherView, sourceId: ids.sourceA, name: "同名视图91", type: "table", linked: true, visiblePropertyIds: ["title"] }), createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME });
workspace.ui = {
  ...workspace.ui, activeSection: "private", selectedPageId: "p-a1", selectedFolderId: "f-a",
  privateExpanded: true, expandedFolderIds: workspace.folders.filter((entry) => !entry.trashedAt).map((entry) => entry.id),
  preferences: { ...workspace.ui.preferences, theme: "system" },
};

const entityCollections = ["folders", "pages", "dataSources", "databaseItems", "databaseViews", "relations", "attachments", "people", "syncedSources", "discussions", "comments", "pageTemplates", "databaseTemplates", "pageVersions"];
const identities = (value) => Object.fromEntries(entityCollections.map((key) => [key, (value[key] || []).map((entry) => entry.id).sort()]));
const ownership = (value) => ({
  pages: value.pages.map(({ id, folderId, parentPageId, pageType, databaseSourceId, databaseViewId }) => ({ id, folderId, parentPageId, pageType, databaseSourceId, databaseViewId })),
  sources: value.dataSources.map(({ id, ownerPageId }) => ({ id, ownerPageId })),
  views: value.databaseViews.map(({ id, sourceId }) => ({ id, sourceId })),
});
const editorSelector = `.life-editor[data-page-id="${ids.root}"] .bn-editor`;
const preservedScreenshots = [];

if (existsSync(directory)) throw new Error(`Preserve earlier run: ${directory}`);
mkdirSync(directory, { recursive: true });
publish("fixture.json", workspace);
const report = await browserScenario(name, async ({ page, check, screenshot, assert, seed, saved, persisted }) => {
  const sidebar = page.getByRole("complementary", { name: "主导航" });
  const tree = sidebar.getByRole("tree", { name: "Private 文件夹与页面", exact: true });
  const row = (id) => tree.locator(`[data-node-id="${id}"]`);
  const main = (id) => row(id).locator(":scope > .sidebar-page-main");
  const disclosure = (id, expanded) => row(id).getByRole("button", { name: `${expanded ? "收起" : "展开"}${seed.pages.find((entry) => entry.id === id).title}`, exact: true });
  const alias = (blockId) => tree.locator(`[data-sidebar-view-id="${blockId}"]`);
  const rootBlock = (blockId) => page.locator(`${editorSelector} .bn-block-outer[data-id="${blockId}"]`);
  const rootGroup = () => row(ids.root).locator("..").locator(':scope > [role="group"]');
  const baselineIds = identities(seed);
  const baselineOwnership = ownership(seed);
  let originalRootContent;
  let originalNativeRootContent;
  const nativeRoot = () => page.evaluate((selector) => document.querySelector(selector).pmViewDesc.node.type.schema.cached.blockNoteEditor.document, editorSelector);
  const assertNoEntitiesOrOwnershipChanged = (value) => {
    assert.deepEqual(identities(value), baselineIds, "sidebar navigation must preserve every entity ID set");
    assert.deepEqual(ownership(value), baselineOwnership, "sidebar navigation must preserve folders, parents, sources and view ownership");
  };
  const capture = async (label) => {
    await screenshot(label);
    const file = path.join(directory, `${label}.png`);
    copyFileSync(`.qa/${name}-${label}.png`, file);
    preservedScreenshots.push(file);
  };
  const openPage = async (id) => {
    await main(id).click();
    const state = await persisted((value) => value.ui.selectedPageId === id);
    assert.equal(await row(id).getAttribute("aria-selected"), "true");
    assert.equal(await page.locator(".page-title-input").inputValue(), state.pages.find((entry) => entry.id === id).title);
    return state;
  };
  const selectedEditor = (id) => page.locator(`.life-editor[data-page-id="${id}"] .bn-editor`);
  const toggleWrapper = () => rootBlock(ids.toggle).locator(":scope > .bn-block .bn-toggle-wrapper").first();

  await check("valid full-fixture ownership starts with the Wiki root collapsed and preserves legacy root counts", async () => {
    await sidebar.waitFor();
    await selectedEditor("p-a1").waitFor();
    assert.equal(checkWorkspaceIntegrity(seed).ok, true);
    assert.equal(await row(ids.root).count(), 1);
    assert.equal(await row(ids.root).getAttribute("role"), "treeitem");
    assert.equal(await disclosure(ids.root, false).getAttribute("aria-expanded"), "false");
    for (const id of [ids.child, ids.grandchild, ids.databaseA, ids.databaseB, ids.wrapper]) assert.equal(await row(id).count(), 0);
    for (const id of [ids.aliasA, ids.aliasDuplicate, ids.aliasOther, ...tailAliases]) assert.equal(await alias(id).count(), 0);
    const recordPageIds = new Set(seed.databaseItems.map((item) => item.pageId));
    const sidebarPages = seed.pages.filter((entry) => !entry.trashedAt && (entry.pageType === "database" || !recordPageIds.has(entry.id)));
    const folderCount = seed.folders.filter((entry) => !entry.trashedAt).length;
    assert.equal(await sidebar.locator(".sidebar-tree-count").innerText(), `${folderCount} 个文件夹 · ${sidebarPages.length} 个页面`);
    assertNoEntitiesOrOwnershipChanged(await saved());
    publish("initial-identities.json", baselineIds);
    await capture("initial-root-collapsed-light");
  });
  await check("Wiki disclosure expands and collapses without opening a page or changing selection", async () => {
    for (const expanded of [false, true, false]) {
      await disclosure(ids.root, expanded).click();
      assert.equal(await disclosure(ids.root, !expanded).getAttribute("aria-expanded"), String(!expanded));
      assert.equal(await row(ids.child).isVisible(), !expanded);
      const state = await persisted((value) => value.ui.expandedPageIds?.includes(ids.root) === !expanded);
      assert.equal(state.ui.selectedPageId, "p-a1");
      assert.equal(await page.locator(".page-title-input").inputValue(), "A 概览");
      assert.equal(await selectedEditor("p-a1").isVisible(), true);
      assertNoEntitiesOrOwnershipChanged(state);
    }
  });
  await check("owned child pages and every exact embedded block appear once while inline references remain outside the branch", async () => {
    await openPage(ids.root);
    await selectedEditor(ids.root).waitFor();
    const group = rootGroup();
    const directPages = await group.locator(':scope > .sidebar-page-branch > [data-node-id]').evaluateAll((elements) => elements.map((element) => element.dataset.nodeId).sort());
    assert.deepEqual(directPages, [ids.child, ids.databaseA, ids.databaseB, ids.wrapper].sort());
    assert.equal(await group.locator(`[data-node-id="${ids.reference}"]`).count(), 0);
    assert.equal(await row(ids.reference).count(), 1, "unrelated root keeps its own single page row");
    assert.equal(await row(ids.child).count(), 1, "a structural link must not duplicate its owned child");
    assert.equal(await row(ids.grandchild).count(), 0, "grandchildren await their own disclosure");
    const viewEntries = [[ids.aliasA, ids.viewA], [ids.aliasDuplicate, ids.viewA], [ids.aliasOther, ids.otherView], ...tailAliases.map((id) => [id, ids.viewA])];
    assert.equal(await group.locator("[data-sidebar-view-id]").count(), viewEntries.length, "the tree must include every alias without a cap");
    const orderedEntries = await group.locator(':scope > .sidebar-page-branch > [data-node-id], :scope > [data-sidebar-view-id]').evaluateAll((elements) => elements.map((element) => element.dataset.nodeId || element.dataset.sidebarViewId));
    assert.deepEqual(orderedEntries, [ids.child, ...viewEntries.map(([id]) => id), ids.databaseA, ids.databaseB, ids.wrapper], "structural and nested block appearance order precedes remaining actual owned children");
    for (const [blockId, viewId] of viewEntries) {
      assert.equal(await alias(blockId).count(), 1);
      assert.equal(await alias(blockId).getAttribute("data-owner-page-id"), ids.root);
      assert.equal(await alias(blockId).getAttribute("data-view-id"), viewId);
      assert.equal(await rootBlock(blockId).locator(".database-view").getAttribute("data-view-id"), viewId);
      assert.equal(await rootBlock(blockId).locator(".database-view").getAttribute("data-source-id"), ids.sourceA);
      assert.equal(await alias(blockId).locator(".workspace-tree-label").innerText(), aliasLabel);
    }
    assert.equal(await row(ids.databaseA).locator(".workspace-tree-label").innerText(), titles.database);
    assert.equal(await row(ids.databaseB).locator(".workspace-tree-label").innerText(), titles.database);
    await capture("owned-pages-and-view-aliases-light");
  });
  await check("nested ordinary pages retain titles and icons and every real page is visible without flooding database records", async () => {
    await disclosure(ids.child, false).click();
    await row("p-a1").getByRole("button", { name: "展开A 概览", exact: true }).click();
    for (const entry of seed.pages.filter((entry) => !entry.trashedAt && (!entry.databaseSourceId || entry.pageType === "database"))) {
      assert.equal(await row(entry.id).count(), 1, `one actual page row for ${entry.id}`);
      assert.equal(await row(entry.id).isVisible(), true, `${entry.id} remains visible in the expanded tree`);
    }
    for (const [id, title, icon] of [[ids.root, titles.root, "📚"], [ids.child, titles.child, "📝"], [ids.grandchild, titles.grandchild, "🌱"]]) {
      assert.equal(await row(id).locator(".workspace-tree-label").innerText(), title);
      assert.equal(await row(id).locator(".page-tree-glyph").innerText(), icon);
    }
    assert.ok(Number(await row(ids.grandchild).getAttribute("aria-level")) > Number(await row(ids.child).getAttribute("aria-level")));
    for (const item of seed.databaseItems) assert.equal(await row(item.pageId).count(), 0, `record ${item.pageId} is not a sidebar page`);
    for (const id of [ids.databaseA, ids.databaseB]) assert.equal(await row(id).getByRole("button", { name: /^(展开|收起)/ }).count(), 0, "records must not make a full database expandable");
    assert.equal(await row(ids.databaseA).locator(".page-tree-glyph").textContent(), "🧪", "a database's explicit page icon must be preserved");
  });
  await check("child and grandchild main rows open their exact normal-page identities", async () => {
    for (const id of [ids.child, ids.grandchild]) {
      const state = await openPage(id);
      await selectedEditor(id).waitFor();
      assert.equal(state.ui.selectedFolderId, "f-a");
      assertNoEntitiesOrOwnershipChanged(state);
    }
  });
  await check("same-title full databases navigate by page and source IDs rather than their labels", async () => {
    for (const [id, sourceId, otherId] of [[ids.databaseA, ids.sourceA, ids.databaseB], [ids.databaseB, ids.sourceB, ids.databaseA]]) {
      const state = await openPage(id);
      await page.locator(`.page-full-database .database-view[data-source-id="${sourceId}"]`).waitFor();
      assert.equal(await row(otherId).getAttribute("aria-selected"), "false");
      assert.equal(await page.locator(".page-full-database .database-view").getAttribute("data-source-id"), sourceId);
      assertNoEntitiesOrOwnershipChanged(state);
    }
  });
  await check("view-only wrapper displays View of with a linked icon and opens its own page without duplicating its only view", async () => {
    assert.equal(await row(ids.wrapper).locator(".workspace-tree-label").innerText(), aliasLabel);
    assert.equal(await row(ids.wrapper).getByRole("button", { name: /^(展开|收起)/ }).count(), 0);
    assert.equal(await alias(ids.wrapperBlock).count(), 0);
    assert.equal(await row(ids.wrapper).locator(".sidebar-database-view-arrow").count(), 1, "wrapper must have the linked-view icon");
    const state = await openPage(ids.wrapper);
    await selectedEditor(ids.wrapper).waitFor();
    await page.locator(`.life-editor[data-page-id="${ids.wrapper}"] .database-view[data-source-id="${ids.sourceA}"]`).waitFor();
    assert.equal(state.ui.selectedPageId, ids.wrapper);
    assert.equal(await page.locator(".page-title-input").inputValue(), titles.wrapper);
    assertNoEntitiesOrOwnershipChanged(state);
  });

  // Each exact block is a separate check: the first two intentionally share the
  // same source AND view ID, and the second lives under a collapsed native toggle.
  for (const [blockId, viewId, label] of [
    [ids.aliasA, ids.viewA, "first embedded alias opens the owner root and highlights its exact block without entity creation"],
    [ids.aliasDuplicate, ids.viewA, "duplicate-view alias reveals its collapsed toggle and highlights only its own block without changing content"],
    [ids.aliasOther, ids.otherView, "same-label alternate-view alias preserves view identity and targets its own owner block"],
  ]) {
    await check(label, async () => {
      await openPage(ids.root);
      await selectedEditor(ids.root).waitFor();
      if (!originalRootContent) {
        originalRootContent = (await saved()).pages.find((entry) => entry.id === ids.root).content;
        originalNativeRootContent = await nativeRoot();
        assert.equal(await toggleWrapper().getAttribute("data-show-children"), "false", "the toggle starts collapsed in the fresh browser context");
      }
      if (blockId === ids.aliasDuplicate) {
        assert.equal(await toggleWrapper().getAttribute("data-show-children"), "false");
        assert.equal(await rootBlock(blockId).isVisible(), false);
        await capture("duplicate-alias-before-toggle-reveal");
      }
      // Navigate away so the alias must restore its owner page as well as focus.
      await openPage(ids.child);
      await selectedEditor(ids.child).waitFor();
      await alias(blockId).click();
      await rootBlock(blockId).locator("xpath=self::*[contains(@class,'is-link-target')]").waitFor();
      const highlighted = await page.locator(`${editorSelector} .bn-block-outer.is-link-target`).evaluateAll((elements) => elements.map((element) => element.dataset.id));
      assert.deepEqual(highlighted, [blockId], "the matching label/source/view must never select a different block");
      assert.equal(await rootBlock(blockId).isVisible(), true);
      const target = await rootBlock(blockId).boundingBox();
      assert.ok(target && target.y < 900 && target.y + target.height > 0, "focused target is scrolled into the viewport");
      if (blockId === ids.aliasDuplicate) assert.equal(await toggleWrapper().getAttribute("data-show-children"), "true", "the native collapsed ancestor is revealed");
      assert.equal(await alias(blockId).getAttribute("data-view-id"), viewId);
      const state = await persisted((value) => value.ui.selectedPageId === ids.root);
      assertNoEntitiesOrOwnershipChanged(state);
      assert.deepEqual(state.pages.find((entry) => entry.id === ids.root).content, originalRootContent, "revealing and focusing a view must not rewrite document content");
      assert.deepEqual(await nativeRoot(), originalNativeRootContent, "focus and toggle reveal must leave the live block document unchanged");
      publish(`${blockId}-state.json`, { selectedPageId: state.ui.selectedPageId, highlighted, ownership: ownership(state), identities: identities(state), rootContent: state.pages.find((entry) => entry.id === ids.root).content });
      await capture(`${blockId}-focused-light`);
    });
  }

  await check("the last alias in a tree over twenty entries scrolls into view, opens its exact block and leaves bottom navigation reachable", async () => {
    const blockId = tailAliases.at(-1);
    assert.ok(4 + 3 + tailAliases.length > 20, "the synthetic root must actually exceed twenty direct entries");
    assert.equal(await alias(blockId).count(), 1, "the tail must not be truncated");
    await alias(blockId).scrollIntoViewIfNeeded();
    const tailBounds = await alias(blockId).boundingBox();
    const sidebarBounds = await sidebar.boundingBox();
    assert.ok(tailBounds && tailBounds.y >= sidebarBounds.y && tailBounds.y + tailBounds.height <= sidebarBounds.y + sidebarBounds.height, "last alias is inside the visible sidebar after scrolling");
    await alias(blockId).click();
    await rootBlock(blockId).locator("xpath=self::*[contains(@class,'is-link-target')]").waitFor();
    assert.equal(await rootBlock(blockId).isVisible(), true);
    const state = await persisted((value) => value.ui.selectedPageId === ids.root);
    assertNoEntitiesOrOwnershipChanged(state);
    assert.deepEqual(state.pages.find((entry) => entry.id === ids.root).content, originalRootContent);
    assert.deepEqual(await nativeRoot(), originalNativeRootContent);
    for (const name of ["模板", "密钥库", "回收站"]) {
      const link = sidebar.getByRole("button", { name, exact: true });
      await link.scrollIntoViewIfNeeded();
      const box = await link.boundingBox();
      assert.ok(box && box.y >= sidebarBounds.y && box.y + box.height <= sidebarBounds.y + sidebarBounds.height, `${name} remains reachable below the long tree`);
    }
    await sidebar.getByRole("button", { name: "回收站", exact: true }).click();
    await persisted((value) => value.ui.activeSection === "trash");
    await main(ids.root).scrollIntoViewIfNeeded();
    await openPage(ids.root);
    await selectedEditor(ids.root).waitFor();
    assertNoEntitiesOrOwnershipChanged(await saved());
    publish("long-tree-tail.json", { blockId, directEntryCount: 4 + 3 + tailAliases.length, embeddedBlockCount: 3 + tailAliases.length, tailBounds, sidebarBounds });
    await capture("long-tree-tail-and-bottom-links");
  });

  await check("root main click opens the root page and leaves expanded child branches available", async () => {
    await openPage(ids.grandchild);
    const state = await openPage(ids.root);
    await selectedEditor(ids.root).waitFor();
    assert.equal(await disclosure(ids.root, true).getAttribute("aria-expanded"), "true");
    assert.equal(await row(ids.grandchild).isVisible(), true);
    assertNoEntitiesOrOwnershipChanged(state);
  });
  await check("948px light and dark sidebar keeps long nested rows and linked views inside its width with no horizontal overflow", async () => {
    await openPage(ids.grandchild);
    await page.setViewportSize({ width: 948, height: 900 });
    for (const mode of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, mode);
      const geometry = await sidebar.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const tree = element.querySelector(".sidebar-folder-tree");
        return {
          viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth,
          sidebar: { left: rect.left, right: rect.right, width: rect.width, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth },
          tree: { clientWidth: tree.clientWidth, scrollWidth: tree.scrollWidth },
          rows: [...tree.querySelectorAll('.workspace-tree-row')].map((row) => {
            const bounds = row.getBoundingClientRect();
            const label = row.querySelector(".workspace-tree-label");
            const style = label && getComputedStyle(label);
            return { id: row.dataset.nodeId || row.dataset.sidebarViewId, left: bounds.left, right: bounds.right, labelOverflow: style?.textOverflow };
          }),
        };
      });
      publish(`narrow-${mode}-geometry.json`, geometry);
      assert.ok(geometry.documentWidth <= geometry.viewportWidth, "window must not scroll horizontally");
      assert.ok(geometry.sidebar.scrollWidth <= geometry.sidebar.clientWidth + 1, "sidebar must not scroll horizontally");
      assert.ok(geometry.tree.scrollWidth <= geometry.tree.clientWidth + 1, "nested tree must not overflow horizontally");
      for (const row of geometry.rows) assert.ok(row.left >= geometry.sidebar.left - 1 && row.right <= geometry.sidebar.right + 1, `${row.id} fits inside the sidebar`);
      assert.equal(geometry.rows.find((entry) => entry.id === ids.child).labelOverflow, "ellipsis");
      for (const id of [ids.root, ids.child, ids.grandchild, ids.databaseA, ids.databaseB, ids.wrapper]) assert.equal(await row(id).isVisible(), true);
      await capture(`narrow-${mode}`);
    }
  });
  await check("reload automatically expands the selected grandchild's collapsed page ancestors without creating or reparenting entities", async () => {
    await openPage(ids.grandchild);
    await disclosure(ids.child, true).click();
    await disclosure(ids.root, true).click();
    const before = await persisted((value) => value.ui.selectedPageId === ids.grandchild && !value.ui.expandedPageIds?.includes(ids.root) && !value.ui.expandedPageIds?.includes(ids.child));
    assert.equal(await row(ids.grandchild).count(), 0, "manual collapse retains selection while hiding descendants");
    publish("before-reload.json", { ui: before.ui, identities: identities(before), ownership: ownership(before) });
    await page.reload();
    await selectedEditor(ids.grandchild).waitFor();
    await row(ids.grandchild).waitFor();
    assert.equal(await row(ids.grandchild).getAttribute("aria-selected"), "true");
    for (const id of [ids.root, ids.child]) assert.equal(await disclosure(id, true).getAttribute("aria-expanded"), "true");
    const restored = await persisted((value) => value.ui.selectedPageId === ids.grandchild && value.ui.expandedPageIds?.includes(ids.root) && value.ui.expandedPageIds?.includes(ids.child));
    assertNoEntitiesOrOwnershipChanged(restored);
    assert.deepEqual(restored.pages.find((entry) => entry.id === ids.root).content, originalRootContent);
    publish("after-reload.json", { ui: restored.ui, identities: identities(restored), ownership: ownership(restored) });
    await capture("reloaded-selected-grandchild-dark");
  });
  await check("legacy folder disclosure still only toggles while folder body opens Folder View and right-click preserves page context", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await row("f-z").getByRole("button", { name: "收起Z 其他", exact: true }).click();
    const collapsed = await persisted((value) => !value.ui.expandedFolderIds.includes("f-z"));
    assert.equal(collapsed.ui.selectedPageId, ids.grandchild);
    await row("f-z").getByRole("button", { name: "展开Z 其他", exact: true }).click();
    await row("f-z").locator(".tree-folder-main").click();
    const folder = await persisted((value) => value.ui.selectedFolderId === "f-z" && value.ui.selectedPageId === null);
    await page.locator(".folder-view").waitFor();
    assertNoEntitiesOrOwnershipChanged(folder);
    await row(ids.child).click({ button: "right" });
    const menu = page.locator(".sidebar-context-menu");
    await menu.waitFor();
    assert.equal(await menu.getByRole("menuitem", { name: "移到回收站", exact: true }).isVisible(), true);
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
    assert.equal(await row(ids.child).getAttribute("draggable"), "true");
    assert.equal(await row("f-z").getAttribute("draggable"), "true");
    // Actual drag/reorder/invalid-target regression remains in wp12-navigation.
    assertNoEntitiesOrOwnershipChanged(await saved());
  });
}, { workspace, now: FIXTURE_TIME, viewport: { width: 1440, height: 900 } });

if (!report.passed && existsSync(`.qa/${name}-failure.png`)) copyFileSync(`.qa/${name}-failure.png`, path.join(directory, "failure.png"));
publish("scenario.json", { ...report, run, preservedScreenshots });
