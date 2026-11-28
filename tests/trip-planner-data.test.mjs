import assert from "node:assert/strict";
import test from "node:test";
import { searchTripPlaces } from "../src/editor/widgets/trip-data/placeSearch.js";
import { planChengduTransit } from "../src/editor/widgets/trip-data/chengduTransit.js";
import { knownPlaces } from "../src/editor/widgets/trip-data/itineraryState.js";
import { amapSearchResults, amapTransitLeg, fromAmapPoint, toAmapPoint } from "../src/domain/transitProviders.js";
import { decodeLine } from "../src/domain/tripRoutes.js";
import { registerTripRoutesIpc } from "../electron/main/ipc/tripRoutes.js";

const event={ sender:{id:1,mainFrame:{processId:2,routingId:3}},senderFrame:{processId:2,routingId:3}};
event.senderFrame=event.sender.mainFrame;
function ipc(fetchRoute, extra={}) {
  const handlers=new Map();
  registerTripRoutesIpc({ipcMain:{handle:(n,h)=>handlers.set(n,h)},getWorkspaceWindow:()=>({webContents:event.sender}),fetchRoute,...extra});
  return (name,args,caller=event)=>handlers.get("la:trip:"+name)(caller,args);
}

const transitPayload={status:"1",route:{transits:[{distance:"1860",cost:{duration:"630"},segments:[
  {walking:{distance:"400",steps:[{polyline:"104.084096,30.652049;104.090000,30.651000"}]}},
  {bus:{buslines:[{name:"地铁2号线",type:"地铁线路",departure_stop:{name:"起站"},arrival_stop:{name:"下站"},
    distance:"1460",via_num:"0",polyline:"104.090000,30.651000;104.100000,30.650000"}]}}
]}]}};

test("search indexes unfamiliar Chengdu shops, landmarks, station aliases and WGS84 coordinates",()=>{
  const museum=searchTripPlaces("成都博物馆")[0];
  assert.equal(museum.name,"成都博物馆");assert.equal(museum.source,"OpenStreetMap");
  assert.ok(museum.point[0]>30.6&&museum.point[1]>104);
  assert.ok(searchTripPlaces("书店").some(p=>p.name.includes("书店")));
  assert.ok(searchTripPlaces("Wenshu").some(p=>p.name.includes("文殊院")));
  assert.equal(searchTripPlaces("金融城站")[0].citycode,"028");
  assert.deepEqual(searchTripPlaces(" "),[]);
  assert.ok(!Object.hasOwn(museum,"amap"));
});

test("offline transit times include a separate waiting and interchange model",()=>{
  const points=[...knownPlaces.values()].slice(0,4);
  const {legs}=planChengduTransit(points);
  assert.deepEqual(legs.map(l=>l.seconds),[4002,1504,2599]);
  for(const leg of legs){
    assert.equal(leg.seconds,leg.steps.reduce((sum,s)=>sum+s.seconds,0));
    assert.equal(leg.seconds,leg.rideSeconds+leg.walkSeconds+leg.transferSeconds+leg.waitSeconds);
    assert.ok(leg.estimated);assert.ok(leg.waitSeconds>0);
  }
  assert.equal(legs[2].transferSeconds,180);
});

test("city metro supports trips outside the four examples and keeps missing adjacent legs",()=>{
  const [a,b,c]=["天府广场站","成都东客站","金融城站"].map(q=>searchTripPlaces(q)[0].point);
  const {legs}=planChengduTransit([[0,0],a,b,c]);
  assert.equal(legs[0],null);
  assert.deepEqual(legs[1].steps.filter(s=>s.type==="metro").map(s=>s.name),["地铁2号线"]);
  assert.ok(legs[2].transferSeconds>0);
  for(const l of legs.slice(1))for(const s of l.steps.filter(s=>s.type==="metro"))assert.ok(s.sections.every(line=>decodeLine(line).length>1));
  const off=[a[0]+0.003,a[1]];
  const access=planChengduTransit([off,b]).legs[0].steps[0];
  assert.ok(access.geometryEstimated);assert.deepEqual(access.sections,[]);
  assert.equal(planChengduTransit([[0,0],[1,1]]),null);
});

