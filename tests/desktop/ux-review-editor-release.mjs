import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createIsolatedDirectory, removeIsolatedDirectory, REPO_ROOT, seedWorkspaceDatabase } from "./helpers.mjs";
import { startApp, closeAppGracefully, waitFor } from "../release/helpers.mjs";
import { SLASH_MENU_CATALOG } from "../../src/editor/slashMenuCatalog.js";
import { workspaceFixture, root, block, inline, openPage, mainTitle, slashTitle, dbTitle, focusInfo, editorSnapshot, closeFloating, setSurface, pause } from "./ux-review-editor-support.mjs";
import { runEditorControls } from "./ux-review-editor-actions.mjs";
import { runEditorMatrix } from "./ux-review-editor-matrix.mjs";

const profile = createIsolatedDirectory("ux-review-editor");
await fs.mkdir(path.join(REPO_ROOT, ".qa"), { recursive: true });
const evidence = await fs.mkdtemp(path.join(REPO_ROOT, ".qa", "ux-review-editor-"));
const executable = path.join(REPO_ROOT, "release/release/win-unpacked/Life Atlas.exe");
const filter = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7) || "all";
const filterIds = new Set((process.argv.find((arg) => arg.startsWith("--ids="))?.slice(6) || "").split(",").filter(Boolean));
const stepIds = new Set((process.argv.find((arg) => arg.startsWith("--steps="))?.slice(8) || "").split(",").filter(Boolean));
const strict = process.argv.includes("--assert-ux");
const expectedAsar = process.argv.find((arg) => arg.startsWith("--expected-asar="))?.slice(16).toLowerCase();
const report = { at: new Date().toISOString(), profile, filter, executable, results: [], findings: [], pageErrors: [], surfaces: [], screenshots: [] };
const write = () => fs.writeFile(path.join(evidence, "result.json"), JSON.stringify(report, null, 2));
let browser, page, child;
const safeName = (id) => id.replace(/[^a-z0-9-]/giu, "-");
async function shot(id) {
  const name = safeName(id) + ".png";
  await page.screenshot({ path: path.join(evidence, name), timeout: 2200 });
  report.screenshots.push(name);
}
async function check(id, task) {
  if (stepIds.size && !stepIds.has(id)) return;
  const step = { id, at: new Date().toISOString() };
  const previousFindings = report.findings.length;
  try {
    step.observed = await task();
    step.findings = report.findings.slice(previousFindings).map((issue) => issue.id);
    step.status = step.findings.length ? "finding" : "passed";
  } catch (error) {
    step.status = "inspect";
    step.error = String(error.message).slice(0, 1300);
    if (error.observed) step.observed = error.observed;
    step.focus = await focusInfo(page).catch(() => null);
    if (report.results.filter((r) => r.status === "inspect").length < 10) await shot("inspect-" + id).catch(() => {});
    await closeFloating(page);
  }
  report.results.push(step);
  await write();
  console.log("EDITOR_REVIEW", step.status, id, step.error?.split("\n")[0] || "");
}
function finding(id, detail) { report.findings.push({ id, ...detail }); }

async function surface(theme, width, height) {
  const real = await setSurface(page, theme, width, height, child.pid, executable);
  report.surfaces.push({ requested: [width, height], ...real });
  return real;
}

const expectedTypes = {
  text: "paragraph", page: "pageLink", todo: "checkListItem", h1: "heading", h2: "heading", h3: "heading", h4: "heading",
  th1: "heading", th2: "heading", th3: "heading", th4: "heading", table: "table", bullet: "bulletListItem",
  numbered: "numberedListItem", toggle: "toggleListItem", quote: "quote", divider: "divider", "link-to-page": "pageLink",
  callout: "callout", image: "image", video: "video", audio: "audio", file: "file", pdf: "file", code: "codeBlock",
  toc: "tableOfContents", equation: "equation", breadcrumb: "breadcrumb", synced: "syncedBlock", tabs: "tabs",
  "editorial-card": "editorialCard", "editorial-3-cards": "columnList", "editorial-media-text": "editorialCard",
  "editorial-section": "editorialSection", "database-inline": "databaseView", "linked-view": "databaseView",
};

