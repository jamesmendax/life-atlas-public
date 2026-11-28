export function assistantError(code, message) {
  return Object.assign(new Error(message), { code });
}
