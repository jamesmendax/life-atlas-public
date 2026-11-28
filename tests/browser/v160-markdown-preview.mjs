import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import electron from "electron";
import { _electron as playwrightElectron } from "playwright";
import { createServer } from "vite";
import { createIsolatedDirectory, removeIsolatedDirectory, REPO_ROOT, seedWorkspaceDatabase } from "../desktop/helpers.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { MARKDOWN_PREVIEW_EXTENSIONS } from "../../electron/main/markdownPreview.js";

const sandbox = createIsolatedDirectory("markdown-preview-electron");
const profile = path.join(sandbox, "data");
const wrapper = path.join(sandbox, "hidden-main.mjs");
const devUrl = "http://127.0.0.1:5199";
const cwd = path.join(sandbox, "本地 文件");
const errorLog = [];
let app;
let server;
const hash = async file => createHash("sha256").update(await readFile(file)).digest("hex");

try {
  await mkdir(cwd, { recursive: true });
  await seedWorkspaceDatabase(profile, coreParityWorkspace());
  await mkdir(path.join(profile, "runtime", "crashes"), { recursive: true });
  await writeFile(wrapper, `
    import { app, BrowserWindow, globalShortcut } from "electron";
    Object.defineProperty(BrowserWindow.prototype, "show", { value() {} });
    Object.defineProperty(BrowserWindow.prototype, "focus", { value() {} });
    globalShortcut.register = () => false;
    app.setAppPath(${JSON.stringify(REPO_ROOT)});
    await import(${JSON.stringify(pathToFileURL(path.join(REPO_ROOT, "electron/main/index.js")).href)});
  `);
  const extensions = [...MARKDOWN_PREVIEW_EXTENSIONS, ".md", ".md", ".md", ".md", ".md"];
  const files = await Promise.all(extensions.map(async (extension, index) => {
    const filename = path.join(cwd, `文档 ${index + 1}${extension}`);
    const text = `# 文档 ${index + 1}\n\n**中文正文**\n\n| 项目 | 数量 |\n| --- | --- |\n| 苹果 | 3 |\n\n![远程图片](https://example.invalid/image.png)\n\n[网址](https://example.invalid/)\n\n[文件](file:///C:/unknown.md)\n\n<script>throw new Error("script executed")</script>`;
    await writeFile(filename, index === 8 ? Buffer.from([0xc0, 0x80]) : text);
    return filename;
  }));
  const sourceBefore = await Promise.all(files.map(hash));
  const database = path.join(profile, "workspace.db");
  const before = await hash(database);
  const dependencies = await realpath(path.join(REPO_ROOT, "node_modules"));
  server = await createServer({ root: REPO_ROOT, cacheDir: path.join(sandbox, "vite-cache"), logLevel: "warn",
    server: { port: 5199, host: "127.0.0.1", strictPort: true, fs: { allow: [REPO_ROOT, dependencies] } } });
  await server.listen();
  const env = { ...process.env, LIFE_ATLAS_DATA_ROOT: profile, LIFE_ATLAS_TEST: "1", LIFE_ATLAS_DEV_URL: devUrl,
    LIFE_ATLAS_TEST_DEFER_WORKSPACE_LOAD: "1" };
  const launch = args => playwrightElectron.launch({ executablePath: electron, args: [wrapper, ...args], cwd, env, timeout: 30000 });
  const waitPreview = async window => {
    window.on("pageerror", error => errorLog.push(error.message));
    window.setDefaultTimeout(10000);
    await window.getByRole("heading", { name: "Markdown 预览", exact: true }).waitFor();
    assert.deepEqual(await window.evaluate(() => [typeof window.lifeAtlasMarkdownPreview, typeof window.lifeAtlasDesktop, typeof window.lifeAtlasVault, typeof require]),
      ["object", "undefined", "undefined", "undefined"]);
    return window.getByRole("tablist", { name: "所选文件" });
  };
  const invisible = application => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible()));
  const sendInvocation = args => once(spawn(electron, [wrapper, ...args], { cwd, env, windowsHide: true, stdio: "ignore" }), "exit");
  app = await launch(["--markdown-preview", ...files]);
  const document = await app.firstWindow();
  const tabs = await waitPreview(document);
  await document.getByRole("tab", { name: path.basename(files[9]) }).waitFor();
  assert.equal(await tabs.getByRole("tab").count(), 10);
  await document.getByText("一次最多预览 10 个文件，已略过 1 个。", { exact: true }).waitFor();
  assert.ok(await invisible(app));
  assert.equal(app.windows().length, 1);
  await assert.rejects(access(path.join(profile, ".lock")), { code: "ENOENT" });
  await document.getByRole("heading", { name: "文档 1", exact: true }).waitFor();
  await document.getByRole("table").getByText("苹果", { exact: true }).waitFor();
  assert.equal(await document.locator("article img, article script").count(), 0);
  assert.equal(await document.getByRole("link", { name: "文件", exact: true }).count(), 0);
  assert.equal(await document.getByRole("link", { name: "网址", exact: true }).getAttribute("href"), "https://example.invalid/");
  const first = tabs.getByRole("tab").first();
  await first.press("ArrowRight");
  await document.getByRole("heading", { name: "文档 2", exact: true }).waitFor();
  for (const [index, filename] of files.slice(2, 6).entries()) {
    await tabs.getByRole("tab", { name: path.basename(filename), exact: true }).click();
    await document.getByRole("heading", { name: `文档 ${index + 3}`, exact: true }).waitFor();
  }
  await tabs.getByRole("tab", { name: path.basename(files[8]) }).click();
  await document.getByRole("alert").getByText("文件不是有效的 UTF-8 文本。", { exact: true }).waitFor();
  assert.equal(await hash(database), before);
  console.log("PASS cold Electron Markdown preview, six extensions, 10/11, safe content, keyboard and untouched workspace");

  const ordinaryWindow = app.waitForEvent("window", { timeout: 15000 });
  const ordinaryExit = sendInvocation([]);
  await ordinaryWindow;
  assert.equal((await ordinaryExit)[0], 0);
  await access(path.join(profile, ".lock"));
  assert.ok(await invisible(app));
  assert.equal(app.windows().length, 2);
  await document.getByRole("alert").getByText("文件不是有效的 UTF-8 文本。", { exact: true }).waitFor();
  console.log("PASS ordinary launch starts its workspace when a cold preview owns the instance lock");
  await app.close();
  app = undefined;

  app = await launch([]);
  await app.firstWindow();
  await access(path.join(profile, ".lock"));
  const beforeWarm = await hash(database);
  const hotPreview = app.waitForEvent("window", { timeout: 15000 });
  const secondaryExit = sendInvocation(["--markdown-preview", ...files.slice(0, 2)]);
  const warmDocument = await hotPreview;
  const warmTabs = await waitPreview(warmDocument);
  await warmTabs.getByRole("tab", { name: path.basename(files[1]), exact: true }).click();
  await warmDocument.getByRole("heading", { name: "文档 2", exact: true }).waitFor();
  assert.equal((await secondaryExit)[0], 0);
  assert.equal(app.windows().length, 2);
  assert.ok(await invisible(app));
  assert.equal(await hash(database), beforeWarm);
  assert.deepEqual(await Promise.all(files.map(hash)), sourceBefore);
  assert.deepEqual(errorLog, []);
  console.log("PASS second-instance delivery to the existing main process, hidden preview, and unchanged source and workspace bytes");
} finally {
  try { await app?.close(); }
  finally {
    await server?.close();
    removeIsolatedDirectory(sandbox);
  }
}
