import { createHash, randomUUID } from "node:crypto";
import { ok, fail, errorResult } from "../ipc/result.js";
import { acceptsNoArguments, isNonEmptyString, isPlainObject, isTrustedSender } from "../ipc/validate.js";
import { maxAssistantReasoningLength } from "../../../src/assistant/conversation.js";
import { workspaceAssistantTools } from "../../../src/assistant/toolCatalog.js";
import { assistantWebTools } from "../../../src/assistant/webTools.js";
import { assistantError, createAssistantConfig } from "./config.js";
import { createAssistantAttachments } from "./attachments.js";
import { createAssistantWeb } from "./publicWeb.js";
import { decodeDeepSeekToolCalls } from "./deepSeekToolCalls.js";
import { providerReasoning, readChatReply, readReplyText } from "./chatReply.js";

const assistantChannels = {
  getConfig: "la:assistant:get-config",
  configure: "la:assistant:configure",
  complete: "la:assistant:complete",
  cancel: "la:assistant:cancel",
  web: "la:assistant:web",
  importWebImage: "la:assistant:import-web-image",
  prepareAttachment: "la:assistant:prepare-attachment",
  loadAttachment: "la:assistant:load-attachment",
  recognizeAttachment: "la:assistant:recognize-attachment",
  listConversations: "la:assistant:list-conversations",
  getConversation: "la:assistant:get-conversation",
  saveConversation: "la:assistant:save-conversation",
  selectConversation: "la:assistant:select-conversation",
};
const maxPayloadBytes = 512 * 1024;
const maximumCalls = 12;
const maxContentLength = 32000;
const maxReasoningBytes = 96 * 1024;
const maxReasoningCacheBytes = 512 * 1024;
const maxCachedReasoningTurns = 64;
const rawToolMarkup = /^\s*[<＜][|｜]{1,2}DSML[|｜]{1,2}[ \t]*(?:calls|function_calls|tool_calls|invoke)(?=\s|[>＞])/u;
const deepSeekV4 = /(?:^|[/:])deepseek-v4(?:[.\-_/]|$)/iu;
const thinkingCapableModel = /(?:^|[/:])(?:deepseek-(?:v3\.[12]|v4|reasoner|r1)|qwq|qwen3)(?:[.\-_/]|$)/iu;
const createPageTool = workspaceAssistantTools.find(({ function: tool }) => tool.name === "create_page");

function toolTurnKey(message) {
  if (!message.tool_calls?.length) return null;
  return createHash("sha256").update(JSON.stringify([message.content, message.tool_calls])).digest("hex");
}

function normalizeCalls(value) {
  if (!Array.isArray(value) || !value.length || value.length > maximumCalls) return null;
  const ids = new Set();
  const calls = [];
  for (const call of value) {
    if (!isPlainObject(call) || call.type !== "function" || !isNonEmptyString(call.id, 192) || !/^[a-zA-Z0-9_.:-]+$/.test(call.id) || ids.has(call.id)
      || !isPlainObject(call.function) || !/^[a-zA-Z0-9_-]{1,64}$/.test(call.function.name)
      || typeof call.function.arguments !== "string" || call.function.arguments.length > maxContentLength) return null;
    ids.add(call.id);
    calls.push({ id: call.id, type: "function", function: { name: call.function.name, arguments: call.function.arguments } });
  }
  return calls;
}

