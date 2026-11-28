import test from "node:test";
import assert from "node:assert/strict";
import { resolveDatabaseOccurrenceViews, serializeDatabaseOccurrenceViewIds } from "../src/domain/databaseOccurrenceViews.js";
import { projectViewItems } from "../src/domain/database.js";
import { native208, createFixture153, databaseBlocks, deepFreeze, wikiId, blockIds, sourceId, originalViewId, addedViewIds } from "../.qa/LOCAL-NOTION-001/v14-wiki-real133/viewset153/fixture153.mjs";

function resolveUnchanged(workspace, props) {
  const before = structuredClone({ workspace, props });
  deepFreeze(workspace);
  deepFreeze(props);
  const result = resolveDatabaseOccurrenceViews(workspace, props);
  assert.deepEqual({ workspace, props }, before, "resolver must preserve every collection and raw input");
  assert.deepEqual(Object.keys(result), ["known", "viewIds", "views", "selectedView", "problems"]);
  return result;
}

function codes(result) { return result.problems.map((problem) => problem.code); }
function view(workspace, id) { return workspace.databaseViews.find((entry) => entry.id === id); }

test("native208 fixture preserves all 14 collections, 84 pages, 58 items, 20 assets and all 118 histories", () => {
  assert.equal(native208.phase, "native208-formal30-v14-real-wiki-resume");
  const expectedCounts = { folders: 3, pages: 84, dataSources: 11, databaseItems: 58, databaseViews: 31, relations: 0, syncedSources: 0, attachments: 20, people: 1, pageTemplates: 0, databaseTemplates: 0, discussions: 0, comments: 0, pageVersions: 118 };
  assert.deepEqual(Object.fromEntries(Object.entries(native208.workspace).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length])), expectedCounts);
  const { workspace, blocks } = createFixture153();
  assert.deepEqual(Object.keys(workspace), Object.keys(native208.workspace));
  for (const key of Object.keys(workspace).filter((key) => !["pages", "databaseViews"].includes(key))) assert.deepEqual(workspace[key], native208.workspace[key], key);
  assert.equal(workspace.databaseViews.length, 34);
  assert.deepEqual(workspace.databaseViews.slice(0, 31), native208.workspace.databaseViews);
  assert.deepEqual(workspace.databaseViews.slice(31).map((entry) => entry.id), addedViewIds);
  const originalWiki = native208.workspace.pages.find((page) => page.id === wikiId);
  assert.equal(originalWiki.title, "Mendax 的 Vibe Coding Wiki");
  assert.deepEqual(blocks.map((block) => block.id), blockIds);
  for (const block of blocks) {
    const original = databaseBlocks(originalWiki.content).find((entry) => entry.id === block.id);
    assert.equal(original.props.sourceId, sourceId);
    assert.equal(original.props.viewId, originalViewId);
    block.props = structuredClone(original.props);
  }
  assert.deepEqual(workspace.pages, native208.workspace.pages, "only the two actual E3/E7 occurrence declarations may differ");
});

test("real E3/E7 have disjoint ordered view sets, original object references and exactly the same source/items", () => {
  const { workspace, blocks } = createFixture153();
  const first = resolveUnchanged(workspace, blocks[0].props);
  const second = resolveUnchanged(workspace, blocks[1].props);
  assert.deepEqual(first.viewIds, [addedViewIds[0], originalViewId]);
  assert.deepEqual(second.viewIds, [addedViewIds[2], addedViewIds[1]]);
  assert.equal(first.viewIds.some((id) => second.viewIds.includes(id)), false);
  assert.equal(first.known, true);
  assert.equal(second.known, true);
  assert.deepEqual(first.problems, []);
  assert.deepEqual(second.problems, []);
  assert.strictEqual(first.selectedView, view(workspace, originalViewId));
  assert.strictEqual(second.selectedView, view(workspace, addedViewIds[1]));
  const itemIds = ["item-20b959c7-2589-4f15-aa7c-1d727e23b2bc", "item-e4b9fd55-0c58-43ce-bde0-10164c9949b6", "item-8a2a59c8-6348-4db0-b1b7-95c3c6332338", "item-920d3873-aa41-48cc-be03-628eeca773cd", "item-df6a50a1-e82b-4b60-b192-1f612d886285", "item-5c0b26dd-1e0b-4646-8ff8-b271ea6f50a9"];
  for (const result of [first, second]) {
    result.views.forEach((entry, index) => {
      assert.strictEqual(entry, view(workspace, result.viewIds[index]));
      assert.equal(entry.sourceId, sourceId);
      const items = projectViewItems(workspace, entry);
      assert.deepEqual(items.map((item) => item.id), itemIds);
      for (const item of items) assert.strictEqual(item, workspace.databaseItems.find((candidate) => candidate.id === item.id));
    });
  }
});

