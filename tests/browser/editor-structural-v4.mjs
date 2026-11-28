import { browserScenario, shootBothModes } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { blockContext, copyJson, stableJson, walkBlocks } from "../../src/domain/blockDocument.js";

const workspace = coreParityWorkspace();
workspace.ui.selectedPageId = "editor-page";
workspace.ui.preferences = { theme: "system" };
const fixturePage = workspace.pages.find((entry) => entry.id === "editor-page");
fixturePage.title = "区块结构与原始标识";
fixturePage.icon = "";
fixturePage.content = [
  { id: "structural-before", type: "paragraph", content: "结构调整前的正文" },
  { id: "structural-three", type: "columnList", props: { columns: 3 }, children: [
    { id: "structural-left", type: "column", props: { width: 33.333333, index: 0, count: 3 }, children: [
      { id: "structural-rich", type: "paragraph", content: [
        { type: "text", text: "保留粗体", styles: { bold: true } },
        { type: "text", text: " 与 ", styles: {} },
        { type: "link", href: "lifeatlas://page/alpha-page", content: [{ type: "text", text: "原链接", styles: { italic: true } }] },
      ], children: [{ id: "structural-child", type: "bulletListItem", content: "保留子项", children: [{ id: "structural-grandchild", type: "paragraph", content: "保留孙项" }] }] },
      { id: "structural-left-tail", type: "paragraph", content: "左栏末段" },
    ] },
    { id: "structural-middle", type: "column", props: { width: 44.444444, index: 1, count: 3 }, children: [
      { id: "structural-middle-first", type: "checkListItem", props: { checked: true }, content: "中栏首项" },
      { id: "structural-middle-tail", type: "paragraph", content: "中栏末段" },
    ] },
    { id: "structural-right", type: "column", props: { width: 22.222223, index: 2, count: 3 }, children: [{ id: "structural-right-text", type: "paragraph", content: "右栏正文" }] },
  ] },
  { id: "structural-between", type: "paragraph", content: "两栏末项跨栏移动" },
  { id: "move-two", type: "columnList", props: { columns: 2 }, children: [
    { id: "move-source-column", type: "column", props: { width: 40, index: 0, count: 2 }, children: [
      { id: "move-only", type: "paragraph", content: [{ type: "text", text: "移动完整子树", styles: { bold: true } }], children: [{ id: "move-child", type: "bulletListItem", content: "移动的子项" }] },
    ] },
    { id: "move-target-column", type: "column", props: { width: 60, index: 1, count: 2 }, children: [
      { id: "move-target", type: "paragraph", content: "接收末项" },
      { id: "move-empty", type: "paragraph", content: "" },
    ] },
  ] },
  { id: "structural-after-move", type: "paragraph", content: "通过区块菜单删除末项" },
  { id: "delete-two", type: "columnList", props: { columns: 2 }, children: [
    { id: "delete-source-column", type: "column", props: { width: 35, index: 0, count: 2 }, children: [
      { id: "delete-only", type: "paragraph", content: "删除这一完整子树", children: [{ id: "delete-child", type: "bulletListItem", content: "随父区块删除的子项" }] },
    ] },
    { id: "delete-target-column", type: "column", props: { width: 65, index: 1, count: 2 }, children: [
      { id: "delete-target", type: "checkListItem", props: { checked: true }, content: "保留其他栏的待办" },
      { id: "delete-empty", type: "paragraph", content: "" },
    ] },
  ] },
  { id: "structural-after", type: "paragraph", content: "结构调整后的正文" },
];

