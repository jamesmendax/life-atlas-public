import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { WIDGET_CHANNEL } from "../../../src/domain/marketFrameProtocol.js";
import { StorageError } from "../storage/workspaceDb.js";
import { widgetUiFileType } from "./package.js";

const frameAddress = /^life-widget:\/\/([a-f0-9]{48})\/([a-zA-Z0-9._/-]+)$/u;
const maxFrames = 128;
const maxBytes = 96 * 1024 * 1024;
const previewKeysPath = "host-preview-keys.js";
const surfacePath = "host-frame-surface.js";
const surfaceSource = readFileSync(new URL("./frameSurface.js", import.meta.url), "utf8");
// These signed Dot releases report a fixed height. New Carbon packages measure themselves.
const fixedLayouts = new Map([
  ["community.dot-carbon", ["carbon", ["1.0.0", "1.0.1"]]],
  ["community.dot-decision", ["decision", ["1.0.0"]]],
  ["community.dot-mingzhang", ["mingzhang", ["1.0.0", "1.0.1", "1.0.2"]]],
  ["community.dot-whiteboard", ["whiteboard", ["1.0.0", "1.0.1"]]],
]);
const forbidden = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
// The timer reports its content height, which changes with its available width.
// Keep the resize target inside the frame and prevent a viewport scrollbar from shrinking the layout.
// A settings dialog can still scroll within its own bounds.
const pomodoroFrameStyle = '<style>:root[data-style="mobai"] { scrollbar-width: none; }'
  + ':root[data-style="mobai"] .pomodoro-resize { inset-inline-end: 0; }</style>';

// The embedder holds the lease. Each distinct iframe has its own origin, while
// several pages displaying the same verified release share one immutable file map.
export function createWidgetProtocol({ allowedOrigin = "app://bundle" } = {}) {
  const parent = /^(?:app:\/\/bundle|http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?)$/u.test(allowedOrigin) ? allowedOrigin : "app://bundle";
  // Run after handlers inside the component. Native dialog cancellation happens
  // after keydown and keeps the first Escape inside its own dialog.
  const previewKeys = `window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !event.isTrusted || event.defaultPrevented || event.repeat || event.isComposing
      || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || document.querySelector("dialog[open]")) return;
    window.parent.postMessage({channel: ${JSON.stringify(WIDGET_CHANNEL)}, type: "preview-escape"}, ${JSON.stringify(parent)});
  });`;
  const frames = new Map();
  const packages = new Map();
  let heldBytes = 0;

  function release(frameUrl) {
    const match = typeof frameUrl === "string" && frameAddress.exec(frameUrl);
    const frame = match && match[2] === "index.html" && frames.get(match[1]);
    if (!frame) return false;
    frames.delete(match[1]);
    const archive = packages.get(frame.hash);
    if (--archive.leases === 0) { packages.delete(frame.hash); heldBytes -= archive.size; }
    return true;
  }

  function open(verified, { previewToken, preview = Boolean(previewToken) } = {}) {
    if (!verified.uiFiles) return { kind: null };
    let archive = packages.get(verified.hash);
    const size = archive?.size ?? [...verified.uiFiles.values()].reduce((total, bytes) => total + bytes.length, 0);
    if (frames.size >= maxFrames || !archive && heldBytes + size > maxBytes) throw new StorageError("E_CONFLICT", "运行中的小组件过多，请关闭其他页面后再试。");
    if (!archive) {
      const layout = fixedLayouts.get(verified.meta.id);
      archive = { layout: layout?.[1].includes(verified.meta.version) ? layout[0] : null, files: verified.uiFiles, capabilities: new Set(verified.capabilities), size, leases: 0,
        pomodoro: verified.meta.id === "life-atlas.pomodoro" };
      packages.set(verified.hash, archive);
      heldBytes += size;
    }
    const id = randomBytes(24).toString("hex");
    archive.leases += 1;
    frames.set(id, { hash: verified.hash, previewToken, preview });
    return { kind: "frame", frameUrl: `life-widget://${id}/index.html`, capabilities: [...verified.capabilities], ...(archive.layout && { intrinsicHeight: true }) };
  }

  function serve(request) {
    const match = typeof request?.url === "string" && frameAddress.exec(request.url);
    const frame = match && frames.get(match[1]);
    if (!frame) return forbidden();
    if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    const destination = request.headers?.get?.("sec-fetch-dest") || request.destination;
    if (destination === "document") return forbidden();
    const archive = packages.get(frame.hash);
    const files = archive.files;
    const name = match[2];
    const entry = name === "index.html";
    const keyboard = frame.preview && name === previewKeysPath;
    const surface = name === surfacePath;
    const mime = entry ? "text/html; charset=utf-8" : keyboard || surface ? "text/javascript" : widgetUiFileType(name)?.[0];
    if (!mime || !entry && (["iframe", "frame"].includes(destination) || !surface && !keyboard && !files.has(name))) return forbidden();
    const own = `life-widget://${match[1]}`;
    const policy = [`default-src 'none'`, `sandbox allow-scripts`, `script-src ${own}`, `style-src ${own} 'unsafe-inline'`, `img-src ${own} data: blob:`,
      `media-src ${own} data: blob:`, `font-src ${own}`, `connect-src ${own}`, `frame-src 'none'`, `worker-src 'none'`, `object-src 'none'`,
      `base-uri 'none'`, `form-action 'none'`, `frame-ancestors ${parent}`].join("; ");
    let body = keyboard ? previewKeys : files.get(name);
    if (surface) body = surfaceSource + "\ninstallWidgetSurface(" + JSON.stringify(archive.layout) + ', "content-height");';
    if (entry) {
      const styles = files.has("ui.css") ? '<link rel="stylesheet" href="./ui.css">' : "";
      const layout = archive.pomodoro ? pomodoroFrameStyle : "";
      const keys = frame.preview ? `<script src="./${previewKeysPath}"></script>` : "";
      body = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Life Atlas</title>${styles}${layout}</head><body><div id="root"></div><script src="./${surfacePath}"></script><script src="./ui.js"></script>${keys}</body></html>`;
    }
    return new Response(request.method === "HEAD" ? null : body, { headers: {
      "Content-Type": mime, "Content-Length": String(Buffer.byteLength(body)), "Cache-Control": "no-store",
      "Content-Security-Policy": policy, "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), display-capture=(), usb=(), payment=()",
      // A sandbox without allow-same-origin reads its own assets from an opaque origin.
      ...(request.headers?.get?.("origin") === "null" ? { "Access-Control-Allow-Origin": "null", Vary: "Origin" } : {}),
    } });
  }

  function releaseWhere(predicate) {
    for (const [id, frame] of frames) if (predicate(frame)) release(`life-widget://${id}/index.html`);
  }
  function capabilityOwner(frameUrl, capability) {
    const match = typeof frameUrl === "string" && frameAddress.exec(frameUrl);
    if (!match || match[2] !== "index.html") return null;
    const frame = frames.get(match[1]);
    return frame && packages.get(frame.hash).capabilities.has(capability) ? frame.hash : null;
  }
  return { open, serve, release, releasePackage: (hash) => releaseWhere((frame) => frame.hash === hash),
    capabilityOwner, releasePreview: (token) => releaseWhere((frame) => frame.previewToken === token), clear: () => { frames.clear(); packages.clear(); heldBytes = 0; } };
}
