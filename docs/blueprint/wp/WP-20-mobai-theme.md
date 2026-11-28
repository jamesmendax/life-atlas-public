# WP-20 墨白主题：白天与夜间

- 规模：L · 前置：WP-03（**执行顺序排在 WP-03 之后、WP-04 之前**，见 06 第 1 节）· 分支：`wp/20-mobai-theme`
- 停止点：步骤 0（理解确认）、步骤 6（浏览器场景和视觉对照图完成）、步骤 8（收尾）
- 必读：`12-视觉规范-墨白.md` 全文；`docs/blueprint/design/mobai/theme/index.css`；`docs/blueprint/design/mobai/sample-page.json`；`09-执行手册.md`（4.3、4.5 节）；`11-接口契约.md` 第 1 节（`app.setThemeSource`）；源码 `src/main.jsx`、`src/App.jsx`、`src/components/WorkspaceTopbar.jsx`、`src/editor/PageEditor.jsx`、`src/editor/EditorContainers.jsx`、`src/persistence/normalize.js`、`electron/main/ipc/app.js`、`electron/preload/workspace.cjs`、`tests/browser/harness.mjs`；工具 `docs/blueprint/tools/theme-tokens.mjs`、`docs/blueprint/tools/compare-shots.mjs`

## 0. 一页纸

- **要做到**：整个应用换成用户选定的“墨白”风格（2026-11-06 起尽量贴近 Notion：无衬线字体、暖灰文字、浅灰网格线、Notion 蓝、悬停才出现的控件，`12` 第 1 节），有白天和夜间两种模式，默认跟随电脑；顶栏有一个按钮可以在“跟随系统 → 白天 → 夜间”之间切换，重启后还记得。
- **交付物**：两个字体包（devDependencies）；全部 CSS 里写死的颜色换成变量（`src/ui/theme-tokens.css`）；`src/ui/theme.js`、`src/ui/useResolvedTheme.js`；`src/ui/themes/mobai/` 的 9 个文件（从蓝图原样复制）；顶栏切换按钮；桌面版 `app.setThemeSource`；单元测试 `tests/theme.test.mjs`、`tests/theme-files.test.mjs`；浏览器场景 `wp20-mobai`；桌面端到端 `tests/desktop/theme.e2e.mjs`；视觉对照图 `.qa/WP-20/compare/`。
- **绝对不要**：修改 `src/ui/themes/mobai/` 里从蓝图复制来的 8 个样式文件（`index.css` 以外）；手工改旧 CSS 里的颜色（用工具）；改布局、改组件结构、改任何业务逻辑；做设置对话框（WP-17）；动密钥库窗口和首次启动向导（它们还不存在，WP-05、WP-07 按 12 第 2 节自己做）。
- **什么时候停**：步骤 0、6 各停一次；步骤 8 的 wp-check 退出码为 0 或 2 时停。

## 1. 已知事实（总设计师 2026-11-01 和 2026-11-06 在项目副本上实测）

