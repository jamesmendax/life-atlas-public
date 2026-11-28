import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

const workspace = coreParityWorkspace();
workspace.ui.selectedPageId = "editor-page";
const page = workspace.pages.find(entry => entry.id === "editor-page");
page.content = [{ id: "reading-log", type: "paragraph", content: "阅读笔记" }, { id: "empty-line", type: "paragraph", content: "" }];
const label = "记录今日阅读";
const message = "✓ 已记录阅读 20 分钟 · QA-124";
const button = { id: "add-project", name: "创建供应记录", type: "button", config: { action: {
  type: "createRecord", targetSourceId: "partners", title: "{title} · 新供应记录",
} } };
const projects = workspace.dataSources.find(source => source.id === "projects");
projects.properties.splice(1, 0, button);
workspace.databaseViews.find(view => view.id === "view-table").visiblePropertyIds.splice(1, 0, button.id);
const body = ws => ws.pages.find(entry => entry.id === page.id).content;
const hasAppended = ws => body(ws).some(block => JSON.stringify(block.content || "").includes(message));

await browserScenario("action-buttons-150", async ({ page: browser, persisted, check, assert }) => {
  const editor = browser.locator('.life-editor[data-page-id="editor-page"] .bn-editor').first();
  await check("slash inserts a configurable native page button", async () => {
    await editor.locator('[data-id="empty-line"] .bn-inline-content').first().click();
    await browser.keyboard.type("/button");
    await browser.locator(".bn-suggestion-menu").getByRole("option", { name: /按钮/ }).first().click();
    await editor.getByRole("button", { name: "配置页面按钮" }).click();
    await editor.getByLabel("按钮名称").fill(label);
    await editor.getByLabel("追加到页面末尾的文字").fill(message);
    await editor.getByRole("button", { name: "保存按钮" }).click();
    await persisted(ws => body(ws).some(block => block.type === "actionButton" && block.props.label === label && block.props.text === message));
  });
  await check("one click appends the PARA check-in at the end, and one undo removes only the appended entry", async () => {
    await editor.getByRole("button", { name: label }).click();
    await persisted(hasAppended);
    await browser.keyboard.press("Control+z");
    const undo = await persisted(ws => !hasAppended(ws));
    assert.ok(body(undo).some(block => block.props?.label === label));
    assert.ok(JSON.stringify(body(undo)[0].content).includes("阅读笔记"));
    await editor.getByRole("button", { name: label }).click();
    await persisted(hasAppended);
    await browser.reload();
    await editor.getByText(message, { exact: true }).waitFor();
  });
  await check("native table button double click creates one durable record", async () => {
    await browser.locator('[data-node-id="database-page"]').first().click();
    const first = browser.getByRole("button", { name: button.name, exact: true }).first();
    await first.dblclick();
    const records = ws => ws.databaseItems.filter(item => item.actionReceipt?.operationId);
    const after = await persisted(ws => records(ws).length > 0);
    assert.equal(records(after).length, 1);
    const receipt = records(after)[0];
    assert.equal(receipt.sourceId, "partners");
    assert.ok(after.pages.find(entry => entry.id === receipt.pageId).title.endsWith(" · 新供应记录"));
    await browser.reload();
    const reloaded = await persisted(ws => records(ws).length === 1);
    assert.ok(records(reloaded).some(item => item.id === receipt.id));
  });
}, { workspace });
