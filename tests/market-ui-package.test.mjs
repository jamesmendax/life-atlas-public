import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buffer } from "node:stream/consumers";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import yazl from "yazl";
import { marketHash, verifyMarketPack } from "../electron/main/market/package.js";
import { componentMime, createMarketService } from "../electron/main/market/service.js";
import { createWidgetProtocol } from "../electron/main/market/widgetProtocol.js";

const signer = generateKeyPairSync("ed25519");
const options = { appVersion: "1.3.1", publicKeys: [signer.publicKey.export({ format: "pem", type: "spki" })] };
const source = Buffer.from("(() => { throw Error('verification executed submitted UI'); })();");

async function makeUi(overrides = {}, contents = new Map([["ui.js", source]]), changed) {
  const manifest = Buffer.from(JSON.stringify({
    formatVersion: 1, kind: "life-atlas-market-package", id: "community.reader.counter", type: "component",
    title: "计数", description: "静态验签样例", version: "2.0.0", minAppVersion: "1.3.1", apiVersion: 2,
    files: [...contents].map(([path, bytes]) => ({ path, size: bytes.length, sha256: marketHash(bytes) })),
    ...overrides,
  }));
  const zip = new yazl.ZipFile();
  zip.addBuffer(manifest, "manifest.json");
  zip.addBuffer(Buffer.from(sign(null, manifest, signer.privateKey).toString("base64")), "manifest.sig");
  for (const [name, bytes] of contents) zip.addBuffer(changed?.get(name) || bytes, name);
  const archive = buffer(zip.outputStream);
  zip.end();
  return archive;
}

test("rich UI grants only the reviewed permissions included in its signed manifest", async () => {
  const empty = await verifyMarketPack(await makeUi(), options);
  assert.deepEqual(empty.capabilities, []);
  assert.deepEqual(empty.uiFiles.get("ui.js"), source);
  for (const permissions of [["trip-routing"], ["widget-audio"]]) {
    const verified = await verifyMarketPack(await makeUi({ permissions }), options);
    assert.deepEqual(verified.capabilities, permissions);
  }
  for (const permissions of [["arbitrary-fs"], ["trip-routing", "trip-routing"], "widget-audio"]) {
    await assert.rejects(verifyMarketPack(await makeUi({ permissions }), options), /未知或重复/u);
  }
});

test("rich UI requires a compatible app, a signed entry script, and individually verified allowed resources", async () => {
  const contents = new Map([["ui.js", source], ["ui.css", Buffer.from("body{}")], ["assets/test.json", Buffer.from('{"n":1}')]]);
  await assert.rejects(verifyMarketPack(await makeUi({}, contents), { ...options, appVersion: "1.3.0" }), { code: "E_UNSUPPORTED_VERSION" });
  await assert.rejects(verifyMarketPack(await makeUi({ minAppVersion: "1.1.0" }, contents), options), { code: "E_CORRUPT" });
  await assert.rejects(verifyMarketPack(await makeUi({}, contents, new Map([["assets/test.json", Buffer.from('{"n":2}')]])), options), /校验失败/u);
  for (const name of ["assets/guide.html", "assets/script.js", "ui.html", "index.js", "host-preview-keys.js", "assets/a.svg"]) {
    const bad = new Map(contents).set(name, Buffer.from("unsupported"));
    await assert.rejects(verifyMarketPack(await makeUi({}, bad), options), /不支持或过大/u);
  }
  await assert.rejects(verifyMarketPack(await makeUi({}, new Map([["ui.css", Buffer.from("body{}")]])), options), /缺少 ui.js/u);
});

