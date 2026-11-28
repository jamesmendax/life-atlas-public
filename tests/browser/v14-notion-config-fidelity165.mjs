import assert from "node:assert/strict";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";
import { projectViewItems, groupViewItems } from "../../src/domain/database.js";
import { notionViewFile162Fixture } from "./v14-notion-view-file162.mjs";
import { installWikiProjections149DesktopFixture } from "./v14-wiki-projections149.mjs";
import { sourceViewConfigurations156 } from "../../.qa/LOCAL-NOTION-001/v14-wiki-real133/import156/source-configurations156.mjs";

// Worker165: import/audit starts no browser/server and writes nothing. The parent
// invokes the run export against its isolated5178 preview after the164 mapper fix.
const qaRoot = new URL("../../.qa/LOCAL-NOTION-001/v14-wiki-real133/", import.meta.url);
const archiveFile = new URL("../v11-wiki-replica48/wiki-source-html48.zip", qaRoot);
const acceptedSettingsFile = new URL("import162/parent-full02/configured-source-input.json", qaRoot);
const inventoryFile = new URL("wrapper148/input-collections148.json", qaRoot);
const factsFile = new URL("import143/facts143.json", qaRoot);
const evidenceRoot = new URL("fidelity165/", qaRoot);
const readJSON = file => JSON.parse(readFileSync(file, "utf8"));
const arrayKeys = value => Object.keys(value).filter(key => Array.isArray(value[key]));
const counts = value => Object.fromEntries(arrayKeys(value).map(key => [key, value[key].length]));
const blocksOf = blocks => (blocks || []).flatMap(block => [block, ...blocksOf(block.children)]);
const one = (entries, label) => { assert.equal(entries.length, 1, label); return entries[0]; };
const expectedCounts = { folders: 3, pages: 85, dataSources: 11, databaseItems: 58, databaseViews: 31,
  relations: 0, syncedSources: 0, attachments: 20, people: 1, pageTemplates: 0, databaseTemplates: 0,
  discussions: 0, comments: 0, pageVersions: 122 };
const expectedImportedCounts = { ...expectedCounts, folders: 4, pages: 141, dataSources: 17, databaseItems: 96, databaseViews: 50 };
const missingReason = "导出文件未提供原视图的名称、布局、筛选、排序、分组和属性显示设置";
const modes = ["side-invalid", "configured", "no-settings"];

export function auditV14NotionConfigFidelity165() {
  const workspace = notionViewFile162Fixture();
  const configurations = readJSON(acceptedSettingsFile);
  const inventory = readJSON(inventoryFile), facts = readJSON(factsFile);
  assert.deepEqual(counts(workspace), expectedCounts, "Full162/native35 project; every old array/history retained");
  assert.deepEqual(configurations, sourceViewConfigurations156, "Exact optional JSON accepted by161/162, not inferred HTML settings");
  assert.equal(configurations.length, 2);
  assert.equal(configurations[0].views[0].config.openRecordsIn, "peek");
  assert.equal(configurations[0].views[0].type, "gallery");
  assert.equal(configurations[1].views[0].type, "board");
  assert.equal(Object.hasOwn(configurations[1].views[0], "config"), false, "Accepted156 leaves unrepresentable Side peek unknown");
  assert.equal(statSync(archiveFile).isFile(), true); // No ZIP/attachment bytes or hashes in worker preparation.
  assert.deepEqual([facts.counts.archiveMembers, facts.counts.htmlMembers, facts.counts.csvMembers,
    facts.counts.totalImportedPages, facts.counts.records, facts.counts.databases, facts.counts.localAttachments], [62, 56, 6, 56, 38, 6, 0]);
  assert.equal(inventory.archive, facts.archive);
  assert.equal(inventory.archiveMembers, 62);
  assert.equal(inventory.totalCollections, 19);
  assert.equal(inventory.collections.length, 19);
  assert.equal(inventory.additionalLinkedOccurrences.length, 2);
  for (const config of configurations) one(inventory.collections.filter(entry => entry.member === config.path && entry.ordinal === config.collectionIndex + 1), "Original156 occurrence is in complete148 inventory");
  const side = structuredClone(configurations);
  side[1].views[0].config = { openRecordsIn: "side" };
  assert.deepEqual(side[0], configurations[0], "Bad W2 cannot alter valid W1 input");
  const restored = structuredClone(side); delete restored[1].views[0].config;
  assert.deepEqual(restored, configurations, "Only observed W2 Side peek differs from accepted156 input");
  return { name: "v14-notion-config-fidelity165", arrays: counts(workspace), archive: fileURLToPath(archiveFile),
    acceptedSettings: fileURLToPath(acceptedSettingsFile), inventory: fileURLToPath(inventoryFile), facts: fileURLToPath(factsFile),
    archiveVerification: "Existing frozen143/148 facts plus file existence; no worker ZIP read or hash",
    archiveMembers: 62, htmlMembers: 56, csvMembers: 6, fullCollections: 19,
    expectedAdded: { folders: 1, pages: 56, dataSources: 6, databaseItems: 38, databaseViews: 19, attachments: 0 },
    expectedBaseline: "Parent integration164/probe-before164.log/.json: actual mapper->createDatabaseView accepted side and stored peek. side-invalid check must be RED on that implementation.",
    modes, checks: 6, workspace, configurations, side };
}

