export class VaultError extends Error {
  constructor(code, message = code, extra = {}) {
    super(message);
    this.name = "VaultError";
    this.code = code;
    Object.assign(this, extra);
  }
}

export function invalidArgument(message = "参数不正确") {
  throw new VaultError("E_INVALID_ARGUMENT", message);
}
