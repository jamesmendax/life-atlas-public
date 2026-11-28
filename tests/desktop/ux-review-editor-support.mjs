import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { upgradeWorkspace } from "../../src/persistence/migrations.js";
import { SLASH_MENU_CATALOG } from "../../src/editor/slashMenuCatalog.js";

export const mainTitle = "编辑器交互走查";
export const slashTitle = "斜杠插入走查";
export const dbTitle = "数据库插入走查";
const paragraph = (id, content = "") => ({ id, type: "paragraph", content });
const slot = (id) => paragraph("ux-slot-" + id);

export function workspaceFixture() {
  const workspace = upgradeWorkspace(coreParityWorkspace());
  const original = workspace.pages.find((entry) => entry.id === "editor-page");
  const tasksTab = original.content.find((block) => block.type === "tabs").children[1];
  tasksTab.children.push({ id: "ux-hidden-toggle", type: "toggleListItem", content: "折叠的标题容器",
    children: [{ id: "ux-tab-heading", type: "heading", props: { level: 3 }, content: "折叠标签中的标题" }] });
  workspace.folders.push({ ...structuredClone(workspace.folders[0]), id: "ux-move-target", name: "走查目标文件夹", lastOpenedPageId: null });
  original.title = mainTitle;
  original.cover = { kind: "gallery", value: "degas-landscape", position: 50 };
  const sample = (type, props = {}, content) => ({ id: "ux-" + type, type, props, ...(content === undefined ? {} : { content }) });
  original.content = [
    paragraph("ux-format", "文字样式与选区走查 ABC容易识别XYZ"), paragraph("ux-drag-a", "拖动甲"),
    paragraph("ux-drag-b", "拖动乙"), paragraph("ux-drag-c", "拖动丙"),
    sample("tableOfContents"), sample("heading", { level: 2 }, "根标题"),
    sample("checkListItem", { checked: false }, "走查勾选"), sample("bulletListItem", {}, "项目符号"),
    sample("numberedListItem", {}, "编号列表"),
    { ...sample("toggleListItem", {}, "折叠内容"), children: [paragraph("ux-toggle-child", "折叠内文字")] },
    sample("quote", {}, "引用内容"), sample("divider"), sample("callout", { icon: "💡" }, "提示文字"),
    sample("codeBlock", { language: "javascript" }, "const sample = 1;"), sample("equation", {}, "x^2"),
    sample("table", {}, { type: "tableContent", rows: [{ cells: ["甲", "乙"] }, { cells: ["丙", "丁"] }] }),
    sample("image"), sample("video"), sample("audio"), sample("file"),
    { id: "ux-pdf", type: "file", props: { name: "PDF 文件" } },
    sample("pageLink", { pageId: "alpha-page", label: "Alpha 项目" }), sample("breadcrumb"),
    sample("editorialCard", { title: "编辑卡", excerpt: "卡片摘要" }),
    sample("editorialSection", { fallbackJson: JSON.stringify([{ title: "精选卡", excerpt: "精选摘要", pageId: "alpha-page" }]) }),
    sample("databaseView", { sourceId: "projects", viewId: "view-table" }),
    sample("marketComponent", { title: "隔离未下载组件", packageId: "community.sample", packageVersion: "1.0.0" }),
    ...original.content,
    ...Array.from({ length: 12 }, (_, i) => paragraph("ux-spacer-" + i, "滚动定位用正文 " + i)),
    { id: "ux-bottom-heading", type: "heading", props: { level: 3 }, content: "末尾标题" },
    { id: "ux-nested-parent", type: "bulletListItem", content: "层级正文",
      children: [{ id: "ux-nested-heading", type: "heading", props: { level: 2 }, content: "嵌套标题" }] },
    paragraph("ux-end", "尾部正文"), paragraph("ux-format-extra", "独立格式测试 XYZ"),
  ];
  for (const [id, title, database] of [["ux-slash", slashTitle, false], ["ux-db", dbTitle, true]]) {
    workspace.pages.push({ ...structuredClone(original), id, title, cover: null,
      content: [slot("inventory"), ...SLASH_MENU_CATALOG.filter((e) => (e.group === "数据库") === database).map((e) => slot(e.id)), paragraph("ux-slot-end", "尾部")] });
  }
  workspace.pages.push({ ...structuredClone(original), id: "ux-history", title: "版本恢复走查", cover: null,
    content: [paragraph("ux-history-text", "待保留的原文")] });
  workspace.ui.selectedPageId = original.id;
  workspace.ui.selectedFolderId = original.folderId;
  workspace.ui.preferences = { ...workspace.ui.preferences, theme: "light", style: "mobai" };
  return workspace;
}

