import { copyJson } from "./blockDocument.js";
import { ROADMAP_DEFAULTS, ROADMAP_MARKERS, ROADMAP_ZOOMS } from "./roadmapLayout.js";
import { CHART_AXIS_LABELS, DONUT_SECTOR_LABELS } from "./chartLabels.js";

export const CALCULATIONS = Object.freeze({
  none: "不计算", count_all: "全部计数", count_values: "值计数", count_unique: "唯一值计数",
  count_empty: "空值计数", count_not_empty: "非空值计数", percent_empty: "空值百分比", percent_not_empty: "非空值百分比",
  sum: "求和", average: "平均值", median: "中位数", min: "最小值", max: "最大值", range: "范围",
  earliest: "最早日期", latest: "最晚日期", date_range: "日期范围",
  checked: "已勾选", unchecked: "未勾选", percent_checked: "已勾选百分比", percent_unchecked: "未勾选百分比",
});

export const VIEW_REGISTRY = Object.freeze({
  table: { label: "表格", description: "逐行编辑所有属性" },
  board: { label: "看板", description: "按属性组织卡片" },
  list: { label: "列表", description: "紧凑的记录列表" },
  gallery: { label: "画廊", description: "带内容预览的卡片" },
  calendar: { label: "日历", description: "按日期安排记录" },
  timeline: { label: "时间线", description: "查看开始与结束日期" },
  chart: { label: "图表", description: "分组、聚合与可视化" },
  form: { label: "表单", description: "收集答卷并保存为数据库记录" },
  dashboard: { label: "仪表盘", description: "跨库组合视图、指标和图表" },
  map: { label: "地图", description: "显示地点与可访问的地点列表" },
  roadmap: { label: "时间脉络", description: "像幻灯片一样按时间展示里程碑和阶段" },
  feed: { label: "动态", description: "连续阅读记录正文并参与页面讨论" },
});
export const VIEW_TYPES = Object.keys(VIEW_REGISTRY);
export const CHART_KINDS = ["column", "bar", "line", "donut", "number"];
export const AGGREGATIONS = ["count", "sum", "average", "min", "max"];

export function suggestedChart(source) {
  const properties = source?.properties || [];
  const category = properties.find(property => property.type === "status") || properties.find(property => property.type === "select");
  return category
    ? { kind: "donut", aggregation: "count", xPropertyId: category.id }
    : { kind: "number", aggregation: "count" };
}

// Apply source-aware suggestions on creation. Loading a saved view still uses its own configuration.
export function initialViewConfig(type, source, config = {}) {
  if (type === "roadmap" && !config.roadmap) {
    return { ...config, roadmap: { datePropertyId: source?.properties.find(property => property.type === "date")?.id ?? null } };
  }
  if (type === "chart" && !config.chart && !config.chartType && !config.valuePropertyId) {
    return { ...config, chart: suggestedChart(source) };
  }
  if (type !== "dashboard" || Array.isArray(config.dashboard?.widgets)) return config;
  return { ...config, dashboard: { ...config.dashboard, widgets: [] } };
}

export function listVisiblePropertyIds(source, view) {
  const title = source.properties.find((property) => property.type === "title");
  const secondary = source.properties.find((property) => property.type === "status" || property.type === "select");
  const selected = Array.isArray(view.visiblePropertyIds) ? view.visiblePropertyIds : secondary ? [secondary.id] : [];
  return [...new Set([...(title ? [title.id] : []), ...selected])];
}

