#!/usr/bin/env node
// 总设计师提供的工具（WP-20 起使用，不要修改）。
// 把“参照图”和“实际截图”并排拼成一张图，并算出两张图有多少像素明显不同，方便总设计师验收视觉效果。
// 用法：
//   node docs/blueprint/tools/compare-shots.mjs <参照图目录> <实际截图目录> --out <输出目录> [--prefix <实际截图文件名前缀>] [--only <画面>,<画面>]
// 例：node docs/blueprint/tools/compare-shots.mjs docs/blueprint/design/mobai/product-shots .qa --prefix wp20-mobai- --out .qa/WP-20/compare
// 规则：参照图目录里的每个 <名称>.png，去实际截图目录找 <前缀><名称>.png；找到就输出 <输出目录>/<名称>.png（左参照、右实际、下面一行差异图），
// 并在 <输出目录>/summary.md 写一行：名称、两张图的尺寸、“明显不同的像素”占比（任一通道差 > 24 算明显不同）。
// --only 只比较列出的画面：<画面> 匹配参照图 <画面>.png、<画面>-light.png、<画面>-dark.png（例：--only vault-setup,vault 不包括 vault-locked-*）。
// 找不到的写“缺少实际截图”。退出码：0（全部生成）、1（参数错误或有缺少的截图）。差异占比只供参考，不决定退出码。
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const option = (name, fallback = null) => { const index = args.indexOf(name); return index >= 0 && args[index + 1] ? args[index + 1] : fallback; };
const positional = args.filter((value, index) => !value.startsWith("--") && !["--out", "--prefix", "--only"].includes(args[index - 1]));
const [referenceDir, actualDir] = positional;
const outDir = option("--out");
const prefix = option("--prefix", "");
const only = option("--only", "").split(",").map((name) => name.trim()).filter(Boolean);
if (!referenceDir || !actualDir || !outDir) {
  console.error("用法：node docs/blueprint/tools/compare-shots.mjs <参照图目录> <实际截图目录> --out <输出目录> [--prefix <前缀>]");
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const wanted = (name) => only.length === 0 || only.some((view) => [`${view}.png`, `${view}-light.png`, `${view}-dark.png`].includes(name));
const references = fs.readdirSync(referenceDir).filter((name) => name.toLowerCase().endsWith(".png") && wanted(name)).sort();
if (references.length === 0) {
  console.error(`参照图目录里没有要比较的图片：${referenceDir}${only.length ? `（--only ${only.join(",")}）` : ""}`);
  process.exit(1);
}
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const rows = [];
let missing = 0;
for (const name of references) {
  const actualPath = path.join(actualDir, `${prefix}${name}`);
  if (!fs.existsSync(actualPath)) { rows.push(`| ${name} | — | 缺少实际截图 \`${prefix}${name}\` |`); missing += 1; continue; }
  // 用 data: 地址传图片：file:// 的图片会让画布无法读取像素
  const toDataUrl = (file) => `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
  const referenceUrl = toDataUrl(path.resolve(referenceDir, name));
  const actualUrl = toDataUrl(path.resolve(actualPath));
  await page.setContent(`<!doctype html><body style="margin:0;background:#888"><canvas id="c"></canvas></body>`);
  const result = await page.evaluate(async ({ referenceUrl, actualUrl, name }) => {
    const load = (src) => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error(`无法读取 ${name}`)); image.src = src; });
    const [a, b] = await Promise.all([load(referenceUrl), load(actualUrl)]);
    const width = Math.max(a.width, b.width);
    const height = Math.max(a.height, b.height);
    const draw = (image) => { const canvas = new OffscreenCanvas(width, height); const context = canvas.getContext("2d"); context.drawImage(image, 0, 0); return context.getImageData(0, 0, width, height); };
    const da = draw(a), db = draw(b);
    const diff = new ImageData(width, height);
    let different = 0;
    for (let i = 0; i < da.data.length; i += 4) {
      const d = Math.max(Math.abs(da.data[i] - db.data[i]), Math.abs(da.data[i + 1] - db.data[i + 1]), Math.abs(da.data[i + 2] - db.data[i + 2]));
      const hit = d > 24;
      if (hit) different += 1;
      diff.data[i] = hit ? 230 : 255; diff.data[i + 1] = hit ? 40 : 255; diff.data[i + 2] = hit ? 40 : 255; diff.data[i + 3] = 255;
    }
    const scale = 0.5, gap = 16, label = 28;
    const canvas = document.getElementById("c");
    canvas.width = Math.round(width * scale) * 2 + gap * 3;
    canvas.height = Math.round(height * scale) * 2 + gap * 3 + label * 2;
    const context = canvas.getContext("2d");
    context.fillStyle = "#dfe1e5"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#1b1c1f"; context.font = "600 15px sans-serif";
    const w = Math.round(width * scale), h = Math.round(height * scale);
    context.fillText(`参照：${name}`, gap, gap + 16);
    context.fillText("实际", gap * 2 + w, gap + 16);
    context.drawImage(a, gap, gap + label, w, h);
    context.drawImage(b, gap * 2 + w, gap + label, w, h);
    const diffCanvas = new OffscreenCanvas(width, height); diffCanvas.getContext("2d").putImageData(diff, 0, 0);
    context.fillText(`差异（红色 = 明显不同）：${((different / (width * height)) * 100).toFixed(1)}%`, gap, gap * 2 + label + h + 16);
    context.drawImage(diffCanvas, gap, gap * 2 + label * 2 + h, w, h);
    return { width: canvas.width, height: canvas.height, aSize: `${a.width}×${a.height}`, bSize: `${b.width}×${b.height}`, percent: (different / (width * height)) * 100 };
  }, { referenceUrl, actualUrl, name });
  await page.setViewportSize({ width: result.width, height: result.height });
  await page.locator("#c").screenshot({ path: path.join(outDir, name) });
  rows.push(`| ${name} | ${result.aSize} / ${result.bSize} | ${result.percent.toFixed(1)}% |`);
}
await browser.close();
fs.writeFileSync(path.join(outDir, "summary.md"), ["# 视觉对照", "", "| 画面 | 参照 / 实际尺寸 | 明显不同的像素 |", "| --- | --- | --- |", ...rows, ""].join("\n"));
console.log(`[compare-shots] images=${references.length - missing} missing=${missing} out=${outDir}`);
process.exit(missing ? 1 : 0);
