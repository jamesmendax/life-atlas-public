#!/usr/bin/env node
// Life Atlas 总设计师提供的工具。执行者（GPT）只使用，不要修改本文件。
//
// 用法：
//   node docs/blueprint/tools/tree-hash.mjs <git 引用> <目录...>     例：node docs/blueprint/tools/tree-hash.mjs main src tests scripts
//   node docs/blueprint/tools/tree-hash.mjs --worktree <目录...>      计算磁盘上当前文件
//
// 输出一行：files=<文件数> treehash=<64 位十六进制>
// 计算方法：对每个文件（路径用正斜杠，按路径排序）拼接 “路径\0内容的SHA-256\n”，再整体求 SHA-256。
// Git 引用模式读取 Git 对象里的原始字节（仓库必须设置 core.autocrlf=false，WP-00 会设置）。

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const [source, ...dirs] = process.argv.slice(2);
if (!source || !dirs.length) {
  console.error("用法：node docs/blueprint/tools/tree-hash.mjs <git 引用 | --worktree> <目录...>");
  process.exit(64);
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const entries = [];

if (source === "--worktree") {
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) entries.push({ file: full.split(path.sep).join("/"), hash: sha256(readFileSync(full)) });
    }
  };
  for (const directory of dirs) walk(directory);
} else {
  const listing = execFileSync("git", ["ls-tree", "-r", "-z", "--full-tree", source, "--", ...dirs], { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 });
  for (const record of listing.toString("utf8").split("\0").filter(Boolean)) {
    const tab = record.indexOf("\t");
    const [mode, type, objectId] = record.slice(0, tab).split(" ");
    if (type !== "blob" || mode === "120000") continue;
    const content = execFileSync("git", ["cat-file", "blob", objectId], { encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 });
    entries.push({ file: record.slice(tab + 1), hash: sha256(content) });
  }
}

entries.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
const total = createHash("sha256");
for (const entry of entries) total.update(`${entry.file}\0${entry.hash}\n`);
console.log(`files=${entries.length} treehash=${total.digest("hex")}`);
