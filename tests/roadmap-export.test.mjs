import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRoadmapSvg, EXPORT_COLORS, roadmapExportFileName } from "../src/domain/roadmapExport.js";
import { layoutRoadmap } from "../src/domain/roadmapLayout.js";

const DAY = 86400000;
const now = Date.UTC(2026, 10, 1);
const titles = ["需求与规划", "需求评审通过", "原型与设计", "开发 v1", "文档编写", "功能冻结", "测试与修复", "v1.0 发布"];
const offsets = [[-28, -14], [-14], [-14, 3], [3, 38], [20, 45], [38], [38, 52], [53]];
const entries = titles.map((title, index) => ({ id: `entry-${index}`, title, start: now + offsets[index][0] * DAY, end: offsets[index].length === 2 ? now + offsets[index][1] * DAY : null, color: "default", marker: index === 7 ? "major" : "diamond", subtitle: index === 7 ? "1.0.0" : "", progress: null }));
const layout = layoutRoadmap({ entries, width: 1760, now, config: { zoom: 1 } });

function assertBalancedTags(svg) {
  const stack = [];
  for (const match of svg.matchAll(/<\/?([A-Za-z][\w:-]*)\b[^>]*>/g)) {
    const [tag, name] = match;
    if (tag.startsWith("</")) assert.equal(stack.pop(), name, `Mismatched ${name} closing tag`);
    else if (!tag.endsWith("/>")) stack.push(name);
  }
  assert.deepEqual(stack, []);
}

test("svg export is well formed and contains every title", () => {
  const svg = buildRoadmapSvg({ layout, title: "项目开发进程", rangeLabel: "2026年10月 → 12月", background: "white", mode: "light" });
  assertBalancedTags(svg);
  for (const title of titles) assert.ok(svg.includes(title), title);
  assert.ok(svg.includes("1.0.0"));
});

test("svg export uses the fixed slide size and inline styles only", () => {
  const svg = buildRoadmapSvg({ layout, title: "时间脉络", background: "theme", mode: "dark" });
  assert.ok(svg.includes('viewBox="0 0 1920 1080"'));
  assert.ok(svg.includes('width="1920" height="1080"'));
  for (const forbidden of ["class=", "url(http", "@import", "var(--", "<style", "<image", "<foreignObject", "<script"]) assert.ok(!svg.includes(forbidden), forbidden);
  assert.ok(svg.includes("Segoe UI Variable Text"));
  assert.ok(svg.includes("Noto Sans SC"));
  assert.ok(svg.includes(`fill:${EXPORT_COLORS.dark.paper}`));
});

test("file names use the database name and local date", () => {
  const localDate = new Date(2026, 10, 7, 23, 59).getTime();
  assert.equal(roadmapExportFileName("里程碑与阶段", "png", localDate), "里程碑与阶段-时间脉络-20261107.png");
  assert.equal(roadmapExportFileName("软件开发", "svg", localDate), "软件开发-时间脉络-20261107.svg");
  assert.equal(roadmapExportFileName("项目/计划", "svg", localDate), "项目-计划-时间脉络-20261107.svg");
});

test("background choices use the required palettes and transparency", () => {
  const white = buildRoadmapSvg({ layout, background: "white", mode: "dark" });
  const transparent = buildRoadmapSvg({ layout, background: "transparent", mode: "dark" });
  const theme = buildRoadmapSvg({ layout, background: "theme", mode: "dark" });
  assert.ok(white.includes(`<rect width="1920" height="1080" style="fill:${EXPORT_COLORS.light.paper}"/>`));
  assert.ok(!transparent.includes('<rect width="1920" height="1080"'));
  assert.ok(transparent.includes(`fill:${EXPORT_COLORS.light.ink}`));
  assert.ok(theme.includes(`<rect width="1920" height="1080" style="fill:${EXPORT_COLORS.dark.paper}"/>`));
});

test("export palettes match the immutable Mobai tokens in both modes", () => {
  const tokens = readFileSync(new URL("../src/ui/themes/mobai/tokens.css", import.meta.url), "utf8");
  const names = { paper: "paper", ink: "ink", muted: "muted", faint: "faint", line: "line", line2: "line-2", accent: "accent", today: "today" };
  for (const mode of ["light", "dark"]) {
    const block = tokens.split(`:root[data-style="mobai"][data-theme="${mode}"] {`)[1].split("\n}")[0];
    for (const [key, variable] of Object.entries(names)) assert.equal(new RegExp(`--mb-${variable}:\\s*([^;]+)`).exec(block)[1].trim(), EXPORT_COLORS[mode][key]);
    for (const color of Object.keys(EXPORT_COLORS[mode].user)) {
      assert.equal(new RegExp(`--mb-u-${color}:\\s*([^;]+)`).exec(block)[1].trim(), EXPORT_COLORS[mode].user[color]);
      assert.equal(new RegExp(`--mb-tag-${color}:\\s*([^;]+)`).exec(block)[1].trim(), EXPORT_COLORS[mode].tag[color]);
    }
  }
});

test("unsafe title characters are escaped and dense rows fit one slide", () => {
  const denseEntries = Array.from({ length: 120 }, (_, index) => ({ ...entries[7], id: `dense-${index}`, title: index === 0 ? '<script> & "项目"' : `发布 ${index}` }));
  const denseLayout = layoutRoadmap({ entries: denseEntries, width: 1760, now, config: {} });
  const svg = buildRoadmapSvg({ layout: denseLayout, title: '<img src="x"> & 项目', background: "transparent" });
  assertBalancedTags(svg);
  assert.ok(svg.includes("&lt;script&gt; &amp; &quot;项目&quot;"));
  assert.ok(!svg.includes("<script>"));
  const scale = Number(/translate\(80 200\) scale\(1 ([\d.]+)\)/.exec(svg)[1]);
  assert.ok(scale > 0 && scale < 1);
  assert.ok(denseLayout.height * scale <= 800);
  for (let index = 1; index < denseEntries.length; index++) assert.ok(svg.includes(`发布 ${index}`));
});
