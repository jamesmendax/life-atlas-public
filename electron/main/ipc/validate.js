export function isNonEmptyString(value, max = 200) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !value.includes("\0");
}

export function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
}

export function oneOf(value, list) {
  return list.includes(value);
}

export function isTrustedSender(event, window) {
  if (!window || window.isDestroyed?.()) return false;
  const contents = window.webContents;
  if (!contents || contents.isDestroyed?.() || event?.sender !== contents || event.sender.id !== contents.id) return false;
  const frame = event.senderFrame;
  if (!frame || frame.isDestroyed?.()) return false;
  const mainFrame = contents.mainFrame;
  return Boolean(mainFrame && frame.routingId === mainFrame.routingId && frame.processId === mainFrame.processId);
}

export function acceptsNoArguments(value) {
  return value === undefined;
}
