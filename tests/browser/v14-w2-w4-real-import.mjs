import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";
import { groupViewItems, projectViewItems } from "../../src/domain/database.js";
import { notionViewFile162Fixture } from "./v14-notion-view-file162.mjs";
import { installWikiProjections149DesktopFixture } from "./v14-wiki-projections149.mjs";
import { W1Gallery } from "../../.qa/LOCAL-NOTION-001/v14-wiki-real133/import156/source-configurations156.mjs";

const qaRoot = new URL("../../.qa/LOCAL-NOTION-001/v14-wiki-real133/", import.meta.url);
const archiveFile = new URL("../v11-wiki-replica48/wiki-source-html48.zip", qaRoot);
const inventoryFile = new URL("wrapper148/input-collections148.json", qaRoot);
const evidenceRoot = new URL("w2-w4-import166/", qaRoot);
const readJSON = (file) => JSON.parse(readFileSync(file, "utf8"));
const arrayKeys = (value) => Object.keys(value).filter((key) => Array.isArray(value[key]));
const counts = (value) => Object.fromEntries(arrayKeys(value).map((key) => [key, value[key].length]));
const blocksOf = (blocks) => (blocks || []).flatMap((block) => [block, ...blocksOf(block.children)]);
const one = (entries, label) => { assert.equal(entries.length, 1, label); return entries[0]; };

// Proposal 166 explicit inputs for W1 (Gallery peek), W2 (Board side + layout toggles), and W4 (List side + layout toggles)
export const proposal166Configurations = [
  W1Gallery,
  {
    path: "Untitled 3d54679fe15581d9b33dc70387153f79.html",
    collectionIndex: 0,
    pageType: "database",
    sourcePath: "札记 a47b2b17fabb4b15aaa527617a154c34.html",
    views: [
      {
        name: "札记 · 阶段",
        type: "board",
        filter: { propertyId: "公开", operator: "checked" },
        sorts: [{ propertyId: "最近更新", direction: "desc" }],
        groupBy: "阶段",
        grouping: {
          primaryPropertyId: "阶段",
          secondaryPropertyId: null,
          order: ["初记", "成形", "推演"],
          hiddenGroupKeys: ["未分组"],
          showEmpty: false,
        },
        visiblePropertyIds: ["标题", "摘要"],
        config: {
          openRecordsIn: "side",
          showDataSourceTitle: true,
          showPageIcon: true,
          board: {
            colorColumns: true,
            wrapAllContent: true,
          },
        },
      },
    ],
  },
  {
    path: "Untitled 3d54679fe155813b92f6d22f35a32c54.html",
    collectionIndex: 0,
    pageType: "database",
    sourcePath: "书架 cfdb47a69cfe4c31ac8caddc87f4a139.html",
    views: [
      {
        name: "书架 · 在读",
        type: "list",
        filter: { propertyId: "状态", operator: "equals", value: "Reading" },
        sorts: [{ propertyId: "开始日期", direction: "desc" }],
        groupBy: null,
        grouping: null,
        visiblePropertyIds: ["书名", "作者", "核心收获"],
        config: {
          openRecordsIn: "side",
          showDataSourceTitle: true,
          showPageIcon: true,
        },
      },
    ],
  },
];

function importedOccurrence(actual, original, config, inventory) {
  const added = (key) => actual[key].filter((entry) => !original[key].some((old) => old.id === entry.id));
  const sourceName = one(
    inventory.collections.filter((entry) => entry.member === config.path && entry.ordinal === config.collectionIndex + 1),
    "Frozen occurrence",
  ).sourceTitle;
  const source = one(added("dataSources").filter((entry) => entry.title === sourceName), `One imported ${sourceName} source`);
  const page = one(
    added("pages").filter(
      (entry) =>
        entry.id !== source.ownerPageId &&
        entry.title === sourceName &&
        blocksOf(entry.content).some((block) => block.type === "databaseView" && block.props.sourceId === source.id),
    ),
    `Original wrapper Page for ${sourceName}`,
  );
  const block = one(blocksOf(page.content).filter((entry) => entry.type === "databaseView" && entry.props.sourceId === source.id), "Occurrence block");
  const view = one(added("databaseViews").filter((entry) => entry.id === block.props.viewId && entry.sourceId === source.id), "Occurrence view");
  return { source, page, block, view };
}

