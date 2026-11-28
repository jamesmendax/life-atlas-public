import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { browserScenario } from "./harness.mjs";

// Keep the complete real85-page snapshot and its initially selected linked
// fullpage created by136. No fabricated pages, source configuration or pruning.
const input = ".qa/LOCAL-NOTION-001/v14-wiki-real133/context136/native-fullpage-gallery.json";
const workspace = structuredClone(JSON.parse(readFileSync(input, "utf8")).workspace);
const linked = workspace.pages.find(entry => entry.id === workspace.ui.selectedPageId);
const sharedSource = workspace.dataSources.find(entry => entry.id === linked?.databaseSourceId);
const owner = workspace.pages.find(entry => entry.id === sharedSource?.ownerPageId);
assert.equal(workspace.pages.length, 85, "Use the full real136 snapshot");
assert.equal(workspace.databaseItems.length, 58);
assert.equal(workspace.dataSources.length, 11);
assert.equal(workspace.databaseViews.length, 31);
assert.equal(workspace.attachments.length, 20);
assert.equal(workspace.pageVersions.length, 118, "Retain the input history; browser saves are not native-history proof");
assert.equal(linked?.pageType, "database");
assert.ok(owner && owner.id !== linked.id, "The initial selection must be the linked page, not its canonical owner");
assert.equal(workspace.ui.activeSection, "private");
assert.equal(workspace.ui.preferences.startPage, "last");

//136 left the linked source's owner inline. Exercise another existing real
// canonical fullpage, without changing any Page declaration in the seed.
const canonical = workspace.pages.find(entry => entry.pageType === "database" && !entry.settings?.locked &&
  workspace.dataSources.some(source => source.id === entry.databaseSourceId && source.ownerPageId === entry.id) &&
  workspace.databaseItems.some(item => item.sourceId === entry.databaseSourceId));
assert.ok(canonical && canonical.id !== linked.id, "Keep a real canonical database-page control case");

const run = process.env.WIKI_RENAME142_RUN || `run-${Date.now()}`;
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid evidence run name");
const name = `LOCAL-NOTION-001/v14-wiki-real133/rename142/${run}/browser-report`;
const directory = `.qa/LOCAL-NOTION-001/v14-wiki-real133/rename142/${run}`;
if (existsSync(directory)) throw new Error("Preserve earlier rename142 runs");
mkdirSync(directory, { recursive: true });

