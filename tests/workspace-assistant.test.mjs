import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { registerAssistantIpc } from "../electron/main/assistant/ipc.js";
import { createBlankWorkspace } from "../src/domain/blankWorkspace.js";
import { projectViewItems } from "../src/domain/database.js";
import { checkWorkspaceIntegrity } from "../src/domain/integrity.js";
import { restorePageVersion } from "../src/domain/pageHistory.js";
import { isAssistantTaskContinuation, runWorkspaceAssistant } from "../src/assistant/runWorkspaceAssistant.js";
import { executeWorkspaceTool } from "../src/assistant/workspaceTools.js";

const channelPrefix = "la:assistant:";
const now = "2026-11-23T14:50:00.000Z";
const token = "fixture-token-for-local-provider";
const userMessage = (content) => [{ role: "user", content }];
const tool = (id, name, args) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const reply = (response, content, tool_calls = undefined) => {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content, ...(tool_calls ? { tool_calls } : {}) } }] }));
};
const completionResponse = (content, tool_calls) => Response.json({ choices: [{ message: { role: "assistant", content, tool_calls } }] });

function testSafeStorage() {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },
    decryptString(buffer) {
      const decipher = createDecipheriv("aes-256-gcm", key, buffer.subarray(0, 12));
      decipher.setAuthTag(buffer.subarray(12, 28));
      return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString("utf8");
    },
  };
}

function createHarness(t, { safeStorage = testSafeStorage(), ...options } = {}) {
  const temporaryParent = fs.realpathSync(os.tmpdir());
  const configDirectory = fs.mkdtempSync(path.join(temporaryParent, "life-atlas-assistant-test-"));
  const handlers = new Map();
  const sender = Object.assign(new EventEmitter(), { id: 17, mainFrame: { routingId: 8, processId: 19 } });
  const event = { sender, senderFrame: sender.mainFrame };
  const close = registerAssistantIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), removeHandler: (name) => handlers.delete(name) },
    getWorkspaceWindow: () => ({ webContents: sender }), configDirectory, safeStorage, ...options,
  });
  t.after(() => {
    close();
    assert.equal(path.dirname(configDirectory), temporaryParent);
    fs.rmSync(configDirectory, { recursive: true });
  });
  return {
    configDirectory, event,
    call: (command, args, dispatch = event) => handlers.get(channelPrefix + command)(dispatch, args),
  };
}

async function localProvider(t, handler) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    const entry = { body, headers: request.headers, path: request.url };
    requests.push(entry);
    try { await handler(response, entry, requests.length, request); }
    catch (error) {
      t.diagnostic(error.stack);
      response.writeHead(500).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
}

function fixture() {
  let sequence = 0;
  return createBlankWorkspace({ now, idFactory: (prefix) => `${prefix}-fixture-${++sequence}` });
}

test("a just-written page gets a check and confirmation without another user message", async () => {
  let workspace = fixture();
  let rounds = 0;
  const messages = userMessage("请创建一个名为「展览笔记」的新页面，联网查资料，写入后检查结果。");
  const result = await runWorkspaceAssistant({
    messages,
    workspaceEnabled: true,
    getWorkspace: () => workspace,
    applyWorkspace: async (apply) => {
      const operation = apply(workspace);
      workspace = operation.workspace;
      return operation;
    },
    complete: async ({ messages: transcript, tools, workspaceEnabled }) => {
      rounds += 1;
      let calls;
      if (rounds < 30) calls = [tool(`search-${rounds}`, "search_web", { query: `exhibition ${rounds}` })];
      if (rounds === 30) calls = [tool("create-note", "create_page", { title: "展览笔记", markdown: "展览正文" })];
      if (rounds === 31) {
        assert.match(transcript[0].content, /Check its saved content/);
        assert.equal(tools && workspaceEnabled, true);
        calls = [tool("check-note", "read_page", { page_id: workspace.pages.find((page) => page.title === "展览笔记").id })];
      }
      return { ok: true, value: { role: "assistant", content: calls ? null : "页面已建立并检查。", ...(calls ? { tool_calls: calls } : {}) } };
    },
    assistant: {
      web: async ({ args }) => ({ ok: true, value: { results: [{ title: args.query, url: `https://gallery.example/${encodeURIComponent(args.query)}` }] } }),
    },
    onContinuation: () => assert.fail("A newly written page can be checked in the same run."),
  });
  assert.equal(rounds, 32);
  assert.equal(result, "页面已建立并检查。");
  assert.equal(workspace.pages.filter((page) => page.title === "展览笔记").length, 1);
});

test("a public-image edit verifies direct URLs without requiring web keywords in the request", async () => {
  const direct = "https://photo.example/portrait.png";
  const verified = "https://cdn.photo.example/portrait.png";
  for (const allowWeb of [false, true]) {
    let workspace = fixture();
    const target = workspace.ui.selectedPageId;
    let importCount = 0;
    let calls = 0;
    await runWorkspaceAssistant({
      messages: userMessage(allowWeb ? "请联网为当前页面添加一张图片。" : "请为当前页面添加一张图片。"),
      workspaceEnabled: true,
      getWorkspace: () => workspace,
      getCurrentPageId: () => target,
      applyWorkspace: async (apply) => {
        const operation = apply(workspace);
        workspace = operation.workspace;
        return operation;
      },
      complete: async () => {
        calls += 1;
        return { ok: true, value: calls === 1
          ? { role: "assistant", content: null, tool_calls: [tool("insert-verified", "update_page", {
            page_id: "current", blocks: [{ type: "image", url: direct, caption: "图源已验证" }],
          })] }
          : { role: "assistant", content: "已处理。" } };
      },
      assistant: {
        importWebImage: async ({ url }) => {
          importCount += 1;
          assert.equal(url, direct);
          return { ok: true, value: { url: `life-asset://${"a".repeat(64)}`, verifiedUrl: verified, kind: "image", name: "portrait.png" } };
        },
      },
    });
    assert.equal(importCount, 1);
    const images = workspace.pages.find(({ id }) => id === target).content.filter(({ type }) => type === "image");
    assert.equal(images.length, 1);
  }
});

test("a short overwrite uses the previous current page even after navigation", async (t) => {
  let workspace = fixture();
  const targetId = workspace.ui.selectedPageId;
  const otherId = "page-other";
  workspace = { ...workspace, pages: [
    ...workspace.pages.map((page) => page.id === targetId ? { ...page, title: "奥特曼图鉴 · 五位光之巨人" } : page),
    { ...workspace.pages.find((page) => page.id === targetId), id: otherId, title: "另一份页面" },
  ] };
  const prompt = "把当前页面的版面重做一版。";
  const messages = [
    { role: "user", content: prompt, workspaceEnabled: true, contextPageId: targetId },
    { role: "assistant", content: "这里是一份重新排版的草稿。" },
    { role: "user", content: "直接覆盖", workspaceEnabled: true, contextPageId: otherId },
  ];
  const app = createHarness(t);
  const provider = await localProvider(t, (response, { body }, step) => {
    if (step === 1) return reply(response, null, [
      tool("overwrite", "update_page", { page_id: "current", markdown: "版本 | 状态\n--- | ---\n第二版 | 已完成", mode: "replace" }),
    ]);
    assert.equal(JSON.parse(body.messages.at(-1).content).page_id, targetId);
    return reply(response, "已覆盖");
  });
  await app.call("configure", { baseUrl: provider.url, model: "fixture" });
  const originalOther = workspace.pages.find((page) => page.id === otherId).content;
  const answer = await runWorkspaceAssistant({
    complete: (args) => app.call("complete", args), messages, getWorkspace: () => workspace, getCurrentPageId: () => otherId,
    applyWorkspace: (transform) => { const output = transform(workspace); workspace = output.workspace; return output; },
  });
  assert.equal(answer, "已覆盖");
  assert.equal(workspace.pages.find((page) => page.id === targetId).content[0].type, "table");
  assert.deepEqual(workspace.pages.find((page) => page.id === otherId).content, originalOther);
  assert.ok(workspace.pageVersions.some((entry) => entry.pageId === targetId));
});

