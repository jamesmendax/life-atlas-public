import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buffer } from "node:stream/consumers";
import test from "node:test";
import yazl from "yazl";
import { marketHash } from "../electron/main/market/package.js";
import { createMarketService, componentMime, marketBaseUrl } from "../electron/main/market/service.js";
import { createAssetCleanupService } from "../electron/main/storage/assetCleanup.js";
import { replaceDatabaseWorkspace } from "../electron/main/storage/workspaceDb.js";
import { createSnapshot, snapshotDirectory } from "../electron/main/storage/snapshots.js";
import { exportFullBackup } from "../electron/main/backup/desktopExport.js";
import { restoreFromToken } from "../electron/main/backup/desktopRestore.js";
import { createBackupInspector } from "../electron/main/backup/inspection.js";
import { createDesktopBackupContext } from "./desktop/backup-helpers.mjs";
import { PNG_1X1_BASE64, FIXTURE_TIME } from "./fixtures/full-workspace.mjs";

const appVersion = "1.3.1";
const url = "https://market.example.invalid/";
const signer = generateKeyPairSync("ed25519");
const png = Buffer.from(PNG_1X1_BASE64, "base64");
const pngThumbnail = { url: `data:image/png;base64,${png.toString("base64")}` };
const asJson = (value) => Buffer.from(JSON.stringify(value));
const source = Buffer.from("document.getElementById('root').textContent = '测试组件';");

async function archive(id, { template = false, permissions = [], key = signer.privateKey } = {}) {
  const files = template
    ? [["template.json", asJson({ title: "测试页", blocks: [{ type: "image", props: { url: "asset:assets/test.png" } }] })], ["assets/test.png", png]]
    : [["ui.js", source], ["ui.css", Buffer.from("body { color: navy; }")], ["assets/data.json", asJson({ value: 18 })]];
  const meta = { id, type: template ? "template" : "component", version: "1.0.0", minAppVersion: appVersion, title: "自定义 " + id, description: "测试资源" };
  const manifest = asJson({ ...meta, kind: "life-atlas-market-package", formatVersion: 1, ...(!template ? { apiVersion: 2, permissions } : {}),
    files: files.map(([name, bytes]) => ({ path: name, size: bytes.length, sha256: marketHash(bytes) })) });
  const zip = new yazl.ZipFile();
  for (const [name, bytes] of [["manifest.json", manifest], ["manifest.sig", Buffer.from(sign(null, manifest, key).toString("base64"))], ...files]) zip.addBuffer(bytes, name);
  const stream = buffer(zip.outputStream);
  zip.end();
  const bytes = await stream;
  return { bytes, entry: { ...meta, size: bytes.length, sha256: marketHash(bytes), packagePath: `packages/${id}.atlaspack`, previewPath: "previews/sample.png" } };
}

async function setup(t, packages, fixture, onRemoveResources) {
  fixture ??= await createDesktopBackupContext(t, { appVersion, seed: false });
  const directory = path.join(fixture.dataRoot, "market-test");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "trusted-keys.json"), asJson({ publicKeys: [signer.publicKey.export({ format: "pem", type: "spki" })] }));
  const index = asJson({ formatVersion: 1, entries: packages.map((p) => p.entry) });
  fs.writeFileSync(path.join(directory, "catalog-v2.json"), index);
  const replies = new Map([["catalog-v2.json", index], ["previews/sample.png", png], ...packages.map((p) => [p.entry.packagePath, p.bytes])]);
  const requests = [];
  let online = true, selectedFile, service;
  const cleanup = createAssetCleanupService({ dataRoot: fixture.dataRoot, db: () => fixture.workspaceService.db, installedMarketAssets: () => service.installedAssetIds() });
  service = createMarketService({ appVersion, directory, assetStore: fixture.assetStore, assetCleanup: cleanup, onRemoveResources,
    baseUrl: url, fetchImpl: async (requestUrl, options) => {
      const name = requestUrl.slice(url.length);
      requests.push(name);
      if (online && typeof replies.get(name) === "function") return replies.get(name)(options.signal);
      return online && replies.has(name) ? new Response(replies.get(name)) : new Response(null, { status: 404 });
    }, dialogs: { showOpenDialog: async () => ({ canceled: !selectedFile, filePaths: [selectedFile] }) }, getWindow: () => null,
    runtime: { run: () => assert.fail("v2 never starts a v1 worker"), close() {} } });
  t.after(() => service.close());
  return { ...fixture, service, cleanup, directory, replies, requests, offline: () => { online = false; }, online: () => { online = true; }, choose: (f) => { selectedFile = f; } };
}

