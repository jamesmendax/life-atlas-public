import test from "node:test";
import assert from "node:assert/strict";
import { calendarDays, localDay } from "../src/domain/databaseProperties.js";

test("calendar month and week grids start on the selected weekday", () => {
  const november = calendarDays("2026-11-06", 1, "month");
  assert.equal(november.length, 42);
  assert.equal(november[0], "2026-10-26");
  assert.equal(november.at(-1), "2026-12-06");
  assert.deepEqual(calendarDays("2026-11-06", 1, "week"), ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
  assert.equal(calendarDays("2026-11-06", 0, "week")[0], "2026-11-01");
  assert.ok(calendarDays("2024-02-15", 1, "month").includes("2024-02-29"));
  assert.deepEqual(calendarDays("invalid", 1, "month"), []);
});

test("today uses the local date instead of a utc substring", () => {
  const day = new Date(2026, 10, 6, 0, 30);
  assert.equal(localDay(day), "2026-11-06");
});

test("month grid covers only the full weeks intersecting the month", () => {
  const sunday = calendarDays("2026-11-06", 0, "month");
  assert.equal(sunday.length, 35);
  assert.equal(sunday[0], "2026-11-01");
  assert.equal(sunday.at(-1), "2026-12-05");
  assert.equal(calendarDays("2026-11-06", 1, "month").length, 42);
  assert.deepEqual(calendarDays("2021-02-01", 1, "month"), Array.from({ length: 28 }, (_, index) => `2021-02-${String(index + 1).padStart(2, "0")}`));
  const leap = calendarDays("2024-02-15", 1, "month");
  assert.equal(leap.length, 35);
  assert.equal(leap[0], "2024-01-29");
  assert.equal(leap.at(-1), "2024-03-03");
  assert.ok(leap.includes("2024-02-29"));
  assert.deepEqual(calendarDays("2026-02-30", 1, "month"), []);
});
