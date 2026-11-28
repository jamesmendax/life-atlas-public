import test from "node:test";
import assert from "node:assert/strict";
import { SHORTCUTS } from "../src/editor/shortcuts.js";

test("every shortcut has a description and a verification note", () => {
  for (const shortcut of SHORTCUTS) {
    for (const property of ["group", "keys", "description", "verify"]) { assert.equal(typeof shortcut[property], "string"); assert.ok(shortcut[property].trim(), `${shortcut.id}.${property}`); }
    assert.ok(["导航", "页面", "编辑", "插入"].includes(shortcut.group));
  }
});

test("no shortcut is listed twice", () => {
  assert.equal(new Set(SHORTCUTS.map((shortcut) => shortcut.id)).size, SHORTCUTS.length);
  assert.equal(new Set(SHORTCUTS.map((shortcut) => shortcut.keys)).size, SHORTCUTS.length);
});
