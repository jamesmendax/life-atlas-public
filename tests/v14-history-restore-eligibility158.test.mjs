import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { isDeepStrictEqual } from "node:util";
import { transformSync } from "esbuild";
import * as history from "../src/domain/pageHistory.js";
import * as documents from "../src/domain/blockDocument.js";

const SOURCE = new URL("../.qa/LOCAL-NOTION-001/v14-wiki-real133/context136/native-selection141-final-closed35.json", import.meta.url);
const NOW = Date.parse("2026-11-14T01:00:00.000Z");
const DECLARATIONS = ["pageType", "databaseSourceId", "databaseViewId"];
const ORDINARY = { pageType: null, databaseSourceId: null, databaseViewId: null };
const same = (actual, expected, label) => assert.ok(isDeepStrictEqual(actual, expected), label);
const declarations = (page) => Object.fromEntries(DECLARATIONS.filter((field) => Object.hasOwn(page, field)).map((field) => [field, page[field]]));

function realWiki() {
  const workspace = JSON.parse(readFileSync(SOURCE, "utf8")).workspace;
  same([workspace.pages.length, workspace.databaseItems.length, workspace.dataSources.length, workspace.databaseViews.length, workspace.attachments.length, workspace.pageVersions.length],
    [85, 58, 11, 31, 20, 122], "use the complete real Wiki without pruning entities or histories");
  assert.ok(workspace.pageVersions.every((version) => DECLARATIONS.every((field) => !Object.hasOwn(version, field))));
  return workspace;
}

function ordinaryOccurrence(workspace) {
  const page = workspace.pages.find((entry) => entry.title === "随笔" && entry.pageType === null);
  const block = documents.walkBlocks(page.content).find((entry) => entry.type === "databaseView");
  assert.ok(page && block);
  return { page, declaration: { pageType: "database", databaseSourceId: block.props.sourceId, databaseViewId: block.props.viewId } };
}

const componentCode = transformSync(readFileSync(new URL("../src/components/PageHistoryDialog.jsx", import.meta.url), "utf8"), {
  loader: "jsx", format: "cjs", jsx: "automatic", target: "es2022",
}).code;

// Execute the public dialog and its button handler in memory. The editor/portal
// shells are not mounted; domain capture/restore and comparison remain real.
function renderDialog(workspace, page, { confirm = true } = {}) {
  const state = { workspace, confirmations: [], closed: 0, restored: [] };
  const jsx = (type, props) => ({ type, props });
  const react = {
    lazy: () => "PageEditor", Suspense: "Suspense",
    useId: () => "history158-preview", useMemo: (operation) => operation(), useRef: (current) => ({ current }),
    useState: (initial) => [initial, () => {}],
  };
  const module = { exports: {} };
  runInNewContext(componentCode, {
    module, exports: module.exports, window: { lifeAtlas: { platform: "desktop" } },
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
      if (name === "../domain/pageHistory.js") return history;
      if (name === "../domain/blockDocument.js") return documents;
      if (name === "../ui/Dialog.jsx") return { Dialog: "Dialog" };
      if (name === "./AppearanceGlyph.jsx") return { AppearanceGlyph: "AppearanceGlyph" };
      if (name === "../ui/DialogProvider.jsx") return { useDialogs: () => ({ confirm: async (options) => { state.confirmations.push(options); return confirm; } }) };
      throw new Error(`Unexpected dialog dependency: ${name}`);
    },
  }, { filename: "PageHistoryDialog.jsx" });
  const tree = module.exports.PageHistoryDialog({ workspace, page, onClose: () => { state.closed += 1; }, onRestored: (message) => state.restored.push(message),
    runtime: { platform: "desktop", restorePageVersion: async (pageId, versionId) => {
      state.workspace = history.restorePageVersion(state.workspace, { pageId, versionId, now: NOW + 1000, preRestoreId: "ver-history158-pre-restore" });
    } },
  });
  const nodes = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    nodes.push(node); walk(node.props?.children);
  };
  walk(tree);
  const restore = nodes.find((node) => node.type === "button" && node.props.children === "恢复此版本");
  assert.ok(restore, "public Restore button found");
  const textOf = (node) => Array.isArray(node) ? node.map(textOf).join("") : node && typeof node === "object" ? textOf(node.props?.children) : node == null || typeof node === "boolean" ? "" : String(node);
  return { state, restore, differenceText: textOf(nodes.find((node) => node.props?.className === "hist-diff")) };
}