function normalizeMessages(value, toolsEnabled) {
  const invalid = () => assistantError("E_INVALID_ARGUMENT", "AI 对话格式无效或超过长度限制。");
  if (!Array.isArray(value) || !value.length || value.length > 160) throw invalid();
  const messages = [];
  let waitingFor = new Set();
  let imageCount = 0;
  let textSize = 0;
  for (const message of value) {
    if (!isPlainObject(message) || !["system", "assistant", "user", "tool"].includes(message.role)) throw invalid();
    const { role } = message;
    let { content } = message;
    if (role === "tool") {
      if (!waitingFor.delete(message.tool_call_id) || typeof content !== "string" || content.length > maxContentLength) throw invalid();
      textSize += Buffer.byteLength(content);
      messages.push({ role, content, tool_call_id: message.tool_call_id });
      continue;
    }
    if (waitingFor.size || (role === "system" && messages.length)) throw invalid();
    const calls = message.tool_calls === undefined ? null : normalizeCalls(message.tool_calls);
    if (Array.isArray(content)) {
      if (role !== "user" || !content.length || content.length > 4) throw invalid();
      content = content.map((part) => {
        if (isPlainObject(part) && part.type === "text" && typeof part.text === "string" && part.text.length <= maxContentLength) {
          textSize += Buffer.byteLength(part.text);
          return { type: "text", text: part.text };
        }
        const url = part?.image_url?.url;
        if (part?.type !== "image_url" || typeof url !== "string" || url.length > 1050000
          || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(url) || ++imageCount > 3) throw invalid();
        return { type: "image_url", image_url: { url } };
      });
    }
    if ((message.tool_calls !== undefined && (!calls || role !== "assistant" || !toolsEnabled))
      || (!Array.isArray(content) && (typeof content !== "string" ? !(content === null && calls) : content.length > maxContentLength))) throw invalid();
    if (typeof content === "string") textSize += Buffer.byteLength(content);
    if (calls) textSize += Buffer.byteLength(JSON.stringify(calls));
    waitingFor = new Set(calls?.map((call) => call.id));
    messages.push({ role, content, ...(calls ? { tool_calls: calls } : {}) });
  }
  if (waitingFor.size || !messages.some((message) => message.role === "user") || textSize > maxPayloadBytes
    || (!imageCount && Buffer.byteLength(JSON.stringify(messages)) > maxPayloadBytes)) throw invalid();
  return { messages, textSize };
}

function displayReasoning(text, key, partial = false) {
  if (key && partial) {
    // Hold any suffix that could be the start of the API key until its next chunk arrives.
    for (let length = Math.min(key.length - 1, text.length); length > 0; length -= 1) {
      if (text.endsWith(key.slice(0, length))) {
        text = text.slice(0, -length);
        break;
      }
    }
  }
  return (key ? text.replaceAll(key, "〔已隐藏〕") : text).slice(0, maxAssistantReasoningLength);
}

function replyMessage(raw, { key, model }, toolsEnabled, tools) {
  const invalid = () => assistantError("E_IO", "AI 服务没有返回有效的聊天消息。");
  if (!isPlainObject(raw) || (raw.role !== undefined && raw.role !== "assistant")) throw invalid();
  const hasCalls = raw.tool_calls !== undefined && raw.tool_calls !== null && !(Array.isArray(raw.tool_calls) && !raw.tool_calls.length);
  let calls = hasCalls ? normalizeCalls(raw.tool_calls) : null;
  if (hasCalls && (!calls || !toolsEnabled)) throw invalid();
  if (raw.content != null && typeof raw.content !== "string") throw invalid();
  const redact = (value) => key ? value.replaceAll(key, "〔已隐藏〕") : value;
  const rawContent = typeof raw.content === "string" ? raw.content : null;
  const containsRawToolMarkup = rawContent !== null && rawToolMarkup.test(rawContent);
  if (containsRawToolMarkup && !calls && toolsEnabled && deepSeekV4.test(model)) {
    const allowed = new Set(tools.map(({ function: tool }) => tool.name));
    const decoded = decodeDeepSeekToolCalls(rawContent, allowed);
    calls = normalizeCalls(decoded?.map((call) => ({ ...call, id: `call_dsml_${randomUUID()}` })));
  }
  if (containsRawToolMarkup && !calls) throw assistantError("E_IO", "AI 服务返回了无法执行的工具指令。");
  const content = rawContent !== null && !containsRawToolMarkup ? redact(rawContent).slice(0, maxContentLength) : null;
  if (!calls && !content?.trim()) throw invalid();
  if (calls && key) {
    for (const call of calls) {
      if (call.id === key || call.function.name === key || (key.length >= 8 && (call.id.includes(key) || call.function.name.includes(key)))) throw invalid();
      let canonical;
      try { canonical = JSON.stringify(JSON.parse(call.function.arguments)); } catch {}
      const encodedKey = JSON.stringify(key).slice(1, -1);
      call.function.arguments = canonical === undefined ? redact(call.function.arguments) : canonical.replaceAll(encodedKey, "〔已隐藏〕");
    }
  }
  return { role: "assistant", content, ...(calls ? { tool_calls: calls } : {}) };
}

