import { isPlainObject } from "../ipc/validate.js";
import { assistantError } from "./errors.js";

const maxReplyBytes = 1024 * 1024;
const maxStreamBytes = 64 * maxReplyBytes;
const invalidReply = () => assistantError("E_IO", "AI 服务没有返回有效的聊天消息。");

async function* replyChunks(response, limit = maxReplyBytes) {
  if (!response.body || Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw assistantError("E_IO", "AI 服务响应为空或超过大小限制。");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let ended = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        ended = true;
        yield decoder.decode();
        return;
      }
      size += value.byteLength;
      if (size > limit) throw assistantError("E_IO", "AI 服务响应超过大小限制。");
      yield decoder.decode(value, { stream: true });
    }
  } finally {
    if (!ended) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function readReplyText(response) {
  let text = "";
  for await (const chunk of replyChunks(response)) text += chunk;
  return text;
}

export function providerReasoning(message) {
  if (typeof message?.reasoning_content === "string" && message.reasoning_content) return message.reasoning_content;
  if (typeof message?.reasoning === "string" && message.reasoning) return message.reasoning;
  if (Array.isArray(message?.reasoning_details)) {
    const joined = message.reasoning_details.map((entry) => typeof entry?.text === "string" ? entry.text : "").filter(Boolean).join("\n");
    if (joined) return joined;
  }
  return "";
}

export function extractInlineThinkTags(rawMessage) {
  if (!rawMessage || typeof rawMessage !== "object") return rawMessage;
  if (providerReasoning(rawMessage)) return rawMessage;
  if (typeof rawMessage.content !== "string" || !rawMessage.content.includes("<think>")) return rawMessage;
  const thoughts = [];
  const cleaned = rawMessage.content.replace(/<think>([\s\S]*?)<\/think>/gi, (_match, inner) => {
    const trimmed = String(inner ?? "").trim();
    if (trimmed) thoughts.push(trimmed);
    return "";
  }).replace(/^\s+/, "");
  if (!thoughts.length) return rawMessage;
  return { ...rawMessage, reasoning_content: thoughts.join("\n\n"), content: cleaned || null };
}

function createThinkTagStreamSplitter(onThought, onVisible) {
  let pending = "";
  let inThink = false;
  const openTag = "<think>";
  const closeTag = "</think>";

  function partialTagLength(text, tag) {
    const max = Math.min(text.length, tag.length - 1);
    for (let len = max; len > 0; len -= 1) {
      if (text.toLowerCase().endsWith(tag.slice(0, len))) return len;
    }
    return 0;
  }

  function drain(flushAll = false) {
    while (pending.length) {
      const lower = pending.toLowerCase();
      if (!inThink) {
        const idx = lower.indexOf(openTag);
        if (idx >= 0) {
          if (idx > 0) onVisible(pending.slice(0, idx));
          pending = pending.slice(idx + openTag.length);
          inThink = true;
          continue;
        }
        const hold = flushAll ? 0 : partialTagLength(pending, openTag);
        const emit = pending.slice(0, pending.length - hold);
        if (emit) onVisible(emit);
        pending = pending.slice(pending.length - hold);
        break;
      } else {
        const idx = lower.indexOf(closeTag);
        if (idx >= 0) {
          if (idx > 0) onThought(pending.slice(0, idx));
          pending = pending.slice(idx + closeTag.length);
          inThink = false;
          continue;
        }
        const hold = flushAll ? 0 : partialTagLength(pending, closeTag);
        const emit = pending.slice(0, pending.length - hold);
        if (emit) onThought(emit);
        pending = pending.slice(pending.length - hold);
        break;
      }
    }
  }

  return {
    push(chunk) {
      if (!chunk) return;
      pending += chunk;
      drain(false);
    },
    flush() {
      drain(true);
    },
  };
}

async function readStreamMessage(response, onReasoning, maximumCalls) {
  const message = { role: "assistant", content: null, reasoning_content: "" };
  const calls = new Map();
  let rest = "";
  let data = [];
  let dataSize = 0;
  let messageSize = 0;
  let done = false;
  let finished = false;

  function append(text, fragment) {
    if (typeof fragment !== "string" || !fragment) return text;
    messageSize += Buffer.byteLength(fragment);
    if (messageSize > maxReplyBytes) throw assistantError("E_IO", "AI 服务响应超过大小限制。");
    return (text ?? "") + fragment;
  }

  let hasNativeReasoning = false;
  const thinkSplitter = createThinkTagStreamSplitter(
    (thought) => {
      message.reasoning_content = append(message.reasoning_content, thought);
      onReasoning?.(message.reasoning_content);
    },
    (visible) => {
      message.content = append(message.content, visible);
    },
  );

  function readLine(line) {
    if (line.startsWith("data:")) {
      dataSize += line.length;
      if (dataSize > maxReplyBytes) throw invalidReply();
      data.push(line.slice(5).replace(/^ /, ""));
    }
    if (line || !data.length) return;
    const payload = data.join("\n");
    data = [];
    dataSize = 0;
    if (payload.trim() === "[DONE]") {
      done = true;
      return;
    }
    let item;
    try { item = JSON.parse(payload); }
    catch { throw invalidReply(); }
    if (!isPlainObject(item) || item.error) throw invalidReply();
    const choice = item.choices?.[0];
    if (!choice) return;
    if (typeof choice.finish_reason === "string" && choice.finish_reason) finished = true;
    const delta = choice.delta ?? {};
    if (!isPlainObject(delta) || (delta.role !== undefined && delta.role !== "assistant")) throw invalidReply();
    const reasoning = providerReasoning(delta);
    if (reasoning) {
      hasNativeReasoning = true;
      message.reasoning_content = append(message.reasoning_content, reasoning);
      onReasoning?.(message.reasoning_content);
    }
    if (typeof delta.content === "string" && delta.content) {
      if (hasNativeReasoning) message.content = append(message.content, delta.content);
      else thinkSplitter.push(delta.content);
    }
    const toolCalls = delta.tool_calls ?? [];
    if (!Array.isArray(toolCalls)) throw invalidReply();
    for (const call of toolCalls) {
      const index = call?.index;
      if (!Number.isSafeInteger(index) || index < 0 || index >= maximumCalls
        || (call.type !== undefined && call.type !== null && call.type !== "function")) throw invalidReply();
      const current = calls.get(index) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
      if (call.id !== current.id) current.id = append(current.id, call.id);
      current.function.name = append(current.function.name, call.function?.name);
      current.function.arguments = append(current.function.arguments, call.function?.arguments);
      calls.set(index, current);
    }
    if (choice.finish_reason === "length" && calls.size) throw invalidReply();
  }

  for await (const chunk of replyChunks(response, maxStreamBytes)) {
    rest += chunk;
    let end;
    while (!done && (end = rest.indexOf("\n")) >= 0) {
      readLine(rest.slice(0, end).replace(/\r$/, ""));
      rest = rest.slice(end + 1);
    }
    if (rest.length > maxReplyBytes) throw invalidReply();
    if (done) break;
  }
  if (!done) {
    if (rest) readLine(rest.replace(/\r$/, ""));
    readLine("");
  }
  if (!done && !finished) throw assistantError("E_IO", "AI 服务的流式响应意外中断。");
  if (!hasNativeReasoning) thinkSplitter.flush();
  if (typeof message.content === "string" && message.reasoning_content && !hasNativeReasoning) {
    message.content = message.content.replace(/^\s+/, "") || null;
  }
  if (calls.size) message.tool_calls = Array.from(calls.keys()).sort((a, b) => a - b).map((index) => calls.get(index));
  return message;
}

export async function readChatReply(response, { onReasoning, maximumCalls }) {
  if (response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
    return readStreamMessage(response, onReasoning, maximumCalls);
  }
  const text = await readReplyText(response);
  try { return extractInlineThinkTags(JSON.parse(text)?.choices?.[0]?.message); }
  catch { throw assistantError("E_IO", "AI 服务没有返回有效的 JSON 响应。"); }
}
