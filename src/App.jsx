import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { WorkspaceAssistant } from "./components/assistant/WorkspaceAssistant.jsx";
import IconActivity from "@tabler/icons-react/dist/esm/icons/IconActivity.mjs";
import IconArchive from "@tabler/icons-react/dist/esm/icons/IconArchive.mjs";
import IconArrowUpRight from "@tabler/icons-react/dist/esm/icons/IconArrowUpRight.mjs";
import IconArrowsSort from "@tabler/icons-react/dist/esm/icons/IconArrowsSort.mjs";
import IconAtom from "@tabler/icons-react/dist/esm/icons/IconAtom.mjs";
import IconAward from "@tabler/icons-react/dist/esm/icons/IconAward.mjs";
import IconBolt from "@tabler/icons-react/dist/esm/icons/IconBolt.mjs";
import IconBook2 from "@tabler/icons-react/dist/esm/icons/IconBook2.mjs";
import IconBriefcase from "@tabler/icons-react/dist/esm/icons/IconBriefcase.mjs";
import IconBulb from "@tabler/icons-react/dist/esm/icons/IconBulb.mjs";
import IconCalendar from "@tabler/icons-react/dist/esm/icons/IconCalendar.mjs";
import IconCamera from "@tabler/icons-react/dist/esm/icons/IconCamera.mjs";
import IconChartBar from "@tabler/icons-react/dist/esm/icons/IconChartBar.mjs";
import IconCheck from "@tabler/icons-react/dist/esm/icons/IconCheck.mjs";
import IconChevronDown from "@tabler/icons-react/dist/esm/icons/IconChevronDown.mjs";
import IconChevronRight from "@tabler/icons-react/dist/esm/icons/IconChevronRight.mjs";
import IconClock from "@tabler/icons-react/dist/esm/icons/IconClock.mjs";
import IconCode from "@tabler/icons-react/dist/esm/icons/IconCode.mjs";
import IconCoffee from "@tabler/icons-react/dist/esm/icons/IconCoffee.mjs";
import IconCompass from "@tabler/icons-react/dist/esm/icons/IconCompass.mjs";
import IconCopy from "@tabler/icons-react/dist/esm/icons/IconCopy.mjs";
import IconCpu from "@tabler/icons-react/dist/esm/icons/IconCpu.mjs";
import IconDatabase from "@tabler/icons-react/dist/esm/icons/IconDatabase.mjs";
import IconDeviceGamepad2 from "@tabler/icons-react/dist/esm/icons/IconDeviceGamepad2.mjs";
import IconDots from "@tabler/icons-react/dist/esm/icons/IconDots.mjs";
import IconFileDescription from "@tabler/icons-react/dist/esm/icons/IconFileDescription.mjs";
import IconFilePlus from "@tabler/icons-react/dist/esm/icons/IconFilePlus.mjs";
import IconFlask2 from "@tabler/icons-react/dist/esm/icons/IconFlask2.mjs";
import IconFolder from "@tabler/icons-react/dist/esm/icons/IconFolder.mjs";
import IconFolderPlus from "@tabler/icons-react/dist/esm/icons/IconFolderPlus.mjs";
import IconGlobe from "@tabler/icons-react/dist/esm/icons/IconGlobe.mjs";
import IconHeart from "@tabler/icons-react/dist/esm/icons/IconHeart.mjs";
import IconHome2 from "@tabler/icons-react/dist/esm/icons/IconHome2.mjs";
import IconLeaf from "@tabler/icons-react/dist/esm/icons/IconLeaf.mjs";
import IconLink from "@tabler/icons-react/dist/esm/icons/IconLink.mjs";
import IconMap from "@tabler/icons-react/dist/esm/icons/IconMap.mjs";
import IconMessageCircle from "@tabler/icons-react/dist/esm/icons/IconMessageCircle.mjs";
import IconMoon from "@tabler/icons-react/dist/esm/icons/IconMoon.mjs";
import IconMusic from "@tabler/icons-react/dist/esm/icons/IconMusic.mjs";
import IconNotes from "@tabler/icons-react/dist/esm/icons/IconNotes.mjs";
import IconPalette from "@tabler/icons-react/dist/esm/icons/IconPalette.mjs";
import IconPlane from "@tabler/icons-react/dist/esm/icons/IconPlane.mjs";
import IconPhoto from "@tabler/icons-react/dist/esm/icons/IconPhoto.mjs";
import IconPlus from "@tabler/icons-react/dist/esm/icons/IconPlus.mjs";
import IconRocket from "@tabler/icons-react/dist/esm/icons/IconRocket.mjs";
import IconSchool from "@tabler/icons-react/dist/esm/icons/IconSchool.mjs";
import IconSearch from "@tabler/icons-react/dist/esm/icons/IconSearch.mjs";
import IconSettings from "@tabler/icons-react/dist/esm/icons/IconSettings.mjs";
import IconSparkles from "@tabler/icons-react/dist/esm/icons/IconSparkles.mjs";
import IconStar from "@tabler/icons-react/dist/esm/icons/IconStar.mjs";
import IconSun from "@tabler/icons-react/dist/esm/icons/IconSun.mjs";
import IconTag from "@tabler/icons-react/dist/esm/icons/IconTag.mjs";
import IconTarget from "@tabler/icons-react/dist/esm/icons/IconTarget.mjs";
import IconTool from "@tabler/icons-react/dist/esm/icons/IconTool.mjs";
import IconTrophy from "@tabler/icons-react/dist/esm/icons/IconTrophy.mjs";
import IconTrash from "@tabler/icons-react/dist/esm/icons/IconTrash.mjs";
import IconUsers from "@tabler/icons-react/dist/esm/icons/IconUsers.mjs";
import IconWorld from "@tabler/icons-react/dist/esm/icons/IconWorld.mjs";
import IconWriting from "@tabler/icons-react/dist/esm/icons/IconWriting.mjs";
import IconX from "@tabler/icons-react/dist/esm/icons/IconX.mjs";
import { emptyDocument, seedWorkspace } from "./domain/workspaceSeed.js";
import { deriveFolderSummary, derivePageSummary, documentToPlainText, formatDateTime } from "./domain/content.js";
import { coverGallery, coverGalleryGroups, coverGalleryItem, normalizeCoverChoice } from "./data/coverGallery.js";
import { AppearanceGlyph } from "./components/AppearanceGlyph.jsx";
import { AttachmentMediaContext } from "./components/AttachmentMedia.jsx";
import { PageCover } from "./components/PageCover.jsx";
import { coverWithPosition } from "./components/coverPosition.js";
import { PageActionsMenu } from "./components/PageActionsMenu.jsx";
import { PageHistoryDialog } from "./components/PageHistoryDialog.jsx";
import { PagePresentation } from "./components/PagePresentation.jsx";
import { DatabaseHistoryDialog } from "./components/DatabaseHistoryDialog.jsx";
import { captureDatabaseVersions, recordDatabaseVersion, previewDatabaseRestore, restoreDatabaseVersion, assertDatabaseRestoreAttachments } from "./domain/databaseHistory.js";
import { archivePage, archiveRootPageId, isPageArchived } from "./domain/archive.js";
import { BacklinksPanel } from "./components/BacklinksPanel.jsx";
import { SettingsDialog } from "./components/SettingsDialog.jsx";
import { CsvImportDialog } from "./components/CsvImportDialog.jsx";
import { NotionImportDialog } from "./components/NotionImportDialog.jsx";
import { MarkdownExportDialog } from "./components/MarkdownExportDialog.jsx";
import { buildNotionImport } from "./import/notionImport.js";
import { mergeImportedWorkspace } from "./import/mergeImportedWorkspace.js";
import { PageExportDialog } from "./components/PageExportDialog.jsx";
import { TrashView } from "./components/TrashView.jsx";
import { DatabaseView } from "./components/DatabaseView.jsx";
import { useSharedFormInbox } from "./components/useSharedFormInbox.js";
import { RecordProperties } from "./components/RecordProperties.jsx";
import { duplicatePageIndependently, importPageBundle } from "./domain/pageBundle.js";
import { relationFilterDefaults } from "./domain/databaseFilters.js";
import { emptyAssetPreferences } from "./data/appearancePreferences.js";
import { workspaceSchemaVersion } from "./persistence/workspaceRepository.js";
import { createAutosaveController } from "./persistence/autosaveController.js";
import { applyContrast, applyTheme, resolveTheme, normalizeThemePreference, nextThemePreference, systemPrefersDark, watchSystemContrast, watchSystemTheme, writeCachedPreference } from "./ui/theme.js";
import { readDevicePreferences, subscribeDevicePreferences, updateDevicePreferences } from "./ui/devicePreferences.js";
import { isAltGraphKeyboardEvent, isComposingKeyboardEvent } from "./ui/keyboard.js";
import { BackupDialog, WorkspaceRescueDialog } from "./components/BackupDialog.jsx";
import { FolderMoveDialog } from "./components/FolderMoveDialog.jsx";
import { ConfirmDialog } from "./ui/ConfirmDialog.jsx";
import { hasOpenModal, useModalFocus } from "./ui/Dialog.jsx";
import { useDialogs } from "./ui/DialogProvider.jsx";
import { trashFolder, trashPage, restoreTrashGroup, deleteTrashGroupPermanently, emptyTrash as emptyWorkspaceTrash, listTrashGroups, pageAvailability } from "./domain/trash.js";
import { checkWorkspaceIntegrity } from "./domain/integrity.js";
import { createSyncedContentStore } from "./domain/syncedContent.js";
import { PROPERTY_LABELS, READ_ONLY_PROPERTY_TYPES, normalizePropertyValue, safePropertyHref } from "./domain/databaseProperties.js";
import { executeDatabaseAction } from "./domain/databaseActions.js";
import { applyStatusChange, applyStatusChanges, captureStatusChange, hasStatusWorkflow } from "./domain/statusWorkflows.js";
import { initialViewConfig, VIEW_REGISTRY } from "./domain/viewRegistry.js";
import { buildSearchDocuments, querySearch, searchSnippet } from "./search/searchIndex.js";
import { applyDatabaseTemplate, createDatabaseTemplate, createPageTemplate, defaultTemplateFolderId, instantiatePageTemplate, templateFolderChoices } from "./domain/templates.js";
import { instantiateTemplate } from "./templates/instantiate.js";
import { getBuiltinTemplate } from "./templates/registry.js";
import { createComment, createDiscussion, pageAnchor, setDiscussionResolved } from "./domain/comments.js";
import { createAttachmentMetadata, persistBrowserAttachment, resolveBrowserAttachmentUrl } from "./domain/attachments.js";
import { PageWorkspaceTools } from "./components/PageWorkspaceTools.jsx";
import { WorkspaceSidebar as Sidebar } from "./components/WorkspaceSidebar.jsx";
import { WorkspaceTopbar } from "./components/WorkspaceTopbar.jsx";
import { WorkspaceLibrary } from "./components/WorkspaceLibrary.jsx";
import { WorkspaceTabs } from "./components/WorkspaceTabs.jsx";
import { createWorkspaceNavigation, restoreWorkspacePageTabs } from "./domain/workspaceNavigation.js";
import { WorkspaceHome, RecentPages } from "./components/WorkspaceHome.jsx";
import { RenameWorkspaceDialog, AboutWorkspaceDialog } from "./components/WorkspaceIdentityDialogs.jsx";
import { recordVisit } from "./domain/recents.js";
import { favoritePages, toggleFavorite, moveFavorite } from "./domain/favorites.js";
import { createHistory, pushLocation, goBack, goForward } from "./domain/navigationHistory.js";
import { blockContext, cloneBlockDocument, walkBlocks } from "./domain/blockDocument.js";
import { resolveDatabaseOccurrenceLocation } from "./domain/databaseOccurrenceNavigation.js";
import { serializeDatabaseOccurrenceViewIds, serializeDatabaseOccurrenceSourceIds, resolveDatabaseOccurrenceViews } from "./domain/databaseOccurrenceViews.js";
import { normalizeRecordLayout } from "./domain/recordLayout.js";
import { applyDependencyDateChange, applyDependencyDateChanges, normalizeDependencyConfig, setItemDependencies as changeItemDependencies } from "./domain/databaseDependencies.js";
import { setDatabaseItemParent as changeDatabaseItemParent } from "./domain/databaseSubitems.js";
import { DatabaseOccurrenceDocument } from "./components/DatabaseOccurrenceDocument.jsx";
import { moveSidebarNode } from "./domain/sidebarDrag.js";
import { QuickCapture } from "./components/QuickCapture.jsx";
import { InboxView } from "./components/InboxView.jsx";
import { useI18n } from "./i18n/workspaceRuntime.js";
import { archivePages, inboxPages, markRemindersRead } from "./domain/inbox.js";
import { markdownToBlocks, captureTitle } from "./domain/markdownBlocks.js";
import { newNotePage } from "./domain/newPage.js";
import { processReminders } from "./domain/reminders.js";
import { recordEdit, restorePageVersion as restorePageVersionRecord } from "./domain/pageHistory.js";
import { applyTrackedPageEdit, captureTrackedPageVersions, isTrackedPageEdit, planTrackedPageCaptures } from "./domain/pageHistoryCapture.js";
import { updateTableItemsProperty } from "./domain/tableRecordActions.js";
import { canEditDatabaseSource, canEditDatabaseItems } from "./domain/databaseWriteAccess.js";
import { useBacklinkIndex } from "./ui/useBacklinkIndex.js";
import { allocateUniqueIds, assignUniqueIds, convertPropertyType, deleteProperty, updatePropertyDefinition } from "./domain/propertyChanges.js";
import { buildCsvDatabase, importCsvIntoSource } from "./domain/csv.js";
import { appendBlocksToPage as appendPageBlocks } from "./domain/blockMoves.js";
import { FindBar } from "./editor/FindBar.jsx";
import { ShortcutPanel } from "./editor/ShortcutPanel.jsx";
import { IconButton } from "./ui/IconButton.jsx";
import { childFolders as childrenOf, compareNavigationOrder as compareOrder, topLevelPages as pagesOf, folderAncestors, pageAncestors, moveFolder, renameFolder as renameWorkspaceFolder } from "./domain/navigation.js";
import { moveOwnedPage } from "./domain/pageMoves.js";
import {
  defaultPageSettings,
  duplicatePage,
  movePageToTrash,
  normalizePageSettings,
  parsePageImport,
  restorePageFromTrash,
} from "./domain/pageActions.js";
import {
  createDataSource,
  createDatabaseItem as createDatabaseItemRecord,
  defaultDatabaseItemValues,
  duplicateDatabaseItem as duplicateDatabaseItemRecord,
  createDatabaseView as createDatabaseViewRecord,
  ensureMapPlaceProperty,
  createLinkedView,
  createProperty,
  createRelation,
  applyRelationChange,
  createStarterDatabase,
  databaseId,
  dataSourceById,
  makeDatabaseItemPage,
  updateDatabaseItemValue as updateDatabaseItemValueRecord,
  updateDatabaseView as updateDatabaseViewRecord,
} from "./domain/database.js";

const LazyPageEditor = lazy(() => import("./editor/PageEditor.jsx").then((module) => ({ default: module.PageEditor })));
const LazyPageCustomizePanel = lazy(() => import("./components/PageCustomizePanel.jsx").then((module) => ({ default: module.PageCustomizePanel })));
const LazyMarketplaceView = lazy(() => import("./components/MarketplaceView.jsx").then((module) => ({ default: module.MarketplaceView })));

const emojiGroups = [
  { id: "people", label: "人物", values: ["😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🥸","🤩","🥳","😏","😒","😞","😔","😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🫡","🤭","🫢","🤫","🤥","😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵","🤐","🥴","🤢","🤮","🤧","😷","🤒","🤕"] },
  { id: "hands", label: "手势", values: ["👋","🤚","🖐️","✋","🖖","👌","🤌","🤏","✌️","🤞","🫰","🤟","🤘","🤙","👈","👉","👆","👇","☝️","👍","👎","✊","👊","🤛","🤜","👏","🙌","🫶","👐","🤲","🤝","🙏","✍️","💅","🤳"] },
  { id: "nature", label: "自然", values: ["🌱","🌿","☘️","🍀","🎍","🪴","🎋","🍃","🍂","🍁","🌾","🌵","🌴","🌳","🌲","🪵","🪨","🌊","💧","🔥","🌈","☀️","🌤️","⛅","🌥️","☁️","🌧️","⛈️","🌨️","❄️","🌙","⭐","🌟","✨","⚡","☄️","🌍","🌎","🌏","🪐"] },
  { id: "objects", label: "物品", values: ["📄","📚","📖","📘","📗","📕","📙","📓","📒","🗂️","📁","📂","🗒️","📝","✏️","🖊️","🖋️","📌","📍","📎","🖇️","📐","📏","🧮","🧠","💡","🧪","⚗️","🔬","🔭","🧭","🗺️","🧰","🛠️","⚙️","🔧","🔨","🪛","🔑","🔒","📦","🎁","🎒","💼","🧳","☕","🍵","🎧","📷","🎥","💻","⌨️","🖱️","📱","⌚"] },
  { id: "activities", label: "活动", values: ["🎯","🏆","🥇","🏅","🎨","🎭","🎬","🎮","🕹️","🎲","♟️","🎼","🎵","🎸","🎹","🥁","🎤","⚽","🏀","🏈","⚾","🎾","🏐","🏓","🏸","🥊","🚴","🏃","🧘","🏋️","✈️","🚀","🛶","⛵","🚗","🚆","🏠","🏫","🏢","🏛️"] },
  { id: "symbols", label: "符号", values: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","✅","☑️","✔️","❌","⭕","⚠️","❗","❓","‼️","💯","🔴","🟠","🟡","🟢","🔵","🟣","⚫","⚪","🟤","🔶","🔷","🔺","🔻","⭐","🌟","♻️","∞","➕","➖","✳️","✴️","〰️"] },
];

const iconLibrary = [
  ["activity","活动",IconActivity],["atom","原子",IconAtom],["award","奖章",IconAward],["book","书籍",IconBook2],
  ["briefcase","公文包",IconBriefcase],["bulb","灵感",IconBulb],["calendar","日历",IconCalendar],["camera","相机",IconCamera],
  ["chart","图表",IconChartBar],["check","完成",IconCheck],["clock","时间",IconClock],["code","代码",IconCode],
  ["coffee","咖啡",IconCoffee],["compass","指南针",IconCompass],["cpu","芯片",IconCpu],["database","数据库",IconDatabase],
  ["gamepad","游戏",IconDeviceGamepad2],["file","文档",IconFileDescription],["flask","实验",IconFlask2],["folder","文件夹",IconFolder],
  ["globe","地球",IconGlobe],["heart","喜欢",IconHeart],["home","主页",IconHome2],["leaf","叶子",IconLeaf],
  ["link","链接",IconLink],["map","地图",IconMap],["message","消息",IconMessageCircle],["moon","月亮",IconMoon],
  ["music","音乐",IconMusic],["notes","笔记",IconNotes],["palette","设计",IconPalette],["plane","旅行",IconPlane],
  ["photo","图片",IconPhoto],["rocket","火箭",IconRocket],["school","学习",IconSchool],["search","搜索",IconSearch],
  ["settings","设置",IconSettings],["sparkles","灵感",IconSparkles],["star","星标",IconStar],["sun","太阳",IconSun],
  ["tag","标签",IconTag],["target","目标",IconTarget],["tool","工具",IconTool],["trophy","奖杯",IconTrophy],
  ["users","团队",IconUsers],["world","世界",IconWorld],["writing","写作",IconWriting],["bolt","闪电",IconBolt],
].map(([name, label, Component]) => ({ name, label, Component }));

const iconComponentByName = Object.fromEntries(iconLibrary.map((item) => [item.name, item.Component]));
const iconColorChoices = [
  { id: "stone", label: "灰", value: "#b7b7b7" },
  { id: "red", label: "红", value: "#e56b6f" },
  { id: "orange", label: "橙", value: "#e89555" },
  { id: "amber", label: "黄", value: "#d9ad4f" },
  { id: "green", label: "绿", value: "#6eb57b" },
  { id: "teal", label: "青", value: "#55b7ae" },
  { id: "blue", label: "蓝", value: "#6fa8dc" },
  { id: "indigo", label: "靛", value: "#7f8ce0" },
  { id: "purple", label: "紫", value: "#a887df" },
  { id: "pink", label: "粉", value: "#d983ad" },
  { id: "brown", label: "棕", value: "#b58a6a" },
  { id: "white", label: "白", value: "#e7e7e7" },
];

const sectionMeta = {
  home: { title: "首页" },
  inbox: { title: "收件箱" },
  recents: { title: "最近访问" },
  library: { title: "资料库" },
  private: { title: "Private" },
  market: { title: "模板与市场" },
  trash: { title: "回收站" },
};

function colorClass(color) {
  return `color-${color ?? "stone"}`;
}

function folderById(folders, id) {
  return folders.find((folder) => folder.id === id) ?? null;
}

function pageById(pages, id) {
  return pages.find((page) => page.id === id) ?? null;
}

function isPageInsideFolder(page, folderId, folders) {
  if (!page) return false;
  let currentId = page.folderId;
  const seen = new Set();
  while (currentId && !seen.has(currentId)) {
    if (currentId === folderId) return true;
    seen.add(currentId);
    currentId = folderById(folders, currentId)?.parentId ?? null;
  }
  return false;
}

function firstPageInFolder(folderId, folders, pages) {
  const folder = folderById(folders, folderId);
  const remembered = pageById(pages, folder?.lastOpenedPageId);
  if (remembered && isPageInsideFolder(remembered, folderId, folders)) return remembered;

  const direct = pagesOf(pages, folderId)[0];
  if (direct) return direct;

  for (const child of childrenOf(folders, folderId)) {
    const nested = firstPageInFolder(child.id, folders, pages);
    if (nested) return nested;
  }
  return null;
}

function descendantFolderIds(folders, folderId) {
  const result = new Set([folderId]);
  const visit = (id) => {
    for (const child of childrenOf(folders, id)) {
      if (!result.has(child.id)) {
        result.add(child.id);
        visit(child.id);
      }
    }
  };
  visit(folderId);
  return result;
}

function nextSortIndex(items) {
  return items.reduce((max, item) => Math.max(max, item.sortIndex ?? 0), 0) + 10;
}

function makeId(prefix) {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function PageGlyph({ icon, color, className = "" }) {
  return <AppearanceGlyph icon={icon} color={color} className={className} />;
}

function coverStyle(cover) {
  if (!cover) return undefined;
  const normalized = normalizeCoverChoice(cover);
  if (normalized.kind === "upload" && normalized.value) {
    return {
      backgroundImage: `linear-gradient(rgba(0,0,0,.08), rgba(0,0,0,.14)), url("${normalized.value}")`,
      backgroundPosition: `center ${normalized.position ?? 50}%`,
    };
  }
  if (normalized.kind === "gallery") {
    const item = coverGalleryItem(normalized.value);
    if (item) {
      return {
        backgroundImage: `linear-gradient(rgba(0,0,0,.04), rgba(0,0,0,.12)), url("${item.src}")`,
        backgroundPosition: `center ${normalized.position ?? 50}%`,
      };
    }
  }
  return undefined;
}

function FolderView({ folder, folders, pages, onOpenPage, onCreatePage, onCreateFolder, onContextMenu }) {
  const { locale, t } = useI18n();
  const [sortMode, setSortMode] = useState("updated");
  const directPages = useMemo(() => pagesOf(pages, folder.id).map((page) => ({
    ...page,
    summary: page.summary || derivePageSummary(page),
  })), [pages, folder.id]);
  const childFolders = childrenOf(folders, folder.id);
  const sortedPages = useMemo(() => {
    const result = directPages.slice();
    if (sortMode === "created") return result.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (sortMode === "title") return result.sort((a, b) => String(a.title).localeCompare(String(b.title)));
    return result.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }, [directPages, sortMode]);
  const folderSummary = folder.summary || deriveFolderSummary(folder, directPages);

  return (
    <article className="folder-view" aria-label={t("folder.viewAria", { name: folder.name })}>
      <header className="folder-view-header">
        <div className="folder-view-title-group">
          <div className={`folder-view-icon ${colorClass(folder.color)}`}><IconFolder size={30} stroke={1.55} /></div>
          <div>
            <h1>{folder.name}</h1>
            <p>{folderSummary}</p>
            <div className="folder-view-counts">
              <span>{t("folder.noteCount", { count: directPages.length })}</span>
              <span aria-hidden="true">·</span>
              <span>{t("folder.subfolderCount", { count: childFolders.length })}</span>
            </div>
          </div>
        </div>
        <div className="folder-view-actions">
          <button type="button" className="ghost-button folder-create-button" onClick={onCreateFolder}><IconFolderPlus size={17} stroke={1.8} />{t("nav.newFolder")}</button>
          <button type="button" className="primary-button folder-create-button" onClick={onCreatePage}><IconFilePlus size={17} stroke={1.8} />{t("folder.newNote")}</button>
        </div>
      </header>

      <div className="folder-list-toolbar">
        <div className="folder-list-label">{t("folder.notesLabel")}</div>
        <label className="folder-sort-control">
          <IconArrowsSort size={15} stroke={1.8} />
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value)} aria-label={t("folder.sortAria")}>
            <option value="updated">{t("folder.sortUpdated")}</option>
            <option value="created">{t("folder.sortCreated")}</option>
            <option value="title">{t("folder.sortTitle")}</option>
          </select>
        </label>
      </div>

      {sortedPages.length > 0 ? (
        <div className="folder-note-list" role="list">
          <div className="folder-note-columns" aria-hidden="true">
            <span>{t("folder.colName")}</span>
            <span>{t("folder.colCreated")}</span>
            <span>{t("folder.colUpdated")}</span>
            <span />
          </div>
          {sortedPages.map((page) => {
            const pageTitle = page.title || t("backlinks.untitled");
            return (
            <div
              role="listitem"
              className="folder-note-row"
              key={page.id}
              onContextMenu={(event) => {
                event.preventDefault();
                onContextMenu(event, { type: "page", id: page.id });
              }}
            >
              <button type="button" className="folder-note-main" onClick={() => onOpenPage(page.id)}>
                <span className="folder-note-icon"><PageGlyph icon={page.icon} color={page.iconColor} /></span>
                <span className="folder-note-copy">
                  <strong>{pageTitle}</strong>
                  <small>{page.summary}</small>
                </span>
              </button>
              <span className="folder-note-time">{formatDateTime(page.createdAt, locale)}</span>
              <span className="folder-note-time">{formatDateTime(page.updatedAt, locale)}</span>
              <button type="button" className="folder-note-more" aria-label={t("folder.noteActionsAria", { title: pageTitle })} aria-haspopup="menu"
                onClick={(event) => { event.stopPropagation(); onContextMenu(event, { type: "page", id: page.id }); }}>
                <IconDots size={17} stroke={1.8} />
              </button>
            </div>
            );
          })}
        </div>
      ) : (
        <div className="folder-list-empty">
          <IconFileDescription size={24} stroke={1.6} />
          <div><strong>{t("folder.emptyNotes")}</strong><p>{t("folder.emptyNotesDesc")}</p></div>
          <button type="button" className="text-action" onClick={onCreatePage}><IconPlus size={16} stroke={1.8} />{t("folder.newFirstNote")}</button>
        </div>
      )}
    </article>
  );
}

