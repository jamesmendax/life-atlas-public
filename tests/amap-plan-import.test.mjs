import assert from "node:assert/strict";
import test from "node:test";
import { buildAmapPersonalMapArgs } from "../src/domain/amapPersonalMap.js";
import { createAmapPersonalMap } from "../electron/main/amapPersonalMap.js";
import { registerTripMapWindows } from "../electron/main/tripMapWindow.js";

const example = {
  title: "两天成都合成计划", date: "2028-02-28",
  days: [
    { day: 1, title: "第一日",
      stops: [{ name: "样例景区", time: "09:15", dwellMinutes: 45, amap: { poiId: "A_TEST", location: [104.09, 30.70] } }],
      lodging: "样例酒店", lodgingAmap: { poiId: "H_TEST", location: [104.06, 30.65] } },
    { day: 2, title: "第二日",
      stops: [{ name: "样例博物馆", time: "13:20", dwellMinutes: 0, amap: { poiId: "B_TEST", location: [104.03, 30.67] } }] },
  ],
};
const text = { type: "string" };
const poi = { type: "object", additionalProperties: false, required: ["name", "lon", "lat", "poiId"],
  properties: { name: text, lon: { type: "number" }, lat: { type: "number" }, poiId: text, desc: text } };
const line = { type: "object", required: ["pointInfoList", "title"], additionalProperties: false,
  properties: { title: text, pointInfoList: { type: "array", items: poi }, desc: text } };
const schema = { type: "object", required: ["orgName", "lineList"], additionalProperties: false,
  properties: { orgName: text, lineList: { type: "array", items: line } } };
const goodLink = "amapuri://workInAmap/createWithToken?polylineID=fixture";
function mockService({ inputSchema = schema, result, failedMethod } = {}) {
  const methods = [], submissions = [];
  const fetchImpl = async (url, options) => {
    assert.equal(new URL(url).origin, "https://mcp.amap.com");
    assert.equal(options.credentials, "omit");
    if (options.method === "DELETE") { methods.push("DELETE"); return new Response(null, { status: 200 }); }
    const { id, method, params } = JSON.parse(options.body);
    methods.push(method);
    if (method === failedMethod) return new Response(null, { status: 503 });
    if (method === "initialize") return Response.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18" } }, { headers: { "mcp-session-id": "fixture-session" } });
    if (method === "notifications/initialized") return new Response(null, { status: 202 });
    if (method === "tools/list") return Response.json({ jsonrpc: "2.0", id, result: { tools: [{ name: "maps_schema_personal_map", inputSchema }] } });
    assert.equal(method, "tools/call");
    assert.equal(params.name, "maps_schema_personal_map");
    submissions.push(params.arguments);
    const reply = { jsonrpc: "2.0", id, result: result || { content: [{ type: "text", text: goodLink }] } };
    return new Response("event: message\ndata: " + JSON.stringify(reply) + "\n\n", { headers: { "content-type": "text/event-stream" } });
  };
  return { options: { key: "fixture-only", fetchImpl }, methods, submissions };
}

