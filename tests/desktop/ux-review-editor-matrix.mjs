import assert from "node:assert/strict";
import { waitFor } from "../release/helpers.mjs";
import { mainTitle, openPage, root } from "./ux-review-editor-support.mjs";
import { createReviewTemplatePage, scanBlocks } from "./ux-review-editor-actions.mjs";

const sizes = { wide: [1380, 860], narrow: [1000, 720] };
const sourceSelector = '.life-synced-source[data-source-id="shared-source"]';
const paragraphSelector = '[data-content-type="paragraph"] .bn-inline-content';

// Observe actual trusted input targets without modifying focus, selection or editor state.
async function observeInput(page) {
  return page.evaluateHandle(() => {
    const events = [];
    const recent = [];
    const describe = (node) => {
      const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      const editor = el?.closest(".bn-editor");
      return el ? { tag: el.tagName, role: el.getAttribute("role"), label: el.getAttribute("aria-label"),
        blockType: el.closest("[data-content-type]")?.dataset.contentType, blockId: el.closest(".bn-block-outer")?.dataset.id,
        source: el.closest(".life-synced-source")?.dataset.sourceId, panel: el.closest('[role="tabpanel"]')?.id,
        editor: editor ? editor.closest(".life-synced-editor") ? "synced" : "page" : null } : null;
    };
    const observe = (event) => {
      if (!event.isTrusted) return;
      const selection = document.getSelection();
      const item = { type: event.type, key: event.key, ctrl: event.ctrlKey, target: describe(event.target),
        caret: describe(selection?.focusNode), offset: selection?.focusOffset,
        ...(event.type === "pointerdown" ? { x: event.clientX, y: event.clientY } : {}) };
      events.push(item);
      recent.push(item);
      if (recent.length > 14) recent.shift();
    };
    document.addEventListener("pointerdown", observe, true);
    document.addEventListener("keydown", observe, true);
    return { read: () => events.splice(0), diagnostics: () => ({ recent, active: describe(document.activeElement),
      caret: describe(document.getSelection()?.focusNode), offset: document.getSelection()?.focusOffset }), stop() {
      document.removeEventListener("pointerdown", observe, true);
      document.removeEventListener("keydown", observe, true);
    } };
  });
}

async function caretIn(text) {
  return text.evaluate((el) => {
    const editor = el.closest(".bn-editor");
    const selection = document.getSelection();
    return { focused: document.activeElement === editor, inside: el.contains(selection?.focusNode),
      owner: editor.closest(".life-synced-editor") ? "synced" : "page", node: selection?.focusNode?.nodeName,
      offset: selection?.focusOffset, id: el.closest(".bn-block-outer")?.dataset.id, text: el.innerText };
  });
}

async function clickAndNavigate(page, text, readEvents) {
  await readEvents();
  await text.click();
  await page.keyboard.press("Home");
  const before = await caretIn(text);
  await page.keyboard.press("ArrowRight");
  const after = await caretIn(text);
  const events = await readEvents();
  assert.ok(before.focused && before.inside && after.focused && after.inside, JSON.stringify({ before, after }));
  assert.equal(after.offset, before.offset + 1);
  assert.ok(events.some((e) => e.type === "pointerdown" && e.target.editor === after.owner));
  assert.ok(events.some((e) => e.key === "ArrowRight" && e.target.editor === after.owner && e.caret.blockId === after.id));
  return { before, after, events };
}

async function sourceState(page, expected) {
  return waitFor(async () => {
    const { canonical, mirrors } = await page.evaluate(async ({ sourceSelector, paragraphSelector }) => {
      const stored = (await window.lifeAtlas.workspace.load()).value.workspace.syncedSources.find((s) => s.id === "shared-source");
      const content = stored?.blocks[0]?.content;
      const text = typeof content === "string" ? content : content?.map((item) => item.text || "").join("");
      const mirrors = [...document.querySelectorAll(sourceSelector)].filter((el) => el.getBoundingClientRect().height > 0)
        .map((el) => ({ block: el.closest(".bn-block-outer")?.dataset.id, panel: el.closest('[role="tabpanel"]')?.id,
          text: el.querySelector(paragraphSelector)?.innerText }));
      return { canonical: { revision: stored?.revision, text }, mirrors };
    }, { sourceSelector, paragraphSelector });
    return canonical.text === expected && mirrors.length >= 2 && mirrors.every((copy) => copy.text === expected) && { canonical, mirrors };
  }, { timeoutMs: 6500, intervalMs: 100, message: "Visible synced copies and persisted canonical source did not settle on " + expected });
}

