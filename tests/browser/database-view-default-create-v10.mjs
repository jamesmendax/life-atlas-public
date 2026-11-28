import { browserScenario } from './harness.mjs';
import { coreParityWorkspace } from '../fixtures/core-parity-workspace.mjs';

const evidenceRun = process.env.V10_VIEW_CREATE_RUN;
if (evidenceRun && !/^[a-z0-9-]+$/.test(evidenceRun)) throw new Error('invalid run label');
const reportName = name => evidenceRun ? `LOCAL-NOTION-001/v10-view-create15/legacy-${evidenceRun}-${name}` : name;
const workspace = coreParityWorkspace();
workspace.ui.preferences = { style: 'mobai', theme: 'system' };
workspace.pages.find(page => page.id === 'database-page').databaseViewId = 'view-table';

await browserScenario(reportName('database-view-default-create-v10'), async ({ page, check, assert, saved, persisted }) => {
  await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="database-page"]').click();
  const db = page.locator('section.database-view[data-source-id="projects"]');
  await db.waitFor();
  await persisted(value => value.pages.every(entry => Object.hasOwn(entry, 'contentRevision')));
  await check('empty name and selected layout create one selected view with unchanged records and source', async () => {
    const before = await saved();
    await db.getByRole('button', { name: '添加视图' }).click();
    const panel = page.getByRole('dialog', { name: '添加视图' });
    await panel.getByRole('button', { name: '看板', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '新建视图', exact: true });
    const name = settings.getByLabel('视图名称', { exact: true });
    assert.equal(await name.inputValue(), '');
    const done = settings.getByRole('button', { name: '完成', exact: true });
    assert.equal(await done.isEnabled(), true, 'blank name must not disable completing the view');
    await done.click();
    const after = await persisted(value => value.databaseViews.length === before.databaseViews.length + 1);
    const added = after.databaseViews.filter(view => !before.databaseViews.some(old => old.id === view.id));
    assert.equal(added.length, 1);
    const view = added[0];
    assert.ok(view.id); assert.equal(view.type, 'board'); assert.equal(view.name, ''); assert.equal(view.sourceId, 'projects');
    assert.equal(new Set(after.databaseViews.map(entry => entry.id)).size, after.databaseViews.length);
    assert.equal(await db.getAttribute('data-view-id'), view.id);
    assert.equal(await db.locator(`[role="tab"][data-view-id="${view.id}"]`).getAttribute('aria-selected'), 'true');
    assert.equal((await db.locator(`[role="tab"][data-view-id="${view.id}"]`).innerText()).trim(), '看板');
    assert.deepEqual(after.databaseItems, before.databaseItems);
    assert.deepEqual(after.dataSources, before.dataSources);
    const pageContent = value => value.pages.map(({ databaseViewId, ...entry }) => entry);
    assert.deepEqual(pageContent(after), pageContent(before));
    assert.equal(after.pages.find(entry => entry.id === 'database-page').databaseViewId, view.id);
    await page.reload(); await db.waitFor();
    const reloaded = await saved();
    assert.deepEqual(reloaded.databaseViews.find(entry => entry.id === view.id), view);
    assert.equal(await db.getAttribute('data-view-id'), view.id);
    assert.deepEqual(reloaded.databaseItems, before.databaseItems);
    assert.deepEqual(reloaded.dataSources, before.dataSources);
    assert.deepEqual(pageContent(reloaded), pageContent(before));
    await db.getByRole('button', { name: '视图设置', exact: true }).click();
    await page.getByRole('dialog', { name: '视图设置' }).getByLabel('视图名称').fill('后来命名');
    const renamed = await persisted(value => value.databaseViews.find(entry => entry.id === view.id)?.name === '后来命名');
    assert.equal(renamed.databaseViews.length, after.databaseViews.length);
    assert.equal(renamed.databaseViews.find(entry => entry.id === view.id).sourceId, 'projects');
    assert.deepEqual(renamed.databaseItems, before.databaseItems);
    await page.keyboard.press('Escape');
  });
  await check('whitespace falls back to layout label and custom names take precedence', async () => {
    let before = await saved();
    const add = db.getByRole('button', { name: '添加视图' });
    await add.click();
    let panel = page.getByRole('dialog', { name: '添加视图' });
    await panel.getByRole('button', { name: '列表', exact: true }).click();
    let settings = page.getByRole('dialog', { name: '新建视图', exact: true });
    await settings.getByLabel('视图名称').fill('   ');
    await settings.getByRole('button', { name: '完成', exact: true }).click();
    const list = await persisted(value => value.databaseViews.length === before.databaseViews.length + 1);
    const listView = list.databaseViews.find(view => !before.databaseViews.some(old => old.id === view.id));
    assert.equal(listView.name, ''); assert.equal(listView.type, 'list');
    assert.equal((await db.locator(`[role="tab"][data-view-id="${listView.id}"]`).innerText()).trim(), '列表');
    assert.equal(await db.getAttribute('data-view-id'), listView.id);
    before = list; await add.click();
    panel = page.getByRole('dialog', { name: '添加视图' });
    await panel.getByRole('button', { name: '日历', exact: true }).click();
    settings = page.getByRole('dialog', { name: '新建视图', exact: true });
    await settings.getByLabel('视图名称').fill('  自定义视图  ');
    assert.equal(await settings.getByLabel('视图名称').inputValue(), '  自定义视图  ');
    await settings.getByRole('button', { name: '完成', exact: true }).click();
    const custom = await persisted(value => value.databaseViews.length === before.databaseViews.length + 1 && value.databaseViews.some(view => !before.databaseViews.some(old => old.id === view.id) && view.name === '自定义视图'));
    const customView = custom.databaseViews.find(view => !before.databaseViews.some(old => old.id === view.id));
    assert.equal(customView.name, '自定义视图'); assert.equal(customView.type, 'calendar');
    assert.equal(await db.getAttribute('data-view-id'), customView.id);
    assert.deepEqual(custom.databaseItems, before.databaseItems);
    assert.deepEqual(custom.dataSources, before.dataSources);
  });
}, { workspace });

await browserScenario(reportName('database-view-default-create-v10-cancel'), async ({ page, check, assert, saved }) => {
  await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="database-page"]').click();
  const db = page.locator('section.database-view[data-source-id="projects"]');
  await check('Cancel and Escape before creation leave view IDs records and source unchanged', async () => {
    const before = await saved();
    const add = db.getByRole('button', { name: '添加视图' });
    await add.click();
    await page.getByRole('dialog', { name: '添加视图' }).getByRole('button', { name: '关闭添加视图', exact: true }).click();
    await add.click(); await page.keyboard.press('Escape');
    const after = await saved();
    assert.deepEqual(after.databaseViews, before.databaseViews);
    assert.deepEqual(after.databaseItems, before.databaseItems);
    assert.deepEqual(after.dataSources, before.dataSources);
    assert.equal(await db.getAttribute('data-view-id'), 'view-table');
  });
}, { workspace });

const locked = coreParityWorkspace();
locked.ui.preferences = { style: 'mobai', theme: 'system' };
locked.pages.find(page => page.id === 'database-page').settings.locked = true;
await browserScenario(reportName('database-view-default-create-v10-locked'), async ({ page, check, assert, saved }) => {
  await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="database-page"]').click();
  const db = page.locator('section.database-view[data-source-id="projects"]');
  await check('locked page offers no create view action and retains all view IDs', async () => {
    const before = await saved();
    assert.equal(await db.getByRole('button', { name: '添加视图' }).count(), 0);
    assert.deepEqual((await saved()).databaseViews, before.databaseViews);
  });
}, { workspace: locked });
