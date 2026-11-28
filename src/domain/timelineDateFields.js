import { normalizeDate, normalizeDateTimeZone } from "./databaseProperties.js";
import { DAY, dayMs, isoDay, resizeDate, shiftDate } from "./databaseDateRange.js";

export const HOUR = DAY / 24;
const dateFormatters = new Map();
const clock = stamp => {
  const match = /^(\d{4}-\d\d-\d\d)(?:[T ](\d\d:\d\d)(?::(\d\d)(\.\d+)?)?)?/.exec(String(stamp));
  return match ? Date.parse(match[1] + "T" + (match[2] || "00:00") + ":" + (match[3] || "00") + (match[4] || "") + "Z") : NaN;
};
function inZone(ms, zone) {
  if (!zone) return ms;
  zone = normalizeDateTimeZone(zone);
  let formatter = dateFormatters.get(zone);
  if (!formatter) {
    try { formatter = new Intl.DateTimeFormat("en-GB",{ timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23" }); }
    catch { return NaN; }
    dateFormatters.set(zone,formatter);
  }
  const p = Object.fromEntries(formatter.formatToParts(ms).map(part=>[part.type,part.value]));
  return Date.parse(p.year+"-"+p.month+"-"+p.day+"T"+p.hour+":"+p.minute+":"+p.second+"Z") + ((ms%1000)+1000)%1000;
}
const suffix = stamp => /(?:Z|[+-]\d\d:\d\d)$/.exec(stamp)?.[0] || "";
const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
function instant(stamp, zone) {
  if (suffix(stamp)) return Date.parse(stamp);
  const wall = clock(stamp);
  if (!Number.isFinite(wall)) return NaN;
  let guess = wall;
  for (let i=0;i<4;i++) {
    const current = inZone(guess,zone || deviceZone);
    if (!Number.isFinite(current)) return NaN;
    if (current === wall) return guess;
    guess += wall-current;
  }
  return NaN;
}
export function axisTime(stamp, zone, axisZone = deviceZone) {
  if (!stamp?.includes("T")) return dayMs(stamp);
  const tick = instant(stamp, zone);
  return Number.isFinite(tick) ? inZone(tick,axisZone) : NaN;
}
function hourShift(stamp, delta, zone) {
  const tick = instant(stamp,zone);
  if (!Number.isFinite(tick)) return null;
  const tail = suffix(stamp);
  const shifted = tick + delta*HOUR;
  const offset = tail && tail !== "Z" ? (tail[0]==="-"?-1:1)*(Number(tail.slice(1,3))*60+Number(tail.slice(4,6)))*60000 : 0;
  const wall = tail ? shifted+offset : inZone(shifted,zone || deviceZone);
  if (!Number.isFinite(wall)) return null;
  const precision = /\.\d+/.test(stamp) ? 23 : /T\d\d:\d\d:\d\d/.test(stamp) ? 19 : 16;
  const value = new Date(wall).toISOString().slice(0,precision)+tail;
  // A floating local timestamp cannot distinguish the two instances of a repeated DST hour.
  if (!tail && instant(value,zone)!==shifted) return null;
  return value;
}
export function timelineDates(startValue,endValue,separate) {
  const start=normalizeDate(startValue),end=normalizeDate(endValue);
  if (!start) return null;
  return { ...start,end:separate ? end?.start || null : start.end,endZone:separate ? end?.timeZone || null : start.timeZone };
}
const timeOf = (stamp,zone) => stamp?.includes("T") ? instant(stamp,zone) : instant(stamp+"T00:00",zone);
export function timelineDateChange(startValue,endValue,separate,edge,delta,unit) {
  const start=normalizeDate(startValue),end=normalizeDate(endValue);
  const range=timelineDates(start,end,separate);
  if (!range) return {error:"请先填写开始日期。"};
  const endZone = separate ? (end?.timeZone || start.timeZone) : start.timeZone;
  let first=range.start,last=range.end;
  const shifted=(stamp,zone)=>unit==="hour" ? hourShift(stamp,delta,zone) : shiftDate(stamp,delta).start;
  if (edge==="move") {
    first=shifted(first,start.timeZone);
    if(last) last=shifted(last,endZone);
  } else if (unit==="hour") {
    if(edge==="start") first=shifted(first,start.timeZone);
    else last=shifted(last || first,endZone);
  } else if (!separate || start.timeZone===endZone) {
    const base=edge==="start" ? first : last || first;
    const next=resizeDate(range,edge,isoDay(dayMs(base)+delta*DAY));
    first=next.start;last=next.end;
    if(separate && edge==="start" && !end) {first=shifted(range.start,start.timeZone);last=null;}
  } else if(edge==="start") first=shifted(first,start.timeZone);
  else last=shifted(last || first,endZone);
  if (!first || ((range.end || edge==="end") && !last)) return {error:"该当地时间不存在或有重复，请从日期属性输入带时区的时间。"};
  if(!Number.isFinite(timeOf(first,start.timeZone)) || (last && !Number.isFinite(timeOf(last,endZone)))) return {error:"无法识别当前时间或时区，请先检查日期属性。"};
  if(last && timeOf(first,start.timeZone)>timeOf(last,endZone)) return {error:"结束时间不能早于开始时间。"};
  if (!separate) return {start:{...start,start:first,end:last,includeTime:start.includeTime || first.includes("T") || Boolean(last?.includes("T"))}};
  const changes={};
  const setField=(property,stamp,zone)=>{
    if(property?.end && timeOf(stamp,zone)>timeOf(property.end,zone)) return null;
    return {...(property || {end:null,timeZone:zone || null}),start:stamp,includeTime:Boolean(property?.includeTime || stamp.includes("T"))};
  };
  if (first!==start.start) changes.start=setField(start,first,start.timeZone);
  if (last && last!==end?.start) changes.end=setField(end,last,endZone);
  if(Object.values(changes).includes(null)) return {error:"调整会越过该日期属性自身的结束时间，请先修改该属性的日期范围。"};
  return changes;
}