test("the desktop frame confines the timer resize target without changing package files or other widgets", async () => {
  const signedCss = Buffer.from(".pomodoro-resize { inset-inline-end: -11px; }");
  const files = new Map([["ui.js", source], ["ui.css", signedCss]]);
  const protocol = createWidgetProtocol();
  const read = (lease, name, destination) => protocol.serve(new Request(new URL(name, lease.frameUrl), {
    headers: { "sec-fetch-dest": destination },
  }));
  for (const id of ["life-atlas.pomodoro", "community.reader.counter"]) {
    const signed = await verifyMarketPack(await makeUi({ id }, files), options);
    const lease = protocol.open(signed);
    const index = await read(lease, "index.html", "iframe").text();
    if (id === "life-atlas.pomodoro") {
      assert.match(index, /href="\.\/ui\.css"><style>[^<]*\.pomodoro-resize\s*\{\s*inset-inline-end: 0;/u);
      assert.match(index, /scrollbar-width: none/u);
    } else assert.doesNotMatch(index, /pomodoro-resize|scrollbar-width/u);
    assert.deepEqual(Buffer.from(await read(lease, "ui.css", "style").arrayBuffer()), signedCss);
  }
});

test("installed historic UI receives host keyboard handling only in its own live preview lease", async (t) => {
  const distribution = new URL("../market/public/", import.meta.url);
  const archive = new URL("packages/life-atlas.travel-footprint-2.0.1.atlaspack", distribution);
  const bytes = await readFile(archive);
  const hash = marketHash(bytes);
  const url = "life-asset://" + hash;
  const service = createMarketService({
    appVersion: "1.3.1", directory: fileURLToPath(distribution), runtime: { close() {} },
    assetStore: { get: id => id === hash ? { mime: componentMime, size: bytes.length } : null, filePath: () => fileURLToPath(archive) },
  });
  t.after(() => service.close());
  const read = (lease, name, dest) => service.serveWidgetResource(new Request(new URL(name, lease.frameUrl), { headers: { "sec-fetch-dest": dest } }));
  const editor = await service.hostWidget({ url });
  const trial = await service.hostWidget({ url, preview: true });
  const script = "host-preview-keys.js";
  assert.notEqual(editor.frameUrl, trial.frameUrl);
  const editorPage = read(editor, "index.html", "iframe");
  const trialPage = read(trial, "index.html", "iframe");
  assert.doesNotMatch(await editorPage.text(), /host-preview-keys/u);
  assert.match(await trialPage.text(), /src="\.\/host-preview-keys\.js"/u);
  const policy = trialPage.headers.get("Content-Security-Policy");
  const ownOrigin = trial.frameUrl.slice(0, -"/index.html".length);
  assert.ok(policy.split("; ").includes("script-src " + ownOrigin));
  assert.ok(policy.split("; ").includes("sandbox allow-scripts"));
  assert.ok(policy.split("; ").includes("frame-ancestors app://bundle"));
  assert.equal(read(editor, script, "script").status, 404);
  assert.equal(read(trial, script, "iframe").status, 404);
  const keys = read(trial, script, "script");
  assert.equal(keys.status, 200);
  assert.equal(keys.headers.get("Content-Type"), "text/javascript");
  assert.deepEqual(await read(trial, "ui.js", "script").arrayBuffer(), await read(editor, "ui.js", "script").arrayBuffer());

  let handler, nativeDialog;
  const messages = [];
  runInNewContext(await keys.text(), {
    document: { querySelector: () => nativeDialog },
    window: {
      addEventListener(name, listener) { assert.equal(name, "keydown"); handler = listener; },
      parent: { postMessage: (message, origin) => messages.push([message.type, message.channel, origin]) },
    },
  });
  const escape = { key: "Escape", isTrusted: true };
  for (const flags of [{ key: "Enter" }, { isTrusted: false }, { defaultPrevented: true }, { isComposing: true }, { keyCode: 229 }, { repeat: true }, { altKey: true }]) handler({ ...escape, ...flags });
  nativeDialog = {}; handler(escape);
  assert.equal(messages.length, 0);
  nativeDialog = null; handler(escape);
  assert.deepEqual(messages, [["preview-escape", "life-atlas.widget.v1", "app://bundle"]]);
  assert.equal(service.releaseFrame({ frameUrl: trial.frameUrl }).released, true);
  assert.equal(read(trial, script, "script").status, 404);
  assert.equal(read(editor, "ui.js", "script").status, 200);
  await assert.rejects(service.hostWidget({ url, preview: 1 }), { code: "E_INVALID_ARGUMENT" });
});
