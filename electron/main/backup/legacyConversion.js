import { attachmentIdFromUrl, createAttachmentMetadata } from "../../../src/domain/attachments.js";
import { assetHashFromUrl } from "../../../src/domain/attachmentUrls.js";
import { databaseVersionSignature } from "../../../src/domain/databaseHistory.js";
import { visitDatabaseVersionFiles } from "../../../src/domain/databaseHistoryFiles.js";
import { StorageError } from "../storage/workspaceDb.js";

const mediaTypes = new Set(["image", "video", "audio", "file", "pdf"]);
// A repeated four-character group exhausts the regexp stack on valid large uploads.
const dataUrlPattern = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/;

export async function convertBrowserPackage(input, assetIndex, { putAsset }) {
  if (!Array.isArray(assetIndex) || typeof putAsset !== "function") throw new StorageError("E_INVALID_ARGUMENT", "浏览器备份转换参数无效");
  const workspace = structuredClone(input);
  const hashes = new Map(assetIndex.filter((entry) => entry.legacyAttachmentId).map((entry) => [entry.legacyAttachmentId, entry.sha256]));
  const report = { convertedAttachments: 0, convertedDataUrls: 0, leftovers: [] };
  const aliases = new Map();
  for (const attachment of workspace.attachments || []) {
    aliases.set(attachment.id, attachment);
    if (attachment.storageKey) aliases.set(attachment.storageKey, attachment);
    const sha256 = hashes.get(attachment.id) || hashes.get(attachment.storageKey);
    if (attachment.provider === "local-ref" && sha256) {
      attachment.provider = "asset";
      attachment.storageKey = sha256;
      attachment.checksum = sha256;
      report.convertedAttachments += 1;
    }
  }
  const fields = [];
  const addField = (owner, key, collection, id, field) => {
    if (owner && typeof owner[key] === "string") fields.push({ owner, key, collection, id, field });
  };
  const blocks = (tree, collection, id, prefix) => {
    if (!Array.isArray(tree)) return;
    for (let index = 0; index < tree.length; index += 1) {
      const block = tree[index];
      if (!block || typeof block !== "object") continue;
      if (mediaTypes.has(block.type)) addField(block.props, "url", collection, id, `${prefix}[${index}].props.url`);
      blocks(block.children, collection, id, `${prefix}[${index}].children`);
    }
  };
  const pageFields = (collection) => {
    for (const entity of workspace[collection] || []) {
      addField(entity, "icon", collection, entity.id, "icon");
      if (entity.cover?.kind === "upload") addField(entity.cover, "value", collection, entity.id, "cover.value");
      blocks(entity.content, collection, entity.id, "content");
    }
  };
  pageFields("pages");
  pageFields("pageTemplates");
  for (const entity of workspace.databaseTemplates || []) {
    addField(entity.pageAppearance, "icon", "databaseTemplates", entity.id, "pageAppearance.icon");
    if (entity.pageAppearance?.cover?.kind === "upload") addField(entity.pageAppearance.cover, "value", "databaseTemplates", entity.id, "pageAppearance.cover.value");
    blocks(entity.pageContent, "databaseTemplates", entity.id, "pageContent");
  }
  for (const entity of workspace.syncedSources || []) blocks(entity.blocks, "syncedSources", entity.id, "blocks");
  // Convert versions after live content so shared hashes keep the original asset metadata.
  pageFields("pageVersions");
  const putDataUrl = async (value, id, field) => {
    const match = dataUrlPattern.exec(value);
    if (!match || match[2].length % 4 !== 0) return null;
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.toString("base64") !== match[2]) throw new StorageError("E_CORRUPT", "浏览器图片的 Base64 无效");
    const name = `${id}-${field.replace(/[^A-Za-z0-9_-]/g, "-")}`.slice(0, 255);
    const result = await putAsset(bytes, { mime: match[1], name });
    const hash = assetHashFromUrl(result?.url);
    if (!hash) throw new StorageError("E_IO", "附件转换没有返回有效地址");
    report.convertedDataUrls += 1;
    return { url: result.url, hash, mime: match[1], size: bytes.length, name };
  };
  for (const { owner, key, collection, id, field } of fields) {
    const value = owner[key];
    const attachmentId = attachmentIdFromUrl(value);
    if (attachmentId && hashes.has(attachmentId)) owner[key] = `life-asset://${hashes.get(attachmentId)}`;
    else {
      const converted = await putDataUrl(value, id, field);
      if (converted) owner[key] = converted.url;
    }
    if (/^data:.*;base64,/i.test(owner[key]) || owner[key].includes("#life-attachment=")) report.leftovers.push({ collection, id, field });
  }
  const historyFiles = [];
  visitDatabaseVersionFiles(workspace.databaseVersions, (owner, key, version, item, propertyId) => {
    historyFiles.push({ owner, key, version, field: `items.${item.id}.values.${propertyId}` });
  });
  if (historyFiles.length) {
    const byHash = new Map((workspace.attachments || []).filter((attachment) => attachment.provider === "asset").map((attachment) => [attachment.storageKey, attachment]));
    const assetByHash = new Map(assetIndex.map((entry) => [entry.sha256, entry]));
    const attachmentIds = new Set((workspace.attachments || []).map((attachment) => attachment.id));
    const modified = new Set();
    for (const { owner, key, version, field } of historyFiles) {
      const value = owner[key];
      const referencedId = attachmentIdFromUrl(value);
      const attached = aliases.get(referencedId || value);
      let metadata = attached;
      if (!metadata) {
        const hash = assetHashFromUrl(value) || hashes.get(referencedId || value);
        const entry = assetByHash.get(hash);
        const converted = entry ? { hash, mime: entry.mime, size: entry.size, name: entry.originalName } : await putDataUrl(value, version.id, field);
        if (converted) {
          metadata = byHash.get(converted.hash);
          if (!metadata) {
            const base = `history-asset-${converted.hash}`;
            let id = base;
            for (let suffix = 1; attachmentIds.has(id); suffix++) id = `${base}-${suffix}`;
            metadata = createAttachmentMetadata({
              provider: "asset", storageKey: converted.hash, checksum: converted.hash, mime: converted.mime, size: converted.size, name: converted.name,
            }, { id, now: version.createdAt });
            (workspace.attachments ||= []).push(metadata);
            byHash.set(converted.hash, metadata);
            attachmentIds.add(id);
          }
        }
      }
      if (metadata?.id && (!referencedId || metadata.provider !== "local-ref")) {
        if (value !== metadata.id) { owner[key] = metadata.id; modified.add(version); }
      } else if (/^(data:|blob:|life-asset:)/i.test(value) || value.includes("#life-attachment=")) {
        report.leftovers.push({ collection: "databaseVersions", id: version.id, field });
      }
    }
    for (const version of modified) version.signature = databaseVersionSignature(version);
  }
  return { workspace, report };
}