test("a multi-day transport uses a single official tool call, appends lodging and retains the leap-day schedule", async () => {
  const service = mockService();
  const response = await createAmapPersonalMap({ plan: example }, service.options);
  assert.deepEqual(response, { url: goodLink });
  assert.deepEqual(service.methods, ["initialize", "notifications/initialized", "tools/list", "tools/call", "DELETE"]);
  const [args] = service.submissions;
  assert.equal(args.orgName, "两天成都合成计划 · 2028-02-28");
  assert.equal(args.lineList.length, 2);
  assert.match(args.lineList[1].title, /2028-02-29.*第二日/u);
  assert.match(args.lineList[0].pointInfoList[0].desc, /09:15.*停留 45 分钟/u);
  assert.match(args.lineList[1].pointInfoList[0].desc, /13:20.*停留 0 分钟/u);
  assert.deepEqual(args.lineList[0].pointInfoList.map(p => [p.poiId, p.lon, p.lat]), [["A_TEST",104.09,30.70],["H_TEST",104.06,30.65]]);
  assert.equal(args.lineList[0].pointInfoList[1].desc, "当晚住宿");
});
test("a declared JSON string lineList carries all stops and all days in a single argument", async () => {
  const service = mockService({ inputSchema: { ...schema, properties: { orgName: text, lineList: text } } });
  const days = Array.from({ length: 7 }, (_, i) => ({ ...example.days[0], day: i + 1 }));
  days[4].date = "2028-03-18";
  const result = await createAmapPersonalMap({ plan: { ...example, days } }, service.options);
  assert.equal(result.url, goodLink);
  assert.equal(service.submissions.length, 1);
  const lines = JSON.parse(service.submissions[0].lineList);
  assert.equal(lines.length, 7);
  assert.match(lines[4].title, /2028-03-18.*停留 45 分钟.*当晚住宿/u);
  assert.ok(lines.every(row => row.pointInfoList.length === 2));
});
test("missing unconfirmed stops and lodging name the exact day and make zero network requests", async () => {
  const plan = structuredClone(example);
  delete plan.days[0].lodgingAmap;
  plan.days[1].stops[0].amap.location = [400, 30];
  const service = mockService();
  await assert.rejects(createAmapPersonalMap({ plan }, { ...service.options, key: "" }), err =>
    err.code === "E_INVALID_ARGUMENT" && /第 1 天住宿「样例酒店」/u.test(err.message) && /第 2 天第 1 站「样例博物馆」/u.test(err.message));
  assert.deepEqual(service.methods, []);
  await assert.rejects(createAmapPersonalMap({ plan: example }, { ...service.options, key: "" }), { code: "E_NOT_FOUND" });
  assert.deepEqual(service.methods, []);
});
test("advertised per-line capacity triggers grouping and a genuine map-level cap fails before submission", async () => {
  const constrained = structuredClone(schema);
  constrained.properties.lineList.items.properties.pointInfoList.maxItems = 1;
  const accepted = mockService({ inputSchema: constrained });
  await createAmapPersonalMap({ plan: example }, accepted.options);
  assert.deepEqual(accepted.submissions[0].lineList.map(line => line.pointInfoList.map(p => p.poiId)), [["A_TEST"], ["H_TEST"], ["B_TEST"]]);
  constrained.properties.lineList.maxItems = 2;
  const service = mockService({ inputSchema: constrained });
  await assert.rejects(createAmapPersonalMap({ plan: example }, service.options), err =>
    err.code === "E_INVALID_ARGUMENT" && /整张地图的子路线数.*3.*最多 2/u.test(err.message));
  assert.equal(service.submissions.length, 0);
  assert.equal(service.methods.at(-1), "DELETE");
  const invalid = mockService({ inputSchema: { ...schema, properties: { orgName: text, lineList: { type: "object" } } } });
  await assert.rejects(createAmapPersonalMap({ plan: example }, invalid.options), { code: "E_UNSUPPORTED_VERSION" });
  assert.equal(invalid.submissions.length, 0);
});
test("a lodging-only day and the original one-day caller remain complete; too large inputs fail explicitly", () => {
  const lodgingOnly = { ...example.days[0], stops: [] };
  assert.equal(buildAmapPersonalMapArgs({ plan: { days: [lodgingOnly] } }).lineList[0].pointInfoList[0].poiId, "H_TEST");
  const legacy = buildAmapPersonalMapArgs({day: example.days[0], date: "2030-03-02"});
  assert.equal(legacy.orgName, "第 1 天 · 第一日");
  assert.match(legacy.lineList[0].title, /2030-03-02.*09:15.*停留 45 分钟/u);
  const many = Array(101).fill(example.days[0].stops[0]);
  assert.equal(buildAmapPersonalMapArgs({plan: {days: [{day: 2, stops: many}]}}).lineList.flatMap(line => line.pointInfoList).length, 101);
  const huge = { plan: { title: "旅".repeat(350000), days: example.days } };
  assert.throws(() => buildAmapPersonalMapArgs(huge), /1 MiB/u);
});
test("service error or untrusted returned URL leaves the map uncreated to the caller", async () => {
  for (const service of [mockService({ failedMethod: "tools/list" }), mockService({ result: { content: [{ type: "text", text: "https://unrelated.example/fiction" }] } })]) {
    await assert.rejects(createAmapPersonalMap({ plan: example }, service.options), { code: "E_IO" });
    assert.equal(service.methods.at(-1), "DELETE");
  }
});
test("the real IPC personal-map branch forwards the whole plan and rejects an untrusted sender", async () => {
  const handlers = new Map(), service = mockService();
  const sender = { id: 3, mainFrame: { processId: 12, routingId: 34 } };
  const event = { sender, senderFrame: sender.mainFrame };
  registerTripMapWindows({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    getWindow: () => ({ webContents: sender }), capabilityOwner: () => "sample", getKey: () => "fixture", fetchImpl: service.options.fetchImpl });
  const invoke = handlers.get("la:trip:personal-map");
  assert.equal((await invoke({ ...event, sender: {} }, { plan: example })).error.code, "E_FORBIDDEN");
  const r = await invoke(event, { frameUrl: "life-widget://sample/index.html", plan: example });
  assert.deepEqual(r, { ok: true, value: { url: goodLink } });
  assert.equal(service.submissions[0].lineList.length, 2);
});

