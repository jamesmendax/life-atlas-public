import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { assetHashFromUrl } from "../domain/attachmentUrls.js";
import { blockContext } from "../domain/blockDocument.js";
import { changePomodoro, pomodoroRemaining, readPomodoroState, updatePomodoroSettings, validatePomodoroAudio } from "../domain/pomodoro.js";
import { PomodoroSettingsDialog, PomodoroWidgetView } from "./PomodoroWidgetView.jsx";

const tickSrc = "/assets/pomodoro/mechanical-tick.wav";
const defaultAlarmSrc = "/assets/pomodoro/standard-alarm.wav";
const deadlines = new Map();
const alarms = new Map();
const alarmListeners = new Set();

function subscribeToAlarms(notify) {
  alarmListeners.add(notify);
  return () => alarmListeners.delete(notify);
}

function broadcastAlarms() {
  for (const notify of alarmListeners) notify();
}

function stopAlarm(key) {
  const sound = alarms.get(key);
  if (!sound) return;
  alarms.delete(key);
  sound.pause();
  broadcastAlarms();
}

async function playAlarm(key, settings) {
  if (!settings.finishEnabled || !settings.finishVolume) return;
  stopAlarm(key);
  const sound = new Audio(settings.finishUrl || defaultAlarmSrc);
  sound.volume = settings.finishVolume / 100;
  alarms.set(key, sound);
  broadcastAlarms();
  const stop = () => { if (alarms.get(key) === sound) stopAlarm(key); };
  sound.addEventListener("ended", stop, { once: true });
  try {
    await sound.play();
  } catch {
    if (alarms.get(key) !== sound) return;
    if (settings.finishUrl) {
      sound.src = defaultAlarmSrc;
      try {
        await sound.play();
        return;
      } catch { /* The stop control is removed if neither audio source can play. */ }
    }
    stop();
  }
}

function cancelDeadline(key) {
  const job = deadlines.get(key);
  if (job) window.clearTimeout(job.timeout);
  deadlines.delete(key);
}

function scheduleDeadline(key, endsAt, readLiveState) {
  if (endsAt === null) {
    cancelDeadline(key);
    return;
  }
  if (endsAt <= Date.now() || deadlines.get(key)?.endsAt === endsAt) return;
  cancelDeadline(key);
  const job = { endsAt, timeout: null };
  deadlines.set(key, job);
  const checkDeadline = () => {
    if (deadlines.get(key) !== job) return;
    const remaining = endsAt - Date.now();
    if (remaining > 0) {
      job.timeout = window.setTimeout(checkDeadline, Math.min(remaining, 2_147_483_647));
      return;
    }
    deadlines.delete(key);
    const current = readLiveState();
    if (current?.endsAt === endsAt) void playAlarm(key, current.settings);
  };
  checkDeadline();
}

