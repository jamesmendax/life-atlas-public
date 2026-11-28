import { BACKUP_COLLECTIONS } from "../../src/backup/format.js";
import { upgradeWorkspace } from "../../src/persistence/migrations.js";
import { fullWorkspace } from "./full-workspace.mjs";
import { bigWorkspace } from "./big-workspace.mjs";

const searchTitles = new Map([
  ["big-p-4321", "性能检索目标一"],
  ["big-p-17", "性能检索目标二"],
  ["big-p-2500", "性能检索目标三"],
]);

export function releaseWorkspace() {
  const full = upgradeWorkspace(fullWorkspace());
  const big = upgradeWorkspace(bigWorkspace());
  const workspace = { ...full };
  for (const collection of BACKUP_COLLECTIONS) {
    const ids = new Set(full[collection].map((entity) => entity.id));
    workspace[collection] = [...full[collection], ...big[collection].filter((entity) => !ids.has(entity.id))];
  }
  workspace.pages = workspace.pages.map((page) => searchTitles.has(page.id) ? { ...page, title: searchTitles.get(page.id) } : page);
  return workspace;
}
