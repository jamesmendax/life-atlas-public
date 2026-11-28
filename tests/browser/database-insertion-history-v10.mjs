import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { walkBlocks } from "../../src/domain/blockDocument.js";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";

const run = process.env.V10_INSERTION_RUN || "run01";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid run label");
const evidence = `.qa/LOCAL-NOTION-001/v10-insertion-history/${run}`;
mkdirSync(evidence, { recursive: true });
const workspace = coreParityWorkspace();
const parent = workspace.pages.find((page) => page.id === "editor-page");
parent.content = [{ id: "v10-inline-start", type: "paragraph", content: "" }, { id: "v10-inline-tail", type: "paragraph", content: "inline tail" }];
workspace.pages.push({ ...structuredClone(parent), id: "v10-subpage-parent", title: "V10 subpage parent", content: [{ id: "v10-subpage-start", type: "paragraph", content: "" }, { id: "v10-subpage-tail", type: "paragraph", content: "subpage tail" }] });
workspace.ui.selectedPageId = parent.id;
workspace.ui.preferences = { theme: "system", style: "mobai" };

await browserScenario("database-insertion-history-v10", async ({ page, check, screenshot, saved, persisted, assert }) => {
  if (process.env.V10_TRACE === "1") page.on("console", (message) => {
    if (message.text().startsWith("[DEBUG-v10]")) appendFileSync(`${evidence}/trace.log`, `${message.text()}\n`);
  });
  if (process.env.V10_TRACE === "1") {
    await page.addInitScript(() => {
      let current, serial = 0;
      Object.defineProperty(window, "ProseMirror", { configurable: true, get: () => current, set: (editor) => {
        current = editor;
        const instance = ++serial;
        editor.__v10DebugInstance = instance;
        (window.__v10Editors ||= []).push(editor);
        console.log("[DEBUG-v10]" + JSON.stringify({ event: "editor-created", instance }));
        editor.on("transaction", ({ transaction, appendedTransactions = [] }) => {
          for (const tr of [transaction, ...appendedTransactions]) {
            if (!tr.docChanged) continue;
            const history = editor.state.plugins.find((p) => p.key.startsWith("history$"))?.getState(editor.state);
            console.log("[DEBUG-v10]" + JSON.stringify({ instance, before: tr.before.toString(), after: tr.doc.toString(), steps: tr.steps.map((step) => step.toJSON()), addToHistory: tr.getMeta("addToHistory"), history: history ? { done: history.done.eventCount, undone: history.undone.eventCount } : null }));
          }
        });
      } });
    });
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  const problems = [];
  const ids = (entries) => entries.map((entry) => entry.id);
  const added = (before, after, key) => after[key].filter((entry) => !before[key].some((old) => old.id === entry.id));
  const blocks = (state, pageId) => walkBlocks(state.pages.find((entry) => entry.id === pageId).content);
  const snap = async (kind, stage, parentId, startId) => {
    await page.locator(".save-state.is-saved").waitFor();
    await page.waitForFunction(({ key, parentId, startId }) => {
      const state = JSON.parse(localStorage.getItem(key));
      const block = state?.pages?.find((p) => p.id === parentId)?.content?.find((b) => b.id === startId);
      const dom = document.querySelector(`[data-id="${startId}"] [data-content-type]`);
      return block && dom && dom.getAttribute("data-content-type") === block.type && document.querySelector(".save-state.is-saved");
    }, { key: workspaceStorageKey, parentId, startId });
    const state = await saved();
    writeFileSync(`${evidence}/${kind}-${stage}.json`, JSON.stringify({ capturedAt: new Date().toISOString(), workspace: state }, null, 2));
    await screenshot(`${run}-${kind}-${stage}`);
    return state;
  };
  const expect = (condition, message, data = {}) => { if (!condition) problems.push({ message, ...data }); };
  const historyAction = async (label) => {
    const trigger = page.getByRole("button", { name: "页面操作", exact: true });
    const menu = page.getByRole("menu", { name: "页面操作", exact: true });
    if (!(await menu.isVisible())) await trigger.click();
    const action = menu.getByRole("menuitem", { name: label, exact: true });
    const enabled = await action.isEnabled();
    if (enabled) await action.click();
    if (await menu.isVisible()) await trigger.click();
    return enabled;
  };

  async function probe({ kind, parentId, startId, menuLabel, blockType }) {
    const snapshot = (stage) => snap(kind, stage, parentId, startId);
    const historyActions = [];
    const action = async (label) => {
      const enabled = await historyAction(label);
      historyActions.push({ label, enabled });
      return enabled;
    };
    await page.locator(`[data-id="${startId}"] .bn-block-content`).first().waitFor();
    const before = await snapshot("before");
    await page.locator(`[data-id="${startId}"] .bn-block-content`).first().click();
    await page.keyboard.type("/");
    const options = page.locator('[role="option"]:visible');
    await options.first().waitFor();
    await options.filter({ hasText: menuLabel }).first().click();
    const inserted = await persisted((w) => walkBlocks(w.pages.find((p) => p.id === parentId).content).some((b) => b.type === blockType));
    const insert = await snapshot("insert");
    if (process.env.V10_TRACE === "1") await page.evaluate(({ parentId }) => {
      const editor = window.__v10Editors.find((e) => !e.isDestroyed && e.view?.dom?.closest(`.life-editor[data-page-id="${parentId}"]`));
      const history = editor.state.plugins.find((p) => p.key.startsWith("history$"))?.getState(editor.state);
      const items = [];
      history?.done.items.forEach((item) => items.push({ step: item.step?.toJSON(), applyFailureOnCurrentDoc: item.step?.apply(editor.state.doc).failed, map: item.map?.toString(), selection: Boolean(item.selection) }));
      console.log("[DEBUG-v10]" + JSON.stringify({ event: "history-before-undo", parentId, instance: editor.__v10DebugInstance, items }));
    }, { parentId });
    const found = blocks(insert, parentId).filter((b) => b.type === blockType);
    const block = found[0];
    const newPages = added(before, insert, "pages");
    const newSources = added(before, insert, "dataSources");
    const newViews = added(before, insert, "databaseViews");
    const newItems = added(before, insert, "databaseItems");
    expect(found.length === 1, `${kind}: exactly one inserted reference block`, { found: found.length });
    if (kind === "inline") {
      expect(newPages.length === 0 && newSources.length === 1 && newViews.length === 1 && newItems.length === 0, "inline: creation counts", { newPages: ids(newPages), newSources: ids(newSources), newViews: ids(newViews), newItems: ids(newItems) });
      expect(newSources[0]?.ownerPageId === parentId && block?.props?.sourceId === newSources[0]?.id && block?.props?.viewId === newViews[0]?.id && newViews[0]?.sourceId === newSources[0]?.id, "inline: source owner and references match");
    } else {
      expect(newPages.length === 1 && newSources.length === 0 && newViews.length === 0 && newItems.length === 0, "subpage: creation counts", { newPages: ids(newPages), newSources: ids(newSources), newViews: ids(newViews), newItems: ids(newItems) });
      expect(newPages[0]?.parentPageId === parentId && block?.props?.pageId === newPages[0]?.id, "subpage: parent and reference match");
    }
    const undoEnabled = await action("撤回");
    const undo = await snapshot("undo");
    expect(undoEnabled, `${kind}: Undo available after insertion`);
    expect(!blocks(undo, parentId).some((b) => b.id === block?.id && b.type === blockType), `${kind}: Undo removes inserted reference block`, { referenceBlockId: block?.id });
    let currentUndo = undo;
    let undoCount = 1;
    while (undoCount < 4 && blocks(currentUndo, parentId).some((b) => b.id === block?.id && b.type === blockType)) {
      const enabled = await action("撤回");
      if (!enabled) break;
      undoCount += 1;
      currentUndo = await snapshot(`undo${undoCount}`);
    }
    const removed = !blocks(currentUndo, parentId).some((b) => b.id === block?.id && b.type === blockType);
    expect(removed, `${kind}: reference removed within four Undo actions`, { referenceBlockId: block?.id, undoCount });
    let redo = currentUndo;
    let redoCount = 0;
    for (let index = 1; index <= undoCount; index += 1) {
      const enabled = await action("重做");
      if (!enabled) break;
      redoCount += 1;
      redo = await snapshot(index === 1 ? "redo" : `redo${index}`);
    }
    if (redoCount === 0) redo = await snapshot("redo");
    expect(redoCount > 0, `${kind}: Redo available after Undo`);
    const redoBlock = blocks(redo, parentId).find((b) => b.id === block?.id && b.type === blockType);
    if (removed && redoCount > 0) {
      expect(Boolean(redoBlock), `${kind}: Redo restores same block ID`, { referenceBlockId: block?.id, redoBlocks: blocks(redo, parentId).map((b) => ({ id: b.id, type: b.type, props: b.props })) });
      expect(JSON.stringify(redoBlock?.props) === JSON.stringify(block?.props), `${kind}: Redo restores same reference IDs`, { insertedProps: block?.props, redoProps: redoBlock?.props });
    }
    for (const key of ["pages", "dataSources", "databaseViews", "databaseItems"]) {
      const insertIds = ids(insert[key]).sort();
      const redoIds = ids(redo[key]).sort();
      expect(JSON.stringify(insertIds) === JSON.stringify(redoIds), `${kind}: Redo creates no duplicate or replacement ${key}`, { inserted: insertIds, redo: redoIds });
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".bn-editor").first().waitFor();
    const reload = await snapshot("reload");
    const reloadBlock = blocks(reload, parentId).find((b) => b.id === block?.id && b.type === blockType);
    expect(Boolean(reloadBlock) && JSON.stringify(reloadBlock?.props) === JSON.stringify(block?.props), `${kind}: reload retains restored reference`, { referenceBlockId: block?.id, reloadProps: reloadBlock?.props });
    for (const key of ["pages", "dataSources", "databaseViews", "databaseItems"]) expect(JSON.stringify(ids(reload[key]).sort()) === JSON.stringify(ids(redo[key]).sort()), `${kind}: reload preserves ${key} identities`);
    return { insertedBlock: block, newPages: ids(newPages), newSources: ids(newSources), newViews: ids(newViews), newItems: ids(newItems), historyActions, undoEnabled, undoReferencePresent: blocks(undo, parentId).some((b) => b.id === block?.id && b.type === blockType), undoPages: ids(undo.pages), undoSources: ids(undo.dataSources), undoViews: ids(undo.databaseViews), undoItems: ids(undo.databaseItems), undoCount, redoCount, referenceRemovedAfterUndo: removed, finalUndoPages: ids(currentUndo.pages), finalUndoSources: ids(currentUndo.dataSources), finalUndoViews: ids(currentUndo.databaseViews), finalUndoItems: ids(currentUndo.databaseItems), redoReferencePresent: Boolean(redoBlock), redoRestorationVerified: removed && redoCount > 0 && Boolean(redoBlock) && JSON.stringify(redoBlock.props) === JSON.stringify(block.props), reloadReferencePresent: Boolean(reloadBlock), persistedAtInsert: Boolean(inserted) };
  }

  let inline, subpage;
  await check("Measure inline slash insertion, Undo, Redo and reload", async () => {
    inline = await probe({ kind: "inline", parentId: "editor-page", startId: "v10-inline-start", menuLabel: "数据库 - 行内", blockType: "databaseView" });
  });
  await check("Measure subpage slash insertion, Undo, Redo and reload", async () => {
    await page.getByRole("complementary", { name: "主导航" }).locator('[data-node-id="v10-subpage-parent"]').click();
    subpage = await probe({ kind: "subpage", parentId: "v10-subpage-parent", startId: "v10-subpage-start", menuLabel: "在此页面中嵌入子页面", blockType: "pageLink" });
  });
  writeFileSync(`${evidence}/observations.json`, JSON.stringify({ inline, subpage, problems, note: "Retained entities after Undo are observed neutrally; no deletion contract is assumed." }, null, 2));
  await check("Identity, reference and redo expectations", async () => {
    assert.deepEqual(problems, [], `Observed insertion/history failures: ${JSON.stringify(problems)}`);
  });
}, { workspace });
