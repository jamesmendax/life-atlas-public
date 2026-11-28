import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transform } from "esbuild";

test("roadmap components compile with SVG-only rendering and release-only date writes", async () => {
  for (const name of ["DatabaseRoadmap", "RoadmapSettings"]) {
    const source = readFileSync(new URL(`../src/components/${name}.jsx`, import.meta.url), "utf8");
    const result = await transform(source, { loader: "jsx", jsx: "automatic" });
    assert.ok(result.code.length > 0);
    assert.ok(!/#(?:[0-9a-fA-F]{3}){1,2}\b/.test(source));
    console.log(`SYNTAX_OK=${name}.jsx`);
  }
  const source = readFileSync(new URL("../src/components/DatabaseRoadmap.jsx", import.meta.url), "utf8");
  assert.ok(source.includes("new ResizeObserver"));
  assert.ok(source.includes("<svg"));
  assert.ok(!source.includes("<canvas"));
  assert.ok(source.includes("onPointerDown"));
  assert.ok(source.includes('keyEvent.key === "Escape"'));
  assert.equal((source.match(/onUpdateItemValue\?\.\(/g) || []).length, 1);
  assert.ok(source.includes("commit && !lockedRef.current && active.deltaDays !== 0"));
  assert.ok(source.includes('data-testid="roadmap-view"'));
});

test("roadmap CSS stays in Mobai scope and uses only existing color tokens", () => {
  const css = readFileSync(new URL("../src/ui/themes/mobai/roadmap.css", import.meta.url), "utf8");
  const tokens = readFileSync(new URL("../src/ui/themes/mobai/tokens.css", import.meta.url), "utf8");
  assert.ok(!/#(?:[0-9a-fA-F]{3}){1,2}\b|rgba?\(|hsla?\(/.test(css));
  for (const match of css.matchAll(/var\((--[\w-]+)\)/g)) {
    assert.ok(match[1].startsWith("--mb-"));
    assert.ok(tokens.includes(`${match[1]}:`), match[1]);
  }
  for (const rule of css.split("}")) {
    const selector = rule.slice(rule.lastIndexOf("{") + 1);
    if (!rule.includes("{")) continue;
    const prefix = rule.slice(0, rule.lastIndexOf("{")).replace(/@media[^\{]+\{/, "").trim();
    if (!prefix || selector.trim().length === 0) continue;
    for (const part of prefix.split(/,\s*\n/)) assert.ok(part.trim().startsWith(':root[data-style="mobai"] '), part);
  }
});
