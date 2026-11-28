import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { registerDatabaseMapTiles } from "../electron/main/ipc/databaseMap.js";
import { registerTripRoutesIpc } from "../electron/main/ipc/tripRoutes.js";
import { databaseTileSource } from "../electron/main/databaseTileSource.js";

function harness(register, options) {
  const handlers = new Map(), sender = Object.assign(new EventEmitter(), { id: 42, mainFrame: { processId: 12, routingId: 1 } });
  const event = { sender, senderFrame: sender.mainFrame };
  const getWindow = () => ({ webContents: sender });
  register({ ipcMain: { handle: (name, cb) => handlers.set(name, cb) }, getWindow, getWorkspaceWindow: getWindow, appVersion: "test", ...options });
  return { call: (name, args, caller = event) => handlers.get(name)(caller, args), sender, event };
}
const tile = "la:database-map:tile", cancel = "la:database-map:cancel";
const args = { layer: "street", z: 9, x: 400, y: 210, requestId: "a" };
const png = Buffer.alloc(33);
Buffer.from([137,80,78,71,13,10,26,10]).copy(png); png.write("IHDR",12); png.writeUInt32BE(256,16); png.writeUInt32BE(256,20);
const image = () => new Response(png, { headers: { "Content-Type": "image/png" } });

test("fixed public hosts, genuine imagery, exact grid bounds and no renderer URL or record metadata", async () => {
  const calls = [];
  const h = harness(registerDatabaseMapTiles, { fetchTile: async (url, opts) => { calls.push({ url, opts }); return image(); } });
  assert.equal((await h.call(tile, args, { ...h.event, senderFrame: { routingId: 5, processId: 12 } })).error.code, "E_FORBIDDEN");
  for (const extra of [{ database: "private" }, { url: "https://example.org/" }, { x: -1 }, { layer: "imaginary" }, { z: 20 }]) {
    assert.equal((await h.call(tile, { ...args, ...extra })).error.code, "E_INVALID_ARGUMENT");
  }
  assert.equal((await h.call(tile, { ...args, layer: "satellite", y: 0 })).error.code, "E_NOT_FOUND");
  assert.equal(calls.length, 0);
  const data = await h.call(tile, args);
  assert.ok(data.value.dataUrl.startsWith("data:image/png;base64,"));
  assert.equal(calls[0].url, "https://tile.openstreetmap.org/9/400/210.png");
  const { opts } = calls[0];
  assert.equal(opts.referrerPolicy, "no-referrer"); assert.equal(opts.credentials, "omit"); assert.equal(opts.redirect, "error");
  assert.match(opts.headers["User-Agent"], /LifeAtlas.*github/u);
  const local = new URL(databaseTileSource("satellite",14,12928,6724).url);
  assert.equal(local.hostname, "wmts.terrascope.be"); assert.equal(local.searchParams.get("LAYER"),"esa-worldcover-s2rgbnir-10m-2021-v2_tcc");
  assert.equal(local.searchParams.get("TILEROW"),"6724"); assert.equal(local.searchParams.get("TILECOL"),"12928");
  assert.match(databaseTileSource("satellite",6,50,26).url,/BlueMarble_NextGeneration.*\/6\/26\/50\.jpeg$/u);
});

test("requests share the same transfer, cancel individually, cap concurrency and drop queued tiles on navigation", async () => {
  const calls = [];
  const h = harness(registerDatabaseMapTiles, { fetchTile: (url, opts) => new Promise((res, rej) => {
    calls.push({ url, opts, res }); opts.signal.addEventListener("abort", () => rej(new Error("aborted")), { once: true });
  }) });
  const a = h.call(tile, args), b = h.call(tile, { ...args, requestId: "b" });
  assert.equal(calls.length,1);
  await h.call(cancel,{requestId:"a"}); assert.equal((await a).error.code, "E_CANCELLED"); assert.ok(!calls[0].opts.signal.aborted);
  calls[0].res(image()); assert.ok((await b).ok);
  const batch = Array.from({ length: 10 }, (_, i) => h.call(tile, { ...args, x:350+i, requestId:"id-"+i }));
  assert.equal(calls.length, 7);
  h.sender.emit("did-start-navigation", { isMainFrame:true, isSameDocument:false });
  for (const item of await Promise.all(batch)) assert.equal(item.error.code,"E_CANCELLED");
  assert.equal(calls.length, 7);
});

test("no coverage, corrupt images, oversized bodies and upstream rate limits return explicit errors", async () => {
  const responses = [new Response(null,{status:404}),new Response("bad",{headers:{"content-type":"image/png"}}),
    new Response(png,{headers:{"content-type":"image/png","content-length":"999999"}}),new Response(null,{status:429,headers:{"Retry-After":"40"}})];
  let hits=0;
  const h = harness(registerDatabaseMapTiles, { fetchTile:async()=>responses[hits++] });
  for(const code of ["E_NOT_FOUND","E_IO","E_IO","E_THROTTLED","E_THROTTLED"]) assert.equal((await h.call(tile,args)).error.code,code);
  assert.equal(hits,4);
});

test("visible satellite tile retries a transient interruption once, sharing the second transfer", async () => {
  const input = { ...args, layer: "satellite" };
  for (const first of [() => { throw new DOMException("timed out", "TimeoutError"); }, () => new Response(null, { status: 502 })]) {
    let hits = 0;
    const h = harness(registerDatabaseMapTiles, { fetchTile: async () => ++hits === 1 ? first() : image() });
    const both = await Promise.all([h.call(tile, input), h.call(tile, { ...input, requestId: "b" })]);
    assert.ok(both.every(result => result.ok));
    assert.equal(hits, 2);
  }
  let hits = 0;
  const h = harness(registerDatabaseMapTiles, { fetchTile: async () => { hits++;return new Response(null, { status: 504 }); } });
  assert.equal((await h.call(tile, input)).error.code, "E_IO");
  assert.equal(hits, 2);
});

