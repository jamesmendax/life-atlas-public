import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { registerAssistantIpc } from "../electron/main/assistant/ipc.js";
import { assertPhysicalPath } from "../electron/main/storage/dataRoot.js";

test("provider reasoning is displayable and replayed only for the exact active tool turn", async (t) => {
  const temporaryParent = fs.realpathSync(os.tmpdir());
  const configDirectory = fs.mkdtempSync(path.join(temporaryParent, "life-atlas-provider-continuation-"));
  const sender = Object.assign(new EventEmitter(), { id: 12, mainFrame: { processId: 34, routingId: 56 } });
  const event = { sender, senderFrame: sender.mainFrame };
  const ipc = new Map();
  const requests = [];
  const reasoning = "Opaque continuation data from a synthetic provider.";
  const toolCall = { id: "call-1", type: "function", function: { name: "search_web", arguments: '{"query":"fixture"}' } };
  const close = registerAssistantIpc({
    ipcMain: { handle: (channel, handler) => ipc.set(channel, handler), removeHandler: (channel) => ipc.delete(channel) },
    getWorkspaceWindow: () => ({ webContents: sender }),
    configDirectory,
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      const message = requests.length === 1
        ? { role: "assistant", content: null, tool_calls: [toolCall], reasoning_content: reasoning }
        : { role: "assistant", content: "Verified." };
      return Response.json({ choices: [{ message }] });
    },
  });
  t.after(() => {
    close();
    fs.rmSync(assertPhysicalPath(configDirectory, { root: temporaryParent, allowMissing: false }), { recursive: true });
  });

  const invoke = (action, args) => ipc.get(`la:assistant:${action}`)(event, args);
  const settings = { baseUrl: "https://provider-fixture.example/v1", model: "fixture" };
  const config = await invoke("configure", settings);
  assert.equal(config.ok, true);
  const original = { role: "user", content: "Research the fixture." };
  const first = await invoke("complete", { messages: [original] });
  assert.equal(first.ok, true);
  assert.equal(first.value.reasoning, reasoning);
  assert.equal(Object.hasOwn(first.value, "reasoning_content"), false);

  const output = { role: "tool", content: '{"ok":true}', tool_call_id: toolCall.id };
  const followup = { messages: [original, first.value, output] };
  assert.equal((await invoke("complete", followup)).ok, true);
  assert.equal(requests.at(-1).messages[1].reasoning_content, reasoning);

  const modified = {
    ...first.value,
    reasoning_content: "Untrusted renderer-supplied reasoning.",
    tool_calls: [{ ...toolCall, function: { ...toolCall.function, arguments: '{"query":"different"}' } }],
  };
  assert.equal((await invoke("complete", { messages: [original, modified, output] })).ok, true);
  assert.equal(Object.hasOwn(requests.at(-1).messages[1], "reasoning_content"), false);

  assert.equal((await invoke("configure", { ...settings, model: "fixture-v2" })).ok, true);
  assert.equal((await invoke("complete", followup)).ok, true);
  assert.equal(Object.hasOwn(requests.at(-1).messages[1], "reasoning_content"), false);
});

test("only the active DeepSeek tool catalog can decode a provider's raw call envelope", async (t) => {
  const base = fs.realpathSync(os.tmpdir());
  const configDirectory = fs.mkdtempSync(path.join(base, "life-atlas-provider-format-"));
  const sender = Object.assign(new EventEmitter(), { id: 14, mainFrame: { routingId: 15, processId: 16 } });
  const event = { sender, senderFrame: sender.mainFrame };
  const handlers = new Map();
  const content = `<｜｜DSML｜｜ calls>
<｜｜DSML｜｜ invoke name="create_page">
<｜｜DSML｜｜ parameter name="title" string="true">New fixture page</｜｜DSML｜｜ parameter>
<｜｜DSML｜｜ parameter name="markdown" string="true">Native body</｜｜DSML｜｜ parameter>
</｜｜DSML｜｜ invoke>
</｜｜DSML｜｜ calls>`;
  const close = registerAssistantIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), removeHandler: (channel) => handlers.delete(channel) },
    getWorkspaceWindow: () => ({ webContents: sender }),
    configDirectory,
    fetchImpl: async () => Response.json({ choices: [{ message: { role: "assistant", content } }] }),
  });
  t.after(() => {
    close();
    fs.rmSync(assertPhysicalPath(configDirectory, { root: base, allowMissing: false }), { recursive: true });
  });
  const invoke = (action, args) => handlers.get(`la:assistant:${action}`)(event, args);
  const baseUrl = "https://provider-fixture.example/v1";
  assert.equal((await invoke("configure", { baseUrl, model: "deepseek-v4.1-flash-1017" })).ok, true);
  const messages = [{ role: "user", content: "Create the fixture page." }];
  const recognized = await invoke("complete", { messages, workspaceEnabled: true });
  assert.equal(recognized.ok, true);
  assert.equal(recognized.value.content, null);
  assert.deepEqual(recognized.value.tool_calls.map((call) => [call.function.name, JSON.parse(call.function.arguments)]), [
    ["create_page", { title: "New fixture page", markdown: "Native body" }],
  ]);
  assert.equal((await invoke("complete", { messages, workspaceEnabled: false })).ok, false);
  assert.equal((await invoke("complete", { messages, tools: false })).ok, false);
  assert.equal((await invoke("configure", { baseUrl, model: "different-fixture" })).ok, true);
  assert.equal((await invoke("complete", { messages, workspaceEnabled: true })).ok, false);
});

