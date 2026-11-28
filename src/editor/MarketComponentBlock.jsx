import { useContext, useEffect, useRef, useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import IconPackage from "@tabler/icons-react/dist/esm/icons/IconPackage.mjs";
import IconRefresh from "@tabler/icons-react/dist/esm/icons/IconRefresh.mjs";
import { parseState } from "../domain/marketFrameProtocol.js";
import { LifeAtlasEditorRuntimeContext } from "./EditorRuntime.jsx";
import { PersistentMarketWidget } from "./widgets/MarketWidgetHost.jsx";

function ScriptComponent({ block, editor }) {
  const runtime = useContext(LifeAtlasEditorRuntimeContext);
  const bridge = globalThis.window?.lifeAtlas?.market;
  const surface = useRef(null);
  const dispatch = useRef(null);
  const [shown, setShown] = useState(false);
  const [view, setView] = useState(null);
  const [error, setError] = useState("");
  const [restart, setRestart] = useState(0);
  const [pendingClick, setPendingClick] = useState(false);
  const { id, props: { url, title, packageVersion } } = block;
  const locked = runtime?.locked || !editor.isEditable;
  const canRun = Boolean(bridge && runtime?.pageId && url && !runtime?.syncedAncestry?.length);

  useEffect(() => {
    const target = surface.current;
    if (!target || !globalThis.IntersectionObserver) { setShown(true); return; }
    const observer = new IntersectionObserver(([entry]) => setShown(entry.isIntersecting));
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!canRun || !shown) return;
    const instance = globalThis.crypto.randomUUID();
    let live = true;
    let pendingEvent;
    let queuedClick;
    let failed = false;
    setError("");
    setView(null);
    setPendingClick(false);
    const release = () => { void bridge.release({ id: instance }).catch(() => {}); };
    async function run(event) {
      if (!live || failed || (locked && event.type === "click")) return;
      if (pendingEvent) {
        if (event.type === "click" && pendingEvent !== "click" && !queuedClick) {
          queuedClick = event;
          setPendingClick(true);
        }
        return;
      }
      const before = editor.getBlock(id);
      if (!before || before.props.url !== url) { setPendingClick(false); return; }
      pendingEvent = event.type;
      if (event.type === "click") setPendingClick(true);
      try {
        const result = await bridge.run({ id: instance, url, state: parseState(before.props.state), event });
        if (!live) { release(); return; }
        if (!result?.ok) throw new Error(result?.error?.message || "组件暂时无法运行。");
        const current = editor.getBlock(id);
        if (!current || current.props.url !== url || current.props.state !== before.props.state) return;
        const state = JSON.stringify(result.value.state);
        if (editor.isEditable && !locked && state !== current.props.state) editor.updateBlock(id, { props: { ...current.props, state } });
        setView(result.value.view);
      } catch (failure) {
        if (!live) { release(); return; }
        failed = true;
        setError(failure.message || "组件暂时无法运行。");
      } finally {
        pendingEvent = null;
        const next = queuedClick;
        queuedClick = null;
        if (live && next && !failed) void run(next);
        else if (live && (next || event.type === "click")) setPendingClick(false);
      }
    }
    dispatch.current = run;
    void run({ type: "mount" });
    const tick = window.setInterval(() => void run({ type: "tick" }), 1000);
    return () => { live = false; dispatch.current = null; window.clearInterval(tick); release(); };
  }, [bridge, canRun, editor, id, locked, restart, shown, url]);

  return <section ref={surface} className="market-component" contentEditable={false} aria-label={title || "互动组件"}
    onMouseDown={(event) => event.stopPropagation()} onDragStart={(event) => event.preventDefault()}>
    <header><IconPackage size={16} /><strong>{title || "互动组件"}</strong>{packageVersion && <small>{packageVersion}</small>}</header>
    {view && <div className="market-component-body">{view.map((item, index) => {
      if (item.type === "text") return <p key={index}>{item.text}</p>;
      if (item.type === "progress") return <progress key={index} value={item.value} max={1} aria-label={item.label} />;
      return <button key={item.id} className="mb-button" type="button" disabled={locked || pendingClick || item.disabled} onClick={() => void dispatch.current?.({ type: "click", id: item.id })}>{item.label}</button>;
    })}</div>}
    {!canRun && <p className="market-component-status">在 Life Atlas 桌面工作区运行此组件。</p>}
    {canRun && !view && !error && <p className="market-component-status" role="status">正在加载组件…</p>}
    {error && <div className="market-component-status" role="status"><span>{error}</span> <button className="mb-button" type="button" onClick={() => setRestart((value) => value + 1)}>重试组件</button></div>}
  </section>;
}

