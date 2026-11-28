import fs from "node:fs";
import path from "node:path";

export function readPackageJson(appPath) {
  return JSON.parse(fs.readFileSync(path.join(appPath, "package.json"), "utf8"));
}

export function resolveFlavor({ isPackaged, appPath, packageJson }) {
  if (!isPackaged) return "dev";
  let metadata = packageJson;
  try {
    metadata ??= readPackageJson(appPath);
  } catch {
    return "release";
  }
  return metadata?.lifeAtlasFlavor === "test" ? "test" : "release";
}

export function areTestHooksEnabled(flavor, env = process.env) {
  return ["dev", "test"].includes(flavor) && env.LIFE_ATLAS_TEST === "1";
}

export function resolveRuntimeFlavor(app, env = process.env) {
  const flavor = resolveFlavor({ isPackaged: app.isPackaged, appPath: app.getAppPath() });
  return { flavor, testHooksEnabled: areTestHooksEnabled(flavor, env) };
}