test("free days retain their original dates, headings and ordinals before, between and after located days", async () => {
  const empty = (day, title) => ({ day, title, stops: [] });
  const days = [empty(1, "抵达休整"), { ...example.days[0], day: 2 }, empty(3, "自由安排"),
    { ...example.days[1], day: 4 }, empty(5, "返程预留")];
  const plan = { ...example, days };
  const tests = [
    { lineDesc: false, pointDesc: false }, { lineDesc: true, pointDesc: false },
    { lineDesc: false, pointDesc: true }, { lineDesc: true, pointDesc: true },
  ];
  for (const options of tests) {
    const declared = structuredClone(schema);
    const props = declared.properties.lineList.items.properties;
    if (!options.lineDesc) delete props.desc;
    if (!options.pointDesc) delete props.pointInfoList.items.properties.desc;
    if (options.lineDesc || options.pointDesc) props.title = { type: "string", maxLength: 30 };
    const mock = mockService({ inputSchema: declared });
    await createAmapPersonalMap({ plan }, mock.options);
    const [args] = mock.submissions;
    assert.equal(args.lineList.length, 2);
    const joined = JSON.stringify(args.lineList);
    for (const token of ["2028-02-28 · 第 1 天 · 抵达休整", "2028-03-01 · 第 3 天 · 自由安排",
      "2028-03-03 · 第 5 天 · 返程预留", "2028-02-29 · 第 2 天", "2028-03-02 · 第 4 天",
      "停留 45 分钟", "当晚住宿", "停留 0 分钟"]) assert.ok(joined.includes(token), token);
    if (options.lineDesc || options.pointDesc) assert.ok(args.lineList.every(row => !row.title.includes("停留")));
  }
  assert.throws(() => buildAmapPersonalMapArgs({ plan: { days: [empty(1, "首日"), empty(2, "次日")] } }), /整趟计划还没有可导入/u);
  const capped = structuredClone(schema);
  capped.properties.lineList.items.properties.pointInfoList.minItems = 3;
  const service = mockService({ inputSchema: capped });
  await assert.rejects(createAmapPersonalMap({plan}, service.options), err => err.code === "E_INVALID_ARGUMENT" && /第 2 天地点列表/u.test(err.message));
});

test("official service-returned personal-map schemes work and a supplied mobile short link wins", async () => {
  const backflow = "amapuri://workInAmap/backflowMap?mapID=fixture";
  const withScheme = mockService({ result: { structuredContent: { schema_url: backflow } } });
  assert.equal((await createAmapPersonalMap({ plan: example }, withScheme.options)).url, backflow);
  const short = "https://surl.amap.com/fixture";
  const both = mockService({ result: { content: [{ type: "text", text: backflow }], structuredContent: { schema_url: short } } });
  assert.equal((await createAmapPersonalMap({ plan: example }, both.options)).url, short);
});

function syntheticStops(count, prefix = "poi") {
  return Array.from({ length: count }, (_, i) => ({
    name: prefix + "站-" + (i + 1), time: String(i % 24).padStart(2, "0") + ":15", dwellMinutes: i + 1,
    amap: { poiId: prefix + "_" + (i + 1), location: [104 + i / 1000, 30.66] },
  }));
}