await browserScenario(name, async ({ page, check, saved, persisted }) => {
  const titleInput = page.locator(".page-document .page-title-input");
  const fullDatabase = sourceId => page.locator(`.page-full-database .database-view[data-source-id="${sourceId}"]`);
  const byPageId = (state, id) => state.pages.find(entry => entry.id === id);
  const bySourceId = (state, id) => state.dataSources.find(entry => entry.id === id);
  const withoutRenameFields = ({ title, updatedAt, ...rest }) => rest;
  const preservePages = (after, before, editedId) => {
    assert.equal(after.pages.length, before.pages.length, "Renaming must not create or delete Pages");
    for (const original of before.pages) {
      const current = byPageId(after, original.id);
      assert.ok(current, `Preserve Page identity ${original.id}`);
      assert.deepEqual(original.id === editedId ? withoutRenameFields(current) : current,
        original.id === editedId ? withoutRenameFields(original) : original,
        `Preserve Page ${original.id}: content, source/view declaration and all other linked Pages`);
    }
  };
  const preserveSharedData = (after, before) => {
    for (const key of ["databaseItems", "databaseViews", "relations", "syncedSources", "attachments", "people",
      "pageTemplates", "databaseTemplates", "discussions", "comments"]) {
      assert.deepEqual(after[key], before[key], `Renaming preserves ${key}, including IDs and configuration`);
    }
  };
  const editTitle = async title => {
    await titleInput.click();
    await titleInput.fill(title);
    await titleInput.press("Tab");
    assert.equal(await titleInput.inputValue(), title, "The normal Page title input displays the local edit");
  };

  await check("Real136 linked fullpage title changes locally without renaming its shared source or canonical Page", async () => {
    await titleInput.waitFor();
    await fullDatabase(sharedSource.id).waitFor();
    const before = await saved();
    assert.equal(before.ui.selectedPageId, linked.id, "Start on the new linked Page from136");
    assert.equal(await titleInput.inputValue(), linked.title);
    assert.equal(await fullDatabase(sharedSource.id).locator(".db-source-button").innerText(), sharedSource.title);
    const localTitle = "关联整页 · 本地标题142";
    await editTitle(localTitle);
    const renamed = await persisted(state => byPageId(state, linked.id)?.title === localTitle);
    assert.equal(bySourceId(renamed, sharedSource.id)?.title, sharedSource.title,
      "Editing a linked Page title must preserve the shared data-source name");
    assert.deepEqual(renamed.dataSources, before.dataSources, "Preserve every source, canonical owner and source timestamp");
    assert.deepEqual(byPageId(renamed, owner.id), byPageId(before, owner.id), "The canonical Page remains unchanged");
    preservePages(renamed, before, linked.id);
    preserveSharedData(renamed, before);
    assert.equal(await fullDatabase(sharedSource.id).locator(".db-source-button").innerText(), sharedSource.title);

    await page.reload({ waitUntil: "domcontentloaded" });
    await titleInput.waitFor();
    await fullDatabase(sharedSource.id).waitFor();
    const reopened = await persisted(state => state.ui.selectedPageId === linked.id && byPageId(state, linked.id)?.title === localTitle);
    assert.equal(await titleInput.inputValue(), localTitle);
    assert.equal(await fullDatabase(sharedSource.id).locator(".db-source-button").innerText(), sharedSource.title);
    assert.deepEqual(reopened.dataSources, before.dataSources, "Browser reload keeps the original shared source");
    preservePages(reopened, before, linked.id);
    preserveSharedData(reopened, before);
  });

  await check("A real canonical database Page still shares its renamed title with its source", async () => {
    await page.locator(`[data-node-id="${canonical.id}"] > .sidebar-page-main`).click();
    await fullDatabase(canonical.databaseSourceId).waitFor();
    const before = await persisted(state => state.ui.selectedPageId === canonical.id);
    const originalSource = bySourceId(before, canonical.databaseSourceId);
    assert.equal(originalSource.ownerPageId, canonical.id);
    assert.equal(await titleInput.inputValue(), canonical.title);
    const canonicalTitle = `${canonical.title} · 主数据库标题142`;
    await editTitle(canonicalTitle);
    const renamed = await persisted(state => byPageId(state, canonical.id)?.title === canonicalTitle &&
      bySourceId(state, originalSource.id)?.title === canonicalTitle);
    assert.equal(byPageId(renamed, canonical.id).title, canonicalTitle);
    assert.equal(bySourceId(renamed, originalSource.id).title, canonicalTitle, "Canonical title still renames its source");
    assert.deepEqual(withoutRenameFields(bySourceId(renamed, originalSource.id)), withoutRenameFields(originalSource),
      "Canonical rename preserves source ID, ownership and property definitions");
    assert.deepEqual(renamed.dataSources.filter(entry => entry.id !== originalSource.id),
      before.dataSources.filter(entry => entry.id !== originalSource.id), "Keep all other sources unchanged");
    preservePages(renamed, before, canonical.id);
    preserveSharedData(renamed, before);
    assert.equal(await fullDatabase(originalSource.id).locator(".db-source-button").innerText(), canonicalTitle);

    await page.reload({ waitUntil: "domcontentloaded" });
    await titleInput.waitFor();
    await fullDatabase(originalSource.id).waitFor();
    const reopened = await persisted(state => state.ui.selectedPageId === canonical.id && byPageId(state, canonical.id)?.title === canonicalTitle);
    assert.equal(await titleInput.inputValue(), canonicalTitle);
    assert.equal(await fullDatabase(originalSource.id).locator(".db-source-button").innerText(), canonicalTitle);
    assert.deepEqual(reopened.dataSources, renamed.dataSources);
    preservePages(reopened, before, canonical.id);
    preserveSharedData(reopened, before);
  });
}, { workspace });
