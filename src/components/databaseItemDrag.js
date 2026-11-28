// During dragover Chromium exposes the formats, but hides their payloads.
// Encode the source ID as bytes because custom format names are lowercased.
function sourceFormat(sourceId) {
  return "application/x-life-atlas-record-" + new TextEncoder().encode(sourceId).join(".");
}

export function startDatabaseItemDrag(event, item) {
  if (event.target !== event.currentTarget) return false;
  const data = event.dataTransfer;
  data.effectAllowed = "move";
  data.setData(sourceFormat(item.sourceId), item.id);
  data.setData("text/life-atlas-item", item.id);
  data.setData("text/plain", item.id);
  return true;
}

let activeTarget = null;

function clearTarget() {
  if (!activeTarget) return;
  const view = activeTarget.ownerDocument.defaultView;
  delete activeTarget.dataset.dragover;
  activeTarget = null;
  view.removeEventListener("dragend", clearTarget, true);
  view.removeEventListener("drop", clearTarget, true);
  view.removeEventListener("blur", clearTarget);
}

export function markDatabaseItemDrop(event, sourceId, enabled) {
  if (!enabled || !event.dataTransfer.types.includes(sourceFormat(sourceId))) {
    if (event.currentTarget === activeTarget) clearTarget();
    return;
  }
  event.preventDefault();
  if (activeTarget === event.currentTarget) return;
  clearTarget();
  activeTarget = event.currentTarget;
  activeTarget.dataset.dragover = "true";
  const view = activeTarget.ownerDocument.defaultView;
  view.addEventListener("dragend", clearTarget, true);
  view.addEventListener("drop", clearTarget, true);
  view.addEventListener("blur", clearTarget);
}

export function leaveDatabaseItemDrop(event) {
  if (event.currentTarget === activeTarget && !activeTarget.contains(event.relatedTarget)) clearTarget();
}

export function takeDatabaseItemDrop(event, sourceId, enabled) {
  clearTarget();
  if (!enabled) return "";
  const id = event.dataTransfer.getData(sourceFormat(sourceId));
  if (id) event.preventDefault();
  return id;
}
