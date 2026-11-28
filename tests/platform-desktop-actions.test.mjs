import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { installTestHooks } from "../electron/main/testHooks.js";
import { resolveFlavor, areTestHooksEnabled } from "../electron/main/flavor.js";
import { registerAppIpc } from "../electron/main/ipc/app.js";

const source = fs.readFileSync(new URL("../electron/main/index.js", import.meta.url), "utf8");

function requiredSource(pattern, description) {
  const match = source.match(pattern);
  assert.ok(match, description);
  return match[0];
}

function preserveGlobals(context) {
  const previous = ["__lifeAtlasTest", "__lifeAtlasNetworkLog", "__lifeAtlasDialogs"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  context.after(() => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
}

function notificationHandler(context) {
  const property = requiredSource(/notify: \(\{ title, body, pageId \}\) => \{[\s\S]*?\n    \},/, "The real main notification handler must be tested");
  return vm.runInContext(`({ ${property} }).notify`, context);
}

function actionFixture(hooks) {
  const actions = [];
  const messages = [];
  let minimized = true;
  const window = {
    isDestroyed: () => false,
    isMinimized: () => minimized,
    restore: () => { minimized = false; actions.push("restore"); },
    show: () => actions.push("show"),
    focus: () => actions.push("focus"),
    webContents: { isDestroyed: () => false, send: (channel, value) => messages.push({ channel, value }) },
  };
  const context = vm.createContext({ testHooks: hooks, workspaceWindow: window });
  const focus = requiredSource(/function focusWindow\(window\) \{[\s\S]*?\n\}/, "Actions must use the real guarded focus helper");
  const send = requiredSource(/function send\(window, channel, value\) \{[\s\S]*?\n\}/, "Actions must use the real guarded send helper");
  const click = requiredSource(/  const notificationClick = \(pageId\) => \{[^\n]*\};/, "Native and simulated notification clicks must share one callback");
  const capture = requiredSource(/  const triggerQuickCapture = \(\) => \{[^\n]*\};/, "Native and simulated shortcuts must share one callback");
  const guard = requiredSource(/if \(testHooks\) \{\s+testHooks\.clickNotification[\s\S]*?\n  \}/, "Action test callbacks must stay inside the test hook guard");
  const callbacks = vm.runInContext(`${focus}\n${send}\n${click}\n${capture}\n${guard}\n({ notificationClick, triggerQuickCapture })`, context);
  return { context, callbacks, actions, messages, window };
}

test("notification test state is fresh and unavailable to release and unauthorized flavors", (context) => {
  preserveGlobals(context);
  const sentinel = {};
  globalThis.__lifeAtlasTest = sentinel;
  for (const [isPackaged, packageJson, authorized] of [[true, { lifeAtlasFlavor: "release" }, "1"], [true, { lifeAtlasFlavor: "test" }, "0"], [false, {}, "0"]]) {
    const env = { LIFE_ATLAS_TEST: authorized };
    assert.equal(installTestHooks({ enabled: areTestHooksEnabled(resolveFlavor({ isPackaged, packageJson }), env), env }), null);
    assert.equal(globalThis.__lifeAtlasTest, sentinel);
    assert.equal(sentinel.notifications, undefined);
  }
  const first = installTestHooks({ enabled: true, now: () => 1000, env: {} });
  assert.deepEqual(first.notifications, []);
  first.notifications.push({ title: "old", body: "old", pageId: "old" });
  const second = installTestHooks({ enabled: true, now: () => 1000, env: {} });
  assert.deepEqual(second.notifications, []);
  assert.notEqual(second.notifications, first.notifications);
  const preload = fs.readFileSync(new URL("../electron/preload/workspace.cjs", import.meta.url), "utf8");
  assert.doesNotMatch(preload, /__lifeAtlasTest|clickNotification|triggerQuickCapture/);
});

test("authorized notifications record only values without touching OS support or constructors", () => {
  const hooks = { notifications: [] };
  const native = new Set();
  const context = vm.createContext({ testHooks: hooks, notifications: native, Notification: { get isSupported() { throw new Error("Authorized tests must never query OS notification support"); } }, notificationClick: () => assert.fail("Recording is not a notification click") });
  const notify = notificationHandler(context);
  const args = { title: "提醒页面", body: "提醒时间 09:00", pageId: "page-reminder", ignored: "must-not-record" };
  assert.equal(Object.keys(notify(args)).length, 0);
  args.title = "changed after invocation";
  assert.deepEqual(JSON.parse(JSON.stringify(hooks.notifications)), [{ title: "提醒页面", body: "提醒时间 09:00", pageId: "page-reminder" }]);
  assert.equal(native.size, 0);
});

test("release notifications preserve native show click focus event and close behavior", () => {
  const state = actionFixture(null);
  const instances = [];
  class NativeNotification extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options = options; this.shown = 0; instances.push(this); }
    show() { this.shown += 1; }
  }
  state.context.Notification = NativeNotification;
  state.context.notifications = new Set();
  const notify = notificationHandler(state.context);
  assert.equal(Object.keys(notify({ title: "提醒页面", body: "提醒时间 09:00", pageId: "page-native" })).length, 0);
  assert.equal(instances.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(instances[0].options)), { title: "提醒页面", body: "提醒时间 09:00", silent: true });
  assert.equal(instances[0].shown, 1);
  assert.equal(state.context.notifications.has(instances[0]), true);
  instances[0].emit("click");
  assert.deepEqual(state.actions, ["restore", "show", "focus"]);
  assert.deepEqual(JSON.parse(JSON.stringify(state.messages)), [{ channel: "la:app:notification-click", value: { pageId: "page-native" } }]);
  instances[0].emit("close");
  assert.equal(state.context.notifications.size, 0);
});

