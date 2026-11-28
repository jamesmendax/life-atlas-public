import { createRoot } from "react-dom/client";
import { WIDGET_CHANNEL } from "../../src/domain/marketFrameProtocol.js";

// Each package calls this once with its own component. The embedding window
// supplies the state, supported capabilities and theme for this single block.
export function mountWidget(Component) {
  const container = document.getElementById("root");
  const root = createRoot(container);
  const pending = new Map(), audioListeners = new Set();
  let context, state, revision = -1, sequence = 0, editing = null, queued = false;
  let lastHeight = 0, measurementQueued = false, closed = false;
  const send = (type, values = {}) => window.parent.postMessage({ channel: WIDGET_CHANNEL, type, ...values }, "*");

  function request(method, args = {}) {
    const id = ++sequence;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: { message: "请求已超时，请重试。" } });
      }, method === "audio.pick" ? 300000 : 60000);
      pending.set(id, (result) => { clearTimeout(timer); resolve(result); });
      send("request", { id, method, args });
    });
  }
  async function audioRequest(method, args) {
    const result = await request("audio." + method, args);
    if (!result?.ok) throw new Error(result?.error?.message || "无法完成音频操作。");
    return result.value;
  }
  const trip = {
    route: (args) => request("trip.route", args),
    tile: (args) => request("trip.tile", args),
    open: (args) => request("trip.open", args),
  };
  const audio = {
    pick: () => audioRequest("pick"), commit: (args) => audioRequest("commit", args),
    play: (args) => audioRequest("play", args), stop: () => audioRequest("stop"),
    schedule: (args) => audioRequest("schedule", args), dismiss: () => audioRequest("dismiss"),
    onChange(listener) { audioListeners.add(listener); return () => audioListeners.delete(listener); },
  };
  function commit() {
    editing = ++sequence;
    send("commit", { id: editing, base: revision, state });
    queued = false;
  }
  function change(next) {
    if (context?.locked || !context) return;
    state = typeof next === "function" ? next(state) : next;
    if (editing === null) commit();
    else queued = true;
    render();
  }
  function render() {
    const permissions = context.capabilities || [];
    root.render(<Component state={state} onChange={change} locked={context.locked}
      demonstration={context.demonstration} compact={context.compact}
      api={{ trip: permissions.includes("trip-routing") ? trip : undefined,
        audio: permissions.includes("widget-audio") ? audio : undefined }} />);
  }
  function receive(event) {
    if (event.source !== window.parent || event.data?.channel !== WIDGET_CHANNEL) return;
    const msg = event.data;
    if (msg.type === "reply") {
      pending.get(msg.id)?.(msg.result);
      pending.delete(msg.id);
      return;
    }
    if (msg.type === "audio-ended" || msg.type === "audio-alarm") {
      for (const listener of audioListeners) listener(msg.type);
      return;
    }
    if (msg.type !== "context" || !Number.isSafeInteger(msg.revision) || msg.revision < revision) return;
    context = msg;
    document.documentElement.dataset.style = "mobai";
    document.documentElement.dataset.theme = msg.theme === "dark" ? "dark" : "light";
    document.documentElement.toggleAttribute("data-widget-preview", Boolean(msg.demonstration));
    if (Number.isFinite(msg.viewportHeight) && msg.viewportHeight > 0) {
      document.documentElement.style.setProperty("--la-widget-viewport-height", `${msg.viewportHeight}px`);
    }
    const acknowledged = msg.ack && msg.ack.id === editing;
    if (msg.locked || (acknowledged && !msg.ack.accepted) || (!acknowledged && msg.revision !== revision)) {
      editing = null; queued = false; state = msg.state;
    } else if (acknowledged) {
      editing = null;
      if (!queued) state = msg.state;
    } else if (editing === null) state = msg.state;
    revision = msg.revision;
    if (!msg.locked && queued && editing === null) commit();
    render();
  }
  function measure() {
    measurementQueued = false;
    if (closed) return;
    const dialog = document.querySelector("dialog[open]");
    const ordinary = Math.ceil(container.getBoundingClientRect().height);
    const height = dialog ? Math.max(ordinary, Math.min(1000, Math.max(600, dialog.scrollHeight + 44))) : ordinary;
    if (height && height !== lastHeight) { lastHeight = height; send("height", { height }); }
  }
  // Chromium suspends animation frames in off-screen cross-origin iframes.
  // Report the first committed layout even when this editor block is below the fold.
  function queueMeasurement() {
    if (!measurementQueued) { measurementQueued = true; queueMicrotask(measure); }
  }
  // Sandboxed frames cannot navigate by submitting a form. Preserve native
  // validation and deliver a local submit event to the component's form handler.
  function localSubmit(event) {
    const button = event.target instanceof Element && event.target.closest("button,input");
    const form = button?.form;
    if (event.defaultPrevented || event.button !== 0 || !form || button.type !== "submit" || button.matches(":disabled")
      || form.hasAttribute("action") || button.hasAttribute("formaction")) return;
    event.preventDefault();
    if (!form.noValidate && !button.formNoValidate && !form.reportValidity()) return;
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: button }));
  }
  function enterInField(event) {
    const input = event.target;
    if (event.defaultPrevented || event.key !== "Enter" || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
      || !(input instanceof HTMLInputElement) || !input.form || input.matches(":disabled") || !["text", "search", "email", "url", "tel", "password", "number"].includes(input.type)) return;
    const button = [...input.form.elements].find((field) => field.type === "submit");
    if (!button || button.matches(":disabled") || input.form.hasAttribute("action") || button.hasAttribute("formaction")) return;
    event.preventDefault();
    if (!event.repeat) button.click();
  }
  document.addEventListener("click", localSubmit);
  document.addEventListener("keydown", enterInField);
  const size = new ResizeObserver(queueMeasurement);
  size.observe(container);
  const overlays = new MutationObserver(queueMeasurement);
  overlays.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
  window.addEventListener("message", receive);
  window.addEventListener("pagehide", () => {
    closed = true;
    window.removeEventListener("message", receive);
    document.removeEventListener("click", localSubmit);
    document.removeEventListener("keydown", enterInField);
    size.disconnect(); overlays.disconnect();
    for (const finish of pending.values()) finish({ ok: false, error: { message: "组件已关闭。" } });
    pending.clear(); audioListeners.clear();
  }, { once: true });
  send("ready");
}
