import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { browserScenario } from './harness.mjs';
import { coreParityWorkspace } from '../fixtures/core-parity-workspace.mjs';
import { walkBlocks } from '../../src/domain/blockDocument.js';

// Each case gets a fresh browser context and its own fixture. No runtime is mocked.
const run = process.env.V10_NESTED_IDENTITY_RUN || 'prepared01';
if (!/^[a-z0-9-]+$/.test(run)) throw new Error('Invalid identity run label');
const root = '.qa/LOCAL-NOTION-001/v10-nested-database13/identity';
mkdirSync(root, { recursive: true });
const cases = [
  { key: 'inline-peek', label: '数据库 - 行内', inPeek: true, linked: false },
  { key: 'layout-full', label: '表格视图', inPeek: false, linked: false, expectedViewType: 'table' },
  { key: 'linked-full', label: '数据源的链接视图', inPeek: false, linked: true },
  { key: 'ordinarycalendar-full', label: '日历视图', inPeek: false, linked: false, expectedViewType: 'calendar' },
];
for (const entry of cases) {
  if (existsSync(`${root}/${run}-${entry.key}.json`)) throw new Error(`Report exists: ${run}-${entry.key}; choose a new V10_NESTED_IDENTITY_RUN`);
}

const ids = (items) => items.map((item) => item.id).sort();
const sourceItems = (state, sourceId) => state.databaseItems.filter((item) => item.sourceId === sourceId);
const sourceViews = (state, sourceId) => state.databaseViews.filter((view) => view.sourceId === sourceId);
const blocks = (state, pageId) => walkBlocks(state.pages.find((p) => p.id === pageId)?.content || []).filter((b) => b.type === 'databaseView');
const saveStage = (entry, stage, state) => writeFileSync(`${root}/${run}-${entry.key}-${stage}.json`, JSON.stringify(state, null, 2));

