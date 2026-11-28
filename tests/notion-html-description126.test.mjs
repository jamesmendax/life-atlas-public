import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseNotionHtmlPage, notionHtmlToBlocks } from "../src/import/notionHtml.js";

const source = await readFile(new URL("../src/import/notionHtml.js", import.meta.url), "utf8");

// Node has no HTML DOM in this checkout. These are source contracts, not DOM
// behavior tests; the QA browser-checks126.mjs helper exercises both public APIs
// in a real browser and does not form a dependency of this Node test file.
test("source contract: HTML descriptors retain header paragraph descriptions", () => {
  assert.ok(/header\?\.querySelector\(["']:scope > p\.page-description["']\)/.test(source), "parser must read the header description paragraph");
  assert.ok(/description:\s*description\?\.innerHTML\s*\|\|\s*["']["']/.test(source), "descriptor must retain description HTML");
  assert.ok(source.slice(source.indexOf("export function notionHtmlToBlocks(")).includes("descriptor.description"), "block conversion must consume the description");
});

test("HTML parser public APIs import without a fake Node DOM", () => {
  assert.equal(typeof parseNotionHtmlPage, "function");
  assert.equal(typeof notionHtmlToBlocks, "function");
});
