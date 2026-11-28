export const maxAssistantMessageLength = 16000;
export const maxAssistantReasoningLength = 96000;
export const maxAssistantTitleLength = 80;
export const maxAssistantAttachments = 6;
export const maxAssistantAttachmentBytes = 16 * 1024 * 1024;

export function attachmentReference({ id, name, kind, mimeType, size, assetUrl }) {
  return { id, name, kind, mimeType, size, assetUrl };
}

export function createAssistantMessage(content, attachments, workspaceEnabled, contextPageId) {
  return {
    id: crypto.randomUUID(), role: "user", content, workspaceEnabled, attachments: attachments.map(attachmentReference),
    ...(workspaceEnabled && contextPageId ? { contextPageId } : {}),
  };
}

export function createAssistantConversation(firstMessage, { source, messageId } = {}) {
  const sourceIndex = source?.messages.findIndex((message) => message.id === messageId && message.role === "user");
  if (source && sourceIndex === -1) throw new Error("找不到要编辑的消息。");
  const messages = source ? [...source.messages.slice(0, sourceIndex), firstMessage] : [firstMessage];
  const initialTitle = messages[0].content.trim().replace(/\s+/g, " ") || messages[0].attachments?.[0]?.name || "新对话";
  const suffix = "（编辑版）";
  const title = source ? `${source.title.slice(0, maxAssistantTitleLength - suffix.length)}${suffix}` : initialTitle.slice(0, maxAssistantTitleLength);
  return { id: crypto.randomUUID(), title, messages, revision: 0, ...(source ? { sourceId: source.id } : {}) };
}

export function assistantPromptHistory(messages) {
  return messages.filter(({ role }) => role === "user" || role === "assistant");
}

export function completeWithReasoning(complete, onReasoning, signal) {
  let reasoning = "";
  return async (request) => {
    const prior = reasoning ? reasoning + "\n\n" : "";
    let active = true;
    const show = (text) => {
      if (!active || signal?.aborted || typeof text !== "string" || !text.trim()) return;
      const combined = prior + text;
      const next = combined.length <= maxAssistantReasoningLength
        ? combined : "…\n" + combined.slice(2 - maxAssistantReasoningLength).replace(/^[\uDC00-\uDFFF]/u, "");
      if (next === reasoning) return;
      reasoning = next;
      onReasoning?.(reasoning);
    };
    try {
      const reply = onReasoning ? await complete(request, show) : await complete(request);
      if (!reply?.ok || typeof reply.value?.reasoning !== "string") return reply;
      const { reasoning: display, ...message } = reply.value;
      if (onReasoning) show(display);
      return { ...reply, value: message };
    } finally {
      active = false;
    }
  };
}
