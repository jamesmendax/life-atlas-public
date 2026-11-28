import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";
import { installWikiProjections149DesktopFixture } from "./v14-wiki-projections149.mjs";

// Test input only: these explicit occurrence sets do not claim source metadata.
// Importing this file reads no fixture and starts no browser/server/QA run.
const baselineUrl = new URL("../../.qa/LOCAL-NOTION-001/v14-wiki-real133/context136/native-selection141-final-closed35.json", import.meta.url);
const qaUrl = new URL("../../.qa/LOCAL-NOTION-001/v14-wiki-real133/occurrence157/", import.meta.url);
const onlyOne = (values, label) => { assert.equal(values.length, 1, label); return values[0]; };
const baseline = () => JSON.parse(readFileSync(baselineUrl, "utf8")).workspace;
function* blocksOf(blocks) {
  for (const block of blocks || []) { yield block; yield* blocksOf(block.children); }
}
const blockOf = (workspace, address) => onlyOne([...blocksOf(workspace.pages.find(page => page.id === address.pageId)?.content)].filter(block => block.id === address.blockId), "Original occurrence exists exactly once");
const variants = ["explicit", "legacy", "missing-current", "dangling-current", "foreign-current", "outside-membership", "malformed-membership", "empty-membership"];
function variantProps(workspace, address, variant) {
  const props = { ...blockOf(baseline(), address).props, viewId: address.viewId, viewIdsJson: JSON.stringify(address.viewIds) };
  if (variant === "legacy") delete props.viewIdsJson;
  if (variant === "missing-current") delete props.viewId;
  if (variant === "dangling-current") props.viewId = "view-occurrence157-missing";
  if (variant === "foreign-current") props.viewId = workspace.databaseViews.find(view => view.sourceId !== address.sourceId).id;
  if (variant === "outside-membership") props.viewId = workspace.databaseViews.find(view => view.sourceId === address.sourceId && !address.viewIds.includes(view.id)).id;
  if (variant === "malformed-membership") props.viewIdsJson = "[";
  if (variant === "empty-membership") props.viewIdsJson = "[]";
  return props;
}

export function wikiOccurrence157Fixture({ variant = "explicit" } = {}) {
  assert.ok(variants.includes(variant), "Named full Wiki test variant");
  const workspace = baseline();
  const source = onlyOne(workspace.dataSources.filter(entry => entry.title === "随笔"), "Real Wiki Essay source");
  const views = workspace.databaseViews.filter(entry => entry.sourceId === source.id);
  const published = onlyOne(views.filter(entry => entry.name === "已发布"), "Existing published view");
  const draft = onlyOne(views.filter(entry => entry.name === "草稿"), "Existing draft view");
  const home = onlyOne(views.filter(entry => entry.name === "首页精选"), "Existing home view");
  const occurrences = workspace.pages.flatMap(page => [...blocksOf(page.content)]
    .filter(block => block.type === "databaseView" && block.props.sourceId === source.id)
    .map(block => ({ pageId: page.id, blockId: block.id, sourceId: source.id })));
  const root = onlyOne(workspace.pages.filter(page => page.title === "Mendax 的 Vibe Coding Wiki"), "Full real Wiki root");
  const first = onlyOne(occurrences.filter(entry => entry.pageId === root.id), "Original root Essay occurrence");
  const sibling = onlyOne(occurrences.filter(entry => entry.pageId !== root.id), "Original linked Essay occurrence");
  first.viewIds = [published.id, draft.id]; first.viewId = draft.id;
  sibling.viewIds = [home.id, published.id]; sibling.viewId = home.id;
  for (const address of [first, sibling]) Object.assign(blockOf(workspace, address).props, { viewId: address.viewId, viewIdsJson: JSON.stringify(address.viewIds) });
  blockOf(workspace, sibling).props = variantProps(workspace, sibling, variant);
  const article = onlyOne(workspace.dataSources.filter(entry => entry.title === "文章"), "Real Wiki E5/E6 Article source");
  const samePage = [...blocksOf(root.content)].filter(block => block.type === "databaseView" && block.props.sourceId === article.id)
    .map(block => ({ pageId: root.id, blockId: block.id, sourceId: article.id, viewId: block.props.viewId }));
  assert.equal(samePage.length, 2, "Both original root E5/E6 Article occurrences retained");
  workspace.ui = { ...workspace.ui, activeSection: "private", selectedPageId: sibling.pageId, selectedFolderId: root.folderId,
    selectedBlockId: variant === "explicit" || variant === "legacy" ? null : sibling.blockId,
    privateExpanded: true, expandedPageIds: [...new Set([...(workspace.ui.expandedPageIds || []), root.id])],
    preferences: { ...workspace.ui.preferences, theme: "light", startPage: "last" } };
  return { workspace, first, sibling, samePage, variant, rootPageId: root.id };
}

