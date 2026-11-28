import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { browserScenario, sourceFingerprint } from './harness.mjs';
import { coreParityWorkspace } from '../fixtures/core-parity-workspace.mjs';
import { normalizeLoadedWorkspace } from '../../src/persistence/normalize.js';

const run = process.env.V10_FIRSTBLOCK21_RUN;
if (!run || !/^[a-z0-9-]+$/.test(run)) throw new Error('Set a unique V10_FIRSTBLOCK21_RUN label');
const qa = '.qa/LOCAL-NOTION-001/v10-gallery-firstblock21';
const externalBase = process.env.PARITY_BASE_URL;
if (externalBase) assert.equal(new URL(externalBase).origin, 'http://127.0.0.1:5178');
const name = suffix => `LOCAL-NOTION-001/v10-gallery-firstblock21/${run}-${suffix}`;
mkdirSync(qa, { recursive: true });
for (const suffix of ['text', 'later-image', 'compat']) {
  if (existsSync(`.qa/${name(suffix)}.json`) || existsSync(`.qa/${name(suffix)}-failure.png`)) {
    throw new Error(`Preserve prior evidence; choose another label: ${name(suffix)}`);
  }
}
const runtime = path.resolve(qa, `${run}-runtime`);
if (existsSync(runtime)) throw new Error(`Preserve prior runtime; choose another label: ${runtime}`);
const temp = path.join(runtime, 'temp');
const cache = path.join(runtime, 'cache');
mkdirSync(temp, { recursive: true });
mkdirSync(cache, { recursive: true });
process.env.TEMP = temp;
process.env.TMP = temp;
process.env.XDG_CACHE_HOME = cache;
process.env.npm_config_cache = cache;
process.env.PARITY_BASE_URL = externalBase || 'http://127.0.0.1:5178';

// Same algorithm as the browser harness, excluding only this newly added test.
function formalBaselineFingerprint() {
  const files = [];
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (file.replaceAll('\\', '/') !== 'tests/browser/v10-gallery-firstblock21.mjs') files.push(file);
    }
  };
  visit('src'); visit('tests');
  files.push('package.json', 'package-lock.json');
  const hash = createHash('sha256');
  for (const file of files.sort()) { hash.update(file.replaceAll('\\', '/')); hash.update(readFileSync(file)); }
  return hash.digest('hex');
}

async function provePortFree() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen({ host: '0.0.0.0', port: 5178, exclusive: true }, resolve);
  });
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
}

const first = 'V10 首块文本后图片 · 画廊复验21';
const selector = item => `section.database-view[data-source-id="projects"] .db-gallery-card[data-item-id="${item}"] .db-gallery-content`;
const domains = ['pages', 'databaseItems', 'dataSources', 'databaseViews', 'attachments'];
function fixture() {
  const value = coreParityWorkspace();
  value.ui.preferences = { style: 'mobai', theme: 'system' };
  value.ui.selectedPageId = 'database-page';
  value.pages.find(page => page.id === 'database-page').databaseViewId = 'view-gallery';
  value.databaseViews.find(view => view.id === 'view-gallery').config = {
    gallery: { preview: { kind: 'page-content', propertyId: null }, cardSize: 'medium', imageFit: 'cover', visiblePropertyIds: [] },
  };
  value.pages.find(page => page.id === 'alpha-page').content = [
    { id: 'first-text-21', type: 'paragraph', content: [
      { type: 'text', text: 'V10 首块文本后图片 · ', styles: {} },
      { type: 'text', text: '画廊复验21', styles: {} },
    ] },
    { id: 'second-text-21', type: 'paragraph', content: '/image' },
  ];
  return normalizeLoadedWorkspace(value, { idFactory: prefix => `${prefix}-firstblock21` });
}
async function openGallery(page) {
  await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="database-page"]').click();
  const db = page.locator('section.database-view[data-source-id="projects"]');
  await db.waitFor();
  await page.waitForFunction(() => document.querySelector('section.database-view[data-source-id="projects"]')?.dataset.viewType === 'gallery');
  return db;
}
async function decodeCard(page, target) {
  await page.waitForFunction(selector => {
    const image = document.querySelector(selector)?.querySelector('img');
    return Boolean(image?.complete && image.naturalWidth > 0);
  }, target);
  const observed = await page.locator(target).evaluate(async element => {
    const image = element.querySelector('img');
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight, background: getComputedStyle(element).backgroundImage };
  });
  assert.ok(observed.width > 0 && observed.height > 0, JSON.stringify(observed));
  assert.match(observed.background, /blob:/);
  assert.doesNotMatch(observed.background, /expired-firstblock21/);
  return observed;
}