| 事实 | 对你的影响 |
| --- | --- |
| 在项目副本上运行 `theme-tokens.mjs --write`：改写 4 个文件、替换 880 处颜色、无法换算 0 处；改写前后 `node --test tests/*.test.mjs` 的结果完全相同 | 步骤 2 照做，不需要改任何测试 |
| `theme-tokens.mjs` 不处理 `src/ui/themes/`、`src/vault-ui/`、`src/setup-ui/`（这些地方本来就自己定义颜色） | 主题文件里的颜色是允许的；wp-check 的 K13 只检查旧 CSS |
| `docs/blueprint/design/mobai/theme/` 的 9 个文件装到“步骤 2 之后的项目副本”上，侧栏、顶栏、页面、编辑器全部区块、行内数据库、数据库的 10 种视图、页面菜单、搜索、文件夹视图、首页、回收站在白天和夜间都正常；截图就是 `design/mobai/product-shots/` | 步骤 4 原样复制，不要“改进” |
| 主题里有两处是在修旧样式表的布局：`styles.css` 比 `databaseParity.css` 晚加载，旧的 `.db-gallery-card`（三行网格）和 `.db-timeline-view`（横排）把新规则盖住了，画廊的标题压在属性上、时间线所有行挤成一排。`database.css` 用更高的优先级改回来 | 不要为这两处改组件或旧 CSS；画廊不显示封面是另一个代码问题，WP-15 修 |
| 主题用 `opacity` 让一些控件悬停时才出现（拖动手柄、日期旁的“···”、标题下面的元信息、同步区块的头部），没有用 `display: none` | 现有场景照样能找到、点击这些元素；不要改场景去适应 |
| 主题文件用到了工具生成的变量名（例如 `--la-gray-19`、`--la-c-aea6ff`） | 必须先做步骤 2，再做步骤 4 |
| `@fontsource-variable/noto-sans-sc@5.3.1`、`@fontsource-variable/noto-serif-sc@5.3.1`：OFL-1.1，各 112 个文件（其中 101 个是按字符范围分片的 woff2），字体族名 `"Noto Sans SC Variable"`、`"Noto Serif SC Variable"`；`import "@fontsource-variable/noto-sans-sc";` 导入全部字重。墨白的字体栈是 `"Segoe UI Variable Text", "Segoe UI", …, "Noto Sans SC Variable", …`：英文和数字是 Windows 自带的 Segoe UI，中文是打包的思源黑体；宋体包只给“衬线”页面字体用，平时不加载 | 步骤 1 安装，步骤 4 导入 |
| WP-03 已经删掉了 `fonts.googleapis.com` 的在线字体；桌面 CSP 是 `font-src 'self' data:`，Vite 打包后的字体文件在 `app://bundle/assets/` 下 | 不需要改 CSP |
| `BlockNoteView` 现在写死 `theme="dark"`（`PageEditor.jsx`、`EditorContainers.jsx` 各一处） | 改成跟随当前模式（2.3 节） |
| 在 Electron 里设置 `nativeTheme.themeSource` 为 `"light"`/`"dark"` 后，所有窗口的 `prefers-color-scheme` 都会跟着变；设为 `"system"` 时跟随 Windows | 密钥库窗口和向导以后只要用 `@media (prefers-color-scheme: dark)` 就能跟随 |
| 浏览器场景的 harness 默认视口是 1440×1040，可以用第三个参数的 `viewport` 改 | 本 WP 的场景用 1440×900，和参照图一样 |

## 2. 设计要点（规定）

### 2.1 偏好

- `ui.preferences.theme` 取 `"system" | "light" | "dark"`，默认 `"system"`。读取工作区时补默认值：在 `src/persistence/normalize.js` 的 `normalizeLoadedWorkspace` 返回之前，`ui.preferences = { ...ui.preferences, theme: normalizeThemePreference(ui.preferences?.theme) }`（从 `../ui/theme.js` 导入），不升 schema 版本（02 第 12 节已登记）。WP-17 以后会在同一个对象里再加 `defaultFont`、`startPage`。
- 另外在 `localStorage` 的 `life-atlas.theme-preference` 里缓存一份（只是界面缓存，不是工作区数据），让 `main.jsx` 在第一次渲染前就能用对的模式，不闪一下。

### 2.2 `src/ui/theme.js`（新文件，照抄）

