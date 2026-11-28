import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_PACK_BYTES, marketHash, marketPath, validateMarketCatalog, validateMarketPng, verifyMarketPack } from "../electron/main/market/package.js";
import { assertPhysicalPath } from "../electron/main/storage/dataRoot.js";

export async function readDistributionFile(root, relative, limit) {
  if (!marketPath(relative)) throw new Error("无效的分发路径");
  const file = assertPhysicalPath(path.join(root, relative), { root, allowMissing: false });
  const info = await lstat(file);
  if (!info.isFile() || info.size < 1 || info.size > limit) throw new Error("分发文件缺失或大小异常：" + relative);
  const bytes = await readFile(file);
  if (bytes.length !== info.size) throw new Error("读取时分发文件已更改：" + relative);
  return bytes;
}

export async function readCatalogues(root) {
  const read = async (name) => {
    const bytes = await readDistributionFile(root, name, 256 * 1024);
    return { bytes, entries: validateMarketCatalog(bytes) };
  };
  const legacy = await read("catalog.json");
  let rich;
  try { rich = await read("catalog-v2.json"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const { publicKeys } = JSON.parse(await readDistributionFile(root, "trusted-keys.json", 8192));
  if (!Array.isArray(publicKeys) || !publicKeys.length || publicKeys.length > 4 || publicKeys.some((key) => typeof key !== "string" || key.length > 1024)) {
    throw new Error("既有发布目录缺少有效的签名信任根");
  }
  return { legacy, rich, publicKeys };
}

export async function preserveFile(destination, relative, bytes) {
  const file = assertPhysicalPath(path.join(destination, relative), { root: destination });
  await mkdir(path.dirname(file), { recursive: true });
  try { await writeFile(file, bytes, { flag: "wx" }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (!(await readFile(file)).equals(bytes)) throw new Error("已发布路径的内容发生变更：" + relative);
  }
}

// Keep immutable package URLs, including versions which a former catalogue advertised.
export async function copyMarketArchives(source, destination, catalogues, appVersion) {
  const expected = new Map();
  const previews = new Set();
  const packagedImageHashes = new Set();
  for (const entry of [...catalogues.legacy.entries, ...(catalogues.rich?.entries || [])]) {
    if (entry.packagePath !== "packages/" + entry.id + "-" + entry.version + ".atlaspack") throw new Error("版本化包路径无效");
    if (expected.has(entry.packagePath) && expected.get(entry.packagePath).sha256 !== entry.sha256) throw new Error("两个目录引用同版本的不同包");
    expected.set(entry.packagePath, entry);
    if (entry.previewPath) previews.add(entry.previewPath);
  }
  const archives = await readdir(assertPhysicalPath(path.join(source, "packages"), { root: source, allowMissing: false }));
  for (const filename of archives) {
    const relative = "packages/" + filename;
    if (!marketPath(relative) || !filename.endsWith(".atlaspack")) throw new Error("正式包目录含额外文件");
    const bytes = await readDistributionFile(source, relative, MAX_PACK_BYTES);
    const { meta, template, uiFiles } = await verifyMarketPack(bytes, { appVersion, publicKeys: catalogues.publicKeys, expected: expected.get(relative) });
    for (const [name, asset] of uiFiles ?? template?.assets ?? []) {
      if (name.endsWith(".png")) packagedImageHashes.add(marketHash(asset));
    }
    if (filename !== meta.id + "-" + meta.version + ".atlaspack") throw new Error("存档名称与签名身份不符");
    await preserveFile(destination, relative, bytes);
    expected.delete(relative);
  }
  if (expected.size) throw new Error("正式目录引用了缺失的软件包");
  for (const relative of previews) {
    if (!relative.startsWith("previews/")) throw new Error("无效的市集预览路径");
    const png = await readDistributionFile(source, relative, 2 * 1024 * 1024);
    validateMarketPng(png);
    await preserveFile(destination, relative, png);
  }
  return packagedImageHashes;
}
