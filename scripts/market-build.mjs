import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { buffer } from "node:stream/consumers";
import yazl from "yazl";
import { openZipFileReader } from "../electron/main/backup/zipNode.js";
import { MAX_PACK_BYTES, MIN_WIDGET_UI_APP_VERSION, marketMetadata, marketPath, validateMarketCatalog, verifyMarketPack } from "../electron/main/market/package.js";
import { assertPhysicalPath } from "../electron/main/storage/dataRoot.js";
import { readSubmissionFiles } from "../market/check-submission.mjs";
import { copyMarketArchives, readCatalogues, readDistributionFile } from "./market-archives.mjs";
import { buildWidgetUi } from "./market-widget-bundles.mjs";
import { createThumbnailWriter } from "./market-thumbnails.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DEFAULT_OUTPUT = path.join(ROOT, "market", "public");
const MIN_APP_VERSION = "1.1.0";
const RELEASE_ITEMS = [
  {
    id: "life-atlas.focus-study",
    version: "1.0.0",
    minAppVersion: "1.1.0",
    type: "template",
    title: "专注学习页",
    description: "从本轮目标开始，把学习笔记和下次要做的事留在同一页。",
    source: "focus-study",
    files: ["template.json", "assets/study.png"],
    preview: "assets/study.png",
  },
  {
    id: "life-atlas.pomodoro",
    permissions: ["widget-audio"],
    version: "2.0.2",
    minAppVersion: MIN_WIDGET_UI_APP_VERSION,
    type: "component",
    title: "番茄钟",
    description: "在页面内倒计时，随时暂停，并在 25 分钟专注和 5 分钟休息间切换。",
    source: "pomodoro",
    preview: "preview-ui.png",
  },
  {
    id: "life-atlas.travel-footprint",
    version: "2.0.3",
    minAppVersion: MIN_WIDGET_UI_APP_VERSION,
    type: "component",
    title: "交互式足迹点亮地图",
    description: "在全国地图上逐个点亮去过的地级市和自治州，直辖市可细到区县。搜索城市或景点，在城市手记里记录旅行日期、打卡地点和见闻，也可切换日本和世界地图。",
    source: "travel-footprint",
    preview: "preview-ui.png",
  },
  {
    id: "life-atlas.habit-heatmap",
    version: "2.0.2",
    minAppVersion: MIN_WIDGET_UI_APP_VERSION,
    type: "component",
    title: "习惯打卡热力日历图",
    description: "GitHub 风格年度坚持热力矩阵，支持多习惯新建与切换、今日一键打卡/补卡、连续天数与近 30 天达成率统计。",
    source: "habit-heatmap",
    preview: "preview-ui.png",
  },
  {
    id: "life-atlas.trip-itinerary",
    permissions: ["trip-routing"],
    version: "2.4.5",
    minAppVersion: "1.3.9",
    type: "component",
    title: "旅行计划与路线地图",
    description: "安排多日旅行，搜索地点和入口。点选两站可计算道路与耗时。可选配本机高德 Web 服务 Key，准备区域路网后可离线计算驾车、骑行和步行。",
    source: "trip-itinerary",
    preview: "preview-ui.png",
  },
  {
    id: "life-atlas.travel-packing",
    version: "2.0.2",
    minAppVersion: MIN_WIDGET_UI_APP_VERSION,
    type: "component",
    title: "旅行智能打包清单",
    description: "内置城市漫游、海岛度假、商务差旅与户外露营 4 套打包预设，实时统计装入进度与预估重量。",
    source: "travel-packing",
    preview: "preview-ui.png",
  },
  {
    id: "life-atlas.world-clock",
    version: "2.0.2",
    minAppVersion: MIN_WIDGET_UI_APP_VERSION,
    type: "component",
    title: "世界时钟与跨区换算",
    description: "多城市模拟表盘与实时数字时钟，支持 ±12 小时时间旅行滑块一键换算全球任意时刻。",
    source: "world-clock",
    preview: "preview-ui.png",
  },
  {
    id: "life-atlas.ambient-mixer",
    version: "2.0.2",
    minAppVersion: MIN_WIDGET_UI_APP_VERSION,
    type: "component",
    title: "白噪音专注混音台",
    description: "基于 Web Audio API 的纯离线声景合成器，支持细雨、森林、壁炉、咖啡馆、海浪与粉红专注音 6 轨自由混音。",
    source: "ambient-mixer",
    preview: "preview-ui.png",
  },
  {
    id: "life-atlas.life-countdown",
    version: "2.0.1",
    minAppVersion: MIN_WIDGET_UI_APP_VERSION,
    type: "component",
    title: "时光进度条与重要倒计时",
    description: "精确呈现今年/本月/本周/今日的时间进度，并在页面内追踪多个多彩重要里程碑倒计时。",
    source: "life-countdown",
    preview: "preview-ui.png",
  },
  {
    id: "life-atlas.flashcard-quote",
    version: "2.0.2",
    minAppVersion: MIN_WIDGET_UI_APP_VERSION,
    type: "component",
    title: "3D 间隔闪卡与每日金句",
    description: "3D 立体翻面学习卡片，支持不熟/模糊/已掌握分级复习，并可直接在页面内新增自定义知识卡片。",
    source: "flashcard-quote",
    preview: "preview-ui.png",
  },
];

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");

