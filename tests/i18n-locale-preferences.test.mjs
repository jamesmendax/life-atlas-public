import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalePreferences, registerLocaleIpc } from "../electron/main/localePreferences.js";

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "life-atlas-locale-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bootstrapFile = path.join(directory, "bootstrap.json");
  const localeFile = path.join(directory, "locale.json");
  const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value), "utf8");
  return {
    directory,
    localeFile,
    legacy: () => write(bootstrapFile, { dataRoot: directory }),
    saved: (locale) => write(localeFile, { locale }),
    open: (options = {}) => createLocalePreferences({ bootstrapFile, ...options }),
    read: () => JSON.parse(fs.readFileSync(localeFile, "utf8")),
  };
}

test("saved preference wins over legacy and system defaults", (t) => {
  const state = fixture(t);
  state.legacy();
  state.saved("zh-SG");
  const preferences = state.open({ getPreferredSystemLanguages: () => assert.fail("system locales were queried") });
  assert.deepEqual(preferences.get(), { locale: "zh-SG" });
});

test("legacy bootstrap remains zh-CN without a valid preference", (t) => {
  const state = fixture(t);
  state.legacy();
  state.saved("fr-FR");
  const preferences = state.open({ getPreferredSystemLanguages: () => assert.fail("system locales were queried") });
  assert.deepEqual(preferences.get(), { locale: "zh-CN" });
  assert.deepEqual(state.read(), { locale: "fr-FR" });
});

test("first launch matches all five preferred system locales and uses en-US when unmatched", async (t) => {
  for (const [languages, locale] of [
    [["zh-Hans-CN"], "zh-CN"],
    [["fr-FR", "zh-Hans-SG", "en-US"], "zh-SG"],
    [["ja-JP"], "ja-JP"],
    [["en-SG"], "en-SG"],
    [["en-US"], "en-US"],
    [["fr-FR", "de-DE"], "en-US"],
    [[], "en-US"],
  ]) {
    await t.test(languages.join(", ") || "no system locales", (subtest) => {
      const state = fixture(subtest);
      const result = state.open({ getPreferredSystemLanguages: () => languages });
      assert.deepEqual(result.get(), { locale });
      assert.equal(fs.existsSync(state.localeFile), false);
    });
  }
});

test("the system locale test override requires enabled hooks", (t) => {
  const state = fixture(t);
  const getPreferredSystemLanguages = () => ["en-SG"];
  const env = { LIFE_ATLAS_TEST_SYSTEM_LOCALES: "fr-FR, ja-JP, en-US" };
  assert.deepEqual(state.open({ getPreferredSystemLanguages, env }).get(), { locale: "en-SG" });
  assert.deepEqual(state.open({ getPreferredSystemLanguages, env, testHooksEnabled: true }).get(), { locale: "ja-JP" });
  state.legacy();
  assert.deepEqual(state.open({ env, testHooksEnabled: true }).get(), { locale: "zh-CN" });
});

test("saving an effective or chosen locale commits before notification and survives reopening", (t) => {
  const state = fixture(t);
  fs.writeFileSync(state.localeFile, "{", "utf8");
  const preferences = state.open({ getPreferredSystemLanguages: () => ["ja-JP"] });
  const changes = [];
  const unsubscribe = preferences.subscribe((value) => {
    assert.deepEqual(state.read(), value);
    assert.deepEqual(preferences.get(), value);
    changes.push(value);
  });
  assert.deepEqual(preferences.set("ja-JP"), { locale: "ja-JP" });
  assert.deepEqual(state.read(), { locale: "ja-JP" });
  assert.deepEqual(preferences.set("en-SG"), { locale: "en-SG" });
  assert.deepEqual(preferences.set("en-SG"), { locale: "en-SG" });
  unsubscribe();
  preferences.set("zh-SG");
  state.legacy();
  assert.deepEqual(changes, [{ locale: "en-SG" }]);
  assert.deepEqual(state.read(), { locale: "zh-SG" });
  assert.deepEqual(state.open().get(), { locale: "zh-SG" });
  assert.deepEqual(fs.readdirSync(state.directory).sort(), ["bootstrap.json", "locale.json"]);
});

test("invalid locales and failed replacements leave the effective preference untouched", (t) => {
  const state = fixture(t);
  const preferences = state.open();
  preferences.subscribe(() => assert.fail("failed writes must not notify"));
  for (const value of ["es-ES", "EN-US", " en-US ", "", null, undefined, { locale: "ja-JP" }]) {
    assert.throws(() => preferences.set(value), TypeError);
  }
  assert.deepEqual(fs.readdirSync(state.directory), []);
  fs.mkdirSync(state.localeFile);
  assert.throws(() => preferences.set("ja-JP"));
  assert.deepEqual(preferences.get(), { locale: "en-US" });
  assert.deepEqual(fs.readdirSync(state.directory), ["locale.json"]);
});

test("locale IPC trusts only listed main frames and permits writes only from workspace and setup", (t) => {
  const state = fixture(t);
  const handlers = new Map();
  const windows = Array.from({ length: 5 }, (_, id) => ({
    webContents: { id, mainFrame: { processId: id, routingId: 1 } },
  }));
  const [workspace, setup, vault, preview, otherPreview] = windows;
  const eventFor = (window) => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  registerLocaleIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    preferences: state.open(),
    getWindows: () => windows,
    getWritableWindows: () => [workspace, setup],
  });
  const get = handlers.get("la:locale:get");
  const set = handlers.get("la:locale:set");
  for (const window of windows) assert.deepEqual(get(eventFor(window)), { ok: true, value: { locale: "en-US" } });
  for (const window of [vault, preview, otherPreview]) assert.equal(set(eventFor(window), { locale: "ja-JP" }).error.code, "E_FORBIDDEN");
  const workspaceEvent = eventFor(workspace);
  assert.equal(get({ ...workspaceEvent, senderFrame: { processId: 0, routingId: 2 } }).error.code, "E_FORBIDDEN");
  assert.equal(get({ sender: { id: 2 }, senderFrame: vault.webContents.mainFrame }).error.code, "E_FORBIDDEN");
  assert.equal(get(workspaceEvent, undefined).error.code, "E_INVALID_ARGUMENT");
  for (const input of [undefined, "ja-JP", null, {}, ["ja-JP"], { locale: "ja-JP", extra: true }, { locale: "ja-jp" }]) {
    assert.equal(set(workspaceEvent, input).error.code, "E_INVALID_ARGUMENT");
  }
  assert.equal(set(workspaceEvent, { locale: "ja-JP" }, null).error.code, "E_INVALID_ARGUMENT");
  assert.deepEqual(set(workspaceEvent, { locale: "ja-JP" }), { ok: true, value: { locale: "ja-JP" } });
  assert.deepEqual(set(eventFor(setup), { locale: "zh-SG" }), { ok: true, value: { locale: "zh-SG" } });
  assert.deepEqual(get(eventFor(otherPreview)), { ok: true, value: { locale: "zh-SG" } });
});
