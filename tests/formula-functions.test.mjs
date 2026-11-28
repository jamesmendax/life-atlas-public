import test from "node:test";
import assert from "node:assert/strict";
import { FORMULA_FUNCTION_NAMES, evaluateFormula, formulaDependencies, renameFormulaPropertyReference } from "../src/domain/formula/engine.js";
import { FORMULA_HELP } from "../src/domain/formula/help.js";

const values = { amount: 12, name: "Alpha", date: "2026-09-19", tags: ["a", "b"], time: { start: "2026-09-19T10:45", end: "2026-09-21T08:00", includeTime: true } };
const lookup = (propertyId) => values[propertyId];
const resolveName = (name) => ({ 金额: "amount", 名称: "name", 日期: "date", 标签: "tags", 时间: "time" })[name];
const options = { now: new Date(2026, 9, 1, 8, 30).getTime(), resolveName };
const evaluate = (source) => evaluateFormula(source, lookup, options);

test("new formula functions match the known answers", () => {
  const answers = [
    ['ifs(prop("金额") > 20, "大", prop("金额") > 10, "中", "小")', "中"], ["ifs(false, 1)", null], ["ifs(false, 1, 2)", 2],
    ["and(true, false)", false], ['and(1, "x", true)', true], ['or(false, 0, "")', false], ["not(false)", true],
    ['empty("")', true], ['empty(prop("标签"))', false], ["empty(null)", true], ['length("你好")', 2],
    ['format(prop("标签"))', "a, b"], ['format(prop("日期"))', "2026-09-19"], ['join(prop("标签"), "、")', "a、b"],
    ['replace("a-b-c", "-", "+")', "a+b-c"], ['replaceAll("a-b-c", "-", "+")', "a+b+c"], ['replace("x", "x", "$&$&")', "$&$&"],
    ['slice("你好世界", 1, 3)', "好世"], ['slice("你好世界", -2)', "世界"], ['padStart("7", 3, "0")', "007"], ['trim("  a ")', "a"],
    ['toNumber("42")', 42], ["toNumber(true)", 1], ['toNumber("")', null], ["floor(-1.2)", -2], ["pow(2, 10)", 1024], ["mod(-7, 3)", -1],
    ["round(1.005, 2)", 1.01], ["round(2.5)", 3], ["round(-2.5)", -2], ["sum(1, 2, 3)", 6], ["min()", null],
    ["format(today())", "October 1, 2026"], ["format(now())", "October 1, 2026 08:30"], ['format(dateAdd(prop("时间"), 90, "minutes"))', "September 19, 2026 12:15"],
    ['day(prop("日期"))', 6], ['week(prop("日期"))', 38], ['week("2027-01-01")', 53], ['week("2026-01-01")', 1], ['hour(prop("时间"))', 10],
    ['format(dateEnd(prop("时间")))', "September 21, 2026 08:00"], ['prop("金额") * 2', 24],
  ];
  for (const [formula, expected] of answers) assert.deepEqual(evaluate(formula), expected, formula);
  assert.equal(evaluate('if(false, 1 / 0, 7)'), 7);
  assert.equal(evaluate('ifs(false, 1 / 0, true, 8, 1 / 0)'), 8);
  assert.equal(evaluate('length("😀a")'), 2);
  assert.equal(evaluate('slice("😀a", 0, 1)'), "😀");
  assert.equal(evaluate('replaceAll("x-x", "x", "$&")'), "$&-$&");
  assert.equal(evaluate('replace("a", "", "b")'), "a");
  assert.equal(evaluate('sum(prop("金额"), 1, null)'), 13);
});

