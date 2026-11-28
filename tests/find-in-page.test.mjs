import test from "node:test";
import assert from "node:assert/strict";
import { findTextMatches } from "../src/editor/findInPage.js";

test("matches are case insensitive and stay inside one unit", () => {
  assert.deepEqual(findTextMatches(["Alpha alpha", "ALPHA"], "alpha"), [{ unit: 0, start: 0, end: 5 }, { unit: 0, start: 6, end: 11 }, { unit: 1, start: 0, end: 5 }]);
  assert.deepEqual(findTextMatches(["ab", "c"], "bc"), []);
});

test("regular expression characters are literal", () => {
  assert.deepEqual(findTextMatches(["a.b axb"], "a.b"), [{ unit: 0, start: 0, end: 3 }]);
});

test("an empty query finds nothing", () => {
  assert.deepEqual(findTextMatches(["abc"], ""), []);
  assert.deepEqual(findTextMatches(["abc"], "   "), []);
});