const resource = (service, frameUrl, name = "index.html", properties = {}) =>
  service.serveWidgetResource({ url: frameUrl.replace(/index\.html$/u, name), method: "GET", headers: new Headers(), ...properties });

test("legacy catalogue browsing never downloads an original template image, even when its preview is requested directly", async (t) => {
  const fixture = await createDesktopBackupContext(t, { appVersion, seed: false });
  const source = new URL("../market/public/", import.meta.url);
  const read = (name) => fs.readFileSync(new URL(name, source));
  const legacy = JSON.parse(read("catalog.json")).entries.find(entry => entry.id === "life-atlas.focus-study");
  const rich = JSON.parse(read("catalog-v2.json")).entries.find(entry => entry.id === legacy.id);
  const directory = path.join(fixture.dataRoot, "legacy-catalogue");
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "catalog.json"), read("catalog.json"));
  fs.writeFileSync(path.join(directory, "trusted-keys.json"), read("trusted-keys.json"));
  const requests = [];
  let index = "catalog.json";
  const distributionPaths = [legacy.previewPath, rich.previewPath, legacy.packagePath];
  const service = createMarketService({
    appVersion, directory, assetStore: fixture.assetStore, baseUrl: url,
    runtime: { close() {} },
    fetchImpl: async (href) => {
      const name = href.slice(url.length);
      requests.push(name);
      if (index && (name === index || distributionPaths.includes(name))) return new Response(read(name));
      return new Response(null, { status: 404 });
    },
  });
  t.after(() => service.close());

  for (const available of ["catalog.json", null]) {
    index = available;
    const catalogue = await service.catalogue();
    assert.equal(catalogue.origin, available ? "online" : "bundled");
    assert.ok(catalogue.entries.every(entry => !entry.hasPreview));
    assert.deepEqual(requests.splice(0), ["catalog-v2.json", "catalog.json"]);
    for (const entry of catalogue.entries) assert.deepEqual(await service.previewImage(entry), { url: null });
    assert.deepEqual(requests, []);
  }
  index = "catalog.json";
  const verified = await service.preview(legacy);
  assert.equal(verified.sha256, legacy.sha256);
  assert.deepEqual(requests.splice(0), [legacy.packagePath]);

  index = "catalog-v2.json";
  const catalogue = await service.catalogue();
  assert.equal(catalogue.entries.find(entry => entry.sha256 === rich.sha256).hasPreview, true);
  assert.notDeepEqual(read(rich.previewPath), read(legacy.previewPath));
  const preview = await service.previewImage(rich);
  assert.equal(preview.url, "data:image/png;base64," + read(rich.previewPath).toString("base64"));
  assert.deepEqual(requests, ["catalog-v2.json", rich.previewPath]);
});

