import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";

const root = process.cwd();
const publicRoot = path.join(root, "public", "assets", "covers");
const generatedPath = path.join(root, "src", "data", "coverAssets.generated.js");
const manifestPath = path.join(publicRoot, "index.json");
const USER_AGENT = "LifeAtlasPrototype/0.2 (offline cover library builder)";
const acceptedLicenses = new Set(["Public domain", "CC0", "CC0 1.0"]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const masterCatalog = [
  ["van-gogh-starry-night","星月夜","Vincent van Gogh","The Starry Night Van Gogh Google Art Project",["梵高","星夜","油画","夜景"]],
  ["monet-water-lilies","睡莲","Claude Monet","Claude Monet Water Lilies painting",["莫奈","睡莲","印象派","花园"]],
  ["hokusai-great-wave","神奈川冲浪里","Katsushika Hokusai","The Great Wave off Kanagawa Hokusai",["浮世绘","海浪","日本","葛饰北斋"]],
  ["van-gogh-sunflowers","向日葵","Vincent van Gogh","Van Gogh Sunflowers painting",["梵高","向日葵","油画"]],
  ["van-gogh-cafe-terrace","夜间露天咖啡座","Vincent van Gogh","Van Gogh Cafe Terrace at Night painting",["梵高","夜景","咖啡馆"]],
  ["monet-impression-sunrise","印象·日出","Claude Monet","Monet Impression Sunrise painting",["莫奈","日出","印象派"]],
  ["monet-japanese-bridge","日本桥与睡莲","Claude Monet","Monet Japanese bridge water lilies painting",["莫奈","花园","桥","睡莲"]],
  ["vermeer-pearl-earring","戴珍珠耳环的少女","Johannes Vermeer","Girl with a Pearl Earring Vermeer",["维米尔","肖像","经典"]],
  ["mona-lisa","蒙娜丽莎","Leonardo da Vinci","Mona Lisa Leonardo da Vinci",["达芬奇","肖像","文艺复兴"]],
  ["rembrandt-night-watch","夜巡","Rembrandt","The Night Watch Rembrandt painting",["伦勃朗","荷兰","油画"]],
  ["botticelli-venus","维纳斯的诞生","Sandro Botticelli","The Birth of Venus Botticelli",["波提切利","文艺复兴","经典"]],
  ["friedrich-wanderer","雾海上的旅人","Caspar David Friedrich","Wanderer above the Sea of Fog Friedrich",["浪漫主义","山峰","雾海"]],
  ["turner-fighting-temeraire","战舰无畏号","J. M. W. Turner","The Fighting Temeraire Turner",["透纳","海洋","日落"]],
  ["seurat-grande-jatte","大碗岛的星期天下午","Georges Seurat","A Sunday Afternoon on the Island of La Grande Jatte Seurat",["修拉","点彩","公园"]],
  ["millet-gleaners","拾穗者","Jean-François Millet","The Gleaners Millet painting",["米勒","田野","现实主义"]],
  ["whistler-mother","惠斯勒的母亲","James McNeill Whistler","Whistler's Mother Arrangement in Grey and Black",["惠斯勒","肖像","灰调"]],
  ["bruegel-hunters","雪中猎人","Pieter Bruegel the Elder","Hunters in the Snow Bruegel",["勃鲁盖尔","雪景","冬季"]],
  ["velazquez-las-meninas","宫娥","Diego Velázquez","Las Meninas Velazquez",["委拉斯开兹","宫廷","西班牙"]],
  ["bosch-garden","人间乐园","Hieronymus Bosch","The Garden of Earthly Delights Bosch",["博斯","幻想","经典"]],
  ["hiroshige-sudden-shower","大桥骤雨","Utagawa Hiroshige","Sudden Shower over Shin-Ohashi bridge Hiroshige",["歌川广重","浮世绘","雨","桥"]]
];

const batches = {
  nature: {
    label: "自然风光",
    quota: 20,
    tags: ["自然","山川","森林","海岸","风景"],
    queries: [
      ["National Park Service Yosemite landscape public domain", 4],
      ["National Park Service Grand Canyon landscape public domain", 3],
      ["National Park Service forest public domain", 4],
      ["National Park Service coast public domain", 3],
      ["National Park Service mountain lake public domain", 3],
      ["National Park Service desert landscape public domain", 3]
    ]
  },
  astronomy: {
    label: "星空极光",
    quota: 14,
    tags: ["星空","极光","星云","宇宙","深空"],
    queries: [
      ["NASA aurora public domain", 3],
      ["NASA Milky Way public domain", 2],
      ["NASA galaxy public domain", 3],
      ["NASA Hubble nebula public domain", 4],
      ["NASA Earth from space public domain", 2]
    ]
  },
  patterns: {
    label: "古典纹样",
    quota: 20,
    tags: ["传统纹样","织物","装饰","几何","古典"],
    queries: [
      ["William Morris wallpaper public domain", 4],
      ["Chinese textile pattern public domain museum", 4],
      ["Islamic tile pattern public domain museum", 4],
      ["Japanese textile pattern public domain museum", 4],
      ["ornament pattern public domain museum", 4]
    ]
  },
  textures: {
    label: "低干扰纹理",
    quota: 10,
    tags: ["纹理","低干扰","纸张","石材","织物"],
    queries: [
      ["paper texture public domain", 3],
      ["marble texture public domain", 2],
      ["linen fabric texture public domain", 2],
      ["stone texture public domain", 2],
      ["wood grain texture public domain", 1]
    ]
  }
};

function stripHtml(value = "") {
  return String(value).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}
function pageTitleToLabel(title = "") {
  return String(title).replace(/^File:/, "").replace(/\.[^.]+$/, "").replaceAll("_", " ").trim();
}
function commonsPageUrl(title) {
  return "https://commons.wikimedia.org/wiki/" + encodeURIComponent(String(title).replaceAll(" ", "_"));
}
function searchUrl(query) {
  return "https://commons.wikimedia.org/wiki/Special:MediaSearch?type=image&search=" + encodeURIComponent(query);
}
async function fetchJson(url, attempts = 5) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (response.ok) return response.json();
    if (response.status !== 429) throw new Error(`HTTP ${response.status}`);
    const waitSeconds = Math.min(35, Number(response.headers.get("retry-after")) || 5 + attempt * 5);
    console.warn(`[rate-limit] wait ${waitSeconds}s`);
    await sleep(waitSeconds * 1000);
  }
  throw new Error("HTTP 429 after retries");
}
async function fetchBuffer(url, attempts = 4) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    if (response.status !== 429) throw new Error(`image HTTP ${response.status}`);
    await sleep((4 + attempt * 4) * 1000);
  }
  throw new Error("image HTTP 429 after retries");
}
async function searchCommons(query, limit = 50) {
  const params = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: query, gsrnamespace: "6", gsrlimit: String(limit),
    prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: "1920",
    format: "json", origin: "*"
  });
  const data = await fetchJson("https://commons.wikimedia.org/w/api.php?" + params);
  return Object.values(data.query?.pages ?? {});
}
function acceptablePage(page) {
  const info = page.imageinfo?.[0];
  if (!info) return false;
  const license = stripHtml(info.extmetadata?.LicenseShortName?.value);
  if (!acceptedLicenses.has(license)) return false;
  if (!/^image\/(jpeg|png|webp)$/i.test(info.mime ?? "")) return false;
  if ((info.width ?? 0) < 1200 || (info.height ?? 0) < 600) return false;
  return true;
}
async function writeAsset({ id, title, artist, category, categoryLabel, tags, sourceUrl, license, input, sortOrder, originalPageTitle }) {
  const targetDir = path.join(publicRoot, category);
  const thumbDir = path.join(publicRoot, "thumbnails");
  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(thumbDir, { recursive: true });
  const fullPath = path.join(targetDir, `${id}.webp`);
  const thumbPath = path.join(thumbDir, `${id}.webp`);
  await sharp(input).rotate().resize(1600, 900, { fit: "cover", position: "attention" }).webp({ quality: 82, effort: 5 }).toFile(fullPath);
  await sharp(input).rotate().resize(400, 225, { fit: "cover", position: "attention" }).webp({ quality: 72, effort: 4 }).toFile(thumbPath);
  const stats = await sharp(input).stats();
  const dominant = stats.dominant ? `#${[stats.dominant.r,stats.dominant.g,stats.dominant.b].map(v=>v.toString(16).padStart(2,"0")).join("")}` : null;
  const checksum = crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
  return {
    id, title, category, categoryLabel, subcategory: categoryLabel, tags,
    artist, source: "Wikimedia Commons", sourceUrl, license,
    licenseUrl: "https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia",
    src: `/assets/covers/${category}/${id}.webp`,
    thumbnailSrc: `/assets/covers/thumbnails/${id}.webp`,
    dominantColors: dominant ? [dominant] : [],
    orientation: "horizontal", featured: sortOrder < 6, sortOrder: sortOrder + 1,
    defaultPosition: 50, checksum, originalPageTitle
  };
}

