import { format as i18nFormat, getActiveLocale, tVault } from "../i18n/vaultTranslator.js";

const IMAGE_TOKEN = /^!\[\[vault-image:(va_[0-9a-f]{32})\|([^|\]]*)(?:\|([^\]]*))?\]\]$/;
const FILE_TOKEN = /^!\[\[vault-file:(va_[0-9a-f]{32})\|([^\]]*)\]\]$/;
const VALID_ATTACHMENT_ID = /^va_[0-9a-f]{32}$/;

let blockSequence = 0;

export function nextVaultBlockId() {
  blockSequence += 1;
  return `vb_${blockSequence}`;
}

export function formatVaultFileSize(bytes, locale = getActiveLocale()) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${i18nFormat.formatNumber(bytes / 1024, locale, { maximumFractionDigits: 1 })} KiB`;
  return `${i18nFormat.formatNumber(bytes / (1024 * 1024), locale, { maximumFractionDigits: 1 })} MiB`;
}

export function sanitizeTokenSegment(value) {
  return String(value ?? "").replace(/[|\[\]\r\n]/g, " ").trim();
}

export function isVaultImageName(name) {
  return /\.(?:png|jpe?g|webp|gif)$/i.test(String(name || ""));
}

const SLASH_COMMAND_DEFS = [
  { id: "image", labelKey: "vault.note.cmd.image.label", descKey: "vault.note.cmd.image.desc", keywords: "image img pic photo tupian 图片 照片 截图 画像 写真 スクリーンショット", groupKey: "vault.note.group.media" },
  { id: "file", labelKey: "vault.note.cmd.file.label", descKey: "vault.note.cmd.file.desc", keywords: "file attachment doc pdf wenjian fujian 文件 附件 文档 证书 密钥 ファイル 添付", groupKey: "vault.note.group.media" },
  { id: "heading1", labelKey: "vault.note.cmd.heading1.label", descKey: "vault.note.cmd.heading1.desc", keywords: "h1 heading1 title 标题 一级 見出し", groupKey: "vault.note.group.basic" },
  { id: "heading2", labelKey: "vault.note.cmd.heading2.label", descKey: "vault.note.cmd.heading2.desc", keywords: "h2 heading2 subtitle 标题 二级 見出し", groupKey: "vault.note.group.basic" },
  { id: "heading3", labelKey: "vault.note.cmd.heading3.label", descKey: "vault.note.cmd.heading3.desc", keywords: "h3 heading3 标题 三级 見出し", groupKey: "vault.note.group.basic" },
  { id: "todo", labelKey: "vault.note.cmd.todo.label", descKey: "vault.note.cmd.todo.desc", keywords: "todo check task checklist 待办 清单 复选框 タスク", groupKey: "vault.note.group.basic" },
  { id: "bullet", labelKey: "vault.note.cmd.bullet.label", descKey: "vault.note.cmd.bullet.desc", keywords: "ul bullet list 列表 无序 箇条書き", groupKey: "vault.note.group.basic" },
  { id: "numbered", labelKey: "vault.note.cmd.numbered.label", descKey: "vault.note.cmd.numbered.desc", keywords: "ol number ordered list 列表 有序 编号 番号", groupKey: "vault.note.group.basic" },
  { id: "callout", labelKey: "vault.note.cmd.callout.label", descKey: "vault.note.cmd.callout.desc", keywords: "callout tip note warn 提示 标注 提醒 コールアウト", groupKey: "vault.note.group.basic" },
  { id: "quote", labelKey: "vault.note.cmd.quote.label", descKey: "vault.note.cmd.quote.desc", keywords: "quote blockquote 引用", groupKey: "vault.note.group.basic" },
  { id: "code", labelKey: "vault.note.cmd.code.label", descKey: "vault.note.cmd.code.desc", keywords: "code pre snippet 代码 配置 密钥片段 コード", groupKey: "vault.note.group.basic" },
  { id: "divider", labelKey: "vault.note.cmd.divider.label", descKey: "vault.note.cmd.divider.desc", keywords: "hr divider line 分割线 横线 区切り線", groupKey: "vault.note.group.basic" },
  { id: "paragraph", labelKey: "vault.note.cmd.paragraph.label", descKey: "vault.note.cmd.paragraph.desc", keywords: "text p paragraph 文本 正文 段落 テキスト", groupKey: "vault.note.group.basic" },
];

export function getVaultSlashCommands(translate = tVault) {
  return SLASH_COMMAND_DEFS.map((cmd) => ({
    ...cmd,
    label: translate(cmd.labelKey),
    description: translate(cmd.descKey),
    group: translate(cmd.groupKey),
  }));
}

export const VAULT_SLASH_COMMANDS = Object.freeze(getVaultSlashCommands());

export function filterVaultSlashCommands(query, translate = tVault) {
  const normalized = String(query ?? "").trim().toLowerCase();
  const list = getVaultSlashCommands(translate);
  if (!normalized) return list;
  return list.filter((command) =>
    command.label.toLowerCase().includes(normalized)
    || command.description.toLowerCase().includes(normalized)
    || command.keywords.toLowerCase().includes(normalized)
    || command.id.toLowerCase().includes(normalized)
  );
}

export function createVaultBlock(type = "paragraph", extra = {}) {
  const id = extra.id || nextVaultBlockId();
  if (type === "divider") return { id, type: "divider" };
  if (type === "todo") return { id, type: "todo", text: String(extra.text ?? ""), checked: Boolean(extra.checked) };
  if (type === "image") {
    return {
      id,
      type: "image",
      attachmentId: VALID_ATTACHMENT_ID.test(extra.attachmentId) ? extra.attachmentId : "",
      name: sanitizeTokenSegment(extra.name || "加密图片"),
      caption: sanitizeTokenSegment(extra.caption || ""),
    };
  }
  if (type === "file") {
    return {
      id,
      type: "file",
      attachmentId: VALID_ATTACHMENT_ID.test(extra.attachmentId) ? extra.attachmentId : "",
      name: sanitizeTokenSegment(extra.name || "加密文件"),
    };
  }
  const safeType = ["paragraph", "heading1", "heading2", "heading3", "bullet", "numbered", "quote", "callout", "code"].includes(type)
    ? type
    : "paragraph";
  return { id, type: safeType, text: String(extra.text ?? "") };
}

export function parseVaultNote(value) {
  const raw = typeof value === "string" ? value.replace(/\r\n?/g, "\n") : "";
  if (!raw) return [createVaultBlock("paragraph", { text: "" })];
  const lines = raw.split("\n");
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.trim() === "```") {
      const codeLines = [];
      let closed = false;
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        if (lines[cursor].trim() === "```") {
          index = cursor;
          closed = true;
          break;
        }
        codeLines.push(lines[cursor]);
      }
      if (closed) {
        blocks.push(createVaultBlock("code", { text: codeLines.join("\n") }));
        continue;
      }
    }

    if (line.trim() === ":::callout") {
      const calloutLines = [];
      let closed = false;
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        if (lines[cursor].trim() === ":::") {
          index = cursor;
          closed = true;
          break;
        }
        calloutLines.push(lines[cursor]);
      }
      if (closed) {
        blocks.push(createVaultBlock("callout", { text: calloutLines.join("\n") }));
        continue;
      }
    }

    const imageMatch = IMAGE_TOKEN.exec(line.trim());
    if (imageMatch) {
      blocks.push(createVaultBlock("image", { attachmentId: imageMatch[1], name: imageMatch[2], caption: imageMatch[3] ?? "" }));
      continue;
    }

    const fileMatch = FILE_TOKEN.exec(line.trim());
    if (fileMatch) {
      blocks.push(createVaultBlock("file", { attachmentId: fileMatch[1], name: fileMatch[2] }));
      continue;
    }

    if (line.trim() === "---") {
      blocks.push(createVaultBlock("divider"));
      continue;
    }

    const todoMatch = /^- \[([ xX])\] (.*)$/.exec(line);
    if (todoMatch) {
      blocks.push(createVaultBlock("todo", { checked: todoMatch[1].toLowerCase() === "x", text: todoMatch[2] }));
      continue;
    }

    if (line.startsWith("### ")) { blocks.push(createVaultBlock("heading3", { text: line.slice(4) })); continue; }
    if (line.startsWith("## ")) { blocks.push(createVaultBlock("heading2", { text: line.slice(3) })); continue; }
    if (line.startsWith("# ")) { blocks.push(createVaultBlock("heading1", { text: line.slice(2) })); continue; }
    if (line.startsWith("- ")) { blocks.push(createVaultBlock("bullet", { text: line.slice(2) })); continue; }

    const numberedMatch = /^\d+\. (.*)$/.exec(line);
    if (numberedMatch) {
      blocks.push(createVaultBlock("numbered", { text: numberedMatch[1] }));
      continue;
    }

    if (line.startsWith("> ")) { blocks.push(createVaultBlock("quote", { text: line.slice(2) })); continue; }

    blocks.push(createVaultBlock("paragraph", { text: line }));
  }

  return blocks.length ? blocks : [createVaultBlock("paragraph", { text: "" })];
}

