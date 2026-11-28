import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readNotionExport } from "../../src/import/notionImport.js";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";
import { installWikiProjections149DesktopFixture } from "./v14-wiki-projections149.mjs";
import { sourceViewConfigurations156 } from "../../.qa/LOCAL-NOTION-001/v14-wiki-real133/import156/source-configurations156.mjs";

// Worker163 owns only this regression and import163 QA. Importing this module
// starts no browser/server, hashes no source/assets, and creates no evidence.
const evidenceRoot = new URL("../../.qa/LOCAL-NOTION-001/v14-wiki-real133/import163/", import.meta.url);
const baselineFile = new URL("../../.qa/LOCAL-NOTION-001/v14-wiki-real133/context136/native-selection141-final-closed35.json", import.meta.url);
const archiveFile = new URL("../../.qa/LOCAL-NOTION-001/v11-wiki-replica48/wiki-source-html48.zip", import.meta.url);
const inventoryFile = new URL("../../.qa/LOCAL-NOTION-001/v14-wiki-real133/wrapper148/input-collections148.json", import.meta.url);
const factsFile = new URL("../../.qa/LOCAL-NOTION-001/v14-wiki-real133/import143/facts143.json", import.meta.url);
const initialPageId = "dbpage-6360d61a-ae0c-478a-8ba5-2007ee2b35ec";
const bridgeKey = "__v14NotionViewFileLifecycle163";
const readJSON = file => JSON.parse(readFileSync(file, "utf8"));
const arrayKeys = workspace => Object.keys(workspace).filter(key => Array.isArray(workspace[key]));
const blocksOf = blocks => (blocks || []).flatMap(block => [block, ...blocksOf(block.children)]);
const textOf = content => typeof content === "string" ? content : (content || []).map(part => part.text ?? textOf(part.content)).join("");
const one = (entries, label) => { assert.equal(entries.length, 1, label); return entries[0]; };

