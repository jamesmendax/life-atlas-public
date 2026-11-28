import { browserScenario, shootBothModes } from './harness.mjs';
import { coreParityWorkspace } from '../fixtures/core-parity-workspace.mjs';

const run = process.env.V9_DB_CONTEXT_RUN || 'initial01';
if (!/^[a-z0-9-]+$/.test(run)) throw new Error('invalid context run label');
const workspace = coreParityWorkspace();
workspace.ui.preferences = { theme: 'system', style: 'mobai' };
workspace.databaseViews = workspace.databaseViews.filter(view => view.sourceId !== 'projects' || ['view-table', 'view-board', 'view-calendar'].includes(view.id));
workspace.pages.find(page => page.id === 'database-page').databaseViewId = 'view-board';
workspace.databaseViews.find(view => view.id === 'view-board').visiblePropertyIds = [];
workspace.databaseViews.find(view => view.id === 'view-calendar').config = { calendar: { datePropertyId: 'date', mode: 'month', startOfWeek: 0, showWeekends: true, anchorDate: '2026-11-01' } };

await browserScenario('database-context-create-v9', async ({ page, check, assert, saved, persisted, screenshot }) => {
  await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="database-page"]').click();
  const db = page.locator('section.database-view[data-source-id="projects"]');
  await db.waitFor();
  let boardRecord, calendarRecord;

  await check('group inline creation inherits status and commits one real record page', async () => {
    const before = await saved();
    const group = db.locator('.db-board-column[data-group-key="doing"]');
    await group.getByRole('button', { name: '新建页面', exact: true }).click();
    const title = group.getByRole('textbox', { name: '页面名称', exact: true });
    await title.fill('V9 UI 看板 · 进行中');
    await title.press('Enter');
    const after = await persisted(value => value.databaseItems.some(item => item.values.title === 'V9 UI 看板 · 进行中'));
    const created = after.databaseItems.filter(item => !before.databaseItems.some(old => old.id === item.id));
    assert.equal(created.length, 2);
    boardRecord = created.find(item => item.values.title === 'V9 UI 看板 · 进行中');
    const nextRecord = created.find(item => item.id !== boardRecord.id);
    assert.equal(boardRecord.sourceId, 'projects');
    assert.equal(boardRecord.values.status, 'doing');
    const pages = after.pages.filter(candidate => !before.pages.some(old => old.id === candidate.id));
    assert.equal(pages.length, 2);
    const boardPage = pages.find(page => page.id === boardRecord.pageId);
    assert.equal(boardPage.title, 'V9 UI 看板 · 进行中');
    assert.ok(Array.isArray(boardPage.content));
    assert.equal(nextRecord.values.status, 'doing');
    assert.ok(pages.some(page => page.id === nextRecord.pageId));
    assert.equal(await page.getByRole('dialog', { name: '记录预览', exact: true }).count(), 0);
    assert.equal(await title.isVisible(), true);
    const committed = await saved();
    await title.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.db-board-column[data-group-key="doing"] input[aria-label="页面名称"]'));
    const canceled = await persisted(value => Boolean(value.pages.find(page => page.id === nextRecord.pageId)?.trashedAt));
    assert.deepEqual(canceled.databaseItems, committed.databaseItems);
    assert.ok(canceled.pages.find(page => page.id === nextRecord.pageId)?.trashedAt);
    assert.deepEqual(canceled.pages.find(page => page.id === boardRecord.pageId), committed.pages.find(page => page.id === boardRecord.pageId));
    assert.equal(await group.getByRole('button', { name: '新建页面', exact: true }).evaluate(element => element === document.activeElement), true);
  });

  await check('new board card opens the shared editable page and title changes propagate', async () => {
    await db.getByRole('button', { name: 'V9 UI 看板 · 进行中', exact: true }).click();
    const peek = page.getByRole('dialog', { name: '记录预览', exact: true });
    await peek.waitFor();
    await peek.getByRole('textbox', { name: '记录标题', exact: true }).fill('V9 UI 看板 · 正文页');
    await persisted(value => value.pages.find(candidate => candidate.id === boardRecord.pageId)?.title === 'V9 UI 看板 · 正文页');
    const after = await saved();
    assert.equal(after.databaseItems.find(item => item.id === boardRecord.id).values.title, 'V9 UI 看板 · 正文页');
    assert.equal(after.databaseItems.filter(item => item.pageId === boardRecord.pageId).length, 1);
    await peek.getByRole('button', { name: '关闭预览', exact: true }).click();
  });

  await check('calendar date plus creates a dated record and opens its actual page', async () => {
    await db.locator('[role="tab"][data-view-id="view-calendar"]').click();
    const before = await saved();
    const cell = db.locator('.db-calendar-cell[data-date="2026-11-11"]');
    await cell.getByRole('button', { name: /新建页面/ }).click();
    const peek = page.getByRole('dialog', { name: '记录预览', exact: true });
    await peek.waitFor();
    const title = peek.getByRole('textbox', { name: '记录标题', exact: true });
    assert.equal(await title.evaluate(element => element === document.activeElement), true);
    const after = await persisted(value => value.databaseItems.length === before.databaseItems.length + 1);
    const created = after.databaseItems.filter(item => !before.databaseItems.some(old => old.id === item.id));
    assert.equal(created.length, 1);
    calendarRecord = created[0];
    assert.equal(calendarRecord.sourceId, 'projects');
    assert.equal(calendarRecord.values.date.start, '2026-11-11');
    assert.equal(calendarRecord.values.date.includeTime, false);
    assert.equal(calendarRecord.values.status, 'todo');
    assert.equal(after.pages.filter(candidate => !before.pages.some(old => old.id === candidate.id)).length, 1);
    assert.ok(after.pages.some(candidate => candidate.id === calendarRecord.pageId));
    await title.fill('V9 UI 日历 · 2026-11-11');
    await persisted(value => value.databaseItems.find(item => item.id === calendarRecord.id).values.title === 'V9 UI 日历 · 2026-11-11');
    await peek.getByRole('button', { name: '关闭预览', exact: true }).click();
    await cell.getByRole('button', { name: 'V9 UI 日历 · 2026-11-11', exact: true }).waitFor();
  });

  await check('pointer cancellation does not move a record or silently change its date', async () => {
    const before = await saved();
    const handle = db.getByRole('button', { name: '拖动 V9 UI 日历 · 2026-11-11 到其他日期', exact: true });
    await handle.dispatchEvent('pointerdown', { pointerId: 4, button: 0, clientX: 600, clientY: 450 });
    await db.locator('.db-calendar-cell[data-date="2026-11-12"]').evaluate(cell => {
      const rect = cell.getBoundingClientRect();
      window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 4, clientX: rect.left + 12, clientY: rect.top + 12 }));
    });
    const after = await saved();
    assert.deepEqual(after.databaseItems, before.databaseItems);
    assert.deepEqual(after.pages, before.pages);
  });

  await check('context-created page identity and values survive reload', async () => {
    const before = await saved();
    await page.reload();
    await db.waitFor();
    const after = await saved();
    for (const record of [boardRecord, calendarRecord]) {
      assert.deepEqual(after.databaseItems.find(item => item.id === record.id), before.databaseItems.find(item => item.id === record.id));
      assert.deepEqual(after.pages.find(candidate => candidate.id === record.pageId), before.pages.find(candidate => candidate.id === record.pageId));
    }
    assert.equal(after.databaseViews.filter(view => view.sourceId === 'projects').length, 3);
  });

  await check('calendar and board retain their controls in light dark and narrow layouts', async () => {
    await shootBothModes(page, screenshot, `v9-calendar-${run}`, { keepVisible: '.db-calendar-grid' });
    await db.locator('[role="tab"][data-view-id="view-board"]').click();
    await shootBothModes(page, screenshot, `v9-board-${run}`, { keepVisible: '.db-board-view' });
    await page.setViewportSize({ width: 760, height: 850 });
    await db.getByRole('button', { name: '视图设置', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '视图设置', exact: true });
    const bounds = await panel.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight };
    });
    assert.ok(bounds.left >= 0 && bounds.right <= bounds.width && bounds.bottom <= bounds.height, JSON.stringify(bounds));
    await page.keyboard.press('Escape');
    assert.equal(await panel.count(), 0);
  });
}, { workspace, now: '2026-11-10T12:00:00.000Z' });