async function slashChecks() {
  for (const [title, group] of [[slashTitle, false], [dbTitle, true]]) {
    await openPage(page, title);
    if (!group) await check("slash-menu-inventory-wheel-keyboard", async () => {
      await inline(page, "ux-slot-inventory").click();
      await page.keyboard.type("/");
      const menu = page.locator(".bn-suggestion-menu:visible").last();
      await menu.waitFor();
      const labels = await menu.locator(".bn-mt-suggestion-menu-item-title").allTextContents();
      const bounds = await menu.boundingBox();
      await menu.hover();
      const before = await menu.evaluate((el) => el.scrollTop);
      await page.mouse.wheel(0, 780);
      await pause(160);
      const after = await menu.evaluate((el) => el.scrollTop);
      await page.keyboard.press("ArrowDown");
      const active = await menu.locator('[aria-selected="true"]').innerText();
      await shot("slash-open");
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "hidden" });
      const focus = await focusInfo(page);
      assert.ok(labels.includes("文本") && labels.includes("表情") && after > before && focus.inEditor);
      return { labels, bounds, before, after, active, focus };
    });
    for (const entry of SLASH_MENU_CATALOG.filter((item) => (item.group === "数据库") === group)) {
      if (filterIds.size && !filterIds.has(entry.id)) continue;
      await check("slash-" + entry.id, async () => {
        await openPage(page, title);
        const id = "ux-slot-" + entry.id;
        const original = await editorSnapshot(page);
        const index = original.blocks.findIndex((item) => item.id === id);
        await inline(page, id).click();
        await page.keyboard.type("/");
        const menu = page.locator(".bn-suggestion-menu:visible").last();
        await menu.waitFor();
        const option = menu.getByText(entry.title, { exact: true }).first();
        if (!await option.count()) await page.keyboard.insertText(entry.aliases[0]);
        const subtitle = await option.locator("..").locator(".bn-mt-suggestion-menu-item-subtitle").innerText();
        if (entry.id === "pdf" && !subtitle.includes("附件")) finding("pdf-insert-label", { rendered: "attachment", actualLabel: subtitle });
        await option.click();
        if (entry.id === "inline-equation") {
          const dialog = page.getByRole("dialog", { name: "行内公式" });
          await dialog.locator("textarea").fill("y^2");
          await dialog.locator("button").last().click();
          await block(page, id).locator(".life-inline-equation").waitFor();
        } else if (entry.id === "mention") {
          const choices = page.locator(".bn-suggestion-menu:visible");
          await choices.getByRole("option").first().click();
        } else if (entry.id === "emoji") {
          await page.keyboard.type("sm");
          await page.locator(".bn-grid-suggestion-menu [role=option]").first().waitFor();
          await page.keyboard.press("Enter");
        } else if (entry.id === "database-full") {
          await page.waitForFunction((name) => document.querySelector(".page-title-input")?.value !== name, title, { timeout: 3000 });
          const selected = await page.locator(".page-title-input").inputValue();
          const table = await page.locator(".database-view:visible").count();
          assert.ok(table > 0);
          return { title: entry.title, openedDatabasePage: selected, table };
        }
        const now = await editorSnapshot(page);
        const expected = expectedTypes[entry.id] || (entry.id.startsWith("view-") ? "databaseView" : entry.id.startsWith("columns-") ? "columnList" : null);
        const result = now.blocks.find((item) => item.id === id) || now.blocks[index];
        const inserted = expected && result?.type !== expected ? now.blocks.slice(Math.max(0, index - 1), index + 3).find((b) => b.type === expected && !original.blocks.some((old) => old.id === b.id && old.type === expected)) : result;
        if (expected) assert.equal(inserted?.type, expected, entry.title + " did not produce " + expected);
        if (/^t?h[1-4]$/u.test(entry.id)) {
          assert.equal(inserted.props.level, Number(entry.id.at(-1)));
          assert.equal(Boolean(inserted.props.isToggleable), entry.id.startsWith("th"));
        }
        if (entry.id.startsWith("columns-")) assert.equal(inserted.children.length, Number(entry.id.at(-1)));
        if (entry.id === "emoji") assert.match(JSON.stringify(result.content), /\p{Extended_Pictographic}/u);
        if (entry.id === "mention") assert.match(JSON.stringify(result.content), /(?:page|date|user)Mention/u);
        if (entry.id.startsWith("view-") || entry.id === "database-inline") assert.ok(inserted.props.sourceId && inserted.props.viewId);
        return { label: entry.title, subtitle, resultType: inserted?.type || result.type, props: expected === "heading" || expected === "databaseView" ? inserted.props : undefined };
      });
    }
  }
}

