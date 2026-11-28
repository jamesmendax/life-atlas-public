export function isComposingKeyboardEvent(event) {
  return event?.isComposing === true || event?.nativeEvent?.isComposing === true || event?.keyCode === 229 || event?.nativeEvent?.keyCode === 229;
}

export function isAltGraphKeyboardEvent(event) {
  return Boolean(event?.getModifierState?.("AltGraph") || event?.nativeEvent?.getModifierState?.("AltGraph"));
}

export function navigateChoiceGroup(event) {
  if (isComposingKeyboardEvent(event) || event.altKey || event.ctrlKey || event.metaKey) return;
  const group = event.currentTarget;
  const radio = group.getAttribute("role") === "radiogroup";
  const keys = radio ? ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"] : ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const options = [...group.querySelectorAll(radio ? '[role="radio"]:not(:disabled)' : '[role="tab"]:not(:disabled)')];
  const index = options.indexOf(event.target);
  if (index < 0) return;
  const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
  const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + delta + options.length) % options.length;
  event.preventDefault();
  options[next].focus();
  options[next].click();
}
