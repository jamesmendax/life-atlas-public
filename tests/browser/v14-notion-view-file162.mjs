import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";
import { installWikiProjections149DesktopFixture } from "./v14-wiki-projections149.mjs";
import { sourceViewConfigurations156 } from "../../.qa/LOCAL-NOTION-001/v14-wiki-real133/import156/source-configurations156.mjs";
import { projectViewItems, groupViewItems } from "../../src/domain/database.js";

// Parent runs this headless module. Import alone starts nothing and writes nothing.
const snapshotUrl = new URL("../../.qa/LOCAL-NOTION-001/v14-wiki-real133/context136/native-selection141-final-closed35.json", import.meta.url);
const archiveUrl = new URL("../../.qa/LOCAL-NOTION-001/v11-wiki-replica48/wiki-source-html48.zip", import.meta.url);
const qaUrl = new URL("../../.qa/LOCAL-NOTION-001/v14-wiki-real133/import162/", import.meta.url);
const counts = state => Object.fromEntries(Object.entries(state).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length]));
const one = (values, label) => { assert.equal(values.length, 1, label); return values[0]; };

export function notionViewFile162Fixture() {
  const workspace = JSON.parse(readFileSync(snapshotUrl, "utf8")).workspace;
  assert.deepEqual(counts(workspace), { folders: 3, pages: 85, dataSources: 11, databaseItems: 58, databaseViews: 31,
    relations: 0, syncedSources: 0, attachments: 20, people: 1, pageTemplates: 0, databaseTemplates: 0,
    discussions: 0, comments: 0, pageVersions: 122 });
  const initial = one(workspace.pages.filter(entry => entry.id === "page-c2bf1d3d-69c3-4054-a92d-e7bd5fca6f4c"), "Existing asset-free136 linked Page");
  assert.equal(initial.title, "随笔");
  assert.deepEqual(initial.content.map(block => block.type), ["databaseView"]);
  workspace.ui = { ...workspace.ui, activeSection: "private", selectedPageId: initial.id, selectedBlockId: null,
    selectedFolderId: initial.folderId, privateExpanded: true,
    expandedFolderIds: workspace.folders.map(entry => entry.id), expandedPageIds: workspace.pages.map(entry => entry.id),
    preferences: { ...workspace.ui.preferences, startPage: "last", theme: "light" } };
  return workspace;
}

