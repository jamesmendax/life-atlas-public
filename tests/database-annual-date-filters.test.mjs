import assert from "node:assert/strict";
import test from "node:test";
import { localDateWindow, matchesLocalDateWindow } from "../src/domain/databaseDateRange.js";
import { projectViewItems } from "../src/domain/database.js";

test("rolling twelve months includes both calendar-day boundaries and clamps leap day", () => {
  const window = localDateWindow("past_12_months", new Date(2024, 1, 29, 16));
  assert.deepEqual(window, [new Date(2023, 1, 28).getTime(), new Date(2024, 2, 1).getTime()]);
  for (const [date, expected] of [["2023-02-27", false], ["2023-02-28", true], ["2024-02-29T23:59", true], ["2024-03-01", false]]) {
    assert.equal(matchesLocalDateWindow(date, window, "start"), expected, date);
  }
});

test("calendar year uses January boundaries, while an inclusive deadline retains overdue dates", () => {
  const now = new Date(2026, 11, 28, 23, 59);
  const year = localDateWindow("this_year", now);
  assert.deepEqual(year, [new Date(2026, 0, 1).getTime(), new Date(2027, 0, 1).getTime()]);
  const byNextWeek = localDateWindow("through_next_7_days", now);
  for (const [date, expected] of [["2020-01-01", true], ["2027-01-04T23:59", true], ["2027-01-05", false], [null, false]]) {
    assert.equal(matchesLocalDateWindow(date, byNextWeek, "start"), expected, date);
  }
});

test("strictly after today starts at the next local midnight", () => {
  const now = new Date(2024, 2, 6, 22);
  const window = localDateWindow("after_today", now);
  assert.deepEqual(window, [new Date(2024, 2, 7).getTime(), Infinity]);
  assert.equal(matchesLocalDateWindow("2024-03-06T23:59", window, "start"), false);
  assert.equal(matchesLocalDateWindow("2024-03-07", window, "start"), true);
  const ongoing = { start: "2024-03-06", end: "2024-03-08" };
  assert.equal(matchesLocalDateWindow(ongoing, window, "start"), false);
  assert.equal(matchesLocalDateWindow(ongoing, window, "end"), true);
  assert.equal(matchesLocalDateWindow(ongoing, window, "overlap"), true);
  assert.equal(matchesLocalDateWindow(null, window, "start"), false);
});

test("one calendar month deadline clamps month ends and includes the cutoff day", () => {
  for (const [year, lastFebruaryDay] of [[2024, 29], [2025, 28]]) {
    const window = localDateWindow("through_next_month", new Date(year, 0, 31, 23, 58));
    assert.deepEqual(window, [-Infinity, new Date(year, 2, 1).getTime()]);
    const lastMinute = new Date(year, 1, lastFebruaryDay, 23, 59).toISOString();
    assert.equal(matchesLocalDateWindow({ start: lastMinute, includeTime: true }, window, "start"), true);
    assert.equal(matchesLocalDateWindow(`${year}-03-01`, window, "start"), false);
    assert.equal(matchesLocalDateWindow("2000-01-01", window, "start"), true);
  }
  assert.deepEqual(localDateWindow("through_next_month", new Date(2026, 11, 31, 22)),
    [-Infinity, new Date(2027, 1, 1).getTime()]);
});

test("new saved date limits default to start and retain explicit end or overlap", () => {
  const source = { id: "events", properties: [{ id: "day", type: "date" }] };
  const workspace = { dataSources: [source], databaseItems: [
    { id: "through", sourceId: source.id, values: { day: { start: "2024-03-05", end: "2024-03-08" } } },
    { id: "next", sourceId: source.id, values: { day: "2024-03-07" } },
    { id: "later", sourceId: source.id, values: { day: "2024-03-08" } },
  ] };
  const select = (day, value, dateTarget) => projectViewItems(workspace, { sourceId: source.id,
    filter: { propertyId: "day", operator: "relative_date", value, dateTarget },
  }, { now: new Date(2024, 2, day, 12) }).map(item => item.id);
  assert.deepEqual([6, 7, 8].map(day => select(day,"after_today")), [["next", "later"], ["later"], []]);
  for (const endpoint of ["end", "overlap"]) {
    assert.deepEqual(select(6, "after_today", endpoint), ["through", "next", "later"]);
  }
  assert.deepEqual(select(6, "today"), ["through"]);
});

test("saved view relative date conditions distinguish range overlap, start and end on raw and formula dates", () => {
  const date = { id: "due", type: "date" };
  const formula = { id: "computed", type: "formula", config: { expression: "{{due}}" } };
  const source = { id: "goals", properties: [{ id: "title", type: "title" }, date, formula] };
  const values = {
    annual: { start: "2026-01-01", end: "2026-12-31" },
    point: { start: "2026-12-31", end: null },
    spans: { start: "2025-12-31", end: "2027-01-01" },
    begins: { start: "2026-12-10", end: "2027-01-01" },
    blank: null,
  };
  const workspace = { dataSources: [source], pages: [], relations: [], databaseItems: Object.entries(values)
    .map(([id, due]) => ({ id, sourceId: source.id, values: { title: id, due } })) };
  const now = new Date(2026, 11, 15, 12);
  for (const propertyId of [date.id, formula.id]) {
    const selected = dateTarget => projectViewItems(workspace, { sourceId: source.id,
      filter: { propertyId, operator: "relative_date", value: "this_month", dateTarget } }, { now }).map(row => row.id);
    assert.deepEqual(selected("start"), ["point", "begins"]);
    assert.deepEqual(selected("end"), ["annual", "point"]);
    assert.deepEqual(selected("overlap"), ["annual", "point", "spans", "begins"]);
    assert.deepEqual(selected(undefined), selected("overlap"));
  }
});
