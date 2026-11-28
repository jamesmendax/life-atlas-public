import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildMarkdownExport } from "../src/export/markdownExport.js";
import { pageToMarkdown } from "../src/domain/pageExport.js";
import { pageSemanticDocument } from "../src/domain/documentSemantics.js";
import { upgradeWorkspace } from "../src/persistence/migrations.js";
import { parseCsv } from "../src/domain/csv.js";
import { validateMarkdownExportPayload } from "../electron/main/exports/markdownFolder.js";
import { fullWorkspace, FIXTURE_TIME } from "./fixtures/full-workspace.mjs";

const fixture = () => upgradeWorkspace(fullWorkspace());
const exportFixture = (workspace = fixture()) => buildMarkdownExport(workspace, { now: FIXTURE_TIME, appVersion: "0.1.0" });

function oldPlain(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => typeof item === "string" ? item : !item || typeof item !== "object" ? "" : typeof item.text === "string" ? item.text : oldPlain(item.content)).join("");
}

function oldInline(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return "";
    if (item.type === "inlineEquation") return `$${item.props?.expression || ""}$`;
    if (item.type === "link") { const text = oldInline(item.content); const href = item.href || item.props?.href || ""; return href ? `[${text || href}](${href})` : text; }
    let text = typeof item.text === "string" ? item.text : oldInline(item.content);
    const styles = item.styles || {};
    if (styles.code) text = `\`${text}\``;
    if (styles.bold) text = `**${text}**`;
    if (styles.italic) text = `*${text}*`;
    if (styles.strike) text = `~~${text}~~`;
    return text;
  }).join("");
}

