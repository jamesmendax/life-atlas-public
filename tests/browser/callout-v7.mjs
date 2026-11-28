import { writeFileSync } from "node:fs";
import { browserScenario as runBrowserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { walkBlocks } from "../../src/domain/blockDocument.js";

const run = process.env.V7_CALLOUT_RUN || "local";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid V7_CALLOUT_RUN");
const base = `LOCAL-NOTION-001/v7-callout-${run}`;
const subreports = [];
const browserScenario = async (...args) => {
  const report = await runBrowserScenario(...args);
  subreports.push(report);
  return report;
};
const probePage = (value) => value.pages.find((item) => item.id === "editor-page");
const find = (value, id) => walkBlocks(probePage(value).content).find((item) => item.id === id);
const editorSelector = '.life-editor[data-page-id="editor-page"] .bn-editor';
const outer = (page, id) => page.locator(`${editorSelector} .bn-block-outer[data-id="${id}"]`).first();
const body = (page, id) => outer(page, id).locator(':scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer > .bn-block-content').first();
const makeWorkspace = (content, locked = false) => {
  const workspace = coreParityWorkspace();
  workspace.ui.selectedPageId = "editor-page";
  workspace.ui.preferences = { theme: "system" };
  const target = probePage(workspace);
  target.settings = { ...target.settings, locked };
  target.content = content;
  return workspace;
};
const callout = (id = "callout") => ({ id, type: "callout", props: { icon: "🌿", tone: "neutral" },
  content: [{ type: "text", text: "提示中文 ABC", styles: {} }],
  children: [{ id: `${id}-empty`, type: "paragraph", content: [], children: [] }] });
const snap = async (page) => {
  await page.locator(editorSelector).waitFor();
  return page.evaluate((selector) => {
  const editor = document.querySelector(selector).pmViewDesc.node.type.schema.cached.blockNoteEditor;
  return { document: editor.document, native: editor.prosemirrorState.doc.toJSON(), selection: editor.prosemirrorState.selection.toJSON(), editable: editor.isEditable };
  }, editorSelector);
};
const saveEvidence = (name, value) => writeFileSync(`.qa/${base}-${name}.json`, `${JSON.stringify(value, null, 2)}\n`);

await browserScenario(`${base}-creation`, async ({ page, check, screenshot, persisted, assert }) => {
  await check("slash callout creates an empty editable body", async () => {
    await body(page, "start").click();
    await page.keyboard.press("/");
    await page.keyboard.type("callout");
    const option = page.locator('[role="option"]:visible').filter({ hasText: "标注" }).first();
    await option.waitFor();
    await page.keyboard.press("Enter");
    await page.locator('.life-callout').waitFor();
    const state = await persisted((value) => walkBlocks(probePage(value).content).some((item) => item.type === "callout"));
    const created = walkBlocks(probePage(state).content).find((item) => item.type === "callout");
    saveEvidence("creation-observed", { created, native: await snap(page) });
    await screenshot("observed");
    assert.ok(created, "created callout was not persisted");
    assert.deepEqual(created.content, [], "new callout must not persist default body text");
  });
}, { workspace: makeWorkspace([{ id: "start", type: "paragraph", content: "" }]), viewport: { width: 1440, height: 900 } });

await browserScenario(`${base}-enter`, async ({ page, check, screenshot, saved, assert }) => {
  await check("End Enter and typing keep existing child under the callout", async () => {
    await body(page, "callout").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("内部段落 V7 子内容");
    await page.waitForTimeout(800);
    const state = await saved();
    const parent = find(state, "callout");
    saveEvidence("enter-observed", { page: probePage(state), native: await snap(page) });
    await screenshot("observed");
    assert.ok(parent.children.some((child) => JSON.stringify(child.content).includes("内部段落 V7 子内容")), "typed paragraph must be directly owned by callout");
    assert.ok(parent.children.some((child) => child.id === "callout-empty"), "existing empty child must remain directly owned");
  });
}, { workspace: makeWorkspace([callout(), { id: "tail", type: "paragraph", content: "后方正文" }]), viewport: { width: 1440, height: 900 } });

await browserScenario(`${base}-geometry`, async ({ page, check, screenshot, assert }) => {
  await check("owned child is enclosed by callout background in light and dark", async () => {
    await page.locator(".life-callout").waitFor();
    const results = [];
    for (const mode of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, mode);
      const measurement = await page.evaluate(() => {
        const host = document.querySelector('.bn-block-outer[data-id="callout"]');
        const face = host.querySelector(':scope > .bn-block');
        const child = host.querySelector('.bn-block-outer[data-id="child"]');
        const rect = (node) => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
        return { face: rect(face), child: rect(child), background: getComputedStyle(face).backgroundColor, host: host.outerHTML.slice(0, 8000) };
      });
      results.push({ mode, ...measurement });
      await screenshot(mode);
    }
    saveEvidence("geometry-observed", results);
    for (const { mode, face, child } of results) assert.ok(child.top >= face.top && child.bottom <= face.bottom && child.left >= face.left && child.right <= face.right, `${mode}: child outside painted callout: ${JSON.stringify({ face, child })}`);
  });
}, { workspace: makeWorkspace([{ ...callout(), children: [{ id: "child", type: "paragraph", content: "内部段落 V7 子内容", children: [{ id: "empty", type: "paragraph", content: "" }] }] }, { id: "tail", type: "paragraph", content: "后方正文" }]), viewport: { width: 1440, height: 900 } });