test("unsupported native notifications create no instance and send no event", () => {
  class UnsupportedNotification {
    static isSupported() { return false; }
    constructor() { assert.fail("Unsupported notifications must not be constructed"); }
  }
  const native = new Set();
  const context = vm.createContext({ testHooks: null, Notification: UnsupportedNotification, notifications: native, notificationClick: () => assert.fail("Unsupported notifications must not dispatch") });
  assert.equal(Object.keys(notificationHandler(context)({ title: "提醒页面", body: "09:00", pageId: "page-unsupported" })).length, 0);
  assert.equal(native.size, 0);
});

test("simulated notification clicks validate indices and use the native guarded focus event callback", () => {
  const hooks = { notifications: [{ title: "one", body: "09:00", pageId: "page-one" }, { title: "two", body: "10:00", pageId: "page-two" }] };
  const state = actionFixture(hooks);
  for (const index of [-1, 2, 0.5, NaN, Infinity, "0", null, undefined, {}, 9007199254740992]) {
    assert.throws(() => hooks.clickNotification(index), { name: "TypeError", message: "通知索引无效" });
    assert.deepEqual(state.actions, []);
    assert.deepEqual(state.messages, []);
  }
  hooks.clickNotification(1);
  assert.deepEqual(state.actions, ["restore", "show", "focus"]);
  assert.deepEqual(JSON.parse(JSON.stringify(state.messages)), [{ channel: "la:app:notification-click", value: { pageId: "page-two" } }]);
  state.actions.length = 0;
  state.messages.length = 0;
  state.window.isDestroyed = () => true;
  hooks.clickNotification(0);
  assert.deepEqual(state.actions, []);
  assert.deepEqual(state.messages, []);
});

test("simulated quick capture is the exact registered callback without a renderer test bridge", () => {
  const hooks = { notifications: [] };
  const state = actionFixture(hooks);
  let registered;
  state.context.accelerator = "Ctrl+Alt+Space";
  state.context.shortcutRegistered = false;
  state.context.globalShortcut = { register: (accelerator, callback) => { registered = { accelerator, callback }; return false; } };
  const registration = requiredSource(/  shortcutRegistered = globalShortcut\.register\(accelerator, triggerQuickCapture\);/, "The test hook must reference the real registered shortcut callback");
  vm.runInContext(registration, state.context);
  assert.equal(registered.accelerator, "Ctrl+Alt+Space");
  assert.equal(registered.callback, hooks.triggerQuickCapture);
  assert.equal(hooks.triggerQuickCapture, state.callbacks.triggerQuickCapture);
  assert.equal(state.context.shortcutRegistered, false);
  hooks.triggerQuickCapture();
  assert.deepEqual(state.actions, ["restore", "show", "focus"]);
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].channel, "la:app:quick-capture");
  assert.equal(state.messages[0].value, undefined);
  state.actions.length = 0;
  state.messages.length = 0;
  state.context.workspaceWindow = undefined;
  hooks.triggerQuickCapture();
  assert.deepEqual(state.actions, []);
  assert.deepEqual(state.messages, []);
});

test("notification IPC rejects untrusted frames and invalid arguments before recording", async () => {
  const handlers = new Map();
  const mainFrame = { routingId: 1, processId: 10, isDestroyed: () => false };
  const contents = { id: 42, mainFrame, isDestroyed: () => false };
  const window = { webContents: contents, isDestroyed: () => false };
  const event = { sender: contents, senderFrame: mainFrame };
  const recorded = [];
  registerAppIpc({ ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) }, getWorkspaceWindow: () => window, notify: (args) => { recorded.push(args); return {}; } });
  const notify = handlers.get("la:app:notify");
  const valid = { title: "提醒页面", body: "提醒时间 09:00", pageId: "page-reminder" };
  assert.equal((await notify({ ...event, sender: { id: 42 } }, valid)).error.code, "E_FORBIDDEN");
  assert.equal((await notify({ ...event, senderFrame: { routingId: 2, processId: 10 } }, valid)).error.code, "E_FORBIDDEN");
  for (const invalid of [undefined, null, [], { ...valid, title: " " }, { ...valid, title: "x".repeat(201) }, { ...valid, body: 1 }, { ...valid, body: "x".repeat(2001) }, { ...valid, pageId: "" }, { ...valid, pageId: "x".repeat(201) }, { ...valid, pageId: "unsafe\0id" }]) {
    assert.equal((await notify(event, invalid)).error.code, "E_INVALID_ARGUMENT");
  }
  assert.deepEqual(recorded, []);
  assert.deepEqual(await notify(event, valid), { ok: true, value: {} });
  assert.deepEqual(recorded, [valid]);
});
