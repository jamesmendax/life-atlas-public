import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { validateMarkdownExportPath, validateMarkdownExportPayload, writeMarkdownFolder } from "../electron/main/exports/markdownFolder.js";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";
import { FIXTURE_TIME, PNG_1X1_BASE64 } from "./fixtures/full-workspace.mjs";

test("export paths must stay inside the folder", () => {
  for (const value of ["../a.md", "/a.md", "a\\b.md", "a/./b.md", "a/:b.md", "a//b.md", "", "a/../b.md", "a/CON.md", "a/b. ", `a/${"字".repeat(101)}.md`]) assert.equal(validateMarkdownExportPath(value), false, value);
  for (const value of ["A 项目/A 概览.md", "_assets/0123456789ab-图.png"]) assert.equal(validateMarkdownExportPath(value), true, value);
});

test("all paths are validated before an export folder is created", async (context) => {
  const directory = createIsolatedDirectory("markdown-path-validation");
  context.after(() => removeIsolatedDirectory(directory));
  await assert.rejects(writeMarkdownFolder({ files: [{ path: "README.md", text: "readable" }, { path: "../bad.md", text: "bad" }], assets: [] }, { directory, now: FIXTURE_TIME }), { code: "E_INVALID_ARGUMENT" });
  assert.deepEqual(fs.readdirSync(directory), []);
  for (const files of [[{ path: "A.md", text: "a" }, { path: "a.md", text: "b" }], [{ path: "a.md", text: "a" }, { path: "a.md/b.md", text: "b" }]]) assert.throws(() => validateMarkdownExportPayload({ files, assets: [] }), { code: "E_INVALID_ARGUMENT" });
  assert.throws(() => validateMarkdownExportPayload({ files: [], assets: [{ path: "_assets/a.png", sha256: "../escape" }] }), { code: "E_INVALID_ARGUMENT" });
});

test("markdown folder writing preserves UTF8 bytes and skips missing assets", async (context) => {
  const directory = createIsolatedDirectory("markdown-folder-writing");
  const sourceDirectory = createIsolatedDirectory("markdown-source-assets");
  context.after(() => { removeIsolatedDirectory(directory); removeIsolatedDirectory(sourceDirectory); });
  const bytes = Buffer.from(PNG_1X1_BASE64, "base64");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  fs.writeFileSync(path.join(sourceDirectory, sha256), bytes);
  const payload = { files: [{ path: "README.md", text: "# 中文导出\n" }, { path: "A 项目/数据库.csv", text: "\uFEFF名称,数量\r\n任务,2\r\n" }], assets: [{ path: "_assets/图.png", sha256 }, { path: "_assets/missing.png", sha256: "a".repeat(64) }] };
  const assetStore = { filePath: (id) => path.join(sourceDirectory, id) };
  const first = await writeMarkdownFolder(payload, { directory, assetStore, now: FIXTURE_TIME });
  assert.equal(first.fileCount, 3);
  assert.deepEqual(first.missingAssets, ["_assets/missing.png"]);
  assert.equal(fs.readFileSync(path.join(first.folder, "README.md"), "utf8"), payload.files[0].text);
  assert.deepEqual(fs.readFileSync(path.join(first.folder, "A 项目/数据库.csv")), Buffer.from(payload.files[1].text, "utf8"));
  assert.equal(createHash("sha256").update(fs.readFileSync(path.join(first.folder, "_assets/图.png"))).digest("hex"), sha256);
  const second = await writeMarkdownFolder(payload, { directory, assetStore, now: FIXTURE_TIME });
  assert.equal(second.folder, `${first.folder} (2)`);
  assert.equal(fs.readFileSync(path.join(first.folder, "README.md"), "utf8"), payload.files[0].text);
});
