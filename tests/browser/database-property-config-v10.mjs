import { mkdirSync, writeFileSync } from 'node:fs';
import { browserScenario } from './harness.mjs';
import { coreParityWorkspace } from '../fixtures/core-parity-workspace.mjs';

const run = process.env.V10_PROPERTY_RUN || 'local';
if (!/^[a-z0-9-]+$/.test(run)) throw new Error('invalid run label');
const dir = 'LOCAL-NOTION-001/v10-property-config';
mkdirSync(`.qa/${dir}`, { recursive: true });
const workspace = coreParityWorkspace();
const host = workspace.pages.find(page => page.id === 'editor-page');
host.content = [{ id: 'property-db', type: 'databaseView', props: { sourceId: 'projects', viewId: 'view-table' } }];
workspace.ui.selectedPageId = host.id;
workspace.ui.preferences = { style: 'mobai', theme: 'system' };
const status = workspace.dataSources.find(source => source.id === 'projects').properties.find(property => property.id === 'status');
status.options = [{ id: 'todo', name: '待办', color: 'gray', group: 'todo' }, { id: 'doing', name: '进行中', color: 'blue', group: 'inProgress' }, { id: 'done', name: '完成', color: 'green', group: 'complete' }];

if (!process.env.V10_PROPERTY_FOCUS_ONLY) {
await browserScenario(`${dir}/${run}`, async ({ page, check, assert, saved, persisted, screenshot }) => {
  await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="editor-page"]').click();
  const db = page.locator('section.database-view.is-inline[data-source-id="projects"]');
  const header = db.locator('.db-property-header[data-type="status"]');
  const panel = page.getByRole('dialog', { name: '编辑状态属性' });
  const property = value => value.dataSources.find(source => source.id === 'projects').properties.find(prop => prop.id === 'status');
  const open = async () => { await header.click(); await page.getByRole('menu', { name: '状态 属性菜单' }).getByRole('menuitem', { name: '编辑属性…' }).click(); await panel.waitFor(); };
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await check('header identity and status name changes persist on Escape', async () => {
    const before = await saved();
    await header.click();
    const menu = page.getByRole('menu', { name: '状态 属性菜单' });
    const identity = menu.locator('.db-property-menu-identity');
    assert.equal(`${await identity.getByLabel('属性名称').inputValue()}\n${await identity.locator('small').innerText()}`, '状态\n状态');
    await menu.getByRole('menuitem', { name: '编辑属性…' }).click(); await panel.waitFor();
    for (const group of ['待办', '进行中', '完成']) assert.equal(await panel.getByRole('region', { name: `${group}选项` }).count(), 1);
    await panel.getByLabel('属性名称').fill('状态更新');
    const renamed = await persisted(value => property(value).name === '状态更新');
    assert.deepEqual(property(renamed).options, property(before).options);
    assert.deepEqual(renamed.databaseItems.map(item => [item.id, item.values.status]), before.databaseItems.map(item => [item.id, item.values.status]));
    await page.keyboard.press('Escape'); await settle();
    assert.equal(await header.evaluate(element => element === document.activeElement), true);
    await header.click(); await page.getByRole('menu', { name: '状态更新 属性菜单' }).getByRole('menuitem', { name: '编辑属性…' }).click();
    await panel.getByLabel('属性名称').fill('状态');
    await persisted(value => property(value).name === '状态');
    await page.keyboard.press('Escape'); await settle();
  });
  await check('option name commits on Enter while color and group update immediately', async () => {
    const before = await saved(); await open();
    await panel.getByRole('button', { name: '编辑选项 待办' }).click();
    await panel.getByLabel('选项名称').fill('排队');
    await panel.getByLabel('选项分组').selectOption('inProgress');
    await panel.getByRole('button', { name: '红色' }).click();
    const moved = await persisted(value => property(value).options.find(option => option.id === 'todo')?.color === 'red');
    assert.equal(property(moved).options.find(option => option.id === 'todo').name, '待办');
    assert.equal(property(moved).options.find(option => option.id === 'todo').group, 'inProgress');
    await panel.getByLabel('选项名称').press('Enter');
    const after = await persisted(value => property(value).options.find(option => option.id === 'todo')?.name === '排队');
    assert.deepEqual(property(after).options.find(option => option.id === 'todo'), { ...property(before).options.find(option => option.id === 'todo'), name: '排队', color: 'red', group: 'inProgress' });
    assert.deepEqual(after.databaseItems.map(item => [item.id, item.values.status]), before.databaseItems.map(item => [item.id, item.values.status]));
    await panel.getByRole('button', { name: '关闭属性设置' }).click(); await settle();
    assert.equal(await header.evaluate(element => element === document.activeElement), true);
  });
  await check('explicit delete preserves stored values and outside keeps clicked focus', async () => {
    const before = await saved(); await open();
    await panel.getByRole('button', { name: '编辑选项 完成' }).click();
    await panel.getByRole('button', { name: '删除选项' }).click();
    const after = await persisted(value => !property(value).options.some(option => option.id === 'done'));
    assert.deepEqual(after.databaseItems.map(item => [item.id, item.values.status]), before.databaseItems.map(item => [item.id, item.values.status]));
    const outside = page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="editor-page"] .sidebar-page-main');
    await outside.click(); await settle();
    assert.equal(await outside.evaluate(element => element === document.activeElement), true);
  });
  await check('other property types retain the existing complete form', async () => {
    await db.getByRole('button', { name: '编辑 双倍金额 属性' }).click();
    await page.getByRole('menu', { name: '双倍金额 属性菜单' }).getByRole('menuitem', { name: '编辑属性…' }).click();
    const dialog = page.getByRole('dialog', { name: '编辑公式属性' });
    await dialog.waitFor();
    assert.equal(await dialog.getByLabel('属性名称').inputValue(), '双倍金额');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
  });
  await check('light and dark configuration and detail stay in the viewport at narrow width', async () => {
    await page.setViewportSize({ width: 760, height: 700 });
    for (const mode of ['light','dark']) {
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, mode);
      await open(); await screenshot(`config-${mode}`);
      await panel.getByRole('button', { name: '编辑选项 排队' }).click(); await screenshot(`detail-${mode}`);
      const rect = await panel.evaluate(el => { const r = el.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:innerWidth, height:innerHeight }; });
      assert.ok(rect.left >= 0 && rect.right <= rect.width && rect.top >= 0 && rect.bottom <= rect.height, JSON.stringify(rect));
      await panel.getByRole('button', { name: '关闭属性设置', exact: true }).click();
    }
  });
}, { workspace, viewport: { width: 1200, height: 800 } });