test("satellite backoff observes user cancellation, no coverage and upstream Retry-After", async () => {
  const input = { ...args, layer: "satellite" };
  let hits = 0;
  const h = harness(registerDatabaseMapTiles, { fetchTile: async () => { hits++; throw new TypeError("fetch failed"); } });
  const pending = h.call(tile, input);
  await new Promise(resolve => setImmediate(resolve));
  await h.call(cancel, { requestId: input.requestId });
  assert.equal((await pending).error.code, "E_CANCELLED");
  for (const [status, expected] of [[404,"E_NOT_FOUND"], [429,"E_THROTTLED"], [503,"E_THROTTLED"], [502,"E_THROTTLED"]]) {
    let calls = 0;
    const blocked = harness(registerDatabaseMapTiles, { now: () => 1234, fetchTile: async () => {
      calls++; return new Response(null, { status, headers: status === 404 ? {} : { "Retry-After": "77" } });
    } });
    const { error } = await blocked.call(tile, input);
    assert.equal(error.code, expected);
    if (expected === "E_THROTTLED") assert.equal((await blocked.call(tile, input)).error.retryAfterMs, 77000);
    assert.equal(calls, 1);
  }
  assert.equal(hits, 1);
});

test("a rate limit on a neighboring visible tile stops a pending satellite retry", async () => {
  let calls = 0;
  const h = harness(registerDatabaseMapTiles, { now: () => 1234, fetchTile: async () => {
    if (++calls === 1) throw new Error("net::ERR_CONNECTION_RESET");
    return new Response(null, { status: 503, headers: { "Retry-After": "75" } });
  } });
  const input = { ...args, layer: "satellite" };
  const pending = h.call(tile, input);
  const neighbour = await h.call(tile, { ...input, x: input.x + 1, requestId: "neighbour" });
  assert.equal(neighbour.error.retryAfterMs, 75000);
  assert.deepEqual(await pending, neighbour);
  assert.equal(calls, 2);
});

test("database explicit search shares Nominatim's cooldown, cache and in-flight call with travel, without reading AMap settings", async () => {
  let keys=0, calls=0, finish;
  const fixture=[{ name:"天府广场",lat:"30.657",lon:"104.066",osm_type:"way",osm_id:77,display_name:"天府广场, 成都" }];
  const h = harness(registerTripRoutesIpc, { getAmapKey:()=>{keys++;return "";},capabilityOwner:f=>f==="widget"?"sha":null,
    fetchRoute:(url,options)=>{ calls++; const u = new URL(url); assert.equal(u.hostname,"nominatim.openstreetmap.org");
      assert.equal(u.searchParams.get("q"),"天府广场"); assert.deepEqual([...u.searchParams.keys()].sort(),["accept-language","format","limit","q"]);
      assert.equal(options.credentials,"omit");return new Promise(resolve=>{finish=()=>resolve(Response.json(fixture));}); } });
  const search = "la:database-map:search", req={query:"天府广场",requestId:"native"};
  assert.equal((await h.call(search,{...req,city:"private"})).error.code, "E_INVALID_ARGUMENT");
  assert.equal((await h.call(search,req,{...h.event,sender:{}})).error.code,"E_FORBIDDEN");
  const first=h.call(search,req);
  await new Promise(r=>setImmediate(r)); assert.equal(keys,0); assert.equal(calls,1);
  const fromTrip=h.call("la:trip:search",{...req,frameUrl:"widget",requestId:"trip",provider:"nominatim",userInitiated:true});
  await new Promise(r=>setImmediate(r)); assert.equal(keys,1);assert.equal(calls,1);
  await h.call("la:database-map:cancel-search",{requestId:"native"}); assert.equal((await first).error.code,"E_CANCELLED");
  finish(); const result=await fromTrip;assert.equal(result.value.places[0].name,"天府广场");
  assert.deepEqual(await h.call(search,{...req,requestId:"repeated"}), result);
  assert.equal((await h.call(search,{...req,query:"新样例"})).error.code,"E_THROTTLED");
  assert.equal(keys,1);assert.equal(calls,1);
});

test("only main-process HTTPS configuration changes the Nominatim endpoint, and invalid overrides fail without a fallback", async () => {
  const req = { query:"合成公园", requestId:"public-test" };
  let transfers = 0;
  const run = (url, fetchRoute) => harness(registerTripRoutesIpc, { nominatimSearchUrl:url, getAmapKey:()=>{ throw Error("unexpected key read"); }, fetchRoute });
  for(const invalid of ["http://geocoder.example/search","https://name:identifier@geocoder.example/search","https://geocoder.example/search?x=1"]) {
    const h = run(invalid,()=>{transfers++;throw Error("unexpected");});
    assert.equal((await h.call("la:database-map:search",req)).error.code, "E_IO");
  }
  assert.equal(transfers,0);
  const h = run("https://geocoder.example/controlled/search",async u => {
    transfers++;
    const url = new URL(u); assert.equal(url.origin + url.pathname,"https://geocoder.example/controlled/search");
    return Response.json([]);
  });
  assert.equal((await h.call("la:database-map:search",req)).value.serviceHost,"geocoder.example");
  assert.equal(transfers,1);
});