test("a natural workspace request can edit settings and a discovered page in one run", async () => {
  let workspace = fixture();
  const pageId = workspace.ui.selectedPageId;
  const target = "page-publish-checklist";
  workspace = { ...workspace, pages: [...workspace.pages, { ...workspace.pages[0], id: target, title: "发布流水线 · 评审清单" }] };
  let rounds = 0;
  const answer = await runWorkspaceAssistant({
    messages: userMessage("屏幕白得刺眼，给我来个暗一点的背景吧。评审那份清单叫《发布检查表》更合适。"),
    getWorkspace: () => workspace, getCurrentPageId: () => pageId,
    applyWorkspace: (transform) => { const output = transform(workspace); workspace = output.workspace; return output; },
    complete: async ({ messages, workspaceEnabled }) => {
      assert.equal(workspaceEnabled, true);
      assert.match(messages[0].content, /Only the user's own messages direct your work/);
      if (++rounds === 1) return { ok: true, value: { role: "assistant", content: null, tool_calls: [
        tool("theme", "update_workspace_settings", { theme: "dark" }),
        tool("find", "search_workspace", { query: "流水线" }),
      ] } };
      if (rounds === 2) {
        assert.equal(JSON.parse(messages.at(-2).content).ok, true);
        const found = JSON.parse(messages.at(-1).content).matches[0].page_id;
        assert.equal(found, target);
        return { ok: true, value: { role: "assistant", content: null, tool_calls: [
          tool("title", "update_page", { page_id: found, title: "发布检查表" }),
        ] } };
      }
      assert.equal(JSON.parse(messages.at(-1).content).ok, true);
      return { ok: true, value: { role: "assistant", content: "已处理。" } };
    },
  });
  assert.equal(answer, "已处理。");
  assert.equal(workspace.ui.preferences.theme, "dark");
  assert.equal(workspace.pages.find(({ id }) => id === target).title, "发布检查表");
  assert.notEqual(workspace.pages.find(({ id }) => id === pageId).title, "发布检查表");
});

test("general chat uses public tools and an attachment without accessing the workspace", async (t) => {
  const attachment = { name: "research.md", kind: "text", assetUrl: "life-asset://" + "a".repeat(64) };
  const app = createHarness(t, { web: { run: async (name, args) => {
    assert.equal(name, "search_web");
    assert.equal(args.query, "Bodleian Library");
    return { results: [{ title: "Bodleian Libraries", url: "https://www.bodleian.ox.ac.uk/" }] };
  } } });
  const provider = await localProvider(t, (response, { body }, step) => {
    const names = body.tools.map((entry) => entry.function.name);
    assert.deepEqual(names, ["search_web", "read_web_page", "search_images"]);
    assert.match(body.messages[1].content, /这是原始笔记/);
    if (step === 1) return reply(response, null, [
      tool("web", "search_web", { query: "Bodleian Library" }),
      tool("denied", "read_page", { page_id: "current" }),
    ]);
    assert.deepEqual(body.messages.slice(-2).map((entry) => JSON.parse(entry.content).ok), [true, false]);
    return reply(response, "公开资料与附件里的笔记已经核对。");
  });
  await app.call("configure", { baseUrl: provider.url, model: "fixture" });
  const answer = await runWorkspaceAssistant({
    complete: (args) => app.call("complete", args),
    assistant: {
      web: (args) => app.call("web", args),
      loadAttachment: async () => ({ ok: true, value: { ...attachment, text: "这是原始笔记" } }),
    },
    workspaceEnabled: false, messages: [{ role: "user", content: "联网核对附件", attachments: [attachment] }],
    attachments: [attachment],
    getWorkspace: () => assert.fail("general chat read the workspace"),
    applyWorkspace: () => assert.fail("general chat mutated the workspace"),
  });
  assert.match(answer, /已经核对/);
});

test("assistant turns public images into persistent page assets and writes editable native blocks", async (t) => {
  const source = "https://images.example.com/camera.jpg";
  const managed = "life-asset://" + "b".repeat(64);
  let workspace = fixture();
  const app = createHarness(t, { web: { run: async () => ({ results: [{ image_url: source, source_url: "https://example.com/photo", license: "CC BY 4.0" }] }) } });
  const provider = await localProvider(t, (response, { body }, step) => {
    if (step === 1) return reply(response, null, [tool("search", "search_images", { query: "Radcliffe Camera" })]);
    assert.ok(JSON.parse(body.messages.at(-1).content).ok);
    if (step === 2) return reply(response, null, [tool("author", "create_page", {
      title: "牛津图书馆研学",
      blocks: [
        { type: "section", heading: "牛津图书馆" },
        { type: "image", url: source },
        { type: "table", rows: [["图书馆", "地址"], ["Radcliffe Camera", "Oxford"]] },
        { type: "columns", columns: [[{ type: "markdown", markdown: "左侧" }], [{ type: "callout", markdown: "右侧" }]] },
      ],
    })]);
    return reply(response, "图文页面已创建。");
  });
  await app.call("configure", { baseUrl: provider.url, model: "fixture" });
  const downloads = [];
  await runWorkspaceAssistant({
    complete: (args) => app.call("complete", args),
    assistant: {
      web: (args) => app.call("web", args),
      importWebImage: async ({ url }) => {
        downloads.push(url);
        return { ok: true, value: { url: managed, name: "camera.jpg", mime: "image/jpeg", kind: "image" } };
      },
    },
    messages: userMessage("联网找图并为我创建一个牛津图书馆页面。"), getWorkspace: () => workspace,
    applyWorkspace: (transform) => { const output = transform(workspace); workspace = output.workspace; return output; },
  });
  const content = workspace.pages.find(({ title }) => title === "牛津图书馆研学").content;
  assert.deepEqual(downloads, [source]);
  assert.deepEqual(content.map(({ type }) => type), ["heading", "image", "table", "columnList"]);
  assert.equal(content[1].props.url, managed);
});

test("no-new image searches leave all tools available and reuse previously sourced images", async (t) => {
  const imageUrl = "https://images.example.com/camera.jpg";
  const source = { image_url: imageUrl, source_url: "https://example.com/photo", title: "Radcliffe Camera" };
  const managedUrl = "life-asset://" + "c".repeat(64);
  const searches = [];
  let workspace = fixture();
  let checkpoint;
  const progress = [];
  const app = createHarness(t, { web: { run: async (name, args) => {
    assert.equal(name, "search_images");
    searches.push(args.query);
    if (searches.length === 1) return { results: [source] };
    if (searches.length === 2) return { results: [{ ...source, image_url: `${imageUrl}#same-image` }] };
    return { results: [] };
  } } });
  const provider = await localProvider(t, (response, { body }, step) => {
    const names = body.tools.map(({ function: entry }) => entry.name);
    const last = () => JSON.parse(body.messages.at(-1).content);
    if (step === 1) return reply(response, null, [tool("first-image", "search_images", { query: "Radcliffe Camera" })]);
    if (step === 2) {
      assert.equal(last().new_candidates, 1);
      return reply(response, null, [tool("repeat-image", "search_images", { query: "  ＲＡＤＣＬＩＦＦＥ， CAMERA  " })]);
    }
    if (step === 3) {
      assert.equal(last().repeated_query, true);
      return reply(response, null, [tool("same-source", "search_images", { query: "Oxford tower" })]);
    }
    if (step === 4) {
      assert.equal(last().new_candidates, 0);
      assert.match(last().next_step, /different source/u);
      return reply(response, null, [tool("empty-source", "search_images", { query: "Oxford archive" })]);
    }
    if (step === 5) {
      assert.match(last().next_step, /different source/u);
      for (const name of ["search_images", "search_web", "read_web_page", "read_page", "update_page"]) assert.ok(names.includes(name));
      return reply(response, null, [
        tool("cached-search", "search_images", { query: "Radcliffe Camera" }),
        tool("append-image", "update_page", { page_id: "current", markdown: `![Radcliffe Camera](${imageUrl})`, mode: "append" }),
      ]);
    }
    assert.equal(step, 6);
    const cached = JSON.parse(body.messages.at(-2).content);
    assert.equal(cached.cached, true);
    assert.deepEqual(cached.results, [source]);
    assert.equal(last().changed, true);
    return reply(response, "已将取得的照片追加在当前页面。");
  });
  await app.call("configure", { baseUrl: provider.url, model: "fixture" });
  const answer = await runWorkspaceAssistant({
    complete: (args) => app.call("complete", args), messages: userMessage("请搜图并把找到的照片追加到当前页面。"),
    getWorkspace: () => workspace,
    applyWorkspace: (transform) => { const output = transform(workspace); workspace = output.workspace; return output; },
    assistant: {
      web: (args) => app.call("web", args),
      importWebImage: async ({ url }) => { assert.equal(url, imageUrl); return { ok: true, value: { url: managedUrl, name: "Camera", mime: "image/jpeg" } }; },
    },
    onTool: (event) => progress.push(event), onContinuation: (state) => { checkpoint = state; },
  });
  assert.deepEqual(searches, ["Radcliffe Camera", "Oxford tower", "Oxford archive"]);
  assert.deepEqual(progress.map(({ kind }) => kind), ["candidates", "skipped", "empty", "empty", "skipped", "downloaded", "written"]);
  assert.equal(answer, "已将取得的照片追加在当前页面。");
  assert.equal(checkpoint, undefined);
  assert.ok(workspace.pages.find(({ id }) => id === workspace.ui.selectedPageId).content.some((block) => block.type === "image" && block.props.url === managedUrl));
});

test("a genuinely new image resets the empty-search streak and verbatim call IDs are still deduplicated", async () => {
  const query = (step) => tool(step < 2 ? "same-id" : `search-${step}`, "search_images", { query: step < 2 ? "first" : `image ${step}` });
  const attempts = [];
  const progress = [];
  let turn = 0;
  const answer = await runWorkspaceAssistant({
    complete: async ({ imageSearchEnabled }) => {
      assert.equal(imageSearchEnabled, true);
      if (turn === 5) return { ok: true, value: { content: "已有候选，可按需采用。" } };
      return { ok: true, value: { content: null, tool_calls: [query(turn++)] } };
    },
    workspaceEnabled: false, messages: userMessage("请帮我在线搜索公开图片。"),
    getWorkspace: () => assert.fail("general chat read the workspace"),
    assistant: { web: async ({ args }) => {
      attempts.push(args.query);
      const results = args.query === "image 2" ? [{ image_url: "https://example.com/usable.jpg" }] : [];
      return { ok: true, value: { results } };
    } },
    onTool: ({ kind }) => progress.push(kind), onContinuation: () => assert.fail("new image did not reset the empty-search streak"),
  });
  assert.equal(answer, "已有候选，可按需采用。");
  assert.deepEqual(attempts, ["first", "image 2", "image 3", "image 4"]);
  assert.deepEqual(progress, ["empty", "skipped", "candidates", "empty", "empty"]);
});

test("an unproductive provider stops with a truthful checkpoint while advertised tools stay stable", async (t) => {
  let workspace = fixture();
  const searches = [];
  const app = createHarness(t, { web: { run: async (_name, { query }) => {
    searches.push(query);
    return { results: [] };
  } } });
  const provider = await localProvider(t, (response, { body }, step) => {
    const calls = [tool(`image-${step}`, "search_images", { query: "Radcliffe Camera" })];
    if (step === 5) calls.push(tool("append-text", "update_page", { page_id: "current", markdown: "已验证的正文" }));
    return reply(response, null, calls);
  });
  await app.call("configure", { baseUrl: provider.url, model: "fixture" });
  let checkpoint;
  const answer = await runWorkspaceAssistant({
    complete: (args) => app.call("complete", args),
    messages: userMessage("请搜图并向当前页面追加正文。"),
    getWorkspace: () => workspace,
    applyWorkspace: (transform) => { const output = transform(workspace); workspace = output.workspace; return output; },
    assistant: { web: (args) => app.call("web", args) },
    onContinuation: (state) => { checkpoint = state; },
  });
  assert.deepEqual(searches, ["Radcliffe Camera"]);
  assert.equal(provider.requests.length, 11);
  const firstTools = provider.requests[0].body.tools;
  assert.ok(firstTools.some(({ function: { name } }) => name === "search_images"));
  for (const { body } of provider.requests) assert.deepEqual(body.tools, firstTools);
  assert.match(answer, /连续多轮没有获得新资料或写入进展.*已写入 1 项更改/su);
  assert.doesNotMatch(answer, /达到上限/u);
  assert.match(JSON.stringify(workspace.pages[0].content), /已验证的正文/u);
  assert.equal(checkpoint.completedWrites.length, 1);
});

test("fresh evidence allows authoring past the former call and round cutoffs", async () => {
  let workspace = fixture();
  let round = 0;
  let searches = 0;
  const answer = await runWorkspaceAssistant({
    messages: userMessage("请搜图并将小结追加到当前页面。"),
    getWorkspace: () => workspace,
    applyWorkspace: (transform) => { const output = transform(workspace); workspace = output.workspace; return output; },
    complete: async ({ tools, messages, imageSearchEnabled }) => {
      assert.equal(tools, true);
      round += 1;
      if (round <= 34) {
        assert.equal(imageSearchEnabled, true);
        return { ok: true, value: { content: null, tool_calls: Array.from({ length: 4 }, (_, i) =>
          tool(`image-${round}-${i}`, "search_images", { query: `Image ${round}-${i}` })) } };
      }
      assert.equal(imageSearchEnabled, true);
      if (round === 35) {
        assert.equal(JSON.parse(messages.at(-1).content).new_candidates, 1);
        return { ok: true, value: { content: null, tool_calls: [tool("finish-page", "update_page", { page_id: "current", markdown: "小结已写入" })] } };
      }
      assert.equal(JSON.parse(messages.at(-1).content).changed, true);
      return { ok: true, value: { content: "已补充小结。" } };
    },
    assistant: { web: async () => ({ ok: true, value: { results: [{ image_url: `https://example.com/image-${++searches}.jpg` }] } }) },
  });
  assert.equal(searches, 136);
  assert.match(answer, /已补充小结。/u);
  assert.match(JSON.stringify(workspace.pages.find(({ id }) => id === workspace.ui.selectedPageId).content), /小结已写入/u);
});

test("mixed public research and workspace authoring use the same authorized tools", async (t) => {
  const names = ["search_web", "read_web_page", "search_images"];
  const requests = [];
  const searches = [];
  let workspace = fixture();
  const webCall = (index) => {
    const name = names[index % names.length];
    return tool(`public-${index}`, name, name === "read_web_page" ? { url: `https://example.com/source-${index}` } : { query: `Oxford ${index}` });
  };
  const app = createHarness(t, {
    web: { run: async (name) => {
      searches.push(name);
      const slug = `https://example.com/source-${searches.length}`;
      if (name === "search_images") return { results: [{ image_url: `${slug}.jpg`, source_url: slug }] };
      if (name === "read_web_page") return { url: slug, text: "A fresh public source" };
      return { results: [{ title: "A fresh public source", url: slug }] };
    } },
    fetchImpl: async (_url, { body }) => {
      const request = JSON.parse(body);
      const advertised = request.tools?.map(({ function: entry }) => entry.name);
      const round = requests.push(request);
      if (!advertised) return completionResponse("还需要写入页面。");
      if (round <= 3) {
        return completionResponse(null, Array.from({ length: 12 }, (_, index) => webCall((round - 1) * 12 + index)));
      }
      if (round === 4) return completionResponse(null, [
        webCall(36), webCall(37), webCall(38),
        tool("local-read", "read_page", { page_id: "current", metadata_only: true }),
        tool("finish-page", "update_page", { page_id: "current", markdown: "牛津资料已整理。" }),
      ]);
      return completionResponse("已更新牛津研学笔记。");
    },
  });
  await app.call("configure", { baseUrl: "https://provider.example.com", model: "fixture" });
  const answer = await runWorkspaceAssistant({
    complete: (args) => app.call("complete", args),
    assistant: { web: (args) => app.call("web", args) },
    messages: userMessage("请联网搜图、查资料，把牛津研学小结追加到当前页面。"),
    getWorkspace: () => workspace,
    applyWorkspace: (transform) => { const output = transform(workspace); workspace = output.workspace; return output; },
  });
  const page = workspace.pages.find(({ id }) => id === workspace.ui.selectedPageId);
  assert.match(JSON.stringify(page.content), /牛津资料已整理/u, "fresh research exhausted the run before the requested page was written");
  assert.equal(answer, "已更新牛津研学笔记。");
  assert.equal(searches.length, 39);
  assert.deepEqual([...new Set(searches)], names);
  assert.equal(requests.length, 5);
  const writeRound = requests[3];
  const advertised = writeRound.tools.map(({ function: entry }) => entry.name);
  assert.ok(advertised.includes("read_page") && advertised.includes("update_page"));
  assert.ok(names.every((name) => advertised.includes(name)));
  for (const request of requests) assert.deepEqual(request.tools, requests[0].tools);
  const outputs = (request, count) => request.messages.slice(-count).map(({ content }) => JSON.parse(content));
  assert.ok(outputs(writeRound, 8).every(({ ok }) => ok));
  assert.ok(outputs(requests[4], 5).every(({ ok }) => ok));
});

test("long tool transcripts retain complete groups within the provider message limit", async (t) => {
  const previous = Array.from({ length: 23 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `历史 ${index}` }));
  const messages = [...previous, ...userMessage("查找公开资料。")];
  let rounds = 0;
  let requests = 0;
  const app = createHarness(t, {
    web: { run: async () => ({ results: [{ title: "A public source", url: `https://example.com/${++requests}` }] }) },
    fetchImpl: async (_url, { body }) => {
      const request = JSON.parse(body);
      rounds += 1;
      if (rounds === 29) {
        assert.deepEqual(request.messages.slice(1, 25), messages);
        assert.ok(request.messages.length <= 160);
        const groups = request.messages.slice(25);
        assert.ok(groups.length < 28 * 5);
        for (let index = 0; index < groups.length; index += 5) {
          assert.deepEqual(groups.slice(index + 1, index + 5).map(({ tool_call_id }) => tool_call_id), groups[index].tool_calls.map(({ id }) => id));
        }
        return completionResponse("资料已核对。");
      }
      return completionResponse(null, Array.from({ length: 4 }, (_, index) =>
        tool(`web-${rounds}-${index}`, "search_web", { query: `Subject ${rounds}-${index}` })));
    },
  });
  await app.call("configure", { baseUrl: "https://provider.example.com", model: "fixture" });
  const answer = await runWorkspaceAssistant({ messages, workspaceEnabled: false, complete: (args) => app.call("complete", args),
    assistant: { web: (args) => app.call("web", args) } });
  assert.equal(answer, "资料已核对。");
  assert.equal(rounds, 29);
  assert.equal(requests, 112);
});

