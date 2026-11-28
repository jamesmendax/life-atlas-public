import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { browserScenario } from './harness.mjs';
import { coreParityWorkspace } from '../fixtures/core-parity-workspace.mjs';
import { createDatabaseView } from '../../src/domain/database.js';
import { normalizeLoadedWorkspace } from '../../src/persistence/normalize.js';
import { chooseSavedView, openViewSettingsSection, setViewSettings } from './database-navigation.mjs';

const run = process.env.V10_GALLERY_PROPERTIES_RUN || 'prepared01';
if (!/^[a-z0-9-]+$/.test(run)) throw new Error('Invalid V10_GALLERY_PROPERTIES_RUN');
const directory = `.qa/LOCAL-NOTION-001/v10-gallery-properties17/${run}`;
mkdirSync(directory, { recursive: true });
const name = suffix => `LOCAL-NOTION-001/v10-gallery-properties17/${run}/${suffix}`;
for (const suffix of ['common', 'legacy', 'global', 'locked']) {
  if (existsSync(`.qa/${name(suffix)}.json`)) throw new Error('Preserve prior evidence; choose a new run label');
}

function fixture({ locked = false, legacy = false } = {}) {
  const value = coreParityWorkspace();
  value.ui.preferences = { style: 'mobai', theme: 'system' };
  value.ui.selectedPageId = 'database-page';
  const owner = value.pages.find(page => page.id === 'database-page');
  owner.databaseViewId = 'view-gallery';
  owner.settings.locked = locked;
  const source = value.dataSources.find(source => source.id === 'projects');
  source.properties = source.properties.filter(property => ['title', 'status', 'amount', 'date', 'checked', 'notes', 'files', 'formula'].includes(property.id));
  const view = value.databaseViews.find(view => view.id === 'view-gallery');
  view.visiblePropertyIds = legacy ? ['title', 'amount'] : null;
  view.config = {
    openRecordsIn: 'peek', preservedMetadata: { marker: 'properties17' },
    gallery: { preview: { kind: 'page-content', propertyId: null, preservedPreview: 'unchanged' }, cardSize: 'small', imageFit: 'contain', preservedGallery: 'unchanged', visiblePropertyIds: legacy ? ['title', 'status', 'checked', 'removed-property'] : [] },
    table: { preservedInactiveConfig: true },
  };
  value.databaseViews.push(createDatabaseView({ id: 'view-roadmap', sourceId: source.id, type: 'roadmap', name: 'roadmap view' }));
  value.databaseViews.push(createDatabaseView({ id: 'view-table-default', sourceId: source.id, type: 'table', name: 'table default view' }));
  for (const sibling of value.databaseViews.filter(view => view.sourceId === source.id && view.id !== 'view-gallery')) {
    sibling.visiblePropertyIds = ['title', 'status', 'amount'];
    sibling.config.gallery = { preview: { kind: 'none', propertyId: null }, cardSize: 'large', imageFit: 'cover', visiblePropertyIds: ['status'] };
  }
  value.databaseViews.find(view => view.id === 'view-table-default').visiblePropertyIds = null;
  value.databaseItems.find(item => item.id === 'alpha').values.amount = 0;
  return normalizeLoadedWorkspace(value, { idFactory: prefix => `${prefix}-properties17` });
}

