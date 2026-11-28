import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

const workspace = coreParityWorkspace();
workspace.ui.preferences = { style: "mobai", theme: "system" };
const source = (state) => state.dataSources.find((entry) => entry.id === "projects");
const ids = (state) => source(state).properties.map((property) => property.id);

await browserScenario("database-property-default-create-v10", async ({ page, check, saved, persisted, assert, screenshot }) => {
  const db = page.locator('.database-view[data-source-id="projects"]');
  const settingsButton = db.getByRole("button", { name: "视图设置", exact: true });
  const panel = page.getByRole("dialog", { name: "视图设置", exact: true });
  const openTypes = async () => { await settingsButton.click(); await panel.getByRole("button", { name: "添加属性", exact: true }).click(); };
  const selectType = (name) => panel.getByLabel("属性类型", { exact: true }).getByRole("button", { name, exact: true }).click();
  const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await db.waitFor();
  const before = await saved();
  let firstId;
  await check("selecting Text creates its default property before any Save", async () => {
    await openTypes();
    assert.equal(await panel.getByLabel("新属性名称").inputValue(), "");
    await selectType("文本");
    const added = await persisted((state) => ids(state).length === ids(before).length + 1);
    const created = source(added).properties.filter((property) => !ids(before).includes(property.id));
    console.log("PROPERTY_IMMEDIATE_CREATION", JSON.stringify({ before: ids(before), added: created }));
    assert.equal(created.length, 1);
    assert.equal(created[0].name, "文本");
    assert.equal(created[0].type, "text");
    assert.deepEqual(created[0].options, []);
    firstId = created[0].id;
    const editor = page.getByRole("dialog", { name: "编辑文本属性", exact: true });
    assert.equal(await editor.getByLabel("属性名称").inputValue(), "文本");
    await page.keyboard.press("Escape"); await settle();
    assert.equal(await settingsButton.evaluate((node) => document.activeElement === node), true);
    await page.reload(); await db.waitFor();
    assert.equal(source(await saved()).properties.find((property) => property.id === firstId)?.name, "文本");
  });
  await check("optional name creates once and editing keeps the same property ID", async () => {
    const old = await saved(); await openTypes();
    await panel.getByLabel("新属性名称").fill("自定义名称");
    await selectType("URL");
    const state = await persisted((value) => ids(value).length === ids(old).length + 1);
    const property = source(state).properties.find((entry) => !ids(old).includes(entry.id));
    assert.equal(property.name, "自定义名称"); assert.equal(property.type, "url");
    const editor = page.getByRole("dialog", { name: "编辑URL属性", exact: true });
    await editor.getByLabel("属性名称").fill("稍后更名");
    await editor.getByLabel("属性名称").press("Enter");
    const changed = await persisted((value) => source(value).properties.find((entry) => entry.id === property.id)?.name === "稍后更名");
    assert.equal(ids(changed).length, ids(old).length + 1);
    assert.deepEqual(changed.databaseItems, old.databaseItems);
    await page.keyboard.press("Escape");
    await page.reload(); await db.waitFor();
    assert.equal(source(await saved()).properties.find((entry) => entry.id === property.id)?.name, "稍后更名");
  });
  await check("select default remains empty and closing outside preserves the new ID", async () => {
    const old = await saved(); await openTypes(); await selectType("单选");
    const state = await persisted((value) => ids(value).length === ids(old).length + 1);
    const property = source(state).properties.find((entry) => !ids(old).includes(entry.id));
    assert.deepEqual(property.options, []);
    await page.getByRole("complementary", { name: "主导航" }).locator('[data-node-id="database-page"]').click();
    await page.reload(); await db.waitFor();
    assert.equal(source(await saved()).properties.find((entry) => entry.id === property.id)?.name, "单选");
  });
  await check("dependent relation and rollup keep required targets before creation", async () => {
    const old = await saved(); await openTypes(); await selectType("关联");
    let dialog = page.getByRole("dialog", { name: "新建关联属性", exact: true });
    await dialog.getByRole("button", { name: "保存属性" }).click();
    assert.equal(await dialog.getByLabel("关联目标数据库").evaluate((node) => node.validity.valueMissing), true);
    assert.deepEqual(ids(await saved()), ids(old));
    await dialog.getByLabel("关联目标数据库").selectOption("partners");
    await dialog.getByRole("button", { name: "保存属性" }).click();
    const related = await persisted((value) => ids(value).length === ids(old).length + 1);
    const relation = source(related).properties.find((entry) => !ids(old).includes(entry.id));
    assert.equal(relation.config.targetSourceId, "partners");
    await openTypes(); await selectType("汇总");
    dialog = page.getByRole("dialog", { name: "新建汇总属性", exact: true });
    await dialog.getByRole("button", { name: "保存属性" }).click();
    assert.equal(await dialog.getByLabel("汇总关联属性").evaluate((node) => node.validity.valueMissing), true);
    await dialog.getByLabel("汇总关联属性").selectOption(relation.id);
    await dialog.getByRole("button", { name: "保存属性" }).click();
    assert.equal(await dialog.getByLabel("汇总目标属性").evaluate((node) => node.validity.valueMissing), true);
    assert.deepEqual(ids(await saved()), ids(related));
    await dialog.getByLabel("汇总目标属性").selectOption("title");
    await dialog.getByRole("button", { name: "保存属性" }).click();
    const rolled = await persisted((value) => ids(value).length === ids(related).length + 1);
    const rollup = source(rolled).properties.find((entry) => !ids(related).includes(entry.id));
    assert.equal(rollup.config.relationPropertyId, relation.id); assert.equal(rollup.config.targetPropertyId, "title");
  });
  await check("compact configuration stays on screen in day and night at narrow width", async () => {
    await page.setViewportSize({ width: 760, height: 700 });
    for (const mode of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, mode);
      await openTypes(); await selectType("数字");
      const editor = page.getByRole("dialog", { name: "编辑数字属性", exact: true });
      await editor.waitFor(); await screenshot(`compact-${mode}`);
      const rect = await editor.evaluate((node) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight }; });
      assert.ok(rect.left >= 0 && rect.top >= 0 && rect.right <= rect.width && rect.bottom <= rect.height, JSON.stringify(rect));
      await page.keyboard.press("Escape"); await settle();
    }
  });
}, { workspace });