try {
  await seedWorkspaceDatabase(profile, workspaceFixture());
  report.asarSha256 = createHash("sha256").update(await fs.readFile(path.join(path.dirname(executable), "resources/app.asar"))).digest("hex");
  if (expectedAsar !== undefined) {
    assert.match(expectedAsar, /^[0-9a-f]{8,64}$/);
    assert.ok(report.asarSha256.startsWith(expectedAsar), "Packaged app.asar differs from the scheduled release");
  }
  child = startApp(executable, profile, { args: ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"] });
  console.log("EDITOR_REVIEW_EVIDENCE", evidence);
  const ws = await waitFor(() => child.releaseOutput.stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[\w-]+)/u)?.[1], { timeoutMs: 30000 });
  browser = await chromium.connectOverCDP(ws);
  page = await waitFor(() => browser.contexts()[0].pages().find((p) => p.url() === "app://bundle/index.html"), { timeoutMs: 25000 });
  page.setDefaultTimeout(2600);
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  await page.locator("html[data-la-ready]").waitFor({ timeout: 14000 });
  const info = (await page.evaluate(() => window.lifeAtlas.app.getInfo())).value;
  assert.equal(info.flavor, "release");
  assert.equal(info.isPackaged, true);
  assert.equal(path.resolve(info.dataRoot), profile);
  report.app = { version: info.appVersion, flavor: info.flavor, isPackaged: info.isPackaged, pid: child.pid };
  await openPage(page, mainTitle);
  await surface("light", 1380, 860);
  if (filter === "all" || filter === "controls") await runEditorControls({ page, profile, check, finding, shot, surface, evidence });
  if (filter === "all" || filter === "slash") await slashChecks();
  if (filter === "matrix-ordinary" || filter === "matrix-template") {
    await runEditorMatrix({ page, check, finding, surface, shot, kind: filter.slice("matrix-".length) });
  }
  assert.ok(report.results.length, "No matching review steps ran");
  if (stepIds.size) assert.deepEqual(new Set(report.results.map((item) => item.id)), stepIds);
} catch (error) {
  report.error = String(error.stack);
} finally {
  if (page && !page.isClosed()) {
    await page.close({ runBeforeUnload: true }).catch(() => {});
    await waitFor(() => child.exitCode !== null, { timeoutMs: 6000, intervalMs: 80 }).catch(() => {});
  }
  if (child) try { await closeAppGracefully(child); report.exitCode = child.exitCode; } catch (error) { report.closeError = String(error.message); }
  await browser?.close().catch(() => {});
  await write();
  removeIsolatedDirectory(profile);
}
console.log("EDITOR_REVIEW_RESULT", evidence, { steps: report.results.length, inspect: report.results.filter((s) => s.status === "inspect").length, error: report.error });
if (report.error || report.closeError || report.pageErrors.length || report.results.some((s) => s.status === "inspect") || strict && report.findings.length) process.exitCode = 1;
