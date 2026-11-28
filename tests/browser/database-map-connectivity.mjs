import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const parent = process.env.LA_MAP_QA_ROOT || tmpdir();
mkdirSync(parent, { recursive: true });
const run = mkdtempSync(path.join(parent, "database-map-connectivity-"));
const temp = path.join(run, "temp");
mkdirSync(temp);
const proof = { startedAt: new Date().toISOString(), checks: [], requests: [] };
const save = () => writeFileSync(path.join(run, "proof.json"), JSON.stringify(proof, null, 2));
console.log(path.join(run, "proof.json"));
const fixture = [
  'import React from "react";',
  'import { createRoot } from "react-dom/client";',
  'import { DatabaseMap } from "./src/components/DatabaseMap.jsx";',
  'import "./src/ui/themes/mobai/database-map-search.css";',
  'const source={id:"map-source",properties:[{id:"title",type:"title"},{id:"place",type:"place"}]};',
  'const item={id:"local",sourceId:source.id,pageId:"map-record-page",values:{title:"Local marker",place:{latitude:30,longitude:104,name:"Local place"}}};',
  'const workspace={dataSources:[source],databaseItems:[item],pages:[]};',
  'const view={id:"map-view",sourceId:source.id,type:"map",config:{map:{layer:"street",placePropertyId:"place",center:[104,30],tileZoom:5}}};',
  'window.observed={searches:[],cancels:[],tiles:[],tileErrors:[],saves:[],opened:[],pending:new Map()};',
  'const observed=window.observed;',
  'window.lifeAtlas={databaseMap:{',
  'tile:async ({layer,z,x,y})=>{observed.tiles.push([layer,z,x,y]);if(observed.noCoverage){observed.tileErrors.push({layer,code:"E_NOT_FOUND"});return {ok:false,error:{code:"E_NOT_FOUND"}};}return {ok:true,value:{dataUrl:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/5WQAAAAASUVORK5CYII="}};},',
  'cancelTile:async()=>{},',
  'search:({query,requestId})=>new Promise(resolve=>{observed.searches.push({query,requestId});observed.pending.set(query,resolve);}),',
  'cancelSearch:async({requestId})=>{observed.cancels.push(requestId);}',
  '}};',
  'createRoot(document.querySelector("#root")).render(React.createElement(DatabaseMap,{workspace,source,view,items:[item],onUpdateView:(id,update)=>observed.saves.push(update.config.map),onOpenItemPage:id=>observed.opened.push(id)}));',
].join("\n");
await build({ absWorkingDir: repo, stdin: {contents:fixture,resolveDir:repo,sourcefile:"map-connectivity.jsx",loader:"jsx"},
  bundle:true, jsx:"automatic", define:{"process.env.NODE_ENV":'"production"'}, outfile:path.join(run,"map.js"),
  loader:{".png":"dataurl"}, logLevel:"silent" });
const entry=path.join(run,"map.html");
writeFileSync(entry,'<!doctype html><html lang="zh"><meta charset="utf-8"><link rel="stylesheet" href="map.css"><style>.db-geographic-canvas{height:400px;width:760px}</style><div id="root"></div><script src="map.js"></script></html>');
const env={...process.env,TEMP:temp,TMP:temp};
const browser=await chromium.launchPersistentContext(path.join(run,"profile"),{channel:"msedge",headless:true,env,
  args:["--disable-background-networking"],viewport:{width:1100,height:800},acceptDownloads:false});
