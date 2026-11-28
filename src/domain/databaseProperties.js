import { copyJson } from "./blockDocument.js";
import { formatComputedNumber, formatNumber } from "./numberFormat.js";
import { formatCurrencyAmount, isCurrencyError, reportedCurrency } from "./currencyConversion.js";
import { isDateRollupAggregation, isListRollupAggregation, isPercentRollupAggregation, resolveRollupTarget } from "./rollupConfiguration.js";

export const PROPERTY_LABELS = Object.freeze({
  converted_amount: "折算金额",
  title: "名称", text: "文本", number: "数字", select: "单选", multi_select: "多选", status: "状态",
  date: "日期", checkbox: "复选框", people: "人员", url: "URL", email: "电子邮件", phone: "电话",
  files: "文件和媒体", place: "地点", relation: "关联", rollup: "汇总", button: "按钮", formula: "公式", id: "内部 ID",
  created_time: "创建时间", modified_time: "上次编辑时间", unique_id: "ID", created_by: "创建者", last_edited_by: "最后编辑者",
});
export const READ_ONLY_PROPERTY_TYPES = ["button", "converted_amount", "formula", "rollup", "id", "created_time", "modified_time", "unique_id", "created_by", "last_edited_by"];
export const DEFAULT_FILE_PROPERTY_LIMIT_MB = 25;

export function filePropertyIssue(file, config = {}) {
  if (file.provider === "external") return null;
  const configured = Number(config?.maxSizeMb);
  const limit = configured > 0 && Number.isFinite(configured) ? configured : DEFAULT_FILE_PROPERTY_LIMIT_MB;
  if (Number.isFinite(file.size) && file.size > limit * 1024 * 1024) return `「${file.name}」超过此属性的单文件上限（${limit} MB）。`;
  const accepts = String(config?.accept || "").toLowerCase().split(",").map(entry => entry.trim()).filter(Boolean);
  const name = String(file.name || "").toLowerCase();
  const mime = String(file.type || file.mime || "").toLowerCase().split(";")[0].trim();
  const matches = accepts.some(entry => {
    if (entry === "*/*") return true;
    if (entry.startsWith(".")) return name.endsWith(entry);
    if (entry.endsWith("/*")) return mime.startsWith(entry.slice(0, -1));
    return mime === entry;
  });
  return accepts.length && !matches ? `「${file.name}」不符合此属性允许的文件类型（${config.accept}）。` : null;
}

export function normalizeIdValues(value) {
  return [...new Set((Array.isArray(value) ? value : value ? [value] : []).filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()))];
}

export function normalizeDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return { start: value.trim(), end: null, includeTime: false, timeZone: null };
  if (typeof value !== "object" || !value.start) return null;
  return { ...copyJson(value), start: String(value.start), end: value.end ? String(value.end) : null, includeTime: Boolean(value.includeTime), timeZone: value.timeZone ? String(value.timeZone) : null };
}

export function normalizePropertyValue(propertyOrType, value) {
  const type = typeof propertyOrType === "string" ? propertyOrType : propertyOrType?.type;
  if (["people", "files", "multi_select", "relation"].includes(type)) return normalizeIdValues(value);
  if (type === "date") return normalizeDate(value);
  if (type === "checkbox") return value === true || value === "true" || value === 1;
  if (type === "number") return value === "" || value == null || !Number.isFinite(Number(value)) ? null : Number(value);
  if (type === "place") {
    if (!value || typeof value !== "object") return null;
    const result = { ...copyJson(value) };
    for (const key of ["name", "address", "providerId"]) {
      if (value[key] != null) result[key] = String(value[key]).trim();
    }
    for (const [key, bound] of [["latitude", 90], ["longitude", 180]]) {
      if (value[key] === "" || value[key] == null) delete result[key];
      else if (Number.isFinite(Number(value[key])) && Math.abs(Number(value[key])) <= bound) result[key] = Number(value[key]);
      else delete result[key];
    }
    return Object.values(result).some((entry) => entry !== "" && entry != null) ? result : null;
  }
  if (["url", "email", "phone", "select", "status"].includes(type)) return value == null || String(value).trim() === "" ? null : String(value).trim();
  return copyJson(value);
}