function MarketComponent({ block, editor }) {
  const runtime = useContext(LifeAtlasEditorRuntimeContext);
  const bridge = globalThis.window?.lifeAtlas?.market;
  const [resolution, resolve] = useState(null);
  const [reload, setReload] = useState(0);
  const [candidate, setCandidate] = useState(null);
  const [updateNote, setUpdateNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { url, packageId, packageVersion } = block.props;
  const locked = runtime?.locked || !editor.isEditable;
  const canRun = Boolean(bridge?.hostWidget && url && runtime?.pageId && !runtime.syncedAncestry?.length);
  const mounted = useRef(false);
  const current = useRef(null);
  const updateAction = useRef(null);
  current.current = { url, locked };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    const invalidate = (event) => { if (url === "life-asset://" + event.detail?.sha256) setReload((value) => value + 1); };
    window.addEventListener("life-atlas-market-change", invalidate);
    return () => window.removeEventListener("life-atlas-market-change", invalidate);
  }, [url]);
  useEffect(() => {
    setCandidate(null); setUpdateNote("");
    if (!canRun) return;
    let active = true, frameUrl;
    const release = (value) => { if (value) void bridge.releaseFrame?.({ frameUrl: value })?.catch(() => {}); };
    void bridge.hostWidget({ url }).then((result) => {
      const value = result?.value;
      if (!active) { release(value?.frameUrl); return; }
      frameUrl = value?.frameUrl;
      resolve({ url, reload, value, error: result?.ok ? "" : result?.error?.message || "组件包暂不可用。" });
    }, () => { if (active) resolve({ url, reload, error: "组件包暂不可用。" }); });
    return () => { active = false; release(frameUrl); };
  }, [bridge, canRun, reload, url]);
  function unwrap(result) {
    if (!result?.ok) throw new Error(result?.error?.message || "市集操作未完成。");
    return result.value;
  }
  async function checkUpdate() {
    if (busy || locked) return;
    setBusy(true);
    try {
      const sources = await Promise.allSettled([bridge.catalogue().then(unwrap), bridge.installed().then(unwrap)]);
      if (!mounted.current || current.current.url !== url) return;
      if (sources.every((source) => source.status === "rejected")) throw sources[0].reason;
      const candidates = sources.flatMap((source) => source.status === "fulfilled" ? source.value.entries : [])
        .filter((entry) => entry.id === packageId && entry.type === "component" && entry.compatible !== false);
      const compare = (a, b) => a.localeCompare(b, "en", { numeric: true });
      const latest = candidates.filter((item) => compare(item.version, packageVersion) > 0).sort((a, b) => compare(b.version, a.version))[0]
        || (resolution?.error ? candidates.find((item) => "life-asset://" + item.sha256 === url) : null);
      setCandidate(latest || null);
      setUpdateNote(latest ? "" : "暂时没有适用的组件更新。");
    } catch (e) { if (mounted.current && current.current.url === url) setUpdateNote(e.message); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function replacePackage() {
    if (!candidate || busy || locked) return;
    setBusy(true);
    try {
      const prepared = unwrap(await bridge.preview({ sha256: candidate.sha256 }));
      if (!mounted.current || current.current.url !== url || current.current.locked) return;
      const pack = unwrap(await bridge.install({ token: prepared.token }));
      if (pack.id !== packageId || pack.url !== "life-asset://" + candidate.sha256 || pack.version !== candidate.version) throw new Error("下载的组件版本与所选条目不一致。");
      const item = editor.getBlock(block.id);
      if (!mounted.current || current.current.locked || !editor.isEditable || item?.type !== "marketComponent" || item.props.url !== url) return;
      editor.updateBlock(block.id, { props: { ...item.props, url: pack.url, packageVersion: pack.version } });
      window.dispatchEvent(new CustomEvent("life-atlas-market-change", { detail: { sha256: candidate.sha256 } }));
      setCandidate(null);
    } catch (e) { if (mounted.current && current.current.url === url) setUpdateNote(e.message); }
    finally { if (mounted.current) setBusy(false); }
  }
  if (!canRun) return <ScriptComponent block={block} editor={editor} />;
  if (resolution?.url !== url || resolution.reload !== reload) return <section className="market-component" contentEditable={false}>
    <p className="market-component-status" role="status">正在加载组件…</p></section>;
  const rich = resolution.value?.kind === "frame";
  return <div className={rich ? "market-widget-block" : undefined} contentEditable={false}>
    {rich ? <PersistentMarketWidget key={resolution.value.frameUrl}
      resolution={resolution.value} block={block} editor={editor} locked={locked} runtime={runtime} />
    : resolution.error ? <section className="market-component" aria-label={block.props.title || "互动组件"}>
      <strong>{block.props.title || "互动组件"}</strong><p role="status">{resolution.error}</p>
      <button type="button" className="mb-button" onClick={() => setReload((n) => n + 1)}>重新加载</button>
    </section> : <ScriptComponent block={block} editor={editor} />}
    {!locked && packageId && <div className="market-component-status market-widget-update"
      onMouseDown={(event) => event.stopPropagation()}>
      {updateNote && <span role="status">{updateNote}</span>}
      <button type="button" ref={updateAction} className={candidate ? "mb-button" : "mb-button market-update-icon"}
        title={candidate ? undefined : "从市集检查更新"} aria-label={candidate ? undefined : "从市集检查更新"} disabled={busy}
        onClick={candidate ? replacePackage : checkUpdate}>{candidate
          ? (candidate.installed ? "应用本机版本" : "下载并应用") + " " + candidate.version + "，保留区块记录"
          : <IconRefresh size={15} stroke={1.7} aria-hidden="true" />}</button>
      {candidate && <button type="button" className="mb-button" disabled={busy} onClick={() => {
        setCandidate(null); updateAction.current?.focus({ preventScroll: true });
      }}>取消</button>}
    </div>}
  </div>;
}

export const MarketComponentBlock = createReactBlockSpec({
  type: "marketComponent", content: "none",
  propSchema: { url: { default: "" }, title: { default: "" }, packageId: { default: "" }, packageVersion: { default: "" }, state: { default: "{}" } },
}, {
  render: (props) => <MarketComponent {...props} />,
  toExternalHTML: ({ block }) => <p>互动组件 · {block.props.title}</p>,
});
