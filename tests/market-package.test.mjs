import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buffer } from "node:stream/consumers";
import yazl from "yazl";
import { validateMarketCatalog, verifyMarketPack } from "../electron/main/market/package.js";
import { componentMime, createMarketService, marketBaseUrl } from "../electron/main/market/service.js";
import { createAssetStore } from "../electron/main/storage/assetStore.js";
import { prepareWritable } from "../electron/main/storage/workspaceDb.js";
import { buildMarketRelease } from "../scripts/market-build.mjs";

const base = path.resolve(tmpdir());
const prefix = "life-atlas-market-check-";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => Buffer.from(JSON.stringify(value), "utf8");
const pngHeader = "89504e470d0a1a0a";
const minimalTemplate = { title: "复习笔记", blocks: [{ type: "paragraph", content: "复述所学内容。" }] };
const appVersion = "1.10.0";
let directory, release, signingKey, publicKeys;

async function officialSample(type) {
  const entry = release.catalog.entries.find((entry) => entry.type === type);
  const file = path.join(release.outputDirectory, entry.packagePath);
  return { entry, file, bytes: await readFile(file) };
}

async function templateArchive({ template = minimalTemplate, metadata = {}, extraFiles = [], signer = signingKey, changeEntries = (entries) => entries } = {}) {
  const files = [["template.json", json(template)], ...extraFiles];
  const manifest = json({
    kind: "life-atlas-market-package",
    formatVersion: 1,
    id: "life-atlas.synthetic-review",
    title: "复习笔记",
    description: "用于测试包验证",
    type: "template",
    version: "1.0.0",
    minAppVersion: "1.1.0",
    ...metadata,
    files: files.map(([file, bytes]) => ({ path: file, size: bytes.length, sha256: sha256(bytes) })),
  });
  const signature = Buffer.from(sign(null, manifest, signer).toString("base64"), "ascii");
  const archive = new yazl.ZipFile();
  for (const [name, bytes] of changeEntries([["manifest.json", manifest], ["manifest.sig", signature], ...files])) {
    archive.addBuffer(bytes, name);
  }
  const result = buffer(archive.outputStream);
  archive.end();
  return result;
}

const replaceEntry = (entries, target, replace) => entries.map(([name, bytes]) => [name, name === target ? replace(bytes) : bytes]);

async function openMarket(t, { chooseFile, fetchImpl, baseUrl } = {}) {
  const db = new DatabaseSync(":memory:");
  const assetsDir = await mkdtemp(path.join(directory, "assets-"));
  prepareWritable(db);
  const assets = createAssetStore({ assetsDir, db });
  const service = createMarketService({
    appVersion,
    directory: release.outputDirectory,
    assetStore: assets,
    runtime: { run: () => assert.fail("Preview and install must not run component code"), close() {} },
    dialogs: { showOpenDialog: async () => ({ canceled: false, filePaths: [chooseFile?.()] }) },
    getWindow: () => null,
    fetchImpl,
    baseUrl,
  });
  t.after(() => { service.close(); db.close(); });
  return { service, assets };
}

before(async () => {
  directory = await mkdtemp(path.join(base, prefix));
  const { privateKey } = generateKeyPairSync("ed25519");
  signingKey = privateKey;
  release = await buildMarketRelease({ outputDirectory: path.join(directory, "site"), signingKey });
  ({ publicKeys } = JSON.parse(await readFile(path.join(release.outputDirectory, "trusted-keys.json"), "utf8")));
});

