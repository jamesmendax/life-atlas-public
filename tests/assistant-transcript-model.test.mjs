import test from "node:test";
import assert from "node:assert/strict";
import { extractInlineThinkTags, providerReasoning, readChatReply } from "../electron/main/assistant/chatReply.js";
import { formatProcessSummary, groupTranscriptItems, summarizeToolSteps } from "../src/components/assistant/assistantTranscriptModel.js";

test("groupTranscriptItems folds consecutive tool events with their assistant turn and compresses identical steps", () => {
  const messages = [
    { id: "u1", role: "user", content: "做个奥特曼橱窗" },
    { id: "t1", role: "tool", content: "读取网页 tsuburaya-prod.com · 取得 2 项新资料。" },
    { id: "t2", role: "tool", content: "下载图片 · 图片已下载，等待写入。" },
    { id: "t3", role: "tool", content: "下载图片 · 图片已下载，等待写入。" },
    { id: "t4", role: "tool", content: "下载图片 · 图片已下载，等待写入。" },
    { id: "t5", role: "tool", content: "编辑页面 · 工具参数不完整或超出允许范围。", error: true },
    { id: "t6", role: "tool", content: "新建页面 《奥特曼橱窗》 · 已写入：页面已创建。" },
    { id: "a1", role: "assistant", content: "已完成页面创建。", reasoning: "先查官方文档，再逐个导入图片并分栏排版。" },
  ];
  const entries = groupTranscriptItems(messages, [], null);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].kind, "user");
  assert.equal(entries[1].kind, "turn");
  assert.equal(entries[1].tools.length, 6);
  assert.equal(entries[1].assistant.id, "a1");
  assert.equal(entries[1].live, false);

  const steps = summarizeToolSteps(entries[1].tools);
  assert.equal(steps.length, 4);
  assert.equal(steps[1].label, "下载图片");
  assert.equal(steps[1].count, 3);
  assert.equal(steps[2].error, true);
  assert.equal(
    formatProcessSummary({ hasReasoning: true, tools: entries[1].tools, live: false }),
    "思考过程与执行步骤 · 6 项操作（1 项异常）",
  );
  assert.equal(
    formatProcessSummary({ hasReasoning: true, tools: entries[1].tools, live: true }),
    "正在思考与执行 · 已完成 6 项操作",
  );
});

test("extractInlineThinkTags and streaming readChatReply preserve full uncensored CoT from <think> blocks and reasoning_details", async () => {
  assert.equal(providerReasoning({ reasoning_details: [{ text: "第一步" }, { text: "第二步" }] }), "第一步\n第二步");
  const jsonExtracted = extractInlineThinkTags({ role: "assistant", content: "<think>先检查页面结构，再调整分栏。</think>\n已为你更新。" });
  assert.equal(jsonExtracted.reasoning_content, "先检查页面结构，再调整分栏。");
  assert.equal(jsonExtracted.content, "已为你更新。");

  const encoder = new TextEncoder();
  const chunks = [
    'data: {"choices":[{"delta":{"content":"<thi"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"nk>第一步分析需求。"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"第二步制定方案。</thin"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"k>\\n这是最终回答。"},"finish_reason":"stop"}]}\n\n',
    "data: [DONE]\n\n",
  ];
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  const streamedThoughts = [];
  const reply = await readChatReply(new Response(stream, { headers: { "Content-Type": "text/event-stream" } }), {
    maximumCalls: 12,
    onReasoning: (text) => streamedThoughts.push(text),
  });
  assert.equal(reply.reasoning_content, "第一步分析需求。第二步制定方案。");
  assert.equal(reply.content, "这是最终回答。");
  assert.ok(streamedThoughts.length >= 2);
});
