import test from "node:test";
import assert from "node:assert/strict";
import { pageToMarkdown, pageToStandaloneHtml } from "../src/domain/pageExport.js";

test("headings one to four export with matching hashes", () => {
  const page = { title: "标题", content: [1, 2, 3, 4].map((level) => ({ type: "heading", props: { level }, content: `层级${level}` })) };
  const lines = pageToMarkdown(page, { includeTitle: false }).trim().split(/\n\n/);
  assert.deepEqual(lines, ["# 层级1", "## 层级2", "### 层级3", "#### 层级4"]);
  assert.match(pageToStandaloneHtml(page), /<h4>层级4<\/h4>/);
});

test("toggle headings export as markdown headings", () => {
  const page = { content: [{ type: "heading", props: { level: 2, isToggleable: true }, content: "折叠标题" }] };
  assert.equal(pageToMarkdown(page, { includeTitle: false }), "## 折叠标题\n");
});

test("code blocks keep their language", () => {
  const page = { content: [{ type: "codeBlock", props: { language: "python" }, content: [{ type: "text", text: "print(1)", styles: {} }] }] };
  assert.equal(pageToMarkdown(page, { includeTitle: false }), "```python\nprint(1)\n```\n");
});
