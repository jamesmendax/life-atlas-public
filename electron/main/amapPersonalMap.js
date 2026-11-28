import packageInfo from "../../package.json" with { type: "json" };
import { AMAP_POINTS_PER_LINE, buildAmapPersonalMapArgs, checkMapTransportSize } from "../../src/domain/amapPersonalMap.js";
import { StorageError } from "./storage/workspaceDb.js";

const toolName = "maps_schema_personal_map";
const maxReply = 512 * 1024;

async function rpcReply(response, id) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty reply");
  const stream = response.headers.get("content-type")?.includes("text/event-stream");
  const decoder = new TextDecoder();
  let buffer = "", bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      bytes += chunk.value?.byteLength || 0;
      if (bytes > maxReply) throw new Error("response limit");
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      if (!stream && chunk.done) {
        const message = JSON.parse(buffer);
        if (message.id === id && message.result !== undefined && !message.error) return message.result;
        throw new Error("invalid response");
      }
      if (stream) {
        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop();
        if (chunk.done && buffer) { parts.push(buffer); buffer = ""; }
        for (const part of parts) {
          const data = part.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
          if (!data) continue;
          const message = JSON.parse(data);
          if (message.id !== id) continue;
          if (message.error || message.result === undefined) throw new Error("tool error");
          return message.result;
        }
      }
      if (chunk.done) throw new Error("missing response");
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function returnedMap(result) {
  if (result?.isError) return null;
  const texts = (result?.content || []).filter((entry) => entry.type === "text").map((entry) => entry.text);
  if (result?.structuredContent) texts.push(JSON.stringify(result.structuredContent));
  let appLink, webLink;
  for (const text of texts) {
    const candidates = String(text).replaceAll("\\/", "/").match(/(?:amapuri|https):\/\/[^\s"'<>\\)\]]+/gi) || [];
    for (const value of candidates) {
      if (value.length > 8192) continue;
      let url;
      try { url = new URL(value); } catch { continue; }
      if (url.username || url.password || url.port) continue;
      if (url.protocol === "amapuri:" && url.hostname.toLowerCase() === "workinamap"
        && ["/createwithtoken", "/backflowmap"].includes(url.pathname.toLowerCase()) && url.search.length > 1) appLink ||= url.href;
      if (url.protocol === "https:" && (url.pathname.length > 1 || url.search)) {
        if (url.hostname === "surl.amap.com") return url.href;
        if (url.hostname === "wb.amap.com") webLink ||= url.href;
      }
    }
  }
  return appLink || webLink || null;
}

const incompatible = () => new StorageError("E_UNSUPPORTED_VERSION", "高德当前的专属地图接口无法接收这份计划，请检查桌面版本和高德服务配置。");

function resolveSchema(definition, root) {
  if (!definition?.$ref) return definition || {};
  if (!definition.$ref.startsWith("#/")) throw incompatible();
  const value = definition.$ref.slice(2).split("/").reduce((node, key) => node?.[key.replaceAll("~1", "/").replaceAll("~0", "~")], root);
  if (!value || value.$ref) throw incompatible();
  return value;
}

function supportsType(schema, expected) {
  return schema && (schema.type === expected || (Array.isArray(schema.type) && schema.type.includes(expected)));
}

function checkWireValue(value, raw, root, label, dayLabels) {
  const schema = resolveSchema(raw, root);
  const type = Array.isArray(value) ? "array" : typeof value;
  if (schema.type && !supportsType(schema, type)) throw incompatible();
  if (Array.isArray(value) || typeof value === "string") {
    const size = Array.isArray(value) ? value.length : Array.from(value).length;
    const min = Array.isArray(value) ? schema.minItems : schema.minLength;
    const max = Array.isArray(value) ? schema.maxItems : schema.maxLength;
    if ((Number.isInteger(min) && size < min) || (Number.isInteger(max) && size > max)) {
      const bound = size < min ? "至少 " + min : "最多 " + max;
      throw new StorageError("E_INVALID_ARGUMENT", label + "有 " + size + (type === "array" ? " 项" : " 个字符") + "，高德接口要求" + bound + "。");
    }
  }
  if (type === "array" && schema.items) {
    value.forEach((item, index) => {
      const itemLabel = label === "整张地图的子路线数" ? (dayLabels?.[index] || "第 " + (index + 1) + " 天") : label + "第 " + (index + 1) + " 项";
      checkWireValue(item, schema.items, root, itemLabel, dayLabels);
    });
  }
  if (type === "object" && value) {
    if ((schema.required || []).some(key => !Object.hasOwn(value, key))) throw incompatible();
    for (const [key, entry] of Object.entries(value)) {
      if (!schema.properties?.[key] && schema.additionalProperties === false) throw incompatible();
      if (schema.properties?.[key]) {
        const field = { orgName: "计划名称", title: "标题", desc: "说明", pointInfoList: "地点列表", name: "名称", poiId: "高德 POI ID" }[key] || key;
        checkWireValue(entry, schema.properties[key], root, key === "lineList" ? "整张地图的子路线数" : label + field, dayLabels);
      }
    }
  }
}

function argumentsForSchema(input, root) {
  if (!root?.properties?.orgName || !root.properties.lineList) throw incompatible();
  const definition = resolveSchema(root.properties.lineList, root);
  const choices = (definition.anyOf || definition.oneOf || [definition]).map(item => resolveSchema(item, root));
  const shape = choices.find(item => supportsType(item, "array") || item.items) || choices.find(item => supportsType(item, "string"));
  if (!shape) throw incompatible();
  const lineShape = resolveSchema(shape.items || shape.contentSchema?.items, root);
  const pointsShape = resolveSchema(lineShape.properties?.pointInfoList, root);
  const pointShape = resolveSchema(pointsShape.items, root);
  const allowsDesc = node => supportsType(resolveSchema(node?.properties?.desc, root), "string");
  const maxPointsPerLine = Math.min(AMAP_POINTS_PER_LINE, pointsShape.maxItems ?? AMAP_POINTS_PER_LINE);
  const minPointsPerLine = Math.max(1, pointsShape.minItems ?? 1);
  if (!Number.isInteger(maxPointsPerLine) || !Number.isInteger(minPointsPerLine) || maxPointsPerLine < minPointsPerLine) {
    throw new StorageError("E_UNSUPPORTED_VERSION", "高德当前接口的每条路线地点数与专属地图格式不兼容。");
  }
  const args = buildAmapPersonalMapArgs(input, { lineDesc: allowsDesc(lineShape), pointDesc: allowsDesc(pointShape),
    rootDesc: allowsDesc(root), maxPointsPerLine, minPointsPerLine });
  if (allowsDesc(root) && root.required?.includes("desc") && !args.desc) args.desc = args.orgName;
  for (const line of args.lineList) {
    if (allowsDesc(lineShape) && lineShape.required?.includes("desc") && !line.desc) line.desc = line.title;
    for (const point of line.pointInfoList) {
      if (allowsDesc(pointShape) && pointShape.required?.includes("desc") && !point.desc) point.desc = point.name;
      for (const key of ["lon", "lat"]) {
        const coord = resolveSchema(pointShape.properties?.[key], root);
        if (supportsType(coord, "string") && !supportsType(coord, "number")) point[key] = String(point[key]);
      }
    }
  }

  const dayLabels = (input.plan?.days || [input.day]).flatMap((day, i) => {
    const count = day.stops.length + (day.lodging?.trim() ? 1 : 0);
    return Array(Math.ceil(count / maxPointsPerLine)).fill("第 " + (day.day ?? i + 1) + " 天");
  });
  if (supportsType(shape, "string") && !supportsType(shape, "array")) {
    if (shape.contentSchema) checkWireValue(args.lineList, shape.contentSchema, root, "整张地图的子路线数", dayLabels);
    args.lineList = JSON.stringify(args.lineList);
  }
  checkWireValue(args, { ...root, properties: { ...root.properties, lineList: shape } }, root, "计划", dayLabels);
  try { checkMapTransportSize(args); }
  catch (error) { throw new StorageError("E_INVALID_ARGUMENT", error.message); }
  return args;
}

export async function createAmapPersonalMap(input, { key, fetchImpl, signal = AbortSignal.timeout(40000) }) {
  try { buildAmapPersonalMapArgs(input); }
  catch (error) { throw new StorageError("E_INVALID_ARGUMENT", error.message); }
  if (!key) throw new StorageError("E_NOT_FOUND", "请在设置的「地图服务」中配置高德 Web 服务 Key。");
  const endpoint = new URL("https://mcp.amap.com/mcp");
  endpoint.searchParams.set("key", key);
  let sessionId, protocolVersion;
  async function send(method, params, id) {
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;
    if (protocolVersion) headers["MCP-Protocol-Version"] = protocolVersion;
    const response = await fetchImpl(endpoint.href, { method: "POST", headers, credentials: "omit", redirect: "error", signal,
      body: JSON.stringify({ jsonrpc: "2.0", ...(id ? { id } : {}), method, ...(params ? { params } : {}) }) });
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error("service unavailable"); }
    if (method === "initialize") sessionId = response.headers.get("mcp-session-id");
    if (!id) { await response.body?.cancel().catch(() => {}); return; }
    return rpcReply(response, id);
  }
  try {
    const hello = await send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "LifeAtlas", version: packageInfo.version } }, 1);
    if (!["2025-03-26", "2025-06-18"].includes(hello?.protocolVersion)) throw new Error("protocol mismatch");
    protocolVersion = hello.protocolVersion;
    await send("notifications/initialized");
    const list = await send("tools/list", {}, 2);
    const advertised = list?.tools?.find((tool) => tool.name === toolName);
    const args = argumentsForSchema(input, advertised?.inputSchema);
    const result = await send("tools/call", { name: toolName, arguments: args }, 3);
    const url = returnedMap(result);
    if (!url || (key.length === 32 && decodeURIComponent(url).toLowerCase().includes(key.toLowerCase()))) throw new Error("no shareable map link");
    return { url };
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError("E_IO", "高德未返回可用的专属地图链接，请检查服务权限、额度和网络。");
  } finally {
    if (sessionId && protocolVersion && !signal.aborted) {
      try {
        const end = await fetchImpl(endpoint.href, { method: "DELETE", headers: { "Mcp-Session-Id": sessionId, "MCP-Protocol-Version": protocolVersion },
          credentials: "omit", redirect: "error", signal: AbortSignal.timeout(2000) });
        await end.body?.cancel().catch(() => {});
      } catch { /* The service may expire the session itself. */ }
    }
  }
}
