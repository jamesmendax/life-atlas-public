import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import IconArrowLeft from "@tabler/icons-react/dist/esm/icons/IconArrowLeft.mjs";
import IconCheck from "@tabler/icons-react/dist/esm/icons/IconCheck.mjs";
import IconChevronDown from "@tabler/icons-react/dist/esm/icons/IconChevronDown.mjs";
import IconChevronRight from "@tabler/icons-react/dist/esm/icons/IconChevronRight.mjs";
import IconDownload from "@tabler/icons-react/dist/esm/icons/IconDownload.mjs";
import IconHourglass from "@tabler/icons-react/dist/esm/icons/IconHourglass.mjs";
import IconKey from "@tabler/icons-react/dist/esm/icons/IconKey.mjs";
import IconLayersIntersect from "@tabler/icons-react/dist/esm/icons/IconLayersIntersect.mjs";
import IconLock from "@tabler/icons-react/dist/esm/icons/IconLock.mjs";
import IconMoon from "@tabler/icons-react/dist/esm/icons/IconMoon.mjs";
import IconPlus from "@tabler/icons-react/dist/esm/icons/IconPlus.mjs";
import IconSearch from "@tabler/icons-react/dist/esm/icons/IconSearch.mjs";
import IconSettings from "@tabler/icons-react/dist/esm/icons/IconSettings.mjs";
import IconShieldLock from "@tabler/icons-react/dist/esm/icons/IconShieldLock.mjs";
import IconStar from "@tabler/icons-react/dist/esm/icons/IconStar.mjs";
import IconStarFilled from "@tabler/icons-react/dist/esm/icons/IconStarFilled.mjs";
import IconSun from "@tabler/icons-react/dist/esm/icons/IconSun.mjs";
import IconTag from "@tabler/icons-react/dist/esm/icons/IconTag.mjs";
import IconTrash from "@tabler/icons-react/dist/esm/icons/IconTrash.mjs";
import IconUser from "@tabler/icons-react/dist/esm/icons/IconUser.mjs";
import IconX from "@tabler/icons-react/dist/esm/icons/IconX.mjs";
import { invokeVault } from "./api.js";
import PasswordForm, { PasswordInput, SetupSteps } from "./PasswordForm.jsx";
import ItemEditor from "./ItemEditor.jsx";
import ConfirmationDialog from "./ConfirmationDialog.jsx";
import ItemDetails from "./ItemDetails.jsx";
import Settings from "./Settings.jsx";
import CsvPreview from "./CsvPreview.jsx";
import PasswordBoxImport from "./PasswordBoxImport.jsx";
import MergeSitesDialog from "./MergeSitesDialog.jsx";
import SiteOverview, { SiteGlyph } from "./SiteOverview.jsx";
import { expiryState, localDateString } from "./expiry.js";
import { itemTypeLabel, ITEM_TYPES } from "./itemTypes.js";
import { findMergeableSiteGroups } from "./siteHelper.js";
import { createConfirmationQueue } from "./confirmationQueue.js";
import { useI18n } from "./i18n.js";

