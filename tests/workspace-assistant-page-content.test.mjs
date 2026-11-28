import test from "node:test";
import assert from "node:assert/strict";
import { collectAssistantMediaUrls, executeWorkspaceTool } from "../src/assistant/workspaceTools.js";
import { restorePageVersion } from "../src/domain/pageHistory.js";

const time = Date.parse("2026-11-24T09:00:00.000Z");
const pageId = "page-notes";

function fixture(content = [{ id: "existing", type: "paragraph", content: "已有正文" }]) {
  const page = { id: pageId, title: "项目记录", folderId: "folder-main", content, settings: {} };
  return { pages: [page], pageVersions: [], folders: [{ id: "folder-main", parentId: null, name: "记录" }] };
}

function run(workspace, name, args, options) {
  return executeWorkspaceTool(name, args, { workspace, currentPageId: pageId, time, ...options });
}

test("assistant Markdown writes a native table with optional boundary pipes and styled links", () => {
  const workspace = fixture();
  const operation = run(workspace, "update_page", {
    page_id: "current",
    mode: "replace",
    markdown: "## 进展\n\n项目 | 状态\n:--- | ---:\n原型 | **完成**\n验证 | [查看资料](https://example.test/report)\n\n[原始出处](https://example.test/source)",
  });
  assert.equal(operation.result.ok, true);
  const [heading, table, source] = operation.workspace.pages[0].content;
  assert.equal(heading.type, "heading");
  assert.equal(table.type, "table");
  assert.equal(table.content.type, "tableContent");
  assert.equal(table.content.headerRows, 1);
  assert.equal(table.content.rows.length, 3);
  assert.equal(table.content.rows[1].cells[1][0].styles.bold, true);
  assert.equal(table.content.rows[2].cells[1][0].href, "https://example.test/report");
  assert.equal(source.content[0].href, "https://example.test/source");
  assert.deepEqual(operation.workspace.pageVersions[0].content, workspace.pages[0].content);
  const restored = restorePageVersion(operation.workspace, {
    pageId, versionId: operation.workspace.pageVersions[0].id, now: time + 1000, preRestoreId: "before-restore",
  });
  assert.deepEqual(restored.pages[0].content, workspace.pages[0].content);
});

test("structured page authoring uses normal sections, editable columns, callouts and tables", () => {
  const workspace = fixture();
  const operation = run(workspace, "create_page", {
    title: "排版草稿",
    blocks: [
      { type: "section", heading: "汇报摘要", markdown: "***重点*** 和 <u>下划线</u>" },
      { type: "columns", columns: [
        [{ type: "callout", tone: "yellow", icon: "⚠️", markdown: "请检查 **版本**。\n\n- 对照文档" }],
        [{ type: "table", header: false, rows: [["剩余", "3"], ["当前", "[进度](https://example.test/progress)"]] }],
      ] },
    ],
  });
  assert.equal(operation.result.ok, true);
  const [section, paragraph, columns] = operation.workspace.pages.find((page) => page.id === operation.result.page_id).content;
  assert.deepEqual([section.type, section.props.level], ["heading", 2]);
  assert.deepEqual(paragraph.content[0].styles, { bold: true, italic: true });
  assert.equal(paragraph.content[2].styles.underline, true);
  assert.deepEqual([columns.type, columns.props.columns], ["columnList", 2]);
  assert.deepEqual(columns.children.map(({ type, props }) => [type, props.index, props.count, props.width]), [
    ["column", 0, 2, 50], ["column", 1, 2, 50],
  ]);
  const callout = columns.children[0].children[0];
  assert.deepEqual([callout.type, callout.props.icon, callout.props.tone], ["callout", "⚠️", "yellow"]);
  assert.equal(callout.children[0].type, "bulletListItem");
  const table = columns.children[1].children[0];
  assert.equal(table.content.headerRows, 0);
  assert.equal(table.content.rows[1].cells[1][0].type, "link");
});

