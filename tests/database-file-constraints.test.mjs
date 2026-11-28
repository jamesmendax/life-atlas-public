import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_FILE_PROPERTY_LIMIT_MB, filePropertyIssue } from "../src/domain/databaseProperties.js";

const mib = 1024 * 1024;

test("database file size uses the field limit inclusively before upload and when reusing a local asset", () => {
  assert.equal(filePropertyIssue({ name: "one.txt", size: mib }, { maxSizeMb: 1 }), null);
  assert.match(filePropertyIssue({ name: "one.txt", size: mib + 1 }, { maxSizeMb: 1 }), /one\.txt.+1 MB/u);
  assert.match(filePropertyIssue({ name: "one.txt", size: mib + 1, provider: "asset" }, { maxSizeMb: 1 }), /1 MB/u);
  assert.match(filePropertyIssue({ name: "old-field.txt", size: DEFAULT_FILE_PROPERTY_LIMIT_MB * mib + 1 }), /25 MB/u);
});

test("database file types accept extensions, exact MIME and MIME families for selected or stored files", () => {
  const config = { accept: " .PDF, image/*,text/plain " };
  assert.equal(filePropertyIssue({ name: "notes.PDF", type: "" }, config), null);
  assert.equal(filePropertyIssue({ name: "scan", type: "IMAGE/PNG" }, config), null);
  assert.equal(filePropertyIssue({ name: "draft", mime: "text/plain; charset=utf-8" }, config), null);
  assert.match(filePropertyIssue({ name: "notes.pdf.bin", type: "application/octet-stream" }, config), /允许的文件类型/u);
  assert.equal(filePropertyIssue({ name: "other", type: "" }, {accept:"*/*"}), null);
});

test("external link attachments remain available without reading or downloading their remote content", () => {
  assert.equal(filePropertyIssue({ name: "文档链接", provider: "external", size: null }, {accept:"image/*", maxSizeMb:1}), null);
});