function documentHasDatabaseBlock(blocks) {
  return (blocks || []).some((block) => block.type === "databaseView" || documentHasDatabaseBlock(block.children));
}

function PageDocument({
  page,
  folderPath,
  saveState,
  onTitleChange,
  onContentChange,
  onChangeIcon,
  onChangeCover,
  onSaveCoverPosition,
  onEditorApiChange,
  onHistoryStateChange,
  databaseRuntime,
  backlinkIndex,
  documentRef,
  focusBlockId,
  onBlockFocused,
  qaFocusCoverAction = false,
}) {
  const { locale, t } = useI18n();
  const settings = normalizePageSettings(page.settings);
  const isDatabasePage = page.pageType === "database" && Boolean(page.databaseSourceId);
  const saveStateLabel = saveState === "error" ? t("status.saveError") : saveState === "saving" ? t("status.saving") : t("status.saved");
  return (
    <article
      ref={documentRef}
      className={`page-document page-font-${settings.fontFamily} ${settings.smallText ? "is-small-text" : ""} ${settings.fullWidth ? "is-full-width" : ""} ${settings.presentationMode === "focus" ? "is-focus-reading" : ""} ${settings.locked ? "is-locked" : ""}`}
      aria-label={t("page.editorAria")}
    >
      {page.cover && (
        <PageCover
          key={page.id}
          cover={page.cover}
          readOnly={settings.locked || settings.presentationMode === "focus"}
          onChangeCover={onChangeCover}
          onSavePosition={onSaveCoverPosition}
          focusChangeOnMount={qaFocusCoverAction}
        />
      )}
      <header className={`page-document-header ${page.cover ? "has-cover" : ""}`}>
        <button type="button" className="page-icon-button" title={settings.locked ? t("page.lockedTitle") : t("customize.changeIcon")} aria-label={settings.locked ? t("page.lockedTitle") : t("customize.changeIcon")} onClick={onChangeIcon} disabled={settings.locked}><PageGlyph icon={page.icon} color={page.iconColor} className="page-main-glyph" /></button>
        {!page.cover && !settings.locked && (
          <button type="button" className="page-add-cover-action" onClick={onChangeCover}><IconPhoto size={14} stroke={1.8} />{t("page.addCover")}</button>
        )}
        <input
          className="page-title-input"
          aria-label={t("page.titleAria")}
          value={page.title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder={t("backlinks.untitled")}
          readOnly={settings.locked}
        />
        <div className="page-document-secondary">
          <div className="page-document-meta">
            <span><IconClock size={14} stroke={1.7} />{t("page.createdAt", { time: formatDateTime(page.createdAt, locale) })}</span>
            <span aria-hidden="true">·</span>
            <span>{t("page.updatedAt", { time: formatDateTime(page.updatedAt, locale) })}</span>
            <span aria-hidden="true">·</span>
            <span className={saveState === "saved" ? "save-state is-saved" : "save-state"}>{saveStateLabel}</span>
          </div>
          <div className="page-path">{folderPath.map((folder) => folder.name).join(" / ")}</div>
          <PageWorkspaceTools page={page} runtime={databaseRuntime} />
        </div>
        <BacklinksPanel workspace={databaseRuntime.workspace} pageId={page.id} index={backlinkIndex} runtime={databaseRuntime} />
      </header>
      {isDatabasePage && !documentHasDatabaseBlock(page.content) && (
        <div className="page-full-database">
          <DatabaseView
            workspace={databaseRuntime?.workspace}
            sourceId={page.databaseSourceId}
            sourceIdsJson={JSON.stringify(page.databaseSourceIds ?? [page.databaseSourceId])}
            viewId={page.databaseViewId || databaseRuntime?.workspace?.databaseViews?.find((view) => view.sourceId === page.databaseSourceId)?.id}
            runtime={databaseRuntime}
            onSelectView={(databaseViewId) => databaseRuntime?.updatePageDatabaseView?.(page.id, databaseViewId)}
            onChangeViewSet={(props) => databaseRuntime?.materializeDatabaseOccurrence?.(page.id, props)}
            onUpdateView={databaseRuntime?.updateDatabaseView}
            onUpdateItemValue={databaseRuntime?.updateDatabaseItemValue}
            onCreateItem={databaseRuntime?.createDatabaseItem}
            onOpenItemPage={databaseRuntime?.openPage}
            onCreateView={databaseRuntime?.createDatabaseView}
            onAddProperty={databaseRuntime?.addDatabaseProperty}
            onTurnIntoPage={databaseRuntime?.createFullPageFromSource}
            onTurnIntoInline={() => databaseRuntime?.turnFullPageDatabaseInline?.(page.id)}
          />
        </div>
      )}
        <>
          {!isDatabasePage && <RecordProperties page={page} runtime={databaseRuntime} compact fullPage />}
          {(settings.locked || !page.content?.length || (page.content.length === 1 && page.content[0].type === "paragraph" && !page.content[0].content?.length && !page.content[0].children?.length)) && <div className="editor-hint" aria-hidden="true">
            <span>{settings.locked ? t("page.lockedHint") : <><strong>/</strong> {t("page.slashAddHint")}</>}</span>
          </div>}
          <Suspense fallback={<div className="editor-loading">{t("page.editorLoading")}</div>}>
            <LazyPageEditor
              key={`${page.id}:${page.importRevision || 0}:${isDatabasePage ? "database" : "document"}`}
              pageId={page.id}
              initialContent={page.content}
              onChange={onContentChange}
              locked={settings.locked}
              onEditorApiChange={onEditorApiChange}
              onHistoryStateChange={onHistoryStateChange}
              databaseRuntime={databaseRuntime}
              focusBlockId={focusBlockId}
              onBlockFocused={onBlockFocused}
            />
          </Suspense>
        </>
    </article>
  );
}

function LegacyPageCustomizeModal({ page, onClose, onSave }) {
  const [icon, setIcon] = useState(page.icon || "📄");
  const [iconColor, setIconColor] = useState(page.iconColor || iconColorChoices[0].value);
  const [cover, setCover] = useState(() => normalizeCoverChoice(page.cover ?? null));
  const [iconTab, setIconTab] = useState(() => page.icon?.startsWith("icon:") ? "icons" : page.icon?.startsWith("data:image/") ? "upload" : "emoji");
  const [emojiGroup, setEmojiGroup] = useState("people");
  const [iconQuery, setIconQuery] = useState("");
  const [coverTab, setCoverTab] = useState(page.cover?.kind === "upload" ? "upload" : "gallery");
  const [coverGroup, setCoverGroup] = useState("all");
  const currentEmojiGroup = emojiGroups.find((group) => group.id === emojiGroup) ?? emojiGroups[0];
  const filteredIcons = iconLibrary.filter((item) => {
    const query = iconQuery.trim().toLocaleLowerCase();
    return !query || item.name.includes(query) || item.label.toLocaleLowerCase().includes(query);
  });
  const visibleCovers = coverGroup === "all" ? coverGallery : coverGallery.filter((item) => item.group === coverGroup);

  function uploadCover(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCover({ kind: "upload", value: String(reader.result), position: 50 });
      setCoverTab("upload");
    };
    reader.readAsDataURL(file);
  }

  function uploadIcon(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setIcon(String(reader.result));
    reader.readAsDataURL(file);
  }

  return (
    <div className="modal-backdrop page-customize-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="page-customize-modal" role="dialog" aria-modal="true" aria-label="自定义页面" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><h2>自定义页面</h2><p>设置页面图标和封面。没有封面时保持极简。</p></div>
          <IconButton label="关闭" onClick={onClose}><IconX size={19} stroke={1.8} /></IconButton>
        </div>

        <section className="customize-section">
          <div className="customize-section-heading"><strong>页面图标</strong><span>Emoji / Icons / Upload</span></div>
          <div className="icon-picker">
            <div className="icon-picker-tabs" role="tablist" aria-label="图标来源">
              <button type="button" role="tab" aria-selected={iconTab === "emoji"} className={iconTab === "emoji" ? "is-active" : ""} onClick={() => setIconTab("emoji")}>Emoji</button>
              <button type="button" role="tab" aria-selected={iconTab === "icons"} className={iconTab === "icons" ? "is-active" : ""} onClick={() => setIconTab("icons")}>Icons</button>
              <button type="button" role="tab" aria-selected={iconTab === "upload"} className={iconTab === "upload" ? "is-active" : ""} onClick={() => setIconTab("upload")}>Upload</button>
            </div>

            {iconTab !== "upload" && (
              <label className="icon-picker-search">
                <IconSearch size={16} stroke={1.7} />
                <input
                  value={iconQuery}
                  onChange={(event) => setIconQuery(event.target.value)}
                  placeholder={iconTab === "emoji" ? "筛选 Emoji…" : "搜索图标…"}
                />
                {iconQuery && <button type="button" aria-label="清空搜索" onClick={() => setIconQuery("")}><IconX size={14} stroke={1.8} /></button>}
              </label>
            )}

            {iconTab === "emoji" && (
              <>
                <div className="emoji-category-tabs" aria-label="Emoji 分类">
                  {emojiGroups.map((group) => (
                    <button type="button" key={group.id} className={emojiGroup === group.id ? "is-active" : ""} onClick={() => setEmojiGroup(group.id)}>
                      {group.label}
                    </button>
                  ))}
                </div>
                <div className="icon-choice-grid emoji-choice-grid">
                  {currentEmojiGroup.values
                    .filter((choice) => !iconQuery.trim() || choice.includes(iconQuery.trim()))
                    .map((choice) => (
                      <button type="button" key={choice} title={choice} className={icon === choice ? "is-selected" : ""} onClick={() => setIcon(choice)}>{choice}</button>
                    ))}
                </div>
              </>
            )}

            {iconTab === "icons" && (
              <>
                <div className="icon-color-row">
                  <span>颜色</span>
                  <div className="icon-color-palette" aria-label="图标颜色">
                    {iconColorChoices.map((choice) => (
                      <button
                        type="button"
                        key={choice.id}
                        title={choice.label}
                        aria-label={choice.label}
                        className={iconColor === choice.value ? "is-selected" : ""}
                        style={{ "--swatch": choice.value }}
                        onClick={() => setIconColor(choice.value)}
                      />
                    ))}
                  </div>
                </div>
                <div className="icon-choice-grid vector-icon-grid">
                  {filteredIcons.map(({ name, label, Component }) => (
                    <button
                      type="button"
                      key={name}
                      title={label}
                      className={icon === `icon:${name}` ? "is-selected" : ""}
                      onClick={() => setIcon(`icon:${name}`)}
                    >
                      <Component size={22} stroke={1.7} style={{ color: iconColor }} />
                      <span>{label}</span>
                    </button>
                  ))}
                  {filteredIcons.length === 0 && <div className="icon-picker-empty">没有匹配的图标</div>}
                </div>
              </>
            )}

            {iconTab === "upload" && (
              <div className="icon-upload-panel">
                <div className="icon-upload-preview"><PageGlyph icon={icon} color={iconColor} /></div>
                <div>
                  <strong>上传自己的图标</strong>
                  <p>建议使用正方形 PNG、JPG 或 WebP。浏览器原型会先保存在本地数据中。</p>
                  <label className="ghost-button upload-cover-button"><IconPhoto size={16} stroke={1.8} />选择图片<input type="file" accept="image/*" onChange={(event) => uploadIcon(event.target.files?.[0])} /></label>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="customize-section">
          <div className="customize-section-heading"><strong>页面封面</strong><span>艺术图库 / 上传图片</span></div>
          <div className="cover-picker-tabs" role="tablist" aria-label="封面来源">
            <button type="button" role="tab" aria-selected={coverTab === "gallery"} className={coverTab === "gallery" ? "is-active" : ""} onClick={() => setCoverTab("gallery")}>Gallery</button>
            <button type="button" role="tab" aria-selected={coverTab === "upload"} className={coverTab === "upload" ? "is-active" : ""} onClick={() => setCoverTab("upload")}>Upload</button>
            {cover && <button type="button" className="cover-remove-tab" onClick={() => setCover(null)}>Remove</button>}
          </div>

          {coverTab === "gallery" && (
            <div className="cover-gallery-browser">
              <div className="cover-gallery-groups">
                {coverGalleryGroups.map((group) => (
                  <button type="button" key={group.id} className={coverGroup === group.id ? "is-active" : ""} onClick={() => setCoverGroup(group.id)}>{group.label}</button>
                ))}
              </div>
              <div className="cover-choice-grid art-cover-grid">
                {visibleCovers.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    title={`${item.title} · ${item.artist}`}
                    className={`cover-choice art-cover-choice ${cover?.kind === "gallery" && cover.value === item.id ? "is-selected" : ""}`}
                    onClick={() => setCover({ kind: "gallery", value: item.id, position: 50 })}
                  >
                    <img src={item.src} alt="" loading="lazy" />
                    <span><strong>{item.artist}</strong><small>{item.title}</small></span>
                  </button>
                ))}
              </div>
              <div className="cover-gallery-credit">The Metropolitan Museum of Art · Open Access CC0</div>
            </div>
          )}

          {coverTab === "upload" && (
            <div className="cover-upload-panel">
              <div className="cover-upload-preview" style={cover?.kind === "upload" ? coverStyle(cover) : undefined}>
                {cover?.kind !== "upload" && <IconPhoto size={28} stroke={1.5} />}
              </div>
              <div>
                <strong>上传自己的封面</strong>
                <p>使用横向图片效果最好。上传后仍可以通过下方滑杆调整取景位置。</p>
                <label className="ghost-button upload-cover-button"><IconPhoto size={16} stroke={1.8} />选择图片<input type="file" accept="image/*" onChange={(event) => uploadCover(event.target.files?.[0])} /></label>
              </div>
            </div>
          )}

          {cover && (
            <label className="cover-position-control">
              <span>封面位置</span>
              <input type="range" min="0" max="100" value={cover.position ?? 50} onChange={(event) => setCover((current) => ({ ...current, position: Number(event.target.value) }))} />
            </label>
          )}
        </section>

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>取消</button>
          <button type="button" className="primary-button" onClick={() => onSave({ icon, iconColor, cover })}>保存更改</button>
        </div>
      </div>
    </div>
  );
}

function HighlightText({ text, query }) {
  const value = String(text ?? "");
  const needle = String(query ?? "").trim();
  if (!needle) return value;
  const index = value.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (index < 0) return value;
  return <>{value.slice(0, index)}<mark>{value.slice(index, index + needle.length)}</mark>{value.slice(index + needle.length)}</>;
}

