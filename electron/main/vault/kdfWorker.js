import { parentPort } from "node:worker_threads";
import { argon2id } from "hash-wasm";

parentPort.once("message", async ({ passwordB64, saltB64, params }) => {
  const password = Buffer.from(passwordB64, "base64");
  const salt = Buffer.from(saltB64, "base64");
  let key;
  try {
    if (params.alg !== "argon2id" || params.version !== 19) throw new Error("unsupported kdf");
    key = await argon2id({
      password,
      salt,
      memorySize: params.memoryKiB,
      iterations: params.iterations,
      parallelism: params.parallelism,
      hashLength: 32,
      outputType: "binary",
    });
    parentPort.postMessage({ keyB64: Buffer.from(key).toString("base64") });
  } catch {
    parentPort.postMessage({ error: "derivation-failed" });
  } finally {
    password.fill(0);
    salt.fill(0);
    key?.fill(0);
  }
});
