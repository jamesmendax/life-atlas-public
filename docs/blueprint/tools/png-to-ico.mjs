#!/usr/bin/env node
// 总设计师提供的工具（WP-19 使用，不要修改）。把若干张正方形 PNG 合成一个 Windows .ico 文件（每个尺寸直接内嵌 PNG，Windows Vista 起支持）。
// 用法：node docs/blueprint/tools/png-to-ico.mjs <输出.ico> <16.png> <24.png> <32.png> <48.png> <64.png> <128.png> <256.png>
// 每个 PNG 必须是正方形，边长 16–256；按给出的顺序写入。
import fs from "node:fs";

const [output, ...inputs] = process.argv.slice(2);
if (!output || !inputs.length) {
  console.error("用法：node docs/blueprint/tools/png-to-ico.mjs <输出.ico> <png…>");
  process.exit(1);
}
const images = inputs.map((file) => {
  const bytes = fs.readFileSync(file);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((value, index) => bytes[index] === value)) throw new Error(`${file} 不是 PNG 文件`);
  if (bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error(`${file} 缺少 IHDR`);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== height || width < 16 || width > 256) throw new Error(`${file} 必须是 16–256 的正方形，现在是 ${width}×${height}`);
  return { file, bytes, size: width };
});
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);   // reserved
header.writeUInt16LE(1, 2);   // type: icon
header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map((image) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(image.size === 256 ? 0 : image.size, 0);
  entry.writeUInt8(image.size === 256 ? 0 : image.size, 1);
  entry.writeUInt8(0, 2);      // palette colors
  entry.writeUInt8(0, 3);      // reserved
  entry.writeUInt16LE(1, 4);   // color planes
  entry.writeUInt16LE(32, 6);  // bits per pixel
  entry.writeUInt32LE(image.bytes.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += image.bytes.length;
  return entry;
});
fs.writeFileSync(output, Buffer.concat([header, ...entries, ...images.map((image) => image.bytes)]));
console.log(`[png-to-ico] ${output} sizes=${images.map((image) => image.size).join(",")} bytes=${offset}`);