async function assertNewDirectory(directory) {
  try { await lstat(directory); } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`输出路径已存在，请选择新的目录：${directory}`);
}

async function publishDirectory(staging, destination) {
  for (const wait of [50, 100, 200, 400]) {
    await assertNewDirectory(destination);
    try { await rename(staging, destination); return; } catch (error) {
      if (process.platform !== "win32" || !["EPERM", "EBUSY", "EACCES"].includes(error.code)) throw error;
      await delay(wait);
    }
  }
  await assertNewDirectory(destination);
  await rename(staging, destination);
}

async function writePackage(destination, manifest, privateKey, files) {
  const manifestBytes = json(manifest);
  const signature = sign(null, manifestBytes, privateKey).toString("base64");
  const zip = new yazl.ZipFile();
  const options = { mtime: new Date(2000, 0, 1, 12), forceDosTimestamp: true, mode: 0o100644 };
  zip.addBuffer(manifestBytes, "manifest.json", options);
  zip.addBuffer(Buffer.from(signature, "ascii"), "manifest.sig", options);
  for (const file of files) zip.addBuffer(file.bytes, file.path, { ...options, compress: !file.path.endsWith(".png") });
  const archive = buffer(zip.outputStream);
  zip.end();
  await writeFile(destination, await archive, { flag: "wx" });
}

async function readApprovedItems(directory) {
  const list = assertPhysicalPath(path.join(directory, "approved.json"), { root: directory, allowMissing: false });
  const approved = JSON.parse(await readFile(list, "utf8"));
  if (!Array.isArray(approved) || approved.length + RELEASE_ITEMS.length > 200) throw new Error("市集准入名单格式或数量无效");
  const ids = new Set();
  return approved.map((item) => {
    if (!item || !marketPath(item.source) || item.source.includes("/") || !marketPath(item.preview) || !item.preview.endsWith(".png")
      || ![item.author, item.license].every((value) => typeof value === "string" && value.trim() && value.length <= 120)) {
      throw new Error("社区作品需要有效的源目录、PNG 预览、作者和许可");
    }
    const info = marketMetadata(item);
    if (!info.id.startsWith("community.") || ids.has(info.id)) throw new Error("社区作品 ID 必须使用 community. 前缀且每件作品只列一个当前版本");
    ids.add(info.id);
    return { ...info, description: info.description + "\n作者 " + item.author.trim() + " · " + item.license.trim(),
      source: item.source, preview: item.preview, community: true, permissions: item.permissions };
  });
}

async function reusePublishedPackage(priorDirectory, relative, manifest, destination, verification) {
  const file = assertPhysicalPath(path.join(priorDirectory, relative), { root: priorDirectory });
  const stats = await lstat(file).catch((error) => { if (error.code !== "ENOENT") throw error; return null; });
  if (!stats) return false;
  if (!stats.isFile() || stats.size > MAX_PACK_BYTES) throw new Error("既有正式包格式无效");
  const bytes = await readFile(file);
  try {
    await verifyMarketPack(bytes, verification);
  } catch (error) {
    if (error.code === "E_FORBIDDEN") return false; // Independent test releases have their own trust root.
    throw error;
  }
  const reader = await openZipFileReader(file);
  try {
    const previous = JSON.parse(await reader.read("manifest.json"));
    if (!isDeepStrictEqual(previous, manifest)) throw new Error("已发布的 " + manifest.id + " 内容发生变更，请提高作品版本号");
  } finally { reader.close(); }
  await writeFile(destination, bytes, { flag: "wx" });
  return true;
}

