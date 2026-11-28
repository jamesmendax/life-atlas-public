import test from "node:test";
import assert from "node:assert/strict";
import { buildTripShare } from "../src/editor/widgets/trip-data/routeShare.js";
import { amapEmbeddedRoute } from "../src/editor/widgets/trip-data/amapLinks.js";
import { buildAmapPersonalMapArgs } from "../src/domain/amapPersonalMap.js";

const domestic = [
  { name: "熊猫基地", point: [30.73335,104.14409], time: "09:15" },
  { name: "春熙路", point: [30.65445,104.08156], time: "11:20" },
  { name: "宽窄,巷子|北;门", point: [30.66697,104.05089], time: "15:30" },
  { name: "玉林路", point: [30.61979,104.04458], time: "18:40" },
];
const share = (stops, provider = "amap", mode = "drive") =>
  buildTripShare({ day: { day: 2, title: "成都 <&> 行程", stops }, date: "2026-11-25", provider, mode });

test("the travel plan copies a complete AMap link separately from readable dwell and lodging", () => {
  const day = { day: 1, title: "成都", lodging: "今晚的酒店", stops: domestic.map((stop) => ({ ...stop, dwellMinutes: 30 })) };
  const transit = buildTripShare({ day, mode: "transit" });
  assert.equal(transit.shareLinks.length, 1);
  assert.equal(new URL(transit.shareLinks[0].url).searchParams.get("markers").split("|").length, 4);
  const driving = buildTripShare({ day, mode: "drive" });
  assert.equal(driving.shareLinks.length, 1);
  assert.equal(new URL(driving.shareLinks[0].url).searchParams.get("via").split(";").length, 2);
  assert.match(transit.plan, /1\. 09:15 熊猫基地 · 停留 30 分钟/);
  assert.match(transit.plan, /当晚住宿 · 今晚的酒店/);
  assert.doesNotMatch(transit.plan, /https?:/);
});

test("an AMap redirect preserves later stops when a label contains query delimiters", () => {
  const name = "巷子 & 公园 #1+2%";
  const out = share([domestic[0], { ...domestic[1], name }, domestic[2]], "amap", "transit");
  const markers = new URL(out.shareLinks[0].url).searchParams.get("markers");
  const afterRedirect = new URL("https://ditu.amap.com/marker?markers=" + markers).searchParams.get("markers");
  assert.equal(afterRedirect.split("|").length, 3);
  assert.match(afterRedirect, /巷子 ＆ 公园 ＃1＋2％/);
  assert.ok(out.plan.includes(name));
});

test("AMap supports a full-day desktop multistop route, named map and separate mobile links", () => {
  const out = share(domestic), markers = new URL(out.links[0].url);
  assert.deepEqual(markers.searchParams.get("markers").split("|").map((marker) => marker.split(",").length), [3,3,3,3]);
  assert.match(markers.searchParams.get("markers"), /104\.084096,30\.652049,2\. 11:20 春熙路/);
  const url = new URL(out.links[1].url);
  assert.equal(url.pathname, "/ssr/embed/dir"); assert.equal(url.searchParams.get("platform"), "pc");
  assert.equal(url.searchParams.get("via"), "104.084096,30.652049,春熙路;104.05337,30.664531,宽窄，巷子｜北；门");
  assert.ok(out.links.every((l) => new URL(l.url).protocol === "https:"));
  const mobile = out.mobileLinks.map((l) => new URL(l.url));
  assert.deepEqual(mobile.map((u) => u.protocol), ["iosamap:", "amapuri:"]);
  for (const u of mobile) { assert.equal(u.searchParams.get("vian"), "2"); assert.equal(u.searchParams.get("dev"), "0"); }
  for (const [i,s] of domestic.entries()) assert.ok(out.text.includes((i+1) + ". " + s.time + " " + s.name));
  assert.equal(share(domestic,"amap","transit").links.filter((l)=>l.url.includes("embed/dir")).length, 3);
});

