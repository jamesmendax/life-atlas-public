import { useState } from "react";
import { AppearanceGlyph } from "./AppearanceGlyph.jsx";
import { useI18n } from "../i18n/workspaceRuntime.js";

export function WorkspaceLibrary({ navigation, now, onOpenPage }) {
  const { locale, t } = useI18n();
  const [status, setStatus] = useState("active");
  const groups = navigation.libraryGroups(now, status);
  const displayLabel = (label) => (label === "无标题页面" ? t("backlinks.untitled") : label === "新数据库" ? t("app.msg.newDb") : label);
  return <div className="page-view library-view">
    <header className="page-heading page-heading-with-meta">
      <div><h1>{t("nav.library")}</h1></div>
      <select className="mb-field" aria-label={t("library.statusAria")} value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="active">{t("library.status.active")}</option>
        <option value="archived">{t("library.status.archived")}</option>
        <option value="all">{t("library.status.all")}</option>
      </select>
    </header>
    <div className="library-groups">
      {groups.map((group) => <section key={group.id} aria-labelledby={`library-heading-${group.id}`}>
        <div className="home-title">
          <h2 id={`library-heading-${group.id}`}>{t(`sidebar.${group.id}`)}</h2>
          <span>{t("home.pageCount", { count: group.entries.length })}</span>
        </div>
        {group.entries.length ? <ul className="home-list library-list">
          {group.entries.map((entry) => <li key={entry.id}>
            <button type="button" className="home-list-row library-row" data-page-id={entry.id} onClick={() => onOpenPage(entry.id)}>
              <AppearanceGlyph icon={entry.icon} color={entry.iconColor} className="home-favorite-icon" />
              <span className="library-row-label"><strong>{displayLabel(entry.label)}</strong><small>{entry.path}</small></span>
              {entry.visitedAt && <time dateTime={entry.visitedAt}>{new Date(entry.visitedAt).toLocaleDateString(locale)}</time>}
            </button>
          </li>)}
        </ul> : <p className="library-empty">{t(`library.empty.${group.id}`)}</p>}
      </section>)}
    </div>
  </div>;
}