function oldBlock(block, depth = 0) {
  const text = oldInline(block?.content);
  const type = block?.type || "paragraph";
  const indent = "  ".repeat(depth);
  let line = text;
  if (type === "heading") line = `${"#".repeat(Math.min(4, Math.max(1, Number(block?.props?.level) || 1)))} ${text}`;
  else if (type === "bulletListItem") line = `- ${text}`;
  else if (type === "numberedListItem") line = `1. ${text}`;
  else if (type === "checkListItem") line = `- [${block?.props?.checked ? "x" : " "}] ${text}`;
  else if (type === "quote") line = `> ${text}`;
  else if (type === "codeBlock") line = `\`\`\`${block?.props?.language || ""}\n${oldPlain(block?.content)}\n\`\`\``;
  else if (type === "equation") line = `$$\n${oldPlain(block?.content)}\n$$`;
  else if (type === "divider") line = "---";
  else if (type === "table") {
    const raw = Array.isArray(block?.content?.rows) ? block.content.rows : Array.isArray(block?.content) ? block.content : [];
    const rows = raw.map((row) => (Array.isArray(row?.cells) ? row.cells : Array.isArray(row) ? row : []).map((cell) => oldPlain(Array.isArray(cell) ? cell : cell?.content ?? cell)));
    if (!rows.length) line = "";
    else {
      const width = Math.max(...rows.map((row) => row.length), 1);
      const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ""));
      const header = normalized[0];
      line = [`| ${header.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...normalized.slice(1).map((row) => `| ${row.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`)].join("\n");
    }
  }
  const children = Array.isArray(block?.children) ? block.children : [];
  return [line ? `${indent}${line}` : "", children.map((child) => oldBlock(child, depth + 1)).filter(Boolean).join("\n")].filter(Boolean).join("\n");
}

function oldPage(page, { includeTitle = true, workspace } = {}) {
  const blocks = workspace ? pageSemanticDocument(page, workspace) : Array.isArray(page?.content) ? page.content : [];
  const body = blocks.map((block) => oldBlock(block)).filter(Boolean).join("\n\n").trim();
  if (!includeTitle) return body ? `${body}\n` : "";
  return `# ${page?.title || "无标题页面"}\n\n${body}`.trimEnd() + "\n";
}

test("the export tree follows folders pages and databases", () => {
  const result = exportFixture();
  const paths = new Set(result.files.map((file) => file.path));
  for (const filePath of ["README.md", "A 项目/A 概览.md", "A 项目/A 概览/A 子页面.md", "A 项目/B 资料/B 笔记.md", "A 项目/B 资料/B 笔记/行内任务.csv", "A 项目/B 资料/B 笔记/行内任务/任务一.md", "A 项目/B 资料/C 细节/C 深层.md", "Z 其他/Z 目标页.md", "Z 其他/整页项目库.md", "Z 其他/整页项目库.csv", "Z 其他/整页项目库/项目甲.md"]) assert.ok(paths.has(filePath), filePath);
  assert.equal([...paths].some((filePath) => filePath.includes("B 单独删除的页") || filePath.startsWith("vault") || filePath.startsWith("空文件夹/")), false);
  assert.equal(paths.has("A 项目/B 资料/任务一.md"), false);
});

test("front matter and relative links are correct", () => {
  const result = exportFixture();
  const current = result.files.find((file) => file.path === "A 项目/A 概览.md");
  assert.ok(current.text.startsWith('---\nid: "p-a1"'));
  assert.ok(current.text.includes('[Z 目标页](../Z%20其他/Z%20目标页.md)'));
  assert.ok(current.text.includes('[→ C 深层](B%20资料/C%20细节/C%20深层.md)'));
  const paths = new Set(result.files.map((file) => file.path));
  for (const match of current.text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) assert.ok(paths.has(path.posix.normalize(path.posix.join(path.posix.dirname(current.path), decodeURIComponent(match[1])))), match[1]);
  const record = result.files.find((file) => file.path.endsWith("行内任务/任务一.md"));
  assert.match(record.text, /properties:\n/);
  assert.match(record.text, /"状态": "已完成"/);
  assert.match(record.text, /"完成": "✓"/);
});

test("database csv files carry every property", () => {
  const result = exportFixture();
  const file = result.files.find((entry) => entry.path === "Z 其他/整页项目库.csv");
  assert.equal(file.text.charCodeAt(0), 0xfeff);
  const rows = parseCsv(file.text);
  assert.deepEqual(rows[0], ["名称", "评分", "任务", "任务数"]);
  const first = rows.find((row) => row[0] === "项目甲");
  assert.equal(first[1], "5");
  assert.equal(first[3], "2");
  assert.match(first[2], /任务一, 任务二/);
});

test("attachments are listed under assets", () => {
  const result = exportFixture();
  const workspace = fixture();
  const sha256 = workspace.attachments.find((attachment) => attachment.id === "att-img").checksum;
  const asset = result.assets.find((entry) => entry.sha256 === sha256);
  assert.ok(asset);
  assert.ok(asset.path.startsWith(`_assets/${sha256.slice(0, 12)}-`));
  const page = result.files.find((entry) => entry.path === "A 项目/B 资料/B 笔记.md");
  const match = /!\[图.png\]\(([^)]+)\)/.exec(page.text);
  assert.ok(match, page.text);
  assert.equal(path.posix.normalize(path.posix.join(path.posix.dirname(page.path), decodeURIComponent(match[1]))), asset.path);
});

test("the vault trash versions and comments are not exported", () => {
  const workspace = fixture();
  const markers = ["LA-MARKER-VAULT-EXCLUDED", "LA-MARKER-HISTORY-EXCLUDED", "LA-MARKER-TEMPLATE-EXCLUDED"];
  workspace.vault = { secret: markers[0] };
  workspace.pageVersions = [{ id: "history-private", pageId: "p-a1", content: [{ type: "paragraph", content: markers[1] }] }];
  workspace.pageTemplates.push({ id: "template-private", content: [{ type: "paragraph", content: markers[2] }] });
  const result = exportFixture(workspace);
  const text = result.files.map((file) => file.text).join("\n");
  for (const value of ["早就单独删除了", "第一条评论", ...markers]) assert.equal(text.includes(value), false, value);
  assert.equal(result.files.some((file) => /^(?:vault|trash|pageVersions|comments|templates)(?:\/|\.)/i.test(file.path)), false);
  assert.equal(result.assets.some((asset) => asset.url === "att-orphan"), false);
});

test("exporting without links keeps the old single page output", () => {
  const workspace = fixture();
  const page = workspace.pages.find((entry) => entry.id === "p-a1");
  assert.equal(pageToMarkdown(page, { workspace }), oldPage(page, { workspace }));
  for (const entry of workspace.pages) for (const includeTitle of [true, false]) assert.equal(pageToMarkdown(entry, { workspace, includeTitle }), oldPage(entry, { workspace, includeTitle }), entry.id);
});

test("file collisions YAML strings and long attachment names stay portable", () => {
  const workspace = fixture();
  const before = structuredClone(workspace);
  workspace.pages.push({ ...workspace.pages.find((page) => page.id === "p-a1-child"), id: "collision-1", parentPageId: null, title: "NOTE", sortIndex: 50 }, { ...workspace.pages.find((page) => page.id === "p-a1-child"), id: "collision-2", parentPageId: null, title: "note", sortIndex: 60 });
  workspace.pages.find((page) => page.id === "p-a1").tags = ['标签"双引号', "斜\\线"];
  workspace.attachments.find((attachment) => attachment.id === "att-img").name = `${"图".repeat(100)}.png`;
  const edited = structuredClone(workspace);
  const result = exportFixture(workspace);
  assert.ok(result.files.some((file) => file.path === "A 项目/NOTE.md"));
  assert.ok(result.files.some((file) => file.path === "A 项目/note (2).md"));
  assert.match(result.files.find((file) => file.path === "A 项目/A 概览.md").text, /tags: \["标签\\"双引号", "斜\\\\线"\]/);
  assert.doesNotThrow(() => validateMarkdownExportPayload({ files: result.files, assets: result.assets.map(({ path: filePath, sha256 }) => ({ path: filePath, sha256 })) }));
  assert.deepEqual(workspace, edited);
  assert.notDeepEqual(workspace, before);
});

test("table view sorting does not omit filtered records from exported CSV", () => {
  const workspace = fixture();
  const view = workspace.databaseViews.find((entry) => entry.id === "v-full-table");
  view.sorts = [{ propertyId: "score", direction: "asc" }];
  view.filter = { propertyId: "score", operator: "greater_than", value: 3 };
  const result = exportFixture(workspace);
  const rows = parseCsv(result.files.find((file) => file.path === "Z 其他/整页项目库.csv").text);
  assert.deepEqual(rows.slice(1).map((row) => row[0]), ["项目乙", "项目甲"]);
});

test("linked exports preserve native toggles columns tabs table mentions and synchronized content", () => {
  const workspace = fixture();
  const page = workspace.pages.find((entry) => entry.id === "p-a1-child");
  page.content = [
    { type: "callout", props: { icon: "💡" }, content: "提示内容" },
    { type: "heading", props: { level: 4, isToggleable: true }, content: "折叠标题", children: [{ type: "paragraph", content: "标题子正文" }] },
    { type: "toggleListItem", content: "折叠列表", children: [{ type: "paragraph", content: "列表子正文" }] },
    { type: "columnList", children: [{ type: "column", children: [{ type: "paragraph", content: "第一栏正文" }] }, { type: "column", children: [{ type: "paragraph", content: "第二栏正文" }] }] },
    { type: "tabs", children: [{ type: "tabPanel", props: { label: "标签甲" }, children: [{ type: "paragraph", content: "标签正文" }] }] },
    { type: "table", content: { type: "tableContent", headerRows: 1, rows: [{ cells: [[{ type: "text", text: "标题", styles: {} }]] }, { cells: [[{ type: "pageMention", props: { pageId: "p-z1", labelSnapshot: "旧标题" } }]] }] } },
    { type: "syncedBlock", props: { sourceId: "sync-shared" } },
    { type: "databaseView", props: { sourceId: "ds-inline", viewId: "v-inline-table" } },
    { type: "image", props: { name: "远程图片", url: "https://example.test/photo.png" } },
    { type: "paragraph", content: [{ type: "inlineEquation", props: { expression: "x^2" } }, { type: "link", href: "lifeatlas://page/p-c1#block-b-c1-p", content: [{ type: "text", text: "区块链接", styles: {} }] }] },
    { type: "tableOfContents", content: "不要输出目录" },
    { type: "breadcrumb", content: "不要输出路径" },
  ];
  const before = structuredClone(workspace);
  const result = exportFixture(workspace);
  const current = result.files.find((file) => file.path === "A 项目/A 概览/A 子页面.md");
  assert.ok(current.text.includes("> 💡 提示内容"));
  assert.ok(current.text.includes("<details><summary>折叠标题</summary>\n\n标题子正文\n\n</details>"));
  assert.ok(current.text.includes("<details><summary>折叠列表</summary>\n\n列表子正文\n\n</details>"));
  assert.ok(current.text.includes("<!-- 第 1 栏 -->\n\n第一栏正文"));
  assert.ok(current.text.includes("<!-- 第 2 栏 -->\n\n第二栏正文"));
  assert.ok(current.text.includes("**标签甲**\n\n标签正文"));
  assert.ok(current.text.includes("[Z 目标页](../../Z%20其他/Z%20目标页.md)"));
  assert.ok(current.text.includes("共享内容"));
  assert.ok(current.text.includes("[数据库：行内任务](../B%20资料/B%20笔记/行内任务.csv)"));
  assert.ok(current.text.includes("![远程图片](https://example.test/photo.png)"));
  assert.ok(current.text.includes("$x^2$[区块链接](../B%20资料/C%20细节/C%20深层.md#block-b-c1-p)"));
  assert.equal(current.text.includes("不要输出"), false);
  assert.deepEqual(workspace, before);
});
