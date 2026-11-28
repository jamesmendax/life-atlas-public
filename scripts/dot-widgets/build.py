"""Adapt the verified 2026-11-25 Dot delivery. Run from the repo root with its directory as argv[1]."""
import base64
import gzip
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from bs4 import BeautifulSoup

here = Path(__file__).resolve().parent
repo = here.parent.parent
source = Path(sys.argv[1]).resolve()
market = repo / 'market/community'
bridge = (here / 'frame.js').read_text('utf8')
expected = {
    'decision': ('决策复盘-评审稿.html', '22fdd27471cc4bbe1e2a89efbd8ce3e45fa0bb9848fe6b68a77ae810cc512a37'),
    'mingzhang': ('明账-收支储蓄-评审稿.html', '4973ddefa1dd117df5229e144337ebe478effc1e90cad0be09f394ae0e9c57ac'),
    'whiteboard': ('手绘白板-基础版.html', '49dab3ca27a3638bcb4f84309c41536c4b05d6e31c9205c0767302fb9e1d21bc'),
    'carbon': ('Carbon-代码卡片.html', '60f50034205ace3140c7193e8998ee2e2f8594632c0eef0b105801469d5c5a3e'),
}
for listing in ['RUN-SHA256.txt', 'SOURCE-SHA256.txt']:
    for line in (source / listing).read_text('utf-8-sig').splitlines():
        digest, name = line.split('  ', 1)
        target = (source / name).resolve()
        if not target.is_relative_to(source) or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            raise ValueError(f'Unexpected input: {name}')
def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(value.encode('utf8') if isinstance(value, str) else value)
def js(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))
def exact(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f'Dot input changed at {old[:90]}')
    return text.replace(old, new)
def between(text, first, next_line, replacement):
    start = text.index(first)
    end = text.index(next_line, start)
    return text[:start] + replacement + text[end:]
def local_ui(name):
    return (here/name).read_text('utf8')
def consent_action(code):
    # Native confirm() is unavailable in an opaque iframe. Preserve deletion confirmation via a dialog.
    pattern = r"action:\(\)=>\{if\(!window\.confirm\((.*?)\)\)return;"
    return re.sub(pattern, r'action:async()=>{if(!await atlasConfirm(\1))return;', code).replace(
        "action:()=>{\n  if(!window.confirm(", "action:async()=>{\n  if(!await atlasConfirm(")
def adapt_journal(slug, soup, out):
    scripts = [s.extract().string for s in soup.select('script')]
    css = '\n'.join(s.get_text() for s in soup.select('style'))
    code = '\n'.join(scripts).replace('localStorage.', 'storage.')
    code = code.replace('new URLSearchParams(location.search)', "new URLSearchParams({embed:'1'})")
    code = code.replace("let demo=!embed && q.get('demo')!=='0'", "let demo=get('mode',context.demonstration)")
    code = code.replace('demo=!demo;active=null', "demo=!demo;put('mode',demo);active=null")
    code = code.replace("read('mode','demo')", "read('mode',context.demonstration?'demo':'real')")
    code = code.replace("get('theme',matchMedia('(prefers-color-scheme: light)').matches?'light':'dark')", "get('theme',context.theme)")
    code = code.replace("read('theme',matchMedia('(prefers-color-scheme:light)').matches?'light':'dark')","read('theme',context.theme)")
    code = consent_action(code)
    if slug == 'mingzhang':
        code = exact(code, '()=>{const message=remove.action();', 'async()=>{const message=await remove.action();')
    modal = """function atlasConfirm(message) {
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
    }\n"""
    markup = 'document.getElementById("root").innerHTML=' + js(local_ui(slug+'.html')) + ';\n'
    if slug == 'decision':
        code = adapt_decision(code)
        css = local_ui('decision.css')
        modal = ''
    else:
        code = adapt_mingzhang(code)
        css += '\nhtml,body{min-height:0!important}body{padding:0}dialog{max-height:calc(100vh - 22px);overflow:auto}\n' + local_ui('mingzhang.css')
    write(out/'ui.js', bridge+'\nmountDotWidget(({storage,context})=>{\n'+markup+modal+code+'\n},null);\n')
    write(out/'ui.css',css)

