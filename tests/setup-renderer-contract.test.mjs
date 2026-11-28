import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { registerSetupIpc } from "../electron/main/ipc/setup.js";
import { DEFAULT_LEGACY_LOCALE, LOCALE_METADATA, SUPPORTED_LOCALES } from "../src/i18n/locales.js";

const component = transformSync(fs.readFileSync(new URL("../src/setup-ui/SetupApp.jsx", import.meta.url), "utf8"), { loader: "jsx", format: "cjs", jsx: "automatic", target: "es2022" }).code;
const dataRoot = "D:/isolated-setup-contract/data";
const restoreToken = "selected-backup-inspection-token";

function setupIpc() {
  const handlers = new Map();
  const calls = [];
  const mainFrame = { routingId: 7, processId: 11 };
  const contents = { id: 3, mainFrame };
  const window = { webContents: contents };
  registerSetupIpc({
    ipcMain: { handle: (channel, operation) => handlers.set(channel, operation), removeHandler: (channel) => handlers.delete(channel) },
    getSetupWindow: () => window,
    service: { finish: async (payload) => { calls.push(payload); return {}; } },
  });
  return { calls, invoke: (payload) => handlers.get("la:setup:finish")({ sender: contents, senderFrame: mainFrame }, structuredClone(payload)) };
}

function findPrimaryButton(node) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findPrimaryButton(child);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  if (node.type === "button" && node.props?.className === "btn-primary") return node;
  return findPrimaryButton(node.props?.children);
}

async function completeFromRenderer(start) {
  const ipc = setupIpc();
  const results = [];
  const hooks = [2, dataRoot, dataRoot, { kind: "missing", level: "ok" }, start, start === "restore" ? { token: restoreToken } : null, null, "", "", false, false];
  let hookIndex = 0;
  const react = {
    useEffect() {},
    useState(initial) {
      const current = hookIndex++;
      assert.ok(current < hooks.length);
      return [hooks[current] === undefined ? initial : hooks[current], (value) => { hooks[current] = typeof value === "function" ? value(hooks[current]) : value; }];
    },
  };
  const jsxRuntime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "fragment" };
  const module = { exports: {} };
  const realm = vm.createContext({
    module,
    exports: module.exports,
    window: { lifeAtlasSetup: { finish: async (payload) => { const result = await ipc.invoke(payload); results.push(result); return result; } } },
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name === "../i18n/surfaces.js") return {
        useI18n: () => ({ locale: DEFAULT_LEGACY_LOCALE, locales: SUPPORTED_LOCALES, metadata: LOCALE_METADATA, t: (key) => key }),
      };
      if (name === "@tabler/icons-react") return new Proxy({}, { get: (target, icon) => icon });
      const iconModule = /^@tabler\/icons-react\/dist\/esm\/icons\/(Icon[A-Za-z0-9]+)\.mjs$/.exec(name);
      if (iconModule) return { __esModule: true, default: iconModule[1] };
      throw new Error(`Unexpected component dependency: ${name}`);
    },
  });
  vm.runInContext(component, realm, { filename: "SetupApp.jsx" });
  const button = findPrimaryButton(module.exports.SetupApp());
  assert.ok(button);
  assert.equal(button.props.disabled, false);
  await button.props.onClick();
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true, results[0].error?.code);
  assert.equal(hooks[8], "");
  assert.equal(ipc.calls.length, 1);
  return ipc.calls[0];
}

test("blank setup completion reaches finish without a restore token", async () => {
  const payload = await completeFromRenderer("blank");
  assert.deepEqual(payload, { dataRoot, start: "blank" });
  assert.equal(Object.hasOwn(payload, "token"), false);
});

test("restore setup completion forwards the selected inspection token", async () => {
  assert.deepEqual(await completeFromRenderer("restore"), { dataRoot, start: "restore", token: restoreToken });
});

test("setup completion keeps strict blank and restore token validation", async () => {
  const ipc = setupIpc();
  for (const payload of [{ dataRoot, start: "blank", token: null }, { dataRoot, start: "blank", token: restoreToken }, { dataRoot, start: "restore" }, { dataRoot, start: "restore", token: null }, { dataRoot, start: "restore", token: "" }]) {
    const result = await ipc.invoke(payload);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "E_INVALID_ARGUMENT");
  }
  assert.deepEqual(ipc.calls, []);
});