```js
// 主题：风格（data-style）× 模式（data-theme）。现在只有墨白一种风格；以后加“钛白”只需要在 THEME_STYLES 里加一项。
export const THEME_STYLES = ["mobai"];
export const DEFAULT_STYLE = "mobai";
export const THEME_PREFERENCES = ["system", "light", "dark"];
export const DEFAULT_THEME_PREFERENCE = "system";
export const THEME_CACHE_KEY = "life-atlas.theme-preference";
export const THEME_LABELS = { system: "跟随系统", light: "白天", dark: "夜间" };

export function normalizeThemePreference(value) {
  return THEME_PREFERENCES.includes(value) ? value : DEFAULT_THEME_PREFERENCE;
}

export function resolveTheme(preference, systemPrefersDark) {
  const value = normalizeThemePreference(preference);
  if (value === "system") return systemPrefersDark ? "dark" : "light";
  return value;
}

export function nextThemePreference(preference) {
  const index = THEME_PREFERENCES.indexOf(normalizeThemePreference(preference));
  return THEME_PREFERENCES[(index + 1) % THEME_PREFERENCES.length];
}

export function applyTheme(resolved, root = document.documentElement, style = DEFAULT_STYLE) {
  root.dataset.style = THEME_STYLES.includes(style) ? style : DEFAULT_STYLE;
  root.dataset.theme = resolved === "dark" ? "dark" : "light";
}

export function systemPrefersDark() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function watchSystemTheme(callback) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const listener = (event) => callback(event.matches);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

export function readCachedPreference(storage = globalThis.localStorage) {
  try { return normalizeThemePreference(storage?.getItem(THEME_CACHE_KEY)); } catch { return DEFAULT_THEME_PREFERENCE; }
}

export function writeCachedPreference(preference, storage = globalThis.localStorage) {
  try { storage?.setItem(THEME_CACHE_KEY, normalizeThemePreference(preference)); } catch { /* 缓存写不进去不影响使用 */ }
}
```

### 2.3 `src/ui/useResolvedTheme.js`（新文件，照抄）与编辑器

```js
import { useSyncExternalStore } from "react";

// 读 <html data-theme>，属性变化时让组件重新渲染。BlockNoteView 用它决定 theme="light" 还是 "dark"。
function subscribe(callback) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
const getSnapshot = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

export function useResolvedTheme() {
  return useSyncExternalStore(subscribe, getSnapshot, () => "light");
}
```

`PageEditor.jsx` 和 `EditorContainers.jsx`：组件开头 `const resolvedTheme = useResolvedTheme();`，`BlockNoteView` 的 `theme="dark"` 改成 `theme={resolvedTheme}`。

### 2.4 应用与切换

- `src/main.jsx`：在 `createRoot(...).render(...)` **之前**加 `applyTheme(resolveTheme(readCachedPreference(), systemPrefersDark()));`（从 `./ui/theme.js` 导入）。
- `src/App.jsx`：
  - `const themePreference = normalizeThemePreference(workspace?.ui?.preferences?.theme);`
  - 一个 `useEffect`（依赖 `[themePreference]`）：定义 `const apply = () => applyTheme(resolveTheme(themePreference, systemPrefersDark()));`，立刻调用一次；`writeCachedPreference(themePreference)`；`window.lifeAtlas?.app?.setThemeSource?.({ source: themePreference })`（浏览器版没有这个函数，可选链跳过）；`const stop = watchSystemTheme(apply); return stop;`。
  - `cycleThemePreference()`：用 App 里修改 `workspace.ui` 的现有写法，把 `ui.preferences.theme` 改成 `nextThemePreference(themePreference)`（`ui.preferences` 不存在时先建成 `{}`）。
- `src/components/WorkspaceTopbar.jsx`：新 props `themePreference`、`onCycleTheme`；在 `.header-actions` 里、搜索按钮**前面**加：

  ```jsx
  <button type="button" className="header-theme-toggle ui-icon-button" aria-label="切换白天/夜间" title={`外观：${THEME_LABELS[themePreference]}`} onClick={onCycleTheme}>
    {themePreference === "light" ? <IconSun size={16} /> : themePreference === "dark" ? <IconMoon size={16} /> : <IconCircleHalf2 size={16} />}
  </button>
  ```

  （图标从 `@tabler/icons-react` 导入；样式已经在 `theme/shell.css` 里。）App 渲染 `WorkspaceTopbar` 的每一处都传这两个 props。

### 2.5 桌面版

