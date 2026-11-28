import rail from "./chengdu-rail.json" with { type: "json" };

// Planning assumptions, not published service frequencies or stop timetables.
const TRANSFER_SECONDS = 180;
const METRO_WAIT = 180;
const BUS_WAIT = 300;
const ACCESS_LIMIT_METERS = 1500;
const riding = s => s.type==="bus" || s.type==="metro";
const waitTime = step => step.type==="bus"?BUS_WAIT:METRO_WAIT;
export const distance = ([a,b],[x,y])=>Math.hypot((a-x)*111195,(b-y)*111195*Math.cos((a+x)*Math.PI/360));
const outgoing = rail.stations.map(()=>[]);
for(const [serviceIndex,service] of rail.services.entries()) {
  for(const [from,to,meters,line] of service.edges){
    // A metro vehicle averages about 35 km/h including stops. Short hops
    // retain a one-minute allowance for acceleration and station dwell.
    const seconds=Math.max(60,Math.round(meters / (35000/3600)));
    outgoing[from].push({to,serviceIndex,meters,seconds,line});
  }
}

function nearStations(p) {
  return rail.stations.map((s,id)=>({id,meters:distance(p,s.point)}))
    .filter(s=>outgoing[s.id].length && s.meters<=ACCESS_LIMIT_METERS)
    .sort((a,b)=>a.meters-b.meters).slice(0,4);
}

export function estimatedAccess(meters,from,to) {
  if(meters<9)return [];
  // No street path is present for arbitrary map pins. Give only a rough
  // distance and time. An empty section list prevents a fake route on the map.
  const estimatedMeters=Math.round(meters*1.35);
  return [{type:"walk",name:"步行接驳（估算）",from,to,meters:estimatedMeters,seconds:Math.round(estimatedMeters/1.2),sections:[],geometryEstimated:true}];
}

function withTimes(steps,source) {
  const detailed=[];
  let rides=0;
  for(const [i,step] of steps.entries()) {
    if(step.type==="transfer") {
      detailed.push({...step,name:"站内换乘",meters:0,seconds:TRANSFER_SECONDS,sections:[],estimated:true});
      continue;
    }
    if(riding(step)) {
      rides++;
      if(rides>1 && riding(steps[i-1]))detailed.push({type:"transfer",name:"站内换乘",from:step.from,to:step.from,meters:0,seconds:TRANSFER_SECONDS,sections:[],estimated:true});
      detailed.push({type:"wait",name:"预计候车",from:step.from,to:step.from,meters:0,seconds:waitTime(step),sections:[],estimated:true});
    }
    detailed.push({...step,estimated:true});
  }
  const sum=pred=>detailed.filter(pred).reduce((n,s)=>n+(s.seconds??0),0);
  const rideSeconds=sum(riding),walkSeconds=sum(s=>s.type==="walk"),waitSeconds=sum(s=>s.type==="wait"),transferSeconds=sum(s=>s.type==="transfer");
  return {meters:detailed.reduce((n,s)=>n+(s.meters||0),0),seconds:rideSeconds+walkSeconds+waitSeconds+transferSeconds,rideSeconds,walkSeconds,waitSeconds,transferSeconds,estimated:true,source,steps:detailed};
}

export function timedKnownLeg(leg) { return withTimes(leg.steps,"成都离线公交地铁 · 估算"); }

export function cityRailLeg(from,to) {
  if(distance(from,to)<8)return null;
  const starts=nearStations(from), ends=nearStations(to);
  if(!starts.length||!ends.length)return null;
  const targets=new Map(ends.map(e=>[e.id,e.meters]));
  const frontier=[], best=new Map();
  let solution=null;
  function push(entry) {
    const key=entry.id+"/"+entry.service;
    if(entry.cost >= (best.get(key)??Infinity))return;
    best.set(key,entry.cost);frontier.push({...entry,key});
  }
  for(const s of starts)push({id:s.id,service:-1,cost:Math.round(s.meters*1.35/1.2),start:s,previous:null,edge:null});
  while(frontier.length) {
    frontier.sort((a,b)=>b.cost-a.cost);
    const curr=frontier.pop();
    if(curr.cost!==best.get(curr.key))continue;
    if(solution && curr.cost>=solution.total)break;
    if(targets.has(curr.id) && (curr.edge || distance(from,to)<=ACCESS_LIMIT_METERS)) {
      const total=curr.cost+Math.round(targets.get(curr.id)*1.35/1.2);
      if(!solution||total<solution.total)solution={end:curr,total,lastMeters:targets.get(curr.id)};
    }
    for(const edge of outgoing[curr.id]){
      const change=edge.serviceIndex!==curr.service;
      const extra=change?METRO_WAIT+(curr.service===-1?0:TRANSFER_SECONDS):0;
      push({id:edge.to,service:edge.serviceIndex,cost:curr.cost+extra+edge.seconds,previous:curr,edge,start:curr.start});
    }
  }
  if(!solution)return null;
  const path=[];
  for(let e=solution.end;e.edge;e=e.previous)path.push(e);
  if(!path.length){
    const direct=distance(from,to);
    return direct<=ACCESS_LIMIT_METERS? withTimes(estimatedAccess(direct,"起点","终点"),"邻近地点步行 · 估算"):null;
  }
  const name=id=>rail.stations[id].name.endsWith("站")?rail.stations[id].name:rail.stations[id].name+"站";
  const steps=estimatedAccess(solution.end.start.meters,"起点",name(solution.end.start.id));
  let lastService=-1;
  for(const e of path.reverse()){
    const service=rail.services[e.service];
    if(e.service===lastService){
      const prev=steps.at(-1);
      prev.to=name(e.id); prev.meters+=e.edge.meters; prev.seconds+=e.edge.seconds; prev.sections.push(e.edge.line);prev.stopCount++;
    }else{
      steps.push({type:"metro",name:service.name,towards:service.towards,from:name(e.previous.id),to:name(e.id),meters:e.edge.meters,seconds:e.edge.seconds,stopCount:1,sections:[e.edge.line]});
    }
    lastService=e.service;
  }
  steps.push(...estimatedAccess(solution.lastMeters,name(solution.end.id),"终点"));
  return withTimes(steps,"成都离线地铁 · 估算");
}