function assertRetained165(actual, original, { preview = false } = {}) {
  assert.deepEqual(arrayKeys(actual).sort(), arrayKeys(original).sort(), "All14 arrays survive");
  for (const key of arrayKeys(original)) {
    const ids = new Set(original[key].map(entry => entry.id));
    assert.deepEqual(actual[key].filter(entry => ids.has(entry.id)), original[key], `Every original ${key} entity/order/value remains exact`);
    if (preview) assert.deepEqual(actual[key], original[key], `Preview must not write ${key}`);
  }
  assert.equal(actual.schemaVersion, original.schemaVersion);
  assert.deepEqual(actual.pageVersions, original.pageVersions, "Exactly122 original histories, no backfill or replacement");
}

function importedOccurrence165(actual, original, config, inventory) {
  const added = key => actual[key].filter(entry => !original[key].some(old => old.id === entry.id));
  const sourceName = config === undefined ? null : one(inventory.collections.filter(entry => entry.member === config.path && entry.ordinal === config.collectionIndex + 1), "Frozen occurrence").sourceTitle;
  const source = one(added("dataSources").filter(entry => entry.title === sourceName), `One imported ${sourceName} source`);
  const page = one(added("pages").filter(entry => entry.id !== source.ownerPageId && entry.title === sourceName &&
    blocksOf(entry.content).some(block => block.type === "databaseView" && block.props.sourceId === source.id)), "Original wrapper Page and own source block");
  const block = one(blocksOf(page.content).filter(entry => entry.type === "databaseView" && entry.props.sourceId === source.id), "Original wrapper database block");
  const view = one(added("databaseViews").filter(entry => entry.id === block.props.viewId && entry.sourceId === source.id), "Own occurrence view");
  return { source, page, block, view };
}

function assertKnown165(actual, entry, config) {
  const property = name => one(entry.source.properties.filter(prop => prop.name === name), `Exact same-source property ${name}`);
  const ids = names => names.map(name => property(name).id);
  assert.equal(entry.view.name, config.views[0].name);
  assert.equal(entry.view.type, config.views[0].type);
  assert.equal(entry.page.pageType, "database");
  assert.equal(entry.page.databaseSourceId, entry.source.id);
  assert.equal(entry.page.databaseViewId, entry.view.id);
  assert.deepEqual(JSON.parse(entry.block.props.viewIdsJson), [entry.view.id]);
  assert.deepEqual(entry.view.visiblePropertyIds, ids(config.views[0].visiblePropertyIds));
  assert.deepEqual(entry.view.sorts, config.views[0].sorts.map(sort => ({ propertyId: property(sort.propertyId).id, direction: sort.direction })));
  if (entry.view.type === "gallery") {
    const published = one(property("状态").options.filter(option => option.name === "Published"), "Known Published option");
    assert.deepEqual(entry.view.filter, { kind: "group", op: "and", children: [
      { kind: "condition", propertyId: property("状态").id, operator: "equals", value: published.id },
      { kind: "condition", propertyId: property("首页精选").id, operator: "checked" },
    ] });
    assert.equal(entry.view.config.openRecordsIn, "peek", "W1's explicitly observed Center peek remains peek");
    assert.deepEqual(entry.view.config.gallery.preview, { kind: "none", propertyId: null });
    assert.equal(entry.view.config.gallery.cardSize, "medium");
    assert.deepEqual(entry.view.config.gallery.visiblePropertyIds, ids(["标题", "摘要", "发布日期"]));
    assert.equal(projectViewItems(actual, entry.view).length, 2);
  } else {
    assert.deepEqual(entry.view.filter, { propertyId: property("公开").id, operator: "checked" });
    assert.equal(entry.view.groupBy, property("阶段").id);
    assert.deepEqual(entry.view.grouping, { primaryPropertyId: property("阶段").id, secondaryPropertyId: null,
      order: ["初记", "成形", "推演"].map(name => one(property("阶段").options.filter(option => option.name === name), `Known stage ${name}`).id),
      hiddenGroupKeys: ["未分组"], showEmpty: false });
    assert.deepEqual(entry.view.config, {}, "Omitted source config remains unknown, never a claim of source Center peek");
    assert.deepEqual(groupViewItems(actual, entry.view).map(group => group.items.length), [2, 4, 3]);
  }
}

