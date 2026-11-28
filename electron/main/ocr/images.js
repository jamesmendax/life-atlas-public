import fs from "node:fs/promises";
import { OcrError } from "./errors.js";

export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 24_000_000;
export const MAX_IMAGE_EDGE = 8192;
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG_FRAMES = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegOrientation(segment) {
  if (segment.length < 14 || segment.toString("binary", 0, 6) !== "Exif\0\0") return 1;
  const tiff = segment.subarray(6);
  const order = tiff.toString("ascii", 0, 2);
  if (!["II", "MM"].includes(order)) return 1;
  const read16 = order === "II" ? tiff.readUInt16LE.bind(tiff) : tiff.readUInt16BE.bind(tiff);
  const read32 = order === "II" ? tiff.readUInt32LE.bind(tiff) : tiff.readUInt32BE.bind(tiff);
  if (read16(2) !== 42) return 1;
  const offset = read32(4);
  if (offset < 8 || offset + 2 > tiff.length) return 1;
  const entries = Math.min(read16(offset), Math.floor((tiff.length - offset - 2) / 12));
  for (let entry = offset + 2; entry < offset + 2 + entries * 12; entry += 12) {
    if (read16(entry) !== 0x0112 || read16(entry + 2) !== 3 || read32(entry + 4) !== 1) continue;
    const orientation = read16(entry + 8);
    return orientation >= 1 && orientation <= 8 ? orientation : 1;
  }
  return 1;
}

function jpegInfo(image) {
  let offset = 2;
  let orientation = 1;
  let size;
  while (offset + 3 < image.length && image[offset++] === 0xff) {
    while (image[offset] === 0xff) offset += 1;
    const marker = image[offset++];
    if (marker === 0xda || marker === 0xd9 || offset + 2 > image.length) break;
    const length = image.readUInt16BE(offset);
    if (length < 2 || offset + length > image.length) break;
    if (marker === 0xe1) orientation = jpegOrientation(image.subarray(offset + 2, offset + length));
    if (JPEG_FRAMES.has(marker) && length >= 8) {
      size = { width: image.readUInt16BE(offset + 5), height: image.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return size ? { ...size, orientation } : undefined;
}

function webpInfo(image) {
  if (image.toString("ascii", 0, 4) !== "RIFF" || image.toString("ascii", 8, 12) !== "WEBP") return;
  const format = image.toString("ascii", 12, 16);
  if (format === "VP8X" && image.length >= 30 && !(image[20] & 0x02)) {
    return { width: image.readUIntLE(24, 3) + 1, height: image.readUIntLE(27, 3) + 1 };
  }
  if (format === "VP8L" && image.length >= 25 && image[20] === 0x2f) {
    const bits = image.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (format === "VP8 " && image.length >= 30 && image.readUIntBE(23, 3) === 0x9d012a) {
    return { width: image.readUInt16LE(26) & 0x3fff, height: image.readUInt16LE(28) & 0x3fff };
  }
}

export function inspectImage(image) {
  if (!Buffer.isBuffer(image) || image.length < 24) throw new OcrError("E_OCR_IMAGE");
  if (image.length > MAX_IMAGE_BYTES) throw new OcrError("E_OCR_SIZE");
  let size;
  if (image.subarray(0, 8).equals(PNG_SIGNATURE) && image.toString("ascii", 12, 16) === "IHDR") {
    size = { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
  } else if (image[0] === 0xff && image[1] === 0xd8) {
    size = jpegInfo(image);
  } else {
    size = webpInfo(image);
  }
  if (!size?.width || !size?.height) throw new OcrError("E_OCR_IMAGE");
  const { width, height } = size;
  if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS) {
    throw new OcrError("E_OCR_SIZE");
  }
  return { orientation: 1, ...size };
}

export async function readImageFile(filePath) {
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) throw new OcrError("E_OCR_FILE");
      if (stats.size > MAX_IMAGE_BYTES) throw new OcrError("E_OCR_SIZE");
      const image = Buffer.allocUnsafe(stats.size);
      let offset = 0;
      while (offset < image.length) {
        const { bytesRead } = await handle.read(image, offset, image.length - offset, offset);
        if (bytesRead === 0) throw new OcrError("E_OCR_FILE");
        offset += bytesRead;
      }
      return image;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof OcrError) throw error;
    throw new OcrError("E_OCR_FILE");
  }
}

export function nativeImageBytes(image) {
  const { width, height } = image.getSize(1);
  if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS) {
    throw new OcrError("E_OCR_SIZE");
  }
  return image.toPNG({ scaleFactor: 1 });
}