async function buildItem(item, staging, { privateKey, verification, communityDirectory, priorDirectory }) {
  const sourceRoot = item.community ? communityDirectory : path.join(ROOT, "market", "official");
  const source = assertPhysicalPath(path.join(sourceRoot, item.source), { root: sourceRoot, allowMissing: false });
  let contents;
  if (item.community) contents = await readSubmissionFiles(item.type, source);
  else if (item.type === "component") contents = await buildWidgetUi(item.source);
  else contents = new Map(await Promise.all(item.files.map(async (name) => [name, await readFile(path.join(source, name))])));
  const names = [...contents.keys()];
  if (item.community || item.type === "component") names.sort();
  const files = names.map((name) => {
    const bytes = contents.get(name);
    return { path: name, size: bytes.length, sha256: digest(bytes), bytes };
  });
  const info = marketMetadata({ ...item, minAppVersion: item.minAppVersion || MIN_APP_VERSION });
  const { id, type, version } = info;
  const ui = type === "component" && contents.has("ui.js");
  if (item.permissions !== undefined && !ui) throw new Error("只有富组件可申请宿主能力");
  const manifest = {
    kind: "life-atlas-market-package",
    formatVersion: 1,
    ...info,
    ...(type === "component" ? { apiVersion: ui ? 2 : 1 } : {}),
    ...(item.permissions !== undefined ? { permissions: item.permissions } : {}),
    files: files.map(({ bytes, ...file }) => file),
  };
  const packagePath = `packages/${id}-${version}.atlaspack`;
  const destination = path.join(staging, packagePath);
  if (!await reusePublishedPackage(priorDirectory, packagePath, manifest, destination, verification)) {
    await writePackage(destination, manifest, privateKey, files);
  }
  const archive = await readFile(destination);
  const archiveInfo = { size: archive.length, sha256: digest(archive) };
  await verifyMarketPack(archive, { ...verification, expected: { ...info, ...archiveInfo } });
  const imageHashes = files.filter((file) => file.path.endsWith(".png")).map((file) => file.sha256);
  return { info, packagePath, source, preview: item.preview, archiveInfo, imageHashes };
}

