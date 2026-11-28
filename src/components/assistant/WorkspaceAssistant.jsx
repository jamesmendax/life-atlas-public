import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import IconArrowUp from "@tabler/icons-react/dist/esm/icons/IconArrowUp.mjs";
import IconCheck from "@tabler/icons-react/dist/esm/icons/IconCheck.mjs";
import IconChevronLeft from "@tabler/icons-react/dist/esm/icons/IconChevronLeft.mjs";
import IconChevronRight from "@tabler/icons-react/dist/esm/icons/IconChevronRight.mjs";
import IconFileText from "@tabler/icons-react/dist/esm/icons/IconFileText.mjs";
import IconHistory from "@tabler/icons-react/dist/esm/icons/IconHistory.mjs";
import IconLanguage from "@tabler/icons-react/dist/esm/icons/IconLanguage.mjs";
import IconLayoutSidebarRight from "@tabler/icons-react/dist/esm/icons/IconLayoutSidebarRight.mjs";
import IconListCheck from "@tabler/icons-react/dist/esm/icons/IconListCheck.mjs";
import IconMessageCircle from "@tabler/icons-react/dist/esm/icons/IconMessageCircle.mjs";
import IconMessagePlus from "@tabler/icons-react/dist/esm/icons/IconMessagePlus.mjs";
import IconPaperclip from "@tabler/icons-react/dist/esm/icons/IconPaperclip.mjs";
import IconPencil from "@tabler/icons-react/dist/esm/icons/IconPencil.mjs";
import IconPhoto from "@tabler/icons-react/dist/esm/icons/IconPhoto.mjs";
import IconScan from "@tabler/icons-react/dist/esm/icons/IconScan.mjs";
import IconSettings from "@tabler/icons-react/dist/esm/icons/IconSettings.mjs";
import IconSparkles from "@tabler/icons-react/dist/esm/icons/IconSparkles.mjs";
import IconSquare from "@tabler/icons-react/dist/esm/icons/IconSquare.mjs";
import IconX from "@tabler/icons-react/dist/esm/icons/IconX.mjs";
import { isAssistantTaskContinuation, runWorkspaceAssistant } from "../../assistant/runWorkspaceAssistant.js";
import { executeDesktopTool } from "../../assistant/desktopTools.js";
import { assistantPromptHistory, createAssistantConversation, createAssistantMessage, maxAssistantAttachmentBytes, maxAssistantAttachments, maxAssistantMessageLength, maxAssistantTitleLength } from "../../assistant/conversation.js";
import { assistantResult, useAssistantConversationSession } from "../../assistant/conversationSession.js";
import { AssistantConnection } from "./AssistantConnection.jsx";
import { AssistantMarkdown } from "./AssistantMarkdown.jsx";
import { formatProcessSummary, groupTranscriptItems, summarizeToolSteps } from "./assistantTranscriptModel.js";
import { format, useI18n } from "../../i18n/workspaceRuntime.js";

const OcrPanel = lazy(() => import("./OcrPanel.jsx"));
const emptyDraft = { content: "", attachments: [], scope: "auto" };

function ToolButton({ title, icon: Icon, ...props }) {
  return <button type="button" className="assistant-tool-button" aria-label={title} title={title} {...props}><Icon size={17} stroke={1.65} aria-hidden="true" /></button>;
}

function Attachments({ attachments, onRemove, disabled }) {
  const { t } = useI18n();
  if (!attachments?.length) return null;
  return <ul className="assistant-attachments" aria-label={t("assistant.attachmentsAria")}>
    {attachments.map(({ id, name, kind, assetUrl, imageUrl }, index) => <li key={`${id}-${index}`} title={name}>
      {kind === "image" ? <>
        <img src={imageUrl || assetUrl} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />
        <IconPhoto className="assistant-image-fallback" size={15} aria-hidden="true" />
      </> : <IconFileText size={15} aria-hidden="true" />}
      <span>{name}</span>
      {onRemove && <ToolButton title={t("assistant.removeAttachment", { name })} icon={IconX} onClick={() => onRemove(index)} disabled={disabled} />}
    </li>)}
  </ul>;
}

function nearScrollEnd({ scrollHeight, clientHeight, scrollTop }) {
  return scrollHeight - clientHeight - scrollTop <= 12;
}

const DOCK_STORAGE_KEY = "life-atlas.assistant.docked";
const WIDTH_STORAGE_KEY = "life-atlas.assistant.width";
const MIN_DOCK_WIDTH = 340;
const MAX_DOCK_WIDTH = 640;
const DEFAULT_DOCK_WIDTH = 400;

