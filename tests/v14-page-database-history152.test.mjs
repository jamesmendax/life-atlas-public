import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { stableJson, walkBlocks } from "../src/domain/blockDocument.js";
import { createPageVersion, latestVersionOf, pageSnapshotOf, restorePageVersion, snapshotSignature } from "../src/domain/pageHistory.js";
import { applyTrackedPageEdit, captureTrackedPageVersions, isTrackedPageEdit, planTrackedPageCaptures } from "../src/domain/pageHistoryCapture.js";
import { createChangeTracker } from "../src/persistence/changeset.js";
import { applyChangeset, assembleWorkspace, openWorkspaceDatabase, quickCheck, readAllRows, readAssetRows, restoreAssetRows } from "../electron/main/storage/workspaceDb.js";
import { assertTestPath, createIsolatedDirectory, removeIsolatedDirectory, seedWorkspaceDatabase } from "./desktop/helpers.mjs";

const SOURCE = fileURLToPath(new URL("../.qa/LOCAL-NOTION-001/v14-wiki-real133/context136/native-selection141-final-closed35.json", import.meta.url));
const NOW = Date.parse("2026-11-13T22:25:00.000Z");
const DECLARATIONS = ["pageType", "databaseSourceId", "databaseViewId"];
const ORDINARY = { pageType: null, databaseSourceId: null, databaseViewId: null };
const declarationOf = (value) => Object.fromEntries(DECLARATIONS.filter((field) => Object.hasOwn(value, field)).map((field) => [field, value[field]]));
const same = (actual, expected, label) => assert.ok(isDeepStrictEqual(actual, expected), label);
const pageOf = (workspace, pageId) => workspace.pages.find((page) => page.id === pageId);

function realWiki() {
  const workspace = JSON.parse(fs.readFileSync(SOURCE, "utf8")).workspace;
  assert.equal(workspace.pages.length, 85);
  assert.equal(workspace.databaseItems.length, 58);
  assert.equal(workspace.dataSources.length, 11);
  assert.equal(workspace.databaseViews.length, 31);
  assert.equal(workspace.attachments.length, 20);
  assert.equal(workspace.pageVersions.length, 122);
  assert.ok(workspace.pageVersions.every((version) => DECLARATIONS.every((field) => !Object.hasOwn(version, field))));
  return workspace;
}

function occurrence(workspace) {
  const page = workspace.pages.find((entry) => entry.title === "随笔" && entry.pageType === null);
  const block = walkBlocks(page.content).find((entry) => entry.type === "databaseView");
  const source = workspace.dataSources.find((entry) => entry.id === block.props.sourceId);
  assert.equal(source.ownerPageId, page.id);
  assert.equal(workspace.pageVersions.filter((version) => version.pageId === page.id).length, 0);
  return { page, declaration: { pageType: "database", databaseSourceId: block.props.sourceId, databaseViewId: block.props.viewId } };
}

function preserved(workspace, original, pageId) {
  const changedPages = new Set(Array.isArray(pageId) ? pageId : [pageId]);
  for (const [collection, values] of Object.entries(original)) {
    if (!Array.isArray(values)) continue;
    if (collection === "pages") {
      assert.equal(workspace.pages.length, values.length);
      same(workspace.pages.filter((page) => !changedPages.has(page.id)), values.filter((page) => !changedPages.has(page.id)), "all other real pages preserved");
    } else if (collection === "pageVersions") {
      same(workspace.pageVersions.slice(0, values.length), values, "all 122 legacy histories preserved in order without declarations");
    } else same(workspace[collection], values, `${collection} preserved in full`);
  }
  same(workspace.ui, original.ui, "UI metadata preserved");
  for (const field of ["schemaVersion", "workspaceId", "savedAt"]) assert.equal(workspace[field], original[field]);
}