test("16, 17 and 42 visits stay ordered and retain every dwell in one map without duplicated boundary POIs", async () => {
  for (const [count, sizes] of [[16, [16]], [17, [16, 1]], [42, [16, 16, 10]]]) {
    const stops = syntheticStops(count);
    const day = { day: 1, date: "2026-12-08", title: "成都长日", stops };
    const service = mockService();
    const out = await createAmapPersonalMap({ plan: { days: [day] } }, service.options);
    assert.equal(out.url, goodLink);
    assert.equal(service.submissions.length, 1);
    const lines = service.submissions[0].lineList;
    assert.deepEqual(lines.map(line => line.pointInfoList.length), sizes);
    const points = lines.flatMap(line => line.pointInfoList);
    assert.deepEqual(points.map(p => p.poiId), stops.map(stop => stop.amap.poiId));
    assert.deepEqual(points.map(p => p.desc), stops.map(s => "到达 " + s.time + "，停留 " + s.dwellMinutes + " 分钟"));
    lines.forEach((line, i) => assert.equal(line.title, "2026-12-08 · 第 1 天 · 成都长日" + (sizes.length > 1 ? " · 第 " + (i + 1) + "/" + sizes.length + " 段" : "")));
    const legacy = buildAmapPersonalMapArgs({ day });
    assert.deepEqual(legacy.lineList.map(l => l.pointInfoList.length), sizes);
    if (count === 42) assert.match(legacy.lineList[2].title, /33\. poi站-33.*42\. poi站-42/u);
  }
});

test("both hotels remain final and each free day's text occurs once in the matching first or final subgroup", async () => {
  const freeDay = (day, title) => ({ day, title, stops: [] });
  const first = { ...example.days[0], day: 2, title: "第一站群", stops: syntheticStops(16, "甲") };
  const second = { ...example.days[0], day: 4, title: "第二站群", stops: syntheticStops(17, "乙"),
    lodging: "第二酒店", lodgingAmap: { poiId: "H2_TEST", location: [104.05, 30.66] } };
  const plan = { date: "2027-01-01", days: [freeDay(1, "首日休整"), first, freeDay(3, "中间休整"), second, freeDay(5, "末日休整")] };
  const service = mockService();
  await createAmapPersonalMap({ plan }, service.options);
  const [args] = service.submissions;
  assert.deepEqual(args.lineList.map(line => line.pointInfoList.length), [16, 1, 16, 2]);
  const [a, b, c, d] = args.lineList;
  assert.match(a.desc, /2027-01-01 · 第 1 天 · 首日休整/u);
  assert.match(b.desc, /2027-01-03 · 第 3 天 · 中间休整/u);
  assert.match(d.desc, /2027-01-05 · 第 5 天 · 末日休整/u);
  assert.equal(c.desc, undefined);
  for (const title of ["首日休整", "中间休整", "末日休整"]) assert.equal(JSON.stringify(args).split(title).length, 2);
  assert.deepEqual([b, d].map(line => line.pointInfoList.at(-1)).map(p => [p.poiId, p.desc]), [["H_TEST", "当晚住宿"], ["H2_TEST", "当晚住宿"]]);
  assert.match(a.title, /^2027-01-02.*第 1\/2 段/u);
  assert.match(c.title, /^2027-01-04.*第 1\/2 段/u);
});

test("declared minimum and maximum capacities rebalance the tail; the whole-map maximum applies after splitting", async () => {
  const constrained = structuredClone(schema);
  Object.assign(constrained.properties.lineList.items.properties.pointInfoList, { minItems: 2, maxItems: 8 });
  constrained.properties.lineList.maxItems = 3;
  const plan = { days: [{ day: 4, stops: syntheticStops(17) }] };
  const accepting = mockService({ inputSchema: constrained });
  await createAmapPersonalMap({ plan }, accepting.options);
  const [args] = accepting.submissions;
  assert.deepEqual(args.lineList.map(line => line.pointInfoList.length), [8, 7, 2]);
  assert.deepEqual(args.lineList.flatMap(line => line.pointInfoList.map(p => p.poiId)), plan.days[0].stops.map(s => s.amap.poiId));
  // The same trip only fits if all three subroutes are accepted.
  constrained.properties.lineList.maxItems = 2;
  const rejecting = mockService({ inputSchema: constrained });
  await assert.rejects(createAmapPersonalMap({ plan }, rejecting.options), e => e.code === "E_INVALID_ARGUMENT" && /子路线数.*3.*最多 2/u.test(e.message));
  assert.equal(rejecting.submissions.length, 0);
});