// Follow the existing Gallery fixture: seed IndexedDB while the App is unloaded,
// then retain an intentionally expired blob URL with its managed attachment ID.
async function seedImage(page, mode) {
  const appUrl = page.url();
  const seedUrl = new URL('/src/domain/attachments.js', appUrl).href;
  let served = false;
  const routeSeed = async route => {
    if (!served && route.request().isNavigationRequest()) {
      served = true;
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body></body></html>' });
    } else await route.continue();
  };
  await page.route(seedUrl, routeSeed);
  let response;
  try { response = await page.goto(seedUrl, { waitUntil: 'domcontentloaded' }); }
  finally { await page.unroute(seedUrl, routeSeed); }
  assert.equal(response?.status(), 200);
  assert.equal(await page.locator('section.database-view, .life-editor').count(), 0, 'App must be unloaded during fixture seed');
  const local = await page.evaluate(async ({ mode, first }) => {
    const { persistBrowserAttachment } = await import('/src/domain/attachments.js');
    const { workspaceStorageKey } = await import('/src/persistence/workspaceRepository.js');
    const { normalizeLoadedWorkspace } = await import('/src/persistence/normalize.js');
    const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNYsGDBfwAGpALg68ByCAAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(pixel), c => c.charCodeAt(0));
    const answer = await persistBrowserAttachment(new File([bytes], 'firstblock21.png', { type: 'image/png' }), { id: 'firstblock21-managed-image' });
    const expired = answer.url.replace(/^blob:[^#]+/, 'blob:http://127.0.0.1:5178/expired-firstblock21');
    const workspace = JSON.parse(localStorage.getItem(workspaceStorageKey));
    workspace.attachments.push(answer.metadata);
    const image = id => ({ id, type: 'image', props: { url: expired, name: 'firstblock21.png' } });
    const alpha = workspace.pages.find(entry => entry.id === 'alpha-page');
    if (mode === 'later') alpha.content = [
      { id: 'first-text-21', type: 'paragraph', content: first }, image('later-image-21'),
      { id: 'later-text-21', type: 'paragraph', content: '/image' },
    ];
    if (mode === 'compat') {
      alpha.content = [image('first-image-21'), { id: 'after-image-21', type: 'paragraph', content: 'later text' }];
      workspace.pages.find(entry => entry.id === 'beta-page').content = [
        { id: 'nested-parent-21', type: 'toggleListItem', content: 'nested preview', children: [image('nested-image-21')] },
      ];
    }
    localStorage.setItem(workspaceStorageKey, JSON.stringify(normalizeLoadedWorkspace(workspace)));
    return { id: answer.metadata.id, expired };
  }, { mode, first });
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  return local;
}

let server;
let before;
try {
  before = { all: sourceFingerprint(), formal: formalBaselineFingerprint() };
  console.log(`FINGERPRINT_BEFORE all=${before.all} baseline_without_new_test=${before.formal}`);
  if (process.env.V10_FIRSTBLOCK21_EXPECT_BASELINE) {
    assert.equal(before.formal, process.env.V10_FIRSTBLOCK21_EXPECT_BASELINE, 'Requested source/test baseline changed');
  }
  if (!externalBase) {
    await provePortFree();
    console.log('PORT_5178_PRECHECK_FREE=true');
    const { createServer } = await import('vite');
    server = await createServer({
      configLoader: 'native', cacheDir: cache, logLevel: 'error',
      server: { host: '127.0.0.1', port: 5178, strictPort: true },
    });
    await server.listen();
    console.log(`OWNED_VITE pid=${process.pid} temp=${temp} cache=${cache}`);
  } else console.log(`EXTERNAL_PARITY_SERVER owner=parent url=${externalBase}`);

  await browserScenario(name('text'), async ({ page, check, saved, screenshot }) => {
    await openGallery(page);
    await check('fixture retains two separate paragraphs and stable page identity', async () => {
      const state = await saved();
      assert.equal(state.databaseItems.find(item => item.id === 'alpha').pageId, 'alpha-page');
      assert.deepEqual(state.pages.find(entry => entry.id === 'alpha-page').content.map(block => block.id), ['first-text-21', 'second-text-21']);
    });
    await check('page content preview shows the first paragraph without the next paragraph', async () => {
      const preview = page.locator(selector('alpha'));
      const actual = await preview.innerText();
      const background = await preview.evaluate(element => getComputedStyle(element).backgroundImage);
      console.log(`TEXT_PREVIEW ${JSON.stringify({ actual, background })}`);
      await screenshot('observed');
      assert.equal(actual, first, 'Only the first paragraph belongs in this preview');
      assert.doesNotMatch(actual, /\/image/);
      assert.equal(background, 'none');
    });
  }, { workspace: fixture() });

  await browserScenario(name('later-image'), async ({ page, check, saved, screenshot }) => {
    const local = await seedImage(page, 'later');
    await openGallery(page);
    await page.reload();
    await openGallery(page);
    await check('later managed image is present and decodes independently after reload', async () => {
      const state = await saved();
      const blocks = state.pages.find(entry => entry.id === 'alpha-page').content;
      assert.deepEqual(blocks.map(block => block.id), ['first-text-21', 'later-image-21', 'later-text-21']);
      assert.equal(blocks[1].props.url, local.expired);
      assert.equal(state.databaseItems.find(item => item.id === 'alpha').pageId, 'alpha-page');
      const decoded = await page.evaluate(async id => {
        const { resolveBrowserAttachmentUrl } = await import('/src/domain/attachments.js');
        const url = await resolveBrowserAttachmentUrl(id);
        const image = new Image(); image.src = url;
        await image.decode();
        return { width: image.naturalWidth, height: image.naturalHeight, url };
      }, local.id);
      assert.ok(decoded.width > 0 && decoded.height > 0, JSON.stringify(decoded));
      assert.match(decoded.url, /blob:/);
      assert.doesNotMatch(decoded.url, /expired-firstblock21/);
      console.log(`LATER_ATTACHMENT_DECODED ${JSON.stringify(decoded)}`);
    });
    await check('first paragraph remains visible when a managed image follows it', async () => {
      const preview = page.locator(selector('alpha'));
      const image = preview.locator('img');
      if (await image.count()) await decodeCard(page, selector('alpha'));
      const actual = await preview.innerText();
      const background = await preview.evaluate(element => getComputedStyle(element).backgroundImage);
      console.log(`LATER_IMAGE_PREVIEW ${JSON.stringify({ actual, background })}`);
      await screenshot('observed');
      assert.equal(actual, first, 'A later image must not replace the first paragraph');
      assert.doesNotMatch(actual, /\/image/);
      assert.equal(background, 'none');
    });
  }, { workspace: fixture() });

  await browserScenario(name('compat'), async ({ page, check, saved, screenshot }) => {
    const local = await seedImage(page, 'compat');
    await openGallery(page);
    const beforeRead = await saved();
    await check('first image resolves and decodes from a managed expired reference', async () => {
      await decodeCard(page, selector('alpha'));
    });
    await check('nested image inside the first top-level subtree remains supported', async () => {
      await decodeCard(page, selector('beta'));
    });
    await check('both managed previews decode again after reload', async () => {
      await page.reload(); await openGallery(page);
      await decodeCard(page, selector('alpha'));
      await decodeCard(page, selector('beta'));
      await screenshot('decoded-after-reload');
    });
    await check('read and reload preserve page identities and managed stored references', async () => {
      const after = await saved();
      for (const domain of domains) assert.deepEqual(after[domain], beforeRead[domain], domain);
      assert.equal(after.databaseItems.find(item => item.id === 'alpha').pageId, 'alpha-page');
      assert.equal(after.databaseItems.find(item => item.id === 'beta').pageId, 'beta-page');
      assert.equal(after.pages.find(entry => entry.id === 'alpha-page').content[0].props.url, local.expired);
      assert.equal(after.pages.find(entry => entry.id === 'beta-page').content[0].children[0].props.url, local.expired);
      assert.ok(after.attachments.some(entry => entry.id === local.id));
    });
  }, { workspace: fixture() });
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  try {
    if (server) {
      await server.close();
      console.log('OWNED_VITE_CLOSED=true');
      await provePortFree();
      console.log('PORT_5178_POSTCLOSE_FREE=true');
    } else console.log('EXTERNAL_PARITY_SERVER_PRESERVED=true');
  } catch (error) { console.error(`CLEANUP_FAILURE ${error.stack}`); process.exitCode = 1; }
  try {
    const after = { all: sourceFingerprint(), formal: formalBaselineFingerprint() };
    console.log(`FINGERPRINT_AFTER all=${after.all} baseline_without_new_test=${after.formal}`);
    if (before) assert.deepEqual(after, before, 'Source/test inputs changed during this run');
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