test("the full-tool recovery and last-resort compose preserve original inputs and sourced native content", async (t) => {
  for (const interruption of ["text stall", "HTTP 400", "extended research"]) await t.test(interruption, async (t) => {
    const title = "牛津橱窗";
    const sourceUrl = "https://example.com/oxford/profile";
    const subjectUrl = "https://example.com/oxford/subject";
    const otherSubjectUrl = "https://example.com/oxford/other-subject";
    const directImage = "https://example.com/oxford/official.jpg";
    const alternateImage = "https://example.com/oxford/alternative.jpg";
    const managedUrl = "life-asset://" + "d".repeat(64);
    const attachment = { name: "Oxford.md", kind: "text", assetUrl: "life-asset://" + "e".repeat(64), text: "用户提供的原始笔记" };
    const user = { role: "user", content: `请直接在这个测试工作区搭建一个名为「${title}」的新页面。使用有策展感的原生分栏、人物图片和资料来源，可以联网。`, attachments: [attachment] };
    const attempts = [];
    const downloads = [];
    const readUrls = [];
    const regular = [];
    let activeReads = 0;
    let peakReads = 0;
    let workspace = fixture();
    const initial = workspace;
    const compose = (id, image) => completionResponse(null, [tool(id, "create_page", { title, blocks: [
      { type: "section", heading: "牛津人物" },
      { type: "columns", columns: [
        [{ type: "image", url: image }],
        [{ type: "markdown", markdown: `牛津的历史记录。 [原始资料](${sourceUrl})` }],
      ] },
    ] })]);
    const app = createHarness(t, {
      web: { run: async (name, { query, url }) => {
        if (name === "search_web") return { results: [{ title: "Oxford guide", url: sourceUrl, snippet: "Search excerpt" }] };
        if (name === "read_web_page") {
          readUrls.push(url);
          activeReads += 1;
          peakReads = Math.max(peakReads, activeReads);
          await new Promise((resolve) => setImmediate(resolve));
          activeReads -= 1;
          return { title: "Oxford official profile", url, text: "Verified body excerpt",
            links: url === sourceUrl ? [{ title: "Oxford subject profile", url: subjectUrl }, { title: "Another Oxford profile", url: otherSubjectUrl }] : [],
            images: [{ image_url: directImage, source_url: url, title: "Oxford official photograph" }] };
        }
        return { results: [{ image_url: query === "Oxford image 1" ? alternateImage : `${alternateImage}?q=${encodeURIComponent(query)}`,
          source_url: sourceUrl, license: "CC BY", author: "Oxford photographer" }] };
      } },
      fetchImpl: async (_url, { body }) => {
        const request = JSON.parse(body);
        if (request.tool_choice?.function?.name === "create_page") {
          attempts.push(request);
          return compose(`compose-${attempts.length}`, attempts.length > 1 ? alternateImage : directImage);
        }
        const researchRounds = regular.push(request);
        if (researchRounds === 1 || (interruption === "extended research" && researchRounds <= 32)) return completionResponse(null, [
          tool(`source-${researchRounds}`, "search_web", { query: `Oxford ${researchRounds}` }),
          tool(`image-${researchRounds}`, "search_images", { query: `Oxford image ${researchRounds}` }),
          tool(`profile-${researchRounds}`, "read_web_page", { url: sourceUrl }),
        ]);
        if (interruption === "extended research") {
          return researchRounds === 33 ? compose("regular-create", directImage) : completionResponse(`已创建页面《${title}》。`);
        }
        if (interruption === "HTTP 400") {
          if (researchRounds === 2) return Response.json({ error: { message: "Provider request rejected" } }, { status: 400 });
          if (researchRounds === 3) return completionResponse(null, [tool("official-subject", "read_web_page", { url: subjectUrl }),
            tool("other-official-subject", "read_web_page", { url: otherSubjectUrl })]);
          if (researchRounds === 4) return compose("regular-create", directImage);
          return completionResponse(`已创建页面《${title}》。`);
        }
        return completionResponse("我整理好了资料，稍后制作页面。");
      },
    });
    await app.call("configure", { baseUrl: "https://provider.example.com", model: "fixture" });
    const answer = await runWorkspaceAssistant({
      messages: [user], attachments: [attachment], complete: (args) => app.call("complete", args),
      getWorkspace: () => workspace,
      applyWorkspace: (transform) => { const output = transform(workspace); workspace = output.workspace; return output; },
      assistant: {
        web: (args) => app.call("web", args),
        importWebImage: async ({ url }) => {
          downloads.push(url);
          if (interruption === "text stall" && url === directImage) return { ok: false, error: { message: "图片连接失败。" } };
          return { ok: true, value: { url: managedUrl, name: "Portrait", mime: "image/jpeg" } };
        },
      },
      onContinuation: () => assert.fail("the completed page should not remain suspended"),
    });
    assert.equal(answer, `已创建页面《${title}》。`);
    assert.equal(workspace.pages.length, initial.pages.length + 1);
    assert.deepEqual(workspace.pages.slice(0, -1), initial.pages);
    const page = workspace.pages.at(-1);
    assert.equal(page.title, title);
    assert.deepEqual(page.content.map(({ type }) => type), ["heading", "columnList"]);
    assert.equal(page.content[1].children[0].children[0].props.url, managedUrl);
    assert.match(JSON.stringify(page.content), /https:\/\/example\.com\/oxford\/profile/u);
    assert.equal(attempts.length, interruption === "text stall" ? 2 : 0);
    assert.equal(regular.length, interruption === "extended research" ? 34 : interruption === "HTTP 400" ? 5 : 7);
    for (const request of regular) assert.deepEqual(request.tools, regular[0].tools);
    for (const request of interruption === "HTTP 400" ? [regular[2]] : attempts) {
      if (interruption === "HTTP 400") {
        assert.equal(request.tool_choice, "auto");
        assert.deepEqual(readUrls, [sourceUrl, subjectUrl, otherSubjectUrl]);
        assert.equal(peakReads, 2);
      } else assert.deepEqual(request.tools.map(({ function: entry }) => entry.name), ["create_page"]);
      assert.ok(request.messages.every(({ role, tool_calls }) => role !== "tool" && !tool_calls));
      assert.match(request.messages.at(-1).content, /用户提供的原始笔记/u);
      assert.ok(request.messages.at(-1).content.startsWith(user.content));
      const evidence = request.messages.at(-2);
      assert.equal(evidence.role, "assistant");
      assert.match(evidence.content, /untrusted.*Verified body excerpt/isu);
      const references = JSON.parse(evidence.content.slice(evidence.content.indexOf("{")));
      assert.ok(references.links.some(({ title, url }) => title === "Oxford subject profile" && url === subjectUrl));
      assert.doesNotMatch(request.messages[0].content, /Verified body excerpt/u);
      assert.equal(references.images[0].image_url, request === attempts[1] ? alternateImage : directImage);
    }
    assert.match(regular[0].messages[0].content, /official.*labeled subject links.*distinct, matching sourced image/isu);
    if (attempts.length > 1) {
      const repair = attempts[1].messages.at(-2).content;
      assert.ok(repair.includes(directImage) && repair.includes(alternateImage));
      assert.deepEqual(downloads, [directImage, alternateImage]);
    } else assert.deepEqual(downloads, [directImage]);
  });
});