export async function auditV14NotionViewFileLifecycle163() {
  const workspace = readJSON(baselineFile).workspace;
  const inventory = readJSON(inventoryFile), facts = readJSON(factsFile);
  const archive = await readNotionExport(readFileSync(archiveFile));
  const collections = arrayKeys(workspace);
  assert.equal(collections.length, 14, "Keep every complete native35 array");
  assert.deepEqual([workspace.pages.length, workspace.databaseItems.length, workspace.dataSources.length,
    workspace.databaseViews.length, workspace.attachments.length, workspace.pageVersions.length], [85, 58, 11, 31, 20, 122]);
  assert.equal(workspace.ui.selectedPageId, initialPageId, "Use the existing asset-free136 linked Page without reseeding a reduced project");
  const initial = one(workspace.pages.filter(page => page.id === initialPageId), "Existing136 linked Page");
  const source = one(workspace.dataSources.filter(entry => entry.id === initial.databaseSourceId), "Retained shared source");
  const view = one(workspace.databaseViews.filter(entry => entry.id === initial.databaseViewId), "Retained selected view");
  assert.notEqual(initial.id, source.ownerPageId);
  assert.equal(initial.cover, null);
  assert.ok(blocksOf(initial.content).every(block => !["image", "video", "audio", "file"].includes(block.type)));
  assert.equal(view.config.gallery.preview.kind, "none", "Initial rendering requires no physical attachment bytes");
  assert.equal(archive.entries.size, 62);
  assert.equal([...archive.entries.keys()].filter(member => member.endsWith(".html")).length, 56);
  assert.equal([...archive.entries.keys()].filter(member => member.endsWith(".csv")).length, 6);
  assert.equal(archive.problems.length, 0);
  assert.equal(inventory.archive, facts.archive);
  assert.equal(inventory.totalCollections, 19);
  assert.equal(inventory.collections.length, 19);
  assert.equal(inventory.coveredIdentities143, 17, "143 is a subset, not the complete view count");
  assert.equal(inventory.additionalLinkedOccurrences.length, 2);
  const actualCollections = [...archive.entries].filter(([member]) => member.endsWith(".html")).flatMap(([member, bytes]) => {
    const markup = new TextDecoder().decode(bytes);
    return [...markup.matchAll(/<table\b[^>]*\bclass="[^"]*\bcollection-content\b[^"]*"[^>]*>/g)].map((_, index) => ({ member, ordinal: index + 1 }));
  });
  assert.deepEqual(actualCollections.map(entry => `${entry.member}#${entry.ordinal}`).sort(),
    inventory.collections.map(entry => `${entry.member}#${entry.ordinal}`).sort(), "Inventory covers all actual HTML collections, including both ordinary 此刻 occurrences");
  assert.ok(inventory.additionalLinkedOccurrences.every(entry => entry.pageTitle === "此刻" && actualCollections.some(actual => actual.member === entry.member && actual.ordinal === entry.ordinal)));
  //143 fixes the count; captions come independently from the original ZIP,
  // never from the imported result. Keep original order and repeated captions.
  const rootMarkup = new TextDecoder().decode(archive.entries.get(facts.root.member));
  const rootImageCaptions = [...rootMarkup.matchAll(/<figure\b[^>]*\bclass="[^"]*\bimage\b[^"]*"[^>]*>([\s\S]*?)<\/figure>/g)].map(match => {
    const captions = [...match[1].matchAll(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/g)];
    assert.equal(captions.length, 1, "Every original root image has its exported caption");
    assert.doesNotMatch(captions[0][1], /[<&]/, "These retained captions are plain text, not a generic HTML-decoding assumption");
    return captions[0][1].trim();
  });
  assert.equal(rootImageCaptions.length, facts.counts.rootColumnMediaPlaceholders);
  assert.equal(rootImageCaptions.length, 13);
  assert.equal(sourceViewConfigurations156.length, 2, "Use the same approved156 optional configuration array");
  return {
    artifactKind: "Lifecycle regression input audit; not source acquisition, product import, browser execution or Wiki acceptance",
    baseline: fileURLToPath(baselineFile), archive: fileURLToPath(archiveFile), inventory: fileURLToPath(inventoryFile),
    sourceInput: "import156/source-configurations156.mjs: W1Gallery/W2Board; explicit retained source facts, not settings inferred from HTML",
    arrays: Object.fromEntries(collections.map(key => [key, workspace[key].length])), initialPageId,
    archiveMembers: 62, htmlMembers: 56, csvMembers: 6, originalCollections: 19, subset143: 17, ordinaryNowCollections: 2,
    rootImageCaptions, rootImagePlaceholders: rootImageCaptions.map(caption => `[图片：${caption}]`),
    transport: "Existing149 desktop changeset fixture installed before the first app load; context-local one-shot seed; never reseed during reload",
    expectedAdded: { pages: 56, databaseItems: 38, dataSources: 6, databaseViews: 19, attachments: 0 },
    limits: "No physical assets, real roots, source/attachment hashes, SQL, new persistent product fields, browser/native run or source UI operations in this audit",
  };
}

// Only an exact test filename is delayed. Every other File.text call uses the
// browser's original implementation. This bridge is test-only, document-local,
// installed before the app, explicitly released and restored after each flow.
function installDelayedFileText163({ filename, key }) {
  const original = File.prototype.text;
  const bridge = { filename, calls: 0, pending: 0, events: [] };
  let resolver, settled;
  File.prototype.text = function (...args) {
    if (this.name !== filename) return original.apply(this, args);
    if (resolver) throw new Error("Unexpected second controlled File.text call");
    bridge.calls += 1; bridge.pending += 1; bridge.events.push("read-started");
    const promise = new Promise(resolve => { resolver = resolve; });
    settled = promise.then(value => { bridge.pending -= 1; bridge.events.push("read-resolved"); return value; });
    return settled;
  };
  bridge.release = async text => {
    if (!resolver) throw new Error("No controlled read to release");
    const resolve = resolver; resolver = null; resolve(text);
    await settled;
    // Event-driven render turns let the real async reader and React commit run.
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  };
  bridge.restore = () => {
    if (bridge.pending) throw new Error("Controlled read was not explicitly released");
    File.prototype.text = original;
    delete window[key];
  };
  window[key] = bridge;
}

