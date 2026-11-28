import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLinkedView, projectViewItems } from "../../src/domain/database.js";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";

// Runtime projections of known source147 settings, NOT a metadata/import fix.
// Importing this module never starts a browser, server, or evidence run.
const baselinePath = new URL("../../.qa/LOCAL-NOTION-001/v9-formal-database-ui01/evidence/native208-formal30-v14-real-wiki-resume.json", import.meta.url);
const evidenceRoot = "LOCAL-NOTION-001/v14-wiki-real133/projection149";
const evidencePath = fileURLToPath(new URL(`../../.qa/${evidenceRoot}/`, import.meta.url));
const definitions = [
  {
    key: "w3", sourceTitle: "项目", name: "项目 · 精选", type: "gallery",
    visibleNames: ["名称", "摘要", "状态"], sortName: "最近更新", sourceCount: 6,
    sourceOrder: ["个人知识花园", "安静的个人出版系统", "AI 工作流笔记本"],
    // Equal retained 01:54 timestamps cannot distinguish the live tie order.
    // Preserve its values and stable tie order; never invent a tie-break sort.
    snapshotOrder: ["个人知识花园", "AI 工作流笔记本", "安静的个人出版系统"],
    records: [
      { title: "个人知识花园", values: ["一个用于长期保存笔记、阅读、项目和 AI 辅助综合的系统，同时避免把生活变成另一个需要清空的收件箱。", "Active"] },
      { title: "AI 工作流笔记本", values: ["记录提示词、实验、工具行为、失败方式与可复用流程；目标不是收集技巧，而是保留足够上下文让第二次运行仍然可信。", "Active"] },
      { title: "安静的个人出版系统", values: ["这套以 Notion 为后台的个人刊物：精选文章、花园笔记、项目、书架和一个尽量克制、低维护的首页。", "Active"] },
    ],
  },
  {
    key: "w4", sourceTitle: "书架", name: "书架 · 在读", type: "list",
    visibleNames: ["书名", "作者", "核心收获"], sortName: "开始日期", sourceCount: 8,
    sourceOrder: ["Seeing Like a State", "The Creative Act"],
    snapshotOrder: ["Seeing Like a State", "The Creative Act"],
    records: [
      { title: "Seeing Like a State", values: ["James C. Scott", "可读性有助于管理，但过度简化的模型也会抹掉真正让系统运转的地方性知识。"] },
      { title: "The Creative Act", values: ["Rick Rubin", "创作更依赖感受力、注意力与持续练习，而不是用压力强行逼出产量。"] },
    ],
  },
];
const one = (values, message) => { assert.equal(values.length, 1, message); return values[0]; };
const readBaseline = () => JSON.parse(readFileSync(baselinePath, "utf8")).workspace;
function* blocksOf(blocks) {
  for (const block of blocks || []) { yield block; yield* blocksOf(block.children); }
}
const property = (source, name) => one(source.properties.filter(entry => entry.name === name), `Unique ${source.title}.${name}`);
const viewId = definition => `view-projection149-${definition.key}`;

function occurrence(workspace, definition) {
  const source = one(workspace.dataSources.filter(entry => entry.title === definition.sourceTitle), `Real ${definition.sourceTitle} source`);
  const owner = one(workspace.pages.filter(entry => entry.id === source.ownerPageId), "Canonical owner exists");
  const wrapper = one(workspace.pages.filter(entry => entry.id !== owner.id && !entry.databaseSourceId && entry.title === definition.sourceTitle
    && [...blocksOf(entry.content)].some(block => block.type === "databaseView" && block.props.sourceId === source.id)), "Actual Wiki wrapper, selected by source identity");
  const block = one([...blocksOf(wrapper.content)].filter(entry => entry.type === "databaseView" && entry.props.sourceId === source.id), "Wrapper keeps its existing database block");
  return { source, owner, wrapper, block };
}

