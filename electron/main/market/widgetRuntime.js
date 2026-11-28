import { randomUUID } from "node:crypto";
import { isPlainObject } from "../ipc/validate.js";
import { StorageError } from "../storage/workspaceDb.js";

const hostSuffix = ".life-atlas-component.invalid";
const maxStateLength = 16 * 1024;
const maxResultLength = 32 * 1024;
const maxActive = 6;
const contentPolicy = "default-src 'none'; script-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const index = "<!doctype html><meta charset=utf-8><title>Life Atlas component sandbox</title><script src='/boot.js'></script>";
const boot = `(() => {
  const worker = new Worker('/worker.js');
  let awaiting;
  let failure;
  worker.onmessage = ({ data }) => {
    if (!awaiting) return;
    const request = awaiting;
    awaiting = undefined;
    if (typeof data !== 'string' || data.length > ${maxResultLength}) request.reject(new Error('Invalid component result'));
    else request.resolve(data);
  };
  worker.onerror = () => {
    failure = new Error('Component execution failed');
    awaiting?.reject(failure);
    awaiting = undefined;
  };
  Object.defineProperty(globalThis, '__lifeAtlasComponent', { value: (payload) => new Promise((resolve, reject) => {
    if (failure) { reject(failure); return; }
    if (awaiting) { reject(new Error('Component is busy')); return; }
    awaiting = { resolve, reject };
    worker.postMessage(payload);
  }), writable: false, configurable: false });
})();`;
const worker = `(() => {
  const parse = JSON.parse, stringify = JSON.stringify;
  const send = postMessage.bind(globalThis);
  addEventListener('message', async ({ data }) => {
    if (typeof globalThis.handleComponentEvent !== "function") throw new Error("Component entry point missing");
    try {
      const result = stringify(await globalThis.handleComponentEvent(parse(data)));
      send(typeof result === "string" && result.length <= ${maxResultLength} ? result : null);
    } catch { send(null); }
  });
  importScripts('/component.js');
})();`;

const invalid = (message) => new StorageError("E_INVALID_ARGUMENT", message);
const text = (value, maxLength) => typeof value === "string" && value.length <= maxLength && !value.includes("\0");
const buttonId = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/u.test(value);

export function validateComponentState(state) {
  if (!isPlainObject(state)) throw invalid("组件状态无效。");
  let json;
  try { json = JSON.stringify(state); } catch { throw invalid("组件状态无法保存。"); }
  if (!json || json.length > maxStateLength || Buffer.byteLength(json) > maxStateLength) throw invalid("组件状态超过大小限制。");
  return JSON.parse(json);
}

export function validateComponentEvent(event) {
  if (!isPlainObject(event) || !["mount", "tick", "click"].includes(event.type)
    || (event.type === "click" ? !buttonId(event.id) : event.id !== undefined)) throw invalid("无效的组件操作。");
  return event.type === "click" ? { type: event.type, id: event.id } : { type: event.type };
}

export function decodeComponentResult(raw) {
  if (typeof raw !== "string" || raw.length > maxResultLength || Buffer.byteLength(raw) > maxResultLength) throw invalid("组件回应过大或无法读取。");
  const { state, view } = JSON.parse(raw) ?? {};
  if (!Array.isArray(view) || view.length > 32) throw invalid("组件显示内容超出范围。");
  const ids = new Set();
  const presentation = view.map((item) => {
    if (!isPlainObject(item)) throw invalid("无效的组件显示内容。");
    if (item.type === "text" && text(item.text, 500)) return { type: "text", text: item.text };
    if (item.type === "button" && buttonId(item.id) && text(item.label, 80) && !ids.has(item.id)) {
      ids.add(item.id);
      return { type: "button", id: item.id, label: item.label, disabled: item.disabled === true };
    }
    if (item.type === "progress" && Number.isFinite(item.value) && item.value >= 0 && item.value <= 1 && text(item.label ?? "", 80)) {
      return { type: "progress", value: item.value, label: item.label || "进度" };
    }
    throw invalid("组件只能使用文字、按钮和进度条。");
  });
  return { state: validateComponentState(state), view: presentation };
}

function withinDeadline(promise, duration) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new StorageError("E_IO", "组件没有及时响应，已停止运行。")), duration);
  })]).finally(() => clearTimeout(timer));
}

