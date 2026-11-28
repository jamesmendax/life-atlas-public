import test from "node:test";
import assert from "node:assert/strict";
import { writeBrowserAttachmentBlob, resolveBrowserAttachmentUrl, removeBrowserAttachmentBlob } from "../src/domain/attachments.js";

test("browser attachment resolution reuses an object URL until its bytes change", async () => {
  const id = "attachment-cached-local";
  try {
    await writeBrowserAttachmentBlob(id, new Blob(["first"]));
    const [first, second] = await Promise.all([resolveBrowserAttachmentUrl(id), resolveBrowserAttachmentUrl(id)]);
    assert.ok(first.startsWith("blob:"));
    assert.equal(first, second);
    assert.equal(await resolveBrowserAttachmentUrl(id), first);
    await writeBrowserAttachmentBlob(id, new Blob(["second"]));
    assert.notEqual(await resolveBrowserAttachmentUrl(id), first);
  } finally { await removeBrowserAttachmentBlob(id); }
  assert.equal(await resolveBrowserAttachmentUrl(id), null);
});
