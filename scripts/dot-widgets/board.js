// Pinned bindings from Dot's MIT Excalidraw 0.18.1 release, see build.py.
const ReactBoard = ue.default;
const h = ReactBoard.createElement;
mountDotWidget(({ get, save, context }) => {
  const surface = document.getElementById('root');
  surface.className = 'atlas-board';
  surface.innerHTML = `
    <header class="atlas-board-bar">
      <h1>手绘白板</h1>
      <div class="atlas-board-actions">
        <button type="button" data-fit disabled>居中查看</button>
        <button type="button" data-expand aria-pressed="false">加高画布</button>
      </div>
    </header>
    <div class="atlas-board-canvas"></div>
    <output class="atlas-board-status" role="status"></output>`;
  const editor = surface.querySelector('.atlas-board-canvas');
  const fit = surface.querySelector('[data-fit]');
  const expand = surface.querySelector('[data-expand]');
  const status = surface.querySelector('.atlas-board-status');
  const saved = get('drawing');
  let api, last = saved || '', timer, latest;
  fit.onclick = () => api?.scrollToContent(undefined, { fitToViewport: true, maxZoom: 1, animate: false });
  expand.onclick = () => {
    const expanded = surface.toggleAttribute('data-expanded');
    expand.setAttribute('aria-pressed', String(expanded));
    expand.textContent = expanded ? '恢复画布高度' : '加高画布';
  };
  observeDotSurface(surface, context, setDotTheme);
  function commitScene() {
    if (!latest) return;
    const { elements, appState, files } = latest;
    const json = Sd(elements, appState, files, 'local');
    if (json === last) return;
    try { save('drawing', json); last = json; status.textContent = ''; }
    catch (error) { status.textContent = error.message + ' 可在菜单中查看可编辑备份。'; }
  }
  function changed(elements, appState, files) {
    fit.disabled = !elements.some(element => !element.isDeleted);
    if (appState.isLoading || appState.editingTextElement || appState.cursorButton === 'down') return;
    latest = { elements, appState, files };
    clearTimeout(timer);
    // Flush at the end of the current event, before a page switch can unmount the frame.
    timer = setTimeout(commitScene, 0);
  }
  function exportText() {
    if (!api) return;
    const dialog = document.createElement('dialog'), text = document.createElement('textarea'), close = document.createElement('button');
    dialog.className = 'atlas-board-backup';
    dialog.setAttribute('aria-label', '可编辑白板备份');
    const heading = document.createElement('h2');
    heading.textContent = '可编辑白板备份';
    text.setAttribute('aria-label', '可编辑白板 JSON');
    text.readOnly = true;
    text.value = Sd(api.getSceneElements(), api.getAppState(), api.getFiles(), 'local');
    close.textContent = '关闭';
    close.onclick = () => dialog.close();
    dialog.append(heading, text, close); document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal(); text.select();
  }
  const M = pt.DefaultItems;
  const menu = h(pt, null, h(M.LoadScene), h(pt.Item, { onSelect: exportText }, '复制可编辑备份'),
    h(M.SearchMenu), h(M.ClearCanvas), h(pt.Separator), h(M.ToggleTheme), h(M.ChangeCanvasBackground));
  window.EXCALIDRAW_ASSET_PATH = new URL('assets/', document.baseURI).href;
  jO.createRoot(editor).render(h(vx, {
    initialData: saved ? JSON.parse(saved) : { appState: { theme: context.theme } },
    onChange: changed, excalidrawAPI: handle => { api = handle; }, langCode: 'zh-CN', autoFocus: false,
    detectScroll: false, handleKeyboardGlobally: true, aiEnabled: false, validateEmbeddable: false,
    UIOptions: { canvasActions: { toggleTheme: true, export: false, saveAsImage: false, saveToActiveFile: false } },
  }, menu, h(TO, null, h(TO.Center, null,
    h(TO.Center.Logo), h(TO.Center.Heading, null, '画草图、想点子、理清思路。')))));
}, null);