export function wikiProjections149Fixture() {
  const workspace = readBaseline();
  for (const definition of definitions) {
    const { source, block } = occurrence(workspace, definition);
    const visible = definition.visibleNames.map(name => property(source, name).id);
    const filter = definition.key === "w3"
      ? { propertyId: property(source, "精选").id, operator: "checked" }
      : { propertyId: property(source, "状态").id, operator: "equals", value: one(property(source, "状态").options.filter(entry => entry.name === "Reading"), "Actual Reading option").id };
    assert.ok(!workspace.databaseViews.some(entry => entry.id === viewId(definition)), "No fixture view ID collision");
    workspace.databaseViews.push(createLinkedView(source.id, {
      id: viewId(definition), name: definition.name, type: definition.type, filter,
      sorts: [{ propertyId: property(source, definition.sortName).id, direction: "desc" }],
      groupBy: null, visiblePropertyIds: visible,
      // W3 Center peek is representable. W4 Side peek is deliberately not
      // encoded as Center peek: omit openRecordsIn and document the format gap.
      config: definition.key === "w3" ? { openRecordsIn: "peek", gallery: { preview: { kind: "none" }, cardSize: "medium", visiblePropertyIds: visible } } : {},
    }));
    block.props.viewId = viewId(definition);
  }
  const { wrapper } = occurrence(workspace, definitions[0]);
  workspace.ui = { ...workspace.ui, activeSection: "private", selectedPageId: wrapper.id, selectedFolderId: wrapper.folderId,
    preferences: { ...workspace.ui.preferences, theme: "light", startPage: "last" } };
  return workspace;
}

export function auditWikiProjections149Fixture(workspace = wikiProjections149Fixture()) {
  const baseline = readBaseline();
  const collections = Object.keys(baseline).filter(key => Array.isArray(baseline[key]));
  assert.deepEqual([baseline.pages.length, baseline.databaseItems.length, baseline.dataSources.length, baseline.databaseViews.length, baseline.attachments.length, baseline.pageVersions.length], [84, 58, 11, 31, 20, 118], "Use the whole actual native208 snapshot");
  const permittedPages = structuredClone(baseline.pages);
  for (const definition of definitions) {
    const { source, wrapper, block } = occurrence(workspace, definition);
    const oldWrapper = permittedPages.find(entry => entry.id === wrapper.id);
    one([...blocksOf(oldWrapper.content)].filter(entry => entry.id === block.id), "Original occurrence ID").props.viewId = viewId(definition);
    const view = one(workspace.databaseViews.filter(entry => entry.id === viewId(definition)), "Runtime fixture view exists");
    const visible = definition.visibleNames.map(name => property(source, name).id);
    assert.equal(view.sourceId, source.id);
    assert.equal(view.linked, true);
    assert.equal(view.name, definition.name);
    assert.equal(view.type, definition.type);
    assert.equal(view.groupBy, null);
    assert.equal(view.grouping, undefined, "No extra grouping semantics");
    assert.deepEqual(view.sorts, [{ propertyId: property(source, definition.sortName).id, direction: "desc" }]);
    assert.deepEqual(view.visiblePropertyIds, visible);
    if (definition.key === "w3") {
      assert.deepEqual(view.filter, { propertyId: property(source, "精选").id, operator: "checked" });
      assert.deepEqual(view.config.gallery.visiblePropertyIds, visible);
      assert.equal(view.config.gallery.preview.kind, "none");
      assert.equal(view.config.gallery.cardSize, "medium");
    } else {
      assert.deepEqual(view.filter, { propertyId: property(source, "状态").id, operator: "equals", value: property(source, "状态").options.find(entry => entry.name === "Reading").id });
      assert.deepEqual(view.config, {}, "W4 gains neither Gallery settings nor a fake Side peek encoding");
    }
    const items = projectViewItems(workspace, view);
    const titleProperty = property(source, definition.visibleNames[0]);
    assert.deepEqual(items.map(item => item.values[titleProperty.id]), definition.snapshotOrder);
    assert.equal(workspace.databaseItems.filter(item => item.sourceId === source.id).length, definition.sourceCount, "Filtering never removes canonical records");
  }
  for (const key of collections) {
    if (key === "pages") assert.deepEqual(workspace.pages, permittedPages, "Only two existing wrapper view references change");
    else if (key === "databaseViews") {
      assert.equal(workspace.databaseViews.length, baseline.databaseViews.length + 2);
      assert.deepEqual(workspace.databaseViews.slice(0, baseline.databaseViews.length), baseline.databaseViews, "All original31 views remain exact");
    } else assert.deepEqual(workspace[key], baseline[key], `Full fixture retains every ${key}`);
  }
  for (const key of Object.keys(baseline).filter(key => key !== "ui" && !collections.includes(key))) assert.deepEqual(workspace[key], baseline[key], `Keep ${key}`);
  return {
    baseline: fileURLToPath(baselinePath), sourceFacts: ".qa/LOCAL-NOTION-001/v14-wiki-real133/source147/source-facts147.md",
    counts: Object.fromEntries(collections.map(key => [key, workspace[key].length])),
    fixtureChanges: "Two added existing-format linked views; only their two existing wrapper block viewId references and initial UI selection/preferences differ",
    projections: definitions.map(definition => {
      const { source, wrapper, block } = occurrence(workspace, definition);
      return { key: definition.key, sourceId: source.id, wrapperPageId: wrapper.id, blockId: block.id, viewId: viewId(definition),
        visibleNames: definition.visibleNames, sourceOrder: definition.sourceOrder, snapshotOrder: definition.snapshotOrder };
    }),
    gaps: ["native208 W3 has equal minute-resolution timestamps and a different retained tie order; the live relative order of AI/安静 is not encoded", "W4 Side peek is not representable by existing page/peek format; not asserted or re-encoded", "History reload uses the existing desktop repository with a context-local fixture transport, not real SQLite/native restart", "Missing metadata acquisition/import, descriptions, exact tab membership, native restart and attachment bytes are outside149"],
  };
}

