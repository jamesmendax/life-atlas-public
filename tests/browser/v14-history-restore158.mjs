import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { walkBlocks } from "../../src/domain/blockDocument.js";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";
import { installWikiProjections149DesktopFixture } from "./v14-wiki-projections149.mjs";

// Prepared for parent execution. Import/audit never starts a browser or server.
const sourceUrl = new URL("../../.qa/LOCAL-NOTION-001/v14-wiki-real133/context136/native-selection141-final-closed35.json", import.meta.url);
const evidenceRoot = "LOCAL-NOTION-001/v14-wiki-real133/history158";
const declarations = page => ({ pageType: page.pageType, databaseSourceId: page.databaseSourceId, databaseViewId: page.databaseViewId });

export function historyRestore158Fixture() {
  const workspace = JSON.parse(readFileSync(sourceUrl, "utf8")).workspace;
  const linked = workspace.pages.find(page => page.id === workspace.ui.selectedPageId);
  assert.equal(linked.title, "关联随笔 · 标题归属35");
  assert.equal(linked.pageType, "database");
  assert.equal(walkBlocks(linked.content).filter(block => block.type === "databaseView").length, 0, "asset-free initial linked page uses its existing zero-block declaration");
  const canonical = workspace.pages.find(page => page.title === "此刻 · 原库标题35" && page.pageType === "database");
  assert.equal(workspace.dataSources.find(source => source.id === canonical.databaseSourceId).ownerPageId, canonical.id);
  assert.equal(canonical.cover, null);
  const block = walkBlocks(canonical.content).filter(entry => entry.type === "databaseView" && entry.props.sourceId === canonical.databaseSourceId && entry.props.viewId === canonical.databaseViewId);
  assert.equal(block.length, 1, "canonical page has exactly its original declared database block");
  workspace.ui = { ...workspace.ui, activeSection: "private", selectedPageId: linked.id, selectedFolderId: linked.folderId,
    selectedBlockId: null, privateExpanded: true, preferences: { ...workspace.ui.preferences, theme: "light", startPage: "last" } };
  return { workspace, linked, canonical, blockId: block[0].id };
}

export function auditHistoryRestore158Fixture(fixture = historyRestore158Fixture()) {
  const original = JSON.parse(readFileSync(sourceUrl, "utf8")).workspace;
  const collections = Object.keys(original).filter(key => Array.isArray(original[key]));
  assert.equal(collections.length, 14);
  assert.deepEqual([original.pages.length, original.databaseItems.length, original.dataSources.length, original.databaseViews.length, original.attachments.length, original.pageVersions.length], [85, 58, 11, 31, 20, 122]);
  for (const collection of collections) assert.deepEqual(fixture.workspace[collection], original[collection], `${collection} retains every original entity`);
  return { source: fileURLToPath(sourceUrl), counts: Object.fromEntries(collections.map(key => [key, original[key].length])),
    initialLinkedPageId: fixture.linked.id, canonicalPageId: fixture.canonical.id, originalBlockId: fixture.blockId,
    inputChanges: "Initial UI selection/preferences only; all 14 entity arrays remain exact",
    transport: "Existing projection149 one-shot desktop fixture transport; no native/SQLite/asset access" };
}

