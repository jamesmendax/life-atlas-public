import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { browserScenario } from './harness.mjs';
import { coreParityWorkspace } from '../fixtures/core-parity-workspace.mjs';

const run = process.env.V10_RECORD_READING_RUN || 'local';
if (!/^[a-z0-9-]+$/.test(run)) throw new Error('Invalid record reading run label');
const dir = '.qa/LOCAL-NOTION-001/v10-calendar-peek14/record';
mkdirSync(dir, { recursive: true });
for (const suffix of ['main', 'locked']) {
  if (existsSync(`${dir}/${run}-${suffix}.json`)) throw new Error(`Evidence already exists for ${run}-${suffix}`);
}

function fixture(locked = false) {
  const workspace = coreParityWorkspace();
  const source = workspace.dataSources.find(entry => entry.id === 'projects');
  const text = source.properties.find(property => property.id === 'notes');
  source.properties.push({ ...structuredClone(text), id: 'record-blank-name', name: '' });
  source.properties.push({ ...structuredClone(source.properties.find(property => property.id === 'amount')), id: 'record-empty-number', name: '空数字' });
  const item = workspace.databaseItems.find(entry => entry.id === 'alpha');
  item.values.notes = '';
  item.values.amount = 0;
  item.values.url = null;
  item.values['record-blank-name'] = '';
  item.values['record-empty-number'] = null;
  const record = workspace.pages.find(entry => entry.id === 'alpha-page');
  record.settings.locked = locked;
  record.content = [
    { id: 'record-reading-calendar', type: 'databaseView', props: { sourceId: 'projects', viewId: 'view-calendar' } },
    { id: 'record-reading-tail', type: 'paragraph', content: '' },
  ];
  const host = workspace.pages.find(entry => entry.id === 'editor-page');
  host.content = [{ id: 'record-reading-host', type: 'databaseView', props: { sourceId: 'projects', viewId: 'view-table' } }];
  workspace.ui.selectedPageId = host.id;
  workspace.ui.preferences = { style: 'mobai', theme: 'system' };
  return workspace;
}

