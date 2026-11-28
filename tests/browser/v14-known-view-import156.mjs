import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { browserScenario } from "./harness.mjs";

const run = process.env.WIKI_KNOWN_IMPORT156_RUN || `parent-${Date.now()}`;
assert.match(run, /^[a-z0-9-]+$/);
const root = `LOCAL-NOTION-001/v14-wiki-real133/import156/${run}`;
mkdirSync(`.qa/${root}`);
const workspace = JSON.parse(readFileSync(".qa/LOCAL-NOTION-001/v14-wiki-real133/context136/native-selection141-final-closed35.json", "utf8")).workspace;
const zipBytes = [...readFileSync(".qa/LOCAL-NOTION-001/v11-wiki-replica48/wiki-source-html48.zip")];
await browserScenario(`${root}/browser156`, async ({ page, check }) => {
  await check("Complete real HTML archive imports explicit occurrence views and preserves the entire existing Wiki", async () => {
    const result = await page.evaluate(async ({ zipBytes, workspace }) => {
      const { runKnownViewImport156 } = await import("/.qa/LOCAL-NOTION-001/v14-wiki-real133/import156/browser-checks156.mjs");
      return runKnownViewImport156({ zipBytes, workspace, includeWorkspace: true });
    }, { zipBytes, workspace });
    const { configuredWorkspace, ...summary } = result;
    writeFileSync(path.join(`.qa/${root}`, "configured-workspace.json"), `${JSON.stringify(configuredWorkspace, null, 2)}\n`, { flag: "wx" });
    writeFileSync(path.join(`.qa/${root}`, "result156.json"), `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
    assert.equal(result.archiveMembers, 62);
    assert.equal(result.validationSteps.length, 8);
    assert.deepEqual([configuredWorkspace.pages.length, configuredWorkspace.databaseItems.length, configuredWorkspace.databaseViews.length], [141, 96, 50]);
  });
}, { workspace });
