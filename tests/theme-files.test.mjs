import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const themeParts = ["tokens.css", "base.css", "shell.css", "page.css", "editor.css", "overlays.css", "views.css", "database.css"];
const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

test("mobai theme files are copied verbatim", () => {
  for (const name of themeParts) assert.equal(read(`src/ui/themes/mobai/${name}`), read(`docs/blueprint/design/mobai/theme/${name}`), name);
});
test("the mobai entry imports every part in order", () => {
  const imports = (content) => content.split(/\r?\n/).filter((line) => line.startsWith("@import"));
  assert.deepEqual(imports(read("src/ui/themes/mobai/index.css")).slice(0, 8), imports(read("docs/blueprint/design/mobai/theme/index.css")));
});
test("main.jsx loads the theme after the other stylesheets", () => {
  const main = read("src/main.jsx");
  let previous = -1;
  for (const value of ["./ui/theme-tokens.css", "./ui/product-system.css", "@fontsource-variable/noto-sans-sc", "@fontsource-variable/noto-serif-sc", "./ui/themes/mobai/index.css"]) {
    assert.ok(main.indexOf(value) > previous, value);
    previous = main.indexOf(value);
  }
  assert.ok(main.indexOf("applyTheme(") < main.indexOf("createRoot("));
});
test("no online fonts remain", () => {
  const root = new URL("../src/", import.meta.url);
  const inspect = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) inspect(entryPath);
      else if (/\.(js|jsx|css|html)$/.test(entry.name)) assert.doesNotMatch(readFileSync(entryPath, "utf8"), /fonts\.(googleapis|gstatic)\.com/, entryPath);
    }
  };
  inspect(fileURLToPath(root));
  assert.doesNotMatch(read("index.html"), /fonts\.(googleapis|gstatic)\.com/);
});
