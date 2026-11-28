import { normalizeIdValues } from "../domain/databaseProperties.js";

export function boardGroupValue(type, destination, current, origin) {
  const ungrouped = destination === "未分组";
  if (type !== "multi_select" && type !== "people") return ungrouped ? null : destination;
  if (ungrouped) return [];
  const ids = normalizeIdValues(current);
  if (destination === origin) return ids;
  const others = ids.filter((id) => id !== origin);
  return others.includes(destination) ? others : [...others, destination];
}

export function handleBoardTitleKey(event, finish) {
  event.stopPropagation();
  if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
  if (event.key !== "Enter" && event.key !== "Escape") return;
  event.preventDefault();
  finish(event.currentTarget.value, event.key === "Enter", true);
}
