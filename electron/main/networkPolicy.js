export function validatedDevOrigin(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== "5199" || url.username || url.password) throw new TypeError("开发服务只能使用 http://127.0.0.1:5199");
  return url.origin;
}

export function shouldBlockRequest(value, { devOrigin } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return true;
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return false;
  if (!devOrigin || url.username || url.password) return true;
  let allowed;
  try {
    allowed = new URL(validatedDevOrigin(devOrigin));
  } catch {
    return true;
  }
  const protocol = url.protocol === "ws:" ? "http:" : url.protocol;
  return protocol !== allowed.protocol || url.hostname !== allowed.hostname || url.port !== allowed.port;
}
