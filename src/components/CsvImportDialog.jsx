import { useEffect, useMemo, useRef, useState } from "react";
import { dataSourceById } from "../domain/database.js";
import { READ_ONLY_PROPERTY_TYPES } from "../domain/databaseProperties.js";
import { assertCsvLimits, decodeCsvBytes, inferColumnType, parseCsv } from "../domain/csv.js";
import { useI18n } from "../i18n/workspaceRuntime.js";
import { Dialog } from "../ui/Dialog.jsx";

const COLUMN_TYPES = ["text", "number", "select", "multi_select", "status", "date", "checkbox", "url", "email", "phone"];

export function CsvImportDialog({ workspace, sourceId = null, folderId = null, onImport, onClose }) {
  const { t } = useI18n();
  const source = dataSourceById(workspace, sourceId);
  const fileInput = useRef(null), sequence = useRef(0);
  const [file, setFile] = useState(null), [bytes, setBytes] = useState(null);
  const [encoding, setEncoding] = useState("auto"), [withHeader, setWithHeader] = useState(true);
  const [columnTypes, setColumnTypes] = useState({}), [mapping, setMapping] = useState({});
  const [error, setError] = useState(""), [result, setResult] = useState(null), [busy, setBusy] = useState(false);
  const parsed = useMemo(() => {
    if (!bytes) return { rows: [], header: [], encoding: "", error: "" };
    try {
      assertCsvLimits({ byteLength: bytes.byteLength, rowCount: 0, columnCount: 0 });
      const decoded = decodeCsvBytes(bytes, encoding);
      const allRows = parseCsv(decoded.text);
      const columnCount = allRows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
      const rows = withHeader ? allRows.slice(1) : allRows;
      assertCsvLimits({ byteLength: bytes.byteLength, rowCount: rows.length, columnCount });
      const header = Array.from({ length: columnCount }, (_, index) => withHeader ? allRows[0]?.[index]?.trim() || t("db.csv.columnDefault", { index: index + 1 }) : t("db.csv.columnDefault", { index: index + 1 }));
      return { rows, header, encoding: decoded.encoding, error: "" };
    } catch (issue) { return { rows: [], header: [], encoding: "", error: issue.message }; }
  }, [bytes, encoding, withHeader, t]);
  const writable = source?.properties.filter((property) => !READ_ONLY_PROPERTY_TYPES.includes(property.type)) || [];
  useEffect(() => {
    setColumnTypes(Object.fromEntries(parsed.header.map((header, index) => [index, index === 0 ? "title" : inferColumnType(parsed.rows.map((row) => row[index]))])));
    setMapping(Object.fromEntries(parsed.header.map((header, index) => [index, writable.find((property) => property.name === header)?.id || ""])));
    setResult(null); setError("");
  }, [parsed]);
  const readFile = async (candidate) => {
    const current = ++sequence.current;
    setFile(candidate); setBytes(null); setError(""); setResult(null);
    if (!candidate) return;
    try {
      assertCsvLimits({ byteLength: candidate.size, rowCount: 0, columnCount: 0 });
      const buffer = await candidate.arrayBuffer();
      if (sequence.current === current) setBytes(new Uint8Array(buffer));
    } catch (issue) { if (sequence.current === current) setError(issue.message); }
  };
  const importRows = async () => {
    if (busy || parsed.error || !parsed.rows.length || !parsed.header.length || sourceId && !source) return;
    setBusy(true); setError("");
    try {
      const imported = await onImport({ sourceId, fileName: file.name, header: parsed.header, rows: parsed.rows, columnTypes, mapping: Object.fromEntries(Object.entries(mapping).map(([index, propertyId]) => [index, propertyId || null])), folderId });
      if (!imported || imported.error) throw new Error(imported?.error?.message || t("db.csv.failed"));
      setResult(imported);
    } catch (issue) { setError(issue.message); }
    finally { setBusy(false); }
  };
  return <Dialog title={t("db.csv.title")} ariaLabel={t("db.csv.title")} className="db-csv-dialog ui-dialog" onClose={onClose} initialFocusRef={fileInput} busy={busy}>
    <div className="db-csv-body">
      <p>{source ? t("db.csv.into", { name: source.title }) : t("db.csv.createNew")}</p>
      <input ref={fileInput} type="file" accept=".csv,text/csv" aria-label={t("db.csv.pickFile")} disabled={busy} onChange={(event) => readFile(event.target.files?.[0])} />
      <div className="db-csv-options"><label>{t("db.csv.encoding")}<select aria-label={t("db.csv.encoding")} value={encoding} disabled={busy} onChange={(event) => setEncoding(event.target.value)}><option value="auto">{t("db.csv.auto")}</option><option value="utf-8">UTF-8</option><option value="gbk">GBK</option></select></label><label><input type="checkbox" aria-label={t("db.csv.hasHeader")} checked={withHeader} disabled={busy} onChange={(event) => setWithHeader(event.target.checked)} />{t("db.csv.hasHeader")}</label></div>
      {encoding === "auto" && parsed.encoding && <p className="db-csv-encoding">{t("db.csv.detectedEncoding", { encoding: parsed.encoding === "gbk" ? "GBK" : "UTF-8" })}</p>}
      {parsed.header.length > 0 && <div className="db-csv-preview"><table><caption>{t("db.csv.previewCaption", { count: parsed.rows.length })}</caption><thead><tr>{parsed.header.map((header, index) => <th key={index}>{header}</th>)}</tr><tr>{parsed.header.map((header, index) => <th key={index}>{source ? <select aria-label={t("db.csv.mapColAria", { name: header })} value={mapping[index] || ""} disabled={busy} onChange={(event) => setMapping({ ...mapping, [index]: event.target.value })}><option value="">{t("db.csv.ignoreCol")}</option>{writable.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select> : <select aria-label={t("db.csv.colTypeAria", { name: header })} value={columnTypes[index] || "text"} disabled={index === 0 || busy} onChange={(event) => setColumnTypes({ ...columnTypes, [index]: event.target.value })}>{index === 0 ? <option value="title">{t("db.prop.title")}</option> : COLUMN_TYPES.map((type) => <option key={type} value={type}>{t(`db.prop.${type}`)}</option>)}</select>}</th>)}</tr></thead><tbody>{parsed.rows.slice(0, 20).map((row, rowIndex) => <tr key={rowIndex}>{parsed.header.map((header, index) => <td key={index}>{row[index] || ""}</td>)}</tr>)}</tbody></table></div>}
      {(error || parsed.error) && <p role="alert" className="db-field-error">{error || parsed.error}</p>}
      {result && <p role="status" className="db-csv-result">{t("db.csv.result", { count: result.importedCount, extra: result.unrecognizedCount ? t("db.csv.unrecognized", { count: result.unrecognizedCount }) : "" })}</p>}
    </div>
    <footer className="mb-dialog-footer"><button type="button" className="mb-button" onClick={onClose} disabled={busy}>{result ? t("db.csv.done") : t("common.cancel")}</button><button type="button" className="mb-button mb-primary" onClick={importRows} disabled={busy || Boolean(result || parsed.error) || !parsed.rows.length}>{busy ? t("db.csv.importing") : t("db.csv.submit", { count: parsed.rows.length })}</button></footer>
  </Dialog>;
}
