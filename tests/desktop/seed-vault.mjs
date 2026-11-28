import { createVaultService } from "../../electron/main/vault/index.js";
import { lastTwoGroups } from "../../electron/main/vault/recoveryKey.js";
import { ensureDataRootMarker } from "../../electron/main/storage/dataRoot.js";
import { assertTestPath } from "./helpers.mjs";

export async function seedVault(dataRoot, { password, inputs }) {
  if (!Array.isArray(inputs)) throw new TypeError("密钥库夹具条目必须是数组");
  const root = assertTestPath(dataRoot);
  ensureDataRootMarker(root, { appVersion: "1.0.0", now: new Date().toISOString() });
  const service = createVaultService({ dataRoot: root });
  try {
    const { recoveryKey } = await service.create({ password });
    service.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(recoveryKey) });
    for (const input of inputs) service.createItem({ input });
    return { recoveryKey };
  } finally { service.lock("app-quit"); service.closeDatabase(); }
}
