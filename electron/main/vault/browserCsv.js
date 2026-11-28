import { invalidArgument } from "./errors.js";

export function parseCsv(text) {
  if (typeof text !== "string") invalidArgument("不是浏览器导出的密码文件");
  const source = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  for (let position = 0; position < source.length; position += 1) {
    const character = source[position];
    if (quoted) {
      if (character === '"' && source[position + 1] === '"') { field += '"'; position += 1; }
      else if (character === '"') { quoted = false; closedQuote = true; }
      else field += character;
    } else if (character === '"') {
      if (field || closedQuote) invalidArgument("CSV 引号格式不正确");
      quoted = true;
    } else if (character === ",") {
      row.push(field); field = ""; closedQuote = false;
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && source[position + 1] === "\n") position += 1;
      row.push(field); rows.push(row); row = []; field = ""; closedQuote = false;
    } else {
      if (closedQuote) invalidArgument("CSV 引号后有多余字符");
      field += character;
    }
  }
  if (quoted) invalidArgument("CSV 引号没有结束");
  if (field || row.length || closedQuote) { row.push(field); rows.push(row); }
  return rows;
}

export function mapBrowserRows(rows) {
  if (!Array.isArray(rows) || !rows.length) invalidArgument("不是浏览器导出的密码文件");
  const header = rows[0].map((value) => value.trim().toLowerCase());
  const required = ["url", "username", "password"];
  const chrome = header.includes("name");
  const firefox = ["httprealm", "formactionorigin", "guid", "timecreated", "timelastused", "timepasswordchanged"].every((column) => header.includes(column));
  if ((!chrome && !firefox) || required.some((column) => !header.includes(column)) || new Set(header).size !== header.length) invalidArgument("不是浏览器导出的密码文件");
  return rows.slice(1).filter((row) => row.some((value) => value !== "")).map((row) => {
    if (row.length !== header.length) invalidArgument("CSV 列数不正确");
    const get = (name) => row[header.indexOf(name)] ?? "";
    const url = get("url");
    let name = get("name");
    if (!name) { try { name = new URL(url).hostname; } catch { name = ""; } }
    return { name: name || "未命名", url, username: get("username"), password: get("password"), note: get("note") };
  });
}

export function browserCsvPreview(rows) {
  return rows.slice(0, 20).map((row, rowIndex) => ({ rowIndex, name: row.name, url: row.url, username: row.username, hasPassword: Boolean(row.password), note: row.note }));
}
