import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveDatabaseOccurrenceLocation } from "../../src/domain/databaseOccurrenceNavigation.js";

const fixture = JSON.parse(readFileSync(new URL("../../.qa/LOCAL-NOTION-001/v14-wiki-real133/context136/native-selection141-final-closed35.json", import.meta.url), "utf8"));
const workspace = fixture.workspace;
const expectedArrays = {
  folders: 3, pages: 85, dataSources: 11, databaseItems: 58, databaseViews: 31,
  relations: 0, syncedSources: 0, attachments: 20, people: 1, pageTemplates: 0,
  databaseTemplates: 0, discussions: 0, comments: 0, pageVersions: 122,
};

function* entries(page, blocks = page.content, depth = 0) {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    yield { page, block, siblings: blocks, index, depth };
    if (Array.isArray(block.children)) yield* entries(page, block.children, depth + 1);
  }
}

function databaseEntries(current) {
  return current.pages.flatMap((page) => [...entries(page)].filter(({ block }) => block.type === "databaseView"));
}

const wiki = workspace.pages.find((page) => page.title === "Mendax 的 Vibe Coding Wiki");
const embedded = [...entries(wiki)].filter(({ block }) => block.type === "databaseView");
const first = embedded[0];
const location = { pageId: wiki.id, blockId: first.block.id };

function clone() { return structuredClone(workspace); }
function wikiIn(current) { return current.pages.find((page) => page.id === wiki.id); }
function firstIn(current) { return [...entries(wikiIn(current))].find(({ block }) => block.id === first.block.id); }
function plainResult(pageId, problem = null) { return { pageId, blockId: null, block: null, problem }; }

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

// Freeze all entities/content/history/UI and compare the complete serialized
// workspace, without printing a giant fixture if a mutation is detected.
function unchanged(current, action) {
  const before = JSON.stringify(current);
  const arrays = Object.entries(current).filter(([, value]) => Array.isArray(value));
  const contents = current.pages.map((page) => page.content);
  const ui = current.ui;
  deepFreeze(current);
  const result = action(current);
  assert.ok(JSON.stringify(current) === before, "resolver changed complete workspace content, metadata, histories or UI");
  for (const [key, array] of arrays) {
    assert.equal(current[key], array, `${key} array reference changed`);
    assert.equal(current[key].length, expectedArrays[key], `${key} was pruned`);
  }
  current.pages.forEach((page, index) => assert.equal(page.content, contents[index], "Page content reference changed"));
  assert.equal(current.ui, ui, "UI reference changed");
  return result;
}

function resolveUnchanged(current, target) {
  const before = JSON.stringify(target);
  deepFreeze(target);
  const result = unchanged(current, (input) => resolveDatabaseOccurrenceLocation(input, target));
  assert.ok(JSON.stringify(target) === before, "resolver changed its requested location");
  assert.deepEqual(Object.keys(result), ["pageId", "blockId", "block", "problem"]);
  return result;
}

test("complete85 fixture retains all 14 arrays, all 122 histories and seven recursive Wiki occurrences", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(workspace).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length])), expectedArrays);
  assert.equal(databaseEntries(workspace).length, 26);
  assert.equal(embedded.length, 7);
  assert.ok(embedded.every(({ depth }) => depth > 0));
  assert.equal(new Set(embedded.map(({ block }) => block.id)).size, 7);
  assert.equal(Object.hasOwn(workspace.ui, "selectedBlockId"), false, "legacy fixture must not silently gain selectedBlockId");
});

test("complete85 every database occurrence resolves its original block with zero workspace mutations", () => {
  unchanged(workspace, (input) => {
    for (const { page, block } of databaseEntries(input)) {
      const actual = resolveDatabaseOccurrenceLocation(input, { pageId: page.id, blockId: block.id });
      assert.equal(actual.pageId, page.id);
      assert.equal(actual.blockId, block.id);
      assert.equal(actual.block, block, "resolver replaced the exact occurrence object");
      assert.equal(actual.problem, null);
    }
  });
});

test("complete85 shared source/view pairs remain four distinct Wiki occurrence addresses", () => {
  const groups = new Map();
  for (const entry of embedded) {
    const key = `${entry.block.props.sourceId}/${entry.block.props.viewId}`;
    groups.set(key, [...(groups.get(key) || []), entry]);
  }
  const pairs = [...groups.values()].filter((group) => group.length === 2);
  assert.equal(pairs.length, 2);
  unchanged(workspace, (input) => {
    for (const pair of pairs) {
      const results = pair.map(({ block }) => resolveDatabaseOccurrenceLocation(input, { pageId: wiki.id, blockId: block.id }));
      assert.notEqual(results[0].blockId, results[1].blockId);
      results.forEach((actual, index) => {
        assert.equal(actual.block, pair[index].block);
        assert.equal(actual.problem, null);
      });
    }
  });
});

