export function handleDatabaseCellEscape(event) {
  if (event.key !== "Escape") return false;
  const cell = event.currentTarget;
  const details = cell.querySelector("details[open]");
  if (event.target === cell && !details) return false;
  event.preventDefault(); event.stopPropagation();
  if (event.target !== cell) event.target.blur?.();
  if (details) details.open = false;
  cell.focus();
  return true;
}