export function PomodoroMarketWidget({ block, editor, runtime, locked }) {
  const { id, props: { state: serialized, url: packageUrl } } = block;
  const key = runtime.pageId + "/" + id;
  const state = useMemo(() => readPomodoroState(serialized), [serialized]);
  const [now, setNow] = useState(Date.now);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const alive = useRef(true);
  const tick = useRef(null);
  const previousSeconds = useRef(-1);
  const remaining = pomodoroRemaining(state, now);
  const seconds = Math.ceil(remaining / 1000);
  const running = state.endsAt !== null && remaining > 0;
  const ringing = useSyncExternalStore(subscribeToAlarms, () => alarms.has(key));

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      tick.current?.pause();
    };
  }, []);

  const getWorkspace = runtime.getWorkspace;
  const pageId = runtime.pageId;
  useEffect(() => {
    // App-level deadlines survive a page switch. Recheck the block when one
    // expires so deleting it, restoring a backup, or undoing a start is safe.
    scheduleDeadline(key, state.endsAt, () => {
      const page = getWorkspace()?.pages?.find((item) => item.id === pageId && !item.trashedAt);
      const saved = page && blockContext(page.content, id)?.block;
      return saved?.type === "marketComponent" && saved.props.url === packageUrl
        ? readPomodoroState(saved.props.state) : null;
    });
  }, [getWorkspace, id, key, packageUrl, pageId, state.endsAt]);

  useEffect(() => {
    if (state.endsAt === null) return;
    function refresh() { setNow(Date.now()); }
    refresh();
    if (state.endsAt <= Date.now()) return;
    const refreshTimer = window.setInterval(() => {
      refresh();
      if (Date.now() >= state.endsAt) window.clearInterval(refreshTimer);
    }, 100);
    return () => window.clearInterval(refreshTimer);
  }, [state.endsAt]);

  useEffect(() => {
    const previous = previousSeconds.current;
    previousSeconds.current = seconds;
    if (!running || !state.settings.soundEnabled || !state.settings.volume) {
      tick.current?.pause();
      return;
    }
    if (seconds >= previous || document.visibilityState === "hidden") return;
    const sound = tick.current ??= new Audio(tickSrc);
    sound.volume = state.settings.volume / 100;
    sound.currentTime = 0;
    void sound.play().catch(() => {});
  }, [running, seconds, state.settings.soundEnabled, state.settings.volume]);

  function editableBlock() {
    if (!alive.current || locked || !editor.isEditable) return null;
    const current = editor.getBlock(id);
    return current?.type === "marketComponent" && current.props.url === packageUrl ? current : null;
  }

  function updateState(current, next) {
    const stateString = JSON.stringify(next);
    if (current.props.state === stateString) return;
    editor.updateBlock(id, { props: { ...current.props, state: stateString } });
    setNow(Date.now());
  }

  function act(command) {
    const current = editableBlock();
    if (!current) return;
    const before = readPomodoroState(current.props.state);
    const next = changePomodoro(before, command, Date.now());
    if (before === next) return;
    stopAlarm(key);
    if (before.endsAt !== next.endsAt) cancelDeadline(key);
    updateState(current, next);
  }

  function updateGeometry(changes) {
    const current = editableBlock();
    if (current) updateState(current, updatePomodoroSettings(readPomodoroState(current.props.state), changes));
  }

  async function saveSettings(settings, fileChange) {
    if (!editableBlock()) throw new Error("此页面的番茄钟暂时不可编辑。");
    let soundPatch = {};
    if (fileChange === null) soundPatch = { finishUrl: "", finishName: "" };
    if (fileChange instanceof File) {
      const result = await window.lifeAtlas.assets.put({
        bytes: await fileChange.arrayBuffer(), mime: fileChange.type, name: fileChange.name,
      });
      if (!result?.ok || !assetHashFromUrl(result.value?.url)) {
        throw new Error(result?.error?.message || "未能保存铃声，请重试。");
      }
      soundPatch = { finishUrl: result.value.url, finishName: fileChange.name };
    }
    const current = editableBlock();
    if (!current) throw new Error("此页面的番茄钟暂时不可编辑。");
    const next = updatePomodoroSettings(readPomodoroState(current.props.state), { ...settings, ...soundPatch });
    updateState(current, next);
    const sound = alarms.get(key);
    if (sound && (fileChange !== undefined || !next.settings.finishEnabled || !next.settings.finishVolume)) stopAlarm(key);
    else if (sound) sound.volume = next.settings.finishVolume / 100;
  }

  return <>
    <PomodoroWidgetView
      settings={state.settings} phase={state.phase} seconds={seconds} running={running} paused={state.paused}
      locked={locked} ringing={ringing} status={seconds === 0 ? (state.phase === "break" ? "休息结束" : "专注结束") : ""}
      onPhase={act} onToggle={() => act("toggle")} onReset={() => act("reset")}
      onStopSound={() => stopAlarm(key)} onSettings={() => setSettingsOpen(true)} onGeometry={updateGeometry}
    />
    {settingsOpen && !locked && <PomodoroSettingsDialog
      settings={state.settings} tickSrc={tickSrc} defaultAlarmSrc={defaultAlarmSrc}
      alarmSrc={state.settings.finishUrl || defaultAlarmSrc} finishName={state.settings.finishName}
      onSave={saveSettings} onClose={() => setSettingsOpen(false)} validateFile={validatePomodoroAudio}
    />}
  </>;
}
