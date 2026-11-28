import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { passwordRules } from "../src/vault-ui/passwordRules.js";
import { checkMasterPassword } from "../electron/main/vault/passwordPolicy.js";

const directory = path.resolve("src/vault-ui");
const i18nDirectory = path.resolve("src/i18n");
const files = fs.readdirSync(directory).filter((file) => /\.jsx?$/.test(file)).map((file) => path.join(directory, file));
const i18nFiles = fs.readdirSync(i18nDirectory, { recursive: true }).filter((file) => /\.jsx?$/.test(file)).map((file) => path.join(i18nDirectory, file));
const allowedExternal = ["react", "react-dom/client", "@tabler/icons-react", "@fontsource-variable/noto-sans-sc", "@fontsource-variable/noto-serif-sc"];
const isAllowedExternalModule = (name) => allowedExternal.includes(name) || /^@tabler\/icons-react\/dist\/esm\/icons\/Icon[A-Za-z0-9]+\.mjs$/.test(name);

test("vault ui imports only allowed modules", () => {
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    for (const match of content.matchAll(/(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g)) {
      if (match[1].startsWith(".")) {
        const windowContrast = file === path.join(directory, "main.jsx") && match[1] === "../ui/windowContrast.js";
        const vaultI18n = ((file === path.join(directory, "main.jsx") || file === path.join(directory, "i18n.js")) && match[1] === "../i18n/vaultRuntime.js") || match[1] === "../i18n/vaultTranslator.js";
        assert.ok(windowContrast || vaultI18n || path.resolve(path.dirname(file), match[1]).startsWith(directory + path.sep), `${file}: ${match[1]}`);
      } else assert.ok(isAllowedExternalModule(match[1]), `${file}: ${match[1]}`);
    }
  }
});

test("vault ui external icon paths stay inside the approved package", () => {
  for (const name of ["@tabler/icons-react", "@tabler/icons-react/dist/esm/icons/IconBox.mjs", "@tabler/icons-react/dist/esm/icons/IconMessageCircle2.mjs"]) assert.equal(isAllowedExternalModule(name), true, name);
  for (const name of ["@tabler/icons", "@tabler/icons-react/dist/esm/createReactComponent.mjs", "@tabler/icons-react/dist/esm/icons/../../../../src/App.jsx", "@tabler/icons-react/dist/esm/icons/IconBox.mjs/extra", "@tabler/icons-react/dist/esm/icons/IconBox.js", "@tabler/icons-react/dist/esm/icons/IconBox.mjs?query", "@tabler/icons-react/dist/esm/icons/IconBox.mjs\n", "node:fs"]) assert.equal(isAllowedExternalModule(name), false, name);
});

test("vault ui never touches browser storage", () => {
  for (const file of [...files, ...i18nFiles]) assert.doesNotMatch(fs.readFileSync(file, "utf8"), /localStorage|sessionStorage|indexedDB|document\.cookie|caches\./i);
});

test("vault ui uses product dialogs instead of native prompts", () => {
  for (const file of [...files, ...i18nFiles]) assert.doesNotMatch(fs.readFileSync(file, "utf8"), /window\.(?:prompt|confirm|alert)\s*\(/);
});

test("renderer password rules match the main process policy", () => {
  for (const password of ["", "123456789012", "abcdefghijkl", "abcabcabcabc", "abcdefghijkx", "我的主密码很长很长很长", "Correct-Horse-9", "Tr0ub4dor&3xyz!!", "ＡＢＣDefg-123456", "Space Kept-48 "]) {
    const renderer = passwordRules(password); const main = checkMasterPassword(password);
    assert.equal(renderer.bits, main.bits); assert.equal(renderer.strength, main.strength); assert.equal(renderer.length, !main.failures.includes("length")); assert.equal(renderer.distinct, !main.failures.includes("distinct")); if (password) assert.equal(renderer.pattern, !main.failures.includes("pattern"));
  }
});