function ConfirmDialog({ request, onFinished }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [retryUntil, setRetryUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const passwordInput = useRef(null);
  useEffect(() => { const input = passwordInput.current; return () => { if (input) { input.value = ""; input.removeAttribute("value"); } }; }, []);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.ceil((retryUntil - now) / 1000));
  return (
    <div className="vault-scrim">
      <form
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        className="vault-dialog"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || seconds) return;
          setBusy(true);
          try {
            await invokeVault("confirmRequest", { requestId: request.requestId, password });
            setPassword("");
            onFinished(request.requestId);
          } catch (failure) {
            setPassword("");
            if (failure.code === "E_NOT_FOUND") onFinished(request.requestId);
            else {
              setError(failure.code === "E_BAD_PASSWORD" ? t("vault.badPassword") : failure.message);
              if (failure.retryAfterMs) setRetryUntil(Date.now() + failure.retryAfterMs);
              else if (failure.code === "E_BAD_PASSWORD") {
                try { const status = await invokeVault("status"); if (status.retryAfterMs) setRetryUntil(Date.now() + status.retryAfterMs); } catch {}
              }
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>{request.title}</h2>
        <p>{request.description}</p>
        <PasswordInput label={t("vault.confirmPasswordLabel")} value={password} onChange={setPassword} autoFocus ref={passwordInput} />
        {error && <p className="vault-error" role="alert">{error}</p>}
        {seconds > 0 && <p role="status">{t("vault.waitSeconds", { seconds })}</p>}
        <div className="vault-actions">
          <button
            type="button"
            className="btn-line"
            onClick={async () => {
              try { await invokeVault("rejectRequest", { requestId: request.requestId }); }
              catch (failure) { if (failure.code !== "E_NOT_FOUND") setError(failure.message); }
              finally { onFinished(request.requestId); }
            }}
          >
            {t("common.cancel")}
          </button>
          <button className="primary" disabled={!password || busy || seconds > 0}>{busy ? t("vault.verifying") : t("common.confirm")}</button>
        </div>
      </form>
    </div>
  );
}

function SubCredentialGlyph({ type }) {
  if (type === "login") return <IconUser size={13} aria-hidden="true" />;
  if (type === "recoveryCodes") return <IconCheck size={13} aria-hidden="true" />;
  return <IconKey size={13} aria-hidden="true" />;
}

export default function App() {
  const { t } = useI18n();
  const [generation, setGeneration] = useState(0);
  const [confirmations, setConfirmations] = useState([]);
  const confirmationQueue = useRef(null);
  useEffect(() => {
    if (!window.lifeAtlasVault) return;
    const queue = createConfirmationQueue({ onChange: setConfirmations });
    confirmationQueue.current = queue;
    const unsubscribeLock = window.lifeAtlasVault.onLocked(() => setGeneration((value) => value + 1));
    const unsubscribeConfirm = window.lifeAtlasVault.onConfirmRequest(queue.receive);
    document.documentElement.dataset.laVaultReady = "1";
    return () => {
      delete document.documentElement.dataset.laVaultReady;
      unsubscribeLock();
      unsubscribeConfirm();
      queue.dispose();
      confirmationQueue.current = null;
    };
  }, []);
  if (!window.lifeAtlasVault) {
    return (
      <div className="vault-unavailable">
        <IconShieldLock size={28} />
        <h1>{t("vault.desktopOnlyTitle")}</h1>
        <p>{t("vault.desktopOnlyBody")}</p>
      </div>
    );
  }
  return (
    <>
      <VaultSession key={generation} />
      {confirmations.length > 0 && (
        <ConfirmDialog
          key={`${generation}:${confirmations[0].requestId}`}
          request={confirmations[0]}
          onFinished={(requestId) => confirmationQueue.current?.remove(requestId)}
        />
      )}
    </>
  );
}

function VaultSession() {
  const { locale, t } = useI18n();
  const [screen, setScreen] = useState("loading");
  const [settings, setSettings] = useState({ autoLockMinutes: 5, clipboardClearSeconds: 30, lockOnMinimize: false, verifyBeforeReveal: false });
  const [themeMode, setThemeMode] = useState("light");
  const [password, setPassword] = useState("");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [lastGroups, setLastGroups] = useState("");
  const [resetPhrase, setResetPhrase] = useState("");
  const [resetDeadline, setResetDeadline] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryUntil, setRetryUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [summaries, setSummaries] = useState([]);
  const [item, setItem] = useState(null);
  const [itemRevision, setItemRevision] = useState(0);
  const [focusedCredentialId, setFocusedCredentialId] = useState(null);
  const [focusSeq, setFocusSeq] = useState(0);
  const [expandedTrees, setExpandedTrees] = useState(() => new Set());
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("updated");
  const [editing, setEditing] = useState(false);
  const [draftNumber, setDraftNumber] = useState(0);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const editorNavigation = useRef(null);
  const [report, setReport] = useState(null);
  const [csvPreview, setCsvPreview] = useState(null);
  const [quickImportOpen, setQuickImportOpen] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  const mounted = useRef(false);
  const activityAt = useRef(0);
  const selectionVersion = useRef(0);
  const searchInput = useRef(null);
  const mainScrollRef = useRef(null);
  const returnPointRef = useRef({ category: "all", itemId: null, credentialId: null, scrollTop: 0 });
  const themeOverrideRef = useRef(null);

  const navigate = useCallback((action) => {
    if (editorNavigation.current?.busy) return;
    if (editorNavigation.current?.dirty) setPendingNavigation(() => action);
    else action();
  }, []);

  const newItem = useCallback(() => navigate(() => {
    selectionVersion.current += 1;
    setItem(null);
    setFocusedCredentialId(null);
    setDraftNumber((value) => value + 1);
    setEditing(true);
    setCsvPreview(null);
    setScreen("main");
  }), [navigate]);

  const handleError = useCallback((failure) => {
    if (!mounted.current) return;
    setError(failure.message);
    if (failure.retryAfterMs) setRetryUntil(Date.now() + failure.retryAfterMs);
    else if (failure.code === "E_BAD_PASSWORD") {
      invokeVault("status").then((status) => {
        if (mounted.current && status.retryAfterMs) setRetryUntil(Date.now() + status.retryAfterMs);
      }).catch(() => {});
    }
  }, []);

  const refresh = useCallback(async (selectedId = null, focusCredId = null) => {
    const { summaries: values } = await invokeVault("list");
    if (!mounted.current) return;
    setSummaries(values);
    if (selectedId) {
      const version = ++selectionVersion.current;
      const details = await invokeVault("getItem", { id: selectedId });
      if (!mounted.current || selectionVersion.current !== version) return;
      setItem(details.item);
      setItemRevision((value) => value + 1);
      setFocusedCredentialId(focusCredId);
      if (focusCredId) setFocusSeq((value) => value + 1);
      if (details.item.credentials?.length) {
        setExpandedTrees((previous) => new Set([...previous, selectedId]));
      }
    } else {
      setItem(null);
      setFocusedCredentialId(null);
    }
  }, []);

  const selectItem = useCallback(async (id, credentialId = null) => {
    setError("");
    setNotice("");
    setEditing(false);
    setCsvPreview(null);
    setScreen("main");
    if (credentialId) {
      setExpandedTrees((previous) => new Set([...previous, id]));
    }
    const expected = ++selectionVersion.current;
    try {
      const result = await invokeVault("getItem", { id });
      if (mounted.current && expected === selectionVersion.current) {
        setItem(result.item);
        setItemRevision((value) => value + 1);
        setFocusedCredentialId(credentialId);
        if (credentialId) setFocusSeq((value) => value + 1);
        if ((result.item.credentials?.length ?? 0) > 1) {
          setExpandedTrees((previous) => (previous.has(id) ? previous : new Set([...previous, id])));
        }
      }
    } catch (failure) {
      handleError(failure);
    }
  }, [handleError]);

  const openSettings = useCallback(() => {
    if (screen !== "settings") {
      returnPointRef.current = {
        category: category === "settings" ? "all" : category,
        itemId: item?.id ?? null,
        credentialId: focusedCredentialId ?? null,
        scrollTop: mainScrollRef.current?.scrollTop ?? 0,
      };
    }
    selectionVersion.current += 1;
    setCategory("settings");
    setEditing(false);
    setCsvPreview(null);
    setError("");
    setNotice("");
    setScreen("settings");
  }, [screen, category, item, focusedCredentialId]);

  const exitSettings = useCallback(async () => {
    if (location.hash === "#settings") {
      try { window.history.replaceState(null, "", `${location.pathname}${location.search}`); } catch {}
    }
    const saved = returnPointRef.current;
    const nextCategory = saved.category && saved.category !== "settings" ? saved.category : "all";
    setCategory(nextCategory);
    setScreen("main");
    setError("");
    if (saved.itemId) {
      await selectItem(saved.itemId, saved.credentialId);
    } else {
      setItem(null);
      setFocusedCredentialId(null);
    }
    requestAnimationFrame(() => {
      if (mainScrollRef.current) mainScrollRef.current.scrollTop = saved.scrollTop || 0;
    });
  }, [selectItem]);

  async function passwordBoxImported({ importedCount, createdCount = 0, mergedCount = 0, duplicateCount, total }) {
    if (!mounted.current) return;
    setError("");
    const detail = importedCount > 0 ? t("vault.pbox.importedDetail", { created: createdCount, merged: mergedCount }) : "";
    setNotice(t("vault.pbox.importedNotice", { total, imported: importedCount, detail, dup: duplicateCount }));
    try {
      await refresh(screen === "main" && item?.id ? item.id : null, focusedCredentialId);
    } catch (failure) {
      handleError(failure);
    }
  }

  function toggleTheme() {
    const next = themeMode === "dark" ? "light" : "dark";
    themeOverrideRef.current = next;
    document.documentElement.dataset.vaultTheme = next;
    setThemeMode(next);
  }

  useEffect(() => {
    mounted.current = true;
    const root = document.documentElement;
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    let nativeMode;
    const applyTheme = () => {
      const resolved = themeOverrideRef.current ?? nativeMode ?? (systemTheme.matches ? "dark" : "light");
      root.dataset.vaultTheme = resolved;
      if (mounted.current) setThemeMode(resolved);
    };
    const receiveTheme = (mode) => {
      if (mode === "dark" || mode === "light") {
        nativeMode = mode;
        themeOverrideRef.current = null;
        applyTheme();
      }
    };
    systemTheme.addEventListener("change", applyTheme);
    applyTheme();
    const unsubscribeTheme = window.lifeAtlasVault.onThemeChanged?.(receiveTheme);
    const unsubscribeSettings = window.lifeAtlasVault.onSettingsChanged?.(setSettings);
    invokeVault("status").then(async (status) => {
      if (!mounted.current) return;
      if (nativeMode === undefined) receiveTheme(status.theme);
      setSettings(status.settings);
      if (status.retryAfterMs) setRetryUntil(Date.now() + status.retryAfterMs);
      if (!status.exists) setScreen("intro");
      else if (status.locked) setScreen("locked");
      else if (!status.recoveryConfirmed) setScreen("regenerate");
      else {
        await refresh();
        if (mounted.current) {
          if (location.hash === "#settings") {
            returnPointRef.current = { category: "all", itemId: null, scrollTop: 0 };
            setCategory("settings");
            setScreen("settings");
          } else {
            setScreen("main");
          }
        }
      }
    }).catch(handleError);
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => {
      mounted.current = false;
      unsubscribeTheme?.();
      unsubscribeSettings?.();
      systemTheme.removeEventListener("change", applyTheme);
      selectionVersion.current += 1;
      clearInterval(timer);
    };
  }, [handleError, refresh]);

  useEffect(() => {
    const sectionChanged = () => {
      if (location.hash === "#settings" && ["main", "settings", "edit-item"].includes(screen)) {
        navigate(() => openSettings());
      }
    };
    window.addEventListener("hashchange", sectionChanged);
    return () => window.removeEventListener("hashchange", sectionChanged);
  }, [screen, navigate, openSettings]);

  useEffect(() => {
    const activity = () => {
      if (!["main", "settings", "edit-item", "show-recovery-key", "confirm-recovery-key", "regenerate", "regenerate-settings", "change-password"].includes(screen) || Date.now() - activityAt.current < 15000) return;
      activityAt.current = Date.now();
      invokeVault("activity").catch(() => {});
    };
    const shortcut = (event) => {
      activity();
      // VP Review #1: Esc closes dialogs first; when no modal is open on Settings, Esc returns to Vault!
      if (event.key === "Escape") {
        if (document.querySelector('[aria-modal="true"]')) return;
        if (screen === "settings") {
          event.preventDefault();
          exitSettings();
        }
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "l") { event.preventDefault(); invokeVault("lock").catch(handleError); return; }
      if (document.querySelector('[aria-modal="true"]')) return;
      if (["main", "settings", "edit-item"].includes(screen) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInput.current?.focus();
      }
      if (["main", "settings", "edit-item"].includes(screen) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        newItem();
      }
    };
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", shortcut);
    return () => {
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", shortcut);
    };
  }, [screen, handleError, newItem, exitSettings]);

  async function run(operation) {
    if (busy) return;
    setBusy(true);
    setError("");
    try { await operation(); }
    catch (failure) { handleError(failure); }
    finally { if (mounted.current) setBusy(false); }
  }

  function flow(next) {
    setError("");
    setNotice("");
    setPassword("");
    setRecoveryInput("");
    setLastGroups("");
    setRecoveryKey("");
    setEditing(false);
    if (next === "reset") { setResetPhrase(""); setResetDeadline(Date.now() + 10000); }
    setScreen(next);
  }

  function renderAttachmentDownload(file, source, disabled = false) {
    if (!file) return null;
    return (
      <button
        type="button"
        className="vault-attachment-action"
        title={t("vault.att.downloadTitle")}
        aria-label={t("vault.att.downloadAria", { name: file.name })}
        disabled={busy || disabled}
        onClick={() => run(async () => {
          setNotice("");
          const result = await invokeVault("saveAttachmentCopy", { ...source, attachmentId: file.id });
          if (mounted.current && result.saved) setNotice(t("vault.att.savedNotice", { name: file.name }));
        })}
      >
        <IconDownload size={15} aria-hidden="true" />{t("vault.att.downloadBtn")}
      </button>
    );
  }

  function acceptRecovery(result) {
    if (!mounted.current) return;
    setPassword("");
    setRecoveryInput("");
    setRecoveryKey(result.recoveryKey);
    setScreen("show-recovery-key");
  }

  async function chooseCategory(next) {
    if (next === "settings") {
      openSettings();
      return;
    }
    selectionVersion.current += 1;
    setCategory(next);
    setEditing(false);
    setItem(null);
    setFocusedCredentialId(null);
    setCsvPreview(null);
    setError("");
    setNotice("");
    setScreen("main");
    if (next === "security") {
      try {
        const result = await invokeVault("securityReport");
        if (mounted.current) setReport(result);
      } catch (failure) {
        handleError(failure);
      }
    }
  }

  async function toggleFavoriteCurrent() {
    if (!item || item.deletedAt) return;
    try {
      await invokeVault("updateItem", { id: item.id, patch: { favorite: !item.favorite } });
      await refresh(item.id, focusedCredentialId);
    } catch (failure) {
      handleError(failure);
    }
  }

  const retrySeconds = Math.max(0, Math.ceil((retryUntil - now) / 1000));
  const resetSeconds = Math.max(0, Math.ceil((resetDeadline - now) / 1000));
  const isMain = ["main", "settings", "edit-item"].includes(screen);
  const active = useMemo(() => summaries.filter((entry) => !entry.deletedAt), [summaries]);
  const trashed = useMemo(() => summaries.filter((entry) => entry.deletedAt), [summaries]);
  const mergeGroups = useMemo(() => findMergeableSiteGroups(summaries), [summaries]);
  const tags = useMemo(() => [...new Set(active.flatMap((entry) => entry.tags))].sort(), [active]);
  const today = localDateString(now);

  const matchesSearch = useCallback((entry) => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return true;
    const credText = (entry.credentials ?? []).flatMap((cred) => [cred.label, cred.preview]).filter(Boolean);
    const haystack = [entry.title, entry.subtitle, entry.host, entry.siteName, entry.siteUrl, ...entry.tags, ...credText]
      .filter(Boolean).join(" ").toLocaleLowerCase();
    return haystack.includes(query);
  }, [search]);

  const sortEntries = useCallback((entries) => [...entries].sort((first, second) => (
    sort === "name" ? first.title.localeCompare(second.title, locale) : second.updatedAt.localeCompare(first.updatedAt)
  )), [locale, sort]);

  const filteredOverview = useMemo(() => sortEntries(summaries.filter((entry) => {
    if (category === "trash" ? !entry.deletedAt : entry.deletedAt) return false;
    if (category === "favorites" && !entry.favorite) return false;
    if (Object.hasOwn(ITEM_TYPES, category) && !(entry.credentialTypes ?? [entry.type]).includes(category)) return false;
    if (category.startsWith("tag:") && !entry.tags.includes(category.slice(4))) return false;
    if (category === "expiring" && expiryState(entry.expiresAt, today) === "none") return false;
    return matchesSearch(entry);
  })), [summaries, category, today, matchesSearch, sortEntries]);

  const treeSites = useMemo(() => sortEntries(active.filter(matchesSearch)), [active, matchesSearch, sortEntries]);

  const expiringCount = useMemo(
    () => active.filter((entry) => expiryState(entry.expiresAt, today) !== "none").length,
    [active, today],
  );
  const favoritesCount = useMemo(() => active.filter((entry) => entry.favorite).length, [active]);

  const categoryName = Object.hasOwn(ITEM_TYPES, category)
    ? itemTypeLabel(category, t)
    : ({
      all: t("vault.nav.all"),
      favorites: t("vault.nav.favorites"),
      trash: t("vault.nav.trash"),
      settings: t("vault.nav.settings"),
      expiring: t("vault.nav.expiring"),
      security: t("vault.nav.security"),
    })[category] || category.slice(4);

  const currentItemSummary = item ? summaries.find((entry) => entry.id === item.id) : null;
  const sameSiteSiblings = useMemo(() => {
    if (!currentItemSummary?.siteKey || currentItemSummary.deletedAt) return [];
    return active.filter((entry) => entry.id !== currentItemSummary.id && entry.siteKey === currentItemSummary.siteKey);
  }, [active, currentItemSummary]);

  function toggleTreeExpand(id) {
    setExpandedTrees((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="vw" data-screen={screen}>
      {!isMain && (
        <header className="vw-minimal-bar">
          <div className="vw-app">
            <span className="ws-avatar">L</span>
            <b>{t("vault.brand")}</b>
            <span className="vw-sub">Life Atlas</span>
          </div>
          <button
            type="button"
            className="n-icon"
            aria-label={themeMode === "dark" ? t("vault.topbar.lightMode") : t("vault.topbar.darkMode")}
            title={themeMode === "dark" ? t("vault.topbar.lightMode") : t("vault.topbar.darkMode")}
            onClick={toggleTheme}
          >
            {themeMode === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
          </button>
        </header>
      )}

      {screen === "loading" && (
        <main className="vw-lockscreen">
          <p role="status">{t("vault.loading")}</p>
          {error && <p role="alert" className="vault-error">{error}</p>}
        </main>
      )}

      {screen === "intro" && (
        <main className="vw-lockscreen intro">
          <IconShieldLock size={34} />
          <h1 className="lock-title">{t("vault.intro.title")}</h1>
          <p>{t("vault.intro.p1")}</p>
          <p>{t("vault.intro.p2")}</p>
          <p>{t("vault.intro.p3")}</p>
          <button className="primary" onClick={() => flow("create-password")}>{t("vault.intro.start")}</button>
        </main>
      )}

      {screen === "create-password" && (
        <main className="setup">
          <SetupSteps current={0} />
          <h1 className="lock-title">{t("vault.create.title")}</h1>
          <p className="lock-sub">{t("vault.create.sub")}</p>
          <PasswordForm
            busy={busy}
            error={error}
            onCancel={() => flow("intro")}
            onSubmit={(newPassword) => run(async () => acceptRecovery(await invokeVault("create", { password: newPassword })))}
          />
        </main>
      )}

      {screen === "change-password" && (
        <main className="setup">
          <SetupSteps current={0} />
          <h1 className="lock-title">{t("vault.change.title")}</h1>
          <p className="lock-sub">{t("vault.change.sub")}</p>
          <PasswordForm
            currentPasswordRequired
            busy={busy}
            error={error}
            onCancel={() => flow("settings")}
            onSubmit={(newPassword, currentPassword) => run(async () => acceptRecovery(await invokeVault("changePassword", { currentPassword, newPassword })))}
          />
        </main>
      )}

      {screen === "show-recovery-key" && (
        <main className="setup">
          <SetupSteps current={1} />
          <h1 className="lock-title">{t("vault.recovery.title")}</h1>
          <p className="lock-sub">{t("vault.recovery.sub")}</p>
          <pre className="recovery-key" aria-label={t("vault.recovery.aria")}>{recoveryKey}</pre>
          <div className="vault-actions">
            <button className="btn-line" onClick={() => run(async () => { const result = await invokeVault("saveRecoveryKit"); if (!result.cancelled) setNotice(t("vault.recovery.kitSaved")); })}>{t("vault.recovery.saveKit")}</button>
            <button className="btn-line" onClick={() => run(async () => { const result = await invokeVault("copyPendingRecoveryKey"); setNotice(t("vault.recovery.copied", { seconds: result.clearsInSeconds })); })}>{t("vault.recovery.copy")}</button>
          </div>
          {notice && <p role="status">{notice}</p>}
          {error && <p role="alert" className="vault-error">{error}</p>}
          <button className="primary recovery-next" onClick={() => { setRecoveryKey(""); flow("confirm-recovery-key"); }}>{t("vault.recovery.savedNext")}</button>
        </main>
      )}

      {screen === "confirm-recovery-key" && (
        <main className="setup">
          <SetupSteps current={2} />
          <h1 className="lock-title">{t("vault.confirmRec.title")}</h1>
          <p className="lock-sub">{t("vault.confirmRec.sub")}</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                await invokeVault("confirmRecoveryKey", { lastTwoGroups: lastGroups });
                setLastGroups("");
                await refresh();
                if (mounted.current) setScreen("main");
              });
            }}
          >
            <input
              className="recovery-confirm"
              aria-label={t("vault.confirmRec.aria")}
              autoFocus
              value={lastGroups}
              onChange={(event) => setLastGroups(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="XXXXX-XXXXX"
            />
            {error && <p className="vault-error" role="alert">{error}</p>}
            <div className="vault-actions">
              <button className="primary" disabled={!lastGroups || busy}>{t("vault.confirmRec.submit")}</button>
            </div>
          </form>
        </main>
      )}

      {screen === "locked" && (
        <main className={`vw-lockscreen vw-locked ${unlocking ? "is-unlocking" : ""}`}>
          <div className="lock-object" style={{ "--pw": Math.min([...password].length, 12) }} aria-hidden="true">
            <div className="lock-ring" />
            <div
              className="lock-disc"
              onTransitionEnd={() => {
                if (unlocking) {
                  setUnlocking(false);
                  if (location.hash === "#settings") {
                    returnPointRef.current = { category: "all", itemId: null, scrollTop: 0 };
                    setCategory("settings");
                    setScreen("settings");
                  } else {
                    setScreen("main");
                  }
                }
              }}
            >
              <span className="keyhole"><i /><b /></span>
            </div>
          </div>
          <h1 className="lock-title">{t("vault.locked.title")}</h1>
          <p className="lock-sub">{t("vault.locked.sub", { minutes: settings.autoLockMinutes })}</p>
          <form
            className="lock-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (retrySeconds) return;
              run(async () => {
                const result = await invokeVault("unlock", { password });
                if (!mounted.current) return;
                setPassword("");
                setRetryUntil(0);
                setSummaries(result.summaries);
                if (result.requiresRecoveryKeyRegeneration) flow("regenerate");
                else if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                  if (location.hash === "#settings") {
                    returnPointRef.current = { category: "all", itemId: null, scrollTop: 0 };
                    setCategory("settings");
                    setScreen("settings");
                  } else {
                    setScreen("main");
                  }
                } else {
                  setUnlocking(true);
                }
              });
            }}
          >
            <PasswordInput label={t("vault.locked.password")} value={password} onChange={setPassword} autoFocus />
            <button className="lock-submit" disabled={!password || busy || retrySeconds > 0}>{busy ? t("vault.unlocking") : t("vault.unlock")}</button>
          </form>
          {error && <p className="vault-error" role="alert">{error}</p>}
          {retrySeconds > 0 && <p role="status" className="lock-countdown">{t("vault.waitSeconds", { seconds: retrySeconds })}</p>}
          <div className="lock-foot">
            <button className="text-link" onClick={() => flow("recover-with-key")}>{t("vault.locked.forgotKey")}</button>
            <button className="text-link lock-foot-minor" onClick={() => flow("reset")}>{t("vault.locked.forgotAll")}</button>
          </div>
        </main>
      )}

      {screen === "recover-with-key" && (
        <main className="setup">
          <SetupSteps current={0} names={[t("vault.recover.step1"), t("vault.recover.step2"), t("vault.recover.step3")]} />
          <h1 className="lock-title">{t("vault.recover.title")}</h1>
          <p className="lock-sub">{t("vault.recover.sub")}</p>
          <label className="recovery-input-label">
            {t("vault.recover.label")}
            <textarea aria-label={t("vault.recover.aria")} value={recoveryInput} onChange={(event) => setRecoveryInput(event.target.value)} rows={3} autoFocus autoComplete="off" spellCheck={false} />
          </label>
          <PasswordForm
            busy={busy}
            error={error}
            onCancel={() => flow("locked")}
            onSubmit={(newPassword) => run(async () => acceptRecovery(await invokeVault("unlockWithRecoveryKey", { recoveryKey: recoveryInput, newPassword })))}
          />
        </main>
      )}

      {(screen === "regenerate" || screen === "regenerate-settings") && (
        <main
          className="setup"
          onKeyDown={(event) => {
            if (screen === "regenerate-settings" && event.key === "Escape" && !busy) {
              event.preventDefault();
              flow("settings");
            }
          }}
        >
          <SetupSteps current={0} />
          <h1 className="lock-title">{t("vault.regen.title")}</h1>
          <p className="lock-sub">{screen === "regenerate-settings" ? t("vault.regen.subSettings") : t("vault.regen.subRequired")}</p>
          <form
            className="setup-form"
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => acceptRecovery(await invokeVault("regenerateRecoveryKey", { password })));
            }}
          >
            <PasswordInput label={t("vault.regen.password")} value={password} onChange={setPassword} autoFocus />
            {error && <p role="alert" className="vault-error">{error}</p>}
            <button className="primary" disabled={!password || busy}>{t("vault.regen.submit")}</button>
            {screen === "regenerate-settings" && <button type="button" className="btn-line" disabled={busy} onClick={() => flow("settings")}>{t("common.cancel")}</button>}
          </form>
        </main>
      )}

      {screen === "reset" && (
        <main className="setup">
          <SetupSteps current={1} names={[t("vault.reset.step1"), t("vault.reset.step2"), t("vault.reset.step3")]} />
          <h1 className="lock-title">{t("vault.reset.title")}</h1>
          <p className="reset-description">{t("vault.reset.desc")}</p>
          <form
            className="setup-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (resetSeconds || resetPhrase !== "重置我的密钥库") return;
              run(async () => {
                await invokeVault("resetVault", { confirmPhrase: resetPhrase });
                if (mounted.current) flow("intro");
              });
            }}
          >
            <label className="editor-label">
              {t("vault.reset.inputLabel")}
              <input aria-label={t("vault.reset.inputAria")} value={resetPhrase} onChange={(event) => setResetPhrase(event.target.value)} autoFocus />
            </label>
            {error && <p role="alert" className="vault-error">{error}</p>}
            <button className="danger" disabled={resetPhrase !== "重置我的密钥库" || resetSeconds > 0 || busy}>
              {resetSeconds ? t("vault.reset.wait", { seconds: resetSeconds }) : t("vault.reset.confirm")}
            </button>
            <button
              type="button"
              className="btn-line"
              onClick={() => run(async () => { const status = await invokeVault("status"); flow(status.locked ? "locked" : "settings"); })}
            >
              {t("common.cancel")}
            </button>
          </form>
        </main>
      )}

      {/* Scheme 2: Authentic Notion Two-Pane Shell (Left Collapsible Site Tree + Right Full-Page Canvas) */}
      {isMain && (
        <div className="notion-shell">
          <aside className="notion-sidebar" aria-label={t("vault.navAria")}>
            <div className="ws-head">
              <span className="ws-avatar" aria-hidden="true">L</span>
              <span className="ws-name">{t("vault.brand")}</span>
              <button type="button" className="n-icon" aria-label={t("vault.newSiteAria")} title={t("vault.newSiteTooltip")} onClick={newItem}>
                <IconPlus size={16} />
              </button>
            </div>

            <label className="sb-search">
              <IconSearch size={15} aria-hidden="true" />
              <input
                ref={searchInput}
                aria-label={t("vault.searchAria")}
                value={search}
                placeholder={t("vault.searchPlaceholder")}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search ? (
                <button type="button" className="sb-search-clear" aria-label={t("vault.clearSearch")} onClick={() => setSearch("")}>
                  <IconX size={13} />
                </button>
              ) : (
                <span className="sb-kbd">Ctrl F</span>
              )}
            </label>

            <div className="sb-nav-group">
              <button
                type="button"
                className={`sb-row ${screen === "main" && !item && !editing && category === "all" ? "is-active" : ""}`}
                onClick={() => navigate(() => chooseCategory("all"))}
              >
                <IconLayersIntersect size={15} /><span>{t("vault.nav.all")}</span><small className="num">{active.length}</small>
              </button>
              <button
                type="button"
                className={`sb-row ${screen === "main" && !item && !editing && category === "favorites" ? "is-active" : ""}`}
                onClick={() => navigate(() => chooseCategory("favorites"))}
              >
                <IconStar size={15} /><span>{t("vault.nav.favorites")}</span><small className="num">{favoritesCount}</small>
              </button>
              <button
                type="button"
                className={`sb-row ${screen === "main" && !item && !editing && category === "expiring" ? "is-active" : ""}`}
                onClick={() => navigate(() => chooseCategory("expiring"))}
              >
                <IconHourglass size={15} /><span>{t("vault.nav.expiring")}</span><small className={`num ${expiringCount ? "is-warn" : ""}`}>{expiringCount}</small>
              </button>
              <button
                type="button"
                className={`sb-row ${screen === "main" && !item && !editing && category === "security" ? "is-active" : ""}`}
                onClick={() => navigate(() => chooseCategory("security"))}
              >
                <IconShieldLock size={15} /><span>{t("vault.nav.security")}</span>
              </button>
            </div>

            <div className="sb-tree-scroll">
              <div className="sb-section-head">
                <span>{t("vault.sidebar.mySites")}</span>
                {mergeGroups.length > 0 && (
                  <button type="button" className="sb-section-action" onClick={() => setMergeDialogOpen(true)}>
                    {t("vault.sidebar.mergeGroups", { count: mergeGroups.length })}
                  </button>
                )}
              </div>

              <div className="sb-tree-list" role="list" aria-label={t("vault.sidebar.treeAria")}>
                {treeSites.map((summary) => {
                  const hasChildren = (summary.credentials?.length ?? 0) > 1;
                  const isExpanded = hasChildren && expandedTrees.has(summary.id);
                  const isSelected = item?.id === summary.id && screen === "main" && !editing;
                  return (
                    <div key={summary.id} className="sb-tree-node" role="listitem">
                      <div className={`vw-item sb-tree-row ${isSelected ? "is-active" : ""}`}>
                        {hasChildren ? (
                          <button
                            type="button"
                            className="tree-disclosure"
                            aria-label={isExpanded ? t("vault.sidebar.collapseSite", { title: summary.title }) : t("vault.sidebar.expandSite", { title: summary.title })}
                            aria-expanded={isExpanded}
                            onClick={(event) => { event.stopPropagation(); toggleTreeExpand(summary.id); }}
                          >
                            {isExpanded ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
                          </button>
                        ) : (
                          <span className="tree-disclosure-spacer" aria-hidden="true" />
                        )}
                        <button
                          type="button"
                          className="tree-site-btn"
                          onClick={() => navigate(() => selectItem(summary.id, null))}
                        >
                          <SiteGlyph summary={summary} size={15} />
                          <span className="tree-label">{summary.title}</span>
                          {(summary.credentialCount || 1) > 1 && <small className="tree-cnt num">{summary.credentialCount}</small>}
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="sb-tree-children">
                          {summary.credentials.map((cred) => (
                            <button
                              key={cred.id}
                              type="button"
                              className={`sb-tree-child ${isSelected && focusedCredentialId === cred.id ? "is-focus" : ""}`}
                              onClick={() => navigate(() => selectItem(summary.id, cred.id))}
                            >
                              <SubCredentialGlyph type={cred.type} />
                              <span className="tree-label">{cred.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {!treeSites.length && (
                  <p className="sb-empty">{search ? t("vault.sidebar.emptySearch") : t("vault.sidebar.empty")}</p>
                )}
              </div>

              {tags.length > 0 && (
                <>
                  <div className="sb-section-head"><span>{t("vault.sidebar.tags")}</span></div>
                  <div className="sb-tags-list">
                    {tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className={`sb-row ${screen === "main" && !item && category === `tag:${tag}` ? "is-active" : ""}`}
                        onClick={() => navigate(() => chooseCategory(`tag:${tag}`))}
                      >
                        <IconTag size={14} /><span>{tag}</span>
                        <small className="num">{active.filter((entry) => entry.tags.includes(tag)).length}</small>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="sb-foot">
              <button type="button" className="sb-row" onClick={() => navigate(() => setQuickImportOpen(true))}>
                <IconDownload size={15} /><span>{t("vault.nav.importAndMerge")}</span>
              </button>
              <button
                type="button"
                className={`sb-row ${screen === "main" && !item && category === "trash" ? "is-active" : ""}`}
                onClick={() => navigate(() => chooseCategory("trash"))}
              >
                <IconTrash size={15} /><span>{t("vault.nav.trash")}</span><small className="num">{trashed.length}</small>
              </button>
              <button
                type="button"
                className={`sb-row ${screen === "settings" ? "is-active" : ""}`}
                onClick={() => navigate(() => chooseCategory("settings"))}
              >
                <IconSettings size={15} /><span>{t("vault.nav.settings")}</span>
              </button>
            </div>
          </aside>

          {/* Right Full-Page Notion Canvas */}
          <div className="notion-main">
            <header className="notion-topbar">
              <nav className="notion-crumb" aria-label={t("vault.crumbAria")}>
                {screen === "settings" ? (
                  <button type="button" className="crumb-btn" onClick={exitSettings}>
                    <IconArrowLeft size={14} aria-hidden="true" />{t("vault.backToVault")}
                  </button>
                ) : (
                  <>
                    <button type="button" className="crumb-btn crumb-muted" onClick={() => navigate(() => chooseCategory("all"))}>
                      {t("vault.brand")}
                    </button>
                    <span className="crumb-sep" aria-hidden="true">/</span>
                    {item ? (
                      <>
                        {item.tags[0] && (
                          <>
                            <button type="button" className="crumb-btn crumb-muted" onClick={() => navigate(() => chooseCategory(`tag:${item.tags[0]}`))}>
                              {item.tags[0]}
                            </button>
                            <span className="crumb-sep" aria-hidden="true">/</span>
                          </>
                        )}
                        <span className="crumb-current">
                          <SiteGlyph summary={{ type: item.type, siteUrl: item.site?.url }} size={14} />
                          <span>{item.title}</span>
                        </span>
                      </>
                    ) : (
                      <span className="crumb-current">{editing ? t("vault.newItem") : categoryName}</span>
                    )}
                  </>
                )}
              </nav>

              <div className="notion-topbar-right">
                <span className="topbar-idle num">{t("vault.topbar.idle", { minutes: settings.autoLockMinutes })}</span>
                {item && screen === "main" && !editing && !item.deletedAt && (
                  <button
                    type="button"
                    className={`n-icon ${item.favorite ? "is-starred" : ""}`}
                    aria-label={item.favorite ? t("vault.topbar.unstar") : t("vault.topbar.star")}
                    title={item.favorite ? t("vault.topbar.unstar") : t("vault.topbar.star")}
                    onClick={toggleFavoriteCurrent}
                  >
                    {item.favorite ? <IconStarFilled size={15} /> : <IconStar size={15} />}
                  </button>
                )}
                <button
                  type="button"
                  className="n-icon"
                  aria-label={themeMode === "dark" ? t("vault.topbar.lightMode") : t("vault.topbar.darkMode")}
                  title={themeMode === "dark" ? t("vault.topbar.lightMode") : t("vault.topbar.darkMode")}
                  onClick={toggleTheme}
                >
                  {themeMode === "dark" ? <IconSun size={15} /> : <IconMoon size={15} />}
                </button>
                <button
                  type="button"
                  className="n-ghost n-ghost-ink"
                  aria-label={t("vault.lock")}
                  title={t("vault.lockTooltip")}
                  onClick={() => invokeVault("lock").catch(handleError)}
                >
                  <IconLock size={14} aria-hidden="true" />{t("vault.lock")}
                </button>
              </div>
            </header>

            <main ref={mainScrollRef} className="notion-canvas-scroll">
              {error && <p className="vault-error panel-message" role="alert">{error}</p>}
              {notice && <p className="panel-message panel-notice" role="status">{notice}</p>}

              {csvPreview ? (
                <CsvPreview
                  preview={csvPreview}
                  onError={handleError}
                  onCancel={() => setCsvPreview(null)}
                  onDone={async (result) => {
                    await refresh();
                    if (mounted.current) {
                      setCsvPreview(null);
                      setNotice(t("vault.csv.done", {
                        count: result.importedCount,
                        extra: result.deletedSourceFile ? t("vault.csv.doneDeleted") : t("vault.csv.doneKeep"),
                      }));
                    }
                  }}
                />
              ) : editing ? (
                <ItemEditor
                  renderAttachmentDownload={renderAttachmentDownload}
                  key={item?.id || `new-item-${draftNumber}`}
                  item={item}
                  navigationState={editorNavigation}
                  onCancel={() => navigate(() => setEditing(false))}
                  onError={handleError}
                  onSaved={async (id) => {
                    await refresh(id);
                    if (mounted.current) setEditing(false);
                  }}
                />
              ) : screen === "settings" ? (
                <Settings
                  settings={settings}
                  mergeGroupsCount={mergeGroups.length}
                  onSettings={setSettings}
                  onError={handleError}
                  onBack={exitSettings}
                  onOpenMerge={() => setMergeDialogOpen(true)}
                  onPasswordBoxImported={passwordBoxImported}
                  onFlow={(next) => flow(next === "regenerate" ? "regenerate-settings" : next)}
                  onImport={() => run(async () => {
                    const result = await invokeVault("importBrowserCsv");
                    if (!result.cancelled && mounted.current) setCsvPreview(result);
                  })}
                />
              ) : item ? (
                <ItemDetails
                  renderAttachmentDownload={renderAttachmentDownload}
                  key={`${item.id}:${itemRevision}`}
                  item={item}
                  focusedCredentialId={focusedCredentialId}
                  focusSeq={focusSeq}
                  sameSiteSiblings={sameSiteSiblings}
                  onError={handleError}
                  onEdit={() => setEditing(true)}
                  onOpenMerge={() => setMergeDialogOpen(true)}
                  onChanged={(id, focusCredId = null) => refresh(id, focusCredId).catch(handleError)}
                  onSplitCreated={(createdId) => {
                    setNotice(t("vault.details.splitDone"));
                    refresh(createdId).catch(handleError);
                  }}
                />
              ) : (
                <SiteOverview
                  category={category}
                  categoryName={categoryName}
                  summaries={filteredOverview}
                  allSummaries={summaries}
                  search={search}
                  sort={sort}
                  onSortChange={setSort}
                  report={report}
                  mergeGroups={mergeGroups}
                  now={now}
                  onSelectSite={(id) => navigate(() => selectItem(id))}
                  onNewItem={newItem}
                  onOpenMerge={() => setMergeDialogOpen(true)}
                  onOpenPasswordBoxImport={() => setQuickImportOpen(true)}
                />
              )}
            </main>
          </div>
        </div>
      )}

      {quickImportOpen && (
        <PasswordBoxImport
          onClose={() => setQuickImportOpen(false)}
          onImported={(result) => {
            setQuickImportOpen(false);
            passwordBoxImported(result);
          }}
        />
      )}

      {mergeDialogOpen && mergeGroups.length > 0 && (
        <MergeSitesDialog
          groups={mergeGroups}
          onClose={() => setMergeDialogOpen(false)}
          onError={handleError}
          onPartialRefresh={() => refresh(item?.id ?? null, focusedCredentialId).catch(handleError)}
          onMerged={async ({ mergedGroups, mergedItems, targetId }) => {
            setMergeDialogOpen(false);
            setNotice(t("vault.merge.done", { groups: mergedGroups, items: mergedItems }));
            await refresh(targetId);
          }}
        />
      )}

      {pendingNavigation && (
        <ConfirmationDialog
          title={t("vault.cred.discardTitleMain")}
          description={t("vault.cred.discardDescMain")}
          danger
          cancelLabel={t("vault.cred.continueEdit")}
          confirmLabel={t("vault.cred.discardChanges")}
          onCancel={() => setPendingNavigation(null)}
          onConfirm={() => { setPendingNavigation(null); pendingNavigation(); }}
        />
      )}
    </div>
  );
}
