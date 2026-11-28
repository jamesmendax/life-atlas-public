import test from "node:test";
import assert from "node:assert/strict";
import { filterSuggestionItems } from "@blocknote/core";
import { SLASH_MENU_CATALOG, SLASH_GROUP_ORDER, SLASH_MARKDOWN_HINTS } from "../src/editor/slashMenuCatalog.js";

test("slash menu groups follow the specified order", () => {
  const groups = SLASH_MENU_CATALOG.filter((item, index) => item.group !== SLASH_MENU_CATALOG[index - 1]?.group).map((item) => item.group);
  assert.deepEqual(groups, SLASH_GROUP_ORDER);
});

test("slash menu titles match the table", () => {
  assert.deepEqual(SLASH_MENU_CATALOG.map((item) => item.title), [
    "文本", "页面", "待办事项", "标题 1", "标题 2", "标题 3", "标题 4", "表格", "项目符号列表", "有序列表", "折叠列表", "引用", "分隔线", "链接到页面", "标注", "折叠标题 1", "折叠标题 2", "折叠标题 3", "折叠标题 4",
    "图片", "视频", "音频", "文件", "PDF", "代码",
    "表格视图", "看板视图", "画廊视图", "列表视图", "日历视图", "时间轴视图", "时间脉络", "地图视图", "图表", "表单", "管理面板视图", "动态视图", "数据库 - 行内", "数据库 - 整页", "数据源的链接视图",
    "按钮", "目录", "公式区块", "路径栏", "同步区块", "选项卡", "2 列", "3 列", "4 列", "5 列", "Editorial Card", "Editorial 3 Cards", "Editorial Media / Text", "Editorial Section",
    "提及", "行内公式", "表情",
  ]);
});

test("english aliases find their blocks", () => {
  for (const [query, title] of [["h1", "标题 1"], ["todo", "待办事项"], ["code", "代码"], ["table", "表格"], ["quote", "引用"], ["roadmap", "时间脉络"]]) {
    assert.equal(filterSuggestionItems(SLASH_MENU_CATALOG, query)[0]?.title, title, query);
  }
});

test("pinyin initials find their blocks", () => {
  for (const [query, title] of [["bt1", "标题 1"], ["dbsx", "待办事项"], ["dm", "代码"], ["zdbt2", "折叠标题 2"], ["sjml", "时间脉络"]]) {
    assert.equal(filterSuggestionItems(SLASH_MENU_CATALOG, query)[0]?.title, title, query);
  }
});

test("old titles stay searchable as aliases", () => {
  for (const [query, title] of [["Callout", "标注"], ["Tabs", "选项卡"], ["Linked View", "数据源的链接视图"], ["Dashboard", "管理面板视图"], ["数据库 - Inline", "数据库 - 行内"], ["数据库 - Full page", "数据库 - 整页"], ["块公式", "公式区块"], ["面包屑", "路径栏"]]) {
    assert.equal(filterSuggestionItems(SLASH_MENU_CATALOG, query)[0]?.title, title, query);
  }
});

test("every entry has exactly one target", () => {
  assert.equal(new Set(SLASH_MENU_CATALOG.map((item) => item.id)).size, SLASH_MENU_CATALOG.length);
  for (const item of SLASH_MENU_CATALOG) assert.equal(Number(Boolean(item.defaultKey)) + Number(Boolean(item.action)), 1, item.id);
});

test("editorial blocks come last in the advanced group", () => {
  assert.deepEqual(SLASH_MENU_CATALOG.filter((item) => item.group === "高级区块").slice(-4).map((item) => item.title), ["Editorial Card", "Editorial 3 Cards", "Editorial Media / Text", "Editorial Section"]);
});

test("markdown hints belong to catalog entries", () => {
  const ids = new Set(SLASH_MENU_CATALOG.map((item) => item.id));
  for (const [id, hint] of Object.entries(SLASH_MARKDOWN_HINTS)) {
    assert.ok(ids.has(id), id);
    assert.equal(typeof hint, "string");
    assert.ok(hint.trim());
  }
});
