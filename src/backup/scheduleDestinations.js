export const BACKUP_DESTINATIONS = Object.freeze({
  local: "本机文件夹",
  onedrive: "OneDrive",
  "google-drive": "Google Drive",
});

export function isBackupDestination(value) {
  return typeof value === "string" && Object.hasOwn(BACKUP_DESTINATIONS, value);
}
