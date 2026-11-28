import { tMain } from "../i18n/index.js";

export const ERROR_CODES = Object.freeze([
  "E_INVALID_ARGUMENT", "E_FORBIDDEN", "E_NOT_FOUND", "E_LOCKED", "E_BAD_PASSWORD", "E_THROTTLED",
  "E_CORRUPT", "E_IO", "E_CONFLICT", "E_UNSUPPORTED_VERSION", "E_UNSUPPORTED_IMAGE", "E_CANCELLED", "E_TOO_LARGE",
]);

export function ok(value = {}) {
  return { ok: true, value };
}

export function fail(code, message, extra = {}) {
  const error = { code: ERROR_CODES.includes(code) ? code : "E_IO", message: tMain(String(message || "操作失败")) };
  if (error.code === "E_THROTTLED" && Number.isFinite(extra.retryAfterMs) && extra.retryAfterMs >= 0) error.retryAfterMs = extra.retryAfterMs;
  return { ok: false, error };
}

export function errorResult(error, fallback = "操作未完成，请重试") {
  return ERROR_CODES.includes(error?.code) ? fail(error.code, error.message, error) : fail("E_IO", fallback);
}
