import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const client = process.argv[2] ? path.resolve(process.argv[2]) : fileURLToPath(new URL("../../dist/client/", import.meta.url));
const evidence = process.argv[3] && path.resolve(process.argv[3]);
if (evidence) await fs.mkdir(evidence, { recursive: true });
const origin = "https://life-atlas-assistant-fixture.invalid";
const reasoningFixture = {
  prompt: "用两步说明复利。",
  first: "先明确本金和利率。\n",
  second: "然后核对 <em>年末结息</em> 的计算公式。",
  answer: "先把上一期利息计入本金，再按新本金计息。",
};
const browser = await chromium.launch({ channel: "msedge", headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const file = path.resolve(client, `.${decodeURIComponent(url.pathname)}`);
    if (path.relative(client, file).startsWith("..")) return route.abort();
    try { await route.fulfill({ path: file }); }
    catch { await route.fulfill({ status: 404 }); }
  });
  await context.addInitScript(({ prompt, first, second, answer }) => {
    const ok = (value) => ({ ok: true, value });
    const read = (key, fallback) => JSON.parse(sessionStorage.getItem(key)) ?? fallback;
    const write = (key, value) => sessionStorage.setItem(key, JSON.stringify(value));
    const config = () => read("assistant-provider", { configured: true, baseUrl: "http://127.0.0.1:8123/v1", model: "fixture-model", configurationId: "initial", hasApiKey: false });
    const history = () => read("assistant-history", {});
    const attachment = (name, mimeType, size) => {
      const image = mimeType === "image/png";
      const id = (image ? "a" : "b").repeat(64);
      return { id, name, mimeType, size, assetUrl: `life-asset://${id}`, kind: image ? "image" : "text",
        ...(image ? { imageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l7sAAAAASUVORK5CYII=" } : { text: "Fixture attachment text" }) };
    };
    window.assistantRequests = [];
    window.assistantAttachments = [];
    window.assistantLoadedAttachments = [];
    window.assistantChecks = [];
    window.lifeAtlas = { assistant: {
      getConfig: async () => ok(config()),
      configure: async (args) => {
        const next = { ...config(), ...args, configurationId: "updated" };
        write("assistant-provider", next);
        return ok(next);
      },
      complete: async (args, onReasoning) => {
        if (args.messages[0].content === "连接测试。请只回复 OK。") {
          window.assistantChecks.push(args);
          return ok({ role: "assistant", content: "OK" });
        }
        window.assistantRequests.push(args);
        if (args.messages.at(-1).content === prompt) {
          onReasoning?.(first);
          await new Promise((resolve) => { window.advanceAssistantReasoning = resolve; });
          onReasoning?.(first + second);
          await new Promise((resolve) => { window.finishAssistantReasoning = resolve; });
          return ok({ role: "assistant", content: answer, reasoning: first + second });
        }
        return ok({ role: "assistant", content: `回复 ${window.assistantRequests.length}` });
      },
      cancel: async () => ok({}),
      listConversations: async () => ok({ activeId: read("active-conversation", null), conversations: Object.values(history()).reverse().map(({ messages, ...entry }) => entry) }),
      getConversation: async ({ id }) => ok(history()[id]),
      saveConversation: async ({ conversation, activeId }) => {
        const { messages, ...entry } = conversation;
        const meta = { ...entry, revision: entry.revision + 1, updatedAt: new Date().toISOString() };
        write("assistant-history", { ...history(), [entry.id]: { ...meta, messages } });
        if (activeId !== undefined) write("active-conversation", activeId);
        return ok(meta);
      },
      selectConversation: async ({ id }) => { write("active-conversation", id); return ok({ activeId: id }); },
      prepareAttachment: async ({ name, mimeType, bytes }) => {
        window.assistantAttachments.push({ name, mimeType, size: bytes.byteLength });
        return ok(attachment(name, mimeType, bytes.byteLength));
      },
      loadAttachment: async ({ assetUrl, name }) => {
        window.assistantLoadedAttachments.push(name);
        return ok(attachment(name, assetUrl.endsWith("a") ? "image/png" : "text/plain", 8));
      },
    } };
  }, reasoningFixture);

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/index.html`);
  const launcher = page.getByRole("button", { name: "打开 AI 助手" });
  const panel = page.getByRole("complementary", { name: "AI 助手" });
  const log = panel.getByRole("log", { name: "对话记录" });
  const textbox = panel.getByRole("textbox", { name: "给助手发消息" });
  const scope = panel.getByRole("combobox", { name: "对话范围" });
  const send = () => panel.getByRole("button", { name: "发送", exact: true }).click();
  const capture = async (name) => { if (evidence) await panel.screenshot({ path: path.join(evidence, `${name}.png`) }); };
  const activeConversation = () => page.evaluate(() => JSON.parse(sessionStorage.getItem("assistant-history"))[JSON.parse(sessionStorage.getItem("active-conversation"))]);

  await launcher.click();
  await textbox.fill("三十摄氏度等于多少华氏度？");
  assert.equal(await scope.inputValue(), "auto");
  await send();
  await log.getByText("回复 1", { exact: true }).waitFor();
  assert.equal((await activeConversation()).messages[0].workspaceEnabled, true);
  assert.equal(await log.locator(".assistant-reasoning").count(), 0);
  await textbox.fill("第二条草稿");
  await panel.getByRole("button", { name: "模型连接", exact: true }).click();
  await panel.getByLabel("模型 ID").fill("updated-fixture-model");
  await panel.getByRole("button", { name: "保存连接" }).click();
  await panel.getByText("连接设置已保存", { exact: true }).waitFor();
  await panel.getByRole("button", { name: "测试已保存的连接" }).click();
  await panel.getByText("模型已响应，连接正常。", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.assistantChecks.at(-1).configurationId), "updated");
  await capture("model-connection");
  await panel.getByRole("button", { name: "返回对话" }).click();
  assert.equal(await textbox.inputValue(), "第二条草稿");
  await log.getByText("回复 1", { exact: true }).waitFor();
  await send();
  await log.getByText("回复 2", { exact: true }).waitFor();
  const rawSecond = await page.evaluate(() => window.assistantRequests.at(-1));
  assert.equal(rawSecond.configurationId, "updated");
  assert.equal(rawSecond.workspaceEnabled, true);
  assert.ok(rawSecond.messages.some(({ role, content }) => role === "assistant" && content === "回复 1"));
  const original = await activeConversation();

  await panel.getByRole("button", { name: "对话历史", exact: true }).click();
  await panel.getByRole("button", { name: /重命名对话 三十摄氏度/ }).click();
  await panel.getByRole("textbox", { name: "对话名称" }).fill("温度讨论");
  await panel.getByRole("button", { name: "保存", exact: true }).click();
  await capture("history");
  await panel.getByRole("button", { name: /^温度讨论/ }).click();
  await log.getByRole("button", { name: "编辑消息" }).first().click();
  assert.equal(await scope.inputValue(), "general");
  await panel.getByRole("textbox", { name: "编辑消息文本" }).fill("请总结当前页面");
  await capture("edit-message");
  await panel.getByRole("button", { name: "发送修改" }).click();
  await log.getByText("回复 3", { exact: true }).waitFor();
  const branch = await activeConversation();
  assert.equal(branch.sourceId, original.id);
  assert.equal(branch.messages[0].workspaceEnabled, false);
  assert.equal((await page.evaluate(() => window.assistantRequests.at(-1))).workspaceEnabled, false);
  await log.getByRole("button", { name: "打开原对话" }).click();
  await log.getByText("第二条草稿", { exact: true }).waitFor();
  assert.deepEqual((await activeConversation()).messages, original.messages);

  await panel.getByRole("button", { name: "新建对话" }).click();
  await panel.getByText("有什么可以帮你？").waitFor();
  await page.locator(".workspace-sidebar .sidebar-page-main").filter({ hasText: "化学" }).click();
  await textbox.fill("如何创建数据库？");
  await panel.locator(".assistant-page-context").getByText("当前页面 化学", { exact: true }).waitFor();
  await scope.selectOption("general");
  assert.equal(await panel.locator(".assistant-page-context").count(), 0);
  await textbox.fill("这两个附件有什么内容？");

  const chooserPromise = page.waitForEvent("filechooser");
  await panel.getByRole("button", { name: "添加文件或图片" }).click();
  await (await chooserPromise).setFiles({ name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("Attachment fixture") });
  await panel.getByText("note.txt", { exact: true }).waitFor();
  await textbox.focus();
  await page.evaluate(() => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" }));
    document.activeElement.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  await panel.getByText("photo.png", { exact: true }).waitFor();
  await capture("composer-attachments");
  await send();
  await log.getByText("回复 4", { exact: true }).waitFor();
  const withFiles = await activeConversation();
  assert.deepEqual(withFiles.messages[0].attachments.map(({ name }) => name), ["note.txt", "photo.png"]);
  assert.ok(withFiles.messages[0].attachments.every((attachment) => attachment.assetUrl && !attachment.text && !attachment.imageUrl));
  assert.deepEqual(await page.evaluate(() => window.assistantAttachments.map(({ name }) => name)), ["note.txt", "photo.png"]);
  const rawAttachmentRequest = await page.evaluate(() => JSON.stringify(window.assistantRequests.at(-1).messages));
  assert.match(rawAttachmentRequest, /Fixture attachment text/);
  assert.match(rawAttachmentRequest, /data:image\/png;base64,/);

  await page.reload();
  await launcher.click();
  await log.getByText("回复 4", { exact: true }).waitFor();
  await log.getByText("note.txt", { exact: true }).waitFor();
  await scope.selectOption("general");
  await textbox.fill("请再读上面两个附件");
  await send();
  await log.getByText("回复 1", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.assistantLoadedAttachments), ["note.txt", "photo.png"]);

  const reasoning = log.locator(".assistant-reasoning");
  const reasoningBody = reasoning.locator(".assistant-reasoning-text");
  const reasoningToggle = reasoning.locator("summary");
  await log.evaluate((element) => { element.style.maxHeight = "185px"; });
  await textbox.fill(reasoningFixture.prompt);
  await send();
  await reasoningBody.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const log = document.querySelector(".assistant-transcript");
    const thinking = log?.querySelector(".assistant-reasoning-text");
    return log && thinking && log.scrollHeight > log.clientHeight
      && log.scrollHeight - log.clientHeight - log.scrollTop <= 1
      && thinking.getBoundingClientRect().bottom <= log.getBoundingClientRect().bottom;
  }, undefined, { timeout: 3000 });
  await log.evaluate((element) => { element.style.maxHeight = ""; });
  assert.equal(await reasoningBody.textContent(), reasoningFixture.first);
  assert.equal(await log.getByText(reasoningFixture.answer, { exact: true }).count(), 0);
  await capture("reasoning-live-light-floating");
  await reasoningToggle.press("Enter");
  await reasoningBody.waitFor({ state: "hidden" });
  await page.evaluate(() => window.advanceAssistantReasoning());
  const fullReasoning = reasoningFixture.first + reasoningFixture.second;
  await page.waitForFunction((text) => document.querySelector(".assistant-reasoning-text")?.textContent === text, fullReasoning);
  assert.equal(await reasoningBody.isVisible(), false);
  await reasoningToggle.press("Enter");
  await reasoningBody.waitFor({ state: "visible" });
  assert.equal(await reasoningBody.textContent(), fullReasoning);
  await reasoningToggle.press("Enter");
  await page.evaluate(() => window.finishAssistantReasoning());
  await log.getByText(reasoningFixture.answer, { exact: true }).waitFor();
  await panel.getByRole("button", { name: "发送", exact: true }).waitFor();
  assert.equal(await reasoningBody.isVisible(), false);
  assert.equal((await activeConversation()).messages.at(-1).reasoning, fullReasoning);

  await page.reload();
  await launcher.click();
  await log.getByText(reasoningFixture.answer, { exact: true }).waitFor();
  assert.equal(await reasoningBody.isVisible(), false);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.locator('html[data-style="mobai"][data-theme="dark"]').waitFor();
  assert.match(await panel.getAttribute("class"), /\bis-docked\b/u);
  await panel.getByRole("button", { name: "切换到小窗" }).click();
  assert.match(await panel.getAttribute("class"), /\bis-floating\b/u);
  await panel.getByRole("button", { name: "固定在右侧" }).click();
  assert.match(await panel.getAttribute("class"), /\bis-docked\b/u);
  await reasoningToggle.press("Space");
  await reasoningBody.waitFor({ state: "visible" });
  assert.equal(await reasoningBody.textContent(), fullReasoning);
  assert.equal(await reasoningBody.locator("em").count(), 0);
  await capture("reasoning-history-dark-docked");

  await page.evaluate(() => {
    const id = JSON.parse(sessionStorage.getItem("active-conversation"));
    const history = JSON.parse(sessionStorage.getItem("assistant-history"));
    const messages = history[id].messages;
    const label = "搜索网页「円谷プロ ウルトラマン ヒーロー図鑑 tsuburaya-prod.com hero gallery」";
    const detail = "没有获取新的内容，已返回本地结果。";
    messages.splice(messages.length - 1, 0,
      { role: "tool", id: "wrap-first", content: `${label} · ${detail}` },
      { role: "tool", id: "wrap-second", content: `${label} · ${detail}` },
      { role: "tool", id: "wrap-path", content: `查找图片 · ${"uncut-filename-".repeat(10)}.png` });
    sessionStorage.setItem("assistant-history", JSON.stringify(history));
    localStorage.setItem("life-atlas.assistant.width", "340");
  });
  await page.reload();
  await launcher.click();
  await log.getByText(reasoningFixture.answer, { exact: true }).waitFor();
  await reasoningToggle.click();
  const steps = reasoning.getByRole("list", { name: "执行步骤" });
  await steps.getByText("×2").waitFor();
  const dimensions = await steps.locator("li").evaluateAll((rows) => rows.map((row) => {
    const text = row.querySelector(".assistant-process-step-main");
    const detail = row.querySelector(".assistant-process-step-detail");
    const fragments = [...detail.getClientRects()];
    return { lines: text.offsetHeight / parseFloat(getComputedStyle(text).lineHeight),
      overflow: row.scrollWidth - row.clientWidth, detailWidth: Math.max(...fragments.map((rect) => rect.width)) };
  }));
  assert.equal(dimensions.length, 2);
  for (const row of dimensions) {
    assert.ok(row.overflow <= 1, JSON.stringify(row));
    assert.ok(row.lines <= 6 && row.detailWidth > 50, JSON.stringify(row));
  }
  await capture("tool-lines-dark-docked");
  assert.deepEqual(errors, []);
  console.log("Assistant UI verified: provider changes, chat memory, history rename and reopen, edit fork, scopes, attachments, reasoning streams, collapse, reload, docked dark theme.");
} finally { await browser.close(); }
