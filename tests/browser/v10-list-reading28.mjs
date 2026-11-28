import { mkdirSync, existsSync } from 'node:fs';
import { browserScenario } from './harness.mjs';
import { coreParityWorkspace } from '../fixtures/core-parity-workspace.mjs';
import { openViewSettingsSection, setViewSettings, chooseSavedView } from './database-navigation.mjs';

const run = process.env.V10_LIST_READING_RUN || 'prepared01';
if (!/^[a-z0-9-]+$/.test(run)) throw new Error('Invalid run');
const root = `LOCAL-NOTION-001/v10-list-reading28/${run}`;
mkdirSync(`.qa/${root}`, { recursive: true });
for (const part of ['alignment', 'reading', 'symptom', 'default', 'properties', 'footer', 'locked', 'itemlocked', 'inline', 'full']) if (existsSync(`.qa/${root}/${part}.json`)) throw new Error('Run label already exists');
function fixture({ locked = false, visible = null } = {}) {
  const w = coreParityWorkspace();
  w.ui.preferences = { style: 'mobai', theme: 'light' };
  const owner = w.pages.find(p => p.id === 'database-page'); owner.databaseViewId = 'view-list'; owner.settings.locked = locked;
  const view = w.databaseViews.find(v => v.id === 'view-list'); view.visiblePropertyIds = visible;
  const other = structuredClone(view); other.id = 'view-list-second'; other.name = 'second list'; other.visiblePropertyIds = []; w.databaseViews.push(other);
  const alpha = w.databaseItems.find(i => i.id === 'alpha'); alpha.values.amount = 0; alpha.values.notes = '';
  w.pages.find(p => p.id === 'alpha-page').icon = '🚀';
  return w;
}
async function open(page) { await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="database-page"]').click(); const db = page.locator('section.database-view[data-source-id="projects"]'); await db.waitFor(); return db; }
const view = (w, id = 'view-list') => w.databaseViews.find(v => v.id === id);