def adapt_decision(code):
    code = between(code, 'let storageReady=false;', 'function get(', 'let storageReady = true;\n')
    code = exact(code, 'JSON.stringify(v))}catch{storageReady=false}', 'JSON.stringify(v));storageReady=true}catch{storageReady=false}')
    code = exact(code, " theme=q.get('theme')||get('theme',context.theme),", '')
    code = between(code, 'function setTheme(', 'function notice(', '')
    code = between(code, 'function render(){', 'function openRecord()', local_ui('decision.js')+'\n')
    code = between(code, 'async function copy(d)', 'function readField(', '')
    code = exact(code, 'function openReview(d){target=d.id;', "function openReview(d){target=d.id;$('#review-subject').textContent=d.title;")
    code = between(code, "$('#add').onclick=openRecord;", 'setTheme(theme);render();', '''$('#add').onclick = openRecord;
$('#filter').onchange = render;
$('#record-picker').onchange = event => { active = event.currentTarget.value; render(); };
observeDotSurface($('.journal'), context, setDotTheme);
''')
    return exact(code, 'setTheme(theme);render();', 'render();')

def adapt_mingzhang(code):
    code = between(code, 'let theme=', "$('#switchData').onclick", '''let theme = read('theme', null);
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
  if (/^\\d{4}-\\d{2}$/.test(value) && value >= '1900-01' && value <= '9999-11' && validDate(value+'-01')) dateChange(from(value+'-01'));
  else event.currentTarget.value = ym(view);
};
''')
    code = between(code, 'function monthNav(', 'function renderCharts(', '')
    code = exact(code, " const main=panel('月度报表 · '+ym(view),monthNav(t,true)), root=h('div','report-root');\n main.append(root);", " const root=h('div','report-root');\n const heading=wrap('report-title',h('h2','','月度报表'),h('p','','实际收支及储蓄划转'));" )
    code = exact(code, " $('#screen').replaceChildren(main);\n}\nfunction renderCalendar", """ for (const [selector, label, tab] of [['.fc-cash-panel', '查看收支明细', 'ledger'], ['.fc-goal-panel', '管理储蓄目标', 'savings']]) {
  root.querySelector(selector)?.append(b(label, () => chooseView(tab), 'fc-chart-action'));
 }
 $('#screen').replaceChildren(heading, root);
}
function renderCalendar""")
    code = exact(code, "+' 月',monthNav(t)), cal", "+' 月'), cal")
    code = exact(code, "+' 收支账本',monthNav(t)), filters", "+' 收支账本'), filters")
    code = exact(code, "panel('储蓄流水 · '+ym(view),monthNav(t))", "panel('储蓄流水 · '+ym(view))")
    code = exact(code, "panel('订阅清单',h('span','tdate',ledger.subs.length+' 项'))", "panel('订阅清单',b('添加订阅',()=>editSub(),'primary'))")
    code = exact(code, "'返回演示数据'", "'查看演示'")
    code = exact(code, "'切换到我的账本'", "'返回我的账本'")
    code = between(code, " $('#summary').replaceChildren(", " $('#screen').classList.toggle", ''' $('#report-month').value = ym(view);
 $('#previous-month').disabled = ym(view) <= '1900-01';
 $('#next-month').disabled = ym(view) >= '9999-11';
 $('#summary').replaceChildren(metric('本月结余',cash,cash<0?'near':'paid','收入减支出'),metric('实际收入',sum(income),'paid','已登记 '+income.length+' 笔'),metric('实际支出',sum(expenses),'outflow','已登记 '+expenses.length+' 笔'),metric('未来 30 天扣费',sum(projected),'near','待确认 '+projected.length+' 笔'));
 sections($('#tabs'),[['charts','报表'],['ledger','收支'],['calendar','日历'],['savings','储蓄'],['subs','订阅']],active);
''')
    code = exact(code, " $('#screen').classList.toggle('full',active==='charts');", ''' const screen = $('#screen');
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
 if (actions.parentElement !== period) period.append(actions);''')
    code = exact(code, "function sections(host,items,k){host.replaceChildren(...items.map(([v,label])=>{const el=b(label,()=>{active=v;render()});el.setAttribute('aria-pressed',String(v===k));return el}))}", '''function chooseView(viewKey) {
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
}''')
    code = exact(code, " const k=m.points;", " p.classList.add('fc-trend-panel');\n const k=m.points;")
    code = exact(code, " const amounts=[['实际收入'", " p.classList.add('fc-cash-panel');\n const amounts=[['实际收入'")
    code = exact(code, " if(!m.goals.length){p.append", " p.classList.add('fc-goal-panel');\n if(!m.goals.length){p.append")
    return code
