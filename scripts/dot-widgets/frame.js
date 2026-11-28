// Runs inside the signed package's opaque frame. All persistent values belong to this block.
function mountDotWidget(start, height) {
  const channel = 'life-atlas.widget.v1';
  let revision = -1, sequence = 0, pending = null, dirty = false, locked = false;
  let state = {}, started = false;
  const send = (type, more = {}) => parent.postMessage({ channel, type, ...more }, '*');
  function flush() {
    if (locked || pending !== null || !dirty) return;
    dirty = false;
    pending = ++sequence;
    send('commit', { id: pending, base: revision, state });
  }
  function save(key, value) {
    if (locked || state[key] === value) return;
    const next = { ...state, [key]: value };
    if (new TextEncoder().encode(JSON.stringify(next)).length > 1048576) throw Error('组件记录超过 1 MiB，页面保留了上一次保存的记录。');
    state = next;
    dirty = true;
    flush();
  }
  const storage = { getItem: key => state[key] ?? null, setItem: (key, value) => save(key, String(value)),
    removeItem: key => { if (Object.hasOwn(state, key)) { delete state[key]; dirty = true; flush(); } } };
  window.addEventListener('message', event => {
    const msg = event.data;
    if (event.source !== parent || msg?.channel !== channel || msg.type !== 'context' ||
        !Number.isSafeInteger(msg.revision) || msg.revision < revision) return;
    const ack = pending !== null && msg.ack?.id === pending;
    // An external edit (including Undo) must replace the contents in the widget itself.
    const external = started && msg.revision !== revision && !ack &&
        JSON.stringify(msg.state) !== JSON.stringify(state);
    revision = msg.revision;
    if (external || (ack && !msg.ack.accepted)) {
      location.reload();
      return;
    }
    if (ack) pending = null;
    locked = Boolean(msg.locked);
    document.body.inert = locked;
    if (!started) {
      started = true;
      state = { ...msg.state };
      document.documentElement.dataset.theme = msg.theme;
      start({ storage, save, get: key => state[key], context: msg });
    }
    flush();
    if (height !== null) send('height', { height: height || Math.max(260, document.body.scrollHeight) });
  });
  // A sandboxed form has no navigation permission. Dispatch only its local submit handler.
  document.addEventListener('click', event => {
    const button = event.target.closest?.('button, input[type=submit]');
    const form = button?.form;
    if (event.defaultPrevented || button?.type !== 'submit' || !form || button.disabled) return;
    event.preventDefault();
    if (form.reportValidity()) form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: button }));
  });
  send('ready');
}

function setDotTheme(theme) {
  const scheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = scheme;
  document.documentElement.style.colorScheme = scheme;
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.content = scheme;
}

function observeDotSurface(surface, initialContext, updateTheme) {
  const channel = 'life-atlas.widget.v1';
  let viewportHeight = 800, lastHeight, request;
  function measure() {
    request = undefined;
    const bounds = surface.getBoundingClientRect();
    const openDialog = Array.from(document.querySelectorAll('dialog[open]')).at(-1);
    let height = Math.ceil(bounds.bottom);
    if (openDialog) {
      const desired = openDialog.scrollHeight + 36;
      height = Math.max(height, Math.min(viewportHeight, desired));
    }
    if (height === lastHeight) return;
    lastHeight = height;
    parent.postMessage({ channel, type: 'height', height }, '*');
  }
  function schedule() {
    if (request === undefined) request = requestAnimationFrame(measure);
  }
  function apply(context) {
    if (Number.isFinite(context.viewportHeight) && context.viewportHeight > 0) {
      viewportHeight = context.viewportHeight;
    }
    updateTheme?.(context.theme);
    schedule();
  }
  const size = new ResizeObserver(schedule);
  size.observe(surface);
  const dialogs = new MutationObserver(schedule);
  dialogs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  window.addEventListener('message', event => {
    if (event.source === parent && event.data?.channel === channel && event.data.type === 'context') apply(event.data);
  });
  window.addEventListener('pagehide', () => {
    size.disconnect();
    dialogs.disconnect();
    cancelAnimationFrame(request);
  }, { once: true });
  apply(initialContext);
}
