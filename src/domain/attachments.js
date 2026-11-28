import { newEntityId } from "./blockDocument.js";

const nowIso = () => new Date().toISOString();
const allowedProviders = new Set(["external", "builtin", "local-ref", "asset"]);
const browserObjectUrls = new Map();

function invalidateBrowserObjectUrl(id) {
  const cached = browserObjectUrls.get(id);
  browserObjectUrls.delete(id);
  if (cached) void cached.then((url) => { if (url) URL.revokeObjectURL(url.split("#")[0]); }).catch(() => {});
}

export function normalizeAttachment(input, fallbackTime = "1970-01-01T00:00:00.000Z") {
  const source = input && typeof input === "object" ? input : {};
  const provider = allowedProviders.has(source.provider) ? source.provider : source.kind === "builtin" ? "builtin" : source.kind === "local-ref" ? "local-ref" : "external";
  const externalUrl = typeof source.externalUrl === "string" ? source.externalUrl : provider === "external" && typeof source.uri === "string" ? source.uri : null;
  return {
    ...source,
    id: String(source.id || newEntityId("attachment")),
    name: String(source.name || "附件").slice(0, 255),
    mime: source.mime || source.mimeType || "application/octet-stream",
    size: Number.isFinite(source.size) ? source.size : null,
    createdAt: source.createdAt || fallbackTime,
    updatedAt: source.updatedAt || source.createdAt || fallbackTime,
    checksum: source.checksum || null,
    provider,
    storageKey: source.storageKey || null,
    externalUrl: externalUrl || null,
    metadata: source.metadata && typeof source.metadata === "object" ? source.metadata : {},
  };
}

export function createAttachmentMetadata(input = {}, { id = newEntityId("attachment"), now = nowIso() } = {}) {
  return normalizeAttachment({ ...input, id, createdAt: now, updatedAt: now }, now);
}

export function createAttachmentProvider({ builtin = new Map(), localRefs = new Map() } = {}) {
  return {
    async put(file) {
      if (!file || typeof file !== "object") throw new Error("附件对象无效");
      if (typeof file.url === "string" && /^https?:\/\//i.test(file.url)) return { provider:"external", externalUrl:file.url, storageKey:file.url };
      if (typeof file.builtinKey === "string") { builtin.set(file.builtinKey, file.value ?? file.builtinKey); return { provider:"builtin", storageKey:file.builtinKey }; }
      if (typeof file.localRef === "string") { localRefs.set(file.localRef, file.value ?? file.localRef); return { provider:"local-ref", storageKey:file.localRef }; }
      throw new Error("当前本地提供器只保存外部、本地引用或内置资产定位符；不会把二进制写入工作区 JSON");
    },
    async get(locator) {
      if (locator?.provider === "external") return locator.externalUrl || locator.storageKey || null;
      if (locator?.provider === "builtin") return builtin.get(locator.storageKey) ?? null;
      if (locator?.provider === "local-ref") return localRefs.get(locator.storageKey) ?? null;
      return null;
    },
    async remove(locator) {
      if (locator?.provider === "builtin") builtin.delete(locator.storageKey);
      if (locator?.provider === "local-ref") localRefs.delete(locator.storageKey);
    },
    canPersistLocally() { return false; },
  };
}

const attachmentDbName = "life-atlas.attachments.v1";
const attachmentStoreName = "blobs";
const attachmentFragment = "life-attachment=";
const memoryBlobs = new Map();

function indexedDbAvailable() {
  return typeof indexedDB !== "undefined";
}

function openAttachmentDb() {
  return new Promise((resolve, reject) => {
    if (!indexedDbAvailable()) return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open(attachmentDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(attachmentStoreName)) db.createObjectStore(attachmentStoreName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Attachment database open failed"));
  });
}

async function idbWrite(id, value) {
  const db = await openAttachmentDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(attachmentStoreName, "readwrite");
      tx.objectStore(attachmentStoreName).put(value, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Attachment write failed"));
      tx.onabort = () => reject(tx.error || new Error("Attachment write aborted"));
    });
  } finally {
    db.close();
  }
}

