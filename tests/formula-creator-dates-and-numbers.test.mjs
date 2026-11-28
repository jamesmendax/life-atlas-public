import test from "node:test";
import assert from "node:assert/strict";
import { coreParityWorkspace } from "./fixtures/core-parity-workspace.mjs";
import { resolvePropertyValue } from "../src/domain/database.js";
import { evaluateFormula } from "../src/domain/formula/engine.js";

test("basic ISO calendar dates flow through typed ranges and the gardening progress calculation", () => {
  const dates = { start: "2024-02-01", end: "2024-02-29", includeTime: false, timeZone: null };
  const formula = `lets(
    start, dateStart({{range}}).formatDate("YYYYMMDD").parseDate(),
    end, dateEnd({{range}}).formatDate("YYYYMMDDT23:59").parseDate(),
    ifs(now() > end, 1, now() < start, 0,
      floor(dateBetween(now(), start, "minutes") / dateBetween(end, start, "minutes") * 100) / 100))`;
  for (const [now, expected] of [[new Date(2024, 0, 31, 23, 59), 0], [new Date(2024, 1, 15, 12), 0.5], [new Date(2024, 2, 1), 1]]) {
    assert.equal(evaluateFormula(formula, () => dates, { now }), expected);
  }
  assert.deepEqual(evaluateFormula('parseDate("20240229")'), { start: "2024-02-29", end: null, includeTime: false, timeZone: null });
  assert.equal(evaluateFormula('format(parseDate("20240229T23:59"))'), "February 29, 2024 23:59");
  assert.equal(evaluateFormula('toNumber(parseDate("20240229T235930.125-0530"))'), Date.UTC(2024, 2, 1, 5, 29, 30, 125));
  for (const input of ["20230229", "2024023", "20240230T12:00", "20241301", "20240229T23:60", "20240229T2359junk", "2024-0229", "20240229T12:3400"]) {
    assert.equal(evaluateFormula(`parseDate(${JSON.stringify(input)})`), null, input);
  }
});

test("weekday, short date and ISO week formatting use the displayed civil day", () => {
  assert.equal(evaluateFormula('"🗓 " + formatDate("2025-01-01", "dddd")'), "🗓 Wednesday");
  assert.equal(evaluateFormula('formatDate("2021-01-03", "dddd ddd dd d W WW YYYY L [W L dddd]")'), "Sunday Sun Su 0 53 53 2021 01/03/2021 W L dddd");
  assert.equal(evaluateFormula('formatDate("2021-01-04", "W WW")'), "1 01");
  assert.equal(evaluateFormula('formatDate("2021-01-03", "W") == formatDate("2021-01-04", "W")'), false);
  assert.equal(evaluateFormula('formatDate("2021-01-04T01:00Z", "dddd W L", "America/Los_Angeles")'), "Sunday 53 01/03/2021");
  assert.equal(evaluateFormula('formatDate("2021-01-04", "dddd W L", "America/Los_Angeles")'), "Monday 1 01/04/2021");
  assert.equal(evaluateFormula('day(parseDate("2021-01-03"))'), 7);
  assert.equal(evaluateFormula('day(parseDate("2021-01-04"))'), 1);
  assert.equal(evaluateFormula('month(parseDate("2021-01-03"))'), 1);
  assert.equal(evaluateFormula('month(parseDate("2021-12-01"))'), 12);
});

