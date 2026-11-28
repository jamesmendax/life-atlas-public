import fs from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ok, fail, errorResult } from "../ipc/result.js";
import { acceptsNoArguments, isPlainObject, isTrustedSender } from "../ipc/validate.js";
import { assertPhysicalPath } from "../storage/dataRoot.js";
import { componentMime, templateMime, marketMimes } from "../storage/marketArchives.js";
import { createWidgetProtocol } from "./widgetProtocol.js";
import { StorageError } from "../storage/workspaceDb.js";
import { MAX_PACK_BYTES, marketPath, parseMarketJson, supportsMarketVersion, validateMarketCatalog, validateMarketPng, verifyMarketPack } from "./package.js";

export const marketBaseUrl = "https://jamesmendax.github.io/life-atlas-public/market/";
const marketRepositoryUrl = "https://raw.githubusercontent.com/jamesmendax/life-atlas-public/main/market/public/";
export { componentMime, templateMime };
const catalogLimit = 256 * 1024;
const previewLimit = 2 * 1024 * 1024;
const previewImageCacheLimit = 64;
const previewDuration = 10 * 60 * 1000;
const assetPattern = /^life-asset:\/\/([a-f0-9]{64})$/u;
const instancePattern = /^[a-zA-Z0-9:_-]{1,200}$/u;
const invalid = (message) => new StorageError("E_INVALID_ARGUMENT", message);

