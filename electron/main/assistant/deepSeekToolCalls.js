import { createHash } from "node:crypto";

const maxContentLength = 32000;
const maxCalls = 12;
const maxParameters = 64;
const formats = [
  { prefix: "｜DSML｜ ", envelope: "calls" },
  { prefix: "｜｜DSML｜｜ ", envelope: "calls" },
  { prefix: "｜DSML｜", envelope: "tool_calls" },
];
const endOfSentence = "<｜end▁of▁sentence｜>";
const dsmlMarkup = /[<＜]\/?[|｜]{1,2}DSML[|｜]{1,2}/u;

function validateJsonNumber(_key, value) {
  if (typeof value === "number" && !Number.isFinite(value)) throw new RangeError("DSML number exceeds JSON range");
  return value;
}

export function decodeDeepSeekToolCalls(content, availableNames) {
  if (typeof content !== "string" || content.length > maxContentLength) return null;
  const names = Array.isArray(availableNames) ? new Set(availableNames) : availableNames;
  if (!(names instanceof Set) || !names.size) return null;

  let position = 0;
  const whitespace = /[ \t\r\n]*/y;
  function skipWhitespace() {
    whitespace.lastIndex = position;
    whitespace.exec(content);
    position = whitespace.lastIndex;
  }
  function consume(token) {
    skipWhitespace();
    if (!content.startsWith(token, position)) return false;
    position += token.length;
    return true;
  }
  function readTag(pattern) {
    pattern.lastIndex = position;
    const match = pattern.exec(content);
    if (match) position = pattern.lastIndex;
    return match;
  }

  const format = formats.find(({ prefix, envelope }) => consume(`<${prefix}${envelope}>`));
  if (!format) return null;
  const { prefix, envelope } = format;
  const invokeTag = new RegExp(`<${prefix}invoke name="([a-zA-Z0-9_-]{1,64})">`, "y");
  const parameterTag = new RegExp(`<${prefix}parameter name="([a-zA-Z0-9_-]{1,64})" string="(true|false)">`, "y");
  const parameterEnd = `</${prefix}parameter>`;

  const calls = [];
  const idPrefix = `call_dsml_${createHash("sha256").update(content).digest("hex").slice(0, 24)}`;
  while (!consume(`</${prefix}${envelope}>`)) {
    const invocation = readTag(invokeTag);
    if (calls.length >= maxCalls || !invocation || !names.has(invocation[1])) return null;

    const args = Object.create(null);
    let parameterCount = 0;
    try {
      while (!consume(`</${prefix}invoke>`)) {
        const parameter = readTag(parameterTag);
        if (++parameterCount > maxParameters || !parameter || Object.hasOwn(args, parameter[1])) return null;
        const end = content.indexOf(parameterEnd, position);
        if (end < 0) return null;
        const value = content.slice(position, end);
        if (dsmlMarkup.test(value)) return null;
        args[parameter[1]] = parameter[2] === "true" ? value : JSON.parse(value, validateJsonNumber);
        position = end + parameterEnd.length;
      }
      const encodedArguments = JSON.stringify(args);
      if (encodedArguments.length > maxContentLength) return null;
      calls.push({
        id: `${idPrefix}_${calls.length + 1}`,
        type: "function",
        function: { name: invocation[1], arguments: encodedArguments },
      });
    } catch {
      return null;
    }
  }

  consume(endOfSentence);
  skipWhitespace();
  return calls.length && position === content.length ? calls : null;
}
