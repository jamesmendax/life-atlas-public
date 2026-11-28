export function applyTableManualOrder(items, order) {
  if (!Array.isArray(order) || !order.length) return items;
  const rank = new Map();
  for (const id of order) if (!rank.has(id)) rank.set(id, rank.size);
  return [...items].sort((left, right) => (rank.get(left.id) ?? rank.size) - (rank.get(right.id) ?? rank.size));
}

export function moveTableRow(items, visibleIds, itemId, targetId, side) {
  if (itemId === targetId) return null;
  const ids = new Set(visibleIds);
  const full = items.map(item => item.id);
  const visible = full.filter(id => ids.has(id));
  if (!visible.includes(itemId) || !visible.includes(targetId)) return null;
  const arranged = visible.filter(id => id !== itemId);
  arranged.splice(arranged.indexOf(targetId) + (side === "after" ? 1 : 0), 0, itemId);
  if (arranged.every((id, index) => id === visible[index])) return null;
  let index = 0;
  return full.map(id => ids.has(id) ? arranged[index++] : id);
}
