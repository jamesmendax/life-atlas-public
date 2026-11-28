import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { walkBlocks } from "../../src/domain/blockDocument.js";

// Synthetic native blocks reduced from source-html48's six maintenance cards.
// No importer, captured profile, or real workspace is loaded by this scenario.
const editorSelector = '.life-editor[data-page-id="editor-page"] .bn-editor';
const paragraph = (id, content) => ({ id, type: "paragraph", content, children: [] });
const callout = (id, title, description, status, color = "gray", icon = "") => ({
  id, type: "callout", props: { icon, tone: color, backgroundColor: color },
  content: [{ type: "text", text: title, styles: { bold: true } }],
  children: [paragraph(`${id}-description`, description), paragraph(`${id}-status`, status)],
});
const left = [
  callout("writing88", "写长文　进入文章库 →", "技术长文、完整观点与深度复盘。", "草稿 → 发布"),
  callout("essays88", "写随笔　进入随笔库 →", "已经能够独立阅读，但比长文更轻、更自由的文字。", "草稿 → 已发布"),
  callout("notes88", "记札记　进入札记 →", "问题、短判断和还在变化的想法。", "初记 → 推演 → 成形"),
];
const right = [
  callout("projects88", "更新项目　进入项目 →", "更新状态、摘要和真正改变方向的进展。", "想法 → 进行中 → 完成 / 暂停"),
  callout("reading88", "记录阅读　进入书架 →", "开始读时建条目，读完后留下真正有用的核心收获。", "想读 → 在读 → 读完 / 参考"),
  callout("now88", "更新此刻　新增状态快照 →", "新建一条状态，不再覆盖旧内容；新的当前状态勾选「当前」。", "历史会一直保留"),
];
const brown = callout("maintenance88", "需要批量整理或调整结构时", "这里才放数据库结构和批量视图；它不是日常使用路径。", "后台维护", "brown");
const green = callout("green88", "写作放进数据库，成熟度交给状态。", `窄窗完整换行 ${"LongUnbrokenContent88".repeat(5)}`, "保留末行子段落", "green", "🌿");
const writing = callout("emoji88", "正式文章", "用于长文、项目复盘或旅行文章。", "保留显式图标", "gray", "✍️");
const cards = [...left, ...right, brown, green, writing];
const columns = [{
  id: "columns88", type: "columnList", props: { columns: 2 }, children: [
    { id: "left88", type: "column", props: { width: 50, index: 0, count: 2 }, children: left },
    { id: "right88", type: "column", props: { width: 50, index: 1, count: 2 }, children: right },
  ],
}];
const workspace = coreParityWorkspace();
workspace.ui.selectedPageId = "editor-page";
workspace.ui.preferences = { theme: "system" };
const fixturePage = workspace.pages.find((entry) => entry.id === "editor-page");
fixturePage.settings = { ...fixturePage.settings, fullWidth: true };
fixturePage.content = [...columns, brown, green, writing, paragraph("tail88", "卡片之后的普通正文")];

const outer = (page, id) => page.locator(`${editorSelector} .bn-block-outer[data-id="${id}"]`).first();
const native = (page) => page.evaluate((selector) => document.querySelector(selector).pmViewDesc.node.type.schema.cached.blockNoteEditor.document, editorSelector);
const savedBlocks = (value) => value.pages.find((entry) => entry.id === "editor-page").content;
const textOf = (content) => typeof content === "string" ? content : (content || []).map((item) => item.text || "").join("");

