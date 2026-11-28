#!/usr/bin/env node
// 总设计师提供的工具（WP-19 使用，不要修改）。生成 THIRD_PARTY_NOTICES.md，并检查随产品发布的第三方代码的许可证。
// 用法：node docs/blueprint/tools/license-report.mjs [--out THIRD_PARTY_NOTICES.md] [--json .qa/WP-19/license-report.json]
// 范围：package.json 里的直接依赖（dependencies 与 devDependencies 都算）去掉纯构建/测试工具后，它们在 package-lock.json 里的全部子依赖。
//   这是“可能进入产品”的上限（Vite 打包时没用到的代码也会被列出来，多列不会出错）。
// 判定：SPDX 表达式里只要有一个 OR 分支的全部 AND 部分都在 ALLOWED 里，就算允许；否则列为“需要处理”，退出码 1。
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const root = process.cwd();
const outPath = path.resolve(root, option("--out", "THIRD_PARTY_NOTICES.md"));
const jsonPath = path.resolve(root, option("--json", ".qa/WP-19/license-report.json"));

const BUILD_ONLY = new Set(["vite", "@vitejs/plugin-react", "sharp", "electron", "electron-builder", "playwright", "@electron/fuses"]);
const ALLOWED = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "Apache-2.0", "MPL-2.0", "Zlib", "CC0-1.0", "Unlicense", "OFL-1.1", "BlueOak-1.0.0", "Python-2.0"]);
const FIXED_ENTRIES = [
  { name: "Electron", version: "44.4.5", license: "MIT", note: "桌面外壳（程序本体）" },
  { name: "Chromium 与其组件", version: "随 Electron 44.4.5", license: "见安装目录里的 LICENSES.chromium.html", note: "Electron 自带，安装包里已包含完整许可证文件" },
  { name: "SecLists 常见密码表（前 1000 条）", version: "—", license: "MIT", note: "数据文件，密钥库弱密码检查用（WP-06）" },
  { name: "EFF 大词表（7776 词）", version: "—", license: "CC-BY-3.0-US", note: "数据文件，口令短语生成用（WP-11）；按要求署名：Electronic Frontier Foundation" },
];

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
if (lock.lockfileVersion < 2 || !lock.packages) {
  console.error("[license-report] 需要 lockfileVersion 2 或 3 的 package-lock.json");
  process.exit(1);
}
const packages = lock.packages;
const directNames = [...new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})])].filter((name) => !BUILD_ONLY.has(name)).sort();

function resolve(name, fromPath) {
  let base = fromPath;
  while (true) {
    const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const index = base.lastIndexOf("/node_modules/");
    base = index >= 0 ? base.slice(0, index) : "";
  }
}
const platformOk = (entry) => (!entry.os || entry.os.includes("win32")) && (!entry.cpu || entry.cpu.includes("x64"));

const included = new Map();
const missingRoots = [];
const queue = [];
for (const name of directNames) {
  const location = resolve(name, "");
  if (!location) { missingRoots.push(name); continue; }
  queue.push(location);
}
while (queue.length) {
  const location = queue.shift();
  if (included.has(location)) continue;
  const entry = packages[location];
  if (!entry || !platformOk(entry)) continue;
  included.set(location, entry);
  const deps = { ...(entry.dependencies || {}), ...(entry.optionalDependencies || {}) };
  for (const dep of Object.keys(deps)) {
    const next = resolve(dep, location);
    if (next) queue.push(next);
  }
}

function licenseString(entry) {
  if (typeof entry.license === "string") return entry.license;
  if (Array.isArray(entry.licenses)) return entry.licenses.map((item) => item.type || item).join(" OR ");
  if (entry.license && typeof entry.license === "object") return entry.license.type || "UNKNOWN";
  return "UNKNOWN";
}
export function isAllowed(expression) {
  const text = String(expression || "").replace(/[()]/g, " ").trim();
  if (!text || text === "UNKNOWN") return false;
  return text.split(/\s+OR\s+/i).some((branch) => branch.split(/\s+AND\s+/i).every((part) => ALLOWED.has(part.trim().replace(/\+$/, ""))));
}
function packageName(location) {
  return location.slice(location.lastIndexOf("node_modules/") + "node_modules/".length);
}
function licenseText(location) {
  const dir = path.join(root, location);
  if (!fs.existsSync(dir)) return null;
  const file = fs.readdirSync(dir).find((name) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name));
  if (!file) return null;
  return fs.readFileSync(path.join(dir, file), "utf8").trim();
}

const rows = [...included.entries()].map(([location, entry]) => ({
  name: packageName(location), version: entry.version || "?", license: licenseString(entry), location,
})).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const problems = rows.filter((row) => !isAllowed(row.license));

const lines = [
  "# 第三方软件许可（THIRD_PARTY_NOTICES）",
  "",
  `Life Atlas ${pkg.version} 使用了下面这些开源软件和数据文件。本文件由 \`docs/blueprint/tools/license-report.mjs\` 生成。`,
  "",
  "## 程序本体与数据文件",
  "",
  "| 名称 | 版本 | 许可证 | 说明 |",
  "| --- | --- | --- | --- |",
  ...FIXED_ENTRIES.map((item) => `| ${item.name} | ${item.version} | ${item.license} | ${item.note} |`),
  "",
  `## npm 包（${rows.length} 个）`,
  "",
  "| 包 | 版本 | 许可证 |",
  "| --- | --- | --- |",
  ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.license} |`),
  "",
  "## 许可证原文",
  "",
];
const seenTexts = new Set();
for (const row of rows) {
  const text = licenseText(row.location);
  lines.push(`### ${row.name}@${row.version}（${row.license}）`, "");
  if (!text) lines.push("（包里没有单独的许可证文件；许可证见上表。）", "");
  else if (seenTexts.has(text)) lines.push("（与前面某个包的许可证原文相同。）", "");
  else { seenTexts.add(text); lines.push("```text", text.replace(/```/g, "'''"), "```", ""); }
}
fs.writeFileSync(outPath, lines.join("\n"), "utf8");
fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
fs.writeFileSync(jsonPath, JSON.stringify({ version: pkg.version, directNames, missingRoots, packages: rows, problems }, null, 2), "utf8");
console.log(`[license-report] packages=${rows.length} problems=${problems.length} missingRoots=${missingRoots.length} out=${path.relative(root, outPath)}`);
for (const row of problems) console.log(`  需要处理：${row.name}@${row.version} 许可证 ${row.license}`);
process.exit(problems.length ? 1 : 0);
