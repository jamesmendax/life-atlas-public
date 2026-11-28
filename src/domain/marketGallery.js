// A work has one shelf entry. Each selectable version still refers to its own archive.
export function marketShelf(catalogue, library, filter, query) {
  const catalogueByHash = new Map(catalogue.map((item) => [item.sha256, item]));
  const byHash = new Map();
  if (filter !== "installed") {
    for (const item of catalogue) byHash.set(item.sha256, { ...item, installed: false });
  }
  for (const item of library) {
    const published = catalogueByHash.get(item.sha256);
    byHash.set(item.sha256, published ? { ...item, ...published, installed: true, url: item.url } : item);
  }
  const works = new Map();
  for (const item of byHash.values()) {
    if (filter !== "all" && filter !== "installed" && item.type !== filter) continue;
    if (!works.has(item.id)) works.set(item.id, []);
    works.get(item.id).push(item);
  }
  const needle = query.trim().toLocaleLowerCase();
  return [...works.values()].filter((versions) => !needle || versions.some((item) =>
    (item.title + " " + (item.description || "")).toLocaleLowerCase().includes(needle)))
    .map((versions) => versions.sort((a, b) =>
      Number(a.compatible === false) - Number(b.compatible === false) ||
      b.version.localeCompare(a.version, "en", { numeric: true })));
}