const alignmentFixture = fixture();
alignmentFixture.databaseItems.find(i => i.id === 'beta').values.title = 'A much longer title in the same list '.repeat(12);
alignmentFixture.pages.find(p => p.id === 'beta-page').title = 'A much longer title in the same list '.repeat(12);
await browserScenario(`${root}/alignment`, async ({ page, check, assert, screenshot }) => {
  const db = await open(page);
  await check('Status aligns to the right across short and long titles at desktop and 700px', async () => {
    for (const width of [1440, 700]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await db.locator('.db-list-view').evaluate(el => {
        const rows = ['alpha', 'beta'].map(id => { const row = el.querySelector(`[data-item-id="${id}"]`); const status = row.querySelector('[data-property-id="status"]'); const r = row.getBoundingClientRect(), s = status.getBoundingClientRect(); return { right: r.right, statusRight: s.right, left: s.left, rowLeft: r.left }; });
        return { rows, pageOverflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.ok(Math.abs(geometry.rows[0].statusRight - geometry.rows[1].statusRight) <= 2, JSON.stringify(geometry));
      for (const row of geometry.rows) assert.ok(row.right - row.statusRight <= 12 && row.statusRight <= row.right && row.left >= row.rowLeft, JSON.stringify(geometry));
      assert.equal(geometry.pageOverflow, false);
    }
    await screenshot('alignment-700');
  });
}, { workspace: alignmentFixture });

const readingFixture = fixture({ visible: ['status', 'amount', 'checked', 'notes'] });
readingFixture.databaseItems.find(i => i.id === 'alpha').values.notes = 'Initial note';
await browserScenario(`${root}/reading`, async ({ page, check, assert, saved, persisted }) => {
  const db = await open(page); const row = db.locator('.db-list-row[data-item-id="alpha"]');
  await check('Text and number read as values, edit on demand, save and cancel locally', async () => {
    const before = await saved();
    assert.equal(await row.locator('[data-property-id="amount"] input, [data-property-id="notes"] input, [data-property-id="notes"] textarea').count(), 0);
    const number = row.getByRole('button', { name: '金额 · Alpha 项目', exact: true });
    const text = row.getByRole('button', { name: '说明 · Alpha 项目', exact: true });
    assert.equal((await number.innerText()).trim(), '0'); assert.equal((await text.innerText()).trim(), 'Initial note');
    assert.equal(await row.locator('[data-property-id="checked"] input').isChecked(), false);
    assert.deepEqual((await saved()).databaseItems, before.databaseItems);
    await number.click();
    let dialog = page.getByRole('dialog', { name: '编辑 金额 · Alpha 项目' });
    let numberInput = dialog.getByLabel('金额 · Alpha 项目', { exact: true }); await numberInput.fill('9'); await numberInput.press('Escape');
    assert.equal((await saved()).databaseItems.find(i => i.id === 'alpha').values.amount, 0);
    assert.equal(await number.evaluate(el => document.activeElement === el), true);
    await number.click(); dialog = page.getByRole('dialog', { name: '编辑 金额 · Alpha 项目' });
    numberInput = dialog.getByLabel('金额 · Alpha 项目', { exact: true }); await numberInput.fill('invalid'); await numberInput.press('Enter');
    await dialog.getByRole('alert').waitFor();
    assert.equal((await saved()).databaseItems.find(i => i.id === 'alpha').values.amount, 0);
    await numberInput.fill('42'); await numberInput.press('Enter');
    await persisted(w => w.databaseItems.find(i => i.id === 'alpha').values.amount === 42);
    assert.equal(await number.evaluate(el => document.activeElement === el), true);
    await text.click(); dialog = page.getByRole('dialog', { name: '编辑 说明 · Alpha 项目' });
    let input = dialog.getByLabel('说明 · Alpha 项目', { exact: true }); await input.fill('Cancelled'); await input.press('Escape');
    assert.equal(await text.evaluate(el => document.activeElement === el), true);
    assert.equal((await saved()).databaseItems.find(i => i.id === 'alpha').values.notes, 'Initial note');
    await text.click(); input = page.getByRole('dialog', { name: '编辑 说明 · Alpha 项目' }).getByLabel('说明 · Alpha 项目', { exact: true });
    await input.fill('Saved on blur'); await db.locator('.db-list-row[data-item-id="beta"] .db-list-open').focus();
    const after = await persisted(w => w.databaseItems.find(i => i.id === 'alpha').values.notes === 'Saved on blur');
    await text.click(); input = page.getByRole('dialog', { name: '编辑 说明 · Alpha 项目' }).getByLabel('说明 · Alpha 项目', { exact: true });
    await input.fill('Saved with Enter'); await input.press('Enter');
    await persisted(w => w.databaseItems.find(i => i.id === 'alpha').values.notes === 'Saved with Enter');
    await number.click(); numberInput = page.getByRole('dialog', { name: '编辑 金额 · Alpha 项目' }).getByLabel('金额 · Alpha 项目', { exact: true });
    await numberInput.fill('43'); await db.locator('.db-list-row[data-item-id="beta"] .db-list-open').focus();
    await persisted(w => w.databaseItems.find(i => i.id === 'alpha').values.amount === 43);
    await text.click(); input = page.getByRole('dialog', { name: '编辑 说明 · Alpha 项目' }).getByLabel('说明 · Alpha 项目', { exact: true });
    await input.fill('Saved by outside click'); await db.locator('.db-list-view').click({ position: { x: 2, y: 2 } });
    await persisted(w => w.databaseItems.find(i => i.id === 'alpha').values.notes === 'Saved by outside click');
    assert.deepEqual(after.databaseItems.filter(i => i.id !== 'alpha'), before.databaseItems.filter(i => i.id !== 'alpha'));
    assert.deepEqual(after.dataSources, before.dataSources);
    assert.equal(await page.getByRole('dialog', { name: '记录预览' }).count(), 0);
  });
}, { workspace: readingFixture });

await browserScenario(`${root}/symptom`, async ({ page, check, assert }) => {
  const db = await open(page);
  await check('Clicking Alpha status opens a picker and does not open the record', async () => {
    await db.locator('.db-list-row').filter({ hasText: 'Alpha 项目' }).getByText('进行中', { exact: true }).click();
    assert.equal(await page.getByRole('dialog', { name: '记录预览' }).count(), 0);
    assert.equal(await page.locator('.db-option-panel').count(), 1);
  });
}, { workspace: fixture() });

await browserScenario(`${root}/default`, async ({ page, check, assert, saved, persisted, screenshot }) => {
  const db = await open(page); const before = await saved();
  await check('Default count matches title and first status without writes', async () => {
    const panel = await openViewSettingsSection(db);
    assert.equal(await panel.getByRole('button', { name: /^显示属性(?:\s|$)/ }).locator('small').innerText(), '2');
    await panel.getByRole('button', { name: /^显示属性(?:\s|$)/ }).click();
    assert.equal(await panel.getByRole('checkbox', { name: '显示 状态' }).isChecked(), true);
    assert.equal(await panel.getByRole('checkbox', { name: '显示 金额' }).isChecked(), false);
    await setViewSettings(db, false);
    assert.deepEqual((await saved()).databaseItems, before.databaseItems);
    assert.equal(view(await saved()).visiblePropertyIds, null);
    assert.equal(await db.locator('.db-list-row[data-item-id="alpha"] .db-list-icon').innerText(), '🚀');
  });
  await check('Status opens local picker, Escape restores focus, selection saves without opening record', async () => {
    const row = db.locator('.db-list-row[data-item-id="alpha"]');
    const trigger = row.locator('[data-property-id="status"] summary');
    await trigger.click();
    assert.equal(await page.getByRole('dialog', { name: '记录预览' }).count(), 0);
    await page.keyboard.press('Escape');
    assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
    await trigger.click();
    await page.getByRole('option', { name: '完成', exact: true }).click();
    const after = await persisted(w => w.databaseItems.find(i => i.id === 'alpha').values.status === 'done');
    assert.equal(after.databaseItems.find(i => i.id === 'alpha').pageId, 'alpha-page');
    assert.equal(after.databaseItems.find(i => i.id === 'alpha').sourceId, 'projects');
    assert.deepEqual(after.dataSources, before.dataSources);
    assert.deepEqual(after.databaseItems.filter(i => i.id !== 'alpha'), before.databaseItems.filter(i => i.id !== 'alpha'));
    assert.equal(await page.getByRole('dialog', { name: '记录预览' }).count(), 0);
    assert.equal(await row.locator('button button').count(), 0);
    await row.locator('.db-list-open').click(); await page.getByRole('dialog', { name: '记录预览' }).waitFor();
    await page.keyboard.press('Escape'); await screenshot('light');
  });
}, { workspace: fixture(), viewport: { width: 1440, height: 900 } });

await browserScenario(`${root}/properties`, async ({ page, check, assert, saved, persisted, screenshot }) => {
  const db = await open(page);
  await check('Explicit visibility includes zero and false, excludes empty, and isolates sibling view', async () => {
    const before = await saved();
    const panel = await openViewSettingsSection(db, '显示属性');
    await panel.getByRole('checkbox', { name: '显示 金额' }).check();
    await panel.getByRole('checkbox', { name: '显示 确认' }).check();
    await panel.getByRole('checkbox', { name: '显示 说明' }).check();
    const after = await persisted(w => view(w).visiblePropertyIds?.includes('notes'));
    assert.deepEqual(view(after, 'view-list-second'), view(before, 'view-list-second'));
    assert.deepEqual(after.dataSources, before.dataSources); assert.deepEqual(after.databaseItems, before.databaseItems);
    await setViewSettings(db, false);
    const row = db.locator('.db-list-row[data-item-id="alpha"]');
    assert.equal(await row.locator('[data-property-id="amount"]').count(), 1);
    assert.equal(await row.locator('[data-property-id="checked"]').count(), 1);
    assert.equal(await row.locator('[data-property-id="notes"]').count(), 0);
    const again = await openViewSettingsSection(db, '显示属性');
    await again.getByRole('checkbox', { name: '显示 状态' }).uncheck();
    await persisted(w => !view(w).visiblePropertyIds.includes('status'));
    await setViewSettings(db, false);
    assert.equal(await row.locator('[data-property-id="status"]').count(), 0);
    await chooseSavedView(db, 'view-list-second');
    assert.equal(await db.locator('.db-list-row[data-item-id="alpha"] [data-property-id]').count(), 0);
    const emptySettings = await openViewSettingsSection(db);
    assert.equal(await emptySettings.getByRole('button', { name: /^显示属性(?:\s|$)/ }).locator('small').innerText(), '1');
    await setViewSettings(db, false);
    await persisted(w => w.pages.find(p => p.id === 'database-page').databaseViewId === 'view-list-second');
    await page.reload({ waitUntil: 'domcontentloaded' }); await db.waitFor();
    assert.deepEqual(view(await saved(), 'view-list-second').visiblePropertyIds, []);
    assert.equal(await db.locator('.db-list-row[data-item-id="alpha"] [data-property-id]').count(), 0);
    await chooseSavedView(db, 'view-list');
    await row.locator('.db-list-edit').click();
    await db.getByPlaceholder('Type a name').fill('Long title '.repeat(30)); await page.keyboard.press('Enter');
    await page.setViewportSize({ width: 700, height: 900 });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    assert.equal(await db.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await screenshot('narrow-dark');
  });
}, { workspace: fixture(), viewport: { width: 1440, height: 900 } });

await browserScenario(`${root}/footer`, async ({ page, check, assert, saved, persisted }) => {
  const db = await open(page);
  await check('New creates one blank record in place, Escape retains it and later Enter updates same record', async () => {
    const before = await saved();
    await db.getByRole('button', { name: '新建页面', exact: true }).click();
    const input = db.getByPlaceholder('Type a name'); await input.waitFor();
    assert.equal(await input.evaluate(el => document.activeElement === el), true);
    assert.equal(await page.getByRole('dialog', { name: '记录预览' }).count(), 0);
    const created = await persisted(w => w.databaseItems.length === before.databaseItems.length + 1);
    const item = created.databaseItems.find(i => !before.databaseItems.some(old => old.id === i.id));
    assert.equal(item.sourceId, 'projects'); assert.equal(created.pages.filter(p => p.id === item.pageId).length, 1);
    await page.keyboard.press('Escape');
    const row = db.locator(`.db-list-row[data-item-id="${item.id}"]`); await row.waitFor();
    assert.equal(await row.evaluate(el => document.activeElement === el), true);
    assert.equal((await saved()).databaseItems.filter(i => i.id === item.id).length, 1);
    await row.getByRole('button', { name: /编辑标题/ }).click();
    await db.getByPlaceholder('Type a name').blur();
    assert.equal((await saved()).databaseItems.filter(i => i.id === item.id).length, 1);
    await page.reload({ waitUntil: 'domcontentloaded' }); await db.waitFor();
    assert.equal((await saved()).databaseItems.filter(i => i.id === item.id && i.pageId === item.pageId).length, 1);
    await row.getByRole('button', { name: /编辑标题/ }).click();
    await db.getByPlaceholder('Type a name').fill('Created list record'); await page.keyboard.press('Enter');
    const final = await persisted(w => w.databaseItems.find(i => i.id === item.id)?.values.title === 'Created list record');
    assert.equal(final.databaseItems.length, before.databaseItems.length + 1); assert.equal(final.databaseItems.find(i => i.id === item.id).pageId, item.pageId);
    await row.getByRole('button', { name: /编辑标题/ }).click();
    await db.getByPlaceholder('Type a name').fill('Saved on blur');
    await db.getByRole('button', { name: '新建页面', exact: true }).focus();
    await persisted(w => w.databaseItems.find(i => i.id === item.id)?.values.title === 'Saved on blur');
    assert.equal(await db.getByRole('button', { name: '新建页面', exact: true }).evaluate(el => document.activeElement === el), true);
    await row.getByRole('button', { name: /编辑标题/ }).click();
    await db.getByPlaceholder('Type a name').fill('Discard this draft'); await page.keyboard.press('Escape');
    assert.equal((await saved()).databaseItems.find(i => i.id === item.id).values.title, 'Saved on blur');
  });
}, { workspace: fixture() });

await browserScenario(`${root}/locked`, async ({ page, check, assert, saved }) => {
  const db = await open(page);
  await check('Locked list reads and opens without write controls or mutations', async () => {
    const before = await saved();
    assert.equal(await db.getByRole('button', { name: '新建页面', exact: true }).count(), 0);
    assert.equal(await db.locator('.db-list-row summary').count(), 0);
    const checkbox = db.locator('.db-list-row[data-item-id="alpha"] [data-property-id="checked"] input');
    assert.equal(await checkbox.isDisabled(), true); assert.equal(await checkbox.isChecked(), false);
    await db.locator('.db-list-row[data-item-id="alpha"] .db-list-open').click();
    await page.getByRole('dialog', { name: '记录预览' }).waitFor(); await page.keyboard.press('Escape');
    const after = await saved(); assert.deepEqual(after.databaseItems, before.databaseItems); assert.deepEqual(after.dataSources, before.dataSources);
  });
}, { workspace: fixture({ locked: true, visible: ['checked'] }) });

const itemLockedFixture = fixture({ visible: ['status', 'amount', 'notes'] }); itemLockedFixture.pages.find(p => p.id === 'alpha-page').settings.locked = true;
itemLockedFixture.databaseItems.find(i => i.id === 'alpha').values.notes = 'Locked note';
await browserScenario(`${root}/itemlocked`, async ({ page, check, assert, saved }) => {
  const db = await open(page);
  await check('Record lock suppresses local edits without locking sibling records', async () => {
    const before = await saved();
    const alpha = db.locator('.db-list-row[data-item-id="alpha"]');
    const beta = db.locator('.db-list-row[data-item-id="beta"]');
    assert.equal(await alpha.locator('summary').count(), 0);
    assert.equal(await alpha.getByRole('button', { name: /编辑标题/ }).count(), 0);
    assert.equal((await alpha.locator('[data-property-id="amount"]').innerText()).trim(), '0');
    assert.equal((await alpha.locator('[data-property-id="notes"]').innerText()).trim(), 'Locked note');
    assert.equal(await alpha.locator('[data-property-id="amount"] button, [data-property-id="notes"] button, [data-property-id="amount"] input, [data-property-id="notes"] input').count(), 0);
    assert.equal(await beta.locator('summary').count(), 1);
    await alpha.locator('.db-list-open').click(); await page.getByRole('dialog', { name: '记录预览' }).waitFor();
    await page.keyboard.press('Escape');
    assert.deepEqual((await saved()).databaseItems, before.databaseItems);
  });
}, { workspace: itemLockedFixture });

const inlineFixture = fixture();
inlineFixture.ui.selectedPageId = 'editor-page';
inlineFixture.pages.find(p => p.id === 'editor-page').content = [{ id: 'list-inline28', type: 'databaseView', props: { sourceId: 'projects', viewId: 'view-list' } }];
await browserScenario(`${root}/inline`, async ({ page, check, assert }) => {
  await check('Inline list opens the selected record in its configured peek', async () => {
    await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="editor-page"]').click();
    const db = page.locator('section.database-view[data-source-id="projects"]'); await db.waitFor();
    await db.locator('.db-list-row[data-item-id="alpha"] .db-list-open').click();
    const dialog = page.getByRole('dialog', { name: '记录预览' }); await dialog.waitFor();
    assert.match(await dialog.innerText(), /Alpha 项目/);
  });
}, { workspace: inlineFixture });

const fullFixture = fixture();
view(fullFixture).config.openRecordsIn = 'page';
await browserScenario(`${root}/full`, async ({ page, check, assert, persisted }) => {
  const db = await open(page);
  await check('Full-page setting opens the original item page', async () => {
    await db.locator('.db-list-row[data-item-id="alpha"] .db-list-open').click();
    const result = await persisted(w => w.ui.selectedPageId === 'alpha-page');
    assert.equal(result.databaseItems.find(i => i.id === 'alpha').pageId, 'alpha-page');
    assert.equal(await page.getByRole('dialog', { name: '记录预览' }).count(), 0);
  });
}, { workspace: fullFixture });
