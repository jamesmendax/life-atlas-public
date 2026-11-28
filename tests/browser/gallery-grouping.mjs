import { createDatabaseView } from '../../src/domain/database.js';
import { coreParityWorkspace } from '../fixtures/core-parity-workspace.mjs';
import { browserScenario } from './harness.mjs';

const fixture = coreParityWorkspace();
fixture.ui.preferences = { style: 'mobai', theme: 'system' };
fixture.pages.find(page => page.id === 'database-page').databaseViewId = 'view-gallery';
const labels = fixture.dataSources[0].properties.find(property => property.id === 'labels');
labels.options.push({ id: 'unused', name: '备用' }, { id: 'hidden', name: '隐藏标签' });
fixture.databaseItems.find(item => item.id === 'alpha').values.labels = ['design', 'launch', 'hidden', 'retired-alongside-active'];
fixture.databaseItems.find(item => item.id === 'gamma').values.labels = ['retired-only'];
const grouping = { primaryPropertyId: 'labels', order: ['launch', 'design', 'unused', 'hidden', '未分组'],
  hiddenGroupKeys: ['hidden'], showEmpty: true };
const savedGallery = fixture.databaseViews.find(view => view.id === 'view-gallery');
const gallery = createDatabaseView({ ...savedGallery, grouping,
  config: { gallery: { preview: { kind: 'none' }, cardSize: 'small', manualOrder: ['beta', 'alpha'] } } });
Object.assign(savedGallery, gallery);

