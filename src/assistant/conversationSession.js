import { useCallback, useRef, useState } from "react";

export function assistantResult(result, fallback) {
  if (!result?.ok) throw new Error(result?.error?.message || fallback);
  return result.value;
}

export function useAssistantConversationSession(bridge) {
  const [history, setHistory] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [historyError, setHistoryError] = useState("");
  const readRequest = useRef(null);
  const loaded = useRef(false);
  const unsaved = useRef(new Map());
  const available = Boolean(bridge?.listConversations);

  const load = useCallback(() => {
    if (!available || loaded.current) return Promise.resolve();
    if (readRequest.current) return readRequest.current;
    setHistoryError("");
    const request = (async () => {
      try {
        const { activeId, conversations } = assistantResult(await bridge.listConversations(), "无法读取对话历史。");
        const active = activeId ? assistantResult(await bridge.getConversation({ id: activeId }), "无法打开对话。") : null;
        loaded.current = true;
        setHistory(conversations);
        setConversation(active);
      } catch (error) { setHistoryError(error.message || "无法读取对话历史。"); }
    })();
    readRequest.current = request;
    void request.finally(() => { readRequest.current = null; });
    return request;
  }, [available, bridge]);

  async function get(id) {
    return unsaved.current.get(id) ?? assistantResult(await bridge.getConversation({ id }), "无法打开对话。");
  }

  async function select(id) {
    await load();
    if (!loaded.current) return false;
    const active = id ? await get(id) : null;
    assistantResult(await bridge.selectConversation({ id }), "无法切换对话。");
    setConversation(active);
    return true;
  }

  async function save(next, { select: selectAfterSaving = false } = {}) {
    const metadata = assistantResult(await bridge.saveConversation({ conversation: next, ...(selectAfterSaving ? { activeId: next.id } : {}) }), "无法保存对话。");
    const saved = { ...next, ...metadata };
    unsaved.current.delete(next.id);
    setHistory((previous) => [metadata, ...previous.filter((entry) => entry.id !== metadata.id)]);
    setConversation((previous) => selectAfterSaving || previous?.id === next.id ? saved : previous);
    return saved;
  }

  function retain(next) {
    unsaved.current.set(next.id, next);
    setConversation((current) => current?.id === next.id ? next : current);
  }

  return { available, history, historyError, conversation, load, get, select, save, retain, hasUnsaved: unsaved.current.has(conversation?.id) };
}
