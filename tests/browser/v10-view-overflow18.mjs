import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { coreParityWorkspace } from '../fixtures/core-parity-workspace.mjs';
import { createDatabaseView } from '../../src/domain/database.js';
import { upgradeWorkspace } from '../../src/persistence/migrations.js';
import { workspaceStorageKey } from '../../src/persistence/workspaceRepository.js';
import { openViewSettingsSection, setViewSettings } from './database-navigation.mjs';

// Real App + fresh browser storage. Deliberately does not call the shared
// browserScenario/sourceFingerprint while this work package has hash=deny.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = path.join(root, '.qa/LOCAL-NOTION-001/v10-view-overflow18');
const run = process.env.V10_VIEW_OVERFLOW_RUN || 'prepared01';
if (!/^[a-z0-9-]+$/.test(run)) throw new Error('Invalid run label');
const reportPath = path.join(directory, run + '.json');
if (existsSync(reportPath)) throw new Error('Report exists; choose a new V10_VIEW_OVERFLOW_RUN');
mkdirSync(path.join(directory, 'runtime/tmp'), { recursive: true });
process.env.TEMP = path.join(directory, 'runtime/tmp');
process.env.TMP = process.env.TEMP;
const ids = Array.from({ length: 12 }, (_, i) => 'overflow-project-' + (i + 1));
const names = ['表格', '状态看板', '日历', '列表', '画廊', '交付计划', '本月任务', '归档记录', '待办清单', '按负责人', 'V10画廊·后续命名15·完整长标题应保留', '项目总览'];
const activeId = ids[10];
const report = { package: 'DBUI-VIEW-OVERFLOW-18', run, startedAt: new Date().toISOString(), seam: 'real App DOM + browser workspace repository', sourceFingerprint: null, fingerprintReason: 'hash=deny; original source bytes preserved instead', scenarios: [], passed: false };
const publish = () => writeFileSync(reportPath, JSON.stringify(report, null, 2));