test("formula errors are reported in chinese with positions", () => {
  const answers = [
    ["sqrt(-1)", "TYPE", "不能对负数开平方"], ["mod(1, 0)", "TYPE", "不能对 0 取余"], ["1 / 0", "TYPE", "不能除以 0"],
    ['toNumber("abc")', "TYPE", "无法转换为数字"], ["unknownFn(1)", "TYPE", "未知函数：unknownFn"],
    ['prop("不存在")', "REF", "找不到属性：不存在"], ["prop(1)", "PARSE", "第 1 个字符：prop() 需要一个属性名称字符串"],
    ["1 +", "PARSE", "第 4 个字符：这里应该是一个值"], ['"abc', "PARSE", "第 1 个字符：字符串缺少结束引号"],
    ["1 2", "PARSE", "第 3 个字符：公式末尾有多余的内容"], ['abs("x")', "TYPE", "需要数字"], ['year("x")', "TYPE", "需要有效的日期"],
    ["round(1.5, 1.5)", "TYPE", "舍入位数必须是整数，且小数位不能超过 10"],
  ];
  for (const [formula, code, message] of answers) assert.deepEqual(evaluate(formula)?.error, { code, message }, formula);
  assert.equal(evaluate('abs(prop("不存在"))').error.code, "REF");
  assert.equal(evaluate('prop("不存在") and true').error.code, "REF");
  assert.equal(evaluate('1 + abs(null)').error.message, "需要数字");
});

test("keyword functions do not break keyword operators", () => {
  const propertyLookup = (propertyId) => ({ a: 2, b: false, c: true })[propertyId];
  const answers = [["true and false", false], ["not true", false], ["not (true)", false], ["empty", null], ["{{a}} > 1 and ({{b}} or {{c}})", true], ["true and (false or true)", true], ["and(true, false)", false], ["or(false, true)", true], ["{{c}} and and({{c}}, true)", true], ['empty("")', true]];
  for (const [formula, expected] of answers) assert.equal(evaluateFormula(formula, propertyLookup), expected, formula);
});

test("prop references resolve by name and report dependencies", () => {
  assert.deepEqual(formulaDependencies('prop("金额") + {{name}} + prop("没有")', { resolveName }), ["amount", "name"]);
});

test("block comments preserve original diagnostics, property ranges and quoted markers", () => {
  const expression = '/* prop("忽略")\r\n {{unused}} */ prop /* call */ ("金额" /* keep */) / 3';
  assert.equal(evaluate(expression), 4);
  assert.deepEqual(formulaDependencies(expression, { resolveName }), ["amount"]);
  assert.equal(renameFormulaPropertyReference(expression, "金额", "金额2"), expression.replace('("金额"', '("金额2"'));
  assert.equal(evaluate('"/*" + /* multiline\n */ "*/"'), "/**/");
  assert.equal(evaluate("1/* immediately before division *//2"), 0.5);
  assert.deepEqual(evaluate("1 + /* 未结束\n")?.error, { code: "PARSE", message: "第 5 个字符：块注释缺少结束符 */" });
  assert.deepEqual(evaluate("/*\n*/ @")?.error, { code: "PARSE", message: "第 7 个字符：无法识别的字符" });
});

test("parseDate returns typed civil dates and retains the instant of explicit offsets", () => {
  assert.deepEqual(evaluate('parseDate("2027-02-28")'), { start: "2027-02-28", end: null, includeTime: false, timeZone: null });
  assert.deepEqual(evaluate('"2027-01-31T22:30".parseDate()'), { start: "2027-01-31T22:30", end: null, includeTime: true, timeZone: null });
  for (const text of ["", "tomorrow", "2027-02-30", "2027-13-01", "2027-01-01T26:00"]) {
    assert.equal(evaluate(`parseDate(${JSON.stringify(text)})`), null, text);
  }
  assert.equal(evaluate("parseDate(7)").error?.code, "TYPE");
  assert.equal(evaluate("parseDate()").error?.code, "TYPE");

  const literal = 'parseDate("2027-01-31T22:30:01.125-05:00")';
  const timestamp = Date.UTC(2027, 1, 1, 3, 30, 1, 125);
  const local = new Date(timestamp);
  const twoDigits = value => String(value).padStart(2, "0");
  const expected = `${local.getFullYear()}-${twoDigits(local.getMonth() + 1)}-${twoDigits(local.getDate())} ${twoDigits(local.getHours())}:${twoDigits(local.getMinutes())}`;
  assert.equal(evaluate(`toNumber(${literal})`), timestamp);
  assert.equal(evaluate(`formatDate(${literal}, "YYYY-MM-DD HH:mm")`), expected);
  assert.equal(evaluate(`hour(${literal})`), local.getHours());
  assert.equal(evaluate(`toNumber(dateAdd(${literal}, 1.5, "hours"))`), timestamp + 5400000);
  assert.equal(evaluate('week(parseDate("2027-01-01"))'), 53);
});

