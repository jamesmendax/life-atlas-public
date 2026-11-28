#!/usr/bin/env node
// 总设计师提供的工具（WP-20 使用，之后每个 WP 的 wp-check K13 也用它检查，不要修改）。
// 把 src/**/*.css 里写死的颜色换成主题变量，并生成 src/ui/theme-tokens.css（深色值 = 原来的颜色，浅色值 = 按固定规则换算）。
// 用法：
//   node docs/blueprint/tools/theme-tokens.mjs            只检查，写报告，不改 CSS
//   node docs/blueprint/tools/theme-tokens.mjs --write    改写 CSS 并生成 src/ui/theme-tokens.css
//   可选：--root <项目目录>（默认当前目录）  --report <报告文件>（默认 .qa/WP-17/theme-tokens-report.md）
// 换算规则（浅色）：保持色相和饱和度，只换算 HSL 亮度 L：v = L × 255；v ≤ 64 时 v' = 255 − (v − 25) × 0.55（深色背景 → 接近白色），
//   否则 v' = 289 − 1.12 × v（浅色文字 → 深色文字）；结果限制在 0–255。纯白半透明叠加层用 --la-ink-rgb，纯黑半透明阴影用 --la-shade-rgb。
// 不改的地方：注释、引号里的字符串、url(...)、选择器里含 data-theme 或 prefers-color-scheme 的规则块、
//   内容颜色的规则块（选择器含 .color-*、.page-cover-*、.cover-choice-* 或 [data-color…]：文件夹颜色、封面、选项颜色在两种主题里保持一样）、
//   带 theme-keep 注释的那一行。
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const write = args.includes("--write");
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const root = path.resolve(option("--root", process.cwd()));
const reportPath = path.resolve(root, option("--report", ".qa/WP-20/theme-tokens-report.md"));
const tokensPath = path.join(root, "src", "ui", "theme-tokens.css");

function listFiles(dir, extensions) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      out.push(...listFiles(full, extensions));
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) out.push(full);
  }
  return out.sort();
}

const hex2 = (value) => Math.round(value).toString(16).padStart(2, "0");
const hex6 = ({ r, g, b }) => `${hex2(r)}${hex2(g)}${hex2(b)}`;
const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));

function lightValue(v) {
  return clamp(v <= 64 ? 255 - (v - 25) * 0.55 : 289 - 1.12 * v);
}

function rgbToHsl({ r, g, b }) {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === red) h = (green - blue) / d + (green < blue ? 6 : 0);
  else if (max === green) h = (blue - red) / d + 2;
  else h = (red - green) / d + 4;
  return { h: h / 6, s, l };
}

function hslToRgb({ h, s, l }) {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return { r: hue(p, q, h + 1 / 3) * 255, g: hue(p, q, h) * 255, b: hue(p, q, h - 1 / 3) * 255 };
}

export function lightColor(rgb) {
  if (rgb.r === rgb.g && rgb.g === rgb.b) {
    const v = lightValue(rgb.r);
    return { r: v, g: v, b: v };
  }
  const hsl = rgbToHsl(rgb);
  const mapped = hslToRgb({ ...hsl, l: lightValue(hsl.l * 255) / 255 });
  return { r: clamp(mapped.r), g: clamp(mapped.g), b: clamp(mapped.b) };
}

const CONTENT_SELECTOR = /\.(?:color|page-cover|cover-choice)-[a-z0-9-]+|\[data-color[\]=~|^$*]/i;

const COLOR_PATTERN = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([0-9]*\.?[0-9]+%?)\s*)?\)|#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{3}\b|(?<![-\w])(?:white|black)(?![-\w])|\b(?:hsla?|hwb|lab|lch|oklab|oklch)\([^)]*\)/g;

