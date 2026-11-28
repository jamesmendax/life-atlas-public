import test from "node:test";
import assert from "node:assert/strict";

import { coreParityWorkspace } from "./fixtures/core-parity-workspace.mjs";
import { walkBlocks } from "../src/domain/blockDocument.js";
import { createPageTemplate, instantiatePageTemplate, createDatabaseTemplate, applyDatabaseTemplate } from "../src/domain/templates.js";
import { createDiscussion, createComment, discussionAnchorState, setDiscussionResolved } from "../src/domain/comments.js";
import { createAttachmentMetadata, createAttachmentProvider, workspaceHasBinaryPayload } from "../src/domain/attachments.js";
import { buildSearchDocuments, querySearch } from "../src/search/searchIndex.js";
import { migratePhase3 } from "../src/persistence/migrations.js";
import { createWorkspaceBackup, parseWorkspaceBackup } from "../src/domain/workspaceBackup.js";

test("Phase 3 page templates clone content with fresh block IDs", () => {
  const workspace = coreParityWorkspace();
  const source = workspace.pages.find((page) => page.id === "alpha-page");
  const template = createPageTemplate(source, { id:"tpl-page", name:"项目页模板", now:"2026-09-19T00:00:00.000Z" });
  const created = instantiatePageTemplate(template, { id:"page-from-template", folderId:source.folderId, now:"2026-09-19T00:01:00.000Z" });
  const originalIds = new Set(walkBlocks(source.content).map((block) => block.id));
  const newIds = walkBlocks(created.content).map((block) => block.id);
  assert.ok(newIds.length > 0);
  assert.ok(newIds.every((id) => !originalIds.has(id)));
  assert.notEqual(created.content, template.content);
  assert.equal(created.title, "项目页模板");
});

test("Phase 3 database templates preserve defaults and clone arbitrary page content", () => {
  const workspace = coreParityWorkspace();
  const page = workspace.pages.find((entry) => entry.id === "alpha-page");
  const item = workspace.databaseItems.find((entry) => entry.id === "alpha");
  const template = createDatabaseTemplate("projects", {
    id:"tpl-db",
    name:"项目记录模板",
    defaultValues:item.values,
    pageContent:page.content,
    pageAppearance:{ icon:"🧪", settings:{ fullWidth:true } },
    now:"2026-09-19T00:00:00.000Z",
  });
  const applied = applyDatabaseTemplate(template);
  assert.deepEqual(applied.values, item.values);
  assert.equal(applied.appearance.icon, "🧪");
  const originalIds = new Set(walkBlocks(page.content).map((block) => block.id));
  assert.ok(walkBlocks(applied.content).every((block) => !originalIds.has(block.id)));
});

test("Phase 3 local discussions keep block anchors across moves, orphan on deletion, and resolve/reopen", () => {
  const workspace = coreParityWorkspace();
  const page = workspace.pages.find((entry) => entry.id === "alpha-page");
  const blockId = walkBlocks(page.content)[0].id;
  const discussion = createDiscussion({ pageId:page.id, anchor:{kind:"block",blockId}, id:"discussion-1", now:"2026-09-19T00:00:00.000Z" });
  const comment = createComment({ discussionId:discussion.id, authorId:"person-a", body:"需要补充催化剂说明", id:"comment-1", now:"2026-09-19T00:00:01.000Z" });
  assert.equal(comment.body, "需要补充催化剂说明");
  assert.equal(discussionAnchorState(discussion,page), "active");
  const moved = { ...page, content:[...page.content].reverse() };
  assert.equal(discussionAnchorState(discussion,moved), "active");
  const withoutBlock = { ...page, content:page.content.filter((block) => block.id !== blockId) };
  assert.equal(discussionAnchorState(discussion,withoutBlock), "orphaned");
  const resolved = setDiscussionResolved(discussion,true,"2026-09-19T00:01:00.000Z");
  assert.ok(resolved.resolvedAt);
  assert.equal(setDiscussionResolved(resolved,false,"2026-09-19T00:02:00.000Z").resolvedAt,null);
});