fs.mkdirSync(publicRoot, { recursive: true });
const items = [];

// Masterworks were license-verified during the first pass. Reuse the already-local compressed files to avoid hammering Commons.
for (let index = 0; index < masterCatalog.length; index += 1) {
  const [id, title, artist, query, tags] = masterCatalog[index];
  const fullPath = path.join(publicRoot, "masters", `${id}.webp`);
  const thumbPath = path.join(publicRoot, "thumbnails", `${id}.webp`);
  if (!fs.existsSync(fullPath) || !fs.existsSync(thumbPath)) continue;
  const stats = await sharp(fullPath).stats();
  const dominant = stats.dominant ? `#${[stats.dominant.r,stats.dominant.g,stats.dominant.b].map(v=>v.toString(16).padStart(2,"0")).join("")}` : null;
  items.push({
    id, title, category: "masters", categoryLabel: "大师画作", subcategory: artist,
    tags, artist, source: "Wikimedia Commons", sourceUrl: searchUrl(query),
    license: "Public domain", licenseUrl: "https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia",
    src: `/assets/covers/masters/${id}.webp`, thumbnailSrc: `/assets/covers/thumbnails/${id}.webp`,
    dominantColors: dominant ? [dominant] : [], orientation: "horizontal",
    featured: index < 8, sortOrder: index + 1, defaultPosition: 50,
    checksum: crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex"),
    licenseVerification: "Wikimedia Commons imageinfo LicenseShortName verified Public domain during build"
  });
}
console.log(`[masters] reused ${items.length} verified local assets`);

