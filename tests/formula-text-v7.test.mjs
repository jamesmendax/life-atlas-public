import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFormula } from "../src/domain/formula/engine.js";
import { isEmptyProperty } from "../src/domain/databaseProperties.js";

const values = { zero: 0, unchecked: false, name: "Alpha", text: "a1b2", pattern: "[0-9]", tags: ["Alpha", "beta"] };
const resolveName = (name) => ({ Number: "zero", Checked: "unchecked", Name: "name", Text: "text", Pattern: "pattern", Tags: "tags" })[name];
const evaluate = (source) => evaluateFormula(source, (id) => values[id], { resolveName });

for (const [expression, expected] of [
  ["empty(0)", true], ["empty(false)", true],
  ['contains("Alpha", "ALPHA")', false],
  ['replaceAll("a1b2", "[0-9]", "X")', "aXbX"],
  ['substring("Atlas", 1, 4)', "tla"], ['repeat("ab", 3)', "ababab"],
  ['test("a1b2", "[0-9]")', true], ['replace("a1b2", "[0-9]", "X")', "aXb2"],
]) test(`observed expression ${expression}`, () => assert.equal(evaluate(expression), expected));

test("original observed batches produce the Notion preview text", () => {
  const semantics = '"empty0=" + format(empty(0)) + "; emptyFalse=" + format(empty(false)) + "; containsCase=" + format(contains("Alpha", "ALPHA")) + "; regexReplace=" + replaceAll("a1b2", "[0-9]", "X")';
  const text = '"substring=" + substring("Atlas", 1, 4) + "; replace=" + replace("a1b2", "[0-9]", "X") + "; replaceAll=" + replaceAll("a1b2", "[0-9]", "X") + "; contains=" + format(contains("Alpha", "ALPHA")) + "; upper=" + upper("Atlas") + "; lower=" + lower("ATLAS") + "; repeat=" + repeat("ab", 3) + "; test=" + format(test("a1b2", "[0-9]"))';
  assert.equal(evaluate(semantics), "empty0=true; emptyFalse=true; containsCase=false; regexReplace=aXbX");
  assert.equal(evaluate(text), "substring=tla; replace=aXb2; replaceAll=aXbX; contains=false; upper=ATLAS; lower=atlas; repeat=ababab; test=true");
});

test("property references work and property storage emptiness remains unchanged", () => {
  for (const [expression, expected] of [
    ['empty(prop("Number"))', true], ['empty(prop("Checked"))', true],
    ['contains(prop("Name"), "ALPHA")', false], ['contains(prop("Tags"), "Alpha")', true],
    ['contains(prop("Tags"), "alpha")', false], ['replaceAll(prop("Text"), prop("Pattern"), "X")', "aXbX"],
    ['substring(prop("Name"), 1, 4)', "lph"], ['repeat(prop("Name"), 2)', "AlphaAlpha"],
    ['test(prop("Text"), prop("Pattern"))', true],
  ]) assert.equal(evaluate(expression), expected, expression);
  assert.equal(isEmptyProperty(0), false);
  assert.equal(isEmptyProperty(false), false);
});

test("text functions propagate reference errors and report invalid inputs", () => {
  for (const expression of ['substring(prop("missing"), 1, 4)', 'repeat(prop("missing"), 3)', 'test(prop("missing"), "x")', 'replace("a", prop("missing"), "x")']) {
    assert.equal(evaluate(expression).error.code, "REF", expression);
  }
  for (const expression of ['substring("Atlas", "bad", 4)', 'repeat("ab", "bad")', 'repeat("ab", 100001)']) {
    assert.equal(evaluate(expression).error.code, "TYPE", expression);
  }
  for (const expression of ['test("a", "[")', 'replace("a", "[", "x")', 'replaceAll("a", "[", "x")']) {
    assert.ok(evaluate(expression).error, expression);
  }
});