test("official POI binding retains original GCJ coordinates; primary route duration is not fabricated",()=>{
  const poi=amapSearchResults({pois:[{id:"BTEST",name:"样例",citycode:"028",location:"104.084096,30.652049"}]})[0];
  assert.deepEqual(poi.amap,{poiId:"BTEST",location:[104.084096,30.652049]});
  assert.ok(Math.abs(poi.point[0]-30.65445)<0.0001);
  assert.ok(Math.abs(toAmapPoint(poi.point)[1]-poi.amap.location[0])<0.00001);
  const leg=amapTransitLeg(transitPayload);
  assert.equal(leg.seconds,630);assert.equal(leg.steps[1].seconds,null);
  assert.deepEqual(decodeLine(leg.steps[0].sections[0])[0].map(v=>v.toFixed(4)),fromAmapPoint([30.652049,104.084096]).map(v=>v.toFixed(4)));
  assert.equal(amapTransitLeg({route:{transits:[{...transitPayload.route.transits[0],segments:[{taxi:{distance:"1860"}}]}]}}),null);
});

test("public online search is explicit, globally throttled and cached; AMap requests never fall back",async()=>{
  const calls=[];
  const provider=ipc(async(url,options)=>{calls.push([new URL(url),options]);return Response.json([{name:"清水寺",display_name:"清水寺, 京都",lat:"34.9943030",lon:"135.7844389",osm_type:"way",osm_id:336641107}]);});
  const args={query:"清水寺",provider:"nominatim",userInitiated:true};
  assert.equal((await provider("search",{...args,userInitiated:false})).error.code,"E_FORBIDDEN");
  assert.equal((await provider("search",{...args,provider:"amap"})).error.code,"E_FORBIDDEN");
  const result=await provider("search",args);assert.equal(result.value.places[0].source,"OpenStreetMap");
  assert.deepEqual(await provider("search",args),result);
  assert.equal((await provider("search",{...args,frameUrl:"other",query:"新搜索"})).error.code,"E_THROTTLED");
  assert.equal(calls.length,1);assert.match(calls[0][1].headers["User-Agent"],/LifeAtlas.*github/u);
  assert.deepEqual([...calls[0][0].searchParams.keys()].sort(),["accept-language","format","limit","q"]);
  const urls=[];
  const failing=ipc(async url=>{urls.push(new URL(url).origin);return Response.json({status:"0",infocode:"10001"});},{getAmapKey:()=>"fixture"});
  assert.equal((await failing("search",{...args,provider:"amap"})).error.code,"E_FORBIDDEN");
  assert.deepEqual(urls,["https://restapi.amap.com"]);
});

test("AMap party, local date and city codes remain separate from district adcodes",async()=>{
  const captured=[];
  const provider=ipc(async url=>{const u=new URL(url);captured.push(u);return Response.json(u.pathname.endsWith("regeo")?{status:"1",regeocode:{addressComponent:{citycode:"028",adcode:"510104"}}}:transitPayload);},{getAmapKey:()=>"fixture",now:()=>Date.parse("2026-11-25T18:00:00Z")});
  const args={points:[[30.65445,104.08156],[30.662,104.055]],citycodes:[null,"028"],date:"2026-11-26",time:"08:10"};
  const r=await provider("transit",args);assert.equal(r.value.legs[0].seconds,630);assert.equal(r.value.at,"2026-11-26");
  const qs=captured[1].searchParams;
  assert.equal(qs.get("city1"),"028");assert.equal(qs.get("city2"),"028");assert.equal(qs.get("time"),"08-10");assert.equal(qs.get("show_fields"),"cost,polyline");
  assert.equal((await provider("transit",{...args,date:"2026-02-30"})).error.code,"E_INVALID_ARGUMENT");
  assert.equal((await provider("transit",{...args,citycodes:["510100","510100"]})).error.code,"E_INVALID_ARGUMENT");
});

