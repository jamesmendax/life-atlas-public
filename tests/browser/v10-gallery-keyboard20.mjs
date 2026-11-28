import { mkdirSync } from 'node:fs';
import { browserScenario } from './harness.mjs';
import { coreParityWorkspace } from '../fixtures/core-parity-workspace.mjs';
import { createProperty } from '../../src/domain/database.js';
import { normalizeLoadedWorkspace } from '../../src/persistence/normalize.js';

const run = process.env.V10_GALLERY_KEYBOARD_RUN || 'manual';
const part = process.env.V10_GALLERY_KEYBOARD_PART || 'all';
mkdirSync(`.qa/LOCAL-NOTION-001/v10-gallery-keyboard20/${run}`, { recursive: true });
const value = coreParityWorkspace();
value.ui.preferences = { style: 'mobai', theme: 'system' };
value.ui.selectedPageId = 'database-page';
value.pages.find(page => page.id === 'database-page').databaseViewId = 'view-gallery';
const source = value.dataSources.find(entry => entry.id === 'projects');
for (let i = 1; i <= 30; i++) source.properties.push(createProperty({ id: `keyboard-files-${i}`, name: `附件 ${String(i).padStart(2, '0')}`, type: 'files' }));
const view = value.databaseViews.find(entry => entry.id === 'view-gallery');
view.config = { ...view.config, openRecordsIn: 'peek', unknownKeyboard: { keep: true }, gallery: { preview: { kind: 'files-property', propertyId: 'keyboard-files-29', unknownPreview: 'keep' }, cardSize: 'medium', imageFit: 'contain', visiblePropertyIds: [], unknownGallery: 'keep' } };
const fixture = normalizeLoadedWorkspace(value, { idFactory: prefix => `${prefix}-keyboard20` });

await browserScenario(`LOCAL-NOTION-001/v10-gallery-keyboard20/${run}/${part}`, async ({ page, check, assert, saved, persisted }) => {
  await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="database-page"]').click();
  const db = page.locator('section.database-view[data-source-id="projects"]');
  await db.waitFor();
  await db.getByRole('button', { name: '视图设置', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '视图设置', exact: true });
  await panel.getByRole('button', { name: /^布局/ }).click();
  const preview = panel.getByRole('button', { name: '画廊预览', exact: true });
  const files = panel.getByRole('button', { name: '画廊附件属性', exact: true });
  const menu = label => panel.getByRole('menu', { name: label, exact: true });
  const before = await saved();
  const assertEntities = (actual, expected) => {
    for (const key of ['databaseViews', 'dataSources', 'databaseItems', 'pages', 'attachments']) assert.deepEqual(actual[key], expected[key], key);
  };

  if (part === 'focus' || part === 'all') {
    await check('Tab leaves submenu without stealing focus or writing, and keyboard opening keeps one menu', async () => {
      await preview.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('End');
      await page.keyboard.press('Tab');
      assert.equal(await files.evaluate(el => el === document.activeElement), true, 'Tab must reach next trigger');
      assert.equal(await menu('画廊预览').count(), 0, 'Tab must dismiss prior menu');
      await page.keyboard.press('Enter');
      assert.equal(await panel.getByRole('menu').count(), 1);
      assert.equal(await menu('画廊附件属性').count(), 1);
      await page.keyboard.press('Escape');
      assert.equal(await files.evaluate(el => el === document.activeElement), true);
      assertEntities(await saved(), before);
    });
    await check('ShiftTab to trigger and Escape dismiss only the open submenu', async () => {
      await preview.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Home'); await page.keyboard.press('Shift+Tab');
      assert.equal(await preview.evaluate(el => el === document.activeElement), true);
      await page.keyboard.press('Escape');
      assert.equal(await menu('画廊预览').count(), 0);
      assert.equal(await panel.count(), 1);
      assert.equal(await preview.evaluate(el => el === document.activeElement), true);
      await page.keyboard.press('Enter'); await page.keyboard.press('Home'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab');
      assert.equal(await menu('画廊预览').count(), 0);
      assert.equal(await panel.getByRole('button', { name: '打开记录的方式', exact: true }).evaluate(el => el === document.activeElement), true);
      assertEntities(await saved(), before);
    });
  }

  if (part === 'scroll' || part === 'all') {
    await check('selected and keyboard-navigated file choices stay visible without moving the parent or viewport', async () => {
      await files.focus();
      const stable = await page.evaluate(() => ({ x: scrollX, y: scrollY, panel: document.querySelector('.db-view-settings-panel').scrollTop }));
      await page.keyboard.press('Enter');
      const list = menu('画廊附件属性');
      const visible = async name => {
        const option = list.getByRole('menuitemradio', { name, exact: true });
        assert.equal(await option.evaluate(el => el === document.activeElement), true, `${name} must be focused`);
        const boxes = await option.evaluate(el => { const item = el.getBoundingClientRect(), box = el.parentElement.getBoundingClientRect(); return { top: item.top, bottom: item.bottom, boxTop: box.top + el.parentElement.clientTop, boxBottom: box.top + el.parentElement.clientTop + el.parentElement.clientHeight }; });
        assert.ok(boxes.top >= boxes.boxTop - 1 && boxes.bottom <= boxes.boxBottom + 1, `${name} must be visible: ${JSON.stringify(boxes)}`);
        assert.deepEqual(await page.evaluate(() => ({ x: scrollX, y: scrollY, panel: document.querySelector('.db-view-settings-panel').scrollTop })), stable);
      };
      await visible('附件 29');
      await page.keyboard.press('Home'); await visible('选择');
      await page.keyboard.press('ArrowDown'); await visible('附件');
      await page.keyboard.press('ArrowDown'); await visible('附件 01');
      await page.keyboard.press('End'); await visible('附件 30');
      await page.keyboard.press('ArrowUp'); await visible('附件 29');
      await page.keyboard.press('ArrowDown'); await visible('附件 30');
      await page.keyboard.press('Enter');
      assert.equal(await list.count(), 0);
      assert.equal(await files.evaluate(el => el === document.activeElement), true);
      const after = await persisted(workspace => workspace.databaseViews.find(entry => entry.id === 'view-gallery').config.gallery.preview.propertyId === 'keyboard-files-30');
      const expected = structuredClone(before);
      expected.databaseViews.find(entry => entry.id === 'view-gallery').config.gallery.preview.propertyId = 'keyboard-files-30';
      assertEntities(after, expected);
    });
  }
}, { workspace: fixture, viewport: { width: 700, height: 350 } });