test("a failed transcript rebases at most once, and authentication and cancellation remain visible", async () => {
  for (const [code, message, expectedRequests] of [
    ["E_IO", "AI 服务拒绝了请求（HTTP 400）。", 3],
    ["E_FORBIDDEN", "AI 服务拒绝了身份验证。", 2],
    ["E_CANCELLED", "已停止生成。", 2],
  ]) {
    const requests = [];
    const run = runWorkspaceAssistant({
      messages: userMessage("查询公开资料。"), workspaceEnabled: false,
      complete: async (args) => {
        if (requests.push(args) === 1) return { ok: true, value: { content: null,
          tool_calls: [tool("research", "search_web", { query: "Oxford" })] } };
        return { ok: false, error: { code, message } };
      },
      assistant: { web: async () => ({ ok: true, value: { results: [{ title: "A public source", url: "https://example.com/" }] } }) },
    });
    if (code === "E_CANCELLED") await assert.rejects(run, { name: "AbortError" });
    else assert.ok((await run).includes(message));
    assert.equal(requests.length, expectedRequests);
    assert.ok(requests.every(({ tools, imageSearchEnabled, webResearchEnabled, requiredPageTool }) =>
      tools && imageSearchEnabled && webResearchEnabled === undefined && requiredPageTool === undefined));
    if (code === "E_IO") {
      assert.ok(requests[1].messages.some(({ role }) => role === "tool"));
      assert.ok(!requests[2].messages.some(({ role }) => role === "tool"));
    }
  }
});

test("a compose handoff is never forced for chat, advice, negative requests or existing-page and database actions", async () => {
  for (const [request, workspaceEnabled] of [
    ["请联网找图，创建一个新页面。", false],
    ["请联网找资料，告诉我怎样创建页面。", true],
    ["请联网找图，但不要创建页面。", true],
    ["请联网找资料，创建一个数据库页面。", true],
    ["请联网查资料，创建一个段落到当前页面。", true],
    ["Find an Oxford image and add it to the current page.", true],
  ]) {
    let round = 0;
    const answer = await runWorkspaceAssistant({
      workspaceEnabled, messages: userMessage(request), getWorkspace: () => fixture(),
      applyWorkspace: () => assert.fail("unauthorized workspace write"),
      complete: async ({ requiredPageTool }) => {
        assert.equal(requiredPageTool, undefined, request);
        if (round++ === 0) return { ok: true, value: { content: null, tool_calls: [tool("public", "search_web", { query: "Oxford" })] } };
        return { ok: true, value: { content: "资料已返回。" } };
      },
      assistant: { web: async () => ({ ok: true, value: { results: [{ title: "Source", url: "https://example.com/" }] } }) },
    });
    assert.equal(answer, "资料已返回。", request);
  }
});

test("image-only stalls remain resumable and an explicit new page may still follow a different source", async () => {
  const subject = "https://example.com/official/subject";
  const image = `${subject}.jpg`;
  const managed = "life-asset://" + "a".repeat(64);
  const original = userMessage("请联网找图，创建一个名为「人物橱窗」的新页面，用原生分栏展示人物图片及资料来源。");
  let workspace = fixture();
  const initial = workspace;
  let checkpoint;
  let resuming = false;
  let rounds = 0;
  let imageQueries = 0;
  const settings = {
    getWorkspace: () => workspace,
    applyWorkspace: (transform) => { const output = transform(workspace); workspace = output.workspace; return output; },
    complete: async ({ tools, imageSearchEnabled, webResearchEnabled, requiredPageTool }) => {
      assert.ok(tools && imageSearchEnabled && webResearchEnabled === undefined && requiredPageTool === undefined);
      rounds += 1;
      if (!resuming) return { ok: true, value: { tool_calls: [tool(`miss-${rounds}`, "search_images", { query: "generic portraits" })] } };
      if (rounds === 1) return { ok: true, value: { tool_calls: [tool("official-search", "search_web", { query: "official subject profile" })] } };
      if (rounds === 2) return { ok: true, value: { tool_calls: [tool("official-read", "read_web_page", { url: subject })] } };
      if (rounds === 3) return { ok: true, value: { tool_calls: [tool("create", "create_page", { title: "人物橱窗", blocks: [
        { type: "columns", columns: [[{ type: "image", url: image }], [{ type: "markdown", markdown: `[人物介绍](${subject})` }]] },
      ] })] } };
      return { ok: true, value: { content: "已创建人物橱窗。" } };
    },
    assistant: {
      web: async ({ name }) => {
        if (name === "search_images") {
          imageQueries += 1;
          return { ok: true, value: { results: Array.from({ length: 3 }, (_, index) => ({ image_url: `https://example.com/unrelated-${index}.jpg` })) } };
        }
        if (name === "search_web") return { ok: true, value: { results: [{ title: "Official subject", url: subject }] } };
        return { ok: true, value: { url: subject, title: "Official subject", text: "Official subject profile", images: [{ image_url: image, source_url: subject }] } };
      },
      importWebImage: async ({ url }) => {
        assert.equal(url, image);
        return { ok: true, value: { url: managed, name: "Portrait", mime: "image/jpeg" } };
      },
    },
  };
  const partial = await runWorkspaceAssistant({ ...settings, messages: original, onContinuation: (state) => { checkpoint = state; } });
  assert.match(partial, /尚未写入工作区/u);
  assert.equal(workspace, initial);
  assert.equal(imageQueries, 1);
  resuming = true;
  rounds = 0;
  const answer = await runWorkspaceAssistant({ ...settings, resume: checkpoint, messages: [...original,
    { role: "assistant", content: partial }, ...userMessage("继续本次任务")] });
  assert.equal(answer, "已创建人物橱窗。");
  assert.equal(workspace.pages.at(-1).content[0].children[0].children[0].props.url, managed);
});

