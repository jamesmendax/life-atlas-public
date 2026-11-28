import { useContext, useEffect, useId, useRef, useState } from "react";
import { LifeAtlasEditorRuntimeContext } from "../editor/EditorRuntime.jsx";
import { DEFAULT_FILE_PROPERTY_LIMIT_MB, PROPERTY_LABELS, READ_ONLY_PROPERTY_TYPES, filePropertyIssue, formatPropertyValue, normalizeIdValues, safePropertyHref, validatePropertyValue } from "../domain/databaseProperties.js";
import { NUMBER_FORMATS, formatNumber } from "../domain/numberFormat.js";
import { OPTION_PALETTE } from "../domain/propertyChanges.js";
import { useDialogs } from "../ui/DialogProvider.jsx";
import { Dialog } from "../ui/Dialog.jsx";
import { OptionPicker } from "./OptionPicker.jsx";
import { DatePicker } from "./DatePicker.jsx";
import { FormulaEditor } from "./FormulaEditor.jsx";
import { isMultilineFormulaResult, renderFormulaResult } from "./formulaResult.js";
import { DatabaseActionButton, DatabaseActionFields } from "./DatabaseActionControls.jsx";
import { databaseActionConfigIssue } from "../domain/databaseActions.js";
import { CurrencyConversionSettings } from "./CurrencyConversionSettings.jsx";
import { currencyConfigIssue } from "../domain/currencyConversion.js";
import { rollupAggregationOptions, rollupRelationTargetId } from "../domain/rollupConfiguration.js";
import { statusDefaultOptionId } from "../domain/statusGroups.js";
import { formulaSyntaxError } from "../domain/formula/validation.js";
import { useI18n } from "../i18n/workspaceRuntime.js";

function DraftText({ value, onChange, label, type = "text", placeholder, validate, disabled, multiline = false, grow = false, formatDisplay, inputMode }) {
  const [draft, setDraft] = useState(value ?? "");
  const [error, setError] = useState("");
  const [focused, setFocused] = useState(false);
  const cancelBlur = useRef(false);
  const errorId = useId();
  useEffect(() => { setDraft(value ?? ""); }, [value]);
  const commit = () => {
    setFocused(false);
    if (cancelBlur.current) { cancelBlur.current = false; return; }
    const issue = validate?.(draft);
    setError(issue || "");
    if (!issue && String(draft) !== String(value ?? "")) onChange?.(draft);
  };
  const props = {
    className: "db-cell-input", "aria-label": label, "aria-invalid": Boolean(error), "aria-describedby": error ? errorId : undefined,
    value: !focused && !error && formatDisplay ? formatDisplay(value) : draft, placeholder, disabled, inputMode,
    onFocus: () => { cancelBlur.current = false; setFocused(true); },
    onChange: (event) => setDraft(event.target.value), onBlur: commit,
    onKeyDown: (event) => {
      event.stopPropagation();
      if (event.key === "Enter" && !multiline && !(grow && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229))) { event.preventDefault(); event.currentTarget.blur(); event.currentTarget.closest("td[data-property-id]")?.focus(); }
      if (event.key === "Escape") {
        event.preventDefault(); cancelBlur.current = true; setDraft(value ?? ""); setError(""); event.currentTarget.blur();
        const cell = event.currentTarget.closest("td[data-property-id]");
        if (cell) { const details = event.currentTarget.closest("details"); if (details) details.open = false; cell.focus(); }
      }
    },
  };
  return <span className="db-draft-field">{multiline || grow ? <textarea {...props} rows={grow ? 1 : undefined} /> : <input {...props} type={type} />}{error && <small id={errorId} role="alert" className="db-field-error">{error}</small>}</span>;
}

