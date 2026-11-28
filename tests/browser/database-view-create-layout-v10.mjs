import { existsSync } from 'node:fs';
import { browserScenario } from './harness.mjs';
import { coreParityWorkspace } from '../fixtures/core-parity-workspace.mjs';
import { walkBlocks } from '../../src/domain/blockDocument.js';
import { normalizeLoadedWorkspace } from '../../src/persistence/normalize.js';

const run = process.env.V10_VIEW_CREATE_RUN || 'prepared01';
if (!/^[a-z0-9-]+$/.test(run)) throw new Error('invalid run label');
const scenarioName = suffix => `LOCAL-NOTION-001/v10-view-create15/layout-${run}${suffix}`;
for (const suffix of ['', '-dismiss', '-locked', '-inline', '-linked']) {
  if (existsSync(`.qa/${scenarioName(suffix)}.json`)) throw new Error(`Report already exists: ${scenarioName(suffix)}; choose a new V10_VIEW_CREATE_RUN`);
}
const workspace = coreParityWorkspace();
workspace.ui.preferences = { style: 'mobai', theme: 'system' };
workspace.pages.find(page => page.id === 'database-page').databaseViewId = 'view-table';
const pageContent = value => value.pages.map(entry => {
  if (entry.id !== 'database-page') return entry;
  const { databaseViewId, ...pageWithoutView } = entry;
  return pageWithoutView;
});

