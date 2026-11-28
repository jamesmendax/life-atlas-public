import assert from "node:assert/strict";
import test from "node:test";
import { boardGroupValue, handleBoardTitleKey } from "../src/components/databaseBoardInteractions.js";

function typeTitleKey(key, nativeEvent = {}) {
  const result = { stopped: false, prevented: false, finishes: [] };
  handleBoardTitleKey({
    key, nativeEvent, currentTarget: { value: "修订后的标题" },
    stopPropagation() { result.stopped = true; },
    preventDefault() { result.prevented = true; },
  }, (...args) => result.finishes.push(args));
  return result;
}

test("board title Enter requests a commit and Escape requests a discard, both requesting focus restoration", () => {
  assert.deepEqual(typeTitleKey("Enter"), { stopped: true, prevented: true, finishes: [["修订后的标题", true, true]] });
  assert.deepEqual(typeTitleKey("Escape"), { stopped: true, prevented: true, finishes: [["修订后的标题", false, true]] });
});

test("typing, Tab, and composition keys do not submit or cancel a board title", () => {
  const editing = { stopped: true, prevented: false, finishes: [] };
  assert.deepEqual(typeTitleKey("Enter", { isComposing: true }), editing);
  assert.deepEqual(typeTitleKey("Escape", { keyCode: 229 }), editing);
  assert.deepEqual(typeTitleKey("Tab"), editing);
  assert.deepEqual(typeTitleKey("a"), editing);
});

test("moving a board card changes its group and preserves its other memberships", () => {
  for (const type of ["multi_select", "people"]) {
    const values = Object.freeze(["first", "other", "last"]);
    assert.deepEqual(boardGroupValue(type, "next", values, "first"), ["other", "last", "next"]);
    assert.deepEqual(boardGroupValue(type, "last", values, "first"), ["other", "last"]);
    assert.deepEqual(boardGroupValue(type, "first", values, "first"), values);
    assert.deepEqual(boardGroupValue(type, "未分组", values, "first"), []);
    assert.deepEqual(boardGroupValue(type, "first", undefined, "未分组"), ["first"]);
  }
  for (const type of ["select", "status"]) {
    assert.equal(boardGroupValue(type, "done", "todo", "todo"), "done");
    assert.equal(boardGroupValue(type, "未分组", "todo", "todo"), null);
  }
});