const measure = (page) => page.evaluate(({ selector, ids, columnIds }) => {
  const editor = document.querySelector(selector);
  const bounds = (node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  };
  const host = (id) => editor.querySelector(`.bn-block-outer[data-id="${id}"]`);
  return {
    cards: ids.map((id) => {
      const node = host(id);
      const face = node.querySelector(":scope > .bn-block");
      const header = face.querySelector(':scope > .react-renderer > .bn-block-content[data-content-type="callout"]');
      const group = face.querySelector(":scope > .bn-block-group");
      const body = header.querySelector(".life-callout-content");
      const style = getComputedStyle(face);
      const token = document.createElement("span");
      token.style.backgroundColor = `var(--mb-u-${header.dataset.backgroundColor}-bg)`;
      document.body.append(token);
      const expected = getComputedStyle(token).backgroundColor;
      token.remove();
      const children = [...group.querySelectorAll(":scope > .bn-block-outer")].map((child) => {
        const inline = child.querySelector(".bn-inline-content");
        const rail = getComputedStyle(child, "::before");
        return { id: child.dataset.id, rect: bounds(child), inline: bounds(inline),
          scrollWidth: inline.scrollWidth, clientWidth: inline.clientWidth,
          rail: { content: rail.content, display: rail.display, border: rail.borderLeftWidth } };
      });
      return { id, rect: bounds(face), background: style.backgroundColor, expected,
        radii: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius],
        headerBackground: getComputedStyle(header).backgroundColor,
        overflow: [style.overflowX, style.overflowY, getComputedStyle(group).overflowX, getComputedStyle(group).overflowY],
        groupBorder: getComputedStyle(group).borderLeftWidth,
        bodyLeft: bounds(body).left, icon: header.querySelector(".life-callout-icon").textContent,
        iconMode: header.querySelector(".life-callout").dataset.calloutIcon,
        children };
    }),
    columns: columnIds.map((id) => {
      const node = host(id);
      return { id, backgrounds: [node, node.querySelector(":scope > .bn-block"), node.querySelector(":scope > .bn-block > .bn-block-group")].map((layer) => getComputedStyle(layer).backgroundColor) };
    }),
  };
}, { selector: editorSelector, ids: cards.map((card) => card.id), columnIds: ["left88", "right88"] });

