import { dateMillis, isEmptyProperty, normalizeDate, normalizeDateTimeZone } from "../databaseProperties.js";
import { axisTime } from "../timelineDateFields.js";
import { formatNumber, NUMBER_FORMATS } from "../numberFormat.js";
import { EMPTY_FORMULA_NUMBER, FormulaPage, FormulaPerson, StyledFormulaText, joinFormulaText, linkFormulaText, plainFormulaValue, styleFormulaText, unstyleFormulaText } from "./values.js";

const MAX_DEPTH = 64;
const MAX_STEPS = 50000;

export function formulaError(code, message, detail = null) {
  return { error: { code, message, ...(detail ? { detail } : {}) } };
}
export function isFormulaError(value) { return Boolean(value && typeof value === "object" && value.error?.code); }

export function createFormulaBudget(maxSteps) {
  const limit = Math.min(MAX_STEPS, Number(maxSteps) || MAX_STEPS);
  let remaining = limit;
  return (steps = 1) => {
    remaining -= steps;
    if (remaining < 0) throw new Error("公式计算步骤过多");
  };
}

function syntaxError(position, reason) {
  return new SyntaxError(`第 ${position + 1} 个字符：${reason}`);
}

export function tokenizeFormula(source) {
  const input = String(source ?? "");
  const tokens = [];
  let i = 0;
  const push = (type, value, start = i) => tokens.push({ type, value, start });
  while (i < input.length) {
    if (/\s/.test(input[i])) { i++; continue; }
    const start = i;
    if (input.startsWith("/*", i)) {
      const end = input.indexOf("*/", i + 2);
      if (end < 0) throw syntaxError(start, "块注释缺少结束符 */");
      i = end + 2;
      continue;
    }
    if (input.startsWith("{{", i)) {
      const end = input.indexOf("}}", i + 2);
      if (end < 0) throw syntaxError(start, "属性引用缺少 }}");
      const id = input.slice(i + 2, end).trim();
      if (!id) throw syntaxError(start, "属性引用为空");
      push("property", id, start); i = end + 2; continue;
    }
    const two = input.slice(i, i + 2);
    if (["==", "!=", ">=", "<=", "&&", "||"].includes(two)) { push("op", two, start); i += 2; continue; }
    if ("()[],?:".includes(input[i])) { push(input[i], input[i], start); i++; continue; }
    if ("+-*/%^><!".includes(input[i])) { push("op", input[i], start); i++; continue; }
    if (input[i] === '"' || input[i] === "'") {
      const quote = input[i++];
      let out = "";
      let closed = false;
      while (i < input.length) {
        const ch = input[i++];
        if (ch === quote) { closed = true; break; }
        if (ch === "\\") {
          if (i >= input.length) break;
          const escaped = input[i++];
          out += ({ n:"\n", r:"\r", t:"\t", "\\":"\\", '"':'"', "'":"'" })[escaped] ?? escaped;
        } else out += ch;
      }
      if (!closed) throw syntaxError(start, "字符串缺少结束引号");
      tokens.push({ type: "literal", value: out, start, end: i });
      continue;
    }
    const number = input.slice(i).match(/^(?:\d+(?:\.\d+)?|\.\d+)/);
    if (number) { push("literal", Number(number[0]), start); i += number[0].length; continue; }
    if (input[i] === ".") { push(".", ".", start); i++; continue; }
    const ident = input.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (ident) {
      const word = ident[0]; i += word.length;
      const lower = word.toLowerCase();
      if (lower === "true" || lower === "false") push("literal", lower === "true", start);
      else if (lower === "null") push("literal", null, start);
      else if (lower === "empty") tokens.push({ type: "literal", value: null, start, word: "empty" });
      else if (lower === "and" || lower === "or" || lower === "not") push("op", lower, start);
      else push("identifier", word, start);
      continue;
    }
    throw syntaxError(start, "无法识别的字符");
  }
  tokens.push({ type:"eof", value:null, start:input.length });
  return tokens;
}