function transition(workspace) {
  const { page, declaration } = occurrence(workspace);
  assert.equal(isTrackedPageEdit(page, declaration), true, "declaration-only conversion is tracked");
  const full = applyTrackedPageEdit(workspace, { pageId: page.id, patch: declaration, now: NOW, beforeEditId: "ver-history152-before" });
  assert.equal(full.pageVersions.length, 123);
  same(declarationOf(full.pageVersions.at(-1)), ORDINARY, "before-edit records explicit ordinary nulls");
  const captured = captureTrackedPageVersions(full, [{ pageId: page.id, id: "ver-history152-full", reason: "idle" }], NOW + 1);
  assert.equal(captured.pageVersions.length, 124);
  same(declarationOf(captured.pageVersions.at(-1)), declaration, "fullpage declaration captured");
  const inline = applyTrackedPageEdit(captured, { pageId: page.id, patch: ORDINARY, now: NOW + 2, beforeEditId: "ver-history152-duplicate" });
  assert.equal(inline.pageVersions.length, 124, "identical latest fullpage snapshot is not duplicated before conversion");
  const result = captureTrackedPageVersions(inline, [{ pageId: page.id, id: "ver-history152-inline", reason: "idle" }], NOW + 3);
  assert.equal(result.pageVersions.length, 125);
  same(declarationOf(result.pageVersions.at(-1)), ORDINARY, "inline declaration captured as nulls");
  assert.notEqual(snapshotSignature(result.pageVersions.at(-1)), snapshotSignature(captured.pageVersions.at(-1)));
  same(pageOf(result, page.id).content, page.content, "declaration-only changes preserve real body and block identities");
  assert.equal(pageOf(result, page.id).contentRevision, page.contentRevision);
  preserved(result, workspace, page.id);
  return { workspace: result, page, declaration };
}

test("real 85-page Wiki versions and restores explicit inline/fullpage declarations while preserving all entities and 122 legacy histories", () => {
  const original = realWiki();
  const before = structuredClone(original);
  const { workspace, page, declaration } = transition(original);
  const full = restorePageVersion(workspace, { pageId: page.id, versionId: "ver-history152-full", now: NOW + 4, preRestoreId: "ver-history152-pre-full" });
  same(declarationOf(pageOf(full, page.id)), declaration, "fullpage declaration restored");
  same(declarationOf(full.pageVersions.at(-1)), ORDINARY, "mandatory pre-restore protects the inline declaration");
  const inline = restorePageVersion(full, { pageId: page.id, versionId: "ver-history152-inline", now: NOW + 5, preRestoreId: "ver-history152-pre-inline" });
  same(declarationOf(pageOf(inline, page.id)), ORDINARY, "explicit nulls clear all current declarations on restore");
  same(declarationOf(inline.pageVersions.at(-1)), declaration, "mandatory pre-restore protects the fullpage declaration");
  assert.equal(inline.pageVersions.length, 127);
  preserved(inline, original, page.id);
  same(original, before, "normal history helpers do not mutate the real source snapshot");
});

test("a new history of a real ordinary page with absent declarations clears later fullpage declarations while actual legacy history retains them", () => {
  const original = realWiki();
  const before = structuredClone(original);
  const page = original.pages.find((entry) => entry.title === "文章" && DECLARATIONS.every((field) => !Object.hasOwn(entry, field)));
  assert.ok(page, "real imported ordinary wrapper has no declaration fields");
  const block = walkBlocks(page.content).find((entry) => entry.type === "databaseView");
  assert.ok(block, "use the wrapper's real database occurrence for its explicit conversion");
  const declaration = { pageType: "database", databaseSourceId: block.props.sourceId, databaseViewId: block.props.viewId };
  const captured = captureTrackedPageVersions(original, [{ pageId: page.id, id: "ver-history152-absent-ordinary", reason: "idle" }], NOW);
  const version = captured.pageVersions.at(-1);
  assert.equal(version.id, "ver-history152-absent-ordinary");
  same(declarationOf(version), ORDINARY, "NEW ordinary history explicitly records all three nulls even when the page omits them");
  const converted = applyTrackedPageEdit(captured, { pageId: page.id, patch: declaration, now: NOW + 1, beforeEditId: null });
  same(declarationOf(pageOf(converted, page.id)), declaration, "explicit fullpage declaration applied");
  const restored = restorePageVersion(converted, { pageId: page.id, versionId: version.id, now: NOW + 2, preRestoreId: "ver-history152-pre-absent-ordinary" });
  same(declarationOf(pageOf(restored, page.id)), ORDINARY, "restoring the NEW ordinary version clears all later declarations");
  preserved(restored, original, page.id);
  const linked = pageOf(original, original.ui.selectedPageId);
  const actualLegacy = original.pageVersions.findLast((entry) => entry.pageId === linked.id);
  same(declarationOf(actualLegacy), {}, "actual legacy snapshot still has absent declarations");
  const legacyRestored = restorePageVersion(original, { pageId: linked.id, versionId: actualLegacy.id, now: NOW + 3, preRestoreId: "ver-history152-pre-actual-legacy" });
  same(declarationOf(pageOf(legacyRestored, linked.id)), declarationOf(linked), "restoring actual legacy history preserves current fullpage declarations");
  same(original, before, "new and legacy restoration never backfill the real source histories");
});

