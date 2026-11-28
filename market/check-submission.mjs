import { generateKeyPairSync, sign } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { buffer } from "node:stream/consumers";
import { Script } from "node:vm";
import yazl from "yazl";
import { MIN_WIDGET_UI_APP_VERSION, marketHash, marketPath, validateMarketPng, verifyMarketPack, widgetUiFileType } from "../electron/main/market/package.js";
import { assertPhysicalPath } from "../electron/main/storage/dataRoot.js";

const maxSourceBytes = 64 * 1024 * 1024;
const noticeNames = new Set(["ATTRIBUTION.md", "LICENSE", "LICENSE.txt", "LICENSE.md"]);

export async function readSubmissionFiles(type, directory) {
  const root = assertPhysicalPath(path.resolve(directory), { allowMissing: false });
  const pending = [""];
  const files = new Map();
  let count = 0;
  let total = 0;
  while (pending.length) {
    const parent = pending.pop();
    for (const item of await readdir(path.join(root, parent), { withFileTypes: true })) {
      const relative = parent ? parent + "/" + item.name : item.name;
      if (++count > 256 || !marketPath(relative)) throw new Error("源目录条目过多或含无效文件名");
      const physical = assertPhysicalPath(path.join(root, relative), { root, allowMissing: false });
      const asset = relative === "assets" || relative.startsWith("assets/");
      if (asset && item.isDirectory()) {
        pending.push(relative);
        continue;
      }
      if (!item.isFile()) throw new Error("源目录只接受普通文件及 assets 资源目录");
      const uiType = type === "component" && widgetUiFileType(relative);
      const contentFile = type === "component" ? relative === "component.js" || Boolean(uiType)
        : relative === "template.json" || (asset && relative.endsWith(".png"));
      const preview = relative === "preview.png";
      if (!contentFile && !preview && !noticeNames.has(relative)) throw new Error("投稿含多余文件：" + relative);
      const size = (await stat(physical)).size;
      total += size;
      if (!size || total > maxSourceBytes || (preview && size > 2 * 1024 * 1024) || (uiType && size > uiType[1])) throw new Error("文件为空或超过大小限制");
      if (contentFile || preview) {
        const bytes = await readFile(physical);
        if (bytes.length !== size) throw new Error("读取时文件已更改");
        if (preview) validateMarketPng(bytes);
        else files.set(relative, bytes);
      }
    }
  }
  return files;
}

// Exercise the same package reader as the desktop app with a throwaway, in-memory key.
// No official signing material is needed, and the candidate archive is never published or stored.
export async function checkSubmission(type, directory) {
  if (!["template", "component"].includes(type) || !directory) {
    throw new Error("用法：node market/check-submission.mjs <template|component> <已展开的作品源目录>");
  }
  const files = await readSubmissionFiles(type, directory);
  const ui = type === "component" && files.has("ui.js");
  const version = ui ? MIN_WIDGET_UI_APP_VERSION : "1.1.0";
  const manifest = Buffer.from(JSON.stringify({
    kind: "life-atlas-market-package", formatVersion: 1, type, id: "community.source-check",
    title: "投稿格式检查", description: "本地格式检查", version: "1.0.0", minAppVersion: version,
    ...(type === "component" ? { apiVersion: ui ? 2 : 1 } : {}),
    files: Array.from(files, ([name, bytes]) => ({ path: name, size: bytes.length, sha256: marketHash(bytes) })),
  }));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const zip = new yazl.ZipFile();
  zip.addBuffer(manifest, "manifest.json");
  zip.addBuffer(Buffer.from(sign(null, manifest, privateKey).toString("base64")), "manifest.sig");
  for (const [name, bytes] of files) zip.addBuffer(bytes, name, { compress: !name.endsWith(".png") });
  const archive = buffer(zip.outputStream);
  zip.end();
  const verified = await verifyMarketPack(await archive, {
    appVersion: version, publicKeys: [publicKey.export({ type: "spki", format: "pem" })],
  });
  if (type === "component") {
    const filename = ui ? "ui.js" : "component.js";
    new Script(ui ? verified.uiFiles.get(filename).toString("utf8") : verified.source, { filename }); // Parse without running.
  }
  return { type, files: files.size };
}

if (import.meta.main) {
  try {
    const [type, directory] = process.argv.slice(2);
    const result = await checkSubmission(type, directory);
    console.log(`投稿静态格式通过（${result.files} 个包内文件）。作者授权、使用效果和版本兼容性仍需人工审核。`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
