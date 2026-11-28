import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";
import { groupViewItems, projectViewItems } from "../../src/domain/database.js";
import { notionViewFile162Fixture } from "./v14-notion-view-file162.mjs";
import { installWikiProjections149DesktopFixture } from "./v14-wiki-projections149.mjs";
import { sourceViewConfigurations156 } from "../../.qa/LOCAL-NOTION-001/v14-wiki-real133/import156/source-configurations156.mjs";

const archive = new URL("../../.qa/LOCAL-NOTION-001/v11-wiki-replica48/wiki-source-html48.zip", import.meta.url);
const inventory = JSON.parse(readFileSync(new URL("../../.qa/LOCAL-NOTION-001/v14-wiki-real133/wrapper148/input-collections148.json", import.meta.url), "utf8"));
const evidenceRoot = new URL("../../.qa/LOCAL-NOTION-001/v14-wiki-real133/gallery-config-fidelity/170/", import.meta.url);
const arrayKeys = (workspace) => Object.keys(workspace).filter((key) => Array.isArray(workspace[key]));
const counts = (workspace) => Object.fromEntries(arrayKeys(workspace).map((key) => [key, workspace[key].length]));
const blocksOf = (blocks) => (blocks || []).flatMap((block) => [block, ...blocksOf(block.children)]);
const one = (entries, label) => { assert.equal(entries.length, 1, label); return entries[0]; };

function assertRetained(actual, original, preview = false) {
  assert.deepEqual(arrayKeys(actual).sort(), arrayKeys(original).sort());
  for (const key of arrayKeys(original)) {
    const ids = new Set(original[key].map((entry) => entry.id));
    const retained = actual[key].filter((entry) => ids.has(entry.id));
    assert.equal(isDeepStrictEqual(retained, original[key]), true, `Every original ${key} entity, value and order must remain exact`);
    if (preview) assert.equal(isDeepStrictEqual(actual[key], original[key]), true, `Preview must not write ${key}`);
  }
  assert.equal(actual.schemaVersion, original.schemaVersion);
}

function occurrence(actual, original, configuration) {
  const added = (key) => actual[key].filter((entry) => !original[key].some((old) => old.id === entry.id));
  const sourceName = one(inventory.collections.filter((entry) => entry.member === configuration.path && entry.ordinal === configuration.collectionIndex + 1), "Frozen source occurrence").sourceTitle;
  const source = one(added("dataSources").filter((entry) => entry.title === sourceName), "One imported source");
  const page = one(added("pages").filter((entry) => entry.id !== source.ownerPageId && entry.title === sourceName && blocksOf(entry.content).some((block) => block.type === "databaseView" && block.props.sourceId === source.id)), "Original wrapper Page");
  const block = one(blocksOf(page.content).filter((entry) => entry.type === "databaseView" && entry.props.sourceId === source.id), "Original occurrence block");
  const view = one(added("databaseViews").filter((entry) => entry.id === block.props.viewId && entry.sourceId === source.id), "Occurrence-local view");
  return { source, page, block, view };
}

