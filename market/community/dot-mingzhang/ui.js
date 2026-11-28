// Runs inside the signed package's opaque frame. All persistent values belong to this block.
function mountDotWidget(start, height) {
  const channel = 'life-atlas.widget.v1';
  let revision = -1, sequence = 0, pending = null, dirty = false, locked = false;
  let state = {}, started = false;
  const send = (type, more = {}) => parent.postMessage({ channel, type, ...more }, '*');
  function flush() {
    if (locked || pending !== null || !dirty) return;
    dirty = false;
    pending = ++sequence;
    send('commit', { id: pending, base: revision, state });
  }
  function save(key, value) {
    if (locked || state[key] === value) return;
    const next = { ...state, [key]: value };
    if (new TextEncoder().encode(JSON.stringify(next)).length > 1048576) throw Error('组件记录超过 1 MiB，页面保留了上一次保存的记录。');
    state = next;
    dirty = true;
    flush();
  }
  const storage = { getItem: key => state[key] ?? null, setItem: (key, value) => save(key, String(value)),
    removeItem: key => { if (Object.hasOwn(state, key)) { delete state[key]; dirty = true; flush(); } } };
  window.addEventListener('message', event => {
    const msg = event.data;
    if (event.source !== parent || msg?.channel !== channel || msg.type !== 'context' ||
        !Number.isSafeInteger(msg.revision) || msg.revision < revision) return;
    const ack = pending !== null && msg.ack?.id === pending;
    // An external edit (including Undo) must replace the contents in the widget itself.
    const external = started && msg.revision !== revision && !ack &&
        JSON.stringify(msg.state) !== JSON.stringify(state);
    revision = msg.revision;
    if (external || (ack && !msg.ack.accepted)) {
      location.reload();
      return;
    }
    if (ack) pending = null;
    locked = Boolean(msg.locked);
    document.body.inert = locked;
    if (!started) {
      started = true;
      state = { ...msg.state };
      document.documentElement.dataset.theme = msg.theme;
      start({ storage, save, get: key => state[key], context: msg });
    }
    flush();
    if (height !== null) send('height', { height: height || Math.max(260, document.body.scrollHeight) });
  });
  // A sandboxed form has no navigation permission. Dispatch only its local submit handler.
  document.addEventListener('click', event => {
    const button = event.target.closest?.('button, input[type=submit]');
    const form = button?.form;
    if (event.defaultPrevented || button?.type !== 'submit' || !form || button.disabled) return;
    event.preventDefault();
    if (form.reportValidity()) form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: button }));
  });
  send('ready');
}

function setDotTheme(theme) {
  const scheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = scheme;
  document.documentElement.style.colorScheme = scheme;
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.content = scheme;
}

function observeDotSurface(surface, initialContext, updateTheme) {
  const channel = 'life-atlas.widget.v1';
  let viewportHeight = 800, lastHeight, request;
  function measure() {
    request = undefined;
    const bounds = surface.getBoundingClientRect();
    const openDialog = Array.from(document.querySelectorAll('dialog[open]')).at(-1);
    let height = Math.ceil(bounds.bottom);
    if (openDialog) {
      const desired = openDialog.scrollHeight + 36;
      height = Math.max(height, Math.min(viewportHeight, desired));
    }
    if (height === lastHeight) return;
    lastHeight = height;
    parent.postMessage({ channel, type: 'height', height }, '*');
  }
  function schedule() {
    if (request === undefined) request = requestAnimationFrame(measure);
  }
  function apply(context) {
    if (Number.isFinite(context.viewportHeight) && context.viewportHeight > 0) {
      viewportHeight = context.viewportHeight;
    }
    updateTheme?.(context.theme);
    schedule();
  }
  const size = new ResizeObserver(schedule);
  size.observe(surface);
  const dialogs = new MutationObserver(schedule);
  dialogs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  window.addEventListener('message', event => {
    if (event.source === parent && event.data?.channel === channel && event.data.type === 'context') apply(event.data);
  });
  window.addEventListener('pagehide', () => {
    size.disconnect();
    dialogs.disconnect();
    cancelAnimationFrame(request);
  }, { once: true });
  apply(initialContext);
}

