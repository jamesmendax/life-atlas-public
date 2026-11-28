/**
 * Registry of Life Atlas official offline host-rendered Market widgets.
 * Every package ID here must also pass Ed25519 signature verification in main-process market service.
 */
export const OFFICIAL_HOST_WIDGET_MAP = {
  "life-atlas.pomodoro": {
    kind: "pomodoro",
    category: "专注效率",
    badge: "离线翻页计时",
    hint: "机械翻页倒计时、专注/短休息切换与音频提醒",
  },
  "life-atlas.travel-footprint": {
    kind: "travel-footprint",
    category: "旅行规划",
    badge: "逐城点亮足迹",
    hint: "在全国地图上逐城记录旅行。搜索城市或景点，打开当地手记，也可切换至日本和世界地图。",
  },
  "life-atlas.habit-heatmap": {
    kind: "habit-heatmap",
    category: "日常生活",
    badge: "26 周热力矩阵",
    hint: "GitHub 风格年度习惯坚持热力日历、多习惯打卡、连续天数与补卡记录",
  },
  "life-atlas.trip-itinerary": {
    kind: "trip-itinerary",
    category: "旅行规划",
    badge: "街道地图与分段行程",
    hint: "在地图上编排多日行程，查看已保存的真实道路与分段耗时。可按需联网查询驾车、骑行或步行路线，公交地铁可打开地图查看班次。",
  },
  "life-atlas.travel-packing": {
    kind: "travel-packing",
    category: "旅行规划",
    badge: "4 大出行场景",
    hint: "城市漫游 / 海岛度假 / 商务差旅 / 户外露营一键生成分类清单与重量进度环",
  },
  "life-atlas.world-clock": {
    kind: "world-clock",
    category: "日常生活",
    badge: "跨区时间旅行",
    hint: "多时区实时模拟表盘与时间偏移滑块，一键换算全球会议与出国时差",
  },
  "life-atlas.ambient-mixer": {
    kind: "ambient-mixer",
    category: "专注效率",
    badge: "WebAudio 纯离线合成",
    hint: "无需联网的细雨、森林、壁炉、咖啡馆、海浪 6 轨白噪音混音台与场景预设",
  },
  "life-atlas.life-countdown": {
    kind: "life-countdown",
    category: "日常生活",
    badge: "时光流逝 + 目标卡片",
    hint: "今年/本月/本周/今日实时进度条与多彩重要日程倒计时卡片",
  },
  "life-atlas.flashcard-quote": {
    kind: "flashcard-quote",
    category: "专注效率",
    badge: "3D 立体翻面记忆",
    hint: "3D 翻转学习闪卡与每日金句，支持不熟/模糊/掌握分级与自定义卡片",
  },
};

export function getOfficialHostWidgetMeta(packageId) {
  return (packageId && OFFICIAL_HOST_WIDGET_MAP[packageId]) || null;
}

export function getOfficialHostWidgetKind(packageId) {
  return getOfficialHostWidgetMeta(packageId)?.kind ?? null;
}
