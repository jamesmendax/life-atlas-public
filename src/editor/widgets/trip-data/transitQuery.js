import { MAX_ROUTE_STOPS, VALID_POINT } from "../../../domain/tripRoutes.js";

export function transitDeparture(date, stop, now = Date.now()) {
  const time = stop.time || undefined;
  const dwell = Number(stop.dwellMinutes);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(time) || !Number.isSafeInteger(dwell) || dwell <= 0) {
    return { date: date || undefined, time };
  }
  const [hours, minutes] = time.split(":").map(Number);
  const total = hours * 60 + minutes + dwell;
  const dayOffset = Math.floor(total / 1440);
  const adjustedTime = [Math.floor(total / 60) % 24, total % 60].map(n => String(n).padStart(2, "0")).join(":");
  if (!dayOffset) return { date: date || undefined, time: adjustedTime };
  // AMap interprets an omitted date in China's timezone. UTC arithmetic avoids
  // applying the machine's DST changes when crossing a calendar boundary.
  const start = date || new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  const stamp = new Date(start + "T00:00:00Z");
  stamp.setUTCDate(stamp.getUTCDate() + dayOffset);
  return { date: Number.isFinite(stamp.getTime()) ? stamp.toISOString().slice(0, 10) : start, time: adjustedTime };
}

export function transitQueryIndices(stopCount, index) {
  if (index !== undefined) {
    return Number.isInteger(index) && index >= 0 && index + 1 < stopCount ? [index] : [];
  }
  if (stopCount > MAX_ROUTE_STOPS) return [];
  return Array.from({ length: Math.max(0, stopCount - 1) }, (_, i) => i);
}

export async function queryTransitLegs({ stops, date, indices, previous, request, current }) {
  const count = stops.length - 1;
  const legs = previous?.legs.slice() || Array(count).fill(null);
  const alternatives = previous?.alternatives?.slice() || Array(count).fill(null);
  const failureByLeg = previous?.failureByLeg.slice() || Array(count).fill("");
  let at = previous?.at || "", failure = "";
  for (const index of indices) {
    if (!current()) return null;
    const from = stops[index], to = stops[index + 1];
    failureByLeg[index] = "";
    if (!VALID_POINT(from.point) || !VALID_POINT(to.point)) {
      failureByLeg[index] = "该段还缺少起点或终点坐标";
      failure ||= failureByLeg[index];
      continue;
    }
    try {
      const result = await request({
        points: [from.point, to.point], citycodes: [from.citycode || "", to.citycode || ""],
        ...((from.amap || to.amap) && { places: [from.amap || null, to.amap || null] }),
        ...transitDeparture(date, from),
      });
      if (!current()) return null;
      const leg = result?.ok && result.value?.legs?.[0];
      if (leg && Array.isArray(leg.steps) && leg.steps.length) {
        legs[index] = { ...leg, provider: "amap" };
        const options = result.value.alternatives?.filter(option => Array.isArray(option.steps) && option.steps.length) || [];
        alternatives[index] = options.length ? options.map(option => ({ ...option, provider: "amap" })) : [legs[index]];
        at = result.value.at || at;
        continue;
      }
      failureByLeg[index] = result?.error?.message || "高德未返回可用线路";
      failure ||= failureByLeg[index];
      if (["E_FORBIDDEN", "E_IO", "E_THROTTLED", "E_CANCELLED"].includes(result?.error?.code)) break;
    } catch {
      if (!current()) return null;
      failureByLeg[index] = "高德公交服务暂不可用";
      failure ||= failureByLeg[index];
      break;
    }
  }
  return { legs, alternatives, failureByLeg, failure, at, count: legs.filter(Boolean).length };
}