- `electron/main/ipc/app.js`：注册 `la:app:set-theme-source`：参数 `{ source }` 必须是 `"light"`、`"dark"`、`"system"` 之一（否则抛 `E_INVALID_ARGUMENT`）；`nativeTheme.themeSource = source`；返回 `{}`。发送方必须是工作区窗口（和 `la:app:get-info` 一样的检查）。
- `electron/preload/workspace.cjs`：`app` 对象里加 `setThemeSource: (args) => ipcRenderer.invoke("la:app:set-theme-source", args)`。
- `electron/main/windows.js`：新增并导出 `themeBackgroundColor()`，返回 `nativeTheme.shouldUseDarkColors ? "#191919" : "#ffffff"`（12 第 3 节的 `--mb-paper`）；`createWorkspaceWindow` 的选项加 `backgroundColor: themeBackgroundColor()`（夜间启动时不会先闪一下白色）；再导出 `installThemeBackgroundSync()`：`nativeTheme.on("updated", () => { for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(themeBackgroundColor()); })`。以后新建的窗口（向导 WP-05、密钥库 WP-07）也用 `backgroundColor: themeBackgroundColor()`。
- `electron/main/index.js`：`app.whenReady()` 之后、创建第一个窗口之前调用 `Menu.setApplicationMenu(null)`（去掉窗口顶部的 File / Edit / View / Window / Help 菜单栏；Windows 上复制、粘贴、撤销、全选这些编辑快捷键由 Chromium 自己处理，不受影响）和 `installThemeBackgroundSync()`。
- 11 第 1 节这一行的“由谁做”已改为 WP-20；`app.onSystemThemeChanged` 不需要（渲染进程用 `matchMedia` 就能收到变化），11 里已删除。

### 2.6 主题文件

- 把 `docs/blueprint/design/mobai/theme/` 的 9 个文件（`tokens.css`、`base.css`、`shell.css`、`page.css`、`editor.css`、`overlays.css`、`views.css`、`database.css`、`index.css`）原样复制到 `src/ui/themes/mobai/`。用 PowerShell：

  ```powershell
  New-Item -ItemType Directory -Force -Path src/ui/themes/mobai | Out-Null
  Copy-Item -Path docs/blueprint/design/mobai/theme/*.css -Destination src/ui/themes/mobai/
  ```

- `src/main.jsx` 的导入顺序（从上到下；WP-03 加的 `@fontsource/dm-sans` 几行保持不动）：`./ui/theme-tokens.css`（步骤 2 工具加的，必须在最前面）……现有的全部 CSS……`./ui/product-system.css`，然后**紧接着**这三行：

  ```js
  import "@fontsource-variable/noto-sans-sc";
  import "@fontsource-variable/noto-serif-sc";
  import "./ui/themes/mobai/index.css";
  ```

## 3. 范围

### 必做

2.1–2.6 全部；单元测试；浏览器场景；桌面端到端；视觉对照图。

### 不做

- 设置对话框、默认字体、启动页（WP-17）；钛白（以后）；任何新界面（各自的 WP 按 12 做）。
- 删除旧 CSS 里没用的规则（以后单独整理）。

## 4. 执行步骤

### 步骤 0：开工准备【停止点】

按执行手册 3.1 节开工（分支 `wp/20-mobai-theme`），生成报告骨架，跑基线：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-20/step0-npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-20/step0-browser.log npm run test:parity:browser
```

在报告第 1 节回答理解题：

1. 白天还是夜间，由 `<html>` 上的哪个属性决定？“墨白”这个风格又由哪个属性决定？以后加“钛白”要改哪些地方？
2. `src/ui/themes/mobai/` 里哪些文件不能改？如果装上以后某个界面看起来不对，你应该怎么做？
3. 为什么步骤 2 必须在步骤 4 之前？
4. 用户把偏好设成“跟随系统”，Windows 从白天切到夜间，界面会怎样变化？桌面版是靠什么知道的？

提交 `WP-20: step 0 understanding`，运行 `node docs/blueprint/tools/wp-check.mjs WP-20 --until 0`，退出码 0 → **停止**。

### 步骤 1：字体依赖

```powershell
npm install --save-dev --save-exact @fontsource-variable/noto-sans-sc@5.3.1 @fontsource-variable/noto-serif-sc@5.3.1
node docs/blueprint/tools/run-logged.mjs .qa/WP-20/step1-npm-ls.log npm ls @fontsource-variable/noto-sans-sc @fontsource-variable/noto-serif-sc
```

`package.json` 的 `devDependencies` 里出现这两个包、版本没有 `^`；`dependencies` 不变。提交 `WP-20: add noto sans and serif font packages`。

### 步骤 2：颜色变量化

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-20/theme-tokens-dry-run.log node docs/blueprint/tools/theme-tokens.mjs --report .qa/WP-20/theme-tokens-report.md
node docs/blueprint/tools/run-logged.mjs .qa/WP-20/theme-tokens-write.log node docs/blueprint/tools/theme-tokens.mjs --write --report .qa/WP-20/theme-tokens-report.md
node docs/blueprint/tools/run-logged.mjs .qa/WP-20/theme-tokens-recheck.log node docs/blueprint/tools/theme-tokens.mjs --report .qa/WP-20/theme-tokens-recheck.md
```