export function isEmptyProperty(value) {
  if (value == null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return "start" in value ? !value.start : Object.keys(value).length === 0;
  return false;
}

export function safePropertyHref(type, value) {
  if (!value) return null;
  const text = String(value).trim();
  if (/[\r\n]/.test(text)) return null;
  if (type === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? `mailto:${encodeURIComponent(text).replace(/%40/gi, "@")}` : null;
  if (type === "phone") return /^[+()\d\s.-]{3,}$/.test(text) ? `tel:${text.replace(/[^+\d]/g, "")}` : null;
  try {
    const url = new URL(text);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function normalizeDateTimeZone(zone) {
  if (typeof zone !== "string") return zone;
  const trimmed = zone.trim();
  const offset = /^UTC([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(trimmed);
  if (!offset) return trimmed;
  const [, sign, hours, minutes = "00"] = offset;
  if (Number(hours) > 23 || Number(minutes) > 59) return trimmed;
  return sign + hours.padStart(2, "0") + ":" + minutes;
}

export function dateMillis(value) {
  const date = normalizeDate(value);
  if (!date?.start) return NaN;
  const raw = date.start;
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(raw)) return NaN;
  if (!date.includeTime || raw.length === 10) return Date.parse(`${raw.slice(0, 10)}T00:00:00Z`);
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) return Date.parse(raw);
  const wall = Date.parse(`${raw}Z`);
  if (!date.timeZone || !Number.isFinite(wall)) return wall;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: normalizeDateTimeZone(date.timeZone), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    let instant = wall;
    for (let pass = 0; pass < 3; pass++) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
      const displayed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
      const next = wall - (displayed - instant);
      if (next === instant) break;
      instant = next;
    }
    return instant;
  } catch { return NaN; }
}

export function validatePropertyValue(property, value) {
  if (isEmptyProperty(value)) return null;
  if (["url", "email", "phone"].includes(property.type) && !safePropertyHref(property.type, value)) return `请输入有效的${PROPERTY_LABELS[property.type]}`;
  if (property.type === "date") {
    const date = normalizeDate(value);
    if (!Number.isFinite(dateMillis(date))) return "日期格式或时区无效";
    if (date.end && dateMillis({ ...date, start: date.end }) < dateMillis(date)) return "结束时间不能早于开始时间";
  }
  if (property.type === "place") {
    if (value.latitude != null && (!Number.isFinite(Number(value.latitude)) || Math.abs(Number(value.latitude)) > 90)) return "纬度须在 -90 到 90 之间";
    if (value.longitude != null && (!Number.isFinite(Number(value.longitude)) || Math.abs(Number(value.longitude)) > 180)) return "经度须在 -180 到 180 之间";
  }
  return null;
}

export function formatDisplayPropertyValue(workspace, property, value, source) {
  return formatPropertyValue(workspace, property, value, { computedNumberDisplay: true, source });
}

export function formatOriginalRollupChoices(workspace, property, value, source) {
  if (property?.type !== "rollup" || !Array.isArray(value)) return null;
  const aggregation = property.config?.aggregation;
  if (!isListRollupAggregation(aggregation)) return null;
  const target = resolveRollupTarget(workspace, property, source)?.property;
  const type = target?.type;
  if (aggregation === "show_unique" && ["multi_select", "people", "files", "relation"].includes(type)) {
    return formatPropertyValue(workspace, target, value);
  }
  if (!["select", "status", "multi_select", "relation"].includes(type)) return null;
  return value.map(entry => formatPropertyValue(workspace, target, entry)).filter(Boolean).join(", ");
}

export function formatPropertyValue(workspace, property, value, { computedNumberDisplay = false, source } = {}) {
  if (value?.error) return `${value.error.code || "ERROR"}: ${value.error.message || "计算失败"}`;
  if (isEmptyProperty(value)) return "";
  const type = property?.type;
  const computed = type === "formula" || type === "rollup";
  if (typeof value === "number" && (type === "converted_amount" || type === "rollup")) {
    const currency = reportedCurrency(workspace, property, source);
    if (currency) return formatCurrencyAmount(value, currency);
  }
  const numberFormat = property?.config?.numberFormat;
  if (typeof value === "number" && numberFormat && (computed || type === "number")) {
    return computedNumberDisplay && computed ? formatComputedNumber(value, numberFormat) : formatNumber(value, numberFormat);
  }
  if (type === "unique_id") return property.config?.prefix ? `${property.config.prefix}-${value}` : String(value);
  if (["created_by", "last_edited_by"].includes(type)) return "我";
  if (type === "rollup" && isPercentRollupAggregation(property.config?.aggregation)) return typeof value === "number" ? `${Math.round(value * 100)}%` : "";
  if (type === "rollup" && property.config?.aggregation === "date_range") {
    const date = normalizeDate(value);
    return date ? `${date.start.slice(0, 10)} → ${(date.end || date.start).slice(0, 10)}` : "";
  }
  if (type === "rollup" && Array.isArray(value)) {
    const labels = formatOriginalRollupChoices(workspace, property, value, source);
    if (labels !== null) return labels;
  }
  if (computedNumberDisplay && computed && typeof value === "number") return formatComputedNumber(value);
  if (type === "checkbox") return value ? "✓" : "";
  if (["select", "status"].includes(type)) return property.options?.find((option) => option.id === value)?.name ?? String(value);
  if (type === "multi_select") return normalizeIdValues(value).map((id) => property.options?.find((option) => option.id === id)?.name ?? id).join(", ");
  if (type === "people") return normalizeIdValues(value).map((id) => workspace?.people?.find((person) => person.id === id)?.displayName || "未知成员").join(", ");
  if (type === "files") return normalizeIdValues(value).map((id) => workspace?.attachments?.find((file) => file.id === id)?.name || "不可用附件").join(", ");
  if (type === "place") return [value.name, value.address, value.latitude != null && value.longitude != null ? `${value.latitude}, ${value.longitude}` : null].filter(Boolean).join(" · ");
  const dateValue = typeof value?.start === "string";
  if (type === "date" || (type === "rollup" && (dateValue || isDateRollupAggregation(property.config?.aggregation)))) {
    const date = normalizeDate(value);
    return date ? `${date.start.replace("T", " ")}${date.end ? ` → ${date.end.replace("T", " ")}` : ""}${date.includeTime && date.timeZone ? ` (${date.timeZone})` : ""}` : "";
  }
  if (type === "relation") return normalizeIdValues(value).filter((id) => {
    const item = workspace?.databaseItems?.find((entry) => entry.id === id);
    return item && !workspace?.pages?.find((page) => page.id === item.pageId)?.trashedAt;
  }).map((id) => {
    const item = workspace?.databaseItems?.find((entry) => entry.id === id);
    const source = workspace?.dataSources?.find((entry) => entry.id === item?.sourceId);
    const titleId = source?.properties?.find((entry) => entry.type === "title")?.id;
    return item?.values?.[titleId] || workspace?.pages?.find((page) => page.id === item?.pageId)?.title || "不可用记录";
  }).join(", ");
  if (type === "formula" && dateValue) return formatDateLabel(value, { showTimeZone: true });
  if (Array.isArray(value)) return value.map((entry) => {
    if (computed && (typeof entry?.start === "string" || Array.isArray(entry))) return formatPropertyValue(workspace, property, entry, { computedNumberDisplay, source });
    return typeof entry === "object" ? entry?.name || entry?.start || JSON.stringify(entry) : String(entry);
  }).join(", ");
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function formatDateLabel(value, { showTimeZone = false } = {}) {
  const date = normalizeDate(value);
  if (!date?.start) return "";
  const zone = showTimeZone && date.includeTime ? date.timeZone : null;
  const label = (text) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2})(:\d{2}(?:\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})?)?/.exec(text);
    if (!match) return text;
    const [, year, month, day, clock, seconds = "", offset] = match;
    const calendarDate = `${Number(year)}年${Number(month)}月${Number(day)}日`;
    if (!clock) return calendarDate;
    const offsetLabel = offset?.toUpperCase() === "Z" ? "UTC" : offset && `UTC${offset}`;
    const zoneSuffix = showTimeZone && offsetLabel && normalizeDateTimeZone(offsetLabel) !== normalizeDateTimeZone(zone) ? ` ${offsetLabel}` : "";
    return `${calendarDate} ${clock}${showTimeZone ? seconds : ""}${zoneSuffix}`;
  };
  return `${label(date.start)}${date.end ? ` → ${label(date.end)}` : ""}${zone ? ` (${zone})` : ""}`;
}

