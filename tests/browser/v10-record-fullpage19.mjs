import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { browserScenario } from './harness.mjs';
import { coreParityWorkspace } from '../fixtures/core-parity-workspace.mjs';

const run = process.env.V10_RECORD_FULLPAGE19_RUN || 'prepared';
if (!/^[a-z0-9-]+$/.test(run)) throw new Error('Invalid run label');
const dir = `.qa/LOCAL-NOTION-001/v10-record-fullpage19/${run}`;
mkdirSync(dir, { recursive: true });
const name = suffix => `LOCAL-NOTION-001/v10-record-fullpage19/${run}/${suffix}`;
for (const suffix of ['default', 'wide', 'locked']) {
  if (existsSync(`.qa/${name(suffix)}.json`)) throw new Error('Evidence exists; select a new run label');
}

function fixture({ wide = false, locked = false } = {}) {
  const workspace = coreParityWorkspace();
  const source = workspace.dataSources.find(entry => entry.id === 'projects');
  source.properties.push({ ...structuredClone(source.properties.find(entry => entry.id === 'amount')), id: 'empty-number19', name: '空数字' });
  const item = workspace.databaseItems.find(entry => entry.id === 'alpha');
  Object.assign(item.values, { notes: '', url: null, amount: 0, checked: false, 'empty-number19': null });
  const record = workspace.pages.find(entry => entry.id === 'alpha-page');
  record.settings.fullWidth = wide;
  record.settings.locked = locked;
  workspace.ui.selectedPageId = record.id;
  workspace.ui.preferences = { style: 'mobai', theme: 'system' };
  return workspace;
}

const item = state => state.databaseItems.find(entry => entry.id === 'alpha');
const record = state => state.pages.find(entry => entry.id === 'alpha-page');
async function measure(page) {
  return page.evaluate(() => {
    const box = selector => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const rect = element.getBoundingClientRect();
      return { x: rect.x, width: rect.width, right: rect.right };
    };
    return { title: box('.page-document-header'), properties: box('.db-record-properties'), body: box('.page-document .life-editor') };
  });
}
function aligned(assert, dimensions) {
  for (const part of ['properties', 'body']) {
    for (const edge of ['x', 'right', 'width']) {
      assert.ok(Math.abs(dimensions[part][edge] - dimensions.title[edge]) <= 2, `${part}.${edge}: ${JSON.stringify(dimensions)}`);
    }
  }
}

const reports = [];
reports.push(await browserScenario(name('default'), async ({ page, check, assert, saved, persisted, screenshot }) => {
  const props = page.locator('.page-document .db-record-properties');
  const property = id => props.locator(`.db-record-property[data-property-id="${id}"]`);
  const text = property('notes').getByRole('textbox', { name: '说明', exact: true });
  await check('Full record title properties and body align in default width', async () => {
    await props.waitFor();
    await page.locator('.page-document .life-editor').waitFor();
    const dimensions = await measure(page);
    writeFileSync(`${dir}/default-dimensions.json`, JSON.stringify(dimensions, null, 2));
    await screenshot('default-light');
    assert.ok(Math.abs(dimensions.title.width - 708) <= 2, JSON.stringify(dimensions));
    aligned(assert, dimensions);
  });
  await check('Full record aligns at narrower widths in light and dark', async () => {
    for (const width of [1100, 700]) {
      await page.setViewportSize({ width, height: 900 });
      for (const mode of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: mode });
        await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, mode);
        const dimensions = await measure(page);
        writeFileSync(`${dir}/width-${width}-${mode}.json`, JSON.stringify(dimensions, null, 2));
        aligned(assert, dimensions);
        await screenshot(`width-${width}-${mode}`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1040 });
    await page.emulateMedia({ colorScheme: 'light' });
  });
  await check('Type glyphs placeholders zero and false are readable without writes', async () => {
    const before = await saved();
    for (const id of ['notes', 'url', 'amount', 'empty-number19', 'checked']) assert.equal(await property(id).locator('.db-record-property-label svg[aria-hidden="true"]').count(), 1, id);
    for (const [id, label] of [['notes', '说明'], ['url', '链接'], ['empty-number19', '空数字']]) {
      const input = property(id).getByRole('textbox', { name: label, exact: true });
      assert.equal(await input.inputValue(), '');
      assert.equal(await input.getAttribute('placeholder'), '空');
    }
    assert.equal(await property('amount').getByRole('textbox', { name: '金额', exact: true }).inputValue(), '0');
    assert.equal(await property('checked').getByRole('checkbox').isChecked(), false);
    assert.deepEqual(item(await saved()).values, item(before).values);
  });
  await check('Escape cancels and Enter and blur commit to the same item across reload', async () => {
    await text.fill('取消内容');
    await text.press('Escape');
    assert.equal(await text.inputValue(), '');
    assert.equal(item(await saved()).values.notes, '');
    await text.fill('回车保存');
    await text.press('Enter');
    await persisted(state => item(state).values.notes === '回车保存');
    await text.fill('失焦保存');
    await text.blur();
    const after = await persisted(state => item(state).values.notes === '失焦保存');
    assert.equal(item(after).pageId, 'alpha-page');
    assert.equal(item(after).values.amount, 0);
    assert.equal(item(after).values.checked, false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await props.waitFor();
    assert.equal(await text.inputValue(), '失焦保存');
    assert.equal(record(await saved()).id, 'alpha-page');
    assert.equal(item(await saved()).values.notes, '失焦保存');
  });
}, { workspace: fixture(), now: '2026-09-18T12:00:00.000Z' }));

reports.push(await browserScenario(name('wide'), async ({ page, check, assert, screenshot }) => {
  await check('Wide full record keeps title properties and body aligned', async () => {
    await page.locator('.page-document .life-editor').waitFor();
    const dimensions = await measure(page);
    writeFileSync(`${dir}/wide-dimensions.json`, JSON.stringify(dimensions, null, 2));
    await screenshot('wide-light');
    assert.ok(dimensions.title.width > 708, JSON.stringify(dimensions));
    aligned(assert, dimensions);
  });
}, { workspace: fixture({ wide: true }), now: '2026-09-18T12:00:00.000Z' }));

reports.push(await browserScenario(name('locked'), async ({ page, check, assert, saved }) => {
  await check('Locked full record shows empty and zero without allowing writes', async () => {
    const props = page.locator('.page-document .db-record-properties');
    await props.waitFor();
    const before = await saved();
    assert.equal(await props.locator('[data-property-id="notes"] .db-readonly-cell').innerText(), '空');
    assert.equal(await props.locator('[data-property-id="amount"] .db-readonly-cell').innerText(), '0');
    assert.equal(await props.locator('[data-property-id="notes"] textarea').count(), 0);
    assert.deepEqual(item(await saved()).values, item(before).values);
  });
}, { workspace: fixture({ locked: true }), now: '2026-09-18T12:00:00.000Z' }));

writeFileSync(`${dir}/aggregate.json`, JSON.stringify({ run, passed: reports.every(report => report.passed && report.sourceFingerprint === reports[0].sourceFingerprint), reports: reports.map(({ name, passed, sourceFingerprint, checks, errors, failure }) => ({ name, passed, sourceFingerprint, checks, errors, failure })) }, null, 2));
if (!reports.every(report => report.passed && report.sourceFingerprint === reports[0].sourceFingerprint)) process.exitCode = 1;
