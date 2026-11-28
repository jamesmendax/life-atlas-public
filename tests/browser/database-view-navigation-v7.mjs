import { browserScenario } from './harness.mjs';
import { coreParityWorkspace } from '../fixtures/core-parity-workspace.mjs';

const run = process.env.V7_DB_NAV_RUN || 'red01';
if (!/^[a-z0-9-]+$/.test(run)) throw new Error('invalid run label');
const evidenceRun = process.env.V10_VIEW_CREATE_RUN;
if (evidenceRun && !/^[a-z0-9-]+$/.test(evidenceRun)) throw new Error('invalid evidence run label');
const reportName = suffix => evidenceRun
  ? `LOCAL-NOTION-001/v10-view-create15/legacy-${evidenceRun}-navigation${suffix}`
  : `LOCAL-NOTION-001/v7-database-view-navigation-${run}${suffix}`;
const workspace = coreParityWorkspace();
workspace.databaseViews = workspace.databaseViews.filter(v => v.sourceId !== 'projects' || v.id === 'view-table');
workspace.ui.preferences = { theme: 'system', style: 'mobai' };
const reports = [];
reports.push(await browserScenario(reportName(''), async ({ page, check, assert, saved, persisted, screenshot }) => {
  await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="database-page"]').click();
  const db = page.locator('section.database-view[data-source-id="projects"]');
  await db.waitFor();
  await check('a source with one saved view shows one named tab', async () => {
    const tabs = db.getByRole('tab');
    assert.equal(await tabs.count(), 1);
    assert.equal(await tabs.first().getAttribute('data-view-id'), 'view-table');
    assert.equal(await tabs.first().innerText(), 'table view');
  });
  let initial, createdId, copiedId;
  await check('cancel add and Escape do not write a view', async () => {
    initial = await saved();
    const add = db.getByRole('button', { name: '添加视图' });
    await add.click();
    const chooser = page.getByRole('dialog', { name: '添加视图', exact: true });
    await page.waitForFunction(() => document.querySelector('[role="dialog"][aria-label="添加视图"]')?.contains(document.activeElement));
    assert.equal(await chooser.evaluate(el => el.contains(document.activeElement)), true);
    await chooser.getByRole('button', { name: '关闭添加视图', exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '添加视图');
    assert.equal(await add.evaluate(el => el === document.activeElement), true);
    await add.click(); await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '添加视图');
    assert.equal(await add.evaluate(el => el === document.activeElement), true);
    assert.deepEqual((await saved()).databaseViews, initial.databaseViews);
  });
  await check('create an independent same-layout view and filter it', async () => {
    await db.getByRole('button', { name: '添加视图' }).click();
    const chooser = page.getByRole('dialog', { name: '添加视图', exact: true });
    const layouts = ['表格', '看板', '列表', '画廊', '日历', '时间线', '图表', '表单', '仪表盘', '地图', '时间脉络'];
    for (const label of layouts) assert.equal(await chooser.getByRole('button', { name: label, exact: true }).count(), 1);
    assert.equal(layouts.length, 11);
    await chooser.getByRole('button', { name: '表格', exact: true }).click();
    const creation = page.getByRole('dialog', { name: '新建视图', exact: true });
    await creation.getByLabel('视图名称', { exact: true }).fill('筛选视图');
    await creation.getByRole('button', { name: '完成', exact: true }).click();
    const updated = await persisted(w => w.databaseViews.filter(v => v.sourceId === 'projects').length === 2 && w.databaseViews.some(v => v.sourceId === 'projects' && v.id !== 'view-table' && v.name === '筛选视图'));
    const created = updated.databaseViews.find(v => v.sourceId === 'projects' && v.id !== 'view-table');
    createdId = created.id;
    assert.equal(created.name, '筛选视图'); assert.equal(created.type, 'table');
    assert.equal(await db.getAttribute('data-view-id'), createdId);
    await db.getByRole('button', { name: '视图设置' }).click();
    const settings = page.getByRole('dialog', { name: '视图设置', exact: true });
    await settings.getByRole('button', { name: '筛选', exact: true }).click();
    await settings.getByRole('button', { name: '+ 条件', exact: true }).click();
    await settings.getByLabel('筛选值 0').fill('Alpha');
    await settings.getByRole('button', { name: '返回上一级' }).click();
    await settings.getByRole('button', { name: /^布局/ }).click();
    await settings.getByLabel('打开记录的方式').click(); await settings.getByRole('menuitemradio', { name: '完整页面', exact: true }).click();
    await persisted(w => { const v = w.databaseViews.find(x => x.id === createdId); return v.filter?.children?.[0]?.value === 'Alpha' && v.config.openRecordsIn === 'page'; });
    await page.keyboard.press('Escape');
    assert.equal(await db.getByRole('button', { name: '视图设置' }).evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator('.db-view-settings-panel').count(), 0);
    assert.equal(await db.locator('tbody tr[data-item-id="alpha"]').count(), 1);
    assert.equal(await db.locator('tbody tr[data-item-id="beta"]').count(), 0);
  });
  await check('switching named tabs preserves both view definitions', async () => {
    const before = await saved();
    await db.locator('[role="tab"][data-view-id="view-table"]').click();
    assert.equal(await db.getAttribute('data-view-type'), 'table');
    assert.equal(await db.locator('tbody tr[data-item-id="beta"]').count(), 1);
    await db.locator(`[role="tab"][data-view-id="${createdId}"]`).click();
    await persisted(w => w.pages.find(p => p.id === 'database-page').databaseViewId === createdId);
    const after = await saved();
    assert.deepEqual(after.databaseViews, before.databaseViews);
    assert.deepEqual(after.dataSources, before.dataSources); assert.deepEqual(after.databaseItems, before.databaseItems);
    assert.deepEqual(after.pages.filter(p => p.id !== 'database-page'), before.pages.filter(p => p.id !== 'database-page'));
    await db.locator('[role="tab"][data-view-id="view-table"]').click();
    await page.evaluate(() => { window.__dbNavBubbledKeys = []; document.addEventListener('keydown', e => window.__dbNavBubbledKeys.push(e.key)); });
    await page.keyboard.press('End');
    assert.equal(await db.getAttribute('data-view-id'), createdId);
    await page.keyboard.press('Home');
    assert.equal(await db.getAttribute('data-view-id'), 'view-table');
    await page.keyboard.press('ArrowRight');
    assert.equal(await db.getAttribute('data-view-id'), createdId);
    await page.keyboard.press('ArrowLeft');
    assert.equal(await db.getAttribute('data-view-id'), 'view-table');
    assert.deepEqual(await page.evaluate(() => window.__dbNavBubbledKeys), []);
    await db.locator(`[role="tab"][data-view-id="${createdId}"]`).click();
  });
  await check('copy retains configuration and has a fresh independent identity', async () => {
    await db.getByRole('button', { name: '视图设置' }).click();
    await page.getByRole('dialog', { name: '视图设置', exact: true }).getByRole('button', { name: '复制当前视图' }).click();
    const copied = await persisted(w => w.databaseViews.filter(v => v.sourceId === 'projects').length === 3);
    const v = copied.databaseViews.find(v => v.sourceId === 'projects' && !['view-table',createdId].includes(v.id)); copiedId = v.id;
    await page.waitForFunction(id => document.activeElement?.getAttribute('role') === 'tab' && document.activeElement?.dataset.viewId === id, copiedId);
    const original = copied.databaseViews.find(x => x.id === createdId);
    assert.notEqual(v.id, original.id); assert.equal(v.name, '筛选视图 副本'); assert.deepEqual(v.filter, original.filter); assert.deepEqual(v.config, original.config);
    await db.getByRole('button', { name: '视图设置' }).click();
    const settings = page.getByRole('dialog', { name: '视图设置', exact: true });
    await settings.getByRole('button', { name: '筛选', exact: true }).click();
    await settings.getByLabel('筛选值 0').fill('Beta');
    await persisted(w => w.databaseViews.find(x => x.id === copiedId).filter.children[0].value === 'Beta');
    assert.equal((await saved()).databaseViews.find(x => x.id === createdId).filter.children[0].value, 'Alpha');
    await settings.getByRole('button', { name: '返回上一级' }).click();
    await settings.getByRole('button', { name: /^布局/ }).click();
    await settings.getByRole('button', { name: '布局 列表', exact: true }).click();
    const after = await persisted(w => w.databaseViews.find(x => x.id === copiedId).type === 'list');
    assert.equal(after.databaseViews.find(x => x.id === createdId).type, 'table');
    assert.equal(after.databaseViews.find(x => x.id === 'view-table').type, 'table');
    assert.deepEqual(after.databaseItems, initial.databaseItems); assert.deepEqual(after.dataSources, initial.dataSources);
  });
  await check('reload retains selected view and independent settings', async () => {
    await page.reload(); await db.waitFor();
    await page.waitForFunction(id => document.querySelector('section.database-view[data-source-id="projects"]')?.dataset.viewId === id, copiedId);
    assert.equal(await db.getAttribute('data-view-type'), 'list');
    await db.getByRole('button', { name: '视图设置' }).click();
    const settings = page.getByRole('dialog', { name: '视图设置', exact: true });
    await settings.getByRole('button', { name: '筛选', exact: true }).click();
    assert.equal(await settings.getByLabel('筛选值 0').inputValue(), 'Beta');
    await settings.getByRole('button', { name: '返回上一级' }).click();
    await settings.getByRole('button', { name: /^布局/ }).click();
    await settings.getByLabel('打开记录的方式').click(); assert.equal(await settings.getByRole('menuitemradio', { name: '完整页面', exact: true }).getAttribute('aria-checked'), 'true'); await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });
  await check('navigation remains usable in narrow light and dark windows', async () => {
    await page.setViewportSize({ width: 700, height: 800 });
    for (const mode of ['light','dark']) {
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForFunction(m => document.documentElement.dataset.theme === m, mode);
      await screenshot(`narrow-${mode}`);
      const size = await db.locator('.db-navigation-row').evaluate(el => ({left:el.getBoundingClientRect().left, right:el.getBoundingClientRect().right, width:document.documentElement.clientWidth}));
      assert.ok(size.left >= 0 && size.right <= size.width + 1, JSON.stringify(size));
      await db.getByRole('button', { name: '添加视图' }).click();
      assert.equal(await page.getByRole('dialog', { name: '添加视图', exact: true }).getByRole('button', { name: '列表', exact: true }).isVisible(), true);
      const panel = page.getByRole('dialog', { name: '添加视图', exact: true });
      const panelSize = await panel.evaluate(el => ({right:el.getBoundingClientRect().right, width:document.documentElement.clientWidth, background:getComputedStyle(el).backgroundColor}));
      assert.ok(panelSize.right <= panelSize.width + 1, JSON.stringify(panelSize));
      assert.notEqual(panelSize.background, 'rgba(0, 0, 0, 0)');
      await screenshot(`add-${mode}`);
      await page.keyboard.press('Escape');
    }
  });
}, { workspace }));