test("assistant can revise a native table without changing its neighboring blocks, then replace the body", () => {
  const original = fixture();
  const appended = run(original, "update_page", {
    page_id: "current",
    blocks: [{ type: "columns", columns: [
      [{ type: "table", rows: [["条目", "状态"], ["修复", "待验证"]] }],
      [{ type: "markdown", markdown: "交付前需确认" }],
    ] }],
  });
  assert.equal(appended.result.ok, true);
  const [paragraph, columns] = appended.workspace.pages[0].content;
  const column = columns.children[0];
  const [table] = column.children;
  const read = run(appended.workspace, "read_page", { page_id: pageId }).result;
  const readTable = read.blocks.find((block) => block.block_id === table.id);
  assert.equal(readTable.parent_block_id, column.id);
  assert.deepEqual(readTable.table, { header_rows: 1, row_count: 2, column_count: 2, rows: [["条目", "状态"], ["修复", "待验证"]], truncated: false });
  assert.deepEqual(read.blocks.find((block) => block.block_id === column.id).column, { index: 0, count: 2, width: 50 });
  const edited = run(appended.workspace, "edit_block", {
    page_id: pageId, block_id: table.id, operation: "replace_blocks",
    blocks: [{ type: "table", rows: [["条目", "状态"], ["修复", "**已验证**"]] }],
  });
  assert.equal(edited.result.ok, true);
  assert.equal(edited.workspace.pages[0].content[0], paragraph);
  assert.deepEqual(edited.workspace.pages[0].content[1].children[1], columns.children[1]);
  const changed = edited.workspace.pages[0].content[1].children[0].children[0];
  assert.equal(changed.id, table.id);
  assert.equal(changed.content.rows[1].cells[1][0].text, "已验证");
  const replaced = run(edited.workspace, "update_page", {
    page_id: pageId, mode: "replace", markdown: "> [!TIP]\n> **结论**：完成",
  });
  assert.equal(replaced.result.ok, true);
  assert.deepEqual(replaced.workspace.pages[0].content.map((block) => block.type), ["callout"]);
  assert.deepEqual(replaced.workspace.pageVersions.at(-1).content, edited.workspace.pages[0].content);
});

test("assistant discovers block-level image references and uses only approved local media", () => {
  const workspace = fixture();
  const imageUrl = "https://example.test/landscape.png";
  const attachmentUrl = (digit) => "life-asset://" + digit.repeat(64);
  const managedImage = attachmentUrl("a");
  const managedVideo = attachmentUrl("b");
  const managedFile = attachmentUrl("c");
  const args = { page_id: pageId, blocks: [
    { type: "image", url: imageUrl, caption: "测试图片" },
    { type: "video", url: managedVideo },
    { type: "file", url: managedFile },
    { type: "markdown", markdown: "![另一处展示](" + imageUrl + ")\n\n```\n![代码内示例](https://example.test/no.png)\n```" },
  ] };
  assert.deepEqual(collectAssistantMediaUrls("update_page", args), [imageUrl]);
  assert.deepEqual(collectAssistantMediaUrls("update_page_display", { page_id: pageId, cover_url: imageUrl }), [imageUrl]);
  assert.deepEqual(collectAssistantMediaUrls("update_page", { ...args, markdown: "重复的正文参数" }), []);
  const unavailable = run(workspace, "update_page", args);
  assert.equal(unavailable.result.ok, false);
  assert.equal(unavailable.workspace, workspace);
  const options = {
    mediaByUrl: new Map([[imageUrl, { url: managedImage, name: "山景.png", mime: "image/png" }]]),
    attachments: [
      { assetUrl: managedVideo, kind: "file", mimeType: "video/mp4", name: "回放.mp4" },
      { assetUrl: managedFile, kind: "file", mimeType: "application/pdf", name: "说明.pdf" },
    ],
  };
  const operation = run(workspace, "update_page", args, options);
  assert.equal(operation.result.ok, true);
  const written = operation.workspace.pages[0].content.slice(1);
  assert.deepEqual(written.map((block) => block.type), ["image", "video", "file", "image", "codeBlock"]);
  assert.deepEqual(written.slice(0, 4).map((block) => block.props.url), [managedImage, managedVideo, managedFile, managedImage]);
  assert.equal(written[0].props.caption, "测试图片");
  assert.equal(written[1].props.name, "回放.mp4");
  const cover = run(operation.workspace, "update_page_display", { page_id: pageId, cover_url: managedImage, cover_position: 40 }, options);
  assert.deepEqual(cover.workspace.pages[0].cover, { kind: "upload", value: managedImage, position: 40 });
  const fakeMedia = run(workspace, "update_page", { page_id: pageId, blocks: [{ type: "image", url: attachmentUrl("d") }] }, options);
  assert.equal(fakeMedia.result.ok, false);
  assert.equal(fakeMedia.workspace, workspace);
});

