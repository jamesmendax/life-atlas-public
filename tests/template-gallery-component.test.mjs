import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transform } from "esbuild";
import { parse } from "postcss";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("marketplace and template preview compile with accessible template actions", async () => {
  const market = read("../src/components/MarketplaceView.jsx");
  const preview = read("../src/templates/previews.jsx");
  for (const [name, source] of [["MarketplaceView", market], ["TemplatePreview", preview]]) {
    const result = await transform(source, { loader: "jsx", jsx: "automatic" });
    assert.ok(result.code.length > 0);
    assert.ok(!/#(?:[0-9a-fA-F]{3}){1,2}\b/.test(source));
    console.log(`SYNTAX_OK=${name}.jsx`);
  }
  assert.match(market, /<section className="market-page" aria-label="模板与小组件市场">/);
  assert.match(market, /<div className="mp-tabs" role="tablist" aria-label="市场分区">/);
  assert.match(market, /<form className="mp-action-form" onSubmit=\{handleUseTemplateSubmit\}>/);
  assert.match(market, /<MobaiTargetPicker\s+ariaLabel="模板目标文件夹"/);
  assert.match(market, /role="switch"\s+aria-label="包含示例数据"\s+aria-checked=\{includeSampleData\}/);
  assert.match(market, /await dialogs\.confirm\(\{\s+title: "删除模板"/);
  assert.match(market, /await onUseTemplate\(activeWork\.raw/);
  assert.match(market, /maxLength=\{100\}/);
  assert.doesNotMatch(market, /dangerouslySetInnerHTML|window\.prompt/);
});

test("roadmap template preview reproduces the prototype SVG geometry", () => {
  const source = read("../src/templates/previews.jsx");
  assert.match(source, /viewBox="0 0 320 180"/);
  assert.equal((source.match(/className="thumb-grid"/g) || []).length, 3);
  assert.equal((source.match(/className="thumb-ms(?: is-done)?"/g) || []).length, 3);
  assert.equal((source.match(/className="thumb-phase(?: is-done)?"/g) || []).length, 5);
  assert.match(source, /className="thumb-major" cx="276" cy="100" r="8"/);
  assert.match(source, /className="thumb-today" x1="122" y1="44" x2="122" y2="160"/);
  assert.match(source, /className="thumb-done" x1="10" y1="100" x2="122" y2="100"/);
  assert.match(source, /size === "large"/);
  assert.equal((source.match(/<span \/>/g) || []).length, 3);
});

test("marketplace styles fit the workspace canvas and use Mobai theme tokens", () => {
  const css = read("../src/ui/themes/mobai/market.css");
  const tokens = read("../src/ui/themes/mobai/tokens.css");
  const scope = ':root[data-style="mobai"] ';
  const rules = parse(css);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
  for (const match of css.matchAll(/var\((--[\w-]+)/g)) {
    assert.ok(match[1].startsWith("--mb-"), match[1]);
    assert.ok(tokens.includes(`${match[1]}:`), match[1]);
  }
  rules.walkRules((rule) => {
    for (const selector of rule.selectors) assert.ok(selector.startsWith(scope), selector);
  });
  const declaration = (selector, property, media) => {
    let value;
    rules.walkRules(`${scope}${selector}`, (rule) => {
      if ((rule.parent.type === "atrule" ? rule.parent.params : undefined) === media) {
        rule.walkDecls(property, (entry) => { value = entry.value; });
      }
    });
    return value;
  };
  assert.equal(declaration(".workspace-scroll:has(> .market-page)", "padding"), "0");
  assert.equal(declaration(".market-page", "width"), "100%");
  assert.equal(declaration(".market-page", "background"), "var(--mb-paper)");
  assert.equal(declaration(".mp-browse-canvas", "overflow-y"), "auto");
  assert.equal(declaration(".mp-detail-canvas", "overflow-y"), "auto");
  assert.equal(declaration(".mp-detail-grid", "grid-template-columns", "(max-width: 960px)"), "1fr");
});

test("roadmap preview uses the shared template typography and colors", () => {
  const css = read("../src/ui/themes/mobai/templates.css");
  assert.match(css, /\.thumb-num text \{ font: 600 18px/);
  assert.match(css, /\.thumb\.is-big \.thumb-num text \{ font-size: 17px/);
  assert.match(css, /\.thumb-major \{ fill: var\(--mb-accent\)/);
  assert.match(css, /\.thumb-ms \{ fill: var\(--mb-paper\)/);
});
