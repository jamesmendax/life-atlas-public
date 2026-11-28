/**
 * Group raw conversation messages (user / tool / assistant) and live run state
 * into clean turns where consecutive tool events + reasoning belong to ONE
 * collapsible Antigravity/OpenCode-style process trace.
 */

export function groupTranscriptItems(messages = [], runEvents = [], liveReply = null) {
  const combined = [...messages, ...runEvents, ...(liveReply ? [liveReply] : [])];
  const entries = [];
  let pendingTools = [];

  function flushToolsAsTurn(assistantMessage = null, isLive = false) {
    if (!pendingTools.length && !assistantMessage) return;
    entries.push({
      kind: "turn",
      id: assistantMessage?.id ?? pendingTools[0]?.id ?? "live-turn",
      tools: pendingTools,
      assistant: assistantMessage,
      live: isLive,
    });
    pendingTools = [];
  }

  for (const item of combined) {
    if (!item) continue;
    if (item.role === "user") {
      flushToolsAsTurn(null, false);
      entries.push({ kind: "user", id: item.id, message: item });
      continue;
    }
    if (item.role === "tool") {
      pendingTools.push(item);
      continue;
    }
    if (item.role === "assistant") {
      const isLive = item === liveReply;
      flushToolsAsTurn(item, isLive);
    }
  }

  if (pendingTools.length) {
    flushToolsAsTurn(null, Boolean(runEvents.length));
  }

  return entries;
}

export function summarizeToolSteps(tools = []) {
  const grouped = [];
  for (const step of tools) {
    const content = String(step?.content ?? "").trim();
    if (!content) continue;
    const error = Boolean(step.error);
    const previous = grouped.at(-1);
    if (previous && !error && !previous.error && previous.content === content) {
      previous.count += 1;
      continue;
    }
    const separator = content.indexOf(" · ");
    const label = separator > 0 ? content.slice(0, separator) : content;
    const detail = separator > 0 ? content.slice(separator + 3) : "";
    grouped.push({
      id: step.id ?? `${grouped.length}`,
      label,
      detail,
      content,
      error,
      count: 1,
    });
  }
  return grouped;
}

export function formatProcessSummary({ hasReasoning, tools = [], live = false }) {
  const totalTools = tools.length;
  const errorCount = tools.filter((step) => step.error).length;
  if (live) {
    if (hasReasoning && totalTools) return `正在思考与执行 · 已完成 ${totalTools} 项操作`;
    if (totalTools) return `正在执行 · 已完成 ${totalTools} 项操作`;
    return "正在思考…";
  }
  const errorSuffix = errorCount ? `（${errorCount} 项异常）` : "";
  if (hasReasoning && totalTools) return `思考过程与执行步骤 · ${totalTools} 项操作${errorSuffix}`;
  if (totalTools) return `执行过程 · ${totalTools} 项操作${errorSuffix}`;
  return "思考过程";
}
