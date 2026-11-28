import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const metadataPath = path.join(root, "node_modules", "@tabler", "icons", "icons.json");
const svgDir = path.join(root, "node_modules", "@tabler", "icons", "icons", "outline");
const outputRegistry = path.join(root, "src", "data", "iconRegistry.generated.js");
const outputSprite = path.join(root, "public", "icons", "tabler-picker-sprite.svg");

const categoryCaps = {
  System: 160, Devices: 80, Design: 90, Arrows: 90, Map: 70, Document: 90,
  Text: 45, Shapes: 70, Media: 65, "E-commerce": 50, Communication: 60,
  Food: 40, Buildings: 35, Vehicles: 40, Math: 35, Health: 40, Sport: 35,
  Development: 55, Weather: 45, Mood: 40, Photography: 35, Games: 35,
  Nature: 45, Computers: 40, Database: 35, Laundry: 20, Animals: 35,
  Business: 35, Education: 35, Energy: 30, Holidays: 25, Religion: 20,
  Science: 35, Security: 30, Shopping: 25, Time: 30, Users: 35
};

const categoryLabels = {
  System: "通用", Devices: "设备", Design: "设计", Arrows: "箭头", Map: "地图",
  Document: "文档", Text: "文本", Shapes: "形状", Media: "媒体", "E-commerce": "商业",
  Communication: "沟通", Food: "食物", Buildings: "建筑", Vehicles: "交通",
  Math: "数学", Health: "健康", Sport: "运动", Development: "开发", Weather: "天气",
  Mood: "表情", Photography: "摄影", Games: "游戏", Nature: "自然", Computers: "电脑",
  Database: "数据", Laundry: "家居", Animals: "动物", Business: "工作", Education: "学习",
  Energy: "能源", Holidays: "节日", Religion: "文化", Science: "科学", Security: "安全",
  Shopping: "购物", Time: "时间", Users: "人物"
};

const zhAliases = {
  activity: ["活动", "状态"], atom: ["原子", "科学", "物理", "化学"], award: ["奖章", "奖励"],
  book: ["书", "阅读", "学习"], "book-2": ["书", "阅读"], briefcase: ["工作", "公文包"],
  bulb: ["灵感", "灯泡", "想法"], calendar: ["日历", "计划"], camera: ["相机", "摄影"],
  chart: ["图表", "数据"], check: ["完成", "确认"], clock: ["时间", "时钟"],
  code: ["代码", "开发"], coffee: ["咖啡", "休息"], compass: ["指南针", "旅行"],
  cpu: ["芯片", "电脑", "技术"], database: ["数据库", "数据"], gamepad: ["游戏"],
  flask: ["实验", "化学", "科学"], folder: ["文件夹", "目录"], globe: ["地球", "世界"],
  heart: ["喜欢", "爱", "收藏"], home: ["主页", "家"], leaf: ["叶子", "自然"],
  link: ["链接"], map: ["地图", "旅行"], message: ["消息", "沟通"], moon: ["月亮", "夜晚"],
  music: ["音乐"], notes: ["笔记", "记录"], palette: ["设计", "配色"], plane: ["飞机", "旅行"],
  photo: ["图片", "照片"], rocket: ["火箭", "目标"], school: ["学校", "学习"],
  search: ["搜索", "查找"], settings: ["设置"], sparkles: ["灵感", "闪光"], star: ["星标", "收藏"],
  sun: ["太阳", "天气"], tag: ["标签"], target: ["目标"], tool: ["工具"], trophy: ["奖杯", "成就"],
  users: ["团队", "人物"], world: ["世界"], writing: ["写作", "文字"], bolt: ["闪电", "能量"],
  brain: ["大脑", "思考"], microscope: ["显微镜", "科学"], telescope: ["望远镜", "天文"],
  chemistry: ["化学"], dna: ["DNA", "生物"], plant: ["植物", "自然"], tree: ["树", "自然"],
  mountain: ["山", "自然"], beach: ["海滩", "旅行"], car: ["汽车", "交通"],
  train: ["火车", "交通"], ship: ["船", "交通"], wallet: ["钱包", "财务"],
  coin: ["钱", "财务"], currency: ["货币", "财务"], chart_bar: ["图表", "数据"],
};