function preserved(workspace, original, pageId) {
  for (const [collection, entities] of Object.entries(original)) {
    if (!Array.isArray(entities)) continue;
    if (collection === "pages") {
      assert.equal(workspace.pages.length, entities.length);
      same(workspace.pages.filter((page) => page.id !== pageId), entities.filter((page) => page.id !== pageId), "all other pages preserved");
    } else if (collection === "pageVersions") same(workspace.pageVersions.slice(0, 122), entities, "all 122 old histories retained unchanged");
    else same(workspace[collection], entities, `${collection} preserved`);
  }
  same(workspace.ui, original.ui, "UI preserved");
}

test("public history dialog enables and restores a body-identical ordinary version over a fullpage declaration in the complete 85-page Wiki", async () => {
  const original = realWiki();
  const before = structuredClone(original);
  const { page, declaration } = ordinaryOccurrence(original);
  const version = history.createPageVersion(page, { id: "ver-history158-ordinary", now: NOW, reason: "idle" });
  const current = { ...page, ...declaration };
  const workspace = { ...original, pages: original.pages.map((entry) => entry.id === page.id ? current : entry), pageVersions: [...original.pageVersions, version] };
  same(history.compareBlocks(version.content, current.content), { added: 0, removed: 0, changed: 0 }, "real body is identical");
  const dialog = renderDialog(workspace, current);
  assert.equal(Boolean(dialog.restore.props.disabled), false, "declaration-only restore must be enabled despite identical blocks");
  assert.match(dialog.differenceText, /页面变化：.*页面类型.*关联数据源.*数据库视图/, "preview identifies the declaration changes");
  await dialog.restore.props.onClick();
  const restored = dialog.state.workspace.pages.find((entry) => entry.id === page.id);
  same(declarations(restored), ORDINARY, "Restore clears all explicit fullpage declarations");
  same(restored.content, page.content, "restoring declaration preserves the real body");
  assert.equal(dialog.state.confirmations.length, 1);
  assert.equal(dialog.state.closed, 1);
  assert.equal(dialog.state.restored.length, 1);
  assert.equal(dialog.state.workspace.pageVersions.length, 124);
  same(declarations(dialog.state.workspace.pageVersions.at(-1)), declaration, "mandatory pre-restore captures the current fullpage declaration");
  preserved(dialog.state.workspace, original, page.id);
  same(original, before, "public dialog and domain helpers leave the source snapshot unchanged");
});

