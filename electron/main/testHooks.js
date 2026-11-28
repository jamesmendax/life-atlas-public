let failures;

export function consumeInjectedFailure(name) {
  if (!failures?.delete(name)) return;
  const error = new Error("测试注入故障");
  error.code = "E_IO";
  throw error;
}

function validClockTime(value) {
  if (!Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) throw new TypeError("测试时间无效");
  return value;
}

export function installTestHooks({ enabled, now = Date.now, env = process.env } = {}) {
  if (!enabled) return null;
  const initial = env.LIFE_ATLAS_TEST_CLOCK_MS;
  if (initial !== undefined && (typeof initial !== "string" || !initial.trim())) throw new TypeError("测试时间无效");
  let timeOverride = initial === undefined ? undefined : validClockTime(Number(initial));
  globalThis.__lifeAtlasNetworkLog = { blocked: [], completed: [] };
  globalThis.__lifeAtlasDialogs = { queue: { showMessageBox: [], showSaveDialog: [], showOpenDialog: [] }, calls: [] };
  const clock = {
    now: () => timeOverride ?? now(),
    set(value) { timeOverride = validClockTime(value); },
    advance(value) { if (!Number.isFinite(value)) throw new TypeError("测试时间无效"); timeOverride = validClockTime(clock.now() + value); },
  };
  failures = new Set();
  let sampler;
  let baselineRss = 0;
  let peakRss = 0;
  const hooks = {
    clock,
    notifications: [],
    injectFailure(name) {
      if (!["restore-swap", "vault-rotate", "data-root-copy"].includes(name)) throw new TypeError("测试故障名称无效");
      failures.add(name);
    },
    memory: {
      start() {
        if (sampler) clearInterval(sampler);
        baselineRss = process.memoryUsage().rss;
        peakRss = baselineRss;
        sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 100);
        sampler.unref();
      },
      stop() {
        if (sampler) clearInterval(sampler);
        sampler = undefined;
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
        return { baselineRss, peakRss };
      },
    },
  };
  globalThis.__lifeAtlasTest = hooks;
  return hooks;
}
