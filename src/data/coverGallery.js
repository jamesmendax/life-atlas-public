import { generatedCoverAssets, generatedCoverMeta } from "./coverAssets.generated.js";

const legacyMetAssets = [
  { id: "degas-landscape", title: "Landscape", artist: "Edgar Degas", src: "/covers/degas-landscape.jpg", objectId: 359362 },
  { id: "ye-xin-landscape", title: "Landscape", artist: "Ye Xin", src: "/covers/ye-xin-landscape.jpg", objectId: 65625 },
  { id: "brazilian-landscape", title: "A Brazilian Landscape", artist: "Frans Post", src: "/covers/brazilian-landscape.jpg", objectId: 437323 },
  { id: "gericault-aqueduct", title: "Evening: Landscape with an Aqueduct", artist: "Théodore Géricault", src: "/covers/gericault-aqueduct.jpg", objectId: 436455 },
  { id: "blakelock-landscape", title: "Landscape", artist: "Ralph Albert Blakelock", src: "/covers/blakelock-landscape.jpg", objectId: 10181 },
  { id: "unsen-landscape", title: "Landscape", artist: "Kushiro Unsen", src: "/covers/unsen-landscape.jpg", objectId: 57160 },
  { id: "harpignies-landscape", title: "Landscape", artist: "Henri-Joseph Harpignies", src: "/covers/harpignies-landscape.jpg", objectId: 337306 },
  { id: "liu-yu-landscape", title: "Landscape", artist: "Liu Yu", src: "/covers/liu-yu-landscape.jpg", objectId: 49134 },
  { id: "chen-hongshou-landscape", title: "Landscape", artist: "Chen Hongshou", src: "/covers/chen-hongshou-landscape.jpg", objectId: 49055 },
  { id: "ryder-landscape", title: "Landscape", artist: "Albert Pinkham Ryder", src: "/covers/ryder-landscape.jpg", objectId: 11978 },
  { id: "kenyon-cox-landscape", title: "Landscape", artist: "Kenyon Cox", src: "/covers/kenyon-cox-landscape.jpg", objectId: 10560 },
  { id: "wu-xizai-landscape", title: "Landscape", artist: "Wu Xizai", src: "/covers/wu-xizai-landscape.jpg", objectId: 49451 },
  { id: "hu-yuan-landscape", title: "Landscape", artist: "Hu Yuan", src: "/covers/hu-yuan-landscape.jpg", objectId: 49455 },
  { id: "zhang-ruitu-landscape", title: "Landscape", artist: "Zhang Ruitu", src: "/covers/zhang-ruitu-landscape.jpg", objectId: 48968 },
  { id: "fan-hong-landscape", title: "Landscape", artist: "Fan Hong", src: "/covers/fan-hong-landscape.jpg", objectId: 51610 },
  { id: "hokusai-landscape", title: "Landscape", artist: "Katsushika Hokusai", src: "/covers/hokusai-landscape.jpg", objectId: 54437 },
  { id: "twachtman-landscape", title: "Landscape", artist: "John Henry Twachtman", src: "/covers/twachtman-landscape.jpg", objectId: 12844 },
  { id: "david-johnson-landscape", title: "Landscape", artist: "David Johnson", src: "/covers/david-johnson-landscape.jpg", objectId: 15973 },
  { id: "pillement-landscape", title: "Landscape", artist: "Jean Pillement", src: "/covers/pillement-landscape.jpg", objectId: 339341 },
  { id: "van-bloemen-landscape", title: "Landscape", artist: "Jan Frans van Bloemen", src: "/covers/van-bloemen-landscape.jpg", objectId: 335078 },
].map((item, index) => ({
  ...item,
  category: "masters",
  categoryLabel: "大师画作",
  subcategory: "The Met Open Access",
  tags: ["艺术", "绘画", item.artist, item.title],
  source: "The Metropolitan Museum of Art",
  sourceUrl: `https://www.metmuseum.org/art/collection/search/${item.objectId}`,
  license: "CC0",
  licenseUrl: "https://www.metmuseum.org/about-the-met/policies-and-documents/open-access",
  thumbnailSrc: item.src,
  dominantColors: [],
  orientation: "horizontal",
  featured: index < 6,
  sortOrder: 100 + index,
  defaultPosition: 50,
}));

const seen = new Set();
export const coverGallery = [...generatedCoverAssets, ...legacyMetAssets]
  .filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  })
  .slice(0, 150);

const groupLabels = [
  ["all", "精选"],
  ["masters", "大师画作"],
  ["nature", "自然风光"],
  ["astronomy", "星空极光"],
  ["patterns", "古典纹样"],
  ["textures", "低干扰纹理"],
];

export const coverGalleryGroups = groupLabels.map(([id, label]) => ({
  id,
  label,
  count: id === "all" ? coverGallery.length : coverGallery.filter((item) => item.category === id).length,
})).filter((group) => group.id === "all" || group.count > 0);

export const coverGallerySource = {
  name: "Life Atlas curated Open Access cover library",
  licenses: ["Public domain", "CC0"],
  sources: ["Wikimedia Commons", "The Metropolitan Museum of Art Open Access"],
  maxBuiltInAssets: 150,
};

export const coverGalleryMeta = {
  count: coverGallery.length,
  generatedCount: generatedCoverMeta.count,
  legacyMetCount: legacyMetAssets.length,
  maxBuiltInAssets: 150,
};

const legacyCoverPresetMap = {
  "warm-coast": "gericault-aqueduct",
  alpine: "twachtman-landscape",
  forest: "blakelock-landscape",
  desert: "ryder-landscape",
  night: "degas-landscape",
  indigo: "hokusai-landscape",
};

export function normalizeCoverChoice(cover) {
  if (!cover) return null;
  if (typeof cover === "string") return { kind: "upload", value: cover, position: 50 };
  if (cover.kind === "preset" && legacyCoverPresetMap[cover.value]) {
    return { kind: "gallery", value: legacyCoverPresetMap[cover.value], position: cover.position ?? 50 };
  }
  return cover;
}

export function coverGalleryItem(id) {
  return coverGallery.find((item) => item.id === id) ?? null;
}

export function galleryCoverImage(cover) {
  if (!cover) return null;
  if (typeof cover === "string") return { url: cover, position: 50 };
  const normalized = normalizeCoverChoice(cover);
  if (normalized?.kind === "upload" && normalized.value) return { url: normalized.value, position: normalized.position ?? 50 };
  if (normalized?.kind === "gallery") {
    const entry = coverGalleryItem(normalized.value);
    if (entry) return { url: entry.src, position: normalized.position ?? entry.defaultPosition ?? 50 };
  }
  return null;
}