await browserScenario(scenarioName(''), async ({ page, check, assert, saved, persisted, screenshot }) => {
  await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="database-page"]').click();
  const db = page.locator('section.database-view[data-source-id="projects"]');
  await db.waitFor();
  await persisted(value => value.pages.every(entry => Object.hasOwn(entry, 'contentRevision')));

  await check('choosing List immediately creates and selects one view before naming or Done', async () => {
    const before = await saved();
    await db.getByRole('button', { name: '添加视图', exact: true }).click();
    const chooser = page.getByRole('dialog', { name: '添加视图', exact: true });
    const list = chooser.getByRole('button', { name: '列表', exact: true });
    await list.waitFor({ state: 'visible' });
    await list.click();

    const after = await persisted(value => value.databaseViews.length === before.databaseViews.length + 1);
    const added = after.databaseViews.filter(view => !before.databaseViews.some(old => old.id === view.id));
    assert.equal(added.length, 1);
    const view = added[0];
    assert.ok(view.id);
    assert.equal(view.sourceId, 'projects');
    assert.equal(view.type, 'list');
    assert.equal(view.name, '');
    assert.equal(new Set(after.databaseViews.map(entry => entry.id)).size, after.databaseViews.length);
    for (const old of before.databaseViews) assert.deepEqual(after.databaseViews.find(entry => entry.id === old.id), old);
    assert.deepEqual(after.dataSources, before.dataSources);
    assert.deepEqual(after.databaseItems, before.databaseItems);
    assert.deepEqual(pageContent(after), pageContent(before));
    assert.equal(after.pages.find(entry => entry.id === 'database-page').databaseViewId, view.id);
    assert.equal(await db.getAttribute('data-view-id'), view.id);
    assert.equal(await db.getAttribute('data-view-type'), 'list');
    assert.equal(await db.locator(`[role="tab"][data-view-id="${view.id}"]`).getAttribute('aria-selected'), 'true');
    assert.equal(await db.locator('[role="tab"][aria-selected="true"]').count(), 1);
    await db.locator('.db-list-view .db-list-row').first().waitFor({ state: 'visible' });
    const settings = page.getByRole('dialog', { name: '新建视图', exact: true });
    await settings.waitFor({ state: 'visible' });
    assert.equal(await settings.getByLabel('视图名称', { exact: true }).inputValue(), '');
  });

  await check('Done keeps the empty name and ID with a layout fallback after reload and later rename', async () => {
    const before = await saved();
    const id = await db.getAttribute('data-view-id');
    const settings = page.getByRole('dialog', { name: '新建视图', exact: true });
    await settings.getByRole('button', { name: '完成', exact: true }).click();
    await settings.waitFor({ state: 'detached' });
    let after = await persisted(value => value.databaseViews.some(view => view.id === id && view.name === ''));
    assert.deepEqual(after.databaseViews.map(view => view.id), before.databaseViews.map(view => view.id));
    assert.deepEqual(after.pages, before.pages);
    assert.equal((await db.locator(`[role="tab"][data-view-id="${id}"]`).innerText()).trim(), '列表');
    await page.reload();
    await db.waitFor();
    await page.waitForFunction(expected => document.querySelector('section.database-view[data-source-id="projects"]')?.dataset.viewId === expected, id);
    after = await saved();
    assert.equal(after.databaseViews.find(view => view.id === id).name, '');
    assert.deepEqual(after.pages, before.pages);
    assert.equal(after.pages.find(entry => entry.id === 'database-page').databaseViewId, id);
    assert.equal((await db.locator(`[role="tab"][data-view-id="${id}"]`).innerText()).trim(), '列表');
    await db.getByRole('button', { name: '视图设置', exact: true }).click();
    await page.getByRole('dialog', { name: '视图设置', exact: true }).getByLabel('视图名称', { exact: true }).fill('后来命名');
    after = await persisted(value => value.databaseViews.find(view => view.id === id)?.name === '后来命名');
    assert.deepEqual(after.databaseViews.map(view => view.id), before.databaseViews.map(view => view.id));
    assert.equal(after.databaseViews.find(view => view.id === id).sourceId, 'projects');
    assert.deepEqual(after.databaseItems, before.databaseItems);
    assert.deepEqual(after.dataSources, before.dataSources);
    assert.deepEqual(after.pages, before.pages);
    await page.keyboard.press('Escape');
  });

  await check('configuration changes the same ID and Done trims its name without creating a second view', async () => {
    const before = await saved();
    await db.getByRole('button', { name: '添加视图', exact: true }).click();
    await page.getByRole('dialog', { name: '添加视图', exact: true }).getByRole('button', { name: '列表', exact: true }).click();
    const created = await persisted(value => value.databaseViews.length === before.databaseViews.length + 1);
    const view = created.databaseViews.find(entry => !before.databaseViews.some(old => old.id === entry.id));
    assert.ok(view?.id);
    const settings = page.getByRole('dialog', { name: '新建视图', exact: true });
    const name = settings.getByLabel('视图名称', { exact: true });
    await name.fill('  自定义视图  ');
    assert.equal(await name.inputValue(), '  自定义视图  ');
    await settings.locator('.db-v9-menu-list').getByRole('button', { name: /^布局/ }).click();
    await settings.getByRole('button', { name: '布局 看板', exact: true }).click();
    await persisted(value => value.databaseViews.find(entry => entry.id === view.id)?.type === 'board');
    await settings.getByRole('button', { name: '返回上一级', exact: true }).click();
    await settings.getByRole('button', { name: '完成', exact: true }).click();
    const after = await persisted(value => value.databaseViews.find(entry => entry.id === view.id)?.name === '自定义视图');
    assert.equal(after.databaseViews.length, before.databaseViews.length + 1);
    assert.equal(after.databaseViews.find(entry => entry.id === view.id).type, 'board');
    assert.equal(after.databaseViews.find(entry => entry.id === view.id).sourceId, 'projects');
    assert.equal(await db.getAttribute('data-view-id'), view.id);
    assert.equal(await db.getAttribute('data-view-type'), 'board');
    for (const old of before.databaseViews) assert.deepEqual(after.databaseViews.find(entry => entry.id === old.id), old);
    assert.deepEqual(after.databaseItems, before.databaseItems);
    assert.deepEqual(after.dataSources, before.dataSources);
    assert.deepEqual(pageContent(after), pageContent(before));
    assert.equal(after.pages.find(entry => entry.id === 'database-page').databaseViewId, view.id);
  });

  await check('chooser remains usable and visible in narrow light and dark windows', async () => {
    await page.setViewportSize({ width: 700, height: 800 });
    for (const mode of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForFunction(value => document.documentElement.dataset.theme === value, mode);
      await db.getByRole('button', { name: '添加视图', exact: true }).click();
      const chooser = page.getByRole('dialog', { name: '添加视图', exact: true });
      await chooser.getByRole('button', { name: '列表', exact: true }).waitFor();
      const bounds = await chooser.evaluate(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, width: document.documentElement.clientWidth }));
      assert.ok(bounds.left >= 0 && bounds.right <= bounds.width + 1, JSON.stringify(bounds));
      await screenshot(`narrow-${mode}`);
      await page.keyboard.press('Escape');
      await chooser.waitFor({ state: 'detached' });

      const before = await saved();
      await db.getByRole('button', { name: '添加视图', exact: true }).click();
      await chooser.getByRole('button', { name: '列表', exact: true }).click();
      const created = await persisted(value => value.databaseViews.length === before.databaseViews.length + 1);
      const view = created.databaseViews.find(entry => !before.databaseViews.some(old => old.id === entry.id));
      assert.ok(view?.id);
      assert.equal(view.sourceId, 'projects');
      const settings = page.getByRole('dialog', { name: '新建视图', exact: true });
      await settings.waitFor({ state: 'visible' });
      const name = settings.getByLabel('视图名称', { exact: true });
      const done = settings.getByRole('button', { name: '完成', exact: true });
      const renamed = `窄窗 ${mode} 视图`;
      await name.fill(renamed);
      assert.equal(await name.inputValue(), renamed);
      const viewport = page.viewportSize();
      for (const control of [name, done]) {
        assert.equal(await control.isVisible(), true);
        assert.equal(await control.isEnabled(), true);
        const controlBounds = await control.boundingBox();
        assert.ok(controlBounds && controlBounds.x >= 0 && controlBounds.y >= 0 && controlBounds.x + controlBounds.width <= viewport.width + 1 && controlBounds.y + controlBounds.height <= viewport.height + 1, JSON.stringify(controlBounds));
      }
      await screenshot(`configuration-narrow-${mode}`);
      await done.click();
      await settings.waitFor({ state: 'detached' });
      const after = await persisted(value => value.databaseViews.find(entry => entry.id === view.id)?.name === renamed);
      assert.deepEqual(after.databaseViews.map(entry => entry.id), created.databaseViews.map(entry => entry.id));
      assert.equal(after.databaseViews.find(entry => entry.id === view.id).sourceId, 'projects');
      assert.equal(await db.getAttribute('data-view-id'), view.id);
      for (const old of before.databaseViews) assert.deepEqual(after.databaseViews.find(entry => entry.id === old.id), old);
      assert.deepEqual(after.databaseItems, before.databaseItems);
      assert.deepEqual(after.dataSources, before.dataSources);
      assert.deepEqual(pageContent(after), pageContent(before));
      assert.equal(after.pages.find(entry => entry.id === 'database-page').databaseViewId, view.id);
    }
  });
}, { workspace });

