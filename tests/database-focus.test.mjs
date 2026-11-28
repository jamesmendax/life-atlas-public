import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { handleDatabaseCellEscape } from "../src/components/databaseCellFocus.js";

function fixture() {
  const document = { activeElement: null };
  const details = { open: false };
  const effects = [];
  const cell = {
    querySelector(selector) {
      assert.equal(selector, "details[open]");
      return details.open ? details : null;
    },
    focus() { effects.push("cell.focus"); document.activeElement = cell; },
    blur() { effects.push("cell.blur"); document.activeElement = null; },
  };
  const input = {
    focus() { document.activeElement = input; },
    blur() { effects.push("input.blur"); document.activeElement = null; },
  };
  const event = (key, target = document.activeElement) => ({
    key, target, currentTarget: cell,
    preventDefault() { effects.push("preventDefault"); },
    stopPropagation() { effects.push("stopPropagation"); },
  });
  return { document, details, effects, cell, input, event };
}

test("the table calls the actual database cell Escape handler", () => {
  const table = fs.readFileSync(new URL("../src/components/DatabaseTable.jsx", import.meta.url), "utf8");
  assert.match(table, /import \{ handleDatabaseCellEscape \} from "\.\/databaseCellFocus\.js"/);
  assert.match(table, /if \(handleDatabaseCellEscape\(event\)\) return;/);
});

test("same-task Enter opening followed by Escape closes the picker before its delayed focus", () => {
  const { document, details, cell, input, event, effects } = fixture();
  cell.focus(); effects.length = 0;
  details.open = true;
  const delayedToggleFocus = () => { if (details.open) input.focus(); };
  assert.equal(handleDatabaseCellEscape(event("Escape")), true);
  assert.equal(details.open, false);
  assert.equal(document.activeElement, cell);
  delayedToggleFocus();
  assert.equal(document.activeElement, cell);
  assert.deepEqual(effects, ["preventDefault", "stopPropagation", "cell.focus"]);
});

test("Escape from a child editor closes the open picker and restores its cell", () => {
  const { document, details, cell, input, event, effects } = fixture();
  input.focus(); details.open = true;
  assert.equal(handleDatabaseCellEscape(event("Escape")), true);
  assert.equal(details.open, false);
  assert.equal(document.activeElement, cell);
  assert.deepEqual(effects, ["preventDefault", "stopPropagation", "input.blur", "cell.focus"]);
});

test("Escape from a child input without a picker preserves normal cell focus restoration", () => {
  const { document, cell, input, event, effects } = fixture();
  input.focus();
  assert.equal(handleDatabaseCellEscape(event("Escape")), true);
  assert.equal(document.activeElement, cell);
  assert.deepEqual(effects, ["preventDefault", "stopPropagation", "input.blur", "cell.focus"]);
});

test("Escape on a cell with no open editor does not consume the event", () => {
  const { document, cell, event, effects } = fixture();
  cell.focus(); effects.length = 0;
  assert.equal(handleDatabaseCellEscape(event("Escape")), false);
  assert.equal(document.activeElement, cell);
  assert.deepEqual(effects, []);
});

test("non-Escape keys leave normal arrow and Enter handling to the table", () => {
  for (const key of ["Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Tab", "a"]) {
    const { document, details, cell, input, event, effects } = fixture();
    for (const target of [cell, input]) {
      target.focus(); details.open = true; effects.length = 0;
      assert.equal(handleDatabaseCellEscape(event(key)), false);
      assert.equal(document.activeElement, target);
      assert.equal(details.open, true);
      assert.deepEqual(effects, []);
    }
  }
});
