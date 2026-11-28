import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { walkBlocks } from "../src/domain/blockDocument.js";
import { createPageBundle, importPageBundle } from "../src/domain/pageBundle.js";
import { checkWorkspaceIntegrity } from "../src/domain/integrity.js";
import { workspaceToFiles, filesToWorkspace } from "../src/backup/serialize.js";

const SOURCE = new URL("../.qa/LOCAL-NOTION-001/v14-wiki-real133/context136/native-selection141-final-closed35.json", import.meta.url);
const LEGACY_SOURCE = new URL("../.qa/LOCAL-NOTION-001/v9-formal-database-ui01/evidence/native208-formal30-v14-real-wiki-resume.json", import.meta.url);
const COLLECTIONS = ["pages", "dataSources", "databaseItems", "databaseViews", "relations", "syncedSources", "people", "attachments"];
const same = (actual, expected, label) => assert.ok(isDeepStrictEqual(actual, expected), label);
const byId = (entities, id) => entities.find((entity) => entity.id === id);
const sorted = (entities) => [...entities].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function realWiki() {
  const workspace = JSON.parse(readFileSync(SOURCE, "utf8")).workspace;
  same([workspace.pages.length, workspace.databaseItems.length, workspace.dataSources.length, workspace.databaseViews.length, workspace.attachments.length, workspace.pageVersions.length], [85, 58, 11, 31, 20, 122], "complete retained real Wiki fixture");
  return workspace;
}

function occurrences(workspace) {
  const owner = workspace.pages.find((page) => page.title === "随笔" && page.pageType === null);
  const ownerBlock = walkBlocks(owner.content).find((block) => block.type === "databaseView");
  const source = byId(workspace.dataSources, ownerBlock.props.sourceId);
  const views = workspace.databaseViews.filter((view) => view.sourceId === source.id);
  assert.equal(source.ownerPageId, owner.id);
  assert.equal(views.length, 4);
  const page = workspace.pages.find((entry) => entry.title === "Mendax 的 Vibe Coding Wiki");
  const block = walkBlocks(page.content).find((entry) => entry.type === "databaseView" && entry.props.sourceId === source.id);
  return { owner, ownerBlock, source, views, page, block };
}

function declaredWiki() {
  const workspace = realWiki();
  const refs = occurrences(workspace);
  refs.block.props = { ...refs.block.props, viewId: refs.views[3].id, viewIdsJson: JSON.stringify([refs.views[2].id, refs.views[0].id, refs.views[3].id]) };
  refs.ownerBlock.props = { ...refs.ownerBlock.props, viewId: refs.views[1].id, viewIdsJson: JSON.stringify([refs.views[1].id, refs.views[3].id]) };
  return { workspace, ...refs };
}

function importCopy(workspace, page) {
  const target = { id: "references154-copy-target", folderId: page.folderId, title: "Copy destination", content: [], pageType: null, databaseSourceId: null, databaseViewId: null };
  const current = { ...workspace, pages: [...workspace.pages, target] };
  const before = structuredClone(current);
  const bundle = createPageBundle(page, current);
  const bundleBefore = structuredClone(bundle);
  let serial = 0;
  const result = importPageBundle(current, bundle, target.id, (collection) => `references154-${collection}-${++serial}`);
  same(current, before, "page import leaves all source entities and old histories untouched");
  same(bundle, bundleBefore, "page import does not mutate its bundle");
  const maps = {};
  for (const collection of COLLECTIONS) {
    const sourceEntities = collection === "pages" ? [bundle.page, ...bundle.related.pages] : bundle.related[collection];
    const importedEntities = collection === "pages" ? [result.page, ...result.workspace.pages.slice(current.pages.length)] : result.workspace[collection].slice(current[collection].length);
    assert.equal(importedEntities.length, sourceEntities.length, `${collection} copy count`);
    maps[collection] = new Map(sourceEntities.map((entity, index) => [entity.id, importedEntities[index].id]));
    for (const entity of sourceEntities) {
      assert.notEqual(maps[collection].get(entity.id), entity.id, `${collection} gets a fresh ID`);
      if (collection === "pages" && entity.id === page.id) assert.equal(maps[collection].get(entity.id), target.id, "bundle root uses the explicitly selected copy destination");
      else assert.ok(!current[collection].some((entry) => entry.id === maps[collection].get(entity.id)), `${collection} fresh IDs do not collide`);
    }
    if (collection !== "pages") same(result.workspace[collection].slice(0, current[collection].length), current[collection], `${collection} originals preserved exactly`);
  }
  for (const [collection, values] of Object.entries(current)) {
    if (Array.isArray(values) && !COLLECTIONS.includes(collection)) same(result.workspace[collection], values, `${collection} outside bundle stays intact`);
  }
  same(result.workspace.pages.filter((entry) => current.pages.some((original) => original.id === entry.id) && entry.id !== target.id), workspace.pages, "all 85 original pages preserved exactly");
  return { ...result, bundle, maps };
}