after(async () => {
  if (directory && path.dirname(directory) === base && path.basename(directory).startsWith(prefix)) {
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("the app verifies the publisher's study template and Pomodoro release archives", async () => {
  const study = await officialSample("template");
  const timer = await officialSample("component");
  const template = await verifyMarketPack(study.bytes, { appVersion, publicKeys, expected: study.entry });
  const component = await verifyMarketPack(timer.bytes, { appVersion, publicKeys, expected: timer.entry });

  assert.equal(template.meta.id, "life-atlas.focus-study");
  assert.equal(template.template.title, "专注学习页");
  assert.ok(template.template.blocks.some(({ type, content }) => type === "heading" && content === "学习笔记"));
  assert.equal(template.template.assets.get("assets/study.png").subarray(0, 8).toString("hex"), pngHeader);
  assert.equal(component.meta.id, "life-atlas.pomodoro");
  assert.ok(component.uiFiles.has("ui.js"));
  assert.ok(component.uiFiles.has("assets/standard-alarm.wav"));
  assert.deepEqual(component.capabilities, ["widget-audio"]);
  const oldIndex = JSON.parse(await readFile(path.join(release.outputDirectory, "catalog.json"), "utf8"));
  const oldEntry = oldIndex.entries.find(({ id }) => id === "life-atlas.pomodoro");
  const old = await verifyMarketPack(await readFile(path.join(release.outputDirectory, oldEntry.packagePath)), { appVersion, publicKeys, expected: oldEntry });
  assert.match(old.source, /globalThis\.handleComponentEvent/);
});

test("an untrusted signer and a changed raw manifest both fail signature verification", async () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const unknownSigner = await templateArchive({ signer: privateKey });
  const changed = await templateArchive({
    changeEntries: (entries) => replaceEntry(entries, "manifest.json", (bytes) => Buffer.concat([bytes, Buffer.from("\n")])),
  });
  for (const bytes of [unknownSigner, changed]) {
    await assert.rejects(verifyMarketPack(bytes, { appVersion, publicKeys }), { code: "E_FORBIDDEN" });
  }
});

test("changing a file without changing its size still fails its signed hash", async () => {
  const bytes = await templateArchive({
    changeEntries: (entries) => replaceEntry(entries, "template.json", (original) => {
      const changed = json({ ...minimalTemplate, title: "预习笔记" });
      assert.equal(changed.length, original.length);
      return changed;
    }),
  });
  await assert.rejects(verifyMarketPack(bytes, { appVersion, publicKeys }), { code: "E_CORRUPT", message: /文件校验失败/u });
});

test("catalogue validation rejects repeated versions and unsafe distribution paths", async () => {
  const { entry } = await officialSample("template");
  const invalidCatalogues = [
    { formatVersion: 1, entries: [entry, entry] },
    { formatVersion: 1, entries: [{ ...entry, packagePath: "../elsewhere.atlaspack" }] },
    { formatVersion: 1, entries: [{ ...entry, previewPath: "https://example.invalid/preview.png" }] },
  ];
  for (const value of invalidCatalogues) assert.throws(() => validateMarketCatalog(json(value)), { code: "E_CORRUPT" });
});

test("a signed archive must match the catalogue hash and identity", async () => {
  const { entry, bytes } = await officialSample("template");
  await assert.rejects(verifyMarketPack(bytes, { appVersion, publicKeys, expected: { ...entry, sha256: "0".repeat(64) } }), { code: "E_CORRUPT", message: /下载的包与市集目录不一致/u });
  await assert.rejects(verifyMarketPack(bytes, { appVersion, publicKeys, expected: { ...entry, version: "2.0.0" } }), { code: "E_CORRUPT", message: /软件包信息与市集目录不一致/u });
});

test("the app rejects a ZIP that repeats an entry even when its path uses different case", async () => {
  for (const name of ["template.json", "TEMPLATE.JSON"]) {
    const duplicate = await templateArchive({ changeEntries: (entries) => [...entries, [name, json(minimalTemplate)]] });
    await assert.rejects(verifyMarketPack(duplicate, { appVersion, publicKeys }), { code: "E_CORRUPT", message: /重复条目/u });
  }
});

test("official signatures cannot make unsupported blocks, missing images, or bad PNGs installable", async () => {
  const cases = [
    { blocks: [{ type: "databaseView", content: "示例库" }], expected: /不支持的区块/u },
    { blocks: [{ type: "image", props: { url: "asset:assets/absent.png" } }], expected: /图片没有包含/u },
    { blocks: [{ type: "image", props: { url: "asset:assets/bad.png" } }], files: [["assets/bad.png", Buffer.alloc(33)]], expected: /图片格式无效/u },
  ];
  for (const { blocks, files, expected } of cases) {
    const bytes = await templateArchive({ template: { ...minimalTemplate, blocks }, extraFiles: files });
    await assert.rejects(verifyMarketPack(bytes, { appVersion, publicKeys }), { code: "E_CORRUPT", message: expected });
  }
});

test("the app rejects a correctly signed release requiring a newer app version", async () => {
  const { bytes } = await officialSample("template");
  await assert.rejects(verifyMarketPack(bytes, { appVersion: "1.0.3", publicKeys }), { code: "E_UNSUPPORTED_VERSION" });
});

test("the official repository serves a new signed package and its preview when Pages is unavailable", async (t) => {
  const mirror = "https://raw.githubusercontent.com/jamesmendax/life-atlas-public/main/market/public/";
  const original = await officialSample("template");
  const metadata = { id: "community.weekly-review", title: "每周回顾", version: "1.0.0" };
  const bytes = await templateArchive({ metadata });
  const entry = { ...original.entry, ...metadata, description: "用于测试包验证", minAppVersion: "1.1.0",
    packagePath: "packages/community.weekly-review-1.0.0.atlaspack", previewPath: "previews/community-weekly-review.png",
    sha256: sha256(bytes), size: bytes.length };
  const png = await readFile(path.join(release.outputDirectory, original.entry.previewPath));
  const replies = new Map([
    [mirror + "catalog-v2.json", json({ formatVersion: 1, entries: [entry] })],
    [mirror + entry.previewPath, png],
    [mirror + entry.packagePath, bytes],
  ]);
  const requests = [];
  const { service } = await openMarket(t, {
    fetchImpl: async (url, options) => {
      requests.push({ url, credentials: options.credentials, redirect: options.redirect });
      return replies.has(url) ? new Response(replies.get(url)) : new Response(null, { status: 404 });
    },
  });
  const catalogue = await service.catalogue();
  assert.equal(catalogue.origin, "online");
  assert.deepEqual(catalogue.entries.map(({ id }) => id), [entry.id]);
  assert.equal((await service.previewImage(entry)).url, `data:image/png;base64,${png.toString("base64")}`);
  const preview = await service.preview(entry);
  assert.equal(service.install({ token: preview.token }).id, entry.id);
  assert.deepEqual(requests.map(({ url }) => url), [marketBaseUrl + "catalog-v2.json", ...replies.keys()]);
  assert.ok(requests.every((r) => r.credentials === "omit" && r.redirect === "error"));
});

test("offline fallback retains catalogue metadata and never opens packages shipped beside it", async (t) => {
  const custom = "https://example.invalid/market/";
  const mirror = "https://raw.githubusercontent.com/jamesmendax/life-atlas-public/main/market/public/";
  for (const [baseUrl, expected] of [[undefined, [marketBaseUrl, mirror]], [custom, [custom]]]) {
    const requests = [];
    const { service } = await openMarket(t, { baseUrl, fetchImpl: async (url) => {
      requests.push(url);
      return new Response("not a catalogue");
    } });
    const catalogue = await service.catalogue();
    assert.equal(catalogue.origin, "bundled");
    assert.deepEqual(requests, ["catalog-v2.json", "catalog.json"].flatMap((name) => expected.map((base) => base + name)));
    await assert.rejects(service.preview(catalogue.entries[0]));
    assert.equal(requests.filter((url) => url.endsWith(".atlaspack")).length, expected.length);
  }
});

test("the catalogue independently previews two versions of one template", async (t) => {
  const { entry, bytes } = await officialSample("template");
  const updated = { ...entry, version: "2.0.0", minAppVersion: "1.2.0", packagePath: "packages/focus-study-2.0.0.atlaspack" };
  const updatedBytes = await templateArchive({ metadata: {
    id: updated.id, title: updated.title, description: updated.description, version: updated.version, minAppVersion: updated.minAppVersion,
  } });
  const revised = { ...updated, size: updatedBytes.length, sha256: sha256(updatedBytes) };
  const resources = new Map([
    ["/market/catalog-v2.json", json({ formatVersion: 1, entries: [entry, revised] })],
    [`/market/${entry.packagePath}`, bytes],
    [`/market/${revised.packagePath}`, updatedBytes],
  ]);
  const { service, assets } = await openMarket(t, {
    baseUrl: "https://example.invalid/market/",
    fetchImpl: async (url) => {
      const found = resources.get(new URL(url).pathname);
      return found ? new Response(found) : new Response(null, { status: 404 });
    },
  });

  const catalogue = await service.catalogue();
  assert.equal(catalogue.origin, "online");
  assert.deepEqual(catalogue.entries.map(({ version, compatible }) => [version, compatible]), [["1.0.0", true], ["2.0.0", true]]);
  const original = await service.preview({ id: entry.id, version: entry.version });
  const replacement = await service.preview({ id: revised.id, version: revised.version });
  assert.equal(original.version, "1.0.0");
  assert.equal(replacement.version, "2.0.0");
  assert.throws(() => service.install({ token: original.token }), { code: "E_INVALID_ARGUMENT" });
  assert.deepEqual(assets.list(), []);

  const installed = service.install({ token: replacement.token });
  assert.equal(installed.version, "2.0.0");
  assert.deepEqual(installed.template.blocks, [{ type: "paragraph", content: "复述所学内容。" }]);
});

test("a locally picked template only writes its image after confirming the verified preview", async (t) => {
  const { file, bytes } = await officialSample("template");
  const { service, assets } = await openMarket(t, { chooseFile: () => file });
  assert.throws(() => service.install({ token: "unconfirmed" }), { code: "E_INVALID_ARGUMENT" });

  const preview = await service.pick();
  assert.equal(preview.title, "专注学习页");
  assert.equal(preview.assets, 1);
  assert.deepEqual(assets.list(), []);
  assert.throws(() => service.install({ token: "incorrect" }), { code: "E_INVALID_ARGUMENT" });
  assert.deepEqual(assets.list(), []);

  const installed = service.install({ token: preview.token });
  const asset = assets.list().find((item) => item.mime === "image/png");
  assert.equal(assets.list().length, 2);
  assert.equal(asset.mime, "image/png");
  assert.equal(installed.template.blocks.find((block) => block.type === "image").props.url, `life-asset://${asset.sha256}`);
  const verified = await verifyMarketPack(bytes, { appVersion, publicKeys });
  assert.deepEqual(await readFile(assets.filePath(asset.sha256)), verified.template.assets.get("assets/study.png"));
  assert.throws(() => service.install({ token: preview.token }), { code: "E_INVALID_ARGUMENT" });
});

test("a confirmed component saves its signed archive for later use", async (t) => {
  const { entry, bytes, file } = await officialSample("component");
  const { service, assets } = await openMarket(t, { chooseFile: () => file });
  assert.equal((await service.catalogue()).origin, "bundled");
  const preview = await service.pick();
  assert.deepEqual(assets.list(), []);

  const installed = service.install({ token: preview.token });
  assert.equal(installed.url, `life-asset://${entry.sha256}`);
  const [asset] = assets.list();
  assert.equal(assets.list().length, 1);
  assert.equal(asset.mime, componentMime);
  assert.deepEqual(await readFile(assets.filePath(asset.sha256)), bytes);
  assert.equal((await service.preview({ id: entry.id, version: entry.version })).sha256, entry.sha256);
});

test("failed signature verification clears the previous install preview", async (t) => {
  const { file } = await officialSample("template");
  const rejected = path.join(directory, "rejected.atlaspack");
  await writeFile(rejected, await templateArchive({ signer: generateKeyPairSync("ed25519").privateKey }));
  const choices = [file, rejected];
  const { service, assets } = await openMarket(t, { chooseFile: () => choices.shift() });
  const preview = await service.pick();

  await assert.rejects(service.pick(), { code: "E_FORBIDDEN" });
  assert.throws(() => service.install({ token: preview.token }), { code: "E_INVALID_ARGUMENT" });
  assert.deepEqual(assets.list(), []);
});
