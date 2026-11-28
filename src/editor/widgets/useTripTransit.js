import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_ROUTE_STOPS } from "../../domain/tripRoutes.js";
import { planChengduTransit } from "./trip-data/chengduTransit.js";
import { transitQueryIndices, queryTransitLegs } from "./trip-data/transitQuery.js";

function offlineForDay(stops) {
  const points = stops.map(stop => stop.point);
  if (points.length <= MAX_ROUTE_STOPS) return planChengduTransit(points);
  const routes = points.slice(1).map((point, i) => planChengduTransit([points[i], point]));
  const first = routes.find(Boolean);
  return first ? { ...first, legs: routes.map(route => route?.legs[0] || null) } : null;
}

export function useTripTransit({ day, mode, date, trip }) {
  const { stops } = day;
  const offline = useMemo(() => mode === "transit" ? offlineForDay(stops) : null, [mode, stops]);
  const identity = JSON.stringify([day.day, mode, date, stops.map(s => [s.id, s.point, s.time, s.dwellMinutes, s.citycode, s.amap?.poiId, s.amap?.selected])]);
  const latest = useRef(identity);
  latest.current = identity;
  const running = useRef(null);
  const [state, setState] = useState(null);
  const [selection, setSelection] = useState();
  const saved = useRef(null);
  const active = state?.identity === identity ? state : null;
  useEffect(() => () => {
    const job = running.current;
    if (job?.identity !== identity) return;
    running.current = null;
    if (job.requestId && job.cancel) void job.cancel({ requestId: job.requestId }).catch(() => {});
  }, [identity]);

  async function query(index) {
    if (!trip?.transit || running.current || mode !== "transit") return;
    const indices = transitQueryIndices(stops.length, index);
    if (!indices.length) return;
    const job = { identity, requestId: null, cancel: trip.cancel };
    running.current = job;
    const previous = saved.current?.identity === identity ? saved.current : null;
    setState({ ...previous, identity, busy: true, busyIndex: index, failure: "" });
    const current = () => running.current === job && latest.current === identity;
    const request = args => {
      job.requestId = crypto.randomUUID();
      return trip.transit({ ...args, requestId: job.requestId });
    };
    try {
      const data = await queryTransitLegs({ stops, date, indices, previous, request, current });
      if (!data || !current()) return;
      setSelection(previous => previous?.identity === identity ? {
        identity, choices: previous.choices.map((choice, i) => indices.includes(i) ? 0 : choice),
      } : previous);
      saved.current = { ...data, identity, busy: false };
      setState(saved.current);
    } finally {
      if (running.current === job) running.current = null;
    }
  }
  const route = useMemo(() => {
    if (!active?.count) return offline;
    const choices = selection?.identity === identity ? selection.choices : [];
    return { provider: "amap", at: active.at, legs: active.legs.map((leg, i) =>
      active.alternatives?.[i]?.[choices[i] ?? 0] || leg || offline?.legs[i] || null) };
  }, [active, identity, offline, selection]);
  return { route, query, busy: Boolean(active?.busy), busyIndex: active?.busyIndex, failure: active?.failure,
    failureByLeg: active?.failureByLeg || [], onlineCount: active?.count || 0, alternatives: active?.alternatives,
    selected: index => (selection?.identity === identity ? selection.choices[index] : 0) ?? 0,
    select(index, option) {
      if (!active?.alternatives?.[index]?.[option]) return;
      setSelection(previous => {
        const choices = previous?.identity === identity ? [...previous.choices] : [];
        choices[index] = option;
        return { identity, choices };
      });
    } };
}
