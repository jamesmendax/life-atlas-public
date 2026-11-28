import { existsSync } from 'node:fs';
import { browserScenario } from './harness.mjs';
import { coreParityWorkspace } from '../fixtures/core-parity-workspace.mjs';
import { walkBlocks } from '../../src/domain/blockDocument.js';
import { normalizeLoadedWorkspace } from '../../src/persistence/normalize.js';

const run = process.env.V10_GALLERY_RUN || 'prepared01';
if (!/^[a-z0-9-]+$/.test(run)) throw new Error('invalid gallery run label');
const name = suffix => 'LOCAL-NOTION-001/v10-gallery16/gallery-' + run + suffix;
for (const suffix of ['-covers', '-properties', '-content', '-create', '-locked']) {
  if (existsSync('.qa/' + name(suffix) + '.json')) throw new Error('Preserve previous gallery reports; choose a new V10_GALLERY_RUN');
}
function fixture({ locked = false } = {}) {
  const value = coreParityWorkspace();
  value.ui.preferences = { style: 'mobai', theme: 'system' };
  value.ui.selectedPageId = 'database-page';
  const owner = value.pages.find(page => page.id === 'database-page');
  owner.databaseViewId = 'view-gallery';
  owner.settings.locked = locked;
  const view = value.databaseViews.find(entry => entry.id === 'view-gallery');
  view.config = { gallery: { preview: { kind: 'page-cover', propertyId: null }, cardSize: 'medium', imageFit: 'cover', visiblePropertyIds: [] } };
  const alpha = value.pages.find(page => page.id === 'alpha-page');
  alpha.cover = { kind: 'gallery', value: 'hokusai-landscape', position: 0 };
  alpha.icon = 'icon:mood-cry';
  const beta = value.pages.find(page => page.id === 'beta-page');
  beta.cover = null; beta.icon = '📁';
  const gamma = value.pages.find(page => page.id === 'gamma-page');
  gamma.cover = null; gamma.icon = 'icon:mood-cry';
  return normalizeLoadedWorkspace(value, { idFactory: prefix => `${prefix}-gallery16-fixture` });
}
const domains = ['pages', 'databaseItems', 'dataSources', 'databaseViews'];
const allEqual = (assert, actual, expected) => { for (const key of domains) assert.deepEqual(actual[key], expected[key], key); };
const alphaCardSelector = 'section.database-view[data-source-id="projects"] .db-gallery-card[data-item-id="alpha"]';
async function galleryImageDecoded(page, assert, target) {
  await page.waitForFunction(selector => {
    const element = document.querySelector(selector);
    const image = element?.matches('img') ? element : element?.querySelector('img');
    return Boolean(image?.complete && image.naturalWidth > 0);
  }, target);
  const decoded = await page.locator(target).evaluate(async element => {
    const image = element.matches('img') ? element : element.querySelector('img');
    await image.decode();
    return { complete: image.complete, width: image.naturalWidth, height: image.naturalHeight };
  });
  assert.equal(decoded.complete, true, target);
  assert.ok(decoded.width > 0 && decoded.height > 0, JSON.stringify({ target, ...decoded }));
}
async function openGallery(page) {
  await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="database-page"]').click();
  const db = page.locator('section.database-view[data-source-id="projects"]');
  await db.waitFor();
  await page.waitForFunction(() => document.querySelector('section.database-view[data-source-id="projects"]')?.dataset.viewType === 'gallery');
  return db;
}
async function gallerySettings(page, db) {
  await db.getByRole('button', { name: '视图设置', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '视图设置', exact: true });
  await panel.locator('.db-v9-menu-list').getByRole('button', { name: /^布局/ }).click();
  await panel.getByLabel('画廊预览', { exact: true }).waitFor();
  return panel;
}

