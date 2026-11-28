import test from "node:test";
import assert from "node:assert/strict";
import { formatNumber } from "../src/domain/numberFormat.js";
import { comparablePropertyValue, formatDateLabel, formatDisplayPropertyValue, formatPropertyValue } from "../src/domain/databaseProperties.js";

test("number formats match the known answers", () => {
  const answers = [
    [1234.5, { format: "cny" }, "¥1,234.50"], [-1234.5, { format: "usd" }, "-$1,234.50"],
    [1234.5, { format: "eur", decimals: 0 }, "€1,235"], [0.256, { format: "percent", decimals: 1 }, "25.6%"],
    [0.5, { format: "percent" }, "50%"], [0, { format: "percent" }, "0%"],
    [1234567.891, { format: "number_with_commas", decimals: 2 }, "1,234,567.89"], [1234567.891, { format: "number_with_commas" }, "1,234,567.891"],
    [3.14159, { format: "number", decimals: 2 }, "3.14"], [2.5, { format: "number", decimals: 0 }, "3"],
    [-0.5, { format: "number", decimals: 0 }, "-1"], [1234567, {}, "1234567"],
    [null, { format: "cny" }, ""], [0, { format: "cny" }, "¥0.00"],
  ];
  for (const [value, config, expected] of answers) assert.equal(formatNumber(value, config), expected);
});

test("formatted numbers appear in property values", () => {
  const property = { type: "number", config: { numberFormat: { format: "cny" } } };
  assert.equal(formatPropertyValue({}, property, 1234.5), "¥1,234.50");
  assert.equal(formatPropertyValue({}, { type: "number", config: {} }, 1234.5), "1234.5");
  assert.equal(formatPropertyValue({}, { ...property, type: "formula" }, 1234.5), "¥1,234.50");
  assert.equal(formatPropertyValue({}, { ...property, type: "rollup" }, 1234.5), "¥1,234.50");
});

test("automatic computed display shortens binary tails without rounding the comparable value", () => {
  const raw = 3 * 2.1;
  for (const type of ["formula", "rollup"]) {
    const property = { type };
    assert.equal(formatDisplayPropertyValue({}, property, raw), "6.3");
    assert.equal(formatDisplayPropertyValue({}, { type, config: { numberFormat: { format: "number", decimals: null } } }, raw), "6.3");
    assert.equal(formatDisplayPropertyValue({}, property, -raw), "-6.3");
    assert.equal(formatDisplayPropertyValue({}, property, 0.1 + 0.2), "0.3");
    assert.equal(formatDisplayPropertyValue({}, property, 1 / 3), "0.3333333333333333");
    assert.equal(formatDisplayPropertyValue({}, property, Number.MAX_SAFE_INTEGER), "9007199254740991");
    assert.equal(formatDisplayPropertyValue({}, property, 1.234567890123456e-100), "1.234567890123456e-100");
    assert.equal(formatDisplayPropertyValue({}, property, Number.MIN_VALUE), "5e-324");
    assert.equal(formatPropertyValue({}, property, raw), "6.300000000000001");
    assert.equal(comparablePropertyValue({}, property, raw), raw);
    for (const numberFormat of [{ format: "number", decimals: 3 }, { format: "number_with_commas" }, { format: "usd" }, { format: "percent" }]) {
      assert.equal(formatDisplayPropertyValue({}, { type, config: { numberFormat } }, raw), formatNumber(raw, numberFormat));
    }
  }
  assert.equal(formatDisplayPropertyValue({}, { type: "number" }, raw), "6.300000000000001");
  assert.equal(formatDisplayPropertyValue({}, { type: "rollup", config: { aggregation: "percent_checked" } }, 0.5), "50%");
});

test("date labels use chinese dates", () => {
  assert.equal(formatDateLabel("2026-09-05"), "2026年9月5日");
  assert.equal(formatDateLabel("2026-09-05T09:00"), "2026年9月5日 09:00");
  assert.equal(formatDateLabel("2026-09-05T09:00:00z"), "2026年9月5日 09:00");
  assert.equal(formatDateLabel("2026-09-05T09:00 (UTC)"), "2026年9月5日 09:00");
  assert.equal(formatDateLabel({ start: "2026-09-05", end: "2026-09-08" }), "2026年9月5日 → 2026年9月8日");
  assert.equal(formatPropertyValue({}, { type: "date" }, "2026-09-05"), "2026-09-05");
});

test("formula dates display both boundaries and the original clock and offset without altering their values", () => {
  const formula = { type: "formula" };
  const midnight = Object.freeze({ start: "2025-10-01T00:00Z", end: null, includeTime: true, timeZone: "UTC" });
  const range = Object.freeze({ start: "2026-11-01T01:30-04:00", end: "2026-11-01T01:30-05:00", includeTime: true, timeZone: "America/New_York" });
  const day = { start: "2026-04-01", end: null, includeTime: false };
  assert.equal(formatDisplayPropertyValue({}, formula, midnight), "2025年10月1日 00:00 (UTC)");
  assert.equal(formatDisplayPropertyValue({}, formula, { ...midnight, start: "2025-10-01T00:00z" }), "2025年10月1日 00:00 (UTC)");
  assert.equal(formatDisplayPropertyValue({}, formula, { start: "2026-04-01T10:30+05:30", includeTime: true, timeZone: "+05:30" }), "2026年4月1日 10:30 (+05:30)");
  const span = "2026年11月1日 01:30 UTC-04:00 → 2026年11月1日 01:30 UTC-05:00 (America/New_York)";
  assert.equal(formatPropertyValue({}, formula, range), span);
  assert.equal(formatDisplayPropertyValue({}, formula, [day, range]), "2026年4月1日, " + span);
  assert.equal(formatDisplayPropertyValue({}, formula, { start: "2026-04-01", end: "2026-04-04" }), "2026年4月1日 → 2026年4月4日");
  assert.equal(formatDisplayPropertyValue({}, formula, { start: "2026-04-01T10:30:45+05:30", includeTime: true }), "2026年4月1日 10:30:45 UTC+05:30");
  assert.equal(formatDisplayPropertyValue({}, formula, null), "");
  assert.equal(formatDisplayPropertyValue({}, formula, "2026-04-01"), "2026-04-01");
  assert.equal(comparablePropertyValue({}, formula, midnight), Date.UTC(2025, 9, 1));
});
