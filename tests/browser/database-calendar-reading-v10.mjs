import { mkdirSync } from 'node:fs';
import { browserScenario } from './harness.mjs';
import { coreParityWorkspace } from '../fixtures/core-parity-workspace.mjs';
import { openViewSettingsSection, setViewSettings } from './database-navigation.mjs';

const run = process.env.V10_CALENDAR_READING_RUN || 'run01';
if (!/^[a-z0-9-]+$/.test(run)) throw new Error('invalid run label');
const evidence = `.qa/LOCAL-NOTION-001/v10-calendar-peek14/calendar/${run}`;
mkdirSync(evidence, { recursive: true });
const workspace = coreParityWorkspace();
workspace.ui.preferences = { style: 'mobai', theme: 'system' };
workspace.ui.selectedPageId = 'database-page';
workspace.pages.find(p => p.id === 'database-page').databaseViewId = 'view-calendar';
workspace.databaseViews.find(v => v.id === 'view-calendar').config = { calendar: { anchorDate: '2026-11-11', startOfWeek: 0, showWeekends: true, mode: 'month' } };
workspace.databaseItems.find(i => i.id === 'alpha').values.date = { start: '2026-11-11', end: null, includeTime: false, timeZone: null };
workspace.databaseItems.find(i => i.id === 'beta').values.date = null;
workspace.databaseItems.find(i => i.id === 'gamma').values.date = { start: '2026-11-13', end: null, includeTime: false, timeZone: null };
workspace.databaseItems.find(i => i.id === 'gamma').values.title = '';
workspace.pages.find(p => p.id === 'gamma-page').title = '';
workspace.pages.find(p => p.id === 'gamma-page').icon = 'icon:file-description';
workspace.pages.find(p => p.id === 'alpha-page').icon = 'icon:star';
const lockedPage = structuredClone(workspace.pages.find(p => p.id === 'beta-page'));
lockedPage.id = 'calendar-locked-page'; lockedPage.title = '只读未安排'; lockedPage.settings.locked = true;
const lockedItem = structuredClone(workspace.databaseItems.find(i => i.id === 'beta'));
lockedItem.id = 'calendar-locked-item'; lockedItem.pageId = lockedPage.id; lockedItem.values.title = lockedPage.title;
workspace.pages.push(lockedPage); workspace.databaseItems.push(lockedItem);
const dragPage = structuredClone(workspace.pages.find(p => p.id === 'beta-page'));
dragPage.id = 'calendar-drag-page'; dragPage.title = '拖拽记录';
const dragItem = structuredClone(workspace.databaseItems.find(i => i.id === 'beta'));
dragItem.id = 'calendar-drag-item'; dragItem.pageId = dragPage.id; dragItem.values.title = dragPage.title;
workspace.pages.push(dragPage); workspace.databaseItems.push(dragItem);

