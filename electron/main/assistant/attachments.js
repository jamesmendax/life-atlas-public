import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import yauzl from "yauzl";
import { recognizeImage } from "../ocr/engine.js";
import { inspectImage } from "../ocr/images.js";
import { assistantError } from "./errors.js";

const maxBytes = 16 * 1024 * 1024;
const maxModelImageBytes = 768 * 1024;
const maxExtractedText = 9600;
const assetPattern = /^life-asset:\/\/([a-f0-9]{64})$/;
const textFile = /\.(?:txt|md|markdown|csv|tsv|json|jsonl|html?|xml|yaml|yml|log|ini|toml|css|[cm]?js|ts|tsx|jsx|py|sql|java|rs|go)$/i;
const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function attachmentName(value) {
  return typeof value === "string" ? value.split(/[\\/]/).at(-1).replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 220) : "";
}

function imageMime(bytes) {
  if (bytes.length < 24) return "";
  let mime = "";
  if (bytes.toString("hex", 0, 8) === "89504e470d0a1a0a") mime = "image/png";
  else if (bytes[0] === 0xff && bytes[1] === 0xd8) mime = "image/jpeg";
  else if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") mime = "image/webp";
  if (mime) {
    try { inspectImage(bytes); } catch { return ""; }
  }
  return mime;
}

function modelImage(bytes, mime, nativeImage) {
  if (bytes.length <= maxModelImageBytes) return "data:" + mime + ";base64," + bytes.toString("base64");
  const photo = nativeImage?.createFromBuffer(bytes);
  if (!photo || photo.isEmpty()) return undefined;
  const { width, height } = photo.getSize();
  const scale = Math.min(1, 1500 / Math.max(width, height));
  const resized = scale === 1 ? photo : photo.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) });
  const jpeg = resized.toJPEG(80);
  return jpeg.length <= maxModelImageBytes ? "data:image/jpeg;base64," + jpeg.toString("base64") : undefined;
}

function docxText(bytes) {
  return new Promise((resolve) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error) { resolve(""); return; }
      let scanned = 0;
      const finish = (text = "") => { zip.close(); resolve(text); };
      zip.once("error", () => finish());
      zip.once("end", () => finish());
      zip.on("entry", (entry) => {
        scanned += 1;
        if (scanned > 2048) { finish(); return; }
        if (entry.fileName !== "word/document.xml") { zip.readEntry(); return; }
        if (entry.uncompressedSize > 2 * 1024 * 1024) { finish(); return; }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) { finish(); return; }
          const chunks = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.once("error", () => finish());
          stream.once("end", () => finish(Buffer.concat(chunks).toString("utf8")
            .replace(/<\/w:p>/g, "\n").replace(/<w:tab\b[^>]*>/g, "\t").replace(/<w:br\b[^>]*>/g, "\n")
            .replace(/<[^>]+>/g, "").replace(/&(amp|quot|apos|lt|gt);/g, (_, key) => ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" })[key])));
        });
      });
      zip.readEntry();
    });
  });
}

async function textExcerpt(bytes, mime, name) {
  if (mime === docxMime || /\.docx$/i.test(name)) return (await docxText(bytes)).slice(0, maxExtractedText);
  if (!mime.startsWith("text/") && !textFile.test(name)) return "";
  const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : null;
  const slice = bytes.subarray(0, 4 * maxExtractedText);
  try {
    const decoded = new TextDecoder(utf16 || "utf-8", { fatal: true }).decode(slice, { stream: slice.length < bytes.length });
    return decoded.includes("\0") ? "" : decoded.trim().slice(0, maxExtractedText);
  } catch { return ""; }
}

export function createAssistantAttachments({ assetStore, nativeImage, recognize = recognizeImage }) {
  async function describe({ assetUrl, name, bytes, mimeType }) {
    const usableMime = imageMime(bytes);
    const text = !usableMime ? await textExcerpt(bytes, mimeType, name) : "";
    const imageUrl = usableMime ? modelImage(bytes, usableMime, nativeImage) : undefined;
    return {
      id: randomUUID(), name, assetUrl, mimeType: usableMime || mimeType, size: bytes.length,
      kind: usableMime ? "image" : text ? "text" : "file",
      ...(text ? { text } : {}),
      ...(imageUrl ? { imageUrl } : {}),
    };
  }

  function requireAvailable() {
    if (!assetStore) throw assistantError("E_IO", "附件服务尚未就绪。");
  }

  async function read(assetUrl) {
    requireAvailable();
    const id = assetPattern.exec(typeof assetUrl === "string" ? assetUrl : "")?.[1];
    if (!id) throw assistantError("E_INVALID_ARGUMENT", "请选择 Life Atlas 中的附件。");
    const meta = assetStore.get(id);
    if (!meta) throw assistantError("E_NOT_FOUND", "找不到此附件。");
    const handle = await fs.open(assetStore.filePath(id), "r");
    try {
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size < 1 || stats.size > maxBytes || stats.size !== meta.size) {
        throw assistantError("E_IO", "附件文件不可读取或超过 16 MiB。");
      }
      const bytes = await handle.readFile();
      return { meta, bytes };
    } finally { await handle.close(); }
  }

  return {
    async prepare({ name: rawName, mimeType: rawMime, bytes: input } = {}) {
      requireAvailable();
      const name = attachmentName(rawName);
      if (!(input instanceof Uint8Array) || !name || !input.byteLength || input.byteLength > maxBytes) {
        throw assistantError("E_INVALID_ARGUMENT", "请选择 16 MiB 以内的附件。");
      }
      const bytes = Buffer.from(input);
      const validMime = typeof rawMime === "string" && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(rawMime) && !rawMime.startsWith("image/");
      const mimeType = imageMime(bytes) || (validMime ? rawMime : "application/octet-stream");
      const { url: assetUrl } = assetStore.put({ bytes, mime: mimeType, name });
      return describe({ assetUrl, name, bytes, mimeType });
    },
    async load({ assetUrl, name: rawName } = {}) {
      const { meta, bytes } = await read(assetUrl);
      return describe({ assetUrl, name: attachmentName(rawName) || meta.originalName, bytes, mimeType: meta.mime });
    },
    async ocr({ assetUrl } = {}) {
      const { bytes } = await read(assetUrl);
      if (!imageMime(bytes)) throw assistantError("E_INVALID_ARGUMENT", "这份附件没有可识别的图片。");
      const text = await recognize(bytes, "chi_sim+eng", { timeoutMs: 20000 });
      return { text: text.slice(0, maxExtractedText) };
    },
    captureWebImage({ bytes, name: rawName }) {
      requireAvailable();
      const mime = imageMime(bytes);
      if (!mime) throw assistantError("E_INVALID_ARGUMENT", "网络图片格式无效或超过图片尺寸限制。");
      const name = attachmentName(rawName) || "网页图片";
      const { url } = assetStore.put({ bytes, mime, name });
      return { url, name, mime, kind: "image" };
    },
  };
}