async function openDatabase(page) {
  await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="database-page"]').click();
  const db = page.locator('section.database-view[data-source-id="projects"]');
  await db.waitFor();
  return db;
}
const getView = value => value.databaseViews.find(view => view.id === 'view-gallery');
function assertOnlyGalleryProperties(assert, actual, before, ids) {
  for (const domain of ['pages', 'databaseItems', 'dataSources', 'attachments', 'relations', 'syncedSources']) assert.deepEqual(actual[domain], before[domain], domain);
  assert.equal(actual.databaseViews.length, before.databaseViews.length);
  for (const old of before.databaseViews) {
    const expected = old.id === 'view-gallery' ? { ...old, config: { ...old.config, gallery: { ...old.config.gallery, visiblePropertyIds: ids } } } : old;
    assert.deepEqual(actual.databaseViews.find(view => view.id === old.id), expected, old.id);
  }
}
async function assertCount(db, assert, count) {
  const panel = await openViewSettingsSection(db);
  assert.equal(await panel.getByRole('button', { name: /^显示属性(?:\s|$)/ }).locator('small').innerText(), String(count));
  return panel;
}
async function assertChecks(panel, source, assert, ids) {
  for (const property of source.properties) {
    const checkbox = panel.getByRole('checkbox', { name: `显示 ${property.name}`, exact: true });
    assert.equal(await checkbox.isChecked(), property.type === 'title' || ids.includes(property.id), property.id);
    assert.equal(await checkbox.isDisabled(), property.type === 'title', property.id);
    if (property.type === 'title') assert.match(await checkbox.locator('..').innerText(), /始终显示/);
  }
}