test("unknown domestic WGS84 points use the converting single-marker link and missing points search by name", () => {
  const sh = { name: "上海 A&B", point: [31.23,121.47], time: "10:50" }, missing = { name: "还没选点", time: "12:10" };
  const out = share([sh,missing]);
  const [pin,search] = out.links.map((v)=>new URL(v.url));
  assert.equal(pin.searchParams.get("coordinate"),"wgs84"); assert.equal(pin.searchParams.get("position"),"121.47,31.23");
  assert.equal(search.searchParams.get("keyword"),missing.name);
  assert.equal(amapEmbeddedRoute("drive",sh,domestic[0]),null);
  assert.equal(amapEmbeddedRoute("drive",domestic[0],{name:"日本",point:[34.9,135.7]}),null);
  assert.ok(out.text.includes("2. 12:10 还没选点"));
  assert.equal(share([missing]).file,null);
  assert.equal(share([]).links.length,0);
  const single = share([{ ...sh, amap: { location: [121.475,31.228], poiId:"SYNTHETIC" } }, domestic[1]]);
  assert.match(new URL(single.links[0].url).searchParams.get("markers"),/^121\.475,31\.228,/);
});

test("overseas AMap marker batches preserve numbered stops without inventing a local route", () => {
  const stops=Array.from({length:12},(_,i)=>({name:"京都 "+i,time:"08:00",point:[35+i/100,135.75]}));
  const out=share(stops);
  assert.deepEqual(out.links.map((v)=>new URL(v.url).searchParams.get("markers").split("|").length),[10,2]);
  assert.deepEqual(out.mobileLinks,[]);
  const southeast=share([{name:"曼谷",point:[13.7563,100.5018]}, {name:"新加坡",point:[1.3521,103.8198]}]);
  assert.match(new URL(southeast.links[0].url).searchParams.get("markers"),/100\.5018,13\.7563/);
  const taipei=share([{ name:"台北",point:[25.033,121.5654] }, domestic[0]]);
  assert.equal(new URL(taipei.links[0].url).searchParams.get("coordinate"),"wgs84");
});

test("Google and Apple preserve repeated stops, unlocated named stops and every leg across URL limits", () => {
  const stops=Array.from({length:18},(_,i)=>({name:"地点 "+i,point:i%3?[35+i/100,135.75]:null,time:"08:00"}));
  for (const provider of ["apple","google"]) {
    for (const mode of ["drive","transit"]) {
      const out=share(stops,provider,mode), all=[];
      for (const l of out.links) {
        const u=new URL(l.url), apple=provider==="apple";
        const middle=apple?u.searchParams.getAll("waypoint"):(u.searchParams.get("waypoints")||"").split("|").filter(Boolean);
        const row=[u.searchParams.get(apple?"source":"origin"),...middle,u.searchParams.get("destination")];
        if (all.length) assert.equal(all.at(-1),row.shift());
        all.push(...row);
        assert.ok(u.href.length<=2048);
        if (mode==="transit") assert.equal(middle.length,0);
        if (!apple) assert.ok(middle.length<=3);
      }
      assert.deepEqual(all,stops.map((s)=>s.point?.join(",")||s.name));
    }
  }
});

test("KML preserves text, escapes markup, exports longitude first and breaks the line at unlocated stops", () => {
  const out=share([{...domestic[0],name:"<&\"熊猫"},domestic[1],{name:"待定位"},domestic[2]]);
  assert.match(out.file.content,/1\. 09:15 &lt;&amp;&quot;熊猫/);
  assert.match(out.file.content,/<coordinates>104\.14409,30\.73335 104\.08156,30\.65445<\/coordinates>/);
  assert.equal(out.file.content.split("<LineString>").length-1,1);
  assert.match(out.file.content,/站点顺序连线（非道路轨迹）/);
  assert.match(out.file.content,/待定位/); assert.doesNotMatch(out.file.filename,/[<>:"/\\|?*]/u);
});

test("personal-map arguments use confirmed POI IDs and AMap coordinates, and never guess missing POIs", () => {
  assert.throws(()=>buildAmapPersonalMapArgs({day:{stops:domestic}}),/熊猫基地/);
  const day={day:1,date:"2026-11-25",title:"成都",stops:[{...domestic[0],amap:{poiId:"SYNTHETIC_A",location:[104.146603,30.73095]}}]};
  const args=buildAmapPersonalMapArgs({day});
  assert.equal(args.orgName,"第 1 天 · 成都"); assert.match(args.lineList[0].title,/2026-11-25.*09:15/);
  assert.deepEqual(args.lineList[0].pointInfoList,[{name:"熊猫基地",lon:104.146603,lat:30.73095,poiId:"SYNTHETIC_A"}]);
});