const scenarioName = process.env.GALLERY_GROUPING_RUN ? `gallery-grouping-${process.env.GALLERY_GROUPING_RUN}` : 'gallery-grouping';
await browserScenario(scenarioName, async ({ page, check, assert, persisted, screenshot }) => {
  const db = page.locator('section.database-view[data-view-id="view-gallery"]');
  await db.waitFor();
  const groups = db.locator('.db-gallery-group[data-group-key]');
  const group = key => db.locator(`.db-gallery-group[data-group-key="${key}"]`);
  const membership = () => groups.evaluateAll(sections => sections.map(section => [section.dataset.groupKey,
    [...section.querySelectorAll('.db-gallery-card')].map(card => card.dataset.itemId)]));
  const storedView = workspace => workspace.databaseViews.find(view => view.id === 'view-gallery');
  const openGrouping = async () => {
    await db.getByRole('button', { name: '视图设置', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '视图设置', exact: true });
    await panel.getByRole('button', { name: '分组', exact: true }).click();
    return panel;
  };

  await check('saved groups render in order with their labels, empty groups and multiselect memberships', async () => {
    await groups.first().waitFor();
    assert.deepEqual(await membership(), [['launch', ['alpha']], ['design', ['beta', 'alpha']], ['unused', []], ['未分组', ['gamma']]]);
    assert.deepEqual(await groups.getByRole('heading').allTextContents(), ['发布 1', '设计 2', '备用 0', '未分组 1']);
    assert.deepEqual(await db.locator('.db-gallery-view').evaluateAll(grids => grids.map(grid => grid.dataset.cardSize)),
      ['small', 'small', 'small', 'small']);
    assert.equal(await db.locator('.db-gallery-preview').count(), 0);
    await screenshot('saved-groups');
  });

  await check('card movement stays inside a group and persists across reload', async () => {
    const launch = group('launch').locator('.db-gallery-card');
    await launch.locator('summary').focus();
    await launch.locator('summary').click();
    assert.equal(await launch.getByRole('button', { name: '前移一张' }).isDisabled(), true);
    assert.equal(await launch.getByRole('button', { name: '后移一张' }).isDisabled(), true);
    await launch.locator('summary').click();
    const design = group('design').locator('.db-gallery-card[data-item-id="alpha"]');
    const beta = group('design').locator('.db-gallery-card[data-item-id="beta"]');
    await launch.dragTo(beta);
    assert.deepEqual((await membership())[1], ['design', ['beta', 'alpha']]);
    await beta.dragTo(design);
    assert.deepEqual((await membership())[1], ['design', ['alpha', 'beta']]);
    await design.locator('summary').focus();
    await design.locator('summary').click();
    await design.getByRole('button', { name: '后移一张' }).click();
    assert.deepEqual((await membership())[1], ['design', ['beta', 'alpha']]);
    await design.getByRole('button', { name: '前移一张' }).click();
    await persisted(workspace => storedView(workspace).config.gallery.manualOrder[0] === 'alpha');
    await page.reload();
    await groups.first().waitFor();
    assert.deepEqual(await membership(), [['launch', ['alpha']], ['design', ['alpha', 'beta']], ['unused', []], ['未分组', ['gamma']]]);
  });

  await check('unassigned group visibility persists and a saved unassigned position renders when empty', async () => {
    let panel = await openGrouping();
    await panel.getByLabel('显示未分组', { exact: true }).uncheck();
    const hidden = await persisted(workspace => storedView(workspace).grouping.hiddenGroupKeys.includes('未分组'));
    assert.deepEqual(hidden.databaseItems.find(item => item.id === 'gamma').values.labels, ['retired-only']);
    await page.reload();
    await groups.first().waitFor();
    assert.equal(await group('未分组').count(), 0);
    panel = await openGrouping();
    const unassigned = panel.getByLabel('显示未分组', { exact: true });
    assert.equal(await unassigned.isChecked(), false);
    await unassigned.check();
    await persisted(workspace => !storedView(workspace).grouping.hiddenGroupKeys.includes('未分组'));
    await page.keyboard.press('Escape');
    assert.deepEqual((await membership()).at(-1), ['未分组', ['gamma']]);

    await db.getByRole('button', { name: '搜索此视图', exact: true }).click();
    const search = db.getByLabel('在此视图中搜索', { exact: true });
    await search.fill('Alpha');
    assert.deepEqual((await membership()).at(-1), ['未分组', []]);
    assert.equal(await group('未分组').getByRole('heading').textContent(), '未分组 0');
    panel = await openGrouping();
    const showEmpty = panel.getByLabel('显示空分组', { exact: true });
    await showEmpty.uncheck();
    assert.equal(await group('未分组').count(), 0);
    await showEmpty.check();
    assert.deepEqual((await membership()).at(-1), ['未分组', []]);
    await page.keyboard.press('Escape');
    await search.press('Escape');
  });

  await check('existing grouping controls affect the gallery and creation opens the new record in its group', async () => {
    const panel = await openGrouping();
    assert.equal(await panel.getByLabel('一级分组', { exact: true }).inputValue(), 'labels');
    await panel.getByLabel('显示空分组', { exact: true }).uncheck();
    await panel.locator('.db-group-order > div').filter({ hasText: '隐藏标签' }).getByRole('checkbox').check();
    await panel.locator('.db-group-order > div').filter({ hasText: '设计' }).getByRole('button', { name: '↑', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.deepEqual(await membership(), [['design', ['alpha', 'beta']], ['launch', ['alpha']], ['hidden', ['alpha']], ['未分组', ['gamma']]]);

    await group('launch').getByRole('button', { name: '新建页面', exact: true }).click();
    const peek = page.getByRole('dialog', { name: '记录预览', exact: true });
    await peek.waitFor();
    const openedPageId = await peek.locator('.life-editor').getAttribute('data-page-id');
    const workspace = await persisted(value => value.databaseItems.some(item => item.pageId === openedPageId));
    const created = workspace.databaseItems.find(item => item.pageId === openedPageId);
    assert.deepEqual(created.values.labels, ['launch']);
    assert.deepEqual((await membership())[1], ['launch', ['alpha', created.id]]);
    assert.equal(storedView(workspace).grouping.order[0], 'design');
    await page.keyboard.press('Escape');

    const settings = await openGrouping();
    await settings.getByLabel('一级分组', { exact: true }).selectOption('');
    await page.keyboard.press('Escape');
    assert.equal(await groups.count(), 0);
    assert.equal(await db.locator('.db-gallery-card').count(), 4);
    assert.equal(await db.locator('.db-gallery-create').count(), 1);
    await persisted(value => storedView(value).grouping.primaryPropertyId === null);
  });
}, { workspace: fixture });
