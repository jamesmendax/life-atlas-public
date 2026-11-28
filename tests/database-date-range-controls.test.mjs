import test from "node:test";
import assert from "node:assert/strict";
import { timelineDates, timelineDateChange, axisTime, HOUR } from "../src/domain/timelineDateFields.js";
import { DAY, dayMs, resizeDate, scaleWindow, shiftDate, timelineTicks, timelineWindow } from "../src/domain/databaseDateRange.js";
import { dateMillis, validatePropertyValue } from "../src/domain/databaseProperties.js";

const example = { start:"2026-11-03T09:15:00", end:"2026-11-05T17:45:00", includeTime:true, timeZone:"Asia/Shanghai" };
test("calendar and timeline edges keep both local clock times, timezone and same-day ordering", () => {
  assert.deepEqual(resizeDate(example,"end","2026-11-10"),{...example,end:"2026-11-10T17:45:00"});
  assert.equal(resizeDate(example,"start","2026-11-12").start,"2026-11-05T09:15:00");
  assert.equal(resizeDate(example,"end","2026-10-31").end,"2026-11-03T17:45:00");
  const overnight={...example,start:"2026-11-04T22:00:00",end:"2026-11-05T08:00:00"};
  assert.equal(resizeDate(overnight,"end","2026-11-04").end,overnight.start);
  assert.equal(resizeDate({...example,end:null},"end","2026-11-06").end,"2026-11-06T09:15:00");
  assert.equal(shiftDate(example,2).end,"2026-11-07T17:45:00");
});
test("day, week, month and quarter change visible extent and date-aligned ticks",()=>{
  const center=dayMs("2026-11-03");
  const widths=["day","week","month","quarter"].map(scale=>{
    const range=timelineWindow([example],{scale,...scaleWindow(scale,center)});
    const ticks=timelineTicks(range,scale); assert.ok(ticks.length>=3 && ticks.length<=18);
    if(scale==="quarter")assert.ok(ticks.every(t=>new Date(t.ms).getUTCMonth()%3===0 && t.label.includes("Q")));
    if(scale==="week")assert.ok(ticks.every(t=>new Date(t.ms).getUTCDay()===1));
    assert.ok(range.start<center && range.end>center);
    return (range.end-range.start)/DAY;
  });
  assert.deepEqual(widths,[14,56,183,730]);
});

test("separate date columns change atomically while preserving unrelated range endpoints and existing timezone",()=>{
  const start={start:"2026-01-31T23:30:00",end:"2026-02-03T08:00:00",timeZone:"Asia/Shanghai",includeTime:true};
  const end={start:"2026-02-01T02:15:00",end:"2026-02-04T16:45:00",timeZone:"Asia/Shanghai",includeTime:true};
  assert.equal(timelineDates(start,end,true).end,end.start);
  const moved=timelineDateChange(start,end,true,"move",1,"hour");
  assert.deepEqual(moved.start,{...start,start:"2026-02-01T00:30:00"});assert.deepEqual(moved.end,{...end,start:"2026-02-01T03:15:00"});
  assert.deepEqual(timelineDateChange(start,end,true,"end",-1,"hour"),{end:{...end,start:"2026-02-01T01:15:00"}});
  assert.ok(timelineDateChange(start,end,true,"move",10,"day").error);
  assert.ok(timelineDateChange(start,end,true,"end",-8,"hour").error);
  assert.equal(timelineDateChange(start,null,true,"move",1,"hour").end,undefined);
});
test("hour projection respects explicit offsets and DST while yearly ticks align at January",()=>{
  assert.equal(axisTime("2026-11-03T09:15:00","Asia/Shanghai","UTC"),Date.parse("2026-11-03T01:15:00Z"));
  assert.equal(axisTime("2026-11-03T09:15:00+08:00","UTC","UTC"),Date.parse("2026-11-03T01:15:00Z"));
  const spring={start:"2026-03-08T01:30",end:null,timeZone:"America/New_York",includeTime:true};
  assert.equal(timelineDateChange(spring,null,false,"move",1,"hour").start.start,"2026-03-08T03:30");
  const november={...spring,start:"2026-11-01T01:30"};
  assert.ok(timelineDateChange(november,null,false,"move",1,"hour").error);
  const hour=timelineWindow([example],{scale:"hour",...scaleWindow("hour",dayMs("2026-11-03")+12*HOUR)});
  const year=timelineWindow([example],{scale:"year",...scaleWindow("year",dayMs("2026-11-03"))});
  assert.equal(hour.end-hour.start,24*HOUR);assert.ok(timelineTicks(hour,"hour").some(t=>t.label==="12:00"));
  assert.ok(timelineTicks(year,"year").every(t=>isoDayForTest(t.ms).endsWith("-01-01")));
  function isoDayForTest(ms){return new Date(ms).toISOString().slice(0,10);}
});

test("UTC-prefixed fixed offsets work in date validation and both timeline projection directions", () => {
  const start = "2026-11-27T12:00";
  for (const [timeZone, expected] of [
    ["UTC+9", "2026-11-27T03:00Z"], ["UTC-03:30", "2026-11-27T15:30Z"],
    ["UTC+05:45", "2026-11-27T06:15Z"], ["Asia/Tokyo", "2026-11-27T03:00Z"],
  ]) {
    const value = { start, includeTime: true, timeZone };
    const instant = Date.parse(expected);
    assert.equal(dateMillis(value), instant, timeZone);
    assert.equal(axisTime(start, timeZone, "UTC"), instant, timeZone);
    assert.equal(axisTime(expected, "UTC", timeZone), Date.parse(start + "Z"), timeZone);
    assert.equal(validatePropertyValue({ type: "date" }, value), null);
  }
  for (const timeZone of ["UTC+24", "UTC+09:60", "Unknown/Zone"]) {
    const value = { start, includeTime: true, timeZone };
    assert.equal(Number.isNaN(dateMillis(value)), true);
    assert.equal(validatePropertyValue({ type: "date" }, value), "日期格式或时区无效");
  }
  const timed = { start, end: "2026-12-03T23:00", includeTime: true, timeZone: "UTC+9" };
  assert.deepEqual(timelineDateChange(timed, null, false, "move", 1, "hour"), {
    start: { ...timed, start: "2026-11-27T13:00", end: "2026-12-04T00:00" },
  });
});