const observedId = "3fcdaf34-748d-4e58-9ba4-2e69441cb842";
const observedEmptyId = "faa19733-fdce-4be4-a701-111aabe6da28";
const richChild = { id: "existing-rich", type: "paragraph", content: [
  { type: "text", text: "粗体", styles: { bold: true } },
  { type: "link", href: "https://example.com/", content: [{ type: "text", text: "链接", styles: { italic: true } }] },
], children: [] };
const observedCallout = { ...callout(observedId), children: [
  { id: observedEmptyId, type: "paragraph", content: [], children: [] }, richChild,
] };

await browserScenario(`${base}-history`, async ({ page, check, persisted, saved, assert }) => {
  await check("existing children, marks and links survive Enter, native history and reload", async () => {
    const before = (await snap(page)).document;
    await body(page, observedId).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    let afterEnter = (await snap(page)).document;
    const created = afterEnter[0].children[0];
    assert.equal(created.type, "paragraph");
    assert.deepEqual(afterEnter[0].children.slice(1), before[0].children);
    assert.deepEqual(afterEnter[0].content, before[0].content);
    assert.deepEqual(afterEnter.slice(1), before.slice(1));
    await page.keyboard.insertText("内部段落 V7 子内容");
    await persisted((value) => find(value, observedId)?.children[0]?.content?.[0]?.text === "内部段落 V7 子内容");
    const afterType = (await snap(page)).document;
    await page.keyboard.press("Control+z");
    assert.deepEqual((await snap(page)).document, afterEnter, "native undo removes typed text only");
    await page.keyboard.press("Control+z");
    assert.deepEqual((await snap(page)).document, before, "native undo removes inserted child only");
    await page.keyboard.press("Control+Shift+z");
    assert.deepEqual((await snap(page)).document, afterEnter, "native redo restores child identity");
    await page.keyboard.press("Control+Shift+z");
    assert.deepEqual((await snap(page)).document, afterType, "native redo restores child text and identity");
    await persisted((value) => find(value, observedId)?.children[0]?.id === created.id && find(value, observedId)?.children[0]?.content?.[0]?.text === "内部段落 V7 子内容");
    const serialized = probePage(await saved()).content;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('.life-callout').waitFor();
    assert.deepEqual((await snap(page)).document, serialized, "serialized document survives reload");
    saveEvidence("history-observed", { before, afterEnter, afterType, serialized });
  });
}, { workspace: makeWorkspace([observedCallout, { id: "tail", type: "paragraph", content: "后方正文" }]) });

await browserScenario(`${base}-column`, async ({ page, check, screenshot, assert }) => {
  await check("column callout owns its new child and paints it in both modes", async () => {
    await body(page, observedId).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("栏内子段落");
    const tree = (await snap(page)).document;
    const block = tree[0].children[0].children[0];
    assert.equal(block.id, observedId);
    assert.equal(block.children[0].content[0].text, "栏内子段落");
    assert.equal(block.children[1].id, observedEmptyId);
    for (const mode of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, mode);
      const measure = await outer(page, observedId).evaluate((host) => {
        const paint = host.querySelector(':scope > .bn-block');
        const child = paint.querySelector(':scope > .bn-block-group > .bn-block-outer');
        const p = paint.getBoundingClientRect(), c = child.getBoundingClientRect();
        return { inside: c.left >= p.left && c.right <= p.right && c.top >= p.top && c.bottom <= p.bottom, color: getComputedStyle(paint).backgroundColor };
      });
      assert.ok(measure.inside, `${mode}: column child outside painted container`);
      assert.notEqual(measure.color, "rgba(0, 0, 0, 0)");
      await screenshot(mode);
    }
  });
}, { workspace: makeWorkspace([{ id: "columns", type: "columnList", props: { columns: 2 }, children: [
  { id: "col-one", type: "column", props: { width: 50, index: 0, count: 2 }, children: [observedCallout] },
  { id: "col-two", type: "column", props: { width: 50, index: 1, count: 2 }, children: [{ id: "column-tail", type: "paragraph", content: "other" }] },
] }]) });

