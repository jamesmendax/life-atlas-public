import { dataSourceById, resolveDisplayPropertyValue } from "../domain/database.js";
import { PropertyEditor } from "./PropertyEditor.jsx";
import { SpriteIcon } from "./AppearanceGlyph.jsx";
import { RecordLayout } from "./RecordLayout.jsx";
import { isPageArchived } from "../domain/archive.js";
import { useI18n } from "../i18n/workspaceRuntime.js";

const PROPERTY_ICONS = {
  text: "abc", number: "calculator", select: "tag", multi_select: "tag", status: "circle-check",
  date: "calendar", checkbox: "checkbox", people: "users", url: "link", email: "mail", phone: "link",
  files: "file", place: "map", relation: "link", rollup: "calculator", formula: "math-function",
  id: "database", unique_id: "database", created_time: "clock", modified_time: "clock", created_by: "users", last_edited_by: "users",
};

export function RecordProperties({ page, runtime, compact = false, fullPage = false }) {
  const { t } = useI18n();
  const workspace = runtime?.workspace;
  const item = workspace?.databaseItems?.find((entry) => entry.pageId === page.id);
  const source = item ? dataSourceById(workspace, item.sourceId) : null;
  if (!item || !source) return null;
  const owner = source.ownerPageId && workspace.pages?.find(entry => entry.id === source.ownerPageId);
  const locked = Boolean(page.settings?.locked || runtime?.locked || owner?.settings?.locked || owner?.trashedAt || isPageArchived(workspace, page) || isPageArchived(workspace, owner));
  const properties = source.properties.filter(property => property.type !== "title");
  const renderProperty = property => <div className="db-record-property" key={property.id} data-property-id={property.id}>
    <span className="db-record-property-label">{compact && <SpriteIcon id={PROPERTY_ICONS[property.type] || "file"} size={16} />}<span>{property.name}</span></span>
    <PropertyEditor workspace={workspace} source={source} item={item} property={property} value={resolveDisplayPropertyValue(workspace, source, item, property)} runtime={runtime} disabled={locked} emptyPlaceholder={compact ? t("db.ui.emptyCell") : undefined} compact={compact} onChange={(value) => runtime.updateDatabaseItemValue(item.id, property.id, value)} />
  </div>;
  return <div className={`database-view db-record-properties${compact ? " is-compact" : ""}${fullPage ? " record-properties" : ""}`} aria-label={t("db.ui.recordPropsAria")}>
    <RecordLayout key={source.id + ":" + item.id} workspace={workspace} source={source} runtime={runtime} properties={properties} renderProperty={renderProperty} canEdit={!locked && Boolean(runtime.updateDataSourceLayout)} />
  </div>;
}