export function createWidgetRuntime({ WebContentsView, session, deadline = 4000 }) {
  // Only this in-memory session can serve verified package code. It has no normal network loader.
  const entries = new Map();
  const resources = new Map();
  const isolated = session.fromPartition("life-atlas-market-components", { cache: false });
  const part = (url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash
        || !parsed.hostname.endsWith(hostSuffix) || !["/", "/boot.js", "/worker.js", "/component.js"].includes(parsed.pathname)) return null;
      const entry = resources.get(parsed.origin);
      return entry ? { entry, pathname: parsed.pathname } : null;
    } catch { return null; }
  };
  isolated.protocol.handle("https", (request) => {
    const target = part(request.url);
    if (request.method !== "GET" || !target) return new Response(null, { status: 404 });
    const body = target.pathname === "/" ? index : target.pathname === "/boot.js" ? boot : target.pathname === "/worker.js" ? worker : target.entry.source;
    return new Response(body, { headers: {
      "Content-Type": target.pathname === "/" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8",
      "Content-Security-Policy": contentPolicy + (target.pathname === "/" ? "; worker-src 'self'" : "; worker-src 'none'"),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-DNS-Prefetch-Control": "off",
    } });
  });
  isolated.webRequest.onBeforeRequest((details, callback) => {
    const target = part(details.url);
    // Dedicated workers do not always have a webContentsId. The random origin
    // and allowed paths here are private to this session and component instance.
    callback({ cancel: !target || (details.webContentsId > 0 && target.entry.contents.id !== details.webContentsId) });
  });
  isolated.setPermissionRequestHandler((_, __, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.setSpellCheckerEnabled?.(false);
  isolated.on("will-download", (event) => event.preventDefault());

  function remove(id, entry) {
    if (entries.get(id) === entry) entries.delete(id);
    resources.delete(entry.origin);
    if (!entry.contents.isDestroyed()) entry.contents.close({ waitForBeforeUnload: false });
  }

  function create(id, hash, source) {
    if (entries.size >= maxActive) {
      const idle = [...entries].find(([, entry]) => !entry.busy);
      if (!idle) throw new StorageError("E_CONFLICT", "其他组件正在运行，请稍后重试。");
      remove(...idle);
    }
    const origin = `https://${randomUUID()}${hostSuffix}`;
    const view = new WebContentsView({ webPreferences: {
      session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false,
      webviewTag: false, webSecurity: true, backgroundThrottling: false, devTools: false,
    } });
    const contents = view.webContents;
    const deny = (event) => event.preventDefault();
    for (const event of ["will-navigate", "will-frame-navigate", "will-redirect", "will-attach-webview"]) contents.on(event, deny);
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    const entry = { origin, contents, view, source, hash, busy: false };
    resources.set(origin, entry);
    entries.set(id, entry);
    // The exact origin above is created by the host and has no DNS destination.
    entry.ready = contents.loadURL(`${origin}/`);
    entry.ready.catch(() => {});
    return entry;
  }

  return {
    async run({ id, hash, source, state, event, now }) {
      const input = { state: validateComponentState(state), event: validateComponentEvent(event), now };
      let entry = entries.get(id);
      if (entry?.busy) throw new StorageError("E_CONFLICT", "组件正在处理上一项操作。");
      if (entry && (entry.hash !== hash || entry.contents.isDestroyed())) { remove(id, entry); entry = null; }
      if (!entry) entry = create(id, hash, source);
      else { entries.delete(id); entries.set(id, entry); }
      entry.busy = true;
      try {
        await withinDeadline(entry.ready, deadline);
        const serialized = JSON.stringify(JSON.stringify(input));
        const result = await withinDeadline(entry.contents.executeJavaScript(`globalThis.__lifeAtlasComponent(${serialized})`), deadline);
        return decodeComponentResult(result);
      } catch (error) {
        remove(id, entry);
        throw error instanceof StorageError ? error : new StorageError("E_IO", "组件无法运行，原有页面和组件状态已保留。");
      } finally { entry.busy = false; }
    },
    release(id) { const entry = entries.get(id); if (entry) remove(id, entry); },
    close() { for (const [id, entry] of entries) remove(id, entry); },
  };
}