await browserScenario(`${base}-conversion`, async ({ page, check, assert }) => {
  await check("real conversion command retains populated content, links and children", async () => {
    await page.locator(editorSelector).waitFor();
    const result = await page.evaluate(async (selector) => {
      const editor = document.querySelector(selector).pmViewDesc.node.type.schema.cached.blockNoteEditor;
      const { convertEditorBlocks } = await import('/src/editor/blockCommands.js');
      const before = editor.document;
      const result = convertEditorBlocks(editor, ['source'], 'callout');
      return { result, before, after: editor.document };
    }, editorSelector);
    assert.equal(result.result.ok, true);
    assert.equal(result.after[0].id, "source");
    assert.equal(result.after[0].type, "callout");
    assert.deepEqual(result.after[0].content, result.before[0].content);
    assert.deepEqual(result.after[0].children, result.before[0].children);
  });
}, { workspace: makeWorkspace([{ ...richChild, id: "source", children: [{ id: "conversion-child", type: "paragraph", content: "child" }] }]) });

await browserScenario(`${base}-lock`, async ({ page, check, assert }) => {
  await check("locked callout does not change on Enter and typing", async () => {
    const before = await snap(page);
    assert.equal(before.editable, false);
    await body(page, observedId).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("should not appear");
    assert.deepEqual((await snap(page)).document, before.document);
  });
}, { workspace: makeWorkspace([observedCallout], true) });

await browserScenario(`${base}-empty`, async ({ page, check, assert }) => {
  await check("Enter creates a child even when no child previously exists", async () => {
    await body(page, "bare").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("new child");
    const document = (await snap(page)).document;
    assert.equal(document[0].id, "bare");
    assert.equal(document[0].children.length, 1);
    assert.equal(document[0].children[0].content[0].text, "new child");
    assert.equal(document[1].id, "tail");
  });
}, { workspace: makeWorkspace([{ ...callout("bare"), content: [], children: [] }, { id: "tail", type: "paragraph", content: "after" }]) });

await browserScenario(`${base}-tone`, async ({ page, check, assert }) => {
  await check("colored callout paints the complete child container in light and dark", async () => {
    await page.locator('.life-callout').waitFor();
    for (const mode of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, mode);
      const colors = await outer(page, "blue").evaluate((host) => {
        const container = host.querySelector(':scope > .bn-block');
        const sample = document.createElement('span');
        sample.style.backgroundColor = 'var(--mb-u-blue-bg)';
        document.body.append(sample);
        const result = { actual: getComputedStyle(container).backgroundColor, expected: getComputedStyle(sample).backgroundColor };
        sample.remove();
        return result;
      });
      assert.equal(colors.actual, colors.expected, `${mode}: blue tone must cover container`);
    }
  });
}, { workspace: makeWorkspace([{ ...callout("blue"), props: { icon: "🌿", tone: "blue" } }]) });

for (const populated of [false, true]) {
  await browserScenario(`${base}-slash-${populated ? "populated" : "children"}`, async ({ page, check, assert }) => {
    await check("slash creation preserves existing content and child identity", async () => {
      await body(page, "source").click();
      await page.keyboard.press("End");
      await page.keyboard.press("/");
      await page.keyboard.type("callout");
      await page.locator('[role="option"]:visible').filter({ hasText: "标注" }).first().waitFor();
      await page.keyboard.press("Enter");
      await page.locator('.life-callout').waitFor();
      const document = (await snap(page)).document;
      if (populated) {
        assert.equal(document[0].id, "source");
        assert.equal(document[0].content[0].text, "existing");
        assert.equal(document[0].children[0].id, "kept-child");
        assert.equal(document[1].type, "callout");
        assert.deepEqual(document[1].content, []);
      } else {
        assert.equal(document[0].id, "source");
        assert.equal(document[0].type, "callout");
        assert.deepEqual(document[0].content, []);
        assert.equal(document[0].children[0].id, "kept-child");
        assert.equal(document[0].children[0].content[0].text, "preserve me");
      }
    });
  }, { workspace: makeWorkspace([{ id: "source", type: "paragraph", content: populated ? "existing" : "", children: [{ id: "kept-child", type: "paragraph", content: "preserve me" }] }]) });
}

