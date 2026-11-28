import { fullWorkspace, fullWorkspaceAttachmentBytes, FIXTURE_TIME } from "./full-workspace.mjs";
import { upgradeWorkspace } from "../../src/persistence/migrations.js";
import { exportBrowserBackup } from "../../src/backup/browserBackup.js";
import { openZipReader } from "../../src/backup/zipBrowser.js";

export function backupWorkspace() {
  return { ...upgradeWorkspace(fullWorkspace()), workspaceId: "ws-backup-fixture", savedAt: FIXTURE_TIME };
}

export async function backupFixture({ workspace = backupWorkspace(), attachments = fullWorkspaceAttachmentBytes() } = {}) {
  const exported = await exportBrowserBackup({ workspace, readAttachmentBlob: (id) => attachments.has(id) ? new Blob([attachments.get(id)]) : null, now: FIXTURE_TIME, appVersion: "0.1.0" });
  const bytes = new Uint8Array(await exported.blob.arrayBuffer());
  const reader = await openZipReader(bytes);
  const files = new Map();
  for (const filePath of reader.entries()) files.set(filePath, await reader.read(filePath));
  return { ...exported, bytes, reader, files, workspace, attachments };
}

export function memoryReader(files) {
  return { entries: () => [...files.keys()], read: async (filePath) => {
    if (!files.has(filePath)) throw new Error("Missing file");
    return files.get(filePath);
  } };
}

export function memoryStorage(initial = {}, onWrite = () => {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) { onWrite(key, value); values.set(key, String(value)); },
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
    values,
  };
}

export const sortedEntities = (entities) => [...entities].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
