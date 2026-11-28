#!/usr/bin/env node
// Life Atlas 总设计师提供的工具。执行者（GPT）只使用，不要修改本文件；发现问题写进报告。
//
// 用法：node docs/blueprint/tools/run-logged.mjs <日志文件> <命令> [参数...]
// 例子：node docs/blueprint/tools/run-logged.mjs .qa/WP-01/npm-test.log npm test
//
// 作用：
//   1. 在当前目录运行命令（请在项目根目录运行本工具）。
//   2. 命令输出同时显示在终端，并以 UTF-8（无 BOM）写入日志文件；日志所在目录不存在时自动创建。
//   3. 日志第一行记录开始时间与命令，最后一行固定为：
//        [run-logged] exit=<退出码> seconds=<耗时> command=<命令>
//   4. 本工具的退出码 = 被运行命令的退出码。
//
// 为什么需要它：Windows PowerShell 5.1 的 `>` 和 Out-File 会把日志写成 UTF-16，
// 验收工具和总设计师都无法可靠检查。所有需要留证据的命令都用本工具运行。
//
// 限制：参数里不要包含双引号 " 和百分号 %（cmd.exe 会处理它们）。

import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";

const [logPath, ...commandParts] = process.argv.slice(2);
if (!logPath || commandParts.length === 0) {
  console.error("用法：node docs/blueprint/tools/run-logged.mjs <日志文件> <命令> [参数...]");
  process.exit(64);
}
if (commandParts.some((part) => part.includes('"') || part.includes("%"))) {
  console.error("run-logged：参数里不能包含双引号或百分号。");
  process.exit(64);
}

const SAFE = /^[A-Za-z0-9_\-.,/:=@+\\]+$/;
const quote = (part) => (SAFE.test(part) ? part : `"${part}"`);
const commandLine = commandParts.map(quote).join(" ");

mkdirSync(path.dirname(path.resolve(logPath)), { recursive: true });
const log = createWriteStream(logPath, { flags: "w" });
const started = Date.now();
log.write(`[run-logged] start=${new Date(started).toISOString()} cwd=${process.cwd()} command=${commandLine}\n`);

let finished = false;
function finish(exitCode, note = "") {
  if (finished) return;
  finished = true;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const footer = `[run-logged] exit=${exitCode}${note} seconds=${seconds} command=${commandLine}\n`;
  process.stdout.write(footer);
  log.end(footer, () => process.exit(exitCode));
}

const child = spawn(commandLine, {
  shell: true,
  stdio: ["inherit", "pipe", "pipe"],
  env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  windowsHide: true,
});
child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  log.write(chunk);
});
child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
  log.write(chunk);
});
child.on("error", (error) => {
  const message = `[run-logged] 无法启动命令：${error.message}\n`;
  process.stderr.write(message);
  log.write(message);
  finish(127);
});
child.on("close", (code, signal) => {
  finish(Number.isInteger(code) ? code : 1, signal ? ` signal=${signal}` : "");
});