test("a malformed provider action after the research rounds produces a resumable no-write status", async (t) => {
  const imageUrl = "https://example.com/camera-1.jpg";
  const profileUrl = "https://example.com/camera/profile";
  const managedUrl = "life-asset://" + "a".repeat(64);
  const rawAction = '<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="update_page">\n</｜｜DSML｜｜ calls>';
  let workspace = fixture();
  let checkpoint;
  let resuming = false;
  let searches = 0;
  const reads = [];
  const downloads = [];
  const requests = [];
  const app = createHarness(t, {
    web: { run: async (name, { url }) => {
      if (name === "read_web_page") {
        reads.push(url);
        return { title: "Camera directory", url, text: "Camera public profile", links: [{ title: "Official subject", url: profileUrl }] };
      }
      return { results: [{ image_url: `https://example.com/camera-${++searches}.jpg` }] };
    } },
    fetchImpl: async (_url, { body }) => {
      const request = JSON.parse(body);
      const round = requests.push(request);
      if (!resuming) {
        if (round === 1) return completionResponse(null, [tool("directory", "read_web_page", { url: "https://example.com/camera/" })]);
        if (round === 5 || round === 6) return completionResponse(rawAction);
        return completionResponse(null, [tool(`image-${round}`, "search_images", { query: `Oxford camera ${round}` })]);
      }
      if (request.messages.at(-1).role === "user") return completionResponse(null, [
        tool("fresh-profile", "read_web_page", { url: profileUrl }),
        tool("append-sourced-image", "update_page", { page_id: "current", markdown: `![Radcliffe Camera](${imageUrl})` }),
      ]);
      return completionResponse("已把图片追加到当前页面。");
    },
  });
  await app.call("configure", { baseUrl: "https://provider.example.com", model: "fixture" });
  const task = userMessage("请联网找图并把找到的照片追加到当前页面。");
  const base = {
    complete: (args) => app.call("complete", args),
    getWorkspace: () => workspace,
    applyWorkspace: (transform) => { const output = transform(workspace); workspace = output.workspace; return output; },
    assistant: {
      web: (args) => app.call("web", args),
      importWebImage: async ({ url }) => {
        downloads.push(url);
        return { ok: true, value: { url: managedUrl, name: "Camera", mime: "image/jpeg" } };
      },
    },
  };
  const initial = workspace;
  const partial = await runWorkspaceAssistant({ ...base, messages: task, onContinuation: (state) => { checkpoint = state; } });
  assert.match(partial, /尚未写入工作区/u);
  assert.match(partial, /无法执行的工具指令/u);
  assert.doesNotMatch(partial, /DSML/u);
  assert.equal(workspace, initial);
  assert.equal(checkpoint.completedWrites.length, 0);
  assert.equal(searches, 3);
  assert.equal(requests.length, 6);
  assert.deepEqual(requests[5].tools, requests[0].tools);
  assert.equal(requests[5].messages.some(({ role }) => role === "tool"), false);
  assert.deepEqual(checkpoint.publicLinks.map(([, link]) => link.title), ["Official subject"]);
  assert.deepEqual(downloads, []);

  resuming = true;
  const answer = await runWorkspaceAssistant({
    ...base, resume: checkpoint, messages: [...task, { role: "assistant", content: partial }, ...userMessage("继续本次任务")],
    onContinuation: () => assert.fail("the completed page should not remain suspended"),
  });
  assert.equal(answer, "已把图片追加到当前页面。");
  assert.deepEqual(downloads, [imageUrl]);
  assert.equal(searches, 3);
  assert.deepEqual(reads, ["https://example.com/camera/", profileUrl]);
  assert.deepEqual(requests[6].tools, requests[0].tools);
  assert.match(requests[6].messages.at(-2).content, /Official subject/u);
  assert.equal(JSON.parse(requests[7].messages.at(-2).content).ok, true);
  assert.ok(workspace.pages.find(({ id }) => id === workspace.ui.selectedPageId).content.some(({ type, props }) => type === "image" && props.url === managedUrl));
});

test("confirmed writes reset the progress guard and only unfinished changes may run again", async () => {
  let workspace = fixture();
  const targetId = workspace.ui.selectedPageId;
  const otherId = "page-navigated-away";
  workspace = { ...workspace, pages: [...workspace.pages, { ...workspace.pages.find(({ id }) => id === targetId), id: otherId, title: "另一页" }] };
  const otherContent = workspace.pages.at(-1).content;
  const original = userMessage("请给当前页面追加三段，并确认已添加。文章包含初稿标记、校对标记和续做标记。");
  const base = { getWorkspace: () => workspace, applyWorkspace: (transform) => { const output = transform(workspace); workspace = output.workspace; return output; } };
  let calls = 0;
  let checkpoint;
  const summary = await runWorkspaceAssistant({
    ...base, messages: original, getCurrentPageId: () => targetId,
    complete: async ({ tools, webResearchEnabled }) => {
      calls += 1;
      assert.equal(tools, true);
      assert.equal(webResearchEnabled, undefined);
      const call = calls === 1 ? tool("initial-write", "update_page", { page_id: "current", markdown: "初稿标记" })
        : calls === 6 ? tool("second-write", "update_page", { page_id: "current", markdown: "校对标记" })
        : tool(`read-${calls}`, "read_page", { page_id: "current", metadata_only: true });
      return { ok: true, value: { content: null, tool_calls: [call] } };
    },
    onContinuation: (state) => { checkpoint = state; },
  });
  assert.match(summary, /连续多轮没有获得新资料或写入进展.*已写入 2 项更改/u);
  assert.equal(calls, 12);
  assert.ok(isAssistantTaskContinuation("继续本次任务"));
  assert.equal(isAssistantTaskContinuation("继续并另建页面"), false);
  const resumedMessages = [...original, { role: "assistant", content: summary }, ...userMessage("继续本次任务")];
  const beforeReplay = workspace;
  let replayRounds = 0;
  await runWorkspaceAssistant({
    ...base, resume: checkpoint, messages: resumedMessages, getCurrentPageId: () => otherId,
    complete: async ({ tools }) => tools
      ? { ok: true, value: { content: null, tool_calls: [tool(`replay-${++replayRounds}`, "update_page", { page_id: "current", markdown: "初稿标记" })] } }
      : { ok: false, error: { message: "final provider unavailable" } },
  });
  assert.equal(replayRounds, 6);
  assert.equal(workspace, beforeReplay);
  const events = [];
  let resumed = false;
  const answer = await runWorkspaceAssistant({
    ...base, resume: checkpoint, messages: resumedMessages,
    getCurrentPageId: () => otherId, onTool: (event) => events.push(event),
    complete: async ({ messages }) => {
      if (!resumed) {
        assert.match(messages.at(-1).content, /文章包含初稿标记、校对标记和续做标记/u);
        resumed = true;
        return { ok: true, value: { content: null, tool_calls: [
          tool("repeat-alias", "update_page", { mode: "append", markdown: "初稿标记", page_id: targetId }),
          tool("wrong-target", "update_page", { page_id: "nonexistent-page", markdown: "误写页面" }),
          tool("remaining", "update_page", { page_id: "current", markdown: "续做标记" }),
        ] } };
      }
      assert.deepEqual(messages.slice(-3).map(({ content }) => JSON.parse(content).already_completed ?? JSON.parse(content).ok), [true, false, true]);
      return { ok: true, value: { content: "已追加剩余段落。" } };
    },
    onContinuation: () => assert.fail("completed continuation should not remain suspended"),
  });
  assert.equal(answer, "已追加剩余段落。");
  const originalPage = JSON.stringify(workspace.pages.find(({ id }) => id === targetId).content);
  assert.equal(originalPage.match(/初稿标记/gu)?.length, 1);
  assert.equal(originalPage.match(/校对标记/gu)?.length, 1);
  assert.equal(originalPage.match(/续做标记/gu)?.length, 1);
  assert.deepEqual(workspace.pages.find(({ id }) => id === otherId).content, otherContent);
  assert.deepEqual(events.map(({ kind, ok }) => [kind, ok]), [["skipped", true], ["other", false], ["written", true]]);
});