test("formula date endpoints, arithmetic and representation accept original fixed-offset aliases", () => {
  const span = { start: "2026-11-27T12:00", end: "2026-12-03T23:00", includeTime: true, timeZone: "UTC+9" };
  const read = () => span;
  assert.equal(evaluateFormula("toNumber(dateStart({{span}}))", read), Date.UTC(2026, 10, 27, 3));
  assert.equal(evaluateFormula("toNumber(dateEnd({{span}}))", read), Date.UTC(2026, 11, 3, 14));
  assert.equal(evaluateFormula('formatDate(dateAdd(dateStart({{span}}), 1, "month"), "YYYY-MM-DD HH:mm")', read), "2026-12-27 12:00");
  assert.equal(evaluateFormula('formatDate("2026-11-27T03:00Z", "HH:mm", "UTC+9")'), "12:00");
  const dates = {
    first: { start: "2024-01-31T00:30", includeTime: true, timeZone: "UTC+9" },
    last: { start: "2024-02-29T00:30", includeTime: true, timeZone: "+09:00" },
  };
  assert.equal(evaluateFormula('dateBetween({{last}}, {{first}}, "months")', id => dates[id]), 1);
});

test("blank converted numbers add as zero and keep their type across formulas, bindings and lists", () => {
  const workspace = coreParityWorkspace();
  const source = workspace.dataSources.find(entry => entry.id === "projects");
  const item = workspace.databaseItems.find(entry => entry.id === "alpha");
  const result = source.properties.find(entry => entry.id === "formula");
  const read = expression => {
    result.config.expression = expression;
    return resolvePropertyValue(workspace, source, item, result);
  };
  const textToNumber = 'toNumber(replaceAll(prop("说明"), "[^0-9]", ""))';
  const target = { id: "weekly", name: "每周", type: "formula", config: { expression: textToNumber } };
  source.properties.push(target);
  assert.equal(resolvePropertyValue(workspace, source, item, target), null);
  assert.equal(read(`${textToNumber} + ${textToNumber} + ${textToNumber} + ${textToNumber}`), 0);
  assert.equal(read('prop("每周") + 3'), 3);
  assert.equal(read('let(n, prop("每周"), n + n)'), 0);
  assert.equal(read('[toNumber("")].first() + 3'), 3);
  assert.deepEqual(read('[prop("每周")]'), [null]);
  assert.equal(read('format(prop("每周"))'), "");
  assert.equal(read('if(prop("每周"), 1, 2)'), 2);
  item.values.notes = "3 days";
  assert.equal(read(`${textToNumber} + toNumber("")`), 3);
});

test("missing date operands leave the affected formula cell blank and allow dependent properties to test it", () => {
  const workspace = coreParityWorkspace();
  const source = workspace.dataSources.find(entry => entry.id === "projects");
  const item = workspace.databaseItems.find(entry => entry.id === "alpha");
  const latest = { id: "latest", name: "Latest date", type: "date" };
  const calculated = { id: "planned-date", name: "Planned date", type: "formula", config: { expression: 'dateAdd(prop("Latest date"), 0, "days")' } };
  const result = source.properties.find(entry => entry.id === "formula");
  source.properties.push(latest, calculated);
  result.config.expression = 'formatDate(prop("Planned date"), "W YYYY") == formatDate(now(), "W YYYY")';
  assert.equal(resolvePropertyValue(workspace, source, item, calculated), null);
  assert.equal(resolvePropertyValue(workspace, source, item, result), false);
  result.config.expression = 'if(floor(dateBetween(now(), prop("Latest date"), "days") / 90) > 0, "overdue", "scheduled")';
  assert.equal(resolvePropertyValue(workspace, source, item, result), null);
  assert.equal(evaluateFormula('if(empty(null), "no date", dateBetween(now(), null, "days"))'), "no date");
  for (const name of ["dateAdd", "dateSubtract"]) {
    assert.equal(evaluateFormula(`${name}(null, 1, "days")`), null);
    assert.equal(evaluateFormula(`${name}("not-a-date", 1, "days")`).error?.code, "TYPE");
  }
  assert.equal(evaluateFormula('dateBetween(dateEnd(null), dateStart(null), "days")'), null);
  assert.equal(evaluateFormula('dateBetween(now(), null, "days")'), null);
  assert.equal(evaluateFormula('dateBetween(null, now(), "days")'), null);
  assert.equal(evaluateFormula('dateBetween(now(), "not-a-date", "days")').error?.code, "TYPE");
});