function SearchDialog({ documents, onClose, onOpenPage, onOpenFolder, initialQuery = "", initialFilter = "all" }) {
  const { locale, t } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState(initialFilter);
  const [archiveFilter, setArchiveFilter] = useState("active");
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useMemo(() => querySearch(documents, query, filter, { archive: archiveFilter }), [documents, query, filter, archiveFilter]);
  const active = results[Math.min(activeIndex, Math.max(0, results.length - 1))] ?? null;
  const dialog = useRef(null);
  const input = useRef(null);
  const list = useRef(null);
  const listId = useId();
  useModalFocus(dialog, { initialFocusRef: input, onClose });

  useEffect(() => setActiveIndex(0), [query, filter, archiveFilter]);
  useLayoutEffect(() => {
    const pane = list.current;
    const row = pane?.children[activeIndex];
    if (!row) return;
    const bounds = pane.getBoundingClientRect();
    const item = row.getBoundingClientRect();
    if (item.bottom > bounds.bottom) pane.scrollTop += item.bottom - bounds.bottom;
    else if (item.top < bounds.top) pane.scrollTop += item.top - bounds.top;
  }, [activeIndex, results]);

  function openResult(result) {
    if (!result) return;
    if (result.type === "folder") onOpenFolder(result.entityId);
    else if (result.pageId || result.type === "page") onOpenPage(result.pageId || result.entityId);
    onClose();
  }

  return (
    <div className="search-backdrop" role="presentation" onMouseDown={onClose}>
      <div ref={dialog} className="global-search-dialog" role="dialog" aria-modal="true" aria-label={t("search.globalAria")} tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
        <div className="global-search-input-row">
          <IconSearch size={19} stroke={1.8} />
          <input
            ref={input}
            role="combobox"
            aria-label={t("search.inputAria")}
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={active ? `${listId}-${active.id}` : undefined}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search.inputPh")}
            onKeyDown={(event) => {
              if (isComposingKeyboardEvent(event)) return;
              if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((value) => Math.max(0, Math.min(value + 1, results.length - 1))); }
              if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((value) => Math.max(value - 1, 0)); }
              if (event.key === "Enter") { event.preventDefault(); openResult(active); }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="search-filter-tabs">
          <select aria-label={t("search.archiveAria")} value={archiveFilter} onChange={(event) => setArchiveFilter(event.target.value)}>
            <option value="active">{t("search.archiveActive")}</option><option value="archived">{t("search.archiveArchived")}</option><option value="all">{t("search.archiveAll")}</option>
          </select>
          {[["all", t("search.tabAll")], ["pages", t("search.tabPages")], ["folders", t("search.tabFolders")], ["content", t("search.tabContent")]].map(([value, label]) => (
            <button type="button" key={value} aria-pressed={filter === value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>{label}</button>
          ))}
        </div>
        <div className="search-body">
          <div ref={list} id={listId} className="search-result-list" role="listbox" aria-label={t("search.resultsAria")}>
            {results.length > 0 ? results.map((result, index) => (
              <button
                type="button"
                role="option"
                id={`${listId}-${result.id}`}
                tabIndex={-1}
                aria-selected={index === activeIndex}
                key={result.id}
                className={`search-result-row ${index === activeIndex ? "is-active" : ""}`}
                onMouseMove={() => setActiveIndex(index)}
                onClick={() => openResult(result)}
              >
                <span className="search-result-icon">{result.type === "folder" ? <IconFolder size={18} stroke={1.7} /> : <IconFileDescription size={18} stroke={1.7} />}</span>
                <span className="search-result-copy">
                  <strong><HighlightText text={result.title} query={query} /></strong>
                  <small>{result.path}</small>
                  <span><HighlightText text={searchSnippet(result, query)} query={query} /></span>
                </span>
                <time>{formatDateTime(result.updatedAt, locale)}</time>
              </button>
            )) : <div className="search-empty"><IconSearch size={24} stroke={1.5} /><strong>{t("search.noResults")}</strong><span>{t("search.noResultsHint")}</span></div>}
          </div>
          <aside className="search-preview">
            {active ? (
              <>
                <div className="search-preview-title"><span>{active.type === "folder" ? "📁" : "📄"}</span><div><strong>{active.title}</strong><small>{active.path}</small></div></div>
                <div className="search-preview-meta">{t("page.updatedAt", { time: formatDateTime(active.updatedAt, locale) })}</div>
                <div className="search-preview-content"><HighlightText text={searchSnippet(active, query, 180)} query={query} /></div>
                <button type="button" className="ghost-button" onClick={() => openResult(active)}>{t("search.openItem")}</button>
              </>
            ) : <div className="search-preview-empty">{t("search.previewEmpty")}</div>}
          </aside>
        </div>
        <div className="search-footer"><span>{t("search.footerSelect")}</span><span>{t("search.footerOpen")}</span><span>{t("search.footerClose")}</span></div>
      </div>
    </div>
  );
}

function EmptyFolderDocument({ folder, onCreatePage }) {
  const { t } = useI18n();
  return (
    <article className="empty-folder-document">
      <div className={`empty-folder-icon ${colorClass(folder?.color)}`}><IconFolder size={28} stroke={1.65} /></div>
      <h1>{folder?.name ?? t("section.private")}</h1>
      <p>{t("folder.emptyDocDesc")}</p>
      <button type="button" className="text-action" onClick={onCreatePage}><IconPlus size={16} stroke={1.8} />{t("folder.newFirstPage")}</button>
    </article>
  );
}

function ContextMenu({ menu, folders, pages, onAction, onDismiss, favoritePageIds = [] }) {
  const { t } = useI18n();
  const container = useRef(null);
  useLayoutEffect(() => {
    if (menu) container.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [menu]);
  if (!menu) return null;
  const folder = menu.type === "folder" ? folderById(folders, menu.id) : null;
  const page = menu.type === "page" ? pageById(pages, menu.id) : null;
  return (
    <div
      className="sidebar-context-menu ui-popover ui-menu"
      ref={container}
      role="menu"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Tab") {
          if (event.key === "Escape") event.preventDefault();
          event.stopPropagation();
          onDismiss();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]:not(:disabled)')];
        const index = items.indexOf(document.activeElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 :
          (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        event.preventDefault();
        items[next]?.focus();
      }}
    >
      {menu.type === "root" && (
        <button type="button" role="menuitem" onClick={() => onAction("create-root-folder", menu)}>{t("ctx.newRootFolder")}</button>
      )}
      {menu.type === "folder" && (
        <>
          <div className="context-menu-caption">{folder?.name}</div>
          <button type="button" role="menuitem" onClick={() => onAction("create-page", menu)}>{t("nav.newPage")}</button>
          <button type="button" role="menuitem" onClick={() => onAction("create-folder", menu)}>{t("ctx.newSubfolder")}</button>
          <div className="context-menu-separator" />
          <button type="button" role="menuitem" onClick={() => onAction("rename-folder", menu)}>{t("ctx.rename")}</button>
          {folder?.parentId !== null && (
            <button type="button" role="menuitem" onClick={() => onAction("promote-folder-root", menu)}>{t("ctx.promoteRoot")}</button>
          )}
          <button type="button" role="menuitem" onClick={() => onAction("move-folder", menu)}>{t("move.title")}</button>
          <button type="button" role="menuitem" className="is-danger" onClick={() => onAction("delete-folder", menu)}>{t("actions.trash")}</button>
        </>
      )}
      {menu.type === "page" && (
        <>
          <div className="context-menu-caption">{page?.title}</div>
          <button type="button" role="menuitem" onClick={() => onAction("open-page", menu)}>{t("search.openItem")}</button>
          <button type="button" role="menuitem" onClick={() => onAction("rename-page", menu)}>{t("ctx.rename")}</button>
          <button type="button" role="menuitem" onClick={() => onAction("move-page", menu)}>{t("move.title")}</button>
          <button type="button" role="menuitem" onClick={() => onAction("favorite-page", menu)}>{favoritePageIds.includes(menu.id) ? t("actions.removeFavorite") : t("actions.addFavorite")}</button>
          {menu.favorite && <><button type="button" role="menuitem" disabled={favoritePageIds.indexOf(menu.id) <= 0} onClick={() => onAction("favorite-up", menu)}>{t("ctx.moveUp")}</button><button type="button" role="menuitem" disabled={favoritePageIds.indexOf(menu.id) >= favoritePageIds.length - 1} onClick={() => onAction("favorite-down", menu)}>{t("ctx.moveDown")}</button></>}
          <div className="context-menu-separator" />
          <button type="button" role="menuitem" className="is-danger" onClick={() => onAction("delete-page", menu)}>{t("actions.trash")}</button>
        </>
      )}
    </div>
  );
}

function ItemModal({ config, folders, pages, onClose, onSubmit }) {
  const { t } = useI18n();
  const targetFolder = config?.folderId ? folderById(folders, config.folderId) : null;
  const targetPage = config?.pageId ? pageById(pages, config.pageId) : null;
  const [value, setValue] = useState(config?.initialValue ?? "");
  const dialog = useRef(null);
  const input = useRef(null);
  useModalFocus(dialog, { initialFocusRef: input, onClose });
  if (!config) return null;

  const copy = {
    "create-page": [t("nav.newPage"), t("modal.addToFolder", { name: targetFolder?.name ?? t("section.private") }), t("modal.pageTitleLabel"), t("modal.createPagePh"), t("modal.createPageBtn")],
    "create-folder": [t("ctx.newSubfolder"), t("modal.addToFolder", { name: targetFolder?.name ?? t("section.private") }), t("modal.folderNameLabel"), t("modal.createFolderPh"), t("modal.createFolderBtn")],
    "create-root-folder": [t("ctx.newRootFolder"), t("modal.addToPrivate"), t("modal.folderNameLabel"), t("modal.createRootFolderPh"), t("modal.createFolderBtn")],
    "rename-folder": [t("modal.renameFolderTitle"), targetFolder?.name ?? "", t("modal.newNameLabel"), t("modal.folderNameLabel"), t("common.save")],
    "rename-page": [t("modal.renamePageTitle"), targetPage?.title ?? "", t("modal.newTitleLabel"), t("modal.pageTitleLabel"), t("common.save")],
  }[config.mode];

  function submit(event) {
    event.preventDefault();
    const name = value.trim();
    if (!name) return;
    onSubmit(name);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form ref={dialog} className="new-folder-modal ui-dialog" role="dialog" aria-modal="true" aria-label={copy[0]} onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><h2>{copy[0]}</h2><p>{copy[1]}</p></div>
          <IconButton label={t("common.close")} onClick={onClose}><IconX size={19} stroke={1.8} /></IconButton>
        </div>
        <label className="field-label" htmlFor="item-name">{copy[2]}</label>
        <input id="item-name" ref={input} value={value} onChange={(event) => setValue(event.target.value)} placeholder={copy[3]} />
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="primary-button" disabled={!value.trim()}><IconPlus size={17} stroke={1.8} />{copy[4]}</button>
        </div>
      </form>
    </div>
  );
}

function PageMoveModal({ page, folders, onClose, onMove, restoreFocusRef }) {
  const { t } = useI18n();
  const dialog = useRef(null);
  const select = useRef(null);
  useModalFocus(dialog, { initialFocusRef: select, restoreFocusRef, onClose });
  const [folderId, setFolderId] = useState(page?.folderId ?? folders[0]?.id ?? "");
  const sortedFolders = useMemo(
    () => folders.filter((folder) => !folder.system && !folder.trashedAt).sort((a, b) => {
      const aPath = ["Private", ...folderAncestors(folders, a.id).map((item) => item.name)].join(" / ");
      const bPath = ["Private", ...folderAncestors(folders, b.id).map((item) => item.name)].join(" / ");
      return aPath.localeCompare(bPath);
    }),
    [folders],
  );

  if (!page) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="new-folder-modal page-move-modal ui-dialog"
        role="dialog" aria-modal="true" aria-label={t("modal.movePageTitle")} ref={dialog}
        onSubmit={(event) => {
          event.preventDefault();
          if (folderId) onMove(folderId);
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div><h2>{t("modal.movePageTitle")}</h2><p>{t("modal.movePageDesc", { title: page.title || t("backlinks.untitled") })}</p></div>
          <IconButton label={t("common.close")} onClick={onClose}><IconX size={19} stroke={1.8} /></IconButton>
        </div>
        <label className="field-label" htmlFor="page-move-folder">{t("modal.targetFolderLabel")}</label>
        <select id="page-move-folder" ref={select} value={folderId} onChange={(event) => setFolderId(event.target.value)}>
          {sortedFolders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {["Private", ...folderAncestors(folders, folder.id).map((item) => item.name)].join(" / ")}
            </option>
          ))}
        </select>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="primary-button" disabled={!folderId || folderId === page.folderId}>{t("modal.movePageTitle")}</button>
        </div>
      </form>
    </div>
  );
}

