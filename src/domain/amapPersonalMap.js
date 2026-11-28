import { VALID_POINT } from "./tripRoutes.js";

import { MAX_WIDGET_STATE_BYTES } from "./marketFrameProtocol.js";

// AMap's published personal-map format allows up to 16 points per route.
export const AMAP_POINTS_PER_LINE = 16;

export function checkMapTransportSize(input) {
  const encoded = JSON.stringify(input);
  if (!encoded || encoded.length > MAX_WIDGET_STATE_BYTES || new TextEncoder().encode(encoded).byteLength > MAX_WIDGET_STATE_BYTES) {
    throw new Error("旅行计划超过组件 1 MiB 传输上限。");
  }
}

function valueText(value, label) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") throw new Error(label + "需要文字。");
  return value.trim();
}
function calendarDate(value, label) {
  if (!value) return "";
  const date = valueText(value, label);
  const stamp = Date.parse(date + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== date) {
    throw new Error(label + "需要有效的年-月-日。");
  }
  return date;
}

function offsetDate(date, index) {
  return date && new Date(Date.parse(date + "T00:00:00Z") + index * 86400000).toISOString().slice(0, 10);
}

function confirmedPoint(name, binding, label, missing) {
  const coords = binding?.location;
  if (!Array.isArray(coords) || coords.length !== 2 || !VALID_POINT([coords[1], coords[0]])
    || typeof binding.poiId !== "string" || !binding.poiId.trim()) {
    missing.push(label + "「" + name + "」");
    return null;
  }
  return { name, lon: coords[0], lat: coords[1], poiId: binding.poiId.trim() };
}

function tripDays(input) {
  const legacy = input?.plan === undefined;
  if (!legacy && input.day !== undefined) throw new Error("请提交一份完整计划或一天行程。");
  const days = legacy ? [input?.day] : input?.plan?.days;
  if (!Array.isArray(days) || !days.length) throw new Error("请添加行程日。");
  const start = calendarDate(legacy ? input?.date : input.plan.date, "旅行日期");
  const title = legacy ? "" : valueText(input.plan.title, "旅行标题");
  const missing = [];

  const lines = days.map((day, i) => {
    const ordinal = day?.day ?? i + 1;
    if (!Number.isSafeInteger(ordinal) || ordinal < 1) throw new Error("第 " + (i + 1) + " 个行程日的编号无效。");
    const label = "第 " + ordinal + " 天";
    if (!day || !Array.isArray(day.stops)) throw new Error(label + "缺少行程站点列表。");
    const date = (legacy ? start : "") || calendarDate(day.date, label + "日期") || offsetDate(start, i);
    const heading = [label, valueText(day.title, label + "标题") || "旅行行程"].join(" · ");
    const lodging = valueText(day.lodging, label + "住宿");
    const points = day.stops.map((stop, j) => {
      const position = label + "第 " + (j + 1) + " 站";
      const name = valueText(stop?.name, position + "名称");
      if (!name) throw new Error(position + "缺少名称。");
      const time = valueText(stop.time, position + "时间");
      const dwell = stop.dwellMinutes;
      if (dwell != null && (!Number.isSafeInteger(dwell) || dwell < 0)) throw new Error(position + "的停留分钟数无效。");
      const description = [time && "到达 " + time, dwell != null && "停留 " + dwell + " 分钟"].filter(Boolean).join("，");
      return { point: confirmedPoint(name, stop.amap, position, missing), name, description };
    });
    if (lodging) points.push({ point: confirmedPoint(lodging, day.lodgingAmap, label + "住宿", missing), name: lodging, description: "当晚住宿" });
    return { heading, date, points };
  });
  if (missing.length) throw new Error("请从高德搜索结果确认以下地点的 POI 和高德坐标：" + missing.join("、") + "。");
  return { name: legacy ? lines[0].heading : [title || "旅行计划", start].filter(Boolean).join(" · "), lines };
}

// AMap has coordinates for located days only. Attach free days, with their
// original date and ordinal, to the nearest preceding line (or the first line).
function locatedDays(lines) {
  const located = [], leading = [];
  for (const line of lines) {
    if (line.points.length) {
      located.push({ ...line, before: leading.splice(0), after: [] });
      continue;
    }
    const freeDay = [line.date, line.heading, "自由日（无地点）"].filter(Boolean).join(" · ");
    if (located.length) located.at(-1).after.push(freeDay);
    else leading.push(freeDay);
  }
  if (!located.length) throw new Error("整趟计划还没有可导入的站点或住宿。");
  return located;
}

function splitDay(day, capacity, minimum) {
  const groups = [];
  const total = Math.ceil(day.points.length / capacity);
  let offset = 0;
  for (let group = 1; group <= total; group++) {
    // Reserve enough points for each remaining line when the advertised
    // schema requires two or more. Every visit, including lodging, occurs once.
    const remaining = day.points.length - offset;
    const reserve = (total - group) * minimum;
    const length = Math.min(capacity, Math.max(1, remaining - reserve));
    const part = total > 1 ? " · 第 " + group + "/" + total + " 段" : "";
    groups.push({
      date: day.date, heading: day.heading + part, offset, points: day.points.slice(offset, offset + length),
      before: group === 1 ? day.before : [], after: group === total ? day.after : [],
    });
    offset += length;
  }
  return groups;
}

export function buildAmapPersonalMapArgs(input, { lineDesc = false, pointDesc = false, rootDesc = false,
  maxPointsPerLine = AMAP_POINTS_PER_LINE, minPointsPerLine = 1 } = {}) {
  checkMapTransportSize(input);
  const { name, lines } = tripDays(input);
  const join = parts => parts.filter(Boolean).join(" · ");
  const rootNotes = [];
  const capacity = Math.min(AMAP_POINTS_PER_LINE, maxPointsPerLine);
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error("高德当前接口不接受包含地点的路线。");
  const groups = locatedDays(lines).flatMap(day => splitDay(day, capacity, minPointsPerLine));
  const lineList = groups.map(({ heading, date, points, before, after, offset }) => {
    const title = join([date, heading]);
    const schedule = points.map(({ name, description }, i) => join([(offset + i + 1) + ". " + name, description]));
    const pointInfoList = points.map(({ point, description }, i) => {
      if (!pointDesc) return point;
      const notes = [description];
      if (!lineDesc && !rootDesc && i === 0) notes.unshift(...before);
      if (!lineDesc && !rootDesc && i === points.length - 1) notes.push(...after);
      const desc = join(notes);
      return desc ? { ...point, desc } : point;
    });
    const details = join([...before, ...(pointDesc ? [] : schedule), ...after]);
    if (lineDesc) return { title, ...(details && { desc: details }), pointInfoList };
    if (rootDesc) {
      if (details) rootNotes.push(join([title, details]));
      return { title, pointInfoList };
    }
    if (pointDesc) return { title, pointInfoList };
    return { title: join([...before, title, ...schedule, ...after]), pointInfoList };
  });
  const args = { orgName: name, lineList, ...(rootNotes.length > 0 && { desc: rootNotes.join("\n") }) };
  return args;
}