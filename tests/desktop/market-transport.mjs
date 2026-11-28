import path from "node:path";
import { REPO_ROOT } from "./helpers.mjs";

export const marketFixture = path.join(REPO_ROOT, "market", "public");

// The fixture serves the same signed files as the release website. Only the
// test executable enables this transport; no archive is copied into the app.
export async function serveMarketFixture(app) {
  await app.evaluate(({ session }, directory) => {
    const fs = process.getBuiltinModule("node:fs");
    const path = process.getBuiltinModule("node:path");
    const market = session.fromPartition("life-atlas-market-public", { cache: false });
    globalThis.marketTestRequests = [];
    globalThis.marketTestOnline = true;
    market.protocol.handle("https", async (request) => {
      const url = new URL(request.url);
      const prefix = "/life-atlas-public/market/";
      if (url.host !== "jamesmendax.github.io" || !url.pathname.startsWith(prefix)) return new Response(null, { status: 404 });
      const name = url.pathname.slice(prefix.length);
      if (!name.split("/").every((part) => /^[\w-]+(?:\.[\w-]+)*$/u.test(part))) return new Response(null, { status: 404 });
      globalThis.marketTestRequests.push(name);
      if (!globalThis.marketTestOnline) return new Response(null, { status: 503 });
      try { return new Response(await fs.promises.readFile(path.join(directory, name))); }
      catch { return new Response(null, { status: 404 }); }
    });
  }, marketFixture);
}

export function requestedPacks(app) {
  return app.evaluate(() => globalThis.marketTestRequests.filter((name) => name.endsWith(".atlaspack")));
}