test("Phase 3 attachment metadata/provider stores locators only and never binary payloads", async () => {
  const attachment = createAttachmentMetadata({
    name:"设计说明.pdf", mime:"application/pdf", provider:"external", externalUrl:"https://example.com/design.pdf",
  }, { id:"attachment-phase3", now:"2026-09-19T00:00:00.000Z" });
  const provider = createAttachmentProvider();
  const locator = await provider.put({ url:attachment.externalUrl });
  assert.deepEqual(locator,{ provider:"external", externalUrl:attachment.externalUrl, storageKey:attachment.externalUrl });
  assert.equal(await provider.get(locator),attachment.externalUrl);
  assert.equal(provider.canPersistLocally(),false);
  assert.equal(workspaceHasBinaryPayload({attachments:[attachment]}),false);
  assert.equal(workspaceHasBinaryPayload({attachments:[{...attachment,metadata:{raw:"data:image/png;base64,AAAA"}}]}),true);
});

test("Phase 3 search indexes human-readable database values, comments, attachments and templates", () => {
  const workspace = migratePhase3(coreParityWorkspace());
  workspace.pageTemplates.push(createPageTemplate(workspace.pages.find((page)=>page.id==="alpha-page"),{id:"search-template",name:"化学项目模板",now:"2026-09-19T00:00:00.000Z"}));
  workspace.databaseTemplates.push(createDatabaseTemplate("projects",{id:"search-db-template",name:"冲刺模板",defaultValues:{status:"doing"},pageContent:[],now:"2026-09-19T00:00:00.000Z"}));
  workspace.discussions.push(createDiscussion({pageId:"alpha-page",anchor:{kind:"page"},id:"search-discussion",now:"2026-09-19T00:00:00.000Z"}));
  workspace.comments.push(createComment({discussionId:"search-discussion",authorId:"person-a",body:"催化剂复盘关键词",id:"search-comment",now:"2026-09-19T00:00:00.000Z"}));
  workspace.attachments.push(createAttachmentMetadata({name:"反应机理.pdf",mime:"application/pdf",provider:"external",externalUrl:"https://example.com/mechanism.pdf"},{id:"search-attachment",now:"2026-09-19T00:00:00.000Z"}));
  const alpha = workspace.databaseItems.find((item)=>item.id==="alpha");
  alpha.values.files = [...(alpha.values.files || []),"search-attachment"];
  const docs = buildSearchDocuments(workspace.folders,workspace.pages,workspace);
  assert.ok(querySearch(docs,"催化剂复盘关键词").some((result)=>result.type==="comment" && result.pageId==="alpha-page"));
  assert.ok(querySearch(docs,"反应机理").some((result)=>result.type==="attachment" && result.pageId==="alpha-page"));
  assert.ok(querySearch(docs,"化学项目模板").some((result)=>result.type==="template"));
  assert.ok(querySearch(docs,"120").some((result)=>result.type==="database_item" && result.pageId==="alpha-page"));
});

test("Phase 3 v9 migration and full workspace JSON backup roundtrip are deterministic and complete", () => {
  const source = coreParityWorkspace();
  source.schemaVersion = 8;
  source.attachments = [{id:"legacy-file",name:"legacy.pdf",mime:"application/pdf",kind:"external",uri:"https://example.com/legacy.pdf",createdAt:"2026-09-01T00:00:00.000Z"}];
  source.pageTemplates = [{id:"tpl",name:"Legacy Template",content:source.pages[0].content}];
  source.databaseTemplates = [{id:"dbtpl",sourceId:"projects",name:"DB Template",defaultValues:{status:"doing"},pageContent:[]}];
  source.discussions = [{id:"d1",pageId:"alpha-page",anchor:{kind:"page"},createdAt:"2026-09-01T00:00:00.000Z"}];
  source.comments = [{id:"c1",discussionId:"d1",authorId:"person-a",body:"roundtrip",createdAt:"2026-09-01T00:00:00.000Z"}];
  const migrated = migratePhase3(source);
  assert.equal(migrated.schemaVersion,9);
  assert.deepEqual(migratePhase3(migrated),migrated);
  assert.equal(migrated.attachments[0].provider,"external");
  assert.equal(migrated.attachments[0].externalUrl,"https://example.com/legacy.pdf");
  const backup = createWorkspaceBackup(migrated);
  const restored = parseWorkspaceBackup(JSON.stringify(backup));
  assert.equal(restored.schemaVersion,10);
  assert.deepEqual(restored.pageTemplates,migrated.pageTemplates);
  assert.deepEqual(restored.databaseTemplates,migrated.databaseTemplates);
  assert.deepEqual(restored.discussions,migrated.discussions);
  assert.deepEqual(restored.comments,migrated.comments);
  assert.deepEqual(restored.attachments,migrated.attachments);
});
