import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { componentMime, createMarketService } from "../electron/main/market/service.js";
import { collectAssetReferences } from "../electron/main/storage/assetCleanup.js";
import { changePomodoro, pomodoroDefaults, pomodoroRemaining, readPomodoroState, updatePomodoroSettings } from "../src/domain/pomodoro.js";

test("the native timer reads the old countdown and retains the running or paused remainder when durations change", () => {
  const now = 1_000_000;
  const legacy = readPomodoroState(JSON.stringify({ phase: "break", remaining: 300_000, endsAt: now + 250_000 }));
  assert.deepEqual(legacy.settings, pomodoroDefaults);
  assert.equal(legacy.phase, "break");
  const configured = updatePomodoroSettings(legacy, { restMinutes: 1 });
  assert.equal(pomodoroRemaining(configured, now), 250_000);
  const paused = changePomodoro(configured, "toggle", now + 1_500);
  assert.equal(paused.paused, true);
  assert.equal(paused.remaining, 248_500);
  assert.equal(paused.endsAt, null);
  const resumed = changePomodoro(paused, "toggle", now + 5_000);
  assert.equal(resumed.endsAt, now + 253_500);
  assert.equal(pomodoroRemaining(resumed, now + 260_000), 0);
  assert.equal(changePomodoro(resumed, "reset", now).remaining, 60_000);
});

test("custom alarms are managed local assets and remain referenced by the widget's serialized state", () => {
  const hash = "1".repeat(64);
  const initial = readPomodoroState("{}");
  assert.equal(initial.settings.finishEnabled, true);
  assert.equal(initial.settings.finishVolume, 90);
  assert.equal(initial.settings.soundEnabled, false);
  const configured = updatePomodoroSettings(initial, {
    focusMinutes: 42, face: "vertical", finishName: "铃声.wav", finishUrl: "life-asset://" + hash, width: 536,
  });
  assert.equal(configured.remaining, 42 * 60_000);
  const entity = JSON.stringify({ content: [{ type: "marketComponent", props: { state: JSON.stringify(configured) } }] });
  assert(collectAssetReferences([entity]).has(hash));
  const reopened = readPomodoroState(JSON.stringify(configured));
  assert.deepEqual(reopened, configured);
  const invalid = updatePomodoroSettings(reopened, { finishUrl: "https://example.invalid/remote.mp3" });
  assert.equal(invalid.settings.finishUrl, "");
});

test("an old signed Pomodoro archive remains a v1 script and an absent archive cannot claim a host", async () => {
  const bundled = new URL("../market/public/", import.meta.url);
  const catalog = JSON.parse(readFileSync(new URL("catalog.json", bundled), "utf8"));
  const pomodoro = catalog.entries.find((entry) => entry.id === "life-atlas.pomodoro");
  const packagePath = fileURLToPath(new URL(pomodoro.packagePath, bundled));
  let reads = 0;
  const service = createMarketService({
    appVersion: "1.1.0", directory: fileURLToPath(bundled),
    assetStore: {
      get(hash) {
        return hash === pomodoro.sha256 ? { mime: componentMime, size: pomodoro.size } : null;
      },
      filePath() { reads++; return packagePath; },
    },
    runtime: { close() {} },
  });
  try {
    await assert.rejects(service.hostWidget({ url: "life-asset://" + "2".repeat(64), packageId: pomodoro.id }), { code: "E_NOT_FOUND" });
    assert.equal(reads, 0);
    assert.deepEqual(await service.hostWidget({ url: "life-asset://" + pomodoro.sha256 }), { kind: null });
    assert.equal(reads, 1);
  } finally {
    service.close();
  }
});