await browserScenario(scenarioName('-dismiss'), async ({ page, check, assert, saved, persisted }) => {
  await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="database-page"]').click();
  const db = page.locator('section.database-view[data-source-id="projects"]');
  await db.waitFor();
  const add = db.getByRole('button', { name: '添加视图', exact: true });
  const chooser = page.getByRole('dialog', { name: '添加视图', exact: true });
  const creation = page.getByRole('dialog', { name: '新建视图', exact: true });

  await check('Close Escape and outside before choosing preserve state and respect focus', async () => {
    const before = await saved();
    for (const method of ['close', 'escape', 'outside']) {
      await add.click();
      await chooser.waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.querySelector('[role="dialog"][aria-label="添加视图"]')?.contains(document.activeElement));
      if (method === 'close') await chooser.getByRole('button', { name: '关闭添加视图', exact: true }).click();
      else if (method === 'escape') await page.keyboard.press('Escape');
      else await db.getByRole('button', { name: '搜索此视图', exact: true }).click();
      await chooser.waitFor({ state: 'detached' });
      if (method === 'outside') {
        await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '在此视图中搜索');
      } else {
        await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '添加视图');
      }
      const after = await saved();
      assert.deepEqual(after.databaseViews, before.databaseViews, method);
      assert.deepEqual(after.databaseItems, before.databaseItems, method);
      assert.deepEqual(after.dataSources, before.dataSources, method);
      assert.deepEqual(after.pages, before.pages, method);
      assert.equal(await db.getAttribute('data-view-id'), 'view-table');
      if (method === 'outside') await page.keyboard.press('Escape');
    }
  });

  await check('keyboard can navigate the chooser and Escape returns to its trigger', async () => {
    await add.click();
    await chooser.waitFor();
    await page.waitForFunction(() => document.querySelector('[role="dialog"][aria-label="添加视图"]')?.contains(document.activeElement));
    const firstFocus = await page.evaluate(() => document.activeElement?.outerHTML);
    await page.keyboard.press('Tab');
    assert.equal(await chooser.evaluate(el => el.contains(document.activeElement)), true);
    assert.notEqual(await page.evaluate(() => document.activeElement?.outerHTML), firstFocus);
    await page.keyboard.press('Escape');
    await chooser.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '添加视图');
  });

  await check('Close Escape and outside after choosing retain their created IDs without duplicates', async () => {
    for (const method of ['close', 'escape', 'outside']) {
      const before = await saved();
      await add.click();
      await chooser.getByRole('button', { name: '列表', exact: true }).click();
      const created = await persisted(value => value.databaseViews.length === before.databaseViews.length + 1);
      const view = created.databaseViews.find(entry => !before.databaseViews.some(old => old.id === entry.id));
      assert.ok(view?.id);
      await creation.waitFor();
      if (method === 'close') await creation.getByRole('button', { name: /^关闭/ }).click();
      else if (method === 'escape') await page.keyboard.press('Escape');
      else await page.mouse.click(2, 2);
      await creation.waitFor({ state: 'detached' });
      const after = await saved();
      assert.deepEqual(after.databaseViews, created.databaseViews, method);
      assert.equal(after.databaseViews.filter(entry => entry.id === view.id).length, 1);
      assert.equal(await db.getAttribute('data-view-id'), view.id);
      assert.deepEqual(after.databaseItems, before.databaseItems);
      assert.deepEqual(after.dataSources, before.dataSources);
      assert.deepEqual(pageContent(after), pageContent(before));
      assert.equal(after.pages.find(entry => entry.id === 'database-page').databaseViewId, view.id);

      await page.reload();
      await db.waitFor();
      await page.waitForFunction(expected => document.querySelector('section.database-view[data-source-id="projects"]')?.dataset.viewId === expected, view.id);
      const reloaded = await saved();
      assert.deepEqual(reloaded.databaseViews, after.databaseViews, method);
      assert.equal(reloaded.databaseViews.find(entry => entry.id === view.id)?.sourceId, 'projects');
      assert.equal(reloaded.databaseViews.find(entry => entry.id === view.id)?.name, '');
      assert.equal(await db.getAttribute('data-view-id'), view.id);
      assert.equal(await db.getAttribute('data-view-type'), 'list');
      assert.equal(await db.locator(`[role="tab"][data-view-id="${view.id}"]`).getAttribute('aria-selected'), 'true');
      assert.equal((await db.locator(`[role="tab"][data-view-id="${view.id}"]`).innerText()).trim(), '列表');
      assert.deepEqual(reloaded.databaseItems, after.databaseItems, method);
      assert.deepEqual(reloaded.dataSources, after.dataSources, method);
      assert.deepEqual(reloaded.pages, after.pages, method);
    }
  });
