import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const REQUIRED_RELEASE_TESTS = [
  "tests/release/installer-lifecycle.e2e.mjs",
  "tests/release/manual-screenshots.e2e.mjs",
  "tests/release/performance.e2e.mjs",
  "tests/release/security-sweep.e2e.mjs",
];

export function releaseTestFiles(root = REPO_ROOT) {
  const files = readdirSync(path.join(root, "tests", "release"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".e2e.mjs"))
    .map((entry) => `tests/release/${entry.name}`)
    .sort();
  const missing = REQUIRED_RELEASE_TESTS.filter((file) => !files.includes(file));
  if (missing.length) throw new Error(`Missing required release tests: ${missing.join(", ")}`);
  return files;
}

export async function runReleaseTests({ root = REPO_ROOT, spawnProcess = spawn } = {}) {
  let currentFile;
  try {
    const files = releaseTestFiles(root);
    for (const file of files) {
      currentFile = file;
      console.log(`[test:release] start ${file}`);
      const result = await new Promise((resolve, reject) => {
        const child = spawnProcess(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=spec", file], {
          cwd: root,
          stdio: "inherit",
          windowsHide: true,
        });
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
      });
      if (result.signal || result.code !== 0) {
        console.error(`[test:release] stopped ${file}: exit=${result.code ?? "none"} signal=${result.signal || "none"}; subsequent files were not started`);
        return !result.signal && Number.isInteger(result.code) && result.code > 0 ? result.code : 1;
      }
      console.log(`[test:release] passed ${file}`);
    }
    console.log(`[test:release] complete files=${files.length}`);
    return 0;
  } catch (error) {
    console.error(`[test:release] stopped${currentFile ? ` ${currentFile}` : ""}: ${error.message}; subsequent files were not started`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runReleaseTests();
}