test("complete85 every untrashed Page without a block selection remains ordinary Page navigation", () => {
  unchanged(workspace, (input) => {
    for (const page of input.pages.filter((entry) => !entry.trashedAt)) {
      for (const blockId of [undefined, null, ""]) {
        assert.deepEqual(resolveDatabaseOccurrenceLocation(input, { pageId: page.id, blockId }), plainResult(page.id));
      }
    }
    assert.deepEqual(resolveDatabaseOccurrenceLocation(input, { pageId: wiki.id }), plainResult(wiki.id));
  });
});

test("complete85 canonical database Page without a block ID does not infer its database block", () => {
  const source = workspace.dataSources.find((entry) => entry.ownerPageId && workspace.pages.some((page) => page.id === entry.ownerPageId && page.pageType === "database"));
  assert.ok(source, "real fixture must include an explicit canonical database Page");
  const owner = workspace.pages.find((page) => page.id === source.ownerPageId);
  assert.ok([...entries(owner)].some(({ block }) => block.type === "databaseView"));
  assert.deepEqual(resolveUnchanged(workspace, { pageId: owner.id }), plainResult(owner.id));
});

test("complete85 stale persisted UI cannot replace an explicitly requested Page or occurrence", () => {
  const current = clone();
  current.ui.selectedPageId = current.pages.find((page) => page.id !== wiki.id).id;
  current.ui.selectedBlockId = "stale-selected-occurrence";
  const actual = resolveUnchanged(current, { ...location });
  assert.equal(actual.pageId, wiki.id);
  assert.equal(actual.block, firstIn(current).block);
  assert.equal(actual.problem, null);
  assert.equal(current.ui.selectedBlockId, "stale-selected-occurrence");
});

for (const [label, pageId] of [["undefined", undefined], ["null", null], ["empty", ""], ["whitespace", " \t"], ["number", 85], ["object", { id: wiki.id }]]) {
  test(`complete85 ${label} Page ID clears the location with page-id-invalid`, () => {
    assert.deepEqual(resolveUnchanged(workspace, { pageId, blockId: first.block.id }), plainResult(null, "page-id-invalid"));
  });
}

test("complete85 missing Page never follows a matching block in another Page", () => {
  assert.deepEqual(resolveUnchanged(workspace, { pageId: "missing-navigation155-page", blockId: first.block.id }), plainResult(null, "page-not-found"));
});

test("complete85 trashed occurrence owner clears both IDs even while its block remains present", () => {
  const current = clone();
  wikiIn(current).trashedAt = "2026-11-14T00:00:00.000Z";
  assert.deepEqual(resolveUnchanged(current, { ...location }), plainResult(null, "page-trashed"));
  assert.ok(firstIn(current).block, "trashed owner content remains intact");
});

for (const [label, blockId] of [["number", 7], ["boolean", false], ["object", { id: first.block.id }], ["array", [first.block.id]], ["whitespace", " \t"]]) {
  test(`complete85 ${label} selected block ID degrades to its Page with block-id-invalid`, () => {
    assert.deepEqual(resolveUnchanged(workspace, { pageId: wiki.id, blockId }), plainResult(wiki.id, "block-id-invalid"));
  });
}

test("complete85 unknown block ID degrades to its Page without selecting a shared database view", () => {
  assert.deepEqual(resolveUnchanged(workspace, { pageId: wiki.id, blockId: "missing-navigation155-block" }), plainResult(wiki.id, "block-not-found"));
});

test("complete85 lost nested occurrence degrades to its Page while all entity/history arrays remain complete", () => {
  const current = clone();
  const target = firstIn(current);
  target.siblings.splice(target.index, 1);
  assert.deepEqual(resolveUnchanged(current, { ...location }), plainResult(wiki.id, "block-not-found"));
  assert.equal([...entries(wikiIn(current))].filter(({ block }) => block.type === "databaseView").length, 6);
});

test("complete85 moved occurrence resolves only at the explicit new Page address", () => {
  const current = clone();
  const target = firstIn(current);
  const destination = current.pages.find((page) => page.id !== wiki.id && !page.trashedAt);
  const [moved] = target.siblings.splice(target.index, 1);
  destination.content.push(moved);
  unchanged(current, (input) => {
    assert.deepEqual(resolveDatabaseOccurrenceLocation(input, { ...location }), plainResult(wiki.id, "block-not-found"));
    const actual = resolveDatabaseOccurrenceLocation(input, { pageId: destination.id, blockId: moved.id });
    assert.equal(actual.pageId, destination.id);
    assert.equal(actual.block, moved);
    assert.equal(actual.problem, null);
  });
});

