import { writeFileSync, mkdirSync } from 'node:fs';
import { browserScenario } from './harness.mjs';
import { coreParityWorkspace } from '../fixtures/core-parity-workspace.mjs';

const run = process.env.V10_FOCUS_RUN || 'local';
if (!/^[a-z0-9-]+$/.test(run)) throw new Error('invalid run label');
const dir = '.qa/LOCAL-NOTION-001/v10-record-focus';
mkdirSync(dir, { recursive: true });
const workspace = coreParityWorkspace();
const host = workspace.pages.find(page => page.id === 'editor-page');
host.content = [
  ...Array.from({ length: 12 }, (_, i) => ({ id: `focus-before-${i}`, type: 'paragraph', content: `数据库前的编辑位置 ${i}` })),
  { id: 'focus-db', type: 'databaseView', props: { sourceId: 'projects', viewId: 'view-table' } },
  { id: 'focus-after', type: 'paragraph', content: '数据库后的正文' },
];
workspace.ui.selectedPageId = host.id;
workspace.ui.preferences = { style: 'mobai', theme: 'system' };
workspace.databaseViews = workspace.databaseViews.filter(view => view.sourceId !== 'projects' || ['view-table', 'view-board', 'view-calendar'].includes(view.id));
workspace.databaseViews.find(view => view.id === 'view-calendar').config = { calendar: { anchorDate: '2026-09-01', startOfWeek: 1, showWeekends: true } };
workspace.databaseViews.find(view => view.id === 'view-board').visiblePropertyIds = [];

