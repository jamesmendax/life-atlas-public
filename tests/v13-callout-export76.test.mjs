import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { pageToStandaloneHtml, createMarkdownCsvArchive } from "../src/domain/pageExport.js";
import { pageSemanticDocument, pageSemanticText } from "../src/domain/documentSemantics.js";
import { buildSearchDocuments, querySearch } from "../src/search/searchIndex.js";

const articleId = "page-articles76";
const articleHref = `lifeatlas://page/${articleId}`;
const text = (value, styles = {}) => ({ type: "text", text: value, styles });
const paragraph = (id, content) => ({ id, type: "paragraph", props: {}, content, children: [] });

function fixture() {
  // Reduced native shape of source-html48 aside#38b95adb-7f79-4de7-a24c-e84d98291c77.
  // The source has three distinct p nodes and no callout icon.
  const callout = {
    id: "callout76", type: "callout", props: { icon: "", tone: "gray", backgroundColor: "gray" },
    content: [text("写长文", { bold: true }), text("　"), {
      type: "link", href: articleHref, content: [text("进入文章库 →")],
    }],
    children: [
      paragraph("description76", [text("技术长文、完整观点与深度复盘。")]),
      paragraph("status76", [text("草稿 → 发布", { textColor: "gray" })]),
    ],
  };
  const page = { id: "wiki76", title: "Wiki CTA 76", folderId: "folder76", content: [callout] };
  const workspace = {
    folders: [{ id: "folder76", name: "Wiki", parentId: null }],
    pages: [page, { id: articleId, title: "文章", folderId: "folder76", content: [] }],
    dataSources: [], databaseItems: [], databaseViews: [], syncedSources: [], people: [], attachments: [],
  };
  return { page, callout, workspace };
}

test("76 standalone HTML retains the real iconless callout CTA target and label", () => {
  const { page, workspace } = fixture();
  const before = structuredClone(workspace);
  const html = pageToStandaloneHtml(page, { workspace });
  assert.ok(html.includes(`<a href="${articleHref}">进入文章库 →</a>`), "callout CTA must retain its target, not just visible label");
  assert.ok(html.includes(`<blockquote><strong>写长文</strong>　<a href="${articleHref}">进入文章库 →</a></blockquote>`));
  assert.ok(html.includes("技术长文、完整观点与深度复盘。"));
  assert.ok(html.includes("草稿 → 发布"));
  assert.ok(!html.includes("💡"), "source iconless callout must remain iconless");
  assert.deepEqual(workspace, before);
});

test("76 page Markdown ZIP retains the real callout CTA target and independent child paragraphs", async () => {
  const { page, workspace } = fixture();
  const before = structuredClone(workspace);
  const { blob } = await createMarkdownCsvArchive(page, { workspace });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const markdown = await zip.file("Wiki CTA 76.md").async("string");
  assert.ok(markdown.includes(`[进入文章库 →](${articleHref})`), "the actual ZIP Markdown must contain the callout CTA target");
  assert.ok(markdown.includes(`> **写长文**　[进入文章库 →](${articleHref})`));
  assert.ok(markdown.indexOf("技术长文、完整观点与深度复盘。") > markdown.indexOf(articleHref));
  assert.ok(markdown.indexOf("草稿 → 发布") > markdown.indexOf("技术长文、完整观点与深度复盘。"));
  assert.ok(!markdown.includes("💡"));
  assert.deepEqual(workspace, before);
});

test("76 callout projection preserves styled link data and child identities without sharing mutable input", () => {
  const { page, callout, workspace } = fixture();
  callout.content[2].content[0].styles = { bold: true, italic: true, textColor: "green" };
  const before = structuredClone(workspace);
  const [quote] = pageSemanticDocument(page, workspace);
  assert.equal(quote.type, "quote");
  assert.equal(quote.id, "callout76");
  assert.deepEqual(quote.content, callout.content);
  assert.deepEqual(quote.children, callout.children);
  assert.deepEqual(workspace, before);
  quote.content[2].content[0].styles.bold = false;
  quote.children[0].content[0].text = "changed projection only";
  assert.deepEqual(workspace, before);
});

test("76 explicit emoji and legacy strings keep their text while empty or missing icons add no lightbulb", () => {
  const { page, workspace } = fixture();
  for (const [props, content, expected] of [
    [{ icon: "✍️" }, "旧式正文", "✍️ 旧式正文"],
    [{ icon: "" }, "旧式正文", "旧式正文"],
    [{}, "旧式正文", "旧式正文"],
    [{ icon: "✍️" }, [], "✍️"],
    [{ icon: "" }, [], ""],
  ]) {
    page.content = [{ id: "legacy76", type: "callout", props, content, children: [] }];
    const before = structuredClone(workspace);
    assert.equal(pageSemanticText(page, workspace), expected);
    const [quote] = pageSemanticDocument(page, workspace);
    assert.equal(quote.type, "quote");
    assert.ok(Array.isArray(quote.content));
    const html = pageToStandaloneHtml(page, { workspace });
    assert.ok(html.includes(`<blockquote>${expected}</blockquote>`));
    assert.ok(!html.includes("💡"));
    assert.deepEqual(workspace, before);
  }
});

test("76 true mention still follows target rename while custom CTA and search text stay intact", () => {
  const { page, callout, workspace } = fixture();
  callout.content.push(text(" / "), { type: "pageMention", props: { pageId: articleId, labelSnapshot: "文章" } });
  workspace.pages.find((entry) => entry.id === articleId).title = "文章 · 最新76";
  const before = structuredClone(workspace);
  const [quote] = pageSemanticDocument(page, workspace);
  assert.equal(quote.content[2].href, articleHref);
  assert.deepEqual(quote.content[2].content, [text("进入文章库 →")]);
  assert.deepEqual(quote.content.at(-1), text("文章 · 最新76"));
  const expected = "写长文　进入文章库 → / 文章 · 最新76\n技术长文、完整观点与深度复盘。\n草稿 → 发布";
  assert.equal(pageSemanticText(page, workspace), expected);
  const documents = buildSearchDocuments(workspace.folders, workspace.pages, workspace);
  assert.equal(documents.find((entry) => entry.entityId === page.id).body, expected);
  assert.ok(querySearch(documents, "进入文章库", "content").some((entry) => entry.entityId === page.id));
  const html = pageToStandaloneHtml(page, { workspace });
  assert.equal((html.match(/<a href=/g) || []).length, 1);
  assert.ok(html.includes(" / 文章 · 最新76</blockquote>"));
  assert.deepEqual(workspace, before);
});
