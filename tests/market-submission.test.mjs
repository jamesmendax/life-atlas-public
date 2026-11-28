import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkSubmission } from "../market/check-submission.mjs";

const originals = fileURLToPath(new URL("../market/official/", import.meta.url));

test("the submission checker accepts both existing package source layouts", async (t) => {
  assert.deepEqual(await checkSubmission("template", path.join(originals, "focus-study")), { type: "template", files: 2 });
  const official = path.join(originals, "habit-heatmap");
  const submission = await mkdtemp(path.join(tmpdir(), "life-atlas-component-submission-test-"));
  t.after(() => rm(submission, { recursive: true, force: true }));
  for (const file of ["component.js", "preview.png"]) await copyFile(path.join(official, file), path.join(submission, file));
  assert.deepEqual(await checkSubmission("component", submission), { type: "component", files: 1 });
  await assert.rejects(checkSubmission("component", official), /多余文件：preview-ui\.png/u);
});

test("prebuilt rich widgets are checked as data, including resources, without evaluating their UI", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "life-atlas-ui-submission-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "assets"));
  await writeFile(path.join(root, "ui.js"), "(() => { throw Error('review executed submitted code'); })();");
  await writeFile(path.join(root, "ui.css"), "#root{display:grid}");
  await writeFile(path.join(root, "assets", "demo.json"), '{"item":"library"}');
  const result = await checkSubmission("component", root);
  assert.deepEqual(result, { type: "component", files: 3 });
  await writeFile(path.join(root, "assets", "demo.json"), "invalid json");
  await assert.rejects(checkSubmission("component", root), /组件数据/u);
  await writeFile(path.join(root, "assets", "frame.html"), "<b>unexpected</b>");
  await assert.rejects(checkSubmission("component", root), /多余文件/u);
});

test("the submission checker parses widget scripts without executing them and rejects malformed or extra files", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "life-atlas-submission-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = path.join(root, "component.js");
  await writeFile(script, "throw new Error('widget code executed');");
  assert.equal((await checkSubmission("component", root)).files, 1);
  await writeFile(script, "function unfinished(");
  await assert.rejects(checkSubmission("component", root), SyntaxError);
  await writeFile(path.join(root, "extra.txt"), "extra");
  await assert.rejects(checkSubmission("component", root), /多余文件/u);
});