const reports = [];
reports.push(await browserScenario(`LOCAL-NOTION-001/v10-calendar-peek14/record/${run}-main`, async ({ page, check, assert, saved, persisted, screenshot }) => {
  const host = page.locator('[data-id="record-reading-host"] section.database-view');
  const cell = host.locator('tr[data-item-id="alpha"] td[data-property-id="title"]');
  const peek = page.getByRole('dialog', { name: '记录预览', exact: true });
  const property = id => peek.locator(`.db-record-property[data-property-id="${id}"]`);
  const text = property('notes').getByRole('textbox', { name: '说明', exact: true });
  const number = property('amount').getByRole('textbox', { name: '金额', exact: true });
  const url = property('url').getByRole('textbox', { name: '链接', exact: true });
  const getItem = state => state.databaseItems.find(item => item.id === 'alpha');

  await check('Empty properties display placeholders without writing values', async () => {
    await host.waitFor();
    const before = await saved();
    await cell.locator('.db-title-control').hover();
    await cell.locator('.db-title-open').click();
    await peek.waitFor();
    assert.equal(await peek.getByRole('textbox', { name: '记录标题', exact: true }).evaluate(element => element === document.activeElement), true);
    assert.equal(await text.inputValue(), '');
    assert.equal(await text.getAttribute('placeholder'), '空');
    assert.equal(await url.inputValue(), '');
    assert.equal(await url.getAttribute('placeholder'), '空');
    assert.equal(await number.inputValue(), '0');
    assert.equal(await property('record-empty-number').getByRole('textbox', { name: '空数字', exact: true }).inputValue(), '');
    assert.equal(await property('record-empty-number').getByRole('textbox', { name: '空数字', exact: true }).getAttribute('placeholder'), '空');
    assert.equal(await property('record-blank-name').locator('.db-record-property-label > span').innerText(), '');
    assert.equal(await property('record-blank-name').locator('svg[aria-hidden="true"]').count(), 1);
    assert.equal(getItem(await saved()).values.notes, '');
    assert.equal(getItem(await saved()).values.url, null);
    assert.equal(getItem(await saved()).values.amount, 0);
    assert.equal(getItem(await saved()).values.checked, false);
    assert.deepEqual(getItem(await saved()).values, getItem(before).values);
    assert.equal((await saved()).dataSources.find(source => source.id === 'projects').properties.find(entry => entry.id === 'record-blank-name').name, '');
  });

  await check('Record preview and embedded calendar stay accessible in day night and narrow windows', async () => {
    await screenshot('peek-day');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await screenshot('peek-night');
    await page.setViewportSize({ width: 520, height: 740 });
    const bounds = await peek.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 520 && bounds.y + bounds.height <= 740);
    await peek.getByRole('button', { name: '关闭预览', exact: true }).focus();
    assert.equal(await peek.getByRole('button', { name: '关闭预览', exact: true }).evaluate(element => element === document.activeElement), true);
    const scroller = peek.locator('[data-id="record-reading-calendar"] .db-calendar-scroller');
    await scroller.scrollIntoViewIfNeeded();
    const scroll = await scroller.evaluate(element => {
      element.scrollLeft = element.scrollWidth;
      return { client: element.clientWidth, width: element.scrollWidth, left: element.scrollLeft };
    });
    assert.ok(scroll.client > 0 && scroll.width > scroll.client && scroll.left > 0);
    await screenshot('peek-narrow-calendar-night');
    await page.setViewportSize({ width: 1440, height: 1040 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await text.scrollIntoViewIfNeeded();
  });

  await check('Escape cancels text and Enter commits without changing zero', async () => {
    await text.fill('不应保存');
    await text.press('Escape');
    assert.equal(await text.inputValue(), '');
    assert.equal(getItem(await saved()).values.notes, '');
    await text.fill('记录属性编辑');
    await text.press('Enter');
    const after = await persisted(state => getItem(state).values.notes === '记录属性编辑');
    assert.equal(getItem(after).values.amount, 0);
    assert.equal(getItem(after).values.url, null);
  });

  await check('Long text remains visible while editing and survives blur and reload', async () => {
    const longText = '长文本记录内容 '.repeat(45);
    await text.fill(longText);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await text.inputValue(), longText);
    const dimensions = await text.evaluate(element => ({ client: element.clientHeight, scroll: element.scrollHeight }));
    assert.ok(dimensions.scroll <= dimensions.client + 2, JSON.stringify(dimensions));
    await text.blur();
    await persisted(state => getItem(state).values.notes === longText);
    await peek.getByRole('button', { name: '关闭预览', exact: true }).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await host.waitFor();
    await cell.locator('.db-title-control').hover();
    await cell.locator('.db-title-open').click();
    await peek.waitFor();
    assert.equal(await text.inputValue(), longText);
    assert.equal(getItem(await saved()).values.notes, longText);
    assert.equal(getItem(await saved()).values.amount, 0);
  });

  await check('Title Enter focuses the existing record body and retains the nested calendar', async () => {
    const title = peek.getByRole('textbox', { name: '记录标题', exact: true });
    await title.focus();
    await title.press('Enter');
    const tail = peek.locator('[data-id="record-reading-tail"] .bn-inline-content');
    await page.keyboard.insertText('记录正文验证');
    const after = await persisted(state => JSON.stringify(state.pages.find(entry => entry.id === 'alpha-page').content).includes('记录正文验证'));
    assert.ok(await tail.count());
    assert.ok(JSON.stringify(after.pages.find(entry => entry.id === 'alpha-page').content.find(block => block.id === 'record-reading-tail')?.content).includes('记录正文验证'));
    assert.equal(after.pages.find(entry => entry.id === 'alpha-page').content.find(block => block.id === 'record-reading-calendar')?.props?.viewId, 'view-calendar');
    await peek.locator('[data-id="record-reading-calendar"] .db-calendar-grid').waitFor();
  });
}, { workspace: fixture(), now: '2026-09-18T12:00:00.000Z' }));

reports.push(await browserScenario(`LOCAL-NOTION-001/v10-calendar-peek14/record/${run}-locked`, async ({ page, check, assert, saved }) => {
  const host = page.locator('[data-id="record-reading-host"] section.database-view');
  const cell = host.locator('tr[data-item-id="alpha"] td[data-property-id="title"]');
  const peek = page.getByRole('dialog', { name: '记录预览', exact: true });
  await check('Locked record keeps empty and zero properties read-only without mutation', async () => {
    await host.waitFor();
    const before = await saved();
    await cell.locator('.db-title-control').hover();
    await cell.locator('.db-title-open').click();
    await peek.waitFor();
    assert.equal(await peek.getByRole('textbox', { name: '记录标题', exact: true }).getAttribute('readonly'), '');
    assert.equal(await peek.locator('[data-property-id="notes"] .db-readonly-cell').innerText(), '空');
    assert.equal(await peek.locator('[data-property-id="amount"] .db-readonly-cell').innerText(), '0');
    assert.equal(await peek.locator('[data-property-id="notes"] textarea').count(), 0);
    assert.deepEqual((await saved()).databaseItems.find(item => item.id === 'alpha').values, before.databaseItems.find(item => item.id === 'alpha').values);
  });
}, { workspace: fixture(true), now: '2026-09-18T12:00:00.000Z' }));

const aggregate = {
  name: 'database-record-reading-v10',
  run,
  sourceFingerprint: reports[0]?.sourceFingerprint,
  passed: reports.every(report => report.passed && report.sourceFingerprint === reports[0]?.sourceFingerprint),
  checks: reports.flatMap(report => report.checks),
  errors: reports.flatMap(report => report.errors),
  cases: reports.map(report => ({ name: report.name, passed: report.passed, sourceFingerprint: report.sourceFingerprint })),
};
writeFileSync('.qa/database-record-reading-v10.json', JSON.stringify(aggregate, null, 2));
if (!aggregate.passed) process.exitCode = 1;