export function parseFormula(source, { onPropertyNameLiteral, onRelatedProperty } = {}) {
  const input = String(source ?? "");
  const tokens = tokenizeFormula(input);
  const literalLocations = new WeakMap();
  let index = 0;
  let depth = 0;
  const current = () => tokens[index];
  const take = () => tokens[index++];
  const expect = (type, value) => {
    const token = take();
    if (token.type !== type || (value != null && token.value !== value)) throw syntaxError(token.start, `这里应该是 ${value ?? type}`);
    return token;
  };
  const node = (kind, fields = {}) => ({ kind, ...fields });
  const descend = (fn) => {
    if (++depth > MAX_DEPTH) throw syntaxError(current().start, "公式嵌套太深");
    try { return fn(); } finally { depth--; }
  };
  const argumentsUntil = (end) => {
    const args = [];
    if (current().type !== end) {
      do { args.push(expression()); if (current().type !== ",") break; take(); } while (true);
    }
    return { args, close: expect(end, end) };
  };
  const call = (token, receiver) => {
    const name = token.value ?? token.word;
    expect("(", "(");
    const { args, close } = argumentsUntil(")");
    if (name.toLowerCase() === "prop") {
      if (args.length % 2 !== 1 || (!receiver && args.length !== 1) || args.some(arg => arg.kind !== "Literal" || typeof arg.value !== "string")) throw syntaxError(token.start, "prop() 需要一个属性名称字符串");
      if (receiver) {
        const bindings = [];
        for (let i = 1; i < args.length; i += 2) bindings.push({ sourceId: args[i].value, propertyId: args[i+1].value });
        const related = node("RelatedProperty", { argument: receiver, propertyName: args[0].value, ...(bindings.length ? { bindings } : {}) });
        onRelatedProperty?.(related, { close: close.start, name: literalLocations.get(args[0]), sources: args.slice(1).filter((_, index) => index % 2 === 0).map(arg => literalLocations.get(arg)) });
        return related;
      }
      onPropertyNameLiteral?.({ name: args[0].value, ...literalLocations.get(args[0]), callStart: token.start, callEnd: close.start + 1 });
      return node("PropertyRef", { propertyName: args[0].value });
    }
    return node("CallExpression", { name, args: receiver ? [receiver, ...args] : args });
  };
  const primary = () => descend(() => {
    const token = take();
    if (current()?.type === "(" && ((token.type === "op" && ["and", "or"].includes(token.value)) || (token.type === "literal" && token.word === "empty"))) return call(token);
    if (token.type === "literal") {
      const literal = node("Literal", { value: token.value });
      if (typeof token.value === "string") {
        literalLocations.set(literal, { start: token.start, end: token.end });
      }
      return literal;
    }
    if (token.type === "property") return node("PropertyRef", { propertyId: token.value });
    if (token.type === "identifier") {
      return current().type === "(" ? call(token) : node("Identifier", { name: token.value });
    }
    if (token.type === "[") return node("ListExpression", { args: argumentsUntil("]").args });
    if (token.type === "(") { const value = expression(); expect(")", ")"); return value; }
    throw syntaxError(token.start, "这里应该是一个值");
  });
  const postfix = () => {
    let value = primary();
    while (current().type === ".") {
      take();
      const method = take();
      if (method.type !== "identifier" && method.word !== "empty" && !(method.type === "op" && ["and", "or", "not"].includes(method.value))) throw syntaxError(method.start, "这里应该是方法名称");
      value = descend(() => call(method, value));
    }
    return value;
  };
  const unary = () => current().type === "op" && ["-", "+", "!", "not"].includes(current().value)
    ? descend(() => node("UnaryExpression", { operator: take().value, argument: unary() })) : power();
  function power() {
    const left = postfix();
    if (current().value !== "^" || current().type !== "op") return left;
    take();
    return descend(() => node("BinaryExpression", { operator: "^", left, right: unary() }));
  }
  const binary = (next, operators) => () => {
    let left = next();
    while (current().type === "op" && operators.includes(current().value)) {
      const operator = take().value;
      left = node("BinaryExpression", { operator, left, right: next() });
    }
    return left;
  };
  const multiplicative = binary(unary, ["*", "/", "%"]);
  const additive = binary(multiplicative, ["+", "-"]);
  const comparison = binary(additive, [">", ">=", "<", "<="]);
  const equality = binary(comparison, ["==", "!="]);
  const logicalAnd = binary(equality, ["and", "&&"]);
  const logicalOr = binary(logicalAnd, ["or", "||"]);
  function expression() {
    const condition = logicalOr();
    if (current().type !== "?") return condition;
    take();
    return descend(() => {
      const whenTrue = expression();
      expect(":", ":");
      return node("CallExpression", { name: "if", args: [condition, whenTrue, expression()] });
    });
  }
  const ast = expression();
  if (current().type !== "eof") throw syntaxError(current().start, "公式末尾有多余的内容");
  return ast;
}