test("vision inputs fall back to local OCR if the model only accepts text", async (t) => {
  const assetUrl = "life-asset://" + "f".repeat(64);
  const picture = { name: "photo.png", kind: "image", assetUrl, imageUrl: "data:image/png;base64,ABCD" };
  const app = createHarness(t);
  const provider = await localProvider(t, (response, { body }, step) => {
    if (step === 1) {
      assert.equal(body.messages[1].content[1].type, "image_url");
      response.writeHead(400, { "Content-Type": "application/json" });
      return response.end(JSON.stringify({ error: { message: "This model does not support image input" } }));
    }
    assert.match(body.messages[1].content, /本地图中文字/);
    return reply(response, "已读取图片文字。");
  });
  await app.call("configure", { baseUrl: provider.url, model: "fixture" });
  const answer = await runWorkspaceAssistant({
    complete: (args) => app.call("complete", args),
    assistant: { recognizeAttachment: async (request) => {
      assert.equal(request.assetUrl, assetUrl);
      return { ok: true, value: { text: "本地图中文字" } };
    } },
    workspaceEnabled: false, attachments: [picture], messages: [{ role: "user", content: "", attachments: [picture] }],
  });
  assert.match(answer, /已读取/);
  assert.equal(provider.requests.length, 2);
});

test("later text attachments keep earlier user images available to a vision model", async () => {
  const attachments = [
    { name: "left.png", kind: "image", assetUrl: "life-asset://" + "1".repeat(64), imageUrl: "data:image/png;base64,AAAA" },
    { name: "right.png", kind: "image", assetUrl: "life-asset://" + "2".repeat(64), imageUrl: "data:image/png;base64,BBBB" },
    { name: "notes.md", kind: "text", assetUrl: "life-asset://" + "3".repeat(64), text: "对比两张截图" },
  ];
  const history = attachments.map((entry, index) => ({ role: "user", content: "附件 " + index, attachments: [entry] }));
  await runWorkspaceAssistant({
    workspaceEnabled: false, messages: history, attachments,
    complete: async ({ messages }) => {
      assert.deepEqual(messages.filter(({ role, content }) => role === "user" && Array.isArray(content))
        .map(({ content }) => content[1].image_url.url), attachments.slice(0, 2).map(({ imageUrl }) => imageUrl));
      assert.match(messages.at(-1).content, /对比两张截图/);
      return { ok: true, value: { role: "assistant", content: "已收到" } };
    },
  });
});

test("assistant IPC is opt-in, workspace-frame only, and keeps API keys in OS-encrypted config", async (t) => {
  const app = createHarness(t);
  const provider = await localProvider(t, (response) => reply(response, `已连接 ${token}`));
  const initial = await app.call("get-config");
  assert.deepEqual(initial.value, { configured: false, baseUrl: "", model: "", hasApiKey: false, configurationId: null });
  assert.equal((await app.call("complete", { messages: userMessage("你好") })).error.code, "E_INVALID_ARGUMENT");
  assert.equal(provider.requests.length, 0);
  for (const baseUrl of ["http://example.invalid/v1", "https://user:pass@example.invalid", "https://example.invalid/?api_key=raw"]) {
    assert.equal((await app.call("configure", { baseUrl, model: "test", apiKey: token })).error.code, "E_INVALID_ARGUMENT");
  }
  const { event } = app;
  const childFrame = { ...event, senderFrame: { ...event.senderFrame, routingId: 29 } };
  assert.equal((await app.call("configure", { baseUrl: provider.url, model: "test", apiKey: token }, childFrame)).error.code, "E_FORBIDDEN");
  assert.equal(fs.readdirSync(app.configDirectory).length, 0);
  const configured = await app.call("configure", { baseUrl: provider.url + "/v1/", model: "fixture-model", apiKey: token });
  assert.equal(configured.ok, true);
  assert.equal(configured.value.baseUrl, provider.url + "/v1");
  assert.equal(configured.value.hasApiKey, true);
  assert.equal(JSON.stringify(configured).includes(token), false);
  const entries = fs.readdirSync(app.configDirectory);
  assert.deepEqual(entries, ["provider.json"]);
  const file = fs.readFileSync(path.join(app.configDirectory, entries[0]), "utf8");
  assert.equal(file.includes(token), false);
  assert.equal(Buffer.from(JSON.parse(file).encryptedKey, "base64").includes(Buffer.from(token)), false);
  const response = await app.call("complete", { messages: userMessage("你好"), tools: false, configurationId: configured.value.configurationId });
  assert.deepEqual(response, { ok: true, value: { role: "assistant", content: "已连接 〔已隐藏〕" } });
  assert.equal(provider.requests[0].headers.authorization, `Bearer ${token}`);
  assert.equal(provider.requests[0].path, "/v1/chat/completions");
  assert.deepEqual(provider.requests[0].body, { model: "fixture-model", messages: userMessage("你好"), stream: false });
  assert.equal((await app.call("configure", { baseUrl: provider.url + "/different", model: "fixture-model" })).ok, false);
  assert.equal((await app.call("configure", { baseUrl: provider.url, model: "fixture-model-2" })).value.hasApiKey, true);
  assert.equal((await app.call("complete", { messages: userMessage("你好"), configurationId: configured.value.configurationId })).error.code, "E_CONFLICT");
  assert.equal(provider.requests.length, 1);
  const cleared = await app.call("configure", { baseUrl: provider.url.replace("127.0.0.1", "localhost"), model: "fixture-model-2", clearApiKey: true });
  assert.equal(cleared.value.hasApiKey, false);
  await app.call("complete", { messages: userMessage("本机") });
  assert.equal(provider.requests[1].headers.authorization, undefined);
  assert.equal(provider.requests[1].path, "/v1/chat/completions");
});

test("assistant IPC refuses weak credential storage and blocks provider redirects", async (t) => {
  const origin = await localProvider(t, (response, entry) => {
    if (entry.path === "/redirect/chat/completions") return response.writeHead(307, { Location: target.url }).end();
    return response.writeHead(401).end(token);
  });
  const target = await localProvider(t, (response) => reply(response, "unexpected"));
  const weak = createHarness(t, { safeStorage: { ...testSafeStorage(), getSelectedStorageBackend: () => "basic_text" } });
  const unsafe = await weak.call("configure", { baseUrl: origin.url, model: "fixture", apiKey: token });
  assert.equal(unsafe.error.code, "E_IO");
  assert.deepEqual(fs.readdirSync(weak.configDirectory), []);
  const app = createHarness(t);
  await app.call("configure", { baseUrl: origin.url + "/redirect", model: "fixture", apiKey: token });
  assert.match((await app.call("complete", { messages: userMessage("test") })).error.message, /重定向/);
  assert.equal(origin.requests.length, 1);
  assert.equal(target.requests.length, 0);
  await app.call("configure", { baseUrl: origin.url + "/bad-auth", model: "fixture", apiKey: token });
  const denied = await app.call("complete", { messages: userMessage("test") });
  assert.equal(denied.error.code, "E_FORBIDDEN");
  assert.equal(JSON.stringify(denied).includes(token), false);
});

test("assistant runs real loopback tool rounds without sending unrelated records and applies against current state", async (t) => {
  let workspace = fixture();
  const pageId = workspace.ui.selectedPageId;
  const unrelated = "private-fixture-unrelated-page";
  const synced = "private-fixture-synced-text";
  workspace.pages[0].content.push({ id: "synchronizer", type: "syncedBlock", props: { sourceId: "sync-fixture" } });
  workspace.pages.push({ ...workspace.pages[0], id: "unrelated-page", title: unrelated, content: [{ id: "private-block", type: "paragraph", content: unrelated }] });
  workspace.syncedSources = [{ id: "sync-fixture", blocks: [{ id: "private-sync", type: "paragraph", content: synced }] }];
  const app = createHarness(t);
  const provider = await localProvider(t, (response, { body }, step) => {
    assert.equal(JSON.stringify(body).includes(unrelated), false);
    assert.equal(JSON.stringify(body).includes(synced), false);
    assert.equal(body.tools.some((entry) => entry.function.name === "update_page"), true);
    if (step === 1) {
      assert.equal(JSON.stringify(body).includes(pageId), false);
      assert.equal(body.messages.some((message) => message.role === "tool"), false);
      return reply(response, null, [tool("read-1", "read_page", { page_id: "current" })]);
    }
    if (step === 2) {
      const read = JSON.parse(body.messages.at(-1).content);
      assert.equal(read.page_id, pageId);
      assert.ok(read.blocks.some(({ text }) => text.includes("私人工作空间")));
      workspace = { ...workspace, pages: workspace.pages.map((page) => page.id === pageId
        ? { ...page, content: [...page.content, { id: "manual-change", type: "paragraph", content: "测试期间的人工编辑" }] }
        : page) };
      return reply(response, null, [
        tool("write-1", "update_page", { page_id: "current", markdown: "- [ ] 准备事项", mode: "append" }),
        tool("appearance-1", "update_workspace_settings", { theme: "dark" }),
      ]);
    }
    assert.equal(body.messages.slice(-2).every((message) => JSON.parse(message.content).ok), true);
    return reply(response, "已在当前页添加待办，并切换到夜间模式。");
  });
  const configured = await app.call("configure", { baseUrl: provider.url, model: "fixture" });
  const operations = [];
  const answer = await runWorkspaceAssistant({
    complete: (args) => app.call("complete", args),
    cancel: (args) => app.call("cancel", args),
    messages: userMessage("阅读当前页面后追加一项准备事项，并把工作区切换为夜间模式。"),
    configurationId: configured.value.configurationId,
    getWorkspace: () => workspace,
    applyWorkspace: (transform) => { const output = transform(workspace); workspace = output.workspace; return output; },
    onTool: (entry) => operations.push(entry),
  });
  assert.match(answer, /夜间模式/);
  assert.deepEqual(operations.map(({ name, ok }) => [name, ok]), [["read_page", true], ["update_page", true], ["update_workspace_settings", true]]);
  const current = workspace.pages.find((page) => page.id === pageId);
  assert.equal(current.content.at(-2).id, "manual-change");
  assert.equal(current.content.at(-1).type, "checkListItem");
  assert.equal(current.importRevision, 1);
  assert.equal(workspace.pageVersions[0].content.at(-1).id, "manual-change");
  assert.equal(workspace.ui.preferences.theme, "dark");
  assert.equal(provider.requests.length, 3);
  const restored = restorePageVersion(workspace, { pageId, versionId: workspace.pageVersions[0].id, now: Date.now(), preRestoreId: "fixture-before-restore" });
  assert.equal(restored.pages.find((page) => page.id === pageId).content.at(-1).id, "manual-change");
  assert.equal(restored.ui.preferences.theme, "dark");
});