export function serializeVaultNote(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return "";
  if (blocks.length === 1 && blocks[0].type === "paragraph" && !blocks[0].text) return "";
  let listCounter = 0;
  return blocks.map((block) => {
    if (block.type === "numbered") {
      listCounter += 1;
      return `${listCounter}. ${block.text ?? ""}`;
    }
    listCounter = 0;
    if (block.type === "heading1") return `# ${block.text ?? ""}`;
    if (block.type === "heading2") return `## ${block.text ?? ""}`;
    if (block.type === "heading3") return `### ${block.text ?? ""}`;
    if (block.type === "bullet") return `- ${block.text ?? ""}`;
    if (block.type === "todo") return `- [${block.checked ? "x" : " "}] ${block.text ?? ""}`;
    if (block.type === "quote") return `> ${block.text ?? ""}`;
    if (block.type === "callout") return `:::callout\n${block.text ?? ""}\n:::`;
    if (block.type === "code") return `\`\`\`\n${block.text ?? ""}\n\`\`\``;
    if (block.type === "divider") return "---";
    if (block.type === "image" && VALID_ATTACHMENT_ID.test(block.attachmentId)) {
      const name = sanitizeTokenSegment(block.name || "加密图片");
      const caption = sanitizeTokenSegment(block.caption || "");
      return caption ? `![[vault-image:${block.attachmentId}|${name}|${caption}]]` : `![[vault-image:${block.attachmentId}|${name}]]`;
    }
    if (block.type === "file" && VALID_ATTACHMENT_ID.test(block.attachmentId)) {
      const name = sanitizeTokenSegment(block.name || "加密文件");
      return `![[vault-file:${block.attachmentId}|${name}]]`;
    }
    return String(block.text ?? "");
  }).join("\n");
}

export function collectVaultNoteAttachmentIds(value) {
  const ids = new Set();
  for (const block of parseVaultNote(value)) {
    if ((block.type === "image" || block.type === "file") && VALID_ATTACHMENT_ID.test(block.attachmentId)) {
      ids.add(block.attachmentId);
    }
  }
  return ids;
}

export function collectFieldAttachmentIds(fields) {
  const ids = new Set();
  for (const field of fields ?? []) {
    if (field.kind === "multiline" && typeof field.value === "string") {
      for (const id of collectVaultNoteAttachmentIds(field.value)) ids.add(id);
    }
  }
  return ids;
}

export function isRichVaultNote(value) {
  if (typeof value !== "string" || !value) return false;
  return parseVaultNote(value).some((block) => block.type !== "paragraph");
}