await browserScenario(name('-covers'), async ({ page, check, assert, saved, screenshot }) => {
  const db = await openGallery(page);
  await check('cover and blank previews keep real title icons without leaking internal IDs or empty attributes', async () => {
    const before = await saved();
    await screenshot('before-cover-and-empty-preview');
    const cards = db.locator('.db-gallery-card');
    assert.equal(await cards.count(), 3);
    const first = db.locator('.db-gallery-card[data-item-id="alpha"]');
    const blank = db.locator('.db-gallery-card[data-item-id="beta"]'), rawIcon = db.locator('.db-gallery-card[data-item-id="gamma"]');
    await galleryImageDecoded(page, assert, `${alphaCardSelector} .db-gallery-cover`);
    const coverStyle = await first.locator('.db-gallery-cover').evaluate(el => ({ image: getComputedStyle(el).backgroundImage, position: getComputedStyle(el).backgroundPosition, positionY: getComputedStyle(el).backgroundPositionY }));
    assert.match(coverStyle.image, /\/covers\//);
    assert.match(coverStyle.position, /0%/);
    assert.equal(coverStyle.positionY, '0%');
    assert.equal((await blank.locator('.db-gallery-preview').innerText()).trim(), '');
    assert.equal((await rawIcon.locator('.db-gallery-preview').innerText()).trim(), '');
    assert.doesNotMatch(await db.locator('.db-gallery-view').innerText(), /icon:mood-cry|暂无页面正文|暂无附件/);
    assert.equal(await first.locator('.db-gallery-open svg use[href$="#ti-mood-cry"]').count(), 1);
    assert.equal(await db.locator('.db-gallery-properties').count(), 0, 'An empty property selection must show no fallback properties');
    const blankBackground = await blank.locator('.db-gallery-preview').evaluate(el => getComputedStyle(el).backgroundImage);
    assert.equal(blankBackground, 'none', 'No-cover preview must not inherit the old gradient');
    allEqual(assert, await saved(), before);
  });
  await check('medium gallery remains compact in both modes and narrow containers without horizontal overflow', async () => {
    for (const mode of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, mode);
      for (const width of [1000, 700]) {
        await page.setViewportSize({ width, height: 900 });
        const bounds = await db.locator('.db-gallery-view').evaluate(el => {
          const rect = el.getBoundingClientRect();
          return { left: rect.left, right: rect.right, width: document.documentElement.clientWidth, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
        });
        assert.ok(bounds.left >= 0 && bounds.right <= bounds.width + 1 && bounds.scrollWidth <= bounds.clientWidth + 1, JSON.stringify(bounds));
        const title = await db.locator('.db-gallery-card[data-item-id="alpha"]').locator('.db-gallery-open strong').boundingBox();
        const preview = await db.locator('.db-gallery-card[data-item-id="alpha"]').locator('.db-gallery-preview').boundingBox();
        assert.ok(title && title.height <= 40, JSON.stringify(title));
        assert.ok(preview && preview.height <= 150, JSON.stringify(preview));
        if (width === 1000) {
          const lastCard = await db.locator('.db-gallery-card').last().boundingBox();
          const createTile = await db.locator('.db-gallery-create').boundingBox();
          assert.ok(lastCard && createTile);
          assert.ok(Math.abs(lastCard.y - createTile.y) < 1, 'The medium gallery fixture must put the last card and create tile in the same row');
          assert.ok(Math.abs(lastCard.height - createTile.height) < 1, 'A create tile sharing a card row must stretch to the same height, as observed in Notion');
        }

        await screenshot('compact-' + mode + '-' + width);
      }
    }
  });
}, { workspace: fixture() });

const propertiesFixture = fixture();
propertiesFixture.databaseViews.find(view => view.id === 'view-gallery').config.gallery.visiblePropertyIds = ['amount', 'checked', 'notes'];
propertiesFixture.databaseItems.find(item => item.id === 'alpha').values.amount = 0;
propertiesFixture.databaseItems.find(item => item.id === 'alpha').values.checked = false;
propertiesFixture.databaseItems.forEach(item => { item.values.notes = ''; });
await browserScenario(name('-properties'), async ({ page, check, assert, saved, persisted, screenshot }) => {
  const db = await openGallery(page);
  await check('selected zero and unchecked values remain while empty text rows disappear', async () => {
    await screenshot('before-selected-zero-false');
    const first = db.locator('.db-gallery-card[data-item-id="alpha"]');
    assert.equal(await first.locator('[data-property-id="notes"]').count(), 0);
    assert.equal((await first.locator('[data-property-id="amount"]').innerText()).trim(), '0');
    const checkbox = first.locator('[data-property-id="checked"]');
    assert.equal(await checkbox.count(), 1);
    assert.doesNotMatch(await checkbox.innerText(), /—/);
    const unchecked = checkbox.getByRole('img', { name: '未勾选', exact: true });
    assert.equal(await unchecked.count(), 1);
    assert.equal(await unchecked.getAttribute('data-checked'), 'false');
    assert.equal(await checkbox.getByRole('img', { name: '已勾选', exact: true }).count(), 0);
    assert.equal((await saved()).databaseItems.find(item => item.id === 'alpha').values.checked, false);
    assert.equal(await db.locator('.db-gallery-properties [data-property-id="notes"]').count(), 0);
  });
  await check('turning off all card properties persists an empty selection and never restores default rows', async () => {
    const before = await saved();
    const panel = await gallerySettings(page, db);
    await panel.getByRole('button', { name: /^卡片属性/ }).click();
    for (const prop of ['金额', '确认', '说明']) await panel.getByRole('checkbox', { name: `显示 ${prop}`, exact: true }).uncheck();
    await persisted(value => value.databaseViews.find(view => view.id === 'view-gallery').config.gallery.visiblePropertyIds.length === 0);
    await page.keyboard.press('Escape');
    assert.equal(await db.locator('.db-gallery-properties').count(), 0);
    await page.reload(); await db.waitFor();
    assert.equal(await db.locator('.db-gallery-properties').count(), 0);
    const after = await saved();
    assert.deepEqual(after.databaseItems, before.databaseItems);
    assert.deepEqual(after.dataSources, before.dataSources);
    assert.deepEqual(after.pages, before.pages);
    for (const old of before.databaseViews.filter(view => view.id !== 'view-gallery')) assert.deepEqual(after.databaseViews.find(view => view.id === old.id), old);
    assert.deepEqual(after.databaseViews.find(view => view.id === 'view-gallery').config.gallery.visiblePropertyIds, []);
    await screenshot('zero-visible-properties-after-reload');
  });
}, { workspace: propertiesFixture });

await browserScenario(name('-content'), async ({ page, check, assert, saved, persisted, screenshot }) => {
  const appUrl = page.url();
  const seedUrl = new URL('/src/domain/attachments.js', appUrl).href;
  let seedDocumentServed = false;
  const seedDocumentRoute = async route => {
    if (!seedDocumentServed && route.request().isNavigationRequest()) {
      seedDocumentServed = true;
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body></body></html>',
      });
    } else {
      await route.continue();
    }
  };
  await page.route(seedUrl, seedDocumentRoute);
  let moduleResponse;
  try {
    moduleResponse = await page.goto(seedUrl, { waitUntil: 'domcontentloaded' });
  } finally {
    await page.unroute(seedUrl, seedDocumentRoute);
  }
  assert.equal(moduleResponse?.status(), 200, 'Attachment seed document must be served without loading App');
  assert.equal(new URL(page.url()).pathname, '/src/domain/attachments.js');
  assert.equal(await page.locator('section.database-view, .life-editor').count(), 0, 'App must be unloaded before writing the attachment seed');
  const local = await page.evaluate(async () => {
    const { persistBrowserAttachment } = await import('/src/domain/attachments.js');
    const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNYsGDBfwAGpALg68ByCAAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(pixel), c => c.charCodeAt(0));
    const answer = await persistBrowserAttachment(new File([bytes], 'gallery-test.png', { type: 'image/png' }), { id: 'gallery-local-image' });
    const repository = await import('/src/persistence/workspaceRepository.js');
    const { normalizeLoadedWorkspace } = await import('/src/persistence/normalize.js');
    const value = JSON.parse(localStorage.getItem(repository.workspaceStorageKey));
    value.attachments.push(answer.metadata);
    const expired = answer.url.replace(/^blob:[^#]+/, 'blob:http://127.0.0.1:5178/expired-gallery');
    const alpha = value.pages.find(page => page.id === 'alpha-page');
    alpha.cover = { kind: 'upload', value: expired, position: 0 };
    alpha.content = [{ id: 'gallery-nested', type: 'toggleListItem', content: 'nested preview', children: [{ id: 'gallery-image', type: 'image', props: { url: expired, name: 'gallery-test.png' } }] }];
    value.databaseItems.find(item => item.id === 'alpha').values.files = [answer.metadata.id];
    localStorage.setItem(repository.workspaceStorageKey, JSON.stringify(normalizeLoadedWorkspace(value)));
    return { id: answer.metadata.id, expired };
  });
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  const db = await openGallery(page);
  await check('expired local cover references resolve after reload and preserve the saved cover position', async () => {
    const first = db.locator('.db-gallery-card[data-item-id="alpha"]');
    await page.waitForFunction(() => {
      const el = document.querySelector('section.database-view[data-source-id="projects"] .db-gallery-card[data-item-id="alpha"] .db-gallery-cover');
      return el && getComputedStyle(el).backgroundImage.includes('blob:') && !getComputedStyle(el).backgroundImage.includes('expired-gallery');
    });
    await galleryImageDecoded(page, assert, `${alphaCardSelector} .db-gallery-cover`);
    const css = await first.locator('.db-gallery-cover').evaluate(el => ({ image: getComputedStyle(el).backgroundImage, position: getComputedStyle(el).backgroundPosition, positionY: getComputedStyle(el).backgroundPositionY }));
    assert.doesNotMatch(css.image, /expired-gallery/);
    assert.match(css.position, /0%/);
    assert.equal(css.positionY, '0%');
    assert.equal((await saved()).pages.find(page => page.id === 'alpha-page').cover.value, local.expired, 'Preview must resolve locally without mutating saved references');
  });
  await check('nested page content and selected image attachments use local previews while non-image files retain their names', async () => {
    let panel = await gallerySettings(page, db);
    await panel.getByLabel('画廊预览', { exact: true }).click(); await panel.getByRole('menuitemradio', { name: '页面内容', exact: true }).click();
    await persisted(value => value.databaseViews.find(view => view.id === 'view-gallery').config.gallery.preview.kind === 'page-content');
    await page.keyboard.press('Escape');
    const imageVisible = target => galleryImageDecoded(page, assert, `${alphaCardSelector} ${target}`);
    await imageVisible('.db-gallery-content');
    await screenshot('nested-content-image');
    panel = await gallerySettings(page, db);
    await panel.getByLabel('画廊预览', { exact: true }).click(); await panel.getByRole('menuitemradio', { name: '附件属性', exact: true }).click();
    await panel.getByLabel('画廊附件属性', { exact: true }).click(); await panel.getByRole('menuitemradio', { name: '附件', exact: true }).click();
    await persisted(value => value.databaseViews.find(view => view.id === 'view-gallery').config.gallery.preview.propertyId === 'files');
    await page.keyboard.press('Escape');
    await imageVisible('.db-gallery-file');
    assert.match(await db.locator('.db-gallery-card[data-item-id="beta"]').locator('.db-gallery-file').innerText(), /设计说明\.pdf/);
    assert.doesNotMatch(await db.locator('.db-gallery-card[data-item-id="gamma"]').locator('.db-gallery-file').innerText(), /暂无附件/);
    await screenshot('file-image-and-pdf-preview');
    const after = await saved();
    assert.equal(after.databaseItems.find(item => item.id === 'alpha').values.files[0], local.id);
  });
  await check('none preview collapses and card size plus image fit remain view-local after reload', async () => {
    const before = await saved();
    const panel = await gallerySettings(page, db);
    await panel.getByRole('switch', { name: '适应媒体', exact: true }).click();
    await panel.getByLabel('画廊预览', { exact: true }).click(); await panel.getByRole('menuitemradio', { name: '无', exact: true }).click();
    await panel.getByLabel('画廊卡片大小', { exact: true }).click(); await panel.getByRole('menuitemradio', { name: '大', exact: true }).click();
    await persisted(value => value.databaseViews.find(view => view.id === 'view-gallery').config.gallery.preview.kind === 'none');
    await page.keyboard.press('Escape'); await page.reload(); await db.waitFor();
    assert.equal(await db.locator('.db-gallery-preview').count(), 0);
    assert.equal(await db.locator('.db-gallery-view').getAttribute('data-card-size'), 'large');
    const after = await saved();
    assert.equal(after.databaseViews.find(view => view.id === 'view-gallery').config.gallery.imageFit, 'contain');
    assert.deepEqual(after.databaseItems, before.databaseItems);
    assert.deepEqual(after.pages, before.pages);
    assert.deepEqual(after.dataSources, before.dataSources);
    for (const view of before.databaseViews.filter(view => view.id !== 'view-gallery')) assert.deepEqual(after.databaseViews.find(entry => entry.id === view.id), view);
    await screenshot('none-preview-after-reload');
  });
}, { workspace: fixture() });

