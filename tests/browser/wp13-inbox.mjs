import { browserScenario, shootBothModes } from "./harness.mjs";
import { fullWorkspace, FIXTURE_TIME } from "../fixtures/full-workspace.mjs";
import { walkBlocks } from "../../src/domain/blockDocument.js";

const workspace = fullWorkspace();
workspace.ui.preferences = { theme: "system" };
const autoBody = "这是一条从正文自动取得标题的快速记录，用来确认中文与表情不会被截断🌿继续记录更多文字";
const autoTitle = [...autoBody].slice(0, 30).join("");
const markdown = "# 本周研究\n- 阅读论文\n1. 整理笔记\n- [ ] 复现实验\n> 想法先存下来\n```js\nconst complete = true;\n```\n\n普通 **粗体** 与 *斜体* 和 `代码`。";

await browserScenario("wp13-inbox", async ({ page, check, screenshot, saved, persisted, assert }) => {
  await page.clock.install({ time: new Date(FIXTURE_TIME) });
  await page.reload();
  const sidebar = page.getByRole("complementary", { name: "主导航" });
  await page.locator('.life-editor[data-page-id="p-a1"] .bn-editor').first().waitFor();
  const inboxButton = sidebar.getByRole("button", { name: "收件箱", exact: true });
  const capture = page.getByRole("dialog", { name: "快速记录", exact: true });
  const pendingPages = (value) => value.pages.filter((entry) => entry.folderId === "system-inbox" && !entry.trashedAt);
  const createCapture = async (title, body) => {
    await page.keyboard.press("Control+Shift+n");
    await capture.waitFor();
    await capture.getByLabel("记录标题", { exact: true }).fill(title);
    await capture.getByLabel("记录正文", { exact: true }).fill(body);
    await capture.getByRole("button", { name: "保存", exact: true }).click();
    await capture.waitFor({ state: "hidden" });
    return persisted((value) => pendingPages(value).some((entry) => entry.title === title));
  };
  const finishArchive = async () => {
    const dialog = page.getByRole("dialog", { name: "归档到…", exact: true });
    await dialog.getByRole("option", { name: "Z 其他", exact: true }).click();
    await dialog.getByRole("button", { name: "归档", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  };
  let capturedId;
  let automaticId;

  await check("Quick capture works from the sidebar and the keyboard", async () => {
    await sidebar.getByRole("button", { name: "快速记录", exact: true }).click();
    await capture.getByLabel("记录标题", { exact: true }).fill("文献调研");
    await capture.getByLabel("记录正文", { exact: true }).fill(markdown);
    await capture.getByLabel("记录正文", { exact: true }).evaluate((element) => { element.scrollTop = 0; });
    await shootBothModes(page, screenshot, "capture", { keepVisible: '[aria-label="快速记录"][role="dialog"]' });
    await capture.getByLabel("记录正文", { exact: true }).press("Control+Enter");
    await capture.waitFor({ state: "hidden" });
    const first = await persisted((value) => pendingPages(value).some((entry) => entry.title === "文献调研"));
    capturedId = pendingPages(first).find((entry) => entry.title === "文献调研").id;
    await page.keyboard.press("Control+Shift+n");
    await capture.getByLabel("记录正文", { exact: true }).fill(autoBody);
    await capture.getByRole("button", { name: "保存", exact: true }).click();
    const second = await persisted((value) => pendingPages(value).some((entry) => entry.title === autoTitle));
    automaticId = pendingPages(second).find((entry) => entry.title === autoTitle).id;
    assert.equal([...pendingPages(second).find((entry) => entry.id === automaticId).title].length, 30);
  });

  await check("Saved notes are inbox pages with converted blocks", async () => {
    const current = await saved();
    const note = current.pages.find((entry) => entry.id === capturedId);
    assert.equal(note.folderId, "system-inbox");
    assert.ok(note.inboxedAt);
    assert.equal(note.databaseItemId, undefined);
    assert.equal(note.databaseSourceId, undefined);
    assert.equal(note.settings.presentationMode, "default");
    assert.deepEqual(note.content.map((block) => block.type), ["heading", "bulletListItem", "numberedListItem", "checkListItem", "quote", "codeBlock", "paragraph"]);
    assert.equal(note.content[0].props.level, 1);
    assert.equal(note.content[3].props.checked, false);
    assert.equal(note.content[5].props.language, "js");
    assert.equal(note.content.at(-1).content.filter((entry) => Object.keys(entry.styles || {}).length > 0).length, 3);
    assert.equal(pendingPages(current).length, 2);
    assert.equal(await inboxButton.locator(".inbox-nav-badge").innerText(), "2");
  });

  await check("Archiving moves the same page and updates the count", async () => {
    await inboxButton.click();
    await page.getByRole("button", { name: "归档 文献调研", exact: true }).click();
    await finishArchive();
    const single = await persisted((value) => value.pages.find((entry) => entry.id === capturedId)?.folderId === "f-z");
    assert.equal(single.pages.find((entry) => entry.id === capturedId).inboxedAt, null);
    assert.equal(single.pages.filter((entry) => entry.id === capturedId).length, 1);
    assert.equal(await inboxButton.locator(".inbox-nav-badge").innerText(), "1");
    const extra = await createCapture("补充记录", "补充复现步骤与实验注意事项。");
    const extraId = pendingPages(extra).find((entry) => entry.title === "补充记录").id;
    await shootBothModes(page, screenshot, "inbox-pending");
    await page.getByRole("checkbox", { name: `选择 ${autoTitle}`, exact: true }).check();
    await page.getByRole("checkbox", { name: "选择 补充记录", exact: true }).check();
    await page.locator(".inbox-batch").getByRole("button", { name: "归档到…", exact: true }).click();
    await finishArchive();
    const batch = await persisted((value) => pendingPages(value).length === 0);
    for (const pageId of [automaticId, extraId]) {
      assert.equal(batch.pages.find((entry) => entry.id === pageId).folderId, "f-z");
      assert.equal(batch.pages.find((entry) => entry.id === pageId).inboxedAt, null);
    }
    assert.equal(await inboxButton.locator(".inbox-nav-badge").count(), 0);
  });

  await check("The inbox is searchable and hidden from the private tree", async () => {
    await createCapture("收件箱检索线索", "尚未归档的知识也应可以搜索。");
    assert.equal(await sidebar.locator('[data-node-id="system-inbox"]').count(), 0);
    assert.equal(await sidebar.locator('.tree-folder-main[title="收件箱"]').count(), 0);
    await page.keyboard.press("Control+k");
    const search = page.getByRole("dialog", { name: "全局搜索", exact: true });
    await search.getByRole("combobox", { name: "搜索文件夹、页面与正文" }).fill("收件箱检索线索");
    const result = search.locator(".search-result-copy").filter({ hasText: "收件箱检索线索" }).first();
    await result.waitFor();
    assert.equal(await result.locator("small").innerText(), "收件箱");
    await page.keyboard.press("Escape");
  });

  await check("A mention reminder fires and opens its page", async () => {
    await sidebar.getByRole("button", { name: "Private 更多选项", exact: true }).click();
    await page.getByRole("menu", { name: "Private 更多选项" }).getByRole("menuitem", { name: "展开全部", exact: true }).click();
    await page.keyboard.press("Control+k");
    const search = page.getByRole("dialog", { name: "全局搜索", exact: true });
    await search.getByRole("combobox", { name: "搜索文件夹、页面与正文" }).fill("A 子页面");
    await search.locator(".search-result-row").filter({ has: page.locator("strong", { hasText: "A 子页面" }) }).first().click();
    await page.locator('.life-editor[data-page-id="p-a1-child"] .bn-editor').waitFor();
    const trailing = page.locator(".bn-editor .bn-trailing-block");
    if (await trailing.count()) await trailing.last().click();
    else await page.locator(".bn-editor .bn-inline-content").last().click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("@提醒");
    await page.getByRole("option").filter({ hasText: "提醒" }).first().click();
    const reminder = page.getByRole("dialog", { name: "提醒", exact: true });
    const when = await page.evaluate(() => {
      const date = new Date();
      date.setSeconds(0, 0);
      date.setMinutes(date.getMinutes() + 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    });
    await reminder.getByLabel("提醒时间", { exact: true }).fill(when);
    await reminder.getByRole("button", { name: "确定", exact: true }).click();
    await persisted((value) => walkBlocks(value.pages.find((entry) => entry.id === "p-a1-child").content).some((block) => block.content?.some?.((inline) => inline.type === "dateMention" && inline.props.kind === "reminder" && inline.props.value === when)));
    await page.clock.fastForward("01:05");
    const fired = await persisted((value) => value.ui.reminderLog.some((entry) => entry.pageId === "p-a1-child"));
    const entry = fired.ui.reminderLog.find((item) => item.pageId === "p-a1-child");
    assert.equal(entry.missed, false);
    assert.equal(entry.readAt, null);
    assert.equal(entry.source, "提及");
    await inboxButton.click();
    await page.getByRole("tab", { name: /^提醒/ }).click();
    await shootBothModes(page, screenshot, "inbox-reminders");
    await page.locator(".inbox-reminder-row").filter({ hasText: "A 子页面" }).click();
    await page.waitForFunction(() => document.querySelector(".page-title-input")?.value === "A 子页面");
    await persisted((value) => value.ui.reminderLog.find((item) => item.key === entry.key)?.readAt);
  });
}, { workspace, now: FIXTURE_TIME, viewport: { width: 1440, height: 900 } });