export async function runV14GalleryConfigImport170({ run = process.env.WIKI_GALLERY_IMPORT170_RUN || `run-${Date.now()}-${process.pid}` } = {}) {
  assert.match(run, /^[a-z0-9][a-z0-9-]{0,79}$/);
  const base = new URL(process.env.PARITY_BASE_URL || "http://127.0.0.1:5178");
  assert.equal(base.href, "http://127.0.0.1:5178/");
  const workspace = notionViewFile162Fixture();
  const expectedCounts = { ...counts(workspace), folders: 4, pages: 141, dataSources: 17, databaseItems: 96, databaseViews: 50 };
  assert.equal(inventory.archiveMembers, 62);
  assert.equal(inventory.totalCollections, 19);
  mkdirSync(evidenceRoot, { recursive: true });
  const directory = path.join(fileURLToPath(evidenceRoot), run);
  mkdirSync(directory);
  const put = (filename, value) => writeFileSync(path.join(directory, filename), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  const report = { name: "v14-gallery-config-import170", startedAt: new Date().toISOString(), run, passed: false, flows: [],
    policy: { originalCounts: counts(workspace), expectedCounts, archive: fileURLToPath(archive), archiveMembers: 62,
      path: "Normal public ZIP/optional JSON import; original149 desktop repository transport in a new context",
      limits: "No native EXE, SQLite, source UI, physical asset copy/hash, original data writes or proposal166 fields. Reload is browser transport only." } };
  const publish = () => writeFileSync(path.join(directory, "browser-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  publish();
  let browser;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ channel: "msedge", headless: true });
    for (const field of [null, "preview.kind", "cardSize", "imageFit"]) {
      const mode = field ? field.replace(".", "-") : "configured";
      const input = structuredClone(sourceViewConfigurations156);
      if (field === "preview.kind") input[0].views[0].config.gallery.preview.kind = "unsupported-preview";
      else if (field) input[0].views[0].config.gallery[field] = `unsupported-${field}`;
      const filename = `${mode}-source-input.json`;
      put(filename, input);
      const flow = { mode, field, passed: false, checks: [], errors: [] };
      report.flows.push(flow);
      let context, page;
      try {
        context = await browser.newContext({ viewport: { width: 1440, height: 1040 } });
        await context.route("**/*", (route) => {
          const url = new URL(route.request().url());
          if (["http:", "https:"].includes(url.protocol) && url.origin !== base.origin) {
            flow.errors.push({ kind: "external-request", url: url.href });
            return route.abort();
          }
          return route.continue();
        });
        await context.addInitScript(installWikiProjections149DesktopFixture, { workspace, key: workspaceStorageKey });
        page = await context.newPage();
        page.setDefaultTimeout(9000);
        page.setDefaultNavigationTimeout(15000);
        page.on("pageerror", (error) => flow.errors.push({ kind: "pageerror", message: error.stack }));
        page.on("console", (message) => { if (message.type() === "error") flow.errors.push({ kind: "console", message: message.text() }); });
        page.on("response", (response) => { if (response.status() >= 400) flow.errors.push({ kind: "http", status: response.status(), url: response.url() }); });
        const check = async (label, callback) => {
          const item = { label, passed: false };
          flow.checks.push(item); publish();
          console.log(`CHECK gallery170 ${mode}: ${label}`);
          await callback(); assert.deepEqual(flow.errors, []);
          item.passed = true; publish();
        };
        const saved = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), workspaceStorageKey);
        const settled = async () => { await page.waitForFunction(() => document.querySelector(".save-state")?.textContent === "已保存"); return saved(); };
        const dialog = () => page.getByRole("dialog", { name: "从 Notion 导入", exact: true });
        await check("Whole62-member ZIP and optional Gallery JSON preview leave all85 original Pages and122 histories untouched", async () => {
          await page.goto(base.href, { waitUntil: "domcontentloaded" });
          const sidebar = page.getByRole("complementary", { name: "主导航", exact: true });
          await sidebar.waitFor();
          assertRetained(await settled(), workspace, true);
          await sidebar.locator(".workspace-switcher").click();
          await page.getByRole("menu", { name: "工作区菜单", exact: true }).getByRole("menuitem", { name: "从 Notion 导入…", exact: true }).click();
          await dialog().getByLabel("选择 Notion 导出文件", { exact: true }).setInputFiles(fileURLToPath(archive));
          await dialog().getByRole("button", { name: "导入", exact: true }).waitFor();
          for (const [label, expected] of [["页面", 12], ["数据库", 6], ["记录", 38], ["附件", 0]]) assert.equal(await dialog().locator(`[data-count="${label}"] dd`).innerText(), String(expected));
          await dialog().getByLabel("选择视图设置文件", { exact: true }).setInputFiles(path.join(directory, filename));
          await page.waitForFunction(() => {
            const element = document.querySelector('[role="dialog"][aria-label="从 Notion 导入"]');
            return element && !element.textContent.includes("正在读取视图设置") && [...element.querySelectorAll("button")].some((button) => button.textContent.trim() === "导入" && !button.disabled);
          });
          assertRetained(await settled(), workspace, true);
        });
        await check("Public import discloses explicit invalid Gallery enums, preserves valid Board metadata and survives one transport reload", async () => {
          await dialog().getByRole("button", { name: "导入", exact: true }).click();
          await dialog().getByRole("status").filter({ hasText: "已导入" }).waitFor();
          await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) || "null")?.pages.length === 141, workspaceStorageKey);
          const actual = await settled();
          put(`${mode}-imported-workspace.json`, actual);
          assertRetained(actual, workspace);
          assert.deepEqual(counts(actual), expectedCounts);
          const importReport = await dialog().locator(".im-counts").evaluate((element) => {
            const key = Object.keys(element).find((candidate) => candidate.startsWith("__reactFiber$"));
            for (let fiber = key && element[key]; fiber; fiber = fiber.return) {
              const candidate = fiber.memoizedProps?.counts;
              if (candidate && Array.isArray(candidate.warnings) && Array.isArray(candidate.skipped) && Array.isArray(candidate.unrecognizedValues)) return JSON.parse(JSON.stringify(candidate));
            }
            throw new Error("Normal ImportExportCounts report observation point absent");
          });
          assert.deepEqual([importReport.pages, importReport.databases, importReport.records, importReport.attachments], [12, 6, 38, 0]);
          const gallery = occurrence(actual, workspace, sourceViewConfigurations156[0]);
          const board = occurrence(actual, workspace, sourceViewConfigurations156[1]);
          const invalid = importReport.warnings.filter((warning) => warning.kind === "view_configuration_invalid");
          if (field) {
            assert.equal(invalid.length, 1);
            assert.equal(invalid[0].entryIndex, 0);
            assert.equal(invalid[0].path, sourceViewConfigurations156[0].path);
            assert.equal(invalid[0].collectionIndex, 0);
            assert.ok(invalid[0].reason.includes(`gallery.${field}`));
            assert.equal(gallery.view.type, "table");
            assert.equal(gallery.view.filter, null);
            assert.deepEqual(gallery.view.sorts, []);
            assert.equal(gallery.view.groupBy, null);
            assert.deepEqual(gallery.view.config, {});
            assert.equal(Object.hasOwn(gallery.block.props, "viewIdsJson"), false);
            assert.notEqual(gallery.page.pageType, "database");
            assert.ok(importReport.warnings.some((warning) => warning.kind === "view_configuration_missing" && warning.viewId === gallery.view.id && warning.path === invalid[0].path));
          } else {
            assert.deepEqual(invalid, []);
            assert.equal(gallery.view.type, "gallery");
            assert.equal(gallery.view.name, input[0].views[0].name);
            assert.deepEqual(gallery.view.config.gallery.preview, { kind: "none", propertyId: null });
            assert.equal(gallery.view.config.gallery.cardSize, "medium");
            assert.equal(gallery.view.config.gallery.imageFit, "cover");
            assert.equal(gallery.view.config.openRecordsIn, "peek");
            assert.equal(projectViewItems(actual, gallery.view).length, 2);
            assert.deepEqual(JSON.parse(gallery.block.props.viewIdsJson), [gallery.view.id]);
          }
          assert.equal(board.view.type, "board");
          assert.equal(board.view.name, input[1].views[0].name);
          assert.equal(board.page.pageType, "database");
          assert.equal(board.page.databaseViewId, board.view.id);
          assert.deepEqual(JSON.parse(board.block.props.viewIdsJson), [board.view.id]);
          assert.deepEqual(board.view.config, {});
          assert.deepEqual(groupViewItems(actual, board.view).map((group) => group.items.length), [2, 4, 3]);
          const details = dialog().locator("details").filter({ has: page.locator("summary", { hasText: "需要检查的内容" }) });
          await details.locator("summary").click();
          const warningTexts = await details.locator("p").allTextContents();
          assert.equal(warningTexts.length, importReport.warnings.length);
          for (const warning of importReport.warnings) assert.ok(warningTexts.some((text) => text.includes(warning.reason)), "Every actual warning remains visible");
          flow.importReport = importReport;
          flow.visibleWarningTexts = warningTexts;
          flow.occurrences = { gallery: { pageId: gallery.page.id, viewId: gallery.view.id, type: gallery.view.type }, board: { pageId: board.page.id, viewId: board.view.id } };
          assert.equal(isDeepStrictEqual(JSON.parse(readFileSync(path.join(directory, filename), "utf8")), input), true);
          await dialog().getByRole("button", { name: "关闭", exact: true }).click();
          const beforeReload = await settled();
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.getByRole("complementary", { name: "主导航", exact: true }).waitFor();
          const reloaded = await settled();
          assertRetained(reloaded, workspace);
          assert.deepEqual(counts(reloaded), expectedCounts);
          for (const key of arrayKeys(beforeReload)) assert.equal(isDeepStrictEqual(reloaded[key], beforeReload[key]), true, `Reload preserves entire ${key}`);
        });
        flow.passed = flow.checks.length === 2 && flow.checks.every((item) => item.passed);
      } catch (error) {
        flow.failure = error.stack;
        console.error(error.stack);
        if (page) await page.screenshot({ path: path.join(directory, `${mode}-failure.png`), fullPage: true }).catch(() => {});
        break;
      } finally {
        await context?.close().catch((error) => flow.errors.push({ kind: "context-close", message: error.message }));
        publish();
      }
    }
    report.passed = report.flows.length === 4 && report.flows.every((flow) => flow.passed && flow.errors.length === 0);
  } catch (error) { report.failure = error.stack; console.error(error.stack); }
  finally {
    await browser?.close().catch((error) => { report.passed = false; report.failure = error.stack; });
    report.completedAt = new Date().toISOString();
    publish();
  }
  if (!report.passed) process.exitCode = 1;
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await runV14GalleryConfigImport170();
