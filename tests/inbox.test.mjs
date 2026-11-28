import test from "node:test";
import assert from "node:assert/strict";
import { fullWorkspace, FIXTURE_TIME } from "./fixtures/full-workspace.mjs";
import { migrateInbox } from "../src/persistence/migrations.js";
import { archivePages } from "../src/domain/inbox.js";

function pending() { const workspace = migrateInbox(fullWorkspace()); for (const page of workspace.pages.filter((entry) => ["p-a1", "p-b1"].includes(entry.id))) Object.assign(page, { folderId: "system-inbox", inboxedAt: FIXTURE_TIME }); return workspace; }
test("archiving keeps the page id and clears inboxedAt", () => { const workspace = pending(); const result = archivePages(workspace, ["p-a1"], "f-z", FIXTURE_TIME); assert.equal(result.pages.length, workspace.pages.length); assert.equal(result.pages.find((page) => page.id === "p-a1").folderId, "f-z"); assert.equal(result.pages.find((page) => page.id === "p-a1").inboxedAt, null); assert.equal(workspace.pages.find((page) => page.id === "p-a1").folderId, "system-inbox"); });
test("batch archiving moves every selected page", () => { const result = archivePages(pending(), ["p-a1", "p-b1"], "f-z", FIXTURE_TIME); for (const id of ["p-a1", "p-b1"]) assert.deepEqual([result.pages.find((page) => page.id === id).folderId, result.pages.find((page) => page.id === id).inboxedAt], ["f-z", null]); });
test("archiving into a system folder or trashed folder is refused", () => { const workspace = pending(); workspace.folders.find((folder) => folder.id === "f-z").trashedAt = FIXTURE_TIME; for (const id of ["f-z", "system-inbox", "missing"]) assert.throws(() => archivePages(workspace, ["p-a1"], id, FIXTURE_TIME)); });
