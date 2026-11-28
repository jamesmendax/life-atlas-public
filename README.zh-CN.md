# Life Atlas

[English](./README.md) | [日本語](./README.ja.md) | 简体中文

Life Atlas 是本地优先的 Windows 个人工作区。可以用页面和数据库整理资料，将账号和文件放进加密密钥库，使用离线识图提取图片上的中文、日文或英文文字。右下角的 AI 助手可以连接用户选定的模型服务。

## `1.7.0` 主要更新

- **四国五区域多语言支持（`zh-CN` / `zh-SG` / `ja-JP` / `en-SG` / `en-US`）** — 完整覆盖主工作区、密钥库、首次向导与 Markdown 预览四套窗口、原生系统菜单与对话框、本地化日期/数字/星期格式、CJK/Latin 字体适配，以及多语言 NSIS Windows 安装包。
- **页面与 11 种数据库视图** — 支持公式三元条件、关联库公式与汇总、周期任务、可编辑记录的数据库按钮、折算金额属性、万行虚拟化表格与街道级离线地图。
- **全宽加密密钥库（`Argon2id` + `AES-256-GCM`）** — 支持全宽双栏布局、加密斜杠（`/`）富文本备注、加密附件及完整数据迁移保留。
- **官方市集与离线沙箱** — 支持在网页与桌面端按作品下载独立签名 `.atlaspack` 包（专注学习页、番茄钟、足迹点亮地图（含中国 477 地区、日本 47 都道府县、世界 176 国家/地区）、习惯打卡热力图、旅行日程时间轴与登机牌、智能打包清单、世界时钟、人生进度倒计时、白噪音混音器、闪卡摘录、手绘白板、Carbon 代码卡片、决策复盘与明账）。
- **网盘目录加密备份** — 可在 OneDrive 或 Google Drive 同步文件夹写入定期 `.lifeatlas` 加密备份。

[Windows 发行版](https://github.com/jamesmendax/life-atlas-public/releases/latest) · [在线市集](https://jamesmendax.github.io/life-atlas-public/market/)

## 下载与从旧版升级

Windows x64 用户可在 [最新发行页](https://github.com/jamesmendax/life-atlas-public/releases/latest) 下载完整安装程序、`SHA256SUMS.txt`、`.blockmap` 与 `THIRD_PARTY_NOTICES.md`。

1. 退出旧程序后运行新安装包。使用同一 Windows 账户时，程序通常沿用原数据目录。
2. 升级前可在「备份与恢复… → 完整备份」导出一份 `.lifeatlas` 并校验（如需密钥库请勾选「包含密钥库」）。
3. 若出现首次启动向导，选择原数据目录并点击「打开这个工作区」。[使用手册](./docs/用户手册.md) · [网盘备份说明](./docs/云盘备份.md)

## 官方市集

在桌面端侧栏打开「模板 → 官方市集」或访问 [在线市集](https://jamesmendax.github.io/life-atlas-public/market/) 浏览作品与大小并按需下载签名包。

- [在线市集](https://jamesmendax.github.io/life-atlas-public/market/) · [投稿作品](https://github.com/jamesmendax/life-atlas-public/issues/new?template=market-submission.yml) · [问题反馈](https://github.com/jamesmendax/life-atlas-public/issues/new?template=feedback.yml) · [投稿与审核指南](./market/CONTRIBUTING.md)

## 数据兼容性与本地开发

构建打包与 CI 都会运行 `npm run test:compatibility` 核对冻结 SQLite 工作区样本、密钥库主密码/恢复密钥及 `.lifeatlas` 加密备份恢复，详见 [`tests/fixtures/compatibility/README.md`](./tests/fixtures/compatibility/README.md)。

使用 Node.js 24 与 npm：

```powershell
npm ci
node node_modules/electron/install.js
npm run test:compatibility
npm run desktop:dev
```

离线正式构建请按 [README.md](./README.md#building-the-windows-installer) 初始化 `.harness/runtime` 缓存后执行 `npm run desktop:build`。

## 第三方组件

第三方组件及素材适用各自的许可，详见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。