try{
  const page=await browser.newPage();
  page.setDefaultTimeout(5000);
  page.on("pageerror",err=>(proof.pageErrors??=[]).push(err.message));
  await browser.route(/^https?:\/\//,route=>{proof.requests.push(route.request().url());return route.abort();});
  await page.goto(pathToFileURL(entry).href);
  const map=page.getByRole("region",{name:"数据库地点地图"});
  const search=map.getByRole("searchbox");
  const searchBtn=map.getByRole("button",{name:"查找地点"});
  const submit=async term=>{await search.fill(term);await searchBtn.click();};
  const finish=async(query,name)=>page.evaluate(({query,name})=>window.observed.pending.get(query)({ok:true,value:{places:[{id:query,name,address:"Example",point:[35,110]}]}}),{query,name});
  const state=()=>page.evaluate(()=>({online:navigator.onLine,searches:window.observed.searches,cancels:window.observed.cancels,
    tiles:window.observed.tiles.length,saves:window.observed.saves,opened:window.observed.opened,
    layer:document.querySelector("[data-map-layer]").dataset.mapLayer,zoom:document.querySelector("[data-map-zoom]").dataset.mapZoom,
    markers:document.querySelectorAll(".leaflet-interactive[aria-label], .leaflet-marker-icon[aria-label]").length,
    ready:Number(document.querySelector("[data-tile-ready]").dataset.tileReady)}));
  await page.waitForFunction(()=>Number(document.querySelector("[data-tile-ready]")?.dataset.tileReady)>0);
  await submit("First search");
  await page.waitForFunction(()=>window.observed.searches.length===1);
  const before=await state();
  assert.ok(before.ready>0);
  proof.before=before;save();
  await browser.setOffline(true);
  await page.waitForFunction(()=>navigator.onLine===false);
  await page.waitForFunction(()=>document.querySelector("input[type=search]").placeholder.includes("经纬度")&&!document.querySelector("input[type=search]").placeholder.includes("地点"));
  await submit("Offline search");
  assert.match(await map.locator(".db-map-search [role=status]").innerText(),/联网|网络连接/);
  const offline=await state();proof.offline=offline;save();
  assert.deepEqual(offline.searches,before.searches);
  assert.deepEqual(offline.cancels,[before.searches[0].requestId]);
  for(const key of ["tiles","saves","layer","zoom","ready","markers"])assert.deepEqual(offline[key],before[key],key);
  proof.checks.push("offline street search blocked before bridge; pending call cancelled; cached tiles and viewport retained");
  await submit("30.25, 103.5");
  await page.waitForFunction(()=>window.observed.saves.some(s=>Math.abs(s.center[0]-103.5)<.001&&Math.abs(s.center[1]-30.25)<.001));
  await map.getByRole("button",{name:"居中到 Local marker"}).click();
  await map.getByRole("button",{name:"打开记录",exact:true}).click();
  assert.deepEqual((await state()).opened,["map-record-page"]);
  assert.equal((await state()).searches.length,1);
  proof.checks.push("coordinates and stored marker navigate without a geocode");
  await browser.setOffline(false);
  await page.waitForFunction(()=>navigator.onLine && document.querySelector("input[type=search]").placeholder.includes("地点"));
  await submit("Second search");
  await page.waitForFunction(()=>window.observed.searches.length===2);
  await finish("First search","Stale response");
  await finish("Second search","Current response");
  await map.getByRole("button",{name:/Current response/}).waitFor();
  assert.equal(await map.getByRole("button",{name:/Stale response/}).count(),0);
  proof.checks.push("reconnected search returns only the new request");
  await search.press("Escape");
  await page.evaluate(()=>{window.observed.noCoverage=true;});
  await map.getByRole("button",{name:"卫星",exact:true}).click();
  await page.waitForFunction(()=>window.observed.tileErrors.some(e=>e.layer==="satellite"&&e.code==="E_NOT_FOUND"));
  await submit("No tile coverage");
  await page.waitForFunction(()=>window.observed.searches.length===3);
  await finish("No tile coverage","Search works independently");
  await map.getByRole("button",{name:/Search works independently/}).waitFor();
  proof.checks.push("online geocoding survives independent map provider no-coverage responses");
  await browser.setOffline(true);
  await page.reload();
  await page.waitForFunction(()=>!navigator.onLine && document.querySelector("input[type=search]")?.placeholder.includes("经纬度"));
  await submit("Offline at first render");
  assert.match(await map.locator(".db-map-search [role=status]").innerText(),/联网|网络连接/);
  assert.equal((await state()).searches.length,0);
  proof.checks.push("newly mounted saved street layer recognizes an already disconnected device");
  assert.deepEqual(proof.pageErrors??[],[]);
  assert.deepEqual(proof.requests,[]);
  proof.status="passed";
}catch(error){proof.status="failed";proof.error=error.stack;const tab=browser.pages().at(-1);proof.body=await tab?.locator("body").innerText().catch(()=>null);proof.pageState=await tab?.evaluate(()=>({tiles:window.observed?.tiles?.slice(-4),tileErrors:window.observed?.tileErrors?.slice(-4),saves:window.observed?.saves?.slice(-2)})).catch(()=>null);process.exitCode=1;}
finally{await browser.close();proof.finishedAt=new Date().toISOString();save();}
