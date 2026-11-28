import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { sourceFingerprint } from './harness.mjs';
import { coreParityWorkspace } from '../fixtures/core-parity-workspace.mjs';
import { upgradeWorkspace } from '../../src/persistence/migrations.js';
import { workspaceStorageKey } from '../../src/persistence/workspaceRepository.js';

// This script never starts a server. Supply an already approved isolated app URL.
const run = process.env.V10_SELECTION_RUN;
const base = process.env.V10_SELECTION_BASE_URL;
if (!run || !/^[a-z0-9-]+$/.test(run)) throw new Error('Set V10_SELECTION_RUN to a new lowercase run label');
if (!base) throw new Error('Set V10_SELECTION_BASE_URL to the isolated app URL');
const url = new URL(base);
if (url.href !== 'http://127.0.0.1:5178/') throw new Error('V10_SELECTION_BASE_URL must be http://127.0.0.1:5178');
const dir = path.resolve('.qa/LOCAL-NOTION-001/v10-nested-database13/selection', run);
if (existsSync(dir)) throw new Error(`Evidence directory already exists: ${dir}`);
mkdirSync(dir, { recursive: true });
const report = { run, base: url.origin, startedAt: new Date().toISOString(), sourceFingerprint: sourceFingerprint(), passed: false, checks: [], errors: [] };
const publish = () => writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
publish();

