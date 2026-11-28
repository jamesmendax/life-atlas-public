import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { browserScenario, sourceFingerprint } from './harness.mjs';
import { coreParityWorkspace } from '../fixtures/core-parity-workspace.mjs';

const run = process.env.V10_RECORD_ICON23_RUN;
if (!run || !/^[a-z0-9-]+$/.test(run)) throw new Error('Set a unique V10_RECORD_ICON23_RUN label');
const qa = '.qa/LOCAL-NOTION-001/v10-record-default-icon23';
const name = suffix => `LOCAL-NOTION-001/v10-record-default-icon23/${run}-${suffix}`;
for (const suffix of ['default', 'duplicate', 'template']) {
  if (existsSync(`.qa/${name(suffix)}.json`) || existsSync(`.qa/${name(suffix)}-failure.png`)) throw new Error('Preserve previous evidence; choose a new run label');
}
const runtime = path.resolve(qa, `${run}-runtime`);
if (existsSync(runtime)) throw new Error('Preserve previous runtime; choose a new run label');
const temp = path.join(runtime, 'temp'), cache = path.join(runtime, 'cache');
mkdirSync(temp, { recursive: true }); mkdirSync(cache, { recursive: true });
process.env.TEMP = temp; process.env.TMP = temp; process.env.XDG_CACHE_HOME = cache; process.env.npm_config_cache = cache;
const externalBase = process.env.PARITY_BASE_URL;
process.env.PARITY_BASE_URL = externalBase || 'http://127.0.0.1:5178';