function AttachmentLink({ file, runtime }) {
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const externalHref = file?.externalUrl ? safePropertyHref("url", file.externalUrl) : null;
  const [resolved, setResolved] = useState(null);
  const key = `${file?.id || ""}:${file?.provider || ""}:${file?.storageKey || ""}:${file?.deletedAt || ""}`;
  useEffect(() => {
    if (!file || file.deletedAt || externalHref) return undefined;
    let active = true;
    Promise.resolve().then(() => runtimeRef.current?.attachmentUrl?.(file)).then((url) => {
      if (active) setResolved({ key, url: typeof url === "string" && /^(?:blob:|life-asset:\/\/)/i.test(url) ? url : null });
    }).catch(() => { if (active) setResolved({ key, url: null }); });
    return () => { active = false; };
  }, [key, externalHref]);
  const href = externalHref || (resolved?.key === key ? resolved.url : null);
  if (!href || file?.deletedAt) return null;
  return <a href={href} target="_blank" rel="noreferrer" download={externalHref ? undefined : file.name} className="db-file-link">↗ {file.name}</a>;
}

function FilePropertyEditor({ workspace, source, property, value, onChange, runtime, label }) {
  const { t } = useI18n();
  const dialogs = useDialogs();
  const [uploading, setUploading] = useState(false);
  const selected = normalizeIdValues(value);
  const reportError = description => dialogs.alert({ title: t("db.ui.uploadFailed"), description });

  function selectExisting(next) {
    for (const id of next) {
      if (selected.includes(id)) continue;
      const file = workspace.attachments?.find(entry => entry.id === id);
      const issue = file && filePropertyIssue(file, property.config);
      if (issue) { void reportError(issue); return; }
    }
    onChange(next);
  }

  async function uploadFiles(event) {
    const input = event.currentTarget;
    const files = Array.from(input.files || []);
    input.value = "";
    if (!files.length || uploading) return;
    for (const file of files) {
      const issue = filePropertyIssue(file, property.config);
      if (issue) { await reportError(issue); return; }
    }
    setUploading(true);
    const added = [];
    try {
      for (const file of files) {
        const attachment = await runtime.uploadAttachment(file, property.config);
        if (attachment?.id) added.push(attachment.id);
      }
    } catch (error) { await reportError(error.message); }
    finally {
      if (added.length) onChange([...new Set([...selected, ...added])]);
      setUploading(false);
    }
  }

  return <div className="db-files-field"><OptionPicker workspace={workspace} source={source} property={property} label={label} value={value} onChange={selectExisting} runtime={runtime} disabled={uploading}>
    {runtime?.createAttachment && <button type="button" className="db-mini-button" disabled={uploading} onClick={async () => {
      const url = await dialogs.promptText({ title: t("db.ui.addLinkAttach"), label: t("dbx.pe.attachLinkLabel"), description: t("dbx.pe.addLinkDesc"), validate: (value) => safePropertyHref("url", value) ? null : t("app.msg.httpUrlReq") });
      if (!url) return;
      const name = await dialogs.promptText({ title: t("tools.attachNameAria"), initialValue: new URL(url).pathname.split("/").pop() || t("app.msg.attachDefault") });
      if (!name) return;
      const attachment = runtime.createAttachment({ name, externalUrl: url, provider: "external" });
      if (attachment) onChange([...selected, attachment.id]);
    }}>＋ {t("db.ui.addLinkAttach")}</button>}
    {runtime?.uploadAttachment && <label className="db-upload-label">{t("db.ui.uploadFile")}<input type="file" multiple disabled={uploading} accept={property.config?.accept || ""} onChange={uploadFiles} /></label>}
  </OptionPicker>{selected.map(id => { const file = workspace.attachments?.find(entry => entry.id === id); return file ? <AttachmentLink key={id} file={file} runtime={runtime} /> : null; })}</div>;
}

