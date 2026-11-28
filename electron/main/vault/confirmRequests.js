import { randomBytes } from "node:crypto";
import { VaultError, invalidArgument } from "./errors.js";

export function createConfirmRequests({ verifyPassword, clock = Date, timers = globalThis, ttlMs = 120000, idFactory = () => `confirm_${randomBytes(16).toString("hex")}`, deliver }) {
  const requests = new Map();

  function settle(requestId, result) {
    const pending = requests.get(requestId);
    if (!pending) throw new VaultError("E_NOT_FOUND", "确认请求已结束或已过期");
    requests.delete(requestId);
    timers.clearTimeout(pending.timeout);
    pending.resolve(result);
  }

  function request({ kind, title, description }) {
    if (!["export-backup", "schedule-backup", "reveal-field", "change-vault-preferences"].includes(kind) || typeof title !== "string" || typeof description !== "string") invalidArgument();
    const requestId = idFactory();
    const expiresAt = clock.now() + ttlMs;
    return new Promise((resolve) => {
      const timeout = timers.setTimeout(() => {
        if (requests.has(requestId)) settle(requestId, "expired");
      }, ttlMs);
      timeout?.unref?.();
      requests.set(requestId, { resolve, timeout, verifying: false });
      Promise.resolve().then(() => {
        if (requests.has(requestId)) return deliver({ requestId, kind, title, description, expiresAt });
      }).catch(() => {
        if (requests.has(requestId)) settle(requestId, "cancelled");
      });
    });
  }

  async function confirm({ requestId, password }) {
    const pending = requests.get(requestId);
    if (!pending) throw new VaultError("E_NOT_FOUND", "确认请求已结束或已过期");
    if (pending.verifying) throw new VaultError("E_CONFLICT", "正在验证主密码");
    pending.verifying = true;
    try {
      const valid = await verifyPassword(password);
      if (!requests.has(requestId)) throw new VaultError("E_NOT_FOUND", "确认请求已结束或已过期");
      if (!valid) throw new VaultError("E_BAD_PASSWORD", "主密码不正确");
      settle(requestId, "confirmed");
      return {};
    } finally {
      pending.verifying = false;
    }
  }

  function reject({ requestId }) {
    settle(requestId, "cancelled");
    return {};
  }

  function cancelAll() {
    for (const requestId of [...requests.keys()]) settle(requestId, "cancelled");
  }

  return { request, confirm, reject, cancelAll };
}
