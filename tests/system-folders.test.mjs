import test from "node:test";
import assert from "node:assert/strict";
import { fullWorkspace, FIXTURE_TIME } from "./fixtures/full-workspace.mjs";
import { migrateInbox } from "../src/persistence/migrations.js";
import { childFolders, moveFolder, renameFolder } from "../src/domain/navigation.js";
import { trashFolder } from "../src/domain/trash.js";
import { checkWorkspaceIntegrity } from "../src/domain/integrity.js";
import { buildSearchDocuments } from "../src/search/searchIndex.js";

test("system folders are hidden from the private tree", () => { const workspace = migrateInbox(fullWorkspace()); assert.ok(childFolders(workspace.folders, null).every((folder) => !folder.system)); });
test("system folders cannot be trashed moved renamed or used as a move target", () => { const workspace = migrateInbox(fullWorkspace()); for (const action of [() => trashFolder(workspace, "system-inbox", FIXTURE_TIME), () => moveFolder(workspace, "system-inbox", "f-z", FIXTURE_TIME), () => moveFolder(workspace, "f-z", "system-inbox", FIXTURE_TIME), () => renameFolder(workspace, "system-inbox", "Other", FIXTURE_TIME)]) assert.throws(action, /系统文件夹不能删除、移动或改名/); });
test("integrity reports an invalid system folder", () => { for (const patch of [{ parentId: "f-z" }, { trashedAt: FIXTURE_TIME }, { duplicate: true }]) { const workspace = migrateInbox(fullWorkspace()); const inbox = workspace.folders.find((folder) => folder.system === "inbox"); if (patch.duplicate) workspace.folders.push({ ...inbox, id: "duplicate-inbox" }); else Object.assign(inbox, patch); assert.ok(checkWorkspaceIntegrity(workspace).problems.some((problem) => problem.code === "SYSTEM_FOLDER_INVALID" && problem.severity === "error")); } });
test("search shows the inbox path", () => { const workspace = migrateInbox(fullWorkspace()); workspace.pages.find((page) => page.id === "p-a1").folderId = "system-inbox"; const documents = buildSearchDocuments(workspace.folders, workspace.pages, workspace); assert.equal(documents.find((entry) => entry.id === "page:p-a1").path, "收件箱"); assert.ok(!documents.some((entry) => entry.id === "folder:system-inbox")); });
