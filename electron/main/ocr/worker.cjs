const fs = require("node:fs");
const path = require("node:path");
const { parentPort, workerData } = require("node:worker_threads");

const LSTM_ONLY = 1;
const AUTO_LAYOUT = 3;
const SPARSE_TEXT = 11;

async function recognize({ core, wasm, models, image, language, orientation }) {
  const loadCore = require(core);
  const module = await loadCore({ wasmBinary: fs.readFileSync(wasm), print: () => {}, printErr: () => {} });
  for (const code of language.split("+")) {
    const name = `${code}.traineddata`;
    module.FS.writeFile(`/${name}`, fs.readFileSync(path.join(models, name)));
  }
  const api = new module.TessBaseAPI();
  try {
    if (api.Init(null, language, LSTM_ONLY) !== 0) return { ok: false, code: "E_OCR_ENGINE" };
    module.FS.writeFile("/input", image);
    if (api.SetImageFile(orientation, 0) !== 0) return { ok: false, code: "E_OCR_IMAGE" };

    api.SetPageSegMode(AUTO_LAYOUT);
    let text = api.GetUTF8Text().trim();
    if (!text) {
      api.SetPageSegMode(SPARSE_TEXT);
      if (api.SetImageFile(orientation, 0) === 0) text = api.GetUTF8Text().trim();
    }
    return { ok: true, text };
  } finally {
    api.End();
    module.destroy(api);
  }
}

recognize(workerData).then(
  (result) => parentPort.postMessage(result),
  () => parentPort.postMessage({ ok: false, code: "E_OCR_ENGINE" }),
);
