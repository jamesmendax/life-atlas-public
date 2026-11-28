import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

const workspace = coreParityWorkspace();
workspace.ui.selectedPageId = "editor-page";
const pageFixture = workspace.pages.find((entry) => entry.id === "editor-page");
const picture = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1cAAAAASUVORK5CYII=";
const cases = [
  { id: "spaces", text: "  ", side: "left", edge: "last", key: "Backspace", presses: 2 },
  { id: "left-first", text: "", side: "left", edge: "first", key: "Backspace", presses: 2 },
  { id: "right-first", text: "", side: "right", edge: "first", key: "Backspace", presses: 2 },
  { id: "left-last", text: "", side: "left", edge: "last", key: "Backspace", presses: 2 },
  { id: "delete-edge", text: "", side: "left", edge: "last", key: "Delete", presses: 2 },
  { id: "undo-first", text: "", side: "left", edge: "first", key: "Backspace", presses: 2 },
];
const paragraph = (id, content) => ({ id, type: "paragraph", content });
pageFixture.content = cases.flatMap((item) => {
  const left = [paragraph(`${item.id}-text`, "Left column body and navigation")];
  const right = [{ id: `${item.id}-image`, type: "image", props: { url: picture, name: "Synthetic local picture", caption: "Right column image" } }, paragraph(`${item.id}-caption`, "Right column caption")];
  const target = item.side === "left" ? left : right;
  target[item.edge === "first" ? "unshift" : "push"](paragraph(`${item.id}-blank`, item.text));
  return [
    { id: `${item.id}-heading`, type: "heading", props: { level: 2 }, content: item.id },
    { id: `${item.id}-list`, type: "columnList", props: { columns: 2 }, children: [
      { id: `${item.id}-left`, type: "column", props: { width: 56, index: 0, count: 2 }, children: left },
      { id: `${item.id}-right`, type: "column", props: { width: 44, index: 1, count: 2 }, children: right },
    ] },
  ];
});
pageFixture.content.push(paragraph("ordinary64", "Ordinary text xy"));

