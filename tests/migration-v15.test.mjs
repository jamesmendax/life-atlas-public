import test from "node:test";
import assert from "node:assert/strict";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";
import { migrateInbox } from "../src/persistence/migrations.js";

test("v15 creates exactly one inbox", () => { const result = migrateInbox(fullWorkspace()); assert.equal(result.folders.filter((folder) => folder.system === "inbox").length, 1); assert.equal(result.folders.find((folder) => folder.system === "inbox").id, "system-inbox"); assert.equal(result.schemaVersion, 15); });
test("v15 adds inbox and reminder fields", () => { const result = migrateInbox(fullWorkspace()); assert.ok(result.pages.every((page) => page.inboxedAt === null)); assert.deepEqual(result.ui.firedReminderIds, []); assert.deepEqual(result.ui.reminderLog, []); assert.equal(result.ui.lastReminderCheckAt, null); });
test("v15 is idempotent", () => { const input = fullWorkspace(); const before = structuredClone(input); const result = migrateInbox(input); assert.deepEqual(input, before); assert.deepEqual(migrateInbox(result), result); });
test("v15 does not read the clock", (context) => { const input = fullWorkspace(); context.mock.method(Date, "now", () => { throw new Error("Clock access"); }); const result = migrateInbox(input); assert.deepEqual(migrateInbox(input), result); assert.equal(result.folders.find((folder) => folder.system === "inbox").createdAt, input.savedAt || "1970-01-01T00:00:00.000Z"); });
