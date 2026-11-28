import test from "node:test";
import assert from "node:assert/strict";
import { assertCsvLimits, buildCsvDatabase, decodeCsvBytes, importCsvIntoSource, inferColumnType, parseCsv } from "../src/domain/csv.js";
import { createProperty } from "../src/domain/database.js";
import { checkWorkspaceIntegrity } from "../src/domain/integrity.js";
import { upgradeWorkspace } from "../src/persistence/migrations.js";
import { normalizeLoadedWorkspace } from "../src/persistence/normalize.js";
import { FIXTURE_TIME, fullWorkspace } from "./fixtures/full-workspace.mjs";

const idGenerator = () => { let sequence = 0; return (prefix) => `${prefix}-csv-${++sequence}`; };

test("csv parsing handles quotes newlines and bom", () => {
  assert.deepEqual(parseCsv('名称,备注\r\n"A, inc","说 ""你好""\n第二行"\n"",空\n'), [["名称", "备注"], ["A, inc", '说 "你好"\n第二行'], ["", "空"]]);
  assert.deepEqual(parseCsv("\uFEFFa,b\nc,d"), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(parseCsv("a,b,\n1,,3\n"), [["a", "b", ""], ["1", "", "3"]]);
  assert.throws(() => parseCsv('a,"unclosed'), /CSV 里有没有闭合的引号/);
});

test("gbk bytes are detected and decoded", () => {
  assert.deepEqual(decodeCsvBytes(new Uint8Array([0xC3,0xFB,0xB3,0xC6,0x2C,0xBD,0xF0,0xB6,0xEE,0x0D,0x0A,0xC6,0xBB,0xB9,0xFB,0x2C,0x33,0x0D,0x0A])), { text: "名称,金额\r\n苹果,3\r\n", encoding: "gbk" });
});

test("column types are inferred", () => {
  const answers = [
    [["1", "2.5", "", "-3", "1,200"], "number"], [["2026-09-01", "2026/9/2", "2026年9月3日"], "date"], [["2026-02-30"], "text"],
    [["是", "否", "是"], "checkbox"], [["进行中", "完成", "进行中", "完成"], "select"], [["甲", "乙", "丙"], "text"], [["", " "], "text"],
  ];
  for (const [values, type] of answers) assert.equal(inferColumnType(values), type);
});

test("a new database is built from csv", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  const original = structuredClone(workspace);
  const result = buildCsvDatabase(workspace, { fileName: "水果.csv", header: ["名称", "金额", "状态"], rows: [["苹果", "3", "有货"], ["香蕉", "5", "缺货"], ["橙子", "2", "有货"]], columnTypes: ["title", "number", "select"], folderId: "f-z", now: FIXTURE_TIME, idFactory: idGenerator() });
  const source = result.workspace.dataSources.find((entry) => entry.ownerPageId === result.pageId);
  assert.equal(source.title, "水果");
  assert.deepEqual(source.properties.map((property) => property.type), ["title", "number", "select"]);
  assert.equal(result.workspace.databaseItems.filter((item) => item.sourceId === source.id).length, 3);
  assert.equal(result.workspace.pages.filter((page) => page.databaseSourceId === source.id && page.id !== result.pageId).length, 3);
  assert.deepEqual(source.properties[2].options.map((option) => option.name), ["有货", "缺货"]);
  assert.equal(result.importedCount, 3);
  assert.equal(result.unrecognizedCount, 0);
  assert.deepEqual(checkWorkspaceIntegrity(result.workspace).problems.filter((problem) => problem.severity === "error"), []);
  const normalized = normalizeLoadedWorkspace(result.workspace, { fallbackWorkspace: workspace, now: FIXTURE_TIME, idFactory: idGenerator() });
  assert.deepEqual(normalized.pages, result.workspace.pages);
  assert.deepEqual(workspace, original);
});

test("csv rows import into an existing database", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  const result = importCsvIntoSource(workspace, { sourceId: "ds-full", header: ["名称", "评分", "备注"], rows: [["苹果", "12", "忽略"], ["香蕉", "abc", "忽略"]], mapping: { 0: "title", 1: "score", 2: null }, now: FIXTURE_TIME, idFactory: idGenerator() });
  const created = result.workspace.databaseItems.slice(workspace.databaseItems.length);
  assert.equal(created.length, 2);
  assert.equal(created[0].values.score, 12);
  assert.equal(created[1].values.score, null);
  assert.equal(result.importedCount, 2);
  assert.equal(result.unrecognizedCount, 1);
  assert.deepEqual(checkWorkspaceIntegrity(result.workspace).problems.filter((problem) => problem.severity === "error"), []);
});

test("csv unique ids preserve newly created options across rows", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  const source = workspace.dataSources.find((entry) => entry.id === "ds-full");
  source.properties.push(
    createProperty({ id: "csv-uid", name: "编号", type: "unique_id", config: { prefix: "CSV", nextNumber: 9 } }),
    createProperty({ id: "csv-select", name: "分类", type: "select" }),
    createProperty({ id: "csv-tags", name: "标签", type: "multi_select" }),
  );
  const original = structuredClone(workspace);
  const result = importCsvIntoSource(workspace, { sourceId: "ds-full", header: ["名称", "分类", "标签"], rows: [["甲", "新分类", "一、二"], ["乙", "另一类", "二、三"], ["丙", "新分类", "三、四"]], mapping: { 0: "title", 1: "csv-select", 2: "csv-tags" }, now: FIXTURE_TIME, idFactory: idGenerator() });
  const nextSource = result.workspace.dataSources.find((entry) => entry.id === source.id);
  const created = result.workspace.databaseItems.slice(workspace.databaseItems.length);
  const category = nextSource.properties.find((property) => property.id === "csv-select");
  const tags = nextSource.properties.find((property) => property.id === "csv-tags");
  assert.deepEqual(created.map((item) => item.values["csv-uid"]), [9, 10, 11]);
  assert.equal(nextSource.properties.find((property) => property.id === "csv-uid").config.nextNumber, 12);
  assert.deepEqual(category.options.map((option) => option.name), ["新分类", "另一类"]);
  assert.deepEqual(tags.options.map((option) => option.name), ["一", "二", "三", "四"]);
  assert.deepEqual(created.map((item) => category.options.find((option) => option.id === item.values["csv-select"]).name), ["新分类", "另一类", "新分类"]);
  assert.deepEqual(created.map((item) => item.values["csv-tags"].map((id) => tags.options.find((option) => option.id === id).name)), [["一", "二"], ["二", "三"], ["三", "四"]]);
  assert.deepEqual(workspace, original);
});

test("limits are enforced", () => {
  for (const input of [{ byteLength: 100, rowCount: 1, columnCount: 201 }, { byteLength: 100, rowCount: 50001, columnCount: 2 }, { byteLength: 10 * 1024 * 1024 + 1, rowCount: 1, columnCount: 2 }]) assert.throws(() => assertCsvLimits(input), /^Error: 文件太大/);
  assert.doesNotThrow(() => assertCsvLimits({ byteLength: 10 * 1024 * 1024, rowCount: 50000, columnCount: 200 }));
  assert.throws(() => importCsvIntoSource(upgradeWorkspace(fullWorkspace()), { sourceId: "ds-full", header: ["名称"], rows: Array.from({ length: 50001 }, () => ["记录"]), mapping: { 0: "title" }, now: FIXTURE_TIME, idFactory: idGenerator() }), /文件太大：最多 50,000 行/);
});
