import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBlankWorkspace } from "../../src/domain/blankWorkspace.js";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";
import { browserScenario } from "./harness.mjs";

const evidenceRoot = "LOCAL-NOTION-001/v14-wiki-real133/wrapper148";
const factsPath = new URL("../../.qa/LOCAL-NOTION-001/v14-wiki-real133/import143/facts143.json", import.meta.url);
function* blocksOf(blocks) {
  for (const block of blocks || []) { yield block; yield* blocksOf(block.children); }
}
const inlineText = content => typeof content === "string" ? content : (content || []).map(item => item.text ?? inlineText(item.content)).join("");

// Importing this module does not start a browser or create evidence. The parent
// owns 5178 and calls this function (or registers this module in the runner).
export async function runV14RealWikiWrapper148({ run = process.env.V14_WRAPPER148_RUN || `run-${Date.now()}-${process.pid}` } = {}) {
  assert.match(run, /^[a-z0-9][a-z0-9-]{0,79}$/);
  const base = new URL(process.env.PARITY_BASE_URL || "http://127.0.0.1:5178");
  assert.equal(base.origin, "http://127.0.0.1:5178", "Use only the parent's isolated 5178 origin");
  const facts = JSON.parse(readFileSync(factsPath, "utf8"));
  const inputCollections = JSON.parse(readFileSync(new URL(`../../.qa/${evidenceRoot}/input-collections148.json`, import.meta.url), "utf8"));
  assert.equal(inputCollections.archive, facts.archive);
  const archive = fileURLToPath(new URL(`../../${facts.archive}`, import.meta.url));
  const directory = fileURLToPath(new URL(`../../.qa/${evidenceRoot}/${run}/`, import.meta.url));
  assert.equal(existsSync(directory), false, "Keep all earlier RED and GREEN evidence");
  mkdirSync(directory, { recursive: true });
  const put = (name, value) => writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + "\n");
  let sequence = 0;
  const workspace = createBlankWorkspace({ now: "2026-11-14T00:00:00.000Z", idFactory: kind => `wrapper148-seed-${kind}-${++sequence}` });
  put("fixture-policy.json", {
    archive: facts.archive, expectations: fileURLToPath(factsPath), completeArchiveMembers: facts.counts.archiveMembers,
    completeExportedCollections: inputCollections.totalCollections, coveredIdentities143: inputCollections.coveredIdentities143,
    import: "One public-dialog import of the complete retained real Wiki into a fresh browser context; no pruning or original Wiki writes",
    declarations: "Only the four already evidenced W1-W4 Page types are explicitly set using existing pageType/databaseSourceId/databaseViewId in the isolated fixture. This is not an imported page-type fidelity claim.",
    variants: "After checking all four untouched exported descriptions: a legacy declaration on the existing starter Page with no DB block, rich formatting of W1's exact description text, additional before/after body blocks, duplicate and nonmatching occurrences, and a locked W4. These are isolated editor stress variants, not source configuration claims.",
    limits: "Only case5 explicitly sets viewIdsJson on its original occurrence for the two existing views required by that test; earlier fixture inputs retain unknown membership. No fixture schemaVersion, ui.selectedBlockId or history declaration writes. Browser reload is not native restart evidence. Imported Table defaults are not Notion live-layout fidelity."
  });

  return browserScenario(`${evidenceRoot}/${run}/browser-report`, async ({ page, context, check, screenshot, saved, persisted }) => {
    const pendingFixtureKey = `life-atlas.harness.wrapper148.${run}.pending-fixture`;
    // Register once. A departing document may flush its old workspace, but it
    // never writes this separate test key. The next document consumes it before
    // the application loads, and subsequent ordinary reloads keep saved edits.
    await context.addInitScript(({ pendingKey, key }) => {
      const pending = localStorage.getItem(pendingKey);
      if (pending !== null) {
        localStorage.removeItem(pendingKey);
        localStorage.setItem(key, pending);
      }
    }, { pendingKey: pendingFixtureKey, key: workspaceStorageKey });
    let installationSequence = 0;
    const outside = [];
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (["http:", "https:"].includes(url.protocol) && url.origin !== base.origin) { outside.push(url.href); return route.abort(); }
      return route.continue();
    });
    const one = (entries, label) => { assert.equal(entries.length, 1, label); return entries[0]; };
    const pageById = (state, id) => one(state.pages.filter(entry => entry.id === id), `Retain Page ${id}`);
    const article = page.getByRole("article", { name: "页面编辑器", exact: true });
    const blockElement = id => article.locator(`.bn-block-outer[data-id="${id}"]`).first();
    const editorDocument = id => page.evaluate(pageId => {
      const node = document.querySelector(`.life-editor[data-page-id="${pageId}"] .bn-editor`);
      return JSON.parse(JSON.stringify(node.pmViewDesc.node.type.schema.cached.blockNoteEditor.document));
    }, id);
    const installFixture = async (state, id) => {
      // Only this browserScenario's new context is modified; all collections stay.
      const fixture = structuredClone(state), target = pageById(fixture, id);
      fixture.ui = { ...fixture.ui, activeSection: "private", privateExpanded: true, selectedPageId: id,
        selectedFolderId: target.folderId, expandedFolderIds: fixture.folders.map(folder => folder.id),
        expandedPageIds: fixture.pages.map(entry => entry.id), preferences: { ...fixture.ui.preferences, startPage: "last" } };
      const installation = ++installationSequence;
      try {
        await page.evaluate(({ pendingKey, fixture }) => localStorage.setItem(pendingKey, JSON.stringify(fixture)), { pendingKey: pendingFixtureKey, fixture });
        await page.reload({ waitUntil: "domcontentloaded" });
        // Do not accept the welcome hydration frame or depend on PageEditor,
        // which the old detached database branch does not mount.
        await page.waitForFunction(({ key, id, title }) => {
          const input = document.querySelector('article[aria-label="页面编辑器"] input[aria-label="页面标题"]');
          const state = JSON.parse(localStorage.getItem(key) || "null");
          return input?.value === title && state?.ui?.selectedPageId === id;
        }, { key: workspaceStorageKey, id, title: target.title });
        assert.equal(await article.getByRole("textbox", { name: "页面标题", exact: true }).inputValue(), target.title);
      } catch (error) {
        const observed = await page.evaluate(({ key, pendingKey }) => {
          const persistedWorkspace = JSON.parse(localStorage.getItem(key) || "null");
          return {
            url: location.href,
            renderedTitle: document.querySelector('article[aria-label="页面编辑器"] input[aria-label="页面标题"]')?.value ?? null,
            persistedSelectedPageId: persistedWorkspace?.ui?.selectedPageId ?? null,
            persistedWorkspace,
            pendingFixture: JSON.parse(localStorage.getItem(pendingKey) || "null")
          };
        }, { key: workspaceStorageKey, pendingKey: pendingFixtureKey }).catch(diagnosticError => ({ diagnosticError: diagnosticError.stack }));
        put(`fixture-install-${String(installation).padStart(2, "0")}-failure.json`, { expectedPageId: id, expectedTitle: target.title, intendedFullFixture: fixture, observed, failure: error.stack });
        throw error;
      }
      return fixture;
    };
    const preserveEntities = (after, before, editedIds = []) => {
      assert.equal(after.schemaVersion, before.schemaVersion);
      assert.deepEqual(after.pages.map(entry => entry.id), before.pages.map(entry => entry.id), "No Page pruning, copies or replacement identities");
      for (const original of before.pages) if (!editedIds.includes(original.id)) {
        assert.deepEqual(pageById(after, original.id), original, `Preserve untouched real Page ${original.id}`);
      }
      for (const key of Object.keys(before).filter(key => Array.isArray(before[key]) && !["pages", "folders", "pageVersions"].includes(key))) {
        assert.deepEqual(after[key], before[key], `Preserve the complete real ${key}, including canonical ownership and view configuration`);
      }
      assert.deepEqual(after.pageVersions.slice(0, before.pageVersions.length), before.pageVersions, "Never replace retained history");
      assert.deepEqual(after.folders.map(entry => entry.id), before.folders.map(entry => entry.id));
    };
    let imported, declared, wrappers, root;

    await check("Import the complete actual Wiki once and retain every entity, nested collection and exported wrapper description", async () => {
      const before = await saved();
      const sidebar = page.getByRole("complementary", { name: "主导航" });
      await sidebar.locator(".workspace-switcher").click();
      await page.getByRole("menu", { name: "工作区菜单", exact: true }).getByRole("menuitem", { name: "从 Notion 导入…", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "从 Notion 导入", exact: true });
      await dialog.getByLabel("选择 Notion 导出文件", { exact: true }).setInputFiles(archive);
      const button = dialog.getByRole("button", { name: "导入", exact: true });
      await button.waitFor();
      for (const [label, expected] of [["页面", facts.counts.documentPages], ["数据库", facts.counts.databases], ["记录", facts.counts.records], ["附件", facts.counts.localAttachments]]) {
        assert.equal(await dialog.locator(`[data-count="${label}"] dd`).innerText(), String(expected));
      }
      await button.click();
      await dialog.getByRole("status").filter({ hasText: "已导入" }).waitFor();
      imported = await persisted(state => state.pages.length === before.pages.length + facts.counts.totalImportedPages && state.databaseItems.length === before.databaseItems.length + facts.counts.records);
      // Preserve the COMPLETE result before any fixture-oracle assertion. A
      // failed count/reference check must leave extra identities reviewable.
      put("complete-import.json", imported);
      const added = imported.pages.filter(entry => !before.pages.some(prior => prior.id === entry.id));
      const sources = imported.dataSources.filter(entry => !before.dataSources.some(prior => prior.id === entry.id));
      const views = imported.databaseViews.filter(entry => !before.databaseViews.some(prior => prior.id === entry.id));
      const items = imported.databaseItems.filter(entry => !before.databaseItems.some(prior => prior.id === entry.id));
      const occurrences = added.flatMap(owner => [...blocksOf(owner.content)].filter(block => block.type === "databaseView").map(block => ({ pageId: owner.id, pageTitle: owner.title, blockId: block.id, sourceId: block.props.sourceId, viewId: block.props.viewId })));
      put("imported-view-inventory.json", { views, occurrences, declarations: added.filter(entry => entry.pageType === "database").map(entry => ({ pageId: entry.id, sourceId: entry.databaseSourceId, viewId: entry.databaseViewId })) });
      root = one(added.filter(entry => entry.title === facts.root.title), "One complete real Wiki root");
      assert.equal(sources.length, facts.counts.databases);
      assert.equal(views.length, inputCollections.totalCollections, "Retain all 19 actual exported collections; 143's 17 is a covered identity subset");
      const sourceFor = title => one(sources.filter(entry => entry.title === title), `Canonical real source ${title}`);
      const viewFor = id => one(views.filter(entry => entry.id === id), `Imported view ${id}`);
      const canonicalIds = [];
      assert.equal([...blocksOf(root.content)].filter(block => block.type === "columnList").length, facts.counts.rootColumnLists);
      assert.equal([...blocksOf(root.content)].filter(block => block.type === "column").length, facts.counts.rootColumns);
      assert.equal([...blocksOf(root.content)].filter(block => block.type === "databaseView").length, facts.root.embedded.length);
      for (const expected of facts.sources) {
        const source = sourceFor(expected.title), canonical = one(added.filter(entry => entry.id === source.ownerPageId), `Canonical owner ${expected.title}`);
        assert.equal(canonical.pageType, "database");
        assert.equal(canonical.databaseSourceId, source.id);
        assert.deepEqual(source.properties.map(property => property.name), expected.headers);
        const block = one([...blocksOf(canonical.content)].filter(entry => entry.type === "databaseView"), `Canonical original occurrence ${expected.title}`);
        assert.equal(block.props.sourceId, source.id);
        assert.equal(block.props.viewId, canonical.databaseViewId);
        assert.equal(viewFor(canonical.databaseViewId).sourceId, source.id);
        assert.equal(viewFor(canonical.databaseViewId).linked, false);
        canonicalIds.push(canonical.databaseViewId);
        const records = items.filter(entry => entry.sourceId === source.id);
        assert.equal(records.length, expected.recordCount);
        const recordPages = records.map(item => one(added.filter(entry => entry.id === item.pageId), "Each canonical record retains its Page"));
        assert.equal(new Set(recordPages.map(entry => entry.id)).size, expected.recordCount);
        assert.deepEqual(recordPages.map(entry => entry.title).sort(), expected.records.map(entry => entry.title).sort());
        for (const recordPage of recordPages) assert.equal(recordPage.databaseSourceId, source.id);
      }
      wrappers = facts.wrappers.map(expected => {
        const wrapper = one(added.filter(entry => entry.title === expected.title && !entry.databaseSourceId), `Actual wrapper ${expected.member}`);
        assert.deepEqual(wrapper.content.map(block => block.type), ["paragraph", "databaseView"]);
        assert.equal(inlineText(wrapper.content[0].content), expected.description, "Exact exported description, not a generated substitute");
        const block = wrapper.content[1];
        const source = one(sources.filter(entry => entry.id === block.props.sourceId && entry.title === expected.sourceTitle), "Original linked source");
        assert.notEqual(source.ownerPageId, wrapper.id, "A wrapper declaration does not grant source ownership");
        return { id: wrapper.id, expected, blockId: block.id, sourceId: block.props.sourceId, viewId: block.props.viewId, descriptionId: wrapper.content[0].id };
      });
      const embedded = [...blocksOf(root.content)].filter(block => block.type === "databaseView");
      const coveredLinked = [
        ...facts.root.embedded.map((expected, index) => ({ expected, block: embedded[index] })),
        ...wrappers.map(target => ({ expected: target.expected, block: pageById(imported, target.id).content[1] }))
      ];
      const checkLinked = ({ expected, block }) => {
        const source = sourceFor(expected.sourceTitle), view = viewFor(block.props.viewId);
        assert.equal(block.props.sourceId, source.id);
        assert.equal(view.sourceId, source.id);
        assert.equal(view.linked, true);
        assert.deepEqual(view.visiblePropertyIds.map(id => one(source.properties.filter(property => property.id === id), "Visible property identity").name), expected.headers);
      };
      for (const entry of coveredLinked) checkLinked(entry);
      assert.equal(coveredLinked.length, facts.counts.coveredLinkedOccurrences);
      const coveredIds = [...canonicalIds, ...coveredLinked.map(entry => entry.block.props.viewId)];
      assert.equal(new Set(coveredIds).size, facts.counts.coveredCanonicalDefaults + facts.counts.coveredLinkedOccurrences, "Keep every one of the original143 17 independent identities");
      const additionalIds = [];
      for (const expected of inputCollections.additionalLinkedOccurrences) {
        const owner = one(added.filter(entry => entry.title === expected.pageTitle && !entry.databaseSourceId), `Additional ordinary document ${expected.member}`);
        const blocks = [...blocksOf(owner.content)].filter(block => block.type === "databaseView");
        assert.equal(blocks.length, inputCollections.additionalLinkedOccurrences.filter(entry => entry.member === expected.member).length);
        const block = blocks[expected.ordinal - 1];
        checkLinked({ expected, block });
        additionalIds.push(block.props.viewId);
      }
      put("view-coverage.json", { canonicalIds, coveredLinked: coveredLinked.map(entry => ({ sourceTitle: entry.expected.sourceTitle, blockId: entry.block.id, viewId: entry.block.props.viewId })), additional: inputCollections.additionalLinkedOccurrences.map((entry, index) => ({ ...entry, viewId: additionalIds[index] })) });
      assert.equal(new Set([...coveredIds, ...additionalIds]).size, inputCollections.totalCollections, "Both additional 此刻 occurrences keep their own view identities");
      assert.deepEqual(views.map(view => view.id).sort(), [...coveredIds, ...additionalIds].sort(), "Every imported view is explained; do not drop, ignore or invent the extra two");
      assert.equal(occurrences.length, inputCollections.totalCollections);
      assert.deepEqual(occurrences.map(entry => entry.viewId).sort(), views.map(view => view.id).sort(), "Every imported view remains in its original body occurrence exactly once");
      for (const view of views) {
        assert.equal(view.type, "table");
        assert.equal(view.filter, null, "Exported row subsets are not live filter definitions");
        assert.deepEqual(view.sorts, []);
        assert.equal(view.groupBy, null);
      }
      const site = one([...blocksOf(root.content)].filter(block => block.type === "toggleListItem" && [...blocksOf(block.children)].filter(child => child.type === "databaseView").length === facts.root.siteStructure.databaseBlocks), "Retain the real site-structure toggle");
      assert.equal([...blocksOf(site.children)].filter(block => block.type === "pageLink").length, facts.root.siteStructure.pageLinks);
      assert.deepEqual(imported.attachments, before.attachments);
      for (const key of Object.keys(before).filter(key => Array.isArray(before[key]))) assert.deepEqual(imported[key].slice(0, before[key].length), before[key]);
      const warnings = dialog.locator("details").filter({ hasText: "需要检查的内容" });
      await warnings.locator("summary").click();
      const warningText = await warnings.locator("p").allTextContents();
      assert.equal(warningText.filter(value => value.includes("导出文件未提供原视图的名称、布局、筛选、排序、分组和属性显示设置") && value.includes("暂用表格显示，不代表原来的视图")).length, views.length, "Every imported fallback view, including the additional two, retains its missing-live-configuration warning");
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
      declared = structuredClone(imported);
      for (const target of wrappers) Object.assign(pageById(declared, target.id), { pageType: "database", databaseSourceId: target.sourceId, databaseViewId: target.viewId });
      put("complete-declared-fixture.json", declared);
      await installFixture(declared, wrappers[0].id);
    });

    await check("W1-W4 explicit linked database Pages render their exact original description and original database once at its current view", async () => {
      for (const [index, target] of wrappers.entries()) {
        if (index) await installFixture(await saved(), target.id);
        const database = article.locator(`.database-view[data-source-id="${target.sourceId}"]`);
        await database.waitFor();
        // This is the behavioral RED on the old detached PageDocument branch.
        assert.equal(await article.getByText(target.expected.description, { exact: true }).count(), 1, `W${index + 1}: show the complete actual exported description`);
        await article.locator(`.life-editor[data-page-id="${target.id}"]`).waitFor();
        assert.equal(await database.count(), 1, "Only the original database occurrence is editable");
        assert.equal(await database.getAttribute("data-view-id"), target.viewId);
        assert.equal(await blockElement(target.blockId).locator(".database-view.is-full-page").count(), 1, "Render fullpage presentation inside the original block identity");
        assert.equal(await article.locator(".page-full-database .database-view").count(), 1);
        assert.equal(await article.locator(".ProseMirror-selectednode").count(), 0, "Opening a wrapper does not select its database");
        assert.equal(await blockElement(target.descriptionId).evaluate((node, blockId) => Boolean(node.compareDocumentPosition(document.querySelector(`.bn-block-outer[data-id="${blockId}"]`)) & Node.DOCUMENT_POSITION_FOLLOWING), target.blockId), true);
        assert.deepEqual(pageById(await saved(), target.id).content, pageById(declared, target.id).content, "Passive rendering does not rewrite the original body");
      }
      preserveEntities(await saved(), declared);
      await screenshot("four-real-wrappers");
    });

    await check("A legacy declared Page with no original database block retains its declaration database and existing editor body", async () => {
      const fixture = structuredClone(await saved()), starter = pageById(fixture, workspace.ui.selectedPageId), target = wrappers[0];
      assert.equal([...blocksOf(starter.content)].filter(block => block.type === "databaseView").length, 0);
      Object.assign(starter, { pageType: "database", databaseSourceId: target.sourceId, databaseViewId: target.viewId });
      const before = await installFixture(fixture, starter.id);
      const database = article.locator(`.database-view[data-source-id="${target.sourceId}"]`);
      await database.waitFor();
      assert.equal(await database.count(), 1, "Keep the legacy declaration database when there is no original DB occurrence");
      assert.equal(await database.getAttribute("data-view-id"), target.viewId);
      await article.locator(`.life-editor[data-page-id="${starter.id}"]`).waitFor();
      for (const block of starter.content) assert.equal(await blockElement(block.id).innerText(), inlineText(block.content));
      assert.deepEqual(pageById(await saved(), starter.id).content, starter.content, "Do not persist a synthesized DB block or replace legacy body");
      preserveEntities(await saved(), before);
    });

    await check("Rich exact description and nested before-after blocks edit and save through one normal editor without losing identities or shared data", async () => {
      const target = wrappers[0], fixture = structuredClone(await saved()), wrapper = pageById(fixture, target.id);
      const text = target.expected.description;
      const split = text.indexOf(" ") + 1;
      wrapper.content[0].content = [{ type: "text", text: text.slice(0, split), styles: { bold: true } },
        { type: "link", href: `lifeatlas://page/${root.id}`, content: [{ type: "text", text: text.slice(split), styles: { italic: true } }] }];
      wrapper.content.splice(1, 0, { id: "wrapper148-before", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "包装正文之前148", styles: {} }] });
      wrapper.content.push({ id: "wrapper148-after", type: "callout", props: { icon: "💡" }, content: [{ type: "text", text: "包装正文之后148", styles: {} }],
        children: [{ id: "wrapper148-after-child", type: "paragraph", props: {}, content: [{ type: "text", text: "嵌套正文148", styles: {} }] }] });
      const before = await installFixture(fixture, target.id);
      await blockElement("wrapper148-after-child").waitFor();
      const description = blockElement(target.descriptionId);
      assert.equal(await description.innerText(), text);
      assert.equal((await description.locator("strong").innerText()).trimEnd(), text.slice(0, split).trimEnd());
      const descriptionLink = description.locator("a");
      put("rich-description-dom.json", { html: await description.innerHTML(), document: await editorDocument(target.id) });
      assert.equal(await descriptionLink.innerText(), text.slice(split));
      assert.equal(await descriptionLink.getAttribute("href"), `lifeatlas://page/${root.id}`);
      assert.equal(await descriptionLink.evaluate(node => getComputedStyle(node).fontStyle), "italic", "Italic link styling survives regardless of DOM mark nesting");
      const ids = [target.descriptionId, "wrapper148-before", target.blockId, "wrapper148-after"];
      assert.deepEqual(await article.locator(".bn-editor > .bn-block-group > .bn-block-outer").evaluateAll(nodes => nodes.map(node => node.dataset.id)), ids);
      assert.equal(await article.locator(".database-view").count(), 1);
      const originalDocument = await editorDocument(target.id);
      // Inline content inherits editability from the single BlockNote editor root.
      const editable = blockElement("wrapper148-after-child").locator('.bn-inline-content');
      await editable.click();
      await page.keyboard.press("End");
      await page.keyboard.type(" edited148");
      const edited = await persisted(state => inlineText([...blocksOf(pageById(state, target.id).content)].find(block => block.id === "wrapper148-after-child")?.content) === "嵌套正文148 edited148");
      const expectedDocument = structuredClone(originalDocument);
      const leaf = [...blocksOf(expectedDocument)].find(block => block.id === "wrapper148-after-child");
      leaf.content[0].text += " edited148";
      assert.deepEqual(pageById(edited, target.id).content, expectedDocument, "Only the targeted text changed; preserve rich description, nested blocks, DB references and every original ID");
      preserveEntities(edited, before, [target.id]);
      await page.reload({ waitUntil: "domcontentloaded" });
      await blockElement("wrapper148-after-child").waitFor();
      assert.equal(await blockElement("wrapper148-after-child").innerText(), "嵌套正文148 edited148");
      assert.deepEqual(pageById(await saved(), target.id).content, expectedDocument);
      await screenshot("rich-before-after-saved");
    });

    await check("Selecting an existing source view synchronizes only this Page and its unique original occurrence", async () => {
      const target = wrappers[0], fixture = structuredClone(await saved());
      const sourceViews = fixture.databaseViews.filter(view => view.sourceId === target.sourceId);
      const index = sourceViews.findIndex(view => view.id === pageById(fixture, target.id).databaseViewId);
      assert.ok(index >= 0 && sourceViews.length > 1, "The real Wiki retains separate existing linked/canonical views");
      const next = sourceViews[(index + 1) % sourceViews.length];
      // Declare only the two existing views this operation needs, not all source views.
      const occurrence = [...blocksOf(pageById(fixture, target.id).content)].find(block => block.id === target.blockId);
      occurrence.props.viewIdsJson = JSON.stringify([occurrence.props.viewId, next.id]);
      const before = await installFixture(fixture, target.id);
      const database = blockElement(target.blockId).locator(".database-view");
      await database.getByRole("tab", { selected: true }).press("ArrowRight");
      const changed = await persisted(state => pageById(state, target.id).databaseViewId === next.id && [...blocksOf(pageById(state, target.id).content)].find(block => block.id === target.blockId)?.props.viewId === next.id);
      assert.equal(await database.getAttribute("data-view-id"), next.id);
      const expected = structuredClone(pageById(before, target.id).content);
      [...blocksOf(expected)].find(block => block.id === target.blockId).props.viewId = next.id;
      assert.deepEqual(pageById(changed, target.id).content, expected, "Only the original occurrence viewId changes");
      preserveEntities(changed, before, [target.id]);
      await page.reload({ waitUntil: "domcontentloaded" });
      await database.waitFor();
      assert.equal(await database.getAttribute("data-view-id"), next.id);
    });

    await check("Ambiguous matching nested occurrences retain the entire body and both original database blocks without guessing a primary", async () => {
      const target = wrappers[1], fixture = structuredClone(await saved()), wrapper = pageById(fixture, target.id);
      const duplicate = structuredClone(wrapper.content[1]);
      duplicate.id = "wrapper148-ambiguous-db";
      wrapper.content.push({ id: "wrapper148-ambiguous-body", type: "callout", props: { icon: "💡" }, content: [{ type: "text", text: "歧义后的原正文148", styles: {} }], children: [duplicate] });
      const before = await installFixture(fixture, target.id);
      await blockElement(duplicate.id).waitFor();
      assert.equal(await article.getByText(target.expected.description, { exact: true }).count(), 1);
      assert.equal(await article.getByText("歧义后的原正文148", { exact: true }).count(), 1);
      assert.equal(await article.locator(".database-view").count(), 2);
      assert.equal(await article.locator(".database-view.is-full-page").count(), 0, "No arbitrary occurrence is promoted");
      assert.equal(await article.locator(".page-full-database").count(), 0, "Do not add a detached third database");
      assert.deepEqual(pageById(await saved(), target.id).content, pageById(before, target.id).content);
      preserveEntities(await saved(), before);
      await screenshot("ambiguous-body-retained");
    });

    await check("A nonmatching declaration keeps ordinary body and a locked unique wrapper remains read-only", async () => {
      const target = wrappers[2], fixture = structuredClone(await saved()), wrapper = pageById(fixture, target.id);
      const other = fixture.databaseViews.find(view => view.sourceId === target.sourceId && view.id !== target.viewId);
      assert.ok(other);
      wrapper.databaseViewId = other.id;
      const before = await installFixture(fixture, target.id);
      await blockElement(target.blockId).waitFor();
      assert.equal(await article.getByText(target.expected.description, { exact: true }).count(), 1);
      assert.equal(await article.locator(".database-view").count(), 1);
      assert.equal(await blockElement(target.blockId).locator(".database-view").getAttribute("data-view-id"), target.viewId, "Do not guess or rebind a nonmatching original block");
      assert.equal(await article.locator(".page-full-database").count(), 0);
      preserveEntities(await saved(), before);
      const lockedTarget = wrappers[3], lockedFixture = structuredClone(await saved());
      pageById(lockedFixture, lockedTarget.id).settings = { ...pageById(lockedFixture, lockedTarget.id).settings, locked: true };
      const lockedBefore = await installFixture(lockedFixture, lockedTarget.id);
      const editor = article.locator(`.life-editor[data-page-id="${lockedTarget.id}"] .bn-editor`);
      await editor.waitFor();
      assert.equal(await editor.getAttribute("contenteditable"), "false");
      assert.equal(await article.getByRole("textbox", { name: "页面标题", exact: true }).getAttribute("readonly"), "");
      assert.equal(await article.getByText(lockedTarget.expected.description, { exact: true }).count(), 1);
      assert.equal(await blockElement(lockedTarget.blockId).locator(".database-view.is-full-page").count(), 1);
      assert.equal(await article.getByRole("button", { name: "新建记录", exact: true }).count(), 0);
      preserveEntities(await saved(), lockedBefore);
      assert.deepEqual(outside, [], "No real source or remote media requests");
      await screenshot("locked-wrapper");
    });
  }, { workspace });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await runV14RealWikiWrapper148();
