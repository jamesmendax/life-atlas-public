import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { isIPv4 } from "node:net";
import { sharedFormSpec, acceptSharedAnswer } from "../../src/domain/sharedForm.js";
import { formSharePage } from "./formSharePage.js";
import { assertPhysicalPath } from "./storage/dataRoot.js";
import { fail, ok } from "./ipc/result.js";
import { isPlainObject, isTrustedSender } from "./ipc/validate.js";
const maxBody = 64 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const problem = (code, message) => Object.assign(new Error(message), {
  code
});
const only = (value, names) => isPlainObject(value) && Object.keys(value).every(k => names.includes(k));
function addresses() {
  const result = new Map([["127.0.0.1", "仅本机"]]);
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const entry of list || []) {
    const ip = entry.address;
    if (!entry.internal && isIPv4(ip) && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u.test(ip)) result.set(ip, name);
  }
  return [...result].map(([address, label]) => ({
    address,
    label
  }));
}
function publicUrl(value) {
  if (!value) return null;
  if (typeof value !== "string" || value.length > 512) throw problem("E_INVALID_ARGUMENT", "请输入已有的 HTTPS 反向代理地址");
  let u;
  try {
    u = new URL(value);
  } catch {}
  if (!u || u.protocol !== "https:" || u.username || u.password || u.search || u.hash || !/^\/(?:[a-zA-Z0-9._~/-]*)$/u.test(u.pathname)) {
    throw problem("E_INVALID_ARGUMENT", "请输入已有的 HTTPS 反向代理地址");
  }
  return u;
}
function response(res, status, value, extra = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...extra
  });
  res.end(typeof value === "string" ? value : JSON.stringify(value));
}
async function readAnswer(req) {
  if (Number(req.headers["content-length"]) > maxBody) throw problem(413, "回复超过大小限制");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBody) throw problem(413, "回复超过大小限制");
    chunks.push(chunk);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {}
  if (!only(value, ["requestId", "values"]) || !uuid.test(value.requestId) || !isPlainObject(value.values)) throw problem(400, "提交格式有误");
  return value;
}
export function createFormShare({
  dataRoot,
  getWorkspace,
  onReceived,
  listAddresses = addresses,
  now = Date.now
}) {
  const file = assertPhysicalPath(path.join(dataRoot, "runtime", "form-share", "responses.db"), {
    root: dataRoot
  });
  const shares = new Map(),
    tokens = new Map(),
    listeners = new Map(),
    starting = new Map();
  let store,
    epoch = 0,
    stopping = false;
  function db(create = true) {
    if (store) return store;
    if (!create && !fs.existsSync(file)) return null;
    assertPhysicalPath(file, {
      root: dataRoot
    });
    fs.mkdirSync(path.dirname(file), {
      recursive: true
    });
    store = new DatabaseSync(file);
    store.exec("PRAGMA synchronous=FULL; PRAGMA max_page_count=32768; CREATE TABLE IF NOT EXISTS answers(view_id TEXT NOT NULL, request_id TEXT NOT NULL, id TEXT PRIMARY KEY, digest TEXT NOT NULL, payload TEXT, UNIQUE(view_id,request_id)); CREATE INDEX IF NOT EXISTS pending_by_view ON answers(view_id) WHERE payload IS NOT NULL;");
    return store;
  }
  const count = id => db(false)?.prepare("SELECT count(*) AS n FROM answers WHERE view_id=? AND payload IS NOT NULL").get(id).n || 0;
  function status({
    viewId
  }) {
    return {
      addresses: listAddresses(),
      url: shares.get(viewId)?.url || null,
      pending: count(viewId)
    };
  }
  function stop({
    viewId
  }) {
    starting.delete(viewId);
    const share = shares.get(viewId);
    if (share) {
      shares.delete(viewId);
      tokens.delete(share.token);
      share.listener.count--;
      if (!share.listener.count) {
        listeners.delete(share.listener.key);
        share.listener.server.close();
        share.listener.server.closeAllConnections();
      }
    }
    return status({
      viewId
    });
  }
  async function handle(req, res) {
    try {
      if (stopping || !req.url || req.url.length > 900 || !["GET", "POST"].includes(req.method)) return response(res, 404, {
        message: "链接不可用"
      });
      const token = /\/f\/([A-Za-z0-9_-]{43})$/u.exec(req.url)?.[1];
      const s = tokens.get(token),
        host = req.headers.host;
      if (!s || s.listener.server !== req.socket.server || ![s.local.host, s.public?.host].includes(host) || ![s.local.pathname, s.public?.pathname].includes(req.url)) return response(res, 404, {
        message: "链接不可用"
      });
      // Aggregate limits cover proxied clients as well as direct LAN clients.
      if (now() >= s.rate.until) {
        s.rate = {
          until: now() + 60000,
          read: 0,
          write: 0
        };
      }
      const post = req.method === "POST";
      if (post ? ++s.rate.write > 45 : ++s.rate.read > 120) return response(res, 429, {
        message: "请求较多，请稍后重试"
      }, {
        "Retry-After": "60"
      });
      if (post && req.headers.origin && ![s.local.origin, s.public?.origin].includes(req.headers.origin)) return response(res, 403, {
        message: "提交来源无效"
      });
      if (post && req.headers["content-type"]?.split(";")[0].trim() !== "application/json") return response(res, 415, {
        message: "提交格式有误"
      });
      const body = post ? await readAnswer(req) : null;
      let workspace, spec;
      try {
        workspace = await getWorkspace();
        spec = sharedFormSpec(workspace, s.viewId, s.allowed);
      } catch {
        return response(res, 410, {
          message: "表单现已关闭"
        });
      }
      if (tokens.get(token) !== s) return response(res, 410, {
        message: "链接已关闭"
      });
      if (!post) {
        const page = formSharePage(spec);
        return response(res, 200, page.html, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": page.csp
        });
      }
      const digest = createHash("sha256").update(JSON.stringify(Object.entries(body.values).sort(([a], [b]) => a.localeCompare(b)))).digest("hex");
      const connection = db();
      const duplicate = connection.prepare("SELECT digest FROM answers WHERE view_id=? AND request_id=?").get(s.viewId, body.requestId);
      if (duplicate) return response(res, duplicate.digest === digest ? 200 : 409, {
        message: duplicate.digest === digest ? "已收到" : "提交内容已变化，请重新填写"
      });
      let answer;
      try {
        answer = acceptSharedAnswer(workspace, s.viewId, s.allowed, body.values);
      } catch {
        return response(res, 422, {
          message: "请检查必填项、选项和填写格式"
        });
      }
      if (count(s.viewId) >= 1000 || connection.prepare("SELECT count(*) AS n FROM answers WHERE payload IS NOT NULL").get().n >= 4000) {
        return response(res, 503, {
          message: "暂时无法接收，请稍后重试"
        }, {
          "Retry-After": "60"
        });
      }
      connection.prepare("INSERT INTO answers(view_id,request_id,id,digest,payload) VALUES(?,?,?,?,?)").run(s.viewId, body.requestId, randomUUID(), digest, JSON.stringify(answer.values));
      try {
        onReceived?.({
          viewId: s.viewId
        });
      } catch {/* Durable replies remain available after the window closes. */}
      response(res, 201, {
        message: "已收到"
      });
    } catch (e) {
      if (!res.destroyed && !res.headersSent) response(res, typeof e.code === "number" ? e.code : 500, {
        message: typeof e.code === "number" ? e.message : "暂时无法接收提交"
      });
    }
  }
  async function start(args) {
    const {
      viewId,
      address,
      port = 0,
      publicBase
    } = args;
    if (stopping || starting.has(viewId) || shares.has(viewId)) throw problem("E_CONFLICT", "请先停止当前分享再更改设置");
    if (!listAddresses().some(item => item.address === address) || !Number.isInteger(port) || port < 0 || port > 65535) throw problem("E_INVALID_ARGUMENT", "请选择本机地址和有效端口");
    const external = publicUrl(publicBase),
      startEpoch = epoch;
    if (shares.size + starting.size >= 32) throw problem("E_THROTTLED", "同时分享的表单过多");
    const startId = Symbol();
    starting.set(viewId, startId);
    const cancelled = () => startEpoch !== epoch || starting.get(viewId) !== startId;
    try {
      const spec = sharedFormSpec(await getWorkspace(), viewId);
      if (cancelled()) throw problem("E_CANCELLED", "分享已关闭");
      let listener = port && listeners.get(address + ":" + port);
      if (!listener) {
        const server = http.createServer({
          maxHeaderSize: 8192,
          headersTimeout: 10000,
          requestTimeout: 15000
        }, handle);
        server.maxConnections = 40;
        server.keepAliveTimeout = 2000;
        server.maxRequestsPerSocket = 50;
        server.setTimeout(15000, socket => socket.destroy());
        await new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(port, address, () => {
            server.off("error", reject);
            resolve();
          });
        });
        if (cancelled()) {
          server.close();
          throw problem("E_CANCELLED", "分享已关闭");
        }
        const key = address + ":" + server.address().port;
        listener = {
          server,
          key,
          count: 0
        };
        listeners.set(key, listener);
      }
      const token = randomBytes(32).toString("base64url"),
        suffix = "/f/" + token;
      const local = new URL("http://" + listener.key + suffix);
      if (external) external.pathname = external.pathname.replace(/\/$/u, "") + suffix;
      const share = {
        viewId,
        allowed: spec.fields.map(f => f.id),
        token,
        url: (external || local).href,
        local,
        public: external,
        listener,
        rate: {
          until: now() + 60000,
          read: 0,
          write: 0
        }
      };
      listener.count++;
      shares.set(viewId, share);
      tokens.set(token, share);
      return status(args);
    } finally {
      if (starting.get(viewId) === startId) starting.delete(viewId);
    }
  }
  function pending({
    viewId
  }) {
    const rows = db(false)?.prepare("SELECT id,payload FROM answers WHERE view_id=? AND payload IS NOT NULL ORDER BY rowid LIMIT 25").all(viewId) || [];
    return {
      responses: rows.map(row => ({
        id: row.id,
        values: JSON.parse(row.payload)
      }))
    };
  }
  function pendingViews() {
    const rows = db(false)?.prepare("SELECT DISTINCT view_id FROM answers WHERE payload IS NOT NULL").all() || [];
    return {
      viewIds: rows.map(row => row.view_id)
    };
  }
  async function ack({
    viewId,
    ids
  }) {
    if (!Array.isArray(ids) || ids.length > 100 || !ids.every(id => typeof id === "string" && uuid.test(id))) throw problem("E_INVALID_ARGUMENT", "回复编号无效");
    const connection = db(false);
    if (!connection || !ids.length) return {
      acknowledged: 0
    };
    const saved = new Set((await getWorkspace()).databaseItems.filter(item => item.submission?.viewId === viewId).map(item => item.submission.responseId));
    let acknowledged = 0;
    for (const id of new Set(ids)) if (saved.has(id)) acknowledged += connection.prepare("UPDATE answers SET payload=NULL WHERE view_id=? AND id=? AND payload IS NOT NULL").run(viewId, id).changes;
    return {
      acknowledged
    };
  }
  function close() {
    stopping = true;
    epoch++;
    for (const s of [...shares.values()]) stop(s);
    if (store) {
      store.close();
      store = null;
    }
    stopping = false;
  }
  return {
    status,
    start,
    stop,
    pending,
    pendingViews,
    ack,
    close
  };
}
export function registerFormShareIpc({
  ipcMain,
  service,
  getWindow
}) {
  for (const method of ["status", "start", "stop", "pending", "pendingViews", "ack"]) ipcMain.handle("la:forms:" + method, async (event, args) => {
    if (!isTrustedSender(event, getWindow())) return fail("E_FORBIDDEN", "只接受工作区窗口操作");
    const keys = method === "start" ? ["viewId", "address", "port", "publicBase"] : method === "ack" ? ["viewId", "ids"] : ["viewId"];
    if (method === "pendingViews" ? args !== undefined : !only(args, keys) || typeof args.viewId !== "string" || !args.viewId || args.viewId.length > 200) return fail("E_INVALID_ARGUMENT", "表单参数无效");
    try {
      return ok(await service[method](args));
    } catch (e) {
      if (e.code === "EADDRINUSE") return fail("E_CONFLICT", "选定端口已被占用");
      if (["E_INVALID_ARGUMENT", "E_CANCELLED", "E_CONFLICT", "E_THROTTLED"].includes(e.code)) return fail(e.code, e.message);
      return fail("E_IO", method === "start" ? "无法分享。请确认表单开放、存在可填写的问题，且绑定地址可用。" : "无法访问表单回复");
    }
  });
}
