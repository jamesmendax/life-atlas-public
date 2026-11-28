import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { chooseSavedView, openViewSettingsSection, setViewSettings, viewSettingsPanel } from "./database-navigation.mjs";

const workspace = coreParityWorkspace();
workspace.pages.find(page => page.id === "database-page").content = [{ id:"work-surfaces-db", type:"databaseView", props:{
  sourceId:"projects", viewId:"view-table", viewIdsJson:JSON.stringify(workspace.databaseViews.filter(view=>view.sourceId==="projects").map(view=>view.id))
} }];
await browserScenario("phase2-work-surfaces", async ({ page, check, screenshot, saved, persisted, assert }) => {
  const db = page.locator('section.database-view[data-source-id="projects"]');
  const choose = async (type) => {
    await chooseSavedView(db, `view-${type}`);
    await page.waitForFunction((type) => document.querySelector('section.database-view[data-source-id="projects"]')?.getAttribute("data-view-type") === type, type);
  };
  const settings = (open) => setViewSettings(db, open);
  const panel = viewSettingsPanel(db);

  await check("Calendar is a real 7-column month grid and dragging preserves date duration through reload", async () => {
    await db.waitFor();
    await choose("calendar");
    assert.equal(await db.locator('.db-calendar-grid[role="grid"] .db-calendar-cell').count(), 35);
    assert.equal(await db.locator('.db-calendar-cell').first().getAttribute('data-date'), '2026-08-31');
    assert.equal(await db.locator('.db-calendar-cell').last().getAttribute('data-date'), '2026-10-04');
    const before = await saved();
    const alphaBefore = before.databaseItems.find((item)=>item.id==="alpha").values.date;
    const handle = db.getByRole("button",{name:"拖动 Alpha 项目 到其他日期",exact:true});
    const target = db.locator('.db-calendar-cell[data-date="2026-09-22"]');
    const handleBox = await handle.boundingBox(); const targetBox = await target.boundingBox();
    assert.ok(handleBox && targetBox);
    await page.mouse.move(handleBox.x + handleBox.width/2, handleBox.y + handleBox.height/2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width/2, targetBox.y + targetBox.height/2, {steps:8});
    await page.mouse.up();
    const state = await persisted((value) => value.databaseItems.find((item)=>item.id==="alpha").values.date.start === "2026-09-22");
    const alpha = state.databaseItems.find((item)=>item.id==="alpha");
    assert.equal(alpha.pageId, "alpha-page");
    assert.equal(alpha.values.date.end, "2026-09-25");
    assert.equal((Date.parse(alpha.values.date.end) - Date.parse(alpha.values.date.start)), (Date.parse(alphaBefore.end) - Date.parse(alphaBefore.start)));
    const oldAnchor = state.databaseViews.find((view)=>view.id==="view-calendar").config.calendar.anchorDate;
    await db.getByRole("button",{name:"下一周期",exact:true}).click();
    const navigated = await persisted((value)=>value.databaseViews.find((view)=>view.id==="view-calendar").config.calendar.anchorDate !== oldAnchor);
    assert.ok(navigated.databaseViews.find((view)=>view.id==="view-calendar").config.calendar.anchorDate);
    await page.reload({waitUntil:"domcontentloaded"}); await db.waitFor();
    assert.equal((await saved()).databaseItems.find((item)=>item.id==="alpha").values.date.start, "2026-09-22");
    await screenshot("calendar");
  });

  await check("Calendar exposes a non-drag date editing path for keyboard/touch use", async () => {
    await choose("calendar");
    await db.getByRole("button",{name:"上一周期",exact:true}).click();
    const betaDate = db.getByLabel("移动 Beta 项目 日期", { exact:true });
    await betaDate.press("Enter");
    await db.getByRole("button", { name:"2026-09-23", exact:true }).press("Enter");
    const state = await persisted((value)=>value.databaseItems.find((item)=>item.id==="beta").values.date.start === "2026-09-23");
    assert.equal(state.databaseItems.find((item)=>item.id==="beta").values.date.end, "2026-09-23");
    await db.locator('.db-calendar-cell[data-date="2026-09-23"]').focus();
    assert.equal(await db.locator('.db-calendar-cell[data-date="2026-09-23"]').getAttribute("tabindex"), "0");
  });

  await check("Timeline derives bar geometry from dates, supports scale, drag shift and pointer resize", async () => {
    await choose("timeline");
    const alphaBar = db.locator('.db-timeline-bar[data-item-id="alpha"]');
    await alphaBar.waitFor();
    const styleBefore = await alphaBar.getAttribute("style");
    assert.match(styleBefore, /left:/); assert.match(styleBefore, /width:/);
    await db.getByLabel("时间线比例",{exact:true}).selectOption("month");
    await persisted((value)=>value.databaseViews.find((view)=>view.id==="view-timeline").config.timeline.scale === "month");

    const startBefore = (await saved()).databaseItems.find((item)=>item.id==="alpha").values.date.start;
    const dragHandle = db.getByRole("button",{name:"拖动 Alpha 项目 时间",exact:true});
    const dragBox = await dragHandle.boundingBox(); const targetTrack = await alphaBar.locator("..").boundingBox();
    assert.ok(dragBox && targetTrack);
    await page.mouse.move(dragBox.x + dragBox.width/2, dragBox.y + dragBox.height/2);
    await page.mouse.down();
    await page.mouse.move(targetTrack.x + targetTrack.width*0.86, targetTrack.y + targetTrack.height/2, {steps:8});
    await page.mouse.up();
    const shifted = await persisted((value)=>value.databaseItems.find((item)=>item.id==="alpha").values.date.start !== startBefore);
    const shiftedDate = shifted.databaseItems.find((item)=>item.id==="alpha").values.date;
    const durationBeforeResize = Date.parse(shiftedDate.end) - Date.parse(shiftedDate.start);

    const handle = db.getByRole("button",{name:"调整 Alpha 项目 结束日期", exact:true});
    const box = await handle.boundingBox(); assert.ok(box);
    await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width/2 + 90, box.y + box.height/2, { steps:5 });
    await page.mouse.up();
    const resized = await persisted((value)=>{
      const date=value.databaseItems.find((item)=>item.id==="alpha").values.date;
      return Date.parse(date.end)-Date.parse(date.start) !== durationBeforeResize;
    });
    assert.equal(resized.databaseItems.find((item)=>item.id==="alpha").pageId, "alpha-page");
    await page.reload({waitUntil:"domcontentloaded"}); await db.waitFor();
    assert.equal(await db.getAttribute("data-view-type"), "timeline");
    assert.equal(await db.getByLabel("时间线比例",{exact:true}).inputValue(), "month");
    await screenshot("timeline");
  });

  await check("Board drag changes the grouped property without duplicating the item, with keyboard menu fallback", async () => {
    await choose("board");
    const before = await saved();
    const betaHandle = db.getByRole("button",{name:"拖动 Beta 项目 到其他分组",exact:true});
    const doneColumn = db.locator('.db-board-column[data-group-key="done"]');
    const betaBox = await betaHandle.boundingBox(); const doneBox = await doneColumn.boundingBox();
    assert.ok(betaBox && doneBox);
    await page.mouse.move(betaBox.x + betaBox.width/2, betaBox.y + betaBox.height/2);
    await page.mouse.down();
    await page.mouse.move(doneBox.x + doneBox.width/2, doneBox.y + 50, {steps:8});
    await page.mouse.up();
    const moved = await persisted((value)=>value.databaseItems.find((item)=>item.id==="beta").values.status === "done");
    assert.equal(moved.databaseItems.length, before.databaseItems.length);
    assert.equal(moved.databaseItems.find((item)=>item.id==="beta").pageId, "beta-page");
    await db.getByLabel("Beta 项目 记录操作",{exact:true}).press("Enter");
    const fallback = db.getByLabel("移动 Beta 项目 到分组",{exact:true});
    await fallback.selectOption("doing");
    await persisted((value)=>value.databaseItems.find((item)=>item.id==="beta").values.status === "doing");
    await page.reload({waitUntil:"domcontentloaded"}); await db.waitFor();
    assert.equal((await saved()).databaseItems.find((item)=>item.id==="beta").values.status, "doing");
    await screenshot("board");
  });

  await check("Gallery preview source, card size, image fit and visible properties persist independently", async () => {
    await choose("gallery"); await openViewSettingsSection(db, "布局");
    await panel.getByLabel("画廊预览",{exact:true}).click();
    await panel.getByRole("menu", { name: "画廊预览" }).getByRole("menuitemradio", { name: "页面内容" }).click();
    await panel.getByLabel("画廊卡片大小",{exact:true}).click();
    await panel.getByRole("menu", { name: "画廊卡片大小" }).getByRole("menuitemradio", { name: "大" }).click();
    const fit = panel.getByRole("switch", { name: "适应媒体" });
    if (await fit.getAttribute("aria-checked") !== "true") await fit.click();
    await persisted((value)=>{
      const cfg=value.databaseViews.find((view)=>view.id==="view-gallery").config.gallery;
      return cfg.preview.kind==="page-content" && cfg.cardSize==="large" && cfg.imageFit==="contain";
    });
    assert.equal(await db.locator(".db-gallery-view").getAttribute("data-card-size"), "large");
    assert.match(await db.locator(".db-gallery-content").first().innerText(), /文档正文/);

    await panel.getByLabel("画廊预览",{exact:true}).click();
    await panel.getByRole("menu", { name: "画廊预览" }).getByRole("menuitemradio", { name: "附件属性" }).click();
    await panel.getByLabel("画廊附件属性",{exact:true}).click();
    await panel.getByRole("menu", { name: "画廊附件属性" }).getByRole("menuitemradio", { name: "附件" }).click();
    await persisted((value)=>value.databaseViews.find((view)=>view.id==="view-gallery").config.gallery.preview.propertyId==="files");
    assert.match(await db.locator(".db-gallery-file").first().innerText(), /设计说明\.pdf/);
    await settings(false); await page.reload({waitUntil:"domcontentloaded"}); await db.waitFor();
    assert.equal(await db.getAttribute("data-view-type"), "gallery");
    assert.equal(await db.locator(".db-gallery-view").getAttribute("data-card-size"), "large");
    await screenshot("gallery");
  });
}, {workspace});