export function auditWikiOccurrence157Fixture(fixture = wikiOccurrence157Fixture()) {
  const original = baseline(), { workspace, first, sibling } = fixture;
  const collections = Object.keys(original).filter(key => Array.isArray(original[key]));
  assert.equal(collections.length, 14, "Retain all14 collections");
  assert.deepEqual([original.pages.length, original.databaseItems.length, original.dataSources.length, original.databaseViews.length, original.attachments.length, original.pageVersions.length], [85, 58, 11, 31, 20, 122], "Final native35 full Wiki snapshot");
  const permittedPages = structuredClone(original.pages);
  for (const address of [first, sibling]) Object.assign(blockOf({ pages: permittedPages }, address).props, { viewId: address.viewId, viewIdsJson: JSON.stringify(address.viewIds) });
  blockOf({ pages: permittedPages }, sibling).props = variantProps(original, sibling, fixture.variant);
  for (const key of collections) assert.deepEqual(workspace[key], key === "pages" ? permittedPages : original[key], `Retain complete ${key}`);
  for (const key of Object.keys(original).filter(key => key !== "ui" && !collections.includes(key))) assert.deepEqual(workspace[key], original[key], `Keep ${key}`);
  return { baseline: fileURLToPath(baselineUrl), counts: Object.fromEntries(collections.map(key => [key, workspace[key].length])),
    first, sibling, samePage: fixture.samePage, variant: fixture.variant,
    testInput: "Only two existing Essay block viewId/viewIdsJson fields and initial ui differ; all31 existing views,20 attachment metadata,122 histories retained exactly. No source-proof claim.",
    transport: "projection149 one-shot isolated desktop contract; normal repository reload, not SQLite/native process restart; no source hashing or attachment-byte access" };
}

const collectionsOf = workspace => Object.keys(workspace).filter(key => Array.isArray(workspace[key]));
export const absentDefaults = content => {
  const copy = structuredClone(content);
  for (const block of blocksOf(copy)) if (block.type === "databaseView") {
    if (block.props?.viewIdsJson === "") delete block.props.viewIdsJson;
    // BlockNote content:none serializes the atomic empty content as absent.
    // Only [] on databaseView is equivalent; nonempty/null/other-node content,
    // IDs, props, children and all persisted workspace/history arrays stay exact.
    if (Array.isArray(block.content) && block.content.length === 0) delete block.content;
  }
  return copy;
};
function assertRetained(actual, fixture, edits = new Map(), addedViews = []) {
  const { workspace } = fixture;
  const collections = collectionsOf(workspace);
  assert.deepEqual(collectionsOf(actual), collections, "All14 collection arrays remain present");
  for (const key of collections.filter(key => !["pages", "folders", "databaseViews", "pageVersions"].includes(key))) assert.deepEqual(actual[key], workspace[key], `Every shared ${key} remains exact`);
  assert.deepEqual(actual.folders.map(({ lastOpenedPageId, ...folder }) => folder), workspace.folders.map(({ lastOpenedPageId, ...folder }) => folder), "Folder identity/hierarchy remains, aside from ordinary visit marker");
  assert.deepEqual(actual.databaseViews.slice(0, workspace.databaseViews.length), workspace.databaseViews, "All original31 view definitions remain exact");
  assert.deepEqual(actual.databaseViews.slice(workspace.databaseViews.length).map(view => view.id), addedViews, "Only publicly added/copied views exist in append order");
  assert.deepEqual(actual.pages.map(page => page.id), workspace.pages.map(page => page.id), "All85 original Pages remain in order; no fake occurrence Pages");
  for (const expected of workspace.pages) {
    const page = actual.pages.find(entry => entry.id === expected.id);
    const patch = edits.get(expected.id);
    if (!patch) assert.deepEqual(page, expected, `Untouched Page ${expected.id} remains exact`);
    else {
      const content = structuredClone(expected.content);
      for (const [blockId, props] of patch) Object.assign(blockOf({ pages: [{ id: expected.id, content }] }, { pageId: expected.id, blockId }).props, props);
      assert.deepEqual(absentDefaults(page.content), absentDefaults(content), "Only the addressed original database block props change; surrounding and nested content remains");
      const stable = value => Object.fromEntries(Object.entries(value).filter(([key]) => !["content", "updatedAt", "contentRevision", "summary", "summarySourceRevision", "summaryUpdatedAt"].includes(key)));
      assert.deepEqual(stable(page), stable(expected), "Page declaration/title/ownership/settings/assets/identity remain unchanged");
    }
  }
  const originalIds = new Set(workspace.pageVersions.map(version => version.id));
  assert.deepEqual(actual.pageVersions.filter(version => originalIds.has(version.id)), workspace.pageVersions, "Old122 histories remain exact JSON values in order; no pruning/backfill");
  for (const version of actual.pageVersions.filter(version => !originalIds.has(version.id))) {
    assert.ok(edits.has(version.pageId), "New history is attributable to a Page actually edited by public UI");
    for (const field of ["pageType", "databaseSourceId", "databaseViewId"]) assert.ok(Object.hasOwn(version, field), "New history captures explicit declaration fields");
    assert.ok(Array.isArray(version.content), "New history retains complete block content");
  }
  for (const key of Object.keys(workspace).filter(key => !["ui", "savedAt"].includes(key) && !collections.includes(key))) assert.deepEqual(actual[key], workspace[key], `Stable ${key}`);
}

