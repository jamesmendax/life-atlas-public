import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { sourceFingerprint } from './harness.mjs';
import { coreParityWorkspace } from '../fixtures/core-parity-workspace.mjs';
import { upgradeWorkspace } from '../../src/persistence/migrations.js';
import { workspaceStorageKey } from '../../src/persistence/workspaceRepository.js';

// The parent starts the approved isolated application; this script starts no server.
const run = process.env.V10_INITIAL_SELECTION_RUN;
const base = process.env.V10_INITIAL_SELECTION_BASE_URL;
if (!run || !/^[a-z0-9-]+$/.test(run)) throw new Error('Set V10_INITIAL_SELECTION_RUN to a new lowercase run label');
if (!base || new URL(base).href !== 'http://127.0.0.1:5178/') throw new Error('V10_INITIAL_SELECTION_BASE_URL must be http://127.0.0.1:5178');
const dir = path.resolve('.qa/LOCAL-NOTION-001/v10-nested-database13/initial-selection', run);
if (existsSync(dir)) throw new Error(`Evidence directory already exists: ${dir}`);
mkdirSync(dir, { recursive: true });
const report = { run, base: 'http://127.0.0.1:5178', sourceFingerprint: sourceFingerprint(), startedAt: new Date().toISOString(), passed: false, checks: [], errors: [] };
const publish = () => writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
publish();

