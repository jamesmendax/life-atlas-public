import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const packageInfo = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
const generatedCoverRoot = path.resolve(projectDir, "public", "assets", "covers");

// Check the actual renderer dependency graph, including dynamically imported chunks.
function separateMarketPackages() {
  // Leaflet is shared by the built-in database map and the optional itinerary.
  const optionalModule = /\/(?:market\/(?:official|community|widget-ui)\/|src\/editor\/(?:widgets\/(?!MarketWidgetHost\.jsx)|Pomodoro)|src\/domain\/pomodoro\.js|src\/ui\/themes\/mobai\/(?:footprint|trip-route|market-widgets|pomodoro-widget)\.css)/u;
  return {
    name: "life-atlas-market-packages",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk") continue;
        const widget = Object.keys(item.modules).find((id) => optionalModule.test(id.replaceAll("\\", "/")));
        if (widget) this.error(`市集组件应随所选软件包下载，主程序引用了 ${widget}`);
      }
    },
  };
}

function generatedCoverDevServer() {
  return {
    name: "life-atlas-generated-cover-dev-server",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = decodeURIComponent(String(req.url ?? "").split("?")[0]);
        if (!pathname.startsWith("/assets/covers/")) return next();

        const relativePath = pathname.slice(1).split("/").join(path.sep);
        const filePath = path.resolve(projectDir, "public", relativePath);
        const rootPrefix = generatedCoverRoot.endsWith(path.sep) ? generatedCoverRoot : generatedCoverRoot + path.sep;
        if (!filePath.toLowerCase().startsWith(rootPrefix.toLowerCase())) return next();
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return next();

        const extension = path.extname(filePath).toLowerCase();
        const contentType = {
          ".webp": "image/webp",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".png": "image/png",
        }[extension] ?? "application/octet-stream";

        res.statusCode = 200;
        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "no-store");
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig({
  define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(packageInfo.version) },
  build: {
    assetsInlineLimit: 0,
    outDir: "dist/client",
    rollupOptions: { input: Object.fromEntries(["index", "vault", "setup", "markdown-preview"].filter((entry) => fs.existsSync(path.join(projectDir, `${entry}.html`))).map((entry) => [entry, path.join(projectDir, `${entry}.html`)])) },
  },
  optimizeDeps: {
    include: ["react", "react-dom/client", "@blocknote/code-block", "@floating-ui/react", "@tabler/icons-react/dist/esm/icons/IconFileText.mjs"],
  },
  server: {
    host: "127.0.0.1",
    allowedHosts: ["terminal.local"],
    watch: { ignored: ["**/.qa/**", "**/.visual-qa/**", "**/release/**"] },
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [generatedCoverDevServer(), react(), separateMarketPackages()],
});