test("published legacy catalogues remain downloadable ahead of bundled v2 without rebinding installed widgets", async (t) => {
  const fixture = await createDesktopBackupContext(t, { appVersion, seed: false });
  const published = new URL("../market/public/", import.meta.url);
  const directory = path.join(fixture.dataRoot, "catalogue-metadata");
  fs.mkdirSync(directory);
  for (const name of ["catalog-v2.json", "catalog.json", "trusted-keys.json"]) fs.copyFileSync(new URL(name, published), path.join(directory, name));
  const read = (name) => fs.readFileSync(new URL(name, published));
  const rich = JSON.parse(read("catalog-v2.json")).entries, legacy = JSON.parse(read("catalog.json")).entries;
  const timer = rich.find((e) => e.id === "life-atlas.pomodoro"), atlas = rich.find((e) => e.id === "life-atlas.travel-footprint");
  const oldTimer = legacy.find((e) => e.id === timer.id);
  assert.notEqual(timer.version, oldTimer.version);
  const mirror = "https://raw.githubusercontent.com/jamesmendax/life-atlas-public/main/market/public/";
  const imports = path.join(fixture.dataRoot, "import.atlaspack");
  fs.writeFileSync(imports, read(atlas.packagePath));
  const requests = [];
  let publishedBase = marketBaseUrl, availableIndex = "catalog-v2.json";
  const service = createMarketService({
    appVersion, directory, assetStore: fixture.assetStore, getWindow: () => null, runtime: { close() {} },
    dialogs: { showOpenDialog: async () => ({ canceled: false, filePaths: [imports] }) },
    fetchImpl: async (href) => {
      requests.push(href);
      if (!publishedBase || !href.startsWith(publishedBase)) return new Response(null, { status: 404 });
      const name = href.slice(publishedBase.length);
      const livePack = availableIndex === "catalog-v2.json" ? timer.packagePath : oldTimer.packagePath;
      return name === availableIndex || name === livePack ? new Response(read(name)) : new Response(null, { status: 404 });
    },
  });
  t.after(() => service.close());
  const current = await service.catalogue();
  assert.equal(current.origin, "online");
  assert.deepEqual(requests.splice(0), [marketBaseUrl + "catalog-v2.json"]);
  const download = async (item) => service.install({ token: (await service.preview(item)).token, downloadOnly: true });
  const installed = await download(timer);
  const imported = service.install({ token: (await service.pick()).token, downloadOnly: true });
  assert.equal(imported.sha256, atlas.sha256);
  assert.deepEqual(requests.splice(0), [marketBaseUrl + timer.packagePath]);

  availableIndex = "catalog.json";
  for (publishedBase of [marketBaseUrl, mirror]) {
    const online = await service.catalogue();
    assert.equal(online.origin, "online");
    assert.deepEqual(online.entries.map((e) => e.sha256), legacy.map((e) => e.sha256));
    const checked = [marketBaseUrl + "catalog-v2.json", mirror + "catalog-v2.json", marketBaseUrl + "catalog.json"];
    if (publishedBase === mirror) checked.push(mirror + "catalog.json");
    assert.deepEqual(requests.splice(0), checked, "browsing must only read catalogue metadata");
  }
  const old = await download(oldTimer);
  assert.equal(old.url, "life-asset://" + oldTimer.sha256);
  assert.deepEqual(requests.splice(0), [mirror + oldTimer.packagePath]);
  assert.deepEqual(await service.hostWidget({ url: old.url }), { kind: null });
  const stillRich = await service.hostWidget({ url: installed.url });
  assert.equal(service.capabilityOwner(stillRich.frameUrl, "widget-audio"), timer.sha256);
  service.releaseFrame(stillRich);
  assert.equal((await service.preview({ sha256: imported.sha256 })).sha256, atlas.sha256);
  assert.deepEqual(new Set(service.installed().entries.map((e) => e.sha256)), new Set([timer.sha256, oldTimer.sha256, atlas.sha256]));
  assert.deepEqual(requests, []);

  publishedBase = null;
  for (const expected of [rich, legacy]) {
    const offline = await service.catalogue();
    assert.equal(offline.origin, "bundled");
    assert.deepEqual(offline.entries.map((e) => e.sha256), expected.map((e) => e.sha256));
    assert.ok(requests.splice(0).every((href) => href.endsWith(".json")));
    for (const item of [timer, oldTimer, atlas]) assert.equal((await service.preview({ sha256: item.sha256 })).sha256, item.sha256);
    assert.deepEqual(requests, []);
    if (expected === rich) fs.renameSync(path.join(directory, "catalog-v2.json"), path.join(directory, "v2-unavailable"));
  }
});

