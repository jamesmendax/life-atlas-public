import { useMemo, useRef, useState } from "react";
import IconArrowsShuffle from "@tabler/icons-react/dist/esm/icons/IconArrowsShuffle.mjs";
import IconPhoto from "@tabler/icons-react/dist/esm/icons/IconPhoto.mjs";
import IconSearch from "@tabler/icons-react/dist/esm/icons/IconSearch.mjs";
import IconSparkles from "@tabler/icons-react/dist/esm/icons/IconSparkles.mjs";
import IconStar from "@tabler/icons-react/dist/esm/icons/IconStar.mjs";
import IconX from "@tabler/icons-react/dist/esm/icons/IconX.mjs";
import { emojiCategories, emojiRegistry, emojiRegistryMeta } from "../data/emojiRegistry.generated.js";
import { iconCategories, iconRegistry, iconRegistryMeta } from "../data/iconRegistry.generated.js";
import { coverGallery, coverGalleryGroups, coverGalleryItem, normalizeCoverChoice } from "../data/coverGallery.js";
import { emptyAssetPreferences } from "../data/appearancePreferences.js";
import { VirtualAssetGrid } from "./VirtualAssetGrid.jsx";
import { AppearanceGlyph, SpriteIcon } from "./AppearanceGlyph.jsx";
import { useAttachmentMediaUrl } from "./AttachmentMedia.jsx";
import { useModalFocus } from "../ui/Dialog.jsx";
import { navigateChoiceGroup } from "../ui/keyboard.js";
import { format, useI18n } from "../i18n/workspaceRuntime.js";

const iconColorChoices = [
  { id: "stone", value: "#b7b7b7" },
  { id: "red", value: "#e56b6f" },
  { id: "orange", value: "#e89555" },
  { id: "amber", value: "#d9ad4f" },
  { id: "green", value: "#6eb57b" },
  { id: "teal", value: "#55b7ae" },
  { id: "blue", value: "#6fa8dc" },
  { id: "indigo", value: "#7f8ce0" },
  { id: "purple", value: "#a887df" },
  { id: "pink", value: "#d983ad" },
  { id: "brown", value: "#b58a6a" },
  { id: "white", value: "#e7e7e7" },
];

function uniqRecent(id, values, limit = 32) {
  return [id, ...(values ?? []).filter((value) => value !== id)].slice(0, limit);
}

function randomItem(items, currentId, getId = (item) => item.id) {
  if (!items.length) return null;
  const alternatives = items.filter((item) => getId(item) !== currentId);
  const pool = alternatives.length ? alternatives : items;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

function normalize(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
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
        backgroundPosition: `center ${normalized.position ?? item.defaultPosition ?? 50}%`,
      };
    }
  }
  return undefined;
}