const workspace = coreParityWorkspace();
workspace.pages.find(p => p.id === 'editor-page').content = [
  { id: 'initial-host-db', type: 'databaseView', props: { sourceId: 'projects', viewId: 'view-calendar' } },
  { id: 'initial-host-tail', type: 'paragraph', content: '' },
];
workspace.pages.find(p => p.id === 'alpha-page').content = [
  { id: 'initial-record-db', type: 'databaseView', props: { sourceId: 'projects', viewId: 'view-calendar' } },
  { id: 'initial-record-tail', type: 'paragraph', content: '' },
];
workspace.databaseViews = workspace.databaseViews.filter(v => v.sourceId !== 'projects' || ['view-table', 'view-calendar'].includes(v.id));
workspace.databaseViews.find(v => v.id === 'view-calendar').config = { calendar: { anchorDate: '2026-09-01', startOfWeek: 1, showWeekends: true } };
workspace.ui.selectedPageId = 'editor-page';
workspace.ui.preferences = { style: 'mobai', theme: 'system' };
const seed = upgradeWorkspace(workspace);
let browser, page;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1040 } });
  await context.addInitScript(({ key, seed }) => {
    if (!localStorage.getItem('life-atlas.harness.seeded')) {
      localStorage.setItem(key, JSON.stringify(seed));
      localStorage.setItem('life-atlas.harness.seeded', '1');
      localStorage.setItem('life-atlas.parity.seeded', '1');
    }
  }, { key: workspaceStorageKey, seed });
  page = await context.newPage();
  await page.clock.setFixedTime(new Date('2026-09-18T12:00:00.000Z'));
  page.setDefaultTimeout(9000);
  page.on('pageerror', e => report.errors.push({ kind: 'pageerror', message: e.stack }));
  page.on('console', m => { if (m.type() === 'error') report.errors.push({ kind: 'console', message: m.text() }); });
  page.on('response', r => { if (r.status() >= 400) report.errors.push({ kind: 'http', status: r.status(), url: r.url() }); });
  await page.goto('http://127.0.0.1:5178', { waitUntil: 'domcontentloaded' });
  await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="editor-page"]').click();
  const host = page.locator('.life-editor[data-page-id="editor-page"] [data-id="initial-host-db"] section.database-view');
  const peek = page.getByRole('dialog', { name: '记录预览', exact: true });
  const rootSelector = '.record-peek .life-editor[data-page-id="alpha-page"] .bn-editor';
  const record = host.locator('.db-calendar-record').filter({ hasText: 'Alpha 项目' });
  await host.locator('.db-calendar-grid').waitFor();
  await record.waitFor();
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const snapshot = async label => {
    await settle();
    const data = await page.evaluate(selector => {
      const root = document.querySelector(selector);
      const block = root?.querySelector('[data-id="initial-record-db"]');
      const db = block?.querySelector('section.database-view');
      const editor = root?.pmViewDesc?.node.type.schema.cached.blockNoteEditor;
      if (!root || !db || !editor) throw new Error('Record PageEditor or database node view unavailable');
      const sel = editor.prosemirrorState.selection;
      const doc = editor.document;
      let dbPosition = null;
      editor.prosemirrorState.doc.descendants((node, pos) => {
        if (node.attrs?.id !== 'initial-record-db') return;
        node.descendants((child, offset) => {
          if (child.type.name === 'databaseView' && !dbPosition) dbPosition = { from: pos + 1 + offset, to: pos + 1 + offset + child.nodeSize };
        });
        return false;
      });
      if (!dbPosition) throw new Error('Database node not found in ProseMirror document');
      const describe = node => {
        const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        return el ? { tag: el.tagName, className: typeof el.className === 'string' ? el.className : '', blockId: el.closest('[data-id]')?.dataset.id || null, inDatabase: db.contains(el), ariaLabel: el.getAttribute('aria-label') } : null;
      };
      const dom = window.getSelection();
      let coversDatabase = false;
      if (dom?.rangeCount && !dom.isCollapsed) {
        const range = dom.getRangeAt(0), dbRange = document.createRange(); dbRange.selectNodeContents(db);
        coversDatabase = range.compareBoundaryPoints(Range.START_TO_START, dbRange) <= 0 && range.compareBoundaryPoints(Range.END_TO_END, dbRange) >= 0;
      }
      const ancestors = [];
      for (let i = 0; i <= sel.$from.depth; i++) ancestors.push({ type: sel.$from.node(i).type.name, id: sel.$from.node(i).attrs?.id || null });
      return {
        blocks: doc.map(b => ({ id: b.id, type: b.type, content: b.content, props: b.props })),
        pm: { type: sel.constructor.name, json: sel.toJSON(), from: sel.from, to: sel.to, empty: sel.empty, nodeType: sel.node?.type.name || null, dbPosition, coversDatabase: sel.from <= dbPosition.from && sel.to >= dbPosition.to, focused: editor.prosemirrorView.hasFocus(), ancestors },
        selected: [...root.querySelectorAll('.ProseMirror-selectednode')].map(el => ({ className: el.className, blockId: el.closest('[data-id]')?.dataset.id || null, containsDatabase: el.contains(db), insideDatabase: db.contains(el) })),
        dom: { type: dom?.type, collapsed: dom?.isCollapsed, textLength: dom?.toString().length || 0, text: dom?.toString().slice(0, 2000), anchor: describe(dom?.anchorNode), focus: describe(dom?.focusNode), coversDatabase },
        active: describe(document.activeElement),
      };
    }, rootSelector);
    writeFileSync(path.join(dir, `${label}.json`), JSON.stringify(data, null, 2));
    await page.screenshot({ path: path.join(dir, `${label}.png`), animations: 'disabled' });
    return data;
  };
  const check = async (name, action) => {
    const item = { name, passed: false }; report.checks.push(item); publish();
    try { await action(); item.passed = true; }
    catch (error) { item.error = error.stack; await page.screenshot({ path: path.join(dir, `${name}-error.png`), animations: 'disabled' }).catch(() => {}); }
    publish();
  };
  const assertInitial = s => {
    assert.deepEqual(s.blocks.slice(0, 2).map(b => [b.id, b.type]), [['initial-record-db', 'databaseView'], ['initial-record-tail', 'paragraph']], 'fixture must start with database then paragraph');
    assert.equal(s.blocks.length, 2, 'fixture has only database and trailing paragraph');
    assert.equal(JSON.stringify(s.blocks[1].content), '[]', 'trailing paragraph starts empty');
    assert.equal(s.active?.ariaLabel, '记录标题', 'record title is focused');
    assert.notEqual(s.pm.json.type, 'node', 'initial record selection must not be a node');
    assert.notEqual(s.pm.json.type, 'all', 'initial record selection must not be all');
    assert.equal(s.selected.length, 0, 'initial record has no selected node decoration');
    assert.equal(s.dom.coversDatabase, false, 'DOM selection must not cover the database');
  };
  const open = async () => {
    await record.click();
    await peek.waitFor();
    await peek.locator('.life-editor[data-page-id="alpha-page"] .bn-editor [data-id="initial-record-db"] .db-calendar-grid').waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '记录标题');
  };
  const checkOpen = async label => {
    await check(label, async () => {
      await open();
      const initial = await snapshot(`${label}-open`);
      await page.waitForTimeout(350);
      const stable = await snapshot(`${label}-stable`);
      assertInitial(initial); assertInitial(stable);
    });
  };
  await checkOpen('first');
  if (await peek.isVisible()) { await peek.getByRole('button', { name: '关闭预览', exact: true }).click(); await peek.waitFor({ state: 'hidden' }); }
  await checkOpen('reopen');
  await check('title-enter-editable-tail', async () => {
    assert.equal(await peek.getByRole('textbox', { name: '记录标题' }).evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Enter');
    const focused = await snapshot('title-enter');
    assert.equal(focused.pm.focused, true, 'Enter should focus the editor');
    assert.equal(focused.pm.json.type, 'text', 'Enter should focus a text position');
    assert.equal(focused.pm.empty, true, 'Enter should place a caret');
    assert.equal(focused.pm.ancestors.some(a => a.id === 'initial-record-tail'), true, 'caret should be in editable trailing paragraph');
    assert.equal(focused.selected.length, 0, 'Enter should not select a database node');
    await page.keyboard.insertText('initial selection edit');
    await page.waitForFunction(selector => {
      const editor = document.querySelector(selector)?.pmViewDesc?.node.type.schema.cached.blockNoteEditor;
      return JSON.stringify(editor?.getBlock('initial-record-tail')?.content).includes('initial selection edit');
    }, rootSelector);
    await snapshot('title-enter-typed');
  });
  assert.deepEqual(report.errors, [], 'browser errors');
  report.passed = report.checks.length === 3 && report.checks.every(c => c.passed);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.fatal = error.stack; process.exitCode = 1;
  if (page) await page.screenshot({ path: path.join(dir, 'fatal.png'), animations: 'disabled' }).catch(() => {});
} finally {
  await browser?.close().catch(e => { report.errors.push({ kind: 'close', message: e.message }); report.passed = false; process.exitCode = 1; });
  report.completedAt = new Date().toISOString(); publish();
  console.log(`Initial selection evidence: ${dir}; passed=${report.passed}`);
}