for (const entry of cases) {
  const workspace = coreParityWorkspace();
  workspace.ui.preferences = { theme: 'system', style: 'mobai' };
  workspace.databaseViews.find((view) => view.id === 'view-calendar').config = { calendar: { datePropertyId: 'date', mode: 'month', startOfWeek: 0, showWeekends: true, anchorDate: '2026-11-01' } };
  const name = `LOCAL-NOTION-001/v10-nested-database13/identity/${run}-${entry.key}`;
  await browserScenario(name, async ({ page, check, saved, persisted, assert }) => {
    let record, beforeInsert, block, childSourceId, childViewId, afterCreate;
    const parentId = 'projects';
    const parentDb = page.locator(`section.database-view[data-source-id="${parentId}"]`);
    const recordTitle = `V10 nested ${entry.key}`;
    await check('Create a calendar record and enter its actual body', async () => {
      await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="database-page"]').click();
      await parentDb.locator('[role="tab"][data-view-id="view-calendar"]').click();
      const before = await saved();
      await parentDb.locator('.db-calendar-cell[data-date="2026-11-11"]').getByRole('button', { name: /新建页面/ }).click();
      const peek = page.getByRole('dialog', { name: '记录预览', exact: true });
      await peek.waitFor();
      const created = await persisted((state) => state.databaseItems.length === before.databaseItems.length + 1);
      const added = created.databaseItems.filter((item) => !before.databaseItems.some((old) => old.id === item.id));
      assert.equal(added.length, 1);
      record = added[0];
      assert.equal(record.sourceId, parentId);
      assert.equal(record.values.date.start, '2026-11-11');
      await peek.getByRole('textbox', { name: '记录标题', exact: true }).fill(recordTitle);
      await persisted((state) => state.databaseItems.find((item) => item.id === record.id)?.values.title === recordTitle);
      if (!entry.inPeek) await peek.getByRole('button', { name: '打开完整页面', exact: true }).click();
      await page.locator(`.life-editor[data-page-id="${record.pageId}"] .bn-editor`).waitFor();
      beforeInsert = await saved();
      assert.ok(sourceItems(beforeInsert, parentId).some((item) => item.id === 'alpha'));
      assert.ok(sourceViews(beforeInsert, parentId).length > 1);
      assert.equal(blocks(beforeInsert, record.pageId).length, 0);
      saveStage(entry, 'before-insert', beforeInsert);
    });

    await check(entry.linked ? 'Explicit Linked selection shares the chosen source' : 'Ordinary slash insertion creates a distinct source owned by the record', async () => {
      const editor = page.locator(`.life-editor[data-page-id="${record.pageId}"] .bn-editor`);
      await editor.locator('.bn-block-content').first().click();
      await page.keyboard.type('/');
      const options = page.locator('[role="option"]:visible');
      await options.first().waitFor();
      await options.filter({ hasText: entry.label }).first().click();
      let inserted = await persisted((state) => blocks(state, record.pageId).length === 1);
      if (entry.linked) {
        const picker = editor.locator('.db-source-picker');
        await picker.getByRole('button', { name: '项目数据库', exact: true }).click();
        inserted = await persisted((state) => blocks(state, record.pageId)[0]?.props?.sourceId === parentId);
      }
      saveStage(entry, 'insert', inserted);
      block = blocks(inserted, record.pageId)[0];
      childSourceId = block.props.sourceId;
      childViewId = block.props.viewId;
      assert.ok(childSourceId && childViewId, 'inserted block must persist both identities');
      if (entry.linked) {
        assert.equal(childSourceId, parentId);
        assert.deepEqual(ids(inserted.dataSources), ids(beforeInsert.dataSources));
        assert.equal(sourceViews(inserted, parentId).length, sourceViews(beforeInsert, parentId).length + 1);
        assert.equal(inserted.databaseViews.find((view) => view.id === childViewId)?.sourceId, parentId);
      } else {
        assert.notEqual(childSourceId, parentId, 'ordinary New must not share parent source');
        const newSources = inserted.dataSources.filter((source) => !beforeInsert.dataSources.some((old) => old.id === source.id));
        assert.equal(newSources.length, 1);
        assert.equal(newSources[0].id, childSourceId);
        assert.equal(newSources[0].ownerPageId, record.pageId, 'record body owns its newly created source');
        assert.deepEqual(ids(sourceItems(inserted, childSourceId)), []);
        assert.deepEqual(ids(sourceViews(inserted, parentId)), ids(sourceViews(beforeInsert, parentId)));
        assert.deepEqual(ids(sourceViews(inserted, childSourceId)), [childViewId]);
        assert.equal(inserted.databaseViews.find((view) => view.id === childViewId)?.sourceId, childSourceId);
        if (entry.expectedViewType) assert.equal(inserted.databaseViews.find((view) => view.id === childViewId)?.type, entry.expectedViewType);
      }
      const child = editor.locator(`section.database-view[data-source-id="${childSourceId}"]`);
      await child.waitFor();
      if (entry.linked) assert.ok(await child.getByText('Alpha 项目', { exact: true }).count() > 0);
      else assert.equal(await child.getByText('Alpha 项目', { exact: true }).count(), 0);
    });

    await check(entry.linked ? 'A record created through Linked is added to the chosen source' : 'A child record does not add a parent record', async () => {
      // Open the same calendar record as a full page before interacting with its nested database.
      if (entry.inPeek) {
        await page.getByRole('dialog', { name: '记录预览', exact: true }).getByRole('button', { name: '打开完整页面', exact: true }).click();
      }
      const editor = page.locator(`.life-editor[data-page-id="${record.pageId}"] .bn-editor`);
      const child = editor.locator(`section.database-view[data-source-id="${childSourceId}"]`);
      await child.waitFor();
      const before = await saved();
      await child.getByRole('button', { name: '新建记录', exact: true }).click();
      const created = await persisted((state) => state.databaseItems.length === before.databaseItems.length + 1);
      const newItems = created.databaseItems.filter((item) => !before.databaseItems.some((old) => old.id === item.id));
      assert.equal(newItems.length, 1);
      assert.equal(newItems[0].sourceId, childSourceId);
      assert.ok(created.pages.some((candidate) => candidate.id === newItems[0].pageId));
      if (entry.linked) assert.equal(sourceItems(created, parentId).length, sourceItems(before, parentId).length + 1);
      else {
        assert.deepEqual(ids(sourceItems(created, parentId)), ids(sourceItems(before, parentId)));
        assert.equal(sourceItems(created, childSourceId).length, 1);
      }
      afterCreate = created;
      saveStage(entry, 'record-created', created);
      const nestedPeek = page.getByRole('dialog', { name: '记录预览', exact: true });
      if (await nestedPeek.isVisible()) await nestedPeek.getByRole('button', { name: '关闭预览', exact: true }).click();
    });

    await check('Reload preserves source, view and record identities', async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator(`.life-editor[data-page-id="${record.pageId}"] .bn-editor`).waitFor();
      const reloaded = await persisted((state) => blocks(state, record.pageId).some((candidate) => candidate.id === block.id));
      saveStage(entry, 'reload', reloaded);
      assert.deepEqual(blocks(reloaded, record.pageId).find((candidate) => candidate.id === block.id)?.props, block.props);
      assert.deepEqual(ids(sourceItems(reloaded, parentId)), ids(sourceItems(afterCreate, parentId)));
      assert.deepEqual(ids(sourceItems(reloaded, childSourceId)), ids(sourceItems(afterCreate, childSourceId)));
      assert.deepEqual(ids(sourceViews(reloaded, parentId)), ids(sourceViews(afterCreate, parentId)));
      assert.deepEqual(ids(sourceViews(reloaded, childSourceId)), ids(sourceViews(afterCreate, childSourceId)));
      assert.equal(reloaded.databaseViews.find((view) => view.id === childViewId)?.sourceId, childSourceId);
      if (entry.expectedViewType) assert.equal(reloaded.databaseViews.find((view) => view.id === childViewId)?.type, entry.expectedViewType);
      const child = page.locator(`.life-editor[data-page-id="${record.pageId}"] section.database-view[data-source-id="${childSourceId}"]`);
      await child.waitFor();
      if (entry.linked) assert.ok(await child.getByText('Alpha 项目', { exact: true }).count() > 0);
      else assert.equal(await child.getByText('Alpha 项目', { exact: true }).count(), 0);
    });
  }, { workspace, now: '2026-11-10T12:00:00.000Z' });
}
