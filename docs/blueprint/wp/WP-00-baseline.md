# WP-00 基线与版本控制

- 规模：S · 前置：无 · 分支：`wp/00-baseline`（基线提交直接在 `main` 上）
- 停止点：只有收尾（步骤 10）
- 必读：`README.md`、`09-执行手册.md`、`07-验收协议.md`、本文件

## 0. 一页纸

- **要做到**：项目变成一个 Git 仓库，`main` 上第一个提交就是现在磁盘上的原样文件；`npm test` 一条命令跑完全部单元测试；记录一份基线（测试数、构建、浏览器场景、旧验收报告 34/35 差异的原因）。
- **交付物**：`.gitignore`；`main` 上的基线提交；`wp/00-baseline` 分支上的 5 个小改动（删 2 个空文件、`test` 脚本、浏览器测试的关闭超时与 `PARITY_ONLY`、4 份旧文档的横幅）；报告 `docs/blueprint/reports/WP-00-report.md`；`.qa/WP-00/` 下的日志。
- **绝对不要**：在基线提交里夹带任何改动；修改 `src/`；升级或新增依赖；运行 `npm run verify:parity:delivery`；删除步骤 4 以外的任何文件；修改 `AGENTS.md` 或 `docs/blueprint/` 下的设计文档。
- **什么时候停**：步骤 10 的 wp-check 退出码为 0 或 2。

## 1. 为什么做

项目现在不是 Git 仓库，任何改坏都无法回退；旧的验收报告与当前代码对不上。后面 19 个工作包都要在可回退、可度量的基线上进行。

## 2. 已知事实（总设计师 2026-11-01 实测，你的结果应与此一致）

| 项目 | 实测值 |
| --- | --- |
| `src`、`tests`、`scripts` 三个目录的文件总哈希 | `files=104 treehash=b6193aa0d83f1f071b260ee23e860e14d50fbb1d2e3aaa9ae681903fcb2bad4e` |
| 单元测试 | 20 个文件、93 个用例，一次运行全部通过（约 1 秒） |
| 浏览器场景 | 6 个场景全部通过，共 34 项检查：phase1-database 9、phase1-editor 8、phase1-migration 2、phase2-work-surfaces 5、phase2-query-formula 5、phase3-workspace 5。偶尔会因为 Edge 关闭超过 5 秒而误报失败（步骤 6 修正） |
| 34/35 差异 | 2026-09-19 的交付清单 `.qa/core-parity-delivery-manifest.json` 里 phase1-editor 是 9 项；现在的 `tests/browser/phase1-editor.mjs` 只有 8 个 `await check(`，该文件最后修改于 2026-09-19 09:34（交付验证在 09:07）。被删掉的那一项叫什么，现存文件里没有记录 |
| 两个空文件 | 根目录的 `[k` 和 `console.log(JSON.stringify({keys`，大小都是 0 字节 |
| 系统 Git 配置 | `core.autocrlf=true`（所以仓库里必须单独设成 `false`，否则基线哈希会对不上） |

## 3. 执行步骤

### 步骤 0：开工检查（不改任何文件）

```powershell
Set-Location -LiteralPath 'C:\Projects\life-atlas'
node --version
npm --version
git --version
Test-Path -LiteralPath '.git'
node docs/blueprint/tools/tree-hash.mjs --worktree src tests scripts
```

期望：Node `v24.17.0`；npm `11.13.x`；git `2.54.x`；`Test-Path` 输出 `False`；最后一行与第 2 节表格第一行**完全相同**。

- `Test-Path` 是 `True`（已经是 Git 仓库）→ 停下报告。
- 哈希不同 → 停下报告实际输出（说明 2026-11-01 之后有人改过代码，基线需要总设计师重新确认）。

把这几条命令的输出保存下来，步骤 3 写进报告第 3 节。

### 步骤 1：备份旧的验收证据（只复制，不修改原文件）

后面的浏览器测试会覆盖 `.qa/` 里的旧结果，所以先复制一份：