function checkDocument(original, copied, maps) {
  const before = walkBlocks(original), after = walkBlocks(copied);
  assert.equal(after.length, before.length);
  for (let index = 0; index < before.length; index++) {
    const source = before[index], target = after[index];
    assert.notEqual(target.id, source.id, "copied block identity is fresh");
    if (source.type !== "databaseView") continue;
    assert.equal(target.props.sourceId, maps.dataSources.get(source.props.sourceId));
    assert.equal(target.props.viewId, maps.databaseViews.get(source.props.viewId));
    if (Object.hasOwn(source.props, "viewIdsJson")) {
      same(JSON.parse(target.props.viewIdsJson), JSON.parse(source.props.viewIdsJson).map((id) => maps.databaseViews.get(id)), "ordered explicit occurrence references use fresh view IDs without adding sibling views");
    } else assert.equal(Object.hasOwn(target.props, "viewIdsJson"), false, "legacy unknown occurrence remains unknown");
  }
}

test("full real Wiki legacy baseline has no occurrence declarations and integrity is read only", () => {
  const workspace = realWiki(), before = structuredClone(workspace);
  assert.ok(workspace.pages.flatMap((page) => walkBlocks(page.content)).filter((block) => block.type === "databaseView").every((block) => !Object.hasOwn(block.props, "viewIdsJson")));
  same(checkWorkspaceIntegrity(workspace), { ok: true, problems: [] }, "legacy integrity remains compatible");
  same(workspace, before, "legacy source unchanged");
});

test("full real Wiki bundle copy rewrites independently ordered occurrence sets and keeps canonical and record references", () => {
  const { workspace, page, source, owner } = declaredWiki();
  const copy = importCopy(workspace, page);
  checkDocument(page.content, copy.page.content, copy.maps);
  const copiedOwner = byId(copy.workspace.pages, copy.maps.pages.get(owner.id));
  checkDocument(owner.content, copiedOwner.content, copy.maps);
  assert.equal(byId(copy.workspace.dataSources, copy.maps.dataSources.get(source.id)).ownerPageId, copiedOwner.id);
  for (const originalPage of copy.bundle.related.pages.filter((entry) => entry.pageType === "database")) {
    const copiedPage = byId(copy.workspace.pages, copy.maps.pages.get(originalPage.id));
    assert.equal(copiedPage.pageType, originalPage.pageType);
    assert.equal(copiedPage.databaseSourceId, copy.maps.dataSources.get(originalPage.databaseSourceId));
    assert.equal(copiedPage.databaseViewId, copy.maps.databaseViews.get(originalPage.databaseViewId));
  }
  for (const record of copy.bundle.related.databaseItems) {
    const copiedRecord = byId(copy.workspace.databaseItems, copy.maps.databaseItems.get(record.id));
    assert.equal(copiedRecord.sourceId, copy.maps.dataSources.get(record.sourceId));
    assert.equal(copiedRecord.pageId, copy.maps.pages.get(record.pageId));
  }
  same(checkWorkspaceIntegrity(copy.workspace), { ok: true, problems: [] }, "fresh bundle references are all valid");
});