function parseColor(match, r, g, b, alpha) {
  if (r !== undefined) {
    const rgb = { r: Number(r), g: Number(g), b: Number(b) };
    if ([rgb.r, rgb.g, rgb.b].some((value) => value > 255)) return null;
    let a = 1;
    if (alpha !== undefined) a = alpha.endsWith("%") ? Number(alpha.slice(0, -1)) / 100 : Number(alpha);
    return { rgb, alpha: a, alphaText: alpha };
  }
  if (match === "white") return { rgb: { r: 255, g: 255, b: 255 }, alpha: 1 };
  if (match === "black") return { rgb: { r: 0, g: 0, b: 0 }, alpha: 1 };
  if (match.startsWith("#")) {
    let hex = match.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((char) => char + char).join("");
    const rgb = { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { rgb, alpha: a, alphaText: hex.length === 8 ? String(Math.round(a * 1000) / 1000) : undefined };
  }
  return null;
}

const usedSolid = new Map();   // name → rgb
const usedTriples = new Map(); // name → rgb

function tokenFor(color) {
  const { rgb, alpha, alphaText } = color;
  const isGray = rgb.r === rgb.g && rgb.g === rgb.b;
  const name = isGray ? `gray-${hex2(rgb.r)}` : `c-${hex6(rgb)}`;
  if (alpha >= 1 && alphaText === undefined) {
    usedSolid.set(name, rgb);
    return `var(--la-${name})`;
  }
  if (isGray && rgb.r === 255) return `rgba(var(--la-ink-rgb), ${alphaText ?? alpha})`;
  if (isGray && rgb.r === 0) return `rgba(var(--la-shade-rgb), calc(${alphaText ?? alpha} * var(--la-shade-strength)))`;
  usedTriples.set(name, rgb);
  return `rgba(var(--la-${name}-rgb), ${alphaText ?? alpha})`;
}

function rewriteValue(value, onLeftover) {
  return value.replace(COLOR_PATTERN, (match, r, g, b, alpha) => {
    const color = parseColor(match, r, g, b, alpha);
    if (!color) {
      onLeftover(match);
      return match;
    }
    return tokenFor(color);
  });
}

function rewriteCss(text, file, leftovers) {
  let out = "";
  let i = 0;
  let line = 1;
  const stack = [];
  let buffer = "";
  let replaced = 0;
  // Theme-specific blocks are already written for one theme; content colors (folder colors, page covers,
  // option colors) must look the same in both themes. Neither kind is rewritten.
  const skipped = () => stack.some((selector) => /data-theme|prefers-color-scheme/i.test(selector) || CONTENT_SELECTOR.test(selector));
  const flush = (terminator) => {
    const startLine = line - (buffer.match(/\n/g) || []).length;
    const colon = buffer.indexOf(":");
    const isDeclaration = terminator !== "{" && colon > 0 && stack.length > 0;
    if (isDeclaration && !skipped()) {
      const property = buffer.slice(0, colon);
      const value = buffer.slice(colon);
      const parts = value.split("\n").map((part, offset) => {
        if (part.includes("theme-keep")) return part;
        const report = (literal) => leftovers.push({ file, line: startLine + offset, literal, property: property.replace(/\/\*[\s\S]*?\*\//g, "").trim() });
        return part.split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|url\([^)]*\)|\/\*[\s\S]*?\*\/)/g)
          .map((segment, index) => {
            if (index % 2 === 1) return segment;
            const next = rewriteValue(segment, report);
            if (next !== segment) replaced += (segment.match(COLOR_PATTERN) || []).length - (next.match(COLOR_PATTERN) || []).length;
            return next;
          })
          .join("");
      });
      out += property + parts.join("\n");
    } else {
      out += buffer;
    }
    buffer = "";
  };
  while (i < text.length) {
    const char = text[i];
    if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const comment = end < 0 ? text.slice(i) : text.slice(i, end + 2);
      buffer += comment;
      line += (comment.match(/\n/g) || []).length;
      i += comment.length;
      continue;
    }
    if (char === '"' || char === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== char) { if (text[j] === "\\") j++; j++; }
      const literal = text.slice(i, j + 1);
      buffer += literal;
      line += (literal.match(/\n/g) || []).length;
      i = j + 1;
      continue;
    }
    if (char === "{") {
      stack.push(buffer.replace(/\/\*[\s\S]*?\*\//g, "").trim());
      flush("{");
      out += char;
      i++;
      continue;
    }
    if (char === "}") {
      flush("}");
      stack.pop();
      out += char;
      i++;
      continue;
    }
    if (char === ";") {
      flush(";");
      out += char;
      i++;
      continue;
    }
    if (char === "\n") line++;
    buffer += char;
    i++;
  }
  flush("}");
  return { text: out, replaced };
}

// 不处理的目录：密钥库窗口（src/vault-ui）和首次启动向导（src/setup-ui）有自己的一小份样式表（12 第 2 节）；
// 主题目录（src/ui/themes，WP-20 起）本来就是定义颜色的地方。
const FIXED_LOOK_DIRS = ["vault-ui", "setup-ui", path.join("ui", "themes")].map((name) => path.join(root, "src", name) + path.sep);
const cssFiles = listFiles(path.join(root, "src"), [".css"])
  .filter((file) => path.resolve(file) !== path.resolve(tokensPath))
  .filter((file) => !FIXED_LOOK_DIRS.some((dir) => path.resolve(file).startsWith(dir)));
const leftovers = [];
const fileStats = [];
const rewritten = new Map();
for (const file of cssFiles) {
  const original = fs.readFileSync(file, "utf8");
  const { text, replaced } = rewriteCss(original, path.relative(root, file), leftovers);
  fileStats.push({ file: path.relative(root, file), replaced });
  rewritten.set(file, text);
}

// Collect every token referenced by the (rewritten) CSS so that re-running keeps the tokens file complete.
for (const text of rewritten.values()) {
  for (const match of text.matchAll(/var\(--la-(gray-[0-9a-f]{2}|c-[0-9a-f]{6})(-rgb)?\)/g)) {
    const name = match[1];
    const hex = name.startsWith("gray-") ? name.slice(5).repeat(3) : name.slice(2);
    const rgb = { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
    (match[2] ? usedTriples : usedSolid).set(name, rgb);
  }
}
const sortNames = (map) => [...map.keys()].sort();
const triple = ({ r, g, b }) => `${clamp(r)}, ${clamp(g)}, ${clamp(b)}`;
const solid = (rgb) => `#${hex6({ r: clamp(rgb.r), g: clamp(rgb.g), b: clamp(rgb.b) })}`;
const tokensCss = [
  "/* 由 docs/blueprint/tools/theme-tokens.mjs 生成，不要手改。重新生成：node docs/blueprint/tools/theme-tokens.mjs --write */",
  ":root {",
  "  --la-ink-rgb: 255, 255, 255;",
  "  --la-shade-rgb: 0, 0, 0;",
  "  --la-shade-strength: 1;",
  ...sortNames(usedSolid).map((name) => `  --la-${name}: ${solid(usedSolid.get(name))};`),
  ...sortNames(usedTriples).map((name) => `  --la-${name}-rgb: ${triple(usedTriples.get(name))};`),
  "}",
  ':root[data-theme="light"] {',
  "  --la-ink-rgb: 55, 53, 47;",
  "  --la-shade-rgb: 15, 15, 15;",
  "  --la-shade-strength: 0.45;",
  ...sortNames(usedSolid).map((name) => `  --la-${name}: ${solid(lightColor(usedSolid.get(name)))};`),
  ...sortNames(usedTriples).map((name) => `  --la-${name}-rgb: ${triple(lightColor(usedTriples.get(name)))};`),
  "}",
  "",
].join("\n");

const scriptFiles = listFiles(path.join(root, "src"), [".js", ".jsx"]);
const inlineColors = [];
for (const file of scriptFiles) {
  fs.readFileSync(file, "utf8").split("\n").forEach((text, index) => {
    for (const match of text.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)/g)) inlineColors.push({ file: path.relative(root, file), line: index + 1, literal: match[0] });
  });
}