const lockedWorkspace = coreParityWorkspace();
lockedWorkspace.ui.preferences = { style: 'mobai', theme: 'system' };
lockedWorkspace.pages.find(page => page.id === 'database-page').settings.locked = true;
await browserScenario(`${dir}/${run}-locked`, async ({ page, check, assert }) => {
  await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="database-page"]').click();
  await check('locked host disables property configuration', async () => {
    assert.equal(await page.getByRole('button', { name: '编辑 状态 属性' }).isDisabled(), true);
    assert.equal(await page.getByRole('dialog', { name: '编辑状态属性' }).count(), 0);
  });
}, { workspace: lockedWorkspace });
} else {
  const setup = async (page) => {
    await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="editor-page"]').click();
    const db = page.locator('section.database-view.is-inline[data-source-id="projects"]');
    await db.getByRole('button', { name: '编辑 状态 属性' }).click();
    await page.getByRole('menu', { name: '状态 属性菜单' }).getByRole('menuitem', { name: '编辑属性…' }).click();
    return page.getByRole('dialog', { name: '编辑状态属性' });
  };
  const active = page => page.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label'), text: document.activeElement?.textContent?.trim().slice(0, 80), inPanel: Boolean(document.activeElement?.closest('[aria-label="编辑状态属性"]')) }));
  await browserScenario(`${dir}/${run}-back`, async ({ page, check, assert }) => {
    await check('keyboard back returns to the same option and Tab then Enter continues there', async () => {
      const panel = await setup(page);
      await panel.getByRole('button', { name: '编辑选项 待办' }).click();
      await panel.getByLabel('选项名称').waitFor();
      await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Enter');
      const afterBack = await active(page);
      await page.keyboard.press('Tab'); const afterTab = await active(page);
      await page.keyboard.press('Shift+Tab'); const afterShiftTab = await active(page);
      await page.keyboard.press('Enter'); const afterEnter = await active(page);
      const reopened = await panel.getByLabel('选项名称').count();
      writeFileSync(`.qa/${dir}/${run}-back-trace.json`, JSON.stringify({ afterBack, afterTab, afterShiftTab, afterEnter, reopened }, null, 2));
      assert.equal(afterBack.label, '编辑选项 待办');
      assert.equal(afterTab.label, '在进行中添加选项');
      assert.equal(afterShiftTab.label, '编辑选项 待办');
      assert.equal(reopened, 1);
    });
  }, { workspace });
  await browserScenario(`${dir}/${run}-delete`, async ({ page, check, assert }) => {
    await check('deleting an option returns focus to its group and keyboard opens inline creation', async () => {
      const panel = await setup(page);
      await panel.getByRole('button', { name: '编辑选项 完成' }).click();
      await panel.getByRole('button', { name: '删除选项' }).click();
      const afterDelete = await active(page);
      await page.keyboard.press('Enter'); const afterEnter = await active(page);
      const newName = await panel.getByRole('region', { name: '完成选项' }).getByLabel('完成新选项名称').count();
      writeFileSync(`.qa/${dir}/${run}-delete-trace.json`, JSON.stringify({ afterDelete, afterEnter, newName }, null, 2));
      assert.equal(afterDelete.label, '在完成添加选项');
      assert.equal(newName, 1);
    });
  }, { workspace });
}