function fixture({ inline = true, locked = false, few = false } = {}) {
  const workspace = coreParityWorkspace();
  const gallery = { gallery: { preview: 'content', cardSize: 'medium', visiblePropertyIds: [] } };
  workspace.databaseViews = (few ? ids.slice(0, 2) : ids).map((id, i) => createDatabaseView({ id, sourceId: 'projects', name: few ? ['一', '二'][i] : names[i], type: 'gallery', config: gallery }));
  const partnerViews = Array.from({ length: 9 }, (_, i) => createDatabaseView({ id: 'overflow-partner-' + (i + 1), sourceId: 'partners', name: '供应方视图' + (i + 1), type: 'gallery', config: gallery }));
  workspace.databaseViews.push(...partnerViews);
  workspace.pages.find(page => page.id === 'database-page').databaseViewId = few ? ids[0] : activeId;
  const editor = workspace.pages.find(page => page.id === 'editor-page');
  editor.title = '视图导航合成对照18';
  editor.settings.locked = locked;
  editor.content = [{ id: 'overflow-columns', type: 'columnList', props: { columns: 2 }, children: [
    { id: 'overflow-column-a', type: 'column', props: { width: 50, index: 0, count: 2 }, children: [{ id: 'overflow-heading-a', type: 'paragraph', props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' }, content: [{ type: 'text', text: '项目库导航', styles: {} }], children: [] }, { id: 'overflow-linked-a', type: 'databaseView', props: { sourceId: 'projects', viewId: few ? ids[0] : activeId }, children: [] }] },
    { id: 'overflow-column-b', type: 'column', props: { width: 50, index: 1, count: 2 }, children: [{ id: 'overflow-heading-b', type: 'paragraph', props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' }, content: [{ type: 'text', text: '供应方库导航', styles: {} }], children: [] }, { id: 'overflow-linked-b', type: 'databaseView', props: { sourceId: 'partners', viewId: 'overflow-partner-8' }, children: [] }] },
  ] }];
  workspace.databaseItems.find(item => item.id === 'alpha').values.amount = 0;
  workspace.databaseItems.find(item => item.id === 'alpha').values.checked = false;
  workspace.ui.selectedPageId = inline ? 'editor-page' : 'database-page';
  workspace.ui.preferences = { style: 'mobai', theme: 'system' };
  return upgradeWorkspace(workspace);
}

async function settle(page) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
}
async function geometry(db) {
  return db.evaluate(element => {
    const box = e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; };
    const strip = element.querySelector('.db-view-tabs');
    const active = strip.querySelector('[role="tab"][aria-selected="true"]');
    const tabs = [...strip.querySelectorAll('[role="tab"]')];
    const more = strip.querySelector('.db-v10-view-more');
    return { strip: box(strip), area: box(element.querySelector('.db-v9-tab-area')), active: box(active), activeId: active.dataset.viewId, ids: tabs.map(t => t.dataset.viewId), tabBoxes: tabs.map(box), more: more ? { ...box(more), label: more.textContent.trim() } : null, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
  });
}
async function assertCurrentInside(db) {
  const g = await geometry(db);
  assert.equal(g.activeId, await db.getAttribute('data-view-id'));
  assert.ok(g.active.left >= g.strip.left - 1 && g.active.right <= g.strip.right + 1, 'current named view must be fully inside its visible strip: ' + JSON.stringify(g));
  assert.ok(g.active.right <= g.area.right + 1, 'current view must remain inside its available container');
  assert.ok(g.active.width > 28, 'current label must retain a readable title area');
  return g;
}
async function assertMoreCount(db, expectedIds) {
  const g = await geometry(db);
  const hidden = expectedIds.length - g.ids.length;
  assert.ok(hidden > 0, 'many-view fixture must have omitted tabs at this width');
  assert.ok(g.more, 'overflow requires the visible More control');
  assert.equal(g.more.label, '更多' + hidden + '个…');
  assert.ok(g.more.right <= g.area.right + 1, 'More stays inside the available width');
  assert.equal(new Set(g.ids).size, g.ids.length);
  assert.deepEqual(g.ids, expectedIds.filter(id => g.ids.includes(id)), 'tabs retain source order');
  return g;
}

function walk(blocks, result = []) {
  for (const block of blocks || []) { result.push(block); walk(block.children, result); }
  return result;
}
const selectedBlock = (workspace, id) => walk(workspace.pages.find(p => p.id === 'editor-page').content).find(b => b.id === id);
function assertDataStable(after, before) {
  for (const field of ['folders', 'dataSources', 'databaseItems', 'databaseViews', 'attachments', 'relations', 'people', 'syncedSources']) assert.deepEqual(after[field], before[field], field);
}
function assertOnlyPageSelection(after, before, id) {
  assertDataStable(after, before);
  assert.deepEqual(after.pages, before.pages.map(page => page.id === 'database-page' ? { ...page, databaseViewId: id } : page));
}
function assertOnlyLinkedSelection(after, before, changes) {
  assertDataStable(after, before);
  const oldPage = before.pages.find(p => p.id === 'editor-page');
  const nextPage = after.pages.find(p => p.id === 'editor-page');
  const expectedContent = structuredClone(oldPage.content);
  for (const [blockId, viewId] of Object.entries(changes)) walk(expectedContent).find(b => b.id === blockId).props.viewId = viewId;
  assert.deepEqual(nextPage.content, expectedContent, 'only the chosen block view IDs may change');
  assert.ok(nextPage.contentRevision > oldPage.contentRevision);
  assert.equal(nextPage.summarySourceRevision, nextPage.contentRevision);
  const metadata = new Set(['content', 'contentRevision', 'updatedAt', 'summary', 'summarySourceRevision', 'summaryUpdatedAt']);
  const stablePage = page => Object.fromEntries(Object.entries(page).filter(([key]) => !metadata.has(key)));
  assert.deepEqual(stablePage(nextPage), stablePage(oldPage));
  assert.deepEqual(after.pages.filter(p => p.id !== oldPage.id), before.pages.filter(p => p.id !== oldPage.id));
}
async function moreMenu(db, title = '项目数据库') {
  const more = db.locator('button.db-v10-view-more');
  if (await more.getAttribute('aria-expanded') !== 'true') await more.click();
  const menu = db.page().getByRole('dialog', { name: '全部视图：' + title, exact: true });
  await menu.waitFor();
  return menu;
}
async function waitActive(db, id) {
  const tab = db.locator('[role="tab"][data-view-id="' + id + '"][aria-selected="true"]');
  await tab.waitFor();
  await settle(db.page());
  assert.equal(await db.getAttribute('data-view-id'), id);
  return tab;
}

let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  async function scenario(name, options, body) {
    const entry = { name, checks: [], screenshots: [], errors: [], startedAt: new Date().toISOString() };
    report.scenarios.push(entry); publish();
    const context = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 1040 }, colorScheme: 'light' });
    await context.route('**/*', route => { const url = new URL(route.request().url()); return url.hostname === '127.0.0.1' && url.port === '5178' ? route.continue() : route.abort(); });
    const seed = fixture(options);
    await context.addInitScript(({ seed, key }) => {
      if (!localStorage.getItem('life-atlas.harness.seeded')) {
        localStorage.setItem(key, JSON.stringify(seed));
        localStorage.setItem('life-atlas.harness.seeded', '1');
        localStorage.setItem('life-atlas.parity.seeded', '1');
      }
    }, { seed, key: workspaceStorageKey });
    const page = await context.newPage();
    page.setDefaultTimeout(9000); page.setDefaultNavigationTimeout(30000);
    page.on('pageerror', error => { entry.errors.push({ kind: 'pageerror', message: error.stack }); publish(); });
    page.on('console', message => { if (message.type() === 'error') { entry.errors.push({ kind: 'console', message: message.text() }); publish(); } });
    const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), workspaceStorageKey);
    const persisted = async predicate => {
      const deadline = Date.now() + 12000;
      let value;
      do { value = await saved(); if (predicate(value)) return value; await page.waitForTimeout(75); } while (Date.now() < deadline);
      throw new Error('Expected workspace persistence was not observed');
    };
    const screenshot = async label => {
      const target = path.join(directory, run + '-' + name + '-' + label + '.png');
      await page.screenshot({ path: target, fullPage: false }); entry.screenshots.push(target); publish();
    };
    const check = async (label, action) => {
      const result = { label, passed: false };
      entry.checks.push(result);
      try { result.observation = await action(); result.passed = true; }
      catch (error) { result.error = error.stack; await screenshot('failed-' + entry.checks.length); }
      publish();
    };
    try {
      await page.goto('http://127.0.0.1:5178', { waitUntil: 'domcontentloaded' });
      const db = page.locator('section.database-view[data-source-id="projects"]');
      await db.waitFor();
      await persisted(value => value.pages.every(p => Object.hasOwn(p, 'contentRevision')));
      await settle(page);
      await body({ page, db, check, saved, persisted, screenshot, seed });
    } catch (error) { entry.errors.push({ kind: 'scenario', message: error.stack }); await screenshot('scenario-error').catch(() => {}); }
    finally { await context.close(); entry.closedAt = new Date().toISOString(); publish(); }
  }

  for (const [name, viewport] of [['many-default708', { width: 1440, height: 1040 }], ['many-minwindow948', { width: 948, height: 895 }]]) {
    await scenario(name, { viewport }, async ({ page, db, check, screenshot }) => {
      await screenshot('before-navigation');
      await check('Late current named view is fully visible in the actual linked database strip', () => assertCurrentInside(db));
      await check('Overflow exposes the correct remaining count while preserving source order', () => assertMoreCount(db, ids));
    });
  }


  await scenario('menu-navigation', { inline: false }, async ({ page, db, check, saved, persisted, screenshot }) => {
    const before = await saved();

    await check('Fitting preserves a consecutive leading prefix and appends only the current late view', async () => {
      const g = await assertMoreCount(db, ids);
      const prefix = g.ids.at(-1) === g.activeId && ids.indexOf(g.activeId) > g.ids.length - 1 ? g.ids.slice(0, -1) : g.ids;
      assert.deepEqual(prefix, ids.slice(0, prefix.length));
      assert.ok(g.ids.includes(activeId));
      return g;
    });
    await check('All named views appear once, in order, with the current check and a full accessible title', async () => {
      await assertCurrentInside(db);
      const active = db.locator('[role="tab"][aria-selected="true"]');
      assert.equal(await active.getAttribute('aria-label'), names[10]);
      assert.equal(await active.getAttribute('title'), names[10]);
      assert.equal(await active.locator('span').evaluate(e => getComputedStyle(e).textOverflow), 'ellipsis');
      const menu = await moreMenu(db);
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '搜索视图');
      assert.deepEqual(await menu.getByRole('menuitemradio').evaluateAll(es => es.map(e => e.dataset.viewId)), ids);
      assert.equal(await menu.locator('[role="menuitemradio"][aria-checked="true"]').getAttribute('data-view-id'), activeId);
      assert.equal(await menu.getByRole('menuitem', { name: '新建视图', exact: true }).count(), 1);
      await screenshot('all-views-menu');
    });
    await check('Search filters the complete view set and keyboard Enter selects and persists a late view', async () => {
      const menu = await moreMenu(db);
      const search = menu.getByRole('searchbox', { name: '搜索视图' });
      await search.fill('项目总览');
      assert.deepEqual(await menu.getByRole('menuitemradio').evaluateAll(es => es.map(e => e.dataset.viewId)), [ids[11]]);
      await search.press('ArrowDown');
      assert.equal(await menu.getByRole('menuitemradio').evaluate(e => e === document.activeElement), true);
      await page.keyboard.press('Enter');
      const active = await waitActive(db, ids[11]);
      assert.equal(await active.evaluate(e => e === document.activeElement), true);
      assertOnlyPageSelection(await persisted(w => w.pages.find(p => p.id === 'database-page').databaseViewId === ids[11]), before, ids[11]);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitActive(db, ids[11]);
      assertOnlyPageSelection(await saved(), before, ids[11]);
      await assertCurrentInside(db);
      await screenshot('late-view-after-reload');
    });
    await check('The complete menu supports Arrow/Home/End and returns focus when its current view is selected', async () => {
      const menu = await moreMenu(db);
      const search = menu.getByRole('searchbox', { name: '搜索视图' });
      await search.press('ArrowDown');
      await page.keyboard.press('End');
      assert.equal(await menu.getByRole('menuitem', { name: '新建视图' }).evaluate(e => e === document.activeElement), true);
      await page.keyboard.press('ArrowUp');
      assert.equal(await menu.locator('[data-view-id="' + ids[11] + '"]').evaluate(e => e === document.activeElement), true);
      await page.keyboard.press('Home');
      assert.equal(await menu.locator('[data-view-id="' + ids[0] + '"]').evaluate(e => e === document.activeElement), true);
      for (let i = 0; i < 11; i += 1) await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      const active = await waitActive(db, ids[11]);
      assert.equal(await active.evaluate(e => e === document.activeElement), true, 'choosing the current menu row returns focus to its visible tab');
      assertOnlyPageSelection(await saved(), before, ids[11]);
    });
    await check('Tab arrows wrap across all views, including omitted tabs, and retain selected focus', async () => {
      const sequence = [['Home', ids[0]], ['ArrowLeft', ids[11]], ['ArrowRight', ids[0]], ['End', ids[11]], ['ArrowLeft', ids[10]]];
      await db.locator('[role="tab"][aria-selected="true"]').focus();
      for (const [key, id] of sequence) {
        await page.keyboard.press(key);
        const active = await waitActive(db, id);
        assert.equal(await active.evaluate(e => e === document.activeElement), true, key);
        await assertCurrentInside(db);
        assertOnlyPageSelection(await persisted(w => w.pages.find(p => p.id === 'database-page').databaseViewId === id), before, id);
      }
    });
    await check('Escape restores More focus, outside clicks keep their target focus, and search resets on reopening', async () => {
      let menu = await moreMenu(db);
      await menu.getByRole('searchbox').fill('没有这个视图18');
      assert.equal(await menu.getByRole('menuitemradio').count(), 0);
      await menu.getByText('没有匹配的视图', { exact: true }).waitFor();
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached' });
      assert.equal(await db.locator('button.db-v10-view-more').evaluate(e => e === document.activeElement), true);
      menu = await moreMenu(db);
      assert.equal(await menu.getByRole('searchbox').inputValue(), '');
      await page.getByRole('textbox', { name: '页面标题', exact: true }).click();
      await menu.waitFor({ state: 'detached' });
      assert.equal(await page.getByRole('textbox', { name: '页面标题', exact: true }).evaluate(e => e === document.activeElement), true);
      assertOnlyPageSelection(await saved(), before, ids[10]);
    });
  });

  await scenario('resize-font-rename', { inline: false }, async ({ page, db, check, saved, persisted, screenshot }) => {
    const before = await saved();
    await check('Container resize alone recalculates omitted views without changing selection or data', async () => {
      const wide = await assertMoreCount(db, ids);
      await db.evaluate(e => { e.style.width = '290px'; });
      await page.waitForFunction(() => document.querySelector('section.database-view[data-source-id="projects"] .db-v9-tab-area').clientWidth < 300);
      await settle(page);
      const narrow = await assertMoreCount(db, ids);
      assert.ok(narrow.ids.length < wide.ids.length, 'less container width must reduce the visible prefix');
      await assertCurrentInside(db);
      assert.equal(await page.evaluate(() => innerWidth), 1440);
      assertOnlyPageSelection(await saved(), before, activeId);
      await screenshot('container-only-narrow');
      await db.evaluate(e => { e.style.removeProperty('width'); });
      await settle(page);
      assert.deepEqual((await assertMoreCount(db, ids)).ids, wide.ids);
    });
    await check('Changed font metrics trigger fitting and remain local presentation only', async () => {
      const normal = await assertMoreCount(db, ids);
      await page.evaluate(() => { const style = document.createElement('style'); style.id = 'overflow18-font-scene'; style.textContent = ':root[data-style="mobai"] .database-view[data-source-id="projects"] .db-v10-view-tabs .db-v10-view-tab, :root[data-style="mobai"] .database-view[data-source-id="projects"] .db-v10-view-tabs .db-v10-view-more { font-size: 20px; }'; document.head.append(style); });
      await settle(page);
      const changed = await assertMoreCount(db, ids);
      assert.ok(changed.ids.length < normal.ids.length, 'larger real glyph metrics reduce the prefix');
      await assertCurrentInside(db);
      assertOnlyPageSelection(await saved(), before, activeId);
      await screenshot('larger-font-metrics');
      await page.evaluate(() => document.getElementById('overflow18-font-scene').remove());
      await settle(page);
      assert.deepEqual((await assertMoreCount(db, ids)).ids, normal.ids);
    });
    await check('Existing rename remeasures the current label and changes only that view name', async () => {
      const initial = await assertMoreCount(db, ids);
      const panel = await openViewSettingsSection(db);
      await panel.getByRole('textbox', { name: '视图名称', exact: true }).fill('短');
      await persisted(w => w.databaseViews.find(v => v.id === activeId).name === '短');
      await setViewSettings(db, false); await settle(page);
      const short = await assertMoreCount(db, ids);
      assert.ok(short.ids.length > initial.ids.length, 'shortening the active title frees prefix space');
      const renamed = await openViewSettingsSection(db);
      const fullName = '命名18·这是当前具名视图的完整长标题';
      await renamed.getByRole('textbox', { name: '视图名称', exact: true }).fill(fullName);
      const after = await persisted(w => w.databaseViews.find(v => v.id === activeId).name === fullName);
      await setViewSettings(db, false); await settle(page);
      await assertCurrentInside(db);
      assert.equal(await db.locator('[role="tab"][aria-selected="true"]').getAttribute('aria-label'), fullName);
      assert.deepEqual(after.databaseViews, before.databaseViews.map(v => v.id === activeId ? { ...v, name: fullName } : v));
      for (const field of ['pages', 'dataSources', 'databaseItems', 'attachments']) assert.deepEqual(after[field], before[field], field);
      await screenshot('rename-long-active');
    });
    await check('Window changes and dark mode preserve the renamed selected view after reload', async () => {
      const stable = await saved();
      await page.setViewportSize({ width: 948, height: 895 }); await settle(page);
      await assertCurrentInside(db); await assertMoreCount(db, ids);
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      await screenshot('minimum-dark');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitActive(db, activeId);
      for (const field of ['pages', 'dataSources', 'databaseItems', 'databaseViews', 'attachments']) assert.deepEqual((await saved())[field], stable[field], field);
      await assertCurrentInside(db);
    });
  });

  await scenario('sources-isolated', {}, async ({ page, db, check, saved, persisted, screenshot }) => {
    const before = await saved();
    const partners = page.locator('section.database-view[data-source-id="partners"]');
    const partnerIds = Array.from({ length: 9 }, (_, i) => 'overflow-partner-' + (i + 1));
    await check('Two source menus contain only their own complete views and their own current check', async () => {
      let menu = await moreMenu(db);
      assert.deepEqual(await menu.getByRole('menuitemradio').evaluateAll(es => es.map(e => e.dataset.viewId)), ids);
      menu = await moreMenu(partners, '供应方');
      assert.equal(await page.getByRole('dialog', { name: '全部视图：项目数据库', exact: true }).count(), 0);
      assert.deepEqual(await menu.getByRole('menuitemradio').evaluateAll(es => es.map(e => e.dataset.viewId)), partnerIds);
      assert.equal(await menu.locator('[aria-checked="true"]').getAttribute('data-view-id'), 'overflow-partner-8');
      await screenshot('second-source-menu');
      await page.keyboard.press('Escape');
    });
    await check('Selections persist in the correct linked blocks while sources, records, views and attachments stay equal', async () => {
      let menu = await moreMenu(db);
      await menu.locator('[data-view-id="' + ids[9] + '"]').click();
      await waitActive(db, ids[9]);
      await persisted(w => selectedBlock(w, 'overflow-linked-a').props.viewId === ids[9]);
      assert.equal(await partners.getAttribute('data-view-id'), 'overflow-partner-8');
      menu = await moreMenu(partners, '供应方');
      await menu.getByRole('searchbox').fill('供应方视图9');
      await menu.getByRole('searchbox').press('Enter');
      await waitActive(partners, 'overflow-partner-9');
      const after = await persisted(w => selectedBlock(w, 'overflow-linked-b').props.viewId === 'overflow-partner-9');
      assertOnlyLinkedSelection(after, before, { 'overflow-linked-a': ids[9], 'overflow-linked-b': 'overflow-partner-9' });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitActive(db, ids[9]); await waitActive(partners, 'overflow-partner-9');
      assertOnlyLinkedSelection(await saved(), before, { 'overflow-linked-a': ids[9], 'overflow-linked-b': 'overflow-partner-9' });
    });

    await check('The existing source picker resets the strip and menu to the new source without mixing prior views', async () => {
      const stable = await saved();
      await db.getByRole('button', { name: '数据源 项目数据库', exact: true }).click();
      const panel = page.getByRole('dialog', { name: '数据源', exact: true });
      await panel.getByRole('button', { name: '供应方', exact: true }).click();
      const after = await persisted(w => selectedBlock(w, 'overflow-linked-a').props.sourceId === 'partners');
      const block = selectedBlock(after, 'overflow-linked-a');
      const added = after.databaseViews.filter(v => !stable.databaseViews.some(old => old.id === v.id));
      assert.equal(added.length, 1, 'existing source switch creates one linked view');
      assert.equal(added[0].id, block.props.viewId);
      assert.equal(added[0].sourceId, 'partners'); assert.equal(added[0].type, 'gallery'); assert.equal(added[0].linked, true);
      for (const old of stable.databaseViews) assert.deepEqual(after.databaseViews.find(v => v.id === old.id), old);
      for (const field of ['dataSources', 'databaseItems', 'attachments']) assert.deepEqual(after[field], stable[field], field);
      const expectedContent = structuredClone(stable.pages.find(p => p.id === 'editor-page').content);
      Object.assign(walk(expectedContent).find(b => b.id === 'overflow-linked-a').props, { sourceId: 'partners', viewId: added[0].id });
      assert.deepEqual(after.pages.find(p => p.id === 'editor-page').content, expectedContent);
      assert.deepEqual(after.pages.filter(p => p.id !== 'editor-page'), stable.pages.filter(p => p.id !== 'editor-page'));
      const nextDb = page.locator('section.database-view[data-source-id="partners"]').filter({ has: page.locator('[role="tab"][data-view-id="' + added[0].id + '"][aria-selected="true"]') });
      await waitActive(nextDb, added[0].id); await assertCurrentInside(nextDb);
      const menu = await moreMenu(nextDb, '供应方');
      assert.equal(await menu.getByRole('searchbox').inputValue(), '');
      assert.deepEqual(await menu.getByRole('menuitemradio').evaluateAll(es => es.map(e => e.dataset.viewId)), [...partnerIds, added[0].id]);
      assert.equal(await menu.locator('[aria-checked="true"]').getAttribute('data-view-id'), added[0].id);
      await screenshot('source-switched-menu');
      await page.keyboard.press('Escape');
    });
  });

  await scenario('few-no-overflow', { inline: false, few: true }, async ({ page, db, check, saved, screenshot }) => {
    const before = await saved();
    await check('Few views display all real tabs with no More or empty placeholder tab', async () => {
      assert.equal(await db.getByRole('tab').count(), 2);
      assert.deepEqual(await db.getByRole('tab').evaluateAll(es => es.map(e => e.dataset.viewId)), ids.slice(0, 2));
      assert.equal(await db.locator('button.db-v10-view-more').count(), 0);
      assert.equal(await db.getByRole('button', { name: '添加视图', exact: true }).count(), 1);
      await assertCurrentInside(db);
      assertOnlyPageSelection(await saved(), before, ids[0]);
      await screenshot('all-few-tabs');
    });
  });

  await scenario('locked-local', { locked: true }, async ({ page, db, check, saved, screenshot }) => {
    const before = await saved();
    await check('Locked pages expose searchable local view navigation and hide persistent create controls', async () => {
      assert.equal(await db.getByRole('button', { name: '添加视图', exact: true }).count(), 0);
      assert.equal(await db.getByRole('button', { name: '视图设置', exact: true }).count(), 0);
      assert.equal(await db.locator('.db-gallery-create').count(), 0);
      const menu = await moreMenu(db);
      assert.equal(await menu.getByRole('menuitem', { name: '新建视图' }).count(), 0);
      await menu.getByRole('searchbox').fill('项目总览');
      await menu.getByRole('searchbox').press('Enter');
      await waitActive(db, ids[11]);
      await db.locator('[role="tab"][aria-selected="true"]').focus();
      await page.keyboard.press('Home'); await waitActive(db, ids[0]);
      await page.keyboard.press('ArrowLeft'); await waitActive(db, ids[11]);
      await assertCurrentInside(db);
      for (const field of ['pages', 'dataSources', 'databaseItems', 'databaseViews', 'attachments']) assert.deepEqual((await saved())[field], before[field], field);
      await screenshot('local-selection-locked');
    });
    await check('Reload discards only the locked local selection and preserves all stored data', async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitActive(db, activeId);
      for (const field of ['pages', 'dataSources', 'databaseItems', 'databaseViews', 'attachments']) assert.deepEqual((await saved())[field], before[field], field);
    });
  });

  await scenario('create15-properties17', { inline: false }, async ({ page, db, check, saved, persisted, screenshot }) => {
    const before = await saved();
    let createdId;
    await check('New view from the overflow menu uses the accepted chooser and creates one empty-name Gallery', async () => {
      const menu = await moreMenu(db);
      await menu.getByRole('menuitem', { name: '新建视图', exact: true }).click();
      const chooser = page.getByRole('dialog', { name: '添加视图', exact: true });
      await chooser.waitFor();
      assert.equal(await page.getByRole('dialog', { name: '全部视图：项目数据库', exact: true }).count(), 0);
      await chooser.getByRole('button', { name: '画廊', exact: true }).click();
      const after = await persisted(w => w.databaseViews.length === before.databaseViews.length + 1);
      const added = after.databaseViews.filter(v => !before.databaseViews.some(old => old.id === v.id));
      assert.equal(added.length, 1); createdId = added[0].id;
      assert.equal(added[0].name, ''); assert.equal(added[0].type, 'gallery'); assert.equal(added[0].sourceId, 'projects');
      assert.equal(new Set(after.databaseViews.map(v => v.id)).size, after.databaseViews.length);
      for (const old of before.databaseViews) assert.deepEqual(after.databaseViews.find(v => v.id === old.id), old);
      for (const field of ['dataSources', 'databaseItems', 'attachments']) assert.deepEqual(after[field], before[field], field);
      await waitActive(db, createdId);
      await assertCurrentInside(db);
      const creation = page.getByRole('dialog', { name: '新建视图', exact: true });
      assert.equal(await creation.getByRole('textbox', { name: '视图名称', exact: true }).inputValue(), '');
      assert.equal(await db.locator('[role="tab"][aria-selected="true"]').getAttribute('aria-label'), '新视图');
      await creation.getByRole('button', { name: '完成', exact: true }).click();
      await creation.waitFor({ state: 'detached' });
      await settle(page);
      assert.equal(await db.locator('[role="tab"][aria-selected="true"]').getAttribute('aria-label'), '画廊');
      assert.equal((await saved()).databaseViews.find(v => v.id === createdId).name, '');
      await screenshot('created-blank-after-done');
    });
    await check('Gallery17 common properties retain fixed title count, empty selection, selected 0 and false, and restore empty', async () => {
      const current = (await saved()).databaseViews.find(v => v.id === createdId);
      assert.deepEqual(current.config.gallery.visiblePropertyIds, []);
      assert.equal(await db.locator('.db-gallery-properties').count(), 0);
      let panel = await openViewSettingsSection(db);
      assert.equal(await panel.getByRole('button', { name: /^显示属性(?:\s|$)/ }).locator('small').innerText(), '1');
      await panel.getByRole('button', { name: /^显示属性(?:\s|$)/ }).click();
      const title = panel.getByRole('checkbox', { name: '显示 名称', exact: true });
      assert.equal(await title.isChecked(), true); assert.equal(await title.isDisabled(), true);
      await panel.getByRole('checkbox', { name: '显示 金额', exact: true }).check();
      await panel.getByRole('checkbox', { name: '显示 确认', exact: true }).check();
      const selected = await persisted(w => w.databaseViews.find(v => v.id === createdId).config.gallery.visiblePropertyIds.length === 2);
      const alpha = db.locator('.db-gallery-card[data-item-id="alpha"]');
      await alpha.locator('[data-property-id="amount"]').waitFor();
      assert.equal((await alpha.locator('[data-property-id="amount"]').innerText()).trim(), '0');
      assert.equal(await alpha.locator('[data-property-id="checked"] [data-checked="false"]').count(), 1);
      for (const old of before.databaseViews) assert.deepEqual(selected.databaseViews.find(v => v.id === old.id), old);
      assert.deepEqual(selected.dataSources, before.dataSources); assert.deepEqual(selected.databaseItems, before.databaseItems);
      await panel.getByRole('checkbox', { name: '显示 金额', exact: true }).uncheck();
      await panel.getByRole('checkbox', { name: '显示 确认', exact: true }).uncheck();
      await persisted(w => w.databaseViews.find(v => v.id === createdId).config.gallery.visiblePropertyIds.length === 0);
      await setViewSettings(db, false);
      await page.reload({ waitUntil: 'domcontentloaded' }); await waitActive(db, createdId);
      assert.equal(await db.locator('.db-gallery-properties').count(), 0);
      assert.deepEqual((await saved()).databaseViews.find(v => v.id === createdId).config.gallery.visiblePropertyIds, []);
      await assertCurrentInside(db);
    });
    await check('Existing Add chooser Escape creates nothing, and Escape after choosing retains the empty named view once', async () => {
      const stable = await saved();
      await db.getByRole('button', { name: '添加视图', exact: true }).click();
      let chooser = page.getByRole('dialog', { name: '添加视图', exact: true });
      await chooser.waitFor(); await page.keyboard.press('Escape'); await chooser.waitFor({ state: 'detached' });
      assert.deepEqual((await saved()).databaseViews, stable.databaseViews);
      await db.getByRole('button', { name: '添加视图', exact: true }).click();
      chooser = page.getByRole('dialog', { name: '添加视图', exact: true });
      await chooser.getByRole('button', { name: '列表', exact: true }).click();
      const after = await persisted(w => w.databaseViews.length === stable.databaseViews.length + 1);
      const added = after.databaseViews.filter(v => !stable.databaseViews.some(old => old.id === v.id));
      assert.equal(added.length, 1); assert.equal(added[0].name, ''); assert.equal(added[0].type, 'list');
      await page.getByRole('dialog', { name: '新建视图', exact: true }).waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: '新建视图', exact: true }).waitFor({ state: 'detached' });
      await waitActive(db, added[0].id); await assertCurrentInside(db);
      assert.equal(await db.locator('[role="tab"][aria-selected="true"]').getAttribute('aria-label'), '列表');
      await page.reload({ waitUntil: 'domcontentloaded' }); await waitActive(db, added[0].id);
      assert.equal((await saved()).databaseViews.find(v => v.id === added[0].id).name, '');
      assert.equal((await saved()).databaseViews.length, stable.databaseViews.length + 1);
      for (const field of ['dataSources', 'databaseItems', 'attachments']) assert.deepEqual((await saved())[field], before[field], field);
      await screenshot('escaped-blank-list-after-reload');
    });
  });

  report.passed = report.scenarios.every(s => s.errors.length === 0 && s.checks.every(c => c.passed));
} finally {
  await browser?.close();
  report.closedAt = new Date().toISOString(); publish();
}
console.log(JSON.stringify({ run, passed: report.passed, scenarios: report.scenarios.length, checks: report.scenarios.flatMap(s => s.checks).length, failed: report.scenarios.flatMap(s => s.checks).filter(c => !c.passed).length, errors: report.scenarios.flatMap(s => s.errors).length, report: reportPath }));
if (!report.passed) process.exitCode = 1;