test("new snapshots record declaration values and ordinary nulls while logical signatures leave clean real Wiki pages uncaptured", () => {
  const workspace = realWiki();
  const record = workspace.pages.find((page) => Object.hasOwn(page, "databaseSourceId") && !Object.hasOwn(page, "pageType"));
  same(declarationOf(createPageVersion(record, { id: "ver-history152-record", now: NOW, reason: "idle" })),
    { ...ORDINARY, databaseSourceId: record.databaseSourceId }, "record source does not infer a database page type or view");
  const { page, declaration } = occurrence(workspace);
  const base = { ...page };
  DECLARATIONS.forEach((field) => delete base[field]);
  const inherited = Object.assign(Object.create(declaration), base);
  same(declarationOf(pageSnapshotOf(inherited)), ORDINARY, "inherited declarations are ignored and ordinary nulls recorded");
  same(declarationOf(createPageVersion(page, { id: "ver-history152-nulls", now: NOW, reason: "idle" })), ORDINARY, "explicit ordinary nulls are retained");

  for (const version of workspace.pageVersions) {
    const legacySnapshot = { title: version.title, icon: version.icon, iconColor: version.iconColor, cover: version.cover, settings: version.settings, content: version.content };
    assert.equal(snapshotSignature(version), stableJson({ ...legacySnapshot, ...ORDINARY }), `legacy signature ${version.id} normalizes logical ordinary nulls`);
    same(declarationOf(version), {}, "stored legacy snapshots never acquire current declarations");
  }
  const unchanged = [];
  for (const current of workspace.pages) {
    const version = createPageVersion(current, { id: `ver-history152-new-${current.id}`, now: NOW, reason: "idle" });
    same(declarationOf(version), { ...ORDINARY, ...declarationOf(current) }, "all 85 pages create explicit null/value declarations without inferring page type");
    const unchangedPatch = pageSnapshotOf(current);
    DECLARATIONS.forEach((field) => { if (!Object.hasOwn(current, field)) delete unchangedPatch[field]; });
    assert.ok(applyTrackedPageEdit(workspace, { pageId: current.id, patch: unchangedPatch, now: NOW, beforeEditId: "unused" }) === workspace,
      "reapplying actual existing fields does not edit a clean page");
    const latest = latestVersionOf(workspace.pageVersions, current.id);
    if (latest && DECLARATIONS.every((field) => !Object.hasOwn(current, field)) && isDeepStrictEqual(pageSnapshotOf(latest), pageSnapshotOf(current))) {
      unchanged.push({ pageId: current.id, id: `unused-${current.id}`, reason: "idle" });
    }
  }
  assert.ok(unchanged.length > 0, "use real unchanged legacy-backed pages");
  assert.equal(captureTrackedPageVersions(workspace, unchanged, NOW), workspace, "existing signatures do not add versions to unchanged legacy-backed ordinary pages");
  const clean = new Map(workspace.pages.map((current) => [current.id, { dirtySince: null, lastEditAt: NOW }]));
  const plan = planTrackedPageCaptures(clean, NOW + 600000, { flush: true, idFactory: () => assert.fail("unedited pages must not allocate history IDs") });
  same(plan.captures, [], "all 85 clean pages stay uncaptured, including already declared database pages");
});

