import { useState } from "react";
import { PROPERTY_LABELS } from "../domain/databaseProperties.js";
import { DatabasePopover } from "./DatabaseViewSettings.jsx";
import { useI18n } from "../i18n/workspaceRuntime.js";

export function DatabasePropertyConfig({ property, anchor, onClose, onSave, onAdvanced }) {
  const { t } = useI18n();
  const [name, setName] = useState(property.name);
  const propTypeLabel = t(`db.prop.${property.type}`) || PROPERTY_LABELS[property.type] || property.type;
  return <DatabasePopover anchor={anchor} label={t("dbx.propCfg.editTitle", { type: propTypeLabel })} className="db-new-property-config" onClose={onClose}>
    <header><strong>{t("db.ui.editProp")}</strong><button type="button" aria-label={t("db.ui.closePropAria")} onClick={() => onClose(true)}>×</button></header>
    <div className="db-new-property-fields">
      <label>{t("dbx.propCfg.nameLabel")}<input data-popover-initial aria-label={t("db.ui.propName")} placeholder={t("dbx.propCfg.namePlaceholder")} value={name} onChange={(event) => { const value = event.target.value; setName(value); onSave({ name: value }); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) event.preventDefault(); }} /></label>
      <div className="db-new-property-type"><span>{t("db.ui.propTypeLabel")}</span><span>{propTypeLabel}</span></div>
      <button type="button" className="db-new-property-advanced" onClick={() => onAdvanced(name)}>{t("db.ui.moreSettings")}</button>
    </div>
  </DatabasePopover>;
}
