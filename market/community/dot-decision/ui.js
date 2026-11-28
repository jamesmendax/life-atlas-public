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
document.getElementById("root").innerHTML="<main class=\"journal\" aria-labelledby=\"journal-title\">\n  <header class=\"journal-header\">\n    <div><h1 id=\"journal-title\">决策复盘</h1><p id=\"mode\" class=\"secondary\"></p></div>\n    <button id=\"dataset\" type=\"button\" class=\"quiet\"></button>\n    <button id=\"add\" class=\"primary\" type=\"button\">记录决策</button>\n  </header>\n  <div class=\"journal-layout\">\n    <aside class=\"record-index\" aria-labelledby=\"records-title\">\n      <div class=\"record-tools\"><h2 id=\"records-title\">记录 <span id=\"record-count\"></span></h2>\n        <label class=\"sr\" for=\"filter\">筛选决策</label>\n        <select id=\"filter\"><option value=\"all\">全部</option><option value=\"due\">待复盘</option><option value=\"pending\">未到期</option><option value=\"done\">已复盘</option></select>\n      </div>\n      <div class=\"record-list\" id=\"list\"></div>\n      <label class=\"sr\" for=\"record-picker\">选择决策记录</label><select id=\"record-picker\" class=\"record-picker\"></select>\n    </aside>\n    <section aria-label=\"决策对照\" class=\"record-detail\" id=\"detail\"></section>\n  </div>\n  <p class=\"status\" id=\"status\" role=\"status\"></p>\n</main>\n\n<dialog id=\"record-dialog\" aria-labelledby=\"record-heading\">\n  <form id=\"record-form\">\n    <header><h2 id=\"record-heading\">记录一项决策</h2><p class=\"secondary\">保存后，原判断会和复盘结果一起保留。</p></header>\n    <div class=\"form-fields\">\n      <label>要做的决定<input maxlength=\"65\" name=\"title\" placeholder=\"例：把周会缩短到 30 分钟\" required></label>\n      <label>当时的依据<textarea maxlength=\"1200\" name=\"why\" placeholder=\"为什么这样决定？有哪些关键假设？\" required></textarea></label>\n      <label>预期及验收标准<textarea maxlength=\"1200\" name=\"expect\" placeholder=\"什么结果意味着这个决定有效？\" required></textarea></label>\n      <div class=\"form-pair\">\n        <label>复盘日期<input name=\"due\" required type=\"date\"></label>\n        <label>当时的把握（%）<input max=\"100\" min=\"0\" name=\"confidence\" required step=\"1\" type=\"number\" value=\"70\"></label>\n      </div>\n    </div>\n    <footer><button data-close=\"record-dialog\" type=\"button\">取消</button><button class=\"primary\" type=\"submit\">保存原判断</button></footer>\n  </form>\n</dialog>\n<dialog id=\"review-dialog\" aria-labelledby=\"review-heading\">\n  <form id=\"review-form\">\n    <header><h2 id=\"review-heading\">记录复盘结果</h2><p class=\"secondary\" id=\"review-subject\"></p></header>\n    <div class=\"form-fields\">\n      <label>实际发生了什么<textarea maxlength=\"1600\" name=\"actual\" placeholder=\"写下事实、数据或证据\" required></textarea></label>\n      <label>预期是否达成？<select name=\"verdict\"><option value=\"met\">达成</option><option value=\"part\">部分达成</option><option value=\"miss\">未达成</option><option value=\"unknown\">暂无法判断</option></select></label>\n      <label>下次会怎么做<textarea maxlength=\"1600\" name=\"lesson\" placeholder=\"继续、调整还是停止？\"></textarea></label>\n    </div>\n    <footer><button data-close=\"review-dialog\" type=\"button\">取消</button><button class=\"primary\" type=\"submit\">保存复盘</button></footer>\n  </form>\n</dialog>\n<dialog id=\"copy-dialog\" aria-labelledby=\"copy-heading\">\n  <div class=\"copy-sheet\"><h2 id=\"copy-heading\">复盘 Markdown</h2><p class=\"secondary\">文本已选中，可使用系统复制命令。</p>\n    <textarea id=\"copy-text\" aria-label=\"复盘 Markdown 文本\" readonly></textarea>\n    <footer><button data-close=\"copy-dialog\" type=\"button\">关闭</button></footer>\n  </div>\n</dialog>\n";

