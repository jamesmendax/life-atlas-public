import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

const component = transformSync(readFileSync(new URL("../src/editor/MarketComponentBlock.jsx", import.meta.url), "utf8"),
  { loader: "jsx", format: "cjs", jsx: "automatic", target: "es2022" }).code;
const project = "life-atlas.travel-footprint";
const old = { id: project, version: "1.0.0", sha256: "1".repeat(64), type: "component", compatible: true };
const update = { ...old, version: "2.0.1", sha256: "2".repeat(64) };
const ok = value => ({ ok: true, value });
const unavailable = () => Promise.reject(new Error("source unavailable"));
const jsx = (type, props) => ({ type, props });
const plain = value => JSON.parse(JSON.stringify(value));

function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (node == null || typeof node === "boolean") return [];
  return typeof node === "object" ? [node, ...nodes(node.props?.children)] : [node];
}

function button(tree, name) {
  return nodes(tree).find(node => node.type === "button" &&
    (node.props["aria-label"] ?? nodes(node.props.children).filter(item => typeof item === "string").join("")) === name);
}

async function mount({ catalogue, installed, missing = false, kind = "script", version = old.version, locked = false }) {
  const calls = [];
  const block = { id: "original-journal", type: "marketComponent", props: {
    packageId: project, packageVersion: version, url: "life-asset://" + old.sha256, title: "我的足迹",
    state: JSON.stringify({ records: { "cn-510100": { note: "成都手记" } } }),
  } };
  const runtime = { pageId: "original-page", locked };
  const editor = { isEditable: true, getBlock: id => id === block.id ? block : null, updateBlock(id, change) {
    assert.equal(id, block.id);
    block.props = plain(change.props);
    calls.push(["updateBlock", id]);
  } };
  const bridge = {
    hostWidget: async () => missing ? { ok: false, error: { message: "missing" } } : ok({kind,frameUrl:kind==="frame"?"life-widget://"+"a".repeat(48)+"/index.html":undefined}),
    catalogue: async () => { calls.push(["catalogue"]); return catalogue(); },
    installed: async () => { calls.push(["installed"]); return installed(); },
    preview: async options => { calls.push(["preview", plain(options)]); return ok({token:"selected"}); },
    install: async options => {
      calls.push(["install", plain(options)]);
      return ok({ id: project, version: update.version, url: "life-asset://" + update.sha256 });
    },
  };
  const slots = [];
  const effects = [];
  let cursor = 0;
  const react = {
    useContext: () => runtime,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => value !== slots[index][i])) effects.push(effect);
      slots[index] = deps;
    },
  };
  const module = { exports: {} };
  runInNewContext(component, { module, window: { lifeAtlas: { market: bridge }, addEventListener() {}, dispatchEvent() {} },
    CustomEvent: class {}, require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "@blocknote/react") return { createReactBlockSpec: (_schema, spec) => spec };
      return {};
    } });
  function render() {
    cursor = 0;
    const element = module.exports.MarketComponentBlock.render({ block, editor });
    const result = element.type(element.props);
    for (const effect of effects.splice(0)) effect();
    return result;
  }
  render();
  await setImmediate();
  return { render, block, calls };
}

test("legacy component explicitly selects a signed local upgrade over an older public catalogue and keeps the current journal", async () => {
  const ui = await mount({ catalogue: () => ok({entries:[old]}), installed: () => ok({entries:[
    { ...update, version: "5.0.0", type: "template" }, { ...update, version: "4.0.0", compatible: false },
    { ...update, version: "3.0.0", id: "other.widget" }, { ...update, installed: true },
  ]}) });
  assert.deepEqual(ui.calls, []);
  await button(ui.render(), "从市集检查更新").props.onClick();
  assert.deepEqual(ui.calls.map(call => call[0]), ["catalogue", "installed"]);
  const apply = button(ui.render(), "应用本机版本 2.0.1，保留区块记录");
  assert.ok(apply);
  ui.block.props.state = JSON.stringify({ records: { "cn-510100": { note: "选择更新后继续写的成都手记" } } });
  const before = structuredClone(ui.block.props);
  await apply.props.onClick();
  assert.deepEqual(ui.calls.slice(2), [["preview",{sha256:update.sha256}],["install",{token:"selected"}],["updateBlock","original-journal"]]);
  assert.deepEqual(ui.block.props, { ...before, packageVersion: update.version, url: "life-asset://" + update.sha256 });
});

test("a running rich widget exposes updates only on an editable block and cancels without downloading or changing it", async () => {
  const sources = { kind: "frame", version: "2.0.0", catalogue: () => ok({entries:[update]}), installed: () => ok({entries:[old]}) };
  const readOnly = await mount({...sources,locked:true});
  assert.equal(button(readOnly.render(),"从市集检查更新"),undefined);
  assert.deepEqual(readOnly.calls,[]);
  const active = await mount(sources);
  const before = structuredClone(active.block.props);
  active.render();
  assert.deepEqual(active.calls,[]);
  const check = button(active.render(),"从市集检查更新");
  assert.equal(check.props.title, "从市集检查更新");
  assert.equal(check.props.children.props["aria-hidden"], "true");
  await check.props.onClick();
  assert.ok(button(active.render(),"下载并应用 2.0.1，保留区块记录"));
  button(active.render(),"取消").props.onClick();
  assert.ok(button(active.render(),"从市集检查更新"));
  assert.deepEqual(active.calls.map(call=>call[0]),["catalogue","installed"]);
  assert.deepEqual(active.block.props,before);
});

test("an unavailable source leaves the other source usable for a manual component update", async () => {
  for (const local of [true, false]) {
    const available = () => ok({entries:[{...update, installed:local}]});
    const ui = await mount({ catalogue: local ? unavailable : available, installed: local ? available : unavailable });
    await button(ui.render(), "从市集检查更新").props.onClick();
    const label = local ? "应用本机版本" : "下载并应用";
    assert.ok(button(ui.render(), label + " 2.0.1，保留区块记录"));
  }
});

test("restoring a missing component at the same version requires the exact archive the block references", async () => {
  for (const exact of [false, true]) {
    const available = exact ? old : { ...old, sha256: "a".repeat(64) };
    const ui = await mount({ missing: true, catalogue: () => ok({entries:[available]}), installed: () => ok({entries:[]}) });
    await button(ui.render(), "从市集检查更新").props.onClick();
    assert.equal(Boolean(button(ui.render(), "下载并应用 1.0.0，保留区块记录")), exact);
    assert.ok(ui.calls.every(call => call[0] !== "preview" && call[0] !== "install"));
  }
});
