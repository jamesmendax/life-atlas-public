import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { convertBrowserPackage } from "../electron/main/backup/legacyConversion.js";
import { backupFixture } from "./fixtures/backup-helpers.mjs";
import { parseJsonBytes } from "../src/backup/serialize.js";

async function converted(change) {
  const fixture = await backupFixture();
  change?.(fixture.workspace);
  const written = new Map();
  const original = structuredClone(fixture.workspace);
  const result = await convertBrowserPackage(fixture.workspace, parseJsonBytes(fixture.files.get("assets/index.json")), {
    putAsset: async (bytes, metadata) => {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      written.set(sha256, { bytes, ...metadata });
      return { url: `life-asset://${sha256}` };
    },
  });
  assert.deepEqual(fixture.workspace, original);
  return { ...result, written };
}

test("local attachments become content addressed assets", async () => {
  const { workspace, report } = await converted();
  for (const attachment of workspace.attachments) {
    assert.equal(attachment.provider, "asset");
    assert.equal(attachment.storageKey, attachment.checksum);
    assert.match(attachment.storageKey, /^[a-f0-9]{64}$/);
  }
  assert.equal(report.convertedAttachments, 3);
});

test("attachment urls in blocks are rewritten", async () => {
  const { workspace } = await converted();
  assert.equal(workspace.pages.find((page) => page.id === "p-b1").content.find((block) => block.type === "image").props.url, "life-asset://c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77");
});

test("data urls in icons and covers become assets", async () => {
  const { workspace, written, report } = await converted();
  assert.match(workspace.pages.find((page) => page.id === "p-c1").icon, /^life-asset:\/\//);
  assert.match(workspace.pages.find((page) => page.id === "p-z1").cover.value, /^life-asset:\/\//);
  assert.equal(written.size, 1);
  assert.equal(report.convertedDataUrls, 2);
});

test("data urls in ordinary text are left alone", async () => {
  const value = "data:image/png;base64,AAAA";
  const { workspace } = await converted((input) => input.pages.find((page) => page.id === "p-a1").content.push({ id: "text-data-url", type: "paragraph", content: value }));
  assert.equal(workspace.pages.find((page) => page.id === "p-a1").content.at(-1).content, value);
});

test("the report lists no leftovers", async () => {
  const { report } = await converted();
  assert.deepEqual(report.leftovers, []);
});

test("conversion covers nested template media and leaves unresolved references visible", async () => {
  const { workspace, report } = await converted((input) => {
    input.pageTemplates[0].content.push({ id: "nested", type: "paragraph", content: "data:image/png;base64,AAAA", children: [{ id: "media", type: "video", props: { url: "data:video/mp4;base64,AAAA" } }] });
    input.databaseTemplates[0].pageAppearance = { icon: "data:image/png;base64,AAAA", cover: { kind: "upload", value: "data:image/png;base64,AAAA" } };
    input.syncedSources[0].blocks.push({ id: "unresolved", type: "file", props: { url: "blob:unknown#life-attachment=missing" } });
  });
  assert.match(workspace.pageTemplates[0].content.at(-1).children[0].props.url, /^life-asset:\/\//);
  assert.equal(workspace.pageTemplates[0].content.at(-1).content, "data:image/png;base64,AAAA");
  assert.match(workspace.databaseTemplates[0].pageAppearance.icon, /^life-asset:\/\//);
  assert.deepEqual(report.leftovers, [{ collection: "syncedSources", id: "sync-shared", field: "blocks[1].props.url" }]);
});
