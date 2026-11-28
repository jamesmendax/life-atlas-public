import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAllowedEditorLink, parseBlockLink } from "../src/editor/links.js";

test("lifeatlas page links are allowed", () => {
  assert.equal(isAllowedEditorLink("lifeatlas://page/p-a1#block-b-a1-h"), true);
  assert.equal(isAllowedEditorLink("lifeatlas://page/p-a1"), true);
});

test("javascript links are rejected", () => {
  for (const href of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "file:///C:/a"]) assert.equal(isAllowedEditorLink(href), false, href);
});

test("relative and web links stay allowed", () => {
  for (const href of ["https://example.com", "mailto:a@b.c", "#section", "docs/a.md"]) assert.equal(isAllowedEditorLink(href), true, href);
});

test("block links parse page and block ids", () => {
  assert.deepEqual(parseBlockLink("lifeatlas://page/p-a1#block-b-a1-h"), { pageId: "p-a1", blockId: "b-a1-h" });
  assert.deepEqual(parseBlockLink("lifeatlas://page/p-a1"), { pageId: "p-a1", blockId: null });
});

test("malformed block links are rejected", () => {
  for (const href of ["lifeatlas://page/", "lifeatlas://page/a b", "lifeatlas://other/x"]) assert.equal(parseBlockLink(href), null, href);
});

test("block focus excludes unstable parent callback identity", () => {
  const editorSource = readFileSync(new URL("../src/editor/PageEditor.jsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const focusEffect = editorSource.match(/useEffect\(\(\) => \{\n    if \(!focusBlockId\)[\s\S]*?\n  \}, \[([^\]]*)\]\);/);
  assert.ok(focusEffect);
  assert.equal(focusEffect[1].replace(/\s/g, ""), "editor,focusBlockId");
  assert.match(editorSource, /const blockFocusedCallback = useRef\(onBlockFocused\);/);
  assert.match(editorSource, /blockFocusedCallback\.current = onBlockFocused;/);
  assert.equal((focusEffect[0].match(/blockFocusedCallback\.current\?\.\(\)/g) || []).length, 2);
  assert.match(focusEffect[0], /\}, 1200\)/);
  assert.match(focusEffect[0], /cancelAnimationFrame\(frame\)/);
  assert.match(focusEffect[0], /window\.clearTimeout\(highlightTimer\)/);
  assert.doesNotMatch(focusEffect[0], /classList|setAttribute/);
});
