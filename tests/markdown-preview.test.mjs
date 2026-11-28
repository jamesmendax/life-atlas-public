import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile, truncate, writeFile } from "node:fs/promises";
import path from "node:path";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";
import { createMarkdownPreview, MARKDOWN_PREVIEW_EXTENSIONS, MAX_MARKDOWN_PREVIEW_BYTES, parseMarkdownPreviewArgs, readSelectedMarkdown } from "../electron/main/markdownPreview.js";

test("Markdown launches preserve selected order, Chinese paths, six extensions and the overflow count", () => {
  const cwd = path.resolve("fixtures", "中文 文档");
  assert.equal(parseMarkdownPreviewArgs(["--flag", "文档.txt"], cwd), null);
  const names = MARKDOWN_PREVIEW_EXTENSIONS.map(extension => `Markdown 文件${extension.toUpperCase()}`);
  const inputs = [...names, ...Array.from({ length: 5 }, (_, i) => `${i}.md`)];
  for (const args of [inputs, ["--markdown-preview", ...inputs]]) {
    const request = parseMarkdownPreviewArgs(args, cwd);
    assert.deepEqual(request.selected, inputs.slice(0, 10).map(file => path.join(cwd, file)));
    assert.equal(request.overflow, 1);
  }
  assert.deepEqual(parseMarkdownPreviewArgs(["--markdown-preview"], cwd), { selected: [], overflow: 0 });
});

test("selected local files are read-only with UTF-8, type, existence and 8 MB checks", async context => {
  const dir = createIsolatedDirectory("markdown-preview");
  context.after(() => removeIsolatedDirectory(dir));
  const source = path.join(dir, "工作 说明.MARKDOWN");
  const bytes = Buffer.from("\uFEFF# 本地文件\r\n\r\n正文");
  await writeFile(source, bytes);
  assert.deepEqual(await readSelectedMarkdown(source), { text: "# 本地文件\r\n\r\n正文" });
  assert.deepEqual(await readFile(source), bytes);
  const invalid = path.join(dir, "wrong.md");
  await writeFile(invalid, Buffer.from([0xc0, 0x80]));
  assert.match((await readSelectedMarkdown(invalid)).error, /UTF-8/);
  assert.match((await readSelectedMarkdown(path.join(dir, "missing.md"))).error, /不存在/);
  assert.match((await readSelectedMarkdown(path.join(dir, "wrong.txt"))).error, /本机/);
  assert.match((await readSelectedMarkdown("\\\\unavailable-host\\docs\\remote.md")).error, /本机/);
  const limit = path.join(dir, "large.md");
  await writeFile(limit, "");
  await truncate(limit, MAX_MARKDOWN_PREVIEW_BYTES);
  assert.equal((await readSelectedMarkdown(limit)).text.length, MAX_MARKDOWN_PREVIEW_BYTES);
  await truncate(limit, MAX_MARKDOWN_PREVIEW_BYTES + 1);
  assert.match((await readSelectedMarkdown(limit)).error, /8 MB/);
});

test("preview IPC exposes metadata and only the bound file IDs to each preview main frame", async context => {
  const dir = createIsolatedDirectory("markdown-preview-ipc");
  context.after(() => removeIsolatedDirectory(dir));
  const one = path.join(dir, "文档 一.md");
  const two = path.join(dir, "文档 二.md");
  await writeFile(one, "# First");
  await writeFile(two, "# Second");
  const handles = new Map();
  const windows = [];
  let requestPolicy;
  let downloadPolicy;
  let confirm;
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.id = windows.length + 1;
      this.webContents.mainFrame = { processId: this.webContents.id, routingId: 1 };
      this.webContents.setWindowOpenHandler = fn => { this.windowOpen = fn; };
      windows.push(this);
    }
    setMenuBarVisibility() {}
    loadURL(url) { this.webContents.mainFrame.url = url; return Promise.resolve(); }
  }
  const preview = createMarkdownPreview({ BrowserWindow, ipcMain: { handle: (tag, fn) => handles.set(tag, fn) },
    session: { fromPartition(name, options) {
      assert.equal(name, "markdown-preview");
      assert.equal(options.cache, false);
      return {
        protocol: { handle: () => {} },
        webRequest: { onBeforeRequest: fn => { requestPolicy = fn; }, onCompleted: () => {} },
        setPermissionRequestHandler: () => {}, setPermissionCheckHandler: () => {},
        on: (event, callback) => { if (event === "will-download") downloadPolicy = callback; },
      };
    } }, distDir: dir, preload: "preview.cjs", nativeTheme: { shouldUseDarkColors: false }, isPackaged: true,
    confirmExternal: (window, url) => { confirm = { window, url }; }, onLoadError: () => assert.fail("preview failed to load"),
  });
  preview({ selected: [one, two], overflow: 1 });
  const [window] = windows;
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.options.webPreferences.sandbox, true);
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  const list = handles.get("la:markdown-preview:list");
  const read = handles.get("la:markdown-preview:read");
  assert.deepEqual(list(event), { files: [{ id: "0", name: "文档 一.md" }, { id: "1", name: "文档 二.md" }], overflow: 1 });
  assert.deepEqual(await read(event, "1"), { text: "# Second" });
  assert.ok((await read(event, path.join(dir, "文档 一.md"))).error);
  assert.ok((await read({ ...event, senderFrame: { ...event.senderFrame, routingId: 2 } }, "0")).error);
  assert.ok((await read({ ...event, senderFrame: { ...event.senderFrame, url: "app://bundle/index.html" } }, "0")).error);
  assert.ok((await read({ ...event, sender: { id: window.webContents.id } }, "0")).error);
  assert.equal(window.windowOpen({ url: "https://example.invalid/", referrer: { url: event.senderFrame.url } }).action, "deny");
  assert.deepEqual(confirm, { window, url: "https://example.invalid/" });
  assert.equal(window.windowOpen({ url: "file:///other.md" }).action, "deny");
  requestPolicy({ url: "https://example.invalid/image.png" }, outcome => assert.equal(outcome.cancel, true));
  let cancelled = false;
  downloadPolicy({ preventDefault: () => { cancelled = true; } }, { getURL: () => "data:text/plain,text" });
  assert.equal(cancelled, true);
  window.emit("closed");
  assert.ok((await read(event, "1")).error);
});

test("installer offers all preview formats through an owned Open With target", async () => {
  const source = await readFile(new URL("../build/installer.nsh", import.meta.url), "utf8");
  for (const extension of MARKDOWN_PREVIEW_EXTENSIONS) assert.ok(source.includes(`!insertmacro \${Action} "${extension}"`));
  assert.match(source, /OpenWithProgids/);
  assert.match(source, /SupportedTypes/);
  assert.match(source, /--markdown-preview "%1"/);
  assert.match(source, /DeleteRegValue[^\n]+OpenWithProgids/);
  assert.doesNotMatch(source, /UserChoice|ASSOCIATE|WriteRegStr[^\n]+Classes\\\$\{Extension\}"\s+""/i);
});