export async function runV14WikiOccurrence157({ run = process.env.WIKI_OCCURRENCE157_RUN || `run-${Date.now()}-${process.pid}` } = {}) {
  assert.match(run, /^[a-z0-9][a-z0-9-]{0,79}$/);
  const only = process.env.WIKI_OCCURRENCE157_ONLY || "all";
  assert.ok(["all", "ordered"].includes(only), "WIKI_OCCURRENCE157_ONLY is all or ordered");
  const base = new URL(process.env.PARITY_BASE_URL || "http://127.0.0.1:5178");
  assert.equal(base.href, "http://127.0.0.1:5178/", "Parent's isolated5178 only");
  const fixture = wikiOccurrence157Fixture();
  const audit = auditWikiOccurrence157Fixture(fixture);
  const qaRoot = fileURLToPath(qaUrl); mkdirSync(qaRoot, { recursive: true });
  const directory = path.join(qaRoot, run); mkdirSync(directory); // Earlier outputs must remain.
  const put = (name, value) => writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  put("fixture-audit.json", audit);
  const report = { run, only, startedAt: new Date().toISOString(), passed: false, checks: [], errors: [], screenshots: [], audit };
  const observations = {};
  let browser, context, page, activeCase = "explicit";
  const publish = () => writeFileSync(path.join(directory, "browser-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const check = async (label, action) => {
    const item = { label, passed: false, startedAt: new Date().toISOString() }; report.checks.push(item); publish();
    console.log(`CHECK occurrence157: ${label}`);
    await action(); item.passed = true; item.completedAt = new Date().toISOString(); publish();
  };
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const start = async (input, label) => {
      await context?.close(); activeCase = label;
      context = await browser.newContext({ viewport: { width: 1440, height: 1040 } });
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        if (["http:", "https:"].includes(url.protocol) && url.origin !== base.origin) { report.errors.push({ case: label, kind: "external-request", url: url.href }); return route.abort(); }
        return route.continue();
      });
      await context.addInitScript(installWikiProjections149DesktopFixture, { workspace: input.workspace, key: workspaceStorageKey });
      page = await context.newPage(); page.setDefaultTimeout(9000); page.setDefaultNavigationTimeout(15000);
      page.on("pageerror", error => report.errors.push({ case: label, kind: "pageerror", message: error.stack }));
      page.on("console", message => { if (message.type() === "error") report.errors.push({ case: label, kind: "console", message: message.text() }); });
      page.on("response", response => { if (response.status() >= 400) report.errors.push({ case: label, kind: "http", status: response.status(), url: response.url() }); });
      await page.goto(base.href, { waitUntil: "domcontentloaded" });
    };
    await start(fixture, "explicit");
    const db = (address, viewId = address.viewId) => page.locator(`section.database-view[data-source-id="${address.sourceId}"][data-view-id="${viewId}"]`);
    const tabs = async surface => surface.getByRole("tab").evaluateAll(entries => entries.map(entry => ({ id: entry.dataset.viewId, selected: entry.getAttribute("aria-selected") === "true", name: entry.textContent.trim() })));
    await check("Real Wiki occurrence exposes exactly its ordered existing tabs, not all source views", async () => {
      const surface = db(fixture.sibling); await surface.waitFor();
      const actual = await tabs(surface); observations.orderedTabs = actual;
      assert.deepEqual(actual.map(entry => entry.id), fixture.sibling.viewIds, "viewIdsJson defines exact occurrence membership AND order");
      assert.deepEqual(actual.filter(entry => entry.selected).map(entry => entry.id), [fixture.sibling.viewId], "Current view belongs to the occurrence");
    });
    const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), workspaceStorageKey);
    const persisted = async (predicate, label) => {
      const until = Date.now() + 9000;
      let value;
      do {
        value = await saved();
        if (predicate(value)) return value;
        await page.waitForTimeout(150);
      } while (Date.now() < until);
      assert.ok(predicate(value), label || "Expected ordinary repository save");
    };
    const assertSet = async (surface, expected, current) => {
      await surface.waitFor();
      let actual = await tabs(surface);
      const more = surface.getByRole("button", { name: /^更多\d+个/ });
      if (await more.count()) {
        await more.click();
        const menu = page.getByRole("dialog", { name: "全部视图：随笔", exact: true });
        await menu.waitFor();
        actual = await menu.getByRole("menuitemradio").evaluateAll(entries => entries.map(entry => ({ id: entry.dataset.viewId, selected: entry.getAttribute("aria-checked") === "true", name: entry.textContent.trim() })));
        await menu.getByRole("searchbox", { name: "搜索视图", exact: true }).press("Escape");
      }
      assert.deepEqual(actual.map(entry => entry.id), expected, "Public tabs/overflow menu have exact occurrence set and order");
      assert.deepEqual(actual.filter(entry => entry.selected).map(entry => entry.id), [current]);
      return actual;
    };
    const select = async (address, current, next) => {
      const surface = db(address, current);
      const target = surface.locator(`[role="tab"][data-view-id="${next}"]`);
      if (await target.count()) await target.click();
      else {
        await surface.getByRole("button", { name: /^更多\d+个/ }).click();
        await page.getByRole("dialog", { name: "全部视图：随笔", exact: true }).locator(`[role="menuitemradio"][data-view-id="${next}"]`).click();
      }
      return persisted(value => blockOf(value, address).props.viewId === next, "Tab selection persists into original occurrence block");
    };
    const location = async address => {
      const article = page.getByRole("article", { name: "数据库整页", exact: true });
      await article.waitFor();
      assert.equal(await article.getAttribute("data-page-id"), address.pageId);
      assert.equal(await article.getAttribute("data-block-id"), address.blockId, "Original block identity is rendered");
      const value = await persisted(actual => actual.ui.selectedPageId === address.pageId && actual.ui.selectedBlockId === address.blockId, "Exact page+block selection is persisted");
      assert.equal(await page.getByRole("article", { name: "页面编辑器", exact: true }).count(), 0, "Containing root body remains unmounted in occurrence view");
      return value;
    };
    const openOccurrence = async address => {
      await page.locator(`[data-sidebar-view-id="${address.blockId}"][data-owner-page-id="${address.pageId}"]`).click();
      return location(address);
    };
    const addTable = async (address, current) => {
      await db(address, current).getByRole("button", { name: "添加视图", exact: true }).click();
      const chooser = page.getByRole("dialog", { name: "添加视图", exact: true });
      await chooser.getByRole("button", { name: "表格", exact: true }).click();
      const actual = await persisted(value => blockOf(value, address).props.viewId !== current && value.databaseViews.length > fixture.workspace.databaseViews.length, "Public add menu persists a new view and original occurrence reference");
      const id = blockOf(actual, address).props.viewId;
      const panel = page.getByRole("dialog", { name: "新建视图", exact: true });
      await panel.waitFor();
      await panel.getByRole("button", { name: "关闭新建视图", exact: true }).click();
      return { id, actual };
    };
    const copyCurrent = async (address, current, originalCount) => {
      await db(address, current).getByRole("button", { name: "视图设置", exact: true }).click();
      await page.getByRole("dialog", { name: "视图设置", exact: true }).getByRole("button", { name: "复制当前视图", exact: true }).click();
      const actual = await persisted(value => value.databaseViews.length === originalCount + 1 && blockOf(value, address).props.viewId !== current, "Public copy menu saves a distinct View ID");
      return { id: blockOf(actual, address).props.viewId, actual };
    };
    if (only === "all") {
      const edits = new Map(), addedViews = [];
      let siblingCurrent = fixture.sibling.viewId, siblingIds = [...fixture.sibling.viewIds];
      let rootCurrent = fixture.first.viewId;
      const expectEdit = (address, viewId, viewIds) => {
        if (!edits.has(address.pageId)) edits.set(address.pageId, new Map());
        edits.get(address.pageId).set(address.blockId, { viewId, viewIdsJson: JSON.stringify(viewIds) });
      };
      await check("Switching a real linked occurrence tab saves only that original occurrence", async () => {
        const actual = await select(fixture.sibling, siblingCurrent, siblingIds[1]); siblingCurrent = siblingIds[1];
        expectEdit(fixture.sibling, siblingCurrent, siblingIds);
        await assertSet(db(fixture.sibling, siblingCurrent), siblingIds, siblingCurrent);
        assertRetained(actual, fixture, edits, addedViews);
        observations.switch = { blockId: fixture.sibling.blockId, viewId: siblingCurrent, unchangedRoot: blockOf(actual, fixture.first).props };
      });
      await check("Public copy appends a distinct configured view to this occurrence and keeps shared records", async () => {
        const original = fixture.workspace.databaseViews.find(view => view.id === siblingCurrent);
        const copied = await copyCurrent(fixture.sibling, siblingCurrent, fixture.workspace.databaseViews.length);
        siblingCurrent = copied.id; siblingIds.push(copied.id); addedViews.push(copied.id); expectEdit(fixture.sibling, siblingCurrent, siblingIds);
        assert.equal(copied.actual.databaseViews.find(view => view.id === copied.id).sourceId, fixture.sibling.sourceId);
        for (const field of ["type", "filter", "sorts", "groupBy", "grouping", "visiblePropertyIds", "config"]) assert.deepEqual(copied.actual.databaseViews.find(view => view.id === copied.id)[field], original[field], `Public copy preserves ${field}`);
        await assertSet(db(fixture.sibling, siblingCurrent), siblingIds, siblingCurrent);
        assertRetained(copied.actual, fixture, edits, addedViews);
        observations.copy = { id: copied.id, ownSet: [...siblingIds] };
      });
      await check("Public add appends only to this occurrence without leaking into its same-source sibling", async () => {
        const created = await addTable(fixture.sibling, siblingCurrent);
        siblingCurrent = created.id; siblingIds.push(created.id); addedViews.push(created.id); expectEdit(fixture.sibling, siblingCurrent, siblingIds);
        assert.equal(created.actual.databaseViews.find(view => view.id === created.id).type, "table");
        assert.equal(created.actual.databaseViews.find(view => view.id === created.id).sourceId, fixture.sibling.sourceId);
        await assertSet(db(fixture.sibling, siblingCurrent), siblingIds, siblingCurrent);
        assertRetained(created.actual, fixture, edits, addedViews);
        observations.add = { id: created.id, ownSet: [...siblingIds] };
      });
      await check("Open and return uses the original linked Page+block without creating a synthetic Page", async () => {
        await db(fixture.sibling, siblingCurrent).getByRole("button", { name: "以整页打开", exact: true }).click();
        const opened = await location(fixture.sibling); assertRetained(opened, fixture, edits, addedViews);
        assert.equal(await page.locator("section.database-view").count(), 1);
        await page.getByRole("button", { name: "返回所在页面", exact: true }).click();
        await page.getByRole("article", { name: "页面编辑器", exact: true }).waitFor();
        const returned = await persisted(value => value.ui.selectedPageId === fixture.sibling.pageId && value.ui.selectedBlockId == null, "Return clears only the occurrence address");
        await assertSet(db(fixture.sibling, siblingCurrent), siblingIds, siblingCurrent);
        assertRetained(returned, fixture, edits, addedViews);
      });
      await check("Sidebar opens the real nested root occurrence alone with its different ordered membership", async () => {
        const opened = await openOccurrence(fixture.first);
        assert.equal(await page.locator("section.database-view").count(), 1);
        await assertSet(db(fixture.first), fixture.first.viewIds, fixture.first.viewId);
        assertRetained(opened, fixture, edits, addedViews);
        const selected = await select(fixture.first, rootCurrent, fixture.first.viewIds[0]); rootCurrent = fixture.first.viewIds[0];
        expectEdit(fixture.first, rootCurrent, fixture.first.viewIds);
        assertRetained(selected, fixture, edits, addedViews);
        assert.deepEqual(JSON.parse(blockOf(selected, fixture.sibling).props.viewIdsJson), siblingIds, "Sibling still has its own added/copied membership");
        observations.root = { pageId: fixture.first.pageId, blockId: fixture.first.blockId, viewId: rootCurrent, ownSet: fixture.first.viewIds };
      });
      await check("Normal repository reload restores the same real block, current view and edited sets without reseeding", async () => {
        const before = await saved();
        await page.reload({ waitUntil: "domcontentloaded" });
        const after = await location(fixture.first);
        await assertSet(db(fixture.first, rootCurrent), fixture.first.viewIds, rootCurrent);
        assertRetained(after, fixture, edits, addedViews);
        for (const key of collectionsOf(before).filter(key => key !== "pageVersions")) assert.deepEqual(after[key], before[key], `Edit/reload preserves complete ${key}`);
        const afterIds = new Set(after.pageVersions.map(version => version.id));
        for (const version of before.pageVersions) assert.ok(afterIds.has(version.id), "Reload retains all pre-reload histories");
        // A pagehide flush may append the legitimate final idle snapshot. The
        // second read-only reload must preserve all14 arrays strictly.
        await page.reload({ waitUntil: "domcontentloaded" });
        const stable = await location(fixture.first);
        await assertSet(db(fixture.first, rootCurrent), fixture.first.viewIds, rootCurrent);
        for (const key of collectionsOf(after)) assert.deepEqual(stable[key], after[key], `Read-only second reload preserves all ${key} exactly`);
        assertRetained(stable, fixture, edits, addedViews);
        observations.reload = { pageId: stable.ui.selectedPageId, blockId: stable.ui.selectedBlockId, viewId: rootCurrent,
          histories: [before.pageVersions.length, after.pageVersions.length, stable.pageVersions.length], addedViews: [...addedViews], all14ArraysStrictOnSecondReload: true };
      });
      await check("Real same-page same-source E5/E6 Article occurrences remain distinct in Back/Forward and reload", async () => {
        const [first, second] = fixture.samePage;
        assert.equal(first.pageId, second.pageId); assert.equal(first.sourceId, second.sourceId); assert.notEqual(first.blockId, second.blockId);
        await openOccurrence(first); await openOccurrence(second);
        const back = page.getByRole("button", { name: "后退", exact: true }); assert.equal(await back.isEnabled(), true);
        await back.click(); await location(first);
        await page.getByRole("button", { name: "前进", exact: true }).click();
        const forward = await location(second); assertRetained(forward, fixture, edits, addedViews);
        assert.equal(await page.locator("section.database-view").count(), 1);
        await page.reload({ waitUntil: "domcontentloaded" });
        const reloaded = await location(second); assertRetained(reloaded, fixture, edits, addedViews);
        for (const key of collectionsOf(forward)) assert.deepEqual(reloaded[key], forward[key], `Read-only same-page reload keeps ${key}`);
        observations.samePage = { first, second, restoredBlockId: reloaded.ui.selectedBlockId };
      });
      for (const command of ["add", "copy"]) {
        await check(`Unknown legacy membership exposes only current view; public ${command} declares its own pair`, async () => {
          const legacy = wikiOccurrence157Fixture({ variant: "legacy" }); auditWikiOccurrence157Fixture(legacy);
          await start(legacy, `legacy-${command}`);
          const current = legacy.sibling.viewId;
          await assertSet(db(legacy.sibling), [current], current);
          const created = command === "add" ? await addTable(legacy.sibling, current) : await copyCurrent(legacy.sibling, current, legacy.workspace.databaseViews.length);
          const ownSet = [current, created.id];
          assert.deepEqual(JSON.parse(blockOf(created.actual, legacy.sibling).props.viewIdsJson), ownSet, "An unknown set becomes only [old current, new public view]");
          const legacyEdits = new Map([[legacy.sibling.pageId, new Map([[legacy.sibling.blockId, { viewId: created.id, viewIdsJson: JSON.stringify(ownSet) }]])]]);
          await assertSet(db(legacy.sibling, created.id), ownSet, created.id);
          assertRetained(created.actual, legacy, legacyEdits, [created.id]);
          await page.reload({ waitUntil: "domcontentloaded" });
          await assertSet(db(legacy.sibling, created.id), ownSet, created.id);
          const reloaded = await persisted(value => blockOf(value, legacy.sibling).props.viewId === created.id, "Legacy declared pair survives normal reload");
          assertRetained(reloaded, legacy, legacyEdits, [created.id]);
          observations[`legacy-${command}`] = { ownSet, viewId: created.id };
        });
      }
      for (const variant of variants.filter(value => !["explicit", "legacy"].includes(value))) {
        await check(`Explicit ${variant} reference shows recoverable error and survives reload without canonical fallback`, async () => {
          const invalid = wikiOccurrence157Fixture({ variant }); auditWikiOccurrence157Fixture(invalid);
          await start(invalid, variant);
          const errorShown = async () => {
            await location(invalid.sibling);
            const article = page.getByRole("article", { name: "数据库整页", exact: true });
            const alert = article.getByRole("alert"); await alert.waitFor();
            const text = await alert.innerText();
            assert.ok(text.includes("此处的数据库视图不可用"));
            assert.ok(text.includes("保留") && text.includes("恢复"), "Error explains retained references and recovery");
            assert.equal(await article.getByRole("tab").count(), 0, "No canonical/source-wide tab fallback");
            assert.equal(await article.locator("section.database-view[data-view-id]").count(), 0, "No substitute canonical view renders");
            return text;
          };
          const text = await errorShown();
          const before = await saved(); assertRetained(before, invalid);
          assert.deepEqual(blockOf(before, invalid.sibling).props, blockOf(invalid.workspace, invalid.sibling).props, "Invalid explicit reference remains intact for recovery");
          await page.reload({ waitUntil: "domcontentloaded" }); await errorShown();
          const after = await saved(); assertRetained(after, invalid);
          for (const key of collectionsOf(before)) assert.deepEqual(after[key], before[key], `Invalid-case reload retains full ${key}`);
          observations[variant] = { pageId: invalid.sibling.pageId, blockId: invalid.sibling.blockId, retainedProps: blockOf(after, invalid.sibling).props, text };
        });
      }
    }
    assert.deepEqual(report.errors, [], "No browser/HTTP/external errors");
    report.passed = true;
  } catch (error) {
    report.failure = error.stack; report.failureCase = activeCase; process.exitCode = 1;
    if (page) {
      await page.screenshot({ path: path.join(directory, "failure.png"), fullPage: true, timeout: 5000 }).then(() => report.screenshots.push("failure.png")).catch(() => {});
      report.bodyExcerpt = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "Renderer unavailable");
      await page.evaluate(key => JSON.parse(localStorage.getItem(key)), workspaceStorageKey).then(value => put("failure-workspace.json", value)).catch(() => {});
    }
    console.error(`FAIL occurrence157: ${error.stack}`);
  } finally {
    await browser?.close().catch(error => { report.passed = false; report.errors.push({ kind: "close", message: error.message }); process.exitCode = 1; });
    put("observations.json", observations); report.completedAt = new Date().toISOString(); publish();
  }
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.includes("--audit-only")) console.log(JSON.stringify(variants.map(variant => auditWikiOccurrence157Fixture(wikiOccurrence157Fixture({ variant }))), null, 2));
  else await runV14WikiOccurrence157();
}