test("complete85 occurrence moved deeper inside the same Page retains its exact address", () => {
  const current = clone();
  const target = firstIn(current);
  const nestedParent = [...entries(wikiIn(current))].find(({ block, depth }) => depth > 0 && block.id !== target.block.id && block.type !== "databaseView");
  assert.ok(nestedParent, "real Wiki needs an existing nested block for reparenting");
  const [moved] = target.siblings.splice(target.index, 1);
  nestedParent.block.children = [...(nestedParent.block.children || []), moved];
  const actual = resolveUnchanged(current, { ...location });
  assert.equal(actual.block, moved);
  assert.ok(firstIn(current).depth > 1);
  assert.equal(actual.problem, null);
});

test("complete85 same ID duplicated across different Pages remains an exact composite location", () => {
  const current = clone();
  const original = firstIn(current).block;
  const destination = current.pages.find((page) => page.id !== wiki.id && !page.trashedAt);
  const copied = structuredClone(original);
  destination.content.push(copied);
  unchanged(current, (input) => {
    const left = resolveDatabaseOccurrenceLocation(input, { ...location });
    const right = resolveDatabaseOccurrenceLocation(input, { pageId: destination.id, blockId: copied.id });
    assert.equal(left.block, original);
    assert.equal(right.block, copied);
    assert.equal(left.problem, null);
    assert.equal(right.problem, null);
    assert.notEqual(left.pageId, right.pageId);
  });
});

test("complete85 duplicate occurrence IDs at different depths in one Page are ambiguous", () => {
  const current = clone();
  wikiIn(current).content.push(structuredClone(firstIn(current).block));
  assert.deepEqual(resolveUnchanged(current, { ...location }), plainResult(wiki.id, "block-id-ambiguous"));
});

test("complete85 database and ordinary block sharing one ID are ambiguous regardless of order", () => {
  for (const duplicateFirst of [true, false]) {
    const current = clone();
    const ordinary = structuredClone([...entries(wikiIn(current))].find(({ block }) => block.type !== "databaseView").block);
    ordinary.id = first.block.id;
    ordinary.children = [];
    if (duplicateFirst) wikiIn(current).content.unshift(ordinary);
    else wikiIn(current).content.push(ordinary);
    assert.deepEqual(resolveUnchanged(current, { ...location }), plainResult(wiki.id, "block-id-ambiguous"));
  }
});

test("complete85 changed occurrence type degrades to its Page instead of persisting an ordinary anchor", () => {
  const current = clone();
  firstIn(current).block.type = "paragraph";
  assert.deepEqual(resolveUnchanged(current, { ...location }), plainResult(wiki.id, "block-not-database-view"));
});

test("complete85 ordinary internal anchor remains transient with a recoverable type problem", () => {
  const ordinary = [...entries(wiki)].find(({ block }) => block.type !== "databaseView");
  assert.deepEqual(resolveUnchanged(workspace, { pageId: wiki.id, blockId: ordinary.block.id }), plainResult(wiki.id, "block-not-database-view"));
});

test("complete85 missing source/view references do not change exact occurrence identity or trigger normalization", () => {
  const current = clone();
  const block = firstIn(current).block;
  block.props.sourceId = "unresolved-navigation155-source";
  block.props.viewId = "unresolved-navigation155-view";
  block.props.viewIdsJson = "malformed-view-set";
  const actual = resolveUnchanged(current, { ...location });
  assert.equal(actual.block, block);
  assert.equal(actual.problem, null);
});

test("complete85 Page declarations never replace the requested embedded occurrence", () => {
  const current = clone();
  const page = wikiIn(current);
  const other = embedded.at(-1).block;
  page.pageType = "database";
  page.databaseSourceId = other.props.sourceId;
  page.databaseViewId = other.props.viewId;
  const actual = resolveUnchanged(current, { ...location });
  assert.equal(actual.block, firstIn(current).block);
  assert.equal(actual.blockId, first.block.id);
  assert.equal(actual.problem, null);
});

test("complete85 IDs are literal and are never trimmed or coerced", () => {
  unchanged(workspace, (input) => {
    assert.deepEqual(resolveDatabaseOccurrenceLocation(input, { pageId: ` ${wiki.id}`, blockId: first.block.id }), plainResult(null, "page-not-found"));
    assert.deepEqual(resolveDatabaseOccurrenceLocation(input, { pageId: wiki.id, blockId: `${first.block.id} ` }), plainResult(wiki.id, "block-not-found"));
  });
});

test("missing workspace or location yields a coded unavailable location without throwing", () => {
  assert.deepEqual(resolveDatabaseOccurrenceLocation(undefined, { ...location }), plainResult(null, "page-not-found"));
  assert.deepEqual(resolveDatabaseOccurrenceLocation(workspace), plainResult(null, "page-id-invalid"));
});