export function PageCustomizePanel({
  page,
  mode = "icon",
  preferences = emptyAssetPreferences,
  onPreferencesChange,
  onClose,
  onSave,
  onUploadAttachment,
  restoreFocusRef,
}) {
  const { locale, t } = useI18n();
  const safePrefs = { ...emptyAssetPreferences, ...(preferences ?? {}) };
  const [icon, setIcon] = useState(page.icon || "📄");
  const [iconColor, setIconColor] = useState(page.iconColor || iconColorChoices[0].value);
  const [cover, setCover] = useState(() => normalizeCoverChoice(page.cover ?? null));
  const [iconTab, setIconTab] = useState(() => page.icon?.startsWith("icon:") ? "icons" : /^(data:image\/|life-asset:|blob:)/.test(page.icon || "") ? "upload" : "emoji");
  const [emojiCategory, setEmojiCategory] = useState("people");
  const [iconCategory, setIconCategory] = useState("all");
  const [iconQuery, setIconQuery] = useState("");
  const [coverTab, setCoverTab] = useState(page.cover?.kind === "upload" ? "upload" : "gallery");
  const [coverGroup, setCoverGroup] = useState("all");
  const [coverQuery, setCoverQuery] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const coverUrl = useAttachmentMediaUrl(cover?.kind === "upload" ? cover.value : null);
  const dialogRef = useRef(null);
  const searchRef = useRef(null);
  useModalFocus(dialogRef, { initialFocusRef: searchRef, restoreFocusRef, onClose, busy: uploading });

  function updatePrefs(patch) {
    onPreferencesChange?.({ ...safePrefs, ...patch });
  }

  function selectEmoji(item) {
    setIcon(item.native);
    updatePrefs({ recentEmojiIds: uniqRecent(item.id, safePrefs.recentEmojiIds) });
  }

  function selectIcon(item, randomizeColor = false) {
    setIcon(`icon:${item.id}`);
    if (randomizeColor) {
      const colors = iconColorChoices.filter((choice) => choice.value !== iconColor);
      setIconColor(colors[Math.floor(Math.random() * colors.length)]?.value ?? iconColor);
    }
    updatePrefs({ recentIconIds: uniqRecent(item.id, safePrefs.recentIconIds) });
  }

  function selectCover(item) {
    setCover({ kind: "gallery", value: item.id, position: item.defaultPosition ?? 50 });
    updatePrefs({ recentCoverIds: uniqRecent(item.id, safePrefs.recentCoverIds, 24) });
  }

  async function uploadCover(file) {
    if (!file) return;
    if (onUploadAttachment) {
      setUploading(true); setUploadError("");
      try { const { url } = await onUploadAttachment(file); setCover({ kind: "upload", value: url, position: 50 }); setCoverTab("upload"); }
      catch (error) { setUploadError(error.message); }
      finally { setUploading(false); }
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCover({ kind: "upload", value: String(reader.result), position: 50 });
      setCoverTab("upload");
    };
    reader.readAsDataURL(file);
  }

  async function uploadIcon(file) {
    if (!file) return;
    if (onUploadAttachment) {
      setUploading(true); setUploadError("");
      try { const { url } = await onUploadAttachment(file); setIcon(url); }
      catch (error) { setUploadError(error.message); }
      finally { setUploading(false); }
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setIcon(String(reader.result));
    reader.readAsDataURL(file);
  }

  const emojiItems = useMemo(() => {
    const query = normalize(iconQuery);
    if (query) return emojiRegistry.filter((item) => item.searchText.includes(query));
    if (emojiCategory === "recent") {
      const byId = new Map(emojiRegistry.map((item) => [item.id, item]));
      return safePrefs.recentEmojiIds.map((id) => byId.get(id)).filter(Boolean);
    }
    return emojiRegistry.filter((item) => item.category === emojiCategory);
  }, [iconQuery, emojiCategory, safePrefs.recentEmojiIds]);

  const iconItems = useMemo(() => {
    const query = normalize(iconQuery);
    if (query) return iconRegistry.filter((item) => item.searchText.includes(query));
    if (iconCategory === "recent") {
      const byId = new Map(iconRegistry.map((item) => [item.id, item]));
      return safePrefs.recentIconIds.map((id) => byId.get(id)).filter(Boolean);
    }
    if (iconCategory === "all") return iconRegistry;
    return iconRegistry.filter((item) => item.category === iconCategory);
  }, [iconQuery, iconCategory, safePrefs.recentIconIds]);

  const coverItems = useMemo(() => {
    const query = normalize(coverQuery);
    let items;
    if (coverGroup === "recent") {
      const byId = new Map(coverGallery.map((item) => [item.id, item]));
      items = safePrefs.recentCoverIds.map((id) => byId.get(id)).filter(Boolean);
    } else if (coverGroup === "favorites") {
      const favoriteSet = new Set(safePrefs.favoriteCoverIds);
      items = coverGallery.filter((item) => favoriteSet.has(item.id));
    } else if (coverGroup === "all") {
      items = coverGallery;
    } else {
      items = coverGallery.filter((item) => item.category === coverGroup || item.group === coverGroup);
    }
    if (!query) return items;
    return items.filter((item) => [
      item.title, item.artist, item.categoryLabel, item.subcategory, item.source, ...(item.tags ?? [])
    ].join(" ").toLocaleLowerCase().includes(query));
  }, [coverGroup, coverQuery, safePrefs.recentCoverIds, safePrefs.favoriteCoverIds]);

  function randomizeIcon(event) {
    if (iconTab === "emoji") {
      const item = randomItem(emojiItems.length ? emojiItems : emojiRegistry, null, (candidate) => candidate.native === icon ? candidate.id : candidate.id);
      if (item) selectEmoji(item);
      return;
    }
    const currentId = icon.startsWith("icon:") ? icon.slice(5) : null;
    const item = randomItem(iconItems.length ? iconItems : iconRegistry, currentId);
    if (item) selectIcon(item, Boolean(event?.shiftKey));
  }

  const favoriteSet = useMemo(() => new Set(safePrefs.favoriteCoverIds), [safePrefs.favoriteCoverIds]);
  const isIconMode = mode === "icon";
  const dialogTitle = isIconMode ? t("customize.changeIcon") : t("customize.changeCover");
  const dialogDescription = isIconMode
    ? t("customize.iconDesc", { emojis: format.formatNumber(emojiRegistryMeta.count, locale), icons: format.formatNumber(iconRegistryMeta.count, locale) })
    : t("customize.coverDesc", { covers: format.formatNumber(coverGallery.length, locale) });

  return (
    <div className="modal-backdrop page-customize-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !uploading) onClose(); }}>
      <div ref={dialogRef} className={`page-customize-modal page-customize-modal-v2 ${isIconMode ? "is-icon-mode" : "is-cover-mode"}`} role="dialog" aria-modal="true" aria-label={dialogTitle} aria-busy={uploading} tabIndex={-1}>
        {uploading && <p role="status">{t("customize.savingImage")}</p>}
        {uploadError && <p role="alert" className="mb-danger-text">{uploadError}</p>}
        <div className="modal-header">
          <div>
            <h2>{dialogTitle}</h2>
            <p>{dialogDescription}</p>
          </div>
          <button type="button" className="icon-button" aria-label={t("common.close")} onClick={onClose} disabled={uploading}><IconX size={19} stroke={1.8} /></button>
        </div>

        {isIconMode && <section className="customize-section">
          <div className="customize-section-heading"><strong>{t("customize.pageIcon")}</strong><span>Emoji / Icons / Upload</span></div>
          <div className="icon-picker">
            <div className="icon-picker-tabs" role="tablist" aria-label={t("customize.iconSourceAria")} onKeyDown={navigateChoiceGroup}>
              <button type="button" role="tab" tabIndex={iconTab === "emoji" ? 0 : -1} aria-selected={iconTab === "emoji"} className={iconTab === "emoji" ? "is-active" : ""} onClick={() => setIconTab("emoji")}>Emoji <small>{emojiRegistryMeta.count}</small></button>
              <button type="button" role="tab" tabIndex={iconTab === "icons" ? 0 : -1} aria-selected={iconTab === "icons"} className={iconTab === "icons" ? "is-active" : ""} onClick={() => setIconTab("icons")}>Icons <small>{iconRegistryMeta.count}</small></button>
              <button type="button" role="tab" tabIndex={iconTab === "upload" ? 0 : -1} aria-selected={iconTab === "upload"} className={iconTab === "upload" ? "is-active" : ""} onClick={() => setIconTab("upload")}>{t("customize.upload")}</button>
            </div>

            {iconTab !== "upload" && (
              <div className={`picker-search-row ${iconTab === "icons" ? "has-design-random" : ""}`}>
                <label className="icon-picker-search">
                  <IconSearch size={16} stroke={1.7} />
                  <input ref={searchRef} value={iconQuery} onChange={(event) => setIconQuery(event.target.value)} placeholder={iconTab === "emoji" ? t("customize.searchEmojiPh") : t("customize.searchIconPh")} />
                  {iconQuery ? <button type="button" aria-label={t("customize.clearSearch")} onClick={() => setIconQuery("")}><IconX size={14} stroke={1.8} /></button> : <span />}
                </label>
                <button type="button" className="picker-random-button" onClick={randomizeIcon} title={iconTab === "icons" ? t("customize.randomIconTip") : t("customize.randomEmojiTip")} aria-label={iconTab === "icons" ? t("customize.randomIconAria") : t("customize.randomEmojiTip")}>
                  <IconArrowsShuffle size={17} stroke={1.7} />
                </button>
                {iconTab === "icons" && (
                  <button
                    type="button"
                    className="picker-random-design-button"
                    onClick={() => {
                      const currentId = icon.startsWith("icon:") ? icon.slice(5) : null;
                      const item = randomItem(iconItems.length ? iconItems : iconRegistry, currentId);
                      if (item) selectIcon(item, true);
                    }}
                    title={t("customize.randomDesignTip")}
                  >
                    <IconSparkles size={15} stroke={1.7} />
                    {t("customize.randomDesign")}
                  </button>
                )}
              </div>
            )}

            {iconTab === "emoji" && (
              <>
                <div className="emoji-category-tabs" aria-label={t("customize.emojiCatsAria")}>
                  <button type="button" className={emojiCategory === "recent" ? "is-active" : ""} onClick={() => { setEmojiCategory("recent"); setIconQuery(""); }}>{t("customize.recent")}</button>
                  {emojiCategories.map((category) => (
                    <button type="button" key={category.id} className={emojiCategory === category.id ? "is-active" : ""} onClick={() => { setEmojiCategory(category.id); setIconQuery(""); }}>
                      {category.label}<small>{category.count}</small>
                    </button>
                  ))}
                </div>
                <VirtualAssetGrid
                  className="emoji-virtual-grid"
                  items={emojiItems}
                  minCellWidth={44}
                  rowHeight={42}
                  gap={4}
                  maxColumns={14}
                  height={270}
                  resetKey={`emoji:${emojiCategory}:${iconQuery}`}
                  emptyText={emojiCategory === "recent" ? t("customize.emptyRecentEmoji") : t("customize.emptyEmoji")}
                  renderItem={(item) => (
                    <button type="button" title={item.name} aria-label={item.name} className={icon === item.native ? "is-selected" : ""} onClick={() => selectEmoji(item)}>
                      {item.native}
                    </button>
                  )}
                />
              </>
            )}

            {iconTab === "icons" && (
              <>
                <div className="icon-color-row">
                  <span>{t("customize.colorLabel")}</span>
                  <div className="icon-color-palette" aria-label={t("customize.color")}>
                    {iconColorChoices.map((choice) => {
                      const label = t(`customize.color.${choice.id}`);
                      return <button type="button" key={choice.id} title={label} aria-label={label} className={iconColor === choice.value ? "is-selected" : ""} style={{ "--swatch": choice.value }} onClick={() => setIconColor(choice.value)} />;
                    })}
                    <label className="icon-custom-color" title={t("customize.customColor")}>
                      <input type="color" value={iconColor} onChange={(event) => setIconColor(event.target.value)} aria-label={t("customize.customColorAria")} />
                      <span>+</span>
                    </label>
                  </div>
                </div>
                <div className="emoji-category-tabs icon-category-tabs" aria-label={t("customize.iconCatsAria")}>
                  <button type="button" className={iconCategory === "recent" ? "is-active" : ""} onClick={() => { setIconCategory("recent"); setIconQuery(""); }}>{t("customize.recent")}</button>
                  <button type="button" className={iconCategory === "all" ? "is-active" : ""} onClick={() => { setIconCategory("all"); setIconQuery(""); }}>{t("customize.all")}</button>
                  {iconCategories.map((category) => (
                    <button type="button" key={category.id} className={iconCategory === category.id ? "is-active" : ""} onClick={() => { setIconCategory(category.id); setIconQuery(""); }}>
                      {category.label}<small>{category.count}</small>
                    </button>
                  ))}
                </div>
                <VirtualAssetGrid
                  className="icon-virtual-grid"
                  items={iconItems}
                  minCellWidth={82}
                  rowHeight={62}
                  gap={5}
                  maxColumns={9}
                  height={276}
                  resetKey={`icon:${iconCategory}:${iconQuery}`}
                  emptyText={iconCategory === "recent" ? t("customize.emptyRecentIcon") : t("customize.emptyIcon")}
                  renderItem={(item) => (
                    <button type="button" title={`${item.label} · ${item.categoryLabel}`} className={icon === `icon:${item.id}` ? "is-selected" : ""} onClick={() => selectIcon(item)}>
                      <SpriteIcon id={item.id} color={iconColor} size={22} />
                      <span>{item.label}</span>
                    </button>
                  )}
                />
              </>
            )}

            {iconTab === "upload" && (
              <div className="icon-upload-panel">
                <div className="icon-upload-preview"><AppearanceGlyph icon={icon} color={iconColor} /></div>
                <div>
                  <strong>{t("customize.uploadIconTitle")}</strong>
                  <p>{t("customize.uploadIconDesc")}</p>
                  <label className="ghost-button upload-cover-button"><IconPhoto size={16} stroke={1.8} />{t("customize.chooseImage")}<input type="file" accept="image/*" onChange={(event) => uploadIcon(event.target.files?.[0])} /></label>
                </div>
              </div>
            )}
          </div>
        </section>}

        {!isIconMode && <section className="customize-section">
          <div className="customize-section-heading"><strong>{t("customize.pageCover")}</strong><span>{t("customize.coverMetaCount", { count: coverGallery.length })}</span></div>
          <div className="cover-picker-tabs" role="tablist" aria-label={t("customize.coverSourceAria")} onKeyDown={navigateChoiceGroup}>
            <button type="button" role="tab" tabIndex={coverTab === "gallery" ? 0 : -1} aria-selected={coverTab === "gallery"} className={coverTab === "gallery" ? "is-active" : ""} onClick={() => setCoverTab("gallery")}>{t("customize.gallery")}</button>
            <button type="button" role="tab" tabIndex={coverTab === "upload" ? 0 : -1} aria-selected={coverTab === "upload"} className={coverTab === "upload" ? "is-active" : ""} onClick={() => setCoverTab("upload")}>{t("customize.upload")}</button>
            {cover && <button type="button" className="cover-remove-tab" onClick={() => setCover(null)}>{t("customize.remove")}</button>}
          </div>

          {coverTab === "gallery" && (
            <div className="cover-gallery-browser">
              <div className="cover-search-row">
                <label className="icon-picker-search cover-picker-search">
                  <IconSearch size={16} stroke={1.7} />
                  <input ref={searchRef} value={coverQuery} onChange={(event) => setCoverQuery(event.target.value)} placeholder={t("customize.searchCoverPh")} />
                  {coverQuery ? <button type="button" aria-label={t("customize.clearCoverSearch")} onClick={() => setCoverQuery("")}><IconX size={14} stroke={1.8} /></button> : <span />}
                </label>
              </div>
              <div className="cover-gallery-groups">
                <button type="button" className={coverGroup === "recent" ? "is-active" : ""} onClick={() => { setCoverGroup("recent"); setCoverQuery(""); }}>{t("customize.recent")}</button>
                <button type="button" className={coverGroup === "favorites" ? "is-active" : ""} onClick={() => { setCoverGroup("favorites"); setCoverQuery(""); }}>{t("customize.favorites")}</button>
                {coverGalleryGroups.map((group) => (
                  <button type="button" key={group.id} className={coverGroup === group.id ? "is-active" : ""} onClick={() => { setCoverGroup(group.id); setCoverQuery(""); }}>{group.label}{group.count ? <small>{group.count}</small> : null}</button>
                ))}
              </div>
              <VirtualAssetGrid
                className="cover-virtual-grid"
                items={coverItems}
                minCellWidth={170}
                rowHeight={124}
                gap={8}
                maxColumns={4}
                height={344}
                resetKey={`cover:${coverGroup}:${coverQuery}`}
                emptyText={coverGroup === "favorites" ? t("customize.emptyFavCover") : coverGroup === "recent" ? t("customize.emptyRecentCover") : t("customize.emptyCover")}
                renderItem={(item) => (
                  <div className="art-cover-card">
                    <button type="button" title={`${item.title} · ${item.artist}`} className={`cover-choice art-cover-choice ${cover?.kind === "gallery" && cover.value === item.id ? "is-selected" : ""}`} onClick={() => selectCover(item)}>
                      <img src={item.thumbnailSrc || item.src} alt="" decoding="async" />
                      <span><strong>{item.artist}</strong><small>{item.title}</small></span>
                    </button>
                    <button
                      type="button"
                      className={`cover-favorite-button ${favoriteSet.has(item.id) ? "is-favorite" : ""}`}
                      aria-label={favoriteSet.has(item.id) ? t("customize.unfavoriteCover") : t("customize.favoriteCover")}
                      title={favoriteSet.has(item.id) ? t("customize.unfavoriteCover") : t("customize.favorites")}
                      onClick={() => {
                        const next = favoriteSet.has(item.id)
                          ? safePrefs.favoriteCoverIds.filter((id) => id !== item.id)
                          : [item.id, ...safePrefs.favoriteCoverIds];
                        updatePrefs({ favoriteCoverIds: next });
                      }}
                    >
                      <IconStar size={14} stroke={1.7} fill={favoriteSet.has(item.id) ? "currentColor" : "none"} />
                    </button>
                  </div>
                )}
              />
              <div className="cover-gallery-credit">{t("customize.coverCredit")}</div>
            </div>
          )}

          {coverTab === "upload" && (
            <div className="cover-upload-panel">
              <div className="cover-upload-preview" style={cover?.kind === "upload" ? coverStyle({ ...cover, value: coverUrl }) : undefined}>
                {cover?.kind !== "upload" && <IconPhoto size={28} stroke={1.5} />}
              </div>
              <div>
                <strong>{t("customize.uploadCoverTitle")}</strong>
                <p>{t("customize.uploadCoverDesc")}</p>
                <label className="ghost-button upload-cover-button"><IconPhoto size={16} stroke={1.8} />{t("customize.chooseImage")}<input type="file" accept="image/*" onChange={(event) => uploadCover(event.target.files?.[0])} /></label>
              </div>
            </div>
          )}

          {cover && (
            <label className="cover-position-control">
              <span>{t("customize.coverPosition")}</span>
              <input type="range" min="0" max="100" value={cover.position ?? 50} onChange={(event) => setCover((current) => ({ ...current, position: Number(event.target.value) }))} />
            </label>
          )}
        </section>}

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose} disabled={uploading}>{t("common.cancel")}</button>
          <button type="button" className="primary-button" onClick={() => onSave(isIconMode ? { icon, iconColor } : { cover })} disabled={uploading}>{isIconMode ? t("customize.saveIcon") : t("customize.saveCover")}</button>
        </div>
      </div>
    </div>
  );
}
