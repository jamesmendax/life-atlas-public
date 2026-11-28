export const TIMELINE_LOAD_LIMITS = [10, 25, 50, 100];

export function timelineLoadLimit(value) {
  return TIMELINE_LOAD_LIMITS.includes(Number(value)) ? Number(value) : null;
}

export function timelineSideColumns(source, config) {
  const title = source.properties.find(property => property.type === "title");
  const fields = source.properties.filter(property => property.type !== "title");
  const ids = Array.isArray(config.tablePropertyIds) ? config.tablePropertyIds : fields.slice(0, 2).map(property => property.id);
  const byId = new Map(fields.map(property => [property.id, property]));
  return [...(title ? [title] : []), ...[...new Set(ids)].map(id => byId.get(id)).filter(Boolean)];
}