test("explicit general chat cannot disclose workspace content or change the workspace", async (t) => {
  let workspace = fixture();
  const initial = workspace;
  const app = createHarness(t);
  const provider = await localProvider(t, (response, { body }, step) => {
    if (step === 1) return reply(response, null, [
      tool("bad-read", "read_page", { page_id: workspace.ui.selectedPageId }),
      tool("bad-find", "search_workspace", { query: "Life Atlas" }),
      tool("bad-theme", "update_workspace_settings", { theme: "dark" }),
      tool("bad-trash", "trash_page", { page_id: "current" }),
    ]);
    assert.ok(body.messages.filter((entry) => entry.role === "tool").every((entry) => !JSON.parse(entry.content).ok));
    assert.equal(body.messages.some((entry) => entry.role === "tool" && entry.content.includes("私人工作空间")), false);
    return reply(response, "你好！");
  });
  await app.call("configure", { baseUrl: provider.url, model: "fixture" });
  assert.equal(await runWorkspaceAssistant({
    messages: [{ role: "user", content: "你好！", workspaceEnabled: false }],
    complete: (args) => app.call("complete", args),
    getWorkspace: () => assert.fail("general chat read the workspace"),
    applyWorkspace: () => assert.fail("general chat changed the workspace"),
  }), "你好！");
  assert.equal(workspace, initial);
});

test("an explicit empty current page never reads the previously selected page", async (t) => {
  const workspace = fixture();
  const app = createHarness(t);
  const provider = await localProvider(t, (response, { body }, step) => {
    if (step === 1) return reply(response, null, [tool("empty-current", "read_page", { page_id: "current" })]);
    const denied = JSON.parse(body.messages.at(-1).content);
    assert.equal(denied.ok, false);
    assert.equal(JSON.stringify(body).includes(workspace.pages[0].title), false);
    return reply(response, "请先打开要读取的页面。");
  });
  await app.call("configure", { baseUrl: provider.url, model: "fixture" });
  const answer = await runWorkspaceAssistant({
    messages: userMessage("总结当前页面"),
    complete: (args) => app.call("complete", args),
    getWorkspace: () => workspace,
    getCurrentPageId: () => null,
    applyWorkspace: () => assert.fail("unexpected workspace change"),
  });
  assert.match(answer, /请先打开/);
  assert.equal(provider.requests.length, 2);
});

test("a text-only provider retries ordinary chat without tools and reports the workspace limitation for edits", async (t) => {
  const workspace = fixture();
  const app = createHarness(t);
  const provider = await localProvider(t, (response, { body }) => {
    if (Object.hasOwn(body, "tools")) {
      response.writeHead(400, { "Content-Type": "application/json" });
      return response.end(JSON.stringify({ error: { message: `Fixture model does not support tools. Detail ${token}`, param: "tools" } }));
    }
    assert.equal(Object.hasOwn(body, "tool_choice"), false);
    return reply(response, "等于 4。");
  });
  await app.call("configure", { baseUrl: provider.url, model: "fixture-text-only" });
  const run = (content) => runWorkspaceAssistant({
    messages: userMessage(content),
    complete: (args) => app.call("complete", args),
    getWorkspace: () => workspace,
    applyWorkspace: () => assert.fail("text-only services cannot change the workspace"),
  });
  assert.equal(await run("2 加 2 等于几？"), "等于 4。");
  assert.equal(provider.requests.length, 2);
  await assert.rejects(run("把当前页面的标题改成测试"), (error) => /不支持工具调用/.test(error.message) && !error.message.includes(token));
  assert.equal(provider.requests.length, 3);
});

test("stopping an assistant request aborts its main-process connection and cannot apply late tools", async (t) => {
  const workspace = fixture();
  const app = createHarness(t);
  const stop = new AbortController();
  let markConnected;
  const connected = new Promise((resolve) => { markConnected = resolve; });
  let markDisconnected;
  const disconnected = new Promise((resolve) => { markDisconnected = resolve; });
  const provider = await localProvider(t, (response) => {
    response.once("close", markDisconnected);
    markConnected();
  });
  await app.call("configure", { baseUrl: provider.url, model: "fixture" });
  let pending;
  const result = runWorkspaceAssistant({
    messages: userMessage("在当前页面添加文字"),
    complete: (args) => { pending = app.call("complete", args); return pending; },
    cancel: (args) => app.call("cancel", args),
    getWorkspace: () => workspace,
    applyWorkspace: () => assert.fail("tool was run after cancellation"),
    signal: stop.signal,
  });
  await connected;
  stop.abort();
  await assert.rejects(result, { name: "AbortError" });
  assert.equal((await pending).error.code, "E_CANCELLED");
  await disconnected;
});

test("replayed model tool IDs cannot apply a workspace mutation twice", async (t) => {
  let workspace = fixture();
  const app = createHarness(t);
  const repeated = tool("write-replay", "update_page", { page_id: "current", markdown: "唯一新增的文字" });
  const provider = await localProvider(t, (response, { body }, step) => {
    if (step === 1 || step === 2) return reply(response, null, [repeated]);
    if (step === 3) {
      assert.equal(JSON.parse(body.messages.at(-1).content).ok, true);
      return reply(response, null, [tool("write-replay", "update_page", { page_id: "current", markdown: "没有授权的重复更改" })]);
    }
    assert.equal(JSON.parse(body.messages.at(-1).content).ok, false);
    return reply(response, "已添加文字。");
  });
  await app.call("configure", { baseUrl: provider.url, model: "fixture" });
  let applied = 0;
  const response = await runWorkspaceAssistant({
    messages: userMessage("在当前页面添加一行文字"),
    complete: (args) => app.call("complete", args),
    getWorkspace: () => workspace,
    applyWorkspace: (transform) => {
      const output = transform(workspace);
      workspace = output.workspace;
      applied += 1;
      return output;
    },
  });
  assert.equal(response, "已添加文字。");
  assert.equal(applied, 1);
  assert.equal(workspace.pages[0].importRevision, 1);
  const body = JSON.stringify(workspace.pages[0].content);
  assert.equal(body.includes("唯一新增的文字"), true);
  assert.equal(body.includes("没有授权的重复更改"), false);
});

test("workspace tools protect locks and structural blocks, keep record titles aligned, and use the Trash", () => {
  let workspace = fixture();
  const page = workspace.pages[0];
  const toolOnPage = (name, args = {}) => {
    const output = executeWorkspaceTool(name, { page_id: page.id, ...args }, { workspace, time: Date.parse(now) });
    workspace = output.workspace;
    return output.result;
  };
  workspace.pages[0].settings.locked = true;
  assert.equal(toolOnPage("update_page", { title: "不应通过" }).ok, false);
  assert.equal(toolOnPage("trash_page").ok, false);
  workspace.pages[0].settings.locked = false;
  workspace.dataSources = [{ id: "data", properties: [{ id: "record-title", type: "title" }] }];
  workspace.databaseItems = [{ id: "item", sourceId: "data", pageId: page.id, values: { "record-title": page.title } }];
  workspace.pages[0].content.push({ id: "table-occurrence", type: "databaseView", props: { sourceId: "data", viewId: "view" } });
  assert.equal(toolOnPage("update_page", { markdown: "不应覆盖数据库", mode: "replace" }).ok, false);
  assert.equal(toolOnPage("update_page", { title: "更新后的标题" }).ok, true);
  assert.equal(workspace.databaseItems[0].values["record-title"], "更新后的标题");
  assert.equal(toolOnPage("edit_block", { block_id: workspace.pages[0].content[0].id, operation: "replace_text", text: "修改原有标题区块" }).ok, true);
  assert.equal(workspace.pages[0].content[0].content, "修改原有标题区块");
  assert.equal(workspace.pages[0].content.at(-1).id, "table-occurrence");
  assert.equal(toolOnPage("trash_page").ok, true);
  assert.equal(workspace.pages[0].trashedAt, now);
  assert.equal(workspace.databaseItems[0].id, "item");
  assert.equal(toolOnPage("restore_page").ok, true);
  assert.equal(workspace.pages[0].trashedAt, null);
});

test("assistant page appearance preserves the existing cover, accepts gallery covers and enforces explicit unlocking", () => {
  let workspace = fixture();
  const pageId = workspace.ui.selectedPageId;
  workspace.pages[0].cover = "/covers/local-fixture.jpg";
  const run = (name, args = {}) => {
    const output = executeWorkspaceTool(name, args, { workspace, time: Date.parse(now) });
    workspace = output.workspace;
    return output.result;
  };
  run("update_page_display", { page_id: pageId, cover_position: 65, font: "serif", small_text: true, presentation: "focus" });
  assert.deepEqual(workspace.pages[0].cover, { kind: "upload", value: "/covers/local-fixture.jpg", position: 65 });
  assert.equal(workspace.pages[0].settings.fullWidth, true);
  assert.equal(workspace.pages[0].settings.presentationMode, "focus");
  const gallery = run("search_covers", { limit: 1 }).matches[0];
  assert.equal(run("update_page_display", { page_id: pageId, cover_id: gallery.cover_id, locked: true }).ok, true);
  assert.equal(workspace.pages[0].cover.value, gallery.cover_id);
  assert.equal(run("update_page_display", { page_id: pageId, locked: false, cover_id: "" }).ok, false);
  assert.equal(run("update_page", { page_id: pageId, title: "锁定" }).ok, false);
  assert.equal(run("update_page_display", { page_id: pageId, locked: false }).ok, true);
  assert.equal(run("update_page_display", { page_id: pageId, cover_id: "", icon: "🚀" }).ok, true);
  assert.equal(workspace.pages[0].cover, null);
  assert.equal(workspace.pages[0].icon, "🚀");
  assert.equal(run("update_workspace_settings", { default_font: "mono", start_page: "home", sidebar_width: 310, sidebar_collapsed: true }).ok, true);
  assert.equal(workspace.ui.sidebarWidth, 310);
  assert.equal(run("create_page", { title: "使用默认字体" }).ok, true);
  assert.equal(workspace.pages.at(-1).settings.fontFamily, "mono");
});