function readInitialDocked() {
  try {
    const stored = localStorage.getItem(DOCK_STORAGE_KEY);
    if (stored === "0") return false;
    if (stored === "1") return true;
  } catch {}
  return true;
}

function readInitialDockWidth() {
  try {
    const parsed = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
    if (Number.isFinite(parsed) && parsed >= MIN_DOCK_WIDTH && parsed <= MAX_DOCK_WIDTH) return Math.round(parsed);
  } catch {}
  return DEFAULT_DOCK_WIDTH;
}

function AssistantProcessTrace({ reasoning, tools = [], live = false }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(live);
  const wasLive = useRef(live);
  const body = useRef(null);
  const followsText = useRef(true);
  const hasReasoning = Boolean(reasoning && reasoning.trim());
  const groupedTools = useMemo(() => summarizeToolSteps(tools), [tools]);

  useEffect(() => {
    if (wasLive.current && !live) setOpen(false);
    wasLive.current = live;
  }, [live]);

  useLayoutEffect(() => {
    if (live && open && followsText.current && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [live, open, reasoning, groupedTools.length]);

  if (!hasReasoning && !groupedTools.length) return null;

  const summaryLabel = formatProcessSummary({ hasReasoning, tools, live });

  return <details className={`assistant-reasoning assistant-process${live ? " is-live" : ""}`} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>
      <IconChevronRight size={14} className="assistant-process-chevron" aria-hidden="true" />
      {live && <span className="assistant-process-pulse" aria-hidden="true" />}
      <span className="assistant-process-title">{summaryLabel}</span>
      <span className="assistant-process-hint">{live ? t("assistant.trace.live") : open ? t("assistant.trace.collapse") : t("assistant.trace.expand")}</span>
    </summary>
    <div className="assistant-process-body">
      {hasReasoning && (
        <p className="assistant-reasoning-text" tabIndex={0} ref={body} aria-live="off"
          onScroll={(event) => { followsText.current = nearScrollEnd(event.currentTarget); }}>{reasoning}</p>
      )}
      {groupedTools.length > 0 && (
        <ul className="assistant-process-steps" aria-label={t("assistant.stepsAria")}>
          {groupedTools.map((step) => (
            <li key={step.id} className={`assistant-process-step${step.error ? " is-error" : ""}`}>
              <span className="assistant-process-step-icon" aria-hidden="true">
                {step.error ? <IconX size={12} /> : <IconCheck size={12} />}
              </span>
              <span className="assistant-process-step-main">
                <span className="assistant-process-step-label">{step.label}</span>
                {step.detail && <> <span className="assistant-process-step-detail">{step.detail}</span></>}
              </span>
              {step.count > 1 && <span className="assistant-process-step-count">×{step.count}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  </details>;
}

function ConversationHistory({ session, disabled, error, onSelect, onRename }) {
  const { locale, t } = useI18n();
  const [renaming, setRenaming] = useState(null);
  async function rename(event) {
    event.preventDefault();
    if (await onRename(renaming.id, renaming.title.trim())) setRenaming(null);
  }

  return <div className="assistant-inner assistant-history">
    {session.historyError && <p role="alert" className="assistant-error">{session.historyError}</p>}
    {session.historyError && <button type="button" className="mb-button" onClick={session.load}>{t("assistant.history.reload")}</button>}
    {session.available && !session.historyError && !session.history && <p className="assistant-muted" role="status">{t("assistant.history.loading")}</p>}
    {!session.available && <p className="assistant-muted">{t("assistant.history.desktopOnly")}</p>}
    {session.history?.length === 0 && <p className="assistant-muted">{t("assistant.history.empty")}</p>}
    {session.history?.length > 0 && <ul aria-label={t("assistant.history.listAria")}>
      {session.history.map((entry) => <li key={entry.id} className="assistant-history-row">
        {renaming?.id === entry.id ? <form onSubmit={rename} onKeyDown={(event) => {
          if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); setRenaming(null); }
        }}>
          <input className="mb-field" aria-label={t("assistant.history.nameAria")} value={renaming.title} maxLength={maxAssistantTitleLength} autoFocus
            disabled={disabled} onChange={(event) => setRenaming({ id: entry.id, title: event.target.value })} />
          <button className="mb-button" type="button" disabled={disabled} onClick={() => setRenaming(null)}>{t("common.cancel")}</button>
          <button className="mb-button mb-primary" type="submit" disabled={disabled || !renaming.title.trim()}>{t("common.save")}</button>
        </form> : <>
          <button type="button" className="assistant-history-title" aria-current={session.conversation?.id === entry.id ? "true" : undefined}
            disabled={disabled} onClick={() => onSelect(entry.id)}>
            <strong>{entry.title}</strong>
            <time dateTime={entry.updatedAt}>{format.formatDateTime(entry.updatedAt, locale)}</time>
          </button>
          <ToolButton title={t("assistant.renameChat", { title: entry.title })} icon={IconPencil} disabled={disabled} onClick={() => setRenaming({ id: entry.id, title: entry.title })} />
        </>}
      </li>)}
    </ul>}
    {error && <p className="assistant-error" role="alert">{error}</p>}
  </div>;
}

export function WorkspaceAssistant({ getWorkspace, getCurrentPageId, applyWorkspace, pageTitle, openPane, flushWorkspace }) {
  const { t } = useI18n();
  const bridge = window.lifeAtlas?.assistant;
  const prompts = useMemo(() => [
    [IconFileText, t("assistant.prompt.summarize"), t("assistant.prompt.summarizeAsk")],
    [IconLanguage, t("assistant.prompt.translate"), t("assistant.prompt.translateAsk")],
    [IconListCheck, t("assistant.prompt.todos"), t("assistant.prompt.todosAsk")],
  ], [t]);
  const workspacePrompts = useMemo(() => [
    [IconSettings, t("assistant.prompt.settings"), t("assistant.prompt.settingsAsk")],
    [IconListCheck, t("assistant.prompt.backup"), t("assistant.prompt.backupAsk")],
  ], [t]);
  const [view, setView] = useState(null);
  const [radial, setRadial] = useState(false);
  const [docked, setDocked] = useState(readInitialDocked);
  const [dockWidth, setDockWidth] = useState(readInitialDockWidth);
  const [resizing, setResizing] = useState(false);
  const resizeStart = useRef(null);
  const dockWidthRef = useRef(dockWidth);
  dockWidthRef.current = dockWidth;
  const [selectingScreen, setSelectingScreen] = useState(false);
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState("");
  const [drafts, setDrafts] = useState(() => new Map());
  const [editing, setEditing] = useState(null);
  const [operation, setOperation] = useState(null);
  const [attaching, setAttaching] = useState(false);
  const [runEvents, setRunEvents] = useState([]);
  const [liveReply, setLiveReply] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const operationRef = useRef(null);
  const attachingRef = useRef(false);
  const runRef = useRef(null);
  const continuations = useRef(new Map());
  const trigger = useRef(null);
  const panel = useRef(null);
  const radialMenu = useRef(null);
  const input = useRef(null);
  const fileInput = useRef(null);
  const transcript = useRef(null);
  const followsTranscript = useRef(true);
  const session = useAssistantConversationSession(bridge);
  const { conversation, load } = session;
  const sessionKey = conversation?.id ?? "";
  const draft = drafts.get(sessionKey) ?? emptyDraft;
  const composer = editing ?? draft;
  const messages = conversation?.messages ?? [];
  const lastMessage = messages.at(-1);
  const continuation = continuations.current.get(sessionKey);
  const canContinueFromComposer = ({ content, scope, attachments }) => continuation && !editing && !attachments?.length
    && continuation.replyId === lastMessage?.id && isAssistantTaskContinuation(content) && (scope !== "general" || !continuation.progress.workspaceEnabled);
  const composerContinuesTask = canContinueFromComposer(composer);
  const workspaceInComposer = composerContinuesTask ? continuation.progress.workspaceEnabled : composer.scope !== "general";
  const busy = operation === "reply";
  const controlsDisabled = Boolean(operation || attaching);
  const isChat = view === "chat";
  const isHistory = view === "history";

  useEffect(() => {
    if (!bridge) return;
    let live = true;
    let request = 0;
    async function read() {
      const id = ++request;
      try {
        const result = await bridge.getConfig();
        if (!live || id !== request) return;
        setConfig(assistantResult(result, t("assistant.configReadErr")));
        setConfigError("");
      } catch (failure) { if (live && id === request) setConfigError(failure.message); }
    }
    void read();
    window.addEventListener("lifeatlas:assistant-config-changed", read);
    return () => { live = false; window.removeEventListener("lifeatlas:assistant-config-changed", read); };
  }, [bridge]);

  useEffect(() => { if (isChat || isHistory) void load(); }, [isChat, isHistory, load]);

  useEffect(() => {
    document.documentElement.style.setProperty("--assistant-dock-width", `${dockWidth}px`);
    return () => { document.documentElement.style.removeProperty("--assistant-dock-width"); };
  }, [dockWidth]);

  function toggleDocked() {
    setDocked((current) => {
      const next = !current;
      try { localStorage.setItem(DOCK_STORAGE_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  }

  function commitDockWidth(width) {
    const clamped = Math.max(MIN_DOCK_WIDTH, Math.min(MAX_DOCK_WIDTH, Math.round(width)));
    setDockWidth(clamped);
    try { localStorage.setItem(WIDTH_STORAGE_KEY, String(clamped)); } catch {}
  }

  const transcriptEntries = useMemo(() => groupTranscriptItems(messages, runEvents, liveReply), [messages, runEvents, liveReply]);

  useEffect(() => () => runRef.current?.abort(), []);
  useEffect(() => {
    function shortcut(event) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "j" || event.isComposing || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      setRadial(false);
      setView("chat");
      requestAnimationFrame(() => input.current?.focus());
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  useEffect(() => {
    if (view === "chat") input.current?.focus({ preventScroll: true });
    else if (view) panel.current?.focus({ preventScroll: true });
  }, [view]);
  useLayoutEffect(() => {
    if (isChat) followsTranscript.current = true;
  }, [isChat, sessionKey]);
  useLayoutEffect(() => {
    const log = transcript.current;
    if (isChat && log && followsTranscript.current) log.scrollTop = log.scrollHeight;
  }, [isChat, busy, conversation?.messages, runEvents, liveReply]);
  useEffect(() => {
    if (!radial) return;
    radialMenu.current?.querySelector("button")?.focus({ preventScroll: true });
    function outside(event) {
      if (!radialMenu.current?.contains(event.target) && !trigger.current?.contains(event.target)) setRadial(false);
    }
    window.addEventListener("pointerdown", outside, true);
    return () => window.removeEventListener("pointerdown", outside, true);
  }, [radial]);

  function close() {
    setRadial(false);
    setView(null);
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  }
  function open(next) {
    setRadial(false);
    setView(next);
  }

  function beginOperation(name) {
    if (operationRef.current || attachingRef.current) return false;
    operationRef.current = name;
    setOperation(name);
    setError("");
    setStatus("");
    return true;
  }

  function finishOperation() {
    operationRef.current = null;
    setOperation(null);
  }

  function changeComposer(changes) {
    if (editing) setEditing((current) => current && { ...current, ...changes });
    else setDrafts((current) => new Map(current).set(sessionKey, { ...(current.get(sessionKey) ?? emptyDraft), ...changes }));
  }

  async function openConversation(id) {
    if (!session.available || !beginOperation("select")) return;
    try {
      if (!await session.select(id)) return;
      setEditing(null);
      if (id === null) setDrafts((current) => { const next = new Map(current); next.delete(""); return next; });
      open("chat");
      requestAnimationFrame(() => input.current?.focus());
    } catch (failure) { setError(failure.message || t("assistant.openErr")); }
    finally { finishOperation(); }
  }

  function newChat() {
    if (!view) open("chat");
    void openConversation(null);
  }

  async function renameConversation(id, title) {
    if (!title || !beginOperation("rename")) return false;
    try {
      const target = await session.get(id);
      if (target.title !== title) await session.save({ ...target, title });
      return true;
    } catch (failure) { setError(failure.message || t("assistant.renameErr")); return false; }
    finally { finishOperation(); }
  }

  function editMessage(message) {
    setEditing({ messageId: message.id, content: message.content, attachments: message.attachments, scope: "general" });
    setError("");
    setStatus("");
    requestAnimationFrame(() => input.current?.focus());
  }

  async function attachFiles(files) {
    if (!files.length || !bridge?.prepareAttachment || attachingRef.current || operationRef.current) return;
    attachingRef.current = true;
    setAttaching(true);
    setError("");
    const attachments = [...composer.attachments];
    const slots = maxAssistantAttachments - attachments.length;
    let failure = files.length > slots ? t("assistant.maxAttachErr", { max: maxAssistantAttachments }) : "";
    try {
      for (const file of files.slice(0, slots)) {
        try {
          if (!file.size || file.size > maxAssistantAttachmentBytes) throw new Error(t("assistant.attachSizeErr"));
          const result = await bridge.prepareAttachment({ name: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
          attachments.push(assistantResult(result, t("assistant.attachAddErr")));
        } catch (error) { failure ||= `${file.name}: ${error.message || t("assistant.attachAddErr")}`; }
      }
      changeComposer({ attachments });
      setError(failure);
    } finally {
      attachingRef.current = false;
      setAttaching(false);
    }
  }

  async function runReply(saved, attachments, workspaceEnabled, controller, resume) {
    const events = [];
    const replyId = crypto.randomUUID();
    let reasoning = "";
    let nextContinuation;
    let wroteWorkspace = false;
    try {
      const reply = await runWorkspaceAssistant({
        complete: bridge.complete, cancel: bridge.cancel, assistant: bridge, messages: assistantPromptHistory(saved.messages),
        attachments: attachments.filter(({ text, imageUrl }) => text || imageUrl), workspaceEnabled, resume,
        getWorkspace, getCurrentPageId: () => saved.messages.at(-1).contextPageId ?? null, applyWorkspace,
        runDesktopTool: (name, args, context) => executeDesktopTool(name, args, { ...context, api: window.lifeAtlas, openPane, flushWorkspace }),
        configurationId: config.configurationId, signal: controller.signal,
        onContinuation: (progress) => { nextContinuation = progress; },
        onReasoning: (text) => {
          if (controller.signal.aborted || text === reasoning || !text.trim()) return;
          reasoning = text;
          setLiveReply({ id: replyId, role: "assistant", reasoning });
        },
        onTool: (tool) => {
          wroteWorkspace ||= tool.kind === "written";
          const content = [tool.label || tool.name, tool.message].filter(Boolean).join(" · ");
          events.push({ id: crypto.randomUUID(), role: "tool", content, error: !tool.ok });
          setRunEvents([...events]);
        },
      });
      if (!controller.signal.aborted) {
        events.push({ id: replyId, role: "assistant", content: reply, ...(reasoning ? { reasoning } : {}) });
        if (nextContinuation) continuations.current.set(saved.id, { progress: nextContinuation, replyId });
        else if (resume) continuations.current.delete(saved.id);
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message || t("assistant.replyFailErr"));
    }
    if (wroteWorkspace && flushWorkspace) {
      try { assistantResult(await flushWorkspace(), t("assistant.unsavedFlushErr")); }
      catch (failure) {
        const message = failure.message || t("assistant.unsavedFlushErr");
        const result = events.findLast((event) => event.role === "assistant");
        if (result) result.content = `${result.content.slice(0, 31998 - message.length)}\n\n${message}`;
        setError(message);
      }
    }
    if (controller.signal.aborted) setStatus(t("assistant.stoppedStatus"));
    setLiveReply(null);
    setRunEvents([]);
    if (events.length) {
      const next = { ...saved, messages: [...saved.messages, ...events] };
      session.retain(next);
      try { await session.save(next); }
      catch (failure) { setError(failure.message || t("assistant.saveReplyErr")); }
    }
  }

  const originalMessage = editing && messages.find((message) => message.id === editing.messageId);
  const editUnchanged = originalMessage && composer.content.trim() === originalMessage.content
    && composer.attachments.length === originalMessage.attachments.length
    && composer.attachments.every((attachment, index) => attachment.id === originalMessage.attachments[index].id);
  const composerEnabled = session.available && session.history !== null;
  const canSubmit = composerEnabled && !controlsDisabled && !editUnchanged && (composer.content.trim() || composer.attachments.length);

  async function send(proposed = composer, { retry = false, continueTask = false } = {}) {
    const { attachments, scope } = proposed;
    const content = proposed.content.trim();
    if (!composerEnabled || (!content && !attachments.length) || (!retry && editUnchanged) || operationRef.current || attachingRef.current) return;
    if (!config?.configured) {
      if (!retry && !continueTask) changeComposer({ content, attachments, scope });
      open("config");
      return;
    }
    if (!beginOperation("reply")) return;
    followsTranscript.current = true;
    const controller = new AbortController();
    runRef.current = controller;
    try {
      const resume = !retry && (continueTask || canContinueFromComposer(proposed)) ? continuation?.progress : null;
      const workspaceEnabled = resume ? resume.workspaceEnabled : retry ? proposed.workspaceEnabled : scope !== "general";
      let saved = conversation;
      if (!retry) {
        const contextPageId = resume ? resume.currentPageId : workspaceEnabled ? getCurrentPageId?.() : null;
        const message = createAssistantMessage(content, attachments, workspaceEnabled, contextPageId);
        const next = editing ? createAssistantConversation(message, { source: conversation, messageId: editing.messageId })
          : conversation ? { ...conversation, messages: [...messages, message] } : createAssistantConversation(message);
        saved = await session.save(next, { select: true });
        if (!continueTask) setDrafts((current) => {
          const updated = new Map(current).set(saved.id, { ...emptyDraft, scope: editing ? emptyDraft.scope : scope });
          if (!conversation) updated.delete("");
          return updated;
        });
        setEditing(null);
      }
      await runReply(saved, attachments, workspaceEnabled, controller, resume);
    } catch (failure) { setError(failure.message || t("assistant.sendErr")); }
    finally {
      runRef.current = null;
      finishOperation();
      requestAnimationFrame(() => { if (document.activeElement === document.body) input.current?.focus({ preventScroll: true }); });
    }
  }

  async function savePending() {
    if (!conversation || !beginOperation("save")) return;
    try { await session.save(conversation); }
    catch (failure) { setError(failure.message || t("assistant.saveErr")); }
    finally { finishOperation(); }
  }

  return <>
    {!view && <div className="assistant-launcher" data-html2canvas-ignore="true">
      {radial && <div className="assistant-orbit" ref={radialMenu} role="group" aria-label={t("assistant.quickToolsAria")} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); close(); }
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault();
          const buttons = [...radialMenu.current.querySelectorAll("button")];
          const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
          buttons[(buttons.indexOf(document.activeElement) + delta + buttons.length) % buttons.length]?.focus();
        }
      }}>
        <ToolButton title={t("assistant.ocrTitle")} icon={IconScan} onClick={() => open("ocr")} />
        <ToolButton title={t("assistant.newChatTitle")} icon={IconMessagePlus} onClick={newChat} />
        <ToolButton title={t("assistant.connTitle")} icon={IconSettings} onClick={() => open("config")} />
      </div>}
      <button type="button" ref={trigger} className="assistant-orb" aria-label={t("assistant.openAria")} aria-expanded={radial}
        onClick={() => open("chat")} onContextMenu={(event) => { event.preventDefault(); setRadial((v) => !v); }}
        onKeyDown={(event) => { if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); setRadial(true); } }}>
        <IconSparkles size={24} stroke={1.5} aria-hidden="true" />
      </button>
      {!radial && <span className="assistant-orb-tooltip" aria-hidden="true">{t("assistant.openAria")} <kbd>Ctrl+J</kbd></span>}
    </div>}
    {view && <aside ref={panel} tabIndex={-1} className={`workspace-assistant ${docked ? "is-docked" : "is-floating"}${resizing ? " is-resizing" : ""}${view === "config" ? " is-connection" : ""}${selectingScreen ? " is-capturing" : ""}`}
      data-html2canvas-ignore="true" aria-label={view === "ocr" ? t("assistant.ocrWindowAria") : t("assistant.title")} onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented && !event.isComposing && !selectingScreen) {
          event.preventDefault();
          event.stopPropagation();
          if (isChat && editing && !controlsDisabled) setEditing(null);
          else close();
        }
      }}>
      {docked && (
        <div
          className="assistant-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("assistant.resizeAria")}
          aria-valuemin={MIN_DOCK_WIDTH}
          aria-valuemax={MAX_DOCK_WIDTH}
          aria-valuenow={dockWidth}
          tabIndex={0}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            resizeStart.current = { x: event.clientX, width: dockWidthRef.current };
            event.currentTarget.setPointerCapture(event.pointerId);
            setResizing(true);
          }}
          onPointerMove={(event) => {
            if (!resizeStart.current) return;
            const next = Math.max(MIN_DOCK_WIDTH, Math.min(MAX_DOCK_WIDTH, Math.round(resizeStart.current.width + (resizeStart.current.x - event.clientX))));
            dockWidthRef.current = next;
            setDockWidth(next);
          }}
          onPointerUp={(event) => {
            if (!resizeStart.current) return;
            resizeStart.current = null;
            setResizing(false);
            event.currentTarget.releasePointerCapture(event.pointerId);
            commitDockWidth(dockWidthRef.current);
          }}
          onPointerCancel={() => {
            if (!resizeStart.current) return;
            resizeStart.current = null;
            setResizing(false);
            commitDockWidth(dockWidthRef.current);
          }}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? MIN_DOCK_WIDTH : event.key === "End" ? MAX_DOCK_WIDTH : dockWidthRef.current + (event.key === "ArrowLeft" ? 16 : -16);
            commitDockWidth(next);
          }}
        />
      )}
      <header className="assistant-window-head">
        {isChat ? <span className="assistant-small-mark"><IconSparkles size={18} /></span> : <ToolButton title={t("assistant.backToChat")} icon={IconChevronLeft} onClick={() => open("chat")} />}
        <strong title={isChat ? conversation?.title : undefined}>{isChat ? (conversation?.title ?? t("assistant.title")) : isHistory ? t("assistant.historyTitle") : view === "ocr" ? t("assistant.ocrTitle") : t("assistant.connTitle")}</strong>
        <div className="assistant-window-actions">
          {isChat && <>
            <ToolButton title={t("assistant.historyTitle")} icon={IconHistory} disabled={controlsDisabled} onClick={() => open("history")} />
            <ToolButton title={t("assistant.connTitle")} icon={IconSettings} onClick={() => open("config")} />
          </>}
          <ToolButton title={docked ? t("assistant.toFloating") : t("assistant.toDocked")} icon={docked ? IconMessageCircle : IconLayoutSidebarRight} onClick={toggleDocked} />
          {(isChat || isHistory) && <ToolButton title={t("assistant.newChatTitle")} icon={IconMessagePlus} disabled={controlsDisabled || !session.available} onClick={newChat} />}
          <ToolButton title={docked ? t("assistant.closeDocked") : t("assistant.closeFloating")} icon={IconX} onClick={close} />
        </div>
      </header>
      {view === "config" && <div className="assistant-inner"><AssistantConnection bridge={bridge} onSaved={(next) => { setConfig(next); setConfigError(""); }} /></div>}
      {isHistory && <ConversationHistory session={session} disabled={controlsDisabled} error={error} onSelect={openConversation} onRename={renameConversation} />}
      {view === "ocr" && <div className="assistant-inner"><Suspense fallback={<p role="status">{t("assistant.ocrLoading")}</p>}>
        <OcrPanel onClose={close} onScreenSelectingChange={setSelectingScreen} />
      </Suspense></div>}
      {isChat && <>
        <div ref={transcript} className="assistant-transcript" role="log" aria-label={t("assistant.transcriptAria")} aria-live="polite"
          onScroll={(event) => { followsTranscript.current = nearScrollEnd(event.currentTarget); }}>
          {session.available && !session.historyError && !session.history && <p className="assistant-muted" role="status">{t("assistant.history.loading")}</p>}
          {session.historyError && <div className="assistant-recovery"><p className="assistant-error" role="alert">{session.historyError}</p><button className="mb-button" type="button" onClick={load}>{t("assistant.history.reload")}</button></div>}
          {!session.available && <p className="assistant-muted">{t("assistant.desktopPrompt")}</p>}
          {composerEnabled && !messages.length && <div className="assistant-welcome">
            <div className="assistant-welcome-mark"><IconSparkles size={28} stroke={1.45} /></div>
            <h3>{t("assistant.welcomeHeading")}</h3>
            <p className="assistant-muted">{t("assistant.welcomeSub")}</p>
            {draft.scope !== "general" && (pageTitle ? prompts : workspacePrompts).map(([Icon, label, prompt]) => <button type="button" key={label} disabled={controlsDisabled || Boolean(draft.content.trim() || draft.attachments.length)}
              onClick={() => void send({ ...draft, content: prompt })}><Icon size={17} stroke={1.55} aria-hidden="true" />{label}</button>)}
          </div>}
          {conversation?.sourceId && <div className="assistant-version">
            <span>{t("assistant.savedFromEdit")}</span><button type="button" className="assistant-text-button" disabled={controlsDisabled} onClick={() => void openConversation(conversation.sourceId)}>{t("assistant.openSource")}</button>
          </div>}
          {transcriptEntries.map((entry) => entry.kind === "user" ? (
            <div key={entry.id} className="assistant-message-row is-user">
              <ToolButton title={t("assistant.editMessage")} icon={IconPencil} disabled={controlsDisabled} onClick={() => editMessage(entry.message)} />
              <div className="assistant-message is-user" aria-label={t("assistant.userAria")}>
                {entry.message.content}<Attachments attachments={entry.message.attachments} />
              </div>
            </div>
          ) : (
            <div key={entry.id} className="assistant-message-row is-assistant">
              <AssistantProcessTrace reasoning={entry.assistant?.reasoning} tools={entry.tools} live={entry.live} />
              {entry.assistant && entry.assistant !== liveReply && (
                <div className="assistant-message is-assistant" aria-label={t("assistant.assistantAria")}>
                  <AssistantMarkdown content={entry.assistant.content} />
                  <Attachments attachments={entry.assistant.attachments} />
                </div>
              )}
            </div>
          ))}
          {busy && <p className="assistant-working" role="status">{t("common.processing")}</p>}
          {status && <p className="assistant-working" role="status">{status}</p>}
          {error && <p className="assistant-error" role="alert">{error}</p>}
          {configError && <p className="assistant-error" role="alert">{configError}</p>}
          {session.hasUnsaved && !busy && <div className="assistant-recovery"><p className="assistant-muted">{t("assistant.unsavedReplyNotice")}</p><button className="mb-button" type="button" disabled={controlsDisabled} onClick={savePending}>{t("assistant.retrySave")}</button></div>}
          {lastMessage?.role === "user" && !lastMessage.workspaceEnabled && !controlsDisabled && !editing && <button className="mb-button assistant-retry" type="button" onClick={() => void send(lastMessage, { retry: true })}>{t("assistant.retryReply")}</button>}
          {continuation && !editing && <button className="mb-button assistant-retry" type="button" disabled={controlsDisabled} onClick={() => void send({ ...emptyDraft, content: t("assistant.continueTaskAsk") }, { continueTask: true })}>{t("assistant.continueTaskBtn")}</button>}
        </div>
        <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          {editing && <div className="assistant-edit-notice">
            <strong>{t("assistant.editMessage")}</strong>
            <button type="button" className="assistant-text-button" onClick={() => { setEditing(null); input.current?.focus(); }} disabled={controlsDisabled}>{t("assistant.cancelEdit")}</button>
            <p className="assistant-muted">{t("assistant.editNotice")}{workspaceInComposer && t("assistant.editWorkspaceWarn")}</p>
          </div>}
          <textarea ref={input} aria-label={editing ? t("assistant.editInputAria") : t("assistant.inputAria")} placeholder={t("assistant.inputPh")}
            rows="2" value={composer.content} maxLength={maxAssistantMessageLength} disabled={!composerEnabled || Boolean(operation)} onChange={(event) => changeComposer({ content: event.target.value })}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void send(); } }}
            onPaste={(event) => {
              if (!bridge?.prepareAttachment || controlsDisabled) return;
              const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/") || /\.(?:png|jpe?g|webp)$/i.test(file.name));
              if (!images.length) return;
              if (!event.clipboardData.getData("text/plain")) event.preventDefault();
              void attachFiles(images);
            }} />
          <Attachments attachments={composer.attachments} disabled={controlsDisabled} onRemove={(index) => changeComposer({ attachments: composer.attachments.filter((_, i) => i !== index) })} />
          {attaching && <p role="status" className="assistant-working">{t("assistant.attaching")}</p>}
          {composerEnabled && workspaceInComposer && (composerContinuesTask || pageTitle) && <p className="assistant-page-context" title={composerContinuesTask ? undefined : pageTitle}><IconFileText size={14} aria-hidden="true" /><span>{composerContinuesTask ? t("assistant.continuingContext") : t("assistant.currentPageContext", { title: pageTitle })}</span></p>}
          <div className="assistant-composer-actions">
            <input ref={fileInput} hidden type="file" multiple aria-label={t("assistant.pickAttachAria")} onChange={(event) => {
              const files = Array.from(event.target.files);
              event.target.value = "";
              void attachFiles(files);
            }} />
            <ToolButton title={t("assistant.addAttachTitle")} icon={IconPaperclip} disabled={!composerEnabled || !bridge?.prepareAttachment || controlsDisabled || composer.attachments.length >= maxAssistantAttachments} onClick={() => fileInput.current?.click()} />
            <ToolButton title={t("assistant.ocrTitle")} icon={IconScan} onClick={() => open("ocr")} />
            <select className="assistant-scope" aria-label={t("assistant.scopeAria")} title={t("assistant.scopeAria")} value={composer.scope} disabled={!composerEnabled || controlsDisabled}
              onKeyDown={(event) => { if (event.key === "Escape" && event.currentTarget.matches(":open")) event.stopPropagation(); }}
              onChange={(event) => changeComposer({ scope: event.target.value })}>
              <option value="auto">{t("assistant.scopeAuto")}</option>
              <option value="general">{t("assistant.scopeGeneral")}</option>
            </select>
            <button type="button" className="assistant-model" title={config?.configured ? config.model : undefined} onClick={() => open("config")}>{config?.configured ? config.model : t("assistant.connectModel")}</button>
            {busy ? <ToolButton title={t("assistant.stopTitle")} icon={IconSquare} onClick={() => runRef.current?.abort()} /> :
              <button type="submit" className="assistant-send" title={editing ? t("assistant.sendEditTitle") : t("assistant.sendTitle")} aria-label={editing ? t("assistant.sendEditTitle") : t("assistant.sendTitle")} disabled={!canSubmit}><IconArrowUp size={17} /></button>}
          </div>
        </form>
      </>}
    </aside>}
  </>;
}