const lockedWorkspace = coreParityWorkspace();
lockedWorkspace.ui.preferences = { theme: 'system', style: 'mobai' };
lockedWorkspace.databaseViews = lockedWorkspace.databaseViews.filter(v => v.sourceId !== 'projects' || ['view-table','view-board'].includes(v.id));
lockedWorkspace.pages.find(p => p.id === 'database-page').settings.locked = true;
reports.push(await browserScenario(reportName('-locked'), async ({ page, check, assert, saved }) => {
  await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="database-page"]').click();
  const db = page.locator('section.database-view[data-source-id="projects"]'); await db.waitFor();
  await check('locked page allows a read-only switch without creating or mutating a view', async () => {
    const before = await saved();
    await db.locator('[role="tab"][data-view-id="view-board"]').click();
    assert.equal(await db.getAttribute('data-view-id'), 'view-board');
    assert.equal(await db.getByRole('button', { name: '添加视图' }).count(), 0);
    assert.equal(await db.getByRole('button', { name: '视图设置' }).count(), 0);
    const after = await saved(); assert.deepEqual(after.databaseViews, before.databaseViews); assert.deepEqual(after.pages, before.pages);
  });
}, { workspace: lockedWorkspace }));

const inlineWorkspace = coreParityWorkspace();
inlineWorkspace.ui.selectedPageId = 'editor-page';
inlineWorkspace.ui.preferences = { theme: 'system', style: 'mobai' };
inlineWorkspace.pages.find(p => p.id === 'editor-page').content = [{ id: 'fresh-inline-start', type: 'paragraph', content: '' }];
reports.push(await browserScenario(reportName('-fresh-inline'), async ({ page, check, assert, saved, persisted }) => {
  await check('creating an inline database produces one source and one named view tab', async () => {
    await page.locator('[data-id="fresh-inline-start"] .bn-block-content').first().waitFor();
    const before = await saved();
    await page.locator('[data-id="fresh-inline-start"] .bn-block-content').first().fill('/');
    const options = page.locator('[role="option"]:visible'); await options.first().waitFor();
    await options.filter({ hasText: '数据库 - 行内' }).first().click();
    const after = await persisted(w => w.dataSources.length === before.dataSources.length + 1 && w.databaseViews.length === before.databaseViews.length + 1);
    const source = after.dataSources.find(x => !before.dataSources.some(y => y.id === x.id));
    const view = after.databaseViews.find(x => x.sourceId === source.id);
    assert.ok(view); assert.equal(after.databaseViews.filter(x => x.sourceId === source.id).length, 1);
    const db = page.locator(`section.database-view[data-source-id="${source.id}"]`); await db.waitFor();
    assert.equal(await db.getByRole('tab').count(), 1);
    assert.equal(await db.getByRole('tab').first().getAttribute('data-view-id'), view.id);
    assert.equal(await db.getByRole('tab').first().innerText(), view.name);
  });
}, { workspace: inlineWorkspace }));
if (reports.some(report => !report.passed)) process.exitCode = 1;
