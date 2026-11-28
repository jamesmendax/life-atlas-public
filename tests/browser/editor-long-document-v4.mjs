import { mkdirSync, writeFileSync } from "node:fs";
import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { waitForNativeCaretAtBlockEnd } from "../editor-caret.mjs";
import { blockContext, copyJson, stableJson, walkBlocks } from "../../src/domain/blockDocument.js";

const scenarioName = "editor-long-document-v4";
const evidenceDirectory = ".qa/LOCAL-NOTION-001";
const rootSelector = '.life-editor[data-page-id="editor-page"] .bn-editor';
const budgets = { inputP95Ms: 100, nativeCaretP95Ms: 100, scrollFrameP95Ms: 50, wheelResponseP95Ms: 100 };
const workspace = coreParityWorkspace();
workspace.ui.selectedPageId = "editor-page";
workspace.ui.preferences = { theme: "system" };
const fixturePage = workspace.pages.find((entry) => entry.id === "editor-page");
fixturePage.title = "本地工作手册 · 长文档交互";
fixturePage.icon = "";

const columns = (prefix) => ({
  id: prefix, type: "columnList", props: { columns: 3 }, children: [
    { id: `${prefix}-left`, type: "column", props: { width: 40, index: 0, count: 3 }, children: [
      { id: `${prefix}-left-heading`, type: "heading", props: { level: 3 }, content: "研究与资料" },
      { id: `${prefix}-left-rich`, type: "paragraph", content: [
        { type: "text", text: "保留研究结论", styles: { bold: true } },
        { type: "text", text: " 与 ", styles: {} },
        { type: "link", href: "lifeatlas://page/alpha-page", content: [{ type: "text", text: "本地项目链接", styles: { italic: true } }] },
      ], children: [{ id: `${prefix}-child`, type: "bulletListItem", content: "完整保留资料子项", children: [{ id: `${prefix}-grandchild`, type: "paragraph", content: "子项内的复核记录" }] }] },
      { id: `${prefix}-left-detail`, type: "paragraph", content: "比较方法、核对来源，再记录下一步。" },
      { id: `${prefix}-left-tail`, type: "paragraph", content: "研究栏保留的最后一段" },
    ] },
    { id: `${prefix}-middle`, type: "column", props: { width: 35, index: 1, count: 3 }, children: [
      { id: `${prefix}-middle-heading`, type: "heading", props: { level: 3 }, content: "本周行动" },
      { id: `${prefix}-middle-check`, type: "checkListItem", props: { checked: true }, content: "已核对本地记录" },
      { id: `${prefix}-middle-detail`, type: "paragraph", content: "逐项验证成果与实际交互。" },
      { id: `${prefix}-middle-target`, type: "paragraph", content: "在这一段之后接收完整资料子树" },
    ] },
    { id: `${prefix}-right`, type: "column", props: { width: 25, index: 2, count: 3 }, children: [
      { id: `${prefix}-right-heading`, type: "heading", props: { level: 3 }, content: "复盘" },
      { id: `${prefix}-right-check`, type: "checkListItem", props: { checked: false }, content: "等待复查" },
      { id: `${prefix}-right-detail`, type: "paragraph", content: "记录限制与未完成的判断。" },
      { id: `${prefix}-right-tail`, type: "paragraph", content: "复盘栏保留的最后一段" },
    ] },
  ],
});

fixturePage.content = [{ id: "ld-start", type: "paragraph", content: "长文档开头 · 编辑输入从这里开始。" }];
for (let section = 0; section < 20; section += 1) {
  const prefix = `ld-section-${section}`;
  fixturePage.content.push(
    { id: `${prefix}-heading`, type: "heading", props: { level: 2 }, content: `第 ${section + 1} 节 · 本地工作记录` },
    { id: `${prefix}-lead`, type: "paragraph", content: `第 ${section + 1} 节 · 实验、设计与本地工作记录。` },
    { id: `${prefix}-detail`, type: "paragraph", content: "先记录观察到的结果、所用材料与操作，再把下一步安排写清楚。保留证据来源，使之后的复核能够准确找到原来的内容。" },
    { id: `${prefix}-list`, type: "bulletListItem", content: "有层级的复核清单", children: [
      { id: `${prefix}-child-one`, type: "bulletListItem", content: "检查输入材料与原始事实" },
      { id: `${prefix}-child-two`, type: "bulletListItem", content: "记录后续行动", children: [{ id: `${prefix}-grandchild`, type: "paragraph", content: "说明判断的依据、限制与待验证之处。" }] },
    ] },
    { id: `${prefix}-check-one`, type: "checkListItem", props: { checked: section % 2 === 0 }, content: "整理本节的材料与记录" },
    { id: `${prefix}-check-two`, type: "checkListItem", props: { checked: false }, content: "复核下一次行动是否完成" },
    { id: `${prefix}-quote`, type: "quote", content: "结果需要与原始材料一起保存，便于后续继续工作。" },
    { id: `${prefix}-code`, type: "codeBlock", props: { language: "text" }, content: `section: ${section + 1}\nstate: awaiting-review\nsource: local-record` },
    { id: `${prefix}-sources`, type: "paragraph", content: "资料来源：本节的实验记录、设计说明和本地项目文档。" },
    { id: `${prefix}-decision`, type: "paragraph", content: "决策记录：先验证最重要的事实，再安排适合当前条件的行动。" },
    { id: `${prefix}-risks`, type: "paragraph", content: "待复核事项：区分真实结果与尚未验证的假设，避免把预计完成当成已经完成。" },
    { id: `${prefix}-closing`, type: "paragraph", content: "本节结束后保留正文、清单和代码片段，之后可以继续编辑或移动其中的资料。" },
  );
  if (section === 7) fixturePage.content.push(columns("ld-columns-mid"));
  if (section === 15) fixturePage.content.push(columns("ld-columns-late"));
}
fixturePage.content.push({ id: "ld-end", type: "paragraph", content: "长文档末尾 · 最后一条正文可继续编辑。" });
const fixtureExpected = JSON.parse(JSON.stringify(fixturePage.content));
const fixtureBlocks = walkBlocks(fixtureExpected);
const fixtureIds = fixtureBlocks.map((entry) => entry.id);