await browserScenario(`LOCAL-NOTION-001/v10-record-focus/${run}`, async ({ page, check, assert, saved, persisted }) => {
  await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="editor-page"]').click();
  const db = page.locator('section.database-view.is-inline[data-source-id="projects"]');
  const peek = page.getByRole('dialog', { name: '记录预览', exact: true });
  const scroller = page.locator('.workspace-scroll');
  await db.waitFor();
  await page.evaluate(() => {
    window.__focusTrace = [];
    const describe = element => element && ({ tag: element.tagName, class: element.className, label: element.getAttribute?.('aria-label'), item: element.closest?.('[data-item-id]')?.dataset.itemId, block: element.closest?.('[data-id]')?.dataset.id, connected: element.isConnected });
    window.__focusSnapshot = label => window.__focusTrace.push({ label, active: describe(document.activeElement), scroll: document.querySelector('.workspace-scroll')?.scrollTop });
    document.addEventListener('focusin', event => window.__focusTrace.push({ label: 'focusin', active: describe(event.target), scroll: document.querySelector('.workspace-scroll')?.scrollTop }), true);
    const active = Object.getOwnPropertyDescriptor(Document.prototype, 'activeElement');
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (...args) {
      const stack = new Error().stack;
      if (stack?.includes('RecordPeek.jsx')) window.__focusTrace.push({ label: 'RecordPeek-focus', active: describe(this), stack: stack.split('\n').slice(1, 4) });
      return focus.apply(this, args);
    };
    Object.defineProperty(document, 'activeElement', { configurable: true, get() {
      const element = active.get.call(document);
      const stack = new Error().stack;
      if (stack?.includes('RecordPeek.jsx')) window.__focusTrace.push({ label: 'RecordPeek-read', active: describe(element), stack: stack.split('\n').slice(1, 4) });
      return element;
    } });
  });
  await check('table explicit open after body editing restores its exact opener', async () => {
    const opener = db.locator('tr[data-item-id="alpha"] .db-title-open');
    await db.locator('tr[data-item-id="alpha"] .db-title-control').hover();
    const originalOpener = await opener.elementHandle();
    const before = await saved();
    const beforeScroll = await scroller.evaluate(element => element.scrollTop);
    await page.evaluate(() => window.__focusSnapshot('before-click'));
    await opener.click();
    await peek.waitFor();
    await page.evaluate(() => window.__focusSnapshot('after-open'));
    const body = peek.locator('.bn-editor[contenteditable="true"]');
    await body.click(); await body.press('End'); await body.pressSequentially(' focus-v10');
    await persisted(value => JSON.stringify(value.pages.find(entry => entry.id === 'alpha-page').content).includes('focus-v10'));
    await page.evaluate(() => window.__focusSnapshot('after-body'));
    const openerState = await originalOpener.evaluate(element => ({ connected: element.isConnected, same: element === document.querySelector('tr[data-item-id="alpha"] .db-title-open') }));
    await peek.getByRole('button', { name: '关闭预览', exact: true }).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => window.__focusSnapshot('after-close'));
    const restored = await opener.evaluate(element => element === document.activeElement);
    await page.keyboard.press('Tab');
    await page.evaluate(() => window.__focusSnapshot('first-tab'));
    const after = await saved();
    const trace = await page.evaluate(() => window.__focusTrace);
    writeFileSync(`${dir}/${run}-trace.json`, JSON.stringify({ beforeScroll, afterScroll: await scroller.evaluate(element => element.scrollTop), openerState, item: after.databaseItems.find(item => item.id === 'alpha'), pageId: after.pages.find(entry => entry.id === 'alpha-page').id, idsBefore: before.databaseItems.map(item => [item.id, item.pageId]), idsAfter: after.databaseItems.map(item => [item.id, item.pageId]), restored, trace }, null, 2));
    assert.equal(restored, true, 'closing returns focus to the exact open button');
    assert.ok(Math.abs(await scroller.evaluate(element => element.scrollTop) - beforeScroll) <= 1);
    assert.deepEqual(after.databaseItems.map(item => [item.id, item.pageId]), before.databaseItems.map(item => [item.id, item.pageId]));
  });
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const openAndClose = async (opener, close = 'button') => {
    await opener.scrollIntoViewIfNeeded();
    const scrollBefore = await scroller.evaluate(element => element.scrollTop);
    const idsBefore = (await saved()).databaseItems.map(item => [item.id, item.pageId]);
    await opener.click(); await peek.waitFor();
    await peek.getByRole('textbox', { name: '记录标题' }).focus();
    if (close === 'escape') await page.keyboard.press('Escape');
    else await peek.getByRole('button', { name: '关闭预览' }).click();
    await settle();
    assert.equal(await opener.evaluate(element => element === document.activeElement), true);
    assert.ok(Math.abs(await scroller.evaluate(element => element.scrollTop) - scrollBefore) <= 1);
    assert.deepEqual((await saved()).databaseItems.map(item => [item.id, item.pageId]), idsBefore);
  };
  await check('table title focus Escape returns to same button', async () => {
    const opener = db.locator('tr[data-item-id="beta"] .db-title-open');
    await db.locator('tr[data-item-id="beta"] .db-title-control').hover();
    await openAndClose(opener, 'escape');
  });
  await check('row menu opens the right record and restores its stable menu anchor', async () => {
    const anchor = db.getByRole('button', { name: '记录操作 Beta 项目' });
    await anchor.scrollIntoViewIfNeeded();
    const scrollBefore = await scroller.evaluate(element => element.scrollTop);
    const idsBefore = (await saved()).databaseItems.map(item => [item.id, item.pageId]);
    await anchor.click();
    await page.getByRole('menu', { name: 'Beta 项目 记录菜单' }).getByRole('menuitem', { name: '打开', exact: true }).click();
    await peek.waitFor();
    assert.equal(await peek.getByRole('textbox', { name: '记录标题' }).inputValue(), 'Beta 项目');
    await peek.getByRole('button', { name: '关闭预览' }).click(); await settle();
    assert.equal(await anchor.evaluate(element => element === document.activeElement), true);
    assert.ok(Math.abs(await scroller.evaluate(element => element.scrollTop) - scrollBefore) <= 1);
    assert.deepEqual((await saved()).databaseItems.map(item => [item.id, item.pageId]), idsBefore);
  });
  await check('board and calendar existing records return to their own buttons', async () => {
    await db.locator('[role="tab"][data-view-id="view-board"]').click();
    await openAndClose(db.locator('.db-board-card-open').filter({ hasText: 'Alpha 项目' }), 'escape');
    await db.locator('[role="tab"][data-view-id="view-calendar"]').click();
    await openAndClose(db.locator('.db-calendar-record').filter({ hasText: 'Alpha 项目' }));
  });
  await check('calendar create retains its existing date and focus fallback', async () => {
    const plus = db.getByRole('button', { name: '在2026-09-20新建页面' });
    await plus.scrollIntoViewIfNeeded();
    const before = await saved(), scrollBefore = await scroller.evaluate(element => element.scrollTop);
    await plus.click(); await peek.waitFor();
    await peek.getByRole('textbox', { name: '记录标题' }).fill('focus calendar created');
    const after = await persisted(value => value.databaseItems.some(item => item.values.title === 'focus calendar created'));
    const created = after.databaseItems.filter(item => !before.databaseItems.some(old => old.id === item.id));
    assert.equal(created.length, 1); assert.equal(created[0].values.date.start, '2026-09-20');
    assert.ok(after.pages.some(entry => entry.id === created[0].pageId));
    await peek.getByRole('button', { name: '关闭预览' }).click(); await settle();
    assert.equal(await plus.evaluate(element => element === document.activeElement), true);
    assert.ok(Math.abs(await scroller.evaluate(element => element.scrollTop) - scrollBefore) <= 1);
  });
  await check('view change while open does not steal focus to the old record', async () => {
    const old = db.locator('.db-calendar-record').filter({ hasText: 'Alpha 项目' });
    await old.click(); await peek.waitFor();
    const tab = db.locator('[role="tab"][data-view-id="view-board"]');
    // Simulate an external view selection while the modal is open.
    await tab.evaluate(element => { element.focus(); element.click(); });
    await peek.waitFor({ state: 'detached' }); await settle();
    assert.equal(await tab.evaluate(element => element === document.activeElement), true);
    assert.equal(await old.count(), 0);
    await db.locator('[role="tab"][data-view-id="view-calendar"]').click();
  });
  await check('full page navigation does not restore the old opener', async () => {
    const opener = db.locator('.db-calendar-record').filter({ hasText: 'Alpha 项目' });
    const originalOpener = await opener.elementHandle();
    await opener.click(); await peek.waitFor();
    await peek.getByRole('button', { name: '打开完整页面' }).click(); await settle();
    assert.equal(await originalOpener.evaluate(element => element === document.activeElement), false);
    await persisted(value => value.ui.selectedPageId === 'alpha-page');
  });
}, { workspace, viewport: { width: 1200, height: 700 }, now: '2026-09-18T12:00:00.000Z' });
