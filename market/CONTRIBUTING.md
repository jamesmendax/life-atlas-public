# 市集作品投稿与审核

Life Atlas 的模板和小组件共用一个公开目录。下载作品无需注册。作者保留署名，维护者审核每个上架版本，桌面端依据随应用提供的公钥验签。

## 获取作品

- 桌面端打开市集即可浏览介绍与缩略图。选择作品，点「下载模板」或「下载组件」，验签后就能「使用模板」或「插入组件」。这个操作只下载所选作品及它自带的资源。在「已下载」里能查看占用、移除下载；重新下载同一版本后，页面上的组件可继续读取已有记录。
- 也可以从公开仓库选择一个 `.atlaspack`，点 **Download raw file**，在桌面市集选「导入本地包」。下载整个仓库后，直接打开 `market/public/index.html` 即可离线浏览随附作品。[公开下载目录](https://github.com/jamesmendax/life-atlas-public/tree/main/market/public/packages)

## 我要投稿

1. 在桌面或网页市集选「投稿作品」，登录 GitHub，写明作品名称、用途、试用步骤、公开署名、版本和素材许可。[打开投稿表单](https://github.com/jamesmendax/life-atlas-public/issues/new?template=market-submission.yml)
2. 在「上传作品源文件 ZIP」选择文件或拖入单个 ZIP（最大 25 MB），也可在下一栏粘贴具体提交的公开链接。在「上传效果预览 PNG」附上使用演示数据的截图（不超过 2 MiB）。GitHub 会在选择附件时上传文件。[GitHub 表单上传说明](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema#upload)
3. 确认许可后点「Create」。打开带编号的 Issue 即表示已提交，可以在评论中补充材料和查看审核结论。维护者试用并签名发布后会回复下载链接。

## 问题反馈与功能建议

在桌面或网页市集选「问题反馈」，或在仓库 Issues 页选「New issue → 问题反馈与功能建议」。填写版本、操作、实际与预期结果，可附演示截图；每个问题单独提交，在同一个 Issue 跟进回复。[填写反馈表](https://github.com/jamesmendax/life-atlas-public/issues/new?template=feedback.yml) · [查找已有反馈](https://github.com/jamesmendax/life-atlas-public/issues)

## 准备投稿材料

| 作品 | 交给维护者的材料 | 可参照的作品 |
| --- | --- | --- |
| 页面模板 | `template.json` 和正文用到的 `assets/` 下的 PNG。若只做好了文字和插图，可附内容稿并申请协助转换。 | [专注学习页源文件](official/focus-study/) |
| 小组件 | 富交互组件交付一个预构建的经典脚本 `ui.js`、可选的 `ui.css`、所需的 `assets/`、可供审阅的源代码和预览 PNG。旧式 API v1 作品仍可提供 `component.js`。 | [富组件 SDK](widget-ui/entry.jsx) · [v1 示例](official/habit-heatmap/component.js) |

可以把上述源文件打成 ZIP，或提供固定提交的公开源码链接。熟悉 Git 的作者可在自己的 fork 里新增 `market/submissions/<作者>-<作品>/`，开启 pull request 并关联投稿 Issue。更新作品时沿用原 ID，说明新版带来的变化以及旧数据能否继续使用。请只上传单件作品需要的内容。个人工作区备份、网盘凭据和发布私钥均应保留在本机。

作者可为原创脚本选择 MIT 等软件许可，为原创文本或图像选择 CC BY 4.0 等内容许可。逐项列出非原创素材的来源、许可文本和署名要求。富组件可在 `assets/licenses/` 内携带许可原文。模板与 v1 组件的署名写在作品正文或脚本内，完整清单可随源文件提交为 `LICENSE` 或 `ATTRIBUTION.md`。项目本身的整体许可证由权利人另行选定。[GitHub 关于仓库许可证](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)

富组件从 Life Atlas 1.3.1 起可用。发布目录里只放网页可执行的单个 IIFE 脚本、样式和数据。作者可以使用共享 React SDK，或按相同宿主协议提供独立界面。PNG、JPEG、WebP、GIF、WAV、MP3、Ogg、WOFF2、JSON、GeoJSON 和纯文本许可证可放进 `assets/`。压缩包上限 16 MiB，展开上限 64 MiB，最多 256 项。脚本上限 8 MiB，样式上限 1 MiB。涉及宿主能力时，作者在 Issue 说明用途，维护者单独审核。只有进入正式签名清单的能力才随包生效。普通社区组件默认获得空权限列表。

## 我来审核

1. **收件。** 在 Issue 回复「待审核」，记下源文件的提交号或 ZIP 的 SHA-256。核对署名、许可、素材出处、作品 ID、版本和截图。涉及个人资料或授权不清时请作者换演示数据或补充来源。
2. **检查格式。** 在维护者可信的项目检出中安装锁定的依赖。把作者提供的发布载荷放在单独目录，按类型运行下方命令。工具限制路径和大小，以一次性测试密钥调用正式包读取器，检查模板区块、富组件文件类别、包内资源和完整性。组件脚本只做语法解析。对照可审阅源码和编译来源后，再进入试用。
3. **试用。** 使用独立测试工作区和测试签名验证作品。模板要查看插图、文本和重复实例化，再编辑一份，确认另一份不受影响。组件在桌面沙箱操作主要按钮、关闭重开并核对状态。检查深浅色、最小窗口宽度、最低声明版本和一次备份恢复。旅行路线和自选铃声等宿主能力须再核对签名权限和用户交互。
4. **给结论。** 在 Issue 写明「请补充」「退回」或「审核通过」，给出原因、所测版本及对应提交。新提交重审差异。作者和公开许可进入正式作品的源目录，发布记录保留作品 ID、版本、审核链接和包摘要。
5. **发布。** 维护者把通过审核的源文件放入 `market/community/<作品目录>/`，在准入名单中增加下例这样的记录。使用受维护者控制的正式密钥和以往版本的可信公钥生成新的分发目录，核对网页预览和桌面验签后发布。已发布的同一 ID 和版本保留原始包字节。内容有变化就提高版本号。作者、许可会进入签名包的说明，发布后把下载链接回贴到投稿 Issue。[准入名单](community/approved.json) · [签名与构建](README.md)

例如，作者「小林」的周复盘模板可放在 `market/community/xiaolin-weekly/`，同目录放一张不超过 2 MiB 的 `preview.png`。维护者将以下对象添加到 `approved.json` 数组。富组件改用 `"type": "component"`、`"minAppVersion": "1.3.1"` 并提供 `ui.js`。每个 ID 在当前目录只列一个推荐版本。

```json
{
  "id": "community.xiaolin.weekly",
  "type": "template",
  "title": "周复盘",
  "description": "按本周进展、障碍和下周计划整理笔记。",
  "version": "1.0.0",
  "minAppVersion": "1.1.0",
  "author": "小林",
  "license": "CC BY 4.0",
  "source": "xiaolin-weekly",
  "preview": "preview.png"
}
```

```sh
node market/check-submission.mjs template ./作品源目录
node market/check-submission.mjs component ./作品源目录
```

只需运行作品类型对应的一条。模板和 v1 组件样例目录分别为 `market/official/focus-study` 和 `market/official/habit-heatmap`。正式签名由维护者在独立的发布步骤完成。审查预构建的社区载荷时保持发布环境隔离，作者提供的安装命令或构建命令应单独审阅。

## 仓库设置与费用

- **投稿与反馈。** 启用仓库 Issues，将 `.github/ISSUE_TEMPLATE/` 中的投稿与反馈表单放入公开仓库的默认分支。GitHub 账户用于上传、提交和跟踪回复。[GitHub Issue 表单](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository)
- **审批。** 在公开仓库保护默认分支，要求 PR 通过指定检查和维护者批准，新提交使旧批准失效。用 `CODEOWNERS` 把市集源码、签名工具、公钥、发布工作流和规则本身交给指定维护者。外部作者开 PR 时你可直接审核；若你是唯一维护者，先确定第二位审核人，再对自己发起的 PR 启用强制独立审批。这些开关和人员配置需在实际仓库设置。[保护分支](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) · [CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
- **网站。** 现有公开仓库可以同时托管作品源码、审核记录和静态市集。维护者在 Settings → Pages 选 GitHub Actions，在 Actions 中运行 **Publish official market**，输入审核提交对应的应用版本。部署后匿名打开首页、目录及至少一个包，并从桌面验签。GitHub Free 支持公开仓库 Pages、分支保护和标准托管运行器。使用默认域名即可起步；Pages 站点上限 1 GB，每月流量软上限 100 GB。若将来把大包转移到 GitHub Releases，需要同步调整桌面端允许的下载来源，并保留验签。[Pages 与计划](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) · [Pages 限额](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) · [Actions 计费](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

## 下架与版本

在 Issue 标明原因、受影响版本和替代版本，从 `community/approved.json` 移除作品并发布下一版目录，即可停止推荐。普通下架会保留旧版本的下载地址，已经生成的模板页面仍归用户。

版权或安全问题需要停止下载时，维护者须单独处理发布端对应路径，并同步调整历史归档策略，避免后续构建再次收录该文件。发布公告应列出包摘要和用户端移除方法。既有安装、用户备份和历史 Git 提交仍可能含有旧包。现有客户端支持本地验签，远程撤回某个已签名哈希仍待实现。
