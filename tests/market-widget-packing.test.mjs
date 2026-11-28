import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

const source = new URL("../src/editor/widgets/TravelPackingWidget.jsx", import.meta.url);
const code = transformSync(readFileSync(source, "utf8"), { loader: "jsx", jsx: "automatic", format: "cjs" }).code;
const requireFromWidget = createRequire(source);
const container = { exports: {} };
runInNewContext(code, {
  module: container,
  require(name) {
    if (name.endsWith(".css")) return {};
    if (name === "react") return { useMemo: calculate => calculate(), useState: value => [value, () => {}] };
    return requireFromWidget(name);
  },
});
const { TravelPackingWidget } = container.exports;

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  return node?.props ? [node, ...elements(node.props.children)] : [];
}

test("packing scene changes preserve a legacy list, separate edits and deliberately empty scenes on reopening", () => {
  const personal = [{ id: "my-medicine", name: "个人药物", weight: 25, group: "返程", done: true, note: "用户附注" }];
  let state = { scene: "city", items: personal };
  let changes = 0;
  function view() {
    return elements(TravelPackingWidget({ state, onChange(next) {
      changes++;
      state = JSON.parse(JSON.stringify(next));
    } }));
  }
  function select(name) {
    const button = view().find(el => el.type === "button" && el.props.children === name);
    assert.ok(button);
    button.props.onClick();
  }
  select("城市漫游");
  assert.equal(changes, 0);
  select("海岛度假");
  assert.deepEqual(state.otherScenes.city, personal);
  const first = state.items[0].id;
  view().find(el => el.type === "input" && el.props.type === "checkbox").props.onChange();
  assert.ok(state.items.find(item => item.id === first).done);
  select("城市漫游");
  assert.deepEqual(state.items, personal);
  const remove = view().find(el => el.props["aria-label"] === "删除 个人药物");
  remove.props.onClick({ preventDefault() {} });
  assert.deepEqual(state.items, []);
  select("海岛度假");
  assert.ok(state.items.find(item => item.id === first).done);
  select("城市漫游");
  assert.deepEqual(state.items, []);
  assert.equal(Object.hasOwn(state.otherScenes, "city"), false);
});