def adapt_carbon(soup, out):
    packed = json.loads(soup.select_one('#carbon-resources').extract().string)
    core = json.loads(soup.select_one('#carbon-entry').extract().string)
    adapter = soup.find_all('script')[-1].extract().string
    js_modules = {}
    for key in list(packed):
        if key.endswith('.js'):
            script = gzip.decompress(base64.b64decode(packed.pop(key))).decode()
            if 'Unexpected packaged font URL' in script:
                start = script.index('function t(t){var n=new URL("./static/fonts/",document.baseURI)')
                end = script.index('return{resolveAll:', start)
                script = script[:start]+'function t(url){return window.__atlasExportFont(url)}'+script[end:]
            js_modules[key] = script
        elif key.endswith('.woff2'):
            write(out/'assets/fonts'/Path(key).name, gzip.decompress(base64.b64decode(packed[key])))
    adapter = exact(adapter,"JSON.parse(document.getElementById('carbon-resources').textContent)",js(packed))
    adapter = exact(adapter,"JSON.parse(document.getElementById('carbon-entry').textContent)",js(core))
    adapter = exact(adapter,"if(!Object.hasOwn(packed,key))", "if(!Object.hasOwn(packed,key)&&!Object.hasOwn(modules,key))")
    start=adapter.index("if(!running.has(key))running.set(key,load(key).then(buf=>{")
    end=adapter.index('return running.get(key)',start)
    adapter=adapter[:start]+"if(!running.has(key))running.set(key,Promise.resolve().then(()=>modules[key]()));\n    "+adapter[end:]
    module_source = 'const modules={'+',\n'.join(js(k)+':function(){\n'+v+'\n}' for k,v in js_modules.items())+'};\n'
    font_map={k:'assets/fonts/'+Path(k).name for k in packed if k.endswith('.woff2')}
    for key in (k for k in packed if k.endswith('.woff')):
        # Translate the two legacy WOFF containers to the package loader's WOFF2 format.
        from fontTools.ttLib import TTFont
        filename = Path(key).stem+'.woff2'
        font = TTFont(source/'source/carbon'/key, recalcTimestamp=False)
        font.flavor='woff2'
        font.save(out/'assets/fonts'/filename)
        font_map[key]='assets/fonts/'+filename
    adapter=exact(adapter,'name=>window.__carbonURL(name)', "name=>new URL(fontMap[normalize(name)],document.baseURI).href")
    adapter = 'const fontMap='+js(font_map)+';\n'+adapter
    adapter = adapter.replace("window.__carbonText=path=>resources.get(normalize(path));",
        """window.__carbonText=path=>resources.get(normalize(path));
        window.__atlasExportFont=async path=>{
          const url=new URL(path,document.baseURI).href;
          if(!Object.values(fontMap).some(name=>new URL(name,document.baseURI).href===url))throw Error('Unknown packaged font');
          const response=await fetch(url,{credentials:'omit'});
          if(!response.ok)throw Error('Cannot read packaged font');
          return b64(new Uint8Array(await response.arrayBuffer()));
        };""")
    next_data = soup.select_one('#__NEXT_DATA__').extract().string
    # SSR markup and Next's head-count must be installed unchanged before hydration.
    for meta in soup.select('meta[http-equiv]'):
        meta.decompose()
    head = 'document.head.insertAdjacentHTML("beforeend",'+js(soup.head.decode_contents())+');\n'
    dom = head+'document.body.innerHTML='+js(soup.body.decode_contents())+';\n'
    dom += "const data=document.createElement('script');data.id='__NEXT_DATA__';data.type='application/json';data.textContent="+js(next_data)+";document.body.append(data);\n"
    write(out/'ui.js',bridge+'\n'+(here/'carbon.js').read_text('utf8')+'\nmountDotWidget(ctx=>{\n'+dom+
          "try{Object.defineProperty(window,'localStorage',{value:ctx.storage});}catch{}\n"+
          module_source+adapter+'\n'+(repo/'electron/main/market/frameSurface.js').read_text('utf8')+
          "\ninstallWidgetSurface('carbon','height',ctx.context);\nattachCarbonDraft(ctx);\n},null);\n")
    notices = [k for k in packed if k=='LICENSE' or k.startswith('notices/') or '/LICENSE.' in k or k.endswith('fonts.provenance.json')]
    write(out/'assets/licenses/notices.txt','\n'.join('==== '+k+'\n'+gzip.decompress(base64.b64decode(packed[k])).decode() for k in notices))