export const block = (page, id) => page.locator('.life-editor .bn-block-outer[data-id="' + id + '"]').first();
export const inline = (page, id) => block(page, id).locator(".bn-inline-content").first();
export const root = (page) => page.locator(".life-editor > .bn-container").first().locator(".bn-editor").first();
export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function openPage(page, title) {
  if (await page.locator(".page-title-input").first().inputValue().catch(() => "") === title) return;
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "全局搜索", exact: true });
  await search.getByPlaceholder("搜索文件夹、页面与正文内容…").fill(title);
  const exactTitle = new RegExp("^" + title.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&") + "$", "u");
  await search.locator(".search-result-row").filter({ has: page.locator("strong", { hasText: exactTitle }) }).first().click();
  await search.waitFor({ state: "hidden" });
  await page.waitForFunction((name) => document.querySelector(".page-title-input")?.value === name, title);
  await root(page).waitFor();
}

export async function editorSnapshot(page) {
  return root(page).evaluate((el) => {
    const editor = el.pmViewDesc.node.type.schema.cached.blockNoteEditor;
    return { types: Object.keys(editor.schema.blockSchema), blocks: editor.document, selection: editor.prosemirrorState.selection.toJSON(),
      cursor: editor.getTextCursorPosition()?.block?.id, focused: editor.prosemirrorView.hasFocus() };
  });
}

export async function focusInfo(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    return { tag: el?.tagName, label: el?.getAttribute("aria-label"), text: el?.innerText?.slice(0, 65),
      className: typeof el?.className === "string" ? el.className : "", inEditor: Boolean(el?.closest(".bn-editor")),
      dialog: el?.closest('[role="dialog"],[role="alertdialog"]')?.getAttribute("aria-label"), focusVisible: el?.matches(":focus-visible") };
  });
}

export async function setSurface(page, theme, requestedWidth, requestedHeight, processId, executable) {
  const script = fileURLToPath(new URL("./ux-review-editor-window.ps1", import.meta.url));
  const title = await page.title();
  const native = JSON.parse(execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", script,
    "-AppProcessId", String(processId), "-Executable", executable, "-Width", String(requestedWidth), "-Height", String(requestedHeight), "-WindowTitle", title],
    { encoding: "utf8", windowsHide: true, timeout: 12000 }));
  const toggle = page.getByRole("button", { name: "切换白天/夜间", exact: true });
  for (let i = 0; i < 4 && await page.locator("html").getAttribute("data-theme") !== theme; i += 1) {
    await toggle.click();
    await pause(50);
  }
  assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
  const renderer = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
  return { ...renderer, native };
}

export async function showBlockMenu(page, id) {
  const item = block(page, id).locator(".bn-block-content").first();
  await item.scrollIntoViewIfNeeded();
  await item.hover({ position: { x: 8, y: 8 } });
  const rect = await item.boundingBox();
  await page.mouse.move(rect.x + 10, rect.y + 8);
  const trigger = page.locator('.life-block-actions[data-block-id="' + id + '"]').getByRole("button", { name: "区块菜单" });
  await trigger.click();
  return page.locator(".life-block-menu").first();
}

export async function closeFloating(page) {
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("Escape").catch(() => {});
    const dismiss = page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').last()
      .getByRole("button", { name: /^(关闭|关闭对话框|取消)$/ }).first();
    if (await dismiss.isVisible().catch(() => false)) await dismiss.click({ timeout: 500 }).catch(() => {});
  }
}
