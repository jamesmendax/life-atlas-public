export const ROADMAP_ZOOMS = Object.freeze([1, 1.5, 2, 3, 4]);
export const ROADMAP_MARKERS = Object.freeze(["diamond", "circle", "ring", "square", "major"]);
export const ROADMAP_DEFAULTS = Object.freeze({
  datePropertyId: null,
  colorPropertyId: null,
  markerPropertyId: null,
  markerMap: Object.freeze({}),
  subtitlePropertyId: null,
  progressPropertyId: null,
  scale: "auto",
  density: "comfortable",
  showToday: true,
  zoom: 1,
});

const DAY = 86400000;
const WEEK_EPOCH = Date.UTC(1970, 0, 5);
const TICK_CANDIDATES = [
  { unit: "day", step: 1 }, { unit: "day", step: 2 }, { unit: "day", step: 3 },
  { unit: "week", step: 1 }, { unit: "week", step: 2 },
  { unit: "month", step: 1 }, { unit: "month", step: 2 },
  { unit: "quarter", step: 1 }, { unit: "month", step: 6 },
  { unit: "year", step: 1 }, { unit: "year", step: 2 },
  { unit: "year", step: 5 }, { unit: "year", step: 10 },
];
const compareIds = (first, second) => String(first) < String(second) ? -1 : String(first) > String(second) ? 1 : 0;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const utcMonth = (ordinal) => {
  const date = new Date(0);
  date.setUTCFullYear(Math.floor(ordinal / 12), ordinal % 12, 1);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
};

function tickRange(domain, candidate) {
  if (candidate.unit === "day" || candidate.unit === "week") {
    const interval = DAY * candidate.step * (candidate.unit === "week" ? 7 : 1);
    const origin = candidate.unit === "week" ? WEEK_EPOCH : 0;
    const first = Math.ceil((domain.start - origin) / interval);
    const last = Math.floor((domain.end - origin) / interval);
    return { count: Math.max(0, last - first + 1), at: (offset) => origin + (first + offset) * interval };
  }
  const start = new Date(domain.start);
  const end = new Date(domain.end);
  if (candidate.unit === "year") {
    let firstYear = start.getUTCFullYear();
    if (utcMonth(firstYear * 12) < domain.start) firstYear++;
    firstYear = Math.ceil(firstYear / candidate.step) * candidate.step;
    const count = Math.max(0, Math.floor((end.getUTCFullYear() - firstYear) / candidate.step) + 1);
    return { count, at: (offset) => utcMonth((firstYear + offset * candidate.step) * 12) };
  }
  const interval = candidate.unit === "quarter" ? 3 : candidate.step;
  let firstMonth = start.getUTCFullYear() * 12 + start.getUTCMonth();
  if (utcMonth(firstMonth) < domain.start) firstMonth++;
  firstMonth = Math.ceil(firstMonth / interval) * interval;
  const lastMonth = end.getUTCFullYear() * 12 + end.getUTCMonth();
  return { count: Math.max(0, Math.floor((lastMonth - firstMonth) / interval) + 1), at: (offset) => utcMonth(firstMonth + offset * interval) };
}

function buildTicks(domain, axis, scale) {
  const candidates = scale === "auto" ? TICK_CANDIDATES : TICK_CANDIDATES.filter((candidate) => candidate.unit === scale);
  const available = candidates.length ? candidates : TICK_CANDIDATES;
  const maximum = Math.max(2, Math.floor((axis.x1 - axis.x0) / 110));
  let selected = available.at(-1);
  let range = tickRange(domain, selected);
  for (const candidate of available) {
    const current = tickRange(domain, candidate);
    if (current.count <= maximum) {
      selected = candidate;
      range = current;
      break;
    }
  }
  let previousYear = null;
  const ticks = Array.from({ length: range.count }, (_, offset) => {
    const time = range.at(offset);
    const date = new Date(time);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    let label;
    if (selected.unit === "day" || selected.unit === "week") label = `${month}月${date.getUTCDate()}日`;
    else if (selected.unit === "month") label = `${previousYear === year ? "" : `${year}年`}${month}月`;
    else if (selected.unit === "quarter") label = `${year} Q${Math.floor((month - 1) / 3) + 1}`;
    else label = `${year}年`;
    previousYear = year;
    return { x: axis.x0 + (time - domain.start) / (domain.end - domain.start) * (axis.x1 - axis.x0), t: time, label };
  });
  return { unit: selected.unit, step: selected.step, ticks };
}

export function splitTickLabel(label) {
  let match = /^(\d+)月(\d+)日$/.exec(label);
  if (match) return { numeral: match[2], unit: "日", note: `${match[1]}月`, small: false };
  match = /^(?:(\d+)年)?(\d+)月$/.exec(label);
  if (match) return { numeral: match[2], unit: "月", note: match[1] || "", small: false };
  match = /^(\d+) Q([1-4])$/.exec(label);
  if (match) return { numeral: match[2], unit: "季度", note: match[1], small: false };
  match = /^(\d+)年$/.exec(label);
  if (match) return { numeral: match[1], unit: "年", note: "", small: true };
  return { numeral: String(label || ""), unit: "", note: "", small: false };
}

