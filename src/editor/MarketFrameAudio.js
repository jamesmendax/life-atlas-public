const asset = /^life-asset:\/\/[a-f0-9]{64}$/u;
const allowedTypes = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4" };
const maxAudioBytes = 32 * 1024 * 1024;
const references = (state) => new Set(state.match(/life-asset:\/\/[a-f0-9]{64}(?=")/gu) || []);
const scheduled = new Map();
const listeners = new Map();

function alarmEvent(key, type) { for (const listener of listeners.get(key) || []) listener(type); }
function removeAlarm(key) {
  const job = scheduled.get(key);
  if (!job) return;
  scheduled.delete(key);
  clearTimeout(job.timer);
  if (job.sound) {
    job.sound.onended = job.sound.onerror = null;
    job.sound.pause();
    alarmEvent(key, "audio-ended");
  }
  if (job.objectURL) URL.revokeObjectURL(job.objectURL);
  window.removeEventListener("life-atlas-market-change", job.invalidate);
}
function scheduleAlarm({ key, at, snapshot, readSaved, url, defaultSound, volume, packageUrl }) {
  const existing = scheduled.get(key);
  if (existing?.at === at && existing.snapshot === snapshot) return { ringing: Boolean(existing.sound) };
  removeAlarm(key);
  if (!at || at <= Date.now() || !volume) return { ringing: false };
  const job = { at, snapshot };
  scheduled.set(key, job);
  job.invalidate = (event) => { if (packageUrl === "life-asset://" + event.detail?.sha256) removeAlarm(key); };
  window.addEventListener("life-atlas-market-change", job.invalidate);
  job.timer = setTimeout(() => {
    if (scheduled.get(key) !== job) return;
    if (readSaved() !== snapshot) { removeAlarm(key); return; }
    if (defaultSound) job.objectURL = URL.createObjectURL(defaultSound);
    const player = new Audio(url || job.objectURL);
    job.sound = player;
    player.volume = volume;
    alarmEvent(key, "audio-alarm");
    const end = () => { if (scheduled.get(key) === job) removeAlarm(key); };
    player.onended = end;
    void player.play().catch(() => {
      if (scheduled.get(key) !== job) return;
      if (url && job.objectURL) {
        player.src = job.objectURL;
        void player.play().catch(end);
      } else end();
    });
  }, Math.max(0, at - Date.now()));
  return { ringing: false };
}

function audioMime(file, header) {
  const ext = /\.([^.]+)$/u.exec(file.name)?.[1]?.toLowerCase();
  const tag = (offset, length) => String.fromCharCode(...header.subarray(offset, offset + length));
  if (ext === "wav" && tag(0, 4) === "RIFF" && tag(8, 4) === "WAVE") return allowedTypes.wav;
  if (ext === "mp3" && (tag(0, 3) === "ID3" || (header[0] === 255 && (header[1] & 224) === 224))) return allowedTypes.mp3;
  if (ext === "m4a" && tag(4, 4) === "ftyp") return allowedTypes.m4a;
  throw new Error("请选择可播放的 MP3、WAV 或 M4A 铃声。");
}

// The parent owns the picker. Packages can commit only the file the user
// selected here, and may play a saved reference without receiving its bytes.
export function createFrameAudio({ read, editable, preview, notify, alarmScope }) {
  const allowed = references(read() || "{}");
  const ephemeral = new Map();
  let selected, cancelPick, player;
  let live = true;
  const { key, readSaved, packageUrl } = alarmScope;
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(notify);
  function stop() {
    if (!player) return;
    player.onended = player.onerror = null;
    player.pause();
    player.removeAttribute("src");
    player.load();
    player = null;
  }
  function ensureWritable() {
    if (!live || !editable()) throw new Error("当前组件不可编辑。");
  }
  async function pick() {
    ensureWritable();
    if (cancelPick || !navigator.userActivation?.isActive) throw new Error("请点击“选择音频”打开文件选择器。");
    const file = await new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".mp3,.wav,.m4a";
      input.hidden = true;
      const finish = (value) => {
        input.oncancel = input.onchange = null;
        input.remove();
        cancelPick = null;
        resolve(value);
      };
      cancelPick = () => finish(null);
      input.oncancel = cancelPick;
      input.onchange = () => finish(input.files[0] || null);
      document.body.append(input);
      try { input.showPicker(); } catch { finish(null); }
    });
    if (!file) return null;
    ensureWritable();
    if (!file.size || file.size > maxAudioBytes) throw new Error("请选择 32 MiB 以内的非空音频。");
    const mime = audioMime(file, new Uint8Array(await file.slice(0, 32).arrayBuffer()));
    ensureWritable();
    const id = crypto.randomUUID();
    selected = { id, file: new File([file], file.name, { type: mime, lastModified: file.lastModified }) };
    return { id, file: selected.file };
  }
  async function commit({ id }) {
    ensureWritable();
    const choice = selected;
    if (!choice || id !== choice.id) throw new Error("请重新选择铃声。");
    const bytes = await choice.file.arrayBuffer();
    ensureWritable();
    if (selected !== choice) throw new Error("所选铃声已更改。");
    let url;
    if (preview) {
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      url = "life-asset://" + Array.from(hash, (n) => n.toString(16).padStart(2, "0")).join("");
      if (!live) throw new Error("试玩已结束。");
      for (const previous of ephemeral.values()) URL.revokeObjectURL(previous);
      ephemeral.clear();
      ephemeral.set(url, URL.createObjectURL(choice.file));
    } else {
      const result = await window.lifeAtlas.assets.put({ bytes, mime: choice.file.type, name: choice.file.name });
      if (!result?.ok || !asset.test(result.value?.url)) throw new Error(result?.error?.message || "未能保存铃声。");
      url = result.value.url;
    }
    ensureWritable();
    allowed.add(url);
    selected = null;
    return { url, name: choice.file.name };
  }
  async function play({ url, volume }) {
    if (!live || !asset.test(url) || !allowed.has(url) || !Number.isFinite(volume)) throw new Error("仅可播放此组件的铃声。");
    stop();
    const audio = new Audio(ephemeral.get(url) || url);
    player = audio;
    audio.volume = Math.max(0, Math.min(1, volume));
    const finished = () => { if (player === audio) { stop(); notify("audio-ended"); } };
    audio.onended = audio.onerror = finished;
    try { await audio.play(); } catch { finished(); throw new Error("无法播放已保存的铃声。"); }
    return {};
  }
  async function schedule({ at, state, field, url, defaultSound, volume }) {
    const snapshot = read();
    if (!live || !snapshot || JSON.stringify(state) !== snapshot) throw new Error("计时记录已改变。");
    if (at == null) { removeAlarm(key); return { ringing: false }; }
    if (!Number.isSafeInteger(at) || at > Date.now() + 86400000 || !Object.hasOwn(state, field) || state[field] !== at
      || !Number.isFinite(volume) || volume < 0 || volume > 1) throw new Error("提醒时间或音量无效。");
    const existing = scheduled.get(key);
    if (existing?.at === at && existing.snapshot === snapshot) return { ringing: Boolean(existing.sound) };
    if (url && (!asset.test(url) || !allowed.has(url))) throw new Error("请选择本区块的铃声。");
    if (defaultSound) {
      if (!(defaultSound instanceof Blob) || defaultSound.size < 12 || defaultSound.size > 2 * 1024 * 1024) throw new Error("组件默认铃声无效。");
      const header = new Uint8Array(await defaultSound.slice(0, 12).arrayBuffer());
      audioMime({ name: "sound.wav" }, header);
    }
    if (!url && !defaultSound) throw new Error("缺少提醒声音。");
    if (!live || read() !== snapshot) throw new Error("计时记录已改变。");
    return scheduleAlarm({ key, at, snapshot, readSaved, packageUrl, url: ephemeral.get(url) || url, defaultSound, volume });
  }
  return {
    acceptFromEditor(state) { for (const url of references(state)) allowed.add(url); },
    checkWrite(state) { for (const url of references(state)) if (!allowed.has(url)) throw new Error("该附件未由此区块选取。"); },
    async call(method, args) {
      if (method === "audio.pick") return pick();
      if (method === "audio.commit") return commit(args);
      if (method === "audio.play") return play(args);
      if (method === "audio.stop") { stop(); return {}; }
      if (method === "audio.schedule") return schedule(args);
      if (method === "audio.dismiss") { removeAlarm(key); return {}; }
      throw new Error("组件音频操作无效。");
    },
    dispose() {
      live = false;
      listeners.get(key)?.delete(notify);
      if (!listeners.get(key)?.size) listeners.delete(key);
      if (preview) removeAlarm(key);
      cancelPick?.();
      stop();
      selected = null;
      for (const url of ephemeral.values()) URL.revokeObjectURL(url);
      ephemeral.clear();
    },
  };
}
