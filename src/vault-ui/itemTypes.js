import { tVault } from "../i18n/vaultTranslator.js";

export const ITEM_TYPES = Object.freeze({
  login: "登录账号",
  apiKey: "API 密钥",
  server: "服务器 / SSH",
  database: "数据库连接",
  secureNote: "安全笔记",
  recoveryCodes: "恢复码",
  custom: "自定义",
});

export const FIELD_KINDS = Object.freeze({
  text: "文本",
  secret: "密码 / 密钥",
  url: "网址",
  email: "电子邮箱",
  number: "数字",
  date: "日期",
  multiline: "多行文本",
  totp: "两步验证",
});

export function itemTypeLabel(type, translate = tVault) {
  return ITEM_TYPES[type] ? translate(`vault.type.${type}`) : type;
}

export function fieldKindLabel(kind, translate = tVault) {
  return FIELD_KINDS[kind] ? translate(`vault.fieldKind.${kind}`) : kind;
}

const presets = {
  login: [["vault.preset.url", "url"], ["vault.preset.username", "text"], ["vault.preset.password", "secret"], ["vault.preset.totp", "totp"], ["vault.preset.note", "multiline"]],
  apiKey: [["vault.preset.provider", "text"], ["vault.preset.environment", "text"], ["vault.preset.keyName", "text"], ["vault.preset.apiKey", "secret"], ["vault.preset.secret", "secret"], ["vault.preset.scopes", "text"], ["vault.preset.expiryDate", "date"], ["vault.preset.consoleUrl", "url"], ["vault.preset.note", "multiline"]],
  server: [["vault.preset.host", "text"], ["vault.preset.port", "number"], ["vault.preset.username", "text"], ["vault.preset.password", "secret"], ["vault.preset.privateKey", "multiline", true], ["vault.preset.fingerprint", "text"], ["vault.preset.note", "multiline"]],
  database: [["vault.preset.dbType", "text"], ["vault.preset.host", "text"], ["vault.preset.port", "number"], ["vault.preset.dbName", "text"], ["vault.preset.username", "text"], ["vault.preset.password", "secret"], ["vault.preset.connString", "secret"], ["vault.preset.note", "multiline"]],
  secureNote: [["vault.preset.content", "multiline", true]],
  recoveryCodes: [["vault.preset.service", "text"], ["vault.preset.recoveryCodes", "multiline", true], ["vault.preset.note", "multiline"]],
  custom: [],
};

export function newItemFields(type, translate = tVault) {
  return presets[type].map(([labelKey, kind, sensitive = false], index) => ({
    editorId: `new-${index}`,
    label: translate(labelKey),
    kind,
    sensitive: sensitive || ["secret", "totp"].includes(kind),
    value: "",
    modified: true,
  }));
}
