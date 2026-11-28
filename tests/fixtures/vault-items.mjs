import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { KDF_PARAMS } from "../../electron/main/vault/crypto.js";
import { createVaultService } from "../../electron/main/vault/vaultService.js";
import { RUNTIME_ROOT } from "../../scripts/runtime-paths.mjs";

export const VAULT_TEST_RUNTIME = path.join(RUNTIME_ROOT, "vault-unit");
export const TEST_PASSWORD = "Correct-Horse-9-Atlas";
export const NEXT_PASSWORD = "Tr0ub4dor&3xyz!!Atlas";
export const RFC_SHA1_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

export function createMarkers() {
  const values = [];
  return {
    next() { const marker = `LA-MARKER-${randomBytes(8).toString("hex")}`; values.push(marker); return marker; },
    all() { return [...values]; },
  };
}

const presets = {
  login: [["网址", "url"], ["用户名", "text"], ["密码", "secret"], ["两步验证", "totp"], ["备注", "multiline"]],
  apiKey: [["服务商", "text"], ["环境", "text"], ["Key 名称", "text"], ["API Key", "secret"], ["Secret", "secret"], ["权限范围", "text"], ["到期日", "date"], ["控制台网址", "url"], ["备注", "multiline"]],
  server: [["主机", "text"], ["端口", "number"], ["用户名", "text"], ["密码", "secret"], ["私钥", "multiline", true], ["主机指纹", "text"], ["备注", "multiline"]],
  database: [["类型", "text"], ["主机", "text"], ["端口", "number"], ["数据库名", "text"], ["用户名", "text"], ["密码", "secret"], ["连接串", "secret"], ["备注", "multiline"]],
  secureNote: [["内容", "multiline", true]],
  recoveryCodes: [["服务", "text"], ["恢复码", "multiline", true], ["备注", "multiline"]],
  custom: [["自定义信息", "text"], ["自定义秘密", "secret"]],
};

function vaultItemInput(type, fields, markers) {
  return {
    type, title: `${type}-${markers.next()}`, tags: ["测试"], favorite: false, subtitleFieldId: null, expiresAt: null,
    fields: fields.map(([label, kind, sensitive = false]) => {
      const marker = markers.next();
      const value = kind === "totp" ? `otpauth://totp/${marker}?secret=${RFC_SHA1_BASE32}&issuer=${marker}` : kind === "url" ? `https://example.invalid/${marker}` : kind === "date" ? "2027-01-10" : marker;
      return { label: kind === "date" ? `${label} ${marker}` : label, kind, value, sensitive: sensitive || ["secret", "totp"].includes(kind) };
    }),
  };
}

export function vaultItemInputs(markers = createMarkers()) {
  return Object.entries(presets).map(([type, fields]) => vaultItemInput(type, fields, markers));
}

export function vaultTenItems(markers = createMarkers()) {
  const originals = vaultItemInputs(markers);
  const additional = ["login", "secureNote", "custom"].map((type) => vaultItemInput(type, presets[type], markers));
  additional[0].favorite = true;
  additional[1].title = `中文备份 · Unicode ${additional[1].title}`;
  additional[2].tags = ["测试", "备份"];
  return [...originals, ...additional];
}

export function fakeTimers(start = Date.parse("2026-11-07T00:00:00.000Z")) {
  let current = start;
  let nextId = 1;
  const scheduled = new Map();
  const add = (callback, milliseconds, repeat) => {
    const id = nextId++; scheduled.set(id, { callback, at: current + milliseconds, milliseconds, repeat }); return id;
  };
  const advance = (milliseconds) => {
    const finish = current + milliseconds;
    for (;;) {
      const next = [...scheduled.entries()].filter(([, entry]) => entry.at <= finish).sort((first, second) => first[1].at - second[1].at || first[0] - second[0])[0];
      if (!next) break;
      const [id, entry] = next; current = entry.at;
      if (entry.repeat) entry.at += entry.milliseconds; else scheduled.delete(id);
      entry.callback();
    }
    current = finish;
  };
  return {
    clock: { now: () => current, set: (value) => { current = value; }, advance },
    timers: { setTimeout: (callback, milliseconds) => add(callback, milliseconds, false), clearTimeout: (id) => scheduled.delete(id), setInterval: (callback, milliseconds) => add(callback, milliseconds, true), clearInterval: (id) => scheduled.delete(id) },
    advance, pending: () => scheduled.size,
  };
}

export function fakeClipboard() {
  let text = "";
  return { readText: () => text, writeText: (value) => { text = value; }, clear: () => { text = ""; } };
}

export function createVaultTestContext(testContext, options = {}) {
  fs.mkdirSync(VAULT_TEST_RUNTIME, { recursive: true });
  const dataRoot = fs.mkdtempSync(path.join(VAULT_TEST_RUNTIME, "case-"));
  const fake = fakeTimers();
  const clipboard = fakeClipboard();
  const serviceOptions = { dataRoot, clock: fake.clock, timers: fake.timers, clipboard, kdfParams: { ...KDF_PARAMS, memoryKiB: 8192 }, ...options };
  const instances = new Set();
  const open = (extra = {}) => { const service = createVaultService({ ...serviceOptions, ...extra }); instances.add(service); return service; };
  const service = open();
  testContext.after(() => {
    for (const instance of instances) { instance.lock("app-quit"); instance.closeDatabase(); }
    const root = path.resolve(VAULT_TEST_RUNTIME);
    const target = path.resolve(dataRoot);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error("test cleanup escaped runtime");
    fs.rmSync(target, { recursive: true, force: true });
  });
  return { dataRoot, service, open, fake, clipboard, file: path.join(dataRoot, "vault.db") };
}
