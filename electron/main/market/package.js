import { createHash, createPublicKey, verify } from "node:crypto";
import yauzl from "yauzl";
import { StorageError } from "../storage/workspaceDb.js";
import { isPlainObject } from "../ipc/validate.js";

export const MAX_PACK_BYTES = 16 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 256;
const manifestLimit = 64 * 1024;
const digestPattern = /^[a-f0-9]{64}$/u;
const versionPattern = /^(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})$/u;
const packageId = /^[a-z][a-z0-9.-]{1,79}$/u;
const headerPng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export const MIN_WIDGET_UI_APP_VERSION = "1.3.1";
const MiB = 1024 * 1024;
const uiAssetTypes = new Map([
  ["png", ["image/png", 4 * MiB]], ["jpg", ["image/jpeg", 4 * MiB]], ["jpeg", ["image/jpeg", 4 * MiB]],
  ["webp", ["image/webp", 4 * MiB]], ["gif", ["image/gif", 4 * MiB]], ["woff2", ["font/woff2", 2 * MiB]],
  ["wav", ["audio/wav", 8 * MiB]], ["mp3", ["audio/mpeg", 8 * MiB]], ["ogg", ["audio/ogg", 8 * MiB]],
  ["json", ["application/json", 12 * MiB]], ["geojson", ["application/geo+json", 12 * MiB]],
  ["txt", ["text/plain", MiB]], ["md", ["text/plain", MiB]],
]);

export function widgetUiFileType(name) {
  if (name === "ui.js") return ["text/javascript", 8 * MiB];
  if (name === "ui.css") return ["text/css", MiB];
  if (marketPath(name) && name.startsWith("assets/")) return uiAssetTypes.get(name.split(".").at(-1)) ?? null;
  return null;
}

function widgetCapabilities(permissions = []) {
  if (!Array.isArray(permissions) || new Set(permissions).size !== permissions.length
    || permissions.some((permission) => !["trip-routing", "widget-audio"].includes(permission))) {
    throw corrupt("富组件含未知或重复的宿主能力");
  }
  return [...permissions];
}

function checkUiFile(bytes, mime) {
  if (mime === "image/png") return validateMarketPng(bytes);
  if (mime === "application/json" || mime === "application/geo+json") return parseMarketJson(bytes, "组件数据");
  if (mime.startsWith("text/")) {
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw corrupt("富组件文本文件编码无效"); }
    return;
  }
  const head = bytes.subarray(0, 12).toString("ascii");
  const valid = {
    "image/jpeg": bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    "image/webp": head.startsWith("RIFF") && head.slice(8) === "WEBP",
    "image/gif": head.startsWith("GIF87a") || head.startsWith("GIF89a"),
    "audio/wav": head.startsWith("RIFF") && head.slice(8) === "WAVE",
    "audio/ogg": head.startsWith("OggS"),
    "audio/mpeg": head.startsWith("ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0),
    "font/woff2": head.startsWith("wOF2"),
  };
  if (!valid[mime]) throw corrupt("富组件媒体文件头与声明类型不符");
}

export const marketHash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const invalid = (message) => new StorageError("E_INVALID_ARGUMENT", message);
const corrupt = (message) => new StorageError("E_CORRUPT", message);

export function parseMarketJson(bytes, label) {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw corrupt(`${label}不是有效的 UTF-8 JSON。`); }
}

export function marketPath(value) {
  return typeof value === "string" && value.length <= 160 && value.split("/")
    .every((part) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(part) && !part.endsWith("."));
}

function text(value, limit, required = true) {
  return typeof value === "string" && !value.includes("\0") && value.length <= limit && (!required || value.trim().length > 0);
}

export function marketMetadata(input) {
  if (!isPlainObject(input) || typeof input.id !== "string" || !packageId.test(input.id)
    || !versionPattern.test(input.version ?? "") || !versionPattern.test(input.minAppVersion ?? "")
    || !["template", "component"].includes(input.type) || !text(input.title, 100) || !text(input.description, 1200)) {
    throw invalid("市集软件包的信息无效。");
  }
  const { id, version, minAppVersion, type, title, description } = input;
  return { id, version, minAppVersion, type, title, description };
}

