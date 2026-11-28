#!/usr/bin/env node
// Life Atlas 总设计师提供的验收自查工具。执行者（GPT）只使用，不要修改本文件；
// 觉得它判断错了，写进报告第 6 节，由总设计师处理。
//
// 用法（都在项目根目录运行）：
//   node docs/blueprint/tools/wp-check.mjs WP-01 --init-report   生成报告骨架（文件已存在时不覆盖）
//   node docs/blueprint/tools/wp-check.mjs WP-01 --until 0       停止点自查：只检查步骤 0 及之前（不跑测试）
//   node docs/blueprint/tools/wp-check.mjs WP-01 --until 4       停止点自查：检查到步骤 4（会跑 npm test 和 build）
//   node docs/blueprint/tools/wp-check.mjs WP-01 --quick         开发中快速自查（不跑任何测试）
//   node docs/blueprint/tools/wp-check.mjs WP-01                 收尾验收（跑 npm test 和 npm run build）
//   附加：--browser 额外跑 npm run test:parity:browser；--desktop 额外跑 npm run desktop:build 与 npm run test:e2e:desktop
//
// 输出：终端结论 + .qa/WP-xx/wp-check.md + .qa/WP-xx/wp-check.json
// 退出码：
//   0  全部检查通过，且报告里每条 AC 都是“通过”（用 --until 时：到该步骤为止全部通过）→ 可以停止
//   2  机械检查全部通过，但报告里有 AC 是“未通过/未验证” → 确认报告第 7 节写清卡点后停止
//   1  还有检查没通过 → 不能停止，按输出逐条修复、提交后重跑

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const wpArg = argv.find((value) => /^WP-\d\d$/i.test(value));
const flags = new Set(argv.filter((value) => value.startsWith("--")));
const untilIndex = argv.indexOf("--until");
const until = untilIndex >= 0 ? Number(argv[untilIndex + 1]) : null;

function fail(message) {
  console.error(`wp-check：${message}`);
  process.exit(1);
}

