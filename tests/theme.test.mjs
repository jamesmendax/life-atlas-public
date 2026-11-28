import test from "node:test";
import assert from "node:assert/strict";
import { applyTheme, nextThemePreference, normalizeThemePreference, readCachedPreference, resolveTheme, writeCachedPreference } from "../src/ui/theme.js";
import { normalizeLoadedWorkspace } from "../src/persistence/normalize.js";
import { FIXTURE_TIME, fullWorkspace } from "./fixtures/full-workspace.mjs";

test("theme preference resolves with the system setting", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});
test("unknown preferences fall back to system", () => {
  assert.equal(normalizeThemePreference("blue"), "system");
  assert.equal(normalizeThemePreference(undefined), "system");
  assert.equal(resolveTheme("blue", true), "dark");
});
test("the toggle cycles system light dark", () => {
  assert.equal(nextThemePreference("system"), "light");
  assert.equal(nextThemePreference("light"), "dark");
  assert.equal(nextThemePreference("dark"), "system");
});
test("applyTheme sets the style and the mode", () => {
  const root = { dataset: {} };
  applyTheme("dark", root);
  assert.deepEqual(root.dataset, { style: "mobai", theme: "dark" });
  applyTheme("weird", root, "unknown");
  assert.deepEqual(root.dataset, { style: "mobai", theme: "light" });
});
test("the cached preference survives bad storage", () => {
  const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("full"); } };
  assert.equal(readCachedPreference(broken), "system");
  assert.doesNotThrow(() => writeCachedPreference("dark", broken));
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  writeCachedPreference("dark", storage);
  assert.equal(readCachedPreference(storage), "dark");
});
test("preferences get the theme default", () => {
  for (const [preference, expected] of [[undefined, "system"], ["dark", "dark"], ["blue", "system"]]) {
    const workspace = fullWorkspace();
    if (preference !== undefined) workspace.ui.preferences = { theme: preference, untouched: true };
    const normalized = normalizeLoadedWorkspace(workspace, { fallbackWorkspace: fullWorkspace(), now: FIXTURE_TIME, idFactory: (prefix) => `${prefix}-theme-test` });
    assert.equal(normalized.ui.preferences.theme, expected);
    assert.deepEqual(normalized.ui.expandedFolderIds, workspace.ui.expandedFolderIds);
    if (preference !== undefined) assert.equal(normalized.ui.preferences.untouched, true);
  }
});

test("preferences get font and start page defaults", () => {
  for (const [preferences, font, startPage] of [[{ theme: "dark" }, "default", "last"], [{ theme: "light", defaultFont: "serif", startPage: "home" }, "serif", "home"], [{ theme: "system", defaultFont: "unknown", startPage: "cloud" }, "default", "last"]]) {
    const workspace = fullWorkspace();
    workspace.ui.preferences = preferences;
    const before = structuredClone(workspace);
    const normalized = normalizeLoadedWorkspace(workspace, { now: FIXTURE_TIME, idFactory: (prefix) => `${prefix}-settings-test` });
    assert.equal(normalized.ui.preferences.defaultFont, font);
    assert.equal(normalized.ui.preferences.startPage, startPage);
    assert.equal(normalized.ui.preferences.theme, preferences.theme);
    assert.deepEqual(workspace, before);
  }
});
