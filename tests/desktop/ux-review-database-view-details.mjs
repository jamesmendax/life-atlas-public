import assert from "node:assert/strict";
import fs from "node:fs/promises";

export async function databaseViewDetails({page, db, check, nav, frame, until, saved, persist, nativeFile, activateApp, file, button, field, dialog, row, peek, settings, closeSettings, artifact, sha256}) {
  const view = (s, type) => s.databaseViews.find(v => v.id === "view-" + type);
  const dbRows = state => state.databaseItems.filter(r => r.sourceId === "projects" && !state.pages.find(p => p.id === r.pageId)?.trashedAt);
  const layoutChoice = async (panel, name, choice) => {
    await button(panel, name).click();
    await panel.getByRole("menuitemradio", {name: choice, exact: true}).click();
  };
  const closePeek = () => button(peek(), "关闭预览").click();

  await check("board-list-create", "看板列头建页、菜单移组；列表行底部建页与属性编辑", async () => {
    await nav("board");
    const todo = db.locator('.db-board-column[data-group-key="todo"]');
    await todo.locator("header").hover();
    await button(todo, "在待办添加页面").click();
    const draft = field(todo, "页面名称");
    await draft.fill("独立看板页");
    await draft.press("Tab");
    const created = await persist(s => dbRows(s).some(r => r.values.title === "独立看板页" && r.values.status === "todo"));
    const board = dbRows(created).find(r => r.values.title === "独立看板页");
    const card = db.locator('.db-board-card[data-item-id="' + board.id + '"]');
    await card.hover();
    await card.locator(".db-board-move-menu").click();
    await field(dialog(page, "卡片操作"), "移动 独立看板页 到分组").selectOption("done");
    await persist(s => row(s, board.id).values.status === "done");
    assert.equal(await card.evaluate(e => e.closest(".db-board-column").dataset.groupKey), "done");
    await nav("list");
    await button(db, "新建页面").click();
    const title = field(db, "记录标题");
    await title.fill("列表底部新记录"); await title.press("Enter");
    const newPage = await persist(s => dbRows(s).some(r => r.values.title === "列表底部新记录"));
    const amount = db.locator('.db-list-row[data-item-id="alpha"] [data-property-id="amount"] button').first();
    await amount.scrollIntoViewIfNeeded();
    const hits = await amount.evaluate(el => {
      const bounds = node => {const r=node.getBoundingClientRect();return [r.x,r.y,r.width,r.height];};
      const row = el.closest('.db-list-row');
      const p=el.getBoundingClientRect();const targets=[.1,.5,.9].map(at => {const n=document.elementFromPoint(p.left+at*p.width,p.top+p.height/2);return {at,tag:n?.tagName,owner:n?.closest('[data-property-id]')?.dataset.propertyId,label:n?.getAttribute('aria-label')};});
      return {button:bounds(el),targets,fields:[...row.querySelectorAll('.db-list-property')].map(n=>({id:n.dataset.propertyId,box:bounds(n)}))};
    });
    await fs.writeFile(artifact('list-amount-hits','.json'),JSON.stringify(hits,null,2));
    assert.ok(hits.targets.every(point => point.owner === 'amount'), 'A neighbouring field covers the amount button: '+JSON.stringify(hits.targets));
    await amount.click();
    const editor = dialog(page, "编辑 金额 · Alpha 项目");
    const number = field(editor, "金额 · Alpha 项目");
    const oldAmount = row(await saved(), "alpha").values.amount;
    await number.fill("9999"); await number.press("Escape");
    await editor.waitFor({state:"detached"});
    assert.equal(row(await saved(), "alpha").values.amount, oldAmount);
    await amount.click(); await number.fill("131"); await number.press("Enter");
    await persist(s => row(s, "alpha").values.amount === 131);
    await editor.waitFor({state:"detached"});
    const fields = db.locator('.db-list-row[data-item-id="alpha"] .db-list-properties');
    await fields.scrollIntoViewIfNeeded();
    const bounds = await fields.boundingBox();
    await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
    await page.mouse.wheel(-3800,0);
    await until(()=>fields.evaluate(el=>el.scrollLeft<=1));
    await page.mouse.wheel(440,0);
    const scroll = await until(()=>fields.evaluate(el=>el.scrollLeft>1 && {offset:el.scrollLeft,visible:el.clientWidth,total:el.scrollWidth}));
    await page.mouse.wheel(-3800,0);
    await until(()=>fields.evaluate(el=>el.scrollLeft<=1));
    return {boardId:board.id, group:"done", listId:dbRows(newPage).find(r => r.values.title === "列表底部新记录").id, oldAmount, finalAmount:131, hits:hits.targets, scroll};
  });

  await check("gallery-preview", "画廊全部预览来源、真实内置封面、媒体适应与新建", async () => {
    await nav("gallery");
    const alpha = db.locator('.db-gallery-card[data-item-id="alpha"]');
    const results = [];
    for (const [choice, kind] of [["无","none"],["页面内容","page-content"],["附件属性","files-property"],["页面封面","page-cover"]]) {
      const panel = await settings("布局");
      await layoutChoice(panel, "画廊预览", choice);
      if (kind === "files-property") await layoutChoice(panel, "画廊附件属性", "附件");
      if (kind === "page-cover") {
        await layoutChoice(panel, "画廊卡片大小", "大");
        const fit = panel.getByRole("switch", {name:"适应媒体"});
        if ((await fit.getAttribute("aria-checked")) !== "true") await fit.click();
      }
      await closeSettings();
      const stored = await persist(s => view(s,"gallery").config.gallery?.preview?.kind === kind);
      const preview = alpha.locator(".db-gallery-preview");
      if (kind === "none") assert.equal(await preview.count(),0);
      else if (kind === "page-content") assert.ok((await preview.innerText()).includes("Alpha 项目"));
      else if (kind === "page-cover") {
        await until(() => preview.locator("img").evaluate(el => el.complete && el.naturalWidth > 0));
        assert.equal(await preview.evaluate(el => getComputedStyle(el).backgroundSize),"contain");
      } else await preview.waitFor();
      results.push({kind, configured:view(stored,"gallery").config.gallery.preview, preview:await preview.count() ? await preview.getAttribute("class") : null});
    }
    await button(db,"新建页面").click();
    const title = field(peek(),"记录标题"); await title.fill("画廊新页面"); await closePeek();
    const state = await persist(s => dbRows(s).some(r => r.values.title === "画廊新页面"));
    return {results, id:dbRows(state).find(r => r.values.title === "画廊新页面").id};
  });

  await check("calendar-schedule", "未排期记录通过日期选择安排、键盘日期格建页与今天", async () => {
    await nav("calendar");
    await db.getByRole("button",{name:/^未安排 \(/u}).click();
    const menu=dialog(page,"未安排的记录");
    await field(menu,"搜索未安排的记录").fill("现场记录 01");
    const unscheduled = menu.locator(".db-unscheduled-row").filter({hasText:"现场记录 01"});
    await unscheduled.locator(".db-date-picker > summary").click();
    await field(unscheduled,"设置 现场记录 01 开始").fill("2026-09-16");
    const scheduled=await persist(s => row(s,"ux-01").values.date?.start === "2026-09-16");
    if (await menu.isVisible()) await page.keyboard.press("Escape");
    if (await menu.isVisible()) await page.keyboard.press("Escape");
    assert.ok(await db.locator('.db-calendar-cell[data-date="2026-09-16"]').getByRole("button",{name:"现场记录 01",exact:true}).count());
    const day = db.locator('.db-calendar-cell[data-date="2026-09-17"]');
    await day.press("Enter");
    const title=field(peek(),"记录标题"); await title.fill("日历格新记录"); await closePeek();
    const state=await persist(s => dbRows(s).some(r => r.values.title === "日历格新记录" && r.values.date.start === "2026-09-17"));
    await button(db,"今天").click();
    const today=await db.locator('.db-calendar-cell[aria-current="date"]').getAttribute("data-date");
    assert.equal(await db.locator('.db-calendar-cell[aria-current="date"]').count(),1);
    return {scheduled:row(scheduled,"ux-01").values.date, created:dbRows(state).find(r=>r.values.title==="日历格新记录").id,today};
  });

  await check("timeline-drag", "可见时间线条拖动与末端调整，区分整段位移和延长", async () => {
    await nav("timeline");
    const panel=await settings("布局");
    await field(panel,"时间线窗口开始").fill("2026-09-01"); await field(panel,"时间线窗口结束").fill("2026-10-01");
    await field(panel,"时间线设置比例").selectOption("month"); await closeSettings();
    const bar=db.locator('.db-timeline-bar[data-item-id="alpha"]');
    const track=bar.locator("..");
    const old=row(await saved(),"alpha").values.date;
    const handle=button(bar,"拖动 Alpha 项目 时间"); await handle.scrollIntoViewIfNeeded();
    const h=await handle.boundingBox(), t=await track.boundingBox();
    const bounds=await db.locator(".db-timeline-toolbar span").innerText();
    const [start,end]=bounds.match(/\d{4}-\d{2}-\d{2}/gu).map(Date.parse);
    const pxDay=t.width/((end-start)/86400000);
    const destination=Date.parse(old.start)+2*86400000;
    const x=t.x+(destination-start)/86400000*pxDay;
    await page.mouse.move(h.x+h.width/2,h.y+h.height/2); await page.mouse.down();
    await page.mouse.move(x,t.y+t.height/2,{steps:8}); await page.mouse.up();
    const shifted=await persist(s=>row(s,"alpha").values.date.start !== old.start);
    const moved=row(shifted,"alpha").values.date;
    assert.equal(Date.parse(moved.end)-Date.parse(moved.start),Date.parse(old.end)-Date.parse(old.start));
    const resize=button(bar,"调整 Alpha 项目 结束日期"); await resize.scrollIntoViewIfNeeded();
    const r=await resize.boundingBox(), x0=r.x+r.width/2,y0=r.y+r.height/2;
    const direction=x0+2*pxDay<await page.evaluate(()=>innerWidth-5) ? 1 : -1;
    await page.mouse.move(x0,y0); await page.mouse.down(); await page.mouse.move(x0+2*pxDay*direction,y0,{steps:8}); await page.mouse.up();
    const resized=await persist(s=>row(s,"alpha").values.date.end !== moved.end);
    const final=row(resized,"alpha").values.date; assert.equal(final.start,moved.start);
    return {old,moved,final,pxDay};
  });

  await check("chart-dash-config", "图表数值汇总、仪表盘图表/全局筛选以及移除", async () => {
    await nav("chart");
    let panel=await settings("布局");
    await field(panel,"图表类型").selectOption("number"); await field(panel,"图表横轴").selectOption("status");
    await field(panel,"图表聚合").selectOption("sum"); await field(panel,"图表数值属性").selectOption("amount");
    await closeSettings();
    const state=await persist(s=>view(s,"chart").config.chart?.kind==="number");
    const total=dbRows(state).reduce((n,r)=>n+Number(r.values.amount||0),0);
    assert.equal(Number((await db.locator(".db-number-chart strong").innerText()).replaceAll(",","")),total);
    await nav("dashboard"); panel=await settings("布局");
    await button(panel,"＋ 图表").click();
    const widgets=panel.locator(".db-widget-setting"); const count=await widgets.count();
    const added=widgets.last(); await added.locator("summary").click();
    await field(added,"组件 "+count+" 标题").fill("专用数值卡");
    await field(added,"组件 "+count+" 图表类型").selectOption("number");
    const filter=panel.locator(".db-dashboard-filter-settings"); await filter.locator("summary").click();
    await button(filter,"＋ 全局筛选").click(); await field(filter,"仪表盘筛选 1 值").fill("Alpha 项目");
    await closeSettings();
    const card=db.locator(".db-configured-widget").filter({has:page.getByRole("heading",{name:"专用数值卡",exact:true})});
    await until(()=>card.locator(".db-number-chart strong").innerText().then(v=>v==="1"));
    panel=await settings("布局");
    const again=panel.locator(".db-widget-setting").filter({has:page.getByText("专用数值卡",{exact:true})});
    await again.locator("summary").click();
    await button(again,"删除组件").click();
    const filters=panel.locator(".db-dashboard-filter-settings"); await filters.locator("summary").click();
    await button(filters,"移除筛选").click(); await closeSettings();
    const cleaned=await persist(s=>!(view(s,"dashboard").config.dashboard?.globalFilters||[]).length && !view(s,"dashboard").config.dashboard?.widgets?.some(w=>w.title==="专用数值卡"));
    return {total,filteredMetric:1,remainingWidgets:view(cleaned,"dashboard").config.dashboard.widgets.length};
  });

  await check("anonymous-form", "关闭再开放表单、设置默认值与匿名提交者落盘", async () => {
    await nav("form"); let panel=await settings("布局");
    await field(panel,"开放本地提交").uncheck();
    await field(panel,"表单标题").fill("隔离登记表"); await field(panel,"表单描述").fill("用于验证提交配置");
    await field(panel,"匿名记录提交者").check();
    const line=panel.locator(".db-form-field-setting").filter({has:page.getByText("确认",{exact:true})});
    await line.locator("summary").click(); await field(line,"确认 默认值").check();
    await closeSettings();
    assert.ok((await db.locator(".db-form-surface").innerText()).includes("已关闭提交"));
    assert.equal(await button(db,"提交记录").count(),0);
    panel=await settings("布局"); await field(panel,"开放本地提交").check(); await closeSettings();
    await nav("list"); await nav("form");
    const form=db.locator(".db-form-surface"); assert.equal(await field(form,"确认").isChecked(),true);
    await field(form,"名称").fill("匿名默认值记录"); await button(form,"提交记录").click();
    await form.getByRole("status").waitFor();
    const result=await persist(s=>dbRows(s).some(r=>r.values.title==="匿名默认值记录" && r.submission?.anonymous===true));
    const created=dbRows(result).find(r=>r.values.title==="匿名默认值记录");
    assert.equal(created.submission.personId,null); assert.equal(created.values.checked,true);
    panel=await settings("布局");
    const checkField=panel.locator(".db-form-field-setting").filter({has:page.getByText("确认",{exact:true})});
    await checkField.locator("summary").click(); await button(checkField,"清除默认值").click(); await closeSettings();
    await persist(s=>!Object.hasOwn(view(s,"form").config.form.fields.find(f=>f.propertyId==="checked"),"defaultValue"));
    return {id:created.id,anonymous:created.submission,defaultChecked:created.values.checked};
  });

  await check("map-records", "标记键盘选择、打开定位/未定位记录以及缩放边界", async () => {
    await nav("map");
    const marker=db.locator('[data-map-marker="alpha"]'); await marker.press("Space");
    const selected=db.locator(".db-map-selection"); assert.ok((await selected.innerText()).includes("Alpha 项目"));
    await button(selected,"打开记录").click(); assert.equal(await field(peek(),"记录标题").inputValue(),"Alpha 项目"); await closePeek();
    const noLocation=db.locator(".db-map-location-list > div").filter({has:button(page,"现场记录 02")});
    assert.ok((await noLocation.innerText()).includes("未定位")); await button(noLocation,"现场记录 02").click();
    assert.equal(await field(peek(),"记录标题").inputValue(),"现场记录 02"); await closePeek();
    await button(db,"重置地图").click(); assert.equal(await button(db,"地图缩小").isDisabled(),true);
    await button(db,"地图放大").click(); await button(db,"地图缩小").click();
    await persist(s=>view(s,"map").config.map.zoom===1);
    return {selected:"alpha",unlocated:"ux-02",zoom:1};
  });

  await check("roadmap-data", "时间脉络映射、真实节点拖动、取消与键盘进入记录",async()=>{
    await nav("roadmap"); const panel=await settings("布局");
    await field(panel,"时间脉络标记属性").selectOption("ux-marker");
    await field(panel,"重点 标记形状").selectOption("ring");
    await field(panel,"时间脉络副标题属性").selectOption("notes"); await field(panel,"时间脉络进度属性").selectOption("amount");
    await field(panel,"时间脉络显示今天").uncheck(); await closeSettings();
    await persist(s=>view(s,"roadmap").config.roadmap?.markerMap?.m1==="ring");
    const road=db.getByTestId("roadmap-view"),node=road.locator('[data-entry-id="beta"]');
    const grip=node.locator("[data-drag-handle]"); await grip.scrollIntoViewIfNeeded();
    const initial=row(await saved(),"beta").values.date;
    const px=await road.evaluate(el=>(Number(el.dataset.axisX1)-Number(el.dataset.axisX0))/((Number(el.dataset.domainEnd)-Number(el.dataset.domainStart))/86400000));
    const drag=async cancel=>{
      await grip.scrollIntoViewIfNeeded(); const b=await grip.boundingBox();
      const x=b.x+b.width/2,y=b.y+b.height/2;
      const sign=x+px*2<await page.evaluate(()=>innerWidth-5) ? 1 : -1;
      await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x+2*px*sign,y,{steps:6});
      await until(()=>road.getAttribute("data-dragging-entry").then(id=>id==="beta"));
      if(cancel) await page.keyboard.press("Escape");
      await page.mouse.up(); await frame();
    };
    await drag(true); assert.deepEqual(row(await saved(),"beta").values.date,initial);
    await drag(false); const moved=await persist(s=>row(s,"beta").values.date.start!==initial.start);
    await button(road,"适应全部").click();
    await node.press("Enter"); assert.equal(await field(peek(),"记录标题").inputValue(),"Beta 项目"); await closePeek();
    return {initial,moved:row(moved,"beta").values.date,cancelPreserved:true,px};
  });

  await check("roadmap-export", "Windows 保存框取消及输出真实 PNG、SVG，校验文件内容", async () => {
    const activation=await activateApp();
    await fs.writeFile(artifact('roadmap-before-picker','.json'),JSON.stringify(activation,null,2));
    assert.ok(activation.foregroundAfter.owned,"The isolated application must be foreground before starting the task");
    await nav("roadmap"); const road=db.getByTestId("roadmap-view"); await button(road,"导出").click();
    const panel=dialog(page,"导出时间脉络"); await field(panel,"时间脉络导出背景").selectOption("transparent");
    const cancelled=artifact("cancel-export",".svg");
    const abort=await nativeFile("cancel-save",cancelled,()=>button(panel,"下载 SVG").click());
    await assert.rejects(fs.access(cancelled),{code:"ENOENT"});
    await until(()=>button(panel,"下载 SVG").isEnabled());
    const exportFocus=async()=>{
      const current=()=>panel.evaluate(el=>{const active=document.activeElement;return {documentFocused:document.hasFocus(),tag:active?.tagName,button:active?.closest('button')?.textContent||null,insidePanel:el.contains(active)};});
      const ready=await current();
      await frame(); const twoFrames=await current();
      await new Promise(resolve=>setTimeout(resolve,250));
      return {ready,twoFrames,after250ms:await current()};
    };
    abort.focusAfter=await exportFocus();
    const exports=[], log=artifact('roadmap-native-save','.json');
    await fs.writeFile(log,JSON.stringify({abort,exports},null,2));
    for(const [ext, timing] of [["svg","quick"],["svg","after-reading"],["png","after-reading"]]){
      const destination=artifact("roadmap-actual-"+timing,"."+ext);
      const native=await nativeFile("save",destination,()=>button(panel,"下载 "+ext.toUpperCase()).click());
      const receipt={ext,timing,native};exports.push(receipt);await fs.writeFile(log,JSON.stringify({abort,exports},null,2));
      const bytes=await until(async()=>{try{const data=await fs.readFile(destination);return data.length>100 && data;}catch{return false;}}).catch(()=>null);
      if(!bytes){receipt.missing=true;await fs.writeFile(log,JSON.stringify({abort,exports},null,2));continue;}
      if(ext==="svg"){
        const xml=bytes.toString("utf8");
        assert.ok(xml.includes('viewBox="0 0 1920 1080"') && xml.includes("Alpha 项目"));
        assert.equal(await page.evaluate(source=>new DOMParser().parseFromString(source,"image/svg+xml").querySelectorAll("parsererror").length,xml),0);
      }else{
        assert.ok(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
        assert.equal(bytes.readUInt32BE(16),3840); assert.equal(bytes.readUInt32BE(20),2160);
      }
      await until(()=>button(panel,"下载 "+ext.toUpperCase()).isEnabled());
      Object.assign(receipt,{bytes:bytes.length,sha256:sha256(bytes),readyForNext:true,focusAfter:await exportFocus()});await fs.writeFile(log,JSON.stringify({abort,exports},null,2));
    }
    assert.ok(exports.every(receipt=>receipt.bytes>100),'Missing native export: '+exports.filter(e=>e.missing).map(e=>e.ext+' '+e.timing).join(', '));
    await button(panel,"关闭").click();
    const trigger=button(road,"导出");
    await until(()=>trigger.evaluate(el=>document.activeElement===el));
    for (const [record,name] of [[abort,"下载 SVG"],...exports.map(r=>[r,"下载 "+r.ext.toUpperCase()])]) {
      const native=record.native || record;
      assert.ok(native.foregroundBeforeOpen?.owned && native.foregroundBeforeConfirm?.owned,'The isolated app and native save dialog must be foreground before confirmation');
      assert.equal(native.appForegroundAfter,true,'Native focus did not return to the isolated release');
      for (const position of ['twoFrames','after250ms']) {
        const focus=record.focusAfter[position];
        assert.ok(focus.documentFocused && focus.insidePanel && focus.button===name, 'Focus after '+native.action+' '+name+' '+position+': '+JSON.stringify(focus));
      }
    }
    await trigger.click();
    const alternate = button(road,"适应全部");
    const closeBox = await button(panel,"关闭").boundingBox();
    const alternateBox = await alternate.boundingBox();
    const detachedFile = artifact("roadmap-closed-panel-after-reading", ".png");
    let leftPanel;
    const detachedSave = await nativeFile("save", detachedFile, async () => {
      await button(panel,"下载 PNG").press("Enter");
      await page.mouse.click(closeBox.x+closeBox.width/2,closeBox.y+closeBox.height/2);
      await panel.waitFor({state:"detached"});
      await page.mouse.click(alternateBox.x+alternateBox.width/2,alternateBox.y+alternateBox.height/2);
      leftPanel=await alternate.evaluate(el=>({at:Date.now(),focused:document.hasFocus() && document.activeElement===el}));
    });
    const detachedBytes=await until(async()=>{try{const data=await fs.readFile(detachedFile);return data.length>100 && data;}catch{return false;}});
    await frame(); await new Promise(resolve=>setTimeout(resolve,250));
    const finalFocus=await alternate.evaluate(el=>({documentFocused:document.hasFocus(),onAlternate:document.activeElement===el,tag:document.activeElement?.tagName}));
    const closedPanel={leftPanel,native:detachedSave,bytes:detachedBytes.length,sha256:sha256(detachedBytes),finalFocus};
    await fs.writeFile(log,JSON.stringify({abort,exports,closedPanel},null,2));
    assert.ok(leftPanel.focused && leftPanel.at<detachedSave.dialogSeenAt,"The focus transfer must happen while the application still owns the foreground");
    assert.ok(finalFocus.documentFocused && finalFocus.onAlternate,"Finishing an export moved focus away from the newly chosen control");
    assert.equal(await panel.count(),0);
    return {abort,exports,closedFocus:"导出",closedPanel};
  });
}