test("assistant creates folders and child pages, copies their document references, and moves ownership without cycles", () => {
  let workspace = fixture();
  const parentId = workspace.ui.selectedPageId;
  const run = (name, args = {}) => {
    const output = executeWorkspaceTool(name, args, { workspace, currentPageId: parentId, time: Date.parse(now) });
    workspace = output.workspace;
    return output.result;
  };
  const folderId = run("create_folder", { name: "项目资料" }).folder_id;
  const subfolderId = run("create_folder", { name: "工作稿", parent_folder_id: folderId }).folder_id;
  assert.equal(run("update_folder", { folder_id: folderId, parent_folder_id: subfolderId }).ok, false);
  const destination = run("create_page", { title: "新父页", folder_id: subfolderId }).page_id;
  const child = run("create_page", { title: "子页", parent_page_id: "current", markdown: "## 简介\n\n正文" }).page_id;
  assert.equal(workspace.pages[0].content.at(-1).props.pageId, child);
  const copy = run("duplicate_page", { page_id: parentId, title: "整页副本" }).page_id;
  const copiedChild = workspace.pages.find((page) => page.parentPageId === copy);
  assert.equal(copiedChild.title, "子页");
  assert.notEqual(copiedChild.id, child);
  assert.equal(workspace.pages.find((page) => page.id === copy).content.at(-1).props.pageId, copiedChild.id);
  assert.equal(run("move_page", { page_id: parentId, parent_page_id: child }).ok, false);
  assert.equal(run("move_page", { page_id: child, parent_page_id: destination }).ok, true);
  assert.equal(workspace.pages.find((page) => page.id === child).folderId, subfolderId);
  assert.equal(workspace.pages.find((page) => page.id === child).parentPageId, destination);
  assert.equal(workspace.pages.find((page) => page.id === destination).content.at(-1).props.pageId, child);
  assert.equal(workspace.pages[0].content.at(-1).props.pageId, child);
  assert.equal(run("trash_folder", { folder_id: folderId }).ok, true);
  assert.equal(workspace.pages.find((page) => page.id === child).trashedAt, now);
  assert.equal(run("restore_folder", { folder_id: folderId }).ok, true);
  assert.equal(workspace.pages.find((page) => page.id === child).trashedAt, null);
  assert.deepEqual(checkWorkspaceIntegrity(workspace).problems.filter((issue) => issue.severity === "error"), []);
});

test("assistant database tools create native records, keep title and unique IDs aligned, and update compatible views", () => {
  let workspace = fixture();
  const run = (name, args = {}) => {
    const output = executeWorkspaceTool(name, args, { workspace, time: Date.parse(now) });
    workspace = output.workspace;
    return output.result;
  };
  const database = run("create_database", {
    title: "迭代任务",
    properties: [
      { name: "任务", type: "title" },
      { name: "状态", type: "status", options: ["未开始", "已完成"] },
      { name: "排序号", type: "unique_id" },
      { name: "优先级", type: "number" },
    ],
  });
  assert.equal(database.ok, true);
  const { page_id, source_id, view_id } = database;
  const target = { page_id, source_id };
  const { properties, views } = run("list_page_databases", target).databases[0];
  assert.equal(views[0].view_id, view_id);
  const propertyId = (name) => properties.find((property) => property.name === name).property_id;
  const first = run("create_database_record", { ...target, title: "登录流程", markdown: "待测试" });
  const second = run("create_database_record", { ...target, title: "权限检查" });
  assert.equal(first.ok && second.ok, true);
  assert.deepEqual(workspace.databaseItems.map((item) => item.values[propertyId("排序号")]), [1, 2]);
  const update = (name, value) => run("update_database_record", { ...target, item_id: first.item_id, property_id: propertyId(name), value });
  assert.equal(update("状态", "不存在的选项").ok, false);
  assert.equal(update("优先级", "无法转换").ok, false);
  assert.equal(update("状态", "已完成").ok, true);
  assert.equal(update("优先级", 9).ok, true);
  assert.equal(update("任务", "登录验收").ok, true);
  assert.equal(workspace.pages.find((page) => page.id === first.page_id).title, "登录验收");
  const revised = run("update_database_view", {
    ...target, view_id, type: "board", group_property_id: propertyId("状态"),
    sort_property_id: propertyId("优先级"), sort_direction: "desc",
    filter_property_id: propertyId("状态"), filter_operator: "equals", filter_value: "已完成",
    open_records_in: "page", show_page_icon: false,
  });
  assert.equal(revised.ok, true);
  const view = workspace.databaseViews.find((entry) => entry.id === view_id);
  assert.equal(view.type, "board");
  assert.equal(view.config.openRecordsIn, "page");
  assert.equal(view.config.showPageIcon, false);
  assert.deepEqual(projectViewItems(workspace, view).map((item) => item.id), [first.item_id]);
  const queried = run("query_database_records", { ...target, view_id, query: "登录", property_ids: [propertyId("状态")] });
  assert.deepEqual(queried.records, [{
    item_id: first.item_id, page_id: first.page_id, title: "登录验收", fields: [{ property_id: propertyId("状态"), value: "已完成" }],
  }]);
  assert.deepEqual(run("query_database_records", { ...target, view_id, count_only: true }), { ok: true, count: 1 });
  const copied = run("duplicate_page", { page_id: first.page_id });
  assert.equal(copied.ok, true);
  assert.equal(workspace.databaseItems.at(-1).values[propertyId("排序号")], 3);
  assert.equal(workspace.databaseItems.at(-1).values[propertyId("任务")], "登录验收 副本");
  assert.equal(run("update_page_display", { page_id, locked: true }).ok, true);
  assert.equal(run("create_database_record", { ...target, title: "锁定时不应写入" }).ok, false);
  assert.equal(update("优先级", 2).ok, false);
  assert.equal(run("update_database_view", { ...target, view_id, type: "list" }).ok, false);
  assert.equal(run("query_database_records", { ...target, view_id, count_only: true }).count, 2);
  assert.equal(run("update_page_display", { page_id, locked: false }).ok, true);
  assert.equal(run("update_page_display", { page_id: first.page_id, locked: true }).ok, true);
  assert.equal(update("优先级", 2).ok, false);
  assert.equal(checkWorkspaceIntegrity(workspace).ok, true);
});

test("an OpenAI-compatible loopback service can build an inline database and change its records and view", async (t) => {
  let workspace = fixture();
  const owner = workspace.ui.selectedPageId;
  let database;
  let record;
  const app = createHarness(t);
  const provider = await localProvider(t, (response, { body }, step) => {
    if (step === 1) return reply(response, null, [tool("db-create", "create_database", { title: "需求跟踪", mode: "inline", parent_page_id: "current" })]);
    if (step === 2) {
      database = JSON.parse(body.messages.at(-1).content);
      assert.equal(database.ok, true);
      assert.equal(database.page_id, owner);
      return reply(response, null, [tool("record-create", "create_database_record", { page_id: "current", source_id: database.source_id, title: "检查设置" })]);
    }
    const target = { page_id: "current", source_id: database.source_id };
    if (step === 3) {
      record = JSON.parse(body.messages.at(-1).content);
      assert.equal(record.ok, true);
      return reply(response, null, [
        tool("record-edit", "update_database_record", { ...target, item_id: record.item_id, property_id: "done", value: true }),
        tool("view-edit", "update_database_view", { ...target, view_id: database.view_id, type: "board", group_property_id: "status" }),
      ]);
    }
    if (step === 4) {
      assert.ok(body.messages.slice(-2).every((entry) => JSON.parse(entry.content).ok));
      return reply(response, null, [tool("record-query", "query_database_records", { ...target, query: "检查设置", property_ids: ["done"] })]);
    }
    assert.equal(JSON.parse(body.messages.at(-1).content).records[0].item_id, record.item_id);
    return reply(response, "已创建需求跟踪看板并完成检查设置记录。");
  });
  await app.call("configure", { baseUrl: provider.url, model: "fixture" });
  const answer = await runWorkspaceAssistant({
    messages: userMessage("在当前页面新建叫“需求跟踪”的内联数据库，添加一条“检查设置”记录，把完成字段设为已勾选，再切换为按状态分组的看板。"),
    complete: (args) => app.call("complete", args),
    getWorkspace: () => workspace,
    applyWorkspace: (transform) => { const output = transform(workspace); workspace = output.workspace; return output; },
  });
  assert.match(answer, /需求跟踪看板/);
  assert.equal(workspace.pages[0].content.at(-1).props.sourceId, database.source_id);
  assert.equal(workspace.pages[0].importRevision, 1);
  assert.equal(workspace.databaseItems[0].values.done, true);
  assert.equal(workspace.databaseViews[0].type, "board");
  assert.equal(checkWorkspaceIntegrity(workspace).ok, true);
  assert.equal(provider.requests.length, 5);
});