export const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function calendarDays(anchor, startOfWeek = 1, mode = "month") {
  const anchorDay = String(anchor).slice(0, 10);
  const anchorMs = Date.parse(`${anchorDay}T00:00:00Z`);
  if (!Number.isFinite(anchorMs) || new Date(anchorMs).toISOString().slice(0, 10) !== anchorDay) return [];
  const beginning = startOfWeek === 0 ? 0 : 1;
  const monthFirst = new Date(anchorMs);
  monthFirst.setUTCDate(1);
  const first = mode === "week" ? anchorMs : monthFirst.getTime();
  const start = first - ((new Date(first).getUTCDay() - beginning + 7) % 7) * 86400000;
  const monthLast = new Date(first);
  if (mode !== "week") { monthLast.setUTCMonth(monthLast.getUTCMonth() + 1); monthLast.setUTCDate(0); }
  const last = mode === "week" ? first : monthLast.getTime();
  const count = mode === "week" ? 7 : Math.ceil(((last - start) / 86400000 + 1) / 7) * 7;
  return Array.from({ length: count }, (_, index) => new Date(start + index * 86400000).toISOString().slice(0, 10));
}

export function comparablePropertyValue(workspace, property, value) {
  if (isCurrencyError(value) || property?.type === "converted_amount" && !Number.isFinite(value)) return null;
  if (isEmptyProperty(value)) return null;
  if (property?.type === "date" || (["formula", "rollup"].includes(property?.type) && typeof value?.start === "string")) {
    const instant = dateMillis(value);
    return Number.isFinite(instant) ? instant : null;
  }
  if (typeof value === "number" || typeof value === "boolean") return Number(value);
  return formatPropertyValue(workspace, property, value).trim().toLocaleLowerCase() || null;
}

export function mentionLabel(mention, workspace) {
  const props = mention?.props || {};
  if (mention?.type === "pageMention") {
    const page = workspace?.pages?.find((entry) => entry.id === props.pageId);
    if (!page) return "已删除的页面";
    const title = page.title || "无标题页面";
    return page.trashedAt ? `${title}（在回收站）` : title;
  }
  if (mention?.type === "userMention") return `@${workspace?.people?.find((person) => person.id === props.personId)?.displayName || props.labelSnapshot || "未知成员"}`;
  if (mention?.type === "dateMention") return props.value || "未设置日期";
  return "";
}

export function inlineSemanticText(content, workspace) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((entry) => typeof entry === "string" ? entry : mentionLabel(entry, workspace) || entry?.text || inlineSemanticText(entry?.content, workspace)).join("");
}