await browserScenario(name('-create'), async ({ page, check, assert, saved, persisted, screenshot }) => {
  const db = await openGallery(page);
  await check('gallery New page tile creates one blank record in its own source and opens that exact page', async () => {
    const before = await saved();
    const tile = db.getByRole('button', { name: '新建页面', exact: true });
    assert.equal(await tile.count(), 1);
    await tile.click();
    const after = await persisted(value => value.databaseItems.length === before.databaseItems.length + 1 && value.pages.length === before.pages.length + 1);
    const records = after.databaseItems.filter(item => !before.databaseItems.some(old => old.id === item.id));
    const pages = after.pages.filter(page => !before.pages.some(old => old.id === page.id));
    assert.equal(records.length, 1); assert.equal(pages.length, 1);
    assert.equal(records[0].sourceId, 'projects'); assert.equal(records[0].pageId, pages[0].id);
    assert.equal(pages[0].databaseSourceId, records[0].sourceId);
    assert.equal(pages[0].title, ''); assert.equal(records[0].values.title, '');
    assert.deepEqual(after.dataSources, before.dataSources); assert.deepEqual(after.databaseViews, before.databaseViews);
    for (const old of before.databaseItems) assert.deepEqual(after.databaseItems.find(item => item.id === old.id), old);
    for (const old of before.pages) assert.deepEqual(after.pages.find(page => page.id === old.id), old);
    const peek = page.getByRole('dialog', { name: '记录预览', exact: true });
    await peek.waitFor({ state: 'visible' });
    assert.equal(await peek.locator('.life-editor').getAttribute('data-page-id'), pages[0].id);
    await screenshot('blank-record-created-from-tile');
    await page.keyboard.press('Escape'); await page.reload(); await db.waitFor();
    const reloaded = await saved();
    assert.equal(reloaded.databaseItems.find(item => item.id === records[0].id).pageId, pages[0].id);
    assert.equal(reloaded.pages.find(page => page.id === pages[0].id).title, '');
    const standaloneTile = await db.locator('.db-gallery-create').boundingBox();
    assert.ok(standaloneTile && standaloneTile.height >= 30 && standaloneTile.height <= 36, 'A create tile on its own final row remains compact');

    assert.equal(reloaded.pages.find(page => page.id === pages[0].id).databaseSourceId, reloaded.databaseItems.find(item => item.id === records[0].id).sourceId);
    for (const old of before.pages) assert.deepEqual(reloaded.pages.find(page => page.id === old.id), old);
  });

  await check('a fresh unnamed gallery defaults to page content and keeps its view identity after exit and reload', async () => {
    const before = await saved();
    await db.getByRole('button', { name: '添加视图', exact: true }).click();
    await page.getByRole('dialog', { name: '添加视图', exact: true }).getByRole('button', { name: '画廊', exact: true }).click();
    const after = await persisted(value => value.databaseViews.length === before.databaseViews.length + 1);
    const added = after.databaseViews.filter(view => !before.databaseViews.some(old => old.id === view.id));
    assert.equal(added.length, 1);
    const view = added[0];
    assert.equal(view.sourceId, 'projects'); assert.equal(view.type, 'gallery'); assert.equal(view.name, '');
    assert.equal(view.config.gallery.preview.kind, 'page-content');
    assert.equal(view.config.gallery.cardSize, 'medium');
    assert.deepEqual(view.config.gallery.visiblePropertyIds, []);
    assert.equal(await db.getAttribute('data-view-id'), view.id);
    assert.equal(await db.locator('.db-gallery-content').count(), after.databaseItems.filter(item => item.sourceId === 'projects').length);
    assert.equal(await db.locator('.db-gallery-properties').count(), 0);
    assert.deepEqual(after.dataSources, before.dataSources); assert.deepEqual(after.databaseItems, before.databaseItems);
    for (const old of before.databaseViews) assert.deepEqual(after.databaseViews.find(entry => entry.id === old.id), old);
    for (const old of before.pages.filter(entry => entry.id !== 'database-page')) assert.deepEqual(after.pages.find(entry => entry.id === old.id), old);
    await screenshot('new-unnamed-gallery-page-content-default');
    await page.keyboard.press('Escape'); await page.reload(); await db.waitFor();
    const reloaded = await saved();
    assert.equal(await db.getAttribute('data-view-id'), view.id);
    assert.equal(reloaded.databaseViews.length, after.databaseViews.length);
    assert.deepEqual(reloaded.databaseViews.find(entry => entry.id === view.id), view);
    assert.deepEqual(reloaded.dataSources, before.dataSources); assert.deepEqual(reloaded.databaseItems, before.databaseItems);
    for (const old of before.pages.filter(entry => entry.id !== 'database-page')) assert.deepEqual(reloaded.pages.find(entry => entry.id === old.id), old);
    await screenshot('new-unnamed-gallery-after-reload');
  });

}, { workspace: fixture() });

await browserScenario(name('-locked'), async ({ page, check, assert, saved }) => {
  const db = await openGallery(page);
  await check('locked gallery has no create tile and ordinary opening preserves source ownership and data', async () => {
    const before = await saved();
    assert.equal(await db.getByRole('button', { name: '新建页面', exact: true }).count(), 0);
    await db.locator('.db-gallery-card[data-item-id="alpha"]').locator('.db-gallery-open').click();
    await page.getByRole('dialog', { name: '记录预览', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    allEqual(assert, await saved(), before);
  });
}, { workspace: fixture({ locked: true }) });
