import { useMemo } from "react";
import IconBooks from "@tabler/icons-react/dist/esm/icons/IconBooks.mjs";
import IconArchive from "@tabler/icons-react/dist/esm/icons/IconArchive.mjs";
import IconClock from "@tabler/icons-react/dist/esm/icons/IconClock.mjs";
import IconPlus from "@tabler/icons-react/dist/esm/icons/IconPlus.mjs";
import IconTemplate from "@tabler/icons-react/dist/esm/icons/IconTemplate.mjs";
import { AppearanceGlyph } from "./AppearanceGlyph.jsx";
import { recentGroups } from "../domain/recents.js";
import { favoritePages } from "../domain/favorites.js";
import { greeting, upcomingRecords } from "../domain/home.js";
import { localDateString } from "../templates/dates.js";
import { format, useI18n } from "../i18n/workspaceRuntime.js";

const GREETING_KEYS = {
  早上好: "home.greeting.morning",
  下午好: "home.greeting.afternoon",
  晚上好: "home.greeting.evening",
};

const RECENT_GROUP_KEYS = {
  今天: "recents.group.today",
  昨天: "recents.group.yesterday",
  "过去 7 天": "recents.group.week",
  更早: "recents.group.earlier",
};

function compactDate(value, now, locale, t) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return localDateString(date.getTime()) === localDateString(now)
    ? t("home.todayTime", { time: date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false }) })
    : t("home.monthDay", { month: date.getMonth() + 1, day: date.getDate() });
}

export function WorkspaceHome({ workspace, workspaceName, now, onOpenPage, onCreatePage, onOpenTemplates, onOpenLibrary, onOpenBackup, backupStatus }) {
  const { locale, t } = useI18n();
  const recent = useMemo(() => recentGroups(workspace, now).flatMap((group) => group.entries).slice(0, 6), [workspace, now]);
  const favorites = useMemo(() => favoritePages(workspace).slice(0, 8), [workspace]);
  const upcoming = useMemo(() => upcomingRecords(workspace, localDateString(now)), [workspace, now]);
  const date = new Date(now);
  const backupTime = backupStatus?.lastFullBackupAt ? new Date(backupStatus.lastFullBackupAt).getTime() : null;
  const backupDays = backupTime === null ? null : Math.floor((now - backupTime) / 86400000);
  const needsBackup = backupStatus && (backupTime === null || backupDays >= 7);
  const greetingText = t(GREETING_KEYS[greeting(now)] || "home.greeting.morning");
  const weekday = locale.startsWith("zh") ? "日一二三四五六"[date.getDay()] : format.formatWeekday(date.getDay(), locale, "short");
  const displayTitle = (title) => (title === "无标题页面" ? t("backlinks.untitled") : title === "新数据库" ? t("app.msg.newDb") : title || t("backlinks.untitled"));
  return <div className="home-page">
    <header className="home-masthead"><div className="home-date">{t("home.mastheadDate", { month: date.getMonth() + 1, day: date.getDate(), weekday })}</div><h1 className="home-hello">{t("home.greetingLine", { greeting: greetingText, name: workspaceName })}</h1>{upcoming.length > 0 && <p>{t("home.upcomingSummary", { count: upcoming.length })}</p>}</header>
    {recent.length > 0 && <section className="home-section" aria-label={t("home.recentPages")}><div className="home-title"><h2>{t("home.recentPages")}</h2><span><IconClock size={12} />{t("home.chronological")}</span></div><div className="home-recent-row">{recent.map((entry) => <button type="button" className="home-recent-card" key={entry.pageId} onClick={() => onOpenPage(entry.pageId)}><AppearanceGlyph icon={entry.icon} color={entry.iconColor} className="home-recent-icon" /><strong>{displayTitle(entry.title)}</strong><small>{compactDate(workspace.pages.find((page) => page.id === entry.pageId)?.updatedAt || entry.visitedAt, now, locale, t)}</small></button>)}</div></section>}
    <div className="home-cols">
      {upcoming.length > 0 && <section className="home-section home-upcoming" aria-label={t("home.upcomingTitle")}><div className="home-title"><h2>{t("home.upcomingTitle")}</h2><span>{t("home.next7Days")}</span></div><div className="home-list">{upcoming.map((entry) => <button type="button" className="home-list-row" key={`${entry.pageId}:${entry.date}`} onClick={() => onOpenPage(entry.pageId)}><time>{t("home.monthDay", { month: Number(entry.date.slice(5, 7)), day: Number(entry.date.slice(8, 10)) })}</time><strong>{displayTitle(entry.title)}</strong><small>{entry.sourceTitle}</small></button>)}</div></section>}
      <div className={`home-section home-secondary${upcoming.length ? "" : " is-alone"}`}>
        {favorites.length > 0 && <section aria-label={t("sidebar.favorites")}><div className="home-title"><h2>{t("sidebar.favorites")}</h2><span>{t("home.pageCount", { count: favorites.length })}</span></div><div className="home-list">{favorites.map((page) => <button type="button" className="home-list-row" key={page.id} onClick={() => onOpenPage(page.id)}><AppearanceGlyph icon={page.icon} color={page.iconColor} className="home-favorite-icon" /><strong>{displayTitle(page.title)}</strong></button>)}</div></section>}
        <section className={favorites.length ? "home-title-gap" : ""} aria-label={t("home.quickActions")}><div className="home-title"><h2>{t("home.quickActions")}</h2></div><div className="home-actions"><button type="button" onClick={onCreatePage}><IconPlus size={14} />{t("nav.newPage")}</button><button type="button" onClick={onOpenTemplates}><IconTemplate size={14} />{t("home.openMarket")}</button><button type="button" onClick={onOpenLibrary}><IconBooks size={14} />{t("home.openLibrary")}</button></div>{needsBackup && <div className="home-notice"><IconArchive size={16} /><span>{backupDays === null ? t("home.neverBackedUp") : t("home.daysSinceBackup", { days: backupDays })}</span><button type="button" onClick={onOpenBackup}>{t("home.backupNow")}</button></div>}</section>
      </div>
    </div>
  </div>;
}

export function RecentPages({ workspace, now, onOpenPage }) {
  const { locale, t } = useI18n();
  const groups = useMemo(() => recentGroups(workspace, now), [workspace, now]);
  const displayTitle = (title) => (title === "无标题页面" ? t("backlinks.untitled") : title === "新数据库" ? t("app.msg.newDb") : title || t("backlinks.untitled"));
  return <div className="page-view recents-view"><header className="page-heading page-heading-with-meta"><div><h1>{t("home.recentPages")}</h1><p>{t("recents.subtitle")}</p></div><span className="quiet-count">{t("recents.itemCount", { count: groups.reduce((count, group) => count + group.entries.length, 0) })}</span></header>{groups.length ? groups.map((group) => <section className="recents-group" key={group.label}><h2 className="recents-group-title">{t(RECENT_GROUP_KEYS[group.label] || "recents.group.earlier")}</h2><div className="recent-list">{group.entries.map((entry) => <button type="button" className="recent-card" key={entry.pageId} data-page-id={entry.pageId} onClick={() => onOpenPage(entry.pageId)}><AppearanceGlyph icon={entry.icon} color={entry.iconColor} className="recent-icon" /><span className="recent-copy"><strong>{displayTitle(entry.title)}</strong><small>{entry.path}</small></span><time className="recent-time">{["今天", "昨天"].includes(group.label) ? new Date(entry.visitedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false }) : compactDate(entry.visitedAt, now, locale, t)}</time></button>)}</div></section>) : <p className="recents-empty">{t("recents.empty")}</p>}</div>;
}