export function layoutRoadmap({ entries = [], width = 1200, now = 0, config = {} } = {}) {
  const settings = { ...ROADMAP_DEFAULTS, ...(config?.roadmap || config || {}) };
  const zoom = ROADMAP_ZOOMS.includes(settings.zoom) ? settings.zoom : 1;
  const cardWidth = settings.density === "compact" ? 148 : 184;
  const cardHeight = settings.density === "compact" ? 48 : 64;
  const instant = Number.isFinite(now) ? now : 0;
  const axis = { x0: 24, x1: Math.max(0, Number(width) || 0) * zoom - 24, y: 0 };
  const sorted = [...entries].sort((first, second) => {
    const firstStart = Number.isFinite(first.start) ? first.start : Infinity;
    const secondStart = Number.isFinite(second.start) ? second.start : Infinity;
    return firstStart === secondStart ? compareIds(first.id, second.id) : firstStart - secondStart;
  });
  const scheduled = sorted.filter((entry) => Number.isFinite(entry.start));
  const unscheduled = sorted.filter((entry) => !Number.isFinite(entry.start)).map((entry) => entry.id);
  const phases = [];
  const milestones = [];
  const laneEnds = [];
  const intervals = [];
  let domain = { start: null, end: null };
  if (scheduled.length) {
    const first = scheduled[0].start;
    const last = scheduled.reduce((latest, entry) => Math.max(latest, entry.start, Number.isFinite(entry.end) ? entry.end : entry.start), first);
    const span = last - first;
    const padding = span === 0 ? 7 * DAY : Math.max(3 * DAY, span * 0.05);
    domain = { start: first - padding, end: last + padding };
    const position = (time) => axis.x0 + (time - domain.start) / (domain.end - domain.start) * (axis.x1 - axis.x0);
    for (const entry of scheduled) {
      const x = position(entry.start);
      if (Number.isFinite(entry.end) && entry.end > entry.start) {
        let lane = laneEnds.findIndex((end) => end <= entry.start);
        if (lane === -1) lane = laneEnds.length;
        laneEnds[lane] = entry.end;
        const phaseWidth = position(entry.end) - x;
        const progress = typeof entry.progress === "number" && Number.isFinite(entry.progress) ? clamp(entry.progress, 0, 1) : null;
        phases.push({ ...entry, x, width: phaseWidth, lane, y: 0, height: 8, label: entry.title || "", subtitle: entry.subtitle || "", labelVisible: phaseWidth >= 48, subtitleVisible: phaseWidth >= 160, progress, fill: progress === null ? clamp((instant - entry.start) / (entry.end - entry.start), 0, 1) : progress });
        continue;
      }
      const preferred = milestones.length % 2 === 0 ? 1 : 0;
      const startX = x + 10;
      const endX = x - 10 - cardWidth;
      const narrow = cardWidth > axis.x1 - axis.x0 - 10;
      const neitherFits = startX + cardWidth > axis.x1 && endX < axis.x0;
      let selected;
      if (narrow) selected = { level: preferred, align: "start", x: axis.x0 };
      else {
        let attempt = 0;
        while (!selected) {
          const level = attempt < 4 ? (attempt < 2 ? preferred : 1 - preferred) : 2 + Math.floor((attempt - 4) / 2);
          const align = attempt % 2 === 0 ? "start" : "end";
          const left = neitherFits ? clamp(align === "start" ? startX : endX, axis.x0, axis.x1 - cardWidth) : align === "start" ? startX : endX;
          const right = left + cardWidth;
          const overlaps = (intervals[level] || []).some((interval) => left < interval.right + 8 && right > interval.left - 8);
          if (left >= axis.x0 && right <= axis.x1 && !overlaps) selected = { level, align, x: left };
          attempt++;
        }
      }
      if (!intervals[selected.level]) intervals[selected.level] = [];
      intervals[selected.level].push({ left: selected.x, right: selected.x + cardWidth });
      milestones.push({ ...entry, x, level: selected.level, align: selected.align, past: entry.start <= instant, marker: ROADMAP_MARKERS.includes(entry.marker) ? entry.marker : "diamond", card: { x: selected.x, y: 0, width: cardWidth, height: cardHeight } });
    }
  }
  const levels = Math.max(2, intervals.length);
  const lanes = Math.max(1, laneEnds.length);
  axis.y = 96 + levels * (cardHeight + 12) + 8;
  for (const phase of phases) phase.y = axis.y + 36 + phase.lane * 56;
  for (const milestone of milestones) milestone.card.y = axis.y - 18 - cardHeight - milestone.level * (cardHeight + 12);
  const height = axis.y + 36 + (lanes - 1) * 56 + 44 + 48;
  const tickLayout = scheduled.length ? buildTicks(domain, axis, settings.scale) : { unit: "day", step: 1, ticks: [] };
  const today = scheduled.length && settings.showToday !== false && instant >= domain.start && instant <= domain.end ? { x: axis.x0 + (instant - domain.start) / (domain.end - domain.start) * (axis.x1 - axis.x0), t: instant } : null;
  return { domain, ...tickLayout, axis, today, phases, milestones, levels, lanes, height, unscheduled, now: instant };
}
