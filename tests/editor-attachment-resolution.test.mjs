import test from "node:test";
import assert from "node:assert/strict";
import { assetHashFromUrl, attachmentForUrl, resolveAttachmentMediaUrl } from "../src/domain/attachmentUrls.js";

test("restored desktop media resolves via local metadata without mutating its stored URL", async () => {
  const hash = "a".repeat(64);
  const url = `life-asset://${hash}`;
  const attachment = { id: "original-id", checksum: hash, provider: "local-ref", storageKey: "staged-key" };
  const calls = [];
  const runtime = { workspace: { attachments: [attachment] }, resolveEditorAttachmentUrl: async (id) => { calls.push(id); return "blob:restored#life-attachment=original-id"; } };
  assert.equal(assetHashFromUrl(url), hash);
  assert.equal(attachmentForUrl(url, [attachment]), attachment);
  assert.equal(await resolveAttachmentMediaUrl(url, runtime), "blob:restored#life-attachment=original-id");
  assert.deepEqual(calls, ["original-id"]);
  assert.equal(attachment.storageKey, "staged-key");
});

test("marked browser images resolve fresh bytes and unavailable files reject before network access", async () => {
  assert.equal(await resolveAttachmentMediaUrl("blob:expired#life-attachment=photo", { resolveEditorAttachmentUrl: async (id) => id === "photo" ? "blob:fresh" : null }), "blob:fresh");
  await assert.rejects(resolveAttachmentMediaUrl("blob:expired#life-attachment=missing", { resolveEditorAttachmentUrl: async () => null }), /不可用/);
  await assert.rejects(resolveAttachmentMediaUrl("blob:unmarked", {}), /不可用/);
});

test("media resolution is offline and permits only valid direct desktop asset URLs", async () => {
  for (const url of ["https://example.com/a.png", "http://example.com/a.png", "file:///C:/private.png", "//example.com/a.png"]) await assert.rejects(resolveAttachmentMediaUrl(url, {}), /离线/);
  const url = `life-asset://${"b".repeat(64)}`;
  assert.equal(await resolveAttachmentMediaUrl(url, { platform: "desktop" }), url);
  await assert.rejects(resolveAttachmentMediaUrl(url, { platform: "browser" }), /不可用/);
  assert.equal(await resolveAttachmentMediaUrl("/covers/local.jpg", {}), "/covers/local.jpg");
});