await browserScenario("database-property-default-create-v10-clear", async ({ page, check, saved, persisted, assert }) => {
  await check("clearing a created name persists the empty string on the same ID", async () => {
    const db = page.locator('.database-view[data-source-id="projects"]');
    const old = await saved();
    await db.getByRole("button", { name: "视图设置", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "视图设置", exact: true });
    await settings.getByRole("button", { name: "添加属性", exact: true }).click();
    await settings.getByLabel("属性类型", { exact: true }).getByRole("button", { name: "文本", exact: true }).click();
    const added = await persisted((value) => ids(value).length === ids(old).length + 1);
    const property = source(added).properties.find((entry) => !ids(old).includes(entry.id));
    const editor = page.getByRole("dialog", { name: "编辑文本属性", exact: true });
    const input = editor.getByLabel("属性名称");
    await input.fill(""); await input.press("Enter");
    const observation = { id: property.id, input: await input.inputValue(), valueMissing: await input.evaluate((node) => node.validity.valueMissing), afterEnter: source(await saved()).properties.find((entry) => entry.id === property.id) };
    console.log("PROPERTY_CLEAR_AFTER_ENTER", JSON.stringify(observation));
    assert.equal(await editor.isVisible(), true);
    await db.getByRole("button", { name: "搜索此视图", exact: true }).click();
    const cleared = await persisted((value) => source(value).properties.find((entry) => entry.id === property.id)?.name === "");
    assert.equal(source(cleared).properties.find((entry) => entry.id === property.id).name, "");
    await page.reload(); await db.waitFor();
    assert.equal(source(await saved()).properties.find((entry) => entry.id === property.id)?.name, "");
    await db.getByRole("button", { name: "编辑  属性", exact: true }).click();
    await page.getByRole("menu", { name: " 属性菜单", exact: true }).getByRole("menuitem", { name: "编辑属性…" }).click();
    const reopened = page.getByRole("dialog", { name: "编辑文本属性", exact: true });
    assert.equal(await reopened.getByLabel("属性名称").inputValue(), "");
    assert.equal(await reopened.getByRole("button", { name: "保存属性", exact: true }).count(), 0);
    await reopened.getByLabel("属性名称").press("Enter");
    await reopened.getByRole("button", { name: "关闭属性设置", exact: true }).click();
    await page.reload(); await db.waitFor();
    assert.equal(source(await saved()).properties.find((entry) => entry.id === property.id)?.name, "");
  });
}, { workspace: coreParityWorkspace() });