'use strict';
const $=s=>document.querySelector(s);
const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!=null)n.textContent=txt;return n};
const group=(cls,...kids)=>{const n=el('div',cls);n.append(...kids);return n};
const button=(txt,fn,cls)=>{const n=el('button',cls,txt);n.type='button';n.addEventListener('click',fn);return n};
const q=new URLSearchParams({embed:'1'}), embed=q.get('embed')==='1', instance=(q.get('id')||'default').slice(0,64), key='decision-journal-1:'+instance;
const today=(delta=0)=>{const d=new Date;d.setDate(d.getDate()+delta);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
const validateDate=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s};
const seed=()=>[
{id:'d1',title:'用一周测试「先做题再看笔记」',why:'重读笔记很顺手，但合上就想不起来。想用练习题先暴露盲点。',expect:'一周后做 20 道同难度题，答对至少 16 道，复习总时长不超过 3 小时。',confidence:68,created:today(-10),due:today(-3),review:{date:today(-2),actual:'做对 17 / 20 道；用时 3 小时 20 分钟。错题集中在同一个知识点。',verdict:'part',lesson:'保留先做题。给题组设 35 分钟上限，留 10 分钟回查高频错误。'}},
{id:'d2',title:'把周会从 45 分钟缩到 30 分钟',why:'过去三次都在会上补背景；提前发两段摘要，讨论可以聚焦决策。',expect:'两次周会都在 30 分钟内结束，且重要议题不延到会后。',confidence:75,created:today(-15),due:today(-1)},
{id:'d3',title:'先做窄栏组件，再做模板合集',why:'用户先能在自己的页面试用，才知道合集里哪些组件值得长期保留。',expect:'一周内请 3 人在不同栏宽试用，至少 2 人愿意保留一个组件。',confidence:60,created:today(-2),due:today(5)}
];
let storageReady = true;
function get(k,f){try{return JSON.parse(storage.getItem(key+':'+k))??f}catch{return f}}
function put(k,v){try{storage.setItem(key+':'+k,JSON.stringify(v));storageReady=true}catch{storageReady=false}}
let demo=get('mode',context.demonstration), datasets={demo:get('demo',seed()),blank:get('blank',[])}, active=null;
const data=()=>datasets[demo?'demo':'blank'], persist=()=>put(demo?'demo':'blank',data());
const stage=(d,t=today())=>d.review?'done':d.due<=t?'due':'pending';
const stageText={done:'已复盘',due:'待复盘',pending:'未到期'}, verdicts={met:'达成',part:'部分达成',miss:'未达成',unknown:'暂无法判断'};
const dateLabel=(d)=>d.replaceAll('-','.');
function notice(s){$('#status').textContent=s}
function render() {
  const records = data();
  const filter = $('#filter').value;
  const due = records.filter(record => stage(record) === 'due').length;
  const shown = records.filter(record => filter === 'all' || stage(record) === filter);
  if (!shown.some(record => record.id === active)) active = shown[0]?.id ?? null;

  $('#mode').textContent = demo ? '示例日志' : due ? `${due} 项待复盘` : '我的日志';
  $('#dataset').textContent = demo ? '返回我的日志' : '查看示例';
  $('#record-count').textContent = shown.length;

  const list = $('#list'), picker = $('#record-picker');
  list.replaceChildren(...shown.map(record => {
    const state = stage(record);
    const item = button('', () => {
      active = record.id;
      render();
      list.querySelector('[aria-current="true"]')?.focus();
    });
    item.setAttribute('aria-current', String(record.id === active));
    item.append(el('strong', '', record.title), group('record-meta',
      el('span', `record-state ${state}`, stageText[state]), el('time', '', dateLabel(record.due))));
    return item;
  }));
  picker.replaceChildren(...shown.map(record => {
    const option = el('option', '', `${stageText[stage(record)]} · ${record.title}`);
    option.value = record.id;
    return option;
  }));
  picker.hidden = !shown.length;
  picker.value = active ?? '';

  const detail = $('#detail'), record = shown.find(item => item.id === active);
  if (!record) {
    const heading = records.length ? '当前筛选下没有记录' : '开始一份决策日志';
    const message = records.length ? '切换筛选条件可查看其他决策。' : '先记下决定、理由和验收标准，等结果出现后再对照。';
    const empty = group('empty', el('h2', '', heading), el('p', '', message));
    if (records.length) empty.append(button('查看全部', () => { $('#filter').value = 'all'; render(); $('#filter').focus(); }));
    detail.replaceChildren(empty);
    return;
  }

  const state = stage(record);
  const title = el('h2', 'detail-title', record.title);
  const dates = group('detail-dates', el('span', `record-state ${state}`, stageText[state]),
    el('span', '', `记录于 ${dateLabel(record.created)}`),
    el('span', '', `${record.review ? '复盘于' : '计划复盘'} ${dateLabel(record.review?.date ?? record.due)}`));
  const reviewButton = button(record.review ? '更新复盘' : '填写复盘', () => openReview(record), 'primary');
  const copyButton = button('复制为 Markdown', () => copy(record), 'quiet');
  const heading = group('detail-header', title, dates, group('detail-actions', reviewButton, copyButton));

  const before = el('article', 'comparison-side before');
  const after = el('article', 'comparison-side after');
  const meter = el('progress');
  meter.max = 100;
  meter.value = record.confidence;
  meter.setAttribute('aria-label', '当时的把握');
  before.append(el('h3', '', '当时的判断'), el('h4', '', '依据'), el('p', '', record.why),
    el('h4', '', '预期及验收标准'), el('p', '', record.expect),
    group('confidence', el('span', '', `把握 ${record.confidence}%`), meter));
  after.append(el('h3', '', '实际与复盘'));
  if (record.review) {
    const verdict = record.review.verdict;
    after.append(el('span', `record-state ${verdict === 'met' ? 'done' : verdict === 'miss' ? 'miss' : ''}`, verdicts[verdict]),
      el('h4', '', '发生了什么'), el('p', '', record.review.actual));
    if (record.review.lesson) after.append(el('h4', '', '下次怎么做'), el('p', '', record.review.lesson));
  } else {
    after.append(el('p', 'secondary', state === 'due' ? '到复盘日期了。把实际结果和验收标准对照。' : '有实际结果后即可填写复盘。'));
  }
  detail.replaceChildren(heading, group('comparison', before, after));
}

