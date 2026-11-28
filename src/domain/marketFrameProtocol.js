export const WIDGET_CHANNEL = "life-atlas.widget.v1";
export const MAX_WIDGET_STATE_BYTES = 1024 * 1024;

export function frameAddress(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "life-widget:" && url.hostname && !url.username && !url.password
      && !url.port && url.pathname === "/index.html" && !url.search && !url.hash ? url.href : null;
  } catch { return null; }
}

export function parseState(value) {
  try {
    const result = JSON.parse(value || "{}");
    if (result && typeof result === "object" && !Array.isArray(result)) return result;
  } catch { /* Older blocks can omit their state. */ }
  return {};
}

export function serializeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("组件状态必须是对象。");
  let count = 0;
  function validate(item, depth) {
    if (++count > 75000 || depth > 40) throw new Error("组件状态过于复杂。");
    if (item === null || typeof item === "boolean" || typeof item === "string" || Number.isFinite(item)) return;
    if (Array.isArray(item)) { for (const child of item) validate(child, depth + 1); return; }
    if (typeof item !== "object" || Object.getPrototypeOf(item) !== Object.prototype) throw new Error("组件状态只能包含 JSON 数据。");
    for (const [key, child] of Object.entries(item)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") throw new Error("组件状态属性无效。");
      validate(child, depth + 1);
    }
  }
  validate(value, 0);
  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_WIDGET_STATE_BYTES || new TextEncoder().encode(serialized).length > MAX_WIDGET_STATE_BYTES) {
    throw new Error("此组件的记录超过 1 MiB，原有内容已保留。");
  }
  return serialized;
}
