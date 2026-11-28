import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { upgradeWorkspace } from "../../src/persistence/migrations.js";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";

const sourceId = "projects";
const attachmentId = "attachment-reference";
const addedTitle = "历史保存后创建";
const addedBody = "新记录正文留在回收站";
const alphaBody = "恢复时保留这段新正文";
const workspace = coreParityWorkspace();
workspace.workspaceId = "database-history-browser-fixture";
workspace.ui.preferences = { style: "mobai", theme: "system" };
workspace.pages.find((page) => page.id === "database-page").content = [{
  id: "history-owned-block", type: "databaseView",
  props: { sourceId, sourceIdsJson: '["projects"]', viewId: "view-table", viewIdsJson: '["view-table"]' },
}];
workspace.pages.find((page) => page.id === "editor-page").content = [{
  id: "history-linked-block", type: "databaseView",
  props: { sourceId, sourceIdsJson: '["projects"]', viewId: "view-linked", viewIdsJson: '["view-linked"]' },
}];
const table = workspace.databaseViews.find((view) => view.id === "view-table");
table.visiblePropertyIds = ["title", "notes", "checked", "files"];
workspace.databaseViews.push({ ...table, id: "view-linked", name: "外部链接视图", linked: true });
workspace.attachments = [{
  id: attachmentId, provider: "local-ref", storageKey: attachmentId, name: "history-only.txt", mime: "text/plain",
}];
for (const item of workspace.databaseItems) {
  if (item.id !== "alpha") delete item.values.files;
}