async function copy(record) {
  const text = markdown(record);
  try {
    await navigator.clipboard.writeText(text);
    notice('已复制 Markdown。');
  } catch {
    const output = $('#copy-text');
    output.value = text;
    $('#copy-dialog').showModal();
    output.select();
  }
}

function openRecord(){$('#record-form').reset();$('#record-form').elements.due.value=today(7);$('#record-dialog').showModal()}
let target=null;
function openReview(d){target=d.id;$('#review-subject').textContent=d.title;const f=$('#review-form');f.reset();if(d.review){f.elements.actual.value=d.review.actual;f.elements.verdict.value=d.review.verdict;f.elements.lesson.value=d.review.lesson}$('#review-dialog').showModal()}
function markdown(d){const rv=d.review;return '# '+d.title+'\n\n- 决策日期：'+d.created+'\n- 计划复盘：'+d.due+'\n- 当时把握：'+d.confidence+'%\n\n## 当时的判断\n\n### 依据\n'+d.why+'\n\n### 预期与验收\n'+d.expect+'\n\n## 实际与复盘\n\n'+(rv?'复盘日期：'+rv.date+'\n\n结果：'+verdicts[rv.verdict]+'\n\n'+rv.actual+(rv.lesson?'\n\n### 下次怎么做\n'+rv.lesson:''):'尚未填写')+'\n'}
function readField(form,n){const input=form.elements[n], s=input.value.trim();if(!s&&input.required){input.setCustomValidity('请填写此项。');input.reportValidity();input.setCustomValidity('');return null}return s}
$('#record-form').addEventListener('submit',e=>{e.preventDefault();const f=e.currentTarget,title=readField(f,'title'),why=readField(f,'why'),expect=readField(f,'expect'),due=f.elements.due.value,confidence=Number(f.elements.confidence.value);
 if(!title||!why||!expect||!validateDate(due)||!Number.isInteger(confidence)||confidence<0||confidence>100)return;
 const record={id:globalThis.crypto?.randomUUID?.()??String(Date.now())+'-'+Math.random(),title,why,expect,due,confidence,created:today()};
 data().unshift(record);active=record.id;persist();$('#filter').value='all';$('#record-dialog').close();notice(storageReady?'已保存原判断。':'已记录；当前浏览器不允许保存，关闭后会丢失。');render()});
$('#review-form').addEventListener('submit',e=>{e.preventDefault();const f=e.currentTarget,d=data().find(x=>x.id===target),actual=readField(f,'actual');if(!d||!actual)return;
 const verdict=f.elements.verdict.value,lesson=f.elements.lesson.value.trim();if(!Object.hasOwn(verdicts,verdict))return;d.review={date:today(),actual,verdict,lesson};persist();$('#filter').value='all';active=d.id;$('#review-dialog').close();notice(storageReady?'已保存复盘。':'已记录；当前浏览器不允许保存，关闭后会丢失。');render()});
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>document.getElementById(b.dataset.close).close();
$('#dataset').onclick=()=>{demo=!demo;put('mode',demo);active=null;$('#filter').value='all';notice('');render()};
$('#add').onclick = openRecord;
$('#filter').onchange = render;
$('#record-picker').onchange = event => { active = event.currentTarget.value; render(); };
observeDotSurface($('.journal'), context, setDotTheme);
render();

},null);
