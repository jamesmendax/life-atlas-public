export const BACKUP_KIND = "life-atlas-backup";
export const BACKUP_FORMAT_VERSION = 1;
export const BASE_BACKUP_COLLECTIONS = Object.freeze([
  "folders", "pages", "dataSources", "databaseItems", "databaseViews", "relations",
  "syncedSources", "attachments", "people", "pageTemplates", "databaseTemplates", "discussions", "comments",
]);
export const BACKUP_COLLECTIONS = Object.freeze([...BASE_BACKUP_COLLECTIONS, "pageVersions", "databaseVersions"]);
export const COLLECTION_SINCE = Object.freeze({ pageVersions: 16, databaseVersions: 20 });

export function requiredCollections(schemaVersion) {
  return BACKUP_COLLECTIONS.filter((collection) => (COLLECTION_SINCE[collection] ?? 0) <= Number(schemaVersion));
}

export function isSafeBackupPath(filePath) {
  return typeof filePath === "string" && filePath.length > 0 && filePath.length <= 500
    && /^[A-Za-z0-9._/-]+$/.test(filePath) && !filePath.startsWith("/")
    && !filePath.includes("..") && !filePath.includes("//");
}

export function shouldStoreAsset(mime) {
  return /^(image\/(?:jpeg|png|webp|gif)$|video\/|audio\/|application\/(?:pdf|zip)$)/i.test(String(mime).split(";")[0].trim());
}

export function compressionForMime(mime) {
  return shouldStoreAsset(mime) ? "STORE" : "DEFLATE";
}
