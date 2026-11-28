import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { browserScenario } from "./harness.mjs";
const actual = JSON.parse(readFileSync(".qa/LOCAL-NOTION-001/v9-formal-database-ui01/evidence/native208-formal30-v14-real-wiki-resume.json", "utf8")).workspace;
const source = actual.dataSources.find(entry => entry.title === "随笔");
const owner = actual.pages.find(entry => entry.id === source.ownerPageId);
const gallery = actual.databaseViews.find(entry => entry.sourceId === source.id && entry.type === "gallery" && entry.name === "已发布");
if (!owner || !gallery) throw new Error("The real Wiki baseline must include the accepted119 published gallery");
const run = process.env.WIKI_SELECTION141_RUN || `run-${Date.now()}`;
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid run name");
const directory = `.qa/LOCAL-NOTION-001/v14-wiki-real133/selection141/${run}`;
if (existsSync(directory)) throw new Error("Preserve previous runs");
mkdirSync(directory, { recursive: true });
const workspace = structuredClone(actual);
// Approved138 test membership for this occurrence only, not source-layout fidelity.
const occurrence = workspace.pages.find(entry => entry.id === owner.id).content.find(entry => entry.type === "databaseView" && entry.props?.sourceId === source.id);
occurrence.props.viewIdsJson = JSON.stringify([occurrence.props.viewId, gallery.id]);
workspace.ui = { ...workspace.ui, selectedPageId: owner.id, selectedFolderId: owner.folderId, activeSection: "private",
  preferences: { ...workspace.ui.preferences, startPage: "last", theme: "dark" } };
const observations = [];
const report = await browserScenario("v14-real-wiki-selection141", async ({ page, check, assert, screenshot, saved, persisted }) => {
  const editor = page.locator(`.life-editor[data-page-id="${owner.id}"] .bn-editor`);
  const describe = () => page.evaluate(pageId => {
    const root = document.querySelector(`.life-editor[data-page-id="${pageId}"] .bn-editor`);
    const editor = root.pmViewDesc.node.type.schema.cached.blockNoteEditor;
    const state = editor.prosemirrorState, db = root.querySelector("section.database-view");
    const selection = state.selection, native = window.getSelection();
    const selected = [...root.querySelectorAll(".ProseMirror-selectednode")].filter(node => db && (node.contains(db) || db.contains(node)));
    const overlays = [...new Set(selected.flatMap(node => [node, ...node.querySelectorAll("*")]))].map(node => {
      const css = getComputedStyle(node, "::after");
      return { tag: node.tagName, className: node.className, content: css.content, background: css.backgroundColor, shadow: css.boxShadow };
    }).filter(css => !["none", "normal"].includes(css.content) && (css.shadow !== "none" || !["rgba(0, 0, 0, 0)", "transparent"].includes(css.background)));
    return { selectionType: selection.constructor.name, selection: selection.toJSON(), nodeType: selection.node?.type.name,
      selectedDatabase: selected.map(node => ({ className: node.className, tag: node.tagName })), overlays,
      dom: { type: native?.type, collapsed: native?.isCollapsed, textLength: native?.toString().length },
      focused: editor.prosemirrorView.hasFocus(), activeTag: document.activeElement?.tagName,
      nativeBlocks: editor.document.map(block => ({ id: block.id, type: block.type })) };
  }, owner.id);
  await check("Opening the real Wiki inline gallery does not automatically select the whole database", async () => {
    const full = page.locator(".page-full-database .database-view");
    await full.getByRole("tab", { name: "已发布", exact: true }).click();
    await full.getByRole("button", { name: "视图设置", exact: true }).click();
    await page.getByRole("button", { name: "转为内联", exact: true }).click();
    await editor.locator("section.database-view").waitFor();
    observations.push({ phase: "immediate", ...await describe() });
    await page.waitForTimeout(250);
    observations.push({ phase: "settled", ...await describe() });
    writeFileSync(`${directory}/observations.json`, JSON.stringify(observations, null, 2));
    await screenshot("real-gallery-inline-selection");
    for (const value of observations) {
      assert.equal(value.focused, false);
      assert.equal(value.overlays.length, 0, `An unfocused, untouched database must not paint a blue selection: ${JSON.stringify(value)}`);
    }
  });
  await check("A real record's nested editor and block menu do not activate its parent database selection", async () => {
    await editor.getByRole("button", { name: "一种更平静的生产力方式", exact: true }).click();
    const peek = page.getByRole("dialog", { name: "记录预览", exact: true });
    await peek.waitFor();
    const paragraph = peek.locator(".bn-editor .bn-inline-content").first();
    await paragraph.click();
    await paragraph.hover();
    const blockId = await paragraph.evaluate(element => element.closest(".bn-block-outer").dataset.id);
    await page.locator(`.life-block-actions[data-block-id="${blockId}"]`).getByRole("button", { name: "区块菜单", exact: true }).click();
    await page.getByRole("searchbox", { name: "搜索区块操作", exact: true }).waitFor();
    const nested = await describe();
    observations.push({ phase: "nested-record-menu", ...nested });
    assert.equal(await editor.evaluate(element => element.closest(".life-editor").classList.contains("has-editor-selection")), false, "A nested editor's handle must not activate the outer database");
    assert.equal(nested.overlays.length, 0, "The parent database stays passive while the record menu is active");
    await page.getByRole("searchbox", { name: "搜索区块操作", exact: true }).press("Escape");
    if (await peek.isVisible()) await peek.getByRole("button", { name: "关闭预览", exact: true }).click();
  });
  await check("Intentional database selection remains visible and keyboard delete/undo preserves the real records", async () => {
    const before = await saved();
    const original = await page.evaluate(pageId => JSON.parse(JSON.stringify(document.querySelector(`.life-editor[data-page-id="${pageId}"] .bn-editor`).pmViewDesc.node.type.schema.cached.blockNoteEditor.document)), owner.id);
    await editor.focus();
    await editor.press("Control+a");
    const selected = await describe();
    observations.push({ phase: "intentional-selection", ...selected });
    assert.equal(selected.focused, true);
    assert.ok(selected.overlays.length > 0, "User selection must still paint its visible selection feedback");
    await screenshot("intentional-selection");
    await editor.press("Backspace");
    await persisted(value => !value.pages.find(entry => entry.id === owner.id).content.some(block => block.type === "databaseView"));
    await editor.press("Control+z");
    const restored = await persisted(value => value.pages.find(entry => entry.id === owner.id).content.some(block => block.id === original[0].id));
    assert.deepEqual(restored.pages.find(entry => entry.id === owner.id).content, original);
    for (const key of ["dataSources", "databaseViews", "databaseItems", "attachments"]) assert.deepEqual(restored[key], before[key], `Selection/delete/undo preserves ${key}`);
  });
  await check("Moving a deliberate database selection into its block menu keeps visible feedback", async () => {
    await editor.locator("section.database-view").hover();
    const handle = page.getByRole("button", { name: "区块菜单", exact: true });
    await handle.click();
    const search = page.getByRole("searchbox", { name: "搜索区块操作", exact: true });
    await search.waitFor();
    await search.click();
    const menuSelection = await describe();
    observations.push({ phase: "block-menu-selection", ...menuSelection });
    assert.equal(menuSelection.focused, false, "Block menu owns keyboard focus");
    assert.ok(menuSelection.overlays.length > 0, "A deliberate selection stays visible while its menu is focused");
    await search.press("Escape");
  });
}, { workspace });
writeFileSync(`${directory}/report.json`, JSON.stringify({ ...report, input: "Complete real native208 84-page workspace", observations }, null, 2), { flag: "wx" });