test("shared requests cancel independently and unsupported senders cannot search",async()=>{
  let resolveFetch,trigger;
  const started=new Promise(res=>{trigger=res;});
  const run=ipc((url,options)=>new Promise(res=>{trigger(options.signal);resolveFetch=res;}));
  const base={provider:"nominatim",query:"公开样例",userInitiated:true};
  assert.equal((await run("search",base,{senderFrame:{}})).error.code,"E_FORBIDDEN");
  const a=run("search",{...base,requestId:"a"}),b=run("search",{...base,requestId:"b"});
  const signal=await started;
  await run("cancel",{requestId:"a"});assert.equal((await a).error.code,"E_CANCELLED");assert.equal(signal.aborted,false);
  resolveFetch(Response.json([]));assert.deepEqual((await b).value.places,[]);
});


test("exact landmark and station titles win even when the map is centered on the station", () => {
  const near = [30.665007, 104.02811];
  const landmark = searchTripPlaces("杜甫草堂", { near })[0];
  assert.equal(landmark.name, "杜甫草堂");
  assert.equal(landmark.address, "成都及周边 · 公园");
  const station = searchTripPlaces("杜甫草堂站", { near })[0];
  assert.equal(station.name, "杜甫草堂站");
  assert.match(station.address, /轨道交通/u);
});

test("a segment uses the origin's departure after dwell, including Shanghai rollover", async () => {
  const { transitDeparture, transitQueryIndices, queryTransitLegs } = await import("../src/editor/widgets/trip-data/transitQuery.js");
  const origin = { point: [30.66, 104.05], time: "23:50", dwellMinutes: 30 };
  assert.deepEqual(transitDeparture("2028-02-28", origin), { date: "2028-02-29", time: "00:20" });
  assert.deepEqual(transitDeparture("2027-12-31", origin), { date: "2028-01-01", time: "00:20" });
  assert.deepEqual(transitDeparture("", origin, Date.parse("2026-11-25T17:00:00Z")), { date: "2026-11-27", time: "00:20" });
  assert.deepEqual(transitDeparture("", { time: "09:30" }), { date: undefined, time: "09:30" });
  const stops = Array.from({ length: 18 }, (_, i) => ({ ...origin, point: [30 + i / 100, 104.05] }));
  assert.deepEqual(transitQueryIndices(18), []);
  assert.deepEqual(transitQueryIndices(18, 16), [16]);
  assert.deepEqual(transitQueryIndices(18, 17), []);
  assert.deepEqual(transitQueryIndices(3), [0, 1]);
  const calls = [];
  const request = async args => { calls.push(args); return { ok: true, value: { at: "2026-11-25", legs: [{ steps: [{ type: "bus" }] }] } }; };
  const args = { stops, date: "2026-11-25", request, current: () => true };
  const first = await queryTransitLegs({ ...args, indices: [16] });
  const second = await queryTransitLegs({ ...args, indices: [1], previous: first });
  assert.deepEqual(calls.map(c => c.points), [[stops[16].point, stops[17].point], [stops[1].point, stops[2].point]]);
  assert.deepEqual([calls[0].date, calls[0].time], ["2026-11-26", "00:20"]);
  assert.equal(second.legs[16], first.legs[16]);
  assert.equal(second.count, 2);
  const failed = await queryTransitLegs({ ...args, indices: [3], previous: second, request: async () => ({ ok: false, error: { code: "E_IO", message: "网络离线" } }) });
  assert.equal(failed.count, 2); assert.equal(failed.legs[16], first.legs[16]);
  assert.equal(failed.failureByLeg[3], "网络离线"); assert.equal(failed.failureByLeg[16], "");
});

test("the 87 bus connects the Panda Base with additional destinations in both directions", () => {
  const panda = [30.73335, 104.14409], cottage = searchTripPlaces("杜甫草堂")[0].point;
  const { legs } = planChengduTransit([panda, cottage, panda]);
  for (const leg of legs) {
    const bus = leg.steps.find(s => s.type === "bus");
    assert.equal(bus.name, "87路公交");
    assert.ok(leg.steps.some(s => s.type === "metro"));
    assert.equal(leg.waitSeconds, 300 + 180 * leg.steps.filter(s => s.type === "metro").length);
    assert.ok(decodeLine(bus.sections[0]).length > 5);
  }
  assert.notDeepEqual(legs[0].steps.find(s => s.type === "bus").sections, legs[1].steps.find(s => s.type === "bus").sections);
});