const statusWorkspace = coreParityWorkspace();
source(statusWorkspace).properties.find(property => property.id === "status").config = { defaultOptionId: "todo" };

await browserScenario("database-property-default-create-v10-status", async ({ page, check, saved, persisted, assert }) => {
  await check("new status has three grouped defaults and existing rows start at todo", async () => {
    const db = page.locator('.database-view[data-source-id="projects"]');
    await db.getByRole("button", { name: "视图设置", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "视图设置", exact: true });
    await settings.getByRole("button", { name: "添加属性", exact: true }).click();
    const before = await persisted((value) => Object.hasOwn(value.pages[0], "contentRevision"));
    await settings.getByLabel("属性类型", { exact: true }).getByRole("button", { name: "状态", exact: true }).click();
    const after = await persisted((value) => ids(value).length === ids(before).length + 1);
    const property = source(after).properties.find((entry) => !ids(before).includes(entry.id));
    const rows = after.databaseItems.filter((item) => item.sourceId === "projects").map((item) => ({ id: item.id, value: item.values[property.id] ?? null }));
    console.log("NEW_STATUS_DEFAULT_EVIDENCE", JSON.stringify({ property, rows }));
    assert.deepEqual(property.options.map(({ id, name, color, group }) => ({ id, name, color, group })), [
      { id: "todo", name: "未开始", color: "gray", group: "todo" },
      { id: "doing", name: "进行中", color: "blue", group: "inProgress" },
      { id: "done", name: "已完成", color: "green", group: "complete" },
    ]);
    assert.ok(rows.length > 0 && rows.every((row) => row.value === "todo"));
    for (const old of before.databaseItems) {
      const current = after.databaseItems.find((entry) => entry.id === old.id);
      assert.equal(current.pageId, old.pageId);
      if (old.sourceId === "projects") {
        const { [property.id]: newStatus, ...oldValues } = current.values;
        assert.equal(newStatus, "todo"); assert.deepEqual(oldValues, old.values);
      } else assert.deepEqual(current, old);
    }
    assert.deepEqual(after.pages, before.pages);
    await page.keyboard.press("Escape");
    for (const row of rows) assert.equal(await db.locator(`tr[data-item-id="${row.id}"] td[data-property-id="${property.id}"]`).innerText(), "未开始");
    await page.reload(); await db.waitFor();
    const reloaded = await saved();
    assert.deepEqual(source(reloaded).properties.find((entry) => entry.id === property.id).options, property.options);
    for (const row of rows) assert.equal(reloaded.databaseItems.find((entry) => entry.id === row.id).values[property.id], "todo");
    await db.getByRole("button", { name: "新建记录", exact: true }).click();
    const withNew = await persisted((value) => value.databaseItems.length === reloaded.databaseItems.length + 1);
    const newItem = withNew.databaseItems.find((entry) => !reloaded.databaseItems.some((old) => old.id === entry.id));
    assert.equal(newItem.values[property.id], "todo");
    assert.equal(newItem.values.status, "todo");
  });
}, { workspace: statusWorkspace });

const locked = coreParityWorkspace();
locked.pages.find((entry) => entry.id === "database-page").settings.locked = true;
await browserScenario("database-property-default-create-v10-locked", async ({ page, check, saved, assert }) => {
  await check("locked database cannot add a property", async () => {
    const before = await saved();
    assert.equal(await page.getByRole("button", { name: "视图设置", exact: true }).count(), 0);
    assert.deepEqual(ids(await saved()), ids(before));
  });
}, { workspace: locked });