test("native page edits preserve locked pages and database, child-page or synced references", () => {
  const structured = fixture([{
    id: "callout-with-reference", type: "callout", content: "已有区块",
    children: [
      { id: "nested-db", type: "databaseView", props: { sourceId: "db", viewId: "view" } },
      { id: "nested-page", type: "pageLink", props: { pageId: "page-child" } },
      { id: "nested-sync", type: "syncedBlock", props: { sourceId: "sync" } },
    ],
  }]);
  const blocks = [{ type: "table", rows: [["标题"], ["新内容"]] }];
  const replacePage = run(structured, "update_page", { page_id: pageId, mode: "replace", blocks });
  const replaceBlock = run(structured, "edit_block", { page_id: pageId, block_id: "callout-with-reference", operation: "replace_blocks", blocks });
  for (const denied of [replacePage, replaceBlock]) {
    assert.equal(denied.result.ok, false);
    assert.equal(denied.workspace, structured);
  }
  const appended = run(structured, "update_page", { page_id: pageId, blocks });
  assert.equal(appended.result.ok, true);
  assert.equal(appended.workspace.pages[0].content[0], structured.pages[0].content[0]);
  const locked = fixture();
  locked.pages[0].settings.locked = true;
  const denied = run(locked, "update_page", { page_id: pageId, blocks });
  assert.equal(denied.result.ok, false);
  assert.match(denied.result.error, /锁定/);
  assert.equal(denied.workspace, locked);
});

test("page media can be reused within that page without exposing its storage URL or local path", () => {
  const url = "life-asset://" + "e".repeat(64);
  const workspace = fixture([{ id: "hero-image", type: "image", props: { url, name: "C:\\private\\hero.png", caption: "原配图" } }]);
  workspace.pages.push({ id: "other-page", title: "其他页面", content: [], settings: {} });
  const read = run(workspace, "read_page", { page_id: pageId }).result;
  const media = read.blocks[0].media;
  assert.deepEqual(media, { name: "hero.png", caption: "原配图", reuse_url: "block:hero-image" });
  assert.doesNotMatch(JSON.stringify(read), /life-asset|private/);
  const blocks = [{ type: "columns", columns: [
    [{ type: "markdown", markdown: "这里保留原配图" }],
    [{ type: "image", url: media.reuse_url, name: media.name, caption: media.caption }],
  ] }];
  assert.deepEqual(collectAssistantMediaUrls("update_page", { page_id: pageId, blocks }), []);
  const applied = run(workspace, "update_page", { page_id: pageId, mode: "replace", blocks });
  assert.equal(applied.workspace.pages[0].content[0].children[1].children[0].props.url, url);
  const otherPage = run(workspace, "update_page", { page_id: "other-page", blocks });
  assert.equal(otherPage.result.ok, false);
  assert.equal(otherPage.workspace, workspace);
});

test("native read excerpts stay within the page budget and mark incomplete table previews", () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({ cells: [String(index), [{ type: "text", text: '"\n'.repeat(300), styles: {} }]] }));
  const workspace = fixture([
    { id: "long-table", type: "table", content: { type: "tableContent", headerRows: 1, rows } },
    ...Array.from({ length: 8 }, (_, index) => ({ id: "long-" + index, type: "paragraph", content: "很长的正文".repeat(800) })),
  ]);
  const output = run(workspace, "read_page", { page_id: pageId }).result;
  assert.equal(output.blocks[0].table.row_count, 40);
  assert.equal(output.blocks[0].table.column_count, 2);
  assert.equal(output.blocks[0].table.truncated, true);
  assert.equal(output.blocks[0].truncated, true);
  assert.ok(JSON.stringify(output.blocks).length <= 8000);
  assert.equal(output.next_offset, output.blocks.length);
  const next = run(workspace, "read_page", { page_id: pageId, offset: output.next_offset }).result;
  assert.equal(next.blocks[0].block_id, workspace.pages[0].content[output.next_offset].id);
});
