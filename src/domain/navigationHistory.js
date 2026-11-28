export function createHistory() {
  return { entries: [], index: -1 };
}

function sameLocation(left, right) {
  return left?.section === right?.section
    && (left?.pageId || null) === (right?.pageId || null)
    && (left?.folderId || null) === (right?.folderId || null)
    && (left?.blockId || null) === (right?.blockId || null)
    && (left?.marketItemKey || null) === (right?.marketItemKey || null);
}

export function pushLocation(history, location) {
  if (sameLocation(history.entries[history.index], location)) return history;
  const entries = [...history.entries.slice(0, history.index + 1), { ...location }].slice(-50);
  return { entries, index: entries.length - 1 };
}

function travel(history, direction, isValid) {
  for (let index = history.index + direction; index >= 0 && index < history.entries.length; index += direction) {
    if (isValid(history.entries[index])) return { history: { ...history, index }, location: history.entries[index] };
  }
  return { history, location: null };
}

export function goBack(history, isValid) { return travel(history, -1, isValid); }
export function goForward(history, isValid) { return travel(history, 1, isValid); }