export async function runV14HistoryRestore158({ run = process.env.WIKI_HISTORY158_RUN || `run-${Date.now()}-${process.pid}` } = {}) {
  assert.match(run, /^[a-z0-9][a-z0-9-]{0,79}$/);
  assert.equal(new URL(process.env.PARITY_BASE_URL || "http://127.0.0.1:5178").href, "http://127.0.0.1:5178/", "parent's isolated5178 only");
  const fixture = historyRestore158Fixture();
  const audit = auditHistoryRestore158Fixture(fixture);
  const directory = fileURLToPath(new URL(`../../.qa/${evidenceRoot}/${run}/`, import.meta.url));
  mkdirSync(path.dirname(directory), { recursive: true }); mkdirSync(directory);
  const put = (name, value) => writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2), { flag: "wx" });
  put("fixture-audit.json", audit);
  const { browserScenario } = await import("./harness.mjs");
  return browserScenario(`${evidenceRoot}/${run}/browser158`, async ({ page, context, check, saved, persisted, screenshot }) => {
    const assetRequests = [];
    page.on("request", request => { if (request.url().startsWith("life-asset:")) assetRequests.push(request.url()); });
    await context.addInitScript(installWikiProjections149DesktopFixture, { workspace: fixture.workspace, key: workspaceStorageKey });
    await page.reload(); // One fixture preparation reload before any test edits.
    await page.locator('html[data-la-ready="1"]').waitFor();
    await check("Full Wiki loads at the asset-free linked page with all 122 histories", async () => {
      const loaded = await saved();
      for (const [collection, entities] of Object.entries(fixture.workspace).filter(([, value]) => Array.isArray(value))) assert.deepEqual(loaded[collection], entities, `${collection} preserved at load`);
      assert.equal(loaded.ui.selectedPageId, fixture.linked.id);
      assert.deepEqual(assetRequests, []);
    });
    await page.keyboard.press("Control+k");
    const search = page.getByRole("dialog", { name: "全局搜索", exact: true });
    await search.getByRole("combobox", { name: "搜索文件夹、页面与正文" }).fill(fixture.canonical.title);
    await search.locator(".search-result-row").filter({ has: page.locator("strong", { hasText: fixture.canonical.title }) }).first().click();
    await search.waitFor({ state: "hidden" });
    const before = await persisted(workspace => workspace.ui.selectedPageId === fixture.canonical.id);
    put("before-conversion.json", before);
    const surface = page.locator(`.life-editor[data-page-id="${fixture.canonical.id}"] section.database-view[data-source-id="${fixture.canonical.databaseSourceId}"][data-view-id="${fixture.canonical.databaseViewId}"]`);
    await check("Public 转为内联 keeps the canonical original block and changes only its declaration", async () => {
      await surface.getByRole("button", { name: "视图设置", exact: true }).click();
      await page.getByRole("button", { name: "转为内联", exact: true }).click();
      const inline = await persisted(workspace => workspace.pages.find(entry => entry.id === fixture.canonical.id).pageType === null);
      const current = inline.pages.find(entry => entry.id === fixture.canonical.id);
      assert.deepEqual(declarations(current), { pageType: null, databaseSourceId: null, databaseViewId: null });
      assert.deepEqual(current.content, fixture.canonical.content, "declaration-only conversion retains all original body/block IDs");
      assert.equal(walkBlocks(current.content).filter(entry => entry.id === fixture.blockId).length, 1);
      assert.deepEqual(inline.pageVersions.slice(0, 122), fixture.workspace.pageVersions);
      put("after-inline.json", inline);
    });
    await check("Public PageHistory dialog enables the body-identical fullpage version and restores it", async () => {
      await page.getByRole("button", { name: "页面操作", exact: true }).click();
      await page.getByRole("menu", { name: "页面操作", exact: true }).getByRole("menuitem", { name: "页面历史", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "页面历史", exact: true }); await dialog.waitFor();
      assert.match(await dialog.getByRole("option").first().innerText(), /编辑前/);
      assert.match(await dialog.locator(".hist-diff").innerText(), /新增 0 个.*删除 0 个.*修改 0 个.*页面类型.*关联数据源.*数据库视图/);
      assert.equal(await dialog.getByRole("button", { name: "恢复此版本", exact: true }).isEnabled(), true);
      await screenshot("declaration-only-enabled");
      await dialog.getByRole("button", { name: "恢复此版本", exact: true }).click();
      await page.getByRole("alertdialog", { name: "恢复页面版本", exact: true }).getByRole("button", { name: "恢复此版本", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      const restored = await persisted(workspace => workspace.pages.find(entry => entry.id === fixture.canonical.id).pageType === "database");
      const current = restored.pages.find(entry => entry.id === fixture.canonical.id);
      assert.deepEqual(declarations(current), declarations(fixture.canonical));
      assert.deepEqual(current.content, fixture.canonical.content);
      assert.deepEqual(restored.pages.filter(entry => entry.id !== current.id), before.pages.filter(entry => entry.id !== current.id));
      for (const [collection, entities] of Object.entries(before).filter(([key, value]) => Array.isArray(value) && !["pages", "pageVersions"].includes(key))) assert.deepEqual(restored[collection], entities);
      assert.deepEqual(restored.pageVersions.slice(0, 122), fixture.workspace.pageVersions);
      const pre = restored.pageVersions.filter(version => version.pageId === current.id && version.reason === "pre-restore").at(-1);
      assert.ok(pre); assert.deepEqual(declarations(pre), { pageType: null, databaseSourceId: null, databaseViewId: null });
      assert.deepEqual(assetRequests, [], "the scenario never fetches real asset bytes");
      put("after-restore.json", restored); await screenshot("restored-fullpage");
    });
  }, { workspace: fixture.workspace, viewport: { width: 1440, height: 900 }, now: "2026-11-14T01:00:00.000Z" });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.includes("--audit-only")) console.log(JSON.stringify(auditHistoryRestore158Fixture(), null, 2));
  else await runV14HistoryRestore158();
}