test("calendar shifts clamp month ends and dateBetween counts signed complete units", () => {
  const answers = [
    ['formatDate(dateAdd(parseDate("2027-01-31"), 1, "months"))', "2027-02-28"],
    ['formatDate(dateAdd(parseDate("2027-01-31"), 1, "quarters"))', "2027-04-30"],
    ['formatDate(dateAdd(parseDate("2024-02-29"), 1, "years"))', "2025-02-28"],
    ['formatDate(dateSubtract(parseDate("2024-03-31"), 1, "months"))', "2024-02-29"],
    ['formatDate(dateAdd(parseDate("2024-03-31"), -1, "month"))', "2024-02-29"],
    ['formatDate(dateAdd(parseDate("2027-01-31T09:00"), 1.5, "hours"), "HH:mm")', "10:30"],
    ['dateBetween("2027-02-28", "2027-01-31", "months")', 1],
    ['dateBetween("2027-01-31", "2027-02-28", "months")', -1],
    ['dateBetween("2027-03-30", "2027-01-31", "months")', 1],
    ['dateBetween("2025-02-28", "2024-02-29", "years")', 1],
    ['dateBetween("2027-04-30", "2027-01-31", "quarters")', 1],
    ['dateBetween("2027-02-28T08:59", "2027-01-31T09:00", "months")', 0],
    ['dateBetween("2027-03-02T00:00Z", "2027-03-01T01:30Z", "days")', 0],
    ['dateBetween("2027-03-01T01:30Z", "2027-03-02T00:00Z", "days")', 0],
    ['dateBetween("2027-03-02T00:00Z", "2027-03-01T01:30Z", "hours")', 22],
    ['dateBetween("2027-03-01T01:30Z", "2027-03-02T00:00Z", "hours")', -22],
    ['dateBetween("2027-03-01T00:02:59", "2027-03-01T00:00", "minutes")', 2],
    ['dateBetween("2027-03-01", "2027-03-14", "weeks")', -1],
  ];
  for (const [formula, expected] of answers) assert.equal(evaluate(formula), expected, formula);
  assert.equal(evaluate('dateAdd("2027-01-01", 100000000000000, "years")').error?.code, "TYPE");
  assert.equal(evaluate('dateBetween("2027-01-01", "2027-01-02", "seconds")').error?.code, "TYPE");
});

test("date shifts preserve instants for imported offsets and date fields with a named time zone", () => {
  const iso = { start: "2027-01-31T09:00:00+08:00", includeTime: true, timeZone: null };
  const zoned = { start: "2027-01-31T09:00", includeTime: true, timeZone: "Asia/Shanghai" };
  const property = id => ({ iso, zoned })[id];
  const options = { resolveName: name => name };
  const first = 'parseDate("2027-01-31T01:00Z")';
  assert.equal(evaluateFormula(`dateBetween(dateAdd(prop("iso"),1,"hours"),${first},"hours")`, property, options), 1);
  assert.equal(evaluateFormula('dateBetween(prop("zoned"),prop("iso"),"hours")', property, options), 0);
  assert.equal(evaluateFormula('toNumber(dateAdd(prop("zoned"),1,"months"))', property, options), Date.UTC(2027, 1, 28, 1));
});