test("body-identical fullpage, title, icon, cover, settings and reference versions are eligible and restore every versioned field", async () => {
  const original = realWiki();
  const before = structuredClone(original);
  const page = original.pages.find((entry) => entry.id === original.ui.selectedPageId);
  const alternateSource = original.dataSources.find((source) => source.id !== page.databaseSourceId);
  const alternateView = original.databaseViews.find((view) => view.sourceId === page.databaseSourceId && view.id !== page.databaseViewId);
  const cover = original.pages.find((entry) => entry.cover && entry.cover.kind === "gallery").cover;
  const cases = [
    ["title", `${page.title} · 历史158`, "标题"],
    ["icon", "📜", "图标"],
    ["iconColor", "#345678", "图标颜色"],
    ["cover", cover, "封面"],
    ["settings", { ...page.settings, fontFamily: page.settings.fontFamily === "mono" ? "default" : "mono" }, "页面设置"],
    ["pageType", null, "页面类型"],
    ["databaseSourceId", alternateSource.id, "关联数据源"],
    ["databaseViewId", alternateView.id, "数据库视图"],
  ];
  for (const [field, value, label] of cases) {
    const version = history.createPageVersion({ ...page, [field]: value }, { id: `ver-history158-${field}`, now: NOW, reason: "idle" });
    const input = { ...original, pageVersions: [...original.pageVersions, version] };
    same(history.compareBlocks(version.content, page.content), { added: 0, removed: 0, changed: 0 }, `${field} does not change the real body`);
    const comparison = history.comparePageVersion(page, version);
    assert.equal(comparison.identical, false, `${field} is restorable`);
    same(comparison.changedFields, [field], `${field} is the only changed versioned field`);
    const dialog = renderDialog(input, page);
    assert.equal(Boolean(dialog.restore.props.disabled), false, `${field} enables the public Restore button`);
    assert.ok(dialog.differenceText.includes(label), `${field} is explained in the preview`);
    await dialog.restore.props.onClick();
    same(dialog.state.workspace.pages.find((entry) => entry.id === page.id)[field], value, `${field} restored through the public button`);
    preserved(dialog.state.workspace, original, page.id);
  }
  const ordinary = { ...page, ...ORDINARY };
  const full = history.createPageVersion(page, { id: "ver-history158-full", now: NOW, reason: "idle" });
  const input = { ...original, pages: original.pages.map((entry) => entry.id === page.id ? ordinary : entry), pageVersions: [...original.pageVersions, full] };
  const dialog = renderDialog(input, ordinary);
  assert.equal(Boolean(dialog.restore.props.disabled), false, "ordinary nulls can restore the fullpage values without a body edit");
  await dialog.restore.props.onClick();
  same(declarations(dialog.state.workspace.pages.find((entry) => entry.id === page.id)), declarations(page), "all fullpage declaration values restored");
  same(original, before, "all field restore probes keep the complete source unchanged");
});

test("new versions of all 85 real pages compare identical despite history and page metadata differences", () => {
  const workspace = realWiki();
  const before = structuredClone(workspace);
  for (const page of workspace.pages) {
    const version = history.createPageVersion(page, { id: `ver-history158-${page.id}`, now: NOW, reason: "interval" });
    Object.assign(version, { id: `other-${version.id}`, createdAt: new Date(NOW - 1000).toISOString(), reason: "pre-restore", sizeBytes: version.sizeBytes + 100, blockCount: version.blockCount + 1 });
    const current = { ...page, updatedAt: new Date(NOW + 1).toISOString(), contentRevision: (page.contentRevision || 0) + 1,
      importRevision: (page.importRevision || 0) + 1, summary: "派生摘要158", summaryUpdatedAt: new Date(NOW + 2).toISOString() };
    const comparison = history.comparePageVersion(current, version);
    assert.equal(comparison.identical, true, "timestamps/IDs/reasons/counts/derived revisions never enable a no-op restore");
    same(comparison.changedFields, [], "all logical versioned fields remain the same");
  }
  const page = workspace.pages.find((entry) => entry.id === workspace.ui.selectedPageId);
  const latest = workspace.pageVersions.findLast((version) => version.pageId === page.id);
  const dialog = renderDialog(workspace, page);
  assert.equal(Boolean(dialog.restore.props.disabled), true, "actual identical legacy latest version stays disabled");
  assert.equal(history.comparePageVersion(page, latest).identical, true, "legacy missing declarations are not null differences");
  same(workspace, before, "signature/comparison never backfills old versions");
});

test("all 122 actual legacy versions compare and restore the recorded fields while preserving current declarations exactly", () => {
  const workspace = realWiki();
  const before = structuredClone(workspace);
  const recordedFields = ["title", "icon", "iconColor", "cover", "settings", "content"];
  for (const version of workspace.pageVersions) {
    const page = workspace.pages.find((entry) => entry.id === version.pageId);
    const comparison = history.comparePageVersion(page, version);
    const expected = recordedFields.filter((field) => !isDeepStrictEqual(page[field], version[field]));
    same(comparison.changedFields, expected, "legacy eligibility depends only on its actual recorded page fields");
    assert.equal(comparison.identical, expected.length === 0);
    const effective = history.pageRestoreSnapshotOf(page, version);
    same(declarations(effective), declarations(page), "effective restore preserves exact current declaration ownership and values");
    const restored = history.restorePageVersion(workspace, { pageId: page.id, versionId: version.id, now: NOW, preRestoreId: `pre-history158-${version.id}` });
    const result = restored.pages.find((entry) => entry.id === page.id);
    same(declarations(result), declarations(page), "actual domain restore matches the effective declaration projection");
    recordedFields.forEach((field) => same(result[field], version[field], `${field} restored from actual legacy version`));
    same(restored.pageVersions.slice(0, 122), workspace.pageVersions, "all old histories remain exact");
  }
  same(workspace, before, "all legacy probes preserve the full real source");
});

