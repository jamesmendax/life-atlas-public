import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import IconArrowLeft from "@tabler/icons-react/dist/esm/icons/IconArrowLeft.mjs";
import IconArrowUpRight from "@tabler/icons-react/dist/esm/icons/IconArrowUpRight.mjs";
import IconCheck from "@tabler/icons-react/dist/esm/icons/IconCheck.mjs";
import IconColumns from "@tabler/icons-react/dist/esm/icons/IconColumns.mjs";
import IconDatabase from "@tabler/icons-react/dist/esm/icons/IconDatabase.mjs";
import IconDownload from "@tabler/icons-react/dist/esm/icons/IconDownload.mjs";
import IconFileText from "@tabler/icons-react/dist/esm/icons/IconFileText.mjs";
import IconMaximize from "@tabler/icons-react/dist/esm/icons/IconMaximize.mjs";
import IconPackage from "@tabler/icons-react/dist/esm/icons/IconPackage.mjs";
import IconPhoto from "@tabler/icons-react/dist/esm/icons/IconPhoto.mjs";
import IconPlayerPlay from "@tabler/icons-react/dist/esm/icons/IconPlayerPlay.mjs";
import IconRefresh from "@tabler/icons-react/dist/esm/icons/IconRefresh.mjs";
import IconSearch from "@tabler/icons-react/dist/esm/icons/IconSearch.mjs";
import IconSparkles from "@tabler/icons-react/dist/esm/icons/IconSparkles.mjs";
import IconTemplate from "@tabler/icons-react/dist/esm/icons/IconTemplate.mjs";
import IconUpload from "@tabler/icons-react/dist/esm/icons/IconUpload.mjs";
import IconX from "@tabler/icons-react/dist/esm/icons/IconX.mjs";
import { BUILTIN_TEMPLATES } from "../templates/registry.js";
import { TemplatePreview } from "../templates/previews.jsx";
import { isPageArchived } from "../domain/archive.js";
import { defaultTemplateFolderId, pageTemplateDescription, pageTemplatePreview, templateFolderChoices } from "../domain/templates.js";
import { marketShelf } from "../domain/marketGallery.js";
import { MarketWidgetSandbox } from "../editor/widgets/MarketWidgetHost.jsx";
import { MobaiTargetPicker } from "./MobaiTargetPicker.jsx";
import { Dialog, hasOpenModal } from "../ui/Dialog.jsx";
import { useDialogs } from "../ui/DialogProvider.jsx";
import { isComposingKeyboardEvent } from "../ui/keyboard.js";
import { useI18n } from "../i18n/workspaceRuntime.js";

const SCENE_IDS = ["focus", "dev", "travel", "finance", "creative", "mine", "other"];