mountDotWidget(({storage,context})=>{
document.getElementById("root").innerHTML="<main class=\"shell\" id=\"app\" aria-labelledby=\"ledger-title\">\n  <header class=\"ledger-header\">\n    <div><h1 id=\"ledger-title\">明账</h1><p id=\"mode\" class=\"ledger-mode\"></p></div>\n    <div class=\"row ledger-options\">\n      <button class=\"mini bare\" id=\"switchData\" type=\"button\"></button>\n      <button class=\"mini bare\" id=\"theme\" type=\"button\"></button>\n    </div>\n  </header>\n  <div class=\"ledger-period row between\" id=\"ledger-period\">\n    <div class=\"row period\" aria-label=\"账本月份\">\n      <button id=\"previous-month\" class=\"month-step\" type=\"button\" aria-label=\"上个月\">‹</button>\n      <input id=\"report-month\" type=\"month\" aria-label=\"账本月份\" min=\"1900-01\" max=\"9999-11\">\n      <button id=\"next-month\" class=\"month-step\" type=\"button\" aria-label=\"下个月\">›</button>\n      <button id=\"current-month\" class=\"mini bare\" type=\"button\">本月</button>\n    </div>\n    <div class=\"row ledger-actions\" id=\"ledger-actions\">\n      <button id=\"newincome\" type=\"button\">记收入</button><button class=\"primary\" id=\"newexpense\" type=\"button\">记支出</button>\n    </div>\n  </div>\n  <section aria-label=\"收支概览\" class=\"summary\" id=\"summary\"></section>\n  <nav aria-label=\"账本视图\" class=\"ledger-nav\" id=\"tabs\"></nav>\n  <section class=\"screen\" id=\"screen\"></section>\n  <details class=\"ledger-notes\"><summary>账本数据说明</summary><p>我的账本和演示账本分开保存。按本机日期统计，预计扣费需确认后才计入支出，储蓄存取按内部转账处理。</p></details>\n</main>\n<dialog aria-label=\"账目表单\" id=\"dialog\"><form id=\"form\"></form></dialog>\n<div class=\"toast\" id=\"toast\" role=\"status\"></div>\n";
function atlasConfirm(message) {
      return new Promise(resolve => {
        const dialog = document.createElement('dialog'), text = document.createElement('p');
        text.textContent = message; dialog.append(text);
        for(const [label,value] of [['取消','cancel'],['确认','ok']]){
          const button=document.createElement('button');button.type='button';button.textContent=label;
          button.onclick=()=>dialog.close(value);dialog.append(button);
        }
        dialog.onclose=()=>{resolve(dialog.returnValue==='ok');dialog.remove();};
        document.body.append(dialog);dialog.showModal();
      });
    }

(function(rootAPI){
'use strict';
const PALETTE=['--fc-cat1','--fc-cat2','--fc-cat3','--fc-cat4','--fc-cat5','--fc-cat6'];
const monthRE=/^\d{4}-(0[1-9]|1[0-2])$/;
const dateRE=/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
function monthOffset(month,n){const [y,m]=month.split('-').map(Number);const d=new Date(Date.UTC(y,m-1+n,1));return d.toISOString().slice(0,7)}
const entries=(data,positive)=>Array.isArray(data)?data.filter(x=>x&&Number.isSafeInteger(x.cents)&&(!positive||x.cents>0)&&typeof x.date==='string'&&dateRE.test(x.date)):[];
const total=a=>a.reduce((v,x)=>v+x.cents,0);
function financeModel(input){
 const month=input.month;
 if(typeof month!=='string'||!monthRE.test(month))throw new RangeError('Invalid report month');
 const inc=entries(input.income,true), exp=entries(input.expenses,true), save=entries(input.savings,false);
 const limit=monthOffset(month,1);
 const allGoals=Array.isArray(input.goals)?input.goals.filter(g=>g&&typeof g.id==='string'):[];
 const points=Array.from({length:6},(_,i)=>monthOffset(month,i-5)).map(m=>{
  const filter=x=>x.date.startsWith(m);
  const income=total(inc.filter(filter)),expense=total(exp.filter(filter)),saving=total(save.filter(filter));
  return {month:m,income,expense,saving,net:income-expense,available:income-expense-saving};
 });
 const categories=new Map();
 for(const row of exp.filter(x=>x.date.startsWith(month))){
   const k=typeof row.cat==='string'&&row.cat.trim()?row.cat.trim():'未分类';
   categories.set(k,(categories.get(k)||0)+row.cents);
 }
 const sorted=[...categories.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'zh-CN'));
 const slices=sorted.length<=6?sorted:[...sorted.slice(0,5),['其余类别',sorted.slice(5).reduce((v,x)=>v+x[1],0)]];
 const goals=allGoals.map(g=>({name:g.name||'未命名目标',target:Number.isSafeInteger(g.targetCents)&&g.targetCents>0?g.targetCents:(Number.isSafeInteger(g.target)&&g.target>0?g.target:0),balance:total(save.filter(x=>(x.goalId??x.goal)===g.id&&x.date<limit))}));
 return {month,points,slices,goals,selected:points.at(-1)};
}
const E=(t,c,s)=>{const n=document.createElement(t);if(c)n.className=c;if(s!=null)n.textContent=s;return n};
const row=(c,...nodes)=>{const n=E('div',c);n.append(...nodes);return n};
const full=new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY',minimumFractionDigits:2});
const money=n=>full.format(n/100);
const percent=(x,max)=>max>0?Math.round(100*x/max):0;
const short=n=>{n/=100;return n>=10000?+(n/10000).toFixed(1)+'万':n>=1000?+(n/1000).toFixed(1)+'千':String(+n.toFixed(2))};
const svgNS='http://www.w3.org/2000/svg';
function S(tag,attrs={},text){const e=document.createElementNS(svgNS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));if(text!=null)e.textContent=text;return e}
function STitle(svg,text){svg.append(S('title',{},text));svg.setAttribute('role','img');svg.setAttribute('aria-label',text)}
function title(name,note){const e=E('header','fc-head');e.append(E('h2','',name),E('p','',note));return e}
const caption=(n,v)=>row('fc-kpi',E('span','',n),E('strong','',money(v)));
const chartPanel=(name,note)=>{const n=E('section','fc-panel');n.append(title(name,note));return n};
function swatch(text,cl){const lc=E('span','fc-key '+cl);lc.append(E('i'),E('span','',text));return lc}
function trendPanel(m){
 const p=chartPanel('六个月收支','只统计已记录的收入和消费，储蓄划转不计入消费。');
 p.classList.add('fc-trend-panel');
 const k=m.points;
 if(!k.some(x=>x.income||x.expense)){p.append(E('p','fc-empty','过去六个月没有收支记录。录入第一笔收入或消费后显示趋势。'));return p}
 const high=Math.max(4,...k.flatMap(x=>[x.income,x.expense]));
 const raw=high/4, mag=10**Math.floor(Math.log10(raw)), step=[1,2,2.5,5,10].map(x=>x*mag).find(x=>x>=raw), max=step*4;
 const w=590,h=211, left=63, right=16, b=173, top=15, plot=b-top, ww=(w-left-right)/6;
 const svg=S('svg',{viewBox:'0 0 '+w+' '+h,class:'fc-svg fc-trend'});STitle(svg,'六个月实收与实付并列柱图');
 for(let i=0;i<=4;i++){const y=b-plot*i/4;svg.append(S('line',{x1:left,y1:y,x2:w-right,y2:y,class:'fc-gridline'}),S('text',{x:left-8,y:y+4,'text-anchor':'end',class:'fc-axis'},i===0?'0':short(i*step)))}
 k.forEach((x,i)=>{
  const cx=left+ww*(i+.5), key=x.month;
  if(i===k.length-1)svg.append(S('rect',{x:cx-ww*.43,y:top-3,width:ww*.86,height:plot+5,rx:5,class:'fc-selected-month'}));
  for(const [v,sub,name] of [[x.income,'in','实收'],[x.expense,'out','实付']]){
   const hh=v/max*plot; const r=S('rect',{x:cx+(sub==='in'?-16:3),y:b-hh,width:13,height:hh,rx:2,class:'fc-bar '+sub});
   r.append(S('title',{},key+' '+name+' '+money(v)));if(v)svg.append(r);
  }
  svg.append(S('text',{x:cx,y:b+19,'text-anchor':'middle',class:'fc-axis'+(i===5?' focus':'')},Number(key.slice(5))+'月'));
 });
 const label=row('fc-legend',swatch('实收','income'),swatch('实付','expense'),E('span','fc-unit','单位：元'));
 p.append(svg,label);
 const dt=E('details','fc-exact'), sm=E('summary','','查看逐月明细'), tb=E('table'), head=E('thead'), hr=E('tr');
 for(const name of ['月份','实收','实付','收支差额'])hr.append(E('th','',name));
 head.append(hr);const tbody=E('tbody');
 for(const x of [...k].reverse()){const tr=E('tr');for(const val of [x.month,money(x.income),money(x.expense),money(x.net)])tr.append(E('td','',val));tbody.append(tr)}
 tb.append(head,tbody);dt.append(sm,tb);p.append(dt);return p;
}
function categoryPanel(m){
 const n=m.selected.expense,p=chartPanel('钱花在哪','当月实付按类别拆分，不含尚未确认的扣费。');
 if(!n){p.append(E('p','fc-empty','本月没有支出记录。记下第一笔消费后显示分布。'));return p}
 const svg=S('svg',{viewBox:'0 0 144 144',class:'fc-donut'});STitle(svg,'本月支出类别环形图');
 svg.append(S('circle',{cx:72,cy:72,r:55,fill:'none','stroke-width':15,class:'fc-ring-base'}));
 let progress=0;const items=E('ol','fc-category');
 for(const [i,[name,value]] of m.slices.entries()){
  const fraction=value/n*100, c=PALETTE[i];
  const circle=S('circle',{cx:72,cy:72,r:55,fill:'none','stroke-width':15,pathLength:100,transform:'rotate(-90 72 72)','stroke-dasharray':fraction+' '+(100-fraction),'stroke-dashoffset':-progress,style:'stroke:var('+c+')'});
  circle.append(S('title',{},name+' '+money(value)));svg.append(circle);progress+=fraction;
  const li=E('li'), dot=E('i','fc-dot');dot.style.background='var('+c+')';
  li.append(dot,E('span','fc-cat-name',name),E('strong','',money(value)),E('small','',percent(value,n)+'%'));items.append(li);
 }
 const core=row('fc-ring',svg,row('fc-ring-text',E('span','','实付合计'),E('strong','',money(n))));
 p.append(row('fc-composition',core,items));return p;
}
function cashPanel(m){
 const s=m.selected, p=chartPanel('本月现金流','只看本月变化，不是账户余额。储蓄划转不改变收支差额。');
 p.classList.add('fc-cash-panel');
 const amounts=[['实际收入',s.income,'income'],['实际消费',-s.expense,'expense'],['储蓄净划转',-s.saving,'saving']];
 const totalRows=E('div','fc-flow');
 const max=Math.max(1,...amounts.map(x=>Math.abs(x[1])),Math.abs(s.available));
 for(const [label,v,c] of amounts){
   const bar=E('span','fc-flow-track'),fill=E('i','fc-flow-fill '+c);fill.style.width=100*Math.abs(v)/max+'%';bar.append(fill);
   totalRows.append(row('fc-flow-row',E('span','',label),bar,E('strong','',v>0?'+'+money(v):money(v))));
 }
 p.append(totalRows,row('fc-net',caption('收支差额',s.net),caption('扣除储蓄划转后的现金变动',s.available)));
 return p;
}
function goalPanel(m){
 const p=chartPanel('储蓄目标进度','截至所选月末的累计净存入，取出会从目标余额扣回。');
 p.classList.add('fc-goal-panel');
 if(!m.goals.length){p.append(E('p','fc-empty','还没有储蓄目标。新建一个目标后，这里会显示进度。'));return p}
 const list=E('div','fc-goals');for(const g of m.goals){
 const px=percent(g.balance,g.target), lane=E('div','fc-goal-track'),bar=E('i');bar.style.width=Math.max(0,Math.min(100,px))+'%';lane.append(bar);
 const txt=g.target?money(g.balance)+' / '+money(g.target)+' · '+px+'%':money(g.balance);
 const header=row('fc-goal-label',E('strong','',g.name),E('span','',txt));
 list.append(row('fc-goal',header,lane));}
 p.append(list);return p;
}
function renderFinanceCharts(target,input){
 const model=financeModel(input), charts=row('fc-grid',trendPanel(model),categoryPanel(model),cashPanel(model),goalPanel(model));
 target.replaceChildren(charts);
}
rootAPI.renderFinanceCharts=renderFinanceCharts;
if(typeof module!=='undefined')module.exports={financeModel,monthOffset,renderFinanceCharts};
})(globalThis);


