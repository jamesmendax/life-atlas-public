import { validateAssistantConversationBackup } from "../assistant/conversations.js";
import { StorageError } from "../storage/workspaceDb.js";

export const ASSISTANT_ARCHIVE_PATH = "assistant/conversations.json";

export function validateAssistantArchive(archive, assets) {
  try {
    const { attachmentAssetIds } = validateAssistantConversationBackup(archive);
    const assetIds = new Set(assets.map(({ sha256 }) => sha256));
    if (attachmentAssetIds.some((id) => !assetIds.has(id))) throw new Error("missing attachment");
  } catch {
    throw new StorageError("E_CORRUPT", "备份中的助手对话或附件索引无效");
  }
}