function responseError(status) {
  if (status >= 300 && status < 400) return assistantError("E_IO", "AI 服务返回了重定向，请填写最终的基础网址。");
  if (status === 401 || status === 403) return assistantError("E_FORBIDDEN", "AI 服务拒绝了身份验证，请检查 API Key。");
  if (status === 404) return assistantError("E_NOT_FOUND", "找不到聊天接口或模型，请检查基础网址与模型。");
  if (status === 429) return assistantError("E_THROTTLED", "AI 服务暂时达到请求限额，请稍后重试。");
  if (status === 400 || status === 422) return assistantError("E_IO", `AI 服务拒绝了请求（HTTP ${status}）。请检查模型名称和工具调用兼容性。`);
  return assistantError("E_IO", `AI 服务请求失败（HTTP ${status}）。`);
}

function toolsUnsupported(body) {
  let error;
  try {
    const parsed = JSON.parse(body);
    error = parsed?.error ?? parsed;
  } catch {}
  const parameter = typeof error?.param === "string" ? error.param : "";
  const code = typeof error?.code === "string" ? error.code : "";
  const message = (typeof error?.message === "string" ? error.message : typeof error === "string" ? error : body).slice(0, 3000);
  const hasToolParameter = /^(?:tools|tool_choice|functions|function_call)(?:$|[.\[])/i.test(parameter);
  const hasToolTerm = /\b(?:tools?|tool_choice|function[ _-]?call(?:ing|s)?)\b/i.test(message);
  const incompatible = /not support|doesn['’]t support|unsupported|not (?:available|enabled|allowed|implemented|permitted)|unexpected|unknown|unrecognized/i;
  return (hasToolParameter && /^(?:unsupported|unknown|unrecognized)_/.test(code))
    || ((hasToolParameter || hasToolTerm) && incompatible.test(message));
}

function imagesUnsupported(body) {
  if (/expected a string|content.{0,80}must be (?:a )?string/i.test(body)) return true;
  return /image|vision|multimodal/i.test(body)
    && /not support|unsupported|only supports?|expected a string|text.only|not enabled|not a valid|invalid type/i.test(body);
}

function providerOptionUnsupported(body, name) {
  const option = name === "stream" ? /\bstream(?:ing)?\b/i : /\bthinking\b/i;
  return option.test(body)
    && /unsupported|not support|not implemented|unknown|unrecognized|unexpected|extra_forbidden|extra inputs|not allowed/i.test(body);
}

export function registerAssistantIpc({
  ipcMain, getWorkspaceWindow, safeStorage, configDirectory, conversations, assetStore, nativeImage,
  web = createAssistantWeb(), fetchImpl = globalThis.fetch,
}) {
  const config = createAssistantConfig({ safeStorage, configDirectory });
  // Keep provider continuation data in the main process and bind it to the exact tool turn.
  const continuity = new WeakMap();
  function providerTurns(sender, configurationId) {
    let state = continuity.get(sender);
    if (state?.configurationId !== configurationId) {
      state = { configurationId, turns: new Map(), totalBytes: 0 };
      continuity.set(sender, state);
    }
    return state;
  }
  const attachments = createAssistantAttachments({ assetStore, nativeImage });
  const active = new Map();
  const requestPattern = /^[a-zA-Z0-9_-]{1,96}$/;
  const register = (channel, handler, fallback) => ipcMain.handle(channel, async (event, args) => {
    if (!isTrustedSender(event, getWorkspaceWindow())) return fail("E_FORBIDDEN", "只接受工作区窗口的调用");
    try { return ok(await handler(args, event.sender)); }
    catch (error) { return errorResult(error, fallback); }
  });

  register(assistantChannels.getConfig, (args) => {
    if (!acceptsNoArguments(args)) throw assistantError("E_INVALID_ARGUMENT", "此操作不接受参数。");
    return config.getConfig();
  }, "无法读取 AI 服务配置。");
  register(assistantChannels.configure, (args) => config.configure(args), "无法保存 AI 服务配置。");
  if (conversations) {
    for (const name of ["listConversations", "getConversation", "saveConversation", "selectConversation"]) {
      register(assistantChannels[name], (args) => conversations[name](args), "无法读取或保存本地对话。");
    }
  }
  register(assistantChannels.prepareAttachment, (args) => attachments.prepare(args), "无法将附件加入对话。");
  register(assistantChannels.loadAttachment, (args) => attachments.load(args), "无法读取本地对话附件。");
  register(assistantChannels.recognizeAttachment, (args) => attachments.ocr(args), "未能提取图片文字，请确认图片清晰。");
  register(assistantChannels.cancel, (args, sender) => {
    if (!isPlainObject(args) || typeof args.requestId !== "string" || !requestPattern.test(args.requestId) || Object.keys(args).length !== 1) {
      throw assistantError("E_INVALID_ARGUMENT", "AI 请求编号无效。");
    }
    const controller = active.get(sender)?.get(args.requestId);
    controller?.abort();
    return { cancelled: Boolean(controller) };
  }, "无法停止 AI 请求。");
  async function withRequest(args, sender, operation) {
    if (!isPlainObject(args) || (args.requestId !== undefined && (typeof args.requestId !== "string" || !requestPattern.test(args.requestId)))) {
      throw assistantError("E_INVALID_ARGUMENT", "AI 请求编号无效。");
    }
    const requests = active.get(sender) ?? new Map();
    const requestId = args.requestId ?? Symbol("assistant request");
    if (requests.has(requestId)) throw assistantError("E_CONFLICT", "同一 AI 请求仍在处理。");
    if (requests.size >= 2) throw assistantError("E_THROTTLED", "有 AI 请求正在处理，请稍后重试。");
    const controller = new AbortController();
    const abort = () => controller.abort();
    requests.set(requestId, controller);
    active.set(sender, requests);
    sender.once?.("destroyed", abort);
    try {
      const result = await operation(controller.signal);
      if (controller.signal.aborted) throw assistantError("E_CANCELLED", "已停止 AI 请求。");
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw assistantError("E_CANCELLED", "已停止 AI 请求。");
      if (error?.name === "TimeoutError" || error?.name === "AbortError") throw assistantError("E_IO", "网络连接超时，请重试。");
      throw error;
    } finally {
      sender.removeListener?.("destroyed", abort);
      requests.delete(requestId);
      if (!requests.size) active.delete(sender);
    }
  }
  register(assistantChannels.web, (args, sender) => withRequest(args, sender, (signal) =>
    web.run(args.name, args.args, { searchBaseUrl: config.getConfig().searchBaseUrl, signal })), "暂时无法读取公开网络来源。");
  register(assistantChannels.importWebImage, (args, sender) => withRequest(args, sender, async (signal) => {
    const photo = await web.readImage(args.url, signal);
    signal.throwIfAborted();
    return { ...attachments.captureWebImage(photo), verifiedUrl: photo.url };
  }), "未能保存网络图片。");
  register(assistantChannels.complete, (args, sender) => withRequest(args, sender, async (signal) => {
    if (Object.keys(args).some((key) => !["messages", "tools", "workspaceEnabled", "imageSearchEnabled", "webResearchEnabled", "requiredPageTool", "configurationId", "requestId", "stream"].includes(key))
      || (args.tools !== undefined && typeof args.tools !== "boolean")
      || (args.stream !== undefined && typeof args.stream !== "boolean")
      || (args.stream === true && !args.requestId)
      || (args.workspaceEnabled !== undefined && typeof args.workspaceEnabled !== "boolean")
      || (args.imageSearchEnabled !== undefined && typeof args.imageSearchEnabled !== "boolean")
      || (args.webResearchEnabled !== undefined && typeof args.webResearchEnabled !== "boolean")
      || (args.requiredPageTool !== undefined && (args.requiredPageTool !== "create_page" || args.tools === false || args.workspaceEnabled !== true))
      || (args.configurationId !== undefined && !isNonEmptyString(args.configurationId, 36))) {
      throw assistantError("E_INVALID_ARGUMENT", "AI 请求参数无效。");
    }
    const toolsEnabled = args.tools !== false;
    const { messages, textSize } = normalizeMessages(args.messages, toolsEnabled);
    const provider = config.getProvider(args.configurationId);
    const state = providerTurns(sender, provider.configurationId);
    let availableBytes = maxPayloadBytes - textSize;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      const saved = state.turns.get(toolTurnKey(message));
      if (!saved || saved.bytes > availableBytes) continue;
      message.reasoning_content = saved.text;
      availableBytes -= saved.bytes;
    }
    const webTools = args.webResearchEnabled === false
      ? []
      : assistantWebTools.filter(({ function: tool }) => args.imageSearchEnabled !== false || tool.name !== "search_images");
    const tools = args.requiredPageTool ? [createPageTool] : args.workspaceEnabled === false ? webTools : [...workspaceAssistantTools, ...webTools];
    const toolChoice = args.requiredPageTool ? { type: "function", function: { name: args.requiredPageTool } } : "auto";
    const hasImages = messages.some(({ role, content }) => role === "user" && Array.isArray(content) && content.some(({ type }) => type === "image_url"));
    let stream = args.stream === true;
    let thinking = thinkingCapableModel.test(provider.model);
    let response;
    for (;;) {
      response = await fetchImpl(provider.endpoint, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/json", Accept: stream ? "text/event-stream, application/json" : "application/json",
          ...(provider.key ? { Authorization: "Bearer " + provider.key } : {}) },
        body: JSON.stringify({ model: provider.model, messages, stream, ...(thinking ? { thinking: { type: "enabled" } } : {}),
          ...(toolsEnabled && tools.length ? { tools, tool_choice: toolChoice } : {}) }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(stream ? 300000 : 90000)]),
      });
      if (response.ok) break;
      if ([400, 404, 415, 422, 501].includes(response.status)) {
        const body = await readReplyText(response).catch(() => "");
        if (stream && providerOptionUnsupported(body, "stream")) { stream = false; continue; }
        if (thinking && providerOptionUnsupported(body, "thinking")) { thinking = false; continue; }
        if (hasImages && imagesUnsupported(body)) throw assistantError("E_UNSUPPORTED_IMAGE", "当前模型不支持图片输入。");
        if (toolsEnabled && toolsUnsupported(body)) throw assistantError("E_UNSUPPORTED_VERSION", "当前模型不支持工具调用。要联网或操作工作区，请选择支持工具调用的模型。");
      } else void response.body?.cancel().catch(() => {});
      throw responseError(response.status);
    }
    let lastUpdate = -Infinity;
    const rawMessage = await readChatReply(response, {
      maximumCalls,
      onReasoning: stream ? (text) => {
        if (signal.aborted || sender.isDestroyed?.() || performance.now() - lastUpdate < 80) return;
        const safeText = displayReasoning(text, provider.key, true);
        if (!safeText.trim()) return;
        lastUpdate = performance.now();
        sender.send?.("la:assistant:reasoning", { requestId: args.requestId, text: safeText });
      } : undefined,
    });
    const reply = replyMessage(rawMessage, provider, toolsEnabled, tools);
    signal.throwIfAborted();
    if (config.getConfig().configurationId !== provider.configurationId) throw assistantError("E_CONFLICT", "AI 服务配置已更改，请重新发送这条消息。");
    if (args.requiredPageTool && (reply.tool_calls?.length !== 1 || reply.tool_calls[0].function.name !== args.requiredPageTool)) {
      throw assistantError("E_IO", "AI 服务没有返回可用的建页指令。");
    }
    const turnKey = toolTurnKey(reply);
    const reasoning = providerReasoning(rawMessage);
    if (turnKey && reasoning.length && (!provider.key || !reasoning.includes(provider.key))) {
      const bytes = Buffer.byteLength(JSON.stringify(reasoning)) + 24;
      if (bytes <= maxReasoningBytes) {
        state.totalBytes -= state.turns.get(turnKey)?.bytes ?? 0;
        state.turns.delete(turnKey);
        while (state.turns.size >= maxCachedReasoningTurns || state.totalBytes + bytes > maxReasoningCacheBytes) {
          const oldest = state.turns.keys().next().value;
          state.totalBytes -= state.turns.get(oldest).bytes;
          state.turns.delete(oldest);
        }
        state.turns.set(turnKey, { text: reasoning, bytes });
        state.totalBytes += bytes;
      }
    }
    const visibleReasoning = displayReasoning(reasoning, provider.key);
    return visibleReasoning.trim() ? { ...reply, reasoning: visibleReasoning } : reply;
  }), "无法连接 AI 服务，请检查基础网址和网络。");

  return () => {
    for (const requests of active.values()) for (const controller of requests.values()) controller.abort();
    Object.values(assistantChannels).forEach((channel) => ipcMain.removeHandler(channel));
  };
}
