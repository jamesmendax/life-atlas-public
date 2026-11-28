import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";

const root = fileURLToPath(new URL("../", import.meta.url));
const widgetNames = {
  pomodoro: "PomodoroWidget",
  "travel-footprint": "FootprintWidget",
  "habit-heatmap": "HabitHeatmapWidget",
  "trip-itinerary": "TripItineraryWidget",
  "travel-packing": "TravelPackingWidget",
  "world-clock": "WorldClockWidget",
  "ambient-mixer": "AmbientMixerWidget",
  "life-countdown": "LifeCountdownWidget",
  "flashcard-quote": "FlashcardQuoteWidget",
};
const widgetStyleSections = ["travel-footprint", "habit-heatmap", "trip-itinerary", "travel-packing",
  "world-clock", "ambient-mixer", "life-countdown", "flashcard-quote"];
const mapsByWidget = {
  "trip-itinerary": new Map([
    ["src/editor/widgets/trip-data/regional-streets.json", "assets/maps/regional-streets.json"],
    ["src/editor/widgets/trip-data/place-labels.json", "assets/maps/place-labels.json"],
    ["src/editor/widgets/trip-data/china-places.json", "assets/maps/china-places.json"],
    ["src/editor/widgets/trip-data/example-routes.json", "assets/maps/example-routes.json"],
    ["src/editor/widgets/trip-data/chengdu-transit.json", "assets/maps/chengdu-transit.json"],
    ["src/assets/ne_110m_land.json", "assets/maps/world-land.json"],
  ]),
  "travel-footprint": new Map([
    ["src/editor/widgets/footprint-data/macau-parishes.json", "assets/maps/macau-parishes.json"],
  ]),
};

function selectWidgetCss(text, slug) {
  const sheet = postcss.parse(text);
  const selected = widgetStyleSections.indexOf(slug) + 1;
  let section = 0;
  const seen = new Set();
  for (const node of [...sheet.nodes]) {
    if (node.type === "comment") {
      const heading = /^(\d+)\.\s/u.exec(node.text);
      if (heading) { section = Number(heading[1]); seen.add(section); }
    }
    if (node.type === "atrule" && node.name === "media" && node.toString().includes(".mw-fp-grid")) {
      if (slug !== "travel-footprint") node.remove();
      continue;
    }
    if (section && section !== selected) { node.remove(); continue; }
    if (!section && node.type === "rule"
      && ((node.selector.includes(".mw-footprint") && slug !== "travel-footprint")
        || (node.selector.includes(".mw-heatmap") && slug !== "habit-heatmap"))) node.remove();
  }
  if (!seen.has(selected)) throw new Error("缺少组件的独立样式分段：" + slug);
  return sheet.toString();
}

function officialAssets(slug, mountEntry, mapAssets) {
  return { name: "life-atlas-widget-assets", setup(builder) {
    // Existing immutable packages were compiled with the 1.3.4 frame runtime.
    // Even dead new trip-only branches change esbuild's minified identifiers.
    if (slug !== "trip-itinerary") builder.onLoad({ filter: /[\\/]market[\\/]widget-ui[\\/]entry\.jsx$/ }, async resource => ({
      contents: await readFile(path.join(path.dirname(resource.path), "entry-1.3.4.jsx"), "utf8"),
      loader: "jsx", resolveDir: path.dirname(resource.path),
    }));
    builder.onLoad({ filter: /market-widgets\.css$/ }, async (resource) => ({
      contents: selectWidgetCss(await readFile(resource.path, "utf8"), slug), loader: "css", resolveDir: path.dirname(resource.path),
    }));
    if (!mapAssets) return;
    builder.onResolve({ filter: /^atlas-widget:(data|mount)$/ }, (args) => ({ path: args.path, namespace: "atlas-widget" }));
    builder.onLoad({ filter: /.*/, namespace: "atlas-widget" }, (resource) => {
      if (resource.path === "atlas-widget:mount") return { contents: mountEntry, loader: "jsx", resolveDir: root };
      return { loader: "js", contents: `
        export const maps = new Map();
        export async function loadMaps() {
          await Promise.all(${JSON.stringify([...mapAssets.values()])}.map(async (name) => {
            const response = await fetch(new URL(name, document.baseURI), { credentials: "omit" });
            if (!response.ok) throw new Error("离线地图资源读取失败");
            maps.set(name, await response.json());
          }));
        }
      ` };
    });
    builder.onLoad({ filter: /\.json$/ }, (resource) => {
      const name = mapAssets.get(path.relative(root, resource.path).split(path.sep).join("/"));
      if (name) return { contents: 'import { maps } from "atlas-widget:data"; export default maps.get(' + JSON.stringify(name) + ');', loader: "js", resolveDir: root };
    });
  } };
}