test("nested and canonical synced documents rewrite explicit view sets only on database blocks", () => {
  const { workspace, page, source, views } = declaredWiki();
  const nested = { id: "references154-nested", type: "databaseView", props: { sourceId: source.id, viewId: views[1].id, viewIdsJson: JSON.stringify([views[3].id, views[1].id]) }, content: [] };
  page.content.push({ id: "references154-column", type: "column", children: [nested] });
  workspace.syncedSources.push({ id: "references154-sync", blocks: [{ id: "references154-sync-column", type: "column", children: [{ ...structuredClone(nested), id: "references154-synced-db" }] }] });
  page.content.push({ id: "references154-sync-block", type: "syncedBlock", props: { sourceId: "references154-sync" } });
  const raw = JSON.stringify([views[1].id]);
  page.content.push({ id: "references154-ordinary", type: "paragraph", props: { viewIdsJson: raw }, content: [] });
  page.unrelatedMetadata = { viewIdsJson: raw };
  const copy = importCopy(workspace, page);
  checkDocument(page.content, copy.page.content, copy.maps);
  const syncId = copy.maps.syncedSources.get("references154-sync");
  checkDocument(workspace.syncedSources[0].blocks, byId(copy.workspace.syncedSources, syncId).blocks, copy.maps);
  assert.equal(walkBlocks(copy.page.content).find((block) => block.type === "syncedBlock").props.sourceId, syncId);
  assert.equal(walkBlocks(copy.page.content).at(-1).props.viewIdsJson, raw, "unrelated paragraph metadata is untouched");
  assert.equal(copy.page.unrelatedMetadata.viewIdsJson, raw, "arbitrary objects are not occurrence declarations");
});

test("export keeps the existing dependency closure and does not expand a foreign view-set neighbor", () => {
  const workspace = realWiki(), { owner, ownerBlock, views } = occurrences(workspace);
  const baseline = createPageBundle(owner, workspace);
  const foreign = workspace.databaseViews.find((view) => !baseline.related.databaseViews.some((entry) => entry.id === view.id));
  assert.ok(foreign, "complete Wiki has views outside this dependency closure");
  ownerBlock.props.viewIdsJson = JSON.stringify([views[1].id, foreign.id]);
  const exported = createPageBundle(owner, workspace);
  for (const collection of COLLECTIONS) same(exported.related[collection].map((entry) => entry.id), baseline.related[collection].map((entry) => entry.id), `${collection} closure unchanged`);
  const copy = importCopy(workspace, owner);
  const copiedBlock = walkBlocks(copy.page.content).find((entry) => entry.type === "databaseView");
  same(JSON.parse(copiedBlock.props.viewIdsJson), [copy.maps.databaseViews.get(views[1].id), foreign.id], "unresolved foreign reference is not silently dropped or rebound");
});

test("malformed explicit view-set values remain exact on import instead of dropping or rebinding", () => {
  const workspace = realWiki(), { owner, ownerBlock, views } = occurrences(workspace);
  for (const raw of ["[", "{\"ids\":[]}", "null", "", "   ", null, 42, JSON.stringify([views[1].id, 42]), JSON.stringify([views[1].id, views[1].id])]) {
    ownerBlock.props.viewIdsJson = raw;
    const copy = importCopy(workspace, owner);
    const block = walkBlocks(copy.page.content).find((entry) => entry.type === "databaseView");
    same(block.props.viewIdsJson, raw, "malformed bytes/values remain available for diagnosis");
    assert.equal(block.props.viewId, copy.maps.databaseViews.get(ownerBlock.props.viewId), "current view is mapped independently without fallback");
  }
});

test("valid independent occurrence sets pass integrity without guessing legacy sibling membership", () => {
  const { workspace, block } = declaredWiki(), before = structuredClone(workspace);
  same(checkWorkspaceIntegrity(workspace), { ok: true, problems: [] }, "different ordered sets on the shared source are valid");
  same(workspace, before, "integrity does not normalize the workspace");
  // Parent-reviewed worker153 defines absent/null/blank JSON as unknown legacy
  // membership. Integrity shares that contract, including editor default values.
  for (const legacy of [undefined, null, "", " \t\n"]) {
    block.props.viewIdsJson = legacy;
    block.props.viewId = "references154-unknown-legacy-view";
    const legacyBefore = structuredClone(workspace);
    same(checkWorkspaceIntegrity(workspace), { ok: true, problems: [] }, "unknown membership retains preexisting legacy integrity behavior");
    same(workspace, legacyBefore, "legacy membership is not guessed or repaired");
  }
});