export function PropertyEditor({ workspace, source, item, property, value, onChange, runtime: providedRuntime, label: customLabel, disabled = false, emptyPlaceholder, compact = false }) {
  const { t } = useI18n();
  const dialogs = useDialogs();
  const context = useContext(LifeAtlasEditorRuntimeContext);
  const runtime = providedRuntime || context;
  const label = customLabel || property.name || t(`db.prop.${property.type}`) || PROPERTY_LABELS[property.type];
  const locked = disabled || runtime?.locked;
  if (property.type === "button") return item
    ? <DatabaseActionButton workspace={workspace} source={source} item={item} property={property} onRun={runtime?.runDatabaseAction} disabled={locked} />
    : <span className="db-readonly-cell">—</span>;
  if (READ_ONLY_PROPERTY_TYPES.includes(property.type) || locked) {
    const computed = property.type === "formula" || property.type === "rollup";
    const multiline = computed && isMultilineFormulaResult(value);
    const display = computed ? renderFormulaResult(workspace, property, value, source, runtime?.openPage) : formatPropertyValue(workspace, property, value);
    return <span className={multiline ? "db-readonly-cell db-formula-multiline" : "db-readonly-cell"} data-value-kind={typeof value === "number" && Number.isFinite(value) ? "number" : undefined}>{display || (property.type === "checkbox" && value === false ? "—" : emptyPlaceholder || "—")}</span>;
  }
  if (property.type === "checkbox") return <input className="db-real-checkbox" type="checkbox" aria-label={label} checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />;
  if (["select", "status", "multi_select", "relation"].includes(property.type)) return <OptionPicker workspace={workspace} source={source} property={property} value={value} onChange={onChange} runtime={runtime} label={label} />;
  if (property.type === "date") return <DatePicker value={value} onChange={onChange} label={label} disabled={locked} />;
  if (property.type === "number") return <DraftText label={label} value={value} placeholder={emptyPlaceholder} inputMode="decimal" formatDisplay={(number) => formatNumber(number, property.config?.numberFormat)} onChange={(text) => onChange(String(text).trim() === "" ? null : Number(text))} validate={(text) => String(text).trim() !== "" && !Number.isFinite(Number(text)) ? t("db.ui.validNumErr") : null} />;
  if (property.type === "people") return <OptionPicker workspace={workspace} source={source} property={property} label={label} value={value} onChange={onChange} runtime={runtime}>
    {runtime?.updatePerson && normalizeIdValues(value).flatMap(id => {
      const person = workspace.people?.find(entry => entry.id === id);
      if (!person) return [];
      return [
        <button type="button" key={`${id}:name`} className="db-mini-button" onClick={async () => {
          const name = await dialogs.promptText({ title: t("dbx.pe.personDisplayNameTitle"), initialValue: person.displayName || "" });
          if (name?.trim()) runtime.updatePerson(id, { displayName: name.trim() });
        }}>{t("dbx.pe.renameMember", { name: person.displayName || t("app.msg.memberDefault") })}</button>,
        <button type="button" key={`${id}:email`} className="db-mini-button" onClick={async () => {
          const email = await dialogs.promptText({ title: t("dbx.pe.personEmailTitle"), initialValue: person.email || "", inputType: "email",
            validate: value => value.trim() && !safePropertyHref("email", value) ? t("dbx.pe.invalidEmailErr") : null });
          if (email !== null) runtime.updatePerson(id, { email: email.trim() });
        }}>{t("dbx.pe.emailMember", { name: person.displayName || t("app.msg.memberDefault") })}</button>,
      ];
    })}
  </OptionPicker>;
  if (property.type === "files") return <FilePropertyEditor workspace={workspace} source={source} property={property} value={value} onChange={onChange} runtime={runtime} label={label} />;
  if (property.type === "place") return <details className="db-place-editor"><summary>{formatPropertyValue(workspace, property, value) || t("dbx.pe.placeSetup")}</summary><div>
    <DraftText label={t("dbx.pe.placeNameAria", { label })} placeholder={t("dbx.pe.placeNamePh")} value={value?.name} onChange={(name) => onChange({ ...value, name })} />
    <DraftText label={t("dbx.pe.placeAddrAria", { label })} placeholder={t("dbx.pe.placeAddrPh")} value={value?.address} onChange={(address) => onChange({ ...value, address })} />
    <DraftText label={t("dbx.pe.placeLatAria", { label })} type="number" placeholder="-90 … 90" value={value?.latitude} onChange={(latitude) => onChange({ ...value, latitude: latitude === "" ? null : Number(latitude) })} validate={(text) => text !== "" && (!Number.isFinite(Number(text)) || Math.abs(Number(text)) > 90) ? t("dbx.pe.latRangeErr") : null} />
    <DraftText label={t("dbx.pe.placeLngAria", { label })} type="number" placeholder="-180 … 180" value={value?.longitude} onChange={(longitude) => onChange({ ...value, longitude: longitude === "" ? null : Number(longitude) })} validate={(text) => text !== "" && (!Number.isFinite(Number(text)) || Math.abs(Number(text)) > 180) ? t("dbx.pe.lngRangeErr") : null} />
    <button type="button" className="db-mini-button" onClick={() => onChange(null)}>{t("dbx.pe.clearPlace")}</button>
  </div></details>;
  const href = ["url", "email", "phone"].includes(property.type) ? safePropertyHref(property.type, value) : null;
  return <div className="db-link-field"><DraftText label={label} value={value} onChange={onChange} placeholder={emptyPlaceholder} grow={compact && property.type === "text"} type={property.type === "email" ? "email" : property.type === "phone" ? "tel" : "text"} validate={(text) => validatePropertyValue(property, text)} />{href && <a href={href} target={property.type === "url" ? "_blank" : undefined} rel="noreferrer" aria-label={t("dbx.pe.openLinkAria", { label })}>↗</a>}</div>;
}