for (const inColumn of [false, true]) {
  const indentCallout = { ...callout("indent-callout"), children: [
    { id: "indent-paragraph", type: "paragraph", content: "内部段落 V7 子内容", children: [] },
    { id: "indent-list", type: "bulletListItem", content: "列表", children: [
      { id: "indent-list-child", type: "bulletListItem", content: "嵌套列表", children: [] },
    ] },
    { id: "indent-quote", type: "quote", content: "引用", children: [] },
  ] };
  const content = inColumn ? [{ id: "indent-columns", type: "columnList", props: { columns: 2 }, children: [
    { id: "indent-column", type: "column", props: { width: 50, index: 0, count: 2 }, children: [indentCallout] },
    { id: "indent-column-other", type: "column", props: { width: 50, index: 1, count: 2 }, children: [{ id: "indent-other", type: "paragraph", content: "other" }] },
  ] }] : [indentCallout];
  await browserScenario(`${base}-indent-${inColumn ? "column" : "root"}`, async ({ page, check, screenshot, assert }) => {
    await check("direct callout paragraph aligns with body without a generic rail, retaining nested list and quote", async () => {
      await outer(page, "indent-paragraph").waitFor();
      const measurements = [];
      for (const mode of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme: mode });
        await page.waitForFunction((value) => document.documentElement.dataset.theme === value, mode);
        const measured = await outer(page, "indent-callout").evaluate((host) => {
          const group = host.querySelector(':scope > .bn-block > .bn-block-group');
          const child = group.querySelector(':scope > .bn-block-outer[data-id="indent-paragraph"]');
          const nested = group.querySelector('.bn-block-outer[data-id="indent-list-child"]');
          const quote = group.querySelector('.bn-block-outer[data-id="indent-quote"] blockquote');
          const rail = (node) => { const s = getComputedStyle(node, '::before'); return { content: s.content, display: s.display, borderLeftWidth: s.borderLeftWidth, borderLeftStyle: s.borderLeftStyle, backgroundColor: s.backgroundColor }; };
          return { bodyLeft: host.querySelector('.life-callout-content').getBoundingClientRect().left,
            childLeft: child.querySelector('.bn-inline-content').getBoundingClientRect().left,
            groupBorder: getComputedStyle(group).borderLeftWidth, rail: rail(child), nestedRail: rail(nested),
            quoteBorder: getComputedStyle(quote).borderLeftWidth, quoteStyle: getComputedStyle(quote).borderLeftStyle };
        });
        measurements.push({ mode, ...measured });
        await screenshot(mode);
      }
      saveEvidence(`indent-${inColumn ? "column" : "root"}-observed`, measurements);
      const problems = measurements.flatMap((m) => [
        ...(Math.abs(m.bodyLeft - m.childLeft) > 1 ? [`${m.mode}: child left ${m.childLeft} differs from body ${m.bodyLeft}`] : []),
        ...(!["none", "normal"].includes(m.rail.content) && m.rail.display !== "none" ? [`${m.mode}: direct rail ${JSON.stringify(m.rail)}`] : []),
        ...(parseFloat(m.groupBorder) > 0 ? [`${m.mode}: group border ${m.groupBorder}`] : []),
        ...(["none", "normal"].includes(m.nestedRail.content) || m.nestedRail.display === "none" ? [`${m.mode}: nested list rail missing`] : []),
        ...(parseFloat(m.quoteBorder) <= 0 || m.quoteStyle === "none" ? [`${m.mode}: quote border missing`] : []),
      ]);
      assert.deepEqual(problems, [], problems.join("; "));
    });
  }, { workspace: makeWorkspace(content), viewport: { width: 1440, height: 900 } });
}

const checks = subreports.flatMap((report) => report.checks.map((check) => ({ ...check, scenario: report.name })));
const errors = subreports.flatMap((report) => report.errors.map((error) => ({ ...error, scenario: report.name })));
const aggregate = {
  name: "callout-v7",
  passed: subreports.length === 13 && subreports.every((report) => report.passed && report.checks.length > 0 && report.checks.every((check) => check.passed) && report.errors.length === 0),
  checks,
  errors,
  storageKey: subreports[0]?.storageKey || null,
  sourceFingerprint: subreports[0]?.sourceFingerprint || null,
  subreports,
};
writeFileSync(process.env.V7_CALLOUT_AGGREGATE_PATH || ".qa/callout-v7.json", JSON.stringify(aggregate, null, 2));
if (!aggregate.passed) process.exitCode = 1;
console.log(`CALLOUT V7: ${subreports.length} scenarios / ${checks.length} checks, passed=${aggregate.passed}, errors=${errors.length}`);
