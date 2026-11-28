import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");

function token(name) {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  assert.ok(match, `missing token --${name}`);
  return match[1].trim();
}

test("blog-scale page tokens define restrained desktop proportions", () => {
  assert.equal(token("page-content-width"), "760px");
  assert.equal(token("page-cover-height"), "200px");
  assert.equal(token("page-icon-hit-size"), "60px");
  assert.equal(token("page-icon-svg-size"), "50px");
  assert.equal(token("page-icon-emoji-size"), "52px");
  assert.equal(token("page-icon-image-size"), "54px");
  assert.equal(token("page-title-size"), "42px");
  assert.equal(token("page-meta-size"), "13px");
  assert.equal(token("page-body-size"), "16px");
  assert.equal(token("page-body-line-height"), "1.72");
  assert.equal(token("page-h1-size"), "30px");
  assert.equal(token("page-h2-size"), "24px");
  assert.equal(token("page-h3-size"), "20px");
});

test("wide and small desktop breakpoints use discrete scale steps", () => {
  assert.match(css, /@media \(min-width: 1600px\)[\s\S]*?--page-content-width:\s*780px;[\s\S]*?--page-cover-height:\s*210px;[\s\S]*?--page-title-size:\s*44px;/);
  assert.match(css, /@media \(max-width: 1100px\)[\s\S]*?--page-content-width:\s*720px;[\s\S]*?--page-cover-height:\s*180px;[\s\S]*?--page-title-size:\s*38px;/);
});

test("full-bleed cover and constrained reading column coexist", () => {
  assert.match(css, /\.workspace-scroll\.is-page-editor \.page-cover\s*\{[\s\S]*?height:\s*var\(--page-cover-height\)/);
  assert.match(css, /\.workspace-scroll\.is-page-editor \.page-document-header\s*\{[\s\S]*?var\(--page-content-width\)/);
  assert.match(css, /\.workspace-scroll\.is-page-editor \.editor-hint,[\s\S]*?\.workspace-scroll\.is-page-editor \.life-editor[\s\S]*?var\(--page-content-width\)/);
});

test("editor typography and chrome are reading-first", () => {
  assert.match(css, /\.life-editor \.bn-block-content\s*\{[\s\S]*?font-size:\s*var\(--page-body-size\);[\s\S]*?line-height:\s*var\(--page-body-line-height\);/);
  assert.match(css, /data-level="1"[\s\S]*?font-size:\s*var\(--page-h1-size\) !important;/);
  assert.match(css, /data-level="2"[\s\S]*?font-size:\s*var\(--page-h2-size\) !important;/);
  assert.match(css, /data-level="3"[\s\S]*?font-size:\s*var\(--page-h3-size\) !important;/);
  assert.match(css, /\.life-editor \.bn-side-menu\s*\{[\s\S]*?opacity:\s*0\.72;/);
  assert.match(css, /\.life-editor \.bn-side-menu:focus-within\s*\{[\s\S]*?opacity:\s*1;/);
  assert.doesNotMatch(app, /拖动 ⋮⋮ 排序或嵌套/);
  assert.doesNotMatch(app, /选中文字可格式化/);
  assert.match(app, /<strong>\/</);
});

test("sidebar and topbar are quieter without changing their structure", () => {
  assert.match(css, /\.workspace-header\s*\{[\s\S]*?min-height:\s*44px;/);
  assert.match(css, /\.page-tree-row\s*\{[\s\S]*?min-height:\s*29px;/);
  assert.match(css, /\.page-tree-row > span:last-child\s*\{[\s\S]*?font-size:\s*12\.5px;/);
});