export async function runV14W2W4RealImport({ run = process.env.W2_W4_IMPORT166_RUN || `run-${Date.now()}-${process.pid}` } = {}) {
  const base = new URL(process.env.PARITY_BASE_URL || "http://127.0.0.1:5178");
  const workspace = notionViewFile162Fixture();
  const inventory = readJSON(inventoryFile);
  mkdirSync(evidenceRoot, { recursive: true });
  const directory = path.join(fileURLToPath(evidenceRoot), run);
  mkdirSync(directory, { recursive: true });

  const configPath = path.join(directory, "proposal166-input.json");
  writeFileSync(configPath, JSON.stringify(proposal166Configurations, null, 2));

  const report = {
    name: "v14-w2-w4-real-import",
    run,
    startedAt: new Date().toISOString(),
    passed: false,
    checks: [],
    errors: [],
  };
  const publish = () => writeFileSync(path.join(directory, "browser-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  publish();

  let browser;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1040 } });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (["http:", "https:"].includes(url.protocol) && url.origin !== base.origin) {
        report.errors.push({ kind: "external-request", url: url.href });
        return route.abort();
      }
      return route.continue();
    });
    await context.addInitScript(installWikiProjections149DesktopFixture, { workspace, key: workspaceStorageKey });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.setDefaultNavigationTimeout(15000);

    page.on("pageerror", (error) => report.errors.push({ kind: "pageerror", message: error.stack }));
    page.on("console", (message) => {
      if (message.type() === "error") report.errors.push({ kind: "console", message: message.text() });
    });
    page.on("response", (response) => {
      if (response.status() >= 400) report.errors.push({ kind: "http", status: response.status(), url: response.url() });
    });

    const check = async (label, callback) => {
      const item = { label, passed: false };
      report.checks.push(item);
      publish();
      console.log(`CHECK w2-w4-166: ${label}`);
      await callback();
      assert.deepEqual(report.errors, []);
      item.passed = true;
      publish();
    };

    const saved = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), workspaceStorageKey);
    const settled = async () => {
      await page.waitForFunction(() => document.querySelector(".save-state")?.textContent === "已保存");
      return saved();
    };
    const sidebar = () => page.getByRole("complementary", { name: "主导航", exact: true });
    const dialog = () => page.getByRole("dialog", { name: "从 Notion 导入", exact: true });
    const added = (actual, key) => actual[key].filter((entry) => !workspace[key].some((old) => old.id === entry.id));

    let actual, w1, w2, w4;

    await check("Proposal 166 full real 62-member ZIP imports cleanly with 0 invalid-config warnings", async () => {
      await page.goto(base.href, { waitUntil: "domcontentloaded" });
      await sidebar().waitFor();
      await sidebar().locator(".workspace-switcher").click();
      await page.getByRole("menu", { name: "工作区菜单", exact: true }).getByRole("menuitem", { name: "从 Notion 导入…", exact: true }).click();
      await dialog().getByLabel("选择 Notion 导出文件", { exact: true }).setInputFiles(fileURLToPath(archiveFile));
      await dialog().getByRole("button", { name: "导入", exact: true }).waitFor();
      await dialog().getByLabel("选择视图设置文件", { exact: true }).setInputFiles(configPath);
      await page.waitForFunction(() => {
        const d = document.querySelector('[role="dialog"][aria-label="从 Notion 导入"]');
        return d && !d.textContent.includes("正在读取视图设置") && [...d.querySelectorAll("button")].some((b) => b.textContent.trim() === "导入" && !b.disabled);
      });
      await dialog().getByRole("button", { name: "导入", exact: true }).click();
      await dialog().getByRole("status").filter({ hasText: "已导入" }).waitFor();
      await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) || "null")?.pages.length === 141, workspaceStorageKey);

      actual = await settled();
      assert.equal(actual.pages.length, 141);
      assert.equal(actual.dataSources.length, 17);
      assert.equal(actual.databaseItems.length, 96);
      assert.equal(actual.databaseViews.length, 50);

      const importReport = await dialog().locator(".im-counts").evaluate((element) => {
        const key = Object.keys(element).find((k) => k.startsWith("__reactFiber$"));
        for (let fiber = key && element[key]; fiber; fiber = fiber.return) {
          const counts = fiber.memoizedProps?.counts;
          if (counts && Array.isArray(counts.warnings)) return JSON.parse(JSON.stringify(counts));
        }
        throw new Error("Missing import counts fiber");
      });

      const invalidWarnings = importReport.warnings.filter((w) => w.kind === "view_configuration_invalid");
      assert.deepEqual(invalidWarnings, [], "Proposal 166 configs (W1, W2, W4) must produce zero view_configuration_invalid warnings");

      w1 = importedOccurrence(actual, workspace, proposal166Configurations[0], inventory);
      w2 = importedOccurrence(actual, workspace, proposal166Configurations[1], inventory);
      w4 = importedOccurrence(actual, workspace, proposal166Configurations[2], inventory);

      // Verify mapped configurations
      assert.equal(w1.view.type, "gallery");
      assert.equal(w1.view.config.openRecordsIn, "peek");

      assert.equal(w2.view.type, "board");
      assert.equal(w2.view.config.openRecordsIn, "side");
      assert.equal(w2.view.config.showDataSourceTitle, true);
      assert.equal(w2.view.config.showPageIcon, true);
      assert.deepEqual(w2.view.config.board, { colorColumns: true, wrapAllContent: true });

      assert.equal(w4.view.type, "list");
      assert.equal(w4.view.config.openRecordsIn, "side");
      assert.equal(w4.view.config.showDataSourceTitle, true);
      assert.equal(w4.view.config.showPageIcon, true);

      // Close import dialog
      await dialog().getByRole("button", { name: "关闭", exact: true }).click();
    });

    await check("W2 Board displays column colors, wrapped content, and opens Side Peek (non-modal)", async () => {
      const folder = one(added(actual, "folders"), "Imported folder");
      await sidebar().getByRole("button", { name: `展开${folder.name}`, exact: true }).click();
      const root = one(added(actual, "pages").filter((entry) => entry.title === "Mendax 的 Vibe Coding Wiki"), "Wiki root");
      await sidebar().locator(`[data-node-id="${root.id}"]`).getByRole("button", { name: `展开${root.title}`, exact: true }).click();

      // Open W2 Board (札记)
      await sidebar().locator(`[data-node-id="${w2.page.id}"] > .sidebar-page-main`).click();
      const surface = page.locator(`section.database-view[data-view-id="${w2.view.id}"]`);
      await surface.waitFor();
      assert.equal(await surface.getAttribute("data-view-type"), "board");

      // Verify Board colorColumns & wrapAllContent
      const column = surface.locator(".db-board-column").first();
      assert.equal(await column.getAttribute("data-color-columns"), "true");
      const card = surface.locator(".db-board-card").first();
      assert.ok((await card.getAttribute("class")).includes("is-wrapped"));

      // Click card to open Side Peek
      const cardOpen = card.locator(".db-board-card-open");
      await cardOpen.click();

      const sidePeek = page.locator(".record-peek.is-side");
      await sidePeek.waitFor();
      assert.equal(await sidePeek.getAttribute("role"), "region");

      // Verify non-modal (no body overflow hidden)
      const bodyOverflow = await page.evaluate(() => document.body.style.overflow);
      assert.notEqual(bodyOverflow, "hidden");

      // Verify title is focused
      await page.waitForFunction(() => document.activeElement?.classList?.contains("record-peek-title"));

      // Escape closes side peek
      await page.keyboard.press("Escape");
      await sidePeek.waitFor({ state: "detached" });
    });

    await check("W4 List displays page icons and opens Side Peek on item click", async () => {
      // Open W4 List (书架)
      await sidebar().locator(`[data-node-id="${w4.page.id}"] > .sidebar-page-main`).click();
      const surface = page.locator(`section.database-view[data-view-id="${w4.view.id}"]`);
      await surface.waitFor();
      assert.equal(await surface.getAttribute("data-view-type"), "list");

      // Verify page icon rendered
      assert.ok((await surface.locator(".db-list-icon").count()) > 0);

      // Open item -> opens Side Peek
      const itemButton = surface.locator(".db-list-open").first();
      await itemButton.click();

      const sidePeek = page.locator(".record-peek.is-side");
      await sidePeek.waitFor();
      assert.equal(await sidePeek.getAttribute("role"), "region");

      // Close Side Peek
      await page.keyboard.press("Escape");
      await sidePeek.waitFor({ state: "detached" });
    });

    await check("W1 Gallery opens Center Peek (modal)", async () => {
      // Open W1 Gallery (文章)
      await sidebar().locator(`[data-node-id="${w1.page.id}"] > .sidebar-page-main`).click();
      const surface = page.locator(`section.database-view[data-view-id="${w1.view.id}"]`);
      await surface.waitFor();
      assert.equal(await surface.getAttribute("data-view-type"), "gallery");

      // Click card -> opens Center Peek
      const card = surface.locator("article[data-item-id]").first();
      await card.locator(".db-gallery-open").click();

      const centerPeek = page.getByRole("dialog", { name: "记录预览", exact: true });
      await centerPeek.waitFor();
      assert.equal(await centerPeek.getAttribute("role"), "dialog");

      // Verify modal geometry (centered)
      const geometry = await centerPeek.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          centerX: rect.x + rect.width / 2,
          centerY: rect.y + rect.height / 2,
          viewportX: innerWidth / 2,
          viewportY: innerHeight / 2,
        };
      });
      assert.ok(Math.abs(geometry.centerX - geometry.viewportX) <= 2 && Math.abs(geometry.centerY - geometry.viewportY) <= 2);

      // Close Center Peek
      await centerPeek.getByRole("button", { name: "关闭预览", exact: true }).click();
      await centerPeek.waitFor({ state: "detached" });
    });

    report.passed = true;
    publish();
    console.log("PASS v14-w2-w4-real-import: all checks green!");
  } finally {
    if (browser) await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  runV14W2W4RealImport().catch((error) => {
    console.error("FAIL v14-w2-w4-real-import:", error);
    process.exit(1);
  });
}
