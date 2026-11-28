import assert from "node:assert/strict";
import { test } from "node:test";
import { downloadBlob } from "../src/domain/pageExport.js";

test("desktop exports keep each blob until its own native download completes or is cancelled", async (t) => {
  const listeners = new Set();
  const anchors = [];
  const revoked = [];
  const release = URL.revokeObjectURL.bind(URL);
  t.mock.method(URL, "revokeObjectURL", (url) => { revoked.push(url); release(url); });
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = { setTimeout, clearTimeout, lifeAtlas: { app: {
    onExportDownload(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  } } };
  globalThis.document = {
    createElement() { return { click() {}, remove() {} }; },
    body: { appendChild(anchor) { anchors.push(anchor); } },
  };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  });
  const signal = (anchor, outcome) => listeners.forEach((notify) => notify({ url: anchor.href, outcome }));
  const first = downloadBlob(new Blob(["page one"]), "first.html");
  const second = downloadBlob(new Blob(["page two"]), "second.svg");
  signal(anchors[0], "choosing");
  signal(anchors[1], "choosing");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(revoked, []);
  signal(anchors[1], "cancelled");
  assert.equal(await second, false);
  assert.deepEqual(revoked, [anchors[1].href]);
  signal(anchors[0], "completed");
  assert.equal(await first, true);
  assert.deepEqual(revoked, [anchors[1].href, anchors[0].href]);
  assert.equal(listeners.size, 0);
  const failure = downloadBlob(new Blob(["retry"]), "third.pdf");
  signal(anchors[2], "interrupted");
  await assert.rejects(failure, /未能保存导出文件/);
  assert.equal(listeners.size, 0);
});
