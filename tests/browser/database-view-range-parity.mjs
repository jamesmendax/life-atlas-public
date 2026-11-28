import fs from "node:fs/promises";
import assert from "node:assert/strict";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {chromium} from "playwright";
import {fullWorkspace} from "../fixtures/full-workspace.mjs";
import {chooseSavedView,openViewSettingsSection,setViewSettings} from "./database-navigation.mjs";
import {workspaceStorageKey} from "../../src/persistence/workspaceRepository.js";
import {upgradeWorkspace} from "../../src/persistence/migrations.js";

const out=".qa/database-parity-navigation/views";
await fs.mkdir(out,{recursive:true});
const profile=await fs.mkdtemp(join(tmpdir(),"life-atlas-views-parity-"));
const launch=()=>chromium.launchPersistentContext(profile,{channel:"msedge",headless:true,viewport:{width:1500,height:1000}});
let ctx=await launch(),page,db;
const sample=JSON.parse(await fs.readFile("docs/blueprint/design/mobai/sample-database.json","utf8"));
const base=fullWorkspace();
for(const key of ["pages","dataSources","databaseItems","databaseViews"]) base[key].push(...sample[key]);
base.ui.preferences={style:"mobai",theme:"light"};
const owner=base.pages.find(p=>p.id==="p-teach");
owner.content=[{id:"occurrence",type:"databaseView",props:{sourceId:"ds-teach",viewId:"v-teach-table",viewIdsJson:JSON.stringify(sample.databaseViews.map(v=>v.id))}}];
const id="i-teach-2",item=base.databaseItems.find(i=>i.id===id);
item.values.date={start:"2026-11-03T09:15:00",end:"2026-11-05T17:45:00",timeZone:"Asia/Shanghai",includeTime:true};
const source=base.dataSources.find(s=>s.id==="ds-teach");
source.properties.push({...source.properties.find(p=>p.id==="date"),id:"finish-field",name:"交付时间"});
item.values["finish-field"]={start:"2026-11-03T18:45:00",end:"2026-11-20T08:00:00",timeZone:"Asia/Shanghai",includeTime:true};
base.pages.find(p=>p.id===item.pageId).cover={kind:"gallery",value:"hokusai-landscape",position:36};
base.pages.find(p=>p.id==="p-teach-3").settings.locked=true;
await ctx.addInitScript(({key,seed})=>{if(!localStorage.getItem(key)){localStorage.setItem(key,JSON.stringify(seed));localStorage.setItem("life-atlas.parity.seeded","1");}},{key:workspaceStorageKey,seed:upgradeWorkspace(base)});
async function open(){page=await ctx.newPage();page.setDefaultTimeout(6500);await page.goto("http://127.0.0.1:5178");await page.locator(".workspace-tree-row").filter({hasText:"教学安排"}).first().click();db=page.locator('section.database-view[data-source-id="ds-teach"]');await db.waitFor();}
const select=type=>chooseSavedView(db,"v-teach-"+type);
const state=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),workspaceStorageKey);
const record=w=>w.databaseItems.find(i=>i.id===id);
async function settled(predicate){const end=Date.now()+9000;let w;do{w=await state();if(predicate(w))return w;await page.waitForTimeout(120);}while(Date.now()<end);throw Error("目标数据未持久化");}
const shot=name=>page.screenshot({path:join(out,name+".png")});
const report={profile,checks:[],started:new Date().toISOString()};
const check=async(name,fn)=>{const r={name};report.checks.push(r);try{r.observed=await fn();r.passed=true;}catch(e){r.error=String(e);console.error(name,e);await shot("diagnostic-"+name);process.exitCode=1;}await fs.writeFile(join(out,"report.json"),JSON.stringify(report,null,2));};
const ac=(selector)=>db.locator(selector);
const center=async loc=>{await loc.scrollIntoViewIfNeeded();const b=await loc.boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2};};
async function drag(from,to,cancel=false){const a=await center(from);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:12});if(cancel)await page.evaluate(({x,y})=>window.dispatchEvent(new PointerEvent("pointercancel",{pointerId:1,isPrimary:true,clientX:x,clientY:y})),to);await page.mouse.up();}
const view=(w,type)=>w.databaseViews.find(v=>v.id==="v-teach-"+type);
const close=()=>setViewSettings(db,false);
try{
  await open();
  await check("calendar",async()=>{
    await select("calendar");
    const panel=await openViewSettingsSection(db,"布局");await panel.getByLabel("显示页面图标",{exact:true}).uncheck();await close();assert.equal(await ac(".db-calendar-record-glyph:visible").count(),0);
    const chip=ac('.db-calendar-chip[data-item-id="i-teach-2"]');
    const edge=ac('.db-calendar-span[data-item-id="i-teach-2"] .edge-end');
    await drag(edge,await center(ac('[data-date="2026-11-07"] time')));await settled(w=>record(w).values.date.end==="2026-11-07T17:45:00");
    await drag(chip.locator(".edge-start"),await center(ac('[data-date="2026-11-04"] time')));await settled(w=>record(w).values.date.start==="2026-11-04T09:15:00");
    await edge.press("ArrowRight");const w=await settled(w=>record(w).values.date.end==="2026-11-08T17:45:00");
    await drag(edge,await center(ac('[data-date="2026-11-11"] time')),true);await page.waitForTimeout(850);assert.deepEqual(record(await state()).values.date,record(w).values.date);
    await shot("calendar");return record(w).values.date;
  });
  await check("timeline",async()=>{
    await select("timeline");const scale=db.getByLabel("时间线比例",{exact:true});const bars=ac('.db-timeline-bar[data-item-id="i-teach-2"]');const right=bars.locator(".db-timeline-resize");
    await scale.selectOption("quarter");const quarter=await ac(".db-timeline-toolbar span").innerText();assert.ok((await ac(".db-timeline-axis").innerText()).includes("Q"));
    await scale.selectOption("day");const day=await ac(".db-timeline-toolbar span").innerText();assert.notEqual(quarter,day);
    const lock=ac('.db-timeline-bar[data-item-id="i-teach-3"] button');
    const disabled=await lock.evaluateAll(es=>es.map(e=>e.disabled));assert.ok(disabled.length&&disabled.every(Boolean));
    const initial=record(await state()).values.date;const p=await center(right);await drag(right,{x:p.x+85,y:p.y},true);await page.waitForTimeout(900);assert.deepEqual(record(await state()).values.date,initial);
    await drag(right,{x:p.x+85,y:p.y});const w=await settled(w=>record(w).values.date.end!==initial.end);assert.ok(record(w).values.date.end.endsWith("T17:45:00"));
    const before=record(w).values.date.start;await bars.locator(".db-timeline-resize-start").press("ArrowLeft");const v=await settled(w=>record(w).values.date.start!==before);assert.ok(record(v).values.date.start.endsWith("T09:15:00"));await shot("timeline");
    return {quarter,day,date:record(v).values.date,locked:disabled.length};
  });
  await check("timeline-independent-fields",async()=>{
    await select("timeline");
    let panel=await openViewSettingsSection(db,"布局");
    await panel.getByLabel("时间线结束日期属性").selectOption("finish-field");await close();
    const scale=db.getByLabel("时间线比例",{exact:true});
    await scale.selectOption("year");const years=await ac(".db-timeline-axis time").allTextContents();assert.ok(years.length>5 && years.every(y=>y.endsWith("年")));
    await scale.selectOption("hour");
    const jump=db.getByLabel("定位时间线日期");await jump.fill("2026-11-03");await jump.press("Tab");
    const bar=ac('.db-timeline-bar[data-item-id="i-teach-2"]');await bar.waitFor();const ticks=await ac(".db-timeline-axis time").allTextContents();
    const initial=record(await state()).values;assert.ok(ticks.includes("12:00"));
    await bar.getByRole("button",{name:/后移一小时/}).click();
    const moved=record(await settled(w=>record(w).values.date.start==="2026-11-03T10:15:00")).values;
    assert.equal(moved.date.end,initial.date.end);assert.equal(moved["finish-field"].start,"2026-11-03T19:45:00");assert.equal(moved["finish-field"].end,initial["finish-field"].end);
    const geometryBefore=await bar.getAttribute("style");
    await bar.locator(".db-timeline-resize").press("ArrowLeft");
    const adjusted=record(await settled(w=>record(w).values["finish-field"].start==="2026-11-03T18:45:00")).values;
    assert.deepEqual(adjusted.date,moved.date);assert.equal(adjusted["finish-field"].end,initial["finish-field"].end);assert.notEqual(await bar.getAttribute("style"),geometryBefore);
    await shot("timeline-hour");
    return {yearTicks:years,hourTicks:ticks,start:adjusted.date,finish:adjusted["finish-field"]};
  });
  await check("table",async()=>{
    await select("table");const panel=await openViewSettingsSection(db,"分组");await panel.getByLabel("一级分组").selectOption("status");await close();
    const sections=await ac("tr.db-table-group").allTextContents();assert.ok(sections.length===3);
    const row=ac('tr[data-item-id="i-teach-2"]');await row.getByRole("checkbox",{name:/^选择 /}).check();
    await row.locator('[data-property-id="hours"] button').click();const input=page.locator(".db-table-number-popover input");await input.fill("19");await input.press("Enter");await settled(w=>record(w).values.hours===19);assert.ok(await row.getByRole("checkbox",{name:/^选择 /}).isChecked());await shot("table");
    return {sections,selected:true,hours:19};
  });
  await check("board",async()=>{
    await select("board");const panel=await openViewSettingsSection(db,"子分组");await panel.getByLabel("二级分组").selectOption("grade");await close();
    const card=ac('.db-board-card[data-item-id="i-teach-2"]').first();const lane=ac('.db-board-column[data-group-key="todo"] .db-board-lane[data-subgroup-key="g1"]');
    await card.hover();await drag(card.locator(".db-drag-handle"),await center(lane.locator("h4")));await settled(w=>record(w).values.status==="todo"&&record(w).values.grade==="g1");
    await card.hover();await card.getByRole("button",{name:/记录操作/}).click();await page.getByLabel(/移动 .* 到子分组/).selectOption("g3");const w=await settled(w=>record(w).values.grade==="g3");
    assert.equal(record(w).values.status,"todo");const heights=await ac('.db-board-lane[data-subgroup-key="g2"] h4').evaluateAll(es=>es.map(el=>Math.round(el.getBoundingClientRect().top)));assert.equal(new Set(heights).size,1);await shot("board");return {status:"todo",grade:"g3",laneCount:await ac(".db-board-lane").count()};
  });
  await check("gallery",async()=>{
    await select("gallery");const cards=ac(".db-gallery-card");const order=()=>cards.evaluateAll(es=>es.map(e=>e.dataset.itemId));
    const before=await order();await cards.nth(2).dragTo(cards.first());const after=await order();assert.notDeepEqual(after,before);
    const card=ac('.db-gallery-card[data-item-id="i-teach-2"]');const image=card.locator('.db-gallery-preview img');await image.evaluate(img=>img.decode());
    await card.locator("summary").click();const horizontal=card.getByLabel("图片水平位置");await horizontal.focus();await horizontal.press("Home");const input=card.getByLabel("图片垂直位置");await input.focus();await input.press("End");assert.match(await card.locator(".db-gallery-preview").evaluate(e=>e.style.backgroundPosition),/100%/);
    await card.getByRole("button",{name:"后移一张"}).click();await card.locator("summary").click();
    const expected=await order();assert.notDeepEqual(expected,before);
    let panel=await openViewSettingsSection(db,"排序");await panel.getByRole("button",{name:"+ 添加排序"}).click();await close();
    assert.ok(await db.getByText("已按属性排序。关闭排序后可拖动卡片。").isVisible());assert.equal(await cards.first().getAttribute("draggable"),"false");
    panel=await openViewSettingsSection(db,"排序");await panel.getByLabel("删除排序 1").click();await close();assert.deepEqual(await order(),expected);
    const w=await settled(w=>view(w,"gallery").config.gallery.imagePositions?.[id]?.y===100 && view(w,"gallery").config.gallery.imagePositions[id].x===0 && !view(w,"gallery").sorts.length && JSON.stringify(view(w,"gallery").config.gallery.manualOrder)===JSON.stringify(expected));await shot("gallery");
    return {before,after,stored:view(w,"gallery").config.gallery.manualOrder,position:{x:0,y:100}};
  });
  await check("reopen",async()=>{
    await ctx.close();ctx=await launch();await open();const w=await state();
    await select("board");assert.ok(await ac('.db-board-column[data-group-key="todo"] .db-board-lane[data-subgroup-key="g3"] [data-item-id="i-teach-2"]').isVisible());
    await select("table");assert.equal(await ac("tr.db-table-group").count(),3);
    assert.equal(view(w,"timeline").config.timeline.endDatePropertyId,"finish-field");assert.equal(view(w,"timeline").config.timeline.scale,"hour");assert.equal(record(w).values["finish-field"].start,"2026-11-03T18:45:00");
    await select("gallery");const order=await ac(".db-gallery-card").evaluateAll(es=>es.map(e=>e.dataset.itemId));assert.deepEqual(order,view(w,"gallery").config.gallery.manualOrder);
    assert.match(await ac('.db-gallery-card[data-item-id="i-teach-2"] .db-gallery-preview').evaluate(e=>e.style.backgroundPosition),/100%/);
    return {date:record(w).values.date,hours:record(w).values.hours,calendarIcons:view(w,"calendar").config.showPageIcon,galleryOrder:order};
  });
}finally{await ctx.close();}