```powershell
New-Item -ItemType Directory -Force -Path '.qa\WP-00\original' | Out-Null
Copy-Item -LiteralPath '.qa\core-parity-browser.json', '.qa\core-parity-delivery.json', '.qa\core-parity-delivery-manifest.json' -Destination '.qa\WP-00\original\'
Copy-Item -Path '.qa\phase*.json' -Destination '.qa\WP-00\original\'
(Get-ChildItem -LiteralPath '.qa\WP-00\original').Count
(Get-Item -LiteralPath 'tests\browser\phase1-editor.mjs').LastWriteTime.ToString('yyyy-MM-dd HH:mm')
```

期望：文件数 `13`；时间 `2026-09-19 09:34`。

### 步骤 2：建立仓库与基线提交

1. 在项目根目录新建 `.gitignore`，内容**正好**是下面 8 行：

   ```text
   node_modules/
   dist/
   release/
   .devdata/
   .visual-qa/
   .qa/
   *.log
   .staging-*/
   ```

2. 依次运行：

   ```powershell
   git init -b main
   git config user.name "Life Atlas Dev"
   git config user.email "dev@life-atlas.local"
   git config core.autocrlf false
   git add -A
   (git diff --cached --name-only | Select-String -Pattern '^(node_modules|\.visual-qa|\.qa|dist|release)/').Count
   ```

   最后一条期望输出 `0`。不是 0 → 不要提交，停下报告。

3. 提交并验证：

   ```powershell
   git commit -m "WP-00: baseline import (as found on 2026-11-01)"
   git log --oneline
   node docs/blueprint/tools/tree-hash.mjs main src tests scripts
   ```

   期望：`git log` 只有 1 行；哈希与第 2 节表格第一行完全相同。不同 → 停下报告。

这个提交里**除了新建的 `.gitignore` 以外没有任何改动**。不要先改任何文件再提交。

### 步骤 3：工作分支与报告骨架

```powershell
git switch -c wp/00-baseline
node docs/blueprint/tools/wp-check.mjs WP-00 --init-report
```

打开 `docs/blueprint/reports/WP-00-report.md`：

- 第 1 节写“我的理解”，并回答这 3 道理解题：
  1. 基线提交里允许有哪些改动？
  2. 浏览器场景失败时，你应该修复它吗？应该怎么做？
  3. 为什么不能运行 `npm run verify:parity:delivery`？
- 第 3 节贴上步骤 0、1、2 的命令输出。
- 第 0 节把步骤 0–3 改成“完成”。

```powershell
git add -A
git commit -m "WP-00: add report skeleton"
```

### 步骤 4：删除两个空文件

```powershell
Get-Item -LiteralPath '[k', 'console.log(JSON.stringify({keys' | Select-Object Name, Length
```

两个文件的 `Length` 都必须是 `0`；只要有一个不是 0，就不要删，写进报告第 6 节，跳到步骤 5。都是 0 时：

```powershell
Remove-Item -LiteralPath '[k', 'console.log(JSON.stringify({keys'
Test-Path -LiteralPath '[k'
Test-Path -LiteralPath 'console.log(JSON.stringify({keys'
```

期望两个 `False`。把删除前后的输出贴进报告第 3 节。

```powershell
git add -A
git commit -m "WP-00: remove two empty stray files"
```

### 步骤 5：一条命令跑完全部单元测试

1. 编辑 `package.json`：在 `"scripts"` 里 `"preview": "vite preview",` 这一行的下面插入一行（注意里面的 `\"` 是 JSON 的转义，照抄）：

   ```json
       "test": "node --test --test-reporter=spec \"tests/*.test.mjs\"",
   ```

   不要改动其他任何脚本和依赖。

2. 运行：

   ```powershell
   node docs/blueprint/tools/run-logged.mjs .qa/WP-00/npm-test.log npm test
   ```

   期望：用文件工具打开 `.qa/WP-00/npm-test.log`（终端里 `ℹ` 可能显示成乱码，以日志文件为准），里面有 `ℹ tests 93`、`ℹ pass 93`、`ℹ fail 0`，最后一行 `[run-logged] exit=0`。结果不同 → 不要修改任何测试，停下报告（附日志）。

```powershell
git add -A
git commit -m "WP-00: add npm test script for all unit tests"
```

### 步骤 6：浏览器测试的两个小改动