test("integrity rejects every explicit malformed JSON shape and duplicate or invalid ID", () => {
  const cases = [["[", "VIEW_IDS_JSON_INVALID"], [42, "VIEW_IDS_JSON_TYPE"], [false, "VIEW_IDS_JSON_TYPE"], [[], "VIEW_IDS_JSON_TYPE"], ["{}", "VIEW_IDS_NOT_ARRAY"], ["null", "VIEW_IDS_NOT_ARRAY"], ["42", "VIEW_IDS_NOT_ARRAY"], ["[\"\"]", "VIEW_ID_INVALID"], ["[\"   \"]", "VIEW_ID_INVALID"], ["[42]", "VIEW_ID_INVALID"]];
  const workspace = realWiki(), { page, block, views } = occurrences(workspace);
  cases.push([JSON.stringify([views[1].id, views[1].id]), "VIEW_ID_DUPLICATE"]);
  for (const [raw, suffix] of cases) {
    block.props.viewIdsJson = raw;
    const before = structuredClone(workspace), result = checkWorkspaceIntegrity(workspace);
    assert.equal(result.ok, false, suffix);
    assert.ok(result.problems.some((problem) => problem.code === `DATABASE_BLOCK_${suffix}` && problem.severity === "error" && problem.collection === "pages" && problem.id === page.id && problem.detail.includes(block.id)), suffix);
    same(workspace, before, "malformed declaration is reported without mutation");
  }
});

test("integrity reports missing trashed foreign-source and nonmember current view references", () => {
  const { workspace, page, block, views, source } = declaredWiki();
  const foreign = workspace.databaseViews.find((view) => view.sourceId !== source.id);
  views[1].trashedAt = "2026-11-14T00:00:00.000Z";
  block.props.viewIdsJson = JSON.stringify(["references154-missing-view", views[1].id, foreign.id]);
  const before = structuredClone(workspace), result = checkWorkspaceIntegrity(workspace);
  assert.equal(result.ok, false);
  for (const suffix of ["VIEW_MISSING", "VIEW_TRASHED", "VIEW_SOURCE_MISMATCH", "CURRENT_VIEW_NOT_MEMBER"]) assert.ok(result.problems.some((problem) => problem.code === `DATABASE_BLOCK_${suffix}` && problem.id === page.id && problem.severity === "error"), suffix);
  same(workspace, before, "invalid references are retained");
  block.props = { ...block.props, sourceId: "references154-missing-source", viewIdsJson: JSON.stringify([views[3].id]) };
  assert.ok(checkWorkspaceIntegrity(workspace).problems.some((problem) => problem.code === "DATABASE_BLOCK_SOURCE_MISSING" && problem.id === page.id && problem.severity === "error"));
  for (const viewId of [undefined, "", views[0].id]) {
    block.props = { sourceId: source.id, viewId, viewIdsJson: JSON.stringify([views[3].id]) };
    assert.ok(checkWorkspaceIntegrity(workspace).problems.some((problem) => problem.code === "DATABASE_BLOCK_CURRENT_VIEW_NOT_MEMBER" && problem.id === page.id), "explicit current view must belong to the set");
  }
});

test("integrity checks nested database blocks in existing page template database template and synced paths", () => {
  const workspace = realWiki(), { page, source, views } = occurrences(workspace);
  const nested = (id) => [{ id: `${id}-container`, type: "column", children: [{ id: `${id}-db`, type: "databaseView", props: { sourceId: source.id, viewId: views[1].id, viewIdsJson: "[\"references154-missing-view\"]" } }] }];
  page.content.push(...nested("references154-page"));
  workspace.pageTemplates.push({ id: "references154-page-template", content: nested("references154-page-template") });
  workspace.databaseTemplates.push({ id: "references154-database-template", sourceId: source.id, defaultValues: {}, pageContent: nested("references154-database-template") });
  workspace.syncedSources.push({ id: "references154-sync", blocks: nested("references154-sync") });
  const before = structuredClone(workspace), result = checkWorkspaceIntegrity(workspace);
  for (const [collection, id] of [["pages", page.id], ["pageTemplates", "references154-page-template"], ["databaseTemplates", "references154-database-template"], ["syncedSources", "references154-sync"]]) assert.ok(result.problems.some((problem) => problem.collection === collection && problem.id === id && problem.code === "DATABASE_BLOCK_VIEW_MISSING" && problem.severity === "error"), collection);
  same(workspace, before, "all document paths are checked without editing them");
});