function installLoadObservation({ selector, expectedBlocks }) {
  const measurement = { installedAt: performance.now(), readyAt: null, afterFrameAt: null, blockCount: null };
  window.__editorLongDocumentV4Load = measurement;
  const inspect = () => {
    const root = document.querySelector(selector);
    if (!root || root.getAttribute("contenteditable") !== "true" || document.fonts.status !== "loaded" || root.querySelectorAll(".bn-block-outer[data-id]").length !== expectedBlocks) {
      requestAnimationFrame(inspect);
      return;
    }
    measurement.readyAt = performance.now();
    requestAnimationFrame(() => setTimeout(() => {
      measurement.afterFrameAt = performance.now();
      measurement.blockCount = root.querySelectorAll(".bn-block-outer[data-id]").length;
      const navigation = performance.getEntriesByType("navigation")[0];
      measurement.navigationToAfterFrameMs = measurement.afterFrameAt;
      measurement.domContentLoadedToAfterFrameMs = navigation?.domContentLoadedEventEnd ? measurement.afterFrameAt - navigation.domContentLoadedEventEnd : null;
    }, 0));
  };
  requestAnimationFrame(inspect);
}

function installInteractionObservation(selector) {
  const root = document.querySelector(selector);
  const scroller = root?.closest(".workspace-scroll");
  const editor = root?.pmViewDesc?.node.type.schema.cached.blockNoteEditor;
  if (!root || !scroller || !editor) throw new Error("The ordinary production editor and workspace scroller must be present");
  const listeners = [];
  const observers = [];
  const pendingFrames = new Set();
  const pendingTasks = new Set();
  let active = null;
  let frameHandle = null;
  const supported = PerformanceObserver.supportedEntryTypes || [];
  const addListener = (target, type, callback, options = true) => {
    target.addEventListener(type, callback, options);
    const capture = typeof options === "boolean" ? options : Boolean(options.capture);
    listeners.push(() => target.removeEventListener(type, callback, capture));
  };
  const append = (buffer, value) => {
    if (buffer.length >= 1024) { active.overflow = true; return; }
    buffer.push(value);
  };
  const afterFrame = (callback) => {
    const frame = requestAnimationFrame(() => {
      pendingFrames.delete(frame);
      const task = setTimeout(() => { pendingTasks.delete(task); callback(); }, 0);
      pendingTasks.add(task);
    });
    pendingFrames.add(frame);
  };
  const pairWheelScroll = (sample, scroll) => {
    if (!sample || !scroll || sample.requestIndex === null || scroll.requestIndex !== sample.requestIndex || scroll.requestMarkedAt !== sample.requestMarkedAt || !scroll.trusted || scroll.scrollTop === sample.beforeTop) return;
    if (sample.pairedScrollIndex !== undefined && sample.pairedScrollIndex !== scroll.index) return;
    if (!Number.isFinite(sample.startedAt) || !Number.isFinite(scroll.eventTimestamp) || sample.startedAt < sample.requestMarkedAt || sample.startedAt > sample.observedAt || scroll.eventTimestamp < sample.startedAt || scroll.observedAt < scroll.eventTimestamp) {
      sample.timingError = "Wheel and scroll timestamps must share a nonnegative request/event/observation order";
      return;
    }
    if (sample.firstScrollMs === null) {
      sample.pairedScrollIndex = scroll.index;
      scroll.pairedWheelIndex = sample.index;
      sample.firstScrollMs = scroll.observedAt - sample.startedAt;
      sample.firstScrollObservedAt = scroll.observedAt;
      sample.firstScrollEventTimestamp = scroll.eventTimestamp;
      sample.scrollObservedBeforeWheel = scroll.observedAt < sample.observedAt;
      sample.wheelCaptureToFirstScrollMs = scroll.observedAt >= sample.observedAt ? scroll.observedAt - sample.observedAt : null;
      sample.afterTop = scroll.scrollTop;
    }
    if (sample.afterFrameMs === null && Number.isFinite(scroll.afterFrameAt)) {
      if (scroll.afterFrameAt < scroll.observedAt || scroll.afterFrameAt < sample.startedAt) {
        sample.timingError = "A real after-frame callback must follow the wheel event and scroll observation";
        return;
      }
      sample.afterFrameAt = scroll.afterFrameAt;
      sample.afterFrameMs = scroll.afterFrameAt - sample.startedAt;
      sample.afterFrameObservedBeforeWheel = scroll.afterFrameAt < sample.observedAt;
      sample.wheelCaptureToAfterFrameMs = scroll.afterFrameAt >= sample.observedAt ? scroll.afterFrameAt - sample.observedAt : null;
    }
  };
  const nativeCaret = (sample) => {
    if (sample.nativeCaretMs !== null) return;
    const selection = editor.prosemirrorState.selection;
    const domSelection = window.getSelection();
    const focus = domSelection?.focusNode;
    const owner = (focus?.nodeType === Node.ELEMENT_NODE ? focus : focus?.parentElement)?.closest(".bn-block-outer[data-id]");
    if (selection.empty && selection.head === sample.headBefore + sample.data.length && domSelection?.isCollapsed && owner?.dataset.id === sample.blockId && editor.prosemirrorView.hasFocus()) {
      sample.nativeCaretMs = performance.now() - sample.startedAt;
      sample.headAfter = selection.head;
      sample.domCaretBlockId = owner.dataset.id;
    }
  };
  addListener(root, "beforeinput", (event) => {
    if (active?.kind !== "input" || event.inputType !== "insertText") return;
    const selection = editor.prosemirrorState.selection;
    const domSelection = window.getSelection();
    const focus = domSelection?.focusNode;
    const owner = (focus?.nodeType === Node.ELEMENT_NODE ? focus : focus?.parentElement)?.closest(".bn-block-outer[data-id]");
    append(active.inputs, { startedAt: performance.now(), eventTimestamp: event.timeStamp, beforeInputTrusted: event.isTrusted, data: event.data || "", blockId: owner?.dataset.id, headBefore: selection.head, nativeCaretMs: null, afterFrameMs: null, inputCaptureMicrotaskToAfterFrameMs: null });
  });
  addListener(root, "input", (event) => {
    if (active?.kind !== "input") return;
    const sample = active.inputs.findLast((entry) => entry.inputAt === undefined);
    if (!sample) { active.unpairedInputs += 1; return; }
    sample.inputAt = performance.now();
    sample.inputTrusted = event.isTrusted;
    queueMicrotask(() => {
      sample.inputCaptureMicrotaskAt = performance.now();
      nativeCaret(sample);
      afterFrame(() => {
        nativeCaret(sample);
        sample.afterFrameMs = performance.now() - sample.startedAt;
        sample.inputCaptureToAfterFrameMs = performance.now() - sample.inputAt;
        sample.inputCaptureMicrotaskToAfterFrameMs = performance.now() - sample.inputCaptureMicrotaskAt;
      });
    });
  });
  addListener(root, "keydown", (event) => {
    if (active?.kind === "input" && event.key.length === 1) append(active.keys, { key: event.key, trusted: event.isTrusted, startedAt: performance.now() });
  });
  addListener(scroller, "wheel", (event) => {
    if (active?.kind !== "scroll") return;
    const observedAt = performance.now();
    const request = active.pendingWheel;
    active.lastWheelAt = event.timeStamp;
    const sample = { index: active.wheels.length, requestIndex: request?.index ?? null, startedAt: event.timeStamp, eventTimestamp: event.timeStamp, observedAt, captureDelayMs: observedAt >= event.timeStamp ? observedAt - event.timeStamp : null, trusted: event.isTrusted, deltaY: event.deltaY, deltaX: event.deltaX, deltaMode: event.deltaMode, cancelable: event.cancelable, defaultPrevented: event.defaultPrevented, clientX: event.clientX, clientY: event.clientY, beforeTop: request?.initial.top ?? null, observedAtTop: scroller.scrollTop, requestMarkedAt: request?.markedAt ?? null, requestInitialTop: request?.initial.top ?? null, precedingFrameAt: active.previousFrameAt, precedingFrameTop: active.previousTop, precedingScrollAt: active.lastScrollAt, firstScrollMs: null, afterFrameMs: null };
    append(active.wheels, sample);
    const scroll = active.scrollEvents.find((entry) => entry.requestIndex === sample.requestIndex && entry.requestMarkedAt === sample.requestMarkedAt && entry.eventTimestamp >= sample.eventTimestamp && entry.scrollTop !== sample.beforeTop);
    pairWheelScroll(sample, scroll);
  }, { capture: true, passive: true });
  addListener(scroller, "scroll", (event) => {
    if (active?.kind !== "scroll") return;
    active.lastScrollAt = performance.now();
    const request = active.pendingWheel;
    const sample = active.wheels.find((entry) => entry.requestIndex === request?.index && entry.requestMarkedAt === request?.markedAt);
    const scroll = { index: active.scrollEvents.length, observedAt: active.lastScrollAt, eventTimestamp: event.timeStamp, trusted: event.isTrusted, scrollTop: scroller.scrollTop, requestIndex: request?.index ?? null, requestMarkedAt: request?.markedAt ?? null, requestInitialTop: request?.initial.top ?? null, wheelCount: active.wheels.length, candidateWheelIndex: sample?.index ?? null, candidateBeforeTop: sample?.beforeTop ?? null, candidateObservedAt: sample?.observedAt ?? null, differsFromCandidateTop: Boolean(sample) && scroller.scrollTop !== sample.beforeTop, differsFromRequestTop: Boolean(request) && scroller.scrollTop !== request.initial.top, precedingFrameAt: active.previousFrameAt, precedingFrameTop: active.previousTop, afterFrameAt: null };
    append(active.scrollEvents, scroll);
    if (!request || !scroll.differsFromRequestTop || scroll.eventTimestamp < request.markedAt) return;
    pairWheelScroll(sample, scroll);
    afterFrame(() => {
      scroll.afterFrameAt = performance.now();
      const deliveredWheel = active?.wheels.find((entry) => entry.requestIndex === scroll.requestIndex && entry.requestMarkedAt === scroll.requestMarkedAt);
      pairWheelScroll(deliveredWheel, scroll);
    });
  });
  addListener(root, "pointermove", (event) => {
    if (active?.kind !== "hover" || event.buttons) return;
    const owner = event.target instanceof Element ? event.target.closest(".bn-block-outer[data-id]") : null;
    if (!owner || owner.dataset.id === active.lastHoveredId) return;
    active.lastHoveredId = owner.dataset.id;
    const sample = { blockId: owner.dataset.id, startedAt: performance.now(), trusted: event.isTrusted, controlAfterFrameMs: null };
    append(active.hovers, sample);
    const inspect = () => afterFrame(() => {
      const toolbar = document.querySelector(`.life-block-actions[data-block-id="${CSS.escape(sample.blockId)}"]`);
      if (toolbar && toolbar.getBoundingClientRect().width > 0 && getComputedStyle(toolbar).visibility !== "hidden") sample.controlAfterFrameMs = performance.now() - sample.startedAt;
      else if (performance.now() - sample.startedAt < 1000) inspect();
    });
    inspect();
  });
  addListener(document, "dragstart", (event) => {
    if (active?.kind === "drag" && event.target instanceof Element && event.target.closest(".life-block-actions")) append(active.dragEvents, { type: event.type, trusted: event.isTrusted, at: performance.now() });
  });
  addListener(root, "dragover", (event) => {
    if (active?.kind !== "drag") return;
    active.lastDragOverAt = performance.now();
    const sample = { startedAt: active.lastDragOverAt, trusted: event.isTrusted, clientX: event.clientX, clientY: event.clientY, previewAfterFrameMs: null, previewKind: null };
    append(active.dragOvers, sample);
    afterFrame(() => {
      const preview = document.querySelector(".life-block-drop-preview");
      if (preview) { sample.previewAfterFrameMs = performance.now() - sample.startedAt; sample.previewKind = preview.dataset.dropKind; }
    });
  });
  addListener(document, "drop", (event) => {
    if (active?.kind === "drag" && root.contains(event.target)) append(active.dragEvents, { type: event.type, trusted: event.isTrusted, at: performance.now() });
  });
  const observe = (type, consume, options = {}) => {
    if (!supported.includes(type)) return;
    const observer = new PerformanceObserver((list) => consume(list.getEntries()));
    observer.observe({ type, buffered: false, ...options });
    observers.push({ observer, consume });
  };
  observe("longtask", (entries) => {
    if (!active) return;
    for (const entry of entries) if (entry.startTime >= active.startedAt) append(active.longTasks, { startedAt: entry.startTime, durationMs: entry.duration });
  });
  observe("event", (entries) => {
    if (active?.kind !== "input") return;
    for (const entry of entries) {
      if (entry.startTime < active.startedAt || !["keydown", "keyup", "beforeinput", "input"].includes(entry.name)) continue;
      append(active.eventTiming, { name: entry.name, startTime: entry.startTime, durationMs: entry.duration, processingStart: entry.processingStart, processingEnd: entry.processingEnd, processingDelayMs: entry.processingStart - entry.startTime, handlerMs: entry.processingEnd - entry.processingStart, handlerToNextPaintMs: entry.startTime + entry.duration - entry.processingEnd, interactionId: entry.interactionId });
    }
  }, { durationThreshold: 16 });
  const frame = (timestamp) => {
    if (!active) return;
    const top = scroller.scrollTop;
    const interactionAt = active.kind === "scroll" ? active.lastWheelAt : active.kind === "drag" ? active.lastDragOverAt : null;
    const windowIntersectsInterval = Number.isFinite(interactionAt) && active.previousFrameAt !== null && active.previousFrameAt <= interactionAt + 200 && timestamp >= interactionAt;
    const scrolled = active.kind === "scroll" && top !== active.previousTop;
    if (active.previousFrameAt !== null && (windowIntersectsInterval || active.previousFrameActive || scrolled)) append(active.frames, { from: active.previousFrameAt, at: timestamp, intervalMs: timestamp - active.previousFrameAt, scrollTop: top });
    active.previousFrameActive = scrolled || (Number.isFinite(interactionAt) && timestamp >= interactionAt && timestamp <= interactionAt + 200);
    active.previousFrameAt = timestamp;
    active.previousTop = top;
    frameHandle = requestAnimationFrame(frame);
  };
  window.__editorLongDocumentV4Probe = {
    supported: { eventTiming: supported.includes("event"), longTask: supported.includes("longtask") },
    start(label, kind) {
      if (active) throw new Error("An observation window is already active");
      active = { label, kind, startedAt: performance.now(), inputs: [], keys: [], wheels: [], scrollEvents: [], frames: [], hovers: [], dragEvents: [], dragOvers: [], longTasks: [], eventTiming: [], overflow: false, unpairedInputs: 0, pendingWheel: null, previousFrameAt: null, previousFrameActive: false, previousTop: scroller.scrollTop, lastWheelAt: -Infinity, lastDragOverAt: -Infinity, lastScrollAt: performance.now(), lastHoveredId: null };
      frameHandle = requestAnimationFrame(frame);
    },
    pending() { return pendingFrames.size + pendingTasks.size; },
    finish() {
      for (const { observer, consume } of observers) consume(observer.takeRecords());
      if (pendingFrames.size || pendingTasks.size) throw new Error("Observation must wait for every scheduled after-frame sample");
      cancelAnimationFrame(frameHandle);
      active.completedAt = performance.now();
      const result = JSON.parse(JSON.stringify(active));
      active = null;
      return result;
    },
    current() { return active; },
    dispose() {
      cancelAnimationFrame(frameHandle);
      for (const frame of pendingFrames) cancelAnimationFrame(frame);
      for (const task of pendingTasks) clearTimeout(task);
      for (const remove of listeners) remove();
      for (const { observer } of observers) observer.disconnect();
      delete window.__editorLongDocumentV4Probe;
    },
  };
}

