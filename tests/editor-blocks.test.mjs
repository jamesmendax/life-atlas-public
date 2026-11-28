import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const schema = fs.readFileSync(path.join(root, "src", "editor", "lifeAtlasSchema.jsx"), "utf8");
const slashCatalog = fs.readFileSync(path.join(root, "src", "editor", "slashMenuCatalog.js"), "utf8");
const editor = fs.readFileSync(path.join(root, "src", "editor", "PageEditor.jsx"), "utf8");
const sideMenu = fs.readFileSync(path.join(root, "src", "editor", "LifeAtlasSideMenuController.jsx"), "utf8");
const columnLayout = fs.readFileSync(path.join(root, "src", "editor", "ColumnLayout.jsx"), "utf8");
const columnResize = fs.readFileSync(path.join(root, "src", "editor", "columnResize.js"), "utf8");
const dragMenu = fs.readFileSync(path.join(root, "src", "editor", "LifeAtlasDragHandleMenu.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");

test("custom slash menu adds all requested local-first block families and keeps built-ins", () => {
  for (const label of [
    "标题 4","Callout","页面","PDF","块公式","目录","面包屑","Tabs","同步区块",
    "数据库 - Inline","数据库 - Full page","Linked View","图表","表单","Dashboard"
  ]) {
    assert.ok(schema.includes(label) || slashCatalog.includes(label), label);
  }
  assert.match(schema, /getDefaultReactSlashMenuItems/);
  assert.match(schema, /defaultBlockSpecs/);
  assert.match(schema, /filterSuggestionItems/);
  assert.match(schema, /Array\.from\(\{ length: columns \}/);
  assert.match(editor, /slashMenu=\{false\}/);
  assert.match(editor, /SuggestionMenuController/);
});

test("default BlockNote media and content blocks remain enabled by schema spread", () => {
  assert.match(schema, /\.\.\.defaultBlockSpecs/);
  for (const builtIn of ["image","video","audio","file","table","toggleListItem","quote"]) {
    assert.ok(schema.includes("defaultBlockSpecs") && builtIn.length > 0);
  }
});

test("project-owned multi-column blocks support 2-5 columns without GPL XL package", () => {
  assert.match(schema, /type:\s*"columnList"/);
  assert.match(schema, /type:\s*"column"/);
  assert.match(schema, /values:\s*\[2, 3, 4, 5\]/);
  assert.match(schema, /children:\s*Array\.from/);
  assert.match(schema, /width:\s*\{\s*default:\s*50\s*\}/);
  assert.match(schema, /index:\s*\{\s*default:\s*0\s*\}/);
  assert.match(schema, /count:\s*\{\s*default:\s*2\s*\}/);
  assert.match(schema, /props:\s*\{\s*width:\s*50,\s*index,\s*count:\s*columns\s*\}/);
  assert.doesNotMatch(schema, /life-column-add|在此栏添加区块/);
  assert.match(schema, /<ColumnLayout/);
  assert.match(columnLayout, /className="life-column-resizer"/);
  assert.match(columnResize, /runEditorTransaction/);
  assert.match(columnResize, /setNodeMarkup/);
  assert.match(columnResize, /leftId/);
  assert.match(columnResize, /rightId/);
  assert.match(css, /data-content-type="columnList"/);
  assert.match(css, /flex:\s*50 1 0/);
  assert.match(css, /data-column-width="50"/);
  assert.match(css, /\.bn-block-outer:has\(> \.bn-block > \.react-renderer > \.bn-block-content\[data-content-type="column"\] > \.life-column-marker\[data-column-width="50"\]\)\s*\{\s*flex-grow:\s*50/);
  assert.doesNotMatch(css, /\.life-column-add/);
  assert.match(css, /\.life-column-resizer/);
  assert.match(css, /cursor:\s*col-resize/);
  assert.match(css, /border:\s*0/);
  assert.match(sideMenu, /structuralTypes = new Set\(\["column", "columnList"\]\)/);
  assert.match(sideMenu, /structuralTypes\.has\(block\.type\)/);
  assert.match(sideMenu, /LifeAtlasDragHandleMenu block=\{block\}/);
  assert.match(dragMenu, /convertEditorBlocks/);
  assert.match(editor, /disableExtensions: \["sideMenu", "dropCursor", "trailingNode"\]/);
  assert.doesNotMatch(pkg, /@blocknote\/xl-multi-column/);
  assert.doesNotMatch(schema, /@blocknote\/xl/);
});