export async function buildWidgetUi(slug) {
  const name = widgetNames[slug];
  if (!name) throw new Error("未知的内置组件源目录");
  const timer = slug === "pomodoro";
  const mapAssets = mapsByWidget[slug];
  const componentPath = timer ? "./market/widget-ui/PomodoroWidget.jsx" : `./src/editor/widgets/${name}.jsx`;
  const styles = ["./market/widget-ui/widget-base.css", "./src/ui/themes/mobai/" + (timer ? "pomodoro-widget.css" : "market-widgets.css")];
  if (slug === "travel-footprint") styles.push("./src/ui/themes/mobai/footprint.css");
  if (slug === "trip-itinerary") styles.push("./src/ui/themes/mobai/trip-route.css");
  const mountEntry = [
    ...styles.map((file) => "import " + JSON.stringify(file) + ";"),
    'import { mountWidget } from "./market/widget-ui/entry.jsx";',
    `import { ${name} } from ${JSON.stringify(componentPath)};`,
    `mountWidget(${name});`,
  ].join("\n");
  const entry = mapAssets ? `
    import { loadMaps } from "atlas-widget:data";
    loadMaps().then(() => import("atlas-widget:mount")).catch(() => {
      document.getElementById("root").textContent = "无法读取本包的离线地图，请重新打开组件。";
    });
  ` : mountEntry;
  const result = await build({
    absWorkingDir: root, stdin: { contents: entry, sourcefile: "ui.jsx", resolveDir: root, loader: "jsx" },
    outdir: root, entryNames: "ui", assetNames: "assets/[name]-[hash]", bundle: true, write: false,
    format: "iife", platform: "browser", target: "es2022", jsx: "automatic", minify: true, metafile: true,
    define: { "process.env.NODE_ENV": '"production"', TRIP_PLANNER_BRIDGE: String(slug === "trip-itinerary") }, legalComments: "inline", logLevel: "silent",
    loader: { ".png": "file", ".webp": "file", ".woff2": "file" },
    plugins: [officialAssets(slug, mountEntry, mapAssets)],
  });
  const files = new Map(result.outputFiles.map((file) =>
    [path.relative(root, file.path).split(path.sep).join("/"), Buffer.from(file.contents)]));
  const inputs = Object.keys(result.metafile.inputs);
  for (const other of Object.values(widgetNames)) {
    if (other !== name && inputs.some((source) => source.endsWith("/" + other + ".jsx"))) {
      throw new Error("组件引入了其他作品的界面：" + other);
    }
  }
  const add = async (target, source) => files.set(target, await readFile(path.join(root, source)));
  // esbuild reports physical module paths when node_modules is linked from a
  // separate release checkout. Match both the logical and physical roots.
  const logicalModules = path.join(root, "node_modules");
  const moduleRoots = new Set([logicalModules, await realpath(logicalModules)]);
  const buildInputs = inputs.map((file) => path.resolve(root, file));
  const isFrom = (file, directory) => {
    const relative = path.relative(directory, file);
    return Boolean(relative) && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
  };
  for (const library of ["react", "react-dom", "scheduler", "leaflet", "@tabler/icons-react"]) {
    if ([...moduleRoots].some((directory) => buildInputs.some((file) => isFrom(file, path.join(directory, library))))) {
      await add("assets/licenses/" + library.replace("@", "").replace("/", "-") + ".txt", "node_modules/" + library + "/LICENSE");
    }
  }
  if (slug === "trip-itinerary") await add("assets/licenses/qrcode-generator.txt", "market/official/trip-itinerary/qrcode-generator.LICENSE.txt");
  if (timer) {
    for (const name of ["standard-alarm.wav", "mechanical-tick.wav"]) {
      await add("assets/" + name, "market/official/pomodoro/assets/" + name);
    }
  }
  if (mapAssets) for (const [source, target] of mapAssets) await add(target, source);
  if (slug === "trip-itinerary") {
    await add("assets/licenses/travel-maps.md", "src/editor/widgets/trip-data/README.md");
    await add("assets/licenses/natural-earth.md", "MAP_DATA_SOURCES.md");
    await add("assets/licenses/footprint-sources.md", "market/official/travel-footprint/SOURCES.md");
    for (const license of ["cc-by-4.0.txt", "odbl-1.0.txt"]) {
      await add("assets/licenses/" + license, "market/official/travel-footprint/" + license);
    }
  }
  if (slug === "travel-footprint") {
    await add("assets/licenses/footprint-sources.md", "market/official/travel-footprint/SOURCES.md");
    for (const license of ["cc-by-4.0.txt", "odbl-1.0.txt"]) {
      await add("assets/licenses/" + license, "market/official/travel-footprint/" + license);
    }
  }
  return files;
}
