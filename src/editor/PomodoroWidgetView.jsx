import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconRotate, IconSettings } from "@tabler/icons-react";
import { pomodoroAudioAccept, pomodoroDefaults, pomodoroWidthLimits } from "../domain/pomodoro.js";

const FACES = [["auto", "自动"], ["horizontal", "横排"], ["vertical", "竖排"]];

function DigitHalf({ edge, value, className = "", onAnimationEnd }) {
  return <span className={`pomodoro-digit-half ${edge} ${className}`} onAnimationEnd={onAnimationEnd}>
    <span>{value}</span>
  </span>;
}

function FlipDigit({ value }) {
  const [transition, setTransition] = useState({ value, previous: null });
  if (transition.value !== value) setTransition({ value, previous: transition.value });

  return <span className="pomodoro-digit" aria-hidden="true">
    <DigitHalf edge="upper" value={value} />
    <DigitHalf edge="lower" value={value} />
    <span className="pomodoro-digit-seam" />
    {transition.previous !== null && <span key={value} className="pomodoro-digit-motion">
      <DigitHalf edge="upper" value={transition.previous} className="outgoing" />
      <DigitHalf edge="lower" value={transition.previous} className="waiting" />
      <DigitHalf edge="lower" value={value} className="incoming" onAnimationEnd={() => setTransition({ value, previous: null })} />
    </span>}
  </span>;
}

