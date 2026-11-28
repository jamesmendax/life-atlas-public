import { browserScenario } from './harness.mjs';
import { coreParityWorkspace } from '../fixtures/core-parity-workspace.mjs';
import { openViewSettingsSection, setViewSettings } from './database-navigation.mjs';

const workspace = coreParityWorkspace();
const host = workspace.pages.find(page => page.id === 'editor-page');
host.content = [
  { id: 'v9-before-db', type: 'paragraph', content: '数据库前的编辑位置' },
  { id: 'v9-inline-db', type: 'databaseView', props: { sourceId: 'projects', viewId: 'view-calendar' } },
  { id: 'v9-after-db', type: 'paragraph', content: '数据库后的正文保持原样' },
];
workspace.ui.selectedPageId = host.id;
workspace.ui.preferences = { style: 'mobai', theme: 'system' };
workspace.databaseViews = workspace.databaseViews.filter(view => view.sourceId !== 'projects' || ['view-table', 'view-board', 'view-calendar'].includes(view.id));
workspace.databaseViews.find(view => view.id === 'view-calendar').config = { calendar: { anchorDate: '2026-11-01', startOfWeek: 1, showWeekends: true } };
workspace.databaseViews.find(view => view.id === 'view-board').visiblePropertyIds = [];

await browserScenario('database-record-keyboard-v9', async ({ page, check, assert, saved, persisted, screenshot }) => {
  await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="editor-page"]').click();
  const db = page.locator('section.database-view.is-inline[data-source-id="projects"]');
  const scroller = page.locator('.workspace-scroll');
  let created;
  await db.waitFor();

  await check('record title Enter reaches its own body while a composing Enter keeps the title', async () => {
    const plus = db.getByRole('button', { name: '在2026-11-11新建页面', exact: true });
    await plus.scrollIntoViewIfNeeded();
    const beforeScroll = await scroller.evaluate(element => element.scrollTop);
    const before = await saved();
    await plus.click();
    const peek = page.getByRole('dialog', { name: '记录预览', exact: true });
    const title = peek.getByRole('textbox', { name: '记录标题', exact: true });
    await title.fill('V9 标题进入正文');
    await title.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true, bubbles: true });
    assert.equal(await title.evaluate(element => element === document.activeElement), true);
    await title.press('Enter');
    const body = peek.locator('.bn-editor[contenteditable="true"]');
    await page.waitForFunction(() => document.querySelector('[aria-label="记录预览"] .bn-editor[contenteditable="true"]') === document.activeElement, null, { timeout: 2000 });
    await body.pressSequentially('V9 record body');
    const after = await persisted(value => value.pages.some(entry => entry.title === 'V9 标题进入正文' && JSON.stringify(entry.content).includes('V9 record body')));
    const records = after.databaseItems.filter(item => !before.databaseItems.some(old => old.id === item.id));
    assert.equal(records.length, 1); created = records[0];
    assert.equal(after.pages.filter(entry => !before.pages.some(old => old.id === entry.id)).length, 1);
    assert.equal(after.pages.find(entry => entry.id === created.pageId).title, created.values.title);
    assert.equal(created.values.date.start, '2026-11-11');
    await peek.getByRole('button', { name: '关闭预览', exact: true }).click();
    assert.equal(await plus.evaluate(element => element === document.activeElement), true);
    assert.ok(Math.abs(await scroller.evaluate(element => element.scrollTop) - beforeScroll) <= 1, 'Closing the record preview should keep the underlying scroll position');
  });

  await check('inline view and settings controls preserve the nearby editor selection', async () => {
    const paragraph = page.locator('.bn-block-outer[data-id="v9-before-db"] .bn-inline-content');
    await paragraph.click(); await paragraph.press('End');
    const selection = () => page.evaluate(() => {
      const current = getSelection();
      return { text: current?.toString() || '', blockId: current?.anchorNode?.parentElement?.closest('.bn-block-outer')?.dataset.id };
    });
    const before = await selection();
    assert.equal(before.blockId, 'v9-before-db');
    await db.locator('[role="tab"][data-view-id="view-board"]').click();
    assert.equal((await selection()).text, '', 'Using a view tab must not select the inline database text');
    await db.getByRole('button', { name: '视图设置', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '视图设置', exact: true });
    await panel.getByRole('button', { name: /^布局/ }).click();
    await page.keyboard.press('Escape');
    assert.equal(await panel.count(), 0);
    assert.equal((await selection()).text, '');
    await persisted(value => value.pages.find(entry => entry.id === host.id).content.some(block => block.id === 'v9-inline-db' && block.props.viewId === 'view-board'));
    await screenshot('inline-controls-after-escape');
  });

  await check('the saved calendar week start can match the reference without changing other views', async () => {
    await db.locator('[role="tab"][data-view-id="view-calendar"]').click();
    const before = await saved();
    const panel = await openViewSettingsSection(db, '布局');
    await panel.getByLabel('日历每周开始日', { exact: true }).selectOption('0');
    const after = await persisted(value => value.databaseViews.find(view => view.id === 'view-calendar').config.calendar.startOfWeek === 0);
    assert.equal(await db.locator('.db-calendar-weekdays > span').first().innerText(), '周日');
    assert.equal(await db.locator('.db-calendar-cell').first().getAttribute('data-date'), '2026-11-01');
    assert.deepEqual(after.databaseViews.filter(view => view.id !== 'view-calendar'), before.databaseViews.filter(view => view.id !== 'view-calendar'));
    await setViewSettings(db, false);
    await persisted(value => value.pages.find(entry => entry.id === host.id).content.some(block => block.id === 'v9-inline-db' && block.props.viewId === 'view-calendar'));
  });

  await check('record body and host blocks retain their identities after reload', async () => {
    const before = await saved();
    await page.reload(); await db.waitFor();
    const after = await saved();
    assert.deepEqual(after.databaseItems.find(item => item.id === created.id), before.databaseItems.find(item => item.id === created.id));
    assert.deepEqual(after.pages.find(entry => entry.id === created.pageId), before.pages.find(entry => entry.id === created.pageId));
    assert.deepEqual(after.pages.find(entry => entry.id === host.id).content, before.pages.find(entry => entry.id === host.id).content);
    assert.equal(after.databaseViews.filter(view => view.sourceId === 'projects').length, 3);
    assert.equal(after.databaseViews.find(view => view.id === 'view-calendar').config.calendar.startOfWeek, 0);
  });
}, { workspace, now: '2026-11-10T12:00:00.000Z' });