await browserScenario(name('common'), async ({ page, check, assert, saved, persisted, screenshot }) => {
  const db = await openDatabase(page);
  const before = await saved();
  const source = before.dataSources.find(source => source.id === 'projects');
  const alpha = db.locator('.db-gallery-card[data-item-id="alpha"]');
  const waitIds = ids => persisted(value => JSON.stringify(getView(value).config.gallery.visiblePropertyIds) === JSON.stringify(ids));

  await check('Common property count and checkstates match the empty gallery card selection', async () => {
    assert.equal(await db.getAttribute('data-view-id'), 'view-gallery');
    assert.deepEqual(getView(before).config.gallery.visiblePropertyIds, []);
    assert.equal(getView(before).visiblePropertyIds, null);
    assert.equal(await db.locator('.db-gallery-properties').count(), 0);
    const panel = await openViewSettingsSection(db);
    const count = await panel.getByRole('button', { name: /^显示属性(?:\s|$)/ }).locator('small').innerText();
    await panel.getByRole('button', { name: /^显示属性(?:\s|$)/ }).click();
    const states = await panel.getByRole('checkbox').evaluateAll(elements => elements.map(element => ({ label: element.getAttribute('aria-label'), checked: element.checked, disabled: element.disabled })));
    writeFileSync(`${directory}/common-baseline.json`, JSON.stringify({ viewId: 'view-gallery', config: getView(before).config, topLevelVisiblePropertyIds: getView(before).visiblePropertyIds, cardPropertyCount: await db.locator('.db-gallery-properties [data-property-id]').count(), commonCount: count, states }, null, 2));
    await screenshot('empty-common-properties');
    assert.equal(count, '1', 'Notion counts the always shown title while extra card properties remain empty');
    await assertChecks(panel, source, assert, []);
    assertOnlyGalleryProperties(assert, await saved(), before, []);
  });

  await check('Common toggles immediately show and hide actual card values without changing preview or global visibility', async () => {
    const panel = await openViewSettingsSection(db, '显示属性');
    await panel.getByRole('checkbox', { name: '显示 金额', exact: true }).check();
    assertOnlyGalleryProperties(assert, await waitIds(['amount']), before, ['amount']);
    await alpha.locator('[data-property-id="amount"]').waitFor();
    assert.equal((await alpha.locator('[data-property-id="amount"]').innerText()).trim(), '0');
    await panel.getByRole('checkbox', { name: '显示 确认', exact: true }).check();
    assertOnlyGalleryProperties(assert, await waitIds(['amount', 'checked']), before, ['amount', 'checked']);
    await alpha.locator('[data-property-id="checked"]').waitFor();
    assert.equal(await alpha.locator('[data-property-id="checked"] [data-checked="false"]').count(), 1);
    await assertCount(db, assert, 3);
    const again = await openViewSettingsSection(db, '显示属性');
    await assertChecks(again, source, assert, ['amount', 'checked']);
    await again.getByRole('checkbox', { name: '显示 金额', exact: true }).uncheck();
    assertOnlyGalleryProperties(assert, await waitIds(['checked']), before, ['checked']);
    await alpha.locator('[data-property-id="amount"]').waitFor({ state: 'detached' });
    assert.equal(await alpha.locator('[data-property-id="checked"]').count(), 1);
    await assertCount(db, assert, 2);
  });

  await check('Exiting and refreshing keeps the same view ID and config, with matching layout GallerySettings', async () => {
    await setViewSettings(db, false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await db.waitFor();
    assert.equal(await db.getAttribute('data-view-id'), 'view-gallery');
    assertOnlyGalleryProperties(assert, await saved(), before, ['checked']);
    const layout = await openViewSettingsSection(db, '布局');
    await layout.getByRole('button', { name: /^卡片属性/ }).click();
    for (const property of source.properties.filter(property => property.type !== 'title')) assert.equal(await layout.getByRole('checkbox', { name: `显示 ${property.name}`, exact: true }).isChecked(), property.id === 'checked', property.id);
    await layout.getByRole('checkbox', { name: '显示 金额', exact: true }).check();
    assertOnlyGalleryProperties(assert, await waitIds(['checked', 'amount']), before, ['checked', 'amount']);
    await alpha.locator('[data-property-id="amount"]').waitFor();
    await assertCount(db, assert, 3);
    await assertChecks(await openViewSettingsSection(db, '显示属性'), source, assert, ['checked', 'amount']);
    await screenshot('layout-to-common-agreement');
  });

  await check('Turning off every common card property retains zero through exit, reload and layout reopening', async () => {
    const panel = await openViewSettingsSection(db, '显示属性');
    await panel.getByRole('checkbox', { name: '显示 确认', exact: true }).uncheck();
    await waitIds(['amount']);
    await panel.getByRole('checkbox', { name: '显示 金额', exact: true }).uncheck();
    assertOnlyGalleryProperties(assert, await waitIds([]), before, []);
    await db.locator('.db-gallery-properties').waitFor({ state: 'detached' });
    await assertCount(db, assert, 1);
    await page.keyboard.press('Escape');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await db.waitFor();
    assert.equal(await db.getAttribute('data-view-id'), 'view-gallery');
    assertOnlyGalleryProperties(assert, await saved(), before, []);
    assert.equal(await db.locator('.db-gallery-properties').count(), 0);
    await assertCount(db, assert, 1);
    await assertChecks(await openViewSettingsSection(db, '显示属性'), source, assert, []);
    const layout = await openViewSettingsSection(db, '布局');
    await layout.getByRole('button', { name: /^卡片属性/ }).click();
    assert.equal(await layout.locator('.db-v9-property-list input:not(:disabled):checked').count(), 0);
    await screenshot('zero-after-refresh');
  });
}, { workspace: fixture(), viewport: { width: 1440, height: 900 } });

await browserScenario(name('legacy'), async ({ page, check, assert, saved, persisted }) => {
  const db = await openDatabase(page);
  const before = await saved();
  const source = before.dataSources.find(source => source.id === 'projects');
  await check('Existing gallery selection overrides conflicting top-level visibility and survives common edits unchanged elsewhere', async () => {
    await assertCount(db, assert, 3);
    const panel = await openViewSettingsSection(db, '显示属性');
    await assertChecks(panel, source, assert, ['status', 'checked']);
    assert.equal(await db.locator('.db-gallery-card[data-item-id="alpha"] [data-property-id="amount"]').count(), 0);
    await panel.getByRole('checkbox', { name: '显示 状态', exact: true }).uncheck();
    const ids = ['title', 'checked', 'removed-property'];
    const after = await persisted(value => JSON.stringify(getView(value).config.gallery.visiblePropertyIds) === JSON.stringify(ids));
    assertOnlyGalleryProperties(assert, after, before, ids);
    assert.deepEqual(getView(after).visiblePropertyIds, ['title', 'amount']);
    await setViewSettings(db, false);
    await page.reload({ waitUntil: 'domcontentloaded' }); await db.waitFor();
    assertOnlyGalleryProperties(assert, await saved(), before, ids);
    await assertCount(db, assert, 2);
  });
}, { workspace: fixture({ legacy: true }) });

await browserScenario(name('global'), async ({ page, check, assert, saved, persisted }) => {
  const db = await openDatabase(page);
  await check('Every non-gallery layout retains top-level property count and writes without touching inactive gallery config', async () => {
    for (const suffix of ['table', 'board', 'list', 'calendar', 'timeline', 'chart', 'form', 'dashboard', 'map', 'roadmap', 'table-default']) {
      await chooseSavedView(db, `view-${suffix}`);
      const before = await persisted(value => value.pages.find(page => page.id === 'database-page').databaseViewId === `view-${suffix}`);
      const current = before.databaseViews.find(view => view.id === `view-${suffix}`);
      const visible = current.visiblePropertyIds ?? before.dataSources.find(source => source.id === 'projects').properties.map(property => property.id);
      const expectedIds = visible.filter(id => id !== 'amount');
      await assertCount(db, assert, visible.length);
      const panel = await openViewSettingsSection(db, '显示属性');
      assert.equal(await panel.getByRole('checkbox', { name: '显示 名称', exact: true }).isChecked(), true);
      assert.equal(await panel.getByRole('checkbox', { name: '显示 名称', exact: true }).isDisabled(), true);
      const amount = panel.getByRole('checkbox', { name: '显示 金额', exact: true });
      assert.equal(await amount.isChecked(), true);
      if (current.type === 'table') assert.equal(await db.locator('.db-table td[data-property-id="amount"]').count(), 3);
      await amount.uncheck();
      const after = await persisted(value => JSON.stringify(value.databaseViews.find(view => view.id === current.id).visiblePropertyIds) === JSON.stringify(expectedIds));
      assert.deepEqual(after.databaseViews.find(view => view.id === current.id), { ...current, visiblePropertyIds: expectedIds }, suffix);
      for (const old of before.databaseViews.filter(view => view.id !== current.id)) assert.deepEqual(after.databaseViews.find(view => view.id === old.id), old);
      for (const domain of ['dataSources', 'databaseItems', 'attachments', 'relations']) assert.deepEqual(after[domain], before[domain], domain);
      assert.deepEqual(after.pages, before.pages);
      if (current.type === 'table') {
        assert.equal(await db.locator('.db-table td[data-property-id="amount"]').count(), 0);
      }
      await assertCount(db, assert, expectedIds.length);
      await setViewSettings(db, false);
    }
  });
}, { workspace: fixture() });

await browserScenario(name('locked'), async ({ page, check, assert, saved, screenshot }) => {
  const db = await openDatabase(page);
  const before = await saved();
  await check('Locked gallery exposes no write controls, and opening or refreshing preserves all entity domains', async () => {
    assert.equal(await db.getByRole('button', { name: '视图设置', exact: true }).count(), 0);
    assert.equal(await db.getByRole('button', { name: '添加视图', exact: true }).count(), 0);
    assert.equal(await db.getByRole('button', { name: '新建页面', exact: true }).count(), 0);
    await db.locator('.db-gallery-card[data-item-id="alpha"] .db-gallery-open').click();
    await page.getByRole('dialog', { name: '记录预览', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.reload({ waitUntil: 'domcontentloaded' }); await db.waitFor();
    assertOnlyGalleryProperties(assert, await saved(), before, []);
    assert.equal(await db.getByRole('button', { name: '视图设置', exact: true }).count(), 0);
    await screenshot('locked-gallery');
  });
}, { workspace: fixture({ locked: true }) });