test("legacy absent/partial declarations preserve current ownership while explicit nulls enable clearing the current values", () => {
  const original = realWiki();
  const page = original.pages.find((entry) => entry.id === original.ui.selectedPageId);
  const legacy = original.pageVersions.findLast((version) => version.pageId === page.id);
  for (const declaration of [{}, ORDINARY, declarations(page)]) {
    const current = { ...page };
    DECLARATIONS.forEach((field) => delete current[field]);
    Object.assign(current, declaration);
    same(declarations(history.pageRestoreSnapshotOf(current, legacy)), declaration, "legacy absence preserves current presence/value exactly");
    assert.equal(history.comparePageVersion(current, legacy).identical, true, "legacy absence causes no false declaration difference");
  }
  for (let mask = 1; mask < 8; mask += 1) {
    const version = { ...legacy, id: `legacy-history158-mask-${mask}` };
    const expected = declarations(page);
    const changedFields = [];
    DECLARATIONS.forEach((field, index) => {
      if (mask & (1 << index)) { version[field] = null; expected[field] = null; changedFields.push(field); }
    });
    same(declarations(history.pageRestoreSnapshotOf(page, version)), expected, "only explicit nulls replace current values");
    same(history.comparePageVersion(page, version).changedFields, changedFields, "only provided legacy fields count as changes");
  }
});

test("body ordering changes remain restorable when compareBlocks reports zero added removed or changed blocks", () => {
  const workspace = realWiki();
  const page = workspace.pages.find((entry) => !entry.databaseSourceId && entry.content.length >= 2);
  assert.ok(page, "use a real multi-block ordinary page for the ordering case");
  const content = [...page.content];
  [content[0], content[1]] = [content[1], content[0]];
  const version = history.createPageVersion({ ...page, content }, { id: "ver-history158-order", now: NOW, reason: "idle" });
  same(history.compareBlocks(version.content, page.content), { added: 0, removed: 0, changed: 0 }, "same original blocks only moved");
  same(history.comparePageVersion(page, version).changedFields, ["content"], "the full document order is versioned");
  const dialog = renderDialog({ ...workspace, pageVersions: [...workspace.pageVersions, version] }, page);
  assert.equal(Boolean(dialog.restore.props.disabled), false, "body order enables Restore");
  assert.match(dialog.differenceText, /正文/);
});

test("locked pages and declined confirmation keep the public restore guard and every real entity intact", async () => {
  const original = realWiki();
  const { page, declaration } = ordinaryOccurrence(original);
  const version = history.createPageVersion(page, { id: "ver-history158-guard", now: NOW, reason: "idle" });
  const current = { ...page, ...declaration };
  const input = { ...original, pages: original.pages.map((entry) => entry.id === page.id ? current : entry), pageVersions: [...original.pageVersions, version] };
  const cancelled = renderDialog(input, current, { confirm: false });
  assert.equal(Boolean(cancelled.restore.props.disabled), false);
  await cancelled.restore.props.onClick();
  assert.equal(cancelled.state.workspace, input, "cancel makes no workspace edit");
  assert.equal(cancelled.state.closed, 0);
  const locked = { ...current, settings: { ...current.settings, locked: true } };
  const dialog = renderDialog(input, locked);
  assert.equal(Boolean(dialog.restore.props.disabled), true);
  await dialog.restore.props.onClick();
  assert.equal(dialog.state.confirmations.length, 0, "locked guard prevents restore even if called directly");
  assert.equal(dialog.state.workspace, input);
});