function saveBlocks(fixture, sha256, ordinary = false) {
  const workspace = fixture.workspaceService.readWorkspace();
  const url = `life-asset://${sha256}`;
  const block = { type: "marketComponent", props: { url, state: "{\"count\":7}", packageId: "community.custom" } };
  const pages = [1, 2].map((id) => ({ ...workspace.pages[0], id: `test-page-${id}`, title: "保留状态",
    content: [{ ...block, id: `component-${id}` }, ...(ordinary && id === 1 ? [{ type: "file", id: "actual-file", props: { url } }] : [])] }));
  const next = { ...workspace, pages };
  replaceDatabaseWorkspace(fixture.workspaceService.db, next, { generation: "fixture-pages", now: FIXTURE_TIME });
  return pages;
}

test("thumbnail requests by entry and hash share one in-flight download and its cached result", async (t) => {
  const { entry, bytes } = await archive("community.thumbnail");
  const { service, replies, requests } = await setup(t, [{ entry, bytes }]);
  await service.catalogue();
  requests.length = 0;

  const started = Promise.withResolvers();
  const response = Promise.withResolvers();
  replies.set(entry.previewPath, async () => {
    started.resolve();
    await response.promise;
    return new Response(png);
  });
  const first = service.previewImage({ id: entry.id, version: entry.version });
  await started.promise;
  const second = service.previewImage({ sha256: entry.sha256 });
  response.resolve();
  assert.deepEqual(await Promise.all([first, second]), [pngThumbnail, pngThumbnail]);
  assert.deepEqual(await service.previewImage(entry), pngThumbnail);
  assert.deepEqual(requests, [entry.previewPath]);
});

test("thumbnail cache evicts the least recently used entry at 64 entries", async (t) => {
  const items = await Promise.all(Array.from({ length: 65 }, (_, index) => archive(`community.thumbnail-${index}`)));
  const { service, requests } = await setup(t, items);
  await service.catalogue();
  requests.length = 0;

  for (const { entry } of items.slice(0, 64)) await service.previewImage(entry);
  await service.previewImage(items[0].entry);
  await service.previewImage(items[64].entry);
  assert.equal(requests.length, 65);

  requests.length = 0;
  assert.deepEqual(await service.previewImage(items[0].entry), pngThumbnail);
  assert.deepEqual(requests, []);
  assert.deepEqual(await service.previewImage(items[1].entry), pngThumbnail);
  assert.deepEqual(requests, [items[1].entry.previewPath]);
});

test("bundled thumbnails work offline and failed thumbnails can retry when the network returns", async (t) => {
  const bundled = await archive("community.bundled");
  bundled.entry.previewPath = `previews/thumbs/${marketHash(png)}.png`;
  const invalid = await archive("community.invalid");
  invalid.entry.previewPath = "previews/thumbs/invalid.png";
  const missing = await archive("community.missing");
  missing.entry.previewPath = "previews/thumbs/missing.png";
  const fixture = await setup(t, [bundled, invalid, missing]);
  const { service, directory, replies, requests } = fixture;
  const thumbnailFile = path.join(directory, bundled.entry.previewPath);
  fs.mkdirSync(path.dirname(thumbnailFile), { recursive: true });
  fs.writeFileSync(thumbnailFile, png);
  fs.writeFileSync(path.join(directory, invalid.entry.previewPath), "not a PNG");

  fixture.offline();
  assert.equal((await service.catalogue()).origin, "bundled");
  requests.length = 0;
  assert.deepEqual(await service.previewImage(bundled.entry), pngThumbnail);
  assert.deepEqual(requests, []);
  assert.deepEqual(await service.previewImage(invalid.entry), { url: null });
  assert.deepEqual(await service.previewImage(missing.entry), { url: null });

  fixture.online();
  replies.set(invalid.entry.previewPath, png);
  assert.deepEqual(await service.previewImage(invalid.entry), pngThumbnail);
});