const textOf = (block) => typeof block?.content === "string" ? block.content : (block?.content || []).map((entry) => entry.type === "link" ? entry.content.map((part) => part.text || "").join("") : entry.text || "").join("");
const summarize = (values) => {
  const ordered = [...values].filter(Number.isFinite).sort((first, second) => first - second);
  if (!ordered.length) return { count: 0, p50: null, p95: null, max: null };
  return { count: ordered.length, p50: ordered[Math.ceil(ordered.length * 0.5) - 1], p95: ordered[Math.ceil(ordered.length * 0.95) - 1], max: ordered.at(-1) };
};

await browserScenario(scenarioName, async ({ page, context, check, saved, persisted, assert }) => {
  mkdirSync(evidenceDirectory, { recursive: true });
  const observations = { status: "running", scenario: scenarioName, fixture: { blocks: fixtureIds.length, sections: 20, threeColumnGroups: 2 }, budgets, measurements: {} };
  const publish = () => writeFileSync(`${evidenceDirectory}/${scenarioName}-metrics.json`, JSON.stringify(observations, null, 2));
  const record = (label, value) => { observations.measurements[label] = value; publish(); };
  const editorRoot = page.locator(rootSelector).first();
  const outer = (blockId) => editorRoot.locator(`.bn-block-outer[data-id="${blockId}"]`).first();
  const content = (blockId) => outer(blockId).locator(':scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer > .bn-block-content').first();
  const documentBlocks = (value) => value.pages.find((entry) => entry.id === "editor-page").content;
  const block = (blocks, blockId) => blockContext(blocks, blockId)?.block;
  const nativeSnapshot = () => page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const editor = root.pmViewDesc.node.type.schema.cached.blockNoteEditor;
    const state = editor.prosemirrorState;
    const history = state.plugins.find((plugin) => plugin.key.startsWith("history$"))?.getState(state);
    if (!history?.done || !history?.undone) throw new Error("The native history must be observable");
    return { document: JSON.parse(JSON.stringify(editor.document)), native: state.doc.toJSON(), selection: state.selection.toJSON(), history: { undo: history.done.eventCount, redo: history.undone.eventCount } };
  }, rootSelector);
  const waitForDocument = (expected) => persisted((value, json) => stableJson(documentBlocks(value)) === json, stableJson(expected));
  const startObservation = (label, kind) => page.evaluate(({ label, kind }) => window.__editorLongDocumentV4Probe.start(label, kind), { label, kind });
  const finishObservation = async () => {
    await page.waitForFunction(() => window.__editorLongDocumentV4Probe.pending() === 0);
    const result = await page.evaluate(() => window.__editorLongDocumentV4Probe.finish());
    assert.equal(result.overflow, false, "The bounded measurement buffers must not overflow");
    return result;
  };
  const scrollGeometry = () => page.locator(".workspace-scroll").evaluate((element) => ({ top: element.scrollTop, height: element.clientHeight, extent: element.scrollHeight, maximum: element.scrollHeight - element.clientHeight }));
  const geometry = (blockIds) => page.evaluate(({ selector, blockIds }) => {
    const root = document.querySelector(selector);
    const scroller = root.closest(".workspace-scroll");
    const rows = {};
    for (const blockId of blockIds) {
      const outer = root.querySelector(`.bn-block-outer[data-id="${blockId}"]`);
      const content = outer.querySelector(':scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer > .bn-block-content');
      rows[blockId] = [outer, content].map((element) => { const bounds = element.getBoundingClientRect(); return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }; });
    }
    return { rows, scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight };
  }, { selector: rootSelector, blockIds });
  const viewportShot = async (label, animations = "disabled") => {
    const file = `${evidenceDirectory}/${scenarioName}-${label}.png`;
    await page.screenshot({ path: file, fullPage: false, animations });
    return file;
  };
  publish();
  try {
    await check("a real long document loads all original blocks and exposes page-side readiness observations", async () => {
      assert.equal(fixtureIds.length, 338);
      await context.addInitScript(installLoadObservation, { selector: rootSelector, expectedBlocks: fixtureIds.length });
      await page.reload({ waitUntil: "domcontentloaded" });
      await content("ld-start").waitFor();
      await page.waitForFunction(() => Number.isFinite(window.__editorLongDocumentV4Load?.afterFrameAt));
      const snapshot = await nativeSnapshot();
      assert.deepEqual(walkBlocks(snapshot.document).map((entry) => entry.id), fixtureIds);
      assert.deepEqual(snapshot.document.map((entry) => entry.id), fixtureExpected.map((entry) => entry.id));
      for (const original of fixtureBlocks) {
        const rendered = block(snapshot.document, original.id);
        assert.equal(rendered.type, original.type, original.id);
        assert.equal(textOf(rendered), textOf(original), original.id);
        for (const [property, expected] of Object.entries(original.props || {})) assert.deepEqual(rendered.props?.[property], expected, `${original.id} explicit prop ${property}`);
        if (original.content !== undefined) {
          const expectedContent = typeof original.content === "string" ? original.content ? [{ type: "text", text: original.content, styles: {} }] : [] : copyJson(original.content);
          assert.deepEqual(rendered.content, expectedContent, `${original.id} original inline content, styles and links`);
        }
        assert.deepEqual((rendered.children || []).map((entry) => entry.id), (original.children || []).map((entry) => entry.id), `${original.id} direct children`);
        assert.equal(blockContext(snapshot.document, original.id).parent?.id ?? null, blockContext(fixtureExpected, original.id).parent?.id ?? null, `${original.id} original parent`);
      }
      const scroller = await scrollGeometry();
      assert.ok(scroller.maximum > scroller.height * 10, "The fixture must extend across more than ten viewport heights");
      record("load", { ...await page.evaluate(() => window.__editorLongDocumentV4Load), scroller, screenshot: await viewportShot("loaded") });
      await page.evaluate(installInteractionObservation, rootSelector);
      const supported = await page.evaluate(() => window.__editorLongDocumentV4Probe.supported);
      assert.deepEqual(supported, { eventTiming: true, longTask: true }, "The benchmark requires actual Event Timing and Long Task support");
      record("observerSupport", supported);
    });

    await check("trusted typing at the start middle and end advances the native caret and shares one undo redo per burst", async () => {
      const samples = [];
      const nativeTimings = [];
      for (const [position, blockId] of [["start", "ld-start"], ["middle", "ld-section-10-lead"], ["end", "ld-end"]]) {
        await content(blockId).click();
        await page.keyboard.press("End");
        await waitForNativeCaretAtBlockEnd(page, rootSelector, blockId);
        const before = await nativeSnapshot();
        const suffix = ` local-${position}-v4-012345`;
        const expectedText = `${textOf(block(before.document, blockId))}${suffix}`;
        await startObservation(`typing-${position}`, "input");
        await page.keyboard.type(suffix, { delay: 60 });
        const observed = await finishObservation();
        const after = await nativeSnapshot();
        const summary = { beforeInputToAfterFrameMs: summarize(observed.inputs.map((entry) => entry.afterFrameMs)), nativeCaretMs: summarize(observed.inputs.map((entry) => entry.nativeCaretMs)) };
        record(`typing-${position}`, { observed, summary });
        assert.equal(observed.inputs.length, suffix.length);
        assert.equal(observed.keys.length, suffix.length);
        assert.equal(observed.unpairedInputs, 0);
        assert.ok(observed.keys.every((entry) => entry.trusted));
        assert.ok(observed.inputs.every((entry) => entry.beforeInputTrusted && entry.inputTrusted && entry.blockId === blockId && Number.isFinite(entry.nativeCaretMs) && Number.isFinite(entry.afterFrameMs)));
        assert.ok(summary.beforeInputToAfterFrameMs.p95 <= budgets.inputP95Ms, `${position} trusted input p95: ${summary.beforeInputToAfterFrameMs.p95} ms`);
        assert.ok(summary.nativeCaretMs.p95 <= budgets.nativeCaretP95Ms, `${position} native caret p95: ${summary.nativeCaretMs.p95} ms`);
        assert.equal(after.selection.anchor, before.selection.anchor + suffix.length);
        assert.equal(after.selection.head, after.selection.anchor);
        assert.equal(textOf(block(after.document, blockId)), expectedText);
        assert.deepEqual(block(after.document, blockId).content, [{ type: "text", text: expectedText, styles: {} }]);
        const expected = copyJson(before.document);
        block(expected, blockId).content = copyJson(block(after.document, blockId).content);
        assert.deepEqual(after.document, expected, "Typing must change only the targeted inline content");
        assert.equal(after.history.undo, before.history.undo + 1);
        await waitForDocument(after.document);
        await page.keyboard.press("Control+z");
        await waitForDocument(before.document);
        assert.deepEqual((await nativeSnapshot()).native, before.native);
        await page.keyboard.press("Control+Shift+z");
        await waitForDocument(after.document);
        assert.deepEqual((await nativeSnapshot()).native, after.native);
        const caret = await page.evaluate((selector) => {
          const root = document.querySelector(selector);
          const editor = root.pmViewDesc.node.type.schema.cached.blockNoteEditor;
          const bounds = editor.prosemirrorView.coordsAtPos(editor.prosemirrorState.selection.head);
          const viewport = root.closest(".workspace-scroll").getBoundingClientRect();
          return { focused: editor.prosemirrorView.hasFocus(), top: bounds.top, bottom: bounds.bottom, viewportTop: viewport.top, viewportBottom: viewport.bottom };
        }, rootSelector);
        assert.equal(caret.focused, true);
        assert.ok(caret.top >= caret.viewportTop && caret.bottom <= caret.viewportBottom, "The real native caret must remain visible");
        record(`caret-${position}`, { ...caret, screenshot: await viewportShot(`typing-${position}`) });
        samples.push(...observed.inputs);
        nativeTimings.push(...observed.eventTiming);
      }
      const summary = { beforeInputToAfterFrameMs: summarize(samples.map((entry) => entry.afterFrameMs)), inputCaptureToAfterFrameMs: summarize(samples.map((entry) => entry.inputCaptureToAfterFrameMs)), inputCaptureMicrotaskToAfterFrameMs: summarize(samples.map((entry) => entry.inputCaptureMicrotaskToAfterFrameMs)), nativeCaretMs: summarize(samples.map((entry) => entry.nativeCaretMs)), browserEventTiming: { eventToNextPaintMs: summarize(nativeTimings.map((entry) => entry.durationMs)), handlerMs: summarize(nativeTimings.map((entry) => entry.handlerMs)), handlerToNextPaintMs: summarize(nativeTimings.map((entry) => entry.handlerToNextPaintMs)) } };
      record("typingSummary", summary);
      assert.ok(summary.beforeInputToAfterFrameMs.p95 <= budgets.inputP95Ms, `Trusted input p95: ${summary.beforeInputToAfterFrameMs.p95} ms`);
      assert.ok(summary.nativeCaretMs.p95 <= budgets.nativeCaretP95Ms, `Native caret p95: ${summary.nativeCaretMs.p95} ms`);
    });

    await check("trusted wheel scrolling reaches both ends of the long page with observed response and active frame jitter", async () => {
      const bounds = await page.locator(".workspace-scroll").boundingBox();
      assert.ok(bounds);
      await page.mouse.move(bounds.x + bounds.width - 24, bounds.y + bounds.height / 2);
      await page.mouse.wheel(0, -(await scrollGeometry()).maximum);
      await page.waitForFunction(() => document.querySelector(".workspace-scroll").scrollTop <= 1);
      const before = await nativeSnapshot();
      const original = await scrollGeometry();
      const step = Math.ceil(original.maximum / 14);
      await startObservation("scroll", "scroll");
      const wheel = async (deltaY) => {
        const initial = await scrollGeometry();
        const count = await page.evaluate(({ deltaY, initial }) => {
          const observation = window.__editorLongDocumentV4Probe.current();
          observation.pendingWheel = { index: observation.wheels.length, markedAt: performance.now(), deltaY, initial };
          return observation.wheels.length;
        }, { deltaY, initial });
        await page.mouse.wheel(0, deltaY);
        await page.waitForFunction(({ count, initialTop, down }) => {
          const observation = window.__editorLongDocumentV4Probe.current();
          const sample = observation.wheels[count];
          const top = document.querySelector(".workspace-scroll").scrollTop;
          return sample?.afterFrameMs !== null && sample?.afterFrameMs !== undefined && performance.now() - observation.lastScrollAt >= 50 && (down ? top > initialTop : top < initialTop);
        }, { count, initialTop: initial.top, down: deltaY > 0 });
      };
      for (let stepIndex = 0; stepIndex < 12; stepIndex += 1) await wheel(step);
      await wheel(original.maximum);
      await page.waitForFunction(() => { const scroller = document.querySelector(".workspace-scroll"); return Math.abs(scroller.scrollTop - scroller.scrollHeight + scroller.clientHeight) <= 1; });
      assert.ok(Math.abs((await scrollGeometry()).top - original.maximum) <= 1, "A trusted wheel must reach the actual final scroll position");
      for (let stepIndex = 0; stepIndex < 12; stepIndex += 1) await wheel(-step);
      await wheel(-original.maximum);
      await page.waitForFunction(() => document.querySelector(".workspace-scroll").scrollTop <= 1);
      assert.ok((await scrollGeometry()).top <= 1, "A trusted wheel must return to the top");
      const observed = await finishObservation();
      const intervals = observed.frames.map((entry) => entry.intervalMs);
      const summary = { activeFrameIntervalMs: summarize(intervals), wheelToFirstScrollMs: summarize(observed.wheels.map((entry) => entry.firstScrollMs)), wheelEventToCaptureMs: summarize(observed.wheels.map((entry) => entry.captureDelayMs)), wheelCaptureToFirstScrollMs: summarize(observed.wheels.map((entry) => entry.wheelCaptureToFirstScrollMs)), wheelToAfterFrameMs: summarize(observed.wheels.map((entry) => entry.afterFrameMs)), framesOver50Ms: intervals.filter((value) => value > 50).length, longTasks: observed.longTasks, longTaskDurationMs: summarize(observed.longTasks.map((entry) => entry.durationMs)) };
      record("scroll", { observed, summary, before: original, after: await scrollGeometry(), screenshot: await viewportShot("scrolled-top") });
      assert.equal(observed.wheels.length, 26);
      assert.ok(observed.wheels.every((entry) => entry.trusted && Number.isFinite(entry.firstScrollMs) && Number.isFinite(entry.afterFrameMs)));
      assert.ok(observed.wheels.every((entry) => !entry.timingError && entry.firstScrollMs >= 0 && entry.afterFrameMs >= entry.firstScrollMs && Number.isFinite(entry.captureDelayMs) && entry.captureDelayMs >= 0), "Every wheel must retain actual nonnegative event/scroll/frame timings");
      assert.ok(intervals.length >= 30, "Active wheel scrolling must produce enough actual frame samples");
      assert.ok(summary.activeFrameIntervalMs.p95 <= budgets.scrollFrameP95Ms, `Active scroll frame p95: ${summary.activeFrameIntervalMs.p95} ms`);
      assert.ok(summary.wheelToFirstScrollMs.p95 <= budgets.wheelResponseP95Ms, `Wheel response p95: ${summary.wheelToFirstScrollMs.p95} ms`);
      assert.deepEqual((await nativeSnapshot()).native, before.native, "Scrolling must not mutate the native document");
      await waitForDocument(before.document);
    });

    await check("hovering populated long-page columns exposes real controls and conversion without any geometry jump", async () => {
      const ids = ["ld-columns-mid", "ld-columns-mid-left", "ld-columns-mid-middle", "ld-columns-mid-right", "ld-columns-mid-left-rich", "ld-columns-mid-middle-target"];
      await outer("ld-columns-mid").scrollIntoViewIfNeeded();
      await content("ld-columns-mid-left-rich").click();
      const before = await nativeSnapshot();
      const original = await geometry(ids);
      const bounds = await page.locator(".workspace-scroll").boundingBox();
      await page.mouse.move(bounds.x + bounds.width - 24, bounds.y + bounds.height / 2);
      await startObservation("hover", "hover");
      for (const blockId of ["ld-columns-mid-left-rich", "ld-columns-mid-middle-target", "ld-columns-mid-right-detail", "ld-columns-mid-left-rich"]) {
        await content(blockId).hover();
        const toolbar = page.locator(`.life-block-actions[data-block-id="${blockId}"]`);
        await toolbar.getByRole("button", { name: "添加区块", exact: true }).waitFor();
        const menuButton = toolbar.getByRole("button", { name: "区块菜单", exact: true });
        assert.equal(await menuButton.isDisabled(), false);
        assert.equal(await menuButton.getAttribute("draggable"), "true");
        const hit = await menuButton.evaluate((element) => { const bounds = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)); });
        assert.equal(hit, true, "The visible handle must be reachable at its real coordinates");
        await page.waitForFunction((expected) => Number.isFinite(window.__editorLongDocumentV4Probe.current().hovers.findLast((entry) => entry.blockId === expected)?.controlAfterFrameMs), blockId);
        assert.deepEqual(await geometry(ids), original);
      }
      const observed = await finishObservation();
      record("hover", { observed, original });
      assert.ok(observed.hovers.length >= 3);
      assert.ok(observed.hovers.every((entry) => entry.trusted && Number.isFinite(entry.controlAfterFrameMs)));
      await page.locator('.life-block-actions[data-block-id="ld-columns-mid-left-rich"]').getByRole("button", { name: "区块菜单", exact: true }).click();
      await page.getByRole("menuitem", { name: "转换为", exact: true }).hover();
      const conversion = page.locator(".life-block-conversion-menu");
      assert.equal(await conversion.getByRole("menuitem", { name: "标题 2", exact: true }).isDisabled(), false);
      assert.equal(await conversion.getByRole("menuitem", { name: "代码", exact: true }).isDisabled(), true);
      assert.deepEqual(await geometry(ids), original);
      assert.deepEqual((await nativeSnapshot()).native, before.native);
      record("hoverMenu", { screenshot: await viewportShot("long-page-conversion-menu"), geometry: await geometry(ids) });
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.locator(".life-block-menu").waitFor({ state: "hidden" });
      assert.deepEqual(await geometry(ids), original);
    });

    await check("trusted dragging on the long page moves one original rich subtree and restores exact native documents with undo redo", async () => {
      const sourceId = "ld-columns-mid-left-rich";
      const targetId = "ld-columns-mid-middle-target";
      await content(sourceId).hover();
      const before = await nativeSnapshot();
      const original = copyJson(block(before.document, sourceId));
      const expected = copyJson(before.document);
      const sourceColumn = block(expected, "ld-columns-mid-left");
      sourceColumn.children = sourceColumn.children.filter((entry) => entry.id !== sourceId);
      block(expected, "ld-columns-mid-middle").children.push(copyJson(original));
      const handle = page.locator(`.life-block-actions[data-block-id="${sourceId}"]`).getByRole("button", { name: "区块菜单", exact: true });
      const sourceBounds = await handle.boundingBox();
      const targetBounds = await content(targetId).boundingBox();
      assert.ok(sourceBounds && targetBounds);
      const geometryBefore = await scrollGeometry();
      await startObservation("drag-preview", "drag");
      await page.mouse.move(sourceBounds.x + sourceBounds.width / 2, sourceBounds.y + sourceBounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(targetBounds.x + targetBounds.width / 2, targetBounds.y + targetBounds.height - 2, { steps: 12 });
      await page.mouse.move(targetBounds.x + targetBounds.width / 2 + 1, targetBounds.y + targetBounds.height - 2);
      const preview = page.locator('.life-block-drop-preview[data-drop-kind="content"]');
      await preview.waitFor();
      const previewBounds = await preview.boundingBox();
      assert.ok(previewBounds);
      assert.ok(Math.abs(previewBounds.x - targetBounds.x) <= 1);
      assert.ok(Math.abs(previewBounds.y - targetBounds.y - targetBounds.height) <= 1);
      assert.ok(Math.abs(previewBounds.width - targetBounds.width) <= 1);
      assert.deepEqual((await nativeSnapshot()).native, before.native);
      assert.equal((await scrollGeometry()).top, geometryBefore.top, "A visible cross-column drag must not jump the long page");
      const previewObservation = await finishObservation();
      record("dragPreview", { sourceBounds, targetBounds, previewBounds, screenshot: await viewportShot("long-page-drag-preview", "allow") });
      await startObservation("drag-drop", "drag");
      await page.mouse.up();
      const dropObservation = await finishObservation();
      const observed = { windows: { preview: previewObservation, drop: dropObservation }, dragEvents: [...previewObservation.dragEvents, ...dropObservation.dragEvents], dragOvers: [...previewObservation.dragOvers, ...dropObservation.dragOvers], frames: [...previewObservation.frames, ...dropObservation.frames], longTasks: [...previewObservation.longTasks, ...dropObservation.longTasks] };
      record("drag", { observed, previewAfterFrameMs: summarize(observed.dragOvers.map((entry) => entry.previewAfterFrameMs)), activeFrameIntervalMs: summarize(observed.frames.map((entry) => entry.intervalMs)), longTaskDurationMs: summarize(observed.longTasks.map((entry) => entry.durationMs)) });
      assert.ok(observed.dragEvents.some((entry) => entry.type === "dragstart" && entry.trusted));
      assert.ok(observed.dragEvents.some((entry) => entry.type === "drop" && entry.trusted));
      assert.ok(observed.dragOvers.length > 0 && observed.dragOvers.every((entry) => entry.trusted));
      assert.ok(observed.dragOvers.some((entry) => entry.previewKind === "content" && Number.isFinite(entry.previewAfterFrameMs)));
      await waitForDocument(expected);
      const after = await nativeSnapshot();
      assert.deepEqual(after.document, expected);
      assert.deepEqual(block(after.document, sourceId), original);
      assert.equal(after.history.undo, before.history.undo + 1);
      assert.deepEqual(walkBlocks(after.document).map((entry) => entry.id).sort(), [...fixtureIds].sort());
      assert.equal(await editorRoot.locator(`.bn-block-outer[data-id="${sourceId}"]`).count(), 1);
      assert.equal(await page.locator(".life-block-drop-preview").count(), 0);
      await content(targetId).click();
      await page.keyboard.press("Control+z");
      await waitForDocument(before.document);
      assert.deepEqual((await nativeSnapshot()).native, before.native);
      await page.keyboard.press("Control+Shift+z");
      await waitForDocument(after.document);
      assert.deepEqual((await nativeSnapshot()).native, after.native);
      record("dragCommitted", { blocks: walkBlocks(after.document).length, nativeHistory: after.history, screenshot: await viewportShot("long-page-drag-committed") });
    });

    await check("the complete typed and moved long document survives ordinary reload without duplicated identities", async () => {
      const before = await nativeSnapshot();
      await waitForDocument(before.document);
      assert.deepEqual(documentBlocks(await saved()), before.document);
      await page.evaluate(() => window.__editorLongDocumentV4Probe.dispose());
      await page.reload({ waitUntil: "domcontentloaded" });
      await content("ld-start").waitFor();
      await page.waitForFunction(() => Number.isFinite(window.__editorLongDocumentV4Load?.afterFrameAt));
      const after = await nativeSnapshot();
      assert.deepEqual(after.document, before.document);
      assert.deepEqual(after.native, before.native);
      assert.deepEqual(documentBlocks(await saved()), before.document);
      const ids = walkBlocks(after.document).map((entry) => entry.id);
      assert.equal(ids.length, fixtureIds.length);
      assert.equal(new Set(ids).size, ids.length);
      assert.deepEqual(await editorRoot.locator(".bn-block-outer[data-id]").evaluateAll((elements) => elements.map((element) => element.dataset.id)), ids);
      record("reload", { ...await page.evaluate(() => window.__editorLongDocumentV4Load), blocks: ids.length, screenshot: await viewportShot("reloaded") });
    });
    observations.status = "checks-completed";
  } catch (error) {
    observations.status = "failed";
    observations.failure = error.stack;
    publish();
    try {
      observations.failureDiagnostics = await page.evaluate((selector) => {
        const probe = window.__editorLongDocumentV4Probe;
        const root = document.querySelector(selector);
        const scroller = root?.closest(".workspace-scroll") || document.querySelector(".workspace-scroll");
        const bounds = scroller?.getBoundingClientRect();
        const point = bounds ? { x: bounds.right - 24, y: bounds.top + bounds.height / 2 } : null;
        const hit = point ? document.elementFromPoint(point.x, point.y) : null;
        const style = scroller ? getComputedStyle(scroller) : null;
        return {
          kind: "editor-long-document-v4-failure-diagnostic",
          capturedAt: performance.now(),
          activeProbe: probe?.current() ? JSON.parse(JSON.stringify(probe.current())) : null,
          pendingCallbacks: probe?.pending() ?? null,
          scroller: scroller ? { connected: scroller.isConnected, top: scroller.scrollTop, left: scroller.scrollLeft, height: scroller.clientHeight, width: scroller.clientWidth, extent: scroller.scrollHeight, maximum: scroller.scrollHeight - scroller.clientHeight, overflowY: style.overflowY, scrollBehavior: style.scrollBehavior, bounds: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height } } : null,
          wheelPoint: point,
          wheelHit: hit ? { tagName: hit.tagName, className: String(hit.className).slice(0, 200), insideScroller: Boolean(scroller?.contains(hit)) } : null,
        };
      }, rootSelector);
    } catch (diagnosticError) {
      observations.failureDiagnostics = { captureError: diagnosticError.message };
    }
    throw error;
  } finally {
    publish();
    await page.evaluate(() => window.__editorLongDocumentV4Probe?.dispose());
  }
}, { workspace, viewport: { width: 1440, height: 900 } });
