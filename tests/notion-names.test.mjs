import test from "node:test";
import assert from "node:assert/strict";
import { parseNotionName, parseNotionDate, splitNotionMulti, looksMultiSelect } from "../src/import/notionNames.js";
import { safeFileName, dedupeName } from "../src/export/markdownExport.js";

test("notion file names split title id and extension", () => {
  assert.deepEqual(parseNotionName("项目总览 0123456789abcdef0123456789abcdef.md"), { title: "项目总览", notionId: "0123456789abcdef0123456789abcdef", all: false, extension: ".md" });
  assert.deepEqual(parseNotionName("任务库 2222222222222222222222222222222b_all.csv"), { title: "任务库", notionId: "2222222222222222222222222222222b", all: true, extension: ".csv" });
  assert.deepEqual(parseNotionName("没有编号的页面.md"), { title: "没有编号的页面", notionId: null, all: false, extension: ".md" });
  assert.deepEqual(parseNotionName("项目总览 0123456789abcdef0123456789abcdef"), { title: "项目总览", notionId: "0123456789abcdef0123456789abcdef", all: false, extension: "" });
});

test("notion dates parse the known formats", () => {
  const result = (start, end = null, includeTime = false) => ({ start, end, includeTime, timeZone: null });
  assert.deepEqual(parseNotionDate("September 19, 2026"), result("2026-09-19"));
  assert.deepEqual(parseNotionDate("Sep 19, 2026"), result("2026-09-19"));
  assert.deepEqual(parseNotionDate("2026/09/19"), result("2026-09-19"));
  assert.deepEqual(parseNotionDate("2026-09-19"), result("2026-09-19"));
  assert.deepEqual(parseNotionDate("Sep 19, 2026 10:00 AM"), result("2026-09-19T10:00", null, true));
  assert.deepEqual(parseNotionDate("September 19, 2026 12:30 PM → September 21, 2026 9:05 PM"), result("2026-09-19T12:30", "2026-09-21T21:05", true));
  assert.deepEqual(parseNotionDate("September 19, 2026 12:00 AM"), result("2026-09-19T00:00", null, true));
  assert.deepEqual(parseNotionDate("2026年9月19日 → 2026年9月21日"), result("2026-09-19", "2026-09-21"));
  assert.deepEqual(parseNotionDate("2026-09-19 22:30"), result("2026-09-19T22:30", null, true));
  for (const value of ["February 30, 2026", "Someday 1, 2026", "", "2026-13-01", "2026-09-19 24:00", "2026-09-19 13:00 AM"]) assert.equal(parseNotionDate(value), null, value);
});

test("multi select values split and dedupe", () => {
  assert.deepEqual(splitNotionMulti("前端, 后端,前端"), ["前端", "后端"]);
  assert.deepEqual(splitNotionMulti(" , 前端,  , 后端 "), ["前端", "后端"]);
  assert.equal(looksMultiSelect(["前端", "前端, 后端", ""]), true);
  assert.equal(looksMultiSelect(["前端", "后端"]), false);
  assert.equal(looksMultiSelect([Array.from({ length: 31 }, (_, index) => `值${index}`).join(", ")]), false);
});

test("file names are made safe and unique", () => {
  assert.equal(safeFileName('a/b:c*?"<>|'), "a_b_c______");
  assert.equal(safeFileName("con"), "con_");
  assert.equal(safeFileName("结尾有点. "), "结尾有点");
  assert.equal(safeFileName("   "), "无标题");
  assert.equal(safeFileName("CON.txt"), "CON_.txt");
  assert.equal(Array.from(safeFileName("🌿".repeat(81))).length, 80);
  const used = new Set();
  assert.equal(dedupeName("笔记", ".md", used), "笔记.md");
  assert.equal(dedupeName("笔记", ".md", used), "笔记 (2).md");
  assert.equal(dedupeName("笔记", ".md", used), "笔记 (3).md");
  assert.equal(dedupeName("笔记", ".csv", used), "笔记.csv");
  assert.equal(dedupeName("Note", ".md", used), "Note.md");
  assert.equal(dedupeName("note", ".md", used), "note (2).md");
});
