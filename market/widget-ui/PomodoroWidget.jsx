import { useEffect, useMemo, useRef, useState } from "react";
import { changePomodoro, pomodoroRemaining, readPomodoroState, updatePomodoroSettings, validatePomodoroAudio } from "../../src/domain/pomodoro.js";
import { PomodoroSettingsDialog, PomodoroWidgetView } from "../../src/editor/PomodoroWidgetView.jsx";

const tickSrc = "./assets/mechanical-tick.wav";
const alarmSrc = "./assets/standard-alarm.wav";
let defaultSound;
function packagedAlarm() {
  if (!defaultSound) defaultSound = fetch(alarmSrc).then(async (result) => {
    if (!result.ok) throw new Error("未能读取组件默认铃声。");
    return result.blob();
  }).catch((error) => { defaultSound = null; throw error; });
  return defaultSound;
}

export function PomodoroWidget({ state: raw, onChange, locked, demonstration, api }) {
  const state = useMemo(() => readPomodoroState(JSON.stringify(raw)), [raw]);
  const [now, setNow] = useState(Date.now);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ringing, setRinging] = useState(false);
  const latest = useRef(null), chosen = useRef(null), tick = useRef(null), fallback = useRef(null);
  const scheduledAt = useRef(null), previousSeconds = useRef(-1);
  const audio = api?.audio;
  const seconds = Math.ceil(pomodoroRemaining(state, now) / 1000);
  const running = state.endsAt !== null && seconds > 0;
  latest.current = { state, locked, onChange };
  useEffect(() => {
    const unsubscribe = audio?.onChange((type) => setRinging(type === "audio-alarm"));
    return () => { unsubscribe?.(); tick.current?.pause(); fallback.current?.pause(); };
  }, [audio]);

  // The parent holds a deadline for this block while its page is closed. The
  // signed default sound and the configured volume remain package decisions.
  useEffect(() => {
    let live = true;
    scheduledAt.current = null;
    const at = state.endsAt;
    if (audio) void (async () => {
      if (at === null || !state.settings.finishEnabled || !state.settings.finishVolume) {
        await audio.schedule({ at: null, state: raw });
        return;
      }
      const blob = await packagedAlarm().catch(() => null);
      if (!live) return;
      const result = await audio.schedule({ at, field: "endsAt", state: raw, url: state.settings.finishUrl,
        defaultSound: blob, volume: state.settings.finishVolume / 100 });
      if (live) { scheduledAt.current = at; if (result?.ringing) setRinging(true); }
    })().catch(() => {});
    return () => { live = false; };
  }, [audio, raw, state]);

  useEffect(() => {
    const at = state.endsAt;
    setNow(Date.now());
    if (at === null || at <= Date.now()) return;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time < at) return;
      clearInterval(timer);
      if (scheduledAt.current === at) return;
      const { settings } = latest.current.state;
      if (!settings.finishEnabled || !settings.finishVolume) return;
      const sound = new Audio(alarmSrc);
      fallback.current = sound;
      sound.volume = settings.finishVolume / 100;
      sound.onended = () => setRinging(false);
      setRinging(true);
      void sound.play().catch(() => setRinging(false));
    }, 150);
    return () => clearInterval(timer);
  }, [state.endsAt]);

  useEffect(() => {
    const previous = previousSeconds.current;
    previousSeconds.current = seconds;
    if (!running || !state.settings.soundEnabled || !state.settings.volume) { tick.current?.pause(); return; }
    if (seconds >= previous || document.visibilityState !== "visible") return;
    const sound = tick.current ??= new Audio(tickSrc);
    sound.volume = state.settings.volume / 100;
    sound.currentTime = 0;
    void sound.play().catch(() => {});
  }, [running, seconds, state.settings.soundEnabled, state.settings.volume]);

  function stopAlarm() {
    fallback.current?.pause();
    setRinging(false);
    if (audio) void audio.dismiss().catch(() => {});
  }
  function change(command) {
    if (locked) return;
    const next = changePomodoro(state, command, Date.now());
    if (state === next) return;
    stopAlarm();
    setNow(Date.now());
    onChange(next);
  }
  async function chooseAlarm() {
    if (!audio) throw new Error("此组件没有选择铃声的权限。");
    const result = await audio.pick();
    if (!result) return null;
    chosen.current = result.id;
    return result.file;
  }
  async function saveSettings(changes, file) {
    if (latest.current.locked) throw new Error("当前组件不可编辑。");
    let soundPatch = {};
    if (file === null) soundPatch = { finishUrl: "", finishName: "" };
    if (file instanceof File) {
      const saved = await audio.commit({ id: chosen.current });
      soundPatch = { finishUrl: saved.url, finishName: saved.name };
    }
    const current = latest.current;
    if (current.locked) throw new Error("当前组件不可编辑。");
    const next = updatePomodoroSettings(current.state, { ...changes, ...soundPatch });
    if (ringing && (file !== undefined || !next.settings.finishEnabled || !next.settings.finishVolume)) stopAlarm();
    current.onChange(next);
  }
  return <>
    <PomodoroWidgetView settings={state.settings} phase={state.phase} seconds={seconds} running={running}
      paused={state.paused} locked={locked} ringing={ringing} sandbox={demonstration}
      status={seconds === 0 ? (state.phase === "break" ? "休息结束" : "专注结束") : ""}
      onPhase={change} onToggle={() => change("toggle")} onReset={() => change("reset")} onStopSound={stopAlarm}
      onSettings={() => setSettingsOpen(true)} onGeometry={(patch) => { if (!locked) onChange(updatePomodoroSettings(state, patch)); }} />
    {settingsOpen && !locked && <PomodoroSettingsDialog settings={state.settings} tickSrc={tickSrc} defaultAlarmSrc={alarmSrc}
      alarmSrc={state.settings.finishUrl || alarmSrc} finishName={state.settings.finishName}
      pickFile={chooseAlarm} savedAudio={audio} validateFile={validatePomodoroAudio} onSave={saveSettings}
      onClose={() => setSettingsOpen(false)} />}
  </>;
}
