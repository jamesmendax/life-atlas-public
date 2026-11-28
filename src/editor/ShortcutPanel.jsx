import { Dialog } from "../ui/Dialog.jsx";
import { useI18n } from "../i18n/workspaceRuntime.js";
import { getShortcuts } from "./shortcuts.js";

export function ShortcutPanel({ onClose }) {
  const { t } = useI18n();
  const shortcuts = getShortcuts(t);
  return <Dialog title={t("settings.tab.shortcuts")} onClose={onClose} className="life-editor-dialog life-shortcut-panel" dialogKind="shortcuts">
    <div className="mb-dialog-body life-shortcut-groups" data-find-ignore>
      {["nav", "page", "edit", "insert"].map((groupKey) => <section key={groupKey}>
        <h3>{t(`shortcut.group.${groupKey}`)}</h3>
        {shortcuts.filter((shortcut) => shortcut.groupKey === groupKey).map((shortcut) => <div key={shortcut.id} className="life-shortcut-row" data-shortcut-id={shortcut.id}>
          <span>{shortcut.description}</span>
          <span className="life-shortcut-keys">{(shortcut.keys === "+" ? ["+"] : shortcut.keys.split("+")).map((key, index) => <kbd key={`${shortcut.id}-${index}`}>{key}</kbd>)}</span>
        </div>)}
      </section>)}
    </div>
  </Dialog>;
}
