import { useEffect, useRef, useState } from "react";
import { sharedFormSpec } from "../domain/sharedForm.js";

function checked(result) {
  if (!result?.ok) throw new Error(result?.error?.message || "无法连接表单服务");
  return result.value;
}

export function DatabaseFormShare({ workspace, source, view, runtime }) {
  const service = window.lifeAtlas?.forms;
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(null);
  const [address, setAddress] = useState("");
  const [publicBase, setPublicBase] = useState("");
  const [port, setPort] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const link = useRef(null);
  useEffect(() => {
    if (!service || !open) return;
    let live = true;
    async function refresh() {
      try {
        const status = checked(await service.status({viewId:view.id}));
        if (live) {
          setState(status);
          setAddress(current => current || status.addresses.find(a => a.address !== "127.0.0.1")?.address || "127.0.0.1");
        }
      } catch(e) { if (live) setNotice(e.message); }
    }
    void refresh();
    const timer = setInterval(refresh, 3500);
    return () => { live = false; clearInterval(timer); };
  }, [service, open, view.id]);
  if (!service || runtime?.locked) return null;
  let spec, unavailable;
  try { spec = sharedFormSpec(workspace, view.id); } catch(e) { unavailable = e.message; }
  async function perform(fn) {
    if (busy) return;
    setBusy(true); setNotice("");
    try { await fn(); setState(checked(await service.status({viewId:view.id}))); }
    catch(e) { setNotice(e.message); }
    finally { setBusy(false); }
  }
  return <details className="db-form-share" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>分享表单与收取答卷</summary>
    {open && <div className="db-form-share-panel">
      {!state?.url ? <>
        <p>保持 Life Atlas 开启，同一网络的填写者就能用浏览器直接提交。</p>
        {unavailable && <small role="status">{unavailable}</small>}
        {spec && <small>本次开放 {spec.fields.length} 个问题，包括{spec.fields.map(f => f.name).join("、")}。</small>}
        {spec?.omitted.length > 0 && <small>只在本机填写的字段包括{spec.omitted.join("、")}。</small>}
        <label>访问地址<select value={address} onChange={e => setAddress(e.target.value)}>{state?.addresses.map(entry => <option key={entry.address} value={entry.address}>{entry.label} · {entry.address}</option>)}</select></label>
        <details><summary>使用已有 HTTPS 域名</summary>
          <label>反向代理的公网地址<input type="url" placeholder="https://forms.example.com" value={publicBase} onChange={e => setPublicBase(e.target.value)}/></label>
          <label>本机监听端口<input type="number" min="1024" max="65535" placeholder="自动分配" value={port} onChange={e => setPort(e.target.value)}/></label>
          <small>指定固定端口，将已有域名的反向代理指向所选本机地址和端口。</small>
        </details>
        <div><button type="button" disabled={busy || !state || !spec} onClick={() => perform(async () => {
          await runtime.flushForFormShare();
          checked(await service.start({viewId:view.id, address, ...(port ? {port:Number(port)} : {}), ...(publicBase.trim() ? {publicBase:publicBase.trim()} : {})}));
        })}>开启填写链接</button></div>
      </> : <>
        <label>匿名填写链接<input ref={link} readOnly value={state.url} onFocus={e => e.currentTarget.select()}/></label>
        <small>新答卷自动写入本机数据库。停止分享或退出程序后，此链接失效。</small>
        <div className="db-form-share-actions">
          <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(state.url); setNotice("已复制填写链接"); } catch { link.current?.focus(); link.current?.select(); setNotice("链接已选中，可按 Ctrl+C 复制"); } }}>复制链接</button>
          <button type="button" disabled={busy} onClick={() => perform(async () => { checked(await service.stop({viewId:view.id})); setNotice("填写链接已关闭"); })}>停止分享</button>
        </div>
      </>}
      <div className="db-form-share-actions"><button type="button" disabled={busy || !state} onClick={() => perform(async () => {
        const {responses} = checked(await service.pending({viewId:view.id}));
        if (!responses.length) { setNotice("暂时没有新答卷"); return; }
        const count = await runtime.collectFormResponses(source.id, view.id, responses);
        checked(await service.ack({viewId:view.id, ids:responses.map(r => r.id)}));
        setNotice("已收取 " + count + " 份新答卷");
      })}>收取答卷{state?.pending ? "（" + state.pending + "）" : ""}</button></div>
      {notice && <p role="status">{notice}</p>}
    </div>}
  </details>;
}