await browserScenario("v13-callout-visual88", async ({ page, check, assert, persisted, screenshot }) => {
  await outer(page, "writing88").locator(".life-callout").waitFor();
  const baseline = await native(page);
  const palettes = {};
  for (const width of [1440, 860]) {
    await page.setViewportSize({ width, height: 900 });
    for (const mode of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, mode);
      await page.evaluate(async (selector) => {
        const cards = [...document.querySelectorAll(`${selector} .bn-block-outer`)].filter((element) =>
          element.querySelector(':scope > .bn-block > .react-renderer > .bn-block-content[data-content-type="callout"]'));
        await Promise.all(cards.flatMap((element) => element.getAnimations()).map((animation) => animation.finished.catch(() => {})));
      }, editorSelector);
      const measurement = await measure(page);
      palettes[`${width}-${mode}`] = measurement.cards.map((card) => card.background);

      await check(`${width} ${mode}: six adjacent callouts have separate 16px gaps and rounded whole-card backgrounds`, async () => {
        for (const ids of [left.map((card) => card.id), right.map((card) => card.id)]) {
          const column = ids.map((id) => measurement.cards.find((card) => card.id === id));
          for (let index = 1; index < column.length; index += 1) {
            const gap = column[index].rect.top - column[index - 1].rect.bottom;
            assert.ok(Math.abs(gap - 16) <= 1, `${ids[index]} gap=${gap}; ${JSON.stringify(column)}`);
          }
        }
        for (const column of measurement.columns) {
          assert.ok(column.backgrounds.every((value) => value === "rgba(0, 0, 0, 0)"), `${column.id}: ${JSON.stringify(column)}`);
        }
        for (const card of measurement.cards) {
          assert.deepEqual(card.radii, Array(4).fill("10px"), `${card.id}: ${JSON.stringify(card)}`);
          assert.equal(card.headerBackground, "rgba(0, 0, 0, 0)", `${card.id} header must let the rounded whole-card surface show`);
          assert.equal(card.background, card.expected, `${mode} ${card.id} must use its theme background token`);
          assert.notEqual(card.background, "rgba(0, 0, 0, 0)", `${card.id} must paint a complete card`);
        }
      });

      await check(`${width} ${mode}: child paragraphs stay enclosed, wrap, align and have no added rail`, async () => {
        for (const card of measurement.cards) {
          assert.equal(card.children.length, 2, card.id);
          assert.ok(card.overflow.every((value) => value === "visible"), `${card.id}: ${JSON.stringify(card.overflow)}`);
          assert.equal(parseFloat(card.groupBorder), 0, card.id);
          for (const child of card.children) {
            assert.ok(child.rect.left >= card.rect.left - 1 && child.rect.right <= card.rect.right + 1 && child.rect.top >= card.rect.top - 1 && child.rect.bottom <= card.rect.bottom + 1,
              `${card.id} must enclose ${child.id}: ${JSON.stringify(card)}`);
            assert.ok(Math.abs(child.inline.left - card.bodyLeft) <= 1, `${card.id} child must align with body`);
            assert.ok(child.inline.right <= card.rect.right + 1 && child.scrollWidth <= child.clientWidth + 1, `${child.id} must wrap without horizontal clipping: ${JSON.stringify(child)}`);
            assert.ok(["none", "normal"].includes(child.rail.content) || child.rail.display === "none", `${child.id}: ${JSON.stringify(child.rail)}`);
            assert.equal(parseFloat(child.rail.border), 0, child.id);
          }
        }
        assert.deepEqual(await native(page), baseline, "viewport and theme changes must preserve the entire native document");
      });

      await check(`${width} ${mode}: iconless cards keep no emoji column and explicit emoji survive`, async () => {
        for (const card of measurement.cards) {
          const expected = cards.find((entry) => entry.id === card.id).props.icon;
          assert.equal(card.icon, expected, card.id);
          assert.equal(card.iconMode, expected ? "present" : "none", card.id);
          if (!expected) assert.ok(Math.abs(card.bodyLeft - card.rect.left - 12) <= 1, `${card.id}: iconless body must keep its 12px inset`);
        }
      });
      await outer(page, "writing88").scrollIntoViewIfNeeded();
      await screenshot(`maintenance-${width}-${mode}`);
      await outer(page, "green88").scrollIntoViewIfNeeded();
      await screenshot(`controls-${width}-${mode}`);
    }
  }

  await check("gray brown and green backgrounds change with day and night", async () => {
    for (const width of [1440, 860]) {
      for (const id of ["writing88", "maintenance88", "green88"]) {
        const index = cards.findIndex((card) => card.id === id);
        assert.notEqual(palettes[`${width}-light`][index], palettes[`${width}-dark`][index], id);
      }
    }
  });

  await check("narrow-window child input persists through reload without changing callout structure or siblings", async () => {
    const childId = "writing88-description";
    const before = await native(page);
    const original = walkBlocks(before).find((block) => block.id === childId);
    const expectedText = `${textOf(original.content)} 独立编辑88`;
    await outer(page, childId).locator(".bn-inline-content").click();
    // The narrow paragraph wraps: place the caret at the block end, rather
    // than using visual-line End and accidentally editing the first line.
    await page.evaluate(({ selector, id }) => {
      const editor = document.querySelector(selector).pmViewDesc.node.type.schema.cached.blockNoteEditor;
      editor.setTextCursorPosition(id, "end");
    }, { selector: editorSelector, id: childId });
    await page.waitForFunction(({ selector, id }) => {
      const editor = document.querySelector(selector).pmViewDesc.node.type.schema.cached.blockNoteEditor;
      const selection = editor.prosemirrorState.selection;
      return editor.getTextCursorPosition().block.id === id && selection.empty && selection.$from.parentOffset === selection.$from.parent.content.size;
    }, { selector: editorSelector, id: childId });
    await page.keyboard.insertText(" 独立编辑88");
    await persisted((value) => textOf(walkBlocks(savedBlocks(value)).find((block) => block.id === childId)?.content) === expectedText);
    const after = await native(page);
    const expected = structuredClone(before);
    walkBlocks(expected).find((block) => block.id === childId).content = walkBlocks(after).find((block) => block.id === childId).content;
    assert.deepEqual(after, expected, "only the targeted child text may change; IDs, callout props, icons and siblings must stay equal");
    await page.reload({ waitUntil: "domcontentloaded" });
    await outer(page, childId).waitFor();
    assert.deepEqual(await native(page), after);
    assert.equal(await outer(page, childId).locator(".bn-inline-content").textContent(), expectedText);
    const measurement = await measure(page);
    const card = measurement.cards.find((entry) => entry.id === "writing88");
    const child = card.children.find((entry) => entry.id === childId);
    assert.ok(child.rect.bottom <= card.rect.bottom + 1 && child.rect.right <= card.rect.right + 1, "the saved child must remain inside the complete background after reload");
    await screenshot("narrow-dark-edited-reloaded");
  });
}, { workspace, viewport: { width: 1440, height: 900 } });