1. `tests/browser/harness.mjs`：找到这一行（用 `git grep -n "browser close" -- tests/browser/harness.mjs` 定位）：

   ```js
   await bounded(browser?.close(), 5000, "browser close").catch(...
   ```

   只把其中的 `5000` 改成 `20000`。同文件里另一处 `bounded(browser?.close(), 5000, "close")`（在 watchdog 里）**不要改**。原因：Edge 关闭偶尔超过 5 秒，会让全部检查都通过的场景被误判失败。

2. `tests/core-parity-browser.mjs`：支持环境变量 `PARITY_ONLY` 只运行指定场景。
   - 在 `const scenarios = [ … ];` 之后加入：

     ```js
     const only = (process.env.PARITY_ONLY || "").split(",").map((name) => name.trim()).filter(Boolean);
     const unknownScenarios = only.filter((name) => !scenarios.includes(name));
     if (unknownScenarios.length) throw new Error(`Unknown PARITY_ONLY scenario: ${unknownScenarios.join(", ")}`);
     const selectedScenarios = only.length ? scenarios.filter((name) => only.includes(name)) : scenarios;
     ```

   - 把 `report` 对象里的 `scenarios,` 改成 `scenarios: selectedScenarios,`。
   - 把 `for (const scenario of scenarios) {` 改成 `for (const scenario of selectedScenarios) {`。
   - 其他代码不动。

3. 验证 `PARITY_ONLY`：

   ```powershell
   $env:PARITY_ONLY = "phase1-migration"
   node docs/blueprint/tools/run-logged.mjs .qa/WP-00/parity-only.log npm run test:parity:browser
   Remove-Item Env:PARITY_ONLY
   ```

   期望：日志里只有 `PASS phase1-migration: 2 checks` 一个场景，最后一行 `exit=0`。

```powershell
git add -A
git commit -m "WP-00: raise browser close timeout and add PARITY_ONLY filter"
```

### 步骤 7：记录基线

```powershell
node docs/blueprint/tools/run-logged.mjs .qa/WP-00/build.log npm run build
node docs/blueprint/tools/run-logged.mjs .qa/WP-00/test-sites.log npm run test:sites
node docs/blueprint/tools/run-logged.mjs .qa/WP-00/browser-parity.log npm run test:parity:browser
```

期望：三个日志最后一行都是 `exit=0`；浏览器日志里有 6 行 `PASS …`，检查数与第 2 节一致。

- 浏览器场景失败：再运行一次（同一条命令，覆盖日志）。仍然失败就**不要修**，把失败的场景名和错误信息写进报告第 6、7 节，继续步骤 8。
- 构建失败：停下报告。

### 步骤 8：写出 34/35 的结论

运行下面 3 条命令确认第 2 节的事实：

```powershell
node -e "const m = require('./.qa/WP-00/original/core-parity-delivery-manifest.json'); console.log(JSON.stringify(m.browserScenarios.map((s) => [s.scenario, s.checks])))"
node -e "const b = require('./.qa/WP-00/original/core-parity-browser.json'); console.log(JSON.stringify(b.results.map((s) => [s.scenario, s.checks])))"
git grep -c "await check(" -- tests/browser/phase1-editor.mjs
```

期望：第一条里 phase1-editor 是 `9`，第二条里是 `8`，第三条输出 `tests/browser/phase1-editor.mjs:8`。

在报告第 6 节写结论（可以照这个意思写）：差异来自 phase1-editor 场景：交付清单记录 9 项，当前场景文件只有 8 个检查（文件在交付验证之后被修改过）；被删除的检查名称无法从现存文件恢复（没有版本历史，旧的 `.qa/phase1-editor.json` 已被后来的运行覆盖）；本 WP 没有修改阈值或场景。

### 步骤 9：给 4 份旧文档加横幅

在下面 4 个文件的**最前面**插入两行（第一行是横幅，第二行是空行），文件其余内容一个字都不改：

```text
> 历史文档（2026-11-01 起以 docs/blueprint/ 为准，本文仅供查阅）

```

文件：`LIFE_ATLAS_NOTION_PARITY_HANDOFF_2026-09-19.md`、`interaction-contract.md`、`CORE_PARITY_ACCEPTANCE.md`、`design-qa.md`。