export function renameFormulaPropertyReference(source, oldName, newName, { propertyId } = {}) {
  if (typeof source !== "string" || oldName === newName && !propertyId || typeof newName !== "string") return source;
  const locations = [];
  try {
    parseFormula(source, { onPropertyNameLiteral: (location) => {
      if (location.name === oldName) locations.push(location);
    } });
  } catch { return source; }
  if (!locations.length) return source;
  let replacement = propertyId ? `{{${propertyId}}}` : JSON.stringify(newName);
  // The existing formula lexer supports \n/\r/\t but not all JSON escapes.
  // Keep other control characters literal when JSON would not round-trip.
  if (!propertyId && parseFormula(`prop(${replacement})`).propertyName !== newName) {
    replacement = `"${newName.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  }
  let result = source;
  for (const { start, end, callStart, callEnd } of locations.reverse()) {
    result = result.slice(0, propertyId ? callStart : start) + replacement + result.slice(propertyId ? callEnd : end);
  }
  return result;
}

const dayMs = 86400000;
const minuteMs = 60000;
const durationUnits = Object.freeze({ minute: minuteMs, hour: minuteMs * 60, day: dayMs, week: dayMs * 7 });
const calendarUnits = Object.freeze({ month: 1, quarter: 3, year: 12 });
// An operation on an unset date leaves the enclosing formula cell blank.
const missingDateInput = Symbol("missing date input");
const zoneSuffix = /[zZ]$|[+-]\d{2}:?\d{2}$/;
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function dateValue(value) {
  const normalized = normalizeDate(value);
  const text = normalized?.start || (typeof value === "string" ? value : "");
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[zZ]|[+-]\d{2}:?\d{2})?)?$/.test(text)) return null;
  const includeTime = text.length > 10;
  const zone = includeTime ? normalized?.timeZone || null : null;
  const hasOffset = zoneSuffix.test(text);
  const stamp = includeTime ? text : `${text}T00:00:00`;
  const parsed = Date.parse(hasOffset ? stamp : stamp + "Z");
  const ms = hasOffset ? parsed : zonedInstant(parsed, zone);
  if (!Number.isFinite(ms)) return null;
  return { ms, hasZone: hasOffset || !!zone, normalized: { ...normalized, start: text, end: normalized?.end || null, includeTime, timeZone: normalized?.timeZone || null } };
}

function dateOperand(value, message = "需要有效的日期") {
  if (value === null) throw missingDateInput;
  const date = dateValue(value);
  if (!date) throw new TypeError(message);
  return date;
}

function wallTime(ms, zone) {
  const date = new Date(ms);
  if (!zone || zone === "UTC" || !Number.isFinite(date.getTime())) return date.getTime();
  return axisTime(date.toISOString(), null, zone);
}

function dateStamp(ms, includeTime, zone = null) {
  const wall = wallTime(ms, zone);
  if (!Number.isFinite(wall)) throw new TypeError("结果超出范围");
  const iso = new Date(wall).toISOString();
  if (iso[10] !== "T") throw new TypeError("结果超出范围");
  if (!includeTime) return iso.slice(0, 10);
  const stamp = iso.slice(0, iso.slice(20, 23) !== "000" ? 23 : iso.slice(17, 19) !== "00" ? 19 : 16);
  if (!zone) return stamp;
  const offset = Math.round((wall - ms) / minuteMs);
  if (!offset) return stamp + "Z";
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
  return `${stamp}${offset < 0 ? "-" : "+"}${hours}:${minutes}`;
}

function parseDate(...values) {
  if (values.length !== 1) throw new TypeError("parseDate 的参数数量不正确");
  const [text] = values;
  if (typeof text !== "string") throw new TypeError("parseDate 需要文本");
  const iso = text.trim()
    .replace(/^(\d{4})(\d{2})(\d{2})(?=T|$)/, "$1-$2-$3")
    .replace(/T(\d{2})(\d{2})(\d{2})?(?=[.Zz+-]|$)/, (_, hour, minute, second) =>
      `T${hour}:${minute}${second === undefined ? "" : ":" + second}`);
  const date = dateValue(iso);
  if (!date) return null;
  const day = date.normalized.start.slice(0, 10);
  if (dateStamp(Date.parse(day + "T00:00:00Z"), false) !== day) return null;
  if (!date.hasZone) return date.normalized;
  const timeZone = deviceZone();
  return { ...date.normalized, start: dateStamp(date.ms, true, timeZone), timeZone };
}

function asNumber(value) {
  if (value === EMPTY_FORMULA_NUMBER) return 0;
  if (value === null || value === undefined || value === "" || typeof value === "object") throw new TypeError("需要数字");
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError("需要数字");
  return number;
}

function isNumericZero(value) {
  return value === 0 || value === EMPTY_FORMULA_NUMBER;
}

function dateUnit(unit) {
  const key = String(unit).toLowerCase().replace(/s$/, "");
  if (!Object.hasOwn(durationUnits, key) && !Object.hasOwn(calendarUnits, key)) throw new TypeError("不支持的时间单位");
  return key;
}

function shiftCalendarMonths(ms, count) {
  const date = new Date(ms);
  const day = date.getUTCDate();
  const month = date.getUTCMonth() + Math.trunc(count);
  date.setUTCDate(1);
  date.setUTCMonth(month + 1, 0);
  date.setUTCDate(Math.min(day, date.getUTCDate()));
  return date.getTime();
}

function zonedInstant(wall, zone) {
  if (!zone || zone === "UTC" || !Number.isFinite(wall)) return wall;
  const seconds = Math.floor(wall / 1000) * 1000;
  const start = new Date(seconds).toISOString().slice(0, 19);
  return dateMillis({ start, includeTime: true, timeZone: zone }) + (wall - seconds);
}

function addDate(value, amount, unit, direction) {
  const date = dateOperand(value);
  const count = asNumber(amount) * direction;
  const key = dateUnit(unit || "days");
  const zone = date.hasZone ? date.normalized.timeZone || "UTC" : null;
  const next = Object.hasOwn(calendarUnits, key)
    ? zonedInstant(shiftCalendarMonths(wallTime(date.ms, zone), count * calendarUnits[key]), zone)
    : date.ms + count * durationUnits[key];
  return { ...date.normalized, start: dateStamp(next, date.normalized.includeTime, zone), end: null };
}

function dateBetween(first, second, unit = "days") {
  const left = dateOperand(first, "需要两个有效的日期");
  const right = dateOperand(second, "需要两个有效的日期");
  const key = dateUnit(unit);
  const leftZone = left.hasZone ? normalizeDateTimeZone(left.normalized.timeZone) : null;
  const rightZone = right.hasZone ? normalizeDateTimeZone(right.normalized.timeZone) : null;
  const zone = leftZone && rightZone && leftZone !== rightZone ? deviceZone() : leftZone || rightZone;
  const leftMs = left.hasZone ? left.ms : zonedInstant(left.ms, zone);
  const rightMs = right.hasZone ? right.ms : zonedInstant(right.ms, zone);
  const delta = leftMs - rightMs;
  if (!Number.isFinite(delta)) throw new TypeError("需要两个有效的日期");
  if (Object.hasOwn(durationUnits, key)) return Math.trunc(delta / durationUnits[key]) || 0;
  const earlier = new Date(wallTime(Math.min(leftMs, rightMs), zone));
  const later = new Date(wallTime(Math.max(leftMs, rightMs), zone));
  let months = (later.getUTCFullYear() - earlier.getUTCFullYear()) * 12 + later.getUTCMonth() - earlier.getUTCMonth();
  if (shiftCalendarMonths(earlier.getTime(), months) > later.getTime()) months--;
  return Math.sign(delta) * Math.trunc(months / calendarUnits[key]) || 0;
}

const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dateTokens = /\[([^\]]*)\]|YYYY|YY|Y|MMMM|MMM|MM|M|DD|D|dddd|ddd|dd|d|WW|W|L|HH|H|hh|h|mm|m|ss|s|A|a/g;
const padDatePart = (part, width = 2) => String(part).padStart(width, "0");

function isoWeek(clock) {
  const thursday = new Date(clock);
  thursday.setUTCHours(0, 0, 0, 0);
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const yearStart = new Date(thursday);
  yearStart.setUTCMonth(0, 1);
  return Math.floor((thursday - yearStart) / (dayMs * 7)) + 1;
}

function formatDatePattern(clock, pattern) {
  const year = clock.getUTCFullYear(), month = clock.getUTCMonth(), day = clock.getUTCDate();
  const hour = clock.getUTCHours(), minute = clock.getUTCMinutes(), second = clock.getUTCSeconds();
  const hour12 = hour % 12 || 12, period = hour < 12 ? "AM" : "PM";
  const weekday = weekdayNames[clock.getUTCDay()];
  const parts = {
    YYYY: padDatePart(year, 4), YY: padDatePart(year % 100), Y: year,
    MMMM: monthNames[month], MMM: monthNames[month]?.slice(0, 3), MM: padDatePart(month + 1), M: month + 1,
    DD: padDatePart(day), D: day, HH: padDatePart(hour), H: hour, hh: padDatePart(hour12), h: hour12,
    dddd: weekday, ddd: weekday.slice(0, 3), dd: weekday.slice(0, 2), d: clock.getUTCDay(),
    L: `${padDatePart(month + 1)}/${padDatePart(day)}/${padDatePart(year, 4)}`,
    mm: padDatePart(minute), m: minute, ss: padDatePart(second), s: second, A: period, a: period.toLowerCase(),
  };
  return String(pattern).replace(dateTokens, (key, literal) => {
    if (key === "W") return isoWeek(clock);
    if (key === "WW") return padDatePart(isoWeek(clock));
    return literal ?? parts[key];
  });
}

function dateInstant(date) {
  return date.hasZone ? date.ms : zonedInstant(date.ms, deviceZone());
}

function formatDate(value, pattern = "YYYY-MM-DD", timeZone) {
  const date = dateValue(value);
  if (!date) return "";
  if (timeZone === undefined) return formatDatePattern(clockDate(date), pattern);
  if (typeof timeZone !== "string" || !timeZone.trim()) throw new TypeError("需要有效的时区");
  const includeTime = date.normalized.includeTime;
  const displayed = wallTime(includeTime ? dateInstant(date) : date.ms, timeZone);
  if (!Number.isFinite(displayed)) throw new TypeError("无效的时区或日期时间");
  return formatDatePattern(new Date(includeTime ? displayed : date.ms), pattern);
}

function typedDate(value) {
  return typeof value?.start === "string" ? dateValue(value) : null;
}

function formatTextOperand(value) {
  const date = typedDate(value);
  if (!date) return value;
  const label = entry => formatDatePattern(clockDate(entry), entry.normalized.includeTime ? "MMMM D, YYYY h:mm A" : "MMMM D, YYYY");
  const end = date.normalized.end && dateValue({ ...date.normalized, start: date.normalized.end });
  return `@${label(date)}${end ? ` → ${label(end)}` : ""}`;
}

const comparisons = Object.freeze({
  "==": (left, right) => left === right,
  "!=": (left, right) => left !== right,
  ">": (left, right) => left > right,
  ">=": (left, right) => left >= right,
  "<": (left, right) => left < right,
  "<=": (left, right) => left <= right,
});

function referenceType(value) {
  if (value instanceof FormulaPage) return FormulaPage;
  if (value instanceof FormulaPerson) return FormulaPerson;
  return null;
}

function compareValues(operator, left, right) {
  const leftType = referenceType(left), rightType = referenceType(right);
  if (leftType || rightType) {
    const equal = leftType === rightType && left.id === right.id;
    return operator === "==" ? equal : operator === "!=" && !equal;
  }
  const leftDate = typedDate(left), rightDate = typedDate(right);
  const compare = comparisons[operator];
  if (leftDate && rightDate) {
    if (!leftDate.normalized.includeTime && !rightDate.normalized.includeTime) return compare(leftDate.ms, rightDate.ms);
    return compare(dateInstant(leftDate), dateInstant(rightDate));
  }
  if (leftDate || rightDate) return operator === "!=";
  return compare(listValueKey(left), listValueKey(right));
}
function textPattern(value, flags = "") {
  try { return new RegExp(String(value ?? ""), flags); }
  catch { throw new TypeError("无效的正则表达式"); }
}
const FUNCTIONS = Object.freeze({
  add: (left, right) => finiteResult(asNumber(left) + asNumber(right)),
  subtract: (left, right) => finiteResult(asNumber(left) - asNumber(right)),
  multiply: (left, right) => finiteResult(asNumber(left) * asNumber(right)),
  divide: (left, right) => {
    const numerator = asNumber(left), denominator = asNumber(right);
    if (isNumericZero(left) && isNumericZero(right)) return 0;
    if (denominator === 0) throw new TypeError("不能除以 0");
    return finiteResult(numerator / denominator);
  },
  equal: (left, right) => compareValues("==", left, right),
  unequal: (left, right) => compareValues("!=", left, right),
  if: (condition, yes, no) => condition ? yes : no,
  ifs: (...values) => {
    for (let index = 0; index + 1 < values.length; index += 2) if (values[index]) return values[index + 1];
    return values.length % 2 ? values.at(-1) : null;
  },
  and: (...values) => values.every(Boolean),
  or: (...values) => values.some(Boolean),
  not: (value) => !value,
  empty: (...values) => {
    if (!values.length) return null;
    if (values.length !== 1) throw new TypeError("empty 的参数数量不正确");
    const [value] = values;
    return value === 0 || value === false || isEmptyProperty(value);
  },
  concat: (...values) => joinFormulaText(values),
  string: (value) => value == null ? "" : String(value),
  length: (value) => Array.isArray(value) ? value.length : value == null ? 0 : Array.from(String(value)).length,
  lower: (value) => String(value ?? "").toLocaleLowerCase(),
  upper: (value) => String(value ?? "").toLocaleUpperCase(),
  contains: (value, needle) => Array.isArray(value) ? value.includes(needle) : String(value ?? "").includes(String(needle ?? "")),
  format: formatValue,
  join: (value, separator = ", ") => Array.isArray(value) ? joinFormulaText(value.map(entry => entry instanceof StyledFormulaText ? entry : formatValue(entry)), separator) : formatValue(value),
  first: value => {
    if (!Array.isArray(value)) throw new TypeError("需要列表");
    return value[0] ?? null;
  },
  match: (value, pattern) => String(value ?? "").match(textPattern(pattern, "g")) ?? [],
  style: styleFormulaText,
  link: linkFormulaText,
  unstyle: unstyleFormulaText,
  formatNumber: (number, format = "number", decimals) => {
    if (!NUMBER_FORMATS.some(([key]) => key === format)) throw new TypeError("未知数字格式");
    if (decimals !== undefined && (!Number.isInteger(decimals) || decimals < 0 || decimals > 4)) throw new TypeError("小数位数必须是 0–4 的整数");
    return formatNumber(asNumber(number), { format, decimals });
  },
  name: value => {
    if (!(value instanceof FormulaPerson)) throw new TypeError("需要人员");
    return value.displayName;
  },
  email: value => {
    if (!(value instanceof FormulaPerson)) throw new TypeError("需要人员");
    return value.email;
  },
  replace: (value, search, replacement) => String(search ?? "") ? String(value ?? "").replace(textPattern(search), () => String(replacement ?? "")) : String(value ?? ""),
  replaceAll: (value, search, replacement) => String(search ?? "") ? String(value ?? "").replace(textPattern(search, "g"), () => String(replacement ?? "")) : String(value ?? ""),
  test: (value, pattern) => textPattern(pattern).test(String(value ?? "")),
  slice: (value, start, end) => Array.from(String(value ?? "")).slice(asNumber(start), end === undefined ? undefined : asNumber(end)).join(""),
  substring: (value, start, end) => Array.from(String(value ?? "")).slice(asNumber(start), end === undefined ? undefined : asNumber(end)).join(""),
  repeat: (value, times) => {
    const count = asNumber(times);
    const text = String(value ?? "");
    if (count < 0 || count > 100000 || text.length * Math.floor(count) > 100000) throw new TypeError("结果超出范围");
    return text.repeat(count);
  },
  padStart: (value, length, fill = " ") => {
    const count = asNumber(length);
    if (count > 100000 || count < 0) throw new TypeError("结果超出范围");
    return String(value ?? "").padStart(count, String(fill));
  },
  trim: (value) => String(value ?? "").trim(),
  toNumber: (value) => {
    if (value === null || value === undefined || value === "") return EMPTY_FORMULA_NUMBER;
    if (typeof value === "boolean") return Number(value);
    if (value && typeof value === "object" && "start" in value) {
      const date = dateValue(value);
      if (!date) throw new TypeError("需要有效的日期");
      return dateInstant(date);
    }
    if (typeof value === "object" || !Number.isFinite(Number(value))) throw new TypeError("无法转换为数字");
    return Number(value);
  },
  abs: (value) => Math.abs(asNumber(value)),
  ceil: (value) => Math.ceil(asNumber(value)),
  floor: (value) => Math.floor(asNumber(value)),
  sqrt: (value) => { const number = asNumber(value); if (number < 0) throw new TypeError("不能对负数开平方"); return Math.sqrt(number); },
  exp: (value) => finiteResult(Math.exp(asNumber(value))),
  ln: (value) => finiteResult(Math.log(asNumber(value))),
  log10: (value) => finiteResult(Math.log10(asNumber(value))),
  log2: (value) => finiteResult(Math.log2(asNumber(value))),
  sign: (value) => Math.sign(asNumber(value)),
  cbrt: (value) => Math.cbrt(asNumber(value)),
  pi: () => Math.PI,
  e: () => Math.E,
  pow: (value, exponent) => finiteResult(Math.pow(asNumber(value), asNumber(exponent))),
  mod: (value, divisor) => { const denominator = asNumber(divisor); if (denominator === 0) throw new TypeError("不能对 0 取余"); return asNumber(value) % denominator; },
  round: (value, decimals = 0) => {
    const number = asNumber(value);
    if (!Number.isInteger(decimals) || decimals > 10) throw new TypeError("舍入位数必须是整数，且小数位不能超过 10");
    if (decimals < -308) return 0;
    if (decimals >= 0 && Number.isInteger(number)) return number;
    const [significand, exponent = "0"] = String(number).split("e");
    const rounded = Math.round(Number(`${significand}e${Number(exponent) + decimals}`));
    const [result, resultExponent = "0"] = String(rounded).split("e");
    return finiteResult(Number(`${result}e${Number(resultExponent) - decimals}`));
  },
  min: (...values) => { const numbers = numericValues(values); return numbers.length ? Math.min(...numbers) : null; },
  max: (...values) => { const numbers = numericValues(values); return numbers.length ? Math.max(...numbers) : null; },
  sum: (...values) => finiteResult(numericValues(values).reduce((total, value) => total + value, 0)),
  mean: (...values) => {
    const numbers = numericValues(values);
    return numbers.length ? finiteResult(numbers.reduce((total, value) => total + value, 0) / numbers.length) : null;
  },
  median: (...values) => {
    const numbers = numericValues(values).sort((a, b) => a - b);
    if (!numbers.length) return null;
    const middle = Math.floor(numbers.length / 2);
    return numbers.length % 2 ? numbers[middle] : finiteResult((numbers[middle - 1] + numbers[middle]) / 2);
  },
  now: (options) => localDate(options.now ?? Date.now(), true),
  today: (options) => localDate(options.now ?? Date.now(), false),
  timestamp: value => dateInstant(dateOperand(value)),
  fromTimestamp: value => localDate(Math.floor(asNumber(value) / minuteMs) * minuteMs, true),
  dateRange: (start, end) => {
    const from = dateOperand(start), to = dateOperand(end);
    const includeTime = from.normalized.includeTime || to.normalized.includeTime;
    if (!includeTime) return { start: from.normalized.start, end: to.normalized.start, includeTime: false, timeZone: null };
    const timeZone = from.normalized.timeZone || to.normalized.timeZone || deviceZone();
    const endpoint = date => dateStamp(date.hasZone ? date.ms : zonedInstant(date.ms, timeZone), true, timeZone);
    return { start: endpoint(from), end: endpoint(to), includeTime, timeZone };
  },
  parseDate,
  dateAdd: (value, amount, unit) => addDate(value, amount, unit, 1),
  dateSubtract: (value, amount, unit) => addDate(value, amount, unit, -1),
  dateBetween,
  formatDate,
  year: (value) => requiredDate(value).getUTCFullYear(),
  month: (value) => requiredDate(value).getUTCMonth() + 1,
  date: (value) => requiredDate(value).getUTCDate(),
  day: (value) => requiredDate(value).getUTCDay() || 7,
  hour: (value) => requiredDate(value).getUTCHours(),
  minute: (value) => requiredDate(value).getUTCMinutes(),
  week: (value) => isoWeek(requiredDate(value)),
  dateStart: (value) => dateEndpoint(value, false),
  dateEnd: (value) => dateEndpoint(value, true),
});

function formatValue(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  const date = typedDate(value);
  if (date) {
    const label = endpoint => formatDate({ ...value, start: endpoint }, endpoint.includes("T") ? "MMMM D, YYYY HH:mm" : "MMMM D, YYYY");
    return label(value.start) + (value.end ? " → " + label(value.end) : "");
  }
  return String(value);
}

function clockDate(date) {
  const zone = date.hasZone ? date.normalized.timeZone : null;
  return new Date(wallTime(date.ms, zone));
}

function requiredDate(value) {
  return clockDate(dateOperand(value));
}

function dateEndpoint(value, end) {
  const date = dateOperand(value);
  const start = end ? date.normalized.end || date.normalized.start : date.normalized.start;
  const includeTime = start.includes("T");
  return { ...date.normalized, start, end: null, includeTime, timeZone: includeTime ? date.normalized.timeZone : null };
}

function localDate(now, includeTime) {
  const instant = new Date(now).getTime();
  if (!Number.isFinite(instant)) throw new TypeError("需要有效的日期");
  const zone = deviceZone();
  return { start: dateStamp(instant, includeTime, zone), end: null, includeTime, timeZone: includeTime ? zone : null };
}

function numericValues(values) {
  return values.flat(1).filter((value) => value !== null && value !== undefined && value !== "").map(asNumber);
}

function finiteResult(value) {
  if (!Number.isFinite(value)) throw new TypeError("结果超出范围");
  return value;
}

const CALLBACK_FUNCTIONS = new Set(["filter", "map", "find", "findIndex", "sort", "some", "every"]);
const LIST_FUNCTIONS = new Set(["flat", "unique", "includes", "at", "last", "reverse"]);
const EXACT_ARGUMENT_COUNTS = new Map([
  ["equal", 2], ["unequal", 2], ["add", 2], ["subtract", 2], ["multiply", 2], ["divide", 2], ["link", 2],
  ["dateRange", 2], ["timestamp", 1], ["fromTimestamp", 1], ["name", 1], ["email", 1],
]);
export const FORMULA_FUNCTION_NAMES = Object.freeze([...Object.keys(FUNCTIONS), "let", "lets", "id", "split", ...CALLBACK_FUNCTIONS, ...LIST_FUNCTIONS]);
const FUNCTION_KEYS = new Map(FORMULA_FUNCTION_NAMES.map((name) => [name.toLowerCase(), name]));

function sliceList(list, start, end, consumeSteps) {
  const offset = index => {
    const position = Math.trunc(asNumber(index));
    return position < 0 ? Math.max(list.length + position, 0) : Math.min(position, list.length);
  };
  const from = offset(start);
  const to = end === undefined ? list.length : offset(end);
  consumeSteps(Math.max(0, to - from));
  return list.slice(from, to);
}

function splitText(values, consumeSteps) {
  if (values.length !== 2) throw new TypeError("split 的参数数量不正确");
  const [text, separator] = values.map(listValueKey);
  if (typeof text !== "string" || typeof separator !== "string") throw new TypeError("split 需要文本和分隔符");
  if (!text) return [];
  const result = [];
  if (!separator) {
    consumeSteps(text.length);
    return text.split("");
  }
  let start = 0;
  for (let end = text.indexOf(separator); end !== -1; end = text.indexOf(separator, start)) {
    consumeSteps();
    result.push(text.slice(start, end));
    start = end + separator.length;
  }
  consumeSteps();
  result.push(text.slice(start));
  return result;
}

function listValueKey(value) {
  if (value === EMPTY_FORMULA_NUMBER) return null;
  return value instanceof StyledFormulaText ? value.toString() : value;
}

function sameListValue(left, right) {
  return left === right || (Number.isNaN(left) && Number.isNaN(right));
}

function hasListEntry(groups, entry) {
  const type = referenceType(entry);
  return groups.get(type)?.has(type ? entry.id : listValueKey(entry)) ?? false;
}

function addListEntry(groups, entry) {
  const type = referenceType(entry);
  if (!groups.has(type)) groups.set(type, new Set());
  groups.get(type).add(type ? entry.id : listValueKey(entry));
}

function evaluateListFunction(name, values, consumeSteps) {
  const [list, argument] = values;
  const expectedArguments = name === "includes" || name === "at" ? 2 : 1;
  if (values.length !== expectedArguments) throw new TypeError(`${name} 的参数数量不正确`);
  if (!Array.isArray(list)) throw new TypeError("需要列表");
  if (name === "at") return list.at(asNumber(listValueKey(argument))) ?? null;
  if (name === "last") return list.at(-1) ?? null;
  if (name === "includes") {
    for (const entry of list) {
      consumeSteps();
      if (referenceType(entry) || referenceType(argument)) {
        if (compareValues("==", entry, argument)) return true;
      } else if (sameListValue(listValueKey(entry), listValueKey(argument))) return true;
    }
    return false;
  }
  consumeSteps(list.length);
  if (name === "reverse") return list.toReversed();
  if (name === "flat") {
    for (const entry of list) if (Array.isArray(entry)) consumeSteps(entry.length);
    return list.flat();
  }
  const seen = new Map();
  return list.filter(entry => {
    if (hasListEntry(seen, entry)) return false;
    addListEntry(seen, entry);
    return true;
  });
}

export function evaluateFormulaAst(ast, lookup, options = {}) {
  const consumeSteps = options.consumeSteps ?? createFormulaBudget(options.maxSteps);
  const membership = new WeakMap();
  const plain = (value, { preserveStyles = false, pageTitles = false, preserveReferences = false } = {}) => {
    if (value === EMPTY_FORMULA_NUMBER) return null;
    if (referenceType(value)) return plainFormulaValue(value, { pageTitles, preserveReferences });
    if (!Array.isArray(value)) return preserveStyles ? value : listValueKey(value);
    const lists = [value];
    while (lists.length) {
      const list = lists.pop();
      consumeSteps(list.length);
      for (const entry of list) if (Array.isArray(entry)) lists.push(entry);
    }
    return plainFormulaValue(value, { preserveStyles, pageTitles, preserveReferences });
  };
  const numberOperand = value => asNumber(value === EMPTY_FORMULA_NUMBER ? value : plain(value));
  const visit = (node, depth = 0, scope = new Map()) => {
    consumeSteps();
    if (depth > MAX_DEPTH) throw new Error("公式嵌套太深");
    if (!node) return null;
    const read = (child, bindings = scope) => visit(child, depth + 1, bindings);
    if (node.kind === "Literal") return node.value;
    if (node.kind === "Identifier") {
      return scope.has(node.name) ? scope.get(node.name) : formulaError("REF", `找不到变量：${node.name}`);
    }
    if (node.kind === "ListExpression") {
      const values = node.args.map(arg => read(arg));
      return values.find(isFormulaError) || values;
    }
    if (node.kind === "RelatedProperty") {
      const page = read(node.argument);
      if (isFormulaError(page)) return page;
      if (!(page instanceof FormulaPage)) throw new TypeError("只有关联记录可以读取属性");
      return page.readProperty(node.propertyName, node.bindings);
    }
    if (node.kind === "PropertyRef") {
      const propertyId = node.propertyId ?? options.resolveName?.(node.propertyName);
      if (!propertyId) return formulaError("REF", `找不到属性：${node.propertyName || node.propertyId}`);
      const value = lookup(propertyId);
      return value == null && options.resolvePropertyType?.(propertyId) === "number" ? EMPTY_FORMULA_NUMBER : value;
    }
    if (node.kind === "UnaryExpression") {
      const input = read(node.argument);
      if (isFormulaError(input)) return input;
      if (node.operator === "-" || node.operator === "+") return (node.operator === "-" ? -1 : 1) * numberOperand(input);
      return !Boolean(plain(input));
    }
    if (node.kind === "BinaryExpression") {
      if (["and","&&", "or", "||"].includes(node.operator)) {
        const left = plain(read(node.left));
        if (isFormulaError(left)) return left;
        const conjunction = ["and", "&&"].includes(node.operator);
        if (conjunction && !left) return false;
        if (!conjunction && left) return true;
        const right = plain(read(node.right));
        return isFormulaError(right) ? right : Boolean(right);
      }
      const leftValue = read(node.left), rightValue = read(node.right);
      if (isFormulaError(leftValue)) return leftValue;
      if (isFormulaError(rightValue)) return rightValue;
      if (Object.hasOwn(comparisons, node.operator)) return compareValues(node.operator, leftValue, rightValue);
      const textAddition = node.operator === "+" && [leftValue, rightValue].some(value =>
        typeof value === "string" || value instanceof StyledFormulaText || referenceType(value));
      if (textAddition) {
        const left = plain(leftValue, { preserveStyles: true, pageTitles: true });
        const right = plain(rightValue, { preserveStyles: true, pageTitles: true });
        if (left instanceof StyledFormulaText || right instanceof StyledFormulaText) return joinFormulaText([formatTextOperand(left), formatTextOperand(right)]);
        return `${formatTextOperand(left) ?? ""}${formatTextOperand(right) ?? ""}`;
      }
      const left = leftValue === EMPTY_FORMULA_NUMBER ? leftValue : plain(leftValue);
      const right = rightValue === EMPTY_FORMULA_NUMBER ? rightValue : plain(rightValue);
      switch (node.operator) {
        case "+": return FUNCTIONS.add(left, right);
        case "-": return FUNCTIONS.subtract(left, right);
        case "*": return FUNCTIONS.multiply(left, right);
        case "/": return FUNCTIONS.divide(left, right);
        case "%": return FUNCTIONS.mod(left, right);
        case "^": return FUNCTIONS.pow(left, right);
        default: throw new TypeError("不支持的运算符");
      }
    }
    if (node.kind === "CallExpression") {
      const name = FUNCTION_KEYS.get(node.name?.toLowerCase?.());
      if (name === "let" || name === "lets") {
        if (node.args.length < 3 || node.args.length % 2 !== 1 || (name === "let" && node.args.length !== 3)) throw new TypeError(`${name} 需要变量名、值和结果表达式`);
        const bindings = new Map(scope);
        for (let index = 0; index < node.args.length - 1; index += 2) {
          const variable = node.args[index];
          if (variable.kind !== "Identifier") throw new TypeError("需要变量名");
          const value = read(node.args[index + 1], bindings);
          if (isFormulaError(value)) return value;
          bindings.set(variable.name, value);
        }
        return read(node.args.at(-1), bindings);
      }
      if (CALLBACK_FUNCTIONS.has(name)) {
        if (node.args.length !== 2 && !(name === "sort" && node.args.length === 1)) throw new TypeError(`${name} 的参数数量不正确`);
        const list = read(node.args[0]);
        if (isFormulaError(list)) return list;
        if (!Array.isArray(list)) throw new TypeError("需要列表");
        const callback = node.args[1];
        if (!callback) consumeSteps(list.length);
        const result = [];
        const bindings = new Map(scope);
        for (const [index, entry] of list.entries()) {
          bindings.set("current", entry);
          bindings.set("index", index);
          const value = callback ? read(callback, bindings) : entry;
          if (isFormulaError(value)) return value;
          if (name === "map") result.push(value);
          else if (name === "sort") result.push({ entry, key: plain(value) });
          else {
            const matches = Boolean(plain(value));
            if (name === "some" && matches) return true;
            if (name === "every" && !matches) return false;
            if (name === "find" && matches) return entry;
            if (name === "findIndex" && matches) return index;
            if (name === "filter" && matches) result.push(entry);
          }
        }
        if (name === "some") return false;
        if (name === "every") return true;
        if (name === "find") return null;
        if (name === "findIndex") return -1;
        if (name === "sort") return result.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map(row => row.entry);
        return result;
      }
      if (!name) throw new TypeError(`未知函数：${node.name}`);
      const fn = FUNCTIONS[name];
      if (name === "if") {
        const condition = plain(read(node.args[0]));
        if (isFormulaError(condition)) return condition;
        return read(condition ? node.args[1] : node.args[2]);
      }
      if (name === "ifs") {
        for (let index = 0; index + 1 < node.args.length; index += 2) {
          const condition = plain(read(node.args[index]));
          if (isFormulaError(condition)) return condition;
          if (condition) return read(node.args[index + 1]);
        }
        return node.args.length % 2 ? read(node.args.at(-1)) : null;
      }
      if (["now", "today"].includes(name)) return fn(options);
      const values = node.args.map(arg => read(arg));
      const error = values.find(isFormulaError);
      if (error) return error;
      if (EXACT_ARGUMENT_COUNTS.has(name) && values.length !== EXACT_ARGUMENT_COUNTS.get(name)) throw new TypeError(`${name} 的参数数量不正确`);
      if ((name === "formatNumber" && (values.length < 1 || values.length > 3)) || (name === "unstyle" && !values.length)) throw new TypeError(`${name} 的参数数量不正确`);
      if (["equal", "unequal", "name", "email"].includes(name)) return fn(...values);
      if (["add", "subtract", "multiply", "divide"].includes(name)) {
        return fn(...values.map(value => value === EMPTY_FORMULA_NUMBER ? value : plain(value)));
      }
      if (name === "id") {
        if (values.length === 0) return options.pageId ?? null;
        if (values.length !== 1) throw new TypeError("id 的参数数量不正确");
        if (!(values[0] instanceof FormulaPage)) throw new TypeError("需要关联记录");
        return values[0].id;
      }
      if (LIST_FUNCTIONS.has(name)) return evaluateListFunction(name, values, consumeSteps);
      if (name === "split") return splitText(values, consumeSteps);
      if (name === "concat" && values.length && values.every(Array.isArray)) {
        consumeSteps(values.reduce((length, list) => length + list.length, 0));
        return [].concat(...values);
      }
      if (name === "slice" && Array.isArray(values[0])) {
        return sliceList(values[0], listValueKey(values[1]), listValueKey(values[2]), consumeSteps);
      }
      if (name === "first") return fn(...values);
      if (name === "length" && Array.isArray(values[0])) return values[0].length;
      if (name === "contains" && Array.isArray(values[0])) {
        const list = values[0];
        const key = values[1];
        let indexed = membership.get(list);
        if (!indexed) {
          indexed = { groups: new Map(), cursor: 0 };
          membership.set(list, indexed);
        }
        if (hasListEntry(indexed.groups, key)) return true;
        while (indexed.cursor < list.length) {
          consumeSteps();
          addListEntry(indexed.groups, list[indexed.cursor++]);
          if (hasListEntry(indexed.groups, key)) return true;
        }
        return false;
      }
      const preserveStyles = ["concat", "join", "style", "link", "unstyle"].includes(name);
      const pageTitles = preserveStyles || name === "format" || name === "string";
      return fn(...values.map(value => plain(value, { preserveStyles, pageTitles })));
    }
    throw new TypeError("无法计算的表达式");
  };
  try {
    const result = visit(ast);
    return options.internalValues ? result : plain(result, { preserveStyles: options.preserveStyles, preserveReferences: options.preserveReferences });
  }
  catch (error) {
    if (error === missingDateInput) return null;
    return formulaError(error instanceof TypeError ? "TYPE" : "EVAL", error.message);
  }
}

export function evaluateFormula(source, lookup, options) {
  try { return evaluateFormulaAst(parseFormula(source), lookup, options); }
  catch (error) { return formulaError("PARSE", error.message); }
}

export function formulaDependencies(source, { resolveName } = {}) {
  try {
    const ast = parseFormula(source);
    const ids = new Set();
    const walk = (node) => {
      if (!node) return;
      if (node.kind === "PropertyRef") {
        const propertyId = node.propertyId ?? resolveName?.(node.propertyName);
        if (propertyId) ids.add(propertyId);
      }
      if (node.argument) walk(node.argument);
      if (node.left) walk(node.left);
      if (node.right) walk(node.right);
      for (const child of node.args || []) walk(child);
    };
    walk(ast);
    return [...ids];
  } catch { return []; }
}