function sizeText(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function unwrap(result, fallbackMessage) {
  if (!result?.ok) throw new Error(result?.error?.message || fallbackMessage);
  return result.value;
}

function classifyScene(item) {
  if (item.scope === "mine") return "mine";
  if (item.scope === "builtin") return item.raw?.category === "开发" ? "dev" : "focus";
  const text = `${item.id || ""} ${item.title || ""} ${item.description || ""}`.toLocaleLowerCase();
  if (/travel|footprint|trip|itinerary|packing|旅行|足迹|路线|地图|打包/.test(text)) return "travel";
  if (/mingzhang|decision|账|储蓄|收支|决策|复盘/.test(text)) return "finance";
  if (/whiteboard|carbon|白板|代码卡片|excalidraw/.test(text)) return "creative";
  if (/roadmap|dev|开发|研发/.test(text)) return "dev";
  if (/pomodoro|habit|study|clock|ambient|countdown|flashcard|番茄|习惯|学习|时钟|白噪音|倒计时|闪卡/.test(text)) return "focus";
  return "other";
}

function workKindLabel(work, t) {
  if (work.scope === "builtin") return t("market.kind.builtin");
  if (work.scope === "mine") return t("market.kind.mine");
  return work.kind === "component" ? t("market.kind.component") : t("market.kind.template");
}

function primarySummary(description) {
  return String(description || "").split(/\r?\n/u)[0].trim();
}

function MarketCardCover({ work, workspace, thumbUrl, onNeedThumb, t }) {
  const hostRef = useRef(null);

  useEffect(() => {
    if (work.scope !== "official" || !work.hasPreview || thumbUrl !== undefined) return undefined;
    const node = hostRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      onNeedThumb(work);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        onNeedThumb(work);
      }
    }, { rootMargin: "160px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [work, thumbUrl, onNeedThumb]);

  if (work.scope === "builtin") {
    return (
      <div className="mp-card-thumb is-svg">
        <TemplatePreview previewId={work.raw.preview} size="card" />
      </div>
    );
  }

  if (work.scope === "mine") {
    const lines = pageTemplatePreview(work.raw, workspace).filter(Boolean).slice(0, 4);
    return (
      <div className="mp-card-thumb is-mine">
        <div className="mp-mine-sheet">
          <strong>{work.title}</strong>
          {lines.length ? lines.map((line, index) => <p key={index}>{line}</p>) : <p>{t("market.blankTemplatePreview")}</p>}
        </div>
      </div>
    );
  }

  return (
    <div ref={hostRef} className={`mp-card-thumb${thumbUrl ? " has-img" : " is-placeholder"}`}>
      {thumbUrl ? (
        <img src={thumbUrl} alt={t("market.thumbAlt", { title: work.title })} loading="lazy" />
      ) : (
        <div className="mp-thumb-fallback" aria-hidden="true">
          {work.kind === "component" ? <IconPackage size={30} stroke={1.6} /> : <IconFileText size={30} stroke={1.6} />}
        </div>
      )}
      {work.installed && <span className="mp-installed-pill">{t("market.installedPill")}</span>}
    </div>
  );
}

export function MarketplaceView({
  workspace,
  currentFolderId,
  currentPageId,
  detailKey = null,
  onOpenDetail,
  onBackToList,
  onDetailTitleChange,
  onUseTemplate,
  onDeleteTemplate,
  onUseMarketPackage,
  onRetrySave,
}) {
  const { t } = useI18n();
  const dialogs = useDialogs();
  const marketBridge = globalThis.window?.lifeAtlas?.market ?? null;
  const communityLinks = useMemo(() => [
    { label: t("market.submitWork"), url: "https://github.com/jamesmendax/life-atlas-public/issues/new?template=market-submission.yml" },
    { label: t("market.feedback"), url: "https://github.com/jamesmendax/life-atlas-public/issues/new?template=feedback.yml" },
  ], [t]);

  const [section, setSection] = useState("all");
  const [scene, setScene] = useState("all");
  const [query, setQuery] = useState("");
  const [catalogue, setCatalogue] = useState(null);
  const [library, setLibrary] = useState([]);
  const [libraryStatus, setLibraryStatus] = useState(marketBridge ? "loading" : "ready");
  const [reloadTick, setReloadTick] = useState(0);
  const [thumbnails, setThumbnails] = useState({});
  const inflightThumbsRef = useRef(new Set());

  const [versionSelection, setVersionSelection] = useState(null);
  const [verifiedHash, setVerifiedHash] = useState("");
  const [previewFrame, setPreviewFrame] = useState(null);
  const [stage, setStage] = useState("image");
  const [compact, setCompact] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const [projectName, setProjectName] = useState(() => t("market.newProjectDefault"));
  const [folderId, setFolderId] = useState(() => defaultTemplateFolderId(workspace, currentFolderId));
  const [includeSampleData, setIncludeSampleData] = useState(true);
  const [targetPageId, setTargetPageId] = useState(currentPageId || "");

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const routeRef = useRef(null);
  const headingRef = useRef(null);
  const lastDetailRef = useRef(null);
  const cardRefs = useRef(new Map());
  const standalonePreviewRef = useRef(null);
  const browseCanvasRef = useRef(null);
  const browseScrollTop = useRef(0);

  const folders = useMemo(() => templateFolderChoices(workspace), [workspace.folders]);
  const folderMap = useMemo(() => new Map(folders.map((folder) => [folder.id, folder.path])), [folders]);
  const folderOptions = useMemo(() => folders.map((folder) => ({ id: folder.id, label: folder.path })), [folders]);
  const pageOptions = useMemo(
    () => workspace.pages
      .filter((page) => !page.trashedAt && !page.settings?.locked && !isPageArchived(workspace, page.id)
        && page.pageType !== "database" && folderMap.has(page.folderId))
      .map((page) => ({ id: page.id, label: page.title || t("market.untitledPage"), sublabel: folderMap.get(page.folderId) })),
    [workspace, folderMap, t],
  );
  const targetPage = pageOptions.find((page) => page.id === targetPageId) || pageOptions[0] || null;

  useEffect(() => {
    if (!folders.some((folder) => folder.id === folderId)) {
      setFolderId(defaultTemplateFolderId(workspace, currentFolderId));
    }
  }, [folders, folderId, workspace, currentFolderId]);

  useEffect(() => {
    if (currentPageId && pageOptions.some((page) => page.id === currentPageId)) {
      setTargetPageId((current) => current || currentPageId);
    }
  }, [currentPageId, pageOptions]);

  useEffect(() => {
    if (!marketBridge) return undefined;
    let active = true;
    marketBridge.catalogue().then((res) => unwrap(res, t("market.opFailed"))).then((value) => {
      if (active) setCatalogue(value);
    }).catch((failure) => {
      if (active) {
        setError(failure.message || t("market.errCatalog"));
        setCatalogue({ origin: "unavailable", entries: [] });
      }
    });
    marketBridge.installed().then((res) => unwrap(res, t("market.opFailed"))).then(({ entries }) => {
      if (active) {
        setLibrary(entries);
        setLibraryStatus("ready");
      }
    }).catch((failure) => {
      if (active) {
        setLibraryStatus("error");
        setError(failure.message || t("market.errInstalled"));
      }
    });
    return () => { active = false; };
  }, [marketBridge, reloadTick, t]);

  const requestThumbnail = useCallback((work) => {
    if (!marketBridge || !work?.hasPreview) return;
    const targetEntry = work.catalogEntry || work.latest;
    if (!targetEntry?.id || !targetEntry?.version) return;
    const cacheKey = targetEntry.sha256 || `${targetEntry.id}@${targetEntry.version}`;
    const inflight = inflightThumbsRef.current;
    if (inflight.has(cacheKey)) return;
    inflight.add(cacheKey);
    marketBridge.previewImage({ id: targetEntry.id, version: targetEntry.version }).then((result) => {
      const url = result?.ok && /^data:image\/png;base64,/u.test(result.value?.url || "") ? result.value.url : null;
      if (inflightThumbsRef.current === inflight) setThumbnails((prev) => ({ ...prev, [cacheKey]: url }));
    }).catch(() => {
      if (inflightThumbsRef.current === inflight) setThumbnails((prev) => ({ ...prev, [cacheKey]: null }));
    }).finally(() => {
      inflight.delete(cacheKey);
    });
  }, [marketBridge]);

  const allWorks = useMemo(() => {
    const builtinWorks = BUILTIN_TEMPLATES.map((template) => {
      const entry = {
        key: `builtin:${template.id}`,
        id: template.id,
        scope: "builtin",
        kind: "template",
        title: template.name,
        description: template.description,
        version: t("market.version.builtin"),
        installed: true,
        hasPreview: true,
        raw: template,
      };
      return { ...entry, sceneId: classifyScene(entry) };
    });

    const mineWorks = (workspace.pageTemplates || []).map((template) => {
      const entry = {
        key: `mine:${template.id}`,
        id: template.id,
        scope: "mine",
        kind: "template",
        title: template.name,
        description: pageTemplateDescription(template),
        version: t("market.version.mine"),
        installed: true,
        hasPreview: true,
        raw: template,
      };
      return { ...entry, sceneId: classifyScene(entry) };
    });

    const officialGroups = marketBridge
      ? marketShelf(catalogue?.entries || [], library, "all", "")
      : [];
    const catalogueByHash = new Map((catalogue?.entries || []).map((entry) => [entry.sha256, entry]));
    const installedByHash = new Map(library.map((entry) => [entry.sha256, entry]));

    const officialWorks = officialGroups.map((versions) => {
      const latest = versions[0];
      const installedVersion = versions.find((entry) => installedByHash.has(entry.sha256)) || null;
      const catalogEntry = versions.map((entry) => catalogueByHash.get(entry.sha256)).find(Boolean) || null;
      const entry = {
        key: `official:${latest.id}`,
        id: latest.id,
        scope: "official",
        kind: latest.type === "component" ? "component" : "template",
        title: latest.title,
        description: latest.description || "",
        version: latest.version,
        size: latest.size,
        sha256: latest.sha256,
        installed: Boolean(installedVersion),
        hasPreview: Boolean(catalogEntry?.hasPreview),
        catalogEntry,
        latest,
        versions,
      };
      return { ...entry, sceneId: classifyScene(entry) };
    });

    const officialTemplates = officialWorks.filter((work) => work.kind === "template");
    const officialComponents = officialWorks.filter((work) => work.kind === "component");
    return [...builtinWorks, ...officialTemplates, ...officialComponents, ...mineWorks];
  }, [workspace.pageTemplates, marketBridge, catalogue, library, t]);

  const installedCount = useMemo(
    () => new Set(library.map((item) => item.id)).size,
    [library],
  );
  const downloadedSize = useMemo(
    () => library.reduce((sum, item) => sum + (item.size || 0), 0),
    [library],
  );
  const mineCount = (workspace.pageTemplates || []).length;

  const sectionWorks = useMemo(() => {
    if (section === "template") return allWorks.filter((work) => work.kind === "template");
    if (section === "component") return allWorks.filter((work) => work.kind === "component");
    if (section === "mine") return allWorks.filter((work) => work.scope === "mine");
    if (section === "installed") return allWorks.filter((work) => work.scope === "official" && work.installed);
    return allWorks;
  }, [allWorks, section]);

  const availableScenes = useMemo(() => {
    const present = new Set(sectionWorks.map((work) => work.sceneId));
    return SCENE_IDS.filter((id) => present.has(id));
  }, [sectionWorks]);

  useEffect(() => {
    if (scene !== "all" && !availableScenes.includes(scene)) setScene("all");
  }, [scene, availableScenes]);

  const visibleWorks = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return sectionWorks.filter((work) => {
      if (scene !== "all" && work.sceneId !== scene) return false;
      if (!needle) return true;
      return `${work.title} ${work.description} ${t(`market.scene.${work.sceneId}`)} ${workKindLabel(work, t)}`.toLocaleLowerCase().includes(needle);
    });
  }, [sectionWorks, scene, query, t]);

  const activeWork = useMemo(
    () => (detailKey ? allWorks.find((work) => work.key === detailKey) || null : null),
    [allWorks, detailKey],
  );

  const selectedVersionHash = versionSelection?.workKey === detailKey ? versionSelection.sha256 : "";
  const activeOfficialVersion = useMemo(() => {
    if (activeWork?.scope !== "official") return null;
    const installed = section === "installed" ? activeWork.versions.find((entry) => entry.installed) : null;
    return activeWork.versions.find((entry) => entry.sha256 === selectedVersionHash) || installed || activeWork.versions[0] || null;
  }, [activeWork, section, selectedVersionHash]);
  const activeVersionHash = activeOfficialVersion?.sha256;
  const resolution = previewFrame?.detailKey === detailKey && previewFrame?.sha256 === activeVersionHash ? previewFrame.value : null;

  const activeLocal = useMemo(() => {
    if (!activeOfficialVersion) return null;
    return library.find((entry) => entry.sha256 === activeOfficialVersion.sha256) || null;
  }, [activeOfficialVersion, library]);

  const activeCatalogEntry = useMemo(() => {
    if (!activeOfficialVersion) return null;
    return (catalogue?.entries || []).find((entry) => entry.sha256 === activeOfficialVersion.sha256) || activeWork?.catalogEntry || null;
  }, [activeOfficialVersion, catalogue, activeWork]);

  useEffect(() => {
    if (activeWork) {
      const areaLabel = activeWork.kind === "component" ? t("market.areaWidget") : t("market.areaTemplate");
      onDetailTitleChange?.(`${areaLabel} / ${activeWork.title}`);
    } else {
      onDetailTitleChange?.("");
    }
  }, [activeWork, onDetailTitleChange, t]);

  useEffect(() => {
    setError("");
    setNotice("");
  }, [detailKey]);

  useLayoutEffect(() => {
    routeRef.current = {};
    return () => { routeRef.current = null; };
  }, [detailKey, activeVersionHash]);

  useLayoutEffect(() => {
    const returningCard = !detailKey && cardRefs.current.get(lastDetailRef.current);
    if (!detailKey && browseCanvasRef.current) browseCanvasRef.current.scrollTop = browseScrollTop.current;
    (returningCard || headingRef.current)?.focus({ preventScroll: true });
    lastDetailRef.current = detailKey;
  }, [detailKey, activeWork?.key]);

  useEffect(() => {
    setPreviewFrame(null);
    setStage("image");
    setCompact(false);
    setConfirmRemove(false);
  }, [detailKey, activeVersionHash]);

  useEffect(() => {
    if (activeWork?.scope === "official" && activeCatalogEntry?.hasPreview) {
      requestThumbnail({
        scope: "official",
        hasPreview: true,
        catalogEntry: activeCatalogEntry,
        latest: activeOfficialVersion || activeWork.latest,
      });
    }
  }, [activeWork, activeCatalogEntry, activeOfficialVersion, requestThumbnail]);

  useEffect(() => () => {
    if (previewFrame?.value.frameUrl && marketBridge) {
      void marketBridge.releaseFrame({ frameUrl: previewFrame.value.frameUrl }).catch(() => {});
    }
  }, [marketBridge, previewFrame]);

  useEffect(() => {
    if (!detailKey) return undefined;
    const onKeyDown = (event) => {
      if (event.defaultPrevented || hasOpenModal() || isComposingKeyboardEvent(event)) return;
      if (event.key === "Escape" && stage !== "modal" && !busy) {
        const activeTag = document.activeElement?.tagName;
        if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") return;
        event.preventDefault();
        onBackToList?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailKey, stage, busy, onBackToList]);

  function showImage() {
    setPreviewFrame(null);
    setStage("image");
  }

  async function runAction(operation) {
    if (busy) return;
    const route = routeRef.current;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await operation(route);
    } catch (failure) {
      if (routeRef.current === route) setError(failure?.message || t("market.opFailed"));
    } finally {
      if (routeRef.current) setBusy(false);
    }
  }

  async function refreshLibrary(sha256) {
    if (!marketBridge) return;
    const { entries } = unwrap(await marketBridge.installed(), t("market.opFailed"));
    if (routeRef.current) {
      setLibrary(entries);
      setLibraryStatus("ready");
    }
    window.dispatchEvent(new CustomEvent("life-atlas-market-change", { detail: { sha256 } }));
  }

  async function saveDownload(prepared, route) {
    const saved = unwrap(await marketBridge.install({ token: prepared.token, downloadOnly: true }), t("market.opFailed"));
    await refreshLibrary(saved.sha256);
    if (routeRef.current === route) {
      setVerifiedHash(saved.sha256);
      showImage();
      setConfirmRemove(false);
      setVersionSelection({ workKey: `official:${saved.id}`, sha256: saved.sha256 });
    }
    return saved;
  }

  const handleImportLocalPack = () => runAction(async (route) => {
    if (!marketBridge) return;
    const prepared = unwrap(await marketBridge.pick(), t("market.opFailed"));
    if (prepared.cancelled) return;
    const saved = await saveDownload(prepared, route);
    if (routeRef.current !== route) return;
    setNotice(t("market.noticeImported", { title: saved.title }));
    onOpenDetail?.(`official:${saved.id}`);
  });

  const handleDownloadOfficial = () => runAction(async (route) => {
    if (!marketBridge || !activeOfficialVersion) return;
    const prepared = unwrap(await marketBridge.preview({
      id: activeOfficialVersion.id,
      version: activeOfficialVersion.version,
    }), t("market.opFailed"));
    await saveDownload(prepared, route);
    if (routeRef.current === route) setNotice(t("market.noticeDownloaded"));
  });

  const handleUseOfficial = () => runAction(async (route) => {
    if (onRetrySave) return onRetrySave();
    if (!marketBridge || !activeLocal || !onUseMarketPackage) return;
    const prepared = activeLocal.type === "template"
      ? unwrap(await marketBridge.preview({ sha256: activeLocal.sha256 }), t("market.opFailed"))
      : activeLocal;
    if (routeRef.current === route) await onUseMarketPackage(prepared, { folderId, pageId: targetPage?.id });
  });

  const handleTryWidget = (mode) => runAction(async (route) => {
    if (!marketBridge || !activeLocal || activeLocal.type !== "component") return;
    if (!resolution) {
      setVersionSelection({ workKey: detailKey, sha256: activeLocal.sha256 });
      const frame = unwrap(await marketBridge.hostWidget({ url: activeLocal.url, preview: true }), t("market.opFailed"));
      if (routeRef.current !== route) {
        if (frame.frameUrl) await marketBridge.releaseFrame({ frameUrl: frame.frameUrl }).catch(() => {});
        return;
      }
      setVerifiedHash(activeLocal.sha256);
      if (frame.kind !== "frame") {
        setNotice(t("market.noticeLegacyWidget"));
        return;
      }
      setPreviewFrame({ detailKey, sha256: activeLocal.sha256, value: frame });
    }
    setStage(mode);
  });

  const handleRemoveDownload = () => runAction(async (route) => {
    if (!marketBridge || !activeLocal) return;
    const result = unwrap(await marketBridge.remove({ sha256: activeLocal.sha256 }), t("market.opFailed"));
    await refreshLibrary(activeLocal.sha256);
    if (routeRef.current !== route) return;
    showImage();
    setConfirmRemove(false);
    const retained = result.retainedBytes || 0;
    const freed = (result.releasedBytes ?? activeLocal.size) + (result.cacheReleasedBytes || 0);
    const detail = retained ? t("market.retainedBytes", { size: sizeText(retained) }) : "";
    const pending = result.cacheCleanupPending ? t("market.cacheCleanupPending") : "";
    setNotice(t("market.noticeRemoved", { freed: sizeText(freed), detail, pending }));
  });

  const nameError = activeWork?.scope === "builtin" && (!projectName.trim() || projectName.trim().length > 100)
    ? t("market.projectNameErr")
    : "";

  const handleUseTemplateSubmit = (event) => {
    event.preventDefault();
    if (onRetrySave) {
      void runAction(onRetrySave);
      return;
    }
    if (!activeWork || busy || nameError || !folders.some((folder) => folder.id === folderId) || !onUseTemplate) return;
    void runAction(async () => {
      await onUseTemplate(activeWork.raw, {
        projectName: projectName.trim(),
        folderId,
        includeSampleData: activeWork.scope === "builtin" && includeSampleData,
      });
    });
  };

  const handleDeleteMyTemplate = async () => {
    if (activeWork?.scope !== "mine" || busy || !onDeleteTemplate) return;
    const route = routeRef.current;
    const confirmed = await dialogs.confirm({
      title: t("market.deleteTitle"),
      description: t("market.deleteDesc", { title: activeWork.title }),
      confirmLabel: t("market.deleteTitle"),
      danger: true,
    });
    if (!confirmed || routeRef.current !== route) return;
    await runAction(async () => {
      await onDeleteTemplate(activeWork.raw.id);
      if (routeRef.current === route) onBackToList?.();
    });
  };

  const openExternalLink = (event, url) => {
    if (!window.lifeAtlas?.app?.openExternal) return;
    event.preventDefault();
    void window.lifeAtlas.app.openExternal({ url }).then((res) => unwrap(res, t("market.opFailed"))).catch((failure) => setError(failure.message));
  };

  const sectionTabs = useMemo(() => {
    const tabs = [
      { id: "all", label: t("market.tab.all") },
      { id: "template", label: t("market.tab.template") },
    ];
    if (marketBridge) tabs.push({ id: "component", label: t("market.tab.component") });
    tabs.push({ id: "mine", label: mineCount > 0 ? t("market.tab.mineCount", { count: mineCount }) : t("market.tab.mine") });
    if (marketBridge) tabs.push({ id: "installed", label: installedCount > 0 ? t("market.tab.installedCount", { count: installedCount }) : t("market.tab.installed") });
    return tabs;
  }, [marketBridge, mineCount, installedCount, t]);

  function selectSection(sectionId) {
    setSection(sectionId);
    setScene("all");
    setError("");
    setNotice("");
  }

  function handleSectionKey(event, index) {
    const last = sectionTabs.length - 1;
    const destination = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (destination === undefined) return;
    event.preventDefault();
    event.currentTarget.parentElement.children[destination]?.focus();
    selectSection(sectionTabs[destination].id);
  }

  function refreshMarketplace() {
    inflightThumbsRef.current = new Set();
    setThumbnails({});
    setCatalogue(null);
    setLibraryStatus("loading");
    setError("");
    setNotice("");
    setReloadTick((tick) => tick + 1);
  }

  const libraryLoading = libraryStatus === "loading";
  const libraryUnavailable = libraryStatus === "error";
  const sectionHeading = {
    title: t(`market.head.${section}.title`),
    subtitle: t(`market.head.${section}.sub`),
  };

  const catalogStatusText = useMemo(() => {
    if (!marketBridge) return t("market.status.browserCount", { count: visibleWorks.length });
    if (section === "installed") {
      if (libraryLoading) return t("market.status.installedLoading");
      if (libraryUnavailable) return t("market.status.installedError");
      return t("market.status.installedSummary", { count: installedCount, size: sizeText(downloadedSize) });
    }
    if (!catalogue) return t("market.status.syncing");
    const originText = catalogue.origin === "online" ? t("market.status.originOnline") : catalogue.origin === "bundled" ? t("market.status.originBundled") : t("market.status.originOffline");
    return t("market.status.worksSummary", { count: visibleWorks.length, origin: originText });
  }, [marketBridge, section, installedCount, downloadedSize, catalogue, visibleWorks.length, libraryLoading, libraryUnavailable, t]);

  const activeThumbKey = activeOfficialVersion
    ? (activeCatalogEntry?.sha256 || activeOfficialVersion.sha256 || `${activeOfficialVersion.id}@${activeOfficialVersion.version}`)
    : "";
  const activeThumbUrl = activeThumbKey ? thumbnails[activeThumbKey] : null;

  /* ================================================================
     DETAIL VIEW (Full-Canvas Notion Marketplace Listing Page)
     ================================================================ */
  if (detailKey) {
    if (!activeWork) {
      return (
        <section className="market-page" aria-label={t("market.head.all.title")}>
          <div className="mp-detail-canvas" key={detailKey}>
            <div className="mp-detail-wrap">
              <div className="mp-detail-top">
                <button type="button" className="mp-back-btn" onClick={onBackToList}>
                  <IconArrowLeft size={15} aria-hidden="true" />
                  <span>{t("market.backToList")}</span>
                </button>
              </div>
              <div className="mp-empty-state">
                <IconTemplate size={32} stroke={1.5} aria-hidden="true" />
                <p ref={headingRef} tabIndex={-1}>{error || (marketBridge && (!catalogue || libraryLoading) ? t("market.loadingDetail") : t("market.notFound"))}</p>
                <button type="button" className="mb-button" onClick={onBackToList}>{t("market.backToListBtn")}</button>
              </div>
            </div>
          </div>
        </section>
      );
    }

    const isOfficial = activeWork.scope === "official";
    const isBuiltin = activeWork.scope === "builtin";
    const isMine = activeWork.scope === "mine";
    const isComponent = activeWork.kind === "component";
    const currentVersion = activeOfficialVersion?.version || activeWork.version;
    const currentSize = activeOfficialVersion?.size ?? activeWork.size;
    const incompatible = isOfficial && activeOfficialVersion?.compatible === false;
    const kindLabel = workKindLabel(activeWork, t);
    const sceneLabel = t(`market.scene.${activeWork.sceneId}`);

    return (
      <section className="market-page" aria-label={t("market.detailAria", { title: activeWork.title })}>
        <div className="mp-detail-canvas" key={detailKey}>
          <div className="mp-detail-wrap">
            <div className="mp-detail-top">
              <button type="button" className="mp-back-btn" disabled={busy} onClick={onBackToList}>
                <IconArrowLeft size={15} aria-hidden="true" />
                <span>{t("market.backToList")}</span>
              </button>
            </div>

            <div className="mp-detail-grid">
              <div className="mp-stage-col">
                {isOfficial && activeLocal?.type === "component" && (
                  <div className="mp-stage-toolbar">
                    <div className="mp-stage-tabs" role="group" aria-label={t("market.previewModeAria")}>
                      <button type="button" className={stage === "image" ? "is-active" : ""} disabled={busy} onClick={showImage}>
                        <IconPhoto size={14} aria-hidden="true" />{t("market.previewImageTab")}
                      </button>
                      <button type="button" className={stage === "inline" ? "is-active" : ""} disabled={busy} onClick={() => handleTryWidget("inline")}>
                        <IconPlayerPlay size={14} aria-hidden="true" />{t("market.previewLiveTab")}
                      </button>
                    </div>
                    <div className="mp-stage-tools">
                      {stage === "inline" && (
                        <button type="button" className={`mp-tool-btn${compact ? " is-active" : ""}`} aria-pressed={compact} onClick={() => setCompact((value) => !value)}>
                          <IconColumns size={14} aria-hidden="true" />{t("market.compactPreview")}
                        </button>
                      )}
                      <button ref={standalonePreviewRef} type="button" className="mp-tool-btn" disabled={busy} onClick={() => handleTryWidget("modal")}>
                        <IconMaximize size={14} aria-hidden="true" />{t("market.modalPreview")}
                      </button>
                    </div>
                  </div>
                )}

                <div className={`mp-stage-box${stage === "inline" && resolution ? " is-live" : ""}${compact ? " is-narrow" : ""}${isMine ? " is-text" : ""}`}>
                  {stage === "inline" && resolution ? (
                    <div className="mp-live-canvas">
                      <MarketWidgetSandbox resolution={resolution} title={activeWork.title} compact={compact} />
                    </div>
                  ) : isBuiltin ? (
                    <div className="mp-stage-svg">
                      <TemplatePreview previewId={activeWork.raw.preview} size="large" />
                    </div>
                  ) : isMine ? (
                    <div className="mp-mine-detail-preview">
                      {pageTemplatePreview(activeWork.raw, workspace).map((text, index) => <p key={index}>{text || "　"}</p>)}
                    </div>
                  ) : activeThumbUrl ? (
                    <img src={activeThumbUrl} alt={t("market.thumbAlt", { title: activeWork.title })} />
                  ) : (
                    <div className="mp-stage-placeholder" aria-hidden="true">
                      {isComponent ? <IconPackage size={44} stroke={1.5} /> : <IconFileText size={44} stroke={1.5} />}
                      <span>{activeCatalogEntry?.hasPreview ? t("market.previewLoading") : t("market.previewNone")}</span>
                    </div>
                  )}
                </div>

                <div className="mp-about-block">
                  <h2>{t("market.aboutHeading")}</h2>
                  <p className="mp-about-desc">{activeWork.description}</p>
                  <div className="mp-chips" aria-label={t("market.includesAria")}>
                    {isBuiltin ? (
                      <>
                        <span><IconFileText size={14} aria-hidden="true" />{t("market.builtinChip1")}</span>
                        <span><IconDatabase size={14} aria-hidden="true" />{t("market.builtinChip2")}</span>
                        <span><IconDatabase size={14} aria-hidden="true" />{t("market.builtinChip3")}</span>
                        <span><IconSparkles size={14} aria-hidden="true" />{t("market.builtinChip4")}</span>
                      </>
                    ) : (
                      <>
                        <span>{kindLabel}</span>
                        <span>{sceneLabel}</span>
                        {isOfficial && <span>v{currentVersion}</span>}
                        {isOfficial && currentSize > 0 && <span>{sizeText(currentSize)}</span>}
                        {isComponent && <span>{t("market.sandboxChip")}</span>}
                        {activeLocal && <span>{verifiedHash === activeLocal.sha256 ? t("market.verifiedChip") : t("market.installedChip")}</span>}
                      </>
                    )}
                  </div>
                </div>
              </div>

              <aside className="mp-action-card" aria-label={t("market.actionsAria")}>
                <div className="mp-action-head">
                  {isOfficial && activeLocal ? (
                    <span className="mp-status-badge is-installed">
                      <IconCheck size={13} aria-hidden="true" />
                      {verifiedHash === activeLocal.sha256 ? t("market.installedBadgeVerified") : t("market.installedBadge")}
                    </span>
                  ) : (
                    <span className="mp-status-badge">{kindLabel}</span>
                  )}
                  <h1 ref={headingRef} tabIndex={-1}>{activeWork.title}</h1>
                  <p className="mp-action-sub">
                    {kindLabel}
                    {isOfficial ? ` · v${currentVersion} · ${sizeText(currentSize)}` : ""}
                  </p>
                </div>

                <div className="mp-meta-table">
                  {isOfficial && activeWork.versions.length > 1 && (
                    <label className="mp-meta-row is-select">
                      <span>{t("market.meta.version")}</span>
                      <select
                        className="mb-field"
                        aria-label={t("market.meta.selectVersion")}
                        value={activeOfficialVersion?.sha256 || ""}
                        disabled={busy}
                        onChange={(event) => {
                          showImage();
                          setConfirmRemove(false);
                          setVersionSelection({ workKey: detailKey, sha256: event.target.value });
                        }}
                      >
                        {activeWork.versions.map((entry) => (
                          <option key={entry.sha256} value={entry.sha256}>
                            v{entry.version}{entry.installed ? ` · ${t("market.installedPill")}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="mp-meta-row">
                    <span>{t("market.meta.category")}</span>
                    <b>{sceneLabel}</b>
                  </div>
                  <div className="mp-meta-row">
                    <span>{t("market.meta.runtime")}</span>
                    <b>{isComponent ? t("market.meta.runtimeComponent") : t("market.meta.runtimeTemplate")}</b>
                  </div>
                  {isOfficial && activeOfficialVersion?.minAppVersion && (
                    <div className="mp-meta-row">
                      <span>{t("market.meta.minVersion")}</span>
                      <b>Life Atlas {activeOfficialVersion.minAppVersion}+</b>
                    </div>
                  )}
                </div>

                {(isBuiltin || isMine) && (
                  <form className="mp-action-form" onSubmit={handleUseTemplateSubmit}>
                    {isBuiltin && (
                      <label className="mp-field-block">
                        <span>{t("market.projectName")}</span>
                        <input
                          className="mb-field"
                          aria-label={t("market.projectName")}
                          value={projectName}
                          maxLength={100}
                          aria-invalid={Boolean(nameError)}
                          disabled={busy}
                          onChange={(event) => { setProjectName(event.target.value); setError(""); }}
                        />
                      </label>
                    )}

                    <div className="mp-field-block">
                      <span>{t("market.placeIn")}</span>
                      <MobaiTargetPicker
                        ariaLabel={t("market.targetFolderAria")}
                        kind="folder"
                        options={folderOptions}
                        value={folderId || ""}
                        placeholder={t("market.targetFolderPh")}
                        searchPlaceholder={t("market.targetFolderSearch")}
                        emptyText={t("market.targetFolderEmpty")}
                        disabled={busy || !folders.length}
                        onChange={setFolderId}
                      />
                    </div>

                    {isBuiltin && (
                      <div className="mp-switch-row">
                        <div>
                          <span>{t("market.includeSample")}</span>
                          <small>{t("market.includeSampleHint")}</small>
                        </div>
                        <button
                          type="button"
                          className={`tpl-switch${includeSampleData ? " is-on" : ""}`}
                          role="switch"
                          aria-label={t("market.includeSample")}
                          aria-checked={includeSampleData}
                          disabled={busy}
                          onClick={() => setIncludeSampleData((value) => !value)}
                        >
                          <i />
                        </button>
                      </div>
                    )}

                    {(error || nameError || !folders.length) && (
                      <p className="mp-error" role="alert">{error || nameError || t("market.createFolderFirst")}</p>
                    )}

                    <div className="mp-cta-stack">
                      <button
                        type="submit"
                        className="mb-button mb-primary mp-cta-full"
                        disabled={busy || (!onRetrySave && (Boolean(nameError) || !folders.length || !onUseTemplate))}
                      >
                        {busy ? t("common.processing") : onRetrySave ? t("market.retrySave") : t("market.useTemplate")}
                      </button>
                      {isMine && (
                        <button
                          type="button"
                          className="mb-button mp-cta-full mp-cta-danger"
                          disabled={busy || !onDeleteTemplate}
                          onClick={handleDeleteMyTemplate}
                        >
                          {t("market.deleteTitle")}
                        </button>
                      )}
                    </div>
                  </form>
                )}

                {isOfficial && (
                  <div className="mp-action-form">
                    {activeLocal && (
                      <div className="mp-field-block">
                        <span>{isComponent ? t("market.insertIntoPage") : t("market.placeIn")}</span>
                        {isComponent ? (
                          <MobaiTargetPicker
                            ariaLabel={t("market.targetPageAria")}
                            kind="page"
                            options={pageOptions}
                            value={targetPage?.id || ""}
                            placeholder={t("market.targetPagePh")}
                            searchPlaceholder={t("market.targetPageSearch")}
                            emptyText={t("market.targetPageEmpty")}
                            disabled={busy || !targetPage}
                            onChange={setTargetPageId}
                          />
                        ) : (
                          <MobaiTargetPicker
                            ariaLabel={t("market.targetFolderAria")}
                            kind="folder"
                            options={folderOptions}
                            value={folderId || ""}
                            placeholder={t("market.targetFolderPh")}
                            searchPlaceholder={t("market.targetFolderSearch")}
                            emptyText={t("market.targetFolderEmpty")}
                            disabled={busy || !folders.length}
                            onChange={setFolderId}
                          />
                        )}
                      </div>
                    )}

                    {incompatible && (
                      <p className="mp-error" role="alert">{t("market.needMinVersion", { version: activeOfficialVersion.minAppVersion })}</p>
                    )}
                    {notice && <p className="mp-notice" role="status">{notice}</p>}
                    {error && <p className="mp-error" role="alert">{error}</p>}

                    <div className="mp-cta-stack">
                      {activeLocal ? (
                        <>
                          <button
                            type="button"
                            className="mb-button mb-primary mp-cta-full"
                            disabled={busy || (!onRetrySave && (isComponent ? !targetPage : !folderMap.has(folderId)))}
                            onClick={handleUseOfficial}
                          >
                            {busy ? t("common.processing") : onRetrySave ? t("market.retrySave") : isComponent ? t("market.insertComponent") : t("market.useTemplate")}
                          </button>
                          <button
                            type="button"
                            className="mb-button mp-cta-full"
                            disabled={busy}
                            onClick={() => setConfirmRemove((value) => !value)}
                          >
                            {t("market.removeDownload")}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="mb-button mb-primary mp-cta-full"
                          disabled={busy || incompatible}
                          onClick={handleDownloadOfficial}
                        >
                          <IconDownload size={15} aria-hidden="true" />
                          {busy ? t("market.downloading") : isComponent ? t("market.downloadComponent") : t("market.downloadTemplate")}
                        </button>
                      )}
                    </div>

                    {confirmRemove && activeLocal && (
                      <div className="mp-confirm-box">
                        <p>{t("market.confirmRemoveText", { title: activeLocal.title })}</p>
                        <div className="mp-confirm-actions">
                          <button type="button" className="mb-button" disabled={busy} onClick={() => setConfirmRemove(false)}>{t("common.cancel")}</button>
                          <button type="button" className="mb-button mp-cta-danger" disabled={busy} onClick={handleRemoveDownload}>{t("market.confirmRemoveBtn")}</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </aside>
            </div>
          </div>
        </div>

        {stage === "modal" && resolution && (
          <Dialog
            title={t("market.modalTitle", { title: activeWork.title })}
            description={t("market.modalDesc")}
            ariaLabel={t("market.modalTitle", { title: activeWork.title })}
            closeLabel={t("market.modalClose")}
            className="market-sandbox-dialog"
            dialogKind="market-sandbox"
            restoreFocusRef={standalonePreviewRef}
            onClose={showImage}
          >
            <div className="market-sandbox-body">
              <MarketWidgetSandbox resolution={resolution} title={activeWork.title} onPreviewEscape={showImage} />
            </div>
            <footer className="market-sandbox-foot">
              <button type="button" className="mb-button" onClick={showImage}>{t("market.backToList")}</button>
            </footer>
          </Dialog>
        )}
      </section>
    );
  }

  /* ================================================================
     DISCOVER VIEW (Full-Canvas Notion Marketplace Webpage)
     ================================================================ */
  return (
    <section className="market-page" aria-label={t("market.head.all.title")}>
      <nav className="mp-sticky-nav" aria-label={t("market.navAria")}>
        <div className="mp-tabs" role="tablist" aria-label={t("market.tabsAria")}>
          {sectionTabs.map((tab, index) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`market-tab-${tab.id}`}
              aria-controls="market-tab-panel"
              aria-selected={section === tab.id}
              tabIndex={section === tab.id ? 0 : -1}
              className={`mp-tab${section === tab.id ? " is-active" : ""}`}
              disabled={busy}
              onClick={() => selectSection(tab.id)}
              onKeyDown={(event) => handleSectionKey(event, index)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="mp-nav-tools">
          <label className="mp-search">
            <IconSearch size={14} aria-hidden="true" />
            <input
              type="search"
              placeholder={t("market.searchPlaceholder")}
              aria-label={t("market.searchAria")}
              value={query}
              disabled={busy}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button type="button" className="mp-search-clear" aria-label={t("market.clearSearch")} onClick={() => setQuery("")}>
                <IconX size={13} aria-hidden="true" />
              </button>
            )}
          </label>

          {marketBridge && (
            <>
              <button type="button" className="mp-nav-btn" disabled={busy} onClick={handleImportLocalPack}>
                <IconUpload size={14} aria-hidden="true" />
                <span>{t("market.importLocal")}</span>
              </button>
              <button
                type="button"
                className="mp-nav-btn"
                disabled={busy}
                onClick={refreshMarketplace}
              >
                <IconRefresh size={14} aria-hidden="true" />
                <span>{t("market.refresh")}</span>
              </button>
              {communityLinks.map(({ label, url }) => (
                <a
                  key={url}
                  className="mp-nav-btn"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => openExternalLink(event, url)}
                >
                  <span>{label}</span>
                  <IconArrowUpRight size={13} aria-hidden="true" />
                </a>
              ))}
            </>
          )}
        </div>
      </nav>

      <div ref={browseCanvasRef} className="mp-browse-canvas" id="market-tab-panel" role="tabpanel" aria-labelledby={`market-tab-${section}`}
        onScroll={(event) => { browseScrollTop.current = event.currentTarget.scrollTop; }}>
        <div className="mp-browse-wrap">
          <header className="mp-head">
            <h1 ref={headingRef} tabIndex={-1}>{sectionHeading.title}</h1>
            <p>{sectionHeading.subtitle}</p>
          </header>

          {notice && <p className="mp-banner-notice" role="status">{notice}</p>}
          {error && <p className="mp-banner-error" role="alert">{error}</p>}

          <div className="mp-cats-bar">
            <div className="mp-cats" role="group" aria-label={t("market.scenesAria")}>
              {availableScenes.length > 1 && (
                <>
                  <button
                    type="button"
                    className={`mp-cat${scene === "all" ? " is-active" : ""}`}
                    aria-pressed={scene === "all"}
                    onClick={() => setScene("all")}
                  >
                    {t("market.sceneAll")}
                  </button>
                  {availableScenes.map((sceneId) => (
                    <button
                      key={sceneId}
                      type="button"
                      className={`mp-cat${scene === sceneId ? " is-active" : ""}`}
                      aria-pressed={scene === sceneId}
                      onClick={() => setScene(sceneId)}
                    >
                      {t(`market.scene.${sceneId}`)}
                    </button>
                  ))}
                </>
              )}
            </div>
            <span className="mp-status-text" role="status">{catalogStatusText}</span>
          </div>

          {visibleWorks.length > 0 ? (
            <div className="mp-grid" role="list" aria-label={t("market.gridAria")}>
              {visibleWorks.map((work) => {
                const thumbKey = work.scope === "official"
                  ? (work.catalogEntry?.sha256 || work.sha256 || `${work.id}@${work.version}`)
                  : "";
                return (
                  <div key={work.key} role="listitem">
                    <button
                      type="button"
                      className="mp-card"
                      aria-label={work.title}
                      ref={(node) => { if (node) cardRefs.current.set(work.key, node); else cardRefs.current.delete(work.key); }}
                      onClick={() => { setVersionSelection(null); onOpenDetail?.(work.key); }}
                    >
                      <MarketCardCover
                        work={work}
                        workspace={workspace}
                        thumbUrl={thumbKey ? thumbnails[thumbKey] : undefined}
                        onNeedThumb={requestThumbnail}
                        t={t}
                      />
                      <div className="mp-card-body">
                        <div className="mp-card-top">
                          <strong>{work.title}</strong>
                          <span className="mp-card-kind">{workKindLabel(work, t)}</span>
                        </div>
                        <p>{primarySummary(work.description)}</p>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mp-empty-state">
              <IconTemplate size={32} stroke={1.5} aria-hidden="true" />
              <p>
                {section === "installed" && (libraryLoading || libraryUnavailable)
                  ? catalogStatusText
                  : query
                  ? t("market.emptySearch", { query })
                  : section === "mine"
                    ? t("market.emptyMine")
                    : section === "installed"
                      ? t("market.emptyInstalled")
                      : t("market.emptyCategory")}
              </p>
              {(query || scene !== "all") && (
                <button type="button" className="mb-button" onClick={() => { setQuery(""); setScene("all"); }}>
                  {t("market.clearFilters")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
