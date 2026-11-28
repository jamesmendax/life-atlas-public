import React, { useMemo, useState } from "react";
import IconAlertCircle from "@tabler/icons-react/dist/esm/icons/IconAlertCircle.mjs";
import IconBox from "@tabler/icons-react/dist/esm/icons/IconBox.mjs";
import IconCheck from "@tabler/icons-react/dist/esm/icons/IconCheck.mjs";
import IconDatabase from "@tabler/icons-react/dist/esm/icons/IconDatabase.mjs";
import IconDownload from "@tabler/icons-react/dist/esm/icons/IconDownload.mjs";
import IconFileText from "@tabler/icons-react/dist/esm/icons/IconFileText.mjs";
import IconGitMerge from "@tabler/icons-react/dist/esm/icons/IconGitMerge.mjs";
import IconHourglass from "@tabler/icons-react/dist/esm/icons/IconHourglass.mjs";
import IconKey from "@tabler/icons-react/dist/esm/icons/IconKey.mjs";
import IconLink from "@tabler/icons-react/dist/esm/icons/IconLink.mjs";
import IconPlus from "@tabler/icons-react/dist/esm/icons/IconPlus.mjs";
import IconServer from "@tabler/icons-react/dist/esm/icons/IconServer.mjs";
import IconShieldCheck from "@tabler/icons-react/dist/esm/icons/IconShieldCheck.mjs";
import IconStarFilled from "@tabler/icons-react/dist/esm/icons/IconStarFilled.mjs";
import IconTag from "@tabler/icons-react/dist/esm/icons/IconTag.mjs";
import IconWorld from "@tabler/icons-react/dist/esm/icons/IconWorld.mjs";
import { expiryState, localDateString } from "./expiry.js";
import { ITEM_TYPES, itemTypeLabel } from "./itemTypes.js";
import { TYPE_TAG_TONE, daysUntilExpiry, displayDomain } from "./siteHelper.js";
import { useI18n } from "./i18n.js";

const REPORT_SECTION_KEYS = [
  ["weak", "vault.security.weak", "vault.security.weakHint"],
  ["reused", "vault.security.reused", "vault.security.reusedHint"],
  ["stale", "vault.security.stale", "vault.security.staleHint"],
  ["noTotp", "vault.security.noTotp", "vault.security.noTotpHint"],
];

export function SiteGlyph({ summary, size = 16 }) {
  if (summary.type === "server") return <IconServer size={size} aria-hidden="true" />;
  if (summary.type === "database") return <IconDatabase size={size} aria-hidden="true" />;
  if (summary.type === "secureNote") return <IconFileText size={size} aria-hidden="true" />;
  if (summary.type === "recoveryCodes") return <IconCheck size={size} aria-hidden="true" />;
  if (summary.siteUrl || summary.host) return <IconWorld size={size} aria-hidden="true" />;
  if (summary.type === "apiKey") return <IconKey size={size} aria-hidden="true" />;
  return <IconBox size={size} aria-hidden="true" />;
}

