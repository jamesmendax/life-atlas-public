import test from "node:test";
import assert from "node:assert/strict";
import { credentialSecretSignature, normalizeAccount, normalizeDedupeScope, normalizeSiteIdentity } from "../electron/main/vault/siteKey.js";

test("site grouping uses the main domain while dedupe distinguishes full URL hosts", () => {
  const entry = { url: " HTTPS://WWW.Platform.OpenAI.COM:443/docs?q=site#top ", website: " OpenAI ", title: "Enrollment" };
  const site = normalizeSiteIdentity(entry);
  assert.deepEqual(site, { name: "OpenAI", url: "https://www.platform.openai.com/docs?q=site#top", siteKey: "openai.com" });
  assert.equal(normalizeSiteIdentity({ url: "https://openai.com" }).siteKey, site.siteKey);
  assert.equal(normalizeDedupeScope({ ...entry, siteKey: site.siteKey }), "platform.openai.com");
  assert.equal(normalizeDedupeScope({ url: "http://www.openapi.example:80/login" }), "openapi.example");
  assert.equal(normalizeSiteIdentity({ url: "https://www.admin.company.com.cn", title: " Console " }).name, "Console");
  for (const suffix of ["com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "co.uk", "org.uk", "ac.uk", "co.jp", "ne.jp", "or.jp",
    "com.au", "com.hk", "com.tw", "com.sg", "co.kr", "com.br"]) {
    assert.equal(normalizeSiteIdentity({ url: `https://www.admin.company.${suffix}` }).siteKey, `company.${suffix}`);
  }
});

test("tenant domains, non-default ports, IP literals, and localhost retain their full hosts", () => {
  for (const suffix of ["github.io", "vercel.app", "pages.dev", "netlify.app", "workers.dev", "web.app", "firebaseapp.com", "appspot.com",
    "herokuapp.com", "fly.dev", "railway.app", "render.com", "onrender.com", "amazonaws.com", "cloudfront.net", "azurewebsites.net",
    "aliyuncs.com", "myqcloud.com", "gitee.io", "notion.site"]) {
    assert.equal(normalizeSiteIdentity({ url: `https://docs.a.${suffix}` }).siteKey, `docs.a.${suffix}`);
  }
  const cases = [
    ["https://a.github.io", "a.github.io"],
    ["https://b.github.io", "b.github.io"],
    ["https://admin.fakegithub.io", "fakegithub.io"],
    ["http://localhost:3000", "localhost:3000"],
    ["http://localhost:8080", "localhost:8080"],
    ["http://app.localhost", "app.localhost"],
    ["http://127.0.0.1:80", "127.0.0.1"],
    ["http://127.0.0.1:443", "127.0.0.1:443"],
    ["https://[2001:0DB8::1]:8443", "[2001:db8::1]:8443"],
    ["https://www.admin.company.co.uk:444", "admin.company.co.uk:444"],
  ];
  for (const [url, key] of cases) assert.equal(normalizeSiteIdentity({ url }).siteKey, key);
  assert.equal(normalizeDedupeScope({ url: "http://[::1]:3000" }), "[::1]:3000");
});

test("named sites and title-only dedupe scopes work without inferring a group from titles", () => {
  const site = normalizeSiteIdentity({ url: "javascript:alert(1)", website: " Example Team ", title: "Console" });
  assert.deepEqual(site, { name: "Example Team", url: "", siteKey: "site:example team" });
  assert.equal(normalizeDedupeScope({ siteKey: site.siteKey, title: "Console" }), "site:example team");
  assert.equal(normalizeDedupeScope({ url: "invalid", title: " Console " }), "console");
  assert.equal(normalizeSiteIdentity({ url: "https://user:password@example.com", title: "Console" }), null);
  assert.equal(normalizeSiteIdentity({ website: "https://user:password@example.com" }), null);
  assert.equal(normalizeSiteIdentity({ title: "Console" }), null);
});

test("accounts normalize email casing while secret signatures preserve exact content and order", () => {
  assert.equal(normalizeAccount("  User@EXAMPLE.COM "), "user@example.com");
  assert.equal(normalizeAccount(" User "), "User");
  assert.equal(normalizeAccount(null), "");
  const first = { kind: "secret", label: "密钥", value: " Élise\n\r\n " };
  const second = { kind: "secret", label: "API Key", value: "Secret" };
  const excluded = [{ kind: "secret", value: "" }, { kind: "totp", value: "MASK" }, { kind: "text", value: "Public" }];
  assert.equal(credentialSecretSignature(excluded), null);
  assert.equal(credentialSecretSignature([first, ...excluded]), first.value);
  assert.equal(credentialSecretSignature([{ ...first, label: "密码" }]), first.value);
  assert.notEqual(credentialSecretSignature([first]), credentialSecretSignature([{ ...first, value: first.value.trim() }]));
  assert.equal(credentialSecretSignature([first, second]), JSON.stringify([first.value, second.value]));
  assert.notEqual(credentialSecretSignature([first, second]), credentialSecretSignature([second, first]));
});
