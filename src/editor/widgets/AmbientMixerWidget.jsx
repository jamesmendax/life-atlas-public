import { useEffect, useMemo, useRef, useState } from "react";
import { IconCloudRain, IconCoffee, IconFlame, IconPlayerPause, IconPlayerPlay, IconRipple, IconWaveSine, IconWind } from "@tabler/icons-react";

const TRACKS = [
  { id: "rain", label: "窗外细雨", Icon: IconCloudRain, filterType: "bandpass", freq: 920, q: 0.7 },
  { id: "wind", label: "森林微风", Icon: IconWind, filterType: "lowpass", freq: 420, q: 1.4 },
  { id: "fire", label: "壁炉柴火", Icon: IconFlame, filterType: "lowpass", freq: 260, q: 0.9 },
  { id: "cafe", label: "咖啡馆低语", Icon: IconCoffee, filterType: "bandpass", freq: 620, q: 1.2 },
  { id: "wave", label: "海浪潮汐", Icon: IconRipple, filterType: "lowpass", freq: 340, q: 0.6 },
  { id: "pink", label: "粉红专注音", Icon: IconWaveSine, filterType: "lowpass", freq: 1400, q: 0.4 },
];

const PRESETS = [
  { id: "study", label: "雨夜书房", levels: { rain: 65, wind: 15, fire: 45, cafe: 0, wave: 0, pink: 20 } },
  { id: "forest", label: "森林木屋", levels: { rain: 20, wind: 70, fire: 35, cafe: 0, wave: 0, pink: 0 } },
  { id: "cafe", label: "午后咖啡", levels: { rain: 25, wind: 0, fire: 0, cafe: 65, wave: 0, pink: 15 } },
];

const DEFAULT_STATE = {
  preset: "study",
  levels: { ...PRESETS[0].levels },
};

function normalizeState(raw) {
  if (!raw || typeof raw !== "object" || !raw.levels) return DEFAULT_STATE;
  const levels = {};
  for (const t of TRACKS) levels[t.id] = Math.max(0, Math.min(100, Number(raw.levels[t.id]) || 0));
  return { preset: String(raw.preset || "custom"), levels };
}

export function AmbientMixerWidget({ state: rawState, onChange, locked = false }) {
  const data = useMemo(() => normalizeState(rawState), [rawState]);
  const [playing, setPlaying] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const audioRef = useRef(null);

  useEffect(() => {
    return () => {
      try { audioRef.current?.ctx?.close(); } catch { /* ignore */ }
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const engine = audioRef.current;
    if (!engine) return;
    const now = engine.ctx.currentTime;
    for (const track of TRACKS) {
      const gain = engine.gains.get(track.id);
      if (gain) {
        const target = playing ? (data.levels[track.id] / 100) * 0.22 : 0;
        gain.gain.setTargetAtTime(target, now, 0.08);
      }
    }
  }, [playing, data.levels]);

  function ensureAudio() {
    if (audioRef.current) return audioRef.current;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    const ctx = new AudioCtx();
    const bufferSize = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    let b0 = 0; let b1 = 0; let b2 = 0;
    for (let i = 0; i < bufferSize; i += 1) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      channel[i] = (b0 + b1 + b2 + white * 0.1848) * 0.18;
    }
    const gains = new Map();
    for (const track of TRACKS) {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = track.filterType;
      filter.frequency.value = track.freq;
      filter.Q.value = track.q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      src.start();
      gains.set(track.id, gain);
    }
    audioRef.current = { ctx, gains };
    return audioRef.current;
  }

  async function togglePlay() {
    if (playing) {
      setPlaying(false);
      return;
    }
    setStarting(true);
    setError("");
    try {
      const engine = ensureAudio();
      if (!engine) throw new Error("Web Audio unavailable");
      if (engine.ctx.state === "suspended") await engine.ctx.resume();
      setPlaying(true);
    } catch {
      setError("无法播放声音，请重试。");
    } finally {
      setStarting(false);
    }
  }

  function setLevel(id, value) {
    if (locked) return;
    onChange?.({ preset: "custom", levels: { ...data.levels, [id]: value } });
  }

  function applyPreset(preset) {
    if (locked) return;
    onChange?.({ preset: preset.id, levels: { ...preset.levels } });
  }

  const activeCount = TRACKS.filter((t) => data.levels[t.id] > 0).length;

  return (
    <section
      className={`mw-card mw-ambient${playing ? " is-playing" : ""}`}
      contentEditable={false}
      aria-label="白噪音专注混音台"
      onMouseDown={(e) => e.stopPropagation()}
      onDragStart={(e) => e.preventDefault()}
    >
      <header className="mw-head mw-ambient-head">
        <div className="mw-head-title">
          <strong>白噪音混音台</strong>
          <small role="status">{error || (playing ? activeCount ? `正在播放 · ${activeCount} 轨` : "正在播放 · 所有音轨已静音" : `已选 ${activeCount} 轨`)}</small>
        </div>
        <button type="button" className="mw-btn mw-btn-primary mw-ambient-play" disabled={starting} onClick={togglePlay}>
          {playing ? <IconPlayerPause size={17} aria-hidden="true" /> : <IconPlayerPlay size={17} aria-hidden="true" />}
          {starting ? "正在开启…" : playing ? "暂停声景" : "开启声景"}
        </button>
      </header>

      <div className="mw-ambient-scenes">
        <span>场景</span>
        <div className="mw-seg" role="group" aria-label="白噪音场景预设">
          {PRESETS.map((preset) => (
            <button key={preset.id} type="button" className={data.preset === preset.id ? "is-active" : ""}
              aria-pressed={data.preset === preset.id} disabled={locked} onClick={() => applyPreset(preset)}>
              {preset.label}
            </button>
          ))}
        </div>
        {data.preset === "custom" && <small>自定义混音</small>}
      </div>

      <div className="mw-ambient-grid" role="group" aria-label="音轨">
        {TRACKS.map(({ id, label, Icon }) => {
          const val = data.levels[id];
          return (
            <label key={id} className={`mw-track${val > 0 ? " is-active" : ""}`}>
              <Icon size={21} className="mw-track-icon" aria-hidden="true" />
              <span className="mw-track-label">{label}</span>
              <span className="mw-track-value">{val}%</span>
              <input
                type="range"
                min="0"
                max="100"
                value={val}
                style={{ "--mw-track-position": `${val}%` }}
                disabled={locked}
                aria-label={`${label}音量`}
                aria-valuetext={`${val}%`}
                onChange={(e) => setLevel(id, Number(e.target.value))}
              />
            </label>
          );
        })}
      </div>
    </section>
  );
}