const entity = (state, collection, id) => state[collection].find((entry) => entry.id === id);
const field = (state, id) => entity(state, "dataSources", sourceId).properties.find((entry) => entry.id === id);
const values = (state, id) => entity(state, "databaseItems", id).values;
const histories = (state) => state.databaseVersions.filter((entry) => entry.sourceId === sourceId);
const recordBodies = (state) => Object.fromEntries(state.databaseItems.map(({ pageId }) => [pageId, entity(state, "pages", pageId).content]));
const graph = (state) => Object.fromEntries(["pages", "dataSources", "databaseItems", "databaseViews", "relations", "databaseVersions", "attachments"].map((key) => [key, state[key]]));
const base = process.env.PARITY_BASE_URL || "http://127.0.0.1:5178";
const evidence = process.env.LIFE_ATLAS_HISTORY_QA_DIR;
const browser = await chromium.launch({ channel: "msedge", headless: true });
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1420, height: 960 } });
  await context.addInitScript(({ seed, key }) => {
    if (!localStorage.getItem("life-atlas.database-history-probe-seed")) {
      localStorage.setItem(key, JSON.stringify(seed));
      localStorage.setItem("life-atlas.database-history-probe-seed", "1");
    }
  }, { seed: upgradeWorkspace(workspace), key: workspaceStorageKey });
  page = await context.newPage();
  page.setDefaultTimeout(11000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const saved = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), workspaceStorageKey);
  const persisted = async (condition, label) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const state = await saved();
      if (condition(state)) return state;
      await page.waitForTimeout(125);
    }
    assert.ok(condition(await saved()), label);
  };
  const screenshot = async (name) => {
    if (!evidence) return;
    fs.mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: path.join(evidence, `${name}.png`), animations: "disabled" });
  };

  const db = page.locator('.database-view[data-view-id="view-table"]');
  const dialog = page.locator('[data-la-dialog="database-history"]');
  const checkbox = (id) => db.locator(`tr[data-item-id="${id}"] td[data-property-id="checked"] input`);
  const itemMenu = async (id) => {
    const row = db.locator(`tr[data-item-id="${id}"]`);
    await row.hover();
    await row.getByRole("button", { name: /记录操作/ }).click();
    return page.getByRole("menu", { name: /记录菜单/ });
  };
  const propertyMenu = async (name) => {
    await db.getByRole("button", { name: `编辑 ${name} 属性`, exact: true }).click();
    return page.getByRole("menu", { name: `${name} 属性菜单`, exact: true });
  };
  const openHistory = async () => {
    await page.getByRole("button", { name: "页面操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "数据库历史", exact: true }).click();
    await dialog.waitFor();
  };
  const selectManualVersion = () => dialog.getByRole("button", { name: /手动保存/ }).click();
  const confirm = (title) => page.getByRole("alertdialog", { name: title, exact: true });
  const closeHistory = async () => {
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  };
  const returnToDb = async () => {
    await page.getByRole("complementary", { name: "主导航" }).locator('[data-node-id="database-page"]').click();
    await db.waitFor();
  };
  const openRecord = async (id, pageId) => {
    await (await itemMenu(id)).getByRole("menuitem", { name: "在完整页面中打开", exact: true }).click();
    const editor = page.locator(`.life-editor[data-page-id="${pageId}"] .bn-editor`);
    await editor.waitFor();
    return editor;
  };
  const setCurrentBody = async (editor, text) => {
    const paragraph = editor.locator(".bn-inline-content").first();
    await paragraph.click();
    await page.keyboard.press("End");
    await page.keyboard.insertText(text);
  };
  const setAttachment = (available) => page.evaluate(async ({ id, available }) => {
    const { writeBrowserAttachmentBlob, removeBrowserAttachmentBlob } = await import("/src/domain/attachments.js");
    if (available) await writeBrowserAttachmentBlob(id, new Blob(["existing history bytes"], { type: "text/plain" }));
    else await removeBrowserAttachmentBlob(id);
  }, { id: attachmentId, available });

  await page.goto(base, { waitUntil: "domcontentloaded" });
  await db.waitFor();
  await setAttachment(true);
  await openHistory();
  const focusInDialog = await dialog.evaluate((element) => element.contains(document.activeElement));
  assert.equal(focusInDialog, true);
  await dialog.getByRole("button", { name: "保存当前版本", exact: true }).click();
  const seed = await persisted((state) => histories(state).some((version) => version.reason === "manual"), "Manual version must persist");
  const manual = histories(seed).find((version) => version.reason === "manual");
  assert.ok(manual.items.every((item) => !Object.hasOwn(item, "content")));
  assert.equal(manual.views.some((view) => view.id === "view-linked"), false);
  await closeHistory();
  assert.equal(await page.getByRole("button", { name: "页面操作", exact: true }).evaluate((element) => document.activeElement === element), true);
  console.log("PASS manual capture and dialog keyboard focus");

  const notes = await propertyMenu("说明");
  const name = notes.getByRole("textbox", { name: "属性名称", exact: true });
  await name.fill("改过的说明");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await persisted((state) => field(state, "notes").name === "改过的说明", "Property rename must persist");
  await checkbox("alpha").check();
  await (await propertyMenu("改过的说明")).getByRole("menuitem", { name: "降序排序", exact: true }).click();
  await (await propertyMenu("附件")).getByRole("menuitem", { name: "删除属性", exact: true }).click();
  await confirm("删除属性").getByRole("button", { name: "删除属性", exact: true }).click();
  const removed = await persisted((state) => !field(state, "files"), "Property deletion must persist");
  assert.equal(Object.hasOwn(values(removed, "alpha"), "files"), false);
  assert.ok(histories(removed).some((version) => version.reason === "before-edit"
    && version.source.properties.some((entry) => entry.id === "files") && version.items.find((item) => item.id === "alpha").values.checked === true));

  await setCurrentBody(await openRecord("alpha", "alpha-page"), alphaBody);
  await persisted((state) => JSON.stringify(entity(state, "pages", "alpha-page").content).includes(alphaBody), "Current row body edit must persist");
  await returnToDb();
  await db.locator(".db-table-create").click();
  const title = db.locator(".db-title-editor");
  await title.fill(addedTitle);
  await title.press("Enter");
  const created = await persisted((state) => state.databaseItems.some((item) => item.values.title === addedTitle), "New record must persist");
  const added = created.databaseItems.find((item) => item.values.title === addedTitle);
  await setCurrentBody(await openRecord(added.id, added.pageId), addedBody);
  await persisted((state) => JSON.stringify(entity(state, "pages", added.pageId).content).includes(addedBody), "New row body must persist");
  await returnToDb();
  await (await itemMenu("gamma")).getByRole("menuitem", { name: "移到回收站", exact: true }).click();
  await confirm("移到回收站").getByRole("button", { name: "移到回收站", exact: true }).click();
  const changed = await persisted((state) => Boolean(entity(state, "pages", "gamma-page").trashedAt), "Soft-deleted row must persist");
  assert.equal(values(changed, "alpha").checked, true);
  console.log("PASS actual field, row, view, and body edits with automatic capture");

  await openHistory();
  await selectManualVersion();
  await dialog.getByText(/从回收站恢复 1 条记录/).waitFor();
  await dialog.getByText(/将 1 条此版本之后的记录移到回收站/).waitFor();
  await dialog.getByText(/table view.*排序/).waitFor();
  await dialog.getByLabel("预览单条记录").selectOption("alpha");
  const comparison = dialog.getByRole("table");
  await comparison.getByRole("row", { name: /确认/ }).waitFor();
  await screenshot("database-history-preview");
  const beforePreview = graph(await saved());
  const full = dialog.getByRole("button", { name: "恢复整个数据库", exact: true });
  await full.click();
  assert.equal(await confirm("恢复数据库版本").getByRole("button", { name: "确认恢复", exact: true })
    .evaluate((element) => document.activeElement === element), true);
  await confirm("恢复数据库版本").getByRole("button", { name: "取消", exact: true }).click();
  assert.deepEqual(graph(await saved()), beforePreview);

  await setAttachment(false);
  await full.click();
  await confirm("恢复数据库版本").getByRole("button", { name: "确认恢复", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: /历史附件.*文件不可用/ }).waitFor();
  assert.deepEqual(graph(await saved()), beforePreview);
  await setAttachment(true);
  console.log("PASS preview and missing file leave the persisted graph intact");

  await full.click();
  await confirm("恢复数据库版本").waitFor();
  // Deliver a real table input event while the old preview remains in the confirm dialog.
  await checkbox("beta").evaluate((input) => input.click());
  const later = await persisted((state) => values(state, "beta").checked === true, "Concurrent table edit must persist");
  await confirm("恢复数据库版本").getByRole("button", { name: "确认恢复", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: /请重新预览/ }).waitFor();
  assert.deepEqual(graph(await saved()), graph(later));
  console.log("PASS stale confirmation preserves concurrent data without partial writes");

  await full.click();
  await confirm("恢复数据库版本").getByRole("button", { name: "确认恢复", exact: true }).click();
  const restored = await persisted((state) => field(state, "files") && !entity(state, "pages", "gamma-page").trashedAt
    && Boolean(entity(state, "pages", added.pageId).trashedAt), "Whole database restore must persist");
  assert.equal(field(restored, "notes").name, "说明");
  assert.deepEqual(values(restored, "alpha").files, [attachmentId]);
  assert.equal(values(restored, "alpha").checked, false);
  assert.equal(values(restored, "beta").checked, false);
  assert.deepEqual(recordBodies(restored), recordBodies(later));
  assert.deepEqual(entity(restored, "databaseViews", "view-table").sorts, table.sorts);
  assert.deepEqual(entity(restored, "databaseViews", "view-linked"), entity(later, "databaseViews", "view-linked"));
  assert.ok(histories(restored).some((version) => version.reason === "pre-restore" && version.items.some((item) => item.id === added.id)));
  assert.equal(await db.locator(`tr[data-item-id="${added.id}"]`).count(), 0);
  await closeHistory();
  console.log("PASS whole restore rewinds source and row data while preserving every current row body");

  await checkbox("alpha").check();
  await checkbox("beta").check();
  await openRecord("alpha", "alpha-page");
  const beforeSingle = await persisted((state) => values(state, "alpha").checked === true && values(state, "beta").checked === true,
    "Distinct current row values must persist");
  await openHistory();
  await selectManualVersion();
  assert.equal(await dialog.getByLabel("预览单条记录").inputValue(), "alpha");
  await dialog.getByRole("button", { name: "恢复这条记录", exact: true }).click();
  await confirm("恢复这条记录").getByRole("button", { name: "确认恢复", exact: true }).click();
  const single = await persisted((state) => values(state, "alpha").checked === false, "Single record restore must persist");
  assert.equal(values(single, "beta").checked, true);
  assert.deepEqual(single.pages, beforeSingle.pages);
  assert.deepEqual(single.dataSources, beforeSingle.dataSources);
  assert.deepEqual(single.databaseViews, beforeSingle.databaseViews);
  assert.deepEqual(single.relations, beforeSingle.relations);
  await closeHistory();
  await page.reload();
  await page.locator('.life-editor[data-page-id="alpha-page"]').waitFor();
  assert.deepEqual(recordBodies(await saved()), recordBodies(single));
  await openHistory();
  assert.equal(await dialog.getByRole("button", { name: /恢复前/ }).count(), 2);
  await closeHistory();
  assert.deepEqual(errors, []);
  console.log("PASS single restore stays within the chosen record and history survives browser reload");
} catch (failure) {
  if (page && evidence) {
    fs.mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: path.join(evidence, "database-history-failure.png"), animations: "disabled", timeout: 5000 }).catch(() => {});
    const body = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    fs.writeFileSync(path.join(evidence, "database-history-failure.txt"), body);
  }
  throw failure;
} finally {
  await browser.close();
}