test("same-name distinct views are retained within a set and across actual occurrences", () => {
  const { workspace, blocks } = createFixture153();
  const first = resolveUnchanged(workspace, blocks[0].props);
  const second = resolveUnchanged(workspace, blocks[1].props);
  assert.deepEqual([...first.views, ...second.views].map((entry) => entry.name), ["表格", "表格", "表格", "表格"]);
  assert.equal(new Set([...first.views, ...second.views].map((entry) => entry.id)).size, 4);
  assert.deepEqual(second.views.map((entry) => entry.type), ["list", "table"]);
  assert.notStrictEqual(first.selectedView, second.selectedView);
});

test("declared ordering survives shuffled workspace view storage without sorting or first-view fallback", () => {
  const { workspace, blocks } = createFixture153();
  workspace.databaseViews.reverse();
  const result = resolveUnchanged(workspace, blocks[0].props);
  assert.deepEqual(result.viewIds, [addedViewIds[0], originalViewId]);
  assert.deepEqual(result.views.map((entry) => entry.id), result.viewIds);
  assert.strictEqual(result.selectedView, view(workspace, originalViewId));
});

for (const legacy of [undefined, null, "", " \t\n"]) {
  test(`absent/blank legacy ${JSON.stringify(legacy)} stays unknown and exposes only its valid current reference`, () => {
    const { workspace, blocks } = createFixture153();
    const props = { ...blocks[0].props, viewIdsJson: legacy };
    const result = resolveUnchanged(workspace, props);
    assert.equal(result.known, false);
    assert.deepEqual(result.viewIds, [originalViewId]);
    assert.deepEqual(result.problems, []);
    assert.equal(result.views.length, 1);
    assert.strictEqual(result.views[0], view(workspace, originalViewId));
    assert.strictEqual(result.selectedView, result.views[0]);
    assert.equal(props.viewIdsJson, legacy);
  });
}

test("all seven untouched native208 Wiki occurrences remain unknown, without membership backfill", () => {
  const workspace = native208.workspace;
  const blocks = databaseBlocks(workspace.pages.find((page) => page.id === wikiId).content);
  assert.equal(blocks.length, 7);
  for (const block of blocks) {
    assert.equal(Object.hasOwn(block.props, "viewIdsJson"), false);
    const result = resolveUnchanged(workspace, block.props);
    assert.equal(result.known, false);
    assert.deepEqual(result.viewIds, [block.props.viewId]);
    assert.deepEqual(result.problems, []);
    assert.strictEqual(result.selectedView, view(workspace, block.props.viewId));
  }
});

test("legacy without a current view exposes no source views or guessed selection", () => {
  const { workspace } = createFixture153();
  for (const viewId of [undefined, null, ""]) {
    assert.deepEqual(resolveUnchanged(workspace, { sourceId, viewId }), { known: false, viewIds: [], views: [], selectedView: null, problems: [] });
  }
});

test("explicit singleton and explicit empty JSON are distinguishable from unknown legacy", () => {
  const { workspace } = createFixture153();
  const singleton = resolveUnchanged(workspace, { sourceId, viewId: originalViewId, viewIdsJson: JSON.stringify([originalViewId]) });
  assert.equal(singleton.known, true);
  assert.deepEqual(singleton.problems, []);
  const empty = resolveUnchanged(workspace, { sourceId, viewId: originalViewId, viewIdsJson: "[]" });
  assert.equal(empty.known, true);
  assert.deepEqual(empty.viewIds, []);
  assert.deepEqual(empty.views, []);
  assert.deepEqual(codes(empty), ["CURRENT_VIEW_NOT_MEMBER"]);
  assert.equal(empty.selectedView, null);
});