export async function runV14NotionViewFile162({ run = process.env.WIKI_VIEW_FILE162_RUN || `run-${Date.now()}-${process.pid}` } = {}) {
  assert.match(run, /^[a-z0-9][a-z0-9-]{0,79}$/);
  const base = new URL(process.env.PARITY_BASE_URL || "http://127.0.0.1:5178");
  assert.equal(base.href, "http://127.0.0.1:5178/", "Parent's isolated5178 only");
  const workspace = notionViewFile162Fixture();
  const directory = path.join(fileURLToPath(qaUrl), run);
  mkdirSync(directory, { recursive: false }); // Never replace earlier RED/GREEN evidence.
  const put = (name, value) => writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  const report = { run, phase: "full", startedAt: new Date().toISOString(), passed: false, checks: [], errors: [], screenshots: [],
    policy: { baseline: fileURLToPath(snapshotUrl), archive: fileURLToPath(archiveUrl), counts: counts(workspace),
      flow: "Public whole actual ZIP preview; full85 entities/all14 arrays/122 histories, existing149 one-shot desktop transport before app load",
      limits: "Headless isolated browser only; no native/foreground UI, builder invocation, source hashes, attachment reads or original-root writes" } };
  const publish = () => writeFileSync(path.join(directory, "browser-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  let browser, page;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ channel: "msedge", headless: true });
    for (const mode of ["configured", "no-settings", "invalid-reference"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1040 } });
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (["http:", "https:"].includes(url.protocol) && url.origin !== base.origin) {
        report.errors.push({ kind: "external-request", url: url.href }); return route.abort();
      }
      return route.continue();
    });
    await context.addInitScript(installWikiProjections149DesktopFixture, { workspace, key: workspaceStorageKey });
    page = await context.newPage(); page.setDefaultTimeout(9000); page.setDefaultNavigationTimeout(15000);
    page.on("pageerror", error => report.errors.push({ kind: "pageerror", message: error.stack }));
    page.on("console", message => { if (message.type() === "error") report.errors.push({ kind: "console", message: message.text() }); });
    page.on("response", response => { if (response.status() >= 400) report.errors.push({ kind: "http", status: response.status(), url: response.url() }); });
    const item = { label: "Full85 real Wiki public whole-ZIP preview exposes exactly one optional source-view configuration file input", startedAt: new Date().toISOString(), passed: false };
    item.label = `${mode}: ${item.label}`;
    report.checks.push(item); publish(); console.log(`CHECK import162: ${item.label}`);
    await page.goto(base.href, { waitUntil: "domcontentloaded" });
    const sidebar = page.getByRole("complementary", { name: "主导航" }); await sidebar.waitFor();
    await page.getByRole("textbox", { name: "页面标题", exact: true }).filter({ visible: true }).waitFor();
    await sidebar.locator(".workspace-switcher").click();
    await page.getByRole("menu", { name: "工作区菜单", exact: true }).getByRole("menuitem", { name: "从 Notion 导入…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "从 Notion 导入", exact: true });
    await dialog.getByLabel("选择 Notion 导出文件", { exact: true }).setInputFiles(fileURLToPath(archiveUrl));
    await dialog.getByRole("button", { name: "导入", exact: true }).waitFor();
    for (const [label, expected] of [["页面", 12], ["数据库", 6], ["记录", 38], ["附件", 0]]) {
      assert.equal(await dialog.locator(`[data-count="${label}"] dd`).innerText(), String(expected));
    }
    const current = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), workspaceStorageKey);
    assert.deepEqual(counts(current), counts(workspace), "Load the complete85-Page fixture and all14 arrays before preview");
    assert.deepEqual(current.pageVersions, workspace.pageVersions, "Preview retains all122 histories exactly");
    for (const key of Object.keys(workspace).filter(key => Array.isArray(workspace[key]))) assert.deepEqual(current[key], workspace[key], `Preview keeps all ${key}`);
    put(`${mode}-real-zip-preview.json`, { archive: fileURLToPath(archiveUrl), counts: counts(current), body: await dialog.innerText() });
    assert.equal(await dialog.locator('input[type="file"][aria-label="选择视图设置文件"]').count(), 1,
      "After the real complete ZIP preview the normal dialog must expose exactly one optional metadata file input");
    assert.deepEqual(report.errors, []);
    item.passed = true; item.completedAt = new Date().toISOString(); publish();
    const check = async (label, action) => {
      const result = { label: `${mode}: ${label}`, passed: false };
      report.checks.push(result); publish(); console.log(`CHECK import162: ${result.label}`);
      await action(); result.passed = true; publish();
    };
    const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), workspaceStorageKey);
    const retained = (actual) => {
      assert.deepEqual(Object.keys(counts(actual)), Object.keys(counts(workspace)), "All14 arrays remain");
      for (const key of Object.keys(workspace).filter(key => Array.isArray(workspace[key]))) {
        const ids = new Set(workspace[key].map(entry => entry.id));
        assert.deepEqual(actual[key].filter(entry => ids.has(entry.id)), workspace[key], `All old ${key} entities remain exact`);
      }
    };
    let actual;
    const added = key => actual[key].filter(entry => !workspace[key].some(old => old.id === entry.id));
    await check("The public file input reaches the generic importer while the complete existing Wiki stays intact", async () => {
      if (mode !== "no-settings") {
        const configuration = structuredClone(sourceViewConfigurations156);
        if (mode === "invalid-reference") {
          configuration.splice(1);
          configuration[0].views[0].filter = { propertyId: "确实不存在的属性162", operator: "checked" };
        }
        put(`${mode}-source-input.json`, configuration);
        await dialog.getByLabel("选择视图设置文件", { exact: true }).setInputFiles({ name: `${mode}.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(configuration)) });
        await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="从 Notion 导入"]')?.textContent.includes("正在读取视图设置"));
        assert.equal(await dialog.getByRole("button", { name: "导入", exact: true }).isEnabled(), true);
      }
      await dialog.getByRole("button", { name: "导入", exact: true }).click();
      await dialog.getByRole("status").filter({ hasText: "已导入" }).waitFor();
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || "null")?.pages.length === 141, workspaceStorageKey);
      actual = await saved(); retained(actual);
      assert.deepEqual([added("pages").length, added("databaseItems").length, added("dataSources").length, added("databaseViews").length, added("attachments").length], [56, 38, 6, 19, 0]);
      assert.equal(actual.pageVersions.length, 122);
      put(`${mode}-complete-import.json`, actual);
      const warnings = dialog.locator("details").filter({ has: page.locator("summary", { hasText: "需要检查的内容" }) });
      await warnings.locator("summary").click();
      const texts = await warnings.locator("p").allTextContents();
      if (mode !== "configured") {
        assert.ok(added("databaseViews").every(view => view.type === "table" && view.filter === null && view.sorts.length === 0));
        assert.equal(texts.filter(text => text.includes("导出文件未提供原视图的名称、布局、筛选、排序、分组和属性显示设置")).length, 19);
        if (mode === "invalid-reference") assert.ok(texts.some(text => text.includes("确实不存在的属性162")), "Invalid reference remains disclosed alongside the original fallback");
      } else {
        for (const name of ["文章 · 精选", "札记 · 阶段"]) assert.ok(texts.some(text => text.includes(name) && text.includes("仍未提供的字段")), "Partial source settings still disclose unknown fields");
      }
    });
    if (mode === "configured") await check("Normal sidebar opens the imported Gallery and Board, and reload keeps their own views", async () => {
      const blocks = entries => (entries || []).flatMap(block => [block, ...blocks(block.children)]);
      const wrapper = name => {
        const source = one(added("dataSources").filter(entry => entry.title === name), `One imported ${name} source`);
        const page = one(added("pages").filter(entry => entry.pageType === "database" && entry.databaseSourceId === source.id && entry.id !== source.ownerPageId), "Explicit original wrapper declaration");
        const block = one(blocks(page.content).filter(entry => entry.type === "databaseView"), "Original wrapper block");
        const view = one(added("databaseViews").filter(entry => entry.id === block.props.viewId), "Own imported view");
        assert.deepEqual(JSON.parse(block.props.viewIdsJson), [view.id]);
        assert.equal(page.databaseViewId, view.id);
        return { source, page, block, view };
      };
      const gallery = wrapper("文章"), board = wrapper("札记");
      assert.equal(gallery.view.type, "gallery"); assert.equal(gallery.view.name, "文章 · 精选");
      assert.equal(board.view.type, "board"); assert.equal(board.view.name, "札记 · 阶段");
      assert.equal(projectViewItems(actual, gallery.view).length, 2);
      assert.deepEqual(groupViewItems(actual, board.view).map(group => group.items.length), [2, 4, 3]);
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
      const folder = one(added("folders"), "One new import folder");
      await sidebar.getByRole("button", { name: `展开${folder.name}`, exact: true }).click();
      const root = one(added("pages").filter(entry => entry.title === "Mendax 的 Vibe Coding Wiki"), "Actual imported Wiki root");
      await sidebar.locator(`[data-node-id="${root.id}"]`).getByRole("button", { name: `展开${root.title}`, exact: true }).click();
      for (const entry of [gallery, board]) {
        await sidebar.locator(`[data-node-id="${entry.page.id}"] > .sidebar-page-main`).click();
        const surface = page.locator(`section.database-view[data-view-id="${entry.view.id}"]`);
        await surface.waitFor();
        assert.equal(await surface.getAttribute("data-view-type"), entry.view.type);
        assert.equal(await surface.getByRole("tab", { name: entry.view.name, exact: true }).count(), 1);
        assert.equal(await surface.getByRole("tab").count(), 1);
        if (entry === gallery) assert.equal(await surface.locator("article").count(), 2);
        else assert.deepEqual(await surface.locator(".db-board-column").evaluateAll(columns => columns.map(column => column.querySelectorAll("article").length)), [2, 4, 3]);
      }
      const beforeReload = await saved(); retained(beforeReload);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator(`section.database-view[data-view-id="${board.view.id}"][data-view-type="board"]`).waitFor();
      const after = await saved(); retained(after);
      assert.deepEqual(after.databaseViews, beforeReload.databaseViews);
      assert.deepEqual(after.pageVersions, workspace.pageVersions);
      assert.equal(after.ui.selectedPageId, board.page.id);
      put(`${mode}-after-reload.json`, after);
    });
    assert.deepEqual(report.errors, []);
    await context.close();
    }
    report.passed = report.checks.every(check => check.passed);
  } catch (error) {
    report.failure = error.stack; console.error(`FAIL import162: ${error.stack}`); process.exitCode = 1;
    if (page) {
      await page.screenshot({ path: path.join(directory, "failure.png"), fullPage: true }).then(() => report.screenshots.push("failure.png")).catch(() => {});
      report.bodyExcerpt = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "Renderer unavailable");
    }
  } finally {
    await browser?.close().catch(error => { report.passed = false; report.errors.push({ kind: "close", message: error.message }); process.exitCode = 1; });
    report.completedAt = new Date().toISOString(); publish();
  }
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await runV14NotionViewFile162();