await browserScenario('database-calendar-reading-v10', async ({ page, check, assert, saved, persisted }) => {
  await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="database-page"]').click();
  const db = page.locator('section.database-view[data-source-id="projects"]');
  const grid = db.getByRole('grid', { name: '数据库日历' });
  const trigger = db.getByRole('button', { name: /^未安排 \(/ });
  const panel = page.getByRole('dialog', { name: '未安排的记录', exact: true });
  const peek = page.getByRole('dialog', { name: '记录预览', exact: true });
  const snap = label => page.screenshot({ path: `${evidence}/${label}.png`, animations: 'disabled' });
  await grid.waitFor();

  await check('Sunday month covers 35 cells and records show real icons without changing empty title', async () => {
    const before = await saved();
    assert.equal(await grid.getByRole('gridcell').count(), 35);
    assert.equal(await grid.getByRole('gridcell').first().getAttribute('data-date'), '2026-11-01');
    assert.equal(await grid.getByRole('gridcell').last().getAttribute('data-date'), '2026-12-05');
    assert.equal(await grid.locator('[data-date="2026-11-01"]').getAttribute('data-weekend'), 'true');
    assert.equal(await grid.locator('[data-date="2026-11-02"]').getAttribute('data-weekend'), 'false');
    assert.match(await grid.locator('[data-date="2026-11-01"] header').innerText(), /11月/);
    assert.match(await grid.locator('[data-date="2026-12-01"] header').innerText(), /12月/);
    assert.equal(await grid.locator('[data-date="2026-11-11"]').getAttribute('aria-current'), 'date');
    const alpha = grid.getByRole('button', { name: 'Alpha 项目', exact: true });
    assert.equal(await alpha.locator('.db-calendar-record-glyph use').getAttribute('href'), '/icons/tabler-picker-sprite.svg#ti-star');
    const empty = grid.getByRole('button', { name: '无标题', exact: true });
    assert.equal(await empty.locator('.db-calendar-record-glyph use').getAttribute('href'), '/icons/tabler-picker-sprite.svg#ti-file-description');
    assert.equal((await saved()).databaseItems.find(i => i.id === 'gamma').values.title, '');
    assert.equal((await saved()).pages.find(p => p.id === 'gamma-page').title, '');
    assert.deepEqual((await saved()).databaseItems, before.databaseItems);
    await snap('sunday-month');
  });

  await check('unscheduled header control uses filtered rows and keeps nested Escape layers', async () => {
    assert.equal(await db.locator('.db-v9-actions .db-unscheduled-trigger').count(), 1);
    assert.equal(await db.locator('.db-calendar-toolbar .db-unscheduled-trigger').count(), 0);
    assert.equal(await trigger.getAttribute('aria-label'), '未安排 (3)');
    await trigger.focus(); await page.keyboard.press('Enter'); await panel.waitFor();
    assert.equal(await panel.getByRole('button', { name: '打开 Beta 项目', exact: true }).count(), 1);
    const beforeSearch = await saved();
    const search = panel.getByRole('searchbox', { name: '搜索未安排的记录', exact: true });
    await search.fill('beta');
    assert.equal(await panel.getByRole('button', { name: '打开 Beta 项目', exact: true }).count(), 1);
    assert.equal(await panel.getByRole('button', { name: '打开 拖拽记录', exact: true }).count(), 0);
    assert.equal(await trigger.getAttribute('aria-label'), '未安排 (3)');
    assert.deepEqual((await saved()).databaseItems, beforeSearch.databaseItems);
    assert.deepEqual((await saved()).pages, beforeSearch.pages);
    await search.fill('');
    const lockedDate = panel.getByLabel('设置 只读未安排 日期');
    assert.equal(await lockedDate.getAttribute('aria-disabled'), 'true');
    assert.equal(await lockedDate.evaluate(el => el.closest('.db-unscheduled-row').getAttribute('draggable')), 'false');
    await lockedDate.focus(); await page.keyboard.press('Enter');
    assert.equal(await panel.getByLabel('设置 只读未安排 开始').count(), 0);
    await panel.getByLabel('设置 Beta 项目 日期').click();
    const start = panel.getByLabel('设置 Beta 项目 开始'); await start.waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await start.count(), 0);
    assert.equal(await panel.isVisible(), true);
    assert.equal(await panel.getByLabel('设置 Beta 项目 日期').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.classList.contains('db-unscheduled-trigger'));
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
    await db.getByRole('button', { name: '搜索此视图', exact: true }).click();
    await db.getByLabel('在此视图中搜索').fill('Beta 项目');
    await page.waitForFunction(() => document.querySelector('section.database-view[data-source-id="projects"] .db-unscheduled-trigger')?.getAttribute('aria-label') === '未安排 (1)');
    assert.equal(await trigger.getAttribute('aria-label'), '未安排 (1)');
    await trigger.click(); await panel.waitFor();
    assert.equal(await panel.getByRole('button', { name: '打开 Beta 项目', exact: true }).count(), 1);
    assert.equal(await panel.getByRole('button', { name: '打开 只读未安排', exact: true }).count(), 0);
    await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' });
    await db.getByLabel('在此视图中搜索').fill('');
    await db.getByLabel('在此视图中搜索').press('Escape');
    await page.waitForFunction(() => document.querySelector('section.database-view[data-source-id="projects"] .db-unscheduled-trigger')?.getAttribute('aria-label') === '未安排 (3)');
    assert.equal(await trigger.getAttribute('aria-label'), '未安排 (3)');
  });

  await check('narrow dark view keeps the popover within the viewport', async () => {
    await page.setViewportSize({ width: 520, height: 740 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await trigger.click(); await panel.waitFor();
    const bounds = await panel.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 520 && bounds.y + bounds.height <= 740);
    await panel.getByRole('searchbox', { name: '搜索未安排的记录' }).fill('Beta');
    assert.equal(await panel.getByRole('button', { name: '打开 Beta 项目', exact: true }).count(), 1);
    await snap('narrow-dark-unscheduled');
    await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.setViewportSize({ width: 1440, height: 1040 });
  });

  await check('opening an unscheduled record closes the popup and returns to its trigger', async () => {
    await trigger.click(); await panel.waitFor();
    await panel.getByRole('button', { name: '打开 Beta 项目', exact: true }).click();
    await peek.waitFor();
    assert.equal(await panel.count(), 0);
    assert.equal(await peek.getByRole('textbox', { name: '记录标题' }).inputValue(), 'Beta 项目');
    await peek.getByRole('button', { name: '关闭预览', exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.classList.contains('db-unscheduled-trigger'));
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
    await trigger.click(); await panel.waitFor();
    await panel.getByRole('button', { name: '打开 只读未安排', exact: true }).click();
    await peek.waitFor();
    assert.equal(await peek.getByRole('textbox', { name: '记录标题' }).inputValue(), '只读未安排');
    await peek.getByRole('button', { name: '关闭预览', exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.classList.contains('db-unscheduled-trigger'));
  });

  await check('date assignment persists for the chosen unscheduled item only', async () => {
    const before = await saved();
    await trigger.click(); await panel.waitFor();
    await panel.getByLabel('设置 Beta 项目 日期').click();
    await panel.getByRole('button', { name: '2026-11-12', exact: true }).click();
    const after = await persisted(w => w.databaseItems.find(i => i.id === 'beta').values.date?.start === '2026-11-12');
    assert.equal(await trigger.getAttribute('aria-label'), '未安排 (2)');
    assert.deepEqual(after.databaseItems.filter(i => i.id !== 'beta'), before.databaseItems.filter(i => i.id !== 'beta'));
    assert.equal(after.databaseItems.length, before.databaseItems.length);
    assert.equal(after.pages.length, before.pages.length);
    assert.equal(after.databaseItems.find(i => i.id === 'beta').pageId, 'beta-page');
    assert.equal(await grid.locator('[data-date="2026-11-12"]').getByRole('button', { name: 'Beta 项目', exact: true }).count(), 1);
    await page.waitForFunction(() => document.activeElement?.matches('.db-calendar-unscheduled-panel .db-unscheduled-search'));
    assert.equal(await panel.getByRole('searchbox', { name: '搜索未安排的记录' }).evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' });
  });

  await check('dragging an unscheduled row assigns its date without creating a record', async () => {
    const before = await saved();
    await trigger.click(); await panel.waitFor();
    const row = panel.locator('.db-unscheduled-row').filter({ hasText: '拖拽记录' });
    assert.equal(await row.getAttribute('draggable'), 'true');
    await row.dragTo(grid.locator('[data-date="2026-11-14"]'));
    const after = await persisted(w => w.databaseItems.find(i => i.id === 'calendar-drag-item').values.date?.start === '2026-11-14');
    assert.equal(after.databaseItems.length, before.databaseItems.length);
    assert.equal(after.pages.length, before.pages.length);
    assert.equal(after.databaseItems.find(i => i.id === 'calendar-drag-item').pageId, 'calendar-drag-page');
    assert.equal(await trigger.getAttribute('aria-label'), '未安排 (1)');
    assert.equal(await grid.locator('[data-date="2026-11-14"]').getByRole('button', { name: '拖拽记录', exact: true }).count(), 1);
    if (await panel.isVisible()) { await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' }); }
  });

  await check('Monday month spans six weeks and week mode spans one', async () => {
    const settings = await openViewSettingsSection(db, '布局');
    await settings.getByLabel('日历每周开始日').selectOption('1');
    assert.equal(await grid.getByRole('gridcell').count(), 42);
    assert.equal(await grid.getByRole('gridcell').first().getAttribute('data-date'), '2026-10-26');
    assert.equal(await grid.getByRole('gridcell').last().getAttribute('data-date'), '2026-12-06');
    await settings.getByLabel('日历模式').selectOption('week');
    assert.equal(await grid.getByRole('gridcell').count(), 7);
    assert.equal(await grid.getByRole('gridcell').first().getAttribute('data-date'), '2026-11-09');
    await setViewSettings(db, false);
    await snap('monday-week');
  });

  await check('keyboard date cell creates exactly one record with the selected date', async () => {
    const before = await saved();
    const cell = grid.getByRole('gridcell', { name: '2026-11-15', exact: true });
    await cell.focus(); await page.keyboard.press('Enter'); await peek.waitFor();
    const after = await persisted(w => w.databaseItems.length === before.databaseItems.length + 1);
    const created = after.databaseItems.filter(i => !before.databaseItems.some(old => old.id === i.id));
    assert.equal(created.length, 1); assert.equal(created[0].values.date.start, '2026-11-15');
    assert.equal(after.pages.filter(p => !before.pages.some(old => old.id === p.id)).length, 1);
    await peek.getByRole('button', { name: '关闭预览', exact: true }).click();
  });
}, { workspace, now: '2026-11-11T12:00:00.000Z' });
