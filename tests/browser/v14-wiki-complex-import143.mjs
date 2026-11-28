import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBlankWorkspace } from "../../src/domain/blankWorkspace.js";
import { browserScenario } from "./harness.mjs";

// Expectations are retained evidence, never an import/configuration manifest.
const evidenceRoot = ".qa/LOCAL-NOTION-001/v14-wiki-real133/import143";
const facts = JSON.parse(readFileSync(new URL(`../../${evidenceRoot}/facts143.json`, import.meta.url), "utf8"));
const archivePath = fileURLToPath(new URL(`../../${facts.archive}`, import.meta.url));
const base = new URL(process.env.PARITY_BASE_URL || "http://127.0.0.1:5178");
if (base.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(base.hostname) || base.port !== "5178") {
  throw new Error("Run against the parent's browser-scenario server on port 5178");
}
const run = process.env.WIKI_IMPORT143_RUN || `run-${Date.now()}-${process.pid}`;
if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(run)) throw new Error("Invalid WIKI_IMPORT143_RUN");
// Existing run evidence is never overwritten. browserScenario owns browser cleanup.
mkdirSync(path.join(fileURLToPath(new URL(`../../${evidenceRoot}/`, import.meta.url)), run));
let seedSequence = 0;
const workspace = createBlankWorkspace({ now: "2026-11-14T00:00:00.000Z", idFactory: (kind) => `import143-seed-${kind}-${++seedSequence}` });

function* blocksOf(blocks) {
  for (const block of blocks || []) {
    yield block;
    yield* blocksOf(block.children);
  }
}
const inlineText = (content) => typeof content === "string" ? content : (content || []).map((item) => item.text ?? item.props?.labelSnapshot ?? inlineText(item.content)).join("");
const normalized = (value) => value.replace(/\s+/g, " ").trim();
function* linksOf(content) {
  if (!Array.isArray(content)) return;
  for (const item of content) {
    if (item.type === "link") yield item;
    yield* linksOf(item.content);
  }
}