def adapt_board(out):
    zpath = next((source/'source/whiteboard-base').glob('*.zip'))
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp)
        with zipfile.ZipFile(zpath) as z:
            for name in z.namelist():
                if not name.startswith('public/') or name.endswith('/'): continue
                dest = (src/name[7:]).resolve()
                if not dest.is_relative_to(src): raise ValueError(name)
                write(dest,z.read(name))
        editor = (src/'editor.js').read_text('utf8')
        # This build uses the Chinese UI and retains the English fallback.
        editor = re.sub(r'"\./locales/(?!zh-CN\.json|en\.json)[^"]+\.json":\(\)=>import\("[^"]+"\),?', '', editor)
        # The pinned original exports are minified. Replace its browser-storage entry at this boundary.
        editor = editor[:editor.index('var HO=new URL(location.href),Ja=document.documentElement.dataset.reference')]+bridge+'\n'+(here/'board.js').read_text('utf8')
        write(src/'editor.js',editor)
        # Rebundle the original chunks as static functions compatible with the signed-package CSP.
        esbuild = repo/'node_modules/esbuild/bin/esbuild'
        cmd=['node',str(esbuild),str(src/'editor.js'),'--bundle','--minify','--platform=browser','--format=iife','--target=es2022',
             '--external:fs','--external:node:*','--define:import.meta.url=document.baseURI','--define:import.meta.env=undefined',
             '--legal-comments=inline','--log-level=warning','--outfile='+str(out/'ui.js')]
        subprocess.run(cmd,check=True)
        css=(src/'editor.css').read_text('utf8').replace('./fonts/','./assets/fonts/')
        css+='\n'+local_ui('board.css')
        write(out/'ui.css',css)
        for p in (src/'fonts').rglob('*.woff2'):
            write(out/'assets/fonts'/p.relative_to(src/'fonts'),p.read_bytes())
        n=sorted((src/'notices').glob('*'))+sorted(src.glob('*.LEGAL.txt'))
        write(out/'assets/licenses/notices.txt','\n'.join('==== '+p.name+'\n'+p.read_text('utf8',errors='replace') for p in n if p.is_file()))
for slug in sys.argv[2:] or expected:
    filename,digest=expected[slug]
    out = market/('dot-'+slug)
    out.mkdir(parents=True,exist_ok=True)
    source_file = source/'deliver'/filename
    h=hashlib.sha256(source_file.read_bytes()).hexdigest()
    if digest and h!=digest: raise ValueError(filename)
    if slug=='whiteboard': adapt_board(out)
    else:
        soup=BeautifulSoup(source_file.read_bytes().decode('utf8'),'html.parser')
        if slug=='carbon': adapt_carbon(soup,out)
        else: adapt_journal(slug,soup,out)
    write(out/'assets/attribution.md',f'# {filename}\n\nDot 的 Notion 小组件交接，2026-11-25。Life Atlas 移植按页面组件存档。\n\n原始交付 SHA-256：{h}\n'+
          ('\n第三方许可及版权声明见 licenses/notices.txt。\n' if slug in ('whiteboard','carbon') else ''))