const usedPageTitles = new Set();
for (const [category, config] of Object.entries(batches)) {
  const candidates = [];
  for (const [query, queryCap] of config.queries) {
    try {
      const pages = await searchCommons(query, 50);
      let addedFromQuery = 0;
      for (const page of pages) {
        if (!acceptablePage(page) || usedPageTitles.has(page.title)) continue;
        if (candidates.some((candidate) => candidate.title === page.title)) continue;
        candidates.push(page);
        addedFromQuery += 1;
        if (addedFromQuery >= queryCap) break;
      }
      await sleep(2200);
    } catch (error) {
      console.warn(`[query-skip] ${category}: ${query}: ${error.message}`);
    }
    if (candidates.length >= config.quota * 2) break;
  }
  let added = 0;
  for (const page of candidates) {
    if (added >= config.quota) break;
    const info = page.imageinfo?.[0];
    try {
      const input = await fetchBuffer(info.thumburl || info.url);
      const id = `${category}-${String(added + 1).padStart(2,"0")}`;
      const artist = stripHtml(info.extmetadata?.Artist?.value) || stripHtml(info.extmetadata?.Credit?.value) || config.label;
      const title = stripHtml(info.extmetadata?.ObjectName?.value) || pageTitleToLabel(page.title);
      const item = await writeAsset({
        id, title, artist, category, categoryLabel: config.label,
        tags: [...config.tags, title], sourceUrl: commonsPageUrl(page.title),
        license: stripHtml(info.extmetadata?.LicenseShortName?.value), input,
        sortOrder: added, originalPageTitle: page.title
      });
      items.push(item);
      usedPageTitles.add(page.title);
      added += 1;
      console.log(`[${category}] ${added}/${config.quota}: ${title}`);
    } catch (error) {
      console.warn(`[asset-skip] ${category}/${page.title}: ${error.message}`);
    }
  }
  console.log(`[${category}] resolved ${added}/${config.quota}`);
}

const requiredCategories = ["masters","nature","astronomy","patterns","textures"];
const counts = Object.fromEntries(requiredCategories.map((category) => [category, items.filter((item) => item.category === category).length]));
if (items.length > 150) throw new Error(`Built-in cover count ${items.length} exceeds 150`);
for (const category of requiredCategories) {
  if (!counts[category]) throw new Error(`No cover assets resolved for required category: ${category}`);
}

const groups = [
  { id: "all", label: "精选", count: items.length },
  { id: "masters", label: "大师画作", count: counts.masters },
  { id: "nature", label: "自然风光", count: counts.nature },
  { id: "astronomy", label: "星空极光", count: counts.astronomy },
  { id: "patterns", label: "古典纹样", count: counts.patterns },
  { id: "textures", label: "低干扰纹理", count: counts.textures }
];

const manifest = {
  version: 2,
  generatedAt: new Date().toISOString(),
  maxBuiltInAssets: 150,
  sourcePolicy: "Only locally stored assets verified as Public domain / CC0 through Wikimedia Commons metadata are bundled.",
  groups,
  items
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
fs.mkdirSync(path.dirname(generatedPath), { recursive: true });
fs.writeFileSync(generatedPath,
  `// Generated by scripts/build-cover-library.mjs. Do not edit by hand.\n` +
  `export const generatedCoverAssets = ${JSON.stringify(items, null, 2)};\n` +
  `export const generatedCoverGroups = ${JSON.stringify(groups, null, 2)};\n` +
  `export const generatedCoverMeta = ${JSON.stringify({ count: items.length, counts, source: "Wikimedia Commons", acceptedLicenses: [...acceptedLicenses], maxBuiltInAssets: 150 }, null, 2)};\n`
);
console.log(JSON.stringify({ count: items.length, counts, manifestPath, generatedPath }, null, 2));
