import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeDeepSeekToolCalls } from "../electron/main/assistant/deepSeekToolCalls.js";

const marker = "｜DSML｜ ";
const eos = "<｜end▁of▁sentence｜>";
const allow = new Set(["search_workspace", "create_page"]);

function parameter(name, value, isString = true) {
  return `<${marker}parameter name="${name}" string="${isString}">${value}</${marker}parameter>`;
}

function invoke(name, parameters = []) {
  return `<${marker}invoke name="${name}">\n${parameters.join("\n")}\n</${marker}invoke>`;
}

function envelope(...calls) {
  return `<${marker}calls>\n${calls.join("\n")}\n</${marker}calls>`;
}

test("decodes a complete DSML envelope and preserves raw strings and JSON types", () => {
  const markdown = "  # 计划\n\n<a href=\"example\">A & B</a>  \n";
  const content = envelope(invoke("create_page", [
    parameter("title", "2026"),
    parameter("markdown", markdown),
    parameter("limit", "5", false),
    parameter("enabled", " true ", false),
    parameter("items", '[{"a":"中文","b":null},false]', false),
    parameter("empty", ""),
  ]));
  const [call] = decodeDeepSeekToolCalls(`\r\n${content}${eos}\r\n`, allow);
  assert.equal(call.type, "function");
  assert.equal(call.function.name, "create_page");
  assert.deepEqual(JSON.parse(call.function.arguments), {
    title: "2026",
    markdown,
    limit: 5,
    enabled: true,
    items: [{ a: "中文", b: null }, false],
    empty: "",
  });
});

test("decodes the observed double-bar envelope with multiple calls and safe IDs", () => {
  const content = envelope(invoke("search_workspace", [parameter("query", "计划")]), invoke("create_page"))
    .replaceAll(marker, "｜｜DSML｜｜ ");
  const calls = decodeDeepSeekToolCalls(content, ["search_workspace", "create_page"]);
  assert.deepEqual(calls.map(({ function: call }) => [call.name, JSON.parse(call.arguments)]), [
    ["search_workspace", { query: "计划" }],
    ["create_page", {}],
  ]);
  assert.equal(new Set(calls.map(({ id }) => id)).size, 2);
  for (const { id } of calls) assert.match(id, /^[a-zA-Z0-9_.:-]{1,64}$/);
  assert.deepEqual(decodeDeepSeekToolCalls(content, allow), calls);
});

test("decodes the documented V4 legacy envelope", () => {
  const content = '<｜DSML｜tool_calls><｜DSML｜invoke name="search_workspace">'
    + '<｜DSML｜parameter name="query" string="true">notes</｜DSML｜parameter>'
    + `</｜DSML｜invoke></｜DSML｜tool_calls>${eos}`;
  const [call] = decodeDeepSeekToolCalls(content, allow);
  assert.equal(call.function.name, "search_workspace");
  assert.deepEqual(JSON.parse(call.function.arguments), { query: "notes" });
});

test("rejects an entire envelope if any tool name was not advertised", () => {
  const valid = invoke("search_workspace", [parameter("query", "notes")]);
  assert.equal(decodeDeepSeekToolCalls(envelope(valid, invoke("unavailable")), allow), null);
  assert.equal(decodeDeepSeekToolCalls(envelope(valid), ["create_page"]), null);
  assert.equal(decodeDeepSeekToolCalls(envelope(valid), new Set()), null);
  assert.equal(decodeDeepSeekToolCalls(envelope(valid), "search_workspace"), null);
});

test("rejects text around the envelope, incomplete syntax and other formats", () => {
  const call = invoke("create_page", [parameter("title", "notes")]);
  const valid = envelope(call);
  for (const invalid of [
    null,
    '{"name":"create_page","arguments":{"title":"notes"}}',
    `Here is an example:\n${valid}`,
    `\`\`\`\n${valid}\n\`\`\``,
    `${valid} extra`,
    `${valid}${eos}${eos}`,
    `${valid}${valid}`,
    valid.slice(0, -1),
    valid.replace("</｜DSML｜ invoke>", ""),
    valid.replace("</｜DSML｜ calls>", "</｜｜DSML｜｜ calls>"),
    valid.replace("<｜DSML｜ invoke", "<｜DSML｜invoke"),
    valid.replaceAll("｜", "|"),
    envelope(),
    call,
  ]) assert.equal(decodeDeepSeekToolCalls(invalid, allow), null, String(invalid));
});

test("rejects repeated parameters, malformed JSON and reordered or nested tags", () => {
  const title = parameter("title", "notes");
  for (const parameters of [
    [title, title],
    [parameter("blocks", "[1,]", false)],
    [parameter("blocks", "[1e400]", false)],
    [title.replace('name="title" string="true"', 'string="true" name="title"')],
    [title.replace('string="true"', 'string="True"')],
    [title.replace('string="true"', 'string="true" extra="x"')],
    [parameter("title", `<${marker}invoke name="search_workspace">notes`)],
  ]) assert.equal(decodeDeepSeekToolCalls(envelope(invoke("create_page", parameters)), allow), null);
});

test("bounds call count, parameter count and wire and output lengths", () => {
  const call = invoke("create_page");
  const parameters = Array.from({ length: 65 }, (_, index) => parameter(`arg_${index}`, ""));
  assert.equal(decodeDeepSeekToolCalls(envelope(...Array(12).fill(call)), allow).length, 12);
  assert.equal(decodeDeepSeekToolCalls(envelope(...Array(13).fill(call)), allow), null);
  assert.ok(decodeDeepSeekToolCalls(envelope(invoke("create_page", parameters.slice(0, 64))), allow));
  assert.equal(decodeDeepSeekToolCalls(envelope(invoke("create_page", parameters)), allow), null);
  assert.equal(decodeDeepSeekToolCalls(envelope(invoke("create_page", [parameter("title", "z".repeat(32000))])), allow), null);
  assert.equal(decodeDeepSeekToolCalls(envelope(invoke("create_page", [parameter("title", "\0".repeat(6000))])), allow), null);
});
