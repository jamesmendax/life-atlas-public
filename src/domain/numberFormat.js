const SYMBOLS = { cny: "¥", usd: "$", eur: "€" };

export const NUMBER_FORMATS = [
  ["number", "数字"], ["number_with_commas", "带千位分隔符的数字"], ["percent", "百分比"],
  ["cny", "人民币"], ["usd", "美元"], ["eur", "欧元"],
];

export function formatNumber(value, config = {}) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const format = config.format || "number";
  const decimals = Number.isInteger(config.decimals) && config.decimals >= 0 && config.decimals <= 4 ? config.decimals : null;
  const digits = (fallbackMax, grouping) => new Intl.NumberFormat("en-US", {
    useGrouping: grouping, minimumFractionDigits: decimals ?? 0, maximumFractionDigits: decimals ?? fallbackMax,
  });
  if (format === "number_with_commas") return digits(20, true).format(number);
  if (format === "percent") return `${digits(2, false).format(number * 100)}%`;
  if (SYMBOLS[format]) {
    const fixed = new Intl.NumberFormat("en-US", { useGrouping: true, minimumFractionDigits: decimals ?? 2, maximumFractionDigits: decimals ?? 2 }).format(Math.abs(number));
    return `${number < 0 ? "-" : ""}${SYMBOLS[format]}${fixed}`;
  }
  return decimals === null ? String(number) : digits(0, false).format(number);
}

export function formatComputedNumber(value, config = {}) {
  if ((config.format && config.format !== "number") || config.decimals != null) return formatNumber(value, config);
  if (!Number.isFinite(value) || Number.isInteger(value)) return String(value);
  // Shorten common binary tails only when the decimal is within one representable step.
  const rounded = Number(value.toPrecision(15));
  const step = 2 ** Math.max(-1074, Math.floor(Math.log2(Math.abs(value))) - 52);
  return String(Math.abs(value - rounded) <= step ? rounded : value);
}