// Compare operations against the same loaded representation used by the repository.
// First-save normalization must not race the page-domain preservation baseline.
}, { workspace: normalizeLoadedWorkspace(coreParityWorkspace(), { idFactory: prefix => `${prefix}-view15-dismiss-fixture` }) });

const lockedWorkspace = coreParityWorkspace();
lockedWorkspace.pages.find(page => page.id === 'database-page').settings.locked = true;
await browserScenario(scenarioName('-locked'), async ({ page, check, assert, saved }) => {
  await page.getByRole('complementary', { name: '主导航' }).locator('[data-node-id="database-page"]').click();
  const db = page.locator('section.database-view[data-source-id="projects"]');
  await db.waitFor();
  await check('locked database cannot create a view', async () => {
    const before = await saved();
    assert.equal(await db.getByRole('button', { name: '添加视图', exact: true }).count(), 0);
    const after = await saved();
    assert.deepEqual(after.databaseViews, before.databaseViews);
    assert.deepEqual(after.databaseItems, before.databaseItems);
    assert.deepEqual(after.dataSources, before.dataSources);
    assert.deepEqual(after.pages, before.pages);
  });
}, { workspace: lockedWorkspace });

for (const entry of [
  { suffix: '-inline', slash: '数据库 - 行内', linked: false },
  { suffix: '-linked', slash: '数据源的链接视图', linked: true },
]) {
  const fixture = coreParityWorkspace();
  fixture.ui.selectedPageId = 'editor-page';
  fixture.ui.preferences = { theme: 'system', style: 'mobai' };
  fixture.pages.find(page => page.id === 'editor-page').content = [{ id: 'view15-insert', type: 'paragraph', content: '' }];
  await browserScenario(scenarioName(entry.suffix), async ({ page, check, assert, saved, persisted, screenshot }) => {
    const blocks = value => walkBlocks(value.pages.find(candidate => candidate.id === 'editor-page').content).filter(block => block.type === 'databaseView');
    await check('create a view in the actual database block and keep source and page binding', async () => {
      const editor = page.locator('.life-editor[data-page-id="editor-page"]');
      await editor.locator('[data-id="view15-insert"] .bn-block-content').first().fill('/');
      const options = page.locator('[role="option"]:visible');
      await options.first().waitFor();
      await options.filter({ hasText: entry.slash }).first().click();
      let inserted = await persisted(value => blocks(value).length === 1);
      if (entry.linked) {
        await editor.locator('.db-source-picker').getByRole('button', { name: '项目数据库', exact: true }).click();
        inserted = await persisted(value => blocks(value)[0]?.props?.sourceId === 'projects');
      }
      const block = blocks(inserted)[0];
      const sourceId = block.props.sourceId;
      assert.ok(sourceId && block.props.viewId);
      if (entry.linked) assert.equal(sourceId, 'projects');
      else {
        assert.notEqual(sourceId, 'projects');
        assert.equal(inserted.dataSources.find(source => source.id === sourceId)?.ownerPageId, 'editor-page');
      }
      const db = editor.locator(`section.database-view[data-source-id="${sourceId}"]`);
      await db.waitFor();
      const before = await saved();
      await db.getByRole('button', { name: '添加视图', exact: true }).click();
      await page.getByRole('dialog', { name: '添加视图', exact: true }).getByRole('button', { name: '列表', exact: true }).click();
      const after = await persisted(value => value.databaseViews.length === before.databaseViews.length + 1 && blocks(value)[0]?.props?.viewId !== block.props.viewId);
      const view = after.databaseViews.find(candidate => !before.databaseViews.some(old => old.id === candidate.id));
      assert.ok(view?.id);
      assert.equal(view.sourceId, sourceId);
      assert.equal(view.type, 'list');
      assert.equal(blocks(after)[0].id, block.id);
      assert.deepEqual(blocks(after)[0].props, { ...block.props, viewId: view.id });
      assert.equal(await db.getAttribute('data-view-id'), view.id);
      assert.equal(await db.getAttribute('data-view-type'), 'list');
      for (const old of before.databaseViews) assert.deepEqual(after.databaseViews.find(candidate => candidate.id === old.id), old);
      assert.deepEqual(after.dataSources, before.dataSources);
      assert.deepEqual(after.databaseItems, before.databaseItems);
      assert.deepEqual(after.pages.filter(candidate => candidate.id !== 'editor-page'), before.pages.filter(candidate => candidate.id !== 'editor-page'));
      await page.getByRole('dialog', { name: '新建视图', exact: true }).getByRole('button', { name: '完成', exact: true }).click();
      await page.reload();
      await editor.locator(`section.database-view[data-source-id="${sourceId}"][data-view-id="${view.id}"]`).waitFor();
      const reloaded = await saved();
      assert.equal(blocks(reloaded)[0].props.viewId, view.id);
      assert.equal(reloaded.databaseViews.find(candidate => candidate.id === view.id)?.sourceId, sourceId);
      assert.deepEqual(reloaded.dataSources, before.dataSources);
      assert.deepEqual(reloaded.databaseItems, before.databaseItems);
    });

    if (entry.linked) {
      await check('locked unbound Linked source picker cannot create a view or mutate four domains', async () => {
        const editor = page.locator('.life-editor[data-page-id="editor-page"]');
        const beforeInsert = await saved();
        const priorBlocks = blocks(beforeInsert);
        const trailingParagraph = editor.locator('.bn-block-content[data-content-type="paragraph"]').last();
        await trailingParagraph.waitFor({ state: 'visible' });
        await trailingParagraph.fill('/');
        const options = page.locator('[role="option"]:visible');
        await options.first().waitFor();
        await options.filter({ hasText: entry.slash }).first().click();
        const inserted = await persisted(value => blocks(value).length === priorBlocks.length + 1 && blocks(value).some(block => !priorBlocks.some(prior => prior.id === block.id) && block.props.sourceId === '' && block.props.viewId === ''));
        const unbound = blocks(inserted).find(block => !priorBlocks.some(prior => prior.id === block.id));
        assert.ok(unbound?.id, 'Linked slash must insert an actual unbound database block');
        assert.equal(unbound.props.sourceId, '');
        assert.equal(unbound.props.viewId, '');
        for (const prior of priorBlocks) assert.deepEqual(blocks(inserted).find(block => block.id === prior.id), prior);
        assert.deepEqual(inserted.dataSources, beforeInsert.dataSources);
        assert.deepEqual(inserted.databaseViews, beforeInsert.databaseViews);
        assert.deepEqual(inserted.databaseItems, beforeInsert.databaseItems);
        const picker = editor.locator(`[data-id="${unbound.id}"] .db-source-picker`);
        const sourceButton = picker.getByRole('button', { name: '项目数据库', exact: true });
        await sourceButton.waitFor({ state: 'visible' });
        assert.equal(await sourceButton.isEnabled(), true, 'Unlocked unbound Linked block must offer its real source picker');

        await page.getByRole('button', { name: '页面操作', exact: true }).click();
        await page.getByRole('menuitem', { name: '锁定页面', exact: true }).click();
        await page.keyboard.press('Escape');
        await page.getByRole('menu', { name: '页面操作', exact: true }).waitFor({ state: 'hidden' });
        await editor.locator('.bn-editor[contenteditable="false"]').waitFor({ state: 'visible' });
        await persisted(value => value.pages.find(candidate => candidate.id === 'editor-page').settings.locked === true && blocks(value).some(block => block.id === unbound.id && block.props.sourceId === '' && block.props.viewId === ''));
        await page.locator('.page-document-meta .save-state.is-saved').waitFor({ state: 'visible' });
        const before = await saved();
        const enabledSources = [];
        for (const control of await picker.getByRole('button', { includeHidden: true }).all()) {
          if (await control.isVisible() && await control.isEnabled()) enabledSources.push((await control.innerText()).trim());
        }
        await screenshot('locked-unbound-linked-before-source-attempt');
        if (await sourceButton.isVisible() && await sourceButton.isEnabled()) await sourceButton.click();
        // Autosave debounces for 450 ms; do not accept a pre-click saved snapshot as proof of no mutation.
        await page.waitForTimeout(600);
        await page.locator('.page-document-meta .save-state.is-saved').waitFor({ state: 'visible' });
        const after = await saved();
        for (const domain of ['dataSources', 'databaseViews', 'databaseItems', 'pages']) {
          assert.deepEqual(after[domain], before[domain], `Locked unbound Linked source selection must preserve ${domain}`);
        }
        assert.deepEqual(enabledSources, [], 'Locked unbound Linked source picker controls must be hidden or disabled');

        await page.reload();
        await editor.locator('.bn-editor[contenteditable="false"]').waitFor({ state: 'visible' });
        const reloaded = await saved();
        for (const domain of ['dataSources', 'databaseViews', 'databaseItems', 'pages']) {
          assert.deepEqual(reloaded[domain], before[domain], `Locked unbound Linked state must remain unchanged after reload: ${domain}`);
        }
        assert.deepEqual(blocks(reloaded).find(block => block.id === unbound.id), blocks(before).find(block => block.id === unbound.id));
      });
    }
  }, { workspace: fixture });
}
