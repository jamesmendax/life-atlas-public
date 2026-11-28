// Keep the original CodeMirror editor, project options, and Carbon renderer.
function attachCarbonDraft({ get, save }) {
  const watch = new MutationObserver(connect);
  watch.observe(document.body, { childList: true, subtree: true });
  let connected;
  function connect() {
    const cm = document.querySelector('.CodeMirror')?.CodeMirror;
    if (!cm || connected === cm) return;
    connected = cm;
    const source = get('code');
    if (typeof source === 'string' && cm.getValue() !== source) cm.setValue(source);
    cm.on('changes', editor => { try { save('code', editor.getValue()); } catch (error) {
      const status = document.getElementById('atlas-code-status') || document.body.appendChild(document.createElement('output'));
      status.id = 'atlas-code-status'; status.textContent = error.message;
    } });
  }
  connect();
}