期望：第二条 `leftovers=0`；第三条 `replaced=0`。工具只改 CSS、生成 `src/ui/theme-tokens.css`，**不会**改 `main.jsx`：你自己在 `src/main.jsx` 的第一行加 `import "./ui/theme-tokens.css";`（它必须在所有 CSS 导入之前）。然后：

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-20/step2-npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-20/step2-browser.log npm run test:parity:browser
```

都通过（这一步还没有墨白，界面和原来一样是深色）。提交 `WP-20: replace hard coded colors with theme variables`（包括 `src/ui/theme-tokens.css` 和被改写的 CSS）。

### 步骤 3：主题偏好与切换

按 2.1–2.5 节实现。新建 `tests/theme.test.mjs`：

- `theme preference resolves with the system setting`：`resolveTheme("system", true)` → `"dark"`；`("system", false)` → `"light"`；`("light", true)` → `"light"`；`("dark", false)` → `"dark"`。
- `unknown preferences fall back to system`：`normalizeThemePreference("blue")`、`normalizeThemePreference(undefined)` → `"system"`；`resolveTheme("blue", true)` → `"dark"`。
- `the toggle cycles system light dark`：`nextThemePreference("system")` → `"light"`，`("light")` → `"dark"`，`("dark")` → `"system"`。
- `applyTheme sets the style and the mode`：`const root = { dataset: {} }; applyTheme("dark", root)` → `root.dataset.style === "mobai"`、`root.dataset.theme === "dark"`；`applyTheme("weird", root, "unknown")` → `"mobai"`、`"light"`。
- `the cached preference survives bad storage`：传入 `getItem` 抛错的假 storage → `readCachedPreference` 返回 `"system"`；`writeCachedPreference("dark", 假storage)` 不抛错；正常的假 storage 写入后读出 `"dark"`。
- `preferences get the theme default`：`normalizeLoadedWorkspace(fullWorkspace(), { fallbackWorkspace: fullWorkspace(), now: FIXTURE_TIME })`（夹具的 `ui` 里没有 `preferences`）的结果 `ui.preferences.theme === "system"`；先把输入的 `ui.preferences` 设成 `{ theme: "dark" }` 再规范化，结果仍是 `"dark"`；设成 `{ theme: "blue" }` 时结果是 `"system"`。补默认值的代码写在 `normalizeLoadedWorkspace` 返回之前（只补 `ui.preferences.theme` 这一个字段，`ui` 的其他字段原样保留）。

提交 `WP-20: theme preference and toggle`。

### 步骤 4：装上墨白主题

按 2.6 节复制 9 个文件、改 `main.jsx` 的导入。新建 `tests/theme-files.test.mjs`：

- `mobai theme files are copied verbatim`：`tokens.css`、`base.css`、`shell.css`、`page.css`、`editor.css`、`overlays.css`、`views.css`、`database.css` 这 8 个文件，`src/ui/themes/mobai/<文件>` 与 `docs/blueprint/design/mobai/theme/<文件>` 的字节完全相同。
- `the mobai entry imports every part in order`：`src/ui/themes/mobai/index.css` 里 `@import` 行的前 8 行，依次是蓝图 `index.css` 里的 8 行（以后的 WP 只能在后面追加）。
- `main.jsx loads the theme after the other stylesheets`：在 `src/main.jsx` 的文字里，`./ui/theme-tokens.css` 的位置最靠前；`./ui/product-system.css` 的位置 < `@fontsource-variable/noto-sans-sc` < `@fontsource-variable/noto-serif-sc` < `./ui/themes/mobai/index.css`；`applyTheme(` 出现在 `createRoot(` 之前。
- `no online fonts remain`：`src/` 下全部 `.js`、`.jsx`、`.css`、`index.html` 里没有 `fonts.googleapis.com`、`fonts.gstatic.com`。

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-20/step4-npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-20/step4-browser.log npm run test:parity:browser
```

现有场景全部通过（它们不检查颜色；如果某个场景按文字或角色找元素失败，说明你改了组件结构，回去对照 2.4 节）。提交 `WP-20: install the mobai theme`。

### 步骤 5：浏览器场景

新建 `tests/browser/wp20-mobai.mjs`，开头照抄：

```js
import fs from "node:fs";
import { browserScenario } from "./harness.mjs";
import { fullWorkspace } from "../fixtures/full-workspace.mjs";

const sample = JSON.parse(fs.readFileSync("docs/blueprint/design/mobai/sample-page.json", "utf8"));
function mobaiWorkspace() {
  const workspace = fullWorkspace();
  const base = workspace.pages.find((page) => page.id === "p-a1");
  workspace.pages.push({ ...structuredClone(base), id: "p-mobai-sample", title: sample.title, icon: sample.icon, cover: null, sortIndex: 5, content: sample.blocks });
  return workspace;
}
const rgb = (page, selector, property) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [selector, property]);
```

最后一行是 `}, { workspace: mobaiWorkspace(), viewport: { width: 1440, height: 900 } });`。场景里打开页面的写法：`await page.locator(".workspace-tree-row", { hasText: 标题 }).first().click(); await page.waitForTimeout(1600);`。检查项（标题照抄）：

1. `Mobai is applied before the first render`：`page.emulateMedia({ colorScheme: "light" })` 后刷新 → `document.documentElement.dataset.style === "mobai"`、`dataset.theme === "light"`；`saved().ui.preferences.theme === "system"`（没有就是默认值，也算通过）。
2. `Fonts come from the bundled packages`：打开“电化学复习提纲”；`await page.evaluate(() => document.fonts.ready)`；`.page-title-input` 的 `fontFamily` 以 `"Segoe UI Variable Text"` 开头、`fontSize` 是 `40px`、`fontWeight` 是 `700`；`.life-editor .bn-editor` 的 `fontFamily` 以 `"Segoe UI Variable Text"` 开头、`fontSize` 是 `16px`、`lineHeight` 是 `24px`；`document.fonts.check('700 40px "Noto Sans SC Variable"', "电化学")` 为 `true`；整个场景里 `page.on("request")` 记录的地址没有一个包含 `fonts.googleapis.com` 或 `fonts.gstatic.com`。
3. `Light colors match the palette`：`.workspace-sidebar` 的 `backgroundColor` 是 `rgb(247, 247, 245)`；`.workspace-scroll` 是 `rgb(255, 255, 255)`；`.page-title-input` 的 `color` 是 `rgb(55, 53, 47)`；`.bn-container` 的 `data-color-scheme` 是 `light`。
4. `Dark colors match the palette`：`page.emulateMedia({ colorScheme: "dark" })` → 等 `dataset.theme === "dark"` → `.workspace-sidebar` `rgb(32, 32, 32)`；`.workspace-scroll` `rgb(25, 25, 25)`；`.page-title-input` 的 `color` `rgb(212, 212, 212)`；`.bn-container` 的 `data-color-scheme` 是 `dark`。
5. `The theme toggle cycles and persists`：`emulateMedia` 设回 `light`；点 `aria-label="切换白天/夜间"` 的按钮 → `title` 是“外观：白天”、`dataset.theme === "light"`；再点 → “外观：夜间”、`"dark"`；刷新后仍是 `"dark"`，`saved().ui.preferences.theme === "dark"`；再点 → “外观：跟随系统”。
6. `System mode follows the computer`：偏好为“跟随系统”时，`emulateMedia({ colorScheme: "dark" })` → `"dark"`；`emulateMedia({ colorScheme: "light" })` → `"light"`；不需要刷新。

截图（检查 6 之后，偏好保持“跟随系统”，分别在 `emulateMedia` 为 `light` 和 `dark` 时各做一遍，`<模式>` 是 `light` 或 `dark`）：

| 截图标签 | 操作 |
| --- | --- |
| `sample-page-<模式>` | 打开“电化学复习提纲” |
| `sample-page-lower-<模式>` | `.workspace-scroll` 滚到 620（`el.scrollTo(0, 620)`），等 400 ms；截完滚回 0 |
| `page-menu-<模式>` | 点 `.header-actions` 里最后一个按钮（页面操作菜单）；截完按 `Escape`，再点一下页面空白处 |
| `inline-db-<模式>` | 打开“B 笔记” |
| `folder-<模式>` | 点侧栏文件夹行“A 项目”（`.tree-folder-row`） |
| `search-<模式>` | `Ctrl+K`，输入“电化学”，等 500 ms；截完 `Escape` |
| `home-<模式>` | 点侧栏“Home” |
| `trash-<模式>` | 点侧栏“回收站” |
| `prompt-<模式>` | 打开“电化学复习提纲”，点标注块的图标按钮（`.life-callout-icon`）→ 出现产品输入框（WP-03）；截完按 `Escape` |

加入场景列表，单独运行：

```powershell
$env:PARITY_ONLY = "wp20-mobai"
node docs/blueprint/tools/run-logged.mjs .qa/WP-20/browser-wp20.log npm run test:parity:browser
Remove-Item Env:PARITY_ONLY
```

通过后提交 `WP-20: mobai browser scenario`。

### 步骤 6：视觉对照【停止点】

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-20/compare.log node docs/blueprint/tools/compare-shots.mjs docs/blueprint/design/mobai/product-shots .qa --prefix wp20-mobai- --out .qa/WP-20/compare
```

工具为 16 张参照图各生成一张并排对照图（左参照、右实际、下面红色差异图）和 `.qa/WP-20/compare/summary.md`。把 `summary.md` 的表格复制进报告第 3 节。差异占比超过 10% 的画面，在报告第 7 节逐条写出画面名和你看到的不同之处（例如“侧栏多了一行”），**不要改主题文件去追参照图**。`prompt-*` 没有参照图，正常。

报告第 0 节步骤 1–6 标为“完成”，提交 `WP-20: visual comparison`，运行 `node docs/blueprint/tools/wp-check.mjs WP-20 --until 6`，退出码 0 → **停止**。用户会请总设计师看对照图；有意见时按返工清单改。

### 步骤 7：桌面端到端

新建 `tests/desktop/theme.e2e.mjs`（每个用例：临时数据目录 → `launchApp({ dataRoot })` → 最后 `assertNoNetworkAndErrors`）：

- `bundled fonts load under the desktop csp`：打开任意页面，`document.fonts.ready` 后 `document.fonts.check('700 40px "Noto Sans SC Variable"', "电")` 为 `true`；`.page-title-input` 的字体以 `"Segoe UI Variable Text"` 开头；控制台没有包含 `font-src` 的错误（由 `assertNoNetworkAndErrors` 检查）。截图 `.qa/WP-20/desktop-light.png`。
- `the theme preference sets the native theme source`：点三次切换按钮，每次之后 `handle.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)` 依次是 `"light"`、`"dark"`、`"system"`；为 `"dark"` 时截图 `.qa/WP-20/desktop-dark.png`。
- `windows have no menu bar and follow the mode background`：`handle.app.evaluate(({ Menu }) => Menu.getApplicationMenu())` 是 `null`；点一次切换按钮（白天）后 `handle.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor().toLowerCase())` 是 `"#ffffff"`；再点一次（夜间）后是 `"#191919"`。

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-20/build.log npm run build
node docs/blueprint/tools/run-logged.mjs .qa/WP-20/desktop-build-test.log npm run desktop:build:test
node docs/blueprint/tools/run-logged.mjs .qa/WP-20/desktop-e2e.log npm run test:e2e:desktop
```

