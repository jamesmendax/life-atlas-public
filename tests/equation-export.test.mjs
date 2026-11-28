import test from "node:test";
import assert from "node:assert/strict";
import { pageToMarkdown, pageToStandaloneHtml } from "../src/domain/pageExport.js";

test("equation blocks export to markdown and mathml", () => {
  const page = { title: "公式", content: [{ id: "eq", type: "equation", props: {}, content: [{ type: "text", text: "x^2", styles: {} }], children: [] }] };
  assert.ok(pageToMarkdown(page).includes("$$\nx^2\n$$"));
  assert.match(pageToStandaloneHtml(page), /<math/);
});

test("inline equations export to markdown and mathml", () => {
  const page = { title: "行内公式", content: [{ type: "paragraph", content: [{ type: "inlineEquation", props: { expression: "a+b" } }] }] };
  assert.ok(pageToMarkdown(page).includes("$a+b$"));
  assert.match(pageToStandaloneHtml(page), /<math/);
});

test("invalid latex does not throw during export", () => {
  const page = { title: "错误公式", content: [{ type: "equation", content: [{ type: "text", text: "\\frac{", styles: {} }] }, { type: "paragraph", content: [{ type: "inlineEquation", props: { expression: "\\frac{" } }] }] };
  assert.doesNotThrow(() => pageToMarkdown(page));
  assert.doesNotThrow(() => pageToStandaloneHtml(page));
  assert.match(pageToStandaloneHtml(page), /katex-error/);
});
