import test from "node:test";
import assert from "node:assert/strict";
import { isRemoteUrl, remotePlaceholderDataUrl, resolveEditorFileUrl } from "../src/editor/remoteMedia.js";

test("remote urls become a local placeholder", async () => {
  for (const url of ["https://example.com/a.png", "http://example.com/a.png"]) {
    assert.equal(isRemoteUrl(url), true);
    assert.match(await resolveEditorFileUrl(url), /^data:image\/svg\+xml/);
  }
});

test("local asset blob and data urls pass through", async () => {
  for (const url of [`life-asset://${"a".repeat(64)}`, "blob:http://127.0.0.1:5178/x", "data:image/png;base64,AA=="]) {
    assert.equal(isRemoteUrl(url), false);
    assert.equal(await resolveEditorFileUrl(url), url);
  }
});

test("the placeholder shows the host name and escapes it", () => {
  const decode = (url) => decodeURIComponent(remotePlaceholderDataUrl(url).slice("data:image/svg+xml;charset=utf-8,".length));
  const ordinary = decode("https://example.com/a.png");
  assert.match(ordinary, /example\.com/);
  assert.match(ordinary, /外部内容（未加载）/);
  const quoted = decode('https://a"b.example/x');
  assert.ok(quoted.includes("a&quot;b.example"));
  assert.ok(!quoted.includes('a"b'));
  assert.ok(decode("https://exa mple.com/x").includes("未知地址"));
});
