import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import yauzl from "yauzl";

const CHUNK_BYTES = 1024 * 1024;

export async function scanPlaintext(targets, markerValues, onHit = () => {}) {
  if (!targets.length || !markerValues.length || markerValues.some((marker) => typeof marker !== "string" || !marker)) throw new Error("invalid scanner arguments");
  const markers = markerValues.flatMap((value, index) => ["utf8", "utf16le"].map((encoding) => ({ bytes: Buffer.from(value, encoding), encoding, label: value.startsWith("LA-MARKER-") ? value.slice(0, 12) : `marker-${index + 1}` })));
  const overlap = Math.max(...markers.map((marker) => marker.bytes.length)) - 1;
  let hitCount = 0;

  async function scanStream(stream, fileName) {
    let tail = Buffer.alloc(0);
    let offset = 0;
    const delivered = new Set();
    for await (const chunk of stream) {
      const combined = Buffer.concat([tail, chunk]);
      const start = offset - tail.length;
      for (const marker of markers) {
        let position = combined.indexOf(marker.bytes);
        while (position >= 0) {
          const absoluteOffset = start + position;
          const key = `${absoluteOffset}:${marker.encoding}:${marker.label}`;
          if (!delivered.has(key)) {
            delivered.add(key); hitCount += 1;
            onHit({ file: fileName, offset: absoluteOffset, encoding: marker.encoding, marker: marker.label });
          }
          position = combined.indexOf(marker.bytes, position + 1);
        }
      }
      offset += chunk.length;
      tail = Buffer.from(combined.subarray(Math.max(0, combined.length - overlap)));
    }
  }

  async function scanZip(file) {
    const zip = await new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, validateEntrySizes: true }, (error, value) => error ? reject(error) : resolve(value)));
    await new Promise((resolve, reject) => {
      zip.on("error", reject);
      zip.on("end", resolve);
      zip.on("entry", (entry) => {
        if (/\/$/.test(entry.fileName)) { zip.readEntry(); return; }
        zip.openReadStream(entry, (error, stream) => {
          if (error) { zip.close(); reject(error); return; }
          scanStream(stream, `${file}!${entry.fileName}`).then(() => zip.readEntry(), (failure) => { zip.close(); reject(failure); });
        });
      });
      zip.readEntry();
    });
  }

  async function visit(target) {
    const resolved = path.resolve(target);
    const info = await fs.promises.lstat(resolved);
    if (info.isSymbolicLink()) throw new Error("scanner does not follow links");
    if (info.isDirectory()) {
      for (const child of await fs.promises.readdir(resolved)) await visit(path.join(resolved, child));
      return;
    }
    if (!info.isFile()) return;
    await scanStream(fs.createReadStream(resolved, { highWaterMark: CHUNK_BYTES }), resolved);
    if (/\.(zip|lifeatlas)$/i.test(resolved)) {
      const descriptor = await fs.promises.open(resolved, "r");
      const magic = Buffer.alloc(4);
      try { await descriptor.read(magic, 0, 4, 0); } finally { await descriptor.close(); }
      if (magic.equals(Buffer.from([80, 75, 3, 4]))) await scanZip(resolved);
    }
  }

  for (const target of targets) await visit(target);
  return hitCount;
}

async function main(args) {
  const markerIndex = args.indexOf("--markers");
  if (markerIndex < 1 || markerIndex !== args.length - 2) throw new Error("usage: scan-plaintext <directory or file...> --markers <marker-file>");
  const markers = (await fs.promises.readFile(args[markerIndex + 1], "utf8")).split(/\r?\n/).filter(Boolean);
  const hits = await scanPlaintext(args.slice(0, markerIndex), markers, (hit) => console.log(`${hit.file}\t${hit.offset}\t${hit.encoding}\t${hit.marker}`));
  console.log(`plaintext scanner: ${hits} hits`);
  return hits ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, () => { console.error("plaintext scanner: invalid arguments or unreadable input"); process.exitCode = 2; });
}