export function PropertyConfigDialog({ workspace, source, property, initialName, type = property?.type || "text", onSave, onClose }) {
  const { t } = useI18n();
  const propTypeLabel = t(`db.prop.${type}`) || PROPERTY_LABELS[type] || t("dbx.propCfg.fallback");
  const [name, setName] = useState(property?.name ?? (initialName?.trim() || propTypeLabel));
  const [options, setOptions] = useState((property?.options || []).map((option) => ({ ...option })));
  const [config, setConfig] = useState({ ...property?.config });
  const [optionName, setOptionName] = useState("");
  const [error, setError] = useState("");
  const nameRef = useRef(null);
  const relation = source.properties.find((candidate) => candidate.id === config.relationPropertyId);
  const targetSourceId = rollupRelationTargetId(workspace, source, relation);
  const target = workspace.dataSources?.find((entry) => entry.id === targetSourceId);
  const targetProperty = target?.properties.find((entry) => entry.id === config.targetPropertyId);
  const rollupOptions = rollupAggregationOptions(targetProperty);
  const aggregation = Object.hasOwn(rollupOptions, config.aggregation) ? config.aggregation : "show";
  const title = t(property ? "dbx.propCfg.editTitle" : "dbx.propCfg.newTitle", { type: propTypeLabel });
  return <Dialog title={title} ariaLabel={title} className="db-property-dialog ui-dialog" onClose={onClose} initialFocusRef={nameRef} closeLabel={t("db.ui.closePropAria")}><form className="db-property-form" onSubmit={(event) => {
    event.preventDefault();
    if (type === "unique_id" && !/^[A-Za-z0-9-]{0,10}$/.test(config.prefix || "")) { setError(t("dbx.pe.prefixFormatErr")); return; }
    const issue = type === "button" ? databaseActionConfigIssue(workspace, source, config.action)
      : type === "converted_amount" ? currencyConfigIssue(source, config)
      : type === "formula" ? formulaSyntaxError(config.expression) : null;
    if (issue) { setError(issue); return; }
    setError("");
    const savedConfig = type === "unique_id" ? { ...config, prefix: config.prefix || "", nextNumber: config.nextNumber ?? 1 }
      : type === "rollup" ? { ...config, aggregation } : config;
    onSave({ name: property ? name.trim() : name.trim() || propTypeLabel, type, options, config: savedConfig });
  }}>
    <label>{t("dbx.propCfg.nameLabel")}<input ref={nameRef} aria-label={t("db.ui.propName")} placeholder={t("dbx.propCfg.namePlaceholder")} value={name} onChange={(event) => setName(event.target.value)} /></label>
    {type === "status" && <label>{t("dbx.pe.noDefaultStatus")}<select value={statusDefaultOptionId({ type, options, config }) || ""} onChange={event => setConfig({ ...config, defaultOptionId: event.target.value || null })}>
      <option value="">{t("dbx.pe.noDefaultStatus")}</option>
      {options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
    </select></label>}
    {["select", "multi_select", "status"].includes(type) && <fieldset><legend>{t("dbx.pe.optionsLegend")}</legend>{options.map((option, index) => <div className="db-option-settings-row" key={option.id}><input aria-label={t("dbx.pe.optionItemAria", { index: index + 1 })} value={option.name} onChange={(event) => setOptions(options.map((entry) => entry.id === option.id ? { ...entry, name: event.target.value } : entry))} /><select aria-label={t("dbx.pe.optionColorAria", { name: option.name })} value={OPTION_PALETTE.includes(option.color) ? option.color : "default"} onChange={(event) => setOptions(options.map((entry) => entry.id === option.id ? { ...entry, color: event.target.value } : entry))}>{OPTION_PALETTE.map((color) => <option key={color} value={color}>{color}</option>)}</select>{type === "status" && <select aria-label={t("dbx.pe.optionGroupAria", { name: option.name })} value={option.group || "todo"} onChange={(event) => setOptions(options.map((entry) => entry.id === option.id ? { ...entry, group: event.target.value } : entry))}><option value="todo">{t("dbx.statusGroup.todo")}</option><option value="inProgress">{t("dbx.statusGroup.inProgress")}</option><option value="complete">{t("dbx.statusGroup.complete")}</option></select>}<button type="button" aria-label={t("dbx.pe.deleteOptionAria", { name: option.name })} onClick={() => setOptions(options.filter((entry) => entry.id !== option.id))}>×</button></div>)}<div className="db-option-settings-row"><input aria-label={t("dbx.pe.newOptionNameAria")} value={optionName} onChange={(event) => setOptionName(event.target.value)} /><button type="button" onClick={() => { if (optionName.trim()) { setOptions([...options, { id: `opt-${globalThis.crypto.randomUUID()}`, name: optionName.trim(), color: OPTION_PALETTE[options.length % OPTION_PALETTE.length], ...(type === "status" ? { group: "todo" } : {}) }]); setOptionName(""); } }}>{t("dbx.pe.addOptionBtn")}</button></div></fieldset>}
    {type === "relation" && <>
      <label>{t("dbx.pe.relDbLabel")}<select aria-label={t("dbx.pe.relTargetAria")} required value={config.targetSourceId || ""} onChange={(event) => setConfig({ ...config, targetSourceId: event.target.value })}><option value="">{t("dbx.pe.chooseDbOpt")}</option>{(workspace.dataSources || []).map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></label>
      <label>{t("dbx.pe.relLimitLabel")}<select aria-label={t("dbx.pe.relLimitAria")} value={config.relationLimit === 1 ? "1" : ""} onChange={event => setConfig({ ...config, relationLimit: event.target.value ? 1 : null })}>
        <option value="">{t("dbx.pe.unlimited")}</option><option value="1">{t("dbx.pe.singleRecord")}</option>
      </select></label>
      {config.relationLimit === 1 && <p className="db-field-hint">{t("dbx.pe.relLimitHint")}</p>}
    </>}
    {type === "rollup" && <>
      <label>{t("dbx.pe.rollupRelLabel")}<select aria-label={t("dbx.pe.rollupRelAria")} required value={config.relationPropertyId || ""} onChange={(event) => setConfig({ ...config, relationPropertyId: event.target.value, targetPropertyId: "", aggregation: "show" })}>
        <option value="">{t("dbx.pe.chooseRelOpt")}</option>
        {source.properties.filter((entry) => entry.type === "relation").map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </select></label>
      <label>{t("dbx.pe.rollupTargetLabel")}<select aria-label={t("dbx.pe.rollupTargetAria")} required value={targetProperty?.id || ""} onChange={(event) => {
        const targetPropertyId = event.target.value;
        const nextOptions = rollupAggregationOptions(target?.properties.find((entry) => entry.id === targetPropertyId));
        setConfig({ ...config, targetPropertyId, aggregation: Object.hasOwn(nextOptions, aggregation) ? aggregation : "show" });
      }}>
        <option value="">{t("dbx.layout.chooseProp")}</option>
        {target?.properties.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </select></label>
      <label>{t("db.ui.calculate")}<select aria-label={t("dbx.pe.rollupCalcAria")} value={aggregation} onChange={(event) => setConfig({ ...config, aggregation: event.target.value })}>
        {Object.entries(rollupOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
    </>}
    {type === "formula" && <FormulaEditor workspace={workspace} source={source} property={property} expression={config.expression || ""}
      onChange={(expression) => { setError(""); setConfig(current => ({ ...current, expression })); }} />}
    {type === "button" && <DatabaseActionFields workspace={workspace} source={source} action={config.action} onChange={(action) => { setError(""); setConfig(current => ({ ...current, action })); }} />}
    {type === "converted_amount" && <CurrencyConversionSettings source={source} config={config} onChange={(next) => { setError(""); setConfig(next); }} />}
    {["number", "formula", "rollup"].includes(type) && <fieldset><legend>{t("dbx.pe.numDisplayLegend")}</legend><label>{t("dbx.pe.numFormatLabel")}<select aria-label={t("dbx.pe.numFormatLabel")} value={config.numberFormat?.format || "number"} onChange={(event) => setConfig({ ...config, numberFormat: { ...config.numberFormat, format: event.target.value } })}>{NUMBER_FORMATS.map(([format, label]) => <option key={format} value={format}>{label}</option>)}</select></label><label>{t("dbx.pe.decimalsLabel")}<select aria-label={t("dbx.pe.decimalsLabel")} value={config.numberFormat?.decimals ?? "auto"} onChange={(event) => setConfig({ ...config, numberFormat: { ...config.numberFormat, decimals: event.target.value === "auto" ? null : Number(event.target.value) } })}><option value="auto">{t("dbx.pe.auto")}</option>{[0, 1, 2, 3, 4].map((digits) => <option key={digits} value={digits}>{digits}</option>)}</select></label></fieldset>}
    {type === "unique_id" && <label>{t("dbx.pe.idPrefixLabel")}<input aria-label={t("dbx.pe.idPrefixLabel")} value={config.prefix || ""} maxLength={10} pattern={"[A-Za-z0-9\\-]{0,10}"} onChange={(event) => { setConfig({ ...config, prefix: event.target.value }); setError(/^[A-Za-z0-9-]{0,10}$/.test(event.target.value) ? "" : t("dbx.pe.idPrefixErr")); }} /></label>}
    {type === "files" && <><label>{t("dbx.pe.acceptFilesLabel")}<input aria-label={t("dbx.pe.acceptFilesAria")} placeholder="image/*,.pdf" value={config.accept || ""} onChange={(event) => setConfig({ ...config, accept: event.target.value })} /></label><label>{t("dbx.pe.maxFileSizeLabel")}<input aria-label={t("dbx.pe.maxFileSizeAria")} type="number" min="1" max="1024" value={config.maxSizeMb || DEFAULT_FILE_PROPERTY_LIMIT_MB} onChange={(event) => setConfig({ ...config, maxSizeMb: Number(event.target.value) })} /></label></>}
    {type === "place" && <label>{t("dbx.pe.placeDisplayLabel")}<select aria-label={t("dbx.pe.placeDisplayAria")} value={config.display || "name-address"} onChange={(event) => setConfig({ ...config, display: event.target.value })}><option value="name-address">{t("dbx.pe.nameAddress")}</option><option value="coordinates">{t("dbx.pe.coords")}</option></select></label>}
    {error && <p role="alert" className="db-field-error">{error}</p>}
    <footer><button type="button" className="mb-button" onClick={onClose}>{t("common.cancel")}</button><button type="submit" className="mb-button mb-primary" disabled={Boolean(error)}>{t("dbx.pe.savePropBtn")}</button></footer>
  </form></Dialog>;
}