await browserScenario("editor-structural-v4", async ({ page, check, screenshot, saved, persisted, assert }) => {
  const editorRoot = page.locator('.life-editor[data-page-id="editor-page"] > .bn-container .bn-editor').first();
  const documentBlocks = (value) => value.pages.find((entry) => entry.id === "editor-page").content;
  const block = (blocks, blockId) => blockContext(blocks, blockId)?.block;
  const storedBlock = (value, blockId) => block(documentBlocks(value), blockId);
  const outer = (blockId) => editorRoot.locator(`.bn-block-outer[data-id="${blockId}"]`).first();
  const content = (blockId) => outer(blockId).locator(':scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer > .bn-block-content').first();
  const nativeSnapshot = () => page.evaluate(() => {
    const editor = document.querySelector('.life-editor[data-page-id="editor-page"] .bn-editor').pmViewDesc.node.type.schema.cached.blockNoteEditor;
    return { document: JSON.parse(JSON.stringify(editor.document)), native: editor.prosemirrorState.doc.toJSON() };
  });
  const nativeIdentities = (snapshot) => {
    const identities = [];
    const visit = (node) => {
      if (node.attrs?.id) identities.push(node.attrs.id);
      for (const child of node.content || []) visit(child);
    };
    visit(snapshot.native);
    return identities;
  };
  const assertStructure = (snapshot) => {
    const blocks = walkBlocks(snapshot.document);
    const identities = blocks.map((entry) => entry.id);
    assert.ok(identities.every((entry) => typeof entry === "string" && entry.length > 0));
    assert.equal(new Set(identities).size, identities.length, "Canonical block identities must be unique");
    const nativeIds = nativeIdentities(snapshot);
    assert.equal(new Set(nativeIds).size, nativeIds.length, "Native layout and block identities must be unique");
    for (const entry of blocks) {
      if (entry.type === "column") {
        assert.equal(blockContext(snapshot.document, entry.id).parent?.type, "columnList");
        assert.ok(entry.children.length > 0, "Empty columns must be removed");
      }
      if (entry.type === "columnList") {
        assert.ok(entry.children.length >= 2 && entry.children.length <= 5);
        assert.equal(entry.props.columns, entry.children.length);
        entry.children.forEach((column, index) => {
          assert.equal(column.type, "column");
          assert.equal(column.props.index, index);
          assert.equal(column.props.count, entry.children.length);
          assert.ok(Number.isFinite(column.props.width) && column.props.width > 0);
        });
      }
    }
  };
  const waitForDocument = (expected) => {
    const expectedJson = stableJson(expected);
    return persisted((value) => stableJson(documentBlocks(value)) === expectedJson);
  };
  const beginDrag = async (sourceId, targetId, kind = "content") => {
    await content(sourceId).hover();
    const handle = page.locator(`.life-block-actions[data-block-id="${sourceId}"]`).getByRole("button", { name: "区块菜单", exact: true });
    const handleBounds = await handle.boundingBox();
    const targetBounds = await outer(targetId).boundingBox();
    const contentBounds = kind === "edge-column" ? targetBounds : await content(targetId).boundingBox();
    assert.ok(handleBounds && targetBounds && contentBounds, "Native dragging requires visible source and target geometry");
    assert.equal(await handle.getAttribute("draggable"), "true");
    const point = kind === "edge-column"
      ? { x: targetBounds.x + targetBounds.width - 6, y: targetBounds.y + Math.min(targetBounds.height / 2, 24) }
      : { x: contentBounds.x + contentBounds.width / 2, y: contentBounds.y + contentBounds.height - 2 };
    await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(point.x, point.y, { steps: 12 });
    await page.mouse.move(point.x + 1, point.y);
    const preview = page.locator(`.life-block-drop-preview[data-drop-kind="${kind}"]`);
    await preview.waitFor();
    assert.equal(await page.locator(".life-block-drop-preview").count(), 1);
    const previewBounds = await preview.boundingBox();
    assert.ok(previewBounds);
    const previewStyle = await preview.evaluate((element) => {
      const style = getComputedStyle(element);
      return { position: style.position, pointerEvents: style.pointerEvents };
    });
    assert.deepEqual(previewStyle, { position: "fixed", pointerEvents: "none" });
    if (kind === "edge-column") {
      assert.ok(Math.abs(previewBounds.x - targetBounds.x - targetBounds.width) <= 1);
      assert.ok(Math.abs(previewBounds.y - targetBounds.y) <= 1);
      assert.ok(Math.abs(previewBounds.width - 2) <= 1);
      assert.ok(Math.abs(previewBounds.height - Math.max(targetBounds.height, 24)) <= 1);
    } else {
      assert.ok(Math.abs(previewBounds.x - targetBounds.x) <= 1);
      assert.ok(Math.abs(previewBounds.y - targetBounds.y - targetBounds.height) <= 1);
      assert.ok(Math.abs(previewBounds.width - targetBounds.width) <= 1);
      assert.ok(Math.abs(previewBounds.height - 2) <= 1);
    }
  };
  const historyRoundTrip = async (before, after, focusId) => {
    await content(focusId).click({ position: { x: 6, y: 6 } });
    await page.keyboard.press("Control+z");
    await waitForDocument(before.document);
    assert.deepEqual((await nativeSnapshot()).native, before.native, "One undo must restore the whole original native document");
    await page.keyboard.press("Control+Shift+z");
    await waitForDocument(after.document);
    assert.deepEqual((await nativeSnapshot()).native, after.native, "One redo must restore the complete structural change");
    assert.equal(await page.locator(".life-block-drop-preview").count(), 0);
  };

  await check("trusted same-column reorder preserves a rich subtree and one native undo redo", async () => {
    await outer("structural-three").scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await content("structural-rich").click({ position: { x: 6, y: 6 } });
    const before = await nativeSnapshot();
    const original = copyJson(block(before.document, "structural-rich"));
    const expected = copyJson(before.document);
    const left = block(expected, "structural-left");
    left.children = [left.children[1], left.children[0]];
    await beginDrag("structural-rich", "structural-left-tail");
    assert.deepEqual((await nativeSnapshot()).native, before.native, "A drag preview must not rewrite the document");
    await screenshot("same-column-preview");
    await page.mouse.up();
    const state = await persisted((value) => storedBlock(value, "structural-left")?.children.at(-1)?.id === "structural-rich");
    assert.deepEqual(documentBlocks(state), expected);
    const after = await nativeSnapshot();
    assert.deepEqual(after.document, expected);
    assert.deepEqual(block(after.document, "structural-rich"), original);
    assertStructure(after);
    await historyRoundTrip(before, after, "structural-left-tail");
  });

  await check("trusted column-edge drop shows the matching preview and creates a fourth real column", async () => {
    await outer("structural-three").scrollIntoViewIfNeeded();
    await content("structural-rich").click({ position: { x: 6, y: 6 } });
    const before = await nativeSnapshot();
    const original = copyJson(block(before.document, "structural-rich"));
    await beginDrag("structural-rich", "structural-middle", "edge-column");
    assert.deepEqual((await nativeSnapshot()).native, before.native);
    await screenshot("fourth-column-edge-preview");
    await page.mouse.up();
    const state = await persisted((value) => storedBlock(value, "structural-three")?.children.length === 4);
    const after = await nativeSnapshot();
    const columns = block(after.document, "structural-three").children;
    const addedColumn = columns[2];
    assert.deepEqual(columns.filter((entry) => entry.id !== addedColumn.id).map((entry) => entry.id), ["structural-left", "structural-middle", "structural-right"]);
    assert.equal(block(before.document, addedColumn.id), undefined);
    assert.equal(addedColumn.type, "column");
    assert.deepEqual(addedColumn.children, [original]);
    assert.equal(addedColumn.props.width, 22.222222);
    const expected = copyJson(before.document);
    const expectedLayout = block(expected, "structural-three");
    block(expected, "structural-left").children = block(expected, "structural-left").children.filter((entry) => entry.id !== "structural-rich");
    block(expected, "structural-middle").props.width = 22.222222;
    expectedLayout.children.splice(2, 0, copyJson(addedColumn));
    expectedLayout.props.columns = 4;
    expectedLayout.children.forEach((column, index) => { column.props.index = index; column.props.count = 4; });
    assert.deepEqual(documentBlocks(state), expected);
    assert.deepEqual(after.document, expected);
    assertStructure(after);
    const beforeNativeIds = nativeIdentities(before);
    const afterNativeIds = nativeIdentities(after);
    assert.ok(beforeNativeIds.every((entry) => afterNativeIds.includes(entry)), "Creating a fourth column must retain every existing native identity");
    assert.equal(afterNativeIds.length - beforeNativeIds.length, 2, "Only the new column wrapper and layout-content identity may be added");
    const directColumns = outer("structural-three").locator(":scope > .bn-block > .bn-block-group > .bn-block-outer");
    assert.deepEqual(await directColumns.evaluateAll((elements) => elements.map((element) => element.dataset.id)), columns.map((entry) => entry.id));
    await screenshot("fourth-column-committed");
    await historyRoundTrip(before, after, "structural-middle-tail");
  });

  await check("moving the final child across columns removes the empty column and dissolves the layout in one undo unit", async () => {
    await outer("move-two").scrollIntoViewIfNeeded();
    await content("move-only").click({ position: { x: 6, y: 6 } });
    const before = await nativeSnapshot();
    const original = copyJson(block(before.document, "move-only"));
    const expected = copyJson(before.document);
    const layoutIndex = expected.findIndex((entry) => entry.id === "move-two");
    const surviving = block(expected, "move-target-column").children;
    expected.splice(layoutIndex, 1, surviving[0], original, surviving[1]);
    await beginDrag("move-only", "move-target");
    assert.deepEqual((await nativeSnapshot()).native, before.native);
    await screenshot("final-child-cross-column-preview");
    await page.mouse.up();
    const state = await persisted((value) => !storedBlock(value, "move-two") && documentBlocks(value).some((entry) => entry.id === "move-only"));
    assert.deepEqual(documentBlocks(state), expected);
    const after = await nativeSnapshot();
    assert.deepEqual(after.document, expected);
    assert.deepEqual(block(after.document, "move-only"), original);
    for (const removedId of ["move-two", "move-source-column", "move-target-column"]) {
      assert.equal(block(after.document, removedId), undefined);
      assert.equal(await outer(removedId).count(), 0);
    }
    assert.equal(block(after.document, "move-empty").type, "paragraph");
    assert.deepEqual(block(after.document, "move-empty").content, []);
    assertStructure(after);
    await screenshot("final-child-layout-dissolved");
    await historyRoundTrip(before, after, "move-target");
  });

  await check("the production block menu deletes a final-child subtree and atomically preserves the surviving column content", async () => {
    await outer("delete-two").scrollIntoViewIfNeeded();
    await content("delete-only").click({ position: { x: 6, y: 6 } });
    const before = await nativeSnapshot();
    const expected = copyJson(before.document);
    const layoutIndex = expected.findIndex((entry) => entry.id === "delete-two");
    const surviving = block(expected, "delete-target-column").children;
    expected.splice(layoutIndex, 1, ...surviving);
    await content("delete-only").hover();
    await page.locator('.life-block-actions[data-block-id="delete-only"]').getByRole("button", { name: "区块菜单", exact: true }).click();
    const deleteAction = page.locator(".life-block-menu").getByRole("menuitem", { name: "删除", exact: true });
    await deleteAction.waitFor();
    assert.equal(await deleteAction.isDisabled(), false);
    assert.deepEqual((await nativeSnapshot()).native, before.native);
    await screenshot("final-child-delete-menu");
    await deleteAction.click();
    const state = await persisted((value) => !storedBlock(value, "delete-only") && !storedBlock(value, "delete-two"));
    assert.deepEqual(documentBlocks(state), expected);
    const after = await nativeSnapshot();
    assert.deepEqual(after.document, expected);
    for (const removedId of ["delete-two", "delete-source-column", "delete-target-column", "delete-only", "delete-child"]) {
      assert.equal(block(after.document, removedId), undefined);
      assert.equal(await outer(removedId).count(), 0);
    }
    assert.deepEqual(block(after.document, "delete-target"), block(before.document, "delete-target"));
    assert.deepEqual(block(after.document, "delete-empty"), block(before.document, "delete-empty"));
    assertStructure(after);
    await screenshot("final-child-delete-committed");
    await historyRoundTrip(before, after, "delete-target");
  });

  await check("reload retains original subtree identities column order and normalized layout without duplicated blocks", async () => {
    const before = await nativeSnapshot();
    const storedBefore = documentBlocks(await saved());
    assert.deepEqual(storedBefore, before.document);
    assertStructure(before);
    assert.equal(block(before.document, "structural-three").children.length, 4);
    assert.deepEqual(block(before.document, "structural-three").children.flatMap((entry) => entry.children.map((child) => child.id)), ["structural-left-tail", "structural-middle-first", "structural-middle-tail", "structural-rich", "structural-right-text"]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await content("structural-rich").waitFor();
    await page.evaluate(() => document.fonts.ready);
    const after = await nativeSnapshot();
    assert.deepEqual(documentBlocks(await saved()), storedBefore);
    assert.deepEqual(after.document, before.document);
    assert.deepEqual(after.native, before.native);
    assert.deepEqual(nativeIdentities(after), nativeIdentities(before));
    assertStructure(after);
    const rootOuters = editorRoot.locator(":scope > .bn-block-group > .bn-block-outer");
    assert.deepEqual(await rootOuters.evaluateAll((elements) => elements.map((element) => element.dataset.id)), after.document.map((entry) => entry.id));
    const directColumns = outer("structural-three").locator(":scope > .bn-block > .bn-block-group > .bn-block-outer");
    assert.deepEqual(await directColumns.evaluateAll((elements) => elements.map((element) => element.dataset.id)), block(after.document, "structural-three").children.map((entry) => entry.id));
    for (const retainedId of ["structural-rich", "structural-child", "structural-grandchild", "move-only", "move-child", "move-empty", "delete-target", "delete-empty"]) assert.equal(await editorRoot.locator(`.bn-block-outer[data-id="${retainedId}"]`).count(), 1);
    for (const removedId of ["move-two", "move-source-column", "move-target-column", "delete-two", "delete-source-column", "delete-target-column", "delete-only", "delete-child"]) assert.equal(await outer(removedId).count(), 0);
    assert.equal(await page.locator(".life-block-drop-preview").count(), 0);
    await outer("structural-three").scrollIntoViewIfNeeded();
    await shootBothModes(page, screenshot, "structural-persisted");
  });

  await check("copying a selected parent and descendants duplicates the subtree only once", async () => {
    await content("structural-rich").click();
    await page.evaluate(() => {
      const root = document.querySelector('.life-editor[data-page-id="editor-page"] .bn-editor');
      const start = root.querySelector('[data-id="structural-rich"] .bn-inline-content strong').firstChild;
      const end = root.querySelector('[data-id="structural-grandchild"] .bn-inline-content').firstChild;
      window.getSelection().setBaseAndExtent(start, 0, end, 2);
    });
    await page.waitForFunction(() => !document.querySelector('.life-editor[data-page-id="editor-page"] .bn-editor').pmViewDesc.node.type.schema.cached.blockNoteEditor.prosemirrorState.selection.empty);
    const before = await nativeSnapshot();
    const originalIds = new Set(walkBlocks(before.document).map((entry) => entry.id));
    await page.keyboard.press("Control+d");
    const copied = await persisted((value) => walkBlocks(documentBlocks(value)).length > originalIds.size);
    const newBlocks = walkBlocks(documentBlocks(copied)).filter((entry) => !originalIds.has(entry.id));
    assert.equal(newBlocks.length, 3);
    assert.deepEqual(newBlocks.map((entry) => entry.type), ["paragraph", "bulletListItem", "paragraph"]);
    assert.deepEqual(newBlocks[0].content, block(before.document, "structural-rich").content);
    assert.equal(newBlocks[0].children[0].id, newBlocks[1].id);
    assert.equal(newBlocks[1].children[0].id, newBlocks[2].id);
    await page.keyboard.press("Control+z");
    await waitForDocument(before.document);
    assert.deepEqual((await nativeSnapshot()).native, before.native);
  });

  await check("moving a last-column subtree to another page preserves identity and normalizes the source", async () => {
    await content("structural-rich").click();
    const before = await nativeSnapshot();
    const original = copyJson(block(before.document, "structural-rich"));
    const targetBefore = (await saved()).pages.find((entry) => entry.id === "alpha-page").content;
    await content("structural-rich").hover();
    await page.locator('.life-block-actions[data-block-id="structural-rich"]').getByRole("button", { name: "区块菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "移动到…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "移动到", exact: true });
    await dialog.getByRole("textbox", { name: "搜索目标页面", exact: true }).fill("Alpha 项目");
    await dialog.locator(".life-block-move-page").filter({ hasText: "Alpha 项目" }).click();
    const moved = await persisted((value) => !storedBlock(value, "structural-rich") && value.pages.find((entry) => entry.id === "alpha-page").content.at(-1)?.id === "structural-rich");
    assert.deepEqual(moved.pages.find((entry) => entry.id === "alpha-page").content, [...targetBefore, original]);
    assert.equal(block((await nativeSnapshot()).document, "structural-three").children.length, 3);
    assert.equal(walkBlocks(documentBlocks(moved)).some((entry) => ["structural-rich", "structural-child", "structural-grandchild"].includes(entry.id)), false);
    assertStructure(await nativeSnapshot());
    await page.reload({ waitUntil: "domcontentloaded" });
    await outer("structural-three").waitFor();
    assert.deepEqual(documentBlocks(await saved()), documentBlocks(moved));
    assert.deepEqual((await saved()).pages.find((entry) => entry.id === "alpha-page").content, [...targetBefore, original]);
  });
}, { workspace, viewport: { width: 1440, height: 900 } });
