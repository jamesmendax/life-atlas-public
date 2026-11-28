// This file runs inside the sandbox. It is also included in Carbon packages for older clients.
function installWidgetSurface(layout, heightMessage, initialContext) {
  const channel = 'life-atlas.widget.v1';
  const root = document.documentElement;
  let scheme = document.querySelector('meta[name="color-scheme"]');
  if (!scheme) {
    scheme = document.createElement('meta');
    scheme.name = 'color-scheme';
    document.head.prepend(scheme);
  }
  const select = { carbon: '.card-page', decision: '.root', mingzhang: '.shell', whiteboard: '#root' }[layout];
  const style = document.createElement('style');
  if (select) {
    // The document canvas follows the page. Each tool keeps its own controls and artwork.
    style.textContent = 'html,body{background:transparent!important}'
      // Clip overflow from the rotated, inactive face at the card page. The settings pane remains scrollable.
      + (layout === 'carbon' ? '.card-page{overflow:clip}.flipped [data-carbon-face="back"]{max-height:min(650px,var(--atlas-frame-available,650px))!important}' : '')
      + (layout === 'mingzhang' ? '.embed .shell{background:var(--paper)}' : '')
      + (layout === 'decision' || layout === 'mingzhang' ? 'html[data-theme="dark"] body{color-scheme:dark}html[data-theme="light"] body{color-scheme:light}' : '');
    document.head.append(style);
  }
  let lastHeight, viewportHeight = 800;
  function measure() {
    const content = document.querySelector(select);
    if (!content) return;
    let height = Math.ceil(content.getBoundingClientRect().bottom);
    const dialog = document.querySelector('dialog[open]');
    if (dialog) height = Math.max(height, Math.min(viewportHeight, dialog.scrollHeight + 40));
    if (height > 0 && height !== lastHeight) {
      lastHeight = height;
      parent.postMessage({ channel, type: heightMessage, height }, '*');
    }
  }
  function apply(context) {
    if (context?.theme !== 'light' && context?.theme !== 'dark') return;
    // An opaque-origin frame can report a different OS preference from its embedder.
    // A matching explicit scheme lets Chromium composite the transparent canvas.
    scheme.content = context.theme;
    if (select) {
      root.style.colorScheme = context.theme;
      if (layout === 'carbon') root.dataset.theme = context.theme;
      if (Number.isFinite(context.viewportHeight) && context.viewportHeight > 0) {
        viewportHeight = context.viewportHeight;
        root.style.setProperty('--atlas-frame-available', Math.max(72, viewportHeight - 24) + 'px');
      }
    }
  }
  window.addEventListener('message', event => {
    if (event.source === parent && event.data?.channel === channel && event.data.type === 'context') apply(event.data);
  });
  apply(initialContext);
  if (!select) return;
  // The body survives Carbon's initial replacement of #root. Its size is intrinsic even
  // when the frame is taller than its contents or a card is flipped while off screen.
  const size = new ResizeObserver(measure);
  size.observe(document.body);
  const dialogs = new MutationObserver(measure);
  dialogs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  window.addEventListener('pagehide', () => { size.disconnect(); dialogs.disconnect(); }, { once: true });
  measure();
}
