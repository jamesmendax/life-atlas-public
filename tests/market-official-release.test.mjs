import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { openZipFileReader } from "../electron/main/backup/zipNode.js";
import { verifyMarketPack } from "../electron/main/market/package.js";
import { buildMarketRelease } from "../scripts/market-build.mjs";
import { stageMarketPages } from "../scripts/market-stage-pages.mjs";
import { MAX_THUMBNAIL_BYTES, MAX_THUMBNAIL_EDGE } from "../scripts/market-thumbnails.mjs";
import { PNG_1X1_BASE64 } from "./fixtures/full-workspace.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const { version: releaseVersion } = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("official release accepts an in-memory signing key and publishes only public material", async (t) => {
  const base = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(base, "life-atlas-market-"));
  t.after(async () => {
    if (path.dirname(directory) === base && path.basename(directory).startsWith("life-atlas-market-")) {
      await rm(directory, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  const output = path.join(directory, "public");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" });
  const publicPem = publicKey.export({ format: "pem", type: "spki" });
  const build = spawnSync(process.execPath, [path.join(ROOT, "scripts", "market-build.mjs"), "--key-stdin", "--output", output], { input: privatePem, encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  assert.doesNotMatch(build.stdout, /PRIVATE KEY/);

  const catalog = JSON.parse(await readFile(path.join(output, "catalog-v2.json"), "utf8"));
  const keys = JSON.parse(await readFile(path.join(output, "trusted-keys.json"), "utf8"));
  assert.ok(keys.publicKeys.includes(publicPem));
  const legacyRoot = path.join(ROOT, "market", "public");
  const legacy = JSON.parse(await readFile(path.join(output, "catalog.json"), "utf8"));
  assert.deepEqual(await readFile(path.join(output, "catalog.json")), await readFile(path.join(legacyRoot, "catalog.json")));
  const builtins = [
    ["life-atlas.focus-study", "template"], ["life-atlas.pomodoro", "component"], ["life-atlas.travel-footprint", "component"],
    ["life-atlas.habit-heatmap", "component"], ["life-atlas.trip-itinerary", "component"], ["life-atlas.travel-packing", "component"],
    ["life-atlas.world-clock", "component"], ["life-atlas.ambient-mixer", "component"], ["life-atlas.life-countdown", "component"],
    ["life-atlas.flashcard-quote", "component"],
  ];
  for (const index of [legacy, catalog]) {
    assert.deepEqual(index.entries.filter(({ id }) => !id.startsWith("community.")).map(({ id, type }) => [id, type]), builtins);
  }
  for (const entry of [...legacy.entries, ...catalog.entries]) {
    const archivePath = path.join(output, entry.packagePath);
    const archive = await readFile(archivePath);
    assert.equal(archive.length, entry.size);
    assert.equal(sha256(archive), entry.sha256);
    const verified = await verifyMarketPack(archive, { appVersion: releaseVersion, publicKeys: keys.publicKeys, expected: entry });
    const png = await readFile(path.join(output, entry.previewPath));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    if (catalog.entries.includes(entry)) {
      assert.ok(png.byteLength <= MAX_THUMBNAIL_BYTES, entry.id + " thumbnail exceeds the card budget");
      assert.ok(Math.max(png.readUInt32BE(16), png.readUInt32BE(20)) <= MAX_THUMBNAIL_EDGE);
    }
    const reader = await openZipFileReader(archivePath);
    try {
      const raw = await reader.read("manifest.json");
      const signature = Buffer.from((await reader.read("manifest.sig")).toString("ascii"), "base64");
      const manifest = JSON.parse(raw);
      assert.ok(keys.publicKeys.some((key) => verify(null, raw, key, signature)));
      for (const key of ["id", "version", "type", "minAppVersion"]) assert.equal(manifest[key], entry[key]);
      assert.deepEqual(reader.entries(), ["manifest.json", "manifest.sig", ...manifest.files.map((file) => file.path)]);
      for (const file of manifest.files) {
        const packed = await reader.read(file.path);
        assert.equal(packed.length, file.size);
        assert.equal(sha256(packed), file.sha256);
      }
      if (entry.id.startsWith("community.dot-")) {
        assert.equal(manifest.apiVersion, 2);
        assert.equal(entry.minAppVersion, "1.3.4");
        assert.deepEqual(verified.capabilities, []);
        assert.ok(verified.uiFiles.has("ui.js") && verified.uiFiles.has("assets/attribution.md"));
        if (["community.dot-carbon", "community.dot-whiteboard"].includes(entry.id)) {
          assert.match(verified.uiFiles.get("assets/licenses/notices.txt").toString("utf8"), /permission/i);
        }
        await assert.rejects(verifyMarketPack(archive, { appVersion: "1.3.3", publicKeys: keys.publicKeys }), { code: "E_UNSUPPORTED_VERSION" });
      } else if (verified.uiFiles && entry.id.startsWith("life-atlas.")) {
        assert.equal(manifest.apiVersion, 2);
        assert.match(entry.version, /^2\.\d+\.\d+$/u);
        assert.equal(entry.minAppVersion, entry.id === "life-atlas.trip-itinerary" ? "1.3.9" : "1.3.1");
        for (const name of ["ui.js", "ui.css", "assets/licenses/react.txt", "assets/licenses/react-dom.txt"]) assert.ok(verified.uiFiles.has(name));
        assert.deepEqual(verified.capabilities, entry.id === "life-atlas.pomodoro" ? ["widget-audio"] : entry.id === "life-atlas.trip-itinerary" ? ["trip-routing"] : []);
        assert.equal(verified.uiFiles.has("assets/standard-alarm.wav"), entry.id === "life-atlas.pomodoro");
        assert.equal(verified.uiFiles.has("assets/maps/regional-streets.json"), entry.id === "life-atlas.trip-itinerary");
        const css = verified.uiFiles.get("ui.css").toString("utf8");
        assert.equal(css.includes(".mw-fp-grid"), entry.id === "life-atlas.travel-footprint");
        assert.equal(css.includes(".mw-hm-grid"), entry.id === "life-atlas.habit-heatmap");
        if (entry.id === "life-atlas.trip-itinerary") {
          const ui = verified.uiFiles.get("ui.js");
          for (const name of ["world-land", "regional-streets", "place-labels", "china-places", "example-routes"]) {
            const relative = "assets/maps/" + name + ".json";
            assert.ok(ui.includes(relative) && verified.uiFiles.has(relative));
          }
          const streets = JSON.parse(verified.uiFiles.get("assets/maps/regional-streets.json"));
          for (const region of streets.regions) for (const lines of Object.values(region.layers)) {
            const samples = lines.flatMap(line => line.match(/[A-Za-z0-9_?@^{}|~]{24,}/gu) || []);
            if (samples.length) {
              const longest = samples.reduce((a, b) => a.length > b.length ? a : b);
              assert.ok(!ui.includes(longest), "Street geometry must stay in the separate map asset");
            }
          }
        }
      } else if (entry.id === "life-atlas.focus-study") {
        assert.equal(verified.template.blocks.find((block) => block.type === "image").props.url, "asset:assets/study.png");
        const original = await readFile(path.join(legacyRoot, legacy.entries.find((old) => old.id === entry.id).previewPath));
        assert.deepEqual(await reader.read("assets/study.png"), original);
        if (catalog.entries.includes(entry)) assert.notEqual(sha256(png), sha256(original));
        else assert.deepEqual(png, original);
      } else if (entry.id.startsWith("life-atlas.")) {
        assert.equal(manifest.apiVersion, 1);
        const slug = entry.previewPath.slice("previews/".length, -4);
        assert.deepEqual(await reader.read("component.js"), await readFile(path.join(legacyRoot, "previews", slug + ".js")));
      }
    } finally { reader.close(); }
  }
  for (const entry of legacy.entries) {
    for (const relative of [entry.packagePath, entry.previewPath]) {
      assert.deepEqual(await readFile(path.join(output, relative)), await readFile(path.join(legacyRoot, relative)));
    }
  }
  const timer = (index) => index.entries.find((item) => item.id === "life-atlas.pomodoro").previewPath;
  const published = JSON.parse(await readFile(path.join(legacyRoot, "catalog-v2.json"), "utf8"));
  assert.equal(timer(catalog), timer(published), "The current Pomodoro artwork should keep its published thumbnail URL");
  assert.notEqual(timer(catalog), timer(legacy), "The older Pomodoro artwork keeps its own preview URL");
  const index = await readFile(path.join(output, "index.html"), "utf8");
  assert.doesNotMatch(index, /src="previews\/|\.atlaspack" rel="(?:preload|prefetch)"/u);
  const data = (await readFile(path.join(output, "catalog-data.js"), "utf8")).trim();
  assert.deepEqual(JSON.parse(data.slice("globalThis.lifeAtlasMarketCatalog = ".length, -1)), catalog);

  await assert.rejects(buildMarketRelease({ outputDirectory: output, signingKey: privateKey }), /输出路径已存在/);
});

test("approved community works publish self-contained signed UI and multi-image templates without sending their content in the web index", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "life-atlas-community-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const community = path.join(root, "community");
  const study = path.join(community, "study-log");
  const widget = path.join(community, "counter");
  const pages = path.join(root, "pages");
  await Promise.all([mkdir(path.join(study, "assets"), { recursive: true }), mkdir(path.join(widget, "assets"), { recursive: true }), mkdir(pages)]);
  const approved = [
    { id: "community.reader.study-log", type: "template", title: "学习日志", description: "记录两次观察",
      version: "1.0.0", minAppVersion: "1.1.0", author: "测试作者", license: "CC BY 4.0", source: "study-log", preview: "preview.png" },
    { id: "community.reader.counter", type: "component", title: "阅读计数", description: "累计阅读次数",
      version: "1.0.0", minAppVersion: "1.3.1", author: "测试作者", license: "MIT", source: "counter", preview: "preview.png" },
  ];
  const body = { title: "学习日志", blocks: ["one", "two"].map((name) => ({ type: "image", props: { url: "asset:assets/" + name + ".png" } })) };
  const script = "(() => { document.getElementById('root').textContent = '阅读计数'; })();";
  const samples = path.join(ROOT, "market", "official");
  const smallOriginal = await readFile(path.join(samples, "pomodoro/preview-ui.png"));
  const pixel = Buffer.from(PNG_1X1_BASE64, "base64");
  await Promise.all([
    writeFile(path.join(community, "approved.json"), JSON.stringify(approved)),
    writeFile(path.join(study, "template.json"), JSON.stringify(body)),
    writeFile(path.join(widget, "ui.js"), script),
    writeFile(path.join(widget, "ui.css"), "#root { color: green; }"),
    writeFile(path.join(widget, "assets", "labels.json"), '{"unit":"本"}'),
    copyFile(path.join(samples, "focus-study/assets/study.png"), path.join(study, "assets/one.png")),
    writeFile(path.join(study, "assets/two.png"), smallOriginal),
    writeFile(path.join(study, "preview.png"), smallOriginal),
    writeFile(path.join(widget, "assets/pixel.png"), pixel),
    writeFile(path.join(widget, "preview.png"), pixel),
  ]);
  const key = generateKeyPairSync("ed25519");
  const publicKeys = [key.publicKey.export({ format: "pem", type: "spki" })];
  const output = path.join(root, "release");
  const build = (options) => buildMarketRelease({ signingKey: key.privateKey, communityDirectory: community, ...options });
  const { catalog } = await build({ outputDirectory: output });
  const additions = catalog.entries.filter((entry) => entry.id.startsWith("community."));
  assert.deepEqual(additions.map(({ id }) => id), approved.map(({ id }) => id));
  const reduced = await readFile(path.join(output, additions[0].previewPath));
  assert.notEqual(sha256(reduced), sha256(smallOriginal), "Anonymous gallery must not fetch the submitted image");
  assert.ok(reduced.length < smallOriginal.length && reduced.readUInt32BE(16) < smallOriginal.readUInt32BE(16));
  assert.equal(catalog.entries.find((entry) => entry.id === "life-atlas.pomodoro").previewPath, additions[0].previewPath,
    "A different work displaying the same image must use the reduced thumbnail too");
  assert.equal(additions[1].previewPath, undefined, "A single-pixel original has no smaller thumbnail");
  for (const entry of catalog.entries.filter((item) => item.previewPath)) {
    const displayedHash = sha256(await readFile(path.join(output, entry.previewPath)));
    assert.ok(![sha256(smallOriginal), sha256(pixel)].includes(displayedHash));
  }
  await stageMarketPages({ releaseDirectory: output, stagingDirectory: pages, version: releaseVersion });
  const site = path.join(pages, "market");
  const legacyBytes = await readFile(path.join(output, "catalog.json"));
  assert.deepEqual(await readFile(path.join(site, "catalog.json")), legacyBytes);
  const legacyEntries = JSON.parse(legacyBytes).entries;
  const footprint = legacyEntries.find((entry) => entry.id === "life-atlas.travel-footprint");
  assert.equal(footprint.previewPath, "previews/travel-footprint.png");
  const currentFootprint = catalog.entries.find((entry) => entry.id === footprint.id);
  const approvedPreview = await readFile(path.join(output, currentFootprint.previewPath));
  assert.notEqual(sha256(approvedPreview), sha256(await readFile(path.join(output, footprint.previewPath))));
  assert.equal(sha256(await readFile(path.join(site, footprint.previewPath))), sha256(approvedPreview));
  assert.deepEqual(await readFile(path.join(site, currentFootprint.previewPath)), approvedPreview);
  for (const entry of legacyEntries.filter((item) => item.previewPath && item.previewPath !== footprint.previewPath)) {
    assert.deepEqual(await readFile(path.join(site, entry.previewPath)), await readFile(path.join(output, entry.previewPath)));
  }
  const browserData = (await readFile(path.join(site, "catalog-data.js"), "utf8")).trim();
  assert.deepEqual(JSON.parse(browserData.slice("globalThis.lifeAtlasMarketCatalog = ".length, -1)), catalog);
  for (const entry of additions) {
    const bytes = await readFile(path.join(site, entry.packagePath));
    const verified = await verifyMarketPack(bytes, { appVersion: "1.3.1", publicKeys, expected: entry });
    assert.ok(verified.meta.description.includes("测试作者"));
    if (entry.type === "component") {
      assert.equal(verified.uiFiles.get("ui.js").toString("utf8"), script);
      assert.ok(verified.uiFiles.has("ui.css") && verified.uiFiles.has("assets/labels.json"));
      assert.deepEqual(verified.uiFiles.get("assets/pixel.png"), pixel);
      assert.deepEqual(verified.capabilities, []);
      await assert.rejects(readFile(path.join(site, "previews", entry.id + "-1.0.0.js")), { code: "ENOENT" });
    } else {
      assert.equal(verified.template.assets.size, 2);
      for (const [name, png] of verified.template.assets) assert.deepEqual(await readFile(path.join(study, name)), png);
    }
  }
  const next = await build({ outputDirectory: path.join(root, "unchanged"), priorDirectory: output });
  assert.deepEqual(next.catalog, catalog);
  await writeFile(path.join(widget, "ui.js"), script + "\n// changed");
  await assert.rejects(build({ outputDirectory: path.join(root, "conflict"), priorDirectory: output }), /提高作品版本号/u);
  await writeFile(path.join(community, "approved.json"), "[]");
  const delisted = await build({ outputDirectory: path.join(root, "delisted"), priorDirectory: output });
  assert.equal(delisted.catalog.entries.find((entry) => entry.id === "life-atlas.pomodoro").previewPath, additions[0].previewPath,
    "Removing a work from the catalogue must still protect the images in its retained signed archive");
});

test("Pomodoro counts down by elapsed time and resumes, resets, and switches rounds", async () => {
  const script = await readFile(path.join(ROOT, "market", "official", "pomodoro", "component.js"), "utf8");
  const scope = vm.createContext({});
  vm.runInContext(script, scope, { timeout: 50 });
  const start = 1_700_000_000_000;
  let state = {};
  const use = (type, now, id) => {
    const result = scope.handleComponentEvent({ state, event: { type, id }, now });
    state = result.state;
    return result.view[1].text;
  };

  assert.equal(use("mount", start), "25:00");
  assert.equal(use("click", start, "toggle"), "25:00");
  assert.equal(use("tick", start + 2_000), "24:58");
  assert.equal(use("click", start + 2_000, "toggle"), "24:58");
  assert.equal(use("tick", start + 10_000), "24:58");
  assert.equal(use("click", start + 10_000, "toggle"), "24:58");
  assert.equal(use("tick", start + 12_000), "24:56");
  assert.equal(use("click", start + 12_000, "reset"), "25:00");
  assert.equal(use("click", start + 12_000, "break"), "05:00");
  assert.equal(use("click", start + 12_000, "toggle"), "05:00");
  assert.equal(use("tick", start + 312_000), "00:00");
  assert.equal(state.endsAt, null);
  assert.equal(use("click", start + 312_000, "focus"), "25:00");
});
