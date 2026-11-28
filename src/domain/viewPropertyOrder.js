export function moveVisibleProperty(visible, movable, id, targetId) {
  const from = movable.indexOf(id);
  const to = movable.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return visible;

  const next = movable.slice();
  next.splice(to, 0, ...next.splice(from, 1));
  const replacement = new Map(movable.map((propertyId, index) => [propertyId, next[index]]));
  return visible.map(propertyId => replacement.get(propertyId) ?? propertyId);
}
