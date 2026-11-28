import test from "node:test";
import assert from "node:assert/strict";
import { attachmentReferences, permanentlyDelete } from "../src/domain/trash.js";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";

test("desktop content-addressed media keeps its metadata while another page references it", () => {
  const workspace = fullWorkspace();
  const hash = "a".repeat(64);
  workspace.attachments.push({ id: "asset-photo", provider: "asset", storageKey: hash });
  for (const id of ["p-a1", "p-z1"]) workspace.pages.find((page) => page.id === id).content.push({ id: `${id}-asset`, type: "image", props: { url: `life-asset://${hash}` } });
  assert.equal(attachmentReferences(workspace).has("asset-photo"), true);
  const next = permanentlyDelete(workspace, { pageIds: ["p-a1"], folderIds: [] });
  assert.ok(next.attachments.some((attachment) => attachment.id === "asset-photo"));
  const last = permanentlyDelete(next, { pageIds: ["p-z1"], folderIds: [] });
  assert.equal(last.attachments.some((attachment) => attachment.id === "asset-photo"), false);
});

test("page and template covers and icons keep shared asset metadata until their last reference is removed", () => {
  const workspace = fullWorkspace();
  const hash = "b".repeat(64);
  workspace.attachments.push({ id: "asset-appearance", provider: "asset", storageKey: hash });
  workspace.pages.find((page) => page.id === "p-a1").icon = `life-asset://${hash}`;
  workspace.pages.find((page) => page.id === "p-z1").cover = { kind: "upload", value: `life-asset://${hash}` };
  workspace.pageTemplates.push({ id: "appearance-template", content: [], icon: `life-asset://${hash}` });
  assert.equal(attachmentReferences(workspace).has("asset-appearance"), true);
  const next = permanentlyDelete(workspace, { pageIds: ["p-a1", "p-z1"] });
  assert.ok(next.attachments.some((attachment) => attachment.id === "asset-appearance"));
  assert.equal(attachmentReferences({ ...next, pageTemplates: [] }).has("asset-appearance"), false);
});

test("browser-restored asset references resolve by checksum without changing document URLs", () => {
  const workspace = fullWorkspace();
  const hash = "c".repeat(64);
  workspace.attachments.push({ id: "restored-asset", provider: "local-ref", storageKey: "restored-asset--restore-token", checksum: hash });
  workspace.pages.find((page) => page.id === "p-a1").content.push({ id: "restored-image", type: "image", props: { url: `life-asset://${hash}` } });
  assert.equal(attachmentReferences(workspace).has("restored-asset"), true);
});