function assertFallback165(entry) {
  assert.equal(entry.view.type, "table");
  assert.equal(entry.view.filter, null);
  assert.deepEqual(entry.view.sorts, []);
  assert.equal(entry.view.groupBy, null);
  assert.deepEqual(entry.view.config, {}, "Reject the entry, never normalize requested side into peek");
  assert.equal(Object.hasOwn(entry.block.props, "viewIdsJson"), false, "Invalid/absent metadata adds no source membership declaration");
  assert.notEqual(entry.page.pageType, "database", "Rejected metadata adds no wrapper declaration");
  assert.notEqual(entry.view.name, "札记 · 阶段");
}

export async function runV14NotionConfigFidelity165({ run = process.env.WIKI_CONFIG_FIDELITY165_RUN || `run-${Date.now()}-${process.pid}` } = {}) {
  assert.match(run, /^[a-z0-9][a-z0-9-]{0,79}$/);
  const base = new URL(process.env.PARITY_BASE_URL || "http://127.0.0.1:5178");
  assert.equal(base.href, "http://127.0.0.1:5178/", "Parent's isolated5178 preview only");
  const { workspace, configurations, side, ...audit } = auditV14NotionConfigFidelity165();
  const inventory = readJSON(inventoryFile);
  mkdirSync(evidenceRoot, { recursive: true });
  const directory = path.join(fileURLToPath(evidenceRoot), run);
  mkdirSync(directory); // Existing run IDs fail; never replace prior RED/GREEN evidence.
  const put = (filename, value) => writeFileSync(path.join(directory, filename), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  put("fixture-audit165.json", audit);
  const report = { name: audit.name, run, startedAt: new Date().toISOString(), passed: false, fixtureAudit: audit, modes: [],
    outputDirectory: directory, finalPersistedWorkspaceFiles: [],
    reportObservation: "Read-only observation of the rendered ImportExportCounts counts prop (the real result.report plus attachmentBytes), via its DOM React fiber. No module rewriting, direct builder call, prop/state mutation, warning reclassification or result substitution. Fails if the existing observation point is absent.",
    limits: "Parent-only headless run. Full real archive/full85 project/all14 arrays/122 histories. No native/foreground operations, source or asset hashes, attachment transport, real-root writes, server/build/Git/deps/schema/crypto. Browser reload is context-local149 desktop transport, not SQLite/native acceptance. Whole Wiki remains open." };
  const publish = () => writeFileSync(path.join(directory, "browser-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  publish();
  let browser;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ channel: "msedge", headless: true });
    for (const mode of modes) {
      const flow = { id: mode, passed: false, errors: [], checks: [], files: {} };
      report.modes.push(flow); publish();
      let context, page;
      try {
        context = await browser.newContext({ viewport: { width: 1440, height: 1040 } });
        await context.route("**/*", route => {
          const url = new URL(route.request().url());
          if (["http:", "https:"].includes(url.protocol) && url.origin !== base.origin) { flow.errors.push({ kind: "external-request", url: url.href }); return route.abort(); }
          return route.continue();
        });
        await context.addInitScript(installWikiProjections149DesktopFixture, { workspace, key: workspaceStorageKey });
        page = await context.newPage(); page.setDefaultTimeout(9000); page.setDefaultNavigationTimeout(15000);
        page.on("pageerror", error => flow.errors.push({ kind: "pageerror", message: error.stack }));
        page.on("console", message => { if (message.type() === "error") flow.errors.push({ kind: "console", message: message.text() }); });
        page.on("response", response => { if (response.status() >= 400) flow.errors.push({ kind: "http", status: response.status(), url: response.url() }); });
        const check = async (label, callback) => {
          const item = { label, passed: false }; flow.checks.push(item); publish(); console.log(`CHECK fidelity165 ${mode}: ${label}`);
          await callback(); assert.deepEqual(flow.errors, []); item.passed = true; publish();
        };
        const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), workspaceStorageKey);
        const settled = async () => { await page.waitForFunction(() => document.querySelector(".save-state")?.textContent === "已保存"); return saved(); };
        const saveWorkspace = (kind, value) => { const filename = `${mode}-${kind}-workspace.json`; put(filename, value); flow.files[kind] = filename; publish(); return filename; };
        const added = (actual, key) => actual[key].filter(entry => !workspace[key].some(old => old.id === entry.id));
        const dialog = () => page.getByRole("dialog", { name: "从 Notion 导入", exact: true });
        const sidebar = () => page.getByRole("complementary", { name: "主导航", exact: true });
        let actual, w1, w2;
        await check("Whole62-member public import preserves full85 input and either applies known156 or discloses invalid/absent source settings", async () => {
          await page.goto(base.href, { waitUntil: "domcontentloaded" }); await sidebar().waitFor();
          assertRetained165(await settled(), workspace, { preview: true });
          await sidebar().locator(".workspace-switcher").click();
          await page.getByRole("menu", { name: "工作区菜单", exact: true }).getByRole("menuitem", { name: "从 Notion 导入…", exact: true }).click();
          await dialog().getByLabel("选择 Notion 导出文件", { exact: true }).setInputFiles(fileURLToPath(archiveFile));
          await dialog().getByRole("button", { name: "导入", exact: true }).waitFor();
          for (const [label, expected] of [["页面", 12], ["数据库", 6], ["记录", 38], ["附件", 0]]) assert.equal(await dialog().locator(`[data-count="${label}"] dd`).innerText(), String(expected));
          assert.equal(await dialog().getByLabel("选择视图设置文件", { exact: true }).count(), 1);
          assertRetained165(await settled(), workspace, { preview: true });
          if (mode !== "no-settings") {
            const input = mode === "side-invalid" ? side : configurations;
            const filename = `${mode}-source-input.json`; put(filename, input); flow.files.sourceInput = filename;
            // An ordinary local JSON file reaches the existing optional input.
            await dialog().getByLabel("选择视图设置文件", { exact: true }).setInputFiles(path.join(directory, filename));
            await page.waitForFunction(() => { const d = document.querySelector('[role="dialog"][aria-label="从 Notion 导入"]'); return d && !d.textContent.includes("正在读取视图设置") && [...d.querySelectorAll("button")].some(b => b.textContent.trim() === "导入" && !b.disabled); });
            assertRetained165(await settled(), workspace, { preview: true });
          }
          await dialog().getByRole("button", { name: "导入", exact: true }).click();
          await dialog().getByRole("status").filter({ hasText: "已导入" }).waitFor();
          await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || "null")?.pages.length === 141, workspaceStorageKey);
          actual = await settled(); saveWorkspace("complete-import", actual); assertRetained165(actual, workspace);
          assert.deepEqual(counts(actual), expectedImportedCounts, "Complete actual imported Wiki across all14 arrays");
          assert.deepEqual([added(actual, "folders").length, added(actual, "pages").length, added(actual, "dataSources").length,
            added(actual, "databaseItems").length, added(actual, "databaseViews").length, added(actual, "attachments").length], [1, 56, 6, 38, 19, 0]);
          const importReport = await dialog().locator(".im-counts").evaluate(element => {
            const key = Object.keys(element).find(key => key.startsWith("__reactFiber$"));
            for (let fiber = key && element[key]; fiber; fiber = fiber.return) {
              const counts = fiber.memoizedProps?.counts;
              if (counts && Array.isArray(counts.warnings) && Array.isArray(counts.skipped) && Array.isArray(counts.unrecognizedValues)) return JSON.parse(JSON.stringify(counts));
            }
            throw new Error("Existing public ImportExportCounts result.report observation point is absent");
          });
          assert.ok(importReport, "Capture genuine result.report fields, not a reconstructed warning classification");
          assert.deepEqual([importReport.pages, importReport.databases, importReport.records, importReport.attachments], [12, 6, 38, 0], "Actual public report covers the complete62-member archive");
          const imported = { rootFolderId: one(added(actual, "folders"), "Actual public import folder").id, report: importReport };
          flow.importReport = imported.report; flow.rootFolderId = imported.rootFolderId;
          const reportFilename = `${mode}-public-import-result.json`; put(reportFilename, imported); flow.files.publicImportResult = reportFilename; publish();
          w1 = importedOccurrence165(actual, workspace, configurations[0], inventory);
          w2 = importedOccurrence165(actual, workspace, configurations[1], inventory);
          flow.occurrences = { w1: { pageId: w1.page.id, blockId: w1.block.id, sourceId: w1.source.id, viewId: w1.view.id },
            w2: { pageId: w2.page.id, blockId: w2.block.id, sourceId: w2.source.id, viewId: w2.view.id } };
          const warnings = imported.report.warnings, invalid = warnings.filter(w => w.kind === "view_configuration_invalid");
          if (mode === "side-invalid") {
            assert.equal(invalid.length, 1, "Known unsupported source Side peek must publish existing view_configuration_invalid after valid W1");
            assert.equal(invalid[0].entryIndex, 1); assert.equal(invalid[0].path, configurations[1].path); assert.equal(invalid[0].collectionIndex, 0);
            assert.match(invalid[0].reason, /openRecordsIn/, "The field that would coerce side into peek is identified");
          } else assert.deepEqual(invalid, []);
          if (mode === "no-settings") {
            assert.ok(added(actual, "databaseViews").every(view => view.type === "table" && view.filter === null && view.groupBy === null && view.sorts.length === 0));
            assertFallback165(w1); assertFallback165(w2);
          } else {
            assertKnown165(actual, w1, configurations[0]);
            if (mode === "configured") assertKnown165(actual, w2, configurations[1]); else assertFallback165(w2);
            assert.ok(warnings.some(w => w.kind === "view_configuration_missing" && w.viewId === w1.view.id && w.missingFields.includes("grouping")), "Unobserved W1 grouping stays disclosed");
            if (mode === "configured") assert.ok(warnings.some(w => w.kind === "view_configuration_missing" && w.viewId === w2.view.id && w.missingFields.includes("config")), "W2 omitted config remains unknown");
          }
          assert.equal(warnings.filter(w => w.kind === "view_configuration_missing" && w.reason.includes(missingReason)).length, mode === "no-settings" ? 19 : mode === "side-invalid" ? 18 : 17);
          if (mode === "side-invalid") assert.ok(warnings.some(w => w.kind === "view_configuration_missing" && w.viewId === w2.view.id && w.path === configurations[1].path && w.reason.includes(missingReason)), "Rejected W2 keeps its original fallback disclosure");
          const details = dialog().locator("details").filter({ has: page.locator("summary", { hasText: "需要检查的内容" }) }); await details.locator("summary").click();
          const texts = await details.locator("p").allTextContents(); flow.visibleWarningTexts = texts;
          assert.equal(texts.length, warnings.length);
          for (const warning of warnings) assert.ok(texts.some(text => text.includes(warning.reason)), "Every genuine report warning remains visible in the public dialog");
          if (mode !== "no-settings") assert.deepEqual(readJSON(path.join(directory, flow.files.sourceInput)), mode === "side-invalid" ? side : configurations, "Input JSON remains exact");
        });
        await check("Normal sidebar/record reading and one persistence reload keep explicit known views, truthful fallback and every old array/history", async () => {
          await dialog().getByRole("button", { name: "关闭", exact: true }).click();
          const folder = one(added(actual, "folders"), "One complete import folder");
          await sidebar().getByRole("button", { name: `展开${folder.name}`, exact: true }).click();
          const root = one(added(actual, "pages").filter(entry => entry.title === "Mendax 的 Vibe Coding Wiki"), "Complete actual Wiki root");
          await sidebar().locator(`[data-node-id="${root.id}"]`).getByRole("button", { name: `展开${root.title}`, exact: true }).click();
          const open = async entry => {
            await sidebar().locator(`[data-node-id="${entry.page.id}"] > .sidebar-page-main`).click();
            const surface = page.locator(`section.database-view[data-view-id="${entry.view.id}"]`); await surface.waitFor();
            assert.equal(await surface.getAttribute("data-view-type"), entry.view.type);
            if (mode === "configured" || mode === "side-invalid" && entry === w1) {
              assert.equal(await surface.getByRole("tab").count(), 1); assert.equal(await surface.getByRole("tab", { name: entry.view.name, exact: true }).getAttribute("aria-selected"), "true");
            }
            return surface;
          };
          const gallery = await open(w1);
          if (mode !== "no-settings") {
            assert.equal(await gallery.locator("article[data-item-id]").count(), 2);
            assert.equal(await gallery.locator(".db-gallery-preview").count(), 0, "Known W1 Preview None remains asset-free");
            const card = gallery.locator("article[data-item-id]").first();
            const itemId = await card.getAttribute("data-item-id");
            const item = one(actual.databaseItems.filter(item => item.id === itemId && item.sourceId === w1.source.id), "Actual imported W1 record");
            const title = one(w1.source.properties.filter(property => property.name === "标题"), "Known W1 title property");
            await card.locator(".db-gallery-open").click();
            const peek = page.getByRole("dialog", { name: "记录预览", exact: true }); await peek.waitFor();
            await peek.locator(`.life-editor[data-page-id="${item.pageId}"]`).waitFor();
            assert.equal(await peek.getByRole("textbox", { name: "记录标题", exact: true }).inputValue(), item.values[title.id]);
            const geometry = await peek.evaluate(element => {
              const rect = element.getBoundingClientRect();
              return { centerX: rect.x + rect.width / 2, centerY: rect.y + rect.height / 2,
                viewportX: innerWidth / 2, viewportY: innerHeight / 2 };
            });
            assert.ok(Math.abs(geometry.centerX - geometry.viewportX) <= 2 && Math.abs(geometry.centerY - geometry.viewportY) <= 2, "W1 opens the observed Center peek, with its exact imported record Page");
            flow.w1CenterPeek = { itemId, pageId: item.pageId, title: item.values[title.id], geometry };
            assert.equal((await settled()).ui.selectedPageId, w1.page.id, "Center peek preserves its wrapper navigation context");
            await peek.getByRole("button", { name: "关闭预览", exact: true }).click(); await peek.waitFor({ state: "detached" });
          }
          await open(w2);
          if (mode === "configured") assert.deepEqual(await page.locator(`section.database-view[data-view-id="${w2.view.id}"] .db-board-column`).evaluateAll(columns => columns.map(column => column.querySelectorAll("article").length)), [2, 4, 3]);
          else assert.equal(await page.locator(`section.database-view[data-view-id="${w2.view.id}"] .db-board-column`).count(), 0);
          const beforeReload = await settled(); assertRetained165(beforeReload, workspace); saveWorkspace("before-reload", beforeReload);
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.locator(`section.database-view[data-view-id="${w2.view.id}"][data-view-type="${w2.view.type}"]`).waitFor();
          const final = await settled(); assertRetained165(final, workspace);
          assert.deepEqual(counts(final), expectedImportedCounts);
          for (const key of arrayKeys(beforeReload)) assert.deepEqual(final[key], beforeReload[key], `Reload keeps complete ${key}, including every explicit view config and122 histories`);
          assert.equal(final.ui.selectedPageId, w2.page.id); assert.equal(final.ui.selectedBlockId, beforeReload.ui.selectedBlockId);
          const filename = saveWorkspace("final-persisted", final); report.finalPersistedWorkspaceFiles.push(filename);
          flow.sqliteAcceptanceInput = { filename, arrayCounts: counts(final), arrays: arrayKeys(final), oldHistories: 122,
            instruction: "Parent owns real SQLite incremental save/close/reopen in a new isolated root; consume this complete actual public-workflow snapshot without pruning." };
        });
        flow.passed = flow.checks.length === 2 && flow.checks.every(check => check.passed); publish();
      } catch (error) {
        flow.failure = error.stack; console.error(`FAIL fidelity165 ${mode}: ${error.stack}`); publish();
        if (page) {
          const observed = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || "null"), workspaceStorageKey).catch(() => null);
          if (observed) { const filename = `${mode}-failed-observed-workspace.json`; put(filename, observed); flow.files.failedObserved = filename; }
          const filename = `${mode}-failure.png`; await page.screenshot({ path: path.join(directory, filename), fullPage: true }).then(() => { flow.files.failureScreenshot = filename; }).catch(() => {});
          flow.bodyExcerpt = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "Renderer unavailable");
        }
      } finally { await context?.close().catch(error => flow.errors.push({ kind: "context-close", message: error.message })); publish(); }
    }
    report.passed = report.modes.length === 3 && report.modes.every(mode => mode.passed && mode.errors.length === 0);
  } catch (error) { report.failure = error.stack; console.error(error.stack); }
  finally { await browser?.close().catch(error => { report.passed = false; report.failure = error.stack; }); report.completedAt = new Date().toISOString(); publish(); }
  if (!report.passed) process.exitCode = 1;
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await runV14NotionConfigFidelity165();