async function exercisePanel(page, readEvents, marker) {
  const group = root(page).getByRole("tablist", { name: "内容标签页" }).first();
  const plan = group.getByRole("tab", { name: /计划/u });
  const tasks = group.getByRole("tab", { name: /任务/u });
  const panelId = await tasks.getAttribute("aria-controls");
  const panel = page.locator('[role="tabpanel"][id="' + panelId + '"]');
  const nested = panel.locator(sourceSelector).locator(".life-synced-editor .bn-editor").first().locator(paragraphSelector).first();
  const initialTab = await group.getByRole("tab", { selected: true }).innerText();
  // Restore the initial tab before exercising the switch if an earlier incomplete run saved another active tab.
  if (await plan.getAttribute("aria-selected") !== "true") await plan.click();
  assert.equal(await panel.getAttribute("aria-hidden"), "true");
  assert.equal(await nested.isVisible(), false);
  await readEvents();
  await tasks.click();
  assert.equal(await tasks.getAttribute("aria-selected"), "true");
  await nested.waitFor();
  await page.waitForFunction((id) => document.activeElement?.id === id, await tasks.getAttribute("id"));
  const taskClick = await readEvents();
  assert.ok(taskClick.some((e) => e.type === "pointerdown" && e.target.role === "tab"));
  await page.keyboard.press("ArrowLeft");
  assert.equal(await plan.getAttribute("aria-selected"), "true");
  await page.waitForFunction((id) => document.activeElement?.id === id, await plan.getAttribute("id"));
  await page.keyboard.press("ArrowRight");
  assert.equal(await tasks.getAttribute("aria-selected"), "true");
  await page.waitForFunction((id) => document.activeElement?.id === id, await tasks.getAttribute("id"));
  const tabArrow = await readEvents();
  assert.ok(["ArrowLeft", "ArrowRight"].every((key) => tabArrow.some((e) => e.key === key && e.target.role === "tab")));
  const child = await clickAndNavigate(page, panel.locator('[data-content-type="checkListItem"] .bn-inline-content').first(), readEvents);
  assert.equal(child.after.owner, "page");
  assert.ok(child.events.some((e) => e.type === "pointerdown" && e.target.panel === panelId));
  const navigation = await clickAndNavigate(page, nested, readEvents);
  assert.equal(navigation.after.owner, "synced");
  assert.ok(navigation.events.some((e) => e.type === "pointerdown" && e.target.source === "shared-source" && e.target.panel === panelId));
  const original = navigation.before.text;
  const baseline = await sourceState(page, original);
  await page.keyboard.press("End");
  await page.keyboard.type(marker);
  const changed = await sourceState(page, original + marker);
  const typed = await readEvents();
  assert.ok(typed.some((e) => e.key === marker[0] && e.target.editor === "synced" && e.target.panel === panelId));
  await page.keyboard.press("Control+z");
  const restored = await sourceState(page, original);
  const undo = await readEvents();
  assert.ok(undo.some((e) => e.key === "z" && e.ctrl && e.target.editor === "synced" && e.target.panel === panelId));
  assert.ok(baseline.canonical.revision < changed.canonical.revision && changed.canonical.revision < restored.canonical.revision);
  return { panelId, initialTab, hiddenBeforeClick: true, taskClick, tabArrow, child, synced: { navigation, baseline, changed, restored, typed, undo } };
}

export async function runEditorMatrix({ page, check, finding, surface, shot, kind }) {
  const subject = kind === "ordinary" ? { id: "editor-page", title: mainTitle } : await createReviewTemplatePage(page, "编辑器矩阵模板");
  const trace = await observeInput(page);
  const readEvents = () => trace.evaluate((observer) => observer.read());
  const withInputEvidence = async (task) => {
    try { return await task(); }
    catch (error) {
      error.observed = await trace.evaluate((observer) => observer.diagnostics());
      throw error;
    }
  };
  let index = 0;
  try {
    for (const theme of ["light", "dark"]) for (const [size, dimensions] of Object.entries(sizes)) {
      const step = [kind, theme, size].join("-");
      index += 1;
      await check("matrix-" + step, () => withInputEvidence(async () => {
        await page.locator(".page-title-input").first().click();
        await openPage(page, "Alpha 项目");
        const window = await surface(theme, ...dimensions);
        await openPage(page, subject.title);
        assert.equal(await page.locator(".life-editor").first().getAttribute("data-page-id"), subject.id);
        assert.equal(window.theme, theme);
        assert.ok(size === "wide" ? window.width >= 1250 : window.width < 1100);
        assert.equal(window.native.width, Math.round(dimensions[0] * window.native.scale));
        assert.equal(window.native.height, Math.round(dimensions[1] * window.native.scale));
        await shot("matrix-" + step + "-open");
        const panel = await exercisePanel(page, readEvents, "M" + index);
        await shot("matrix-" + step + "-synced");
        const scan = await scanBlocks(page, step, { visibleFirst: true, readEvents });
        const targets = scan.rows.map((row) => {
          const supplemental = row.type === "syncedBlock" ? panel.synced.navigation : row.type === "tabPanel" ? panel.child : null;
          const events = supplemental?.events || row.events || [];
          return { type: row.type, route: supplemental ? row.type === "syncedBlock" ? "nested-synced-paragraph" : "active-panel-checklist" : "block-surface",
            pointer: events.find((e) => e.type === "pointerdown")?.target || null,
            arrow: events.find((e) => e.key === "ArrowRight") || null };
        });
        await root(page).getByRole("tablist", { name: "内容标签页" }).first().getByRole("tab", { name: /计划/u }).click();
        assert.equal(scan.types.length, 28);
        const incompleteTargets = targets.filter((item) => !item.pointer || !item.arrow).map((item) => item.type);
        if (incompleteTargets.length) finding("matrix-" + step + "-incomplete-targets", { incompleteTargets });
        return { subject, theme, size, window, panel, scan, targets, incompleteTargets };
      }));
    }
  } finally {
    await trace.evaluate((observer) => observer.stop());
    await trace.dispose();
  }
}
