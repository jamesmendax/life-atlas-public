import test from "node:test";
import assert from "node:assert/strict";
import { markdownToBlocks, captureTitle } from "../src/domain/markdownBlocks.js";

const parse = (text) => { let index = 0; return markdownToBlocks(text, { idFactory: () => `block-${++index}` }); };
test("markdown headings becomes heading", () => { const result = parse("# One\n## Two\n### Three"); assert.deepEqual(result.map((block) => block.props.level), [1, 2, 3]); assert.ok(result.every((block) => block.type === "heading" && block.id)); });
test("markdown bullets becomes bulletListItem", () => assert.deepEqual(parse("- One\n* Two").map((block) => block.type), ["bulletListItem", "bulletListItem"]));
test("markdown numbers becomes numberedListItem", () => assert.equal(parse("23. One")[0].type, "numberedListItem"));
test("markdown todos becomes checkListItem", () => { const result = parse("- [ ] One\n- [x] Two"); assert.deepEqual(result.map((block) => [block.type, block.props.checked]), [["checkListItem", false], ["checkListItem", true]]); });
test("markdown quotes becomes quote", () => assert.equal(parse("> Quoted")[0].type, "quote"));
test("markdown fences becomes codeBlock", () => { const result = parse("```javascript\nlet value = 3;\n```\n```\n**literal**\n```"); assert.equal(result[0].type, "codeBlock"); assert.equal(result[0].props.language, "javascript"); assert.equal(result[1].props.language, "text"); assert.deepEqual(result[1].content, [{ type: "text", text: "**literal**", styles: {} }]); });
test("markdown plain text becomes paragraph", () => { assert.equal(parse("Hello\nWorld")[0].content[0].text, "Hello\nWorld"); assert.equal(parse("#### Literal")[0].type, "paragraph"); });
test("inline bold italic and code become styled text", () => assert.deepEqual(parse("**bold** *italic* `code`")[0].content.filter((entry) => Object.keys(entry.styles).length).map((entry) => entry.styles), [{ bold: true }, { italic: true }, { code: true }]));
test("blank lines do not create empty blocks", () => { assert.deepEqual(parse("\n\n"), []); assert.equal(parse("One\n\nTwo").length, 2); });
test("capture titles preserve thirty Unicode code points", () => { assert.equal(captureTitle("", `# **${"🌿".repeat(31)}**\nrest`), "🌿".repeat(30)); assert.equal(captureTitle("", ""), "无标题记录"); assert.equal(captureTitle("  Explicit  ", "other"), "Explicit"); });

const richParse = (text, options = {}) => { let sequence = 0; return markdownToBlocks(text, { extended: true, idFactory: () => `rich-block-${++sequence}`, ...options }); };

test("nested list items become children", () => {
  const result = richParse("- 顶层\n  - 两空格\n    - 四空格下层\n- 第二项\n\t- Tab 子项\n\t- [x] 完成子项\n1. 编号\n    2. 子编号");
  assert.equal(result.length, 3);
  assert.equal(result[0].children.length, 1);
  assert.equal(result[0].children[0].children.length, 1);
  assert.equal(result[1].children.length, 2);
  assert.equal(result[1].children[1].type, "checkListItem");
  assert.equal(result[1].children[1].props.checked, true);
  assert.equal(result[2].children[0].type, "numberedListItem");
});

test("tables become table blocks with a header row", () => {
  const result = richParse("| 名称 | 数量 |\n| --- | --- |\n| **苹果** | 3 |\n| 梨\\|子 | 4 |");
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "table");
  assert.equal(result[0].content.type, "tableContent");
  assert.equal(result[0].content.headerRows, 1);
  assert.equal(result[0].content.rows.length, 3);
  assert.deepEqual(result[0].content.rows[1].cells[0], [{ type: "text", text: "苹果", styles: { bold: true } }]);
  assert.equal(result[0].content.rows[2].cells[0][0].text, "梨|子");
});

test("asides become callouts with their emoji icon", () => {
  const result = richParse("<aside>\n💡 提示：这是一个标注\n</aside>\n\n<aside>\n👩‍💻 **开发**\n</aside>");
  assert.deepEqual(result.map((block) => [block.type, block.props.icon]), [["callout", "💡"], ["callout", "👩‍💻"]]);
  assert.equal(result[0].content[0].text, "提示：这是一个标注");
  assert.equal(result[1].content[0].styles.bold, true);
});

test("equations details dividers and level four headings are parsed", () => {
  const result = richParse("#### 四级标题\n\n---\n***\n\n$$\nE = mc^2\n$$\n\n<details><summary>折叠内容</summary>\n\n- 子列表\n\n</details>");
  assert.deepEqual(result.map((block) => block.type), ["heading", "divider", "divider", "equation", "toggleListItem"]);
  assert.equal(result[0].props.level, 4);
  assert.equal(result[3].content[0].text, "E = mc^2");
  assert.equal(result[4].children[0].type, "bulletListItem");
  assert.equal(markdownToBlocks("#### Literal", () => "legacy-block")[0].type, "paragraph");
});

test("images and page links use the resolvers and fall back to text", () => {
  const source = "![图片](photo.png)\n\n[页面](page.md)\n\n[数据库](tasks.csv)\n\n[说明](manual.pdf)\n\n![丢失](missing.png)\n\n[无页面](missing.md)";
  const result = richParse(source, { resolvePage: (href) => ({ "page.md": "page-one", "tasks.csv": "page-tasks" })[href] || null, resolveAsset: (href) => ({ "photo.png": { url: "life-asset://image", kind: "image" }, "manual.pdf": { url: "life-asset://file", kind: "file" } })[href] || null });
  assert.deepEqual(result.map((block) => block.type), ["image", "pageLink", "pageLink", "file", "paragraph", "paragraph"]);
  assert.equal(result[0].props.url, "life-asset://image");
  assert.equal(result[0].props.name, "图片");
  assert.equal(result[1].props.pageId, "page-one");
  assert.equal(result[2].props.pageId, "page-tasks");
  assert.equal(result[3].props.name, "说明");
  assert.equal(result[4].content[0].text, "[图片：丢失]");
  assert.equal(result[5].content[0].text, "无页面");
  assert.equal(richParse("![图片](photo.png)")[0].content[0].text, "[图片：图片]");
});

test("inline strike equations and links are styled", () => {
  const result = richParse("~~删除~~ $x^2$ [提及](page.md) [官网](https://example.test) [邮箱](mailto:example@example.test) [危险](javascript:alert)", { resolvePage: (href) => href === "page.md" ? "page-one" : null });
  const content = result[0].content;
  assert.equal(content.find((entry) => entry.text === "删除").styles.strike, true);
  assert.deepEqual(content.find((entry) => entry.type === "inlineEquation"), { type: "inlineEquation", props: { expression: "x^2" } });
  assert.equal(content.find((entry) => entry.type === "pageMention").props.pageId, "page-one");
  assert.deepEqual(content.filter((entry) => entry.type === "link").map((entry) => entry.href), ["https://example.test", "mailto:example@example.test"]);
  assert.equal(richParse("[官网](https://example.test)")[0].content[0].type, "text");
  assert.equal(richParse("[官网](https://example.test)")[0].content[0].text, "官网");
});