// Test-only transport for the existing createDesktopWorkspaceRepository path.
// The browser repository intentionally omits pageVersions on save. This fixture
// applies the real desktop changeset contract to this context's localStorage;
// it never filters/repairs changes, touches SQLite, or resolves actual assets.
export function installWikiProjections149DesktopFixture({ workspace, key }) {
  if (!localStorage.getItem("life-atlas.projection149.desktop-seeded")) {
    localStorage.setItem(key, JSON.stringify(workspace));
    localStorage.setItem("life-atlas.projection149.desktop-seeded", "1");
  }
  const generation = "projection149-isolated-desktop-fixture";
  window.lifeAtlas = { platform: "desktop", workspace: {
    load: async () => ({ ok: true, value: { generation, workspace: JSON.parse(localStorage.getItem(key)) } }),
    applyChanges: async changes => {
      if (changes.generation !== generation) throw new Error("Unexpected fixture generation");
      const value = JSON.parse(localStorage.getItem(key));
      const changed = new Set([...changes.upserts, ...changes.deletes].map(entry => entry.collection));
      for (const collection of changed) {
        if (!Array.isArray(value[collection])) throw new Error(`Unknown fixture collection: ${collection}`);
        const entities = new Map(value[collection].map(entry => [entry.id, entry]));
        for (const entry of changes.deletes.filter(entry => entry.collection === collection)) entities.delete(entry.id);
        const upserts = changes.upserts.filter(entry => entry.collection === collection);
        for (const entry of upserts) {
          const entity = JSON.parse(entry.json);
          if (entity.id !== entry.id) throw new Error("Unexpected fixture entity ID");
          entities.set(entry.id, entity);
        }
        // The existing tracker emits every entity in its new order when a
        // collection is reordered. Preserve that order rather than hide it.
        value[collection] = upserts.length === entities.size && new Set(upserts.map(entry => entry.id)).size === entities.size
          ? upserts.map(entry => entities.get(entry.id)) : [...entities.values()];
      }
      if (changes.ui !== null) value.ui = changes.ui;
      value.schemaVersion = changes.schemaVersion;
      value.savedAt = new Date().toISOString();
      localStorage.setItem(key, JSON.stringify(value));
      return { ok: true, value: { savedAt: value.savedAt } };
    },
  } };
}