export function normalizeViewConfig(type, input = {}) {
  const config = input && typeof input === "object" && !Array.isArray(input) ? copyJson(input) : {};
  if (config.openRecordsIn !== undefined) config.openRecordsIn = ["page", "side"].includes(config.openRecordsIn) ? config.openRecordsIn : "peek";
  if (config.showDataSourceTitle !== undefined) config.showDataSourceTitle = Boolean(config.showDataSourceTitle);
  if (config.showPageIcon !== undefined) config.showPageIcon = Boolean(config.showPageIcon);
  if (type === "board" && Object.hasOwn(config, "board")) {
    const value = config.board && typeof config.board === "object" && !Array.isArray(config.board) ? config.board : {};
    const board = { ...value };
    if (Object.hasOwn(value, "colorColumns")) board.colorColumns = Boolean(value.colorColumns);
    if (Object.hasOwn(value, "wrapAllContent")) board.wrapAllContent = Boolean(value.wrapAllContent);
    config.board = board;
  }
  if (type === "table" && Object.hasOwn(config, "table")) {
    const value = config.table && typeof config.table === "object" && !Array.isArray(config.table) ? config.table : {};
    const widths = value.columnWidths && typeof value.columnWidths === "object" && !Array.isArray(value.columnWidths) ? value.columnWidths : {};
    const calculations = value.calculations && typeof value.calculations === "object" && !Array.isArray(value.calculations) ? value.calculations : {};
    config.table = {
      ...value,
      columnWidths: Object.fromEntries(Object.entries(widths).filter(([, width]) => typeof width === "number" && Number.isFinite(width)).map(([propertyId, width]) => [propertyId, Math.max(80, Math.min(800, Math.round(width)))])),
      wrapPropertyIds: Array.isArray(value.wrapPropertyIds) ? [...new Set(value.wrapPropertyIds.filter((propertyId) => typeof propertyId === "string"))] : [],
      calculations: Object.fromEntries(Object.entries(calculations).filter(([, calculation]) => Object.hasOwn(CALCULATIONS, calculation))),
    };
  }
  if (type === "roadmap") {
    const value = config.roadmap && typeof config.roadmap === "object" && !Array.isArray(config.roadmap) ? config.roadmap : {};
    const markers = value.markerMap && typeof value.markerMap === "object" && !Array.isArray(value.markerMap) ? value.markerMap : {};
    config.roadmap = {
      ...ROADMAP_DEFAULTS,
      ...value,
      scale: ["auto", "week", "month", "quarter", "year"].includes(value.scale) ? value.scale : "auto",
      density: ["comfortable", "compact"].includes(value.density) ? value.density : "comfortable",
      zoom: ROADMAP_ZOOMS.includes(value.zoom) ? value.zoom : 1,
      showToday: value.showToday !== false,
      markerMap: Object.fromEntries(Object.entries(markers).filter(([, marker]) => ROADMAP_MARKERS.includes(marker))),
    };
  }
  // Keep unrelated/unknown metadata for forward compatibility. Only the selected
  // discriminant is interpreted by its renderer and shown in its settings UI.
  if (type === "chart") {
    const value = config.chart || {};
    config.chart = {
      ...value,
      kind: CHART_KINDS.includes(value.kind || config.chartType) ? value.kind || config.chartType : "bar",
      xPropertyId: value.xPropertyId || null,
      valuePropertyId: value.valuePropertyId || config.valuePropertyId || null,
      groupPropertyId: value.groupPropertyId || null,
      aggregation: AGGREGATIONS.includes(value.aggregation) ? value.aggregation : value.valuePropertyId || config.valuePropertyId ? "sum" : "count",
      ...(Object.hasOwn(value, "axisTitles") ? { axisTitles: typeof value.axisTitles === "string" && Object.hasOwn(CHART_AXIS_LABELS, value.axisTitles) ? value.axisTitles : "none" } : {}),
      ...(Object.hasOwn(value, "donutLabels") ? { donutLabels: typeof value.donutLabels === "string" && Object.hasOwn(DONUT_SECTOR_LABELS, value.donutLabels) ? value.donutLabels : "none" } : {}),
    };
  }
  if (type === "form") {
    const value = config.form || {};
    config.form = {
      ...value, title: value.title || "新增记录", description: value.description || "",
      fields: Array.isArray(value.fields) ? value.fields.map((field) => ({ ...field, required: Boolean(field.required), hidden: Boolean(field.hidden) })) : [],
      open: value.open !== false, anonymous: value.anonymous !== false,
      successMessage: value.successMessage || "记录已保存到本地数据库。",
    };
  }
  if (type === "dashboard") {
    const value = config.dashboard || {};
    config.dashboard = {
      ...value,
      widgets: Array.isArray(value.widgets) ? value.widgets : [
        { id: "records", type: "metric", title: "总记录", aggregation: "count", size: "small" },
        { id: "chart", type: "chart", title: "记录分布", size: "wide", chart: { kind: "bar", aggregation: "count" } },
        { id: "list", type: "list", title: "记录", size: "wide", limit: 8 },
      ],
      globalFilters: Array.isArray(value.globalFilters) ? value.globalFilters : [],
    };
  }
  if (type === "map") {
    const value = config.map || {};
    const relationPropertyId = typeof value.relationPropertyId === "string" ? value.relationPropertyId || null : null;
    config.map = {
      ...value, placePropertyId: value.placePropertyId || null, labelPropertyId: value.labelPropertyId || null,
      relationPropertyId,
      relatedPlacePropertyId: relationPropertyId && typeof value.relatedPlacePropertyId === "string" ? value.relatedPlacePropertyId || null : null,
      zoom: Math.max(1, Math.min(12, Number(value.zoom) || 1)),
      center: Array.isArray(value.center) && value.center.length === 2 && value.center.every(Number.isFinite) ? value.center : [0, 0],
    };
  }
  if (type === "calendar") {
    const value = config.calendar || {};
    config.calendar = {
      ...value,
      datePropertyId: value.datePropertyId || null,
      mode: ["month", "week"].includes(value.mode) ? value.mode : "month",
      showWeekends: value.showWeekends !== false,
      startOfWeek: Number(value.startOfWeek) === 0 ? 0 : 1,
      anchorDate: /^\d{4}-\d{2}-\d{2}$/.test(value.anchorDate || "") ? value.anchorDate : null,
    };
  }
  if (type === "timeline") {
    const value = config.timeline || {};
    config.timeline = {
      ...value,
      datePropertyId: value.datePropertyId || null,
      endDatePropertyId: value.endDatePropertyId || null,
      scale: ["hour", "day", "week", "month", "quarter", "year"].includes(value.scale) ? value.scale : "week",
      windowStart: /^\d{4}-\d{2}-\d{2}$/.test(value.windowStart || "") ? value.windowStart : null,
      windowEnd: /^\d{4}-\d{2}-\d{2}$/.test(value.windowEnd || "") ? value.windowEnd : null,
      showToday: value.showToday !== false,
    };
  }
  if (type === "gallery") {
    const value = config.gallery || {};
    const preview = value.preview && typeof value.preview === "object" ? value.preview : {};
    config.gallery = {
      ...value,
      preview: {
        ...preview,
        kind: ["page-cover", "page-content", "files-property", "none"].includes(preview.kind) ? preview.kind : "page-content",
        propertyId: preview.propertyId || null,
      },
      cardSize: ["small", "medium", "large"].includes(value.cardSize) ? value.cardSize : "medium",
      imageFit: ["cover", "contain"].includes(value.imageFit) ? value.imageFit : "cover",
      visiblePropertyIds: Array.isArray(value.visiblePropertyIds) ? value.visiblePropertyIds : [],
    };
  }
  return config;
}