export async function buildMarketRelease({ outputDirectory = DEFAULT_OUTPUT, signingKey, extraTrustedPublicKeys = [],
  communityDirectory = path.join(ROOT, "market", "community"), priorDirectory = DEFAULT_OUTPUT, only }) {
  const privateKey = signingKey?.type === "private" ? signingKey : createPrivateKey(signingKey);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("请使用 Ed25519 私钥签名市集包");
  const publicKey = createPublicKey(privateKey).export({ format: "pem", type: "spki" });
  const prior = assertPhysicalPath(path.resolve(priorDirectory), { allowMissing: false });
  const historical = await readCatalogues(prior);
  const trustedPublicKeys = Array.from(new Set([publicKey, ...historical.publicKeys, ...extraTrustedPublicKeys.filter((k) => typeof k === "string" && k.trim())]));
  if (trustedPublicKeys.length > 4) throw new Error("信任公钥最多保留 4 把");
  const destination = assertPhysicalPath(path.resolve(outputDirectory));
  await assertNewDirectory(destination);
  const communityRoot = assertPhysicalPath(path.resolve(communityDirectory), { allowMissing: false });
  const approved = await readApprovedItems(communityRoot);
  const candidates = [...RELEASE_ITEMS, ...approved];
  const selectedIds = only ? new Set(only.split(",").map(id => id.trim())) : null;
  const selected = selectedIds ? candidates.filter(item => selectedIds.has(item.id)) : candidates;
  if (!selected.length || (selectedIds && selected.length !== selectedIds.size)) throw new Error("未找到指定的市集作品");
  const { version: appVersion } = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  const staging = await mkdtemp(path.join(path.dirname(destination), ".market-staging-"));
  try {
    await Promise.all(["packages", "previews"].map((folder) => mkdir(path.join(staging, folder))));
    const options = { privateKey, verification: { appVersion, publicKeys: trustedPublicKeys },
      communityDirectory: communityRoot, priorDirectory: prior };
    const packages = [];
    for (const item of selected) packages.push(await buildItem(item, staging, options));
    // A community work can use another work's cover as an asset. Resolve every
    // thumbnail after the new and retained signed packages have been checked.
    const packagedImageHashes = await copyMarketArchives(prior, staging, historical, appVersion);
    for (const item of packages) for (const hash of item.imageHashes) packagedImageHashes.add(hash);
    const writeThumbnail = await createThumbnailWriter(staging, prior, historical, packagedImageHashes);
    const entries = [];
    for (const item of packages) {
      const preview = await readDistributionFile(item.source, item.preview, 2 * 1024 * 1024);
      const previewPath = await writeThumbnail(preview);
      entries.push({ ...item.info, packagePath: item.packagePath, ...(previewPath ? { previewPath } : {}), ...item.archiveInfo });
    }
    const previous = (historical.rich || historical.legacy).entries;
    const updates = new Map(entries.map(entry => [entry.id, entry]));
    const previousIds = new Set(previous.map(entry => entry.id));
    const catalog = { formatVersion: 1, entries: selectedIds
      ? [...previous.map(entry => updates.get(entry.id) ?? entry), ...entries.filter(entry => !previousIds.has(entry.id))]
      : entries };
    const bytes = json(catalog);
    if (bytes.length > 256 * 1024) throw new Error("市集目录超过桌面读取上限");
    validateMarketCatalog(bytes);
    await Promise.all([
      ...["index.html", "market.css", "market.js"].map((file) => copyFile(path.join(ROOT, "market", "site", file), path.join(staging, file))),
      copyFile(path.join(ROOT, "src", "ui", "themes", "mobai", "tokens.css"), path.join(staging, "theme.css")),
      copyFile(path.join(ROOT, "build", "icons", "icon-64.png"), path.join(staging, "app-icon.png")),
      writeFile(path.join(staging, "catalog.json"), historical.legacy.bytes),
      writeFile(path.join(staging, "catalog-v2.json"), bytes),
      writeFile(path.join(staging, "catalog-data.js"), `globalThis.lifeAtlasMarketCatalog = ${JSON.stringify(catalog)};\n`, "utf8"),
      writeFile(path.join(staging, "trusted-keys.json"), json({ publicKeys: trustedPublicKeys })),
    ]);
    await publishDirectory(staging, destination);
    return { outputDirectory: destination, catalog };
  } catch (error) {
    if (path.isAbsolute(staging) && path.dirname(staging) === path.dirname(destination) && path.basename(staging).startsWith(".market-staging-")) {
      await rm(staging, { recursive: true, force: true, maxRetries: 3 });
    }
    throw error;
  }
}

async function runCli(args) {
  const usage = "用法：node scripts/market-build.mjs [--key-stdin | --signing-key <Ed25519 私钥 PEM 文件>] --output <新的输出目录> [--prior <上一版完整分发目录>] [--only <作品 ID，用逗号分隔>] [--preserve-trusted-keys <trusted-keys.json>]。也可通过 LIFE_ATLAS_MARKET_SIGNING_KEY 提供 PEM。";
  if (args.length === 1 && args[0] === "--help") { console.log(usage); return; }
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!["--key-stdin", "--signing-key", "--output", "--prior", "--preserve-trusted-keys", "--only"].includes(key) || Object.hasOwn(options, key)) throw new Error(usage);
    options[key] = key === "--key-stdin" ? true : args[++index];
    if (!options[key] || typeof options[key] === "string" && options[key].startsWith("--")) throw new Error(usage);
  }
  if (options["--key-stdin"] && options["--signing-key"]) throw new Error(usage);
  let signingKey = process.env.LIFE_ATLAS_MARKET_SIGNING_KEY;
  if (options["--signing-key"]) signingKey = await readFile(path.resolve(options["--signing-key"]));
  if (options["--key-stdin"]) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    signingKey = Buffer.concat(chunks);
  }
  let extraTrustedPublicKeys = [];
  if (options["--preserve-trusted-keys"]) {
    const existing = JSON.parse(await readFile(path.resolve(options["--preserve-trusted-keys"]), "utf8"));
    if (Array.isArray(existing?.publicKeys)) extraTrustedPublicKeys = existing.publicKeys;
  }
  if (!signingKey?.length || !options["--output"]) throw new Error(usage);
  const release = await buildMarketRelease({ outputDirectory: options["--output"], priorDirectory: options["--prior"], only: options["--only"], signingKey, extraTrustedPublicKeys });
  console.log(`${release.catalog.entries.length} 个已签名的市集包已生成：${release.outputDirectory}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