export async function runV14WikiProjections149({ run = process.env.WIKI_PROJECTIONS149_RUN || `run-${Date.now()}-${process.pid}` } = {}) {
  assert.match(run, /^[a-z0-9][a-z0-9-]{0,79}$/);
  const base = new URL(process.env.PARITY_BASE_URL || "http://127.0.0.1:5178");
  assert.equal(base.href, "http://127.0.0.1:5178/", "Only the parent's isolated5178 server");
  const workspace = wikiProjections149Fixture();
  const audit = auditWikiProjections149Fixture(workspace);
  mkdirSync(evidencePath, { recursive: true });
  const directory = path.join(evidencePath, run);
  mkdirSync(directory); // Never overwrite an earlier RED/GREEN run.
  const put = (name, value) => writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
  put("fixture-audit149.json", audit);
  // Reuse the same public browserScenario lifecycle/storage/error checks as143.
  const { browserScenario } = await import("./harness.mjs");
  return browserScenario(`${evidenceRoot}/${run}/browser149`, async ({ page, context, check, screenshot, saved, persisted }) => {
    const outside = [];
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (["http:", "https:"].includes(url.protocol) && url.origin !== base.origin) { outside.push(url.href); return route.abort(); }
      return route.continue();
    });
    // One preparation reload installs the desktop transport before main.jsx.
    // Subsequent reloads load actual saves; this guard never re-seeds them.
    await context.addInitScript(installWikiProjections149DesktopFixture, { workspace, key: workspaceStorageKey });
    await page.reload({ waitUntil: "domcontentloaded" });
    const sidebar = page.getByRole("complementary", { name: "主导航" });
    await sidebar.waitFor();
    const collections = Object.keys(workspace).filter(key => Array.isArray(workspace[key]));
    const withoutVisit = folders => folders.map(({ lastOpenedPageId, ...folder }) => folder);
    const retained = actual => {
      for (const key of collections) assert.deepEqual(key === "folders" ? withoutVisit(actual[key]) : actual[key], key === "folders" ? withoutVisit(workspace[key]) : workspace[key], `Read-only projection/reload retains all ${key}`);
      for (const key of Object.keys(workspace).filter(key => !["ui", "savedAt"].includes(key) && !collections.includes(key))) assert.deepEqual(actual[key], workspace[key], `Read-only projection keeps ${key}`);
    };
    const surface = definition => page.locator(`section.database-view[data-source-id="${occurrence(workspace, definition).source.id}"][data-view-id="${viewId(definition)}"]`);
    const open = async pageId => {
      await sidebar.locator(`[data-node-id="${pageId}"] > .sidebar-page-main`).click();
      await persisted(value => value.ui.selectedPageId === pageId);
    };
    const settled = async () => {
      await page.waitForFunction(() => document.querySelector(".save-state")?.textContent === "已保存");
      const actual = await saved(); retained(actual); return actual;
    };
    const observations = {};
    const assertProjection = async (definition, phase) => {
      const { source } = occurrence(workspace, definition);
      const db = surface(definition);
      await db.waitFor();
      assert.equal(await db.getAttribute("data-view-type"), definition.type);
      assert.equal(await db.getByRole("tab", { name: definition.name, exact: true }).getAttribute("aria-selected"), "true");
      const expected = definition.snapshotOrder.map(title => {
        const record = one(definition.records.filter(entry => entry.title === title), "Known source147 record");
        const item = one(workspace.databaseItems.filter(entry => entry.sourceId === source.id && entry.values[property(source, definition.visibleNames[0]).id] === title), "Shared original canonical record");
        return { itemId: item.id, pageId: item.pageId, title, values: record.values };
      });
      const actual = await db.locator(definition.key === "w3" ? ".db-gallery-card" : ".db-list-row").evaluateAll((rows, gallery) => rows.map(row => {
        const title = row.querySelector(gallery ? ".db-gallery-title-text" : ".db-list-open");
        const properties = [...row.querySelectorAll(gallery ? ".db-gallery-properties > [data-property-id]" : ".db-list-properties > [data-property-id]")];
        return { itemId: row.dataset.itemId, title: title?.textContent.trim(),
          propertyIds: properties.map(entry => entry.dataset.propertyId), names: properties.map(entry => entry.title), values: properties.map(entry => entry.textContent.trim()),
          titleFirst: properties.every(entry => Boolean(title.compareDocumentPosition(entry) & Node.DOCUMENT_POSITION_FOLLOWING)),
          hasIcon: Boolean(row.querySelector(gallery ? ".db-gallery-title-icon" : ".db-list-icon")) };
      }), definition.key === "w3");
      assert.deepEqual(actual.map(entry => entry.itemId), expected.map(entry => entry.itemId), "DOM filters and sorts the actual full source records");
      assert.deepEqual(actual.map(entry => entry.title), definition.snapshotOrder);
      assert.deepEqual(actual.map(entry => entry.title).sort(), [...definition.sourceOrder].sort(), "Exact known source147 membership, no extra records");
      for (const [index, row] of actual.entries()) {
        assert.deepEqual(row.propertyIds, definition.visibleNames.slice(1).map(name => property(source, name).id), "Selected property IDs and order only");
        assert.deepEqual(row.names, definition.visibleNames.slice(1));
        assert.deepEqual(row.values, expected[index].values, "Full retained summary/author/takeaway/status content, never snippets");
        assert.equal(row.titleFirst, true, "Name/title precedes the selected property content");
        assert.equal(row.hasIcon, true);
        const recordPage = one(workspace.pages.filter(entry => entry.id === expected[index].pageId), "Original shared record Page");
        assert.equal(recordPage.databaseSourceId, source.id);
      }
      if (definition.key === "w3") {
        assert.equal(await db.locator(".db-gallery-view").getAttribute("data-card-size"), "medium");
        assert.equal(await db.locator(".db-gallery-preview").count(), 0, "Preview None does not substitute page content or cover");
      } else assert.equal(await db.locator(".db-gallery-view, .db-gallery-preview").count(), 0, "List remains an ordinary List renderer");
      await settled();
      observations[`${definition.key}-${phase}`] = actual;
      put(`observed-${definition.key}-${phase}.json`, actual);
      await screenshot(`${definition.key}-${phase}`);
    };

    await check("The entire actual Wiki fixture retains every source, page, record, attachment and118 histories with only two isolated existing-format projections", async () => {
      await surface(definitions[0]).waitFor();
      retained(await saved());
      assert.equal(await page.evaluate(() => window.lifeAtlas?.platform), "desktop", "Exercise the existing desktop repository path with complete history");
    });
    for (const definition of definitions) await check(`${definition.name} renders its known filter, descending sort and exact selected property order/content before reload`, async () => {
      await open(occurrence(workspace, definition).wrapper.id);
      await assertProjection(definition, "before-reload");
    });
    await check("Both projections use the existing canonical records and Pages while all original canonical views and unfiltered records remain intact", async () => {
      for (const definition of definitions) {
        const { source, owner } = occurrence(workspace, definition);
        const canonicalView = one(workspace.databaseViews.filter(entry => entry.id === owner.databaseViewId), "Original canonical default view");
        await open(owner.id);
        const canonical = page.locator(`section.database-view[data-source-id="${source.id}"][data-view-id="${canonicalView.id}"]`);
        await canonical.waitFor();
        assert.equal(await canonical.getAttribute("data-view-type"), "table");
        const ids = await canonical.locator("tbody tr[data-item-id]").evaluateAll(rows => rows.map(row => row.dataset.itemId));
        const sourceItems = workspace.databaseItems.filter(entry => entry.sourceId === source.id);
        assert.equal(ids.length, definition.sourceCount);
        assert.deepEqual([...ids].sort(), sourceItems.map(entry => entry.id).sort());
        for (const row of observations[`${definition.key}-before-reload`]) assert.ok(ids.includes(row.itemId), "The projection shares canonical item IDs");
        await settled();
      }
    });
    for (const definition of definitions) await check(`${definition.name} reload keeps shared identities, exact selected property content and the whole surrounding Wiki`, async () => {
      await open(occurrence(workspace, definition).wrapper.id);
      await settled();
      await page.reload({ waitUntil: "domcontentloaded" });
      await sidebar.waitFor();
      await assertProjection(definition, "after-reload");
      assert.deepEqual(observations[`${definition.key}-after-reload`], observations[`${definition.key}-before-reload`]);
    });
    await check("Read-only rendering and both reloads preserve every complete collection and make no external media request", async () => {
      await settled();
      assert.deepEqual(outside, []);
      put("preservation149.json", { passed: true, collections: audit.counts, originalViews: 31, originalPages: 84, originalRecords: 58, originalAttachments: 20, originalHistories: 118, observations: Object.keys(observations), gaps: audit.gaps });
    });
  }, { workspace, viewport: { width: 1440, height: 900 } });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await runV14WikiProjections149();
