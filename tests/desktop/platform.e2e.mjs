import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PNG_1X1_BASE64 } from "../fixtures/full-workspace.mjs";
import { createIsolatedDirectory, removeIsolatedDirectory, launchApp, closeApp, assertNoNetworkAndErrors } from "./helpers.mjs";

function audioFixture() {
  const sampleRate = 8000;
  const sampleCount = 2400;
  const bytes = Buffer.alloc(44 + sampleCount * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) bytes.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 440 / sampleRate) * 1000), 44 + index * 2);
  return bytes;
}

function unsignedBytes(value) {
  const hexadecimal = BigInt(value).toString(16);
  return Buffer.from(hexadecimal.padStart(Math.ceil(hexadecimal.length / 2) * 2, "0"), "hex");
}

function ebmlSize(value) {
  let width = 1;
  while (BigInt(value) >= (1n << BigInt(width * 7)) - 1n) width += 1;
  assert.ok(width <= 8);
  const bytes = Buffer.alloc(width);
  let remaining = BigInt(value);
  for (let index = width - 1; index >= 0; index -= 1) { bytes[index] = Number(remaining & 255n); remaining >>= 8n; }
  bytes[0] |= 1 << (8 - width);
  return bytes;
}

function ebmlElement(identifier, value) {
  const bytes = Buffer.isBuffer(value) ? value : typeof value === "string" ? Buffer.from(value) : unsignedBytes(value);
  return Buffer.concat([unsignedBytes(identifier), ebmlSize(bytes.length), bytes]);
}

function webmFixture(chunks) {
  assert.equal(chunks.length, 6);
  const header = ebmlElement(0x1a45dfa3, Buffer.concat([ebmlElement(0x4286, 1), ebmlElement(0x42f7, 1), ebmlElement(0x42f2, 4), ebmlElement(0x42f3, 8), ebmlElement(0x4282, "webm"), ebmlElement(0x4287, 4), ebmlElement(0x4285, 2)]));
  const duration = Buffer.alloc(8);
  duration.writeDoubleBE(500);
  const info = ebmlElement(0x1549a966, Buffer.concat([ebmlElement(0x2ad7b1, 1000000), ebmlElement(0x4d80, "Life Atlas test fixture"), ebmlElement(0x5741, "Life Atlas test fixture"), ebmlElement(0x4489, duration)]));
  const video = ebmlElement(0xe0, Buffer.concat([ebmlElement(0xb0, 32), ebmlElement(0xba, 32)]));
  const tracks = ebmlElement(0x1654ae6b, ebmlElement(0xae, Buffer.concat([ebmlElement(0xd7, 1), ebmlElement(0x73c5, 1), ebmlElement(0x83, 1), ebmlElement(0x86, "V_VP8"), ebmlElement(0x23e383, 83333333), video])));
  const blocks = chunks.map((chunk) => {
    assert.ok(chunk.bytes.length > 0);
    const blockHeader = Buffer.alloc(4);
    blockHeader[0] = 0x81;
    blockHeader.writeInt16BE(Math.round(chunk.timestamp / 1000), 1);
    blockHeader[3] = chunk.type === "key" ? 0x80 : 0;
    return ebmlElement(0xa3, Buffer.concat([blockHeader, Buffer.from(chunk.bytes)]));
  });
  const cluster = ebmlElement(0x1f43b675, Buffer.concat([ebmlElement(0xe7, 0), ...blocks]));
  return Buffer.concat([header, ebmlElement(0x18538067, Buffer.concat([info, tracks, cluster]))]);
}

async function videoFixture(page) {
  const chunks = await page.evaluate(async () => {
    if (typeof VideoEncoder !== "function") throw new Error("The required local VP8 fixture encoder is unavailable");
    const config = { codec: "vp8", width: 32, height: 32, bitrate: 20000, framerate: 12, hardwareAcceleration: "prefer-software" };
    if (!(await VideoEncoder.isConfigSupported(config)).supported) throw new Error("The required local VP8 fixture encoder is unsupported");
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const drawing = canvas.getContext("2d");
    const output = [];
    let failure;
    const encoder = new VideoEncoder({
      output: (chunk) => { const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes); output.push({ timestamp: chunk.timestamp, type: chunk.type, bytes: [...bytes] }); },
      error: (error) => { failure = error; },
    });
    try {
      encoder.configure(config);
      for (let index = 0; index < 6; index += 1) {
        drawing.fillStyle = index % 2 ? "#252525" : "#dedede";
        drawing.fillRect(0, 0, 32, 32);
        const frame = new VideoFrame(canvas, { timestamp: index * 83333, duration: 83333 });
        try { encoder.encode(frame, { keyFrame: index === 0 }); } finally { frame.close(); }
      }
      await encoder.flush();
      if (failure) throw failure;
      return output;
    } finally {
      if (encoder.state !== "closed") encoder.close();
    }
  });
  return webmFixture(chunks);
}