test("missing declared view keeps its ID and null slot; a valid current member does not hide the failure", () => {
  const { workspace, blocks } = createFixture153();
  const ids = [addedViewIds[0], "view-viewset153-missing", originalViewId];
  const result = resolveUnchanged(workspace, { ...blocks[0].props, viewIdsJson: JSON.stringify(ids) });
  assert.equal(result.known, true);
  assert.deepEqual(result.viewIds, ids);
  assert.equal(result.views.length, 3);
  assert.strictEqual(result.views[0], view(workspace, ids[0]));
  assert.equal(result.views[1], null);
  assert.strictEqual(result.views[2], view(workspace, ids[2]));
  assert.deepEqual(codes(result), ["VIEW_MISSING"]);
  assert.equal(result.problems[0].index, 1);
  assert.equal(result.problems[0].value, ids[1]);
  assert.equal(result.selectedView, null);
});

test("foreign real source reference remains inspectable, reports expected/actual source and never selects it", () => {
  const { workspace, blocks } = createFixture153();
  const foreign = workspace.databaseViews.find((entry) => entry.sourceId !== sourceId);
  const result = resolveUnchanged(workspace, { ...blocks[0].props, viewId: foreign.id, viewIdsJson: JSON.stringify([originalViewId, foreign.id]) });
  assert.deepEqual(result.viewIds, [originalViewId, foreign.id]);
  assert.strictEqual(result.views[1], foreign);
  assert.deepEqual(codes(result), ["VIEW_SOURCE_MISMATCH"]);
  assert.equal(result.problems[0].index, 1);
  assert.equal(result.problems[0].sourceId, sourceId);
  assert.equal(result.problems[0].actualSourceId, foreign.sourceId);
  assert.equal(result.selectedView, null);
});

test("trashed view keeps its reference and original object instead of disappearing from declared membership", () => {
  const { workspace, blocks } = createFixture153();
  const trashed = view(workspace, addedViewIds[0]);
  trashed.trashedAt = "2026-11-14T00:00:00.000Z";
  const result = resolveUnchanged(workspace, blocks[0].props);
  assert.deepEqual(result.viewIds, [addedViewIds[0], originalViewId]);
  assert.strictEqual(result.views[0], trashed);
  assert.deepEqual(codes(result), ["VIEW_TRASHED"]);
  assert.equal(result.problems[0].value, trashed.id);
  assert.equal(result.selectedView, null);
});

test("duplicate IDs preserve duplicate positions and report their exact index instead of deduplicating", () => {
  const { workspace, blocks } = createFixture153();
  const ids = [addedViewIds[0], originalViewId, addedViewIds[0]];
  const result = resolveUnchanged(workspace, { ...blocks[0].props, viewIdsJson: JSON.stringify(ids) });
  assert.deepEqual(result.viewIds, ids);
  assert.strictEqual(result.views[0], result.views[2]);
  assert.deepEqual(codes(result), ["VIEW_ID_DUPLICATE"]);
  assert.equal(result.problems[0].index, 2);
  assert.equal(result.problems[0].value, addedViewIds[0]);
  assert.equal(result.selectedView, null);
});

test("existing same-source current view outside the declared set is a failure, without appending or resetting", () => {
  const { workspace, blocks } = createFixture153();
  const result = resolveUnchanged(workspace, { ...blocks[0].props, viewId: addedViewIds[1] });
  assert.deepEqual(result.viewIds, [addedViewIds[0], originalViewId]);
  assert.deepEqual(codes(result), ["CURRENT_VIEW_NOT_MEMBER"]);
  assert.equal(result.problems[0].field, "viewId");
  assert.equal(result.problems[0].value, addedViewIds[1]);
  assert.equal(result.selectedView, null);
});

test("unknown current IDs fail in both declared and legacy occurrences, retaining the raw current reference", () => {
  const { workspace, blocks } = createFixture153();
  const missing = "view-viewset153-current-missing";
  for (const viewIdsJson of [undefined, blocks[0].props.viewIdsJson]) {
    const result = resolveUnchanged(workspace, { ...blocks[0].props, viewId: missing, viewIdsJson });
    assert.equal(result.selectedView, null);
    assert.equal(result.known, viewIdsJson !== undefined);
    assert.ok(result.problems.some((problem) => problem.code === "VIEW_MISSING" && problem.field === "viewId" && problem.value === missing));
    if (viewIdsJson === undefined) {
      assert.deepEqual(result.viewIds, [missing]);
      assert.deepEqual(result.views, [null]);
    } else assert.ok(codes(result).includes("CURRENT_VIEW_NOT_MEMBER"));
  }
});