await browserScenario("v12-column-delete64", async ({ page, check, saved, persisted, screenshot, assert }) => {
  const editor = page.locator('.life-editor[data-page-id="editor-page"] .bn-editor');
  await editor.waitFor();
  const geometry = async (id) => page.locator(`.bn-block-outer[data-id="${id}-list"]`).evaluate((outer) => {
    const group = outer.querySelector(":scope > .bn-block > .bn-block-group");
    return [...group.children].filter((node) => node.classList.contains("bn-block-outer")).map((node) => {
      const box = node.getBoundingClientRect();
      return { id: node.dataset.id, x: box.x, y: box.y, width: box.width, height: box.height, type: node.querySelector(":scope > .bn-block > .bn-block-content")?.dataset.contentType };
    });
  });
  const documentState = async (id) => {
    const value = await saved();
    const root = value.pages.find((entry) => entry.id === "editor-page");
    const list = root.content.find((entry) => entry.id === `${id}-list`);
    return { list, root };
  };
  const assertColumns = async (item, before) => {
    const state = await documentState(item.id);
    assert.ok(state.list, `${item.id}: layout wrapper removed`);
    assert.deepEqual(state.list.children.map(({ id, type }) => ({ id, type })), [
      { id: `${item.id}-left`, type: "column" }, { id: `${item.id}-right`, type: "column" },
    ], `${item.id}: structural column membership changed`);
    assert.ok(state.list.children[1].children.some((entry) => entry.id === `${item.id}-image`), `${item.id}: right image escaped its column`);
    const current = await geometry(item.id);
    assert.equal(current.length, 2, JSON.stringify({ id: item.id, current }));
    assert.ok(Math.abs(current[0].width - before[0].width) < 2, JSON.stringify({ id: item.id, before, current }));
    assert.ok(Math.abs(current[1].width - before[1].width) < 2, JSON.stringify({ id: item.id, before, current }));
    assert.ok(Math.abs(current[0].y - current[1].y) < 2 && current[1].x > current[0].x + current[0].width, JSON.stringify({ id: item.id, current }));
  };
  for (const item of cases) {
    await check(`${item.id}: ${item.presses} ${item.key} presses preserve two columns and the right image`, async () => {
      const target = page.locator(`.bn-block-outer[data-id="${item.id}-blank"] .bn-block-content`).first();
      await target.click();
      await page.keyboard.press(item.text ? "End" : "Home");
      const before = await geometry(item.id);
      for (let count = 0; count < item.presses; count += 1) {
        await page.keyboard.press(item.key);
        await page.waitForTimeout(200);
        await assertColumns(item, before);
      }
      await screenshot(`${item.id}-after`);
    });
  }
  await check("Deleting empty paragraphs removes them while preserving the remaining text and image blocks", async () => {
    await persisted((value) => {
      const content = value.pages.find((entry) => entry.id === "editor-page").content;
      return ["left-first", "right-first", "left-last", "undo-first"].every((id) => !content.find((entry) => entry.id === `${id}-list`).children.some((column) => column.children.some((entry) => entry.id === `${id}-blank`)));
    });
    for (const id of ["left-first", "right-first", "undo-first"]) {
      const state = await documentState(id);
      const leftText = state.list.children[0].children.find((entry) => entry.id === `${id}-text`);
      assert.equal(leftText.content.map((entry) => entry.text || "").join(""), "Left column body and navigation");
      assert.equal(state.list.children[1].children.find((entry) => entry.id === `${id}-image`).props.url, picture);
      assert.equal(state.list.children[1].children.find((entry) => entry.id === `${id}-caption`).content.map((entry) => entry.text || "").join(""), "Right column caption");
    }
  });
  await check("Undo and redo restore the removed paragraph inside its original column", async () => {
    await page.keyboard.press("Control+z");
    await persisted((value) => value.pages.find((entry) => entry.id === "editor-page").content.find((entry) => entry.id === "undo-first-list").children[0].children.some((entry) => entry.id === "undo-first-blank"));
    assert.deepEqual((await documentState("undo-first")).list.children.map((entry) => entry.id), ["undo-first-left", "undo-first-right"]);
    await page.keyboard.press("Control+Shift+z");
    await persisted((value) => !value.pages.find((entry) => entry.id === "editor-page").content.find((entry) => entry.id === "undo-first-list").children[0].children.some((entry) => entry.id === "undo-first-blank"));
    assert.deepEqual((await documentState("undo-first")).list.children.map((entry) => entry.type), ["column", "column"]);
  });
  await check("Ordinary character deletion and undo continue to edit text outside columns", async () => {
    const before = (await saved()).pages.find((entry) => entry.id === "editor-page").content;
    await page.locator('[data-id="ordinary64"] .bn-inline-content').first().click({ position: { x: 8, y: 8 } });
    await page.keyboard.press("End");
    await page.keyboard.press("Backspace");
    const changed = await persisted((value) => value.pages.find((entry) => entry.id === "editor-page").content.find((entry) => entry.id === "ordinary64").content.map((entry) => entry.text || "").join("") === "Ordinary text x");
    const actual = changed.pages.find((entry) => entry.id === "editor-page").content;
    const expected = structuredClone(before);
    expected.find((entry) => entry.id === "ordinary64").content = actual.find((entry) => entry.id === "ordinary64").content;
    assert.deepEqual(actual, expected, "ordinary typing must leave all column content unchanged");
    await page.keyboard.press("Control+z");
    const restored = await persisted((value) => value.pages.find((entry) => entry.id === "editor-page").content.find((entry) => entry.id === "ordinary64").content.map((entry) => entry.text || "").join("") === "Ordinary text xy");
    assert.deepEqual(restored.pages.find((entry) => entry.id === "editor-page").content, before);
  });
  await check("Reload keeps each tested column layout intact", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await editor.waitFor();
    for (const item of cases) {
      const state = await documentState(item.id);
      assert.deepEqual(state.list.children.map((entry) => entry.type), ["column", "column"]);
      assert.ok(state.list.children[1].children.some((entry) => entry.id === `${item.id}-image`));
    }
  });
}, { workspace, viewport: { width: 1707, height: 1019 } });