export function App({ repository, initialWorkspace }) {
  const { locale, t } = useI18n();
  const query = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;
  const qaMode = query?.get("qa") ?? null;
  const [workspace, commitWorkspace] = useState(() => {
    const base = {
      ...initialWorkspace,
      folders: initialWorkspace.folders,
      pages: qaMode === "trash"
        ? initialWorkspace.pages.map((page) => page.id === "chemistry" ? movePageToTrash(page, new Date().toISOString()) : page)
        : initialWorkspace.pages,
      dataSources: initialWorkspace.dataSources ?? [],
      databaseItems: initialWorkspace.databaseItems ?? [],
      databaseViews: initialWorkspace.databaseViews ?? [],
      relations: initialWorkspace.relations ?? [],
      ui: initialWorkspace.ui ?? {},
    };
    if (qaMode !== "database") return base;
    const existingQaDatabase = base.pages.find((page) => page.id === "chemistry" && page.pageType === "database" && page.databaseSourceId);
    if (existingQaDatabase && base.dataSources.some((source) => source.id === existingQaDatabase.databaseSourceId)) return base;
    const starter = createStarterDatabase({ title: "化学知识库", ownerPageId: "chemistry", folderId: "parenting" });
    return {
      ...base,
      pages: [
        ...base.pages.map((page) => page.id === "chemistry"
          ? { ...page, title: "化学知识库", pageType: "database", databaseSourceId: starter.source.id, settings: { ...normalizePageSettings(page.settings), fullWidth: true, presentationMode: "full" } }
          : page),
        ...starter.pages,
      ],
      dataSources: [...base.dataSources, starter.source],
      databaseItems: [...base.databaseItems, ...starter.items],
      databaseViews: [...base.databaseViews, starter.view],
    };
  });
  const setWorkspace = useCallback((update) => {
    const now = Date.now(), ids = [];
    commitWorkspace((current) => {
      const next = typeof update === "function" ? update(current) : update;
      if (next === current || next.databaseVersions !== current.databaseVersions) return next;
      let index = 0;
      return captureDatabaseVersions(current, next, { now, idFactory: (prefix) => {
        const position = index++; return ids[position] ||= makeId(prefix);
      } });
    });
  }, []);
  const [syncedStore] = useState(() => createSyncedContentStore(initialWorkspace.syncedSources || [], (syncedSources) => setWorkspace((current) => ({ ...current, syncedSources }))));
  const [devicePreferences, setDevicePreferences] = useState(() => readDevicePreferences());
  const [restoredTabs] = useState(() => qaMode ? { ids: [], activeId: null }
    : restoreWorkspacePageTabs(devicePreferences, workspace.workspaceId, createWorkspaceNavigation(workspace)));
  const [tabIds, setTabIds] = useState(restoredTabs.ids);
  const [activeSection, setActiveSectionState] = useState(() => {
    if (qaMode) return qaMode === "trash" ? "trash" : "private";
    if (workspace.ui?.preferences?.startPage === "home") return "home";
    if (restoredTabs.activeId) return "private";
    return workspace.ui?.activeSection !== "market" && sectionMeta[workspace.ui?.activeSection] ? workspace.ui.activeSection : "private";
  });
  const [persistedSection, setPersistedSection] = useState(() => (activeSection === "market" ? "private" : activeSection));
  const [startPage] = useState(() => {
    const id = restoredTabs.activeId ?? workspace.ui?.selectedPageId ?? initialWorkspace.ui?.selectedPageId ?? null;
    return workspace.pages.find((page) => page.id === id && !page.trashedAt);
  });
  const [expanded, setExpanded] = useState(() => {
    const stored = [...(workspace.ui?.expandedFolderIds ?? initialWorkspace.ui?.expandedFolderIds ?? []), ...(workspace.ui?.expandedPageIds ?? initialWorkspace.ui?.expandedPageIds ?? [])];
    if (!startPage || (!startPage.parentPageId && !restoredTabs.activeId)) return new Set(stored);
    return new Set([...stored, ...folderAncestors(workspace.folders, startPage.folderId).map((folder) => folder.id), ...pageAncestors(workspace.pages, startPage.id).map((page) => page.id)]);
  });
  const [selectedFolderId, setSelectedFolderId] = useState(qaMode === "folder" ? "parenting" : restoredTabs.activeId && startPage ? startPage.folderId : workspace.ui?.selectedFolderId ?? initialWorkspace.ui?.selectedFolderId ?? "parenting");
  const qaPageMode = ["page", "customize", "icon-picker", "cover-picker", "cover-hover", "page-actions", "export", "database", "slash-menu"].includes(qaMode);
  const [selectedPageId, setSelectedPageIdState] = useState(qaMode === "folder" || qaMode === "trash" ? null : qaPageMode ? "chemistry" : startPage?.id ?? null);
  const [privateExpanded, setPrivateExpanded] = useState(initialWorkspace.ui?.privateExpanded ?? true);
  const qaContextMenu = import.meta.env.DEV && new URLSearchParams(window.location.search).get("qa") === "context-menu";
  const [contextMenu, setContextMenu] = useState(() => qaContextMenu ? { type: "folder", id: "parenting", x: 128, y: 296 } : null);
  const menuOpener = useRef(null);
  const pageActionsTriggerRef = useRef(null);
  const [modal, setModal] = useState(null);
  const [searchOpen, setSearchOpen] = useState(qaMode === "search");
  const [pageActionsOpen, setPageActionsOpen] = useState(qaMode === "page-actions");
  const [exportOpen, setExportOpen] = useState(qaMode === "export");
  const [backupOpen, setBackupOpen] = useState(false);
  const [marketDetailKey, setMarketDetailKey] = useState(null);
  const [marketDetailTitle, setMarketDetailTitle] = useState("");
  const [pendingMarketSave, setPendingMarketSave] = useState(null);
  const marketNavigationRevision = useRef(0);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findFocusKey, setFindFocusKey] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [pendingBlockFocus, setPendingBlockFocus] = useState(null);
  const [blockNavigation, setBlockNavigationState] = useState(() => {
    if (qaMode || !workspace.ui?.selectedBlockId || selectedPageId !== workspace.ui.selectedPageId) return null;
    const location = resolveDatabaseOccurrenceLocation(workspace, { pageId: workspace.ui.selectedPageId, blockId: workspace.ui.selectedBlockId });
    return location.block ? { pageId: location.pageId, blockId: location.blockId } : null;
  });
  const [historyPageId, setHistoryPageId] = useState(null);
  const [databaseHistoryTarget, setDatabaseHistoryTarget] = useState(null);
  const [presentationPageId, setPresentationPageId] = useState(null);
  const [historyNotice, setHistoryNotice] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    const openMapSettings = () => setSettingsOpen("maps");
    window.addEventListener("lifeatlas-open-map-settings", openMapSettings);
    return () => window.removeEventListener("lifeatlas-open-map-settings", openMapSettings);
  }, []);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [notionImportOpen, setNotionImportOpen] = useState(false);
  const [markdownExportOpen, setMarkdownExportOpen] = useState(false);
  const [renameWorkspaceOpen, setRenameWorkspaceOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [navigationHistory, setNavigationHistory] = useState(createHistory);
  const [sidebarWidth, setSidebarWidth] = useState(() => typeof workspace.ui?.sidebarWidth === "number" && workspace.ui.sidebarWidth >= 200 && workspace.ui.sidebarWidth <= 480 ? workspace.ui.sidebarWidth : 248);
  const [now, setNow] = useState(Date.now);
  const [backupStatus, setBackupStatus] = useState(null);
  const [movePageTargetId, setMovePageTargetId] = useState(null);
  const [moveFolderTargetId, setMoveFolderTargetId] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [workspaceNotice, setWorkspaceNotice] = useState(() => {
    if (qaMode || !workspace.ui?.selectedBlockId) return "";
    const location = resolveDatabaseOccurrenceLocation(workspace, { pageId: workspace.ui.selectedPageId, blockId: workspace.ui.selectedBlockId });
    return location.problem ? t("app.msg.entryMissing") : "";
  });
  const [vaultStatus, setVaultStatus] = useState({ exists: false, locked: true });
  const dialogs = useDialogs();
  const [editorHistory, setEditorHistory] = useState({ canUndo: false, canRedo: false });
  const [customizeTarget, setCustomizeTarget] = useState(() => {
    if (qaMode === "cover-picker") return { pageId: "chemistry", mode: "cover" };
    if (qaMode === "customize" || qaMode === "icon-picker") return { pageId: "chemistry", mode: "icon" };
    return null;
  });
  const [saveState, setSaveState] = useState("saved");
  const [saveError, setSaveError] = useState("");
  const [workspaceRescueOpen, setWorkspaceRescueOpen] = useState(false);
  const saveController = useRef(null);
  const savedAt = useRef(initialWorkspace.savedAt);
  const pageEditorApiRef = useRef(null);
  const pageEditorViewKey = useRef(null);
  const workspaceScrollRef = useRef(null);
  const tabViewStates = useRef(new Map());
  const tabBlockIds = useRef(new Map());
  const pageDocumentRef = useRef(null);
  const pendingNewPageFocus = useRef(null);
  const pendingDefaultFolder = useRef(null);
  const importInputRef = useRef(null);
  const historyTrackers = useRef(new Map());
  const editedThisSession = useRef(new Set());
  const reminderStartedAt = useRef(Date.now());
  const notificationKeys = useRef(new Set((initialWorkspace.ui?.reminderLog || []).map((entry) => entry.key)));
  const openPageRef = useRef(null);
  openPageRef.current = openPage;

  const {
    folders,
    pages,
    dataSources = [],
    databaseItems = [],
    databaseViews = [],
    relations = [],
  } = workspace;
  const workspaceUi = workspace.ui ?? {};
  const backlinkIndex = useBacklinkIndex(workspace);
  const workspaceName = workspaceUi.workspaceName || t("app.msg.mySpace");
  const sidebarCollapsed = Boolean(workspaceUi.sidebarCollapsed);
  const favorites = useMemo(() => favoritePages(workspace), [workspace.pages, workspace.folders, workspace.ui?.favoritePageIds]);
  const inboxCount = inboxPages(workspace).length + (workspaceUi.reminderLog || []).filter((entry) => !entry.readAt).length;
  const themePreference = normalizeThemePreference(workspaceUi.preferences?.theme);
  const assetPreferences = { ...emptyAssetPreferences, ...(workspaceUi.assetPreferences ?? {}) };
  const selectedFolder = useMemo(() => folderById(folders, selectedFolderId), [folders, selectedFolderId]);
  const selectedPage = useMemo(() => pageById(pages, selectedPageId), [pages, selectedPageId]);
  const selectedFolderPath = useMemo(() => folderAncestors(folders, selectedPage?.folderId ?? selectedFolderId), [folders, selectedPage, selectedFolderId]);
  const searchDocuments = useMemo(() => searchOpen ? buildSearchDocuments(folders, pages, workspace) : [], [searchOpen, folders, pages, workspace]);
  const meta = { title: t(`section.${activeSection}`) || sectionMeta[activeSection]?.title || "" };
  const workspaceNavigation = useMemo(() => createWorkspaceNavigation(workspace), [workspace]);
  const activeTabId = activeSection === "private" && workspaceNavigation.canOpenPage(selectedPageId) ? selectedPageId : null;
  const activeTabViewKey = activeTabId ? JSON.stringify([activeTabId, blockNavigation?.pageId === activeTabId ? blockNavigation.blockId : null]) : null;
  const visibleTabIds = useMemo(() => {
    const ids = tabIds.filter(workspaceNavigation.canOpenPage);
    if (activeTabId && !ids.includes(activeTabId)) ids.push(activeTabId);
    return ids.length === tabIds.length && ids.every((id, index) => id === tabIds[index]) ? tabIds : ids;
  }, [tabIds, workspaceNavigation, activeTabId]);
  const tabPages = visibleTabIds.map(workspaceNavigation.pageById);
  const workspacePanelId = "workspace-tab-panel";
  const tabCommands = useRef(null);
  tabCommands.current = { activeTabId, visibleTabIds, closePageTab, activatePageTab };

  useEffect(() => subscribeDevicePreferences(setDevicePreferences), []);
  useLayoutEffect(() => {
    if (visibleTabIds !== tabIds) setTabIds(visibleTabIds);
  }, [tabIds, visibleTabIds]);
  useEffect(() => {
    if (activeSection === "market" || qaMode || !workspace.workspaceId || !devicePreferences.reopenPageTabs) return;
    const session = { ids: visibleTabIds, activeId: activeTabId };
    if (JSON.stringify(readDevicePreferences().pageTabs[workspace.workspaceId]) !== JSON.stringify(session)) {
      updateDevicePreferences({ pageTabs: { [workspace.workspaceId]: session } });
    }
  }, [activeSection, qaMode, workspace.workspaceId, devicePreferences.reopenPageTabs, visibleTabIds, activeTabId]);

  useLayoutEffect(() => {
    const view = tabViewStates.current.get(activeTabViewKey);
    workspaceScrollRef.current?.scrollTo({ top: view?.scrollTop ?? 0, left: view?.scrollLeft ?? 0, behavior: "instant" });
  }, [activeSection, activeTabViewKey, selectedFolderId]);
  const selectedPageSettings = selectedPage ? normalizePageSettings(selectedPage.settings) : defaultPageSettings;
  const focusReading = activeSection === "private" && Boolean(selectedPage) && selectedPageSettings.presentationMode === "focus";
  const navigationRef = useRef(null);
  navigationRef.current = navigateHistory;
  const navigationBlockId = blockNavigation?.pageId === selectedPageId ? blockNavigation.blockId : null;
  const selectedOccurrence = useMemo(() => resolveDatabaseOccurrenceLocation(workspace, { pageId: selectedPageId, blockId: navigationBlockId }), [pages, selectedPageId, navigationBlockId]);

  useEffect(() => {
    if (!navigationBlockId || !selectedOccurrence.problem || selectedOccurrence.problem === "block-not-database-view") return;
    setBlockNavigation(null);
    setPendingBlockFocus(null);
    setWorkspaceNotice(t("app.msg.entryUnavailable"));
  }, [navigationBlockId, selectedOccurrence.problem]);

  useEffect(() => {
    if (selectedPage?.id !== pendingNewPageFocus.current) return;
    pageDocumentRef.current?.querySelector(".page-title-input")?.focus();
    pendingNewPageFocus.current = null;
  }, [selectedPage?.id]);

  useEffect(() => {
    if (folders.some((folder) => folder.id === pendingDefaultFolder.current?.id)) pendingDefaultFolder.current = null;
  }, [folders]);

  useEffect(() => {
    const location = activeSection === "private"
      ? { section: "private", ...(selectedPageId ? { pageId: selectedPageId } : {}), ...(navigationBlockId ? { blockId: navigationBlockId } : {}), folderId: selectedFolderId }
      : activeSection === "market"
        ? { section: "market", ...(marketDetailKey ? { marketItemKey: marketDetailKey } : {}) }
        : { section: activeSection };
    setNavigationHistory((history) => pushLocation(history, location));
  }, [activeSection, selectedPageId, selectedFolderId, navigationBlockId, marketDetailKey]);

  useEffect(() => {
    if (activeSection !== "private" || !selectedPageId) return undefined;
    const timer = setTimeout(() => setWorkspace((current) => current.pages.some((page) => page.id === selectedPageId && !page.trashedAt) ? { ...current, ui: recordVisit(current.ui, selectedPageId, new Date().toISOString()) } : current), 1000);
    return () => clearTimeout(timer);
  }, [activeSection, selectedPageId]);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [activeSection]);

  useEffect(() => {
    const check = (initial) => setWorkspace((current) => processReminders(current, { nowMs: Date.now(), startedAt: reminderStartedAt.current, initial }).workspace);
    check(true);
    const timer = setInterval(() => check(false), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    for (const entry of workspace.ui?.reminderLog || []) {
      if (notificationKeys.current.has(entry.key)) continue;
      notificationKeys.current.add(entry.key);
      if (entry.missed) continue;
      void window.lifeAtlas?.app?.notify?.({ title: entry.title, body: t("page.reminderTime", { time: formatDateTime(new Date(entry.fireAt).toISOString(), locale) }), pageId: entry.pageId }).then((result) => { if (result && !result.ok) setWorkspaceNotice(result.error?.message || t("page.notifyFailed")); }).catch(() => setWorkspaceNotice(t("page.notifyFailed")));
    }
  }, [workspace.ui?.reminderLog]);

  useEffect(() => {
    const stopCapture = window.lifeAtlas?.app?.onQuickCapture?.(() => { if (!hasOpenModal()) setCaptureOpen(true); });
    const stopNotification = window.lifeAtlas?.app?.onNotificationClick?.(({ pageId }) => {
      setWorkspace((current) => ({ ...current, ui: markRemindersRead(current.ui, pageId, new Date().toISOString()) }));
      openPageRef.current?.(pageId);
    });
    return () => { stopCapture?.(); stopNotification?.(); };
  }, []);

  useEffect(() => {
    if (activeSection !== "home" || !window.lifeAtlas?.backup?.getStatus) return undefined;
    let active = true;
    void window.lifeAtlas.backup.getStatus().then((result) => { if (active && result.ok) setBackupStatus(result.value); }).catch(() => {});
    return () => { active = false; };
  }, [activeSection, backupOpen]);

  useEffect(() => {
    const keyboard = (event) => {
      if (event.defaultPrevented || hasOpenModal() || isComposingKeyboardEvent(event) || isAltGraphKeyboardEvent(event)) return;
      if (event.ctrlKey && !event.altKey && event.key === "\\") {
        event.preventDefault();
        setWorkspace((current) => ({ ...current, ui: { ...current.ui, sidebarCollapsed: !current.ui?.sidebarCollapsed } }));
      }
      const back = event.altKey && !event.ctrlKey && event.key === "ArrowLeft" || event.ctrlKey && !event.altKey && event.key === "[";
      const forward = event.altKey && !event.ctrlKey && event.key === "ArrowRight" || event.ctrlKey && !event.altKey && event.key === "]";
      if (back || forward) { event.preventDefault(); navigationRef.current?.(back ? "back" : "forward"); }
    };
    window.addEventListener("keydown", keyboard);
    const stop = window.lifeAtlas?.app?.onNavigate?.(({ direction }) => { if (!hasOpenModal()) navigationRef.current?.(direction); });
    return () => { window.removeEventListener("keydown", keyboard); stop?.(); };
  }, []);

  const handleEditorApiChange = useCallback((api) => {
    if (!api && pageEditorViewKey.current !== activeTabViewKey) return;
    pageEditorApiRef.current = api;
    pageEditorViewKey.current = api ? activeTabViewKey : null;
    const savedView = tabViewStates.current.get(activeTabViewKey);
    if (api && savedView) api.restoreViewState?.(savedView);
    setEditorHistory(api?.getHistoryState?.() ?? { canUndo: false, canRedo: false });
  }, [activeTabViewKey]);

  const handleHistoryStateChange = useCallback((state) => {
    setEditorHistory(state ?? { canUndo: false, canRedo: false });
  }, []);

  useEffect(() => {
    if (qaMode !== "page-actions") setPageActionsOpen(false);
    setFindOpen(false);
    setEditorHistory({ canUndo: false, canRedo: false });
  }, [selectedPageId, qaMode]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!event.defaultPrevented && !hasOpenModal() && !isComposingKeyboardEvent(event) && !isAltGraphKeyboardEvent(event)
        && event.ctrlKey && event.altKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === "p") {
        const pageId = tabCommands.current.activeTabId;
        if (pageId) {
          event.preventDefault(); setPageActionsOpen(false); setPresentationPageId(pageId);
        }
        return;
      }
      if (event.defaultPrevented || hasOpenModal() || event.altKey || isComposingKeyboardEvent(event) || isAltGraphKeyboardEvent(event)) return;
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        setSearchOpen("pages");
      }
      const tabs = tabCommands.current;
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "w" && tabs.activeTabId) {
        event.preventDefault();
        tabs.closePageTab(tabs.activeTabId);
      }
      if (event.ctrlKey && !event.metaKey && event.key === "Tab" && tabs.visibleTabIds.length) {
        event.preventDefault();
        const index = tabs.visibleTabIds.indexOf(tabs.activeTabId);
        const next = index < 0 ? (event.shiftKey ? tabs.visibleTabIds.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + tabs.visibleTabIds.length) % tabs.visibleTabIds.length;
        tabs.activatePageTab(tabs.visibleTabIds[next]);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault();
        setShortcutsOpen(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "f" && pageDocumentRef.current) {
        event.preventDefault();
        setFindOpen(true);
        setFindFocusKey((current) => current + 1);
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLocaleLowerCase() === "n") {
        event.preventDefault();
        setCaptureOpen(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const snapshot = useMemo(() => {
    const folderIds = new Set(workspace.folders.map((folder) => folder.id));
    const pageIds = new Set(workspace.pages.map((page) => page.id));
    return {
      ...workspace,
      schemaVersion: workspaceSchemaVersion,
      ui: { ...workspace.ui, assetPreferences, expandedFolderIds: Array.from(expanded).filter((id) => folderIds.has(id)), expandedPageIds: Array.from(expanded).filter((id) => pageIds.has(id)), selectedFolderId, selectedPageId, selectedBlockId: selectedOccurrence.blockId, privateExpanded, activeSection: activeSection === "market" ? persistedSection : activeSection },
    };
  }, [workspace, expanded, selectedFolderId, selectedPageId, selectedOccurrence.blockId, privateExpanded, activeSection, persistedSection]);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  function currentWorkspaceSnapshot() {
    return { ...snapshotRef.current, ...(savedAt.current ? { savedAt: savedAt.current } : {}) };
  }

  function applyAssistantWorkspace(transform) {
    // Rebase the tool on queued user edits. Replayed React updaters must reuse
    // IDs created for this action, and the next tool must see the committed edit.
    let previous, next, applied, failure;
    flushSync(() => setWorkspace((current) => {
      if (current === previous) return next;
      previous = current;
      const state = { ...current, ui: { ...current.ui, selectedPageId: snapshotRef.current.ui.selectedPageId, selectedFolderId: snapshotRef.current.ui.selectedFolderId } };
      try {
        applied = transform(state);
        next = applied.workspace === state ? current : applied.workspace;
      } catch (error) { failure = error; next = current; }
      return next;
    }));
    if (failure) throw failure;
    const width = next.ui?.sidebarWidth;
    if (width !== previous.ui?.sidebarWidth && Number.isInteger(width) && width >= 200 && width <= 480) {
      setSidebarWidth(width);
    }
    const id = snapshotRef.current.ui.selectedPageId;
    const page = id && next.pages.find((entry) => entry.id === id);
    if (id && (!page || page.trashedAt)) {
      setSelectedPageId(null);
      setBlockNavigation(null);
      setPendingBlockFocus(null);
    } else if (page && page.folderId !== snapshotRef.current.ui.selectedFolderId) {
      setSelectedFolderId(page.folderId);
    }
    return applied;
  }

  const captureVersions = useCallback((flush = false) => {
    const time = Date.now();
    const planned = planTrackedPageCaptures(historyTrackers.current, time, { flush, idFactory: makeId });
    historyTrackers.current = planned.trackers;
    if (!planned.captures.length) return;
    if (flush) {
      const next = captureTrackedPageVersions(snapshotRef.current, planned.captures, time);
      snapshotRef.current = next;
      setWorkspace(next);
      saveController.current?.update(next);
    } else setWorkspace((current) => captureTrackedPageVersions(current, planned.captures, time));
  }, []);

  const flushWorkspace = useCallback(() => {
    captureVersions(true);
    return saveController.current?.flush() ?? Promise.resolve({ ok: false, error: { message: t("app.msg.notReady") } });
  }, [captureVersions]);

  useEffect(() => {
    const timer = window.setInterval(() => captureVersions(), 30000);
    return () => window.clearInterval(timer);
  }, [captureVersions]);

  useEffect(() => {
    if (!historyNotice) return undefined;
    const timer = window.setTimeout(() => setHistoryNotice(""), 2000);
    return () => window.clearTimeout(timer);
  }, [historyNotice]);

  useEffect(() => {
    const controller = createAutosaveController(repository, { onState: (state) => {
      setSaveState(state.status === "error" ? "error" : state.status === "saved" ? "saved" : "saving");
      if (state.savedAt) savedAt.current = state.savedAt;
      if (state.status === "error") setSaveError(state.error?.message || t("app.msg.saveErrorDesc"));
      if (state.status === "saved") setSaveError("");
    } });
    saveController.current = controller;
    const onUnload = () => { captureVersions(true); void controller.flush(); };
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);
    const stopFlush = window.lifeAtlas?.app?.onFlushRequest?.(async () => {
      captureVersions(true);
      const result = await controller.flush();
      if (result?.ok) await window.lifeAtlas.app.flushDone();
    });
    return () => { stopFlush?.(); window.removeEventListener("beforeunload", onUnload); window.removeEventListener("pagehide", onUnload); controller.dispose(); saveController.current = null; };
  }, [repository, captureVersions]);

  useEffect(() => { saveController.current?.update(snapshot); }, [snapshot]);

  useEffect(() => {
    document.documentElement.dataset.laReady = "1";
    const api = window.lifeAtlas?.app;
    let active = true;
    const receive = (value) => { if (active) setVaultStatus({ exists: Boolean(value.exists), locked: Boolean(value.locked) }); };
    void api?.getVaultStatus?.().then((result) => { if (result?.ok) receive(result.value); }).catch(() => {});
    const stop = api?.onVaultStatusChanged?.(receive);
    return () => { active = false; stop?.(); delete document.documentElement.dataset.laReady; };
  }, []);

  useEffect(() => {
    const apply = () => applyTheme(resolveTheme(themePreference, systemPrefersDark()));
    apply();
    writeCachedPreference(themePreference);
    void window.lifeAtlas?.app?.setThemeSource?.({ source: themePreference }).catch(() => {});
    return watchSystemTheme(apply);
  }, [themePreference]);

  useEffect(() => {
    const apply = () => applyContrast(devicePreferences.contrast);
    apply();
    void window.lifeAtlas?.app?.setContrastPreference?.({ preference: devicePreferences.contrast }).catch(() => {});
    return watchSystemContrast(apply);
  }, [devicePreferences.contrast]);

  function changeDevicePreferences(patch) {
    if (patch.reopenPageTabs === false && workspace.workspaceId) {
      updateDevicePreferences({ ...patch, pageTabs: { [workspace.workspaceId]: { ids: [], activeId: null } } });
    } else updateDevicePreferences(patch);
  }

  function cycleThemePreference() {
    setWorkspace((current) => ({ ...current, ui: { ...current.ui, preferences: { ...current.ui?.preferences, theme: nextThemePreference(themePreference) } } }));
  }

  function updatePreferences(patch) {
    setWorkspace((current) => ({ ...current, ui: { ...current.ui, preferences: { ...current.ui?.preferences, ...patch } } }));
  }

  useEffect(() => {
    const { problems } = checkWorkspaceIntegrity(initialWorkspace);
    const errors = problems.filter((problem) => problem.level === "error");
    if (errors.length) console.warn("Life Atlas workspace integrity", errors.map(({ code, level, id }) => ({ code, level, id })));
  }, [initialWorkspace]);

  function updateAssetPreferences(nextPreferences) {
    setWorkspace((current) => ({
      ...current,
      ui: {
        ...(current.ui ?? {}),
        assetPreferences: {
          ...emptyAssetPreferences,
          ...(nextPreferences ?? {}),
        },
      },
    }));
  }

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(null);
    const escape = (event) => event.key === "Escape" && close();
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", escape);
    };
  }, [contextMenu]);

  function toggleFolder(id) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function rememberPage(page) {
    if (!page) return;
    setWorkspace((current) => ({
      ...current,
      folders: current.folders.map((folder) =>
        isPageInsideFolder(page, folder.id, current.folders)
          ? { ...folder, lastOpenedPageId: page.id }
          : folder,
      ),
    }));
  }

  function savePageTabView() {
    if (!activeTabViewKey) return;
    const view = pageEditorViewKey.current === activeTabViewKey ? pageEditorApiRef.current?.getViewState?.() : null;
    const scroll = workspaceScrollRef.current;
    tabViewStates.current.set(activeTabViewKey, { ...tabViewStates.current.get(activeTabViewKey), ...view, scrollTop: scroll?.scrollTop ?? 0, scrollLeft: scroll?.scrollLeft ?? 0 });
    tabBlockIds.current.set(activeTabId, blockNavigation?.pageId === activeTabId ? blockNavigation.blockId : null);
  }

  function setActiveSection(section) {
    if (activeSection !== section) savePageTabView();
    if (section !== "market") {
      if (activeSection === "market") marketNavigationRevision.current += 1;
      setPersistedSection(section);
      setMarketDetailKey(null);
      setMarketDetailTitle("");
    }
    setActiveSectionState(section);
  }

  function openMarketplace(detailKey = null) {
    if (activeSection !== "market") savePageTabView();
    if (activeSection !== "market" || detailKey !== marketDetailKey) marketNavigationRevision.current += 1;
    setMarketDetailKey(detailKey);
    if (!detailKey) setMarketDetailTitle("");
    setActiveSectionState("market");
  }

  function setSelectedPageId(pageId) {
    if (selectedPageId !== pageId) savePageTabView();
    setSelectedPageIdState(pageId);
  }

  function setBlockNavigation(location) {
    if ((blockNavigation?.blockId ?? null) !== (location?.blockId ?? null)) savePageTabView();
    setBlockNavigationState(location);
  }

  function activatePageTab(pageId) {
    if (activeTabId === pageId) return;
    const blockId = tabBlockIds.current.get(pageId);
    if (blockId) openPageAt(pageId, blockId);
    else openPage(pageId);
  }

  function closePageTab(pageId) {
    const index = visibleTabIds.indexOf(pageId);
    if (index < 0) return;
    setTabIds((current) => current.filter((id) => id !== pageId));
    if (pageId !== activeTabId) return;
    const next = visibleTabIds[index + 1] ?? visibleTabIds[index - 1];
    if (next) activatePageTab(next);
    else {
      setBlockNavigation(null);
      setPendingBlockFocus(null);
      setSelectedPageId(null);
      setActiveSection("home");
    }
  }

  function closeOtherPageTabs(pageId) {
    setTabIds([pageId]);
    activatePageTab(pageId);
  }

  function openPage(id) {
    const availability = pageAvailability(workspace, id);
    if (availability !== "ok") { setWorkspaceNotice(availability === "trashed" ? t("app.msg.pageTrashed") : t("app.msg.pageMissing")); return; }
    const page = pageById(pages, id);
    if (!page || page.trashedAt) return;
    setBlockNavigation(null);
    setPendingBlockFocus(null);
    setSelectedPageId(page.id);
    setSelectedFolderId(page.folderId);
    setActiveSection("private");
    setPrivateExpanded(true);
    setExpanded((current) => new Set([...current, ...folderAncestors(folders, page.folderId).map((folder) => folder.id), ...pageAncestors(pages, page.id).map((ancestor) => ancestor.id)]));
    rememberPage(page);
  }

  function openFolder(id) {
    if (!folders.some((folder) => folder.id === id && !folder.trashedAt)) return;
    setBlockNavigation(null);
    setPendingBlockFocus(null);
    setSelectedFolderId(id);
    setSelectedPageId(null);
    setActiveSection("private");
    setPrivateExpanded(true);
    setExpanded((current) => new Set([...current, id, ...folderAncestors(folders, id).map((folder) => folder.id)]));
  }

  function openPageAt(pageId, blockId, viewId) {
    openPage(pageId);
    if (pageAvailability(workspace, pageId) !== "ok") return;
    if (viewId) {
      const page = pageById(pages, pageId);
      let nextContent = page?.content;
      if (Array.isArray(page?.content)) {
        const updateBlockView = (blocks) => blocks.map((b) => {
          if (b.type === "databaseView" && (!blockId || b.id === blockId)) {
            return { ...b, props: { ...b.props, viewId } };
          }
          if (Array.isArray(b.children) && b.children.length) {
            return { ...b, children: updateBlockView(b.children) };
          }
          return b;
        });
        nextContent = updateBlockView(page.content);
      }
      updatePage(pageId, { databaseViewId: viewId, content: nextContent });
    }
    if (!blockId) return;
    const page = pageById(pages, pageId);
    const target = blockContext(page?.content, blockId);
    if (!target) { setWorkspaceNotice(t("app.msg.locationMissing")); return; }
    if (target.block.type === "databaseView") {
      const location = resolveDatabaseOccurrenceLocation(workspace, { pageId, blockId });
      if (location.problem) { setWorkspaceNotice(t("app.msg.entryUnavailable")); return; }
    }
    setBlockNavigation({ pageId, blockId });
    if (target.block.type !== "databaseView") setPendingBlockFocus({ pageId, blockId });
  }

  function openPrivate() {
    setActiveSection("private");
    setPrivateExpanded(true);
  }

  function validLocation(location) {
    if (location.section !== "private") return Boolean(sectionMeta[location.section]);
    if (location.pageId) return pageAvailability(workspace, location.pageId) === "ok";
    return !location.folderId || folders.some((folder) => folder.id === location.folderId && !folder.trashedAt);
  }

  function navigateHistory(direction) {
    const result = (direction === "back" ? goBack : goForward)(navigationHistory, validLocation);
    if (!result.location) return;
    setNavigationHistory(result.history);
    const location = result.location;
    if (location.section === "market") openMarketplace(location.marketItemKey ?? null);
    else if (location.section !== "private") setActiveSection(location.section);
    else if (location.pageId) openPageAt(location.pageId, location.blockId);
    else if (location.folderId) openFolder(location.folderId);
    else { setSelectedPageId(null); setSelectedFolderId(null); setActiveSection("private"); }
  }

  function returnToMarketplaceList() {
    const previous = navigationHistory.entries[navigationHistory.index - 1];
    if (previous?.section === "market" && !previous.marketItemKey) navigateHistory("back");
    else openMarketplace();
  }

  function quickCreatePage() {
    createPage(selectedFolderId);
  }

  function togglePageFavorite(pageId) {
    setWorkspace((current) => ({ ...current, ui: toggleFavorite(current.ui, pageId) }));
  }

  function reorderFavorite(pageId, index) {
    setWorkspace((current) => ({ ...current, ui: moveFavorite(current.ui, pageId, index) }));
  }

  function dropSidebarNode(source, target, position) {
    const next = moveSidebarNode(currentWorkspaceSnapshot(), source, target, position, new Date().toISOString());
    setWorkspace(next);
    const folderId = source.kind === "page" ? next.pages.find((page) => page.id === source.id)?.folderId : target.kind === "folder" ? target.id : null;
    if (source.kind === "page" && selectedPageId === source.id) setSelectedFolderId(folderId);
    if (folderId) setExpanded((current) => new Set([...current, ...folderAncestors(next.folders, folderId).map((folder) => folder.id)]));
  }

  function updatePage(id, patch) {
    const page = snapshotRef.current.pages.find((entry) => entry.id === id);
    if (isPageArchived(snapshotRef.current, id)) return;
    const time = Date.now();
    const tracked = isTrackedPageEdit(page, patch);
    const beforeEditId = tracked && !editedThisSession.current.has(id) ? makeId("ver") : null;
    if (tracked) {
      editedThisSession.current.add(id);
      historyTrackers.current.set(id, recordEdit(historyTrackers.current.get(id), time));
    }
    setWorkspace((current) => applyTrackedPageEdit(current, { pageId: id, patch, now: time, beforeEditId }));
  }

  function updatePageContent(pageId, content) {
    const page = snapshotRef.current.pages.find((entry) => entry.id === pageId);
    if (!page || page.trashedAt || page.settings?.locked) throw new Error(t("app.msg.pageLocked"));
    updatePage(pageId, { content });
  }

  function updateDatabaseOccurrence(pageId, blockId, patch) {
    const current = snapshotRef.current;
    const page = current.pages.find((entry) => entry.id === pageId);
    if (!page || page.trashedAt || page.settings?.locked) return;
    const location = resolveDatabaseOccurrenceLocation(current, { pageId, blockId });
    if (!location.block) return;
    const original = location.block;
    const props = { ...original.props, ...patch };
    const replace = (blocks) => blocks.map((block) => block === original
      ? { ...block, props }
      : block.children?.length ? { ...block, children: replace(block.children) } : block);
    const declared = page.pageType === "database" && page.databaseSourceId === original.props.sourceId && page.databaseViewId === original.props.viewId
      && walkBlocks(page.content).filter((block) => block.type === "databaseView" && block.props?.sourceId === page.databaseSourceId && block.props?.viewId === page.databaseViewId).length === 1;
    updatePage(pageId, { content: replace(page.content), ...(declared ? { databaseViewId: props.viewId, ...(props.sourceIdsJson ? { databaseSourceIds: JSON.parse(props.sourceIdsJson) } : {}) } : {}) });
  }

  function materializeDatabaseOccurrence(pageId, props) {
    const page = snapshotRef.current.pages.find((entry) => entry.id === pageId);
    if (!page || page.trashedAt || page.settings?.locked || page.pageType !== "database" || documentHasDatabaseBlock(page.content)) return;
    const sourceIdsJson = props.sourceIdsJson || JSON.stringify(page.databaseSourceIds ?? [page.databaseSourceId]);
    const block = { id: makeId("block"), type: "databaseView", props: { sourceId: page.databaseSourceId, sourceIdsJson, ...props } };
    // This explicit edit replaces the legacy detached presentation with its
    // first real occurrence. Refresh the editor as for other external edits.
    updatePage(pageId, { databaseViewId: props.viewId, databaseSourceIds: JSON.parse(sourceIdsJson), content: [block, ...(page.content || [])], importRevision: (page.importRevision || 0) + 1 });
  }

  function restorePageVersion(pageId, versionId) {
    if (isPageArchived(snapshotRef.current, pageId)) throw new Error(t("app.msg.unarchiveBeforeHistory"));
    const next = restorePageVersionRecord(currentWorkspaceSnapshot(), { pageId, versionId, now: Date.now(), preRestoreId: makeId("ver") });
    historyTrackers.current.delete(pageId);
    setWorkspace(next);
  }

  function toggleCurrentPageArchive() {
    if (!selectedPage) return;
    const rootId = archiveRootPageId(workspace, selectedPage.id);
    if (rootId && rootId !== selectedPage.id) openPage(rootId);
    else setWorkspace((current) => archivePage(current, selectedPage.id, !rootId));
    setPageActionsOpen(false);
  }

  async function restoreDatabaseHistory(sourceId, versionId, expectedSignature, itemId) {
    const preview = previewDatabaseRestore(currentWorkspaceSnapshot(), sourceId, versionId, { itemId });
    if (!preview.ok || preview.expectedSignature !== expectedSignature) throw new Error(preview.reason || t("app.msg.historyChanged"));
    await assertDatabaseRestoreAttachments(currentWorkspaceSnapshot(), preview);
    commitDatabaseCommand((current) => ({ workspace: restoreDatabaseVersion(current, sourceId, versionId, { expectedSignature, itemId, now: Date.now(), idFactory: makeId }) }));
    saveController.current?.update(currentWorkspaceSnapshot());
    const saved = await flushWorkspace();
    if (saved?.ok === false) throw new Error(saved.error?.message || t("app.msg.restoredUnsaved"));
  }

  function updatePageSettings(id, patch) {
    const page = pageById(pages, id);
    if (!page) return;
    updatePage(id, {
      settings: {
        ...normalizePageSettings(page.settings),
        ...patch,
      },
    });
  }

  function createInlineDatabase(type = "table", ownerPageId = selectedPage?.id) {
    const owner = pageById(pages, ownerPageId);
    if (!owner || owner.trashedAt || owner.settings?.locked || isPageArchived(snapshotRef.current, owner.id)) return null;
    const source = createDataSource({
      title: t("app.msg.newDb"),
      ownerPageId: owner.id,
    });
    const view = createDatabaseViewRecord({
      sourceId: source.id,
      name: VIEW_REGISTRY[type]?.label ? t(`db.view.${type}`) : t("db.view.table"),
      type,
      config: initialViewConfig(type, source),
      visiblePropertyIds: source.properties.map((property) => property.id),
    });
    setWorkspace((current) => ensureMapPlaceProperty({
      ...current,
      dataSources: [...(current.dataSources || []), source],
      databaseViews: [...(current.databaseViews || []), view],
    }, view));
    return { sourceId: source.id, viewId: view.id, source, view };
  }

  function createFullPageDatabase() {
    const folderId = selectedPage?.folderId ?? selectedFolderId ?? childrenOf(folders, null)[0]?.id;
    if (!folderId) return null;
    const pageId = makeId("dbpage");
    const source = createDataSource({
      title: t("app.msg.newDb"),
      ownerPageId: pageId,
    });
    const view = createDatabaseViewRecord({
      sourceId: source.id,
      name: t("db.view.table"),
      type: "table",
      visiblePropertyIds: source.properties.map((property) => property.id),
    });
    const now = new Date().toISOString();
    const page = {
      id: pageId,
      folderId,
      title: source.title,
      icon: "icon:database",
      iconColor: "#7f8ea3",
      cover: null,
      settings: { ...defaultPageSettings, fullWidth: true, presentationMode: "full" },
      trashedAt: null,
      summary: t("app.msg.localDbSummary"),
      contentRevision: 0,
      summarySourceRevision: 0,
      summaryUpdatedAt: now,
      tags: [],
      sortIndex: nextSortIndex(pagesOf(pages, folderId)),
      createdAt: now,
      updatedAt: now,
      pageType: "database",
      databaseSourceId: source.id,
      databaseViewId: view.id,
      content: [{ id: makeId("block"), type: "databaseView", props: { sourceId: source.id, viewId: view.id, viewIdsJson: serializeDatabaseOccurrenceViewIds([view.id]) } }],
    };
    setWorkspace((current) => ({
      ...current,
      pages: [...current.pages, page],
      dataSources: [...(current.dataSources || []), source],
      databaseViews: [...(current.databaseViews || []), view],
    }));
    setSelectedPageId(pageId);
    setSelectedFolderId(folderId);
    setExpanded((current) => new Set([...current, folderId]));
    return { pageId, sourceId: source.id, viewId: view.id };
  }

  function createFullPageFromSource(sourceId, viewId, viewIdsJson, sourceIdsJson) {
    const source = dataSourceById(workspace, sourceId);
    const folderId = selectedPage?.folderId ?? selectedFolderId ?? childrenOf(folders, null)[0]?.id;
    if (!source || !folderId) return null;
    const members = sourceIdsJson || serializeDatabaseOccurrenceSourceIds([sourceId]);
    const currentViewId = viewId || databaseViews.find((candidate) => candidate.sourceId === sourceId && !candidate.trashedAt)?.id;
    const view = resolveDatabaseOccurrenceViews(workspace, { sourceId, sourceIdsJson: members, viewId: currentViewId, viewIdsJson: viewIdsJson || serializeDatabaseOccurrenceViewIds([currentViewId]) }).selectedView;
    if (!view) return null;
    const pageId = makeId("dbpage");
    const now = new Date().toISOString();
    const page = {
      id: pageId,
      folderId,
      title: source.title,
      icon: "icon:database",
      iconColor: "#7f8ea3",
      cover: null,
      settings: { ...defaultPageSettings, fullWidth: true, presentationMode: "full" },
      trashedAt: null,
      summary: t("app.msg.localDbSummary"),
      contentRevision: 0,
      summarySourceRevision: 0,
      summaryUpdatedAt: now,
      tags: [],
      sortIndex: nextSortIndex(pagesOf(pages, folderId)),
      createdAt: now,
      updatedAt: now,
      pageType: "database",
      databaseSourceId: source.id,
      databaseViewId: view.id,
      databaseSourceIds: JSON.parse(members),
      content: [{ id: makeId("block"), type: "databaseView", props: { sourceId: source.id, sourceIdsJson: members, viewId: view.id, viewIdsJson: viewIdsJson || serializeDatabaseOccurrenceViewIds([view.id]) } }],
    };
    setWorkspace((current) => ({
      ...current,
      pages: [...current.pages, page],
      dataSources: (current.dataSources || []).map((candidate) => candidate.id === source.id && !candidate.ownerPageId
        ? { ...candidate, ownerPageId: pageId, updatedAt: now }
        : candidate),
    }));
    setSelectedPageId(pageId);
    setSelectedFolderId(folderId);
    setExpanded((current) => new Set([...current, folderId]));
    return { pageId, sourceId: source.id, viewId: view.id };
  }

  function turnFullPageDatabaseInline(pageId) {
    const page = pageById(pages, pageId);
    const sourceId = page?.databaseSourceId;
    if (!page || page.trashedAt || page.settings?.locked || page.pageType !== "database" || !sourceId) return null;
    const sourceIdsJson = JSON.stringify(page.databaseSourceIds ?? [sourceId]);
    const view = databaseViews.find((candidate) => (page.databaseSourceIds ?? [sourceId]).includes(candidate.sourceId) && !candidate.trashedAt && (!page.databaseViewId || candidate.id === page.databaseViewId));
    if (!view) return null;
    const original = Array.isArray(page.content) ? page.content : [];
    const matching = walkBlocks(original).filter((block) => block.type === "databaseView" && block.props?.sourceId === sourceId && block.props?.viewId === view.id);
    if (matching.length > 1) {
      setWorkspaceNotice(t("app.msg.ambiguousTurnInline"));
      return null;
    }
    const existing = matching[0];
    if (!existing && documentHasDatabaseBlock(original)) {
      setWorkspaceNotice(t("app.msg.missingFullSource"));
      return null;
    }
    const content = existing ? original : [{ id: makeId("block"), type: "databaseView", props: { sourceId, sourceIdsJson, viewId: view.id, viewIdsJson: serializeDatabaseOccurrenceViewIds([view.id]) } }, ...original];
    updatePage(pageId, { pageType: null, databaseSourceId: null, databaseViewId: null, databaseSourceIds: null, content });
    return { pageId, sourceId, viewId: view?.id || "" };
  }

  function createDatabaseItem(sourceId, options = {}) {
    const source = dataSourceById(workspace, sourceId);
    if (!source) return null;
    const currentOwner = source.ownerPageId && workspace.pages.find((page) => page.id === source.ownerPageId);
    if (source.locked || currentOwner?.trashedAt || currentOwner?.settings?.locked || isPageArchived(workspace, source.ownerPageId)) return null;
    if (options.parentItemId) {
      const parent = workspace.databaseItems.find((item) => item.id === options.parentItemId && item.sourceId === sourceId);
      const parentPage = parent && workspace.pages.find((page) => page.id === parent.pageId);
      if (!parentPage || parentPage.trashedAt || parentPage.settings?.locked || isPageArchived(workspace, parentPage.id)) return null;
    }
    const template = options.templateId ? (workspace.databaseTemplates || []).find((entry) => entry.id === options.templateId && entry.sourceId === sourceId) : null;
    const applied = template ? applyDatabaseTemplate(template) : { values: {}, content: [], appearance: null };
    const ownerPage = pageById(pages, source.ownerPageId);
    const folderId = ownerPage?.folderId ?? selectedPage?.folderId ?? selectedFolderId ?? childrenOf(folders, null)[0]?.id;
    if (!folderId) return null;
    const itemId = databaseId("item");
    const titleProperty = source.properties.find((property) => property.type === "title");
    const origin = !options.submission && workspace.databaseViews?.find(view => view.id === options.fromViewId && view.sourceId === sourceId);
    const scopedDefaults = origin ? relationFilterDefaults(workspace, source, origin.filter) : {};
    const mergedValues = { ...defaultDatabaseItemValues(source), ...scopedDefaults, ...applied.values, ...(options.values || {}) };
    const title = String(mergedValues?.[titleProperty?.id] || options.title || template?.name || "");
    const page = makeDatabaseItemPage({
      itemId,
      source,
      folderId,
      title,
      sortIndex: nextSortIndex(pages.filter((candidate) => candidate.folderId === folderId)),
      parentDatabaseItemId: options.parentItemId ?? null,
    });
    page.settings = normalizePageSettings({ ...page.settings, fontFamily: workspace.ui?.preferences?.defaultFont || "default" });
    if (template) {
      page.content = applied.content;
      if (applied.appearance?.icon !== undefined) page.icon = applied.appearance.icon;
      if (applied.appearance?.cover !== undefined) page.cover = applied.appearance.cover;
      if (applied.appearance?.settings !== undefined) page.settings = normalizePageSettings(applied.appearance.settings);
    }
    const normalizedValues = { ...mergedValues };
    for (const property of source.properties) {
      if (Object.prototype.hasOwnProperty.call(normalizedValues, property.id)) normalizedValues[property.id] = normalizePropertyValue(property, normalizedValues[property.id]);
    }
    const item = createDatabaseItemRecord({
      id: itemId,
      sourceId,
      pageId: page.id,
      parentItemId: options.parentItemId ?? null,
      values: {
        ...normalizedValues,
        ...(titleProperty ? { [titleProperty.id]: title } : {}),
      },
    });
    if (options.submission) item.submission = { ...options.submission, submittedAt: new Date().toISOString() };
    const time = new Date().toISOString();
    setWorkspace((current) => {
      const currentSource = dataSourceById(current, sourceId);
      if (!currentSource) return current;
      if (options.submission?.responseId && current.databaseItems.some(entry => entry.submission?.viewId === options.submission.viewId && entry.submission.responseId === options.submission.responseId)) return current;
      const allocated = allocateUniqueIds(current, { sourceId, values: item.values });
      const relationProperties = currentSource.properties.filter((property) => property.type === "relation");
      const values = { ...allocated.values };
      for (const property of relationProperties) values[property.id] = [];
      let next = { ...allocated.workspace, pages: [...allocated.workspace.pages, page], databaseItems: [...(allocated.workspace.databaseItems || []), { ...item, values }] };
      for (const property of relationProperties) next = applyRelationChange(next, { itemId, propertyId: property.id, nextIds: normalizePropertyValue(property, allocated.values[property.id]), now: time });
      return next;
    });
    return { itemId: item.id, pageId: page.id };
  }

  async function flushForFormShare() {
    const controller = saveController.current;
    if (!controller) throw new Error(t("app.msg.notReady"));
    controller.update(currentWorkspaceSnapshot());
    const result = await flushWorkspace();
    if (result?.ok === false) throw new Error(result.error?.message || t("app.msg.formInboxUnsaved"));
  }

  async function collectFormResponses(sourceId, viewId, responses) {
    const current = currentWorkspaceSnapshot();
    const source = dataSourceById(current, sourceId);
    const owner = source && current.pages.find(page => page.id === source.ownerPageId);
    if (!source || owner?.trashedAt || owner?.settings?.locked || (source.ownerPageId && !owner) || !current.databaseViews.some(v => v.id === viewId && v.type === "form" && v.sourceId === sourceId)) throw new Error(t("app.msg.formSourceClosed"));
    const received = new Set(current.databaseItems.filter(item => item.sourceId === sourceId && item.submission?.viewId === viewId).map(item => item.submission.responseId));
    const fresh = responses.filter(r => !received.has(r.id));
    for (const response of fresh) {
      if (Object.keys(response.values).some(id => !source.properties.some(p => p.id === id))) throw new Error(t("app.msg.formRemovedProps"));
    }
    flushSync(() => {
      for (const response of fresh) {
        const created = createDatabaseItem(sourceId, {values:response.values, submission:{viewId, responseId:response.id, anonymous:true, personId:null}});
        if (!created) throw new Error(t("app.msg.formCreateFailed"));
      }
    });
    await flushForFormShare();
    return fresh.length;
  }
  useSharedFormInbox(window.lifeAtlas?.forms, currentWorkspaceSnapshot, collectFormResponses);

  function commitDatabaseCommand(execute) {
    let previous, outcome;
    flushSync(() => setWorkspace(current => {
      if (current === previous) return outcome.workspace;
      previous = current;
      try { outcome = execute(current); }
      catch (error) { outcome = { workspace: current, error }; }
      return outcome.workspace;
    }));
    if (outcome?.error) throw outcome.error;
    return outcome;
  }

  async function runDatabaseAction({ sourceItemId, propertyId, operationId }) {
    const now = new Date().toISOString();
    const result = commitDatabaseCommand(current => {
      const item = current.databaseItems.find(entry => entry.id === sourceItemId);
      const source = item && dataSourceById(current, item.sourceId);
      const property = source?.properties.find(entry => entry.id === propertyId && entry.type === "button");
      if (!property) throw new Error(t("app.msg.actionMissing"));
      return executeDatabaseAction(current, { action: property.config?.action, sourceItemId, operationId, now });
    });
    saveController.current?.update(currentWorkspaceSnapshot());
    const saved = await flushWorkspace();
    if (saved?.ok === false) throw new Error(saved.error?.message || t("app.msg.actionUnsaved"));
    return result;
  }

  function updateDatabaseItemValue(itemId, propertyId, value) {
    const currentItem = snapshotRef.current.databaseItems?.find((entry) => entry.id === itemId);
    const currentSource = currentItem && dataSourceById(snapshotRef.current, currentItem.sourceId);
    const currentProperty = currentSource?.properties.find((entry) => entry.id === propertyId);
    const page = currentItem && snapshotRef.current.pages.find((entry) => entry.id === currentItem.pageId);
    if (!page || !canEditDatabaseItems(snapshotRef.current, currentSource?.id, [itemId]) || !currentProperty || READ_ONLY_PROPERTY_TYPES.includes(currentProperty.type)) return false;
    if (currentProperty.type === "date") {
      try { commitDatabaseCommand((current) => ({ workspace: applyDependencyDateChange(current, { itemId, propertyId, value, now: new Date().toISOString() }) })); return true; }
      catch (error) { setWorkspaceNotice(error.message); return false; }
    }
    if (currentProperty?.type === "title") { updatePage(page.id, { title: String(value ?? "") }); return; }
    if (hasStatusWorkflow(currentProperty)) {
      const change = captureStatusChange(currentSource, currentItem, currentProperty, value, makeId("workflow"), new Date().toISOString());
      const outcome = commitDatabaseCommand(current => applyStatusChange(current, change));
      const due = outcome?.receipt?.nextDue;
      const messages = [
        outcome?.reason,
        due && t("app.msg.taskSnoozed", { date: typeof due === "string" ? due : due.start }),
        outcome?.newRecord && t("app.msg.targetRecordCreated"),
        outcome?.updatedItemIds?.length && t("app.msg.updatedRecords", { count: outcome.updatedItemIds.length }),
      ].filter(Boolean);
      if (messages.length) setWorkspaceNotice(messages.join("，") + "。");
      return;
    }
    setWorkspace((current) => {
      const item = (current.databaseItems || []).find((candidate) => candidate.id === itemId);
      if (!item || !canEditDatabaseItems(current, item.sourceId, [itemId])) return current;
      const source = dataSourceById(current, item.sourceId);
      const property = source?.properties?.find((candidate) => candidate.id === propertyId);
      if (!property || READ_ONLY_PROPERTY_TYPES.includes(property.type)) return current;
      if (property?.type === "relation") return applyRelationChange(current, { itemId, propertyId, nextIds: normalizePropertyValue(property, value), now: new Date().toISOString() });
      const nextItem = updateDatabaseItemValueRecord(item, propertyId, normalizePropertyValue(property, value));
      return {
        ...current,
        databaseItems: (current.databaseItems || []).map((candidate) => candidate.id === itemId ? nextItem : candidate),
        pages: property?.type === "title"
          ? current.pages.map((page) => page.id === item.pageId ? { ...page, title: String(value || t("dbx.untitled")), updatedAt: new Date().toISOString() } : page)
          : current.pages,
      };
    });
  }

  function updateDatabaseItemsProperty(sourceId, itemIds, propertyId, value) {
    const current = currentWorkspaceSnapshot();
    const source = dataSourceById(current, sourceId);
    if (!source || !Array.isArray(itemIds) || !itemIds.length || !canEditDatabaseSource(current, sourceId)) return;
    const now = Date.now();
    const property = source.properties.find(entry => entry.id === propertyId);
    if (property?.type === "date") {
      try {
        commitDatabaseCommand((workspace) => ({ workspace: applyDependencyDateChanges(workspace,
          workspace.databaseItems.filter((item) => item.sourceId === sourceId && itemIds.includes(item.id)).map((item) => ({ itemId: item.id, propertyId, value })), new Date(now).toISOString()) }));
        return true;
      } catch (error) { setWorkspaceNotice(error.message); return false; }
    }
    if (hasStatusWorkflow(property)) {
      const selected = new Set(itemIds);
      const operationId = makeId("workflow-batch");
      const time = new Date(now).toISOString();
      const commands = current.databaseItems.filter(item => item.sourceId === sourceId && selected.has(item.id))
        .map(item => captureStatusChange(source, item, property, value, operationId, time));
      const result = commitDatabaseCommand(workspace => applyStatusChanges(workspace, commands));
      if (result.failures.length) setWorkspaceNotice(t("app.msg.batchUpdated", { applied: result.applied, failed: result.failures.length, firstError: result.failures[0] }));
      return;
    }
    const beforeEditIds = new Map();
    if (source.properties.some(property => property.id === propertyId && property.type === "title")) {
      const selected = new Set(itemIds);
      const pageIds = new Set(current.databaseItems.filter(item => item.sourceId === sourceId && selected.has(item.id) && !item.trashedAt).map(item => item.pageId));
      for (const page of current.pages) {
        if (!pageIds.has(page.id) || !isTrackedPageEdit(page, { title: String(value ?? "") })) continue;
        if (!editedThisSession.current.has(page.id)) beforeEditIds.set(page.id, makeId("ver"));
        editedThisSession.current.add(page.id);
        historyTrackers.current.set(page.id, recordEdit(historyTrackers.current.get(page.id), now));
      }
    }
    setWorkspace(workspace => !canEditDatabaseSource(workspace, sourceId) ? workspace : updateTableItemsProperty(workspace, { sourceId, itemIds, propertyId, value, now, beforeEditIds }));
  }

  function updateDatabaseDateFields(itemId, changes, expected) {
    try { return commitDatabaseCommand(current => {
      const item = current.databaseItems?.find(entry => entry.id === itemId);
      const page = item && current.pages.find(entry => entry.id === item.pageId);
      if (!page || page.trashedAt || page.settings?.locked) return { workspace: current };
      const source = dataSourceById(current,item.sourceId);
      if (Object.entries(expected || {}).some(([id,previous]) => JSON.stringify(item.values[id] ?? null) !== JSON.stringify(previous ?? null))) return { workspace: current };
      const fields = Object.entries(changes);
      if (!fields.length || fields.some(([id]) => !source?.properties.some(property => property.id === id && property.type === "date"))) return { workspace: current };
      return { workspace: applyDependencyDateChanges(current, fields.map(([propertyId, value]) => ({ itemId, propertyId, value })), new Date().toISOString()) };
    }).workspace; } catch (error) { setWorkspaceNotice(error.message); return false; }
  }

  function updateDatabaseView(viewId, patch) {
    setWorkspace((current) => {
      const view = current.databaseViews?.find((entry) => entry.id === viewId);
      if (!view) return current;
      if (!canEditDatabaseSource(current, view.sourceId)) return current;
      const initial = patch.type && patch.type !== view.type
        ? { ...patch, config: initialViewConfig(patch.type, dataSourceById(current, view.sourceId), { ...view.config, ...patch.config }) }
        : patch;
      const changed = updateDatabaseViewRecord(view, initial);
      const next = { ...current, databaseViews: current.databaseViews.map((entry) => entry.id === viewId ? changed : entry) };
      return patch.type === "map" ? ensureMapPlaceProperty(next, changed) : next;
    });
  }

  function createDatabaseView(sourceId, options = {}) {
    if (!canEditDatabaseSource(currentWorkspaceSnapshot(), sourceId)) return null;
    const view = createDatabaseViewRecord({
      sourceId,
      name: options.name ?? t("app.msg.newView"),
      type: options.type || "table",
      filter: options.filter ?? null,
      sorts: options.sorts ?? [],
      groupBy: options.groupBy ?? null,
      grouping: options.grouping ?? null,
      visiblePropertyIds: options.visiblePropertyIds ?? null,
      config: initialViewConfig(options.type, dataSourceById(workspace, sourceId), options.config ?? {}),
      linked: Boolean(options.linked),
    });
    setWorkspace((current) => !canEditDatabaseSource(current, sourceId) ? current : ensureMapPlaceProperty({
      ...current,
      databaseViews: [...(current.databaseViews || []), view],
    }, view));
    return view;
  }

  function createLinkedDatabaseView(sourceId, options = {}) {
    if (!canEditDatabaseSource(currentWorkspaceSnapshot(), sourceId)) return null;
    const view = createLinkedView(sourceId, {
      name: options.name || "Linked View",
      type: options.type || "table",
      filter: options.filter ?? null,
      sorts: options.sorts ?? [],
      groupBy: options.groupBy ?? null,
      grouping: options.grouping ?? null,
      visiblePropertyIds: options.visiblePropertyIds ?? null,
      config: initialViewConfig(options.type, dataSourceById(workspace, sourceId), options.config ?? {}),
    });
    setWorkspace((current) => !canEditDatabaseSource(current, sourceId) ? current : ensureMapPlaceProperty({
      ...current,
      databaseViews: [...(current.databaseViews || []), view],
    }, view));
    return view;
  }

  function renameDatabaseSource(sourceId, title) {
    setWorkspace((current) => !canEditDatabaseSource(current, sourceId) ? current : ({
      ...current,
      dataSources: (current.dataSources || []).map((source) => source.id === sourceId
        ? { ...source, title: title || t("app.msg.untitledDb"), updatedAt: new Date().toISOString() }
        : source),
    }));
  }

  function addDatabaseProperty(sourceId, type, definition = {}) {
    const source = dataSourceById(workspace, sourceId);
    if (!source || !canEditDatabaseSource(currentWorkspaceSnapshot(), sourceId)) return null;
    const otherSource = (workspace.dataSources || []).find((candidate) => candidate.id !== sourceId) || source;
    const relationProperty = source.properties.find((property) => property.type === "relation");
    const numberProperty = source.properties.find((property) => property.type === "number");
    const targetSource = relationProperty ? dataSourceById(workspace, relationProperty.config?.targetSourceId) : otherSource;
    const targetProperty = targetSource?.properties.find((property) => property.type === "number") || targetSource?.properties.find((property) => property.type === "title");
    const config = type === "relation" ? { targetSourceId: otherSource.id }
      : type === "rollup" ? { relationPropertyId: relationProperty?.id || "", targetPropertyId: targetProperty?.id || "", aggregation: "show" }
      : type === "formula" ? { expression: numberProperty ? `{{${numberProperty.id}}} * 2` : "0" } : {};
    const options = ["select", "multi_select", "status"].includes(type) ? [{ id: "option-1", name: t("app.msg.optionPrefix", { n: 1 }) }, { id: "option-2", name: t("app.msg.optionPrefix", { n: 2 }) }] : [];
    // Construct identities outside React's updater. StrictMode may replay an
    // updater, but callers must receive the same ID that the workspace saves.
    const created = createProperty({ name: definition.name || t(`db.prop.${type}`) || PROPERTY_LABELS[type] || t("dbx.propCfg.fallback"), type, options: definition.options || options, config: { ...config, ...definition.config } });
    const initialValues = defaultDatabaseItemValues({ properties: [created] });
    const relation = type === "relation" ? createRelation({ sourceId, propertyId: created.id, targetSourceId: created.config.targetSourceId }) : null;
    setWorkspace((current) => {
      if (!canEditDatabaseSource(current, sourceId)) return current;
      const next = {
        ...current,
        dataSources: (current.dataSources || []).map((candidate) => candidate.id === sourceId
          ? { ...candidate, properties: [...candidate.properties, created], updatedAt: new Date().toISOString() }
          : candidate),
        databaseViews: (current.databaseViews || []).map((view) => view.sourceId === sourceId
          ? { ...view, visiblePropertyIds: view.visiblePropertyIds ? [...view.visiblePropertyIds, created.id] : null }
          : view),
        databaseItems: Object.hasOwn(initialValues, created.id)
          ? (current.databaseItems || []).map((item) => item.sourceId === sourceId
            ? { ...item, values: { ...item.values, ...initialValues } }
            : item)
          : current.databaseItems,
        relations: relation ? [...(current.relations || []), relation] : (current.relations || []),
      };
      return type === "unique_id" ? assignUniqueIds(next, { sourceId, propertyId: created.id }) : next;
    });
    return created;
  }

  function updateDatabaseProperty(sourceId, propertyId, definition) {
    setWorkspace((current) => !canEditDatabaseSource(current, sourceId) ? current : updatePropertyDefinition(current, { sourceId, propertyId, definition, now: new Date().toISOString() }));
  }

  function changePropertyType(sourceId, propertyId, nextType) {
    commitDatabaseCommand((current) => ({ workspace: !canEditDatabaseSource(current, sourceId) ? current : convertPropertyType(current, { sourceId, propertyId, nextType, now: new Date().toISOString(), idFactory: makeId }) }));
  }

  function deleteDatabaseProperty(sourceId, propertyId) {
    setWorkspace((current) => !canEditDatabaseSource(current, sourceId) ? current : deleteProperty(current, { sourceId, propertyId }));
  }

  function trashDatabaseItems(itemIds) {
    const time = new Date().toISOString();
    setWorkspace((current) => {
      const wanted = new Set(itemIds);
      return current.databaseItems.filter((item) => wanted.has(item.id)).reduce((next, item) => trashPage(next, item.pageId, time), current);
    });
  }

  function duplicateDatabaseItem(itemId) {
    const current = currentWorkspaceSnapshot();
    const next = duplicateDatabaseItemRecord(current, { itemId, now: new Date().toISOString(), idFactory: makeId });
    if (next === current) return null;
    const item = next.databaseItems.at(-1);
    setWorkspace(next);
    return { itemId: item.id, pageId: item.pageId };
  }

  function importCsv(input) {
    const current = currentWorkspaceSnapshot();
    if (input.sourceId && !canEditDatabaseSource(current, input.sourceId)) throw new Error(t("app.msg.unarchiveUnlockImport"));
    const command = { ...input, folderId: input.folderId || selectedPage?.folderId || selectedFolderId, now: new Date().toISOString(), idFactory: makeId };
    const result = input.sourceId ? importCsvIntoSource(current, command) : buildCsvDatabase(current, command);
    setWorkspace(result.workspace);
    if (result.pageId) {
      setSelectedPageId(result.pageId);
      setSelectedFolderId(result.workspace.pages.find((page) => page.id === result.pageId)?.folderId || command.folderId);
      setActiveSection("private");
    }
    return { importedCount: result.importedCount, unrecognizedCount: result.unrecognizedCount, ...(result.pageId ? { pageId: result.pageId } : {}) };
  }

  function createPerson(displayName) {
    const time = new Date().toISOString();
    const person = { id: `person-${globalThis.crypto.randomUUID()}`, displayName: String(displayName).trim().slice(0, 120) || t("app.msg.memberDefault"), local: true, createdAt: time, updatedAt: time };
    setWorkspace((current) => ({ ...current, people: [...(current.people || []), person] }));
    return person;
  }

  function updatePerson(id, patch) {
    const email = typeof patch.email === "string" ? patch.email.trim() : null;
    if (email && !safePropertyHref("email", email)) return;
    setWorkspace((current) => ({ ...current, people: (current.people || []).map((person) => person.id === id
      ? { ...person, displayName: String(patch.displayName || person.displayName).trim().slice(0, 120),
        ...(email === null ? {} : { email: email || null }), updatedAt: new Date().toISOString() } : person) }));
  }

  async function stageEditorAttachment(file, context = {}) {
    let created;
    if (window.lifeAtlas?.platform === "desktop") {
      const result = await window.lifeAtlas.assets.put({ bytes: await file.arrayBuffer(), mime: file.type || "application/octet-stream", name: file.name || t("app.msg.attachDefault") });
      if (!result?.ok) throw new Error(result?.error?.message || t("app.msg.attachSaveErr"));
      const { assetId, url } = result.value;
      created = { url, metadata: createAttachmentMetadata({ name: file.name || t("app.msg.attachDefault"), mime: file.type, size: file.size, provider: "asset", storageKey: assetId, checksum: assetId }, context) };
    } else created = await persistBrowserAttachment(file, context);
    return created;
  }

  async function createEditorAttachment(file) {
    const created = await stageEditorAttachment(file);
    setWorkspace((current) => ({
      ...current,
      attachments: [...(current.attachments || []), created.metadata],
    }));
    return created;
  }

  async function importNotion(plan, options) {
    const baseline = snapshotRef.current;
    const imported = await buildNotionImport(baseline, plan, {
      ...options,
      idFactory: makeId,
      uploadAttachment: (name, bytes, mime, context) => stageEditorAttachment(new File([bytes], name, { type: mime }), context),
    });
    mergeImportedWorkspace(snapshotRef.current, baseline, imported.workspace);
    setWorkspace((current) => mergeImportedWorkspace(current, baseline, imported.workspace));
    return { rootFolderId: imported.rootFolderId, report: imported.report };
  }

  async function resolveEditorAttachmentUrl(attachmentId) {
    const attachment = workspace.attachments?.find((entry) => entry.id === attachmentId);
    if (window.lifeAtlas?.platform === "desktop") return attachment?.provider === "asset" ? `life-asset://${attachment.storageKey}` : null;
    return resolveBrowserAttachmentUrl(attachment || attachmentId);
  }

  function createAttachment(metadata) {
    const externalUrl = safePropertyHref("url", metadata.externalUrl);
    if (!externalUrl) throw new Error(t("app.msg.httpUrlReq"));
    const time = new Date().toISOString();
    const attachment = createAttachmentMetadata({ name: metadata.name, provider: "external", storageKey: externalUrl, externalUrl, mime: metadata.mimeType || metadata.mime || "application/octet-stream", size: null }, { id: `attachment-${globalThis.crypto.randomUUID()}`, now: time });
    setWorkspace((current) => ({ ...current, attachments: [...(current.attachments || []), attachment] }));
    return attachment;
  }

  function saveCurrentPageTemplate(pageId, name) {
    const sourcePage = pageById(workspace.pages, pageId);
    if (!sourcePage) return null;
    const template = createPageTemplate(sourcePage, { name });
    setWorkspace((current) => ({ ...current, pageTemplates: [...(current.pageTemplates || []), template] }));
    return template;
  }

  function createPageFromTemplate(templateId, folderId = selectedPage?.folderId || selectedFolderId, { open = true } = {}) {
    const template = (workspace.pageTemplates || []).find((entry) => entry.id === templateId);
    if (!template || !folderId) return null;
    const created = instantiatePageTemplate(template, { folderId, sortIndex: nextSortIndex(pagesOf(workspace.pages, folderId)) });
    const commit = () => {
      setWorkspace((current) => ({ ...current, pages: [...current.pages, created] }));
      if (open) {
        setSelectedFolderId(folderId);
        setSelectedPageId(created.id);
        setActiveSection("private");
        setPrivateExpanded(true);
        setExpanded((current) => new Set([...current, ...folderAncestors(folders, folderId).map((folder) => folder.id)]));
      }
    };
    if (open) commit();
    else flushSync(commit);
    return created;
  }

  async function finishMarketSave(pending) {
    saveController.current?.update(currentWorkspaceSnapshot());
    const saved = await flushWorkspace();
    if (!saved.ok) throw new Error(t("app.msg.addedSaveIncomplete"));
    setPendingMarketSave((current) => current === pending ? null : current);
    if (pending.navigationRevision !== marketNavigationRevision.current) return;
    const current = currentWorkspaceSnapshot();
    const page = pageById(current.pages, pending.pageId);
    if (!page || page.trashedAt) return;
    setSelectedFolderId(page.folderId);
    setSelectedPageId(page.id);
    setBlockNavigation(null);
    setActiveSection("private");
    setPrivateExpanded(true);
    setExpanded((currentIds) => new Set([...currentIds, ...folderAncestors(current.folders, page.folderId).map((folder) => folder.id)]));
  }

  function saveMarketPage(pageId, navigationRevision) {
    const pending = { pageId, navigationRevision };
    setPendingMarketSave(pending);
    return finishMarketSave(pending);
  }

  async function useTemplate(template, options) {
    if (pendingMarketSave) return finishMarketSave(pendingMarketSave);
    const navigationRevision = marketNavigationRevision.current;
    let pageId;
    if (!getBuiltinTemplate(template.id)) {
      const page = createPageFromTemplate(template.id, options.folderId, { open: false });
      if (!page) throw new Error(t("app.msg.tplUnavailable"));
      pageId = page.id;
    } else {
      const result = instantiateTemplate(currentWorkspaceSnapshot(), template, { ...options, now: Date.now(), idFactory: makeId });
      pageId = result.rootPageId;
      flushSync(() => setWorkspace(result.workspace));
    }
    await saveMarketPage(pageId, navigationRevision);
  }

  async function useMarketPackage(preview, { folderId, pageId }) {
    if (pendingMarketSave) return finishMarketSave(pendingMarketSave);
    const navigationRevision = marketNavigationRevision.current;
    const pageForPackage = (current) => {
      const page = current.pages.find((entry) => entry.id === pageId);
      const folders = templateFolderChoices(current);
      if (preview.type === "template" && folders.some((entry) => entry.id === folderId)) return null;
      if (preview.type === "component" && page && !page.trashedAt && !page.settings?.locked && !isPageArchived(current, page.id)
        && page.pageType !== "database" && folders.some((entry) => entry.id === page.folderId)) return page;
      throw new Error(t(preview.type === "template" ? "app.msg.targetInvalidTpl" : "app.msg.targetInvalidWidget"));
    };
    pageForPackage(currentWorkspaceSnapshot());
    const flushed = await flushWorkspace();
    if (!flushed.ok) throw new Error(flushed.error?.message || t("app.msg.saveFirst"));
    if (navigationRevision !== marketNavigationRevision.current) return;
    let pack = preview;
    if (preview.type !== "component" || !/^life-asset:\/\/[a-f0-9]{64}$/u.test(preview.url || "")) {
      const installed = await window.lifeAtlas.market.install({ token: preview.token });
      if (!installed.ok) throw new Error(installed.error?.message || t("app.msg.pkgInstallErr"));
      pack = installed.value;
    }
    if (navigationRevision !== marketNavigationRevision.current) return;
    const current = currentWorkspaceSnapshot();
    let page = pageForPackage(current);
    const now = new Date().toISOString();
    flushSync(() => {
      if (pack.type === "template") {
        const { title, icon, blocks } = pack.template;
        page = { ...newNotePage({ folderId, title, now, content: cloneBlockDocument(blocks, makeId),
          sortIndex: nextSortIndex(pagesOf(current.pages, folderId)), fontFamily: current.ui?.preferences?.defaultFont, idFactory: makeId }), icon };
        setWorkspace((latest) => ({ ...latest, pages: [...latest.pages, page] }));
      } else {
        const widget = { id: makeId("block"), type: "marketComponent", props: { url: pack.url, title: pack.title, packageId: pack.id, packageVersion: pack.version, state: "{}" } };
        updatePage(page.id, { content: [...(page.content || []), widget], importRevision: (page.importRevision || 0) + 1 });
      }
    });
    await saveMarketPage(page.id, navigationRevision);
  }

  async function saveSelectedPageTemplate() {
    if (!selectedPage) return;
    setPageActionsOpen(false);
    const name = await dialogs.promptText({ title: t("actions.saveTemplate"), label: t("app.msg.saveTplDescLabel"), initialValue: selectedPage.title, validate: (value) => value.trim() ? null : t("app.msg.saveTplErr") });
    if (name !== null) saveCurrentPageTemplate(selectedPage.id, name);
  }

  function deletePageTemplate(templateId) {
    setWorkspace((current) => ({ ...current, pageTemplates: (current.pageTemplates || []).filter((entry) => entry.id !== templateId) }));
  }

  function saveDatabaseTemplateFromPage(pageId, name) {
    const item = (workspace.databaseItems || []).find((entry) => entry.pageId === pageId);
    const itemPage = pageById(workspace.pages, pageId);
    if (!item || !itemPage) return null;
    const template = createDatabaseTemplate(item.sourceId, {
      name,
      defaultValues: item.values,
      pageContent: itemPage.content,
      pageAppearance: { icon: itemPage.icon, cover: itemPage.cover, settings: itemPage.settings },
    });
    setWorkspace((current) => ({ ...current, databaseTemplates: [...(current.databaseTemplates || []), template] }));
    return template;
  }

  function deleteDatabaseTemplate(templateId) {
    setWorkspace((current) => ({ ...current, databaseTemplates: (current.databaseTemplates || []).filter((entry) => entry.id !== templateId) }));
  }

  function addDiscussion(pageId, anchor, body) {
    const discussion = createDiscussion({ pageId, anchor: anchor || pageAnchor() });
    const comment = createComment({ discussionId: discussion.id, authorId: workspace.ui?.currentPersonId || "person-local", body });
    setWorkspace((current) => ({ ...current, discussions: [...(current.discussions || []), discussion], comments: [...(current.comments || []), comment] }));
    return discussion;
  }

  function replyDiscussion(discussionId, body) {
    const comment = createComment({ discussionId, authorId: workspace.ui?.currentPersonId || "person-local", body });
    setWorkspace((current) => ({ ...current, comments: [...(current.comments || []), comment] }));
    return comment;
  }

  function resolveDiscussion(discussionId, resolved) {
    setWorkspace((current) => ({ ...current, discussions: (current.discussions || []).map((entry) => entry.id === discussionId ? setDiscussionResolved(entry, resolved) : entry) }));
  }

  function attachExternalToPage(pageId, metadata) {
    const externalUrl = safePropertyHref("url", metadata.externalUrl);
    if (!externalUrl) throw new Error(t("app.msg.httpUrlReq"));
    const time = new Date().toISOString();
    const attachment = createAttachmentMetadata({ name: metadata.name, provider: "external", storageKey: externalUrl, externalUrl, mime: metadata.mime || "application/octet-stream" }, { id: `attachment-${globalThis.crypto.randomUUID()}`, now: time });
    setWorkspace((current) => {
      const item = (current.databaseItems || []).find((entry) => entry.pageId === pageId);
      const source = item ? dataSourceById(current, item.sourceId) : null;
      const fileProperty = source?.properties?.find((property) => property.type === "files");
      return {
        ...current,
        attachments: [...(current.attachments || []), attachment],
        databaseItems: item && fileProperty ? (current.databaseItems || []).map((entry) => entry.id !== item.id ? entry : {
          ...entry,
          values: { ...entry.values, [fileProperty.id]: [...(Array.isArray(entry.values?.[fileProperty.id]) ? entry.values[fileProperty.id] : []), attachment.id] },
        }) : current.databaseItems,
      };
    });
    return attachment;
  }

  function undoCurrentPage() {
    if (!selectedPage || normalizePageSettings(selectedPage.settings).locked) return;
    const api = pageEditorApiRef.current;
    if (!api) return;
    api.undo();
    setEditorHistory(api.getHistoryState());
  }

  function redoCurrentPage() {
    if (!selectedPage || normalizePageSettings(selectedPage.settings).locked) return;
    const api = pageEditorApiRef.current;
    if (!api) return;
    api.redo();
    setEditorHistory(api.getHistoryState());
  }

  async function copyCurrentPageContents() {
    if (!selectedPage) return;
    const text = documentToPlainText(selectedPage.content);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setPageActionsOpen(false);
  }

  function duplicateCurrentPage() {
    if (!selectedPage) return;
    const id = makeId("page");
    let duplicate = null;
    setWorkspace((current) => {
      const source = pageById(current.pages, selectedPage.id);
      if (!source) return current;
      duplicate = duplicatePage(source, {
        id,
        sortIndex: nextSortIndex(pagesOf(current.pages, source.folderId)),
      });
      return { ...current, pages: [...current.pages, duplicate] };
    });
    setSelectedPageId(id);
    setSelectedFolderId(selectedPage.folderId);
    setExpanded((current) => new Set([...current, selectedPage.folderId]));
    setPageActionsOpen(false);
  }

  async function duplicateCurrentPageIndependently() {
    if (!selectedPage) return;
    setPageActionsOpen(false);
    const current = currentWorkspaceSnapshot();
    const source = pageById(current.pages, selectedPage.id);
    if (!source) return;
    try {
      const copy = duplicatePageIndependently(current, source.id, {
        id: makeId("page"),
        sortIndex: nextSortIndex(pagesOf(current.pages, source.folderId)),
      });
      syncedStore.replaceAll(copy.workspace.syncedSources || []);
      setWorkspace(copy.workspace);
      setSelectedPageId(copy.page.id);
      setSelectedFolderId(source.folderId);
      setExpanded(expanded => new Set([...expanded, source.folderId]));
      setWorkspaceNotice(t("app.msg.dupSuccess", { count: copy.importedCounts.dataSources || 0 }));
    } catch (error) {
      await dialogs.alert({ title: t("app.msg.dupFailTitle"), description: error instanceof Error ? error.message : t("app.msg.dupFailDesc") });
    }
  }

  function requestMoveCurrentPage() {
    if (!selectedPage) return;
    pageActionsTriggerRef.current?.focus({ preventScroll: true });
    setMovePageTargetId(selectedPage.id);
    setPageActionsOpen(false);
  }

  function commitMovePage(targetFolderId) {
    const page = pageById(pages, movePageTargetId);
    if (!page || !folderById(folders, targetFolderId)) {
      setMovePageTargetId(null);
      return;
    }
    setWorkspace((current) => ({
      ...moveOwnedPage(current, page.id, {
        folderId: targetFolderId,
        sortIndex: nextSortIndex(pagesOf(current.pages, targetFolderId)),
        now: new Date().toISOString(),
      }),
      folders: current.folders.map((folder) => folder.lastOpenedPageId === page.id && folder.id === page.folderId
        ? { ...folder, lastOpenedPageId: null }
        : folder.id === targetFolderId
          ? { ...folder, lastOpenedPageId: page.id }
          : folder),
    }));
    setSelectedFolderId(targetFolderId);
    setExpanded((current) => new Set([...current, targetFolderId, ...folderAncestors(folders, targetFolderId).map((folder) => folder.id)]));
    setMovePageTargetId(null);
  }

  function trashCurrentPage() {
    if (!selectedPage) return;
    deletePage(selectedPage.id);
    setPageActionsOpen(false);
  }

  function requestExportCurrentPage() {
    if (!selectedPage) return;
    setPageActionsOpen(false);
    setExportOpen(true);
  }

  function requestImport() {
    if (!selectedPage || normalizePageSettings(selectedPage.settings).locked) return;
    setPageActionsOpen(false);
    importInputRef.current?.click();
  }

  async function importIntoCurrentPage(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedPage) return;
    try {
      const parsed = parsePageImport(await file.text(), file.name);
      if (parsed.bundle) {
        const imported = importPageBundle(workspace, parsed.bundle, selectedPage.id);
        imported.page.importRevision = (selectedPage.importRevision || 0) + 1;
        syncedStore.replaceAll(imported.workspace.syncedSources || []);
        setWorkspace(imported.workspace);
        return;
      }
      const patch = { content: parsed.content, importRevision: (selectedPage.importRevision || 0) + 1 };
      for (const key of ["title", "icon", "iconColor", "cover", "settings"]) {
        if (parsed[key] !== undefined) patch[key] = parsed[key];
      }
      updatePage(selectedPage.id, patch);
    } catch (error) {
      await dialogs.alert({ title: t("app.msg.importFailTitle"), description: error instanceof Error ? error.message : t("app.msg.importFailDesc") });
    }
  }

  function createPage(requestedFolderId, title = "") {
    const eligible = folders.filter((folder) => {
      const path = folderAncestors(folders, folder.id);
      return path.length && path[0].parentId === null && path.every((entry) => !entry.system && !entry.trashedAt);
    });
    const target = eligible.find((folder) => folder.id === requestedFolderId)
      || eligible.filter((folder) => folder.parentId === null).sort(compareOrder)[0];
    const now = new Date().toISOString();
    if (target) pendingDefaultFolder.current = null;
    const fallback = target ? null : pendingDefaultFolder.current || {
      id: makeId("folder"), parentId: null, name: t("app.msg.mySpace"), color: "stone",
      sortIndex: nextSortIndex(childrenOf(folders, null)), lastOpenedPageId: null,
      trashedAt: null, trashedByFolderId: null, createdAt: now, updatedAt: now,
    };
    if (fallback) pendingDefaultFolder.current = fallback;
    const folderId = target?.id || fallback.id;
    const page = newNotePage({ folderId, title, now, fontFamily: workspace.ui?.preferences?.defaultFont, iconColor: iconColorChoices[0].value, sortIndex: nextSortIndex(pagesOf(pages, folderId)), idFactory: makeId });
    const id = page.id;
    pendingNewPageFocus.current = id;
    setWorkspace((current) => ({
      ...current,
      folders: fallback && !current.folders.some((folder) => folder.id === fallback.id) ? [...current.folders, fallback] : current.folders,
      pages: [...current.pages, page],
    }));
    setExpanded((current) => new Set([...current, folderId, ...folderAncestors(folders, folderId).map((folder) => folder.id)]));
    setModal(null);
    setContextMenu(null);
    setSelectedPageId(id);
    setSelectedFolderId(folderId);
    setActiveSection("private");
    setPrivateExpanded(true);
    window.setTimeout(() => rememberPage(page), 0);
  }

  function saveQuickCapture({ title, body, open }) {
    const folderId = folders.find((folder) => folder.system === "inbox")?.id;
    if (!folderId) throw new Error(t("app.msg.inboxNotInit"));
    const time = new Date().toISOString();
    const page = newNotePage({ folderId, title: captureTitle(title, body), now: time, fontFamily: workspace.ui?.preferences?.defaultFont, inboxedAt: time, content: markdownToBlocks(body, { idFactory: makeId }), sortIndex: nextSortIndex(pagesOf(pages, folderId)), iconColor: iconColorChoices[0].value, idFactory: makeId });
    setWorkspace((current) => ({ ...current, pages: [...current.pages, page] }));
    setCaptureOpen(false);
    if (open) { setSelectedPageId(page.id); setSelectedFolderId(folderId); setActiveSection("private"); }
    else setWorkspaceNotice(t("app.msg.savedToInbox"));
  }

  function archiveInboxPages(pageIds, targetFolderId) {
    setWorkspace((current) => archivePages(current, pageIds, targetFolderId, new Date().toISOString()));
    if (pageIds.includes(selectedPageId)) setSelectedFolderId(targetFolderId);
  }

  function createSubPage(title = t("app.msg.newPageTitle"), parentPageId = selectedPage?.id) {
    const parent = snapshotRef.current.pages.find((page) => page.id === parentPageId);
    if (!parent || parent.trashedAt || parent.settings?.locked) return null;
    const id = makeId("page");
    const now = new Date().toISOString();
    const page = {
      id,
      folderId: parent.folderId,
      parentPageId: parent.id,
      title,
      icon: "📄",
      iconColor: iconColorChoices[0].value,
      cover: null,
      settings: { ...defaultPageSettings, fontFamily: workspace.ui?.preferences?.defaultFont || "default" },
      trashedAt: null,
      summary: t("app.msg.subpageSummary"),
      contentRevision: 0,
      summarySourceRevision: 0,
      summaryUpdatedAt: now,
      tags: [],
      sortIndex: nextSortIndex(pages.filter((candidate) => candidate.parentPageId === parent.id)),
      createdAt: now,
      updatedAt: now,
      content: emptyDocument(),
    };
    setWorkspace((current) => ({ ...current, pages: [...current.pages, page] }));
    return { pageId: id, title: page.title };
  }

  function createFolder(parentId, name) {
    const id = makeId("folder");
    const folder = {
      id,
      parentId,
      name,
      color: "purple",
      sortIndex: nextSortIndex(childrenOf(folders, parentId)),
      lastOpenedPageId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setWorkspace((current) => ({ ...current, folders: [...current.folders, folder] }));
    if (parentId) setExpanded((current) => new Set([...current, parentId]));
    setSelectedFolderId(id);
    setSelectedPageId(null);
    setActiveSection("private");
    setPrivateExpanded(true);
    setModal(null);
    setContextMenu(null);
  }

  function renameFolder(id, name) {
    if (folders.find((folder) => folder.id === id)?.system) throw new Error(t("app.msg.systemFolderProtect"));
    setWorkspace((current) => renameWorkspaceFolder(current, id, name, new Date().toISOString()));
    setModal(null);
  }

  function renamePage(id, title) {
    updatePage(id, { title });
    setModal(null);
  }

  function deletePage(id) {
    const page = pageById(pages, id);
    if (!page || page.trashedAt) return;
    setConfirmAction({ title: t("app.msg.trashPageTitle", { title: page.title || t("backlinks.untitled") }), description: t("app.msg.trashPageDesc"), confirmLabel: t("actions.trash"), action: () => {
      const next = trashPage(currentWorkspaceSnapshot(), id, new Date().toISOString());
      setWorkspace(next);
      if (!next.pages.some((entry) => entry.id === selectedPageId && !entry.trashedAt)) setSelectedPageId(null);
    } });
    setContextMenu(null);
  }

  function restoreTrashedPage(group) {
    const result = restoreTrashGroup(currentWorkspaceSnapshot(), group, { now: new Date().toISOString(), idFactory: makeId });
    if (!result.restored) return;
    setWorkspace(result.workspace);
    setSelectedPageId(group.kind === "page" ? group.id : null);
    setSelectedFolderId(result.restored.folderId);
    setExpanded((current) => new Set([...current, result.restored.folderId, ...folderAncestors(result.workspace.folders, result.restored.folderId).map((folder) => folder.id)]));
    setPrivateExpanded(true);
    setActiveSection("private");
  }

  function permanentlyDeleteTrashedPage(group) {
    const entry = listTrashGroups(workspace, new Date().toISOString()).find((item) => item.kind === group.kind && item.id === group.id);
    if (!entry) return;
    setConfirmAction({ title: t("app.msg.permDeleteTitle", { name: entry.name }), description: t("app.msg.permDeleteDesc"), confirmLabel: t("trash.deleteForever"), danger: true, action: () => applyPermanentDeletion(deleteTrashGroupPermanently(currentWorkspaceSnapshot(), group)) });
  }

  function applyPermanentDeletion(next) {
    if (next.syncedSources !== snapshotRef.current.syncedSources) syncedStore.replaceAll(next.syncedSources || []);
    setWorkspace(next);
    setSelectedPageId((current) => next.pages.some((entry) => entry.id === current && !entry.trashedAt) ? current : null);
    setSelectedFolderId((current) => next.folders.some((entry) => entry.id === current && !entry.trashedAt) ? current : null);
    setExpanded((current) => new Set([...current].filter((id) => next.folders.some((entry) => entry.id === id) || next.pages.some((entry) => entry.id === id))));
  }

  function emptyTrash() {
    const count = listTrashGroups(workspace, new Date().toISOString()).length;
    if (!count) return;
    setConfirmAction({ title: t("app.msg.emptyTrashTitle"), description: t("app.msg.emptyTrashDesc", { count }), confirmLabel: t("app.msg.emptyTrashBtn"), danger: true, action: () => applyPermanentDeletion(emptyWorkspaceTrash(currentWorkspaceSnapshot())) });
  }

  function deleteFolder(id) {
    const folder = folderById(folders, id);
    if (!folder || folder.trashedAt) return;
    setConfirmAction({ title: t("app.msg.trashFolderTitle", { name: folder.name }), description: t("app.msg.trashFolderDesc"), confirmLabel: t("actions.trash"), action: () => {
      const next = trashFolder(currentWorkspaceSnapshot(), id, new Date().toISOString());
      setWorkspace(next);
      if (!next.folders.some((entry) => entry.id === selectedFolderId && !entry.trashedAt)) setSelectedFolderId(next.folders.find((entry) => entry.id === folder.parentId && !entry.trashedAt)?.id ?? childrenOf(next.folders, null)[0]?.id ?? null);
      if (!next.pages.some((entry) => entry.id === selectedPageId && !entry.trashedAt)) setSelectedPageId(null);
    } });
    setContextMenu(null);
  }

  function showContextMenu(event, target) {
    if (target.type === "folder" && folders.find((folder) => folder.id === target.id)?.system) return;
    const opener = event.target.closest("button") || event.currentTarget.querySelector(".tree-folder-main, .sidebar-page-main, .folder-note-main") || event.currentTarget.querySelector("button");
    menuOpener.current = opener;
    const anchor = opener?.getBoundingClientRect();
    const useAnchor = event.clientX === 0 && event.clientY === 0 || event.type === "click";
    const left = useAnchor && anchor ? anchor.left : event.clientX;
    const top = useAnchor && anchor ? anchor.bottom : event.clientY;
    const menuWidth = 214;
    const menuHeight = target.type === "folder" ? 256 : target.type === "page" ? 180 : 68;
    setContextMenu({
      ...target,
      x: Math.max(8, Math.min(left, window.innerWidth - menuWidth - 10)),
      y: Math.max(8, Math.min(top, window.innerHeight - menuHeight - 10)),
    });
  }

  function dismissContextMenu() {
    setContextMenu(null);
    if (menuOpener.current?.isConnected) menuOpener.current.focus({ preventScroll: true });
  }

  function handleContextAction(action, menu) {
    dismissContextMenu();
    if (action === "create-root-folder") {
      setModal({ mode: "create-root-folder", folderId: null, initialValue: "" });
    } else if (action === "create-page") {
      createPage(menu.id);
    } else if (action === "create-folder") {
      setModal({ mode: "create-folder", folderId: menu.id, initialValue: "" });
    } else if (action === "rename-folder") {
      const folder = folderById(folders, menu.id);
      setModal({ mode: "rename-folder", folderId: menu.id, initialValue: folder?.name ?? "" });
    } else if (action === "promote-folder-root") {
      const next = moveFolder(currentWorkspaceSnapshot(), menu.id, null, new Date().toISOString());
      setWorkspace(next);
    } else if (action === "move-folder") {
      setMoveFolderTargetId(menu.id);
    } else if (action === "move-page") {
      setMovePageTargetId(menu.id);
    } else if (action === "favorite-page") {
      togglePageFavorite(menu.id);
    } else if (action === "favorite-up" || action === "favorite-down") {
      reorderFavorite(menu.id, (workspaceUi.favoritePageIds || []).indexOf(menu.id) + (action === "favorite-up" ? -1 : 1));
    } else if (action === "rename-page") {
      const page = pageById(pages, menu.id);
      setModal({ mode: "rename-page", pageId: menu.id, initialValue: page?.title ?? "" });
    } else if (action === "delete-folder") {
      deleteFolder(menu.id);
    } else if (action === "delete-page") {
      deletePage(menu.id);
    } else if (action === "open-page") {
      openPage(menu.id);
    }
  }

  function submitModal(name) {
    if (modal.mode === "create-page") createPage(modal.folderId, name);
    if (modal.mode === "create-folder") createFolder(modal.folderId, name);
    if (modal.mode === "create-root-folder") createFolder(null, name);
    if (modal.mode === "rename-folder") renameFolder(modal.folderId, name);
    if (modal.mode === "rename-page") renamePage(modal.pageId, name);
  }

  const breadcrumbPath = activeSection === "private" ? workspaceNavigation.breadcrumbs(selectedPage?.id, selectedFolder?.id) : [];
  function openBreadcrumb(node) {
    if (node.kind === "folder") openFolder(node.id);
    if (node.kind === "page") openPage(node.id);
  }
  const databaseRuntime = {
    workspace,
    getWorkspace: currentWorkspaceSnapshot,
    flushForFormShare,
    collectFormResponses,
    recordPeekVisit: (pageId) => setWorkspace((current) => current.pages.some((page) => page.id === pageId && !page.trashedAt) ? { ...current, ui: recordVisit(current.ui, pageId, new Date().toISOString()) } : current),
    platform: window.lifeAtlas?.platform === "desktop" ? "desktop" : "browser",
    dialogs,
    updatePageDatabaseView: (pageId, databaseViewId, sourceIdsJson) => {
      const page = snapshotRef.current.pages.find((entry) => entry.id === pageId);
      if (!page || page.trashedAt || page.settings?.locked) return;
      updatePage(pageId, { databaseViewId, ...(sourceIdsJson ? { databaseSourceIds: JSON.parse(sourceIdsJson) } : {}) });
    },
    updateDataSourceLayout: (sourceId, layout) => setWorkspace((current) => {
      const source = dataSourceById(current, sourceId);
      if (!canEditDatabaseSource(current, sourceId)) return current;
      return { ...current, dataSources: current.dataSources.map((entry) => entry.id === sourceId ? { ...entry, recordLayout: normalizeRecordLayout(layout, source) } : entry) };
    }),
    renderRecordLayoutView: ({ sourceId, viewId }) => <DatabaseView workspace={workspace} sourceId={sourceId} viewId={viewId}
      readOnlyReference runtime={{ ...databaseRuntime, locked: true }} onOpenItemPage={openPage} />,
    openDatabaseHistory: (sourceId, itemId) => setDatabaseHistoryTarget({ sourceId, itemId }),
    setItemDependencies: (itemId, ids) => commitDatabaseCommand((current) => ({ workspace: changeItemDependencies(current, itemId, ids, new Date().toISOString()) })).workspace,
    setDatabaseItemParent: (itemId, parentId) => commitDatabaseCommand((current) => ({ workspace: changeDatabaseItemParent(current, itemId, parentId, new Date().toISOString()) })).workspace,
    updateDependencyConfig: (sourceId, config) => commitDatabaseCommand((current) => {
      const source = dataSourceById(current, sourceId);
      if (!canEditDatabaseSource(current, sourceId)) throw new Error(t("app.msg.sourceNotEditable"));
      return { workspace: { ...current, dataSources: current.dataSources.map((entry) => entry.id === sourceId ? { ...entry, dependencyConfig: normalizeDependencyConfig(source, config) } : entry) } };
    }).workspace,
    syncedStore,
    createPerson,
    updatePerson,
    createAttachment,
    createEditorAttachment,
    uploadAttachment: async (file) => (await createEditorAttachment(file)).metadata,
    attachmentUrl: (attachment) => attachment?.provider === "asset" ? Promise.resolve(`life-asset://${attachment.storageKey}`) : resolveBrowserAttachmentUrl(attachment),
    stageAttachment: (name, bytes, mime, context) => stageEditorAttachment(new File([bytes], name, { type: mime }), context),
    resolveEditorAttachmentUrl,
    saveCurrentPageTemplate,
    createPageFromTemplate,
    deletePageTemplate,
    saveDatabaseTemplateFromPage,
    deleteDatabaseTemplate,
    addDiscussion,
    replyDiscussion,
    resolveDiscussion,
    attachExternalToPage,
    updateDatabaseProperty,
    changePropertyType,
    deleteDatabaseProperty,
    trashDatabaseItems,
    duplicateDatabaseItem,
    updatePageContent,
    updateDatabaseOccurrence,
    materializeDatabaseOccurrence,
    importCsv,
    importNotion,
    restorePageVersion,
    renameDatabaseSource,
    locked: selectedPage ? normalizePageSettings(selectedPage.settings).locked || isPageArchived(workspace, selectedPage.id) : false,
    pageId: selectedPage?.id || null,
    breadcrumb: [
      "Private",
      ...selectedFolderPath.map((folder) => folder.name),
      ...(selectedPage ? [selectedPage.title || t("backlinks.untitled")] : []),
    ],
    openPage,
    openFolder,
    openPageAt,
    appendBlocksToPage: (pageId, blocks) => {
      const target = workspace.pages.find((page) => page.id === pageId);
      if (!target || target.trashedAt || target.settings?.locked) throw new Error(t("app.msg.targetPageNotEditable"));
      setWorkspace((current) => {
        const result = appendPageBlocks(current, { pageId, blocks, now: new Date().toISOString() });
        return { ...result, pages: result.pages.map((page) => page.id === pageId ? { ...page, summary: derivePageSummary(page), summarySourceRevision: page.contentRevision, summaryUpdatedAt: page.updatedAt } : page) };
      });
    },
    createInlineDatabase,
    createFullPageDatabase,
    createDatabaseItem,
    runDatabaseAction,
    updateDatabaseItemValue,
    updateDatabaseItemsProperty,
    updateDatabaseDateFields,
    updateDatabaseView,
    createDatabaseView,
    createLinkedView: createLinkedDatabaseView,
    addDatabaseProperty,
    createFullPageFromSource,
    turnFullPageDatabaseInline,
    createSubPage,
  };

  return (
    <AttachmentMediaContext.Provider value={databaseRuntime}>
    <div className={`app-shell ${focusReading ? "is-focus-reading" : ""} ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`} style={{ "--sidebar-width": `${sidebarWidth}px` }}>
      {!sidebarCollapsed && <Sidebar
        activeSection={activeSection}
        onChange={setActiveSection}
        privateExpanded={privateExpanded}
        onTogglePrivate={() => setPrivateExpanded((current) => !current)}
        folders={folders}
        pages={pages.filter((page) => !isPageArchived(workspace, page.id))}
        dataSources={dataSources}
        databaseViews={databaseViews}
        expanded={expanded}
        selectedFolderId={selectedFolderId}
        selectedPageId={selectedPageId}
        onToggleFolder={toggleFolder}
        onOpenFolder={openFolder}
        onOpenPage={openPage}
        onOpenPageAt={openPageAt}
        onQuickCreatePage={quickCreatePage}
        onContextMenu={showContextMenu}
        onSearch={() => setSearchOpen(true)}
        onQuickCapture={() => setCaptureOpen(true)}
        inboxCount={inboxCount}
        onOpenBackup={() => setBackupOpen(true)}
        onOpenTemplates={() => openMarketplace(null)}
        workspaceName={workspaceName}
        workspaceIcon={workspaceUi.workspaceIcon}
        favorites={favorites}
        visibleSections={devicePreferences.sidebarSections}
        sidebarWidth={sidebarWidth}
        onResize={setSidebarWidth}
        onResizeCommit={(width) => setWorkspace((current) => ({ ...current, ui: { ...current.ui, sidebarWidth: width } }))}
        onMoveNode={dropSidebarNode}
        onMoveFavorite={reorderFavorite}
        onRenameWorkspace={() => setRenameWorkspaceOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onImportNotion={() => setNotionImportOpen(true)}
        onExportMarkdown={() => setMarkdownExportOpen(true)}
        onImportCsv={() => setCsvImportOpen(true)}
        onAbout={() => setAboutOpen(true)}
        onOpenDataFolder={window.lifeAtlas?.app?.openDataFolder ? async () => { const result = await window.lifeAtlas.app.openDataFolder(); if (!result.ok) setWorkspaceNotice(result.error?.message || t("app.msg.openDirFailed")); } : null}
        onCreateRootFolder={() => setModal({ mode: "create-root-folder", folderId: null, initialValue: "" })}
        onExpandAll={() => { setPrivateExpanded(true); setExpanded(new Set([...folders.filter((folder) => !folder.trashedAt).map((folder) => folder.id), ...pages.filter((page) => !page.trashedAt && (!page.databaseSourceId || page.pageType === "database")).map((page) => page.id)])); }}
        onCollapseAll={() => setExpanded(new Set())}
        onOpenVault={window.lifeAtlas?.app?.openVaultWindow ? () => window.lifeAtlas.app.openVaultWindow({}) : null}
        vaultStatus={vaultStatus}
        trashCount={listTrashGroups(workspace, new Date().toISOString()).length}
      />}

      <main className="workspace-pane">
        {findOpen && <FindBar rootRef={pageDocumentRef} focusKey={findFocusKey} onClose={() => setFindOpen(false)} />}
        <WorkspaceTopbar
          activeSection={activeSection}
          sectionTitle={activeSection === "market" && marketDetailTitle ? `${meta.title} / ${marketDetailTitle}` : meta.title}
          breadcrumbPath={breadcrumbPath}
          onOpenBreadcrumb={openBreadcrumb}
          onOpenLibrary={() => setActiveSection("library")}
          onSearch={() => setSearchOpen(true)}
          themePreference={themePreference}
          onCycleTheme={cycleThemePreference}
          canGoBack={Boolean(goBack(navigationHistory, validLocation).location)}
          canGoForward={Boolean(goForward(navigationHistory, validLocation).location)}
          onBack={() => navigateHistory("back")}
          onForward={() => navigateHistory("forward")}
          sidebarCollapsed={sidebarCollapsed}
          onExpandSidebar={() => setWorkspace((current) => ({ ...current, ui: { ...current.ui, sidebarCollapsed: false } }))}
          actions={activeSection === "private" && selectedPage && !selectedPage.trashedAt ? (
            <div className="page-actions-anchor">
              <IconButton
                ref={pageActionsTriggerRef}
                label={t("actions.buttonAria")}
                className={pageActionsOpen ? "is-active" : ""}
                onClick={() => setPageActionsOpen((current) => !current)}
              >
                <IconDots size={18} stroke={1.9} />
              </IconButton>
              {pageActionsOpen && (
                <PageActionsMenu
                  page={selectedPage}
                  history={editorHistory}
                  onUndo={undoCurrentPage}
                  onRedo={redoCurrentPage}
                  onSettingChange={(patch) => updatePageSettings(selectedPage.id, patch)}
                  onCopyContents={copyCurrentPageContents}
                  onDuplicate={duplicateCurrentPage}
                  onDuplicateIndependently={workspace.databaseItems?.some(item => item.pageId === selectedPage.id) ? undefined : duplicateCurrentPageIndependently}
                  onSaveTemplate={saveSelectedPageTemplate}
                  onOpenHistory={() => { setHistoryPageId(selectedPage.id); setPageActionsOpen(false); }}
                  onOpenDatabaseHistory={selectedPage.databaseSourceId || workspace.databaseItems.some((item) => item.pageId === selectedPage.id) ? () => {
                    const item = workspace.databaseItems.find((entry) => entry.pageId === selectedPage.id);
                    setDatabaseHistoryTarget({ sourceId: item?.sourceId || selectedPage.databaseSourceId, itemId: item?.id }); setPageActionsOpen(false);
                  } : undefined}
                  onPresent={() => { setPresentationPageId(selectedPage.id); setPageActionsOpen(false); }}
                  isArchived={isPageArchived(workspace, selectedPage.id)}
                  archiveActionLabel={!selectedPage.archivedAt && isPageArchived(workspace, selectedPage.id) ? t("page.openArchivedParent") : undefined}
                  onArchive={toggleCurrentPageArchive}
                  isFavorite={(workspaceUi.favoritePageIds || []).includes(selectedPage.id)}
                  onToggleFavorite={() => { togglePageFavorite(selectedPage.id); setPageActionsOpen(false); }}
                  onMove={requestMoveCurrentPage}
                  onTrash={trashCurrentPage}
                  onCustomize={() => {
                    setPageActionsOpen(false);
                    setCustomizeTarget({ pageId: selectedPage.id, mode: "icon", fromPageActions: true });
                  }}
                  onImport={requestImport}
                  onExport={requestExportCurrentPage}
                  onClose={() => setPageActionsOpen(false)}
                />
              )}
            </div>
          ) : null}
        />

        <WorkspaceTabs pages={tabPages} activePageId={activeTabId} panelId={workspacePanelId} onActivate={activatePageTab}
          onClose={closePageTab} onCloseOthers={closeOtherPageTabs} onOpenPicker={() => setSearchOpen("pages")} />

        {saveError && <div className="mb-save-error" role="alert"><span>{saveError}</span><button type="button" onClick={() => pendingMarketSave ? void finishMarketSave(pendingMarketSave).catch(() => {}) : void flushWorkspace()}>{t("status.retrySave")}</button>{window.lifeAtlas?.backup?.exportRescue ? <button type="button" onClick={() => setWorkspaceRescueOpen(true)}>{t("page.exportUnsaved")}</button> : <button type="button" onClick={() => setBackupOpen(true)}>{t("page.exportBackup")}</button>}</div>}
        {workspaceNotice && <div className="mb-workspace-notice" role="status"><span>{workspaceNotice}</span><button type="button" className="ui-icon-button" aria-label={t("page.dismissNotice")} onClick={() => setWorkspaceNotice("")}><IconX size={15} /></button></div>}
        {workspace.ui?.databaseHistoryCaptureWarning && <div className="mb-workspace-notice" role="status"><span>{workspace.ui.databaseHistoryCaptureWarning.message}</span><button type="button" onClick={() => setWorkspace((current) => ({ ...current, ui: { ...current.ui, databaseHistoryCaptureWarning: null } }))}>{t("common.okGotIt")}</button></div>}
        {activeSection === "private" && selectedPage && isPageArchived(workspace, selectedPage.id) && <div className="mb-workspace-notice" role="status"><span>{t("page.archivedNotice")}</span><button type="button" onClick={toggleCurrentPageArchive}>{selectedPage.archivedAt ? t("actions.unarchivePage") : t("page.openArchivedParent")}</button></div>}
        <div ref={workspaceScrollRef} role={activeTabId ? "tabpanel" : undefined} id={workspacePanelId}
          aria-labelledby={activeTabId ? `workspace-tab-${activeTabId}` : undefined}
          className={`workspace-scroll ${activeSection === "private" ? "is-private is-editor" : ""} ${activeSection === "private" && selectedPage ? "is-page-editor" : ""} ${focusReading ? "is-focus-reading" : ""}`}>
          {activeSection === "home" && <WorkspaceHome workspace={workspace} workspaceName={workspaceName} now={now} onOpenPage={openPage} onCreatePage={quickCreatePage} onOpenTemplates={() => openMarketplace(null)} onOpenLibrary={() => setActiveSection("library")} onOpenBackup={() => setBackupOpen(true)} backupStatus={backupStatus} />}
          {activeSection === "library" && <WorkspaceLibrary navigation={workspaceNavigation} now={now} onOpenPage={openPage} />}
          {activeSection === "recents" && <RecentPages workspace={workspace} now={now} onOpenPage={openPage} />}
          {activeSection === "inbox" && <InboxView workspace={workspace} onOpenPage={openPage} onArchive={archiveInboxPages} onTrash={deletePage} onReadReminder={(entry) => { setWorkspace((current) => ({ ...current, ui: markRemindersRead(current.ui, entry.pageId, new Date().toISOString()) })); openPage(entry.pageId); }} onReadAll={() => setWorkspace((current) => ({ ...current, ui: markRemindersRead(current.ui, null, new Date().toISOString()) }))} />}
          {activeSection === "market" && (
            <Suspense fallback={null}>
              <LazyMarketplaceView
                workspace={workspace}
                currentFolderId={defaultTemplateFolderId(workspace, selectedFolderId)}
                currentPageId={selectedPage?.id}
                detailKey={marketDetailKey}
                onOpenDetail={(key) => openMarketplace(key)}
                onBackToList={returnToMarketplaceList}
                onDetailTitleChange={setMarketDetailTitle}
                onUseTemplate={useTemplate}
                onDeleteTemplate={deletePageTemplate}
                onUseMarketPackage={useMarketPackage}
                onRetrySave={pendingMarketSave ? () => finishMarketSave(pendingMarketSave) : undefined}
              />
            </Suspense>
          )}
          {activeSection === "trash" && (
            <TrashView
              workspace={workspace}
              onRestore={restoreTrashedPage}
              onDeletePermanently={permanentlyDeleteTrashedPage}
              onEmptyTrash={emptyTrash}
            />
          )}
          {activeSection === "private" && selectedPage && selectedOccurrence.block && (
            <DatabaseOccurrenceDocument page={selectedPage} block={selectedOccurrence.block} runtime={databaseRuntime} documentRef={pageDocumentRef} />
          )}
          {activeSection === "private" && selectedPage && !selectedOccurrence.block && (
            <PageDocument
              key={selectedPage.id}
              page={isPageArchived(workspace, selectedPage.id) ? { ...selectedPage, settings: { ...normalizePageSettings(selectedPage.settings), locked: true } } : selectedPage}
              folderPath={selectedFolderPath}
              saveState={saveState}
              onTitleChange={(title) => {
                const databaseItem = databaseItems.find((item) => item.pageId === selectedPage.id);
                const itemSource = databaseItem ? dataSourceById(workspace, databaseItem.sourceId) : null;
                const titleProperty = itemSource?.properties?.find((property) => property.type === "title");
                if (databaseItem && titleProperty) {
                  updateDatabaseItemValue(databaseItem.id, titleProperty.id, title);
                } else {
                  updatePage(selectedPage.id, { title });
                }
                if (selectedPage.pageType === "database" && selectedPage.databaseSourceId &&
                  dataSourceById(workspace, selectedPage.databaseSourceId)?.ownerPageId === selectedPage.id) {
                  renameDatabaseSource(selectedPage.databaseSourceId, title);
                }
              }}
              onContentChange={(content) => updatePage(selectedPage.id, { content })}
              onChangeIcon={() => setCustomizeTarget({ pageId: selectedPage.id, mode: "icon" })}
              onChangeCover={() => setCustomizeTarget({ pageId: selectedPage.id, mode: "cover" })}
              onSaveCoverPosition={(position) => {
                const page = snapshotRef.current.pages.find((entry) => entry.id === selectedPage.id);
                if (page?.cover && !page.trashedAt && !page.settings?.locked) {
                  updatePage(page.id, { cover: coverWithPosition(page.cover, position) });
                }
              }}
              onEditorApiChange={handleEditorApiChange}
              onHistoryStateChange={handleHistoryStateChange}
              databaseRuntime={databaseRuntime}
              backlinkIndex={backlinkIndex}
              documentRef={pageDocumentRef}
              focusBlockId={pendingBlockFocus?.pageId === selectedPage.id ? pendingBlockFocus.blockId : null}
              onBlockFocused={() => setPendingBlockFocus(null)}
              qaFocusCoverAction={qaMode === "cover-hover"}
            />
          )}
          {activeSection === "private" && !selectedPage && selectedFolder && (
            <FolderView
              folder={selectedFolder}
              folders={folders}
              pages={pages.filter((page) => !isPageArchived(workspace, page.id))}
              onOpenPage={openPage}
              onCreatePage={() => createPage(selectedFolder.id)}
              onCreateFolder={() => setModal({ mode: "create-folder", folderId: selectedFolder.id, initialValue: "" })}
              onContextMenu={showContextMenu}
            />
          )}
        </div>
      </main>

      {backupOpen && <BackupDialog key={backupOpen.tab || "backup"} initialTab={backupOpen.tab || "backup"} initialSchedule={backupOpen.schedule} getWorkspaceSnapshot={currentWorkspaceSnapshot} flushWorkspace={flushWorkspace} repository={repository} onClose={() => setBackupOpen(false)} />}
      {workspaceRescueOpen && <WorkspaceRescueDialog getWorkspaceSnapshot={currentWorkspaceSnapshot} onClose={() => setWorkspaceRescueOpen(false)} />}
      {settingsOpen && <SettingsDialog key={String(settingsOpen)} initialSection={typeof settingsOpen === "string" ? settingsOpen : "appearance"} workspace={workspace} devicePreferences={devicePreferences} onDevicePreferenceChange={changeDevicePreferences} onPreferenceChange={updatePreferences} onIdentityChange={(patch) => setWorkspace((current) => ({ ...current, ui: { ...current.ui, ...patch } }))} onOpenBackup={(tab = "backup") => setBackupOpen({ tab })} onClose={() => setSettingsOpen(false)} />}
      <WorkspaceAssistant getWorkspace={currentWorkspaceSnapshot} getCurrentPageId={() => activeTabId}
        openPane={setSettingsOpen} flushWorkspace={flushWorkspace}
        applyWorkspace={applyAssistantWorkspace} pageTitle={activeSection === "private" && selectedPage ? selectedPage.title || t("backlinks.untitled") : ""} />
      {csvImportOpen && <CsvImportDialog workspace={workspace} folderId={defaultTemplateFolderId(workspace, selectedFolderId)} onImport={importCsv} onClose={() => setCsvImportOpen(false)} />}
      {notionImportOpen && <NotionImportDialog workspace={workspace} runtime={databaseRuntime} onClose={() => setNotionImportOpen(false)} />}
      {markdownExportOpen && <MarkdownExportDialog workspace={workspace} runtime={databaseRuntime} onClose={() => setMarkdownExportOpen(false)} />}
      {historyPageId && workspace.pages.some((page) => page.id === historyPageId && !page.trashedAt) && <PageHistoryDialog restoreFocusRef={pageActionsTriggerRef} workspace={workspace} page={workspace.pages.find((page) => page.id === historyPageId)} runtime={databaseRuntime} onClose={() => setHistoryPageId(null)} onRestored={setHistoryNotice} />}
      {presentationPageId && workspace.pages.some((page) => page.id === presentationPageId && !page.trashedAt) && <PagePresentation page={workspace.pages.find((page) => page.id === presentationPageId)} databaseRuntime={databaseRuntime} restoreFocusRef={pageActionsTriggerRef} onClose={() => setPresentationPageId(null)} />}
      {databaseHistoryTarget && <DatabaseHistoryDialog workspace={workspace} sourceId={databaseHistoryTarget.sourceId} itemId={databaseHistoryTarget.itemId}
        restoreFocusRef={pageActionsTriggerRef} runtime={databaseRuntime} onClose={() => setDatabaseHistoryTarget(null)}
        onCapture={(sourceId) => setWorkspace((current) => recordDatabaseVersion(current, sourceId, { reason: "manual", idFactory: makeId }))}
        onRestore={restoreDatabaseHistory} onRestoreItem={(sourceId, versionId, itemId, signature) => restoreDatabaseHistory(sourceId, versionId, signature, itemId)} />}
      {historyNotice && <div className="page-history-status" role="status">{historyNotice}</div>}
      {captureOpen && <QuickCapture onClose={() => setCaptureOpen(false)} onSave={saveQuickCapture} />}
      {shortcutsOpen && <ShortcutPanel onClose={() => setShortcutsOpen(false)} />}
      {renameWorkspaceOpen && <RenameWorkspaceDialog workspaceName={workspaceName} workspaceIcon={workspaceUi.workspaceIcon} onClose={() => setRenameWorkspaceOpen(false)} onSave={(identity) => { setWorkspace((current) => ({ ...current, ui: { ...current.ui, ...identity } })); setRenameWorkspaceOpen(false); }} />}
      {aboutOpen && <AboutWorkspaceDialog onClose={() => setAboutOpen(false)} />}
      {confirmAction && <ConfirmDialog {...confirmAction} onClose={() => setConfirmAction(null)} onConfirm={() => { const action = confirmAction.action; setConfirmAction(null); action(); }} />}
      {moveFolderTargetId && <FolderMoveDialog workspace={workspace} folderId={moveFolderTargetId} onClose={() => setMoveFolderTargetId(null)} onMove={(targetParentId) => { const next = moveFolder(currentWorkspaceSnapshot(), moveFolderTargetId, targetParentId, new Date().toISOString()); setWorkspace(next); setExpanded((current) => new Set([...current, ...folderAncestors(next.folders, targetParentId).map((folder) => folder.id)])); setMoveFolderTargetId(null); }} />}

      {focusReading && selectedPage && (
        <button
          type="button"
          className="focus-reading-exit"
          aria-label={t("page.exitFocus")}
          onClick={() => updatePageSettings(selectedPage.id, { presentationMode: "full", fullWidth: true })}
        >
          {t("page.exitFocus")}
        </button>
      )}
      <ContextMenu onDismiss={dismissContextMenu} menu={contextMenu ?? (qaContextMenu ? { type: "folder", id: "parenting", x: 128, y: 296 } : null)} folders={folders} pages={pages} favoritePageIds={favorites.map((page) => page.id)} onAction={handleContextAction} />
      {modal && <ItemModal key={`${modal.mode}-${modal.folderId ?? modal.pageId ?? "root"}`} config={modal} folders={folders} pages={pages} onClose={() => setModal(null)} onSubmit={submitModal} />}
      {movePageTargetId && pageById(pages, movePageTargetId) && (
        <PageMoveModal
          page={pageById(pages, movePageTargetId)}
          folders={folders}
          onClose={() => setMovePageTargetId(null)}
          onMove={commitMovePage}
        />
      )}
      {exportOpen && selectedPage && !selectedPage.trashedAt && (
        <PageExportDialog
          restoreFocusRef={pageActionsTriggerRef}
          page={selectedPage}
          workspace={workspace}
          pageElement={document.querySelector(".page-document")}
          qaMode={qaMode === "export"}
          onClose={() => setExportOpen(false)}
        />
      )}
      <input
        ref={importInputRef}
        className="page-import-input"
        type="file"
        accept=".json,.md,.markdown,.txt,application/json,text/markdown,text/plain"
        onChange={importIntoCurrentPage}
        tabIndex={-1}
        aria-hidden="true"
      />
      {customizeTarget?.pageId && pageById(pages, customizeTarget.pageId) && (
        <Suspense fallback={<div className="modal-backdrop page-customize-backdrop"><div className="page-customize-modal page-customize-loading">{t("page.loadingLibrary")}</div></div>}>
          <LazyPageCustomizePanel
            key={`${customizeTarget.pageId}:${customizeTarget.mode}`}
            mode={customizeTarget.mode}
            restoreFocusRef={customizeTarget.fromPageActions ? pageActionsTriggerRef : undefined}
            page={pageById(pages, customizeTarget.pageId)}
            preferences={assetPreferences}
            onPreferencesChange={updateAssetPreferences}
            onUploadAttachment={window.lifeAtlas?.platform === "desktop" ? createEditorAttachment : undefined}
            onClose={() => setCustomizeTarget(null)}
            onSave={(patch) => {
              updatePage(customizeTarget.pageId, patch);
              setCustomizeTarget(null);
            }}
          />
        </Suspense>
      )}
      {searchOpen && (
        <SearchDialog
          initialFilter={searchOpen === "pages" ? "pages" : "all"}
          documents={searchDocuments}
          initialQuery={qaMode === "search" ? "讲解" : ""}
          onClose={() => setSearchOpen(false)}
          onOpenPage={openPage}
          onOpenFolder={openFolder}
        />
      )}
    </div>
    </AttachmentMediaContext.Provider>
  );
}
