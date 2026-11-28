import React, { useEffect, useRef, useState } from "react";
import IconGitMerge from "@tabler/icons-react/dist/esm/icons/IconGitMerge.mjs";
import IconX from "@tabler/icons-react/dist/esm/icons/IconX.mjs";
import { invokeVault } from "./api.js";
import { useI18n } from "./i18n.js";

export default function MergeSitesDialog({ groups, onClose, onMerged, onPartialRefresh, onError }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [completedKeys, setCompletedKeys] = useState(() => new Set());
  const [selectedKeys, setSelectedKeys] = useState(() => new Set(groups.map((group) => group.siteKey)));
  const [targets, setTargets] = useState(() => Object.fromEntries(groups.map((group) => [group.siteKey, group.target.id])));
  const [localError, setLocalError] = useState("");
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement;
    return () => {
      mounted.current = false;
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const remainingSelectedCount = groups.filter((group) => selectedKeys.has(group.siteKey) && !completedKeys.has(group.siteKey)).length;

  async function runMerge() {
    if (busy || !remainingSelectedCount) return;
    setBusy(true);
    setLocalError("");
    let mergedGroups = 0;
    let mergedItems = 0;
    let lastTargetId = null;
    const succeededNow = new Set();
    try {
      for (const group of groups) {
        if (!selectedKeys.has(group.siteKey) || completedKeys.has(group.siteKey)) continue;
        const targetId = targets[group.siteKey] || group.target.id;
        const sourceIds = group.items.map((entry) => entry.id).filter((id) => id !== targetId);
        if (!sourceIds.length) continue;
        const result = await invokeVault("mergeSiteItems", { targetId, sourceIds });
        succeededNow.add(group.siteKey);
        mergedGroups += 1;
        mergedItems += result.mergedItemsCount;
        lastTargetId = result.summary.id;
      }
      if (mounted.current) onMerged({ mergedGroups, mergedItems, targetId: lastTargetId });
    } catch (error) {
      if (mounted.current) {
        if (succeededNow.size > 0) {
          setCompletedKeys((previous) => new Set([...previous, ...succeededNow]));
          setSelectedKeys((previous) => {
            const next = new Set(previous);
            for (const key of succeededNow) next.delete(key);
            return next;
          });
          onPartialRefresh?.();
        }
        setLocalError(succeededNow.size > 0 ? t("vault.merge.partialError", { count: succeededNow.size, message: error.message }) : error.message);
        onError?.(error);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div className="vault-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section
        className="vault-dialog vault-dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-label={t("vault.merge.title")}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="dialog-head">
          <h2><IconGitMerge size={18} aria-hidden="true" /> {t("vault.merge.title")}</h2>
          <button type="button" className="n-icon" aria-label={t("common.close")} disabled={busy} onClick={onClose}>
            <IconX size={16} />
          </button>
        </div>
        <p className="vault-muted">{t("vault.merge.body")}</p>

        <div className="merge-groups">
          {groups.map((group) => {
            const done = completedKeys.has(group.siteKey);
            const checked = !done && selectedKeys.has(group.siteKey);
            const targetId = targets[group.siteKey] || group.target.id;
            return (
              <div key={group.siteKey} className={`merge-group-row ${checked ? "is-checked" : ""}`}>
                <label className="merge-group-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy || done}
                    onChange={(event) => setSelectedKeys((previous) => {
                      const next = new Set(previous);
                      if (event.target.checked) next.add(group.siteKey);
                      else next.delete(group.siteKey);
                      return next;
                    })}
                  />
                  <span className="merge-group-title">
                    <b>{group.siteName}{done ? t("vault.merge.mergedTag") : ""}</b>
                    <small>{t("vault.merge.groupCount", { items: group.items.length, creds: group.totalCredentials })}</small>
                  </span>
                </label>
                <label className="merge-target-picker">
                  {t("vault.merge.keepPrimary")}
                  <select
                    aria-label={t("vault.merge.pickerAria", { site: group.siteName })}
                    value={targetId}
                    disabled={!checked || busy || done}
                    onChange={(event) => setTargets((previous) => ({ ...previous, [group.siteKey]: event.target.value }))}
                  >
                    {group.items.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {t("vault.merge.optionCount", { title: entry.title, count: entry.credentialCount || 1 })}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            );
          })}
        </div>

        {localError && <p className="vault-error" role="alert">{localError}</p>}

        <div className="vault-actions dialog-foot">
          <button type="button" className="btn-line" disabled={busy} onClick={onClose}>{t("common.cancel")}</button>
          <button type="button" className="primary" disabled={busy || !remainingSelectedCount} onClick={runMerge}>
            {busy ? t("vault.merge.busy") : t("vault.merge.submit", { count: remainingSelectedCount })}
          </button>
        </div>
      </section>
    </div>
  );
}