test("metadata requests carry no package payload; selecting one signed third-party UI opens a private resource lease", async (t) => {
  const item = await archive("community.custom", { permissions: ["widget-audio"] });
  const other = await archive("community.second");
  const fixture = await setup(t, [item, other]);
  const { service, requests } = fixture;
  const catalogue = await service.catalogue();
  assert.deepEqual(requests, ["catalog-v2.json"]);
  assert.equal(catalogue.entries[0].installed, false);
  assert.equal((await service.previewImage(other.entry)).url, `data:image/png;base64,${png.toString("base64")}`);
  assert.deepEqual(requests, ["catalog-v2.json", "previews/sample.png"]);
  const preview = await service.preview(item.entry);
  assert.equal(preview.sha256, item.entry.sha256);
  assert.equal(service.installed().totalBytes, 0);
  const frame = await service.hostWidget({ token: preview.token });
  assert.match(frame.frameUrl, /^life-widget:\/\/[0-9a-f]{48}\/index\.html$/u);
  assert.deepEqual(frame.capabilities, ["widget-audio"]);
  assert.equal(service.capabilityOwner(frame.frameUrl, "widget-audio"), item.entry.sha256);
  assert.equal(service.capabilityOwner(frame.frameUrl, "trip-routing"), null);
  const document = resource(service, frame.frameUrl);
  assert.match(await document.text(), /id="root"/u);
  assert.match(document.headers.get("Content-Security-Policy"), /sandbox allow-scripts/u);
  assert.match(document.headers.get("Content-Security-Policy"), /connect-src life-widget:\/\/[0-9a-f]{48};/u);
  assert.doesNotMatch(document.headers.get("Content-Security-Policy"), /https:|unsafe-eval/u);
  assert.equal(await resource(service, frame.frameUrl, "ui.js").text(), source.toString());
  const data = resource(service, frame.frameUrl, "assets/data.json", { headers: new Headers({ Origin: "null" }) });
  assert.deepEqual(await data.json(), { value: 18 });
  assert.equal(data.headers.get("Access-Control-Allow-Origin"), "null");
  for (const name of ["manifest.sig", "assets/../ui.js", "%2e%2e/ui.js", "ui.js?a=1"]) assert.equal(resource(service, frame.frameUrl, name).status, 404);
  assert.equal(resource(service, frame.frameUrl, "index.html", { destination: "document" }).status, 404);
  assert.equal(resource(service, frame.frameUrl, "ui.js", { method: "POST" }).status, 405);
  const second = await service.hostWidget({ token: preview.token });
  assert.notEqual(second.frameUrl, frame.frameUrl);
  assert.equal(service.releaseFrame(frame).released, true);
  assert.equal(service.capabilityOwner(frame.frameUrl, "widget-audio"), null);
  assert.equal(resource(service, frame.frameUrl).status, 404);
  assert.equal(resource(service, second.frameUrl).status, 200);
  const saved = service.install({ token: preview.token, downloadOnly: true });
  assert.equal(resource(service, second.frameUrl).status, 404);
  assert.equal(saved.url, `life-asset://${item.entry.sha256}`);
  fixture.offline();
  const offline = await service.preview({ id: item.entry.id, version: item.entry.version });
  assert.equal(offline.installed, true);
  service.install({ token: offline.token, downloadOnly: true });
  assert.deepEqual(requests, ["catalog-v2.json", "previews/sample.png", item.entry.packagePath]);
  assert.equal(service.installed().totalBytes, item.entry.size);
  assert.deepEqual((await fixture.cleanup.scanUnreferenced()).candidates, []);
  const persistent = await service.hostWidget(saved);
  assert.equal(persistent.kind, "frame");
  service.releaseAllFrames();
  assert.equal(resource(service, persistent.frameUrl).status, 404);
});

test("a new selection invalidates an in-flight older preview and a bad local signature cannot take its place", async (t) => {
  const first = await archive("community.first");
  const second = await archive("community.second");
  const fixture = await setup(t, [first, second]);
  await fixture.service.catalogue();
  let started;
  const pending = new Promise((resolve) => { started = resolve; });
  fixture.replies.set(first.entry.packagePath, (signal) => new Promise((_, reject) => {
    started();
    signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
  }));
  const older = fixture.service.preview(first.entry);
  await pending;
  const selected = fixture.service.preview(second.entry);
  await assert.rejects(older, { code: "E_CONFLICT" });
  const result = await selected;
  const frame = await fixture.service.hostWidget({ token: result.token });
  const bad = await archive("community.impostor", { key: generateKeyPairSync("ed25519").privateKey });
  const file = path.join(fixture.directory, "chosen.atlaspack");
  fs.writeFileSync(file, bad.bytes);
  fixture.choose(file);
  await assert.rejects(fixture.service.pick(), { code: "E_FORBIDDEN" });
  assert.throws(() => fixture.service.install({ token: result.token }), { code: "E_INVALID_ARGUMENT" });
  assert.equal(resource(fixture.service, frame.frameUrl).status, 404);
});

