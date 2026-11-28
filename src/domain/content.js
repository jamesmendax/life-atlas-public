function inlineToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      if (typeof item.text === "string") return item.text;
      if (typeof item.content === "string") return item.content;
      return inlineToText(item.content);
    })
    .join("");
}

function blockToText(block) {
  if (!block || typeof block !== "object") return "";
  const own = inlineToText(block.content);
  const children = Array.isArray(block.children) ? block.children.map(blockToText).join(" ") : "";
  return [own, children].filter(Boolean).join(" ").trim();
}

import { materializeDocument, plainTextFromMaterialized, pageSemanticText } from "./documentSemantics.js";

export function documentToPlainText(blocks, workspace) {
  if (workspace) return plainTextFromMaterialized(materializeDocument(blocks, workspace));
  if (!Array.isArray(blocks)) return "";
  return blocks.map(blockToText).filter(Boolean).join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function summarizeText(text, maxLength = 96) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "还没有可用于总结的正文内容。";
  if (normalized.length <= maxLength) return normalized;
  const head = normalized.slice(0, maxLength + 24);
  const sentenceEnd = Math.max(head.lastIndexOf("。"), head.lastIndexOf("！"), head.lastIndexOf("？"), head.lastIndexOf("."), head.lastIndexOf(";"));
  const cut = sentenceEnd >= Math.floor(maxLength * 0.55) ? sentenceEnd + 1 : maxLength;
  return `${head.slice(0, cut).trim()}…`;
}

export function derivePageSummary(page, maxLength = 96, workspace) {
  if (!page) return "";
  const sourceText = workspace ? pageSemanticText(page, workspace) : documentToPlainText(page.content);
  return summarizeText(sourceText, maxLength);
}

export function deriveFolderSummary(folder, pages, maxLength = 120) {
  if (!folder) return "";
  const directPages = pages.filter((page) => page.folderId === folder.id);
  if (directPages.length === 0) return "这个文件夹还没有笔记。";
  const combined = directPages
    .slice(0, 4)
    .map((page) => page.summary || derivePageSummary(page, 64))
    .filter(Boolean)
    .join("；");
  return summarizeText(combined, maxLength);
}

import { getActiveLocale } from "../i18n/core.js";
import { formatDateTime as formatIntlDateTime } from "../i18n/format.js";

export function formatDateTime(value, locale = getActiveLocale()) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  if (locale !== "zh-CN") return formatIntlDateTime(date, locale);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function normalizeSearchText(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase();
}
