import * as systemDialogs from "./dialogs.js";
import { StorageError } from "./storage/workspaceDb.js";
import { tMain } from "./i18n/index.js";

export function validateExternalUrl(value) {
  if (typeof value !== "string" || !value || value.length > 2048 || /[\0-\x20\x7f]/.test(value)) throw new StorageError("E_INVALID_ARGUMENT", tMain("网址无效"));
  let url;
  try { url = new URL(value); } catch { throw new StorageError("E_INVALID_ARGUMENT", tMain("网址无效")); }
  if (!["http:", "https:", "mailto:"].includes(url.protocol) || url.username || url.password) throw new StorageError("E_INVALID_ARGUMENT", tMain("只允许 http、https 或 mailto 网址"));
  return value;
}

export async function confirmAndOpenExternal(window, url, { dialogs = systemDialogs } = {}) {
  validateExternalUrl(url);
  const response = await dialogs.showMessageBox(window, {
    type: "question", buttons: [tMain("打开"), tMain("取消")], defaultId: 1, cancelId: 1,
    message: tMain("在浏览器中打开这个网址？"), detail: url,
  });
  if (response.response !== 0) return { opened: false };
  await dialogs.openExternal(url);
  return { opened: true };
}