'use strict';
const $=s=>document.querySelector(s);
const h=(t,c,s)=>{const n=document.createElement(t);if(c)n.className=c;if(s!=null)n.textContent=s;return n};
const wrap=(c,...nodes)=>{const n=h('div',c);n.append(...nodes);return n};
const b=(s,fn,c)=>{const n=h('button',c,s);n.type='button';n.onclick=fn;return n};
const query=new URLSearchParams({embed:'1'}), suffix=(query.get('id')||'default').slice(0,70), prefix='mingzhang-v1:'+suffix+':';
if(query.get('embed')==='1')document.documentElement.classList.add('embed');
const read=(key,fallback)=>{try{return JSON.parse(storage.getItem(prefix+key))??fallback}catch{return fallback}};
const write=(key,item)=>{try{storage.setItem(prefix+key,JSON.stringify(item));return true}catch{return false}};
const newId=()=>globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
const pad=n=>String(n).padStart(2,'0'), local=d=>[d.getFullYear(),pad(d.getMonth()+1),pad(d.getDate())].join('-');
const utc=(y,m,d)=>new Date(Date.UTC(y,m,d));
const key=d=>d.toISOString().slice(0,10);
const from=s=>new Date(s+'T00:00:00Z'), plus=(d,n)=>utc(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+n);
const DAY_MS=86400000, days=(a,b)=>Math.round((a-b)/DAY_MS);
const month=(d,off=0)=>utc(d.getUTCFullYear(),d.getUTCMonth()+off,1), short=s=>Number(s.slice(5,7))+'月'+Number(s.slice(8))+'日';
const ym=d=>key(d).slice(0,7);
const today=()=>from(local(new Date())), fmt=v=>'¥'+(v/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const sum=rows=>rows.reduce((a,x)=>a+x.cents,0);
const cycles={weekly:'每周',monthly:'每月',annual:'每年'}, catList=['餐饮','通勤','学习','日用','娱乐','其他'];
const incomeCats=['工资','奖金','自由职业','报销','礼金','其他'];
function blank(){return {subs:[],expenses:[],income:[],goals:[],savings:[]}}
function migrate(raw,mode,t){
 const empty=mode==='demo'?seed(t):blank(), source=raw&&typeof raw==='object'?raw:{};
 return {...source,...Object.fromEntries(['subs','expenses','income','goals','savings'].map(k=>[k,Array.isArray(source[k])?source[k]:empty[k]]))};
}
function seed(t){
 const ds=n=>key(plus(t,n));
 const start=(m,d)=>key(utc(t.getUTCFullYear(),t.getUTCMonth()+m,d));
 return {subs:[
 {id:'cloud',name:'iCloud+',cents:2100,interval:'monthly',start:ds(3),paused:false},
 {id:'music',name:'音乐会员',cents:1500,interval:'monthly',start:ds(9),paused:false},
 {id:'domain',name:'独立站域名',cents:7800,interval:'annual',start:ds(24),paused:false},
 {id:'note',name:'笔记同步',cents:3900,interval:'monthly',start:start(-2,Math.min(25,t.getUTCDate())),paused:false}],
 expenses:[
 {id:'exp-a',name:'笔记同步',cents:3900,date:key(t),cat:'订阅',ref:'note@'+start(0,Math.min(25,t.getUTCDate()))},
 {id:'exp-b',name:'咖啡和午餐',cents:4600,date:key(t),cat:'餐饮'},
 {id:'exp-c',name:'买书',cents:6800,date:key(t),cat:'学习'},
 {id:'exp-d',name:'地铁',cents:1400,date:start(0,Math.max(1,t.getUTCDate()-3)),cat:'通勤'},
 {id:'exp-e',name:'超市补给',cents:18320,date:start(0,Math.max(1,t.getUTCDate()-5)),cat:'日用'},
 {id:'exp-f',name:'电影票',cents:4800,date:start(0,Math.max(1,t.getUTCDate()-6)),cat:'娱乐'},
 {id:'exp-g',name:'社区食堂',cents:6650,date:start(-1,18),cat:'餐饮'},
 {id:'exp-h',name:'月末补货',cents:20300,date:start(-1,25),cat:'日用'}],
 income:[
 {id:'inc-a',name:'本月工资',cents:860000,date:start(0,Math.min(5,t.getUTCDate())),cat:'工资'},
 {id:'inc-b',name:'项目稿费',cents:128000,date:start(0,Math.max(1,t.getUTCDate()-9)),cat:'自由职业'},
 {id:'inc-c',name:'上月工资',cents:860000,date:start(-1,5),cat:'工资'},
 {id:'inc-d',name:'差旅报销',cents:26000,date:start(-1,22),cat:'报销'}],
 goals:[{id:'goal-emergency',name:'应急储备',targetCents:3000000},{id:'goal-trip',name:'川西旅行',targetCents:620000}],
 savings:[
 {id:'sav-a',goalId:'goal-emergency',cents:780000,date:start(-2,8),memo:'初始积累'},
 {id:'sav-b',goalId:'goal-emergency',cents:120000,date:start(0,Math.min(6,t.getUTCDate())),memo:'本月转入'},
 {id:'sav-c',goalId:'goal-trip',cents:220000,date:start(-1,16),memo:'旅行先存一笔'},
 {id:'sav-d',goalId:'goal-trip',cents:80000,date:start(0,Math.min(12,t.getUTCDate())),memo:'机酒预算'},
 {id:'sav-e',goalId:'goal-trip',cents:-25000,date:start(0,Math.min(19,t.getUTCDate())),memo:'退回机动资金'}]};
}
let dataMode=query.get('demo')==='0'?'real':read('mode',context.demonstration?'demo':'real');
let ledger=migrate(read(dataMode,null),dataMode,today());
let active=['calendar','ledger','savings','charts','subs'].includes(query.get('tab'))?query.get('tab'):'charts', date=key(today()), view=month(today()), flowFilter='all', goalFilter='all';
let theme = read('theme', null);
let hostTheme = context.theme;
function setTheme() {
  setDotTheme(theme ?? hostTheme);
  $('#theme').textContent = theme ? '跟随应用' : hostTheme === 'dark' ? '切换浅色' : '切换深色';
  $('#theme').setAttribute('aria-pressed', String(Boolean(theme)));
}
$('#theme').onclick = () => {
  theme = theme ? null : hostTheme === 'dark' ? 'light' : 'dark';
  write('theme', theme);
  setTheme();
};
observeDotSurface($('#app'), context, nextTheme => { hostTheme = nextTheme; setTheme(); });
$('#newexpense').onclick=()=>editExpense(date<=key(today())?date:key(today()));
$('#newincome').onclick=()=>editIncome(date<=key(today())?date:key(today()));
$('#previous-month').onclick = () => dateChange(month(view, -1));
$('#next-month').onclick = () => dateChange(month(view, 1));
$('#current-month').onclick = () => { const t = today(); view = month(t); date = key(t); render(); };
$('#report-month').onchange = event => {
  const value = event.currentTarget.value;
  if (/^\d{4}-\d{2}$/.test(value) && value >= '1900-01' && value <= '9999-11' && validDate(value+'-01')) dateChange(from(value+'-01'));
  else event.currentTarget.value = ym(view);
};
$('#switchData').onclick=()=>{dataMode=dataMode==='demo'?'real':'demo';write('mode',dataMode);date=key(today());view=month(today());ledger=migrate(read(dataMode,null),dataMode,today());goalFilter='all';render()};
let toastTimer;
function notify(msg){$('#toast').textContent=msg;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').textContent='',3300)}
function persist(msg){const ok=write(dataMode,ledger);render();if(!ok)notify('浏览器未允许保存，当前改动仅本次有效');else if(msg)notify(msg)}
function nextDate(start,interval,n){
 const s=from(start), y=s.getUTCFullYear(), m=s.getUTCMonth(), d=s.getUTCDate();
 if(interval==='weekly')return plus(s,n*7);
 const next=utc(y,m+(interval==='annual'?n*12:n),1);
 return plus(next,Math.min(d,utc(next.getUTCFullYear(),next.getUTCMonth()+1,0).getUTCDate())-1);
}
function upcoming(subs, expenses, a, z){
 const settled=new Set(expenses.flatMap(x=>x.ref?[x.ref]:[])), results=[];
 for(const s of subs){
  if(s.paused)continue;
  const start=from(s.start);
  if(start>z)continue;
  const m=(a.getUTCFullYear()-start.getUTCFullYear())*12+a.getUTCMonth()-start.getUTCMonth();
  let n=Math.max(0,s.interval==='weekly'?Math.floor(days(a,start)/7):s.interval==='annual'?Math.floor(m/12):m);
  for(let runs=0;runs<60;runs++,n++){
   const occur=nextDate(s.start,s.interval,n);
   if(occur>z)break;
   if(occur<a)continue;
   const d=key(occur), ref=s.id+'@'+d;
   if(!settled.has(ref))results.push({cents:s.cents,date:d,name:s.name,ref,sub:s.id});
  }
 }
 return results.sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name,'zh'));
}
function validDate(v){return /^\d{4}-\d\d-\d\d$/.test(v)&&!isNaN(+from(v))&&key(from(v))===v}
function recordActual(x){
 if(x.ref&&ledger.expenses.some(v=>v.ref===x.ref&&v.id!==x.id))return false;
 const at=ledger.expenses.findIndex(v=>v.id===x.id);
 if(at<0)ledger.expenses.push(x);else ledger.expenses[at]=x;
 return true;
}
function chooseView(viewKey) {
 active = viewKey;
 render();
 $('#tabs').querySelector('[aria-pressed="true"]')?.focus();
}
function sections(host, items, selected) {
 if (!host.children.length) host.replaceChildren(...items.map(([value, label]) => {
  const control = b(label, () => chooseView(value));
  control.dataset.view = value;
  return control;
 }));
 for (const control of host.children) control.setAttribute('aria-pressed', String(control.dataset.view === selected));
}
function panel(head,right){const box=h('section','panel');box.append(wrap('row between panel-title',h('h2','',head),...(right?[right]:[])));return box}
function metric(label,cents,cl,desc){return wrap('',h('small','',label),h('strong','num '+cl,fmt(cents)),h('small','desc',desc))}
function entry(x,type,{showDate=false}={}){
 const n=h('li','entry'), left=wrap('',h('div','title',x.name),h('div','info',(showDate?short(x.date)+' · ':'')+(type==='future'?'预计扣费':x.cat+(x.ref?' · 手动确认':''))));
 const cls=type==='future'?'near':type==='income'?'paid':'outflow', mark=type==='income'?'+':type==='actual'?'−':'';
 const amt=h('span','num amount '+cls,mark+fmt(x.cents));
 n.append(wrap('row between',left,amt));
 const act=type==='future'?b('确认已扣费',()=>settle(x)):type==='income'?b('编辑',()=>editIncome(x.date,x)):b('编辑',()=>editExpense(x.date,x));
 n.append(wrap('act',act));return n;
}
function listing(xs,type,empty,opt){const ul=h('ul','list');if(xs.length)ul.append(...xs.map(x=>entry(x,type,opt)));else ul.append(h('li','empty',empty));return ul}
function goalBalance(goalId,logs=ledger.savings){return sum(logs.filter(x=>x.goalId===goalId))}
function monthRows(rows){return rows.filter(x=>x.date.startsWith(ym(view)))}
function render(){
 const t=today(), projected=upcoming(ledger.subs,ledger.expenses,t,plus(t,29));
 const expenses=monthRows(ledger.expenses), income=monthRows(ledger.income), cash=sum(income)-sum(expenses);
 $('#mode').textContent=dataMode==='demo'?'演示数据':'本地账本';
 $('#switchData').textContent=dataMode==='demo'?'返回我的账本':'查看演示';
 $('#report-month').value = ym(view);
 $('#previous-month').disabled = ym(view) <= '1900-01';
 $('#next-month').disabled = ym(view) >= '9999-11';
 $('#summary').replaceChildren(metric('本月结余',cash,cash<0?'near':'paid','收入减支出'),metric('实际收入',sum(income),'paid','已登记 '+income.length+' 笔'),metric('实际支出',sum(expenses),'outflow','已登记 '+expenses.length+' 笔'),metric('未来 30 天扣费',sum(projected),'near','待确认 '+projected.length+' 笔'));
 sections($('#tabs'),[['charts','报表'],['ledger','收支'],['calendar','日历'],['savings','储蓄'],['subs','订阅']],active);
 const screen = $('#screen');
 const actions = $('#ledger-actions');
 const period = $('#ledger-period');
 screen.classList.toggle('full',active==='charts');
 if (active === 'charts' && ![ledger.income, ledger.expenses, ledger.subs, ledger.goals, ledger.savings].some(rows => rows.length)) {
  const start = h('section','ledger-start');
  const heading = h('h2','','记下第一笔收支');
  heading.id = 'ledger-start-title';
  start.setAttribute('aria-labelledby', heading.id);
  start.append(wrap('', heading, h('p','','记账后可查看月度收支、分类与现金流。')), actions);
  screen.replaceChildren(start);
  return;
 }
 if (actions.parentElement !== period) period.append(actions);
 if(active==='calendar')renderCalendar(t,projected);
 else if(active==='ledger')renderLedger(t,income,expenses);
 else if(active==='savings')renderSavings(t);
 else if(active==='charts')renderCharts(t);
 else renderSubs(t);
}
function dateChange(d){view=month(d);date=key(view);render()}
function renderCharts(t){
 const root=h('div','report-root');
 const heading=wrap('report-title',h('h2','','月度报表'),h('p','','实际收支及储蓄划转'));
 if(typeof window.renderFinanceCharts==='function')window.renderFinanceCharts(root, {
  month:ym(view),income:ledger.income,expenses:ledger.expenses,
  savings:ledger.savings.map(x=>({...x,name:ledger.goals.find(g=>g.id===x.goalId)?.name||'储蓄目标',cat:x.cents>=0?'存入':'取出'})),
  goals:ledger.goals.map(x=>({...x,balanceCents:goalBalance(x.id)}))
 });
 else root.append(h('p','empty','图表预览未加载。'));
 for (const [selector, label, tab] of [['.fc-cash-panel', '查看收支明细', 'ledger'], ['.fc-goal-panel', '管理储蓄目标', 'savings']]) {
  root.querySelector(selector)?.append(b(label, () => chooseView(tab), 'fc-chart-action'));
 }
 $('#screen').replaceChildren(heading, root);
}
function renderCalendar(t,projected){
 const a=plus(view,-((view.getUTCDay()+6)%7)), z=plus(a,41);
 const expected=upcoming(ledger.subs,ledger.expenses,a,z);
 const byDate=(xs,d)=>xs.filter(x=>x.date===d);
 const pane=panel(view.getUTCFullYear()+' 年 '+(view.getUTCMonth()+1)+' 月'), cal=h('div','calendar');
 for(const x of '一二三四五六日')cal.append(h('span','weekday',x));
 const renderDay=(d)=>{
  const k=key(d), planned=byDate(expected,k), actual=byDate(ledger.expenses,k);
  const cell=b('',()=>{date=k;if(ym(d)!==ym(view))view=month(d);render();document.querySelector('[data-key="'+k+'"]')?.focus()});
  cell.className='datecell'+(ym(d)===ym(view)?'':' other')+(k===key(t)?' now':'');
  cell.dataset.key=k;cell.setAttribute('aria-pressed',String(k===date));cell.setAttribute('aria-label',short(k)+'，'+actual.length+' 笔实付，'+planned.length+' 笔预计');
  cell.append(h('span','dnum',d.getUTCDate()));
  const marks=[...planned.map(x=>['future',x.name]),...actual.map(x=>['actual',x.name])];
  marks.slice(0,2).forEach(([c,x])=>cell.append(h('span','chip '+c,x)));
  if(marks.length>2)cell.append(h('span','chip more','+'+(marks.length-2)));
  return cell;
 };
 const cells=Math.ceil((((view.getUTCDay()+6)%7)+plus(month(view,1),-1).getUTCDate())/7)*7;
 for(let i=0;i<cells;i++)cal.append(renderDay(plus(a,i)));
 pane.append(cal,wrap('row key',h('span','near dot'),h('span','','预计扣费'),h('span','paid dot'),h('span','','实际支出')));
 const details=panel(short(date)+(date===key(t)?' · 今天':''),h('span','tdate',date));
 const current=byDate(expected,date), actual=byDate(ledger.expenses,date);
 if(!current.length&&!actual.length)details.append(h('p','empty','这一天还没有记录。'));
 if(current.length)details.append(h('div','near','预计扣费'),listing(current,'future',''));
 if(actual.length)details.append(h('div',current.length?'second paid':'paid','实际支出'),listing(actual,'actual',''));
 const upcomingPane=panel('接下来 30 天',h('span','num near',fmt(sum(projected))));
 upcomingPane.append(listing(projected.slice(0,5),'future','未来 30 天没有待确认的扣费。',{showDate:true}));
 if(projected.length>5)upcomingPane.append(h('p','callout','另有 '+(projected.length-5)+' 笔，切换月份可逐日查看。'));
 $('#screen').replaceChildren(pane,wrap('',details,wrap('bottom',upcomingPane)));
}
function renderLedger(t,income,expenses){
 const main=panel(ym(view)+' 收支账本'), filters=h('div','row cashflow-controls');
 for(const [k,label] of [['all','全部'],['income','收入'],['expenses','支出']]){
  const el=b(label,()=>{flowFilter=k;render()});el.setAttribute('aria-pressed',String(flowFilter===k));filters.append(el);
 }
 const rows=[...(flowFilter!=='expenses'?income.map(x=>[x,'income']):[]),...(flowFilter!=='income'?expenses.map(x=>[x,'actual']):[])].sort(([a],[b])=>b.date.localeCompare(a.date));
 const list=h('ul','list sheet-list');
 if(rows.length)list.append(...rows.map(([x,k])=>entry(x,k,{showDate:true})));else list.append(h('li','empty',flowFilter==='income'?'这个月还没有收入。':flowFilter==='expenses'?'这个月还没有支出。':'这个月还没有收支记录。'));
 main.append(filters,list);
 const total=sum(expenses), group=new Map();
 expenses.forEach(x=>group.set(x.cat,(group.get(x.cat)||0)+x.cents));
 const side=panel('分类支出',h('span','num',fmt(total)));
 for(const [cat,cents] of [...group].sort((a,b)=>b[1]-a[1])){const fill=h('i');fill.style.width=(100*cents/total)+'%';side.append(wrap('entry',wrap('row between',h('span','',cat),h('span','num',fmt(cents))),wrap('catline',fill)))}
 if(!expenses.length)side.append(h('p','empty','记录支出后可查看分布。'));
 $('#screen').replaceChildren(main,side);
}
function validateSavings(logs,goalId){
 const totals=new Map();
 for(const x of logs)if(x.goalId===goalId)totals.set(x.date,(totals.get(x.date)||0)+x.cents);
 let bal=0;
 for(const [d,c] of [...totals.entries()].sort(([a],[b])=>a.localeCompare(b))){bal+=c;if(bal<0)return d}
 return null;
}
function renderSavings(t){
 const main=panel('储蓄目标',b('新建目标',()=>editGoal(),'primary'));
 const total=ledger.goals.reduce((n,x)=>n+goalBalance(x.id),0);
 const rows=monthRows(ledger.savings), saved=rows.filter(x=>x.cents>0), taken=rows.filter(x=>x.cents<0);
 main.append(wrap('row between entry',wrap('',h('div','title','当前储蓄余额'),h('div','info','全部目标共 '+ledger.goals.length+' 个')),h('strong','num paid',fmt(total))));
 if(!ledger.goals.length)main.append(h('p','empty','先建一个储蓄目标，再登记存入和取出。'));
 for(const g of ledger.goals){
  const bal=goalBalance(g.id), pct=Math.round(100*bal/g.targetCents), fill=h('i');
  fill.style.width=Math.min(100,pct)+'%';
  const progress=wrap('catline goal-progress',fill);
  progress.setAttribute('role','progressbar');progress.setAttribute('aria-label',g.name);progress.setAttribute('aria-valuemin','0');progress.setAttribute('aria-valuemax','100');progress.setAttribute('aria-valuenow',String(Math.min(100,pct)));
  main.append(wrap('entry goal',wrap('row between',h('div','title',g.name),h('strong','num paid',fmt(bal))),progress,
   wrap('row between goal-meta',h('span','','目标 '+fmt(g.targetCents)),h('span','num',pct+'%')),
   wrap('row goal-actions',b('存入',()=>editSavings(g,'in')),b('取出',()=>editSavings(g,'out')),b('编辑目标',()=>editGoal(g),'bare'))));
 }
 const records=panel('储蓄流水 · '+ym(view));
 records.append(wrap('entry',wrap('row between',h('span','','本月存入'),h('span','num paid','+'+fmt(sum(saved)))),wrap('row between',h('span','','本月取出'),h('span','num near','−'+fmt(-sum(taken))))));
 const picker=h('select');picker.setAttribute('aria-label','按储蓄目标筛选');picker.style.maxWidth='100%';
 for(const [v,n] of [['all','全部目标'],...ledger.goals.map(g=>[g.id,g.name])]){const option=h('option','',n);option.value=v;picker.append(option)}
 picker.value=goalFilter;picker.onchange=()=>{goalFilter=picker.value;render()};records.append(wrap('row bottom',picker));
 const lu=h('ul','list'), visible=rows.filter(x=>goalFilter==='all'||x.goalId===goalFilter).sort((a,b)=>b.date.localeCompare(a.date));
 for(const x of visible){const g=ledger.goals.find(g=>g.id===x.goalId), cell=h('li','entry');
  cell.append(wrap('row between',wrap('',h('div','title',g?.name||'储蓄'),h('div','info',short(x.date)+' · '+(x.cents>0?'存入':'取出')+(x.memo?' · '+x.memo:''))),h('span','num '+(x.cents>0?'paid':'near'),(x.cents>0?'+':'−')+fmt(Math.abs(x.cents)))));
  if(g)cell.append(wrap('act',b('编辑',()=>editSavings(g,x.cents>0?'in':'out',x))));
  lu.append(cell);
 }
 if(!visible.length)lu.append(h('li','empty','这个月没有对应的储蓄记录。'));
 records.append(lu,h('p','callout','储蓄是自己的账户之间转移，不会重复记成支出或收入。'));
 $('#screen').replaceChildren(main,records);
}
function renderSubs(t){
 const main=panel('订阅清单',b('添加订阅',()=>editSub(),'primary'));
 for(const s of ledger.subs){
  const future=upcoming([s],ledger.expenses,t,plus(t,380))[0];
  const actions=wrap('act',b('编辑',()=>editSub(s)),b(s.paused?'恢复':'暂停',()=>{s.paused=!s.paused;persist(s.paused?'已暂停预计扣费':'已恢复订阅')}));
  const item=wrap('entry',wrap('row between',wrap('',h('div','title',s.name),h('div','info',cycles[s.interval]+' · '+(s.paused?'已暂停':future?'下次 '+short(future.date):'暂无计划'))),h('span','num near',fmt(s.cents))),actions);
  main.append(item);
 }
 if(!ledger.subs.length)main.append(h('p','empty','添加一个订阅，日历会按周期排出扣费日。'));
 const recurring=ledger.subs.filter(s=>!s.paused).reduce((a,s)=>a+s.cents*(s.interval==='annual'?1/12:s.interval==='weekly'?52/12:1),0);
 const side=panel('订阅月均',h('span','num near',fmt(Math.round(recurring))));side.append(h('p','muted','按全部启用订阅估算。遇到短月份则取月末，随后仍以原日期为准。确认某次扣费后，不会改动后续周期。'));
 $('#screen').replaceChildren(main,side);
}
function showForm(title,subtitle,body,onSave,remove){
 const form=$('#form'), err=h('p','form-error');err.setAttribute('role','alert');
 const cancel=b('取消',()=>$('#dialog').close()), submit=h('button','primary','保存');submit.type='submit';
 form.replaceChildren(h('h2','',title),h('p','muted',subtitle),...body,err,wrap('row between',remove?b(remove.label,async()=>{const message=await remove.action();if(message)err.textContent=message},'warn'):h('span'),wrap('row',cancel,submit)));
 form.onsubmit=e=>{e.preventDefault();const data=Object.fromEntries(new FormData(form));const message=onSave(data);if(message){err.textContent=message;return}$('#dialog').close()};
 $('#dialog').showModal();
}
function field(label,id,type,value,o={}){
 const el=h('label','',label);let box;
 if(type==='select'){box=h('select');Object.entries(o.options).forEach(([k,v])=>{const n=h('option','',v);n.value=k;box.append(n)})}else{box=h('input');box.type=type;for(const key of ['min','max','step','maxLength'])if(o[key]!=null)box[key]=o[key]}
 box.name=id;box.required=!o.optional;box.value=value??'';el.append(box);return el;
}
function getAmount(v){return Number.isFinite(+v)&&+v>0&&+v<=10000000?Math.round(+v*100):0}
function getName(v){return (v??'').trim()}
function makeAmount(cents){return field('金额（元）','amount','number',cents!=null?(cents/100).toFixed(2):'',{min:.01,max:10000000,step:.01})}
function editSub(cur){
 showForm(cur?'编辑订阅':'添加订阅','按周期生成预计扣费；不会创建支出。',[
  field('订阅名称','name','text',cur?.name,{maxLength:48}),wrap('pair',makeAmount(cur?.cents),field('周期','interval','select',cur?.interval||'monthly',{options:cycles})),
  field('首次扣费日','start','date',cur?.start||key(today()),{min:'1900-01-01',max:'9999-12-01'})
 ],x=>{
  const cents=getAmount(x.amount), name=getName(x.name);
  if(!cents||!name||!validDate(x.start)||!Object.hasOwn(cycles,x.interval))return '请填写有效的名称、金额、首次扣费日和周期。';
  const id=cur?.id??newId();
  const scheduleChanged=cur&&(cur.start!==x.start||cur.interval!==x.interval);
  if(scheduleChanged&&ledger.expenses.some(e=>e.ref?.startsWith(id+'@')))return '该订阅已有实付记录。为保留历史，请暂停旧订阅，再新建周期。可继续编辑名称或金额。';
  const item={id,name,cents,interval:x.interval,start:x.start,paused:cur?.paused||false};
  if(cur)Object.assign(cur,item);else ledger.subs.push(item);
  persist(cur?'已更新订阅':'已添加订阅');
 });
}
function upsertExpense(x,opt={}){
 if(!recordActual(x))return '这次扣费已经确认过了。';
 persist(opt.msg??'已保存支出');
}
function settle(x){
 showForm('确认扣费','这笔「'+x.name+'」原定 '+short(x.date)+' 扣费。保存后会从预计转入实付。',[
  wrap('pair',makeAmount(x.cents),field('实际扣费日期','date','date',key(today()),{min:'1900-01-01',max:key(today())}))
 ],v=>{
  const cents=getAmount(v.amount);
  if(!cents||!validDate(v.date)||v.date>key(today()))return '请输入有效的实付金额和不晚于今天的日期。';
  return upsertExpense({id:newId(),name:x.name,cents,date:v.date,cat:'订阅',ref:x.ref},{msg:'已转入消费记录'});
 });
}
function editExpense(d,x){
 const cat=x?.ref?{'订阅':'订阅'}:Object.fromEntries(catList.map(v=>[v,v]));
 const remove=x?{label:x.ref?'撤销已扣费':'删除记录',action:async()=>{if(!await atlasConfirm(x.ref?'撤销后，对应订阅会回到预计扣费。继续吗？':'确认删除这笔消费？'))return;ledger.expenses=ledger.expenses.filter(y=>y.id!==x.id);$('#dialog').close();persist(x.ref?'已恢复预计扣费':'已删除记录')}}:null;
 showForm(x?'编辑支出':'记一笔消费',x?.ref?'改金额或日期不会重新生成相同的预计扣费。':'只登记已经发生的消费。订阅请从日历对应条目确认。',[
  field('消费名称','name','text',x?.name,{maxLength:48}),wrap('pair',makeAmount(x?.cents),field('分类','cat','select',x?.cat||catList[0],{options:cat})),
  field('消费日期','date','date',d,{min:'1900-01-01',max:key(today())})
 ],v=>{
  const cents=getAmount(v.amount),name=getName(v.name);
  if(!cents||!name||!validDate(v.date)||v.date>key(today())||!Object.hasOwn(cat,v.cat))return '请填写有效的名称、金额、分类和日期。';
  const item={id:x?.id??newId(),name,cents,date:v.date,cat:v.cat};if(x?.ref)item.ref=x.ref;
  return upsertExpense(item);
 },remove);
}
function editIncome(d,x){
 const cat=Object.fromEntries(incomeCats.map(v=>[v,v]));
 const remove=x?{label:'删除收入',action:async()=>{if(!await atlasConfirm('确认删除这笔收入？'))return;ledger.income=ledger.income.filter(y=>y.id!==x.id);$('#dialog').close();persist('已删除收入')}}:null;
 showForm(x?'编辑收入':'记一笔收入','收入只登记实际到账。储蓄取出请选择储蓄流水。',[
  field('收入名称','name','text',x?.name,{maxLength:48}),wrap('pair',makeAmount(x?.cents),field('分类','cat','select',x?.cat||incomeCats[0],{options:cat})),
  field('到账日期','date','date',d,{min:'1900-01-01',max:key(today())})
 ],v=>{
  const cents=getAmount(v.amount),name=getName(v.name);
  if(!cents||!name||!validDate(v.date)||v.date>key(today())||!Object.hasOwn(cat,v.cat))return '请填写有效的名称、金额、分类和日期。';
  const item={id:x?.id??newId(),name,cents,date:v.date,cat:v.cat};
  if(x)Object.assign(x,item);else ledger.income.push(item);
  persist('已保存收入');
 },remove);
}
function editGoal(cur){
 const has=cur&&ledger.savings.some(x=>x.goalId===cur.id);
 const del=cur&&!has?{label:'删除目标',action:async()=>{if(!await atlasConfirm('删除这个尚未记账的储蓄目标？'))return;ledger.goals=ledger.goals.filter(x=>x.id!==cur.id);if(goalFilter===cur.id)goalFilter='all';$('#dialog').close();persist('已删除储蓄目标')}}:null;
 showForm(cur?'编辑储蓄目标':'新建储蓄目标','有流水的目标可重命名和调整金额，不会丢失历史。',[
  field('目标名称','name','text',cur?.name,{maxLength:48}),field('目标金额（元）','target','number',cur?(cur.targetCents/100).toFixed(2):'',{min:0.01,max:10000000,step:.01})
 ],v=>{
  const targetCents=getAmount(v.target), name=getName(v.name);
  if(!targetCents||!name)return '请输入目标名称和大于零的目标金额。';
  if(ledger.goals.some(x=>x.name===name&&x.id!==cur?.id))return '已有同名目标，请为它取一个不同的名字。';
  if(cur)Object.assign(cur,{name,targetCents});else ledger.goals.push({id:newId(),name,targetCents});
  active='savings';persist('已保存储蓄目标');
 },del);
}
function editSavings(g,dir,cur){
 const t=key(today()), remove=cur?{label:'删除流水',action:async()=>{
  if(!await atlasConfirm('确认删除这笔储蓄流水？'))return;
  const revised=ledger.savings.filter(x=>x.id!==cur.id);
  const bad=validateSavings(revised,g.id);
  if(bad)return '无法删除：'+bad+' 截至当天的目标余额会变成负数。';
  ledger.savings=revised;$('#dialog').close();persist('已删除储蓄流水');
 }}:null;
 showForm(cur?'编辑储蓄流水':dir==='in'?'向目标存入':'从目标取出',g.name+' · 当前余额 '+fmt(goalBalance(g.id)),[
  wrap('pair',makeAmount(cur?Math.abs(cur.cents):null),field('方向','dir','select',dir,{options:{in:'存入',out:'取出'}})),
  field('储蓄日期','date','date',cur?.date||(date>t?t:date),{min:'1900-01-01',max:t}),
  field('备注（可选）','memo','text',cur?.memo,{maxLength:80,optional:true})
 ],v=>{
  const amount=getAmount(v.amount);
  if(!amount||!validDate(v.date)||v.date>t||!['in','out'].includes(v.dir))return '请输入有效的金额、方向与日期。';
  const item={id:cur?.id??newId(),goalId:g.id,cents:v.dir==='in'?amount:-amount,date:v.date,memo:getName(v.memo)};
  const test=[...ledger.savings.filter(x=>x.id!==item.id),item], bad=validateSavings(test,g.id);
  if(bad)return '这笔记录会让 '+bad+' 截至当天的目标余额变成负数。请核对金额或日期。';
  ledger.savings=test;
  if(!cur&&ym(from(item.date))!==ym(view)){view=month(from(item.date));date=item.date}
  persist(v.dir==='in'?'已记录存入':'已记录取出');
 },remove);
}
if(query.get('month')&&validDate(query.get('month')+'-01')){view=month(from(query.get('month')+'-01'));date=key(view)}
render();

},null);
