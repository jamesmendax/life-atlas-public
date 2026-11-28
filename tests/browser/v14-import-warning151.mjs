import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import JSZip from "jszip";
import { createBlankWorkspace } from "../../src/domain/blankWorkspace.js";
import { browserScenario } from "./harness.mjs";

const evidenceRoot = "LOCAL-NOTION-001/v14-wiki-real133/warning151";
const factsPath = new URL("../../.qa/LOCAL-NOTION-001/v14-wiki-real133/import143/facts143.json", import.meta.url);
const missingViewReason = "导出文件未提供原视图的名称、布局、筛选、排序、分组和属性显示设置；暂用表格显示，不代表原来的视图。";
const formulaReason = "公式表达式未包含在导出中；结果已保留为文本，不会自动计算。";

// No browser, ZIP read or artifact writes on module import. The parent owns the
// server/runner. Acceptance uses the real app's public dialog, with its normal
// browserScenario console/page/HTTP capture; no component mocks or source checks.
export async function runV14ImportWarning151({ run = process.env.V14_IMPORT_WARNING151_RUN || `run-${Date.now()}-${process.pid}` } = {}) {
  assert.match(run, /^[a-z0-9][a-z0-9-]{0,79}$/);
  const base = new URL(process.env.PARITY_BASE_URL || "http://127.0.0.1:5178");
  assert.equal(base.origin, "http://127.0.0.1:5178", "Use the parent's isolated 5178 origin");
  const facts = JSON.parse(readFileSync(factsPath, "utf8"));
  const archive = fileURLToPath(new URL(`../../${facts.archive}`, import.meta.url));
  const directory = fileURLToPath(new URL(`../../.qa/${evidenceRoot}/${run}/`, import.meta.url));
  assert.equal(existsSync(directory), false, "Never overwrite earlier run evidence");
  mkdirSync(directory, { recursive: true });
  const put = (name, value) => writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + "\n");

  // Inspect the same complete input for an independent source-content oracle.
  // Nothing is extracted, rewritten, hashed, injected into workspace storage or
  // passed through a second product import. The original file is selected below.
  const zip = await JSZip.loadAsync(readFileSync(archive), { checkCRC32: false, createFolders: false });
  const members = Object.values(zip.files).filter(file => !file.dir);
  assert.equal(members.length, facts.counts.archiveMembers);
  const htmlFiles = members.filter(file => /\.html$/i.test(file.name));
  assert.equal(htmlFiles.length, facts.counts.htmlMembers);
  assert.equal(members.filter(file => /\.csv$/i.test(file.name)).length, facts.counts.csvMembers);
  assert.equal(members.filter(file => !/\.(html|csv)$/i.test(file.name)).length, facts.counts.otherMembers);
  const htmlMembers = await Promise.all(htmlFiles.map(async file => ({ member: file.name, html: await file.async("string") })));
  put("fixture-policy.json", {
    archive, facts: fileURLToPath(factsPath), archiveMembers: members.length,
    htmlMembers: htmlFiles.length, csvMembers: facts.counts.csvMembers,
    import: "One public-dialog import of the unchanged actual 62-member Wiki ZIP into a new blank context",
    oracle: "Detached archived HTML media references, all collection tables and canonical record formula labels; no product parser/import dry run",
    countScope: "143's 17 covered view identities are not a total-view oracle; all exported collection tables are counted independently",
    redEvidence: "D:/application-development/life-atlas/.qa/LOCAL-NOTION-001/v14-wiki-real133/wrapper148/parent-red01/browser-report.json",
  });
  let sequence = 0;
  const workspace = createBlankWorkspace({ now: "2026-11-14T00:00:00.000Z", idFactory: kind => `warning151-seed-${kind}-${++sequence}` });
  return browserScenario(`${evidenceRoot}/${run}/browser-report`, async ({ page, context, check, screenshot, saved, persisted }) => {
    const outside = [];
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (["http:", "https:"].includes(url.protocol) && url.origin !== base.origin) {
        outside.push(url.href); return route.abort();
      }
      return route.continue();
    });
    // This listener supplements, and never removes or filters, harness capture.
    const duplicateKeyErrors = [];
    page.on("console", message => {
      if (message.type() === "error" && message.text().includes("Encountered two children with the same key")) duplicateKeyErrors.push(message.text());
    });
    const sidebar = page.getByRole("complementary", { name: "主导航", exact: true });
    await sidebar.waitFor();
    const before = await saved();
    const collections = Object.keys(before).filter(key => Array.isArray(before[key]));
    const dialog = page.getByRole("dialog", { name: "从 Notion 导入", exact: true });
    let oracle, previewRows, previewCounts, committed;
    const counts = () => dialog.locator("[data-count]").evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.count, node.querySelector("dd").textContent])));
    const issueList = label => dialog.locator("details.im-unknown").filter({ has: page.locator("summary", { hasText: label }) });
    const visibleRows = async (list, label, expected) => {
      assert.equal(await list.count(), 1, `One ${label} list`);
      assert.equal(await list.locator("summary").textContent(), `${label}（${expected.length}）`, "Keep the existing label and issue count");
      if (!(await list.evaluate(node => node.open))) await list.locator("summary").click();
      const rows = await list.locator("p").allTextContents();
      assert.deepEqual([...rows].sort(), [...expected].sort(), `${label}: every complete issue, with exact multiplicity and verbatim text`);
      assert.equal(await list.locator("p:visible").count(), expected.length, "All issue rows stay exposed in the expanded list");
      return rows;
    };

    await check("The complete actual Wiki preview retains every distinct same-member issue and the original counters", async () => {
      oracle = await page.evaluate(({ htmlMembers, sources }) => {
        const documents = new Map(htmlMembers.map(({ member, html }) => {
          const template = document.createElement("template");
          template.innerHTML = html;
          return [member, template.content];
        }));
        const media = [], collectionViews = [], formulaProperties = [];
        for (const [member, root] of documents) {
          const article = root.querySelector("article.page"), header = article?.querySelector(":scope > header"), body = article?.querySelector(":scope > .page-body");
          const description = header?.querySelector(".page-description");
          const refs = [header?.querySelector("img.page-cover-image")?.getAttribute("src")];
          for (const figure of body?.querySelectorAll("figure.image, figure[data-notion-image]") || []) {
            refs.push(figure.querySelector("img")?.getAttribute("src"), figure.getAttribute("data-notion-image"), figure.querySelector("a")?.getAttribute("href"));
          }
          for (const image of body?.querySelectorAll("img[src]") || []) {
            if (!image.closest("figure.image, figure[data-notion-image], .property-icon, .icon, figure.link-to-page")) refs.push(image.getAttribute("src"));
          }
          for (const image of description?.querySelectorAll("img[src]") || []) refs.push(image.getAttribute("src"));
          for (const link of description?.querySelectorAll("a[href]") || []) {
            const href = link.getAttribute("href"), file = href.split(/[?#]/)[0];
            if (file && !/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(file) && /\.[^/]+$/.test(file) && !/\.(html?|md|csv)$/i.test(file)) refs.push(href);
          }
          // The current archive has no binary members; one source media reference
          // per member/href yields an issue. This never filters actual dialog rows.
          for (const href of new Set(refs.filter(Boolean))) media.push({ path: member, reason: `图片未能本地化：${href}` });
          for (const table of body?.querySelectorAll("table.collection-content") || []) {
            const title = table.closest("div.collection-content")?.querySelector(".collection-title")?.textContent.trim() || header?.querySelector(".page-title")?.textContent.trim() || "";
            collectionViews.push({ path: member, view: title });
          }
        }
        for (const source of sources) {
          const properties = new Set();
          for (const record of source.records) {
            for (const row of documents.get(record.member)?.querySelectorAll("header table.properties tr.property-row-formula") || []) properties.add(row.querySelector("th").textContent.trim());
          }
          for (const property of properties) formulaProperties.push({ path: source.member.replace(/\.html$/i, ".csv"), property });
        }
        return { media, collectionViews, formulaProperties };
      }, { htmlMembers, sources: facts.sources });
      put("source-issues.json", oracle);
      assert.equal(oracle.media.length, 32, "The whole actual archive has all 32 retained missing-media issues");
      const rootIssues = oracle.media.filter(entry => entry.path === facts.root.member);
      assert.ok(rootIssues.length > 1);
      assert.equal(new Set(rootIssues.map(entry => entry.reason)).size, rootIssues.length, "Same root member has multiple distinct source issues");
      await sidebar.locator(".workspace-switcher").click();
      await page.getByRole("menu", { name: "工作区菜单", exact: true }).getByRole("menuitem", { name: "从 Notion 导入…", exact: true }).click();
      await dialog.getByLabel("选择 Notion 导出文件", { exact: true }).setInputFiles(archive);
      await dialog.getByRole("button", { name: "导入", exact: true }).waitFor({ state: "visible" });
      previewRows = await visibleRows(issueList("无法识别的文件"), "无法识别的文件", oracle.media.map(entry => `${entry.path} · ${entry.reason}`));
      previewCounts = await counts();
      assert.deepEqual(previewCounts, { "页面": String(facts.counts.documentPages), "数据库": String(facts.counts.databases), "记录": String(facts.counts.records), "附件": String(facts.counts.localAttachments), "附件大小": "0B" });
      const previewState = await saved();
      for (const key of collections) assert.deepEqual(previewState[key], before[key], `Preview never changes ${key}`);
      put("preview-issues.json", { rows: previewRows, counts: previewCounts, duplicateKeyErrors: [...duplicateKeyErrors] });
      await screenshot("preview-issues");
    });

    await check("One public import keeps every skipped issue verbatim and every existing result label and counter", async () => {
      await dialog.getByRole("button", { name: "导入", exact: true }).click();
      const status = dialog.getByRole("status").filter({ hasText: "已导入" });
      await status.waitFor();
      const rows = await visibleRows(issueList("已跳过的文件"), "已跳过的文件", previewRows);
      assert.deepEqual(await counts(), previewCounts, "Import result counters match preview");
      assert.equal(await status.textContent(), `已导入 ${facts.counts.documentPages} 个页面、${facts.counts.databases} 个数据库（${facts.counts.records} 条记录）、${facts.counts.localAttachments} 个附件`);
      assert.equal(await issueList("无法识别的文件").count(), 0, "Result replaces the preview list");
      put("result-skipped.json", { rows, counts: await counts(), status: await status.textContent(), duplicateKeyErrors: [...duplicateKeyErrors] });
      await screenshot("result-skipped");
    });

    await check("All exported collection and formula warnings remain visible, including repeated equal warnings", async () => {
      assert.equal(oracle.collectionViews.length, 19, "All source tables, including the two ordinary 此刻 document occurrences beyond 143's covered seventeen");
      assert.equal(oracle.formulaProperties.length, 2);
      const expected = [
        ...oracle.collectionViews.map(entry => `${entry.view ? `${entry.view} · ` : ""}${missingViewReason}`),
        ...oracle.formulaProperties.map(entry => `${entry.property} · ${formulaReason}`),
      ];
      assert.ok(new Set(expected).size < expected.length, "Equal warnings are separate source occurrences, not a reason to deduplicate");
      const rows = await visibleRows(issueList("需要检查的内容"), "需要检查的内容", expected);
      put("result-warnings.json", { rows, expected, counts: await counts() });
      await screenshot("all-result-issues");
    });

    await check("The full imported Wiki and seed are preserved and no duplicate-key error is captured", async () => {
      committed = await persisted(state => state.pages.length === before.pages.length + facts.counts.totalImportedPages && state.databaseItems.length === before.databaseItems.length + facts.counts.records);
      for (const key of collections) assert.deepEqual(committed[key].slice(0, before[key].length), before[key], `Preserve existing ${key}`);
      assert.equal(committed.folders.length - before.folders.length, 1);
      assert.equal(committed.dataSources.length - before.dataSources.length, facts.counts.databases);
      assert.equal(committed.databaseViews.length - before.databaseViews.length, oracle.collectionViews.length);
      assert.deepEqual(committed.attachments, before.attachments);
      const newIds = new Set(committed.pages.filter(entry => !before.pages.some(prior => prior.id === entry.id)).map(entry => entry.id));
      assert.equal(committed.pages.filter(entry => newIds.has(entry.id) && entry.title === facts.root.title).length, 1);
      for (const source of facts.sources) {
        const added = committed.dataSources.filter(entry => !before.dataSources.some(prior => prior.id === entry.id) && entry.title === source.title);
        assert.equal(added.length, 1);
        assert.equal(committed.databaseItems.filter(entry => entry.sourceId === added[0].id).length, source.recordCount);
      }
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      await page.reload({ waitUntil: "domcontentloaded" });
      await sidebar.waitFor();
      const reopened = await saved();
      for (const key of collections) assert.deepEqual(reopened[key], committed[key], `Reload preserves ${key}`);
      assert.deepEqual(duplicateKeyErrors, [], "The actual public-dialog import emits zero duplicate-key errors");
      assert.deepEqual(outside, [], "Remote source media is never requested");
      put("preservation.json", { newPages: newIds.size, newSources: facts.counts.databases, newRecords: facts.counts.records, newViews: oracle.collectionViews.length, preservedCollections: collections, duplicateKeyErrors, outside });
    });
  }, { workspace });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await runV14ImportWarning151();