async function idbRead(id) {
  const db = await openAttachmentDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(attachmentStoreName, "readonly");
      const request = tx.objectStore(attachmentStoreName).get(id);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error || new Error("Attachment read failed"));
    });
  } finally {
    db.close();
  }
}

export function attachmentIdFromUrl(url) {
  if (typeof url !== "string") return null;
  const marker = url.indexOf(`#${attachmentFragment}`);
  if (marker < 0) return null;
  try {
    return decodeURIComponent(url.slice(marker + attachmentFragment.length + 1));
  } catch {
    return null;
  }
}

export function attachmentUrlWithId(url, id) {
  const base = String(url || "").split("#")[0];
  return `${base}#${attachmentFragment}${encodeURIComponent(String(id))}`;
}

export async function persistBrowserAttachment(file, { id = newEntityId("attachment"), now = nowIso() } = {}) {
  if (!file || typeof file !== "object") throw new Error("附件对象无效");
  const blob = file instanceof Blob ? file : new Blob([file], { type: file.type || "application/octet-stream" });
  if (indexedDbAvailable()) await idbWrite(id, blob);
  else memoryBlobs.set(id, blob);
  const metadata = createAttachmentMetadata({
    name: file.name || "附件",
    mime: file.type || "application/octet-stream",
    size: Number.isFinite(file.size) ? file.size : blob.size,
    provider: "local-ref",
    storageKey: id,
    metadata: { durableStore: indexedDbAvailable() ? "indexeddb" : "memory" },
  }, { id, now });
  const objectUrl = URL.createObjectURL(blob);
  const url = attachmentUrlWithId(objectUrl, id);
  invalidateBrowserObjectUrl(id);
  browserObjectUrls.set(id, Promise.resolve(url));
  return { metadata, url };
}

export async function resolveBrowserAttachmentUrl(attachmentOrId) {
  const id = typeof attachmentOrId === "string" ? attachmentOrId : attachmentOrId?.id;
  if (!id) return null;
  const storageKey = typeof attachmentOrId === "string" ? id : attachmentOrId.storageKey || id;
  if (!browserObjectUrls.has(id)) {
    const pending = readBrowserAttachmentBlob(storageKey).then((blob) => blob ? attachmentUrlWithId(URL.createObjectURL(blob), id) : null);
    browserObjectUrls.set(id, pending);
    void pending.then((url) => { if (!url && browserObjectUrls.get(id) === pending) browserObjectUrls.delete(id); }).catch(() => { if (browserObjectUrls.get(id) === pending) browserObjectUrls.delete(id); });
  }
  return browserObjectUrls.get(id);
}

export async function readBrowserAttachmentBlob(id) {
  const stored = indexedDbAvailable() ? await idbRead(id).catch(() => null) : null;
  return stored || memoryBlobs.get(id) || null;
}

export async function writeBrowserAttachmentBlob(id, blob) {
  if (!(blob instanceof Blob)) throw new Error("附件内容无效");
  if (indexedDbAvailable()) await idbWrite(id, blob);
  else memoryBlobs.set(id, blob);
  invalidateBrowserObjectUrl(id);
}

export async function removeBrowserAttachmentBlob(id) {
  if (indexedDbAvailable()) {
    const database = await openAttachmentDb();
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(attachmentStoreName, "readwrite");
        transaction.objectStore(attachmentStoreName).delete(id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("附件清理失败"));
        transaction.onabort = () => reject(transaction.error || new Error("附件清理失败"));
      });
    } finally { database.close(); }
  }
  memoryBlobs.delete(id);
  invalidateBrowserObjectUrl(id);
}

export function workspaceHasBinaryPayload(workspace) {
  const visit = (value) => {
    if (typeof value === "string") return /^data:[^,]+;base64,/i.test(value);
    if (Array.isArray(value)) return value.some(visit);
    if (!value || typeof value !== "object") return false;
    return Object.values(value).some(visit);
  };
  return visit(workspace);
}