async function uploadMedia(handle, { file, type, title }) {
  const paragraph = handle.page.locator('.life-editor .bn-block-content[data-content-type="paragraph"]').last();
  await paragraph.click();
  await handle.page.keyboard.press("Control+End");
  await handle.page.keyboard.press("Enter");
  await handle.page.keyboard.type(`/${title}`);
  await handle.page.getByRole("option").filter({ hasText: title }).first().click();
  const block = handle.page.locator(`.life-editor .bn-block-content[data-content-type="${type}"]`).last();
  await block.locator(".bn-add-file-button").click();
  await handle.page.locator('.bn-panel input[type="file"]').setInputFiles(file);
  await block.locator(".bn-add-file-button").waitFor({ state: "hidden" });
  await handle.page.keyboard.press("Escape");
  const hash = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const url = `life-asset://${hash}`;
  const deadline = Date.now() + 30000;
  while (true) {
    const result = await handle.page.evaluate(() => window.lifeAtlas.workspace.load());
    assert.equal(result.ok, true, result.error?.message);
    if (result.value.workspace.attachments.some((attachment) => attachment.storageKey === hash)) break;
    assert.ok(Date.now() < deadline, `Timed out awaiting persisted ${type} attachment`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { type, url };
}

async function assertMediaReady(handle, assets) {
  for (const { type, url } of assets) {
    await handle.page.waitForFunction(({ type, url }) => {
      if ([...document.querySelectorAll(".life-media-state")].some((element) => element.textContent.includes("附件文件在本机不可用"))) throw new Error("A required local media fixture entered the unavailable state");
      return [...document.querySelectorAll(`.life-editor ${type === "image" ? "img" : type}`)].some((element) => element.src === url && (type === "image" ? element.complete && element.naturalWidth > 0 : element.readyState >= 2 && !element.error));
    }, { type, url });
  }
  await handle.page.locator(".life-editor").click();
  const playback = await handle.page.evaluate(async (assets) => {
    const media = assets.filter((asset) => asset.type !== "image").map((asset) => [...document.querySelectorAll(`.life-editor ${asset.type}`)].find((element) => element.src === asset.url));
    await Promise.all(media.map((element) => element.play()));
    return media.map((element) => ({ type: element.tagName.toLowerCase(), readyState: element.readyState, paused: element.paused, error: element.error?.code ?? null, width: element.videoWidth ?? null, height: element.videoHeight ?? null }));
  }, assets);
  assert.equal(playback.length, 2);
  for (const media of playback) {
    assert.ok(media.readyState >= 2);
    assert.equal(media.paused, false);
    assert.equal(media.error, null);
    if (media.type === "video") { assert.equal(media.width, 32); assert.equal(media.height, 32); }
  }
  await assertNoNetworkAndErrors(handle);
}

test("opaque local image audio and video assets remain playable after restart", { timeout: 90000 }, async (context) => {
  const dataRoot = createIsolatedDirectory("opaque-media");
  const inputs = createIsolatedDirectory("opaque-media-inputs");
  let handle;
  let completed = false;
  const directories = new Set([dataRoot, inputs]);
  context.after(async () => {
    let failure;
    if (handle) {
      try { await closeApp(handle, { keepDirs: true }); } catch (error) { failure = error; }
    }
    if (!completed || failure) console.log(`LIFE_ATLAS_MEDIA_CASE_RETAINED ${JSON.stringify({ directories: [...directories], completed })}`);
    else for (const directory of directories) if (fs.existsSync(directory)) removeIsolatedDirectory(directory);
    if (failure) throw failure;
  });
  handle = await launchApp({ dataRoot, packaged: true });
  directories.add(handle.bootstrapDir);
  directories.add(handle.tempDir);
  await handle.page.locator('html[data-la-ready="1"]').waitFor();
  const image = path.join(inputs, "local-image.png");
  const audio = path.join(inputs, "local-audio.wav");
  const video = path.join(inputs, "local-video.webm");
  fs.writeFileSync(image, Buffer.from(PNG_1X1_BASE64, "base64"));
  fs.writeFileSync(audio, audioFixture());
  fs.writeFileSync(video, Buffer.from(await videoFixture(handle.page)));
  const assets = [];
  for (const media of [{ file: image, type: "image", title: "图片" }, { file: audio, type: "audio", title: "音频" }, { file: video, type: "video", title: "视频" }]) assets.push(await uploadMedia(handle, media));
  await assertMediaReady(handle, assets);
  const previous = handle;
  await closeApp(previous, { keepDirs: true });
  removeIsolatedDirectory(previous.tempDir);
  handle = null;
  handle = await launchApp({ dataRoot, bootstrapDir: previous.bootstrapDir, packaged: true });
  directories.add(handle.tempDir);
  await handle.page.locator('html[data-la-ready="1"]').waitFor();
  await assertMediaReady(handle, assets);
  console.log(`LIFE_ATLAS_OPAQUE_MEDIA_RESTART=${JSON.stringify({ types: assets.map((asset) => asset.type), playableBeforeAndAfterRestart: true })}`);
  completed = true;
});