全部通过后提交 `WP-20: desktop theme tests`。

### 步骤 8：收尾【停止点】

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-20/npm-test.log npm test
node docs/blueprint/tools/run-logged.mjs .qa/WP-20/browser-all.log npm run test:parity:browser
```

填完报告；第 0 节全部“完成”；提交 `WP-20: complete report`；运行 `node docs/blueprint/tools/wp-check.mjs WP-20 --browser --desktop`，退出码 0 或 2 → 停止。

## 5. 验收标准

| 编号 | 标准 | 证据 |
| --- | --- | --- |
| AC-20-1 | 两个字体包装在 devDependencies、版本精确；不再有在线字体 | `.qa/WP-20/step1-npm-ls.log`；「no online fonts remain」 |
| AC-20-2 | 旧 CSS 的颜色全部换成变量，换算后现有测试和场景全部通过 | `.qa/WP-20/theme-tokens-recheck.log`；`.qa/WP-20/step2-browser.log` |
| AC-20-3 | 主题偏好：三种取值、默认跟随系统、缓存、切换按钮循环、重启后保持 | `tests/theme.test.mjs`；场景检查 1、5、6 |
| AC-20-4 | 墨白主题文件与蓝图逐字节相同，导入顺序正确，第一次渲染前就应用 | `tests/theme-files.test.mjs` |
| AC-20-5 | 白天和夜间的字体、颜色与 12 第 3、4 节一致；编辑器跟随模式 | 场景检查 2、3、4 |
| AC-20-6 | 桌面版：字体在 CSP 下加载；偏好会设置 `nativeTheme.themeSource`；没有菜单栏，窗口底色跟随模式 | 「bundled fonts load under the desktop csp」；「the theme preference sets the native theme source」；「windows have no menu bar and follow the mode background」 |
| AC-20-7 | 16 张参照图都有对照图；差异超过 10% 的画面在报告第 7 节逐条说明 | `.qa/WP-20/compare/summary.md`；报告第 3、7 节 |
| AC-20-8 | 截图：9 个画面 × 白天/夜间，桌面白天/夜间 | `.qa/wp20-mobai-*.png`；`.qa/WP-20/desktop-light.png`；`.qa/WP-20/desktop-dark.png` |
| AC-20-9 | G1–G9 | `.qa/WP-20/wp-check.md` |

## 6. 卡点处理

| 情况 | 做法 |
| --- | --- |
| 某个界面装上主题后明显不对（文字看不清、元素重叠） | 不要改主题文件；截图放 `.qa/WP-20/`，在报告第 7 节写清界面和步骤，继续往下做，到停止点时由总设计师处理 |
| `theme-tokens.mjs --write` 报 `leftovers` 不为 0 | 打开报告看是哪几处，照报告说明加 `theme-keep` 注释或改成工具认识的写法后重跑；不要改工具 |
| `document.fonts.check` 为 `false` | 先确认 `main.jsx` 导入了两个 `@fontsource-variable` 包、`npm run build` 后 `dist/client/assets/` 里有 `noto-sans-sc-*.woff2`；场景里先 `await page.evaluate(() => document.fonts.ready)` 再检查 |
| 颜色检查差 1（例如 `rgb(25, 25, 25)` 实际是 `rgb(25, 25, 26)`） | 说明有别的样式覆盖了主题；用开发者工具找到是哪条规则，写进报告第 7 节，不要改断言 |
| `BlockNoteView` 切换模式后编辑器内容消失或重新加载 | 只改 `theme` 这一个 prop，不要给 `BlockNoteView` 加 `key` |
| 对照图差异很大，但看起来一样（例如只差时间文字） | 照实写进报告第 7 节，总设计师会判断 |
