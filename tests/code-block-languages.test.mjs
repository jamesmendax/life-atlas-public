import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCodeBlockLanguage, lifeAtlasCodeBlockSpec } from "../src/editor/codeBlockSpec.js";

test("code block aliases resolve to configured language identifiers", () => {
  for (const [alias, expected] of [["js", "javascript"], ["TS", "typescript"], ["py", "python"], ["json", "json"], ["bash", "shellscript"], ["sh", "shellscript"], ["sql", "sql"], ["rs", "rust"], ["java", "java"]]) {
    assert.equal(normalizeCodeBlockLanguage(alias), expected);
  }
});

test("unknown code languages render as text without changing stored metadata", () => {
  const block = { id: "code-unknown", type: "codeBlock", props: { language: "private-language" }, content: [{ type: "text", text: "keep exactly", styles: {} }] };
  const before = structuredClone(block);
  assert.equal(lifeAtlasCodeBlockSpec.implementation.meta.highlight(block), "text");
  assert.equal(normalizeCodeBlockLanguage(null), "text");
  assert.deepEqual(block, before);
});

test("code language compatibility preserves the core parsing and export contract", () => {
  assert.equal(lifeAtlasCodeBlockSpec.config.type, "codeBlock");
  assert.equal(lifeAtlasCodeBlockSpec.config.content, "plain");
  assert.equal(lifeAtlasCodeBlockSpec.config.propSchema.language.default, "text");
  assert.equal(typeof lifeAtlasCodeBlockSpec.implementation.parse, "function");
  assert.equal(typeof lifeAtlasCodeBlockSpec.implementation.parseContent, "function");
  assert.equal(typeof lifeAtlasCodeBlockSpec.implementation.toExternalHTML, "function");
  assert.ok(lifeAtlasCodeBlockSpec.extensions.length > 0);
});