```powershell
git diff --stat
```

期望：这 4 个文件各 `2 insertions(+)`，没有删除行。

```powershell
git add -A
git commit -m "WP-00: mark four legacy documents as historical"
```

### 步骤 10：收尾【停止点】

1. 把报告第 2 节每条 AC 填好（结论 + 证据位置），第 4 节逐个列出改动文件（`.gitignore` 在基线提交里，不在本分支的改动中；本分支的改动文件可以用 `git diff --name-only main...HEAD` 查看），第 5–7 节如实填写。
2. 第 0 节把所有步骤改成“完成”。
3. 提交：

   ```powershell
   git add -A
   git commit -m "WP-00: complete report"
   ```

4. 运行验收自查：

   ```powershell
   node docs/blueprint/tools/wp-check.mjs WP-00 --browser
   ```

   退出码 0 或 2 → 停止，按 `09-执行手册.md` 第 6.2 节回复。退出码 1 → 按输出修复、提交、重跑。

## 4. 范围

### 必做

第 3 节全部步骤。

### 不做

- 不改任何 `src/` 文件；不改 `tests/` 里第 3 节步骤 6 以外的内容；不改 `scripts/`。
- 不升级、不新增依赖；不运行 `npm install`、`npm audit fix`。
- **不运行** `npm run verify:parity:delivery`（它会重写 `.qa` 和验收文档）。
- 不删除第 3 节步骤 4 以外的任何文件；不清理 `.qa/`、`.visual-qa/`、`dist/`。
- 浏览器场景失败时不尝试修复。

## 5. 验收标准

| 编号 | 标准 | 证据 |
| --- | --- | --- |
| AC-00-1 | `main` 上只有 1 个提交，说明为 `WP-00: baseline import (as found on 2026-11-01)`；`tree-hash main src tests scripts` 的输出与第 2 节完全相同 | 报告第 3 节的命令输出 |
| AC-00-2 | `git ls-files` 中没有 `node_modules`、`.visual-qa`、`.qa`、`dist`、`release` 下的文件 | 表格下方那条命令输出 `0`（贴进报告第 3 节） |
| AC-00-3 | `npm test` 一条命令运行 20 个文件、93 个用例，0 失败 | `.qa/WP-00/npm-test.log` |
| AC-00-4 | `npm run build` 与 `npm run test:sites` 退出码 0 | `.qa/WP-00/build.log`、`.qa/WP-00/test-sites.log` |
| AC-00-5 | 浏览器场景结果已记录（每个场景的检查数）；34/35 差异的结论写在报告第 6 节 | `.qa/WP-00/browser-parity.log`、报告 |
| AC-00-6 | 两个 0 字节文件已删除（附删除前后的命令输出） | 报告第 3 节 |
| AC-00-7 | 4 份旧文档各增加 2 行横幅，没有其他改动 | `git diff --stat main...HEAD` 输出 |
| AC-00-8 | `harness.mjs` 只改了一个数字；`PARITY_ONLY=phase1-migration` 时只运行这一个场景 | `.qa/WP-00/parity-only.log` |
| AC-00-9 | 旧证据已复制到 `.qa/WP-00/original/`（13 个文件） | 报告第 3 节 |
| AC-00-10 | G1–G9 | `.qa/WP-00/wp-check.md` |

AC-00-2 的命令（PowerShell，照抄）：

```powershell
(git ls-files | Select-String -Pattern '^(node_modules|\.visual-qa|\.qa|dist|release)/').Count
```

## 6. 卡点处理

| 情况 | 做法 |
| --- | --- |
| 步骤 0 的哈希不一致 | 停下，报告实际输出。不要继续建仓库 |
| `git init` 报错或 `.git` 已存在 | 停下报告 |
| `npm test` 的数字和第 2 节不同 | 不要改测试；停下，附日志报告 |
| 浏览器场景连续两次失败 | 不修，记录后继续步骤 8；收尾时 wp-check 的 K9 会失败，按执行手册“同一项 3 次仍失败就停止”的规则处理 |
| 某个旧文档不存在 | 写进报告第 6 节，其余文件照做 |