export function supportsMarketVersion(actual, minimum) {
  const release = typeof actual === "string" ? actual.split("-")[0] : "";
  if (!versionPattern.test(release) || !versionPattern.test(minimum ?? "")) return false;
  const left = release.split(".").map(Number);
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) if (left[index] !== right[index]) return left[index] > right[index];
  return true;
}

export function validateMarketCatalog(bytes) {
  const catalog = parseMarketJson(bytes, "市集目录");
  if (catalog?.formatVersion !== 1 || !Array.isArray(catalog.entries) || catalog.entries.length > 200) throw corrupt("市集目录的格式或版本不可用。");
  const seen = new Set();
  return catalog.entries.map((entry) => {
    const meta = marketMetadata(entry);
    const key = `${meta.id}@${meta.version}`;
    if (seen.has(key) || !marketPath(entry.packagePath) || !entry.packagePath.endsWith(".atlaspack")
      || !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > MAX_PACK_BYTES || !digestPattern.test(entry.sha256 ?? "")
      || (entry.previewPath !== undefined && (!marketPath(entry.previewPath) || !entry.previewPath.endsWith(".png")))) {
      throw corrupt("市集目录中有无效或重复的项目。");
    }
    seen.add(key);
    return { ...meta, packagePath: entry.packagePath, previewPath: entry.previewPath, size: entry.size, sha256: entry.sha256 };
  });
}

export function validateMarketPng(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(headerPng) || bytes.toString("ascii", 12, 16) !== "IHDR") throw corrupt("图片格式无效。");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 4096 || height > 4096) throw corrupt("图片尺寸超出市集软件包限制。");
}

