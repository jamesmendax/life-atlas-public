import { assetHashFromUrl } from "./attachmentUrls.js";

export const pomodoroDefaults = Object.freeze({
  face: "auto",
  focusMinutes: 25,
  restMinutes: 5,
  soundEnabled: false,
  volume: 60,
  finishEnabled: true,
  finishVolume: 90,
  finishUrl: "",
  finishName: "",
  width: 476,
  align: "left",
});

const durationLimit = 99 * 60_000;
const audioTypes = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4" };
export const pomodoroAudioAccept = ".mp3,.wav,.m4a";
export const pomodoroWidthLimits = Object.freeze({ min: 300, max: 2400 });

const integer = (value, min, max, fallback) =>
  Number.isInteger(value) && value >= min && value <= max ? value : fallback;

export function normalizePomodoroSettings(input) {
  const raw = input ?? {};
  const soundHash = assetHashFromUrl(raw.finishUrl);
  return {
    face: ["auto", "horizontal", "vertical"].includes(raw.face) ? raw.face : "auto",
    focusMinutes: integer(raw.focusMinutes, 1, 99, pomodoroDefaults.focusMinutes),
    restMinutes: integer(raw.restMinutes, 1, 99, pomodoroDefaults.restMinutes),
    soundEnabled: raw.soundEnabled === true,
    volume: integer(raw.volume, 0, 100, pomodoroDefaults.volume),
    finishEnabled: raw.finishEnabled !== false,
    finishVolume: integer(raw.finishVolume, 0, 100, pomodoroDefaults.finishVolume),
    finishUrl: soundHash ? "life-asset://" + soundHash : "",
    finishName: soundHash && typeof raw.finishName === "string" ? raw.finishName.replace(/[\u0000-\u001f]/gu, "").slice(0, 255) : "",
    width: integer(raw.width, pomodoroWidthLimits.min, pomodoroWidthLimits.max, pomodoroDefaults.width),
    align: raw.align === "center" ? "center" : "left",
  };
}

function phaseDuration(state) {
  return (state.phase === "break" ? state.settings.restMinutes : state.settings.focusMinutes) * 60_000;
}

export function readPomodoroState(serialized) {
  let raw;
  try { raw = JSON.parse(serialized); } catch { /* Older blocks can omit state. */ }
  const settings = normalizePomodoroSettings(raw?.settings);
  const phase = raw?.phase === "break" ? "break" : "focus";
  const total = phaseDuration({ phase, settings });
  const remaining = Number.isFinite(raw?.remaining) ? Math.min(durationLimit, Math.max(0, Math.round(raw.remaining))) : total;
  const endsAt = Number.isSafeInteger(raw?.endsAt) && raw.endsAt > 0 ? raw.endsAt : null;
  const paused = endsAt === null && remaining > 0 && (raw?.paused ?? (remaining !== total)) === true;
  return { phase, remaining, endsAt, paused, settings };
}

export function pomodoroRemaining(state, now) {
  return state.endsAt === null ? state.remaining : Math.min(durationLimit, Math.max(0, state.endsAt - now));
}

export function updatePomodoroSettings(state, changes) {
  const settings = normalizePomodoroSettings({ ...state.settings, ...changes });
  const updated = { ...state, settings };
  if (state.endsAt === null && !state.paused && state.remaining === phaseDuration(state)) {
    updated.remaining = phaseDuration(updated);
  }
  return updated;
}

export function changePomodoro(state, command, now) {
  switch (command) {
    case "focus":
    case "break": {
      if (state.phase === command) return state;
      const next = { ...state, phase: command, endsAt: null, paused: false };
      return { ...next, remaining: phaseDuration(next) };
    }
    case "reset":
      return { ...state, remaining: phaseDuration(state), endsAt: null, paused: false };
    case "toggle": {
      const remaining = pomodoroRemaining(state, now);
      if (state.endsAt !== null && remaining > 0) return { ...state, remaining, endsAt: null, paused: true };
      const nextRemaining = remaining || phaseDuration(state);
      return { ...state, remaining: nextRemaining, endsAt: now + nextRemaining, paused: false };
    }
    default:
      return state;
  }
}

export async function validatePomodoroAudio(file) {
  const extension = file instanceof File ? /\.([^.]+)$/u.exec(file.name)?.[1].toLowerCase() : "";
  if (!extension || !Object.hasOwn(audioTypes, extension) || !file.size) {
    throw new Error("请选择 MP3、WAV 或 M4A（AAC）音频。");
  }
  if (file.size > 1024 ** 3) throw new Error("单个附件不能超过 1 GB。");
  const normalized = new File([file], file.name, { type: audioTypes[extension], lastModified: file.lastModified });
  const url = URL.createObjectURL(normalized);
  const sample = new Audio();
  try {
    await new Promise((resolve, reject) => {
      const complete = (success) => {
        clearTimeout(timeout);
        sample.onloadeddata = null;
        sample.onerror = null;
        if (success) resolve();
        else reject(new Error("无法播放这个文件。请选择可读取的 MP3、WAV 或 M4A（AAC）音频。"));
      };
      const timeout = setTimeout(() => complete(false), 15_000);
      sample.onloadeddata = () => complete(Number.isFinite(sample.duration) && sample.duration > 0);
      sample.onerror = () => complete(false);
      sample.preload = "auto";
      sample.src = url;
    });
    return normalized;
  } finally {
    sample.removeAttribute("src");
    sample.load();
    URL.revokeObjectURL(url);
  }
}
