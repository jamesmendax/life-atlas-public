import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { browserCsvPreview, mapBrowserRows, parseCsv } from "../electron/main/vault/browserCsv.js";
import { lastTwoGroups } from "../electron/main/vault/recoveryKey.js";
import { TEST_PASSWORD, createVaultTestContext } from "./fixtures/vault-items.mjs";

const fixture = (browser) => fs.readFileSync(new URL(`./fixtures/browser-passwords/${browser}.csv`, import.meta.url), "utf8");

test("chrome edge and firefox exports are recognised", () => {
  for (const browser of ["chrome", "edge", "firefox"]) { const rows = mapBrowserRows(parseCsv(fixture(browser))); assert.equal(rows.length, 5); assert.equal(rows[4].name, "fallback.example.invalid"); }
  assert.throws(() => mapBrowserRows(parseCsv("username,password\nuser,pass")), { code: "E_INVALID_ARGUMENT" });
});

test("quotes commas newlines and chinese survive parsing", () => {
  for (const browser of ["chrome", "edge", "firefox"]) {
    const rows = mapBrowserRows(parseCsv("\uFEFF" + fixture(browser)));
    assert.equal(rows[0].note, "note, with comma"); assert.equal(rows[2].note, "first line\r\nsecond line"); assert.equal(rows[3].username, "测试用户");
    if (browser !== "firefox") assert.equal(rows[1].name, 'Quoted "Name"');
  }
  const lfRows = mapBrowserRows(parseCsv(fixture("chrome").replaceAll("\r\n", "\n")));
  assert.equal(lfRows[2].note, "first line\nsecond line");
});

test("previews never contain passwords", () => {
  for (const browser of ["chrome", "edge", "firefox"]) {
    const rows = mapBrowserRows(parseCsv(fixture(browser))); const preview = browserCsvPreview(rows);
    for (const row of preview) { assert.equal(Object.hasOwn(row, "password"), false); assert.equal(row.hasPassword, true); }
    for (const row of rows) assert.ok(!JSON.stringify(preview).includes(row.password));
  }
});

async function prepare(context, response = 1) {
  let file;
  const dialogs = { showOpenDialog: async () => ({ canceled: false, filePaths: [file] }), showMessageBox: async () => ({ response }) };
  const result = createVaultTestContext(context, { dialogs }); file = path.join(result.dataRoot, "synthetic.csv"); fs.writeFileSync(file, fixture("chrome"));
  const created = await result.service.create({ password: TEST_PASSWORD }); result.service.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(created.recoveryKey) });
  return { ...result, csvFile: file };
}

test("selected rows are imported as login items tagged import", async (context) => {
  const { service } = await prepare(context); const preview = await service.importBrowserCsv(); assert.equal(preview.total, 5);
  const result = await service.commitBrowserCsvImport({ importId: preview.importId, rowIndexes: [0, 3], deleteSourceFile: false }); assert.equal(result.importedCount, 2);
  const summaries = service.list().summaries; assert.equal(summaries.length, 2); for (const summary of summaries) { assert.equal(summary.type, "login"); assert.deepEqual(summary.tags, ["导入"]); }
  const chinese = summaries.find((summary) => summary.title === "中文服务"); assert.equal(service.getItem({ id: chinese.id }).item.fields.find((field) => field.label === "用户名").value, "测试用户");
  await assert.rejects(service.commitBrowserCsvImport({ importId: preview.importId, rowIndexes: [0], deleteSourceFile: false }), { code: "E_NOT_FOUND" });
});

test("the source file is deleted only after a second confirmation", async (context) => {
  for (const response of [1, 0]) {
    const { service, csvFile } = await prepare(context, response); const preview = await service.importBrowserCsv();
    const result = await service.commitBrowserCsvImport({ importId: preview.importId, rowIndexes: [0], deleteSourceFile: true }); assert.equal(result.deletedSourceFile, response === 0); assert.equal(fs.existsSync(csvFile), response !== 0);
  }
});

test("csv preview expires and is discarded on lock", async (context) => {
  const { service, fake } = await prepare(context); const preview = await service.importBrowserCsv();
  fake.clock.set(fake.clock.now() + 600000); fake.advance(600000);
  await service.unlock({ password: TEST_PASSWORD }); await assert.rejects(service.commitBrowserCsvImport({ importId: preview.importId, rowIndexes: [0], deleteSourceFile: false }), { code: "E_NOT_FOUND" });
});
