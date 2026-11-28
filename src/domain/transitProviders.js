import { encodeRoadSections, MAX_ROUTE_POINTS, ROAD_GEOMETRY_SIZE_ERROR, VALID_POINT } from "./tripRoutes.js";

// Offset model adapted from coordtransform, Copyright (c) 2015 记忆的残骸 (MIT).
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
export function toAmapPoint([lat,lon]) {
  if(lon<72.004||lon>137.8347||lat<0.8293||lat>55.8271)return [lat,lon];
  const x=lon-105,y=lat-35,rad=Math.PI/180;
  const sin=v=>Math.sin(v*Math.PI);
  const shared=20*(sin(6*x)+sin(2*x))*2/3;
  const dy=-100+2*x+3*y+0.2*y*y+0.1*x*y+0.2*Math.sqrt(Math.abs(x))+shared
    +(20*sin(y)+40*sin(y/3)+160*sin(y/12)+320*sin(y/30))*2/3;
  const dx=300+x+2*y+0.1*x*x+0.1*x*y+0.1*Math.sqrt(Math.abs(x))+shared
    +(20*sin(x)+40*sin(x/3)+150*sin(x/12)+300*sin(x/30))*2/3;
  const a=6378245,e=0.006693421622965943,denom=1-e*Math.sin(lat*rad)**2;
  return [lat+dy*denom**1.5/(a*(1-e)*rad),lon+dx*Math.sqrt(denom)/(a*Math.cos(lat*rad)*rad)];
}
export function fromAmapPoint(point) {
  let guess=point;
  for(let i=0;i<4;i++){
    const shifted=toAmapPoint(guess);
    guess=guess.map((v,j)=>v+point[j]-shifted[j]);
  }
  return guess.map(v=>Math.round(v*1e6)/1e6);
}
const text=(v,cap=130)=>typeof v==="string"?v.trim().slice(0,cap):"";
const numeric=v=>(typeof v==="number"||typeof v==="string"&&v.trim()!=="")&&Number.isFinite(+v)&&+v>=0?Math.round(+v):null;
function coordinate(value) {
  if(typeof value!=="string"||!/^[-+]?\d+(?:\.\d+)?,[-+]?\d+(?:\.\d+)?$/u.test(value))return null;
  const [lng, lat] = value.split(",").map(Number);
  return VALID_POINT([lat, lng]) ? [lng, lat] : null;
}
export function amapLine(value) {
  if (typeof value !== "string" || !value) return [];
  const pairs = (value.endsWith(";") ? value.slice(0, -1) : value).split(";");
  if (pairs.length > MAX_ROUTE_POINTS) {
    throw Object.assign(new Error("路线轨迹点数超过可保存上限"), { code: ROAD_GEOMETRY_SIZE_ERROR });
  }
  const points = [];
  for (const pair of pairs) {
    const location = coordinate(pair);
    if (!location) return [];
    points.push(fromAmapPoint([location[1], location[0]]));
  }
  return points;
}
function geometry(value) {
  // The timetable is still usable when the provider supplies no drawable line.
  try { return encodeRoadSections(amapLine(value)); }
  catch (error) { if (error?.code === ROAD_GEOMETRY_SIZE_ERROR) return []; throw error; }
}
export function amapSearchResults(payload) {
  return (Array.isArray(payload?.pois) ? payload.pois : []).slice(0, 25).flatMap(p => {
    const location = coordinate(p?.location), name = text(p?.name);
    if (!location || !name) return [];
    const point = fromAmapPoint([location[1], location[0]]);
    const poiId = text(p.id, 80), adcode = text(p.adcode, 6), citycode = text(p.citycode, 6);
    const type = text(p.type), typecode = text(p.typecode, 34);
    const province = text(p.pname), city = text(p.cityname), district = text(p.adname);
    const guide = p.navi?.navi_poiid ?? p.navi_poiid;
    const navigation = coordinate(guide) || text(guide, 80);
    const entrance = coordinate(p.navi?.entr_location ?? p.entr_location);
    const exit = coordinate(p.navi?.exit_location ?? p.exit_location);
    const amap = { poiId, location, ...(typecode && { typecode }), ...(adcode && { adcode }),
      ...(navigation && { navigation }), ...(entrance && { entrance }), ...(exit && { exit }) };
    const address = [...new Set([province, city, district, text(p.address, 200)].filter(Boolean))].join(" ");
    return [{ id: "amap:" + (poiId || point.join(",")), name, point, amap, address, source: "高德地图",
      type, typecode, province, city, district, citycode, adcode }];
  });
}
export function osmSearchResults(payload) {
  return (Array.isArray(payload) ? payload : []).slice(0, 25).flatMap(p => {
    if (!p || p.lat === undefined || p.lon === undefined || p.lat === "" || p.lon === "") return [];
    const point = [Number(p.lat), Number(p.lon)], address = text(p.display_name, 280);
    const name = text(p.name) || address.split(",")[0];
    if (!name || !VALID_POINT(point) || p.lat === null || p.lon === null) return [];
    const osmType = text(p.osm_type, 20), type = text(p.type, 60), category = text(p.category ?? p.class, 60);
    const addressType = text(p.addresstype, 60);
    return [{ id: "osm:" + osmType + ":" + String(p.osm_id ?? p.place_id ?? point.join(",")), name, address,
      point, source: "OpenStreetMap", osmType, type, category, addressType }];
  });
}
function present(value) {
  return value && typeof value === "object" && Object.keys(value).length > 0;
}
function railClock(value) {
  if (typeof value !== "string" || !/^\d{1,2}:?[0-5]\d$/u.test(value)) return null;
  const time = value.replace(":", "");
  const hours = Number(time.slice(0, -2)), minutes = Number(time.slice(-2));
  return hours <= 71 ? { minutes: hours * 60 + minutes, label: `${String(hours).padStart(2, "0")}:${time.slice(-2)}` } : null;
}
function railStep(railway) {
  const trip = text(railway.trip, 24), name = text(railway.name);
  const from = text(railway.departure_stop?.name), to = text(railway.arrival_stop?.name);
  if ((!trip && !name) || !from || !to) return null;
  const departure = railClock(railway.departure_stop?.time), arrival = railClock(railway.arrival_stop?.time);
  const scheduled = departure && arrival && arrival.minutes >= departure.minutes ? (arrival.minutes - departure.minutes) * 60 : null;
  return { type: "rail", name: trip || name, from, to, meters: numeric(railway.distance),
    seconds: numeric(railway.cost?.duration ?? railway.duration) ?? scheduled,
    ...(departure && { departureTime: departure.label }), ...(arrival && { arrivalTime: arrival.label }),
    sections: geometry(railway.polyline) };
}
export function amapTransitAlternatives(payload) {
  const options = Array.isArray(payload?.route?.transits) ? payload.route.transits.slice(0, 10) : [];
  return options.flatMap(option => {
    const seconds = numeric(option?.cost?.duration ?? option?.duration), meters = numeric(option?.distance);
    if (seconds === null || meters === null || !Array.isArray(option.segments)) return [];
    const steps = [];
    for (const segment of option.segments) {
      if (!segment || present(segment.taxi)) return [];
      const walking = segment.walking;
      if (present(walking) && numeric(walking.distance) > 0) {
        const sections = (Array.isArray(walking.steps) ? walking.steps : []).flatMap(step => geometry(step?.polyline));
        steps.push({ type: "walk", name: "步行", from: steps.at(-1)?.to || "", to: "", meters: numeric(walking.distance),
          seconds: numeric(walking.cost?.duration ?? walking.duration), sections: sections.length ? sections : geometry(walking.polyline) });
      }
      const rides = [];
      if (present(segment.bus)) {
        const ride = Array.isArray(segment.bus.buslines) ? segment.bus.buslines.find(line => text(line?.name)) : null;
        if (!ride) return [];
        const name = text(ride.name), type = /地铁|磁悬浮|轨道/u.test(text(ride.type) + name) ? "metro" : "bus";
        const via = numeric(ride.via_num);
        rides.push({ type, name, from: text(ride.departure_stop?.name), to: text(ride.arrival_stop?.name), towards: text(ride.final_station),
          meters: numeric(ride.distance), seconds: numeric(ride.cost?.duration ?? ride.duration),
          sections: geometry(ride.polyline), stopCount: via === null ? null : via + 1 });
      }
      if (present(segment.railway)) {
        const ride = railStep(segment.railway);
        if (!ride) return [];
        rides.push(ride);
      }
      if (rides.length && steps.at(-1)?.type === "walk") steps.at(-1).to = rides[0].from;
      steps.push(...rides);
    }
    return steps.some(step => step.type !== "walk") ? [{ meters, seconds, source: "高德公交规划", estimated: true, steps }] : [];
  });
}
export function amapTransitLeg(payload) {
  return amapTransitAlternatives(payload)[0] ?? null;
}
