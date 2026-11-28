import { browserScenario } from "./harness.mjs";
import { chooseSavedView } from "./database-navigation.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { startDatabaseItemDrag } from "../../src/components/databaseItemDrag.js";

const seed = coreParityWorkspace();
for (const view of seed.databaseViews) view.config.openRecordsIn = "peek";
const viewIds = ["view-map", "view-gallery", "view-board", "view-calendar", "view-table", "view-list"];
const host = seed.pages.find((page) => page.id === "database-page");
host.databaseViewId = viewIds[0];
host.content = [{ id: "db-surface", type: "databaseView", props: { sourceId: "projects", viewId: viewIds[0], viewIdsJson: JSON.stringify(viewIds) } }];

const runScenario = process.argv.includes("--release")
  ? (await import("../release/database-focus-scenario.mjs")).databaseFocusScenario
  : browserScenario;

await runScenario("database-drop-focus", async ({ page, check, assert, saved, persisted, screenshot }) => {
  const db = page.locator('.database-view[data-source-id="projects"]');
  await db.waitFor();
  const choose = (type) => chooseSavedView(db, "view-" + type);
  const focusStyle = (node) => node.evaluate((el) => ({
    focused: el === document.activeElement, keyboard: el.matches(":focus-visible"),
    outline: getComputedStyle(el).outlineStyle, shadow: getComputedStyle(el).boxShadow,
  }));

  await check("clicking or panning the map leaves its surface unoutlined; Tab identifies the keyboard pan target", async () => {
    await choose("map");
    const map = db.locator(".db-offline-map");
    assert.equal((await focusStyle(map)).outline, "none");
    await map.click({ position: { x: 18, y: 18 } });
    let style = await focusStyle(map);
    assert.ok(style.focused && !style.keyboard);
    assert.equal(style.outline, "none");
    const bounds = await map.boundingBox();
    await page.mouse.move(bounds.x + 35, bounds.y + 35);
    await page.mouse.down(); await page.mouse.move(bounds.x + 65, bounds.y + 45, { steps: 4 }); await page.mouse.up();
    assert.equal((await focusStyle(map)).outline, "none");
    await db.getByRole("button", { name: "重置地图" }).click();
    await page.keyboard.press("Tab");
    style = await focusStyle(map);
    assert.ok(style.focused && style.keyboard);
    assert.equal(style.outline, "dashed");
    const box = await map.getAttribute("viewBox");
    await page.keyboard.press("ArrowRight");
    assert.notEqual(await map.getAttribute("viewBox"), box);
  });

  await check("gallery and board restore keyboard focus to a title indicator after closing record preview", async () => {
    for (const [type, selector] of [["gallery", ".db-gallery-open"], ["board", ".db-board-card-open"]]) {
      await choose(type);
      const card = db.locator(selector).first();
      const label = type === "gallery" ? card.locator(".db-gallery-title") : card;
      await card.hover();
      assert.equal((await focusStyle(card)).focused, false);
      await page.keyboard.press("Tab"); await card.focus();
      await card.press("Enter");
      const peek = page.getByRole("dialog", { name: "记录预览" });
      await peek.waitFor();
      await page.keyboard.press("Escape");
      await peek.waitFor({ state: "detached" });
      await page.waitForFunction((css) => document.activeElement?.matches(css), selector);
      const style = await focusStyle(card);
      assert.ok(style.keyboard);
      assert.equal(style.outline, "none");
      assert.equal(style.shadow, "none");
      const indicator = await label.evaluate((el) => ({
        width: parseFloat(getComputedStyle(el, "::before").borderInlineStartWidth), ratio: devicePixelRatio,
      }));
      assert.ok(Math.abs(indicator.width - 3) * indicator.ratio < 1, "title marker must cover three CSS pixels within native device rounding");
    }
  });

  await check("table navigation marks focused values locally and list title editing returns a local indicator", async () => {
    await choose("table");
    const row = db.locator('tr[data-item-id="alpha"]');
    const title = row.locator('td[data-property-id="title"]');
    const status = row.locator('td[data-property-id="status"]');
    assert.ok(await title.evaluate((el) => el.closest(".bn-editor") !== null), "embedded in the actual editor");
    const expectValueFocus = async (cell, target = cell) => {
      const style = await focusStyle(target);
      assert.ok(style.focused && style.keyboard);
      assert.equal(style.outline, "none"); assert.equal(style.shadow, "none");
      const marker = await cell.evaluate((el) => {
        const mark = getComputedStyle(el, "::before");
        const normalized = document.createElement("span").style;
        normalized.color = getComputedStyle(el).getPropertyValue("--mb-muted").trim();
        return [parseFloat(mark.borderInlineStartWidth), parseFloat(mark.blockSize), mark.borderInlineStartColor, normalized.color, devicePixelRatio];
      });
      assert.ok(Math.abs(marker[0] - 3) * marker[4] < 1); assert.equal(marker[1], 16);
      assert.equal(marker[2], marker[3]);
    };
    await page.keyboard.press("Tab"); await title.focus();
    await expectValueFocus(title);
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.activeElement?.dataset.propertyId === "status");
    await expectValueFocus(status);
    await status.locator("summary").focus();
    await expectValueFocus(status, status.locator("summary"));
    await page.keyboard.press("Enter");
    assert.ok(await status.locator("details").evaluate((details) => details.open));
    await page.keyboard.press("Escape");
    await choose("list");
    const listRow = db.locator('.db-list-row[data-item-id="alpha"]');
    await listRow.locator(".db-list-edit").click();
    await listRow.getByRole("textbox", { name: "记录标题" }).press("Escape");
    await page.waitForFunction(() => document.activeElement?.matches(".db-list-row"));
    await expectValueFocus(listRow);
  });

  // Use the actual record transfer formats for another source. Even with a colliding
  // item ID its record must never mark or change a destination in this database.
  const foreign = new Map();
  const owner = {};
  startDatabaseItemDrag({ target: owner, currentTarget: owner, dataTransfer: { setData: (type, value) => foreign.set(type, value) } }, { id: "alpha", sourceId: "partners" });
  await page.evaluate((foreignFormats) => {
    const plain = document.createElement("div");
    plain.id = "external-text-drag";
    plain.textContent = "alpha";
    plain.style.cssText = "position:fixed;top:10px;left:10px;z-index:9999;background:white;padding:4px;user-select:text";
    const other = plain.cloneNode(true);
    other.id = "foreign-record-drag"; other.draggable = true; other.style.left = "90px";
    other.addEventListener("dragstart", (event) => { for (const [format, value] of foreignFormats) event.dataTransfer.setData(format, value); });
    document.body.append(plain, other);
    document.addEventListener("dragover", (event) => {
      const target = event.target.closest?.(".db-board-column, .db-calendar-cell");
      if (target && target === window.dropProbe?.target) window.dropProbe.arrivals++;
    }, true);
  }, [...foreign]);
  const drag = async (source, destination, indicated) => {
    await destination.evaluate((target) => {
      const probe = { target, arrivals: 0, marked: false, appearance: null, resting: getComputedStyle(target).backgroundColor };
      probe.observer = new MutationObserver(records => {
        if (records.some(record => record.oldValue === "true")) probe.marked = true;
        if (target.dataset.dragover !== "true") return;
        probe.marked = true;
        const label = target.matches(".db-board-column") ? target.querySelector("header > :first-child") : target.querySelector("header time");
        const style = getComputedStyle(target), cue = getComputedStyle(label, "::after");
        const rgb = cue.borderBlockEndColor.match(/[\d.]+/gu)?.slice(0, 3).map(Number) ?? [];
        probe.appearance = {
          sameFill: style.backgroundColor === probe.resting, outline: style.outlineStyle,
          underline: cue.borderBlockEndStyle === "solid" && parseFloat(cue.borderBlockEndWidth) * devicePixelRatio >= 1,
          neutral: rgb.length === 3 && Math.max(...rgb) - Math.min(...rgb) < 22,
          local: label.getBoundingClientRect().width < target.getBoundingClientRect().width / 2,
        };
      });
      probe.observer.observe(target, { attributes: true, attributeFilter: ["data-dragover"], attributeOldValue: true });
      window.dropProbe = probe;
    });
    await source.dragTo(destination, { targetPosition: { x: 10, y: 12 } });
    const traffic = await page.evaluate(() => {
      const { arrivals, marked, appearance, observer } = window.dropProbe;
      observer.disconnect();
      return { arrivals, marked, appearance };
    });
    assert.ok(traffic.arrivals, "Chromium delivered dragover on the intended destination");
    assert.equal(traffic.marked, indicated);
    if (indicated) assert.deepEqual(traffic.appearance, { sameFill: true, outline: "none", underline: true, neutral: true, local: true });
    assert.equal(await destination.getAttribute("data-dragover"), null);
  };
  const ignoreUnrelated = async (destination) => {
    const editorContent = () => db.evaluate(node => {
      const editor = node.closest(".bn-editor");
      return {
        databaseBlock: node.closest("[data-id]")?.getAttribute("data-id"),
        blockIds: [...new Set([...editor.querySelectorAll("[data-id]")].map(block => block.getAttribute("data-id")))],
      };
    });
    const original = await editorContent();
    assert.equal(original.databaseBlock, "db-surface");
    const plain = page.locator("#external-text-drag");
    const fixtures = page.locator("#external-text-drag, #foreign-record-drag");
    await fixtures.evaluateAll(nodes => nodes.forEach(node => { node.hidden = false; }));
    await plain.dblclick();
    assert.equal(await page.evaluate(() => getSelection().toString()), "alpha");
    await drag(plain, destination, false);
    assert.deepEqual(await editorContent(), original, "dropping unrelated text inside a database must preserve its parent document");
    await drag(page.locator("#foreign-record-drag"), destination, false);
    assert.deepEqual(await editorContent(), original, "dropping a foreign record must preserve the original database block");
    await fixtures.evaluateAll(nodes => nodes.forEach(node => { node.hidden = true; }));
    const file = await destination.evaluate((target) => {
      const data = new DataTransfer(); data.items.add(new File(["fixture"], "fixture.txt", { type: "text/plain" }));
      const event = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: data });
      target.dispatchEvent(event);
      return { file: data.types.includes("Files"), marked: target.hasAttribute("data-dragover") };
    });
    assert.deepEqual(file, { file: true, marked: false });
  };

  await check("the board ignores unrelated drags and marks a real record move", async () => {
    await choose("board");
    const to = db.locator('[data-group-key="done"]');
    await ignoreUnrelated(to);
    assert.equal((await saved()).databaseItems.find((item) => item.id === "alpha").values.status, "doing");
    const from = db.locator('.db-board-card[data-item-id="alpha"]');
    await from.scrollIntoViewIfNeeded();
    // The top row is an open-record button. Begin the native card drag on its
    // non-interactive properties, including on a 150% scaled Windows display.
    const grip = await from.locator(".db-board-properties").evaluate(node => {
      const bounds = node.getBoundingClientRect();
      const x = bounds.left + bounds.width / 2, y = bounds.top + 6;
      const target = document.elementFromPoint(x, y);
      if (!node.contains(target) || target.closest("button, input, a, textarea")) throw new Error("cannot reach the card's draggable surface");
      return { x, y };
    });
    const header = await to.locator("header").first().boundingBox();
    const goalX = header.x + header.width / 2, goalY = header.y + header.height / 2;
    const resting = await to.evaluate(el => getComputedStyle(el).backgroundColor);
    await page.evaluate(() => {
      window.cancelDragTrace = [];
      for (const type of ["pointerdown", "dragstart", "dragover", "dragleave", "drop", "dragend"]) {
        document.addEventListener(type, event => {
          const target = event.target;
          const entry = [event.type, target.classList?.value, target.closest?.(".db-board-column")?.dataset.groupKey, event.clientX, event.clientY, [...event.dataTransfer?.types ?? []]];
          window.cancelDragTrace.push(entry);
          if (window.cancelDragTrace.length > 30) window.cancelDragTrace.shift();
        }, true);
      }
    });
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x + 15, grip.y + 4, { steps: 4 });
    await page.mouse.move(goalX, goalY, { steps: 5 });
    await page.mouse.move(goalX + 1, goalY);
    await page.mouse.move(goalX, goalY);
    try {
      await page.waitForFunction(() => document.querySelector('.db-board-column[data-group-key="done"]')?.dataset.dragover === "true",
        null, { timeout: 4000 });
    } catch (error) {
      throw new Error("Record drag did not mark the destination. " + JSON.stringify(await page.evaluate(() => window.cancelDragTrace)), { cause: error });
    }
    const painted = await to.evaluate(el => ({ fill: getComputedStyle(el).backgroundColor, outline: getComputedStyle(el).outlineStyle }));
    await screenshot("active-record-drag");
    assert.deepEqual(painted, { fill: resting, outline: "none" }, "a legitimate drag must identify its destination without framing or tinting the entire column");
    await page.keyboard.press("Escape"); await page.mouse.up();
    assert.equal(await to.getAttribute("data-dragover"), null);
    assert.equal((await saved()).databaseItems.find((item) => item.id === "alpha").values.status, "doing");
    await drag(from, to, true);
    await persisted((s) => s.databaseItems.find((item) => item.id === "alpha").values.status === "done");
  });

  await check("the calendar ignores unrelated drags, marks a real date change and keeps keyboard focus on the day number", async () => {
    await choose("calendar");
    const to = db.locator('[data-date="2026-09-23"]');
    await page.keyboard.press("Tab"); await to.focus();
    assert.equal((await focusStyle(to)).outline, "none");
    assert.equal(await to.locator("time").evaluate((el) => getComputedStyle(el).outlineStyle), "solid");
    await ignoreUnrelated(to);
    assert.equal((await saved()).databaseItems.find((item) => item.id === "alpha").values.date.start, "2026-09-18");
    await drag(db.locator(".db-calendar-chip").filter({ hasText: "Alpha 项目" }), to, true);
    await persisted((s) => s.databaseItems.find((item) => item.id === "alpha").values.date.start === "2026-09-23");
  });
}, { workspace: seed });
