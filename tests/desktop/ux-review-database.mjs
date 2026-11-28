import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { upgradeWorkspace } from "../../src/persistence/migrations.js";
import { createDatabaseView } from "../../src/domain/database.js";
import { createDatabaseTemplate } from "../../src/domain/templates.js";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { createIsolatedDirectory, openPageInSidebar, REPO_ROOT, seedWorkspaceDatabase } from "./helpers.mjs";
import { closeAppGracefully, logEvents, readWorkspaceState, startApp, waitFor } from "../release/helpers.mjs";
import { chooseSavedView } from "../browser/database-navigation.mjs";
import { databasePaths } from "./ux-review-database-paths.mjs";
import { databaseMenuPaths, databaseRepairPaths } from "./ux-review-database-menus.mjs";
import { databaseDetailPaths } from "./ux-review-database-details.mjs";

const runFile = promisify(execFile);
const suite = process.env.LIFE_ATLAS_UX_DB_SUITE || "base";
assert.ok(["base", "menus", "repair", "details"].includes(suite), "Unknown database UX suite: " + suite);
await fs.mkdir(path.join(REPO_ROOT, ".qa"), { recursive: true });
const directory = await fs.mkdtemp(path.join(REPO_ROOT, ".qa", "ux-review-database-"));
const exe = path.join(REPO_ROOT, "release/release/win-unpacked/Life Atlas.exe");
const asar = createHash("sha256").update(await fs.readFile(path.join(path.dirname(exe), "resources/app.asar"))).digest("hex");
if (process.env.LIFE_ATLAS_UX_DB_EXPECTED_ASAR) assert.equal(asar, process.env.LIFE_ATLAS_UX_DB_EXPECTED_ASAR, "The packaged resources changed before this scenario");
const report = { executable: exe, asar, suite, startedAt: new Date().toISOString(), runs: [], completed: false };
const write = () => fs.writeFile(path.join(directory, "database.json"), JSON.stringify(report, null, 2));
const types = ["table", "board", "list", "gallery", "calendar", "timeline", "chart", "form", "dashboard", "map", "roadmap"];
const purposes = {table:"表格",board:"看板",list:"列表",gallery:"画廊",calendar:"日历",timeline:"时间线",chart:"图表",form:"表单",dashboard:"仪表盘",map:"地图",roadmap:"时间脉络"};
function fixture(theme) {
  const data = coreParityWorkspace();
  const source = data.dataSources.find(s => s.id === "projects");
  data.databaseViews.push(createDatabaseView({id:"view-roadmap",sourceId:"projects",name:"时间脉络",type:"roadmap",config:{roadmap:{datePropertyId:"date",titlePropertyId:"title"}}}));
  for (const view of data.databaseViews) {
    view.name = purposes[view.type];
    view.config = {...view.config,openRecordsIn:"peek"};
    if (view.type === "calendar") view.config.calendar = {...view.config.calendar, anchorDate:"2026-09-18", datePropertyId:"date"};
    if (view.type === "form") view.config.form = {...view.config.form, fields:source.properties.filter(p=>!["formula","rollup"].includes(p.type)).map(p=>({propertyId:p.id,required:p.id==="title",hidden:!["title","notes","checked"].includes(p.id)}))};
  }
  const db = data.pages.find(p => p.id === "database-page");
  db.databaseViewId = "view-table";
  db.content = [{id:"ux-database",type:"databaseView",props:{sourceId:"projects",viewId:"view-table",viewIdsJson:JSON.stringify(types.map(t=>"view-"+t))}}];
  const alpha = data.databaseItems.find(i => i.id === "alpha");
  const alphaPage = data.pages.find(p=>p.id===alpha.pageId);
  for (let n=1;n<=24;n++) {
    const suffix = String(n).padStart(2,"0");
    const id = "ux-"+suffix, pageId = id+"-page", title = "现场记录 "+suffix;
    data.databaseItems.push({...alpha,id,pageId, values:{title,status:["todo","doing","done"][n%3],amount:n,notes:"模拟记录 "+suffix,checked:false}});
    data.pages.push({...alphaPage,id:pageId,title,content:[{id:id+"-p",type:"paragraph",content:title+" 正文"}]});
    alphaPage.content.push({id:"alpha-more-"+suffix,type:"paragraph",content:"第 "+suffix+" 段  长记录滚动与编辑检查。".repeat(5)});
  }
  data.ui.preferences={style:"mobai",theme};
  data.ui.selectedPageId=db.id;
  if (suite === "menus") {
    data.databaseTemplates = [createDatabaseTemplate(source.id, {
      id: "ux-template",
      name: "走查记录模板",
      defaultValues: { title: "来自走查模板", amount: 752, notes: "模板说明" },
      pageContent: [{ id: "ux-template-text", type: "paragraph", content: "隔离模板正文" }],
    })];
  }
  if (suite === "details") {
    source.properties.push({id:"ux-marker", type:"select", name:"节点形状", options:[{id:"m1", name:"重点", color:"blue"}], config:{}});
    alpha.values["ux-marker"]="m1";
    alphaPage.cover={kind:"gallery", value:"hokusai-landscape", position:50};
  }
  return upgradeWorkspace(data);
}
const selected = process.env.LIFE_ATLAS_UX_DB_CASES?.split(",").filter(Boolean);
const selectCase = id => !selected || selected.includes(id);
const themes = process.env.LIFE_ATLAS_UX_DB_THEME ? [process.env.LIFE_ATLAS_UX_DB_THEME] : ["light","dark"];
const python = process.env.LIFE_ATLAS_RELEASE_PYTHON || process.env.LIFE_ATLAS_GUARD_PYTHON ||
  (process.env.UV_PYTHON_INSTALL_DIR && path.join(process.env.UV_PYTHON_INSTALL_DIR, "cpython-3.13.14-windows-x86_64-none", "python.exe"));