test("selectedBlockId integrity keeps valid nested occurrences and reports stale addresses as recoverable warnings", () => {
  const workspace = realWiki(), { page, block, source, views, owner } = occurrences(workspace);
  page.content.push({ id: "references154-selection-container", type: "column", children: [{ id: "references154-selected-nested", type: "databaseView", props: { sourceId: source.id, viewId: views[2].id } }] });
  workspace.ui = { ...workspace.ui, selectedPageId: page.id, selectedBlockId: "references154-selected-nested" };
  same(checkWorkspaceIntegrity(workspace), { ok: true, problems: [] }, "nested valid occurrence is recoverable by exact page and block identity");
  for (const [pageId, blockId] of [[page.id, "references154-deleted-block"], [owner.id, block.id], ["references154-deleted-page", block.id], [page.id, "references154-selection-container"]]) {
    workspace.ui.selectedPageId = pageId; workspace.ui.selectedBlockId = blockId;
    const before = structuredClone(workspace), result = checkWorkspaceIntegrity(workspace);
    assert.equal(result.ok, true, "stale navigation never corrupts the workspace");
    assert.ok(result.problems.some((problem) => problem.code === "UI_SELECTED_BLOCK_UNAVAILABLE" && problem.severity === "warning" && problem.collection === "ui" && problem.id === blockId), "recoverable warning identifies the stale target");
    same(workspace, before, "integrity does not choose a canonical page or repair UI state");
  }
  workspace.ui = { ...workspace.ui, selectedPageId: page.id, selectedBlockId: block.id };
  page.trashedAt = "2026-11-14T00:00:00.000Z";
  assert.ok(checkWorkspaceIntegrity(workspace).problems.some((problem) => problem.code === "UI_SELECTED_BLOCK_UNAVAILABLE" && problem.severity === "warning"));
});

test("legacy UI with no selected page or no selected block does not invent an occurrence selection", () => {
  const workspace = realWiki();
  delete workspace.ui.selectedPageId;
  workspace.ui.selectedBlockId = "references154-no-page";
  same(checkWorkspaceIntegrity(workspace), { ok: true, problems: [] }, "a block address is validated only alongside selectedPageId");
  delete workspace.ui.selectedBlockId;
  workspace.ui.selectedPageId = workspace.pages[0].id;
  same(checkWorkspaceIntegrity(workspace), { ok: true, problems: [] }, "legacy page-only navigation is untouched");
});

test("complete 85 and 84 page JSONL backups preserve optional occurrence fields and all 122 and 118 legacy histories exactly", () => {
  const sourceBytes = readFileSync(SOURCE, "utf8"), legacyBytes = readFileSync(LEGACY_SOURCE, "utf8");
  const declared = declaredWiki();
  declared.workspace.ui = { ...declared.workspace.ui, selectedPageId: declared.page.id, selectedBlockId: declared.block.id };
  const legacy = JSON.parse(legacyBytes).workspace;
  same([legacy.pages.length, legacy.databaseItems.length, legacy.dataSources.length, legacy.databaseViews.length, legacy.attachments.length, legacy.pageVersions.length], [84, 58, 11, 31, 20, 118], "entire older source is present");
  for (const workspace of [declared.workspace, legacy]) {
    const before = structuredClone(workspace);
    const files = new Map(workspaceToFiles(workspace).map((file) => [file.path, file.bytes]));
    const restored = filesToWorkspace((path) => files.get(path));
    for (const [key, value] of Object.entries(workspace)) same(restored[key], Array.isArray(value) ? sorted(value) : value, `${key} full backup roundtrip`);
    same(restored.pageVersions, sorted(workspace.pageVersions), "every old history field and ID is exact");
    assert.ok(restored.pageVersions.every((version) => ["pageType", "databaseSourceId", "databaseViewId"].every((key) => !Object.hasOwn(version, key))), "old histories receive no backfilled declarations");
    same(workspace, before, "full JSONL serialization does not edit the workspace");
  }
  assert.equal(readFileSync(SOURCE, "utf8"), sourceBytes, "complete 85-page source evidence remains exact");
  assert.equal(readFileSync(LEGACY_SOURCE, "utf8"), legacyBytes, "complete 84-page source evidence remains exact");
});