const flowDefinitions = [
  { id: "invalid-json-clear", kind: "invalid-clear" },
  { id: "nonarray-replace", kind: "nonarray-replace" },
  { id: "delayed-reselection", kind: "reselection", delayed: "v14-lifecycle163-delayed-reselection.json" },
  { id: "delayed-cancel-reopen", kind: "dispose", close: "cancel", delayed: "v14-lifecycle163-delayed-cancel.json" },
  { id: "delayed-close-reopen", kind: "dispose", close: "close", delayed: "v14-lifecycle163-delayed-close.json" },
];

export async function runV14NotionViewFileLifecycle163({ run = process.env.WIKI_VIEW_FILE_LIFECYCLE163_RUN || `run-${Date.now()}-${process.pid}` } = {}) {
  assert.match(run, /^[a-z0-9][a-z0-9-]{0,79}$/);
  const base = new URL(process.env.PARITY_BASE_URL || "http://127.0.0.1:5178");
  assert.equal(base.href, "http://127.0.0.1:5178/", "Parent owns the existing isolated5178 server");
  const audit = await auditV14NotionViewFileLifecycle163();
  const workspace = readJSON(baselineFile).workspace;
  const archiveBytes = readFileSync(archiveFile), facts = readJSON(factsFile);
  const configurations = JSON.stringify(sourceViewConfigurations156);
  const directory = path.join(fileURLToPath(evidenceRoot), run);
  assert.equal(existsSync(directory), false, "Keep every older failure/log/run");
  mkdirSync(directory, { recursive: true });
  const put = (name, value) => writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
  put("fixture-audit163.json", audit);
  const report = { name: "v14-notion-view-file-lifecycle163", run, startedAt: new Date().toISOString(), passed: false,
    fixtureAudit: audit, flows: [], limits: "Public optional-file lifecycle only.162 owns layout and configured-import happy flow. Context-local desktop transport is not SQLite/native restart evidence. Full Wiki acceptance remains open." };
  const publish = () => put("browser-report.json", report);
  const bounded = (promise, ms, label) => {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms); })]).finally(() => clearTimeout(timer));
  };
  publish();
  let browser;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ channel: "msedge", headless: true });
    for (const definition of flowDefinitions) {
      const flow = { id: definition.id, passed: false, checks: [], errors: [], outsideRequests: [] };
      report.flows.push(flow); publish();
      let context, page;
      try {
        context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
        await context.route("**/*", route => {
          const url = new URL(route.request().url());
          if (["http:", "https:"].includes(url.protocol) && url.origin !== base.origin) { flow.outsideRequests.push(url.href); return route.abort(); }
          return route.continue();
        });
        await context.addInitScript(installWikiProjections149DesktopFixture, { workspace, key: workspaceStorageKey });
        if (definition.delayed) await context.addInitScript(installDelayedFileText163, { filename: definition.delayed, key: bridgeKey });
        page = await context.newPage();
        page.setDefaultTimeout(9000); page.setDefaultNavigationTimeout(15000);
        page.on("pageerror", error => { flow.errors.push({ kind: "pageerror", message: error.stack }); publish(); });
        page.on("console", message => { if (message.type() === "error") { flow.errors.push({ kind: "console", message: message.text() }); publish(); } });
        page.on("response", response => { if (response.status() >= 400) { flow.errors.push({ kind: "http", status: response.status(), url: response.url() }); publish(); } });
        await page.goto(base.href, { waitUntil: "domcontentloaded" });
        const check = async (label, callback) => {
          const item = { label, passed: false }; flow.checks.push(item); publish();
          console.log(`CHECK ${definition.id}: ${label}`);
          await bounded(callback(), 30000, label);
          item.passed = true; publish();
        };
        const dialog = () => page.getByRole("dialog", { name: "从 Notion 导入", exact: true });
        const metadata = () => dialog().getByLabel("选择视图设置文件", { exact: true });
        const importButton = () => dialog().getByRole("button", { name: "导入", exact: true });
        const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), workspaceStorageKey);
        const settled = async () => {
          await page.waitForFunction(() => document.querySelector(".save-state")?.textContent === "已保存");
          return saved();
        };
        const retained = actual => {
          assert.deepEqual(arrayKeys(actual).sort(), arrayKeys(workspace).sort(), "Keep all14 arrays");
          for (const key of arrayKeys(workspace)) {
            const oldIds = new Set(workspace[key].map(entry => entry.id));
            assert.deepEqual(actual[key].filter(entry => oldIds.has(entry.id)), workspace[key], `Retain every original ${key}, identity, order and value`);
          }
          assert.equal(actual.schemaVersion, workspace.schemaVersion);
        };
        const unchanged = async () => {
          const actual = await settled(); retained(actual);
          for (const key of arrayKeys(workspace)) assert.deepEqual(actual[key], workspace[key], `Metadata preview/error must not write ${key}`);
          return actual;
        };
        const open = async () => {
          const sidebar = page.getByRole("complementary", { name: "主导航", exact: true });
          await sidebar.locator(".workspace-switcher").click();
          await page.getByRole("menu", { name: "工作区菜单", exact: true }).getByRole("menuitem", { name: "从 Notion 导入…", exact: true }).click();
          await dialog().waitFor();
        };
        const preview = async (name = "wiki-source-html48.zip") => {
          await dialog().getByLabel("选择 Notion 导出文件", { exact: true }).setInputFiles({ name, mimeType: "application/zip", buffer: archiveBytes });
          await importButton().waitFor(); await metadata().waitFor();
          for (const [label, count] of [["页面", 12], ["数据库", 6], ["记录", 38], ["附件", 0]])
            assert.equal(await dialog().locator(`[data-count="${label}"] dd`).innerText(), String(count), "Every flow previews the whole real ZIP");
        };
        const file = (name, text) => metadata().setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(text) });
        const enabled = () => importButton().evaluate(button => !button.disabled);
        const awaitEnabled = () => page.waitForFunction(() => {
          const dialog = [...document.querySelectorAll('[role="dialog"]')].find(node => node.getAttribute("aria-label") === "从 Notion 导入");
          return [...(dialog?.querySelectorAll("button") || [])].some(button => button.textContent.trim() === "导入" && !button.disabled);
        });
        const assertError = async pattern => {
          await dialog().getByRole("alert").waitFor();
          assert.match(await dialog().getByRole("alert").innerText(), pattern);
          assert.equal(await enabled(), false, "Invalid metadata disables the public Import button");
          await unchanged();
        };
        const assertEmpty = async () => {
          assert.equal(await metadata().inputValue(), "", "Old file selection is cleared");
          assert.equal(await dialog().getByRole("alert").count(), 0);
          await awaitEnabled(); await unchanged();
        };
        const beginDelayed = async () => {
          await file(definition.delayed, configurations);
          await page.waitForFunction(key => window[key]?.calls === 1 && window[key]?.pending === 1, bridgeKey);
          assert.equal(await enabled(), false, "File.text pending disables Import");
          await unchanged();
        };
        const release = async () => {
          await page.evaluate(async ({ key, text }) => { await window[key].release(text); }, { key: bridgeKey, text: configurations });
          const events = await page.evaluate(key => ({ calls: window[key].calls, pending: window[key].pending, events: window[key].events }), bridgeKey);
          assert.equal(events.calls, 1); assert.equal(events.pending, 0);
          assert.deepEqual(events.events, ["read-started", "read-resolved"]);
          flow.delayedRead = events; publish();
        };
        const close = async kind => {
          await (kind === "close" ? dialog().getByRole("button", { name: "关闭对话框", exact: true }) : dialog().getByRole("button", { name: "取消", exact: true })).click();
          await dialog().waitFor({ state: "detached" });
        };
        const importFallback = async () => {
          await importButton().click();
          await dialog().getByRole("status").filter({ hasText: "已导入" }).waitFor();
          await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || "null")?.pages.length === 141, workspaceStorageKey);
          const actual = await settled(); put(`${definition.id}-complete-import.json`, actual); retained(actual);
          const added = key => actual[key].filter(entry => !workspace[key].some(old => old.id === entry.id));
          assert.deepEqual([added("pages").length, added("databaseItems").length, added("dataSources").length, added("databaseViews").length, added("attachments").length], [56, 38, 6, 19, 0]);
          const views = added("databaseViews");
          assert.ok(views.every(view => view.type === "table" && view.filter === null && view.groupBy === null && view.sorts.length === 0), "No stale156 Gallery/Board configuration reaches this import");
          const warningDetails = dialog().locator("details").filter({ has: page.locator("summary", { hasText: "需要检查的内容" }) });
          await warningDetails.locator("summary").click();
          const warnings = await warningDetails.locator("p").allTextContents();
          assert.equal(warnings.filter(text => text.includes("导出文件未提供原视图的名称、布局、筛选、排序、分组和属性显示设置")).length, 19, "Every original unknown view remains disclosed");
          const root = one(added("pages").filter(page => page.title === facts.root.title), "Complete actual imported Wiki root");
          const rootBlocks = blocksOf(root.content);
          const placeholders = rootBlocks.filter(block => block.type === "paragraph" && textOf(block.content).startsWith("[图片")).map(block => textOf(block.content));
          assert.equal(placeholders.length, facts.counts.rootColumnMediaPlaceholders);
          assert.deepEqual(placeholders, audit.rootImagePlaceholders, "All13 original captions, their order and repeated occurrences survive as exact placeholder paragraphs");
          assert.equal(rootBlocks.filter(block => block.type === "image").length, 0, "Unpackaged root images remain placeholders");
          flow.fallback = { newPages: 56, newItems: 38, newSources: 6, tableViews: 19, missingViewWarnings: 19, originalHistories: actual.pageVersions.length, rootMediaPlaceholders: 13 };
          await dialog().getByRole("button", { name: "关闭", exact: true }).click();
          await dialog().waitFor({ state: "detached" });
          const beforeReload = await settled();
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.getByRole("complementary", { name: "主导航", exact: true }).waitFor();
          const afterReload = await settled(); retained(afterReload);
          for (const key of arrayKeys(workspace)) assert.deepEqual(afterReload[key], beforeReload[key], `Ordinary reload preserves saved ${key} without reseeding`);
        };

        await check("Complete85-page fixture and original62-member public ZIP preview preserve all14 arrays", async () => {
          await page.getByRole("complementary", { name: "主导航", exact: true }).waitFor();
          assert.equal(await page.evaluate(() => window.lifeAtlas?.platform), "desktop");
          await unchanged(); await open(); await preview(); await assertEmpty();
        });
        if (definition.kind === "invalid-clear") {
          await check("Invalid JSON blocks import without writes; Clear removes the error and selected file", async () => {
            await file("v14-lifecycle163-invalid.json", "[invalid JSON"); await assertError(/JSON/i);
            await dialog().getByRole("button", { name: "清除视图设置", exact: true }).click(); await assertEmpty();
          });
          await check("Cleared metadata imports the complete archive as19 disclosed Tables and retains122 histories through reload", importFallback);
        } else if (definition.kind === "nonarray-replace") {
          await check("A nonarray JSON value blocks import until replaced by the unchanged approved156 array", async () => {
            await file("v14-lifecycle163-nonarray.json", JSON.stringify({ views: sourceViewConfigurations156 })); await assertError(/数组/);
            await file("v14-lifecycle163-approved-replacement.json", configurations); await awaitEnabled();
            assert.equal(await dialog().getByRole("alert").count(), 0);
            assert.ok((await metadata().inputValue()).endsWith("v14-lifecycle163-approved-replacement.json"));
            await unchanged();
          });
          await check("Cancel/reopen with another complete ZIP forgets the replacement selection and writes nothing", async () => {
            await close("cancel"); await open(); await preview("wiki-source-html48-reopened163.zip"); await assertEmpty(); await close("cancel"); await unchanged();
          });
        } else if (definition.kind === "reselection") {
          await check("ZIP reselection clears prior metadata and invalidates a pending read before another complete ZIP preview", async () => {
            await file("v14-lifecycle163-prior-approved.json", configurations); await awaitEnabled();
            await beginDelayed();
            await dialog().getByRole("button", { name: "重新选择", exact: true }).click();
            await preview("wiki-source-html48-reselected163.zip"); await assertEmpty();
            await file("v14-lifecycle163-current-empty.json", "[]"); await awaitEnabled(); await release();
            assert.ok((await metadata().inputValue()).endsWith("v14-lifecycle163-current-empty.json"), "Stale completion cannot replace the current file");
            assert.equal(await dialog().getByRole("alert").count(), 0); assert.equal(await enabled(), true); await unchanged();
          });
          await check("Resolving an obsolete read cannot pass old source settings into the current whole-ZIP import", importFallback);
        } else {
          await check(`${definition.close} disposes a pending read; reopening the full ZIP is independent of its stale completion`, async () => {
            await beginDelayed(); await close(definition.close); await unchanged();
            await open(); await preview("wiki-source-html48-reopened163.zip"); await assertEmpty();
            await release(); await assertEmpty();
          });
          await check("Disposed metadata never changes reopened import options or the19 disclosed Table fallbacks", importFallback);
        }
        assert.deepEqual(flow.errors, [], "No browser/HTTP/console errors");
        assert.deepEqual(flow.outsideRequests, [], "No remote requests for retained assets or unpackaged images");
        flow.passed = true;
        console.log(`PASS ${definition.id}: ${flow.checks.length} checks`);
      } catch (error) {
        flow.failure = error.stack;
        if (page) {
          await page.evaluate(key => JSON.parse(localStorage.getItem(key)), workspaceStorageKey).then(state => put(`${definition.id}-failure-workspace.json`, state)).catch(() => {});
          flow.bodyExcerpt = await page.locator("body").innerText({ timeout: 3000 }).then(text => text.slice(-14000)).catch(() => "Renderer unavailable");
        }
        console.error(`FAIL ${definition.id}: ${error.stack}`);
      } finally {
        if (page && definition.delayed) await page.evaluate(async ({ key, text }) => {
          const bridge = window[key];
          if (!bridge) return;
          if (bridge.pending) await bridge.release(text);
          bridge.restore();
        }, { key: bridgeKey, text: configurations }).catch(error => { flow.passed = false; flow.errors.push({ kind: "bridge-cleanup", message: error.message }); });
        await bounded(context?.close(), 20000, "context close").catch(error => { flow.passed = false; flow.errors.push({ kind: "close", message: error.message }); });
        flow.completedAt = new Date().toISOString(); publish();
      }
    }
    report.passed = report.flows.length === flowDefinitions.length && report.flows.every(flow => flow.passed);
  } catch (error) { report.failure = error.stack; console.error(error.stack); }
  finally {
    await bounded(browser?.close(), 20000, "browser close").catch(error => { report.passed = false; report.failure = error.stack; });
    report.completedAt = new Date().toISOString(); publish();
  }
  if (!report.passed) process.exitCode = 1;
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.includes("--fixture-audit163")) console.log(JSON.stringify(await auditV14NotionViewFileLifecycle163(), null, 2));
  else await runV14NotionViewFileLifecycle163();
}
