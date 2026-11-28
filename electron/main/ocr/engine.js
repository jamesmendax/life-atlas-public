import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { OcrError, ocrFailure } from "./errors.js";
import { inspectImage } from "./images.js";

const require = createRequire(import.meta.url);
export const DEFAULT_OCR_LANGUAGE = "chi_sim+eng";
export const OCR_LANGUAGES = Object.freeze([DEFAULT_OCR_LANGUAGE, "chi_sim", "eng"]);

function unpackedPath(filePath) {
  return filePath.replace(/([\\/])app\.asar([\\/])/i, "$1app.asar.unpacked$2");
}

function assetPaths() {
  try {
    const worker = unpackedPath(fileURLToPath(new URL("./worker.cjs", import.meta.url)));
    const core = unpackedPath(require.resolve("tesseract.js-core/tesseract-core-lstm.js"));
    const wasm = core.replace(/\.js$/, ".wasm");
    const models = path.join(path.dirname(worker), "tessdata");
    const expected = [
      [worker], [core, 89261], [wasm, 2855361],
      [path.join(models, "eng.traineddata"), 4113088],
      [path.join(models, "chi_sim.traineddata"), 2469156],
    ];
    for (const [file, size] of expected) {
      const stats = fs.statSync(file);
      if (!stats.isFile() || (size !== undefined && stats.size !== size)) throw new Error("missing OCR asset");
    }
    return { worker, core, wasm, models };
  } catch {
    throw new OcrError("E_OCR_ENGINE");
  }
}

export function getOcrStatus() {
  try {
    assetPaths();
    return { ok: true, available: true, engine: "Tesseract", languages: OCR_LANGUAGES };
  } catch (error) {
    return { ...ocrFailure(error), available: false };
  }
}

export async function recognizeImage(image, language = DEFAULT_OCR_LANGUAGE, { timeoutMs = 45_000 } = {}) {
  if (!OCR_LANGUAGES.includes(language)) throw new OcrError("E_OCR_LANGUAGE");
  const { orientation } = inspectImage(image);
  const { worker: workerPath, ...assets } = assetPaths();
  const worker = new Worker(workerPath, {
    workerData: { ...assets, image, language, orientation },
    name: "Life Atlas OCR",
  });
  let timeout;
  try {
    return await new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new OcrError("E_OCR_TIMEOUT")), timeoutMs);
      worker.once("message", (result) => {
        if (result?.ok === true && typeof result.text === "string") resolve(result.text);
        else reject(new OcrError(result?.code === "E_OCR_IMAGE" ? result.code : "E_OCR_ENGINE"));
      });
      worker.once("error", () => reject(new OcrError("E_OCR_ENGINE")));
      worker.once("exit", () => reject(new OcrError("E_OCR_ENGINE")));
    });
  } finally {
    clearTimeout(timeout);
    await worker.terminate().catch(() => {});
  }
}