export default function SiteOverview({
  category,
  categoryName,
  summaries,
  allSummaries,
  search,
  sort,
  onSortChange,
  report,
  mergeGroups,
  now,
  onSelectSite,
  onNewItem,
  onOpenMerge,
  onOpenPasswordBoxImport,
}) {
  const { t } = useI18n();
  const [typeFilter, setTypeFilter] = useState("all");
  const today = localDateString(now);

  const visibleItems = useMemo(() => {
    if (typeFilter === "all") return summaries;
    return summaries.filter((entry) => (entry.credentialTypes ?? [entry.type]).includes(typeFilter));
  }, [summaries, typeFilter]);

  const totalCredentials = useMemo(
    () => visibleItems.reduce((sum, entry) => sum + (entry.credentialCount || 1), 0),
    [visibleItems],
  );

  const typeTabs = useMemo(() => {
    const counts = new Map();
    for (const entry of summaries) {
      for (const type of new Set(entry.credentialTypes ?? [entry.type])) {
        counts.set(type, (counts.get(type) || 0) + 1);
      }
    }
    return [
      ["all", t("vault.overview.filterAll"), summaries.length],
      ...Object.keys(ITEM_TYPES)
        .filter((key) => (counts.get(key) || 0) > 0)
        .map((key) => [key, itemTypeLabel(key, t), counts.get(key)]),
    ];
  }, [summaries, t]);

  const activeTypeFilter = typeTabs.some(([key]) => key === typeFilter) ? typeFilter : "all";

  if (category === "security") {
    return (
      <section className="notion-page notion-overview" aria-label={t("vault.overview.securityAria")}>
        <header className="notion-page-head">
          <h1>{t("vault.nav.security")}</h1>
          <p className="notion-page-sub">{t("vault.overview.securitySub")}</p>
        </header>

        {!report ? (
          <p className="vault-muted">{t("vault.checking")}</p>
        ) : (
          <div className="security-sections">
            {REPORT_SECTION_KEYS.map(([key, labelKey, hintKey]) => {
              const ids = key === "reused" ? [...new Set(report[key].flat())] : report[key];
              const entries = ids.map((id) => allSummaries.find((entry) => entry.id === id)).filter(Boolean);
              return (
                <section key={key} className="security-block">
                  <div className="security-block-head">
                    <h2>{t(labelKey)} · {entries.length}</h2>
                    <span className={`n-tag ${entries.length ? (key === "weak" || key === "reused" ? "red" : "yellow") : "green"}`}>
                      {entries.length ? t("vault.security.sitesCount", { count: entries.length }) : t("vault.security.noIssue")}
                    </span>
                  </div>
                  <p className="security-block-hint">{t(hintKey)}</p>
                  {entries.length > 0 && (
                    <div className="notion-list-rows">
                      {entries.map((entry) => (
                        <button key={entry.id} type="button" className="notion-list-row" onClick={() => onSelectSite(entry.id)}>
                          <SiteGlyph summary={entry} size={16} />
                          <span className="row-title">{entry.title}</span>
                          <span className="row-meta">{displayDomain(entry.siteUrl, entry.host || entry.subtitle || "")}</span>
                          <span className="n-tag">{t("vault.security.keysShort", { count: entry.credentialCount || 1 })}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="notion-page notion-overview" aria-label={t("vault.overview.aria")}>
      <header className="notion-page-head">
        <h1>{categoryName}</h1>
        <p className="notion-page-sub num">
          {t("vault.overview.summary", { sites: visibleItems.length, credentials: totalCredentials })}
        </p>
      </header>

      {category !== "trash" && mergeGroups.length > 0 && (
        <div className="notion-callout-bar" role="region" aria-label={t("vault.overview.mergeAria")}>
          <IconGitMerge size={16} aria-hidden="true" />
          <span>
            {t("vault.overview.mergeBanner", {
              count: mergeGroups.length,
              examples: mergeGroups.slice(0, 2).map((group) => group.siteName).join(" / "),
            })}
          </span>
          <button type="button" className="notion-link-action" onClick={onOpenMerge}>{t("vault.overview.mergeAction")}</button>
        </div>
      )}

      <div className="notion-db-bar">
        <div className="notion-db-tabs" role="tablist" aria-label={t("vault.overview.filterAria")}>
          {typeTabs.map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={activeTypeFilter === key}
              className={`notion-db-tab ${activeTypeFilter === key ? "is-active" : ""}`}
              onClick={() => setTypeFilter(key)}
            >
              <span>{label}</span>
              <small className="num">{count}</small>
            </button>
          ))}
        </div>
        <div className="notion-db-actions">
          <label className="notion-sort-inline">
            <span className="sr-only">{t("vault.overview.sortAria")}</span>
            <select aria-label={t("vault.overview.sortAria")} value={sort} onChange={(event) => onSortChange(event.target.value)}>
              <option value="updated">{t("vault.overview.sortUpdated")}</option>
              <option value="name">{t("vault.overview.sortName")}</option>
            </select>
          </label>
          {category !== "trash" && (
            <button type="button" className="n-primary" onClick={onNewItem}>
              <IconPlus size={14} aria-hidden="true" />{t("vault.overview.newBtn")}
            </button>
          )}
        </div>
      </div>

      {visibleItems.length > 0 ? (
        <div className="notion-table-wrap">
          <table className="notion-table">
            <thead>
              <tr>
                <th className="col-site"><span className="th-in"><IconWorld size={14} aria-hidden="true" />{t("vault.overview.colSite")}</span></th>
                <th className="col-domain"><span className="th-in"><IconLink size={14} aria-hidden="true" />{t("vault.overview.colDomain")}</span></th>
                <th className="col-count">{t("vault.overview.colCount")}</th>
                <th className="col-types"><span className="th-in"><IconTag size={14} aria-hidden="true" />{t("vault.overview.colTypes")}</span></th>
                <th className="col-status">{t("vault.overview.colStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((entry) => {
                const state = expiryState(entry.expiresAt, today);
                const days = daysUntilExpiry(entry.expiresAt, today);
                const types = entry.credentialTypes?.length ? entry.credentialTypes : [entry.type];
                const domainText = displayDomain(entry.siteUrl, entry.host || entry.subtitle || "—");
                return (
                  <tr key={entry.id} onClick={() => onSelectSite(entry.id)}>
                    <td className="col-site">
                      <button type="button" className="table-row-trigger" onClick={(event) => { event.stopPropagation(); onSelectSite(entry.id); }}>
                        <SiteGlyph summary={entry} size={15} />
                        <span className="row-name">{entry.title}</span>
                        {entry.favorite && <IconStarFilled size={12} className="star-mark" aria-label={t("vault.overview.starredAria")} />}
                        {state !== "none" && (
                          <span className={`n-tag inline-mobile-status ${state === "expired" ? "red" : "yellow"}`}>
                            {state === "expired" ? t("vault.overview.expired") : t("vault.overview.daysLaterShort", { days: Math.max(days ?? 0, 0) })}
                          </span>
                        )}
                      </button>
                    </td>
                    <td className="col-domain muted-cell">{domainText}</td>
                    <td className="col-count">
                      <span className={`n-tag num ${state === "expired" ? "red" : state === "soon" ? "yellow" : ""}`}>
                        {t("vault.security.keysShort", { count: entry.credentialCount || 1 })}
                      </span>
                    </td>
                    <td className="col-types">
                      <div className="tag-cluster">
                        {types.slice(0, 2).map((type) => (
                          <span key={type} className={`n-tag ${TYPE_TAG_TONE[type] || ""}`}>{itemTypeLabel(type, t)}</span>
                        ))}
                        {types.length > 2 && <span className="n-tag">+{types.length - 2}</span>}
                      </div>
                    </td>
                    <td className="col-status">
                      {state === "expired" ? (
                        <span className="n-tag red"><IconHourglass size={11} aria-hidden="true" />{t("vault.overview.expired")}</span>
                      ) : state === "soon" ? (
                        <span className="n-tag yellow num"><IconHourglass size={11} aria-hidden="true" />{t("vault.overview.daysLaterExpire", { days: Math.max(days ?? 0, 0) })}</span>
                      ) : entry.hasTotp ? (
                        <span className="n-tag green"><IconShieldCheck size={11} aria-hidden="true" />{t("vault.overview.has2fa")}</span>
                      ) : (
                        <span className="status-calm">{t("vault.overview.statusNormal")}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {category !== "trash" && (
            <button type="button" className="notion-table-add" onClick={onNewItem}>
              <IconPlus size={14} aria-hidden="true" />{t("vault.overview.addRow")}
            </button>
          )}
        </div>
      ) : (
        <div className="notion-empty-block">
          <IconAlertCircle size={22} aria-hidden="true" />
          <p>{search ? t("vault.overview.emptySearch", { search }) : category === "trash" ? t("vault.overview.emptyTrash") : t("vault.overview.emptyAll")}</p>
          {category !== "trash" && !search && (
            <div className="vault-actions">
              <button type="button" className="n-primary" onClick={onNewItem}><IconPlus size={14} />{t("vault.overview.createFirst")}</button>
              <button type="button" className="btn-line" onClick={onOpenPasswordBoxImport}><IconDownload size={14} />{t("vault.overview.importPasswordBox")}</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
