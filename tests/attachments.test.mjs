import test from "node:test";
import assert from "node:assert/strict";
import {
  attachmentIdFromUrl,
  attachmentUrlWithId,
  persistBrowserAttachment,
  resolveBrowserAttachmentUrl,
  workspaceHasBinaryPayload,
} from "../src/domain/attachments.js";

test("attachment marker roundtrips identity without embedding binary", () => {
  const value = attachmentUrlWithId("blob:http://localhost/example", "attachment-hello world");
  assert.equal(attachmentIdFromUrl(value), "attachment-hello world");
  assert.equal(workspaceHasBinaryPayload({
    attachments: [{ id: "attachment-1", provider: "local-ref", storageKey: "attachment-1" }],
    pages: [{ content: [{ type: "image", props: { url: value } }] }],
  }), false);
});

test("binary detector scans page content as well as attachment metadata", () => {
  assert.equal(workspaceHasBinaryPayload({
    attachments: [],
    pages: [{ content: [{ type: "image", props: { url: "data:image/png;base64,AAAA" } }] }],
  }), true);
});

test("browser attachment provider keeps blob outside workspace metadata and resolves a fresh URL", async () => {
  const blob = new Blob(["hello"], { type: "text/plain" });
  Object.defineProperty(blob, "name", { value: "hello.txt" });
  const created = await persistBrowserAttachment(blob, { id: "attachment-test", now: "2026-09-19T00:00:00.000Z" });
  assert.equal(created.metadata.id, "attachment-test");
  assert.equal(created.metadata.provider, "local-ref");
  assert.equal(created.metadata.storageKey, "attachment-test");
  assert.equal(created.metadata.mime, "text/plain");
  assert.equal(attachmentIdFromUrl(created.url), "attachment-test");
  assert.equal(workspaceHasBinaryPayload({ attachments: [created.metadata] }), false);
  const restored = await resolveBrowserAttachmentUrl("attachment-test");
  assert.equal(attachmentIdFromUrl(restored), "attachment-test");
  assert.match(restored, /^blob:/);
});