const fixture = coreParityWorkspace();
const host = fixture.pages.find(p => p.id === 'editor-page');
host.content = [
  { id: 'selection-before', type: 'paragraph', content: 'Before database selection boundary' },
  { id: 'selection-db', type: 'databaseView', props: { sourceId: 'projects', viewId: 'view-calendar' } },
  { id: 'selection-after', type: 'paragraph', content: 'After database selection boundary' },
];
fixture.pages.find(p => p.id === 'alpha-page').content = [
  { id: 'selection-peek-before', type: 'paragraph', content: 'Before nested database' },
  { id: 'selection-peek-db', type: 'databaseView', props: { sourceId: 'projects', viewId: 'view-calendar' } },
  { id: 'selection-peek-after', type: 'paragraph', content: 'After nested database' },
];
fixture.databaseViews = fixture.databaseViews.filter(v => v.sourceId !== 'projects' || ['view-table', 'view-calendar'].includes(v.id));
fixture.databaseViews.find(v => v.id === 'view-calendar').config = { calendar: { anchorDate: '2026-09-01', startOfWeek: 1, showWeekends: true } };
fixture.ui.selectedPageId = host.id;
fixture.ui.preferences = { style: 'mobai', theme: 'system' };
const seed = upgradeWorkspace(fixture);

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
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="editor-page"]').click();
  const outerRoot = '.life-editor[data-page-id="editor-page"] .bn-editor';
  const peekRoot = '.life-editor[data-page-id="alpha-page"] .bn-editor';
  const outerDb = page.locator(`${outerRoot} [data-id="selection-db"] section.database-view`);
  const peek = page.getByRole('dialog', { name: '记录预览', exact: true });
  await outerDb.locator('.db-calendar-grid').waitFor();
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const snapshot = async (rootSelector, blockId, label) => {
    await settle();
    const state = await page.evaluate(({ rootSelector, blockId }) => {
      const root = document.querySelector(rootSelector);
      const block = root?.querySelector(`[data-id="${blockId}"]`);
      const db = block?.querySelector('section.database-view');
      if (!root || !block || !db) throw new Error(`Missing editor or database: ${rootSelector} ${blockId}`);
      const editor = root.pmViewDesc?.node.type.schema.cached.blockNoteEditor;
      if (!editor) throw new Error('BlockNote editor state is unavailable');
      const sel = editor.prosemirrorState.selection;
      let databasePosition = null;
      editor.prosemirrorState.doc.descendants((node, pos) => {
        if (node.attrs?.id === blockId) {
          node.descendants((child, offset) => {
            if (child.type.name === 'databaseView' && databasePosition === null) databasePosition = { from: pos + 1 + offset, to: pos + 1 + offset + child.nodeSize };
          });
          return false;
        }
      });
      if (!databasePosition) throw new Error(`Database node not found in ProseMirror document: ${blockId}`);
      const dom = window.getSelection();
      const describe = node => {
        const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        return el ? { tag: el.tagName, className: typeof el.className === 'string' ? el.className : '', blockId: el.closest('[data-id]')?.dataset.id || null, inDatabase: db.contains(el) } : null;
      };
      let coversDatabase = false;
      if (dom?.rangeCount && !dom.isCollapsed) {
        const dbRange = document.createRange(); dbRange.selectNodeContents(db);
        const range = dom.getRangeAt(0);
        coversDatabase = range.compareBoundaryPoints(Range.START_TO_START, dbRange) <= 0 && range.compareBoundaryPoints(Range.END_TO_END, dbRange) >= 0;
      }
      const selected = [...root.querySelectorAll('.ProseMirror-selectednode')].map(el => ({ tag: el.tagName, className: el.className, blockId: el.closest('[data-id]')?.dataset.id || null, containsDatabase: el.contains(db), insideDatabase: db.contains(el) }));
      const node = sel.node;
      return {
        pm: { type: sel.constructor.name, json: sel.toJSON(), from: sel.from, to: sel.to, empty: sel.empty, nodeType: node?.type.name || null, nodeAttrs: node?.attrs || null, databasePosition, coversDatabase: sel.from <= databasePosition.from && sel.to >= databasePosition.to, focused: editor.prosemirrorView.hasFocus() },
        selected, blockClass: block.className, databaseClass: db.className,
        dom: { type: dom?.type, collapsed: dom?.isCollapsed, text: dom?.toString().slice(0, 2000), textLength: dom?.toString().length || 0, anchor: describe(dom?.anchorNode), focus: describe(dom?.focusNode), coversDatabase },
        active: describe(document.activeElement),
      };
    }, { rootSelector, blockId });
    writeFileSync(path.join(dir, `${label}.json`), JSON.stringify(state, null, 2));
    await page.screenshot({ path: path.join(dir, `${label}.png`), animations: 'disabled' });
    return state;
  };
  const check = async (name, action) => {
    const item = { name, passed: false }; report.checks.push(item); publish();
    try { await action(); item.passed = true; }
    catch (error) { item.error = error.stack; await page.screenshot({ path: path.join(dir, `${name}-error.png`), animations: 'disabled' }).catch(() => {}); }
    publish();
  };
  const noWholeSelection = (s) => {
    assert.equal(s.pm.json.type === 'node' && s.pm.coversDatabase, false, 'ordinary click selected the database node');
    assert.notEqual(s.pm.json.type, 'all', 'ordinary click selected the entire editor');
    assert.equal(s.selected.some(x => x.containsDatabase || x.insideDatabase), false, 'database has ProseMirror-selectednode decoration');
    assert.equal(s.dom.coversDatabase, false, 'DOM text selection covers the whole database');
  };
  const reset = async (root, id) => { await page.locator(`${root} [data-id="${id}"] .bn-inline-content`).click(); await settle(); };
  const probe = async (name, root, blockId, beforeId, action) => {
    await check(name, async () => {
      await reset(root, beforeId);
      await snapshot(root, blockId, `${name}-before`);
      await action();
      noWholeSelection(await snapshot(root, blockId, `${name}-after`));
    });
  };
  await probe('outer-grid-blank', outerRoot, 'selection-db', 'selection-before', async () => {
    await outerDb.locator('.db-calendar-cell[data-date="2026-09-20"]').click({ position: { x: 12, y: 55 } });
  });
  await probe('outer-date', outerRoot, 'selection-db', 'selection-before', async () => {
    await outerDb.locator('.db-calendar-cell[data-date="2026-09-20"] time').click();
  });
  await probe('outer-card', outerRoot, 'selection-db', 'selection-before', async () => {
    await outerDb.locator('.db-calendar-record').filter({ hasText: 'Alpha 项目' }).click();
    await peek.waitFor();
  });
  if (await peek.isVisible()) await peek.getByRole('button', { name: '关闭预览' }).click();
  await probe('outer-menu', outerRoot, 'selection-db', 'selection-before', async () => {
    await outerDb.getByRole('button', { name: '视图设置', exact: true }).click();
    await page.getByRole('dialog', { name: '视图设置' }).waitFor();
  });
  await page.keyboard.press('Escape');
  await check('open-record-for-nested', async () => {
    await outerDb.locator('.db-calendar-record').filter({ hasText: 'Alpha 项目' }).click();
    await peek.waitFor();
    await peek.locator(`${peekRoot} [data-id="selection-peek-db"] .db-calendar-grid`).waitFor();
  });
  if (await peek.isVisible()) {
    const nestedDb = peek.locator(`${peekRoot} [data-id="selection-peek-db"] section.database-view`);
    await probe('peek-grid-blank', peekRoot, 'selection-peek-db', 'selection-peek-before', async () => {
      await nestedDb.locator('.db-calendar-cell[data-date="2026-09-20"]').click({ position: { x: 12, y: 55 } });
    });
    await probe('peek-date', peekRoot, 'selection-peek-db', 'selection-peek-before', async () => {
      await nestedDb.locator('.db-calendar-cell[data-date="2026-09-20"] time').click();
    });
    await peek.getByRole('button', { name: '关闭预览' }).click();
  }
  if (process.env.V10_SELECTION_GUARDS === '1') {
    await check('explicit-block-selection-delete-undo', async () => {
      await reset(outerRoot, 'selection-before');
      await outerDb.locator('.db-calendar-cell[data-date="2026-09-20"]').click({ position: { x: 12, y: 55 }, modifiers: ['Control'] });
      const selected = await snapshot(outerRoot, 'selection-db', 'guard-explicit-selection');
      assert.equal(selected.pm.json.type, 'node', 'Ctrl-click should retain explicit node selection');
      assert.equal(selected.pm.coversDatabase, true, 'explicit selection must include this database');
      await page.keyboard.press('Delete');
      await page.locator(`${outerRoot} [data-id="selection-db"]`).waitFor({ state: 'detached' });
      await page.keyboard.press('Control+z');
      await outerDb.locator('.db-calendar-grid').waitFor();
      await snapshot(outerRoot, 'selection-db', 'guard-delete-undo');
    });
    await check('cross-block-selection', async () => {
      await reset(outerRoot, 'selection-before');
      const endpoints = await page.evaluate(rootSelector => {
        const root = document.querySelector(rootSelector);
        const editor = root.pmViewDesc.node.type.schema.cached.blockNoteEditor;
        const a = root.querySelector('[data-id="selection-before"] .bn-inline-content').firstChild;
        const b = root.querySelector('[data-id="selection-after"] .bn-inline-content').firstChild;
        const selection = window.getSelection(); selection.setBaseAndExtent(a, 1, b, b.textContent.length - 1);
        return { anchor: editor.prosemirrorView.posAtDOM(a, 1), head: editor.prosemirrorView.posAtDOM(b, b.textContent.length - 1) };
      }, outerRoot);
      await page.waitForFunction(({ rootSelector, endpoints }) => {
        const s = document.querySelector(rootSelector).pmViewDesc.node.type.schema.cached.blockNoteEditor.prosemirrorState.selection;
        return !s.empty && s.anchor === endpoints.anchor && s.head === endpoints.head;
      }, { rootSelector: outerRoot, endpoints });
      const selected = await snapshot(outerRoot, 'selection-db', 'guard-cross-block');
      assert.equal(selected.pm.empty, false);
      assert.ok(selected.pm.from < selected.pm.to);
      assert.equal(selected.pm.coversDatabase, true, 'cross-block selection must span the database node');
    });
    await check('drag-block-and-undo', async () => {
      await reset(outerRoot, 'selection-before');
      await outerDb.locator('.db-view-header').hover();
      const handle = page.locator('.life-block-actions[data-block-id="selection-db"] .life-block-handle');
      const target = page.locator(`${outerRoot} [data-id="selection-before"] .bn-block-content`).first();
      await handle.waitFor();
      const h = await handle.boundingBox(), t = await target.boundingBox();
      assert.ok(h && t, 'drag handle and target must be visible');
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      await page.mouse.down();
      await page.mouse.move(t.x + t.width / 2, t.y + 2, { steps: 12 });
      await page.mouse.move(t.x + t.width / 2 + 1, t.y + 2);
      await page.locator('.life-block-drop-preview[data-drop-kind="content"]').waitFor();
      await page.screenshot({ path: path.join(dir, 'guard-drag-preview.png'), animations: 'disabled' });
      await page.mouse.up();
      await page.waitForFunction(rootSelector => {
        const doc = document.querySelector(rootSelector).pmViewDesc.node.type.schema.cached.blockNoteEditor.document;
        return doc.findIndex(b => b.id === 'selection-db') < doc.findIndex(b => b.id === 'selection-before');
      }, outerRoot);
      await snapshot(outerRoot, 'selection-db', 'guard-after-drag');
      await page.keyboard.press('Control+z');
      await page.waitForFunction(rootSelector => {
        const doc = document.querySelector(rootSelector).pmViewDesc.node.type.schema.cached.blockNoteEditor.document;
        return doc.findIndex(b => b.id === 'selection-before') < doc.findIndex(b => b.id === 'selection-db');
      }, outerRoot);
      await snapshot(outerRoot, 'selection-db', 'guard-drag-undo');
    });
  }
  assert.deepEqual(report.errors, [], 'browser errors');
  report.passed = report.checks.length > 0 && report.checks.every(c => c.passed);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.fatal = error.stack; process.exitCode = 1;
  if (page) await page.screenshot({ path: path.join(dir, 'fatal.png'), animations: 'disabled' }).catch(() => {});
} finally {
  await browser?.close().catch(e => { report.errors.push({ kind: 'close', message: e.message }); report.passed = false; process.exitCode = 1; });
  report.completedAt = new Date().toISOString(); publish();
  console.log(`Selection evidence: ${dir}; passed=${report.passed}`);
}
