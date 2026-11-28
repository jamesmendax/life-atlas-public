import test from "node:test";
import assert from "node:assert/strict";
import {
  VAULT_SLASH_COMMANDS,
  collectFieldAttachmentIds,
  collectVaultNoteAttachmentIds,
  createVaultBlock,
  filterVaultSlashCommands,
  parseVaultNote,
  serializeVaultNote,
} from "../src/vault-ui/vaultNoteModel.js";

test("plain-text vault notes round-trip transparently without changing existing v1 data", () => {
  for (const text of ["", "Synthetic-Field-48", "第一行说明\n第二行说明"]) {
    const blocks = parseVaultNote(text);
    assert.equal(serializeVaultNote(blocks), text);
  }
});

test("isolated rich blocks including encrypted images and files round-trip cleanly", () => {
  const imageId = `va_${"a".repeat(32)}`;
  const fileId = `va_${"b".repeat(32)}`;
  const blocks = [
    createVaultBlock("heading1", { text: "恢复指南" }),
    createVaultBlock("callout", { text: "仅限离线保存，勿同步云盘" }),
    createVaultBlock("todo", { text: "确认硬件密钥", checked: true }),
    createVaultBlock("todo", { text: "核对备份码", checked: false }),
    createVaultBlock("numbered", { text: "第一步" }),
    createVaultBlock("numbered", { text: "第二步" }),
    createVaultBlock("code", { text: "ssh-ed25519 AAAA..." }),
    createVaultBlock("divider"),
    createVaultBlock("image", { attachmentId: imageId, name: "qr.png", caption: "TOTP 二维码" }),
    createVaultBlock("file", { attachmentId: fileId, name: "recovery.pdf" }),
  ];
  const encoded = serializeVaultNote(blocks);
  const decoded = parseVaultNote(encoded);
  assert.deepEqual(
    decoded.map(({ type, text, checked, attachmentId, name, caption }) => ({ type, text, checked, attachmentId, name, caption })),
    blocks.map(({ type, text, checked, attachmentId, name, caption }) => ({ type, text, checked, attachmentId, name, caption })),
  );
  assert.deepEqual([...collectVaultNoteAttachmentIds(encoded)], [imageId, fileId]);
  assert.deepEqual([...collectFieldAttachmentIds([{ kind: "multiline", value: encoded }, { kind: "text", value: "ignored" }])], [imageId, fileId]);
});

test("external URLs, workspace assets, page links, and databases remain inert plain text in vault notes", () => {
  const untrusted = [
    "![evil](https://example.invalid/tracker.png)",
    "![[vault-image:life-asset://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|leak.png]]",
    "![[vault-file:../secret.txt|traversal.txt]]",
    "lifeatlas://page/12345",
  ].join("\n");
  const blocks = parseVaultNote(untrusted);
  assert.equal(blocks.every((block) => block.type === "paragraph"), true);
  assert.equal(collectVaultNoteAttachmentIds(untrusted).size, 0);
  const slashIds = new Set(VAULT_SLASH_COMMANDS.map((cmd) => cmd.id));
  assert.equal(slashIds.has("database"), false);
  assert.equal(slashIds.has("syncedBlock"), false);
  assert.equal(slashIds.has("pageLink"), false);
  assert.ok(filterVaultSlashCommands("图").some((cmd) => cmd.id === "image"));
  assert.ok(filterVaultSlashCommands("文件").some((cmd) => cmd.id === "file"));
});
