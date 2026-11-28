import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { browserScenario } from "./harness.mjs";

// Replay the complete, retained real Wiki snapshot; no native workspace writes,
// record pruning, hand-built project, or source-configuration guesses.
const baseline = JSON.parse(readFileSync(".qa/LOCAL-NOTION-001/v9-formal-database-ui01/evidence/native208-formal30-v14-real-wiki-resume.json", "utf8")).workspace;
const source = baseline.dataSources.find(entry => entry.title === "随笔");
const owner = baseline.pages.find(entry => entry.id === source.ownerPageId);
const gallery = baseline.databaseViews.find(entry => entry.sourceId === source.id && entry.type === "gallery" && entry.name === "已发布");
if (!owner || !gallery) throw new Error("The real Wiki baseline must include the accepted119 published gallery");
const run = process.env.WIKI_CONTEXT136_RUN || `run-${Date.now()}`;
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid evidence run name");
const directory = `.qa/LOCAL-NOTION-001/v14-wiki-real133/context136/${run}`;
if (existsSync(directory)) throw new Error("Preserve earlier verification runs");
mkdirSync(directory, { recursive: true });
const workspace = structuredClone(baseline);
// Approved138 test membership for this occurrence only, not source-layout fidelity.
const occurrence = workspace.pages.find(entry => entry.id === owner.id).content.find(entry => entry.type === "databaseView" && entry.props?.sourceId === source.id);
occurrence.props.viewIdsJson = JSON.stringify([occurrence.props.viewId, gallery.id]);
workspace.ui = { ...workspace.ui, activeSection: "private", selectedPageId: owner.id, selectedFolderId: owner.folderId,
  preferences: { ...workspace.ui.preferences, startPage: "last", theme: "dark" } };
const report = await browserScenario("v14-real-wiki-view-context136", async ({ page, check, assert, saved, persisted, screenshot }) => {
  const full = () => page.locator(".page-full-database .database-view");
  const inline = () => page.locator(`.life-editor[data-page-id="${owner.id}"] .database-view`);
  const original = structuredClone(owner.content);
  await check("Real84-page Wiki retains the active published gallery and original body when converted inline", async () => {
    await full().getByRole("tab", { name: "已发布", exact: true }).click();
    await persisted(value => value.pages.find(entry => entry.id === owner.id)?.databaseViewId === gallery.id);
    await full().getByRole("button", { name: "视图设置", exact: true }).click();
    await page.getByRole("button", { name: "转为内联", exact: true }).click();
    const after = await persisted(value => value.pages.find(entry => entry.id === owner.id)?.pageType !== "database");
    const converted = after.pages.find(entry => entry.id === owner.id);
    const block = converted.content.find(entry => entry.type === "databaseView" && entry.props?.sourceId === source.id);
    assert.equal(block?.props.viewId, gallery.id, "Inline conversion must keep the selected gallery, not the first/default table");
    assert.equal(block.id, original.find(entry => entry.type === "databaseView").id, "The existing occurrence identity must survive conversion");
    assert.deepEqual(converted.content.filter(entry => entry.id !== block.id), original.filter(entry => entry.id !== block.id), "Keep all original surrounding document content");
    assert.equal(converted.databaseViewId ?? null, null, "Clear the fullpage declaration when converted inline");
    assert.equal(after.dataSources.find(entry => entry.id === source.id).ownerPageId, owner.id);
    await inline().getByRole("tab", { name: "已发布", exact: true }).waitFor();
    assert.equal(await inline().getByRole("tab", { name: "已发布", exact: true }).getAttribute("aria-selected"), "true");
  });
  await check("Creating a fullpage from the real inline gallery preserves its view, shared data and saved identity", async () => {
    const before = await saved();
    await inline().getByRole("button", { name: "视图设置", exact: true }).click();
    await page.getByRole("button", { name: "从数据源创建整页", exact: true }).click();
    const after = await persisted(value => value.pages.length === before.pages.length + 1);
    const created = after.pages.find(entry => !before.pages.some(previous => previous.id === entry.id));
    assert.equal(created.databaseSourceId, source.id);
    assert.equal(created.databaseViewId, gallery.id, "Fullpage creation must retain the invoking view instead of defaulting to table");
    for (const key of ["dataSources", "databaseViews", "databaseItems", "attachments", "pageVersions"]) assert.deepEqual(after[key], before[key], `Conversion must preserve ${key}`);
    assert.deepEqual(after.pages.filter(entry => entry.id !== created.id), before.pages, "Existing84 pages and user edits must remain unchanged");
    assert.equal(after.dataSources.find(entry => entry.id === source.id).ownerPageId, owner.id, "Linked page must not steal canonical ownership");
    await full().getByRole("tab", { name: "已发布", exact: true }).waitFor();
    assert.equal(await full().getByRole("tab", { name: "已发布", exact: true }).getAttribute("aria-selected"), "true");
    await screenshot("real-wiki-gallery-fullpage");
    await page.reload({ waitUntil: "domcontentloaded" });
    await full().getByRole("tab", { name: "已发布", exact: true }).waitFor();
    assert.equal(await full().getByRole("tab", { name: "已发布", exact: true }).getAttribute("aria-selected"), "true");
    const reopened = await saved();
    assert.equal(reopened.pages.find(entry => entry.id === created.id).databaseViewId, gallery.id);
    assert.deepEqual(reopened.databaseViews, before.databaseViews);
  });
}, { workspace });
writeFileSync(`${directory}/report.json`, JSON.stringify({ ...report, inputSnapshot: "native208", originalCounts: { pages: baseline.pages.length, items: baseline.databaseItems.length, sources: baseline.dataSources.length, views: baseline.databaseViews.length }, note: "Browser regression replays a full real workspace; reload is not native restart. Existing119 view config is functional evidence, not importer fidelity." }, null, 2), { flag: "wx" });