test("all 122 real legacy restores preserve current declaration absence, nulls or values and legacy partial declarations restore only provided fields", () => {
  const workspace = realWiki();
  const before = structuredClone(workspace);
  for (const version of workspace.pageVersions) {
    const page = pageOf(workspace, version.pageId);
    const restored = restorePageVersion(workspace, { pageId: page.id, versionId: version.id, now: NOW, preRestoreId: `pre-history152-${version.id}` });
    same(declarationOf(pageOf(restored, page.id)), declarationOf(page), `legacy ${version.id} retains current declarations`);
    same(restored.pageVersions.slice(0, 122), workspace.pageVersions, "legacy restore does not rewrite any old history");
    same(declarationOf(restored.pageVersions.at(-1)), { ...ORDINARY, ...declarationOf(page) }, "new pre-restore records explicit values and ordinary nulls");
  }
  const page = workspace.pages.find((entry) => entry.id === workspace.ui.selectedPageId);
  const legacy = workspace.pageVersions.findLast((version) => version.pageId === page.id);
  assert.equal(page.pageType, "database");
  for (const currentDeclaration of [ORDINARY, {}]) {
    const current = { ...page };
    DECLARATIONS.forEach((field) => delete current[field]);
    Object.assign(current, currentDeclaration);
    const input = { ...workspace, pages: workspace.pages.map((entry) => entry.id === page.id ? current : entry) };
    const restored = restorePageVersion(input, { pageId: page.id, versionId: legacy.id, now: NOW, preRestoreId: "pre-history152-legacy" });
    same(declarationOf(pageOf(restored, page.id)), currentDeclaration, "legacy restore does not infer database declarations from body/source/ownership");
  }
  for (let mask = 1; mask < 8; mask += 1) {
    const expected = declarationOf(page);
    const version = { ...legacy, id: `ver-history152-legacy-partial-${mask}` };
    DECLARATIONS.forEach((field, index) => { if (mask & (1 << index)) { version[field] = null; expected[field] = null; } });
    const input = { ...workspace, pageVersions: [...workspace.pageVersions, version] };
    const restored = restorePageVersion(input, { pageId: page.id, versionId: version.id, now: NOW, preRestoreId: `pre-history152-partial-${mask}` });
    same(declarationOf(pageOf(restored, page.id)), expected, `partial declaration mask ${mask} restores only own fields`);
  }
  same(workspace, before, "all legacy and partial restore probes leave the full source unchanged");
});