async function provePortFree() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen({ host: '0.0.0.0', port: 5178, exclusive: true }, resolve); });
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
}
function fixture(view = 'gallery') {
  const value = coreParityWorkspace();
  value.ui.preferences = { style: 'mobai', theme: 'system' };
  value.pages.find(entry => entry.id === 'database-page').databaseViewId = `view-${view}`;
  value.pages.find(entry => entry.id === 'alpha-page').icon = '🗂️';
  value.pages.find(entry => entry.id === 'beta-page').icon = '🚀';
  return value;
}
async function openDatabase(page) {
  await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="database-page"]').click();
  const db = page.locator('section.database-view[data-source-id="projects"]');
  await db.waitFor(); return db;
}
const newItems = (after, before) => after.databaseItems.filter(item => !before.databaseItems.some(old => old.id === item.id));
let server, before;
try {
  before = sourceFingerprint(); console.log(`FINGERPRINT_BEFORE ${before}`);
  if (!externalBase) {
    await provePortFree();
    const { createServer } = await import('vite');
    server = await createServer({ configLoader: 'native', cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 5178, strictPort: true } });
    await server.listen(); console.log(`OWNED_VITE pid=${process.pid} temp=${temp} cache=${cache}`);
  } else console.log(`EXTERNAL_PARITY_SERVER owner=parent url=${externalBase}`);

  await browserScenario(name('default'), async ({ page, check, saved, persisted, screenshot }) => {
    const db = await openDatabase(page);
    let item;
    await check('Gallery New creates one stable page and item and retains the typed title', async () => {
      const beforeCreate = await saved();
      await db.locator('.db-gallery-create').click();
      const peek = page.getByRole('dialog', { name: '记录预览', exact: true });
      await peek.waitFor();
      const created = await persisted(state => newItems(state, beforeCreate).length === 1);
      item = newItems(created, beforeCreate)[0];
      assert.equal(created.pages.filter(entry => entry.id === item.pageId).length, 1);
      await peek.getByRole('textbox', { name: '记录标题' }).fill('新纪录 · 图标23');
      const named = await persisted(state => state.databaseItems.find(entry => entry.id === item.id)?.values.title === '新纪录 · 图标23');
      assert.equal(named.pages.find(entry => entry.id === item.pageId).title, '新纪录 · 图标23');
      await peek.getByRole('button', { name: '关闭预览' }).click();
      const after = await saved();
      assert.equal(after.databaseItems.find(entry => entry.id === item.id).pageId, item.pageId);
      assert.equal(after.pages.find(entry => entry.id === item.pageId).title, '新纪录 · 图标23');
      assert.equal(newItems(after, beforeCreate).length, 1);
    });
    await check('new record shows the neutral document glyph before and after reload, never a folder', async () => {
      const card = db.locator(`.db-gallery-card[data-item-id="${item.id}"]`);
      const state = await saved();
      const glyph = card.locator('.db-gallery-title-icon');
      await screenshot('default-before-reload');
      assert.equal(state.pages.find(entry => entry.id === item.pageId).icon, 'icon:file-description');
      assert.equal(await glyph.locator('use[href$="#ti-file-description"]').count(), 1);
      assert.doesNotMatch(await glyph.innerText(), /🗂/u);
      await page.reload(); await openDatabase(page);
      const reloaded = await saved();
      assert.equal(reloaded.databaseItems.find(entry => entry.id === item.id).pageId, item.pageId);
      assert.equal(reloaded.pages.find(entry => entry.id === item.pageId).title, '新纪录 · 图标23');
      assert.equal(reloaded.pages.find(entry => entry.id === item.pageId).icon, 'icon:file-description');
      assert.equal(await glyph.locator('use[href$="#ti-file-description"]').count(), 1);
      await screenshot('default-after-reload');
    });
  }, { workspace: fixture() });

  await browserScenario(name('duplicate'), async ({ page, check, saved, persisted, screenshot }) => {
    const db = await openDatabase(page);
    await check('duplicating a historical folder icon and an explicit custom icon preserves each icon and title after reload', async () => {
      const beforeCopy = await saved();
      for (const [id, title] of [['alpha', 'Alpha 项目'], ['beta', 'Beta 项目']]) {
        await db.locator(`tr[data-item-id="${id}"]`).getByRole('button', { name: `记录操作 ${title}` }).click();
        await page.getByRole('menuitem', { name: '复制记录', exact: true }).click();
        await persisted(state => newItems(state, beforeCopy).length === (id === 'alpha' ? 1 : 2));
      }
      await page.reload(); await openDatabase(page);
      const after = await saved();
      const copies = newItems(after, beforeCopy);
      assert.equal(copies.length, 2);
      for (const [title, icon, original] of [['Alpha 项目', '🗂️', 'alpha-page'], ['Beta 项目', '🚀', 'beta-page']]) {
        const copy = copies.find(entry => entry.values.title === title);
        assert.ok(copy); assert.notEqual(copy.pageId, original);
        assert.equal(after.pages.find(entry => entry.id === copy.pageId).icon, icon);
        assert.equal(after.pages.find(entry => entry.id === original).icon, icon);
        assert.equal(after.pages.find(entry => entry.id === copy.pageId).title, title);
        assert.match(await db.locator(`tr[data-item-id="${copy.id}"] .db-record-glyph`).innerText(), new RegExp(icon, 'u'));
      }
      await screenshot('copies-after-reload');
    });
  }, { workspace: fixture('table') });

  await browserScenario(name('template'), async ({ page, check, saved, persisted }) => {
    const db = await openDatabase(page);
    await check('a database template retains its explicit custom icon and title through creation and reload', async () => {
      await db.locator('tr[data-item-id="beta"] td[data-property-id="title"]').hover();
      await db.getByRole('button', { name: '打开 Beta 项目', exact: true }).click();
      await page.getByRole('button', { name: '打开完整页面', exact: true }).click();
      const trigger = page.getByRole('button', { name: '工作区工具', exact: true });
      if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
      await page.getByLabel('工作区工具面板', { exact: true }).getByRole('button', { name: '模板', exact: true }).click();
      await page.getByLabel('数据库模板名称', { exact: true }).fill('图标23模板');
      await page.getByRole('button', { name: '保存数据库模板', exact: true }).click();
      const templateState = await persisted(state => state.databaseTemplates?.some(entry => entry.name === '图标23模板'));
      const template = templateState.databaseTemplates.find(entry => entry.name === '图标23模板');
      assert.equal(template.pageAppearance.icon, '🚀');
      await page.getByLabel('选择数据库模板', { exact: true }).selectOption(template.id);
      const beforeCreate = await saved();
      await page.getByRole('button', { name: '从模板新建记录', exact: true }).click();
      const created = await persisted(state => newItems(state, beforeCreate).length === 1);
      const item = newItems(created, beforeCreate)[0];
      assert.equal(created.pages.find(entry => entry.id === item.pageId).icon, '🚀');
      assert.equal(created.pages.find(entry => entry.id === item.pageId).title, 'Beta 项目');
      await page.reload();
      const after = await saved();
      assert.equal(after.databaseItems.find(entry => entry.id === item.id).pageId, item.pageId);
      assert.equal(after.pages.find(entry => entry.id === item.pageId).icon, '🚀');
      assert.equal(after.pages.find(entry => entry.id === item.pageId).title, 'Beta 项目');
    });
  }, { workspace: fixture('table') });
} catch (error) { console.error(error.stack); process.exitCode = 1; }
finally {
  try {
    if (server) { await server.close(); await provePortFree(); console.log('OWNED_VITE_CLOSED_AND_PORT_FREE=true'); }
    else console.log('EXTERNAL_SERVER_PRESERVED=true');
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  try { const after = sourceFingerprint(); console.log(`FINGERPRINT_AFTER ${after}`); if (before) assert.equal(after, before, 'Source/test inputs changed during run'); }
  catch (error) { console.error(error.stack); process.exitCode = 1; }
}
