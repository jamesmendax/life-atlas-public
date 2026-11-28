import { readFileSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
import { browserScenario } from "./harness.mjs";

const actual = JSON.parse(readFileSync(".qa/LOCAL-NOTION-001/v9-formal-database-ui01/evidence/native208-formal30-v14-real-wiki-resume.json", "utf8")).workspace;
const targets = JSON.parse(readFileSync(".qa/LOCAL-NOTION-001/v13-wiki-navigation122/targets123/targets123.json", "utf8"));
const root = actual.pages.find(entry => entry.id === targets.wiki.pageId);
const pair = ["E5", "E6"].map(id => targets.embeddedRootViews.find(entry => entry.targetId === id));
const workspace = structuredClone(actual);
workspace.ui = { ...workspace.ui, activeSection: "private", selectedPageId: root.id, selectedFolderId: root.folderId,
  privateExpanded: true, expandedPageIds: [...new Set([...(workspace.ui.expandedPageIds || []), root.id])],
  preferences: { ...workspace.ui.preferences, startPage: "last", theme: "dark" } };
const run = process.env.WIKI_HISTORY139_RUN || `run-${Date.now()}`;
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid run name");
const directory = `.qa/LOCAL-NOTION-001/v14-wiki-real133/history139/${run}`;
if (existsSync(directory)) throw new Error("Keep every previous run");
mkdirSync(directory, { recursive: true });
const report = await browserScenario("v14-real-wiki-history139", async ({ page, check, assert, saved }) => {
  const focused = id => page.locator(`[data-id="${id}"].is-link-target, .is-link-target [data-id="${id}"]`);
  const open = async target => {
    await page.locator(`[data-sidebar-view-id="${target.blockId}"]`).click();
    await focused(target.blockId).first().waitFor({ state: "visible" });
  };
  await check("Real Wiki E5 and E6 stay distinct in Back/Forward even on the same page and source", async () => {
    const before = await saved();
    assert.equal(before.pages.length, 84);
    await open(pair[0]);
    await open(pair[1]);
    assert.equal(await page.getByRole("button", { name: "后退", exact: true }).isEnabled(), true, "Two real same-page occurrence addresses must produce navigation history");
    await page.getByRole("button", { name: "后退", exact: true }).click();
    await focused(pair[0].blockId).first().waitFor({ state: "visible" });
    await page.getByRole("button", { name: "前进", exact: true }).click();
    await focused(pair[1].blockId).first().waitFor({ state: "visible" });
    const after = await saved();
    for (const key of ["dataSources", "databaseItems", "databaseViews", "attachments"]) assert.deepEqual(after[key], before[key], `Navigation preserves ${key}`);
    assert.equal(after.ui.selectedBlockId, undefined, "This increment must not add an unapproved persistent location field");
  });
}, { workspace });
writeFileSync(`${directory}/browser-report.json`, JSON.stringify({ ...report, input: "Full real native208, no entity pruning", scope: "In-memory Back/Forward only; not fullpage/normal restart or media fidelity" }, null, 2), { flag: "wx" });