const totalReplaced = fileStats.reduce((sum, entry) => sum + entry.replaced, 0);
const report = [
  "# 主题变量替换报告",
  "",
  `- 模式：${write ? "已改写文件" : "只检查（加 --write 才会改文件）"}`,
  `- CSS 文件 ${cssFiles.length} 个；本次替换的颜色 ${totalReplaced} 处；颜色变量 ${usedSolid.size} 个，RGB 三元组变量 ${usedTriples.size} 个`,
  "",
  "## 每个文件本次替换数",
  "",
  "| 文件 | 替换数 |",
  "| --- | --- |",
  ...fileStats.map((entry) => `| ${entry.file} | ${entry.replaced} |`),
  "",
  `## 工具无法换算的 CSS 颜色（${leftovers.length} 处）`,
  "",
  "这些颜色写法工具不认识（例如 hsl()、lab()）。逐个改成十六进制或 rgb() 写法后重新运行工具，或在该行末尾加 `/* theme-keep */` 表示两种主题用同一个颜色。",
  "",
  "| 位置 | 颜色 | 属性 |",
  "| --- | --- | --- |",
  ...leftovers.map((entry) => `| ${entry.file}:${entry.line} | \`${entry.literal}\` | ${entry.property} |`),
  "",
  `## JS/JSX 里写死的颜色（${inlineColors.length} 处，工具不改）`,
  "",
  "| 位置 | 颜色 |",
  "| --- | --- |",
  ...inlineColors.map((entry) => `| ${entry.file}:${entry.line} | \`${entry.literal}\` |`),
  "",
].join("\n");

if (write) {
  for (const [file, text] of rewritten) fs.writeFileSync(file, text, "utf8");
  fs.mkdirSync(path.dirname(tokensPath), { recursive: true });
  fs.writeFileSync(tokensPath, tokensCss, "utf8");
}
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, report, "utf8");
console.log(`[theme-tokens] ${write ? "written" : "dry-run"} files=${cssFiles.length} replaced=${totalReplaced} solid=${usedSolid.size} triples=${usedTriples.size} leftovers=${leftovers.length} inline=${inlineColors.length} report=${path.relative(root, reportPath)}`);
