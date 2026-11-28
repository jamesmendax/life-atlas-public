import test from "node:test";
import assert from "node:assert/strict";
import { appendCalendarMonth, calendarMonth, monthWindowDays, openCalendarMonthWindow } from "../src/domain/calendarMonthScroll.js";
import { boardCardAppearance, pageCardPreview } from "../src/domain/cardPreview.js";
import { timelineLoadLimit, timelineSideColumns } from "../src/domain/timelineViewOptions.js";

test("rolling calendar month windows cross years, merge shared weeks and retain three months", () => {
  let window = openCalendarMonthWindow("2026-12-01");
  assert.deepEqual(window, { start: "2026-12-01", end: "2027-01-01" });
  assert.ok(monthWindowDays(window, 1).includes("2027-01-16"));
  for (let step = 0; step < 16; step++) {
    const days = monthWindowDays(window, 1);
    assert.equal(new Set(days).size, days.length);
    assert.deepEqual(days, [...days].sort());
    assert.equal(days.length % 7, 0);
    assert.ok(days.length <= 105);
    assert.ok(window.end <= calendarMonth(window.start, 2));
    window = appendCalendarMonth(window);
  }
  assert.equal(calendarMonth("bad date"), null);
  assert.equal(calendarMonth("2028-01-01", -1), "2027-12-01");
});

test("gallery uses first block video, board locates media after initial text, and legacy boards stay text-only", () => {
  const video = { id: "vid", type: "video", props: { url: "blob:old#life-attachment=vid", name: "短片.webm" } };
  const paragraph = { id: "body", type: "paragraph", content: "项目说明" };
  assert.deepEqual(pageCardPreview({ content: [video, paragraph] }), {
    kind: "video", url: "blob:old#life-attachment=vid", name: "短片.webm", text: "",
  });
  assert.equal(pageCardPreview({ content: [paragraph, video] }).kind, "text");
  assert.equal(pageCardPreview({ content: [paragraph, video] }, true).kind, "video");
  assert.equal(boardCardAppearance().preview.kind, "none");
  const statistic = { propertyId: "budget", calculation: "sum" };
  assert.deepEqual(boardCardAppearance({ columnStatistic: statistic, wrapAllContent: true }), {
    columnStatistic: statistic, wrapAllContent: true, cardSize: "medium", preview: { kind: "none", propertyId: null }, imageFit: "cover",
  });
});

test("timeline shows persisted side-column order and handles legacy and limited loads", () => {
  const source = { properties: [{ id: "t", type: "title" }, { id: "s", type: "status" }, { id: "n", type: "number" }, { id: "d", type: "date" }] };
  assert.deepEqual(timelineSideColumns(source, {}).map(property=>property.id), ["t", "s", "n"]);
  assert.deepEqual(timelineSideColumns(source, { tablePropertyIds: ["d", "deleted", "s", "d"] }).map(property=>property.id), ["t", "d", "s"]);
  assert.deepEqual(timelineSideColumns(source, { tablePropertyIds: [] }).map(property=>property.id), ["t"]);
  assert.equal(timelineLoadLimit("25"), 25);
  for (const value of [undefined, "", 0, 3, Infinity]) assert.equal(timelineLoadLimit(value), null);
});
