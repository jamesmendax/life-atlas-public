import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHistory, pushLocation, goBack, goForward } from "../src/domain/navigationHistory.js";

const snapshot208 = JSON.parse(readFileSync(new URL("../.qa/LOCAL-NOTION-001/v9-formal-database-ui01/evidence/native208-formal30-v14-real-wiki-resume.json", import.meta.url), "utf8"));
const targets123 = JSON.parse(readFileSync(new URL("../.qa/LOCAL-NOTION-001/v13-wiki-navigation122/targets123/targets123.json", import.meta.url), "utf8"));
const wiki = snapshot208.workspace.pages.find((page) => page.id === targets123.wiki.pageId);
const siteStructure = wiki.content.find((block) => block.id === targets123.wiki.siteStructure.blockId);

function occurrenceLocation(targetId) {
  const target = targets123.embeddedRootViews.find((entry) => entry.targetId === targetId);
  const block = siteStructure.children.find((entry) => entry.id === target.blockId);
  return { section: "private", pageId: wiki.id, folderId: wiki.folderId, blockId: block.id };
}

test("native208 contains the seven targets123 Wiki occurrences, including shared source/view pairs", () => {
  assert.equal(snapshot208.phase, "native208-formal30-v14-real-wiki-resume");
  assert.equal(wiki.title, "Mendax 的 Vibe Coding Wiki");
  assert.deepEqual(targets123.embeddedRootViews.map((target) => target.targetId), ["E1", "E2", "E3", "E4", "E5", "E6", "E7"]);
  const blocks = siteStructure.children.filter((block) => block.type === "databaseView");
  assert.deepEqual(blocks.map((block) => block.id), targets123.embeddedRootViews.map((target) => target.blockId));
  assert.equal(new Set(blocks.map((block) => block.id)).size, 7);
  for (const target of targets123.embeddedRootViews) {
    const block = blocks.find((entry) => entry.id === target.blockId);
    assert.equal(wiki.id, target.ownerPageId);
    assert.equal(wiki.id, target.expected.selectedPageId);
    assert.equal(wiki.folderId, target.expected.selectedFolderId);
    assert.equal(block.id, target.expected.focusBlockId);
    assert.equal(block.props.sourceId, target.expected.activeSourceId);
    assert.equal(block.props.viewId, target.expected.activeViewId);
  }
  for (const [firstId, secondId] of [["E3", "E7"], ["E5", "E6"]]) {
    const first = blocks.find((block) => block.id === occurrenceLocation(firstId).blockId);
    const second = blocks.find((block) => block.id === occurrenceLocation(secondId).blockId);
    assert.deepEqual([first.props.sourceId, first.props.viewId], [second.props.sourceId, second.props.viewId]);
  }
});

for (const [firstId, secondId] of [["E3", "E7"], ["E5", "E6"]]) {
  test(`native208 ${firstId}/${secondId}: same-page distinct blocks survive Back and Forward`, () => {
    const first = occurrenceLocation(firstId);
    const second = occurrenceLocation(secondId);
    assert.equal(first.pageId, second.pageId);
    assert.notEqual(first.blockId, second.blockId);

    const history = pushLocation(pushLocation(createHistory(), first), second);
    assert.equal(history.entries.length, 2, `${firstId}/${secondId}: two blocks on the same Wiki page were collapsed into one history entry`);
    assert.deepEqual(history.entries, [first, second]);
    assert.equal(history.index, 1);

    const back = goBack(history, () => true);
    assert.deepEqual(back.location, first);
    assert.equal(back.history.index, 0);
    const forward = goForward(back.history, () => true);
    assert.deepEqual(forward.location, second);
    assert.equal(forward.history.index, 1);
  });
}

test("adjacent identical native208 occurrence locations are deduplicated", () => {
  const location = occurrenceLocation("E3");
  const history = pushLocation(createHistory(), location);
  assert.equal(pushLocation(history, { ...location }), history);
  assert.equal(history.entries.length, 1);
  assert.deepEqual(history.entries[0], location);
});

test("ordinary native208 pages retain Back/Forward and optional blockId compatibility", () => {
  const aboutLink = siteStructure.children.find((block) => block.type === "pageLink" && block.props.label === "关于");
  const about = snapshot208.workspace.pages.find((page) => page.id === aboutLink.props.pageId);
  const rootLocation = { section: "private", pageId: wiki.id, folderId: wiki.folderId };
  const aboutLocation = { section: "private", pageId: about.id, folderId: about.folderId };
  let history = pushLocation(createHistory(), rootLocation);
  for (const blockId of [undefined, null, ""]) {
    assert.equal(pushLocation(history, { ...rootLocation, blockId }), history);
  }
  history = pushLocation(history, aboutLocation);
  assert.deepEqual(history.entries, [rootLocation, aboutLocation]);
  const back = goBack(history, () => true);
  assert.deepEqual(back.location, rootLocation);
  assert.deepEqual(goForward(back.history, () => true).location, aboutLocation);
});

test("plain Wiki page and its embedded occurrence remain separate history destinations", () => {
  const rootLocation = { section: "private", pageId: wiki.id, folderId: wiki.folderId };
  const occurrence = occurrenceLocation("E3");
  let history = createHistory();
  for (const location of [rootLocation, occurrence, rootLocation]) history = pushLocation(history, location);
  assert.deepEqual(history.entries, [rootLocation, occurrence, rootLocation]);
  const backToOccurrence = goBack(history, () => true);
  assert.deepEqual(backToOccurrence.location, occurrence);
  const backToRoot = goBack(backToOccurrence.history, () => true);
  assert.deepEqual(backToRoot.location, rootLocation);
  const forwardToOccurrence = goForward(backToRoot.history, () => true);
  assert.deepEqual(forwardToOccurrence.location, occurrence);
  assert.deepEqual(goForward(forwardToOccurrence.history, () => true).location, rootLocation);
});
