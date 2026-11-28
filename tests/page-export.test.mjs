import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";

import { parsePageImport } from "../src/domain/pageActions.js";
import {
  collectTableCsvFiles,
  createHtmlExport,
  createJsonBackup,
  createMarkdownCsvArchive,
  createPdfBlobFromRenderedPages,
  pageToMarkdown,
  pageToStandaloneHtml,
} from "../src/domain/pageExport.js";

const samplePage = {
  id: "export-page",
  folderId: "notes",
  title: "化学复盘",
  icon: "🧪",
  iconColor: "#6fa8dc",
  cover: { kind: "gallery", value: "van-gogh-starry-night", position: 50 },
  settings: { fontFamily: "serif", smallText: true, fullWidth: false, presentationMode: "default", locked: false },
  content: [
    { type: "heading", props: { level: 2 }, content: "氧化还原" },
    { type: "paragraph", content: [{ type: "text", text: "电子", styles: { bold: true } }, { type: "text", text: " 转移", styles: {} }] },
    { type: "bulletListItem", content: "先看化合价" },
    { type: "quote", content: "守恒是核心" },
    { type: "codeBlock", props: { language: "txt" }, content: "Fe2+ -> Fe3+" },
    {
      type: "table",
      content: {
        rows: [
          { cells: [["物质"], ["状态"]] },
          { cells: [["铁"], ["固体"]] },
        ],
      },
    },
  ],
};

test("Markdown export preserves common document structure and table content", () => {
  const markdown = pageToMarkdown(samplePage);
  assert.match(markdown, /^# 化学复盘/m);
  assert.match(markdown, /^## 氧化还原/m);
  assert.match(markdown, /\*\*电子\*\*/);
  assert.match(markdown, /- 先看化合价/);
  assert.match(markdown, /> 守恒是核心/);
  assert.ok(markdown.includes(String.fromCharCode(96).repeat(3) + "txt"));
  assert.match(markdown, /\| 物质 \| 状态 \|/);

  const tables = collectTableCsvFiles(samplePage);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].csv, "物质,状态\r\n铁,固体");
});

test("Markdown & CSV produces a real ZIP with markdown plus CSV tables", async () => {
  const { blob, fileName, tableCount } = await createMarkdownCsvArchive(samplePage);
  assert.equal(tableCount, 1);
  assert.match(fileName, /\.markdown-csv\.zip$/);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK");
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files);
  assert.ok(names.some((name) => name.endsWith(".md")));
  assert.ok(names.includes("table-01.csv"));
  assert.match(await zip.file("table-01.csv").async("string"), /铁,固体/);
});

test("HTML export is a self-contained local document", async () => {
  const html = pageToStandaloneHtml(samplePage);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<title>化学复盘<\/title>/);
  assert.match(html, /<h2>氧化还原<\/h2>/);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /https?:\/\//);

  const result = createHtmlExport(samplePage);
  assert.match(result.fileName, /\.html$/);
  assert.match(await result.blob.text(), /化学复盘/);
});

test("JSON backup remains a full round-trip import format", async () => {
  const { blob, fileName } = createJsonBackup(samplePage);
  assert.match(fileName, /\.life-atlas\.json$/);
  const imported = parsePageImport(await blob.text(), fileName);
  assert.equal(imported.title, samplePage.title);
  assert.deepEqual(imported.cover, samplePage.cover);
  assert.deepEqual(imported.settings, samplePage.settings);
  assert.deepEqual(imported.content, samplePage.content);
});

test("PDF generator produces an actual PDF Blob offline", async () => {
  const blob = await createPdfBlobFromRenderedPages([], samplePage.title);
  assert.equal(blob.type, "application/pdf");
  const prefix = new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 5));
  assert.equal(prefix, "%PDF-");
});