export function PomodoroWidgetView({ settings, phase, seconds, running, paused, locked, ringing, status, sandbox = false, onPhase, onToggle, onReset, onStopSound, onSettings, onGeometry }) {
  const titleId = useId();
  const slot = useRef(null);
  const frame = useRef(null);
  const drag = useRef(null);
  const [available, setAvailable] = useState(0);
  const [draftWidth, setDraftWidth] = useState(null);
  const maximum = Math.min(pomodoroWidthLimits.max, available);
  const minimum = Math.min(pomodoroWidthLimits.min, maximum);
  const visible = Math.min(available, draftWidth ?? settings.width);
  const canResize = !locked && (minimum < maximum || draftWidth !== null);
  const canAlign = !locked && (visible < available || draftWidth !== null);
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  const isFocus = phase === "focus";
  const totalSeconds = (isFocus ? settings.focusMinutes : settings.restMinutes) * 60;
  const runLabel = running ? "暂停" : paused ? "继续" : isFocus ? "开始专注" : "开始休息";
  const idle = !running && !paused && seconds === totalSeconds;
  const timerStatus = status || (running ? (isFocus ? "专注中" : "休息中") : paused ? "已暂停" : "待开始");

  useLayoutEffect(() => {
    const element = slot.current;
    const measure = () => setAvailable(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!locked || !drag.current) return;
    drag.current = null;
    setDraftWidth(null);
  }, [locked]);

  function clampWidth(width) {
    return Math.round(Math.max(minimum, Math.min(maximum, width)));
  }

  function measureDrag(event) {
    return clampWidth(drag.current.width + (event.clientX - drag.current.x) * drag.current.scale);
  }

  function startResize(event) {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault();
    event.stopPropagation();
    const width = frame.current.getBoundingClientRect().width;
    drag.current = { id: event.pointerId, x: event.clientX, width, scale: settings.align === "center" ? 2 : 1 };
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraftWidth(Math.round(width));
  }

  function moveResize(event) {
    if (drag.current?.id !== event.pointerId) return;
    event.stopPropagation();
    setDraftWidth(measureDrag(event));
  }

  function endResize(event) {
    if (drag.current?.id !== event.pointerId) return;
    event.stopPropagation();
    const width = measureDrag(event);
    const changed = width !== Math.round(drag.current.width);
    drag.current = null;
    setDraftWidth(null);
    if (changed && width >= pomodoroWidthLimits.min) onGeometry({ width });
  }

  function cancelResize(event) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDraftWidth(null);
  }

  function resizeByKey(event) {
    const widths = { ArrowLeft: visible - 12, ArrowRight: visible + 12, Home: minimum, End: maximum, Enter: pomodoroDefaults.width };
    if (!Object.hasOwn(widths, event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    onGeometry({ width: clampWidth(widths[event.key]) });
  }

  return <div ref={slot} className="pomodoro-slot" contentEditable={false}>
    <div ref={frame} className="pomodoro-frame" data-align={settings.align} data-resizing={draftWidth !== null || undefined}
      style={{ "--pomodoro-width": `${draftWidth ?? settings.width}px` }}>
      {canAlign && <div className="pomodoro-alignment pomodoro-switch" role="group" aria-label="组件位置">
        <button type="button" aria-pressed={settings.align === "left"} onClick={() => onGeometry({ align: "left" })}>靠左</button>
        <button type="button" aria-pressed={settings.align === "center"} onClick={() => onGeometry({ align: "center" })}>居中</button>
      </div>}
      <section className="pomodoro-widget" data-face={settings.face} data-phase={phase} data-running={running} aria-labelledby={titleId}>
        <header className="pomodoro-header">
          {sandbox
            ? <div id={titleId} className="pomodoro-name"><span className="pomodoro-dial" aria-hidden="true" />番茄钟</div>
            : <h2 id={titleId} className="pomodoro-name"><span className="pomodoro-dial" aria-hidden="true" />番茄钟</h2>}
          <div className="pomodoro-phases pomodoro-switch" role="group" aria-label="计时模式">
            <button type="button" disabled={locked} aria-pressed={phase === "focus"} aria-label={`专注 ${settings.focusMinutes} 分`} onClick={() => onPhase("focus")}>
              专注<span className="pomodoro-mode-duration"> {settings.focusMinutes} 分</span>
            </button>
            <button type="button" disabled={locked} aria-pressed={phase === "break"} aria-label={`短休息 ${settings.restMinutes} 分`} onClick={() => onPhase("break")}>
              短休息<span className="pomodoro-mode-duration"> {settings.restMinutes} 分</span>
            </button>
          </div>
        </header>
        <div className="pomodoro-display" role="timer" aria-label={`剩余 ${minutes} 分 ${remainder} 秒`} data-time={`${minutes}:${remainder}`}>
          <FlipDigit value={minutes[0]} />
          <FlipDigit value={minutes[1]} />
          <span className="pomodoro-separator" aria-hidden="true" />
          <FlipDigit value={remainder[0]} />
          <FlipDigit value={remainder[1]} />
        </div>
        <div className="pomodoro-meter">
          <p className="pomodoro-status" role="status">{timerStatus}</p>
          <progress aria-label="本轮已用时间" max={totalSeconds} value={Math.max(0, totalSeconds - seconds)} />
        </div>
        <div className="pomodoro-controls">
          <button type="button" className="pomodoro-run" data-running={running} disabled={locked} onClick={onToggle}>
            <span className="pomodoro-run-icon" aria-hidden="true" />{runLabel}
          </button>
          <button type="button" className="pomodoro-reset" aria-label="重置" title="重置" disabled={idle || locked} onClick={onReset}>
            <IconRotate size={17} aria-hidden="true" /><span className="pomodoro-reset-label">重置</span>
          </button>
          <button type="button" className="pomodoro-gear" aria-label="番茄钟设置" aria-haspopup="dialog" title="番茄钟设置" disabled={locked} onClick={onSettings}>
            <IconSettings size={18} aria-hidden="true" />
          </button>
        </div>
        {ringing && <button type="button" className="pomodoro-reset pomodoro-dismiss-alarm" onClick={onStopSound}>停止铃声</button>}
      </section>
      {canResize && <div className="pomodoro-resize" role="slider" tabIndex={0} aria-label="番茄钟宽度"
        aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={Math.round(visible)} aria-valuetext={`${Math.round(visible)} 像素`}
        title="拖动右边缘调整宽度，双击恢复默认" onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={endResize}
        onPointerCancel={cancelResize} onLostPointerCapture={cancelResize} onKeyDown={resizeByKey}
        onDoubleClick={() => onGeometry({ width: clampWidth(pomodoroDefaults.width) })} />}
    </div>
  </div>;
}

function SoundSettings({ id, label, enabled, volume, playing, disabledPreview, onEnabled, onVolume, onPreview, children }) {
  const volumeId = `${id}-volume`;
  const action = playing ? "停止" : "试听";
  return <section className="pomodoro-settings-section" aria-labelledby={id}>
    <div className="pomodoro-settings-row pomodoro-sound-heading">
      <h3 id={id}>{label}</h3>
      <label className="pomodoro-sound-switch">
        <input type="checkbox" role="switch" aria-labelledby={id} checked={enabled} onChange={(event) => onEnabled(event.target.checked)} />
        <span aria-hidden="true" />
      </label>
    </div>
    <div className="pomodoro-sound-controls">
      <label htmlFor={volumeId}>音量</label>
      <div className="pomodoro-volume">
        <input id={volumeId} type="range" min="0" max="100" value={volume} aria-label={`${label}音量`}
          onChange={(event) => onVolume(event.target.valueAsNumber)} />
        <span>{volume}%</span>
      </div>
      <button type="button" className="pomodoro-settings-button pomodoro-preview-sound" aria-label={`${action}${label}`}
        disabled={disabledPreview} onClick={onPreview}>{action}</button>
    </div>
    {children}
  </section>;
}

export function PomodoroSettingsDialog({ settings, tickSrc, alarmSrc, defaultAlarmSrc, finishName, onSave, onClose, validateFile, pickFile, savedAudio }) {
  const uid = useId();
  const dialog = useRef(null);
  const fileInput = useRef(null);
  const chooseButton = useRef(null);
  const player = useRef(null);
  const sampleUrl = useRef(null);
  const playAttempt = useRef(0);
  const fileAttempt = useRef(0);
  const [draft, setDraft] = useState(() => ({
    face: settings.face,
    focusMinutes: String(settings.focusMinutes),
    restMinutes: String(settings.restMinutes),
    soundEnabled: settings.soundEnabled,
    volume: settings.volume,
    finishEnabled: settings.finishEnabled,
    finishVolume: settings.finishVolume,
  }));
  const [fileChange, setFileChange] = useState(undefined);
  const [playing, setPlaying] = useState(null);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fileFeedback, setFileFeedback] = useState(null);
  const [status, setStatus] = useState("");
  const savedName = finishName || (alarmSrc && alarmSrc !== defaultAlarmSrc ? "自定义铃声" : "");
  const customName = fileChange === undefined ? savedName : fileChange?.name;

  useLayoutEffect(() => {
    const element = dialog.current;
    const audio = player.current;
    const unsubscribe = savedAudio?.onChange((event) => { if (event === "audio-ended") setPlaying(null); });
    element.showModal();
    element.querySelector('input[type="radio"]:checked')?.focus();
    return () => {
      element.close();
      unsubscribe?.();
      if (savedAudio) void savedAudio.stop().catch(() => {});
      playAttempt.current += 1;
      fileAttempt.current += 1;
      audio.pause();
      if (sampleUrl.current) URL.revokeObjectURL(sampleUrl.current);
      sampleUrl.current = null;
    };
  }, []);

  function change(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    setStatus("");
  }

  function stopPreview() {
    playAttempt.current += 1;
    player.current.pause();
    if (savedAudio) void savedAudio.stop().catch(() => {});
    if (sampleUrl.current) {
      player.current.removeAttribute("src");
      player.current.load();
      URL.revokeObjectURL(sampleUrl.current);
      sampleUrl.current = null;
    }
    setPlaying(null);
  }

  function changeVolume(field, value, sound) {
    change(field, value);
    if (playing === sound) player.current.volume = value / 100;
  }

  async function preview(sound) {
    stopPreview();
    setStatus("");
    if (sound === playing) return;
    const attempt = playAttempt.current;
    const isTick = sound === "tick";
    setPlaying(sound);
    try {
      if (!isTick && fileChange === undefined && savedName && savedAudio) {
        await savedAudio.play({ url: alarmSrc, volume: draft.finishVolume / 100 });
        return;
      }
      if (!isTick && fileChange) sampleUrl.current = URL.createObjectURL(fileChange);
      player.current.src = isTick ? tickSrc : sampleUrl.current || (fileChange === null ? defaultAlarmSrc : alarmSrc) || defaultAlarmSrc;
      player.current.volume = (isTick ? draft.volume : draft.finishVolume) / 100;
      await player.current.play();
    } catch {
      if (attempt !== playAttempt.current) return;
      stopPreview();
      setStatus(`无法播放${isTick ? "走时声" : "结束铃声"}。`);
    }
  }

  async function chooseFile(file) {
    const attempt = ++fileAttempt.current;
    setValidating(true);
    setFileFeedback(null);
    try {
      if (!file && pickFile) file = await pickFile();
      if (!file || attempt !== fileAttempt.current) return;
      stopPreview();
      setStatus("");
      const checkedFile = await validateFile(file);
      if (attempt === fileAttempt.current) setFileChange(checkedFile);
    } catch (error) {
      if (attempt === fileAttempt.current) setFileFeedback(error.message || "无法读取所选音频。");
    } finally {
      if (attempt === fileAttempt.current) setValidating(false);
    }
  }

  function restoreDefault() {
    fileAttempt.current += 1;
    stopPreview();
    setFileChange(null);
    setValidating(false);
    setFileFeedback(null);
    setStatus("");
    chooseButton.current?.focus();
  }

  async function save(form) {
    if (saving || validating) return;
    for (const [name, label] of [["focusMinutes", "专注"], ["restMinutes", "短休息"]]) {
      const input = form.elements.namedItem(name);
      const value = input.valueAsNumber;
      if (Number.isInteger(value) && value >= 1 && value <= 99) continue;
      input.setCustomValidity(`请为${label}填写 1 到 99 分钟的整数。`);
      input.reportValidity();
      return;
    }
    stopPreview();
    setSaving(true);
    setStatus("");
    try {
      await onSave({ ...draft, focusMinutes: Number(draft.focusMinutes), restMinutes: Number(draft.restMinutes) }, fileChange);
      onClose();
    } catch (error) {
      setStatus(error.message || "无法保存设置，请重试。");
      setSaving(false);
    }
  }

  function cancel(event) {
    event.preventDefault();
    if (!saving) onClose();
  }

  return createPortal(<dialog ref={dialog} className="pomodoro-settings-dialog" aria-labelledby={`${uid}-title`} aria-busy={saving}
    onCancel={cancel} onKeyDown={(event) => event.stopPropagation()}>
    <form noValidate onSubmit={(event) => { event.preventDefault(); void save(event.currentTarget); }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.target.type !== "number" || event.nativeEvent.isComposing || event.keyCode === 229
          || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.target.matches(":disabled")) return;
        event.preventDefault();
        if (!event.repeat) void save(event.currentTarget);
      }}>
      <header className="pomodoro-settings-heading"><h2 id={`${uid}-title`}>番茄钟设置</h2></header>
      <div className="pomodoro-settings-content" inert={saving}>
        <section className="pomodoro-settings-section" aria-labelledby={`${uid}-face`}>
          <h3 id={`${uid}-face`}>表盘布局</h3>
          <div className="pomodoro-face-options" role="radiogroup" aria-labelledby={`${uid}-face`}>
            {FACES.map(([face, label]) => <label key={face}>
              <input type="radio" name="face" value={face} checked={draft.face === face} onChange={() => change("face", face)} />
              <span>{label}</span>
            </label>)}
          </div>
          <p className="pomodoro-settings-note">自动布局会根据区块宽度切换排列。</p>
        </section>
        <section className="pomodoro-settings-section" aria-labelledby={`${uid}-time`}>
          <h3 id={`${uid}-time`}>计时</h3>
          {[["focusMinutes", "专注时长"], ["restMinutes", "短休息时长"]].map(([field, label]) => <div className="pomodoro-settings-row" key={field}>
            <label htmlFor={`${uid}-${field}`}>{label}</label>
            <div className="pomodoro-duration">
              <input id={`${uid}-${field}`} name={field} type="number" min="1" max="99" step="1" inputMode="numeric" required value={draft[field]}
                onChange={(event) => { event.target.setCustomValidity(""); change(field, event.target.value); }} />
              <span>分钟</span>
            </div>
          </div>)}
        </section>
        <SoundSettings id={`${uid}-tick`} label="走时声" enabled={draft.soundEnabled} volume={draft.volume} playing={playing === "tick"}
          onEnabled={(enabled) => change("soundEnabled", enabled)} onVolume={(value) => changeVolume("volume", value, "tick")} onPreview={() => preview("tick")} />
        <SoundSettings id={`${uid}-alarm`} label="结束铃声" enabled={draft.finishEnabled} volume={draft.finishVolume} playing={playing === "alarm"}
          disabledPreview={validating} onEnabled={(enabled) => change("finishEnabled", enabled)}
          onVolume={(value) => changeVolume("finishVolume", value, "alarm")} onPreview={() => preview("alarm")}>
          <div className="pomodoro-file-row">
            <div className="pomodoro-file-meta">
              <span className="pomodoro-file-name" aria-live="polite">{customName || "默认闹铃"}</span>
              <span id={`${uid}-formats`}>MP3、WAV、M4A（AAC）</span>
            </div>
            <div className="pomodoro-file-actions">
              {!pickFile && <input type="file" ref={fileInput} accept={pomodoroAudioAccept} hidden onChange={(event) => {
                const file = event.target.files[0]; event.target.value = ""; void chooseFile(file);
              }} />}
              <button type="button" ref={chooseButton} className="pomodoro-settings-button" aria-describedby={`${uid}-formats ${uid}-file-feedback`}
                onClick={() => pickFile ? void chooseFile() : fileInput.current?.click()}>选择音频</button>
              <button type="button" className="pomodoro-settings-button" disabled={!customName && !validating} onClick={restoreDefault}>恢复默认</button>
            </div>
          </div>
          <p id={`${uid}-file-feedback`} className="pomodoro-file-feedback" role="status" data-error={Boolean(fileFeedback) || undefined}>
            {validating ? "正在检查音频…" : fileFeedback}
          </p>
        </SoundSettings>
      </div>
      <p className="pomodoro-settings-status" role="status" data-error={Boolean(status) || undefined}>{saving ? "正在保存…" : status}</p>
      <footer className="pomodoro-settings-footer">
        <button type="button" className="pomodoro-settings-button" disabled={saving} onClick={cancel}>取消</button>
        <button type="button" className="pomodoro-settings-button pomodoro-settings-save" disabled={saving || validating} onClick={(event) => { void save(event.currentTarget.form); }}>保存</button>
      </footer>
    </form>
    <audio ref={player} onEnded={(event) => { if (event.currentTarget.ended) stopPreview(); }} />
  </dialog>, document.body);
}
