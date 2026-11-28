import { resolveRollupTarget } from "./rollupConfiguration.js";

const codes = new Set(Intl.supportedValuesOf("currency"));
const formatters = new Map();

export const currencyFields = [
  { key: "amountPropertyId", label: "原币金额", types: ["number"] },
  { key: "currencyPropertyId", label: "原币代码", types: ["select", "text"] },
  { key: "ratePropertyId", label: "手工汇率", types: ["number"] },
  { key: "rateDatePropertyId", label: "汇率日期", types: ["date"] },
];

function currencyCode(value) {
  const code = String(value ?? "").trim().toUpperCase();
  return codes.has(code) ? code : null;
}

function currencyFormatter(code) {
  if (!formatters.has(code)) {
    const money = new Intl.NumberFormat("en-US", { style: "currency", currency: code, currencyDisplay: "code" });
    const digits = money.resolvedOptions().maximumFractionDigits;
    formatters.set(code, { money, digits });
  }
  return formatters.get(code);
}

export function formatCurrencyAmount(value, baseCurrency) {
  const code = currencyCode(baseCurrency);
  return code && Number.isFinite(value) ? currencyFormatter(code).money.format(value).replace(/\u00a0/g, " ") : "";
}

export const isMoneyAggregation = operation => ["sum", "average", "median", "min", "max", "range"].includes(operation);

export function reportedCurrency(workspace, property, source, visited = new Set()) {
  if (property?.type === "converted_amount") return currencyCode(property.config?.baseCurrency);
  if (property?.type !== "rollup" || !isMoneyAggregation(property.config?.aggregation) || visited.has(property)) return null;
  const target = resolveRollupTarget(workspace, property, source);
  if (!target) return null;
  visited.add(property);
  return reportedCurrency(workspace, target.property, target.source, visited);
}

export function currencyConfigIssue(source, config = {}) {
  if (!currencyCode(config.baseCurrency)) return "请输入有效的本位币代码";
  for (const { key, label, types } of currencyFields) {
    if (!source?.properties?.some(property => property.id === config[key] && types.includes(property.type))) return `请选择有效的${label}属性`;
  }
  if (config.amountPropertyId === config.ratePropertyId) return "手工汇率和原币金额需要不同的数字属性";
  return null;
}

const fxError = message => ({ error: { code: "FX", message } });
export const isCurrencyError = value => value?.error?.code === "FX";

function rowCurrency(source, item, currencyPropertyId) {
  const field = source?.properties?.find(property => property.id === currencyPropertyId);
  const raw = item.values?.[currencyPropertyId];
  return currencyCode(field?.type === "select" ? field.options?.find(option => option.id === raw)?.name : raw);
}

function numericInput(value) {
  if (typeof value === "number") return value;
  return typeof value === "string" && value.trim() ? Number(value) : NaN;
}

// Work with the decimal digits entered for the amount and quote. A binary
// multiplication can otherwise turn a half-cent (0.29 × 50.5) into 14.64499….
function decimalParts(value) {
  const [mantissa, exponent = "0"] = Math.abs(value).toString().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  return { units: BigInt(whole + fraction), exponent: Number(exponent) - fraction.length };
}

function roundedProduct(amount, rate, digits) {
  const left = decimalParts(amount);
  const right = decimalParts(rate);
  const product = left.units * right.units;
  const scale = left.exponent + right.exponent + digits;
  let minorUnits;
  if (scale >= 0) minorUnits = product * 10n ** BigInt(scale);
  else {
    const divisor = 10n ** BigInt(-scale);
    minorUnits = (product + divisor / 2n) / divisor;
  }
  const result = Number(`${minorUnits}e-${digits}`);
  return amount < 0 ? -result : result;
}

function validQuoteDate(value) {
  const stamp = typeof value === "string" ? value : value?.start;
  if (typeof stamp !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(stamp)) return false;
  const day = stamp.slice(0, 10);
  const midnight = Date.parse(day + "T00:00:00Z");
  return Number.isFinite(midnight) && new Date(midnight).toISOString().slice(0, 10) === day && Number.isFinite(Date.parse(stamp));
}

export function convertedAmount(source, item, config = {}) {
  const issue = currencyConfigIssue(source, config);
  if (issue) return fxError(issue);
  const raw = item?.values?.[config.amountPropertyId];
  if (raw == null || raw === "") return null;
  const amount = numericInput(raw);
  if (!Number.isFinite(amount)) return fxError("原币金额无效");
  const currency = rowCurrency(source, item, config.currencyPropertyId);
  if (!currency) return fxError("原币代码缺失或无效");
  const base = currencyCode(config.baseCurrency);
  if (currency === base) return amount;
  const rate = numericInput(item.values?.[config.ratePropertyId]);
  if (!Number.isFinite(rate) || rate <= 0) return fxError("请填写大于零的手工汇率");
  if (!validQuoteDate(item.values?.[config.rateDatePropertyId])) return fxError("请填写有效的汇率日期");
  const result = roundedProduct(amount, rate, currencyFormatter(base).digits);
  if (!Number.isFinite(result)) return fxError("折算金额超出数值范围");
  return result;
}

// A configured conversion identifies the original amount column and its currency.
// Ordinary number columns in legacy databases retain their existing behavior.
export function currencyAggregationIssue(source, property, items, values) {
  const failed = values.filter(isCurrencyError).length;
  if (failed) return fxError(`有 ${failed} 条记录的金额无法汇总，请检查原币、汇率及日期`);
  if (property?.type !== "number") return null;
  const bindings = source?.properties?.filter(field => field.type === "converted_amount" && field.config?.amountPropertyId === property.id) || [];
  for (const field of bindings) {
    let first = null;
    for (const item of items) {
      const amount = item?.values?.[property.id];
      if (amount == null || amount === "") continue;
      const currency = rowCurrency(source, item, field.config.currencyPropertyId);
      if (!currency) return fxError("原币代码缺失或无效，无法汇总原币金额");
      if (first && currency !== first) return fxError("原币金额包含多种货币，请选择折算金额汇总");
      first = currency;
    }
  }
  return null;
}