test("DeepSeek reasoning streams before the reply and tool arguments are assembled and validated", { timeout: 4000 }, async (t) => {
  const base = fs.realpathSync(os.tmpdir());
  const configDirectory = fs.mkdtempSync(path.join(base, "life-atlas-provider-stream-"));
  const sender = Object.assign(new EventEmitter(), { id: 17, mainFrame: { routingId: 18, processId: 19 } });
  sender.send = (channel, event) => sender.emit(channel, event);
  const event = { sender, senderFrame: sender.mainFrame };
  const handlers = new Map();
  const requests = [];
  const key = "synthetic-key-not-real";
  let transport;
  const encoder = new TextEncoder();
  const packet = (choice) => encoder.encode("data: " + JSON.stringify({ choices: [choice] }) + "\r\n\r\n");
  const close = registerAssistantIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), removeHandler: (channel) => handlers.delete(channel) },
    getWorkspaceWindow: () => ({ webContents: sender }),
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() },
    configDirectory,
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      if (requests.length !== 1) return Response.json({ choices: [{ message: { content: "素材已找到。" } }] });
      return new Response(new ReadableStream({ start(controller) { transport = controller; } }), { headers: { "Content-Type": "text/event-stream" } });
    },
  });
  t.after(() => {
    close();
    fs.rmSync(assertPhysicalPath(configDirectory, { root: base, allowMissing: false }), { recursive: true });
  });

  const invoke = (action, args) => handlers.get("la:assistant:" + action)(event, args);
  assert.equal((await invoke("configure", { baseUrl: "https://provider-fixture.example/v1", model: "deepseek-v4.1-flash-1017", apiKey: key })).ok, true);
  const received = once(sender, "la:assistant:reasoning").then(([value]) => value);
  const user = { role: "user", content: "查找参考资料。" };
  const completion = invoke("complete", { messages: [user], stream: true, requestId: "stream-fixture" });
  assert.equal(requests[0].stream, true);
  assert.deepEqual(requests[0].thinking, { type: "enabled" });
  const first = packet({ delta: { reasoning_content: "先核对图源 🔎 " + key.slice(0, 9) } });
  const split = first.indexOf(0xf0) + 1;
  transport.enqueue(first.slice(0, split));
  transport.enqueue(first.slice(split));
  assert.deepEqual(await Promise.race([received, completion]), { requestId: "stream-fixture", text: "先核对图源 🔎 " });
  transport.enqueue(packet({ delta: { reasoning_content: key.slice(9) + "，然后查官方页面。" } }));
  transport.enqueue(packet({ delta: { tool_calls: [{ index: 0, type: "function", id: "stream-call", function: { name: "search_web", arguments: '{"que' } }] } }));
  transport.enqueue(packet({ delta: { tool_calls: [{ index: 0, function: { arguments: 'ry":"官方"}' } }] } }));
  transport.enqueue(packet({ delta: {}, finish_reason: "tool_calls" }));
  transport.enqueue(encoder.encode("data: [DONE]\n\n"));
  transport.close();
  const result = await completion;
  assert.equal(result.ok, true);
  assert.equal(result.value.reasoning, "先核对图源 🔎 〔已隐藏〕，然后查官方页面。");
  assert.deepEqual(result.value.tool_calls, [{ id: "stream-call", type: "function", function: { name: "search_web", arguments: '{"query":"官方"}' } }]);
  const output = { role: "tool", content: '{"ok":true}', tool_call_id: "stream-call" };
  assert.equal((await invoke("complete", { messages: [user, result.value, output] })).ok, true);
  assert.equal(Object.hasOwn(requests[1].messages[1], "reasoning_content"), false);
  assert.equal(Object.hasOwn(requests[1].messages[1], "reasoning"), false);
});

test("a provider can fall back to JSON without dropping the registered tools", async (t) => {
  const base = fs.realpathSync(os.tmpdir());
  const configDirectory = fs.mkdtempSync(path.join(base, "life-atlas-provider-json-"));
  const sender = Object.assign(new EventEmitter(), { id: 20, mainFrame: { routingId: 21, processId: 22 } });
  const event = { sender, senderFrame: sender.mainFrame };
  const handlers = new Map();
  const requests = [];
  const close = registerAssistantIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), removeHandler: (channel) => handlers.delete(channel) },
    getWorkspaceWindow: () => ({ webContents: sender }),
    configDirectory,
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      requests.push(request);
      if (request.stream || request.thinking) {
        return Response.json({ error: { param: request.stream ? "stream" : "thinking", code: "unsupported_parameter" } }, { status: 400 });
      }
      return Response.json({ choices: [{ message: { content: "完成。", reasoning: "兼容格式的思考正文。" } }] });
    },
  });
  t.after(() => {
    close();
    fs.rmSync(assertPhysicalPath(configDirectory, { root: base, allowMissing: false }), { recursive: true });
  });
  const invoke = (action, args) => handlers.get("la:assistant:" + action)(event, args);
  assert.equal((await invoke("configure", { baseUrl: "https://provider-fixture.example/v1", model: "deepseek-v4.1-flash-1017" })).ok, true);
  const reply = await invoke("complete", { messages: [{ role: "user", content: "检查当前页。" }], stream: true, requestId: "json-fallback" });
  assert.equal(reply.ok, true);
  assert.equal(reply.value.reasoning, "兼容格式的思考正文。");
  assert.deepEqual(requests.map(({ stream, thinking }) => [stream, Boolean(thinking)]), [[true, true], [false, true], [false, false]]);
  for (const request of requests) assert.ok(request.tools.some(({ function: tool }) => tool.name === "read_page"));
});