test("full real Wiki declaration capture and restore survive incremental SQLite saves and reopen with attachment metadata and every old history intact", async (context) => {
  const originalBytes = fs.readFileSync(SOURCE, "utf8");
  const original = realWiki();
  const evidenceDir = fileURLToPath(new URL("../.qa/LOCAL-NOTION-001/v14-wiki-real133/history152/", import.meta.url));
  fs.mkdirSync(evidenceDir, { recursive: true });
  const dataRoot = createIsolatedDirectory("history152-sqlite");
  const registration = { owner: "history152", dataRoot, source: SOURCE, status: "created", nativeRuntimeStarted: false, assets: "metadata only; no attachment bytes read or hashed" };
  const registrationFile = path.join(evidenceDir, "sqlite-roundtrip152.json");
  fs.writeFileSync(registrationFile, JSON.stringify(registration, null, 2), "utf8");
  context.diagnostic(`isolatedDataRoot=${dataRoot}`);
  let db;
  let completed = false;
  context.after(() => {
    db?.close();
    const checkedRoot = assertTestPath(dataRoot);
    if (completed) removeIsolatedDirectory(checkedRoot);
    registration.status = completed ? "verified_and_owned_root_removed" : "failed_root_retained";
    registration.existsAfter = fs.existsSync(checkedRoot);
    fs.writeFileSync(registrationFile, JSON.stringify(registration, null, 2), "utf8");
    context.diagnostic(`SQLite resource ${registration.status}: ${checkedRoot}`);
  });
  const generation = "gen-history152";
  await seedWorkspaceDatabase(dataRoot, original, { normalize: false, generation, now: original.savedAt });
  const file = path.join(dataRoot, "workspace.db");
  db = openWorkspaceDatabase(file);
  const assets = [...new Map(original.attachments.map((attachment) => [attachment.storageKey, {
    sha256: attachment.storageKey, size: attachment.size, mime: attachment.mime, originalName: attachment.name, createdAt: attachment.createdAt,
  }])).values()];
  assert.equal(assets.length, 20, "all 20 real attachment metadata rows represented");
  restoreAssetRows(db, assets);
  const read = () => assembleWorkspace(readAllRows(db));
  const baseline = read();
  same(baseline, original, "all source arrays and UI seeded unchanged through existing SQLite helpers");
  const { workspace, page, declaration } = transition(baseline);
  const save = (before, after, now) => {
    const changes = createChangeTracker(before).diff(after);
    same(changes.deletes, [], "history changes never delete old entities");
    assert.ok(changes.upserts.every((entry) => ["pages", "pageVersions"].includes(entry.collection)), "only pages and new histories are written");
    assert.equal(changes.ui, null);
    applyChangeset(db, { ...changes, generation, schemaVersion: after.schemaVersion }, { now: new Date(now).toISOString(), expectedGeneration: generation });
    const expected = { ...after, savedAt: new Date(now).toISOString() };
    db.close();
    db = openWorkspaceDatabase(file);
    const reopened = read();
    same(reopened, expected, "all 14 entity arrays and UI survive SQLite close/reopen exactly");
    same(readAssetRows(db).sort((first, second) => first.sha256.localeCompare(second.sha256)), [...assets].sort((first, second) => first.sha256.localeCompare(second.sha256)), "20 assets metadata rows preserved exactly");
    assert.equal(quickCheck(db), "ok");
    registration.saves = (registration.saves || 0) + 1;
    return reopened;
  };
  let persisted = save(baseline, workspace, NOW + 3);
  same(declarationOf(pageOf(persisted, page.id)), ORDINARY, "inline declaration persisted");
  let restored = restorePageVersion(persisted, { pageId: page.id, versionId: "ver-history152-full", now: NOW + 4, preRestoreId: "ver-history152-sqlite-pre-full" });
  persisted = save(persisted, restored, NOW + 4);
  same(declarationOf(pageOf(persisted, page.id)), declaration, "fullpage restore persisted");
  restored = restorePageVersion(persisted, { pageId: page.id, versionId: "ver-history152-inline", now: NOW + 5, preRestoreId: "ver-history152-sqlite-pre-inline" });
  persisted = save(persisted, restored, NOW + 5);
  same(declarationOf(pageOf(persisted, page.id)), ORDINARY, "null restore persisted");
  const linked = pageOf(persisted, original.ui.selectedPageId);
  const legacy = original.pageVersions.findLast((version) => version.pageId === linked.id);
  restored = restorePageVersion(persisted, { pageId: linked.id, versionId: legacy.id, now: NOW + 6, preRestoreId: "ver-history152-sqlite-pre-legacy" });
  persisted = save(persisted, restored, NOW + 6);
  same(declarationOf(pageOf(persisted, linked.id)), declarationOf(linked), "legacy restore retains current fullpage declaration after SQLite reopen");
  const ordinary = persisted.pages.find((entry) => entry.title === "文章" && DECLARATIONS.every((field) => !Object.hasOwn(entry, field)));
  assert.ok(ordinary, "ordinary imported wrapper still has absent declarations in SQLite");
  const ordinaryBlock = walkBlocks(ordinary.content).find((entry) => entry.type === "databaseView");
  const ordinaryCaptured = captureTrackedPageVersions(persisted, [{ pageId: ordinary.id, id: "ver-history152-sqlite-absent-ordinary", reason: "idle" }], NOW + 7);
  const converted = applyTrackedPageEdit(ordinaryCaptured, { pageId: ordinary.id, patch: {
    pageType: "database", databaseSourceId: ordinaryBlock.props.sourceId, databaseViewId: ordinaryBlock.props.viewId,
  }, now: NOW + 7, beforeEditId: null });
  persisted = save(persisted, converted, NOW + 7);
  same(declarationOf(persisted.pageVersions.find((version) => version.id === "ver-history152-sqlite-absent-ordinary")), ORDINARY,
    "NEW formerly absent ordinary declaration is stored as all three nulls in SQLite");
  restored = restorePageVersion(persisted, { pageId: ordinary.id, versionId: "ver-history152-sqlite-absent-ordinary", now: NOW + 8, preRestoreId: "ver-history152-sqlite-pre-absent-ordinary" });
  persisted = save(persisted, restored, NOW + 8);
  same(declarationOf(pageOf(persisted, ordinary.id)), ORDINARY, "NEW ordinary history clears later fullpage declarations after SQLite reopen");
  preserved({ ...persisted, savedAt: original.savedAt }, original, [page.id, linked.id, ordinary.id]);
  assert.equal(persisted.pageVersions.length, 130);
  assert.equal(fs.readFileSync(SOURCE, "utf8"), originalBytes, "real Wiki JSON evidence is never rewritten");
  registration.counts = Object.fromEntries(Object.entries(persisted).filter(([, value]) => Array.isArray(value)).map(([collection, value]) => [collection, value.length]));
  registration.oldHistoriesPreserved = 122;
  registration.assetMetadataRowsPreserved = assets.length;
  registration.quickCheck = "ok";
  completed = true;
});
