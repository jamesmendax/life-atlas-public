import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const editor = fs.readFileSync(path.join(root, "src", "editor", "PageEditor.jsx"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");

test("BlockNote upload delegates to attachment provider and never converts file bytes to data URLs", () => {
  assert.match(editor, /databaseRuntime\?\.createEditorAttachment/);
  assert.doesNotMatch(editor, /FileReader|readAsDataURL|fileToDataUrl/);
  assert.match(app, /persistBrowserAttachment/);
  assert.match(app, /attachments:\s*\[\.\.\.\(current\.attachments \|\| \[\]\), created\.metadata\]/);
});

test("persisted attachment URLs carry stable identity and are repaired after reload", () => {
  assert.match(editor, /attachmentIdFromUrl/);
  assert.match(editor, /resolveEditorAttachmentUrl/);
  assert.match(editor, /editor\.updateBlock\(repair\.block, \{ props: \{ url: freshUrl \} \}\)/);
});
