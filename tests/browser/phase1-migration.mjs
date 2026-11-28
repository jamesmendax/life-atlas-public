import { browserScenario } from "./harness.mjs";
import { legacyWorkspace } from "../fixtures/workspace-v6-parity.mjs";
import { walkBlocks } from "../../src/domain/blockDocument.js";

const legacy = legacyWorkspace();
await browserScenario("phase1-migration", async ({ page, check, saved, persisted, screenshot, assert }) => {
  await check("Actual v6 browser storage migrates safely, retaining original key, Columns and conflicting canonical payloads", async () => {
    await page.locator(".life-tabs-header").first().waitFor();
    const migrated = await persisted((value) => value.schemaVersion >= 7);
    const original = await page.evaluate(() => localStorage.getItem("life-atlas.workspace.v6"));
    assert.deepEqual(JSON.parse(original), legacy);
    assert.equal(migrated.pages.length, legacy.pages.length);
    assert.equal(migrated.databaseItems.length, 1);
    assert.equal(migrated.dataSources.length, 1);
    const blocks = walkBlocks(migrated.pages[0].content);
    assert.equal(blocks.find((block) => block.id === "columns").type, "columnList");
    assert.deepEqual(blocks.find((block) => block.id === "columns").children.map((column) => column.props.width), [60, 40]);
    assert.equal(migrated.syncedSources.length, 2);
    assert.ok(JSON.stringify(migrated.syncedSources).includes("Do not discard this version"));
    for (const type of ["chart", "form", "dashboard"]) {
      const block = blocks.find((entry) => entry.id === type);
      assert.equal(migrated.databaseViews.find((view) => view.id === block.props.viewId).type, type);
    }
    assert.equal(migrated.databaseViews.find((view) => view.id === "view").type, "table");
  });
  await check("Reload keeps upgraded identities stable and old native Columns remain editable", async () => {
    const first = await saved();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".life-tabs-header").first().waitFor();
    const next = await saved();
    assert.deepEqual(next.syncedSources.map((source) => source.id), first.syncedSources.map((source) => source.id));
    assert.deepEqual(next.databaseViews.map((view) => view.id), first.databaseViews.map((view) => view.id));
    assert.equal(await page.locator('[data-content-type="column"]').count(), 2);
    await screenshot("migrated-columns");
  });
}, { workspace: legacy, legacyStorageKey: "life-atlas.workspace.v6" });