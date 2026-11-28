import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { assertPhysicalPath, isPathInside } from "../electron/main/storage/dataRoot.js";
import { RUNTIME_ROOT } from "./runtime-paths.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "http://127.0.0.1:5199";
const require = createRequire(import.meta.url);

export function parseDevArguments(args) {
  if (args.length > 1 || args.length === 1 && args[0] !== "--smoke") throw Object.assign(new Error("用法：node scripts/desktop-dev.mjs [--smoke]"), { exitCode: 64 });
  return { smoke: args[0] === "--smoke" };
}

async function probeDevelopmentServer(origin) {
  const response = await fetch(origin, { signal: AbortSignal.timeout(250) });
  await response.body?.cancel();
  return response.ok;
}

function isOwnedProcessRunning(child) {
  return child && child.exitCode === null && child.signalCode === null;
}

export async function waitForOwnedDevelopmentServer(child, { origin = ORIGIN, attempts = 30, intervalMs = 300, probe = probeDevelopmentServer } = {}) {
  if (!child?.stdout || !isOwnedProcessRunning(child)) throw new Error("本次启动的开发服务已退出");
  let output = "";
  let listening = false;
  let failure;
  const inspect = (chunk) => {
    output = stripVTControlCharacters(`${output}${chunk.toString()}`).slice(-8192);
    const locals = [...output.matchAll(/(?:^|\n)\s*(?:➜\s*)?Local:\s+(\S+)/g)];
    if (locals.some((match) => match[1] === origin || match[1] === `${origin}/`)) listening = true;
  };
  const exited = () => { failure = new Error("本次启动的开发服务已退出"); };
  const failed = (error) => { failure = error; };
  child.stdout.on("data", inspect);
  child.once("exit", exited);
  child.once("error", failed);
  try {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      if (failure || !isOwnedProcessRunning(child)) throw failure || new Error("本次启动的开发服务已退出");
      if (!listening) continue;
      let ready = false;
      try { ready = await probe(origin); } catch {}
      if (failure || !isOwnedProcessRunning(child)) throw failure || new Error("本次启动的开发服务已退出");
      if (ready) return;
    }
    throw new Error(`开发服务在 ${origin} 未能就绪`);
  } finally {
    child.stdout.removeListener("data", inspect);
    child.removeListener("exit", exited);
    child.removeListener("error", failed);
  }
}

function stopOwnedProcess(child) {
  if (!isOwnedProcessRunning(child)) return;
  if (process.platform === "win32") {
    try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {}
  } else child.kill("SIGTERM");
}

async function runDevelopment(args) {
  let options;
  try { options = parseDevArguments(args); } catch (error) { console.error(error.message); return error.exitCode || 64; }
  const runtime = assertPhysicalPath(RUNTIME_ROOT);
  fs.mkdirSync(runtime, { recursive: true });
  const temp = fs.mkdtempSync(path.join(runtime, "desktop-dev-"));
  const dataRoot = assertPhysicalPath(process.env.LIFE_ATLAS_DATA_ROOT || path.join(runtime, "desktop-dev-data"), { root: runtime });
  const bootstrapDir = path.join(temp, "bootstrap");
  fs.mkdirSync(bootstrapDir);
  let vite;
  let electron;
  let stopping = false;
  const env = { ...process.env, TEMP: temp, TMP: temp, LIFE_ATLAS_DATA_ROOT: dataRoot, LIFE_ATLAS_BOOTSTRAP_DIR: bootstrapDir };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    return await new Promise((resolve) => {
      const stop = (code) => {
        if (stopping) return;
        stopping = true;
        stopOwnedProcess(electron);
        stopOwnedProcess(vite);
        resolve(Number.isInteger(code) ? code : 1);
      };
      process.once("SIGINT", () => stop(130));
      process.once("SIGTERM", () => stop(143));
      vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5199", "--strictPort"], { cwd: PROJECT_ROOT, stdio: ["inherit", "pipe", "inherit"], windowsHide: true, env });
      vite.stdout.pipe(process.stdout, { end: false });
      vite.on("error", () => stop(1));
      vite.on("exit", (code) => { if (!stopping) stop(electron?.exitCode ?? code ?? 1); });
      const waitForServer = async () => {
        await waitForOwnedDevelopmentServer(vite);
        if (stopping || !isOwnedProcessRunning(vite)) return;
        electron = spawn(require("electron"), [PROJECT_ROOT], { cwd: PROJECT_ROOT, stdio: "inherit", windowsHide: true, env: { ...env, LIFE_ATLAS_DEV_URL: ORIGIN, ...(options.smoke ? { LIFE_ATLAS_DEV_SMOKE: "1" } : {}) } });
        electron.on("error", () => stop(1));
        electron.on("exit", (code) => stop(code ?? 1));
      };
      waitForServer().catch((error) => { if (!stopping) console.error(error.message); stop(1); });
    });
  } finally {
    const target = assertPhysicalPath(temp, { root: runtime });
    if (!isPathInside(runtime, target)) throw new Error("开发临时目录不在任务 runtime 内");
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runDevelopment(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => { console.error(error.message); process.exitCode = 1; });
