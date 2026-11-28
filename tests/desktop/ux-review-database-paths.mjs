import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { openViewSettingsSection, setViewSettings, viewSettingsPanel } from "../browser/database-navigation.mjs";

export async function databasePaths({page,db,check,nav,frame,focus,persist,saved,until,openDb,file}) {
  const settings=section=>openViewSettingsSection(db,section);
  const closeSettings=()=>setViewSettings(db,false);
  const button=(root,name)=>root.getByRole("button",{name,exact:true});
  const view=(s,type)=>s.databaseViews.find(v=>v.id==="view-"+type);
  const item=(s,id)=>s.databaseItems.find(r=>r.id===id);
  const rows=()=>db.locator("tbody tr[data-item-id]").evaluateAll(els=>els.map(e=>e.dataset.itemId));
  const anchor=(id,css)=>db.locator('[data-item-id="'+id+'"] '+css);
  const focused=loc=>until(()=>loc.evaluate(el=>document.activeElement===el));
  const peek=()=>page.getByRole("dialog",{name:"记录预览",exact:true});
  const side=()=>page.getByRole("region",{name:"记录侧边预览",exact:true});
  const wheelAt=async (loc,x,y)=>{
    await loc.scrollIntoViewIfNeeded();
    const point=await loc.evaluate(e=>{
      const r=e.getBoundingClientRect();
      return {x:(Math.max(0,r.left)+Math.min(innerWidth,r.right))/2,y:(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2};
    });
    await page.mouse.move(point.x,point.y);
    await page.mouse.wheel(x,y);
  };
  const after=()=>page.evaluate(()=>new Promise(ok=>setTimeout(ok,160)));
  const setOpenMode=async(label)=>{
    const panel=await settings("布局");
    await panel.getByLabel("打开记录的方式",{exact:true}).click();
    await panel.getByRole("menuitemradio",{name:label,exact:true}).click();
    await closeSettings();
  };
  await check("reading-size","默认页与整页入口对照、视图宽度和首屏左右滚动按钮",async()=>{
    await nav("table");
    const first=db.locator("tbody tr[data-item-id]").first();
    await db.locator(".db-navigation-row").scrollIntoViewIfNeeded();
    const measure=()=>db.evaluate(e=>{
      const rect=s=>{const n=e.querySelector(s);if(!n)return null;const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
      const outer=e.closest(".workspace-scroll");
      return {viewport:[innerWidth,innerHeight],rootClass:e.className,table:rect(".db-table-scroll"),
        toolbar:rect(".db-navigation-row"),firstRow:rect("tbody tr[data-item-id]"),horizontalControls:rect(".db-horizontal-scroll-controls"),
        hostTitle:document.querySelector('[aria-label="页面标题"]')?.value,sourceTitle:e.querySelector(".db-source-button")?.innerText,
        parentTop:outer?.scrollTop,parentHeight:outer?.clientHeight,parentScrollHeight:outer?.scrollHeight,
        rightTitle:e.querySelector('[aria-label="向右查看更多属性"]')?.title,
        rows:e.querySelectorAll("tbody tr[data-item-id]").length,sourceId:e.dataset.sourceId,viewId:e.dataset.viewId};
    });
    const standard=await measure();
    assert.ok(standard.horizontalControls && standard.firstRow);
    await button(db,"以整页打开").click();await page.getByRole("article",{name:"数据库整页"}).waitFor();
    const expanded=await measure();
    await page.screenshot({path:file("expanded-table"),animations:"disabled"});
    await button(page,"返回所在页面").click();await first.waitFor();
    const returned=await measure();
    assert.equal(expanded.sourceId,standard.sourceId);
    assert.equal(expanded.viewId,standard.viewId);
    assert.equal(returned.sourceId,standard.sourceId);
    return {standard,expanded,returned};
  });
  await check("tabs","键盘 Home/End、溢出列表和按名称切换视图",async()=>{
    await nav("table");
    let active=db.getByRole("tab",{selected:true});
    await active.press("End");
    await until(()=>db.getAttribute("data-view-type").then(t=>t==="roadmap"));
    await active.press("Home");
    await until(()=>db.getAttribute("data-view-type").then(t=>t==="table"));
    const more=db.getByRole("button",{name:/^更多\d+个…$/});
    if(await more.count()){
      await more.click();
      const menu=page.getByRole("dialog",{name:/^全部视图：/});
      const options=await menu.getByRole("menuitemradio").count();
      const field=menu.getByRole("searchbox",{name:"搜索视图"});
      await field.fill("地图");
      assert.equal(await menu.getByRole("menuitemradio").count(),1);
      await field.press("Enter");
      await until(()=>db.getAttribute("data-view-type").then(t=>t==="map"));
      await focused(active);
      return {selected:"map",overflowOptions:options,focus:await focus()};
    }
    return {selected:"table",visibleTabs:await db.getByRole("tab").count()};
  });
  await check("search","搜索、无结果、清除和 Escape 焦点返回",async()=>{
    await nav("table");
    const opener=button(db,"搜索此视图");
    await opener.click();
    const query=db.getByRole("textbox",{name:"在此视图中搜索"});
    await query.fill("Alpha 项目");
    await until(async()=> (await rows()).length===1);
    assert.deepEqual(await rows(),["alpha"]);
    await query.fill("绝无此记录774");
    await until(async()=>(await rows()).length===0);
    const empty=(await db.locator(".db-view-body").innerText()).slice(0,120);
    await query.press("Escape");
    await focused(opener);
    return {empty,restoredRows:(await rows()).length};
  });
  await check("scroll","表格横向滚轮、横向按钮及页面纵向滚轮",async()=>{
    await nav("table");
    const table=db.locator(".db-table-scroll");
    const scroller=page.locator(".workspace-scroll").first();
    const offsets=()=>table.evaluate(e=>({x:e.scrollLeft,y:e.scrollTop,w:e.clientWidth,full:e.scrollWidth,parent:e.closest(".workspace-scroll")?.scrollTop}));
    await table.scrollIntoViewIfNeeded();
    const initial=await offsets();
    await wheelAt(table,410,0);await after();
    const sideways=await offsets();
    assert.ok(sideways.x>initial.x,JSON.stringify({initial,sideways}));
    const left=button(db,"向左查看更多属性");
    await left.click();await after();
    const reset=await offsets();assert.ok(reset.x<sideways.x);
    const before=await offsets();
    await wheelAt(table,0,before.parent>220||before.y>220?-430:430);await after();
    const vertical=await offsets();
    assert.ok(vertical.parent!==before.parent||vertical.y!==before.y,JSON.stringify({before,vertical}));
    return {initial,sideways,reset,before,vertical,outerHeight:await scroller.evaluate(e=>[e.clientHeight,e.scrollHeight])};
  });
  await check("resize","表头拖动和方向键调宽，读回列宽",async()=>{
    await nav("table");
    const grip=db.getByRole("separator",{name:"调整 金额 列宽"});
    await grip.scrollIntoViewIfNeeded();
    const value=async()=>Number(await grip.getAttribute("aria-valuenow"));
    const original=await value();
    const box=await grip.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    await page.mouse.move(box.x+box.width/2+32,box.y+box.height/2,{steps:6});await page.mouse.up();
    const dragged=await value();assert.ok(dragged>=original+21);
    await grip.press("ArrowLeft");await frame();
    const keyboard=await value();assert.equal(keyboard,dragged-10);
    await persist(s=>view(s,"table").config.table?.columnWidths.amount===keyboard);
    return {original,dragged,keyboard};
  });
  await check("properties","数字错误、修改和 Escape、状态选项、勾选与计算属性",async()=>{
    await nav("table");
    const number=anchor("alpha",'td[data-property-id="amount"]');
    await number.getByRole("button").click();
    const box=page.locator(".db-table-number-popover input");
    await box.fill("错误");assert.equal(await box.getAttribute("aria-invalid"),"true");
    await page.locator(".db-table-number-popover [role=alert]").waitFor();
    await box.fill("137");await box.press("Escape");await focused(number);
    await number.press("ArrowRight");await frame();
    const neighbor=await page.evaluate(()=>document.activeElement?.dataset.propertyId);
    const status=anchor("alpha",'td[data-property-id="status"] summary');
    await status.click();
    await page.getByRole("option",{name:"完成",exact:true}).click();
    const checked=anchor("alpha",'td[data-property-id="checked"] input[type=checkbox]');
    await checked.check();
    const state=await persist(s=>item(s,"alpha").values.amount===137 && item(s,"alpha").values.status==="done" && item(s,"alpha").values.checked===true);
    const derived=await anchor("alpha",'td[data-property-id="formula"]').innerText();
    assert.ok(derived.includes("274"),derived);
    return {neighbor,amount:item(state,"alpha").values.amount,status:item(state,"alpha").values.status,derived};
  });
  await check("property-schema","显示属性、表头菜单与属性命名、创建文本属性",async()=>{
    await nav("table");
    let panel=await settings("显示属性");
    const toggle=panel.getByRole("checkbox",{name:"显示 说明",exact:true});
    await toggle.uncheck();await closeSettings();
    assert.equal(await db.getByRole("button",{name:"编辑 说明 属性",exact:true}).count(),0);
    panel=await settings("显示属性");await panel.getByRole("checkbox",{name:"显示 说明",exact:true}).check();
    await closeSettings();
    const header=button(db,"编辑 说明 属性");await header.click();
    let menu=page.getByRole("menu",{name:"说明 属性菜单",exact:true});
    const input=menu.getByRole("textbox",{name:"属性名称",exact:true});
    assert.equal(await input.inputValue(),"说明");await input.press("Escape");
    await focused(header);
    panel=await settings("添加属性");
    await panel.getByRole("textbox",{name:"新属性名称"}).fill("审阅备注");
    await button(panel.getByLabel("属性类型",{exact:true}),"文本").click();
    const editor=page.getByRole("dialog",{name:"编辑文本属性",exact:true});
    await editor.waitFor();await page.keyboard.press("Escape");
    const state=await persist(s=>s.dataSources.find(d=>d.id==="projects").properties.some(p=>p.name==="审阅备注"&&p.type==="text"));
    return {types:state.dataSources.find(d=>d.id==="projects").properties.map(p=>p.type),created:"审阅备注"};
  });
  await check("filter-sort","快捷筛选按名称匹配、清除，再以金额降序排列",async()=>{
    await nav("table");const filter=button(db,"筛选");
    await filter.click();let panel=viewSettingsPanel(db);
    await button(panel,"+ 条件").click();
    await panel.getByLabel("筛选值 0",{exact:true}).fill("Alpha");
    await closeSettings();await until(async()=>(await rows()).length===1);
    assert.deepEqual(await rows(),["alpha"]);
    await filter.click();panel=viewSettingsPanel(db);await button(panel,"删除筛选 0").click();await closeSettings();
    await button(db,"排序").click();panel=viewSettingsPanel(db);
    await button(panel,"+ 添加排序").click();
    await panel.getByLabel("排序属性 1",{exact:true}).selectOption("amount");await panel.getByLabel("排序方向 1").selectOption("desc");await closeSettings();
    const order=await rows();assert.equal(order[0],"alpha");
    const state=await persist(s=>view(s,"table").sorts?.[0]?.propertyId==="amount"&&view(s,"table").sorts[0].direction==="desc");
    return {orders:order.slice(0,6),sort:view(state,"table").sorts,filteredIds:["alpha"]};
  });
  await check("group","一级和二级分组、空组显示与看板回读",async()=>{
    await nav("board");
    let panel=await settings("分组");
    await panel.getByLabel("一级分组",{exact:true}).selectOption("status");
    await panel.getByLabel("显示空分组",{exact:true}).uncheck();
    await closeSettings();panel=await settings("子分组");
    await panel.getByLabel("二级分组",{exact:true}).selectOption("people");await closeSettings();
    const state=await persist(s=>view(s,"board").grouping?.secondaryPropertyId==="people");
    const groups=await db.locator(".db-board-column").evaluateAll(es=>es.map(e=>e.dataset.groupKey));
    assert.ok(groups.includes("doing"));return {grouping:view(state,"board").grouping,groups};
  });
  await check("board","原生跨列拖动，看板记录状态和父区块保持正确",async()=>{
    await nav("board");
    const from=db.locator('.db-board-card[data-item-id="beta"]');
    const to=db.locator('.db-board-column[data-group-key="doing"]');
    const before=item(await saved(),"beta").values.status;
    await from.dragTo(to,{targetPosition:{x:12,y:13}});
    const state=await persist(s=>item(s,"beta").values.status==="doing");
    assert.equal(state.pages.find(p=>p.id==="database-page").content[0].id,"ux-database");
    return {before,after:item(state,"beta").values.status};
  });
  await check("list","列表标题编辑取消及提交，焦点返回原记录",async()=>{
    await nav("list");const row=db.locator('.db-list-row[data-item-id="beta"]');
    const edit=row.locator(".db-list-edit");
    await edit.click();let input=row.getByRole("textbox",{name:"记录标题",exact:true});
    await input.fill("取消这次编辑");await input.press("Escape");await focused(row);
    assert.equal(await row.locator(".db-list-open").innerText(),"Beta 项目");
    await edit.click();input=row.getByRole("textbox",{name:"记录标题",exact:true});
    await input.fill("Beta 走查");await input.press("Enter");
    const state=await persist(s=>item(s,"beta").values.title==="Beta 走查");
    return {title:item(state,"beta").values.title,focus:await focus()};
  });
  await check("center","画廊键盘打开中心预览，独立滚动并返回原卡片",async()=>{
    await nav("gallery");const card=anchor("alpha",".db-gallery-open");
    await card.scrollIntoViewIfNeeded();await card.press("Enter");
    const modal=peek();await modal.waitFor();await focused(modal.getByRole("textbox",{name:"记录标题",exact:true}));
    const pane=modal.locator(".record-peek-body"),outer=page.locator(".workspace-scroll").first();
    const before=[await pane.evaluate(e=>e.scrollTop),await outer.evaluate(e=>e.scrollTop)];
    await wheelAt(pane,0,380);await after();
    const scrolled=[await pane.evaluate(e=>e.scrollTop),await outer.evaluate(e=>e.scrollTop)];
    assert.ok(scrolled[0]>before[0]);assert.ok(Math.abs(scrolled[1]-before[1])<2);
    await page.screenshot({path:file("center-scroll"),animations:"disabled"});
    await page.keyboard.press("Escape");await modal.waitFor({state:"detached"});await focused(card);
    return {before,scrolled,return:await focus()};
  });
  await check("side","看板卡片菜单打开侧边预览，Escape 回原菜单按钮",async()=>{
    await nav("board");const card=db.locator('.db-board-card[data-item-id="alpha"]');
    await card.hover();const menuButton=card.locator(".db-board-move-menu");
    await menuButton.click();
    await button(page.getByRole("dialog",{name:"卡片操作"}),"在侧边预览中打开").click();
    const panel=side();await panel.waitFor();await focused(panel.getByRole("textbox",{name:"记录标题",exact:true}));
    const rect=await panel.boundingBox();
    assert.equal(await panel.getAttribute("aria-modal"),null);
    await page.screenshot({path:file("side-open"),animations:"disabled"});
    await page.keyboard.press("Escape");await panel.waitFor({state:"detached"});await focused(menuButton);
    return {panel:rect,viewport:await page.evaluate(()=>[innerWidth,innerHeight]),return:await focus()};
  });
  await check("full","记录配置成完整页面，从列表打开再通过侧栏返回",async()=>{
    await nav("list");await setOpenMode("完整页面");await anchor("alpha",".db-list-open").click();
    const title=page.getByLabel("页面标题",{exact:true});await title.waitFor();
    assert.equal(await title.inputValue(),"Alpha 项目");
    assert.equal(await peek().count()+await side().count(),0);
    await openDb();await nav("list");await setOpenMode("中心预览");
    return {opened:"Alpha 项目",returned:await db.getAttribute("data-view-id")};
  });
  await check("calendar","日历前后周期、未安排记录搜索和记录跨日拖放",async()=>{
    await nav("calendar");
    const period=db.locator(".db-calendar-toolbar strong");
    const before=await period.innerText();await button(db,"下一周期").click();const next=await period.innerText();assert.notEqual(next,before);
    await button(db,"上一周期").click();assert.equal(await period.innerText(),before);
    await db.getByRole("button",{name:/^未安排 \(/}).click();
    const uns=page.getByRole("searchbox",{name:"搜索未安排的记录"});
    await uns.fill("现场记录 01");await page.locator(".db-unscheduled-row").filter({hasText:"现场记录 01"}).waitFor();
    await uns.press("Escape");
    const dest=db.locator('.db-calendar-cell[data-date="2026-09-22"]');
    const chip=db.locator(".db-calendar-chip").filter({hasText:"Alpha 项目"});
    await chip.scrollIntoViewIfNeeded();
    const measurements=await db.locator(".db-calendar-chip").evaluateAll(els=>els.map(el=>{
      const name=el.querySelector(".db-calendar-record-title"), picker=el.querySelector(".db-date-picker");
      return {full:name.textContent,titlePx:name.clientWidth,textPx:name.scrollWidth,chipPx:el.clientWidth,hiddenPickerPx:picker.clientWidth,
        titleHint:name.closest("[title]")?.getAttribute("title")||null,ellipsis:getComputedStyle(name).textOverflow};
    }));
    await chip.screenshot({path:file("calendar-chip")});
    await page.evaluate(()=>{
      window.uxCalendarTrace=[];
      for(const type of ["pointerdown","pointerup","dragstart","dragover","drop","dragend"]) document.addEventListener(type,e=>{
        const el=e.target.closest?e.target:e.target.parentElement;
        window.uxCalendarTrace.push([type,el.closest(".db-calendar-cell")?.dataset.date||null,el.className?.toString?.(),[...(e.dataTransfer?.types||[])]]);
      },true);
    });
    await chip.dragTo(dest,{targetPosition:{x:13,y:13}});
    await after();
    const trace=await page.evaluate(()=>window.uxCalendarTrace);
    const diag={measurements,trace,afterNative:(await saved()).databaseItems.find(i=>i.id==="alpha").values.date,focus:await focus()};
    await fs.writeFile(file("calendar-trace").replace(/\.png$/,".json"),JSON.stringify(diag,null,2));
    const actualDay=await chip.evaluate(el=>el.closest(".db-calendar-cell").dataset.date);
    if(actualDay!=="2026-09-22"){
      await chip.hover();
      const grip=chip.getByRole("button",{name:"拖动 Alpha 项目 到其他日期"});
      await grip.scrollIntoViewIfNeeded();
      const a=await grip.boundingBox(),b=await dest.boundingBox();
      await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
      await page.mouse.move(b.x+16,b.y+28,{steps:8});await page.mouse.up();
      await after();
      diag.handleTrace=await page.evaluate(()=>window.uxCalendarTrace);
      diag.afterHandle=await chip.evaluate(el=>el.closest(".db-calendar-cell").dataset.date);
      await fs.writeFile(file("calendar-trace").replace(/\.png$/,".json"),JSON.stringify(diag,null,2));
    }
    const state=await persist(s=>item(s,"alpha").values.date.start==="2026-09-22");
    return {before,next,date:item(state,"alpha").values.date,afterNative:actualDay,afterHandle:diag.afterHandle||null,measurements};
  });
  await check("timeline","时间线切换比例、移动一天和保持日期范围",async()=>{
    await nav("timeline");const picker=db.getByLabel("时间线比例");
    await picker.selectOption("week");
    const initial=item(await saved(),"alpha").values.date;
    await button(db,"Alpha 项目 后移一天").click();
    const state=await persist(s=>item(s,"alpha").values.date.start!==initial.start);
    const end=item(state,"alpha").values.date;
    assert.equal(Date.parse(end.start)-Date.parse(initial.start),86400000);
    assert.equal(Date.parse(end.end)-Date.parse(initial.end),86400000);
    return {scale:await picker.inputValue(),initial,end};
  });
  await check("chart","图表明细键盘展开，条形切折线并保留聚合",async()=>{
    await nav("chart");
    const chart=db.locator(".db-chart-data");
    await chart.locator("summary").press("Enter");assert.ok(await chart.evaluate(el=>el.open));
    const data=await chart.locator("tbody tr").allInnerTexts();assert.ok(data.length>=2);
    let panel=await settings("布局");await panel.getByLabel("图表类型",{exact:true}).selectOption("line");await closeSettings();
    await db.locator(".db-real-line-chart").waitFor();
    const state=await persist(s=>view(s,"chart").config.chart.kind==="line");return {data,config:view(state,"chart").config.chart};
  });
  await check("form","空表单必填反馈、键盘填写和创建记录",async()=>{
    await nav("form");const form=db.locator(".db-form-surface");
    await button(form,"提交记录").click();const warning=await form.getByRole("alert").first().innerText();
    await form.getByRole("textbox",{name:"名称",exact:true}).fill("追加的走查记录");
    await form.getByRole("textbox",{name:"名称",exact:true}).press("Tab");
    await button(form,"提交记录").click();await form.getByRole("status").waitFor();
    const state=await persist(s=>s.databaseItems.some(i=>i.values.title==="追加的走查记录"));return {warning,message:await form.getByRole("status").innerText(),id:state.databaseItems.find(i=>i.values.title==="追加的走查记录").id};
  });
  await check("dashboard","仪表盘聚合读数、添加指标与本地记录预览",async()=>{
    await nav("dashboard");const widgets=db.locator(".db-configured-widget");
    const before=await widgets.count();const initial=await db.locator(".db-dashboard-metric strong").first().innerText();
    const panel=await settings("布局");await button(panel,"＋ 指标").click();await closeSettings();
    assert.equal(await widgets.count(),before+1);
    const entry=db.locator(".db-configured-widget .db-list-row").first();const chosen=await entry.innerText();await entry.click();
    await peek().waitFor();assert.equal(await peek().getByRole("textbox",{name:"记录标题",exact:true}).inputValue(),chosen);
    await button(peek(),"关闭预览").click();return {initial,added:await widgets.count(),chosen};
  });
  await check("map","地图缩放、键盘与指针平移，列表地点定位",async()=>{
    await nav("map");const map=db.locator(".db-offline-map");
    await button(db,"地图放大").click();const before=await map.getAttribute("viewBox");
    await map.press("ArrowRight");await frame();const keyboard=await map.getAttribute("viewBox");assert.notEqual(keyboard,before);
    await map.scrollIntoViewIfNeeded();const point=await map.boundingBox();
    await page.mouse.move(point.x+28,point.y+18);await page.mouse.down();await page.mouse.move(point.x+67,point.y+42,{steps:5});await page.mouse.up();await frame();
    const dragged=await map.getAttribute("viewBox");assert.notEqual(dragged,keyboard);
    await button(db,"居中到 Alpha 项目").click();
    const current=await db.locator(".db-map-selection").innerText();assert.ok(current.includes("Alpha 项目"));
    await button(db,"重置地图").click();return {before,keyboard,dragged,current};
  });
  await check("roadmap","时间脉络放大、节点悬停、键盘、导出面板与焦点恢复",async()=>{
    await nav("roadmap");const road=db.getByTestId("roadmap-view"),tools=road.getByRole("toolbar",{name:"时间脉络工具"});
    const old=await road.locator(".db-roadmap-zoom").innerText();await button(tools,"放大").click();const zoom=await road.locator(".db-roadmap-zoom").innerText();assert.notEqual(old,zoom);
    const node=road.locator('[data-entry-id][data-kind="milestone"]').first();await node.locator(".db-roadmap-card-title").hover();
    await page.getByRole("tooltip",{name:"时间脉络详情",exact:true}).waitFor();
    await node.press("Tab");await frame();
    const keyFocus=await page.evaluate(()=>document.activeElement?.closest("[data-entry-id]")?.getAttribute("data-entry-id"));
    const exp=button(tools,"导出");await exp.click();const dialog=road.getByRole("dialog",{name:"导出时间脉络"});
    await dialog.getByLabel("时间脉络导出背景").selectOption("transparent");const actions=await dialog.getByRole("button").allInnerTexts();
    await dialog.getByRole("button",{name:"关闭",exact:true}).click();await focused(exp);
    return {old,zoom,node:keyFocus,actions};
  });
  await check("create","新建记录、添加命名视图再通过溢出菜单重新打开",async()=>{
    await nav("gallery");const count=(await saved()).databaseItems.length;
    await button(db,"新建记录").click();const modal=peek();await modal.waitFor();
    const title=modal.getByRole("textbox",{name:"记录标题",exact:true});await title.fill("新增资料项");await title.press("Escape");
    await persist(s=>s.databaseItems.length===count+1 && s.databaseItems.some(i=>i.values.title==="新增资料项"));
    await button(db,"添加视图").click();await button(page.getByRole("dialog",{name:"添加视图",exact:true}),"列表").click();
    const panel=page.getByRole("dialog",{name:"新建视图",exact:true});
    const titleInput=panel.getByRole("textbox",{name:"视图名称",exact:true});await titleInput.fill("新增走查视图");await button(panel,"完成").click();
    const state=await persist(s=>s.databaseViews.some(v=>v.name==="新增走查视图"));
    return {created:state.databaseViews.find(v=>v.name==="新增走查视图").id,rows:state.databaseItems.length};
  });
}