// 报告里的证据路径：普通路径必须存在；最后一段带 * 的（例如 .qa/wp16-history-*.png）至少要匹配一个文件。
function evidencePathExists(candidate) {
  if (!candidate.includes("*")) return existsSync(path.join(ROOT, candidate));
  const dir = path.posix.dirname(candidate);
  if (dir.includes("*")) return false;
  const pattern = new RegExp(`^${path.posix.basename(candidate).split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  const absoluteDir = path.join(ROOT, dir);
  return existsSync(absoluteDir) && readdirSync(absoluteDir).some((name) => pattern.test(name));
}

if (!wpArg) fail("请指定工作包编号，例如：node docs/blueprint/tools/wp-check.mjs WP-01");
if (untilIndex >= 0 && !Number.isInteger(until)) fail("--until 后面必须是步骤编号，例如 --until 3");
if (!existsSync(path.join(ROOT, "docs", "blueprint", "wp"))) fail("请在 Life Atlas 项目根目录运行本工具。");

const WP = wpArg.toUpperCase();
const WP_NUMBER = WP.slice(3);
const QA_DIR = path.join(ROOT, ".qa", WP);
const REPORT_REL = `docs/blueprint/reports/${WP}-report.md`;
const REPORT_PATH = path.join(ROOT, REPORT_REL);
const PLACEHOLDER = "【待填写】";

// ---------- 规格解析 ----------

const wpFileName = readdirSync(path.join(ROOT, "docs", "blueprint", "wp")).find((name) => name.startsWith(`${WP}-`) && name.endsWith(".md"));
if (!wpFileName) fail(`找不到 docs/blueprint/wp/${WP}-*.md`);
const spec = readFileSync(path.join(ROOT, "docs", "blueprint", "wp", wpFileName), "utf8");
const specTitle = (spec.match(/^#\s+(.+)$/m) || [null, WP])[1].trim();
const specBranch = (spec.match(/分支：`(wp\/[^`]+)`/) || [null, null])[1];
const specAcs = [...new Set([...spec.matchAll(/^\|\s*(AC-\d\d-\d+)\s*\|/gm)].map((match) => match[1]))];
const specSteps = [...spec.matchAll(/^###\s+步骤\s+(\d+)[：:]\s*(.+?)\s*$/gm)].map((match) => ({ n: Number(match[1]), title: match[2].replace(/【停止点】/g, "").trim(), stop: match[2].includes("【停止点】") }));
if (!specBranch) fail(`${wpFileName} 头部没有“分支：\`wp/...\`”，请把这个问题报告给总设计师。`);

// 已批准的依赖：只能在对应 WP 里新增或改变（版本为 "*" 表示不限定版本，否则必须完全相同）
const APPROVED_DEPENDENCIES = {
  "WP-03": { electron: "44.4.5", "electron-builder": "26.18.0", "@fontsource/dm-sans": "5.3.0" },
  "WP-05": { yazl: "3.3.1", yauzl: "3.4.0" },
  "WP-06": { "hash-wasm": "4.12.0" },
  "WP-11": { "@electron/fuses": "1.8.0" },
  "WP-12": { "@atlaskit/pragmatic-drag-and-drop": "*" },
  "WP-14": { katex: "0.19.1", "@blocknote/code-block": "0.54.2", "@floating-ui/react": "0.27.20" },
  "WP-20": { "@fontsource-variable/noto-sans-sc": "5.3.1", "@fontsource-variable/noto-serif-sc": "5.3.1" },
};
// 除本 WP 自己的报告外，还允许写的报告文件
const EXTRA_REPORTS = {
  "WP-19": ["docs/blueprint/reports/FINAL-ACCEPTANCE.md"],
};
// 允许从 dependencies 原样移到 devDependencies 的包（WP-03：界面与构建用的包由 Vite 打包，不能进安装包）
const APPROVED_MOVES_TO_DEV = {
  "WP-03": ["@blocknote/core", "@blocknote/mantine", "@blocknote/react", "@emoji-mart/data", "@mantine/core", "@mantine/hooks", "@tabler/icons-react", "@vitejs/plugin-react", "html2canvas", "jspdf", "jszip", "react", "react-dom", "sharp", "vite"],
};
// 主进程运行时 require 的包：只有它们可以放在 dependencies（electron-builder 只把 dependencies 打进安装包）
const RUNTIME_DEPENDENCIES = ["yazl", "yauzl", "hash-wasm"];
// 允许删除的已跟踪文件（其他删除：tests/ 下一律不允许；其余要在报告第 4 节说明）
const ALLOWED_DELETIONS = {
  "WP-00": ["[k", "console.log(JSON.stringify({keys"],
};
// WP-00 记录的浏览器场景基线检查数，之后任何 WP 都不能减少
const BROWSER_BASELINE = {
  "phase1-database": 9,
  "phase1-editor": 8,
  "phase1-migration": 2,
  "phase2-work-surfaces": 5,
  "phase2-query-formula": 5,
  "phase3-workspace": 5,
};

// ---------- 工具函数 ----------

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 }).replace(/\s+$/, "");
}
function tryGit(...args) {
  try {
    return { ok: true, out: git(...args) };
  } catch (error) {
    return { ok: false, out: String(error.stderr || error.message || error) };
  }
}
function runLogged(logName, command) {
  mkdirSync(QA_DIR, { recursive: true });
  const logPath = path.join(QA_DIR, logName);
  const started = Date.now();
  console.log(`  运行 ${command} …（日志 .qa/${WP}/${logName}）`);
  const result = spawnSync(command, { cwd: ROOT, shell: true, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, timeout: 45 * 60 * 1000, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" }, windowsHide: true });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  const exit = result.status ?? 1;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  writeFileSync(logPath, `[wp-check] command=${command}\n${output}\n[wp-check] exit=${exit} seconds=${seconds}${result.error ? ` error=${result.error.message}` : ""}\n`, "utf8");
  return { exit, output, seconds, log: `.qa/${WP}/${logName}` };
}
function sectionOf(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().startsWith(heading));
  if (start < 0) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s/.test(lines[index])) { end = index; break; }
  }
  return lines.slice(start, end).join("\n");
}
function tableRows(markdown) {
  return markdown.split(/\r?\n/).filter((line) => /^\|/.test(line.trim())).map((line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
}

const results = [];
function record(id, name, status, detail = "") {
  results.push({ id, name, status, detail });
}

// WP 文件“必读”一行里列出的文件（反引号里带 / 或带扩展名的部分）
function mustReadTokens() {
  const line = (spec.match(/^- 必读：(.+)$/m) || [])[1] || "";
  return [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim())
    .filter((token) => /[\/\\]/.test(token) || /\.(md|js|jsx|mjs|cjs|css|json|nsh|svg)$/.test(token));
}
function unresolvedMustRead() {
  const tracked = (tryGit("ls-files").out || "").split(/\r?\n/).filter(Boolean);
  return mustReadTokens().filter((token) => {
    // “prototype/index.html#view=timeline” 只检查文件本身；只有最后一段带 * 时（例如 “shots/vault-*”）按通配符找，
    // 其他带 * 的写法（例如 “src/**/*.css”）只检查 * 前面的目录
    const plain = token.replace(/\\/g, "/").replace(/[#?].*$/, "");
    const lastSegmentGlob = plain.includes("*") && !path.posix.dirname(plain).includes("*") && path.posix.basename(plain) !== "*";
    const cleaned = lastSegmentGlob ? plain : plain.replace(/\*.*$/, "").replace(/\/+$/, "");
    if (!cleaned) return false;
    const direct = [cleaned, `docs/blueprint/${cleaned}`, `docs/blueprint/wp/${cleaned}`];
    if (direct.some((candidate) => evidencePathExists(candidate))) return false;
    if (lastSegmentGlob) return true;
    // 简写（例如 “formula/engine.js”）：在已跟踪文件里按结尾匹配
    return !tracked.some((file) => file.endsWith(`/${cleaned}`));
  });
}

// ---------- --init-report ----------

if (flags.has("--init-report")) {
  if (existsSync(REPORT_PATH)) {
    console.log(`报告已存在，没有覆盖：${REPORT_REL}`);
    process.exit(0);
  }
  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  const stepRows = specSteps.map((step) => `| ${step.n} | ${step.title}${step.stop ? "（停止点）" : ""} | 未开始 |`).join("\n");
  const acRows = specAcs.map((ac) => `| ${ac} | ${PLACEHOLDER} | ${PLACEHOLDER} |`).join("\n");
  const report = `# ${specTitle} · 执行报告

> 由 \`node docs/blueprint/tools/wp-check.mjs ${WP} --init-report\` 生成。把所有“${PLACEHOLDER}”换成真实内容；不要删除任何小节和表格行。

- 执行者：${PLACEHOLDER}（模型名称）
- 分支：${specBranch}
- 开始时间：${PLACEHOLDER}
- 最终提交与结束时间：见 \`.qa/${WP}/wp-check.md\`（由 wp-check 自动记录，这里不用填）

## 0. 步骤进度

每完成一个步骤，就把该行“状态”改成“完成”，和这一步的代码一起提交。状态只能写：未开始 / 进行中 / 完成。

| 步骤 | 内容 | 状态 |
| --- | --- | --- |
${stepRows}

## 1. 我的理解（步骤 0 写）

- 这个 WP 要让用户能做到：${PLACEHOLDER}
- 明确不做：${PLACEHOLDER}
- 准备改动或新建的文件：${PLACEHOLDER}
- 我认为的主要风险：${PLACEHOLDER}
- 理解题回答（WP 文件步骤 0 里的问题，逐题回答）：${PLACEHOLDER}

## 2. 完成情况总览

结论只能写：通过 / 未通过 / 未验证。证据写测试文件路径加用例名，或日志、截图的路径。

| AC | 结论 | 证据位置 |
| --- | --- | --- |
${acRows}

## 3. 关键命令与结果

- wp-check 结果：见 \`.qa/${WP}/wp-check.md\`
- ${PLACEHOLDER}（其他命令：完整命令、退出码、关键数字、日志路径）

## 4. 改动清单

每个改动的文件一行：\`路径\` —— 为什么改。wp-check 会核对 \`git diff --name-only main...HEAD\` 里的每个文件都在这里出现。

- ${PLACEHOLDER}

## 5. 自行决定的事项

- ${PLACEHOLDER}（没有就写“无”）

## 6. 发现的问题与建议（没有动手修的）

- ${PLACEHOLDER}（没有就写“无”）

## 7. 未完成 / 未验证

- ${PLACEHOLDER}（没有就写“无”）

## 8. 返工记录

- 无
`;
  writeFileSync(REPORT_PATH, report, "utf8");
  console.log(`已生成报告骨架：${REPORT_REL}`);
  console.log(`包含 ${specSteps.length} 个步骤、${specAcs.length} 条 AC。下一步：按 WP 文件步骤 0 填写第 1 节。`);
  const missingMustRead = unresolvedMustRead();
  if (missingMustRead.length) {
    console.log(`注意：WP 文件“必读”里的这些文件不存在：${missingMustRead.join("、")}。先用 git grep 找一次；仍找不到就不要开工，在报告第 7 节写“锚点不存在：<文件>”，提交后停止，按 09 第 6.2 节回复（状态：卡住）。`);
  }
  process.exit(0);
}

// ---------- 检查 ----------

const head = tryGit("rev-parse", "HEAD");
const mainRef = tryGit("rev-parse", "--verify", "main");
if (!head.ok || !mainRef.ok) fail("当前目录不是带 main 分支的 Git 仓库（WP-00 之后才可以使用本工具的检查功能）。");

// K0 必读文件存在（规格与代码对得上）
const missingMustRead = unresolvedMustRead();
record("K0", "必读文件存在", missingMustRead.length ? "FAIL" : "PASS", missingMustRead.length ? `WP 文件“必读”里的这些文件不存在：${missingMustRead.join("、")}` : `${mustReadTokens().length} 个文件都在`);

// K1 分支
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
record("K1", "当前分支", branch === specBranch ? "PASS" : "FAIL", branch === specBranch ? branch : `当前是 ${branch}，规格要求 ${specBranch}`);

// K2 提交说明
const commitSubjects = git("log", "--format=%s", "main..HEAD").split(/\r?\n/).filter(Boolean);
const badSubjects = commitSubjects.filter((subject) => !subject.startsWith(`${WP}:`));
if (!commitSubjects.length) record("K2", "提交", "FAIL", "main..HEAD 没有任何提交");
else record("K2", "提交说明", badSubjects.length ? "FAIL" : "PASS", badSubjects.length ? `这些提交说明不以“${WP}:”开头：${badSubjects.join(" / ")}` : `${commitSubjects.length} 个提交`);

// K3 工作区干净
const porcelain = git("status", "--porcelain");
record("K3", "工作区干净", porcelain ? "FAIL" : "PASS", porcelain ? `有未提交的改动：\n${porcelain}` : "git status 无输出");

// K4 受保护路径与删除
const nameStatus = git("diff", "--name-status", "-M", "main...HEAD").split(/\r?\n/).filter(Boolean).map((line) => line.split("\t"));
const changedFiles = [];
const protectedHits = [];
const deletedFiles = [];
for (const parts of nameStatus) {
  const status = parts[0];
  const paths = parts.slice(1);
  if (status.startsWith("R")) deletedFiles.push(paths[0]);
  if (status === "D") deletedFiles.push(paths[0]);
  const current = paths[paths.length - 1];
  changedFiles.push(current);
  for (const file of paths) {
    const extraReports = EXTRA_REPORTS[WP] || [];
    const isProtected = file === "AGENTS.md"
      || (file.startsWith("docs/blueprint/") && !file.startsWith("docs/blueprint/reports/"))
      || (file.startsWith("docs/blueprint/reports/") && file !== REPORT_REL && !extraReports.includes(file))
      || /^(node_modules|\.visual-qa|\.qa|dist|release|\.devdata)\//.test(file);
    if (isProtected) protectedHits.push(file);
  }
}
const allowedDeletions = new Set(ALLOWED_DELETIONS[WP] || []);
const badDeletions = deletedFiles.filter((file) => !allowedDeletions.has(file) && file.startsWith("tests/"));
const otherDeletions = deletedFiles.filter((file) => !allowedDeletions.has(file) && !file.startsWith("tests/"));
if (protectedHits.length) record("K4", "受保护文件", "FAIL", `不允许改动：${protectedHits.join("、")}`);
else if (badDeletions.length) record("K4", "受保护文件", "FAIL", `不允许删除测试文件：${badDeletions.join("、")}`);
else record("K4", "受保护文件", "PASS", otherDeletions.length ? `删除了：${otherDeletions.join("、")}（必须在报告第 4 节说明）` : "未改动受保护文件");

// K5 依赖
(() => {
  const baseText = tryGit("show", "main:package.json");
  if (!baseText.ok) return record("K5", "依赖", "FAIL", "读取 main:package.json 失败");
  let base;
  let current;
  try {
    base = JSON.parse(baseText.out);
    current = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  } catch (error) {
    return record("K5", "依赖", "FAIL", `package.json 无法解析：${error.message}`);
  }
  const approved = APPROVED_DEPENDENCIES[WP] || {};
  const allowedMoves = new Set(APPROVED_MOVES_TO_DEV[WP] || []);
  const problems = [];
  const changes = [];
  // 从 dependencies 原样（版本字符串不变）移到 devDependencies：只在批准的 WP 里允许
  const moved = new Set();
  for (const [name, version] of Object.entries(base.dependencies || {})) {
    if (current.dependencies?.[name] === undefined && current.devDependencies?.[name] === version && base.devDependencies?.[name] === undefined) {
      moved.add(name);
      changes.push(`${name}: dependencies → devDependencies（${version}）`);
      if (!allowedMoves.has(name)) problems.push(`${name} 从 dependencies 移到了 devDependencies，${WP} 不允许这样做`);
    }
  }
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const names = new Set([...Object.keys(base[section] || {}), ...Object.keys(current[section] || {})]);
    for (const name of names) {
      if (moved.has(name) && (section === "dependencies" || section === "devDependencies")) continue;
      const before = base[section]?.[name];
      const after = current[section]?.[name];
      if (before === after) continue;
      changes.push(`${section}.${name}: ${before ?? "无"} → ${after ?? "删除"}`);
      if (after === undefined) problems.push(`${name} 被删除（不允许）`);
      else if (!(name in approved)) problems.push(`${name} 不在 ${WP} 的批准清单里`);
      else if (approved[name] !== "*" && after !== approved[name]) problems.push(`${name} 必须是精确版本 ${approved[name]}（现在是 ${after}）`);
    }
  }
  for (const name of allowedMoves) {
    if (!moved.has(name) && base.dependencies?.[name] !== undefined) problems.push(`${name} 必须原样移到 devDependencies（版本字符串不变）`);
  }
  // WP-03 起：dependencies 里只能有主进程运行时需要 require 的包（打包时它们会被放进安装包）
  if (Number(WP_NUMBER) >= 3) {
    const extra = Object.keys(current.dependencies || {}).filter((name) => !RUNTIME_DEPENDENCIES.includes(name));
    if (extra.length) problems.push(`这些包不能放在 dependencies（界面用的包由 Vite 打包，要用 npm install --save-dev 安装）：${extra.join("、")}`);
  }
  const lockChanged = changedFiles.includes("package-lock.json");
  if (lockChanged && !changes.length) problems.push("package-lock.json 变了，但 package.json 的依赖没有变化（不要运行 npm update / npm audit fix）");
  if (!lockChanged && changes.length) problems.push("package.json 的依赖变了，但 package-lock.json 没有提交");
  const testScript = current.scripts?.test || "";
  if (/test-skip-pattern|test-name-pattern|test-only/.test(testScript)) problems.push(`npm test 脚本里不允许过滤测试：${testScript}`);
  record("K5", "依赖与测试脚本", problems.length ? "FAIL" : "PASS", problems.length ? problems.join("；") : (changes.length ? changes.join("；") : "依赖没有变化"));
})();

// K6 测试削弱扫描
(() => {
  const diff = git("diff", "-U0", "main...HEAD", "--", "tests");
  let file = "";
  const added = [];
  let removedAsserts = 0;
  let removedTests = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ ")) { file = line.slice(6); continue; }
    if (line.startsWith("--- ")) continue;
    if (line.startsWith("+")) {
      const text = line.slice(1);
      if (/\.(skip|only|todo)\s*\(|\b(test|it|describe)\.(skip|only|todo)\b|\{\s*(skip|todo|only)\s*:|\bskip\s*:\s*true/.test(text)) added.push(`${file}: ${text.trim().slice(0, 120)}`);
    } else if (line.startsWith("-")) {
      if (/assert/.test(line)) removedAsserts += 1;
      if (/^\-\s*(await\s+)?(test|it|check)\s*\(/.test(line)) removedTests += 1;
    }
  }
  if (added.length) record("K6", "测试削弱", "FAIL", `新增了跳过/只跑/待办标记：\n${added.join("\n")}`);
  else record("K6", "测试削弱", removedAsserts || removedTests ? "INFO" : "PASS", removedAsserts || removedTests ? `删除了 ${removedAsserts} 行断言、${removedTests} 个用例/检查（必须在报告第 4 节逐个说明原因）` : "没有发现跳过或删除测试");
})();

// K7–K10 运行测试
const quick = flags.has("--quick") || until === 0;
let testSummary = null;
if (!quick) {
  const unit = runLogged("npm-test.log", "npm test");
  const number = (label) => {
    const match = unit.output.match(new RegExp(`ℹ ${label} (\\d+)`));
    return match ? Number(match[1]) : null;
  };
  const counts = { tests: number("tests"), pass: number("pass"), fail: number("fail"), cancelled: number("cancelled"), skipped: number("skipped"), todo: number("todo") };
  const fileCount = readdirSync(path.join(ROOT, "tests")).filter((name) => name.endsWith(".test.mjs")).length;
  testSummary = { ...counts, files: fileCount };
  const ok = unit.exit === 0 && counts.tests > 0 && counts.fail === 0 && counts.cancelled === 0 && counts.skipped === 0 && counts.todo === 0;
  record("K7", "单元测试 npm test", ok ? "PASS" : "FAIL", `${fileCount} 个文件 / ${counts.tests ?? "?"} 个用例，通过 ${counts.pass ?? "?"}，失败 ${counts.fail ?? "?"}，跳过 ${counts.skipped ?? "?"}，退出码 ${unit.exit}；日志 ${unit.log}`);

  const build = runLogged("build.log", "npm run build");
  record("K8", "构建 npm run build", build.exit === 0 ? "PASS" : "FAIL", `退出码 ${build.exit}；日志 ${build.log}`);

  if (flags.has("--browser")) {
    const browser = runLogged("browser-parity.log", "npm run test:parity:browser");
    let detail = `退出码 ${browser.exit}；日志 ${browser.log}`;
    let ok = browser.exit === 0;
    try {
      const report = JSON.parse(readFileSync(path.join(ROOT, ".qa", "core-parity-browser.json"), "utf8"));
      const counts = Object.fromEntries((report.results || []).map((entry) => [entry.scenario, entry.checks]));
      const shrunk = Object.entries(BROWSER_BASELINE).filter(([name, minimum]) => !(counts[name] >= minimum)).map(([name, minimum]) => `${name} 需要 ≥${minimum}，实际 ${counts[name] ?? "缺失"}`);
      if (shrunk.length) { ok = false; detail += `；基线检查数减少：${shrunk.join("，")}`; }
      detail += `；共 ${report.totalChecks} 项检查：${Object.entries(counts).map(([name, value]) => `${name}=${value}`).join(" ")}`;
    } catch {
      ok = false;
      detail += "；读取 .qa/core-parity-browser.json 失败";
    }
    record("K9", "浏览器场景", ok ? "PASS" : "FAIL", detail);
  }

  if (flags.has("--desktop")) {
    const testBuild = runLogged("desktop-build-test.log", "npm run desktop:build:test");
    record("K10a", "测试版打包 npm run desktop:build:test", testBuild.exit === 0 ? "PASS" : "FAIL", `退出码 ${testBuild.exit}；日志 ${testBuild.log}`);
    const releaseBuild = runLogged("desktop-build-release.log", "npm run desktop:build");
    record("K10b", "正式版打包 npm run desktop:build", releaseBuild.exit === 0 ? "PASS" : "FAIL", `退出码 ${releaseBuild.exit}；日志 ${releaseBuild.log}`);
    const e2e = runLogged("desktop-e2e.log", "npm run test:e2e:desktop");
    record("K10c", "桌面端到端 npm run test:e2e:desktop", e2e.exit === 0 ? "PASS" : "FAIL", `退出码 ${e2e.exit}；日志 ${e2e.log}`);
  }
} else {
  record("K7", "单元测试", "SKIP", until === 0 ? "--until 0 不跑测试" : "--quick 不跑测试；收尾时必须不带 --quick 再跑一次");
}

// K11 报告
let acSummary = { pass: 0, notPass: 0, unverified: 0, missing: [] };
(() => {
  if (!existsSync(REPORT_PATH)) return record("K11", "报告", "FAIL", `缺少 ${REPORT_REL}（先运行 --init-report）`);
  const report = readFileSync(REPORT_PATH, "utf8");
  const problems = [];

  // 步骤进度
  const progress = sectionOf(report, "## 0.");
  const rows = progress ? tableRows(progress).filter((cells) => /^\d+$/.test(cells[0])) : [];
  const required = until === null ? specSteps : specSteps.filter((step) => step.n <= until);
  for (const step of required) {
    const row = rows.find((cells) => Number(cells[0]) === step.n);
    if (!row) problems.push(`第 0 节缺少步骤 ${step.n} 这一行`);
    else if (row[2] !== "完成") problems.push(`步骤 ${step.n} 状态是“${row[2] || "空"}”，应为“完成”`);
  }

  // 占位符
  const sectionsToCheck = until === null ? [report] : [report.split(/^## 2\./m)[0]];
  if (sectionsToCheck.some((text) => text.includes(PLACEHOLDER))) problems.push(`还有“${PLACEHOLDER}”没有替换${until === null ? "" : "（第 0、1 节和开头）"}`);

  if (until === null) {
    // AC 结论
    const overview = sectionOf(report, "## 2.") || "";
    const acRows = tableRows(overview).filter((cells) => /^AC-\d\d-\d+$/.test(cells[0]));
    for (const ac of specAcs) {
      const row = acRows.find((cells) => cells[0] === ac);
      if (!row) { acSummary.missing.push(ac); continue; }
      const verdict = row[1];
      if (verdict === "通过") acSummary.pass += 1;
      else if (verdict === "未通过") acSummary.notPass += 1;
      else if (verdict === "未验证") acSummary.unverified += 1;
      else problems.push(`${ac} 的结论“${verdict}”不是 通过/未通过/未验证`);
      if (!row[2] || row[2] === PLACEHOLDER) problems.push(`${ac} 没有写证据`);
      // 证据里提到的路径必须存在
      for (const match of (row[2] || "").matchAll(/(?:\.qa|tests|tools|electron|src|design|docs)\/[^\s「」"'`，、；;()（）]+/g)) {
        const candidate = match[0].replace(/[.,:：]+$/, "").replace(/:\d+$/, "");
        if (!evidencePathExists(candidate)) problems.push(`${ac} 的证据路径不存在${candidate.includes("*") ? "（没有匹配的文件）" : ""}：${candidate}`);
      }
    }
    if (acSummary.missing.length) problems.push(`第 2 节缺少这些 AC：${acSummary.missing.join("、")}`);

    // 改动清单必须覆盖每个改动文件
    const changes = sectionOf(report, "## 4.") || "";
    const unexplained = changedFiles.filter((file) => file !== REPORT_REL && !changes.includes(file));
    if (unexplained.length) problems.push(`第 4 节没有说明这些改动文件：${unexplained.join("、")}`);

    // 未完成项必须写明
    const unfinished = sectionOf(report, "## 7.") || "";
    if ((acSummary.notPass || acSummary.unverified) && /^\s*-\s*无\s*$/m.test(unfinished)) problems.push("有 AC 未通过/未验证，但第 7 节写的是“无”");
  }

  record("K11", "报告", problems.length ? "FAIL" : "PASS", problems.length ? problems.join("\n") : (until === null ? `AC：通过 ${acSummary.pass}，未通过 ${acSummary.notPass}，未验证 ${acSummary.unverified}` : `步骤 0–${until} 已完成`));
})();

// K12 证据目录
if (!quick) {
  const hasEvidence = existsSync(QA_DIR) && readdirSync(QA_DIR).some((name) => name !== "wp-check.md" && name !== "wp-check.json");
  record("K12", "证据目录", hasEvidence ? "PASS" : "FAIL", hasEvidence ? `.qa/${WP}/` : `.qa/${WP}/ 里没有任何证据文件`);
}

// K13 主题变量（WP-20 把颜色换成变量之后的每个 WP：CSS 里不能再出现工具能换算却没换算的颜色）
// WP-20 排在 WP-03 之后执行（06 第 1 节），所以按“src/ui/theme-tokens.css 是否已存在”判断，而不是按编号大小。
const wpNumber = Number(WP.replace(/^WP-/, ""));
const themeTokensExist = existsSync(path.join(ROOT, "src", "ui", "theme-tokens.css"));
if (!quick && Number.isFinite(wpNumber) && (WP === "WP-20" || themeTokensExist) && until === null) {
  const theme = runLogged("theme-tokens-check.log", `node docs/blueprint/tools/theme-tokens.mjs --report .qa/${WP}/theme-tokens-check.md`);
  const replaced = Number(/replaced=(\d+)/.exec(theme.output)?.[1] ?? NaN);
  const leftovers = Number(/leftovers=(\d+)/.exec(theme.output)?.[1] ?? NaN);
  const ok = theme.exit === 0 && replaced === 0 && leftovers === 0;
  record("K13", "主题变量", ok ? "PASS" : "FAIL", ok ? "CSS 里没有待换算的颜色" : `还有 ${Number.isNaN(replaced) ? "?" : replaced} 处颜色没换成变量、${Number.isNaN(leftovers) ? "?" : leftovers} 处无法换算：${WP === "WP-20" ? "运行 node docs/blueprint/tools/theme-tokens.mjs --write 后提交" : "把这些规则移到 src/ui/themes/mobai/ 的新文件里、颜色改用 --mb-* 变量（12 第 0 节；不要用 --write）"}；详情见 .qa/${WP}/theme-tokens-check.md`);
}

// ---------- 结论 ----------

const failed = results.filter((entry) => entry.status === "FAIL");
let exitCode;
let verdict;
if (missingMustRead.length) {
  exitCode = 2;
  verdict = "WP 文件“必读”里列的文件在代码里不存在：规格和代码对不上。不要自己创建这些文件，也不要猜一个相近的文件去改。在报告第 7 节写“锚点不存在：<文件>”，提交，然后停止，按 09 第 6.2 节回复（状态：卡住），等待总设计师修订规格。";
} else if (failed.length) {
  exitCode = 1;
  verdict = "还不能停止。逐条处理上面的 FAIL，修复并提交后重新运行本工具。同一项连续修 3 次仍然 FAIL，就在报告第 7 节写明情况后停止。";
} else if (until !== null) {
  exitCode = 0;
  verdict = `到步骤 ${until} 为止的检查全部通过。这是停止点：停止工作，按 09 执行手册第 6 节的格式回复用户。`;
} else if (acSummary.notPass || acSummary.unverified) {
  exitCode = 2;
  verdict = "机械检查全部通过，但有 AC 未通过或未验证。确认报告第 7 节逐条写清卡点、试过什么、证据在哪，然后停止，等待总设计师。";
} else if (quick) {
  exitCode = 1;
  verdict = "--quick 只做了部分检查。收尾时必须不带 --quick 运行。";
} else {
  exitCode = 0;
  verdict = "全部检查通过，所有 AC 为“通过”。工作包完成：停止工作，不要开始下一个工作包，按 09 执行手册第 6 节的格式回复用户。";
}

const headHash = git("rev-parse", "--short", "HEAD");
const finishedAt = new Date().toISOString();
const lines = [
  `# wp-check ${WP}`,
  "",
  `- 时间：${finishedAt}`,
  `- 分支：${branch}`,
  `- HEAD：${headHash}`,
  `- 参数：${argv.join(" ")}`,
  testSummary ? `- 单元测试：${testSummary.files} 个文件 / ${testSummary.tests} 个用例，失败 ${testSummary.fail}` : "- 单元测试：未运行",
  "",
  "| 检查 | 名称 | 结果 | 说明 |",
  "| --- | --- | --- | --- |",
  ...results.map((entry) => `| ${entry.id} | ${entry.name} | ${entry.status} | ${String(entry.detail).replace(/\|/g, "/").replace(/\r?\n/g, "<br>")} |`),
  "",
  `**退出码 ${exitCode}**：${verdict}`,
  "",
];
mkdirSync(QA_DIR, { recursive: true });
writeFileSync(path.join(QA_DIR, "wp-check.md"), lines.join("\n"), "utf8");
writeFileSync(path.join(QA_DIR, "wp-check.json"), JSON.stringify({ wp: WP, finishedAt, branch, head: headHash, argv, results, testSummary, acSummary, exitCode }, null, 2), "utf8");

console.log("");
for (const entry of results) {
  console.log(`[${entry.status}] ${entry.id} ${entry.name}${entry.detail ? `：${String(entry.detail).split(/\r?\n/).join("\n        ")}` : ""}`);
}
console.log("");
console.log(`退出码 ${exitCode}：${verdict}`);
console.log(`（结果已写入 .qa/${WP}/wp-check.md）`);
process.exit(exitCode);