function templateContents(files) {
  const source = files.get("template.json");
  if (!source || source.length > 256 * 1024) throw corrupt("模板正文缺失或过大。");
  const value = parseMarketJson(source, "模板正文");
  if (!isPlainObject(value) || !text(value.title, 100) || !text(value.icon ?? "", 20, false)
    || !Array.isArray(value.blocks) || !value.blocks.length || value.blocks.length > 200) throw corrupt("模板正文无效。");
  const textTypes = ["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "quote"];
  const assets = new Map();
  const blocks = value.blocks.map((block) => {
    if (!isPlainObject(block) || block.children !== undefined || block.id !== undefined) throw corrupt("模板含不支持的区块结构。");
    if (block.type === "image") {
      const link = block.props?.url;
      const asset = typeof link === "string" && link.startsWith("asset:") ? link.slice(6) : "";
      const bytes = files.get(asset);
      if (!asset.startsWith("assets/") || !asset.endsWith(".png") || !bytes) throw corrupt("模板图片没有包含在包内。");
      validateMarketPng(bytes);
      assets.set(asset, bytes);
      const caption = block.props.caption ?? "";
      if (!text(caption, 240, false)) throw corrupt("模板图片说明无效。");
      return { type: "image", props: { url: link, name: asset.split("/").at(-1), caption } };
    }
    if (!textTypes.includes(block.type) || !text(block.content ?? "", 8000, false)) throw corrupt("模板含不支持的区块类型。");
    const props = block.type === "heading" ? { level: [1, 2, 3].includes(block.props?.level) ? block.props.level : 1 }
      : block.type === "checkListItem" ? { checked: block.props?.checked === true } : undefined;
    return { type: block.type, content: block.content ?? "", ...(props ? { props } : {}) };
  });
  if (files.size !== assets.size + 1) throw corrupt("模板含未引用的文件。");
  return { title: value.title, icon: value.icon || "📄", blocks, assets };
}

export async function verifyMarketPack(bytes, { appVersion, publicKeys, expected } = {}) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_PACK_BYTES) throw invalid("请选择不超过 16 MB 的 .atlaspack 文件。");
  const hash = marketHash(bytes);
  if (expected && (bytes.length !== expected.size || hash !== expected.sha256)) throw corrupt("下载的包与市集目录不一致。");
  const zip = await yauzl.fromBufferPromise(bytes, { lazyEntries: true, autoClose: false, decodeStrings: false, validateEntrySizes: true });
  try {
    if (zip.entryCount > MAX_ENTRIES) throw corrupt("软件包包含过多文件。");
    const entries = new Map();
    const folded = new Set();
    let expanded = 0;
    for await (const entry of zip.eachEntry()) {
      const name = new TextDecoder("utf-8", { fatal: true }).decode(entry.fileName);
      expanded += entry.uncompressedSize;
      if (!marketPath(name) || folded.has(name.toLowerCase()) || expanded > MAX_EXPANDED_BYTES
        || entry.isEncrypted() || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw corrupt("软件包有无效路径、重复条目或展开后过大。");
      folded.add(name.toLowerCase());
      entries.set(name, entry);
    }
    async function read(name, limit) {
      const entry = entries.get(name);
      if (!entry || entry.uncompressedSize > limit) throw corrupt("软件包文件缺失或过大。");
      const chunks = [];
      let total = 0;
      for await (const chunk of await zip.openReadStreamPromise(entry)) {
        total += chunk.length;
        if (total > limit) throw corrupt("软件包文件过大。");
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    }
    const manifestBytes = await read("manifest.json", manifestLimit);
    const signatureText = (await read("manifest.sig", 128)).toString("ascii").trim();
    if (!/^[A-Za-z0-9+/]{86}==$/u.test(signatureText)) throw corrupt("软件包签名无效。");
    const signature = Buffer.from(signatureText, "base64");
    const official = (publicKeys ?? []).some((value) => {
      try {
        const key = createPublicKey(value);
        return key.asymmetricKeyType === "ed25519" && verify(null, manifestBytes, key, signature);
      } catch { return false; }
    });
    if (!official) throw new StorageError("E_FORBIDDEN", "无法验证官方签名，未安装软件包。");
    const manifest = parseMarketJson(manifestBytes, "软件包清单");
    const meta = marketMetadata(manifest);
    if (manifest.kind !== "life-atlas-market-package" || manifest.formatVersion !== 1
      || (meta.type === "component" && ![1, 2].includes(manifest.apiVersion)) || !supportsMarketVersion(appVersion, meta.minAppVersion)) {
      throw new StorageError("E_UNSUPPORTED_VERSION", `当前版本无法使用此包。最低要求是 Life Atlas ${meta.minAppVersion}。`);
    }
    const ui = meta.type === "component" && manifest.apiVersion === 2;
    if (ui && !supportsMarketVersion(meta.minAppVersion, MIN_WIDGET_UI_APP_VERSION)) throw corrupt("富组件最低应用版本无效");
    const capabilities = ui ? widgetCapabilities(manifest.permissions) : [];
    if (expected && Object.keys(meta).some((key) => meta[key] !== expected[key])) throw corrupt("软件包信息与市集目录不一致。");
    if (!Array.isArray(manifest.files) || manifest.files.length !== entries.size - 2) throw corrupt("软件包清单与实际文件不一致。");
    const files = new Map();
    for (const entry of manifest.files) {
      if (!marketPath(entry?.path) || ["manifest.json", "manifest.sig"].includes(entry.path) || files.has(entry.path)
        || !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size !== entries.get(entry.path)?.uncompressedSize
        || !digestPattern.test(entry.sha256 ?? "")) throw corrupt("软件包包含无效的文件记录。");
      const uiType = ui && widgetUiFileType(entry.path);
      if (ui && (!uiType || entry.size > uiType[1])) throw corrupt("富组件含不支持或过大的文件");
      const data = await read(entry.path, entry.size);
      if (data.length !== entry.size || marketHash(data) !== entry.sha256) throw corrupt("软件包文件校验失败。");
      if (ui) checkUiFile(data, uiType[0]);
      files.set(entry.path, data);
    }
    if (meta.type === "template") return { meta, hash, template: templateContents(files) };
    if (ui) {
      if (!files.has("ui.js")) throw corrupt("富组件缺少 ui.js 入口");
      return { meta, hash, uiFiles: files, capabilities };
    }
    const script = files.get("component.js");
    if (files.size !== 1 || !script || script.length > 128 * 1024) throw corrupt("组件代码缺失、过大或含不支持的资源。");
    return { meta, hash, source: new TextDecoder("utf-8", { fatal: true }).decode(script) };
  } finally { zip.close(); }
}
