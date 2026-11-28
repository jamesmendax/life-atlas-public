import test from "node:test";
import assert from "node:assert/strict";
import { createPageTemplate, defaultTemplateFolderId, instantiatePageTemplate, pageTemplateDescription, pageTemplatePreview, templateFolderChoices } from "../src/domain/templates.js";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";

test("template folder choices show full paths and exclude trashed ancestors", () => {
  const workspace = fullWorkspace();
  const original = structuredClone(workspace);
  assert.equal(templateFolderChoices(workspace).find((folder) => folder.id === "f-c").path, "A 项目 / B 资料 / C 细节");
  assert.deepEqual(workspace, original);
  workspace.folders.find((folder) => folder.id === "f-b").trashedAt = "2026-11-01T00:00:00.000Z";
  assert.ok(!templateFolderChoices(workspace).some((folder) => ["f-b", "f-c"].includes(folder.id)));
});

test("template destination defaults to the current folder or first top-level folder", () => {
  const workspace = fullWorkspace();
  assert.equal(defaultTemplateFolderId(workspace, "f-c"), "f-c");
  assert.equal(defaultTemplateFolderId(workspace, "missing"), "f-a");
  workspace.folders.find((folder) => folder.id === "f-a").trashedAt = "2026-11-01T00:00:00.000Z";
  assert.equal(defaultTemplateFolderId(workspace, "f-c"), "f-z");
  assert.equal(defaultTemplateFolderId({ folders: [] }), "");
});

test("my template description uses a local saved date", () => {
  const createdAt = new Date(2026, 9, 20, 23, 45).toISOString();
  assert.equal(pageTemplateDescription({ createdAt }), "我的模板，10月20日保存");
  assert.equal(pageTemplateDescription({ createdAt: "invalid" }), "我的模板");
});

test("my template preview contains only the first five blocks as plain text", () => {
  const workspace = fullWorkspace();
  const template = { content: [
    { id: "heading", type: "heading", content: "第一行" },
    { id: "mention", type: "paragraph", content: [{ type: "text", text: "引用：" }, { type: "pageMention", props: { pageId: "p-z1" } }] },
    { id: "literal", type: "paragraph", content: "<img src=x onerror=alert(1)>" },
    { id: "empty", type: "paragraph", content: "" },
    { id: "fifth", type: "paragraph", content: "第五行" },
    { id: "sixth", type: "paragraph", content: "不显示" },
  ] };
  assert.deepEqual(pageTemplatePreview(template, workspace), ["第一行", "引用：Z 目标页", "<img src=x onerror=alert(1)>", "", "第五行"]);
});

test("saving and reusing a page template preserves content with fresh block ids", () => {
  const workspace = fullWorkspace();
  const page = workspace.pages.find((entry) => entry.id === "p-a1");
  const original = structuredClone(page);
  const template = createPageTemplate(page, { id: "page-template-test", name: "概览模板", now: "2026-11-01T02:00:00.000Z" });
  const reused = instantiatePageTemplate(template, { id: "reused-page", folderId: "f-empty", now: "2026-11-01T02:00:00.000Z" });
  assert.deepEqual(page, original);
  assert.equal(reused.title, "概览模板");
  assert.equal(reused.folderId, "f-empty");
  assert.deepEqual(reused.content.map(({ id, ...block }) => block), page.content.map(({ id, ...block }) => block));
  assert.ok(reused.content.every((block) => !page.content.some((originalBlock) => originalBlock.id === block.id)));
});