test("non-string and blank parsed IDs keep their raw entries and positions with concrete errors", () => {
  const { workspace, blocks } = createFixture153();
  const ids = [originalViewId, null, 123, "", " \t", { id: originalViewId }, [originalViewId]];
  const result = resolveUnchanged(workspace, { ...blocks[0].props, viewIdsJson: JSON.stringify(ids) });
  assert.deepEqual(result.viewIds, ids);
  assert.equal(result.views.length, ids.length);
  assert.strictEqual(result.views[0], view(workspace, originalViewId));
  assert.deepEqual(result.views.slice(1), [null, null, null, null, null, null]);
  assert.deepEqual(result.problems.map((problem) => [problem.code, problem.index, problem.value]), ids.slice(1).map((id, index) => ["VIEW_ID_INVALID", index + 1, id]));
  assert.equal(result.selectedView, null);
});

test("malformed/non-array/non-string declarations retain the raw data and never become legacy or a usable fallback", () => {
  const { workspace, blocks } = createFixture153();
  for (const [raw, code] of [["[", "VIEW_IDS_JSON_INVALID"], ["null", "VIEW_IDS_NOT_ARRAY"], ["{}", "VIEW_IDS_NOT_ARRAY"], [JSON.stringify(originalViewId), "VIEW_IDS_NOT_ARRAY"], [[originalViewId], "VIEW_IDS_JSON_TYPE"], [false, "VIEW_IDS_JSON_TYPE"]]) {
    const result = resolveUnchanged(workspace, { ...blocks[0].props, viewIdsJson: raw });
    assert.equal(result.known, true);
    assert.deepEqual(result.viewIds, []);
    assert.deepEqual(result.views, []);
    assert.equal(result.selectedView, null);
    assert.deepEqual(codes(result), [code]);
    assert.deepEqual(result.problems[0].raw ?? result.problems[0].value, raw);
  }
});

test("declared set requires a current member even when viewId is absent/blank/invalid", () => {
  const { workspace, blocks } = createFixture153();
  for (const viewId of [undefined, null, "", " \t", 123]) {
    const result = resolveUnchanged(workspace, { ...blocks[0].props, viewId });
    assert.equal(result.selectedView, null);
    assert.ok(codes(result).includes("CURRENT_VIEW_NOT_MEMBER"));
    assert.deepEqual(result.viewIds, [addedViewIds[0], originalViewId]);
  }
});

test("missing source does not cause a fallback to an unrelated source or discard declared view IDs", () => {
  const { workspace, blocks } = createFixture153();
  const result = resolveUnchanged(workspace, { ...blocks[0].props, sourceId: "source-viewset153-missing" });
  assert.deepEqual(result.viewIds, [addedViewIds[0], originalViewId]);
  assert.ok(codes(result).includes("SOURCE_MISSING"));
  assert.equal(result.problems.find((problem) => problem.code === "SOURCE_MISSING").value, "source-viewset153-missing");
  assert.equal(result.selectedView, null);
  assert.strictEqual(result.views[1], view(workspace, originalViewId));
});

test("serializer writes only deterministic ordered JSON, retaining exact IDs and leaving its input untouched", () => {
  const ids = deepFreeze([addedViewIds[2], originalViewId, "view-中文", " view-with-padding "]);
  const expected = '["view-viewset153-project-list","view-6d0c9eac-e349-4046-8477-1442d1e64689","view-中文"," view-with-padding "]';
  assert.equal(serializeDatabaseOccurrenceViewIds(ids), expected);
  assert.equal(serializeDatabaseOccurrenceViewIds(ids), expected);
  assert.deepEqual(JSON.parse(expected), ids);
  assert.equal(serializeDatabaseOccurrenceViewIds([]), "[]");
});

test("serializer rejects duplicate, blank, non-string, sparse and non-array writes rather than repairing them", () => {
  const sparse = [originalViewId];
  sparse.length = 2;
  for (const [ids, code] of [[[originalViewId, originalViewId], "VIEW_ID_DUPLICATE"], [[originalViewId, ""], "VIEW_ID_INVALID"], [[" \t"], "VIEW_ID_INVALID"], [[null], "VIEW_ID_INVALID"], [[123], "VIEW_ID_INVALID"], [sparse, "VIEW_ID_INVALID"], [originalViewId, "VIEW_IDS_NOT_ARRAY"], [new Set([originalViewId]), "VIEW_IDS_NOT_ARRAY"]]) {
    const before = structuredClone(ids);
    deepFreeze(ids);
    assert.throws(() => serializeDatabaseOccurrenceViewIds(ids), (error) => error instanceof TypeError && error.code === code && error.problems[0].code === code);
    assert.deepEqual(ids, before);
  }
});
