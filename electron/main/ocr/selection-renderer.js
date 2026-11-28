const bridge = window.ocrSelection;
const capture = document.getElementById("capture");
const frame = document.getElementById("frame");
const selection = document.getElementById("selection");
const cancel = document.getElementById("cancel");
let activePointer;

bridge.onFrame((image) => {
  frame.src = image;
  frame.decode().then(() => bridge.loaded(true), () => bridge.loaded(false));
});

bridge.onRectangle((rectangle) => {
  if (rectangle) {
    selection.style.left = `${rectangle.x}px`;
    selection.style.top = `${rectangle.y}px`;
    selection.style.width = `${rectangle.width}px`;
    selection.style.height = `${rectangle.height}px`;
  }
  selection.hidden = !rectangle;
  capture.dataset.region = String(Boolean(rectangle));
  capture.dataset.dragging = "true";
});

capture.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || cancel.contains(event.target) || activePointer !== undefined) return;
  activePointer = event.pointerId;
  capture.setPointerCapture(activePointer);
  capture.dataset.dragging = "true";
  bridge.start(event.clientX, event.clientY);
});

capture.addEventListener("pointerup", (event) => {
  if (event.pointerId !== activePointer) return;
  activePointer = undefined;
  bridge.commit();
});

capture.addEventListener("lostpointercapture", (event) => {
  if (event.pointerId === activePointer) bridge.cancel();
});

capture.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  bridge.cancel();
});

cancel.addEventListener("click", () => bridge.cancel());
