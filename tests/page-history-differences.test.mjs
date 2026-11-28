import test from "node:test";
import assert from "node:assert/strict";
import { pageHistoryBlockDifferences, pageHistoryOriginLabel } from "../src/domain/pageHistoryDiff.js";

const paragraph = (id, content = id, children) => ({ id, type: "paragraph", content, ...(children ? { children } : {}) });

test("insertions and deletions keep the relative order of surviving IDs", () => {
  const old = [paragraph("a"), paragraph("removed", "旧段落"), paragraph("b")];
  const current = [paragraph("added", "新段落"), paragraph("a"), paragraph("b")];
  assert.deepEqual(pageHistoryBlockDifferences(old, current), {
    counts: { added: 1, removed: 1, changed: 0, moved: 0 },
    ambiguousIds: [],
    differences: [
      { id: "added", categories: ["added"], before: null, current: "新段落" },
      { id: "removed", categories: ["removed"], before: "旧段落", current: null },
    ],
  });
});

test("pure reordering identifies the moved block without marking sibling or container content changed", () => {
  const children = ["a", "b", "c", "d"].map((id) => paragraph(id));
  const old = [paragraph("container", "父级正文", children)];
  const current = [paragraph("container", "父级正文", [...children.slice(1), children[0]])];
  const result = pageHistoryBlockDifferences(old, current);
  assert.deepEqual(result.counts, { added: 0, removed: 0, changed: 0, moved: 1 });
  assert.deepEqual(result.differences, [{ id: "a", categories: ["moved"], before: "a", current: "a" }]);
});

test("reparented edited blocks show both categories and their descendants preserve their own identity", () => {
  const child = paragraph("child", "旧正文", [paragraph("grandchild", "独立正文")]);
  const old = [paragraph("first", "第一组", [child]), paragraph("second", "第二组")];
  const current = [paragraph("first", "第一组"), paragraph("second", "第二组", [{ ...child, content: "新正文" }])];
  const result = pageHistoryBlockDifferences(old, current);
  assert.deepEqual(result.counts, { added: 0, removed: 0, changed: 1, moved: 1 });
  assert.deepEqual(result.differences, [{ id: "child", categories: ["changed", "moved"], before: "旧正文", current: "新正文" }]);
});

test("table cell text and attachment captions supply readable block snippets", () => {
  const table = (label) => ({ id: "table", type: "table", content: { type: "tableContent", rows: [{ cells: [[{ type: "text", text: label }]] }] } });
  const image = (caption) => ({ id: "image", type: "image", props: { caption } });
  const result = pageHistoryBlockDifferences([table("旧单元格"), image("旧图注")], [table("新单元格"), image("新图注")]);
  assert.deepEqual(result.differences.map(({ before, current }) => [before, current]), [["旧单元格", "新单元格"], ["旧图注", "新图注"]]);
});

test("legacy duplicate IDs do not label either occurrence or inflate movement", () => {
  const old = [paragraph("duplicate", "第一处"), paragraph("stable"), paragraph("duplicate", "第二处")];
  const current = [paragraph("duplicate", "一处保留"), paragraph("stable")];
  assert.deepEqual(pageHistoryBlockDifferences(old, current), {
    counts: { added: 0, removed: 0, changed: 0, moved: 0 },
    ambiguousIds: ["duplicate"],
    differences: [],
  });
});

test("origin labels report recorded metadata and known local restoration", () => {
  assert.equal(pageHistoryOriginLabel({ origin: "manual", reason: "before-edit" }), "本机手动保存");
  assert.equal(pageHistoryOriginLabel({ origin: "local-action" }), "本机操作");
  assert.equal(pageHistoryOriginLabel({ reason: "pre-restore" }), "本机恢复操作");
  assert.equal(pageHistoryOriginLabel({ reason: "before-edit" }), "来源未知");
  assert.equal(pageHistoryOriginLabel({ reason: "idle" }), "来源未知");
});
