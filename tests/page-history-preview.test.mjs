import assert from "node:assert/strict";
import test from "node:test";
import { pageHistoryPreview } from "../src/domain/pageHistory.js";

test("history preview keeps captured text and replaces live database and synced content references in place", () => {
  const view = { id: "view-block", type: "databaseView", props: { sourceId: "database", viewId: "first" } };
  const version = { pageType: "database", databaseSourceId: "database", databaseViewId: "first", content: [
    { id: "text", type: "paragraph", content: "之前的文本" },
    { id: "toggle", type: "toggleListItem", children: [view] },
    { id: "synced", type: "syncedBlock", props: { sourceId: "live-source" } },
    { id: "cards", type: "editorialSection", props: { sourceId: "database", fallbackJson: '[{"title":"历史卡片"}]' } },
  ] };
  const preview = pageHistoryPreview(version);
  assert.equal(preview.detachedDatabase, false);
  assert.deepEqual(preview.content[0], version.content[0]);
  assert.equal(preview.content[1].children[0].id, view.id);
  assert.match(preview.content[1].children[0].content, /^整页数据库/);
  assert.match(preview.content[2].content, /^同步区块/);
  assert.equal(preview.content[3].props.sourceId, "");
  assert.equal(preview.content[3].props.fallbackJson, version.content[3].props.fallbackJson);
  assert.equal(version.content[1].children[0].type, "databaseView");
  assert.equal(version.content[3].props.sourceId, "database");
  assert.equal(pageHistoryPreview({ ...version, content: [version.content[0]] }).detachedDatabase, true);
  assert.match(pageHistoryPreview({ content: [view] }).content[0].content, /^数据库视图/);
});
