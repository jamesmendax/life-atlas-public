import { TRIP_MODES, VALID_POINT } from "../../../domain/tripRoutes.js";

const stop = (id, time, name, tag, lat, lon) => ({ id, time, name, tag, point: [lat, lon], done: false });

// The Kansai demonstration and WGS84 stops are from the original itinerary.
export const SAMPLE_TRIP = {
  flight: "MU515", fromCode: "PVG", fromCity: "上海浦东", toCode: "KIX", toCity: "大阪关西",
  date: "2026-12-12", gate: "D72", activeDay: 2, mode: "drive",
  days: [
    { day: 1, title: "大阪 · 抵达与道顿堀夜景", stops: [
      stop("k1", "12:35", "大阪关西国际机场", "机场", 34.4347, 135.244),
      stop("k2", "14:30", "难波格拉斯丽酒店", "住宿", 34.6655, 135.4979),
      stop("k3", "16:45", "道顿堀 · 戎桥", "街区", 34.6687, 135.5013),
      stop("k4", "19:00", "大阪城公园", "景点", 34.6873, 135.5262),
    ] },
    { day: 2, title: "京都 · 清水寺与岚山", stops: [
      stop("k5", "08:30", "清水寺 · 二年坂三年坂", "景点", 34.9949, 135.785),
      stop("k6", "11:45", "祇园花见小路", "午餐", 35.0037, 135.7751),
      stop("k7", "14:30", "岚山 · 渡月桥与竹林", "景点", 35.0129, 135.6777),
      stop("k8", "18:30", "四条河原町", "购物", 35.0038, 135.7689),
    ] },
    { day: 3, title: "奈良 · 公园与返程", stops: [
      stop("k9", "09:30", "奈良公园 · 东大寺", "景点", 34.6851, 135.843),
      stop("k10", "12:30", "奈良町老街", "午餐", 34.6776, 135.8315),
      stop("k11", "16:30", "关西机场第一航站楼", "机场", 34.4347, 135.244),
    ] },
  ],
};

// v1 blocks saved the Chengdu sample with names and manual distances only.
const chengduStops = new Map([
  ["大熊猫繁育研究基地", [30.73335,104.14409]], ["春熙路 · 太古里午餐", [30.65445,104.08156]],
  ["宽窄巷子 & 人民公园喝茶", [30.66697,104.05089]], ["玉林路老火锅夜景", [30.61979,104.04458]],
  ["三星堆博物馆新馆", [30.995,104.2218]], ["锦里古街 & 武侯祠", [30.6464,104.0477]],
  ["九眼桥锦江夜游", [30.6385,104.0903]],
]);
export const knownPlaces = new Map([...chengduStops, ...SAMPLE_TRIP.days.flatMap((d) => d.stops.map((s) => [s.name, s.point]))]);

export function tripStopLetter(index) {
  if (!Number.isSafeInteger(index) || index < 0) return "";
  let label = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    label = String.fromCharCode(65 + (n - 1) % 26) + label;
  }
  return label;
}

function clockLabel(minutes) {
  const day = Math.floor(minutes / 1440);
  const hour = String(Math.floor(minutes / 60) % 24).padStart(2, "0");
  const minute = String(minutes % 60).padStart(2, "0");
  const prefix = day === 0 ? "" : day === 1 ? "次日 " : day + " 天后 ";
  return prefix + hour + ":" + minute;
}

export function legSchedule(from, seconds) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(from?.time) || !Number.isSafeInteger(from.dwellMinutes) || from.dwellMinutes < 0) {
    return { departure: "", arrival: "" };
  }
  const [hours, minutes] = from.time.split(":").map(Number);
  const departure = hours * 60 + minutes + from.dwellMinutes;
  return {
    departure: clockLabel(departure),
    arrival: Number.isFinite(seconds) && seconds >= 0 ? clockLabel(departure + Math.round(seconds / 60)) : "",
  };
}

function normalizeStop(value, i) {
  if (!value || typeof value !== "object" || typeof value.name !== "string") return null;
  // Unrecognized legacy names stay unlocated until the user supplies a point.
  const point = VALID_POINT(value.point) ? value.point : knownPlaces.get(value.name) ?? null;
  const { dwellMinutes, ...saved } = value;
  return { ...saved, id: String(value.id ?? i), name: value.name, time: typeof value.time === "string" ? value.time : "", tag: typeof value.tag === "string" ? value.tag : "", done: value.done === true, point,
    ...(Number.isSafeInteger(dwellMinutes) && dwellMinutes >= 0 && { dwellMinutes }) };
}

const EMPTY_TRIP = {
  flight: "", fromCode: "", fromCity: "", toCode: "", toCity: "", date: "", gate: "",
  activeDay: 1, mode: "drive", days: [{ day: 1, title: "", stops: [] }],
};

export function normalizeTrip(raw, demonstration = false) {
  const fallback = demonstration ? SAMPLE_TRIP : EMPTY_TRIP;
  if (!raw || !Array.isArray(raw.days) || raw.days.length === 0) return fallback;
  const days = raw.days.filter((d) => d && Array.isArray(d.stops)).map((d, i) => ({
    ...d, day: Number.isInteger(d.day) ? d.day : i + 1, title: typeof d.title === "string" ? d.title : "",
    lodging: typeof d.lodging === "string" ? d.lodging.trim() : "",
    lodgingPoint: typeof d.lodging === "string" && d.lodging.trim() && VALID_POINT(d.lodgingPoint) ? d.lodgingPoint : null,
    stops: d.stops.map(normalizeStop).filter(Boolean),
  }));
  if (!days.length) return fallback;
  const data = { ...EMPTY_TRIP, ...raw, days };
  for (const name of ["flight", "fromCode", "fromCity", "toCode", "toCity", "date", "gate"]) {
    if (typeof data[name] !== "string") data[name] = "";
  }
  if (!TRIP_MODES.some((mode) => mode.id === data.mode)) data.mode = "drive";
  return data;
}

export function parseInputPoint(text) {
  const values = text.trim().split(/[,，\s]+/u);
  if (values.length !== 2 || values.some((s) => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(s))) return null;
  const point = values.map(Number);
  return VALID_POINT(point) ? point : null;
}

export function dateForDay(trip, day) {
  if (typeof day.date === "string" && day.date) return day.date;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(trip.date)) return "";
  const firstDay = new Date(trip.date + "T12:00:00Z");
  if (!Number.isFinite(firstDay.getTime())) return "";
  firstDay.setUTCDate(firstDay.getUTCDate() + trip.days.indexOf(day));
  return firstDay.toISOString().slice(0, 10);
}