async function readLocal(filePath, maxBytes) {
  const physical = assertPhysicalPath(filePath, { allowMissing: false });
  const descriptor = await fs.open(physical, "r");
  try {
    const before = await descriptor.stat();
    if (!before.isFile() || before.size < 1 || before.size > maxBytes) throw invalid("所选文件为空或超过大小限制。");
    const result = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < result.length) {
      const { bytesRead } = await descriptor.read(result, size, result.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    const after = await descriptor.stat();
    if (size !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new StorageError("E_CONFLICT", "读取时文件已更改，请重新选择。");
    return result.subarray(0, size);
  } finally { await descriptor.close(); }
}

async function readRemote(fetchImpl, base, relative, maxBytes, timeoutMs = 10000, signal) {
  if (!marketPath(relative)) throw invalid("市集文件路径无效。");
  const url = new URL(relative, base);
  if (url.protocol !== "https:" || url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw invalid("市集文件地址无效。");
  const response = await fetchImpl(url.href, { method: "GET", credentials: "omit", redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
  if (!response?.ok || !response.body) {
    await response?.body?.cancel().catch(() => {});
    throw new StorageError("E_IO", "暂时无法从官方市集下载文件。");
  }
  const reader = response.body.getReader();
  try {
    if (Number(response.headers.get("content-length")) > maxBytes) throw invalid("市集文件超过大小限制。");
    const chunks = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw invalid("市集文件超过大小限制。");
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function previewDataUrl(bytes) {
  validateMarketPng(bytes);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

async function loadTrustedKeys(directory) {
  try {
    const value = parseMarketJson(await readLocal(path.join(directory, "trusted-keys.json"), 8192), "官方信任根");
    if (!Array.isArray(value.publicKeys) || value.publicKeys.length > 4 || value.publicKeys.some((key) => typeof key !== "string" || key.length > 1024)) return [];
    return value.publicKeys;
  } catch { return []; }
}

function catalogueEntries(name, bytes) {
  const entries = validateMarketCatalog(bytes);
  // Legacy preview paths can point to the original template image. Only the
  // rich catalogue is produced with the separate thumbnail pipeline.
  return name === "catalog.json" ? entries.map(entry => ({ ...entry, previewPath: undefined })) : entries;
}

const hashPattern = /^[a-f0-9]{64}$/u;
const unfinished = () => new StorageError("E_CONFLICT", "预览已更改，请重新选择。");
const missing = () => new StorageError("E_NOT_FOUND", "本机没有这个软件包。页面和组件状态已保留。");
const mimeOf = (meta) => meta.type === "component" ? componentMime : templateMime;
const entryKey = (id, version) => `${id}@${version}`;

function archiveName(meta) {
  const title = meta.title.replace(/[\x00-\x1f<>:"/\\|?*]/gu, " ").trim();
  return `${meta.id}@${meta.version} ${title}.atlaspack`;
}

function installedMetadata(row) {
  const current = /^([a-z][a-z0-9.-]+)@([\d.]+) (.*)\.atlaspack$/u.exec(row.originalName ?? "");
  const old = /^([a-z][a-z0-9.-]+)-(\d+\.\d+\.\d+)\.atlaspack$/u.exec(row.originalName ?? "");
  return {
    id: current?.[1] ?? old?.[1] ?? row.sha256, version: current?.[2] ?? old?.[2] ?? "",
    title: current?.[3] || old?.[1] || row.originalName || "已下载的项目",
    type: row.mime === componentMime ? "component" : "template", size: row.size,
    sha256: row.sha256, url: `life-asset://${row.sha256}`, installed: true, compatible: true,
  };
}

function legacyArchiveIndex(directory) {
  try {
    const file = assertPhysicalPath(path.join(directory, "catalog.json"), { root: directory, allowMissing: false });
    const stat = statSync(file);
    if (stat.isFile() && stat.size <= catalogLimit) {
      return new Map(catalogueEntries("catalog.json", readFileSync(file)).map((entry) => [entry.sha256, entry]));
    }
  } catch { /* An imported library can outlive its original catalogue. */ }
  return new Map();
}

export function createMarketService({ appVersion, directory, assetStore, assetCleanup, runtime, dialogs, getWindow, fetchImpl, onRemoveResources, checkWritable = () => true, baseUrl = marketBaseUrl, allowedOrigin }) {
  const root = assertPhysicalPath(directory);
  const primary = new URL(baseUrl);
  const remoteBases = primary.href === marketBaseUrl ? [primary, new URL(marketRepositoryUrl)] : [primary];
  const frames = createWidgetProtocol({ allowedOrigin });
  const keys = loadTrustedKeys(root);
  const catalogEntries = new Map();
  const previewImages = new Map();
  const pendingPreviewImages = new Map();
  let legacyByHash;
  const verifying = new Map();
  const verificationLanes = [Promise.resolve(), Promise.resolve()];
  let nextLane = 0;
  const scripts = new Map();
  let prepared, operation, catalogPromise, closed = false;
  const bundleCatalog = async (name) => catalogueEntries(name, await readLocal(assertPhysicalPath(path.join(root, name), { root, allowMissing: false }), catalogLimit));
  const installedRows = () => assetStore.listByMime?.(marketMimes) ?? (assetStore.list?.() ?? []).filter((row) => marketMimes.includes(row.mime));
  const installedAssetIds = () => installedRows().map((row) => row.sha256);

  function installed() {
    const byHash = new Map([...catalogEntries.values()].map(({ entry }) => [entry.sha256, entry]));
    const entries = installedRows().map((row) => {
      const local = installedMetadata(row);
      let entry = byHash.get(row.sha256);
      if (!entry && local.title === local.id) {
        legacyByHash ??= legacyArchiveIndex(root);
        entry = legacyByHash.get(row.sha256);
        if (!entry) local.title = [...catalogEntries.values()].find(({ entry: work }) => work.id === local.id)?.entry.title || "已下载的旧版作品";
      }
      return entry ? { ...local, ...entry, compatible: supportsMarketVersion(appVersion, entry.minAppVersion) } : local;
    });
    return { entries, totalBytes: entries.reduce((total, item) => total + item.size, 0) };
  }

  async function catalogue() {
    if (catalogPromise) return catalogPromise;
    catalogPromise = (async () => {
      if (!(await keys).length) return { entries: [], origin: "unavailable" };
      // During a staged release, the published catalogue can precede the one
      // shipped with the app. Downloads must follow the published index.
      let entries, sourceBase = null;
      const names = ["catalog-v2.json", "catalog.json"];
      if (fetchImpl) {
        for (const name of names) {
          for (const base of remoteBases) {
            try {
              entries = catalogueEntries(name, await readRemote(fetchImpl, base, name, catalogLimit, 2200));
              sourceBase = base;
              break;
            } catch { /* Try the next fixed official metadata endpoint. */ }
          }
          if (entries) break;
        }
      }
      if (!entries) {
        for (const name of names) {
          try { entries = await bundleCatalog(name); break; } catch { /* An older app may only have catalog.json. */ }
        }
      }
      catalogEntries.clear();
      const hashes = new Set(installedAssetIds());
      for (const entry of entries ?? []) catalogEntries.set(entryKey(entry.id, entry.version), { entry, sourceBase });
      return { origin: entries ? (sourceBase ? "online" : "bundled") : "unavailable", entries: (entries ?? []).map((entry) => ({
        id: entry.id, version: entry.version, minAppVersion: entry.minAppVersion, type: entry.type, title: entry.title, description: entry.description,
        size: entry.size, sha256: entry.sha256, installed: hashes.has(entry.sha256), compatible: supportsMarketVersion(appVersion, entry.minAppVersion),
        hasPreview: Boolean(entry.previewPath), ...(hashes.has(entry.sha256) ? { url: `life-asset://${entry.sha256}` } : {}),
      })) };
    })();
    try { return await catalogPromise; } finally { catalogPromise = null; }
  }

  function lookup(args) {
    if (!isPlainObject(args)) throw invalid("请选择一个市集项目。");
    if (args.sha256 !== undefined) {
      if (typeof args.sha256 !== "string" || !hashPattern.test(args.sha256)) throw invalid("软件包标识无效。");
      const official = [...catalogEntries.values()].find(({ entry }) => entry.sha256 === args.sha256);
      if (official) return official;
      const row = assetStore.get(args.sha256);
      if (row && marketMimes.includes(row.mime)) return { row };
    } else if (typeof args.id === "string" && typeof args.version === "string") {
      const found = catalogEntries.get(entryKey(args.id, args.version));
      if (found) return found;
      const row = installedRows().find((row) => {
        const local = installedMetadata(row);
        return local.id === args.id && local.version === args.version;
      });
      if (row) return { row };
    } else throw invalid("请选择一个市集项目。");
    throw missing();
  }

  function remoteOrder(sourceBase) {
    return sourceBase ? [sourceBase, ...remoteBases.filter((base) => base.href !== sourceBase.href)] : remoteBases;
  }

  async function loadPreviewImage(relative, sourceBase) {
    if (relative.startsWith("previews/")) {
      try {
        const local = assertPhysicalPath(path.join(root, relative), { root, allowMissing: false });
        return previewDataUrl(await readLocal(local, previewLimit));
      } catch { /* Some catalogue entries only have an online thumbnail. */ }
    }
    if (!fetchImpl) return null;
    for (const base of remoteOrder(sourceBase)) {
      try {
        return previewDataUrl(await readRemote(fetchImpl, base, relative, previewLimit, 3500));
      } catch { /* A missing thumbnail falls back to the gallery placeholder. */ }
    }
    return null;
  }

  async function previewImage(args) {
    if (closed) return { url: null };
    const { entry, sourceBase } = lookup(args);
    if (!entry?.previewPath) return { url: null };
    const key = `${entryKey(entry.id, entry.version)}:${entry.sha256}:${entry.previewPath}`;
    const cached = previewImages.get(key);
    if (cached) {
      previewImages.delete(key);
      previewImages.set(key, cached);
      return { url: cached };
    }

    let pending = pendingPreviewImages.get(key);
    if (!pending) {
      pending = loadPreviewImage(entry.previewPath, sourceBase).then((url) => {
        if (url && !closed) {
          if (previewImages.size >= previewImageCacheLimit) previewImages.delete(previewImages.keys().next().value);
          previewImages.set(key, url);
        }
        return url;
      }).finally(() => pendingPreviewImages.delete(key));
      pendingPreviewImages.set(key, pending);
    }
    return { url: await pending };
  }

  function forgetPreview() {
    if (prepared) {
      clearTimeout(prepared.timer);
      frames.releasePreview(prepared.token);
      prepared = null;
    }
  }

  function beginPreview() {
    if (closed) throw unfinished();
    const previous = prepared;
    forgetPreview();
    operation?.abort();
    operation = new AbortController();
    return { current: operation, previous };
  }

  function assertCurrent(current) {
    if (current !== operation || current.signal.aborted || closed) throw unfinished();
  }

  function prepare(bytes, verified, current) {
    assertCurrent(current);
    const token = randomUUID();
    const timer = setTimeout(forgetPreview, previewDuration);
    timer.unref?.();
    prepared = { token, bytes, verified, timer, expires: Date.now() + previewDuration };
    return { ...verified.meta, sha256: verified.hash, size: bytes.length, token, installed: marketMimes.includes(assetStore.get(verified.hash)?.mime),
      blocks: verified.template?.blocks.length ?? 0, assets: verified.template?.assets.size ?? 0 };
  }

  const verify = async (bytes, expected) => verifyMarketPack(bytes, { appVersion, publicKeys: await keys, expected });
  async function preview(args) {
    const { current, previous } = beginPreview();
    const { entry, row: stored, sourceBase } = lookup(args);
    if (entry && !supportsMarketVersion(appVersion, entry.minAppVersion)) throw new StorageError("E_UNSUPPORTED_VERSION", `请先升级到 Life Atlas ${entry.minAppVersion}。`);
    const hash = entry?.sha256 ?? stored.sha256;
    const row = stored ?? assetStore.get(hash);
    if (row && marketMimes.some((type) => row.mime === type || row.mime === `${type};installed=0`)) {
      const bytes = await readLocal(assetStore.filePath(hash), MAX_PACK_BYTES);
      const verified = await verify(bytes, entry);
      if (verified.hash !== hash) throw new StorageError("E_CORRUPT", "本机软件包与原始指纹不一致。");
      return prepare(bytes, verified, current);
    }
    if (previous?.verified.hash === hash && previous.expires >= Date.now()) return prepare(previous.bytes, await verify(previous.bytes, entry), current);
    if (!entry || !fetchImpl) throw new StorageError("E_IO", "本机尚未下载这个软件包。请联网下载，或导入已保存的 .atlaspack 文件。");
    let failure;
    for (const base of remoteOrder(sourceBase)) {
      assertCurrent(current);
      try {
        const bytes = await readRemote(fetchImpl, base, entry.packagePath, Math.min(entry.size, MAX_PACK_BYTES), 10000, current.signal);
        const verified = await verify(bytes, entry);
        return prepare(bytes, verified, current);
      } catch (error) { if (!failure || error.code === "E_CORRUPT" || error.code === "E_FORBIDDEN") failure = error; }
    }
    assertCurrent(current);
    throw failure;
  }

  function withPreview(args) {
    if (!isPlainObject(args) || !prepared || args.token !== prepared.token || prepared.expires <= Date.now()) throw invalid("软件包预览已过期，请重新检查后安装。");
    return prepared;
  }

  async function getComponent(hash) {
    if (!hash || assetStore.get(hash)?.mime !== componentMime) throw missing();
    if (verifying.has(hash)) return verifying.get(hash);
    if (verifying.size >= 128) throw new StorageError("E_CONFLICT", "正在验证其他组件，请稍后重试。");
    const lane = nextLane;
    nextLane = (nextLane + 1) % verificationLanes.length;
    const work = verificationLanes[lane].then(async () => {
      if (closed || assetStore.get(hash)?.mime !== componentMime) throw missing();
      const verified = await verify(await readLocal(assetStore.filePath(hash), MAX_PACK_BYTES));
      if (verified.hash !== hash || verified.meta.type !== "component") throw new StorageError("E_CORRUPT", "本机组件的软件包校验失败。");
      if (closed || assetStore.get(hash)?.mime !== componentMime) throw missing();
      return verified;
    });
    verificationLanes[lane] = work.then(() => {}, () => {});
    verifying.set(hash, work);
    try { return await work; } finally { verifying.delete(hash); }
  }

  function install(args) {
    if (!checkWritable()) throw new StorageError("E_IO", "工作区当前不可写入。");
    const { bytes, verified } = withPreview(args);
    if (args.downloadOnly !== undefined && typeof args.downloadOnly !== "boolean") throw invalid("下载选项无效。");
    const { meta, template } = verified;
    const mime = mimeOf(meta);
    const originalName = archiveName(meta);
    const asset = assetStore.put({ bytes, mime, name: originalName });
    const row = assetStore.get(verified.hash);
    if (row?.mime !== mime || row.originalName !== originalName) {
      if (!assetStore.setMetadata?.({ sha256: verified.hash, previousMime: row?.mime, mime, originalName })) throw new StorageError("E_CONFLICT", "软件包的保存状态已变化，请重试。");
    }
    const result = { ...meta, sha256: verified.hash, size: bytes.length, url: asset.url, installed: true };
    if (template && !args.downloadOnly) {
      const urls = new Map();
      for (const [name, image] of template.assets) urls.set(`asset:${name}`, assetStore.put({ bytes: image, mime: "image/png", name: name.split("/").at(-1) }).url);
      const blocks = template.blocks.map((block) => block.type === "image" ? { ...block, props: { ...block.props, url: urls.get(block.props.url) } } : block);
      result.template = { title: template.title, icon: template.icon, blocks };
    }
    forgetPreview();
    return result;
  }

  return {
    catalogue, installed, installedAssetIds, preview, previewImage, install,
    async pick() {
      const { current } = beginPreview();
      const selection = await dialogs.showOpenDialog(getWindow(), { title: "导入官方市集软件包", properties: ["openFile"], filters: [{ name: "Life Atlas 市集包", extensions: ["atlaspack"] }] });
      assertCurrent(current);
      const file = selection.filePaths?.[0];
      if (selection.canceled || !file) return { cancelled: true };
      if (!/\.atlaspack$/iu.test(file)) throw invalid("请选择 .atlaspack 软件包。");
      const bytes = await readLocal(file, MAX_PACK_BYTES);
      return prepare(bytes, await verify(bytes), current);
    },
    async hostWidget(args) {
      if (!isPlainObject(args) || (typeof args.token === "string") === (typeof args.url === "string")) throw invalid("无效的组件软件包。");
      if (args.preview !== undefined && (typeof args.url !== "string" || typeof args.preview !== "boolean")) throw invalid("无效的组件试玩选项。");
      if (args.token !== undefined) {
        const { verified, token } = withPreview(args);
        if (verified.meta.type !== "component") throw invalid("所选项目不是组件。");
        return frames.open(verified, { previewToken: token });
      }
      const hash = args.url.match(assetPattern)?.[1];
      if (!hash) throw invalid("无效的组件软件包。");
      return frames.open(await getComponent(hash), { preview: args.preview === true });
    },
    serveWidgetResource: frames.serve,
    capabilityOwner: frames.capabilityOwner,
    releaseAllFrames: frames.clear,
    releaseFrame(args) {
      if (!isPlainObject(args) || typeof args.frameUrl !== "string") throw invalid("无效的组件窗口。");
      return { released: frames.release(args.frameUrl) };
    },
    async remove(args) {
      if (!checkWritable()) throw new StorageError("E_IO", "工作区当前不可写入。");
      if (!isPlainObject(args) || typeof args.sha256 !== "string" || !hashPattern.test(args.sha256)) throw invalid("软件包标识无效。");
      const { sha256 } = args;
      const row = assetStore.get(sha256);
      if (!row || !marketMimes.includes(row.mime)) return { sha256, removed: false, releasedBytes: 0, retainedBytes: 0 };
      const archive = await verify(await readLocal(assetStore.filePath(sha256), MAX_PACK_BYTES));
      if (archive.hash !== sha256 || mimeOf(archive.meta) !== row.mime) throw new StorageError("E_CORRUPT", "没有移除未经验证的市集文件。");
      if (!assetCleanup?.removeMarketArchive) throw new StorageError("E_IO", "本机下载管理暂不可用。");
      const result = await assetCleanup.removeMarketArchive({ sha256, mime: row.mime, size: row.size });
      if (prepared?.verified.hash === sha256) forgetPreview();
      frames.releasePackage(sha256);
      scripts.delete(sha256);
      try {
        const cache = await onRemoveResources?.({ sha256, capabilities: archive.capabilities ?? [] });
        return { ...result, cacheReleasedBytes: cache?.cacheReleasedBytes ?? 0, cacheCleanupPending: Boolean(cache?.cacheCleanupPending) };
      } catch { return { ...result, cacheReleasedBytes: 0, cacheCleanupPending: true }; }
    },
    async run(args) {
      if (!isPlainObject(args) || typeof args.id !== "string" || !instancePattern.test(args.id) || typeof args.url !== "string") throw invalid("无效的组件实例。");
      const hash = args.url.match(assetPattern)?.[1];
      if (!hash || assetStore.get(hash)?.mime !== componentMime) throw missing();
      let source = scripts.get(hash);
      if (!source) {
        ({ source } = await getComponent(hash));
        if (typeof source !== "string") throw invalid("此组件需要图形界面。");
        if (scripts.size >= 12) scripts.delete(scripts.keys().next().value);
        scripts.set(hash, source);
      }
      return runtime.run({ id: args.id, hash, source, state: args.state, event: args.event, now: Date.now() });
    },
    release(args) {
      if (!isPlainObject(args) || typeof args.id !== "string" || !instancePattern.test(args.id)) throw invalid("无效的组件实例。");
      runtime.release(args.id);
    },
    close() {
      closed = true;
      operation?.abort();
      forgetPreview();
      frames.clear();
      scripts.clear();
      previewImages.clear();
      pendingPreviewImages.clear();
      runtime.close();
    },
  };
}

export function registerMarketIpc({ ipcMain, getWindow, service }) {
  const operations = {
    catalogue: () => service.catalogue(), installed: () => service.installed(), remove: (args) => service.remove(args),
    "release-frame": (args) => service.releaseFrame(args), "preview-image": (args) => service.previewImage(args),
    preview: (args) => service.preview(args), pick: () => service.pick(), install: (args) => service.install(args),
    "host-widget": (args) => service.hostWidget(args), run: (args) => service.run(args), release: (args) => service.release(args),
  };
  for (const [name, work] of Object.entries(operations)) {
    ipcMain.handle(`la:market:${name}`, async (event, args) => {
      if (!isTrustedSender(event, getWindow())) return fail("E_FORBIDDEN", "市集仅供工作区窗口使用。");
      if (["catalogue", "installed", "pick"].includes(name) && !acceptsNoArguments(args)) return fail("E_INVALID_ARGUMENT", "该操作不接受参数。");
      try { return ok(await work(args)); }
      catch (error) { return errorResult(error, "市集操作未完成，请重试。"); }
    });
  }
}
