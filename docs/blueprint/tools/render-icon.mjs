#!/usr/bin/env node
// 总设计师提供的工具（WP-19 使用，不要修改）。把一个 SVG 图标渲染成 7 个尺寸的 PNG，再合成 Windows 的 icon.ico。
// 用法：node docs/blueprint/tools/render-icon.mjs <图标.svg> <输出目录>
// 输出：<输出目录>/icon-16.png … icon-256.png、<输出目录>/icon.ico、<输出目录>/icon-preview.png（深浅两种背景上的各尺寸对照）
// 依赖：项目已有的开发依赖 playwright 与本机 Edge（channel: "msedge"），不联网。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [svgArg, outArg] = process.argv.slice(2);
if (!svgArg || !outArg) {
  console.error("用法：node docs/blueprint/tools/render-icon.mjs <图标.svg> <输出目录>");
  process.exit(1);
}
const svgPath = path.resolve(svgArg);
const outDir = path.resolve(outArg);
const svg = fs.readFileSync(svgPath, "utf8");
if (!/^\s*<svg[\s>]/.test(svg.replace(/^<\?xml[^>]*>\s*/, ""))) {
  console.error(`[render-icon] ${svgArg} 不是 SVG 文件`);
  process.exit(1);
}
if (/<(script|foreignObject|image)\b|href\s*=\s*["']https?:/i.test(svg)) {
  console.error("[render-icon] SVG 里不能有 script、foreignObject、image 或外部链接");
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

const { chromium } = await import("playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}img{display:block}</style><img src="${dataUrl}" width="${size}" height="${size}">`);
    await page.locator("img").evaluate((img) => img.decode());
    await page.screenshot({ path: path.join(outDir, `icon-${size}.png`), omitBackground: true });
  }
  const strip = (background) => `<div style="display:flex;align-items:center;gap:20px;padding:16px 20px;background:${background};border-radius:12px;margin-top:12px">${SIZES.slice().reverse().map((size) => `<img src="${dataUrl}" width="${size}" height="${size}">`).join("")}</div>`;
  await page.setViewportSize({ width: 760, height: 420 });
  await page.setContent(`<!doctype html><body style="margin:0;padding:24px;background:#ECEAE4;font-family:'Microsoft YaHei',sans-serif">${strip("#1F1F23")}${strip("#F3F3F3")}</body>`);
  await page.screenshot({ path: path.join(outDir, "icon-preview.png"), fullPage: true });
} finally {
  await browser.close();
}

const pngToIco = path.join(path.dirname(fileURLToPath(import.meta.url)), "png-to-ico.mjs");
const result = spawnSync(process.execPath, [pngToIco, path.join(outDir, "icon.ico"), ...SIZES.map((size) => path.join(outDir, `icon-${size}.png`))], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`[render-icon] ${path.relative(process.cwd(), outDir) || outDir}: ${SIZES.length} 张 PNG + icon.ico + icon-preview.png`);