await browserScenario(`${evidenceRoot.replace(/^\.qa\//, "")}/${run}/browser143`, async ({ page, context, check, assert, saved, persisted }) => {
  const outside = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && url.origin !== base.origin) {
      outside.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  const sidebar = page.getByRole("complementary", { name: "主导航" });
  await sidebar.waitFor();
  const before = await saved();
  const collections = Object.keys(before).filter((key) => Array.isArray(before[key]));
  let committed, importedPages, importedSources, importedViews, importedItems, root;
  const one = (entries, message) => { assert.equal(entries.length, 1, message); return entries[0]; };
  const document = (title) => one(importedPages.filter((entry) => entry.title === title && !entry.databaseSourceId), `Unique document: ${title}`);
  const source = (title) => one(importedSources.filter((entry) => entry.title === title), `Unique canonical source: ${title}`);
  const view = (id) => one(importedViews.filter((entry) => entry.id === id), `Imported view exists: ${id}`);
  const owner = (title) => one(importedPages.filter((entry) => entry.id === source(title).ownerPageId), `Canonical owner: ${title}`);
  const pageForMember = (member) => {
    if (member === facts.root.member) return root;
    const canonical = facts.sources.find((entry) => entry.member === member);
    if (canonical) return owner(canonical.title);
    const wrapper = facts.wrappers.find((entry) => entry.member === member);
    if (wrapper) return document(wrapper.title);
    for (const expected of facts.sources) {
      const record = expected.records.find((entry) => entry.member === member);
      if (!record) continue;
      const ids = new Set(importedItems.filter((entry) => entry.sourceId === source(expected.title).id).map((entry) => entry.pageId));
      return one(importedPages.filter((entry) => ids.has(entry.id) && entry.title === record.title), `Record in its own source: ${member}`);
    }
    return document(member.replace(/\s+[a-f0-9]{32}\.html$/i, ""));
  };
  const preserved = (after) => {
    for (const key of collections) assert.deepEqual(after[key].slice(0, before[key].length), before[key], `Import preserves existing ${key}`);
  };

  await check("The whole retained Wiki ZIP imports once through the public dialog with truthful source counts and warnings", async () => {
    await sidebar.locator(".workspace-switcher").click();
    await page.getByRole("menu", { name: "工作区菜单", exact: true }).getByRole("menuitem", { name: "从 Notion 导入…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "从 Notion 导入", exact: true });
    // Pass the actual retained archive; no extraction, generated ZIP or second import.
    await dialog.getByLabel("选择 Notion 导出文件", { exact: true }).setInputFiles(archivePath);
    const importButton = dialog.getByRole("button", { name: "导入", exact: true });
    await importButton.waitFor({ state: "visible" });
    for (const [label, expected] of [["页面", facts.counts.documentPages], ["数据库", facts.counts.databases], ["记录", facts.counts.records], ["附件", facts.counts.localAttachments]]) {
      assert.equal(await dialog.locator(`[data-count="${label}"] dd`).innerText(), String(expected), `Real ZIP preview: ${label}`);
    }
    await importButton.click();
    await dialog.getByRole("status").filter({ hasText: "已导入" }).waitFor();
    committed = await persisted((value) => value.pages.length === before.pages.length + facts.counts.totalImportedPages && value.databaseItems.length === before.databaseItems.length + facts.counts.records);
    const folder = one(committed.folders.filter((entry) => !before.folders.some((previous) => previous.id === entry.id)), "Exactly one new import folder");
    importedPages = committed.pages.filter((entry) => entry.folderId === folder.id);
    importedSources = committed.dataSources.filter((entry) => !before.dataSources.some((previous) => previous.id === entry.id));
    importedViews = committed.databaseViews.filter((entry) => !before.databaseViews.some((previous) => previous.id === entry.id));
    importedItems = committed.databaseItems.filter((entry) => !before.databaseItems.some((previous) => previous.id === entry.id));
    root = document(facts.root.title);
    assert.equal(importedPages.length, facts.counts.totalImportedPages);
    assert.equal(importedSources.length, facts.counts.databases);
    assert.equal(importedItems.length, facts.counts.records);
    assert.deepEqual(committed.attachments, before.attachments, "This HTML/CSV archive has no binary attachment members");
    preserved(committed);
    const warnings = dialog.locator("details").filter({ hasText: "需要检查的内容" });
    await warnings.locator("summary").click();
    const warningText = await warnings.locator("p").allTextContents();
    assert.equal(warningText.filter((value) => value.includes("导出文件未提供原视图的名称、布局、筛选、排序、分组和属性显示设置") && value.includes("暂用表格显示，不代表原来的视图")).length, importedViews.length, "Every imported fallback view discloses the missing live configuration");
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  });

  await check("Six canonical databases keep all 38 records while eleven real occurrences keep independent ordered-column views", async () => {
    const canonicalIds = [];
    for (const expected of facts.sources) {
      const dataSource = source(expected.title), canonical = owner(expected.title);
      assert.equal(canonical.pageType, "database");
      assert.equal(canonical.databaseSourceId, dataSource.id);
      canonicalIds.push(canonical.databaseViewId);
      assert.deepEqual(dataSource.properties.map((property) => property.name), expected.headers);
      const canonicalBlock = one([...blocksOf(canonical.content)].filter((block) => block.type === "databaseView"), `One canonical collection: ${expected.title}`);
      assert.equal(canonicalBlock.props.sourceId, dataSource.id);
      assert.equal(canonicalBlock.props.viewId, canonical.databaseViewId);
      assert.equal(view(canonical.databaseViewId).sourceId, dataSource.id);
      assert.equal(view(canonical.databaseViewId).linked, false);
      const records = importedItems.filter((entry) => entry.sourceId === dataSource.id);
      assert.equal(records.length, expected.recordCount);
      const recordPages = records.map((item) => one(importedPages.filter((entry) => entry.id === item.pageId), "Every record has a retained page"));
      assert.equal(new Set(recordPages.map((entry) => entry.id)).size, expected.recordCount);
      assert.deepEqual(recordPages.map((entry) => entry.title).sort(), expected.records.map((entry) => entry.title).sort(), "Duplicate titles in other sources cannot absorb these records");
      for (const recordPage of recordPages) assert.equal(recordPage.databaseSourceId, dataSource.id);
    }
    const embedded = [...blocksOf(root.content)].filter((block) => block.type === "databaseView");
    assert.equal(embedded.length, facts.root.embedded.length);
    const linked = [
      ...facts.root.embedded.map((expected, index) => ({ expected, block: embedded[index] })),
      ...facts.wrappers.map((expected) => ({ expected, block: one([...blocksOf(document(expected.title).content)].filter((block) => block.type === "databaseView"), `Wrapper collection: ${expected.title}`) })),
    ];
    for (const { expected, block } of linked) {
      const dataSource = source(expected.sourceTitle), occurrence = view(block.props.viewId);
      assert.equal(block.props.sourceId, dataSource.id);
      assert.equal(occurrence.sourceId, dataSource.id);
      assert.equal(occurrence.linked, true);
      assert.deepEqual(occurrence.visiblePropertyIds.map((id) => one(dataSource.properties.filter((property) => property.id === id), "Visible property exists").name), expected.headers);
    }
    assert.equal(linked.length, facts.counts.coveredLinkedOccurrences);
    assert.equal(new Set([...canonicalIds, ...linked.map(({ block }) => block.props.viewId)]).size, facts.counts.coveredCanonicalDefaults + facts.counts.coveredLinkedOccurrences, "Equal E3/E7 and E5/E6 exports still need different occurrence identities");
    for (const fallback of importedViews) {
      assert.equal(fallback.type, "table");
      assert.equal(fallback.filter, null, "Exported row subsets do not reveal a live filter predicate");
      assert.deepEqual(fallback.sorts, []);
      assert.equal(fallback.groupBy, null);
    }
    const site = one([...blocksOf(root.content)].filter((block) => block.type === "toggleListItem" && [...blocksOf(block.children)].filter((child) => child.type === "databaseView").length === facts.root.siteStructure.databaseBlocks), "Seven embedded occurrences stay together beneath the site-structure toggle");
    assert.equal([...blocksOf(site.children)].filter((block) => block.type === "pageLink").length, facts.root.siteStructure.pageLinks);
  });

  await check("All four real wrapper descriptions remain complete body paragraphs before their database occurrence", async () => {
    for (const expected of facts.wrappers) {
      const wrapper = document(expected.title);
      assert.deepEqual(wrapper.content.map((block) => block.type), ["paragraph", "databaseView"]);
      assert.equal(inlineText(wrapper.content[0].content), expected.description);
      assert.equal(wrapper.content[1].props.sourceId, source(expected.sourceTitle).id);
    }
  });

  await check("Complex Wiki columns, missing-media positions, proven callouts and custom local labels survive the real import", async () => {
    const columns = [...blocksOf(root.content)].filter((block) => block.type === "columnList");
    assert.equal(columns.length, facts.counts.rootColumnLists);
    assert.equal(columns.reduce((sum, block) => sum + block.children.length, 0), facts.counts.rootColumns);
    let mediaPositions = 0;
    for (const [index, expected] of facts.columns.entries()) {
      const list = columns[index];
      assert.equal(list.props.columns, expected.widths.length);
      assert.equal(list.children.length, expected.widths.length);
      for (const [columnIndex, column] of list.children.entries()) {
        assert.equal(column.type, "column");
        assert.ok(Math.abs(column.props.width - expected.widths[columnIndex]) < 1e-10, "Retain source widths, not the later native user's width edit");
        assert.deepEqual(column.children.map((block) => block.type), expected.childTypes[columnIndex].map((type) => type === "image" ? "paragraph" : type));
        for (const [childIndex, type] of expected.childTypes[columnIndex].entries()) {
          if (type !== "image") continue;
          mediaPositions += 1;
          assert.match(inlineText(column.children[childIndex].content), /^\[图片(?:：.*|未能本地化)\]$/s, "Unavailable media is a visible placeholder, not silently dropped or fetched");
        }
      }
    }
    assert.equal(mediaPositions, facts.counts.rootColumnMediaPlaceholders);
    for (const expected of facts.callouts) {
      const pageSource = pageForMember(expected.member);
      const callout = one([...blocksOf(pageSource.content)].filter((block) => block.type === "callout" && normalized(inlineText(block.content)) === normalized(expected.paragraphs[0])), `Proven callout: ${expected.domId}`);
      assert.deepEqual([inlineText(callout.content), ...[...blocksOf(callout.children)].filter((block) => block.type === "paragraph").map((block) => inlineText(block.content))].map(normalized), expected.paragraphs.map(normalized));
      if (expected.backgroundColor) assert.equal(callout.props.backgroundColor, expected.backgroundColor);
    }
    for (const expected of facts.customLabels) {
      const pageSource = pageForMember(expected.member), target = pageForMember(expected.targetMember);
      const links = [...blocksOf(pageSource.content)].flatMap((block) => [...linksOf(block.content)]).filter((link) => inlineText(link.content) === expected.label);
      assert.equal(links.length, 1, `Retained custom label: ${expected.label}`);
      assert.equal(links[0].href, `lifeatlas://page/${target.id}`, "Same-title documents and canonical databases must retain the correct local target");
    }
  });

  await check("Reload preserves imported content and independent view identities without changing the seed or contacting remote media", async () => {
    await page.reload();
    await sidebar.waitFor();
    const reopened = await saved();
    for (const key of collections) assert.deepEqual(reopened[key], committed[key], `Reload preserves ${key}`);
    preserved(reopened);
    assert.deepEqual(outside, [], "Source HTML and remote image URLs never initiate external requests");
  });
}, { workspace });
