export function chartBarScale(values, { count = false } = {}) {
  let low = 0;
  let high = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    low = Math.min(low, value);
    high = Math.max(high, value);
  }

  if (count) high = Math.max(2, high);
  if (low === high) high = 1;

  const targetStep = high / 4 - low / 4;
  const magnitude = 10 ** Math.floor(Math.log10(targetStep));
  const factor = [1, 2, 2.5, 5, 10].find(value => value * magnitude >= targetStep);
  let step = factor * magnitude;
  if (count) step = Math.max(1, Math.ceil(step));

  let ticks = [...new Set([low, 0, high])];
  if (step > 0 && Number.isFinite(step)) {
    const first = Math.floor(low / step);
    const last = Math.ceil(high / step);
    const roundedTicks = Array.from({ length: last - first + 1 }, (_, index) => (first + index) * step);
    if (roundedTicks.every(Number.isFinite)) ticks = roundedTicks;
  }

  const min = ticks[0];
  const max = ticks.at(-1);
  // Scaling before taking the difference keeps the span finite for signed data.
  const limit = Math.max(-min, max);
  const position = value => (value / limit - min / limit) / (max / limit - min / limit) * 100;
  return { ticks, position };
}

export function chartDonutLayout(points, aggregation = "count") {
  const distributable = aggregation === "count" || aggregation === "sum";
  let total = 0;
  let max = 0;
  let hasNegative = false;
  if (distributable) {
    for (const { value } of points) {
      if (!Number.isFinite(value)) continue;
      max = Math.max(max, value);
      total += Math.max(0, value);
      if (value < 0) hasNegative = true;
    }
  }
  const weight = value => max > 0 && Number.isFinite(value) && value > 0 ? value / max : 0;
  const scaledTotal = points.reduce((sum, { value }) => sum + weight(value), 0);
  let cumulative = 0;
  const parts = points.map(point => {
    const scaled = weight(point.value);
    const offset = scaledTotal ? cumulative / scaledTotal : 0;
    cumulative += scaled;
    const end = scaledTotal ? cumulative / scaledTotal : 0;
    return { point, share: scaledTotal ? scaled / scaledTotal : 0, offset, end };
  });
  return { distributable, total, hasNegative, parts };
}