assert.ok(python && path.isAbsolute(python), "Set LIFE_ATLAS_RELEASE_PYTHON to an absolute 64-bit Windows Python path.");
function inventory(node) {
  const rect = el => {
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return [box.x,box.y,box.width,box.height].map(n=>Math.round(n));
  };
  const entries = [...node.querySelectorAll(".db-view-actions > button,.db-v9-new-group button,.db-view-tabs button[role=tab],.db-more-views")].filter(b=>b.getClientRects().length);
  return { width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.theme,
    view:node.dataset.viewType, DB:rect(node), toolbar:rect(node.querySelector(".db-navigation-row")),
    documentWidth:document.documentElement.scrollWidth, contentWidth:document.documentElement.clientWidth,
    controls:entries.map(el=>({name:el.getAttribute("aria-label")||el.title||el.textContent.trim(),rect:rect(el)})),
    body:node.querySelector(".db-view-body")?.firstElementChild?.className,
    parentBlock:node.closest("[data-id]")?.getAttribute("data-id"),
  };
}
async function walkthrough(theme) {
  const profile=createIsolatedDirectory("ux-review-database-"+theme);
  const workspace=fixture(theme);
  await seedWorkspaceDatabase(profile,workspace);
  const output={theme,profile,checks:[],errors:[],windows:[],finished:false,closed:false};
  report.runs.push(output);
  const child=startApp(exe,profile,{args:["--remote-debugging-address=127.0.0.1","--remote-debugging-port=0"]});
  let browser,page;
  try {
    const ws=await waitFor(()=>child.releaseOutput.stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[\w-]+)/u)?.[1],{timeoutMs:25000});
    browser=await chromium.connectOverCDP(ws, {noDefaults:true});
    page=await waitFor(()=>browser.contexts()[0].pages().find(p=>p.url()==="app://bundle/index.html"),{timeoutMs:25000});
    page.setDefaultTimeout(4200);
    await page.locator('html[data-la-ready][data-theme="'+theme+'"]').waitFor();
    const info=(await page.evaluate(()=>window.lifeAtlas.app.getInfo())).value;
    const owned=await child.releaseOwnershipReady;
    assert.ok(info.isPackaged && info.flavor==="release");
    assert.equal(path.resolve(info.dataRoot),profile);
    assert.equal(path.resolve(owned.executablePath),exe);
    output.pid=owned.mainPid;
    page.on("pageerror",e=>output.errors.push(e.message));
    await page.bringToFront();
    await openPageInSidebar(page,"项目数据库");
    const db=page.locator('section.database-view[data-source-id="projects"]');
    const frame=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
    const focus=()=>page.evaluate(()=>{const e=document.activeElement;return {tag:e?.tagName,name:e?.getAttribute("aria-label"),class:e?.className,visible:e?.matches(":focus-visible")};});
    const saved=()=>page.evaluate(async()=>(await window.lifeAtlas.workspace.load()).value.workspace);
    const until=(fn,detail)=>waitFor(fn,{timeoutMs:4000,intervalMs:80,message:detail});
    const persist=fn=>until(async()=>{const state=await saved();return fn(state)&&state;});
    const nav=async type=>{await chooseSavedView(db,"view-"+type);await page.locator('section.database-view[data-source-id="projects"][data-view-type="'+type+'"]').waitFor();await frame();};
    let size;
    const sizeTo=async mode=>{
      const result=await runFile(python,["-I","-B",path.join(REPO_ROOT,"tests/desktop/ux-review-database-window.py"),String(owned.mainPid),mode,await page.title()],{windowsHide:true,timeout:6000});
      const native=JSON.parse(result.stdout);
      await frame();
      const css=await page.evaluate(()=>({inner:[innerWidth,innerHeight],outer:[outerWidth,outerHeight],dpr:devicePixelRatio}));
      size=mode;
      output.windows.push({size,...native,...css});
      assert.equal(native.maximized,size==="large");
      return css;
    };
    const recover=async()=>{
      await page.keyboard.press("Escape").catch(()=>{});
      const dialog=page.locator(".record-peek button[aria-label='关闭预览']");
      if(await dialog.isVisible().catch(()=>false)) await dialog.click().catch(()=>{});
      await page.reload({waitUntil:"domcontentloaded"});
      await page.locator("html[data-la-ready]").waitFor();
      await openPageInSidebar(page,"项目数据库");
      await db.waitFor();
    };
    const check=async(id,summary,fn)=>{
      if(!selectCase(id)) return;
      const item={id,summary,theme,size,pass:false};
      output.checks.push(item);
      const shot=theme+"-"+size+"-"+id+(id==="layouts"?"-"+output.checks.length:"")+".png";
      try {
        item.observed=await fn();
        await frame();
        item.focus=await focus();
        item.pass=true;
      } catch(error) {
        item.error=error.message.split("\n").slice(0,10).join("\n");
        item.focus=await focus().catch(()=>null);
        item.dialogs=await page.locator('[role="dialog"]:visible,.record-peek.is-side:visible').evaluateAll(ns=>ns.map(n=>n.getAttribute("aria-label"))).catch(()=>[]);
      }
      if(item.pass && item.observed?.screenshot) item.screenshot=item.observed.screenshot;
      else await page.screenshot({path:path.join(directory,shot),animations:"disabled"}).then(()=>{item.screenshot=shot;});
      console.log(theme,size,item.pass?"PASS":"REVIEW",id,item.error?.slice(0,135)||"");
      await write();
      if(!item.pass) await recover();
    };
    const primary=theme==="light"?"large":"small";
    const alternate=theme==="light"?"small":"large";
    if (suite === "base" && selectCase("layouts")) {
      for(const mode of [alternate,primary]){
        await sizeTo(mode);
        for(const type of types) {
          await check("layouts",purposes[type]+"入口和操作栏",async()=>{
            await nav(type);
            await db.locator(".db-navigation-row").scrollIntoViewIfNeeded();
            const capture=await db.evaluate(inventory);
            const file=theme+"-"+mode+"-view-"+type+".png";
            await page.screenshot({path:path.join(directory,file),animations:"disabled"});
            assert.equal(capture.parentBlock,"ux-database");
            assert.ok(capture.body,"view must contain its working surface");
            assert.ok(capture.documentWidth<=capture.contentWidth+1,"document width "+capture.documentWidth+" > "+capture.contentWidth);
            return {...capture,screenshot:file};
          });
        }
      }
      assert.notDeepEqual(output.windows[0].inner,output.windows[1].inner);
    } else if (suite !== "repair") await sizeTo(primary);
    const nativeFile = async (mode, target, trigger) => {
      const helper = runFile(python, ["-I", "-B", path.join(REPO_ROOT,"tests/desktop/ux-review-database-file-dialog.py"), String(owned.mainPid), mode, target], {windowsHide:true,timeout:16000});
      const [response] = await Promise.all([helper, trigger()]);
      return JSON.parse(response.stdout);
    };
    const activateApp = async () => {
      const result=await runFile(python,["-I","-B",path.join(REPO_ROOT,"tests/desktop/ux-review-database-window.py"),String(owned.mainPid),"foreground",await page.title()],{windowsHide:true,timeout:6000});
      return JSON.parse(result.stdout);
    };
    const context = {page,db,check,nav,frame,focus,persist,saved,until,theme,profile,nativeFile,activateApp,openDb:()=>openPageInSidebar(page,"项目数据库"),file:label=>path.join(directory,theme+"-"+label+".png")};
    if (suite === "base") await databasePaths(context);
    if (suite === "menus") await databaseMenuPaths(context);
    if (suite === "details") await databaseDetailPaths(context);
    if (suite === "repair") {
      for (const mode of [alternate, primary]) {
        await sizeTo(mode);
        await databaseRepairPaths(context);
      }
    }
    output.finished=true;
  } catch(e) {
    output.fatal=e.stack;throw e;
  } finally {
    if(page&&!page.isClosed()) await page.evaluate(()=>{setTimeout(()=>window.close(),0);}).catch(()=>{});
    await waitFor(()=>child.releaseClosed,{timeoutMs:7000}).catch(()=>{});
    try {
      await closeAppGracefully(child);
      output.closed=child.exitCode===0 && logEvents(profile).some(e=>e.event==="app.quit"&&Date.parse(e.at)>=child.releaseSpawnedAt);
      const {entities}=readWorkspaceState(profile);
      output.closedDatabase={blocks:entities.pages["database-page"].content.map(b=>[b.id,b.type]),sourceCount:Object.keys(entities.dataSources).length,rows:Object.values(entities.databaseItems).filter(r=>r.sourceId==="projects").length,alpha:entities.databaseItems.alpha.values,date:entities.databaseItems.alpha.values.date,views:Object.values(entities.databaseViews).filter(v=>v.sourceId==="projects").map(v=>v.id)};
      assert.deepEqual(output.closedDatabase.blocks,[["ux-database","databaseView"]]);
    } finally {await browser?.close().catch(()=>{});await write();}
  }
}
console.log("DATABASE_UX_EVIDENCE",directory);
try { for(const theme of themes) await walkthrough(theme);report.completed=true; }
finally {
  report.finishedAt=new Date().toISOString();await write();
  const issues=report.runs.flatMap(r=>r.checks.filter(c=>!c.pass).map(c=>[r.theme,c.id]));
  console.log("DATABASE_UX",report.completed,JSON.stringify(issues),directory);
  if(issues.length||report.runs.some(r=>r.errors.length||!r.closed))process.exitCode=1;
}
