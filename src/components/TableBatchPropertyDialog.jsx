import { useRef, useState } from "react";
import { batchWritableProperty } from "../domain/tableRecordActions.js";
import { validatePropertyValue } from "../domain/databaseProperties.js";
import { Dialog } from "../ui/Dialog.jsx";
import { PropertyEditor } from "./PropertyEditor.jsx";
import { useI18n } from "../i18n/workspaceRuntime.js";

export function TableBatchPropertyDialog({ workspace, source, count, runtime, onApply, onClose }) {
  const { t } = useI18n();
  const properties = source.properties.filter(batchWritableProperty);
  const [propertyId, setPropertyId] = useState("");
  const [value, setValue] = useState(undefined);
  const [message, setMessage] = useState("");
  const draft = useRef(undefined);
  const editor = useRef(null);
  const property = properties.find(entry => entry.id === propertyId);
  const editorRuntime = {
    ...runtime, createPerson: undefined, updatePerson: undefined, updateDatabaseProperty: undefined,
    createAttachment: undefined, uploadAttachment: undefined,
  };
  const changeValue = value => { draft.current = value; setValue(value); setMessage(""); };
  const apply = () => {
    if (!property || !count || runtime?.locked || editor.current?.querySelector('[aria-invalid="true"]')) return;
    if (draft.current === undefined) {
      setMessage(t("dbx.batch.emptyErr"));
      return;
    }
    const issue = validatePropertyValue(property, draft.current);
    if (issue) { setMessage(issue); return; }
    onApply(property.id, draft.current);
  };
  return <Dialog title={t("dbx.batch.title")} description={t("dbx.batch.desc", { count })} className="db-batch-property-dialog" onClose={onClose}>
    <div className="mb-dialog-body">
      <label className="mb-field-group">{t("dbx.batch.propLabel")}<select aria-label={t("dbx.batch.propAria")} value={propertyId} onChange={event => { setPropertyId(event.target.value); changeValue(undefined); }}>
        <option value="">{t("dbx.batch.chooseProp")}</option>
        {properties.map(entry => <option value={entry.id} key={entry.id}>{entry.name}</option>)}
      </select></label>
      {property && <div ref={editor} className="db-batch-property-editor">
        <div className="mb-field-group"><span aria-hidden="true">{t("dbx.batch.newVal")}</span>
          <PropertyEditor key={property.id} workspace={workspace} source={source} property={property} value={value}
            runtime={editorRuntime} label={t("dbx.batch.newValLabel", { name: property.name })} onChange={changeValue} /></div>
        <button type="button" className="db-mini-button" onClick={() => changeValue(null)}>{t("dbx.batch.clearVal")}</button>
        {value === null && <small role="status">{property.type === "checkbox" ? t("dbx.batch.willUncheck") : t("dbx.batch.willClear")}</small>}
      </div>}
      {message && <p role="alert" className="mb-danger-text">{message}</p>}
    </div>
    <footer className="mb-dialog-footer">
      <button type="button" className="mb-button" onClick={onClose}>{t("common.cancel")}</button>
      <button type="button" className="mb-button mb-primary" disabled={!property || !count || runtime?.locked} onClick={apply}>{t("dbx.batch.applyBtn", { count })}</button>
    </footer>
  </Dialog>;
}
