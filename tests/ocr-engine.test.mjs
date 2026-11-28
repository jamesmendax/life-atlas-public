import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { getOcrStatus, recognizeImage } from "../electron/main/ocr/engine.js";
import { inspectImage } from "../electron/main/ocr/images.js";

const original = new URL("./fixtures/ocr-sample.png", import.meta.url);
const readSample = () => readFile(original);

test("packaged language models recognize Chinese and English from a cold worker", async () => {
  assert.deepEqual(getOcrStatus(), {
    ok: true, available: true, engine: "Tesseract", languages: ["chi_sim+eng", "chi_sim", "eng"],
  });
  const input = await readSample();
  const text = await recognizeImage(input);
  assert.match(text, /^Offline text recognition 2026$/m);
  assert.match(text, /^离线识别测试，图片文字$/m);
  assert.match(await recognizeImage(input, "chi_sim"), /离线识别测试，图片文字/);
  assert.match(await recognizeImage(input, "eng"), /Offline text recognition 2026/);
});

test("recognizes JPEG orientation and static WebP files", async () => {
  const input = await readSample();
  const jpeg = await sharp(input).rotate(90).withMetadata({ orientation: 8 }).jpeg().toBuffer();
  assert.deepEqual(inspectImage(jpeg), { width: 420, height: 1440, orientation: 8 });
  assert.match(await recognizeImage(jpeg), /Offline text recognition 2026/);

  const webp = await sharp(input).webp({ lossless: true }).toBuffer();
  assert.deepEqual(inspectImage(webp), { width: 1440, height: 420, orientation: 1 });
  assert.match(await recognizeImage(webp), /离线识别测试，图片文字/);
});

test("checks limits before decoding and terminates a timed-out worker", async () => {
  const input = await readSample();
  const oversize = Buffer.from(input);
  oversize.writeUInt32BE(9000, 16);
  await assert.rejects(recognizeImage(oversize), { code: "E_OCR_SIZE" });
  await assert.rejects(recognizeImage(Buffer.from("not an image")), { code: "E_OCR_IMAGE" });
  await assert.rejects(recognizeImage(input, "unexpected"), { code: "E_OCR_LANGUAGE" });
  await assert.rejects(recognizeImage(input, "eng", { timeoutMs: 1 }), { code: "E_OCR_TIMEOUT" });
  assert.match(await recognizeImage(input, "eng"), /Offline text recognition 2026/);
});
