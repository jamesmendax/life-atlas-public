# Life Atlas 官方市集

官网是可独立分发的静态目录。用户可以直接按页面模板和组件浏览、预览和下载，下载的 `.atlaspack` 可交给 Life Atlas 桌面端导入。官网在本地打开也可浏览和下载。

匿名下载、作者投稿、维护者审批、下架操作及 GitHub Pages 配置见[市集作品投稿与审核](CONTRIBUTING.md)。

## 源码

- `site/` 提供网页。发布脚本会复制应用当前的墨白主题和图标。
- `official/focus-study/` 是原创「专注学习页」正文和笔记本插图。插图随包携带。
- 九个官方小组件各生成一个 API v2 包。每包拥有自己的 UI、样式、所用资源和依赖许可。足迹地图、旅行路网及番茄钟音频分别跟随使用它们的作品。`widget-ui/entry.jsx` 提供 React 作者使用的 `mountWidget(Component)`。
- `community/approved.json` 枚举维护者采纳的社区作品。独立发布包可以提供自己的 `ui.js`、`ui.css` 和 `assets/`。官网展示作品介绍和可用的缩略图。桌面应用的组件沙箱在作品获准使用后加载对应签名包。

### Dot 的四个组件

1.3.4 起可在市集获取「决策复盘」「明账 · 收支与储蓄」「手绘白板」和「Carbon 代码卡片」。它们按编辑器中的组件块保存内容，继承每块 1 MiB 的状态上限。Excalidraw 采用交接中的基础版，大图可通过菜单中的「可编辑备份文本」保留可重新打开的 JSON。Carbon 的设置面提供 PNG 预览和 SVG 文本。

四项的发布输入在 `community/dot-*/`，各包的 `assets/attribution.md` 记录原始交付文件 SHA-256。Excalidraw 和 Carbon 附带第三方许可、字体及版权说明。需要从 2026-11-25 原始交接重建这些输入时，用安装了 Beautiful Soup、FontTools 和 Brotli 的 Python 运行 `python -X utf8 scripts/dot-widgets/build.py "<交接目录>"`。脚本先核对交接中的两份 SHA-256 清单，并使用本仓库已安装的 esbuild。日常签名直接使用准备好的目录。

## 生成分发目录

在安装仓库锁定依赖后，从项目根运行构建。签名需要发布者提供 Ed25519 私钥，工具从标准输入、`LIFE_ATLAS_MARKET_SIGNING_KEY` 环境变量，或 `--signing-key <文件路径>` 读取 PEM。以下 PowerShell 示例假定保护私钥的系统已经把 PEM 交给当前进程。

```powershell
$marketSigningPem | node scripts/market-build.mjs --key-stdin --output .\market-stage-1.3.1
```

在 Windows 上也可以用 PowerShell 7 运行 `scripts/market-sign-windows.ps1`，将 `-SigningDirectory` 指向源码目录之外的密钥目录。首次初始化使用 `-Initialize`，之后复用同一目录中的 DPAPI 文件。

使用 `--output <新目录>` 指定本地分发树，父目录须已存在。构建完成后才会出现目标目录。内置历史基准为 `market/public/`。后续发布可用 `--prior <上一版完整分发目录>` 继承所有已发版本。Windows 签名包装器可用 `-OutputDirectory` 指向全新的路径。

- `index.html` 是官网入口。`catalog-v2.json` 是新桌面目录，`catalog.json` 保留旧桌面目录及其原始字节。网页的 `catalog-data.js` 仅包含新目录元数据，供从本地文件打开的网站使用。
- `packages/` 为每个作品生成一份 `.atlaspack`。每个包都对原始 `manifest.json` 字节做 Ed25519 签名，清单记录内容的大小与 SHA-256，目录记录包的大小与 SHA-256。
- 新目录使用最长边 640 像素、每张至多 80 KiB 的 PNG 缩略图。若缩略图与任一当前或历史签名包内的 PNG 字节相同，构建会缩小图片。极小图片无法再缩小时仅展示作品介绍。相同的缩略图跨条目和版本共用地址。旧版图片地址继续保留，桌面回退到旧目录时用本机图标展示作品。模板正文、原图、逐件 UI、地图数据和音频位于 `packages/` 的签名包内。网页浏览时按需读取卡片图片，点击下载后才获取包。
- `trusted-keys.json` 只有发布公钥。在桌面应用构建时将可信来源的版本纳入信任配置。线上目录仅用于分发。
- 已安装组件可以随工作区备份还原。轮换发布密钥时，新客户端要保留已发行包所用的信任公钥，并继续通过兼容样本测试。

构建会继承历史目录的发布公钥，校验并保留旧版本包的原始字节与路径。同版本的内容发生变更时，构建会提示提高作品版本。分发新的发布密钥前，先通过可信桌面更新交付其公钥。桌面发行只需从审核过的本地分发树取 `catalog.json`、`catalog-v2.json`、`trusted-keys.json` 三份轻量文件。包和预览由公开分发树提供。

验证命令使用进程内生成的临时密钥检查打包、签名、目录和计时逻辑。

```powershell
node --test tests/market-official-release.test.mjs tests/market-package.test.mjs tests/market-submission.test.mjs
```
