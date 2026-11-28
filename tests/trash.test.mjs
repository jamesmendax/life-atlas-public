import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isTrashExpired,
  movePageToTrash,
  purgeExpiredTrash,
  restorePageFromTrash,
  trashDaysRemaining,
  trashExpiresAt,
} from "../src/domain/pageActions.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const trashViewSource = fs.readFileSync(path.join(root, "src", "components", "TrashView.jsx"), "utf8");
const appSource = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");

const basePage = {
  id: "chemistry",
  folderId: "parenting",
  title: "化学",
  icon: "🧪",
  iconColor: "#6fa8dc",
  cover: { kind: "gallery", value: "van-gogh-starry-night", position: 45 },
  settings: { fontFamily: "mono", smallText: true, fullWidth: true, locked: false },
  content: [{ type: "paragraph", content: "重要正文" }],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

test("soft delete stamps trashedAt and keeps complete page data", () => {
  const trashed = movePageToTrash(basePage, "2026-09-01T00:00:00.000Z");
  assert.equal(trashed.trashedAt, "2026-09-01T00:00:00.000Z");
  assert.deepEqual(trashed.content, basePage.content);
  assert.deepEqual(trashed.cover, basePage.cover);
  assert.deepEqual(trashed.settings, basePage.settings);
});

test("trash retention never removes a page before 30 days and expires at 30 days", () => {
  const trashed = movePageToTrash(basePage, "2026-09-01T00:00:00.000Z");
  assert.equal(trashExpiresAt(trashed), "2026-10-01T00:00:00.000Z");
  assert.equal(trashDaysRemaining(trashed, "2026-09-30T23:59:59.000Z"), 1);
  assert.equal(isTrashExpired(trashed, "2026-09-30T23:59:59.000Z"), false);
  assert.equal(trashDaysRemaining(trashed, "2026-10-01T00:00:00.000Z"), 0);
  assert.equal(isTrashExpired(trashed, "2026-10-01T00:00:00.000Z"), true);
});

test("purge only removes expired trashed pages", () => {
  const oldPage = movePageToTrash({ ...basePage, id: "old" }, "2026-08-01T00:00:00.000Z");
  const recentPage = movePageToTrash({ ...basePage, id: "recent" }, "2026-09-20T00:00:00.000Z");
  const activePage = { ...basePage, id: "active", trashedAt: null };
  const remaining = purgeExpiredTrash([oldPage, recentPage, activePage], "2026-10-01T00:00:00.000Z");
  assert.deepEqual(remaining.map((page) => page.id), ["recent", "active"]);
});

test("restore preserves content and appearance and clears only trash state", () => {
  const trashed = movePageToTrash(basePage, "2026-09-18T00:00:00.000Z");
  const restored = restorePageFromTrash(trashed, { now: "2026-09-19T00:00:00.000Z" });
  assert.equal(restored.trashedAt, null);
  assert.equal(restored.updatedAt, "2026-09-19T00:00:00.000Z");
  assert.equal(restored.folderId, basePage.folderId);
  assert.deepEqual(restored.content, basePage.content);
  assert.deepEqual(restored.cover, basePage.cover);
  assert.deepEqual(restored.settings, basePage.settings);
});

test("Trash UI exposes restore, permanent delete, empty trash, and a 30-day explanation", () => {
  assert.match(trashViewSource, /30 天/);
  assert.match(trashViewSource, /恢复/);
  assert.match(trashViewSource, /永久删除/);
  assert.match(trashViewSource, /清空回收站/);
  assert.match(appSource, /activeSection === "trash"/);
  assert.match(appSource, /restoreTrashedPage/);
  assert.match(appSource, /permanentlyDeleteTrashedPage/);
  assert.match(appSource, /emptyTrash/);
});