test("formatDate projects timed values into a requested time zone and preserves civil days", () => {
  const toronto = {
    summer: { start: "2025-06-06T19:00", timeZone: "America/Toronto", includeTime: true },
    winter: { start: "2025-02-24T12:00", timeZone: "America/Toronto", includeTime: true },
  };
  const render = formula => evaluateFormula(formula, id => toronto[id], { resolveName: name => name });
  assert.equal(render('formatDate(prop("summer"), "MMMM D, h:mm A", "America/Los_Angeles")'), "June 6, 4:00 PM");
  assert.equal(render('formatDate(prop("summer"), "MMMM D, h:mm A", "Australia/Adelaide")'), "June 7, 8:30 AM");
  assert.equal(render('formatDate(prop("winter"), "MMMM D, h:mm A", "Australia/Adelaide")'), "February 25, 3:30 AM");
  assert.equal(render('formatDate("2025-06-06T19:00-04:00", "MMM D, Y [at] hh:mm a", "Europe/London")'), "Jun 7, 2025 at 12:00 am");
  assert.equal(render('formatDate(parseDate("2026-03-20"), "MMMM D, YYYY", "America/Los_Angeles")'), "March 20, 2026");
  assert.equal(render('formatDate("2026-03-20", "YYYY-MM-DD", "invalid/zone")').error?.code, "TYPE");
  assert.equal(render('formatDate("2026-03-20", "YYYY-MM-DD", 3)').error?.code, "TYPE");
  assert.equal(render('formatDate(null, "YYYY-MM-DD", "America/Los_Angeles")'), "");

  const local = new Date(2025, 5, 6, 19);
  const utc = local.toISOString().slice(0, 16).replace("T", " ");
  assert.equal(render('formatDate("2025-06-06T19:00", "YYYY-MM-DD HH:mm", "UTC")'), utc);
});

test("date comparisons use civil dates or timed instants and leave ISO text as text", () => {
  const dateFields = {
    event: { start: "2025-06-06T19:00", timeZone: "America/Toronto", includeTime: true },
    cutoff: { start: "2025-04-07", end: "2025-04-11", includeTime: false },
  };
  const compute = formula => evaluateFormula(formula, id => dateFields[id], { resolveName: name => name, now: Date.UTC(2025, 5, 6, 23) });
  assert.equal(compute('dateEnd(prop("cutoff")) < now()'), true);
  assert.equal(compute('prop("event") == parseDate("2025-06-07T08:00+09:00")'), true);
  assert.equal(compute('prop("event") != now()'), false);
  assert.equal(compute('prop("event") <= now() and prop("event") >= now()'), true);
  assert.equal(compute('prop("event") > parseDate("2025-06-06T22:59Z")'), true);
  assert.equal(compute('dateEnd(prop("cutoff")) == parseDate("2025-04-11")'), true);
  assert.equal(compute('dateEnd(prop("cutoff")) == "2025-04-11"'), false);
  assert.equal(compute('dateEnd(prop("cutoff")) >= "2025-04-11"'), false);
  assert.equal(compute('"2025-04-11" > "2025-04-07"'), true);
});

test("combining dates with styled text renders mentions and preserves text styles", () => {
  const expression = 'style("Last Updated: ", "b") + parseDate("2026-03-20")';
  assert.deepEqual(evaluateFormula(expression, lookup, { ...options, preserveStyles: true }).runs, [
    { text: "Last Updated: ", styles: ["b"] }, { text: "@March 20, 2026", styles: [] },
  ]);
  assert.equal(evaluate(expression), "Last Updated: @March 20, 2026");
  assert.equal(evaluate('parseDate("2026-03-20T08:05") + " start"'), "@March 20, 2026 8:05 AM start");
  assert.equal(evaluate('"start: " + format(parseDate("2026-03-20"))'), "start: March 20, 2026");
});

test("formula help covers every function", () => {
  assert.equal(new Set(FORMULA_HELP.map((entry) => entry.name)).size, FORMULA_HELP.length);
  for (const name of FORMULA_FUNCTION_NAMES) assert.ok(FORMULA_HELP.some((entry) => entry.name === name), name);
  for (const entry of FORMULA_HELP) {
    assert.ok(entry.group && entry.signature && entry.description && entry.example);
    if (entry.name !== "prop") assert.ok(FORMULA_FUNCTION_NAMES.includes(entry.name), entry.name);
  }
});

test("formula results ignore the computer time zone", () => {
  assert.equal(evaluate('hour("2026-09-19T10:45")'), 10);
  assert.equal(evaluate('formatDate("2026-09-19T10:45", "HH:mm")'), "10:45");
});
