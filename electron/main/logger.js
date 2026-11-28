import fs from "node:fs";
import path from "node:path";
import { assertPhysicalPath } from "./storage/dataRoot.js";

const forbiddenFields = /title|body|content|password|secret|recovery|username|account|fieldValue|message|url|path/i;
const allowedStringFields = new Set(["id", "code", "errorCode", "flavor", "host", "reason", "source", "version", "appVersion"]);

export function createLogger({ logsDir, now = () => new Date().toISOString() }) {
  const directory = assertPhysicalPath(logsDir);
  fs.mkdirSync(directory, { recursive: true });
  const instant = () => new Date(typeof now === "function" ? now() : now).toISOString();
  const cutoff = Date.parse(instant().slice(0, 10)) - 14 * 86400000;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^\d{4}-\d{2}-\d{2}\.log$/.test(entry.name) || Date.parse(entry.name.slice(0, 10)) >= cutoff) continue;
    fs.unlinkSync(assertPhysicalPath(path.join(directory, entry.name), { root: directory, allowMissing: false }));
  }
  return {
    log(event, fields = {}) {
      if (typeof event !== "string" || !/^[a-z][a-z0-9.-]{0,119}$/.test(event)) throw new TypeError("日志事件名无效");
      const record = { at: instant(), event };
      if (event === "data-root.moved") {
        for (const key of ["from", "to"]) {
          const value = fields[key];
          if (typeof value !== "string" || !value || value.length > 32767 || /[\r\n\0]/.test(value)) throw new TypeError("数据目录迁移日志路径无效");
          record[key] = value;
        }
      } else {
        for (const [key, value] of Object.entries(fields)) {
          if (forbiddenFields.test(key) || key === "from" || key === "to") continue;
          if (typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) record[key] = value;
          else if (typeof value === "string" && (allowedStringFields.has(key) || /Id$/.test(key)) && value.length <= 255 && !/[\r\n\0]/.test(value)) record[key] = value;
        }
      }
      const filePath = assertPhysicalPath(path.join(directory, `${record.at.slice(0, 10)}.log`), { root: directory });
      fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
    },
  };
}