function cleanLabel(name) {
  return name.split("-").map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(" ");
}

const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
const byCategory = new Map();
for (const item of Object.values(metadata)) {
  if (!item?.styles?.outline) continue;
  if (!Object.hasOwn(categoryCaps, item.category)) continue;
  if (/-off$/.test(item.name)) continue;
  if (/^(brand-|letter-|number-)/.test(item.name)) continue;
  const list = byCategory.get(item.category) ?? [];
  list.push(item);
  byCategory.set(item.category, list);
}

const required = new Set([
  "activity","atom","award","book-2","briefcase","bulb","calendar","camera","chart-bar",
  "check","clock","code","coffee","compass","cpu","database","device-gamepad-2","file-description",
  "flask","folder","globe","heart","home-2","leaf","link","map","message-circle","moon","music",
  "notes","palette","plane","photo","rocket","school","search","settings","sparkles","star","sun",
  "tag","target","tool","trophy","users","world","writing","bolt","brain","microscope","telescope"
]);

const selected = [];
const selectedNames = new Set();
for (const [category, cap] of Object.entries(categoryCaps)) {
  const list = (byCategory.get(category) ?? []).sort((a,b) => a.name.localeCompare(b.name));
  const forced = list.filter((item) => required.has(item.name));
  const rest = list.filter((item) => !required.has(item.name));
  for (const item of [...forced, ...rest].slice(0, cap)) {
    if (selectedNames.has(item.name)) continue;
    selectedNames.add(item.name);
    selected.push(item);
  }
}
for (const name of required) {
  if (selectedNames.has(name) || !metadata[name]?.styles?.outline) continue;
  selectedNames.add(name);
  selected.push(metadata[name]);
}

const registry = selected.map((item) => {
  const aliases = zhAliases[item.name] ?? zhAliases[item.name.replaceAll("-", "_")] ?? [];
  const tags = (item.tags ?? []).map(String).filter(Boolean).slice(0, 20);
  const categoryLabel = categoryLabels[item.category] ?? item.category;
  return {
    id: item.name,
    label: cleanLabel(item.name),
    category: item.category,
    categoryLabel,
    tags: [...new Set([...tags, ...aliases])],
    searchText: [item.name, cleanLabel(item.name), item.category, categoryLabel, ...tags, ...aliases].join(" ").toLocaleLowerCase()
  };
});

const categoryOrder = Object.keys(categoryCaps)
  .filter((id) => registry.some((item) => item.category === id))
  .map((id) => ({ id, label: categoryLabels[id] ?? id, count: registry.filter((item) => item.category === id).length }));

fs.mkdirSync(path.dirname(outputRegistry), { recursive: true });
fs.writeFileSync(outputRegistry,
  `// Generated by scripts/generate-icon-registry.mjs. Do not edit by hand.\n` +
  `export const iconRegistry = ${JSON.stringify(registry, null, 2)};\n` +
  `export const iconCategories = ${JSON.stringify(categoryOrder, null, 2)};\n` +
  `export const iconRegistryMeta = ${JSON.stringify({ count: registry.length, source: "@tabler/icons", version: "3.46.0", license: "MIT" }, null, 2)};\n`
);

const symbols = [];
for (const item of selected) {
  const svgPath = path.join(svgDir, `${item.name}.svg`);
  if (!fs.existsSync(svgPath)) continue;
  const source = fs.readFileSync(svgPath, "utf8");
  const inner = source.replace(/^<svg[\s\S]*?>/m, "").replace(/<\/svg>\s*$/m, "").trim();
  symbols.push(`<symbol id="ti-${item.name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</symbol>`);
}
fs.mkdirSync(path.dirname(outputSprite), { recursive: true });
fs.writeFileSync(outputSprite, `<svg xmlns="http://www.w3.org/2000/svg" style="display:none"><defs>${symbols.join("")}</defs></svg>`);
console.log(JSON.stringify({ icons: registry.length, categories: categoryOrder.length, spriteSymbols: symbols.length, registry: outputRegistry, sprite: outputSprite }, null, 2));
