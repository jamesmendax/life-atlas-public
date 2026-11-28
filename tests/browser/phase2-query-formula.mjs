import { browserScenario } from "./harness.mjs";
import { chooseSavedView, copyCurrentView, openViewSettingsSection, setViewSettings, viewSettingsPanel } from "./database-navigation.mjs";

await browserScenario("phase2-query-formula", async ({ page, check, screenshot, saved, persisted, assert }) => {
  const db = page.locator('section.database-view[data-source-id="projects"]');
  const choose = async (type) => {
    await chooseSavedView(db, `view-${type}`);
    await page.waitForFunction((type)=>document.querySelector('section.database-view[data-source-id="projects"]')?.getAttribute("data-view-type")===type,type);
  };
  const settings = (open) => setViewSettings(db, open);
  const panel = viewSettingsPanel(db);

  await check("Nested filter groups persist and project the same source without copying records", async () => {
    await db.waitFor(); await choose("table"); await openViewSettingsSection(db, "筛选");
    const root = panel.locator('.db-filter-group[data-filter-path="root"]');
    await root.getByRole("button",{name:"+ 条件",exact:true}).click();
    await panel.getByLabel("筛选属性 0",{exact:true}).selectOption("status");
    await panel.getByLabel("筛选操作 0",{exact:true}).selectOption("equals");
    await panel.getByLabel("筛选值 0",{exact:true}).selectOption("doing");
    await root.getByRole("button",{name:"+ 条件组",exact:true}).click();
    const nested=panel.locator('.db-filter-group[data-filter-path="1"]');
    await nested.getByLabel("筛选逻辑 1",{exact:true}).selectOption("or");
    await nested.getByRole("button",{name:"+ 条件",exact:true}).click();
    await panel.getByLabel("筛选属性 1.0",{exact:true}).selectOption("title");
    await panel.getByLabel("筛选操作 1.0",{exact:true}).selectOption("contains");
    await panel.getByLabel("筛选值 1.0",{exact:true}).fill("Alpha");
    const state=await persisted((value)=>{
      const view=value.databaseViews.find((entry)=>entry.id==="view-table");
      return view.filter?.kind==="group" && view.filter.children?.[1]?.kind==="group";
    });
    assert.equal(state.databaseItems.filter((item)=>item.sourceId==="projects").length,3);
    assert.equal(await db.locator("tbody tr[data-item-id]").count(),1);
    assert.match(await db.locator("tbody").innerText(),/Alpha 项目/);
  });

  await check("Three sort levels can be added, edited and reordered with deterministic persistence", async () => {
    await openViewSettingsSection(db, "排序");
    for (let i=0;i<3;i++) await panel.getByRole("button",{name:"+ 添加排序",exact:true}).click();
    await panel.getByLabel("排序属性 1",{exact:true}).selectOption("amount");
    await panel.getByLabel("排序方向 1",{exact:true}).selectOption("desc");
    await panel.getByLabel("排序属性 2",{exact:true}).selectOption("date");
    await panel.getByLabel("排序属性 3",{exact:true}).selectOption("title");
    await panel.getByLabel("排序 3 上移",{exact:true}).click();
    const state=await persisted((value)=>{
      const sorts=value.databaseViews.find((entry)=>entry.id==="view-table").sorts;
      return sorts?.length===3 && sorts[1]?.propertyId==="title";
    });
    assert.deepEqual(state.databaseViews.find((entry)=>entry.id==="view-table").sorts.map((entry)=>entry.propertyId),["amount","title","date"]);
  });

  await check("Grouping order, hidden groups, empty-group policy and secondary grouping persist", async () => {
    await openViewSettingsSection(db, "分组");
    await panel.getByLabel("一级分组",{exact:true}).selectOption("status");
    await panel.getByLabel("显示空分组",{exact:true}).uncheck();
    const doneRow=panel.locator(".db-group-order > div").filter({hasText:"完成"});
    await doneRow.locator('input[type="checkbox"]').uncheck();
    const doingRow=panel.locator(".db-group-order > div").filter({hasText:"进行中"});
    await doingRow.getByRole("button",{name:"↑",exact:true}).click().catch(()=>{});
    await openViewSettingsSection(db, "子分组");
    await panel.getByLabel("二级分组",{exact:true}).selectOption("people");
    const state=await persisted((value)=>{
      const grouping=value.databaseViews.find((entry)=>entry.id==="view-table").grouping;
      return grouping?.primaryPropertyId==="status" && grouping.secondaryPropertyId==="people" && grouping.showEmpty===false && grouping.hiddenGroupKeys?.includes("done");
    });
    assert.equal(state.databaseItems.length,4);
  });

  await check("Formula values render through the typed AST and survive query settings", async () => {
    await settings(false);
    const alpha=db.locator('tr[data-item-id="alpha"]');
    const formulaCell=alpha.locator('[data-property-id="formula"]');
    assert.equal((await formulaCell.innerText()).trim(),"240");
    const state=await saved();
    const source=state.dataSources.find((entry)=>entry.id==="projects");
    assert.equal(source.properties.find((entry)=>entry.id==="formula").config.expression,"{{amount}} * 2");
  });

  await check("Copied shared-source view keeps independent filter/sort/group settings and source rows", async () => {
    const before=await saved();
    await copyCurrentView(db);
    const copied=await persisted((value)=>value.databaseViews.length===before.databaseViews.length+1);
    const copy=copied.databaseViews.at(-1);
    assert.equal(copy.sourceId,"projects");
    assert.equal(copied.databaseItems.length,before.databaseItems.length);
    await openViewSettingsSection(db, "筛选");
    await panel.getByRole("button",{name:"清除筛选",exact:true}).click();
    await openViewSettingsSection(db, "分组");
    await panel.getByLabel("一级分组",{exact:true}).selectOption("");
    await persisted((value)=>{
      const latest=value.databaseViews.find((entry)=>entry.id===copy.id);
      const original=value.databaseViews.find((entry)=>entry.id==="view-table");
      return latest?.filter==null && !latest?.grouping?.primaryPropertyId && original?.filter?.kind==="group" && original?.grouping?.primaryPropertyId==="status";
    });
    await page.reload({waitUntil:"domcontentloaded"}); await db.waitFor();
    const state=await saved();
    assert.equal(state.databaseViews.find((entry)=>entry.id==="view-table").sorts.length,3);
    assert.equal(state.databaseViews.find((entry)=>entry.id===copy.id).sourceId,"projects");
    assert.equal(state.databaseItems.filter((item)=>item.sourceId==="projects").length,3);
    await screenshot("query-settings");
  });
});
