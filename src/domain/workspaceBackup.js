import { copyJson } from "./blockDocument.js";
import { CURRENT_SCHEMA_VERSION, migrateWorkspaceShell } from "../persistence/migrations.js";

export function createWorkspaceBackup(workspace) {
  const migrated = migrateWorkspaceShell(workspace);
  return {
    kind: "life-atlas-workspace",
    version: 1,
    schemaVersion: migrated.schemaVersion,
    exportedAt: new Date().toISOString(),
    workspace: copyJson(migrated),
  };
}

export function parseWorkspaceBackup(value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : copyJson(value);
  if (parsed?.kind !== "life-atlas-workspace" || !parsed.workspace) throw new Error("不是有效的 Life Atlas 工作区备份");
  if (Number(parsed.schemaVersion) > CURRENT_SCHEMA_VERSION) throw new Error("备份版本高于当前应用");
  return migrateWorkspaceShell(parsed.workspace);
}