test("explicit local imports absent from any catalogue share the library; template images are only created on application", async (t) => {
  const pack = await archive("community.local");
  const template = await archive("community.sheets", { template: true });
  const fixture = await setup(t, []);
  fixture.offline();
  for (const item of [pack, template]) {
    const file = path.join(fixture.directory, `${item.entry.id}.atlaspack`);
    fs.writeFileSync(file, item.bytes);
    fixture.choose(file);
    const preview = await fixture.service.pick();
    fixture.service.install({ token: preview.token, downloadOnly: true });
  }
  assert.equal(fixture.service.installed().entries.length, 2);
  assert.equal(fixture.assetStore.list().length, 2);
  for (const item of [pack, template]) {
    const preview = await fixture.service.preview({ id: item.entry.id, version: item.entry.version });
    assert.equal(preview.title, item.entry.title);
  }
  const preview = await fixture.service.preview({ sha256: template.entry.sha256 });
  const applied = fixture.service.install({ token: preview.token });
  assert.match(applied.template.blocks[0].props.url, /^life-asset:\/\//u);
  assert.equal(fixture.assetStore.list().length, 3);
  assert.deepEqual(fixture.requests, []);
});

test("two page references do not pin a removed download; a backup restores the package or the saved placeholder as appropriate", async (t) => {
  const item = await archive("community.custom");
  const fixture = await setup(t, [item]);
  await fixture.service.catalogue();
  const preview = await fixture.service.preview(item.entry);
  const installed = fixture.service.install({ token: preview.token });
  const frame = await fixture.service.hostWidget(installed);
  const pages = saveBlocks(fixture, installed.sha256);
  const backup = async (name) => {
    const filePath = path.join(fixture.dataRoot, `${name}.lifeatlas`);
    await exportFullBackup({ ...fixture, db: fixture.workspaceService.db, workspace: fixture.workspaceService.readWorkspace(), targetPath: filePath });
    return filePath;
  };
  const before = await backup("installed");
  const removed = await fixture.service.remove(item.entry);
  assert.equal(removed.releasedBytes, item.entry.size);
  assert.equal(removed.retainedBytes, 0);
  assert.equal(fixture.assetStore.get(installed.sha256), null);
  assert.equal(fs.existsSync(fixture.assetStore.filePath(installed.sha256)), false);
  assert.deepEqual(fixture.workspaceService.readWorkspace().pages, pages);
  assert.equal(resource(fixture.service, frame.frameUrl).status, 404);
  await assert.rejects(fixture.service.hostWidget(installed), { code: "E_NOT_FOUND" });
  const after = await backup("removed");
  for (const [filePath, present] of [[before, true], [after, false]]) {
    const destination = await setup(t, []);
    destination.offline();
    const inspector = createBackupInspector({ dataRoot: destination.dataRoot, now: FIXTURE_TIME });
    t.after(() => inspector.stop());
    const { token } = await inspector.inspectFile(filePath);
    await restoreFromToken(token, { ...destination, inspector, restoreVault: false });
    assert.deepEqual(destination.workspaceService.readWorkspace().pages, pages);
    assert.equal(destination.service.installed().entries.length, Number(present));
    if (present) assert.equal((await destination.service.hostWidget(installed)).kind, "frame");
    else await assert.rejects(destination.service.hostWidget(installed), { code: "E_NOT_FOUND" });
    assert.equal(destination.requests.length, 0);
  }
  const again = await fixture.service.preview({ sha256: installed.sha256 });
  assert.equal(fixture.service.install({ token: again.token }).url, installed.url);
  assert.equal((await fixture.service.hostWidget(installed)).kind, "frame");
  assert.deepEqual(fixture.workspaceService.readWorkspace().pages, pages);
});

test("snapshot asset rows retain only the reported bytes and release them after snapshot retention ends", async (t) => {
  const item = await archive("community.snapshot");
  const fixture = await setup(t, [item]);
  await fixture.service.catalogue();
  const preview = await fixture.service.preview(item.entry);
  const installed = fixture.service.install({ token: preview.token });
  const snapshot = await createSnapshot({ dataRoot: fixture.dataRoot, reason: "manual", databases: [{ name: "workspace.db", db: fixture.workspaceService.db }], appVersion, schemaVersion: fixture.workspaceService.readWorkspace().schemaVersion, now: FIXTURE_TIME });
  const result = await fixture.service.remove(installed);
  assert.equal(result.retainedForSnapshots, true);
  assert.equal(result.retainedForAttachments, false);
  assert.equal(result.retainedBytes, item.entry.size);
  assert.equal(result.releasedBytes, 0);
  assert.equal(fixture.service.installed().totalBytes, 0);
  assert.equal(fs.existsSync(fixture.assetStore.filePath(installed.sha256)), true);
  const target = snapshotDirectory(fixture.dataRoot, snapshot.id);
  assert.equal(path.dirname(target), path.join(fixture.dataRoot, "snapshots"));
  fs.rmSync(target, { recursive: true });
  await fixture.cleanup.purgeExpired();
  assert.equal(fs.existsSync(fixture.assetStore.filePath(installed.sha256)), false);
});

test("ordinary attachments keep their package bytes until the last actual attachment is gone", async (t) => {
  const item = await archive("community.custom");
  const fixture = await setup(t, [item]);
  await fixture.service.catalogue();
  const preview = await fixture.service.preview(item.entry);
  const saved = fixture.service.install({ token: preview.token });
  saveBlocks(fixture, saved.sha256, true);
  const result = await fixture.service.remove(saved);
  assert.equal(result.retainedForAttachments, true);
  assert.equal(result.retainedBytes, item.entry.size);
  assert.equal(fixture.assetStore.get(saved.sha256).mime, `${componentMime};installed=0`);
  assert.equal(fixture.service.installed().entries.length, 0);
  saveBlocks(fixture, saved.sha256);
  await fixture.cleanup.purgeExpired();
  assert.equal(fs.existsSync(fixture.assetStore.filePath(saved.sha256)), false);
});

test("a changed on-disk package cannot get a new frame even when another page has a valid lease", async (t) => {
  const item = await archive("community.changed");
  const fixture = await setup(t, [item]);
  await fixture.service.catalogue();
  const preview = await fixture.service.preview(item.entry);
  const saved = fixture.service.install({ token: preview.token });
  const existing = await fixture.service.hostWidget(saved);
  fs.writeFileSync(fixture.assetStore.filePath(saved.sha256), Buffer.alloc(item.entry.size, 1));
  await assert.rejects(fixture.service.hostWidget(saved));
  assert.equal(await resource(fixture.service, existing.frameUrl, "ui.js").text(), source.toString());
  await assert.rejects(fixture.service.remove(saved));
});

test("tile cache failure reports pending cleanup after a signed package has been removed and its leases revoked", async (t) => {
  const item = await archive("community.itinerary", { permissions: ["trip-routing"] });
  let frame, fixture;
  fixture = await setup(t, [item], undefined, ({ sha256, capabilities }) => {
    assert.equal(sha256, item.entry.sha256);
    assert.deepEqual(capabilities, ["trip-routing"]);
    assert.equal(fixture.service.capabilityOwner(frame.frameUrl, "trip-routing"), null);
    throw new Error("cache offline");
  });
  await fixture.service.catalogue();
  const preview = await fixture.service.preview(item.entry);
  const local = fixture.service.install({ token: preview.token });
  frame = await fixture.service.hostWidget(local);
  assert.equal(fixture.service.capabilityOwner(frame.frameUrl, "trip-routing"), local.sha256);
  const result = await fixture.service.remove(local);
  assert.equal(result.removed, true);
  assert.equal(result.releasedBytes, local.size);
  assert.equal(result.cacheCleanupPending, true);
  assert.equal(result.cacheReleasedBytes, 0);
  assert.equal(fixture.service.installed().totalBytes, 0);
});
