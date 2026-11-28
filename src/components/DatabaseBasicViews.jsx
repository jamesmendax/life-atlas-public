import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import IconChevronLeft from "@tabler/icons-react/dist/esm/icons/IconChevronLeft.mjs";
import IconChevronRight from "@tabler/icons-react/dist/esm/icons/IconChevronRight.mjs";
import IconDots from "@tabler/icons-react/dist/esm/icons/IconDots.mjs";
import IconPlus from "@tabler/icons-react/dist/esm/icons/IconPlus.mjs";
import { databaseItemPage, groupViewDateValue, groupViewItems, groupViewLabel, itemDisplayTitle, projectViewItems, resolveDisplayPropertyValue, resolvePropertyValue } from "../domain/database.js";
import { calendarDays, formatPropertyValue, isEmptyProperty, localDay, normalizeDate, normalizeIdValues } from "../domain/databaseProperties.js";
import { CALCULATIONS, normalizeViewConfig } from "../domain/viewRegistry.js";
import { BOARD_NUMBER_CALCULATIONS, boardStatisticProperties, computeBoardStatistic, resolveBoardStatistic } from "../domain/boardStatistics.js";
import { galleryCoverImage } from "../data/coverGallery.js";
import { boardCardAppearance } from "../domain/cardPreview.js";
import { appendCalendarMonth, calendarMonth, monthWindowDays, openCalendarMonthWindow } from "../domain/calendarMonthScroll.js";
import { computeColumnStat } from "../domain/databaseStats.js";
import { timelineLoadLimit, timelineSideColumns } from "../domain/timelineViewOptions.js";
import { canWriteSurfaceDate, resolveSurfaceDate, surfaceDateProperty } from "../domain/workSurfaceDates.js";
import { filterSubitems, subitemViewConfig } from "../domain/databaseSubitems.js";
import { OptionTag } from "./OptionPicker.jsx";
import { DatePicker } from "./DatePicker.jsx";
import { DatabasePopover } from "./DatabaseViewSettings.jsx";
import { AppearanceGlyph, SpriteIcon } from "./AppearanceGlyph.jsx";
import { DatabaseCardPreview } from "./DatabaseCardPreview.jsx";
import { DatabaseBoardCard } from "./DatabaseBoardCard.jsx";
import { CardSubitems, cardSubitemIndex, cardSubitemRows } from "./DatabaseStructureControls.jsx";
import { boardGroupValue } from "./databaseBoardInteractions.js";
import { leaveDatabaseItemDrop, markDatabaseItemDrop, startDatabaseItemDrag, takeDatabaseItemDrop } from "./databaseItemDrag.js";
import { Dialog } from "../ui/Dialog.jsx";

import { HOUR, axisTime, timelineDateChange, timelineDates } from "../domain/timelineDateFields.js";
import { DAY, dayMs, isoDay, resizeDate, scaleWindow, shiftDate, timelineTicks, timelineWindow } from "../domain/databaseDateRange.js";
import { useDatabasePointerCommit } from "./useDatabasePointerCommit.js";
import { DatabaseActionButton } from "./DatabaseActionControls.jsx";
import { renderFormulaResult } from "./formulaResult.js";
import { format, useI18n } from "../i18n/workspaceRuntime.js";

function CardPropertyValue({ workspace, source, item, property, value, runtime, locked }) {
  if (property.type === "button") return <DatabaseActionButton workspace={workspace} source={source} item={item} property={property} onRun={runtime?.runDatabaseAction} disabled={locked} />;
  if (property.type === "formula" || property.type === "rollup") return renderFormulaResult(workspace, property, value, source, runtime?.openPage) || "—";
  if (!["select", "multi_select", "status"].includes(property.type)) return formatPropertyValue(workspace, property, value) || "—";
  const ids = property.type === "multi_select" ? normalizeIdValues(value) : value ? [value] : [];
  if (!ids.length) return "—";
  return <span className="db-card-tags">{ids.map((id) => { const option = property.options?.find((entry) => entry.id === id); return <OptionTag key={id} choice={{ ...option, label: option?.name || String(id) }} status={property.type === "status"} />; })}</span>;
}

export { DatabaseList } from "./DatabaseList.jsx";

function GalleryPropertyValue(props) {
  const { t } = useI18n();
  const { workspace, property, value } = props;
  if (property.type === "checkbox") return <span className="db-gallery-checkbox" role="img" aria-label={value ? t("db.ui.checked") : t("db.ui.unchecked")} data-checked={String(Boolean(value))}>{value && <SpriteIcon id="check" size={12} />}</span>;
  if (["select", "multi_select", "status", "button", "formula", "rollup"].includes(property.type)) return <CardPropertyValue {...props} />;
  return formatPropertyValue(workspace, property, value);
}

export function DatabaseGallery({ workspace, source, view, items, onOpenItemPage, onCreateItem, onUpdateView, runtime }) {
  const { t } = useI18n();
  const config = normalizeViewConfig("gallery", view.config).gallery;
  const { display, filter } = subitemViewConfig(view);
  const scoped = filterSubitems(items, filter);
  const automatic = Boolean(view.sorts?.length);
  const canEdit = Boolean(onUpdateView && !runtime?.locked);
  const manual = Array.isArray(config.manualOrder) ? config.manualOrder : [];
  const rank = new Map(manual.map((id,index)=>[id,index]));
  const cards = automatic || !manual.length ? scoped : [...scoped].sort((a,b)=>(rank.get(a.id)??Infinity)-(rank.get(b.id)??Infinity));
  const groupPropertyId = view.grouping ? view.grouping.primaryPropertyId : view.groupBy;
  const groupProperty = source.properties.find((property) => property.id === groupPropertyId);
  const groups = groupProperty ? groupViewItems(workspace, view, cards) : null;
  const nestedCards = cardSubitemIndex(groups ? groups.flatMap((group) => group.items) : cards, display);
  const canPrefillGroup = ["select", "status", "multi_select", "people", "relation", "date"].includes(groupProperty?.type);
  const save = patch => { if (canEdit) onUpdateView(view.id,{config:{...view.config,gallery:{...config,...patch}}}); };
  const move = (id, targetId, groupCards) => {
    if (!canEdit || automatic || id===targetId || !groupCards.some(card=>card.id===id) || !groupCards.some(card=>card.id===targetId)) return;
    const all = projectViewItems(workspace,{...view,filter:null,sorts:[]}).map(item=>item.id);
    const currentIds = new Set(all);
    const order = [...new Set([...manual,...all])].filter(key=>currentIds.has(key));
    const target = order.indexOf(targetId);
    order.splice(order.indexOf(id),1);
    order.splice(target,0,id);
    save({manualOrder:order});
  };
  const summaryProps = config.visiblePropertyIds.map((id) => source.properties.find((property) => property.id === id)).filter((property) => property && property.type !== "title");
  const createPage = (event, groupKey) => {
    if (runtime?.locked || !onCreateItem) return;
    const options = groupKey !== null && canPrefillGroup
      ? { values: { [groupProperty.id]: groupProperty.type === "date" ? groupViewDateValue(view, groupKey) : boardGroupValue(groupProperty.type, groupKey) } }
      : {};
    const created = onCreateItem(source.id, options);
    if (created?.pageId) onOpenItemPage?.(created.pageId, event.currentTarget);
  };
  const renderCard = (item, subitems, index, groupCards, dragFormat) => {
    const page = databaseItemPage(workspace, item);
    const visibleProperties = summaryProps.map((property) => ({ property, value: resolveDisplayPropertyValue(workspace, source, item, property) })).filter(({ property, value }) => property.type === "button" || !isEmptyProperty(value));
    const focus = config.imagePositions?.[item.id];
    const position = focus?.y ?? (typeof focus==="number" ? focus : null) ?? (config.preview.kind==="page-cover" ? galleryCoverImage(page?.cover)?.position : 50) ?? 50;
    const positionX = focus?.x ?? 50;
    const positionChange = (axis,value) => save({imagePositions:{...config.imagePositions,[item.id]:{x:positionX,y:position,[axis]:Number(value)}}});
    return <article className="db-gallery-card" key={item.id} data-item-id={item.id} draggable={canEdit && !automatic} onDragStart={event=>{
      if (!startDatabaseItemDrag(event,item)) return;
      event.dataTransfer.setData(dragFormat, item.id);
    }} onDragOver={(event) => markDatabaseItemDrop(event, source.id, canEdit && !automatic && event.dataTransfer.types.includes(dragFormat))} onDragLeave={leaveDatabaseItemDrop} onDrop={(event) => {
      const id = takeDatabaseItemDrop(event, source.id, canEdit && !automatic && event.dataTransfer.types.includes(dragFormat));
      if (id) move(id, item.id, groupCards);
    }}>
      <button type="button" className="db-gallery-open" onClick={(event) => onOpenItemPage?.(item.pageId, event.currentTarget)}>
        <DatabaseCardPreview workspace={workspace} source={source} item={item} page={page} config={{...config,focusPosition:position,focusPositionX:positionX}} runtime={runtime} />
        <strong className="db-gallery-title">{view?.config?.showPageIcon !== false && <span className="db-gallery-title-icon" aria-hidden="true">{page?.icon ? <AppearanceGlyph icon={page.icon} color={page.iconColor} /> : <SpriteIcon id="file-description" size={16} />}</span>}<span className="db-gallery-title-text">{itemDisplayTitle(workspace, source, item)}</span></strong>
      </button>
      {canEdit && <details className="db-gallery-actions"><summary aria-label={t("dbx.gallery.cardActionsAria", { title: itemDisplayTitle(workspace,source,item) })} title={t("dbx.gallery.cardActionsTitle")}>⋯</summary><div>
        {!automatic && <><button disabled={!index} onClick={()=>move(item.id,groupCards[index-1]?.id,groupCards)}>{t("dbx.gallery.movePrev")}</button><button disabled={index===groupCards.length-1} onClick={()=>move(item.id,groupCards[index+1]?.id,groupCards)}>{t("dbx.gallery.moveNext")}</button></>}
        <label className="db-gallery-image-position">{t("dbx.gallery.horizPos")}<input type="range" aria-label={t("dbx.gallery.horizAria")} min="0" max="100" value={positionX} onChange={event=>positionChange("x",event.target.value)} /></label>
        <label className="db-gallery-image-position">{t("dbx.gallery.vertPos")}<input type="range" aria-label={t("dbx.gallery.vertAria")} min="0" max="100" value={position} onChange={event=>positionChange("y",event.target.value)} /></label>
        {automatic && <small>{t("dbx.gallery.sortedNote")}</small>}
      </div></details>}
      {visibleProperties.length > 0 && <div className="db-gallery-properties">{visibleProperties.map(({ property, value }) => <span key={property.id} data-property-id={property.id} title={property.name}><GalleryPropertyValue workspace={workspace} source={source} item={item} property={property} value={value} runtime={runtime} locked={Boolean(runtime?.locked || page?.settings?.locked)} /></span>)}</div>}
      <CardSubitems workspace={workspace} source={source} onOpenItemPage={onOpenItemPage}>{subitems}</CardSubitems>
    </article>;
  };
  const renderGrid = (groupCards, groupKey = null) => {
    const dragScope = new TextEncoder().encode(JSON.stringify([view.id, groupPropertyId, groupKey]));
    const dragFormat = `application/x-life-atlas-gallery-${dragScope.join(".")}`;
    const cardRows = cardSubitemRows(groupCards, nestedCards);
    const movableCards = cardRows.map(({ item }) => item);
    return <div className={`db-gallery-view size-${config.cardSize}`} data-card-size={config.cardSize}>
      {cardRows.map(({ item, subitems }, index) => renderCard(item, subitems, index, movableCards, dragFormat))}
      {!runtime?.locked && onCreateItem && (groupKey === null || canPrefillGroup) && <button type="button" className="db-gallery-create" aria-label={t("dbx.list.newPageBtn")} onClick={(event) => createPage(event, groupKey)}><IconPlus size={14} aria-hidden="true" />{t("dbx.list.newPageBtn")}</button>}
    </div>;
  };
  return <>
    {automatic && canEdit && <p className="db-gallery-sort-note">{t("dbx.gallery.sortedBanner")}</p>}
    {groups ? <div className="db-gallery-groups">
      {groups.map((group) => {
        const rawLabel = groupViewLabel(workspace, view, group.key);
        const label = rawLabel === "未分组" ? t("db.unassignedGroup") : rawLabel;
        return <section className="db-gallery-group" key={group.key} data-group-key={group.key} aria-label={label}>
          <h3 className="db-gallery-group-title">{label} <small>{group.items.length}</small></h3>
          {renderGrid(group.items, group.key)}
        </section>;
      })}
      {(!groups.length || !canPrefillGroup) && renderGrid([])}
    </div> : renderGrid(cards)}
  </>;
}

export function DatabaseBoard({ workspace, source, view, items, onOpenItemPage, onPeekItemPage, onCreateItem, onUpdateItemValue, onUpdateView, runtime }) {
  const { t } = useI18n();
  const { display, filter } = subitemViewConfig(view);
  const grouping = view.grouping || { primaryPropertyId: view.groupBy };
  const groupProperty = source.properties.find((property) => property.id === grouping.primaryPropertyId) || (!view.grouping && source.properties.find((property) => property.type === "status" || property.type === "select"));
  const effectiveView = { ...view, grouping: { ...(grouping || {}), primaryPropertyId: groupProperty?.id || null }, groupBy: groupProperty?.id || null };
  const groups = groupViewItems(workspace, effectiveView, filterSubitems(items, filter));
  if (!groups.length && !groupProperty) groups.push({ key: "未分组", items: [] });
  const nestedCards = cardSubitemIndex(groups.flatMap((group) => group.items), display);
  const options = groupProperty?.options || [];
  const secondary = source.properties.find(property => property.id === grouping.secondaryPropertyId && property.id !== groupProperty?.id);
  const secondaryOptions = secondary ? secondary.type === "people" ? (workspace.people || []).map(p=>({id:p.id,name:p.displayName})) : secondary.options || [] : null;
  const secondaryKeys = secondary ? [...new Set([...(grouping.showEmpty !== false ? secondaryOptions.map(o=>String(o.id)) : []), ...groups.flatMap(group => group.secondaryGroups.map(lane=>lane.key)), ...(grouping.showEmpty !== false ? ["未分组"] : [])])] : [];
  const pagesById = new Map((workspace.pages || []).map((page) => [page.id, page]));
  const isLocked = (item) => Boolean(runtime?.locked || pagesById.get(item?.pageId)?.settings?.locked);
  const propertyIds = view.visiblePropertyIds || source.properties.filter((property) => property.type !== "title" && property.id !== groupProperty?.id).slice(0, 3).map((property) => property.id);
  const cardProperties = propertyIds.map((id) => source.properties.find((property) => property.id === id)).filter((property) => property && property.type !== "title" && property.id !== groupProperty?.id);
  const [draft, setDraft] = useState(null);
  const [statDraft, setStatDraft] = useState(null);
  const statTrigger = useRef(null), statPropertyInput = useRef(null);
  const draftRef = useRef(null), draftInputRef = useRef(null), footerRefs = useRef(new Map());
  const boardRef = useRef(null), pointerCleanup = useRef(null);
  useLayoutEffect(() => {
    const board = boardRef.current;
    const frame = board.parentElement;
    const measure = () => {
      frame.dataset.overflowStart = String(board.scrollLeft > 1);
      frame.dataset.overflowEnd = String(board.scrollLeft + board.clientWidth < board.scrollWidth - 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    board.addEventListener("scroll", measure, { passive: true });
    return () => { observer.disconnect(); board.removeEventListener("scroll", measure); };
  }, [view.id, groups.length]);
  useEffect(() => () => pointerCleanup.current?.(), [source.id, view.id, runtime?.locked]);
  useEffect(() => { draftRef.current = null; setDraft(null); }, [source.id, view.id, runtime?.locked]);
  useEffect(() => setStatDraft(null), [source.id, view.id, runtime?.locked]);
  const updateDraft = (next) => { draftRef.current = next; setDraft(next); };
  const focusDraft = () => requestAnimationFrame(() => draftInputRef.current?.focus());
  const initialValues = key => groupProperty ? { [groupProperty.id]: groupProperty.type === "date"
    ? groupViewDateValue(effectiveView, key) : boardGroupValue(groupProperty.type, key) } : {};
  const commitDraft = (continueEditing) => {
    const current = draftRef.current;
    if (!current) return true;
    const title = current.title.trim();
    if (title && current.itemId) {
      const titleProperty = source.properties.find((property) => property.type === "title");
      if (titleProperty) onUpdateItemValue?.(current.itemId, titleProperty.id, title);
    } else if (title) {
      const created = onCreateItem?.(source.id, { title, values: initialValues(current.groupKey) });
      if (!created?.pageId) { updateDraft({ ...current, error: t("dbx.board.createFail") }); return false; }
    }
    if (continueEditing) {
      const created = onCreateItem?.(source.id, { values: initialValues(current.groupKey) });
      if (!created?.itemId || !created?.pageId) { updateDraft({ ...current, error: t("dbx.board.createFail") }); return false; }
      updateDraft({ groupKey: current.groupKey, itemId: created.itemId, pageId: created.pageId, title: "", error: "" });
    } else updateDraft(null);
    if (continueEditing) focusDraft();
    return true;
  };
  const startDraft = (groupKey) => {
    if (runtime?.locked || !onCreateItem) return;
    const current = draftRef.current;
    if (current?.groupKey === groupKey) { focusDraft(); return; }
    if (current && !commitDraft(false)) return;
    const created = onCreateItem(source.id, { values: initialValues(groupKey) });
    if (!created?.itemId || !created?.pageId) { updateDraft({ groupKey, title: "", error: t("dbx.board.createFail") }); focusDraft(); return; }
    updateDraft({ groupKey, itemId: created.itemId, pageId: created.pageId, title: "", error: "" });
    focusDraft();
  };
  const cancelDraft = () => {
    const current = draftRef.current;
    const groupKey = current?.groupKey;
    if (current?.itemId && !current.title.trim()) runtime?.trashDatabaseItems?.([current.itemId]);
    updateDraft(null);
    requestAnimationFrame(() => footerRefs.current.get(groupKey)?.focus());
  };
  const moveOptions = groupProperty?.type === "people" ? (workspace.people || []).map((person) => ({ id: person.id, name: person.displayName })) : options;
  const move = (itemId, key, origin, lane, laneOrigin) => {
    const item = workspace.databaseItems?.find(entry => entry.id === itemId && entry.sourceId === source.id);
    if (!item || isLocked(item)) return;
    const update = (property, destination, previous) => {
      if (!property || property.type === "date" || destination == null || destination === previous) return;
      const current = resolvePropertyValue(workspace, source, item, property);
      onUpdateItemValue?.(item.id, property.id, boardGroupValue(property.type, destination, current, previous));
    };
    update(groupProperty,key,origin);
    update(secondary,lane,laneOrigin);
  };
  const beginPointerMove = (event, itemId, origin, laneOrigin) => {
    if (runtime?.locked || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    pointerCleanup.current?.();
    const pointerId = event.pointerId;
    const cleanup = () => {
      pointerCleanup.current = null;
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cleanup);
    };
    const finish = (upEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      cleanup();
      const hit = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
      const target = hit?.closest(".db-board-column");
      if (target?.closest(".db-board-view") === boardRef.current) move(itemId,target.dataset.groupKey,origin,hit.closest(".db-board-lane")?.dataset.subgroupKey,laneOrigin);
    };
    const cancel = (cancelEvent) => { if (cancelEvent.pointerId === pointerId) cleanup(); };
    pointerCleanup.current = cleanup;
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cleanup);
  };
  const colorColumns = Boolean(view?.config?.board?.colorColumns);
  const wrapAllContent = Boolean(view?.config?.board?.wrapAllContent);
  const canDrop = !runtime?.locked && groupProperty && groupProperty.type !== "date" && onUpdateItemValue;
  const canEditStatistics = !runtime?.locked && Boolean(onUpdateView);
  const statistics = resolveBoardStatistic(source, view.config?.board?.columnStatistic);
  const titleProperty = source.properties.find((property) => property.type === "title");
  const openStatisticSettings = event => {
    const menu = event.currentTarget.closest("details");
    statTrigger.current = menu?.querySelector("summary") || event.currentTarget;
    if (menu) menu.open = false;
    setStatDraft({ propertyId: statistics.property?.id || null, calculation: statistics.calculation });
  };
  const saveStatisticSettings = () => {
    if (!canEditStatistics || !statDraft) return;
    const next = resolveBoardStatistic(source, statDraft);
    const columnStatistic = { propertyId: next.property?.id || null, calculation: next.calculation };
    onUpdateView(view.id, { config: { ...view.config, board: { ...view.config?.board, columnStatistic } } });
    setStatDraft(null);
  };
  const renderStatistic = (records, pendingCount) => {
    const { text } = computeBoardStatistic(workspace, source, records, statistics, pendingCount);
    const description = `${statistics.label} · ${text === "—" ? t("dbx.board.noValue") : text}`;
    return <small className="db-board-column-stat" data-calculation={statistics.calculation} title={description} aria-label={description}>{text}</small>;
  };
  const cardAppearance = boardCardAppearance(view.config?.board);
  return <><div className="db-board-scroll-frame" key={view.id}><div className="db-board-view" data-card-size={cardAppearance.cardSize} data-swimlanes={secondary ? "true" : undefined} style={secondary ? {"--board-lane-rows":secondaryKeys.length+3} : undefined} ref={boardRef} tabIndex={0} role="region" aria-label={t("dbx.board.aria")}>
    {!groups.length && canEditStatistics && <button type="button" className="mb-button" onClick={openStatisticSettings}>{t("db.ui.columnStat")}</button>}
    {groups.map((group) => {
    const rawLabel = groupViewLabel(workspace, effectiveView, group.key);
    const label = rawLabel === "未分组" ? t("db.unassignedGroup") : rawLabel;
    const option = options.find((entry) => entry.id === group.key);
    const isDraftGroup = draft?.groupKey === group.key;
    return <section className="db-board-column" key={group.key} data-group-key={group.key} data-group-color={option?.color || "default"} data-color-columns={colorColumns ? "true" : undefined}
      onDragOver={(event) => markDatabaseItemDrop(event, source.id, canDrop)}
      onDragLeave={leaveDatabaseItemDrop}
      onDrop={(event) => {
        const data = event.dataTransfer;
        const itemId = takeDatabaseItemDrop(event, source.id, canDrop);
        const origin = groupProperty?.id === data.getData("text/life-atlas-group-property") ? data.getData("text/life-atlas-group") : null;
        if (itemId) move(itemId, group.key, origin, event.target.closest(".db-board-lane")?.dataset.subgroupKey, data.getData("text/life-atlas-subgroup") || null);
      }}>
      <header>{option ? <OptionTag choice={{ ...option, label: option.name }} status={groupProperty.type === "status"} showStatusDot={false} /> : <span title={label}>{label}</span>}
        {renderStatistic(group.items, isDraftGroup && !group.items.some(item => item.id === draft.itemId) ? 1 : 0)}
        {!runtime?.locked && <div className="db-board-group-actions"><details className="db-board-group-menu" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}><summary aria-label={t("dbx.board.groupMenuAria", { label })} title={t("db.ui.groupMenu")}><IconDots size={16} aria-hidden="true" /></summary><div className="db-board-group-menu-panel">
          {canEditStatistics && <button type="button" onClick={openStatisticSettings}>{t("db.ui.columnStat")}</button>}
          <button type="button" onClick={(event) => { event.currentTarget.closest("details").open = false; startDraft(group.key); }}>{t("dbx.list.newPageBtn")}</button>{groupProperty && onUpdateView && <button type="button" onClick={(event) => { event.currentTarget.closest("details").open = false; onUpdateView(view.id, { grouping: { ...grouping, primaryPropertyId: groupProperty.id, hiddenGroupKeys: [...new Set([...(grouping.hiddenGroupKeys || []), group.key])] }, groupBy: groupProperty.id }); }}>{t("db.ui.hideGroup")}</button>}</div></details><button type="button" aria-label={t("dbx.board.addInGroupAria", { label })} title={t("db.ui.addPage")} onClick={() => startDraft(group.key)}><IconPlus size={15} aria-hidden="true" /></button></div>}
      </header>
      <div className={`db-board-cards ${wrapAllContent ? "is-wrapped" : ""}`}>{(() => {
        const renderCard = ({ item, subitems },subgroupKey) => {
        const page = pagesById.get(item.pageId);
        const title = itemDisplayTitle(workspace, source, item);
        const visibleProperties = cardProperties.map((property) => ({ property, value: resolveDisplayPropertyValue(workspace, source, item, property) })).filter(({ property, value }) => property.type === "button" || !isEmptyProperty(value));
        return <DatabaseBoardCard key={item.id} item={item} page={page} title={title} titleProperty={titleProperty} config={view.config} runtime={runtime}
          preview={<DatabaseCardPreview workspace={workspace} source={source} item={item} page={page} config={cardAppearance} runtime={runtime} surface="board" />}
          groupKey={group.key} subgroupKey={subgroupKey} subgroupOptions={secondaryOptions} onMoveSubgroup={key=>move(item.id,group.key,group.key,key,subgroupKey)} groupPropertyId={groupProperty?.id} moveOptions={canDrop ? moveOptions : null} onUpdateItemValue={onUpdateItemValue}
          onOpenItemPage={onOpenItemPage} onPeekItemPage={onPeekItemPage} onMove={move}
          onDragHandle={groupProperty?.type === "date" ? null : (event,id,origin)=>beginPointerMove(event,id,origin,subgroupKey)}>
          {visibleProperties.length > 0 && <div className="db-board-properties">{visibleProperties.map(({ property, value }) => <span key={property.id} title={property.name}><CardPropertyValue workspace={workspace} source={source} item={item} property={property} value={value} runtime={runtime} locked={Boolean(runtime?.locked || page?.settings?.locked)} /></span>)}</div>}
          <CardSubitems workspace={workspace} source={source} onOpenItemPage={onOpenItemPage}>{subitems}</CardSubitems>
        </DatabaseBoardCard>;
      };
        const renderLane = (records,key) => cardSubitemRows(records.filter(item=>item.id !== draft?.itemId), nestedCards).map(row=>renderCard(row,key));
        if (!secondary) return renderLane(group.items,null);
        return secondaryKeys.map(key => {
          const records = group.secondaryGroups.find(lane=>lane.key===key)?.items || [];
          const laneRaw = secondaryOptions.find(option=>String(option.id)===key)?.name || key;
          const laneLabel = laneRaw === "未分组" ? t("db.unassignedGroup") : laneRaw;
          return <section className="db-board-lane" key={key} data-subgroup-key={key} aria-label={label+" · "+laneLabel}><h4>{laneLabel}{renderStatistic(records)}</h4>{renderLane(records,key)}</section>;
        });
      })()}
      {isDraftGroup && <div className="db-board-card db-board-draft"><input ref={draftInputRef} aria-label={t("modal.pageTitleLabel")} placeholder={t("dbx.board.nameInputPh")} value={draft.title} onChange={(event) => updateDraft({ ...draftRef.current, title: event.target.value, error: "" })} onBlur={() => commitDraft(false)} onKeyDown={(event) => { event.stopPropagation(); if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return; if (event.key === "Enter") { event.preventDefault(); commitDraft(true); } else if (event.key === "Escape") { event.preventDefault(); cancelDraft(); } }} />{draft.error && <small role="alert">{draft.error}</small>}</div>}
      {!runtime?.locked && onCreateItem && <button ref={(element) => { if (element) footerRefs.current.set(group.key, element); else footerRefs.current.delete(group.key); }} type="button" className="db-board-new-page" aria-label={t("dbx.list.newPageBtn")} onClick={() => startDraft(group.key)}><IconPlus size={14} aria-hidden="true" />{t("dbx.list.newPageBtn")}</button>}
      </div>
    </section>;
  })}</div></div>
    {canEditStatistics && statDraft && <Dialog title={t("dbx.board.colStatTitle")} description={t("dbx.board.colStatDesc")} className="mb-confirm-dialog"
      initialFocusRef={statPropertyInput} restoreFocusRef={statTrigger} onClose={() => setStatDraft(null)}>
      <div className="mb-dialog-body mb-form-row">
        <label>{t("dbx.board.statProp")}<select ref={statPropertyInput} value={statDraft.propertyId || ""} onChange={event => {
          const propertyId = event.target.value || null;
          setStatDraft(current => ({ propertyId, calculation: propertyId ? (current.propertyId ? current.calculation : "sum") : "count_all" }));
        }}><option value="">{t("dbx.board.statCountAll")}</option>{boardStatisticProperties(source).map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>
        {statDraft.propertyId && <label>{t("dbx.board.statMethod")}<select value={statDraft.calculation} onChange={event => setStatDraft({ ...statDraft, calculation: event.target.value })}>
          {BOARD_NUMBER_CALCULATIONS.map(calculation => <option key={calculation} value={calculation}>{CALCULATIONS[calculation]}</option>)}
        </select></label>}
      </div>
      <footer className="mb-dialog-footer"><button type="button" className="mb-button" onClick={() => setStatDraft(null)}>{t("common.cancel")}</button><button type="button" className="mb-button mb-primary" onClick={saveStatisticSettings}>{t("dbx.board.apply")}</button></footer>
    </Dialog>}
  </>;
}

export function DatabaseCalendarUnscheduled({ workspace, source, view, items: projectedItems, onOpenItemPage, onUpdateItemValue, runtime }) {
  const { t } = useI18n();
  const { filter } = subitemViewConfig(view);
  const items = useMemo(() => filterSubitems(projectedItems, filter), [projectedItems, filter]);
  const triggerRef = useRef(null), searchRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const dateProperty = surfaceDateProperty(source, normalizeViewConfig("calendar", view.config).calendar.datePropertyId);
  const writable = canWriteSurfaceDate(dateProperty) && Boolean(onUpdateItemValue);
  const unscheduled = useMemo(() => {
    const now = Date.now();
    return items.filter(item => !resolveSurfaceDate(workspace, source, item, dateProperty, now));
  }, [workspace, source, items, dateProperty]);
  const visible = unscheduled.filter((item) => itemDisplayTitle(workspace, source, item).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const isLocked = (item) => Boolean(runtime?.locked || workspace.pages?.find((page) => page.id === item?.pageId)?.settings?.locked);
  const close = (restoreFocus = false) => {
    setOpen(false);
    setQuery("");
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  };
  return <><button ref={triggerRef} type="button" className="db-unscheduled-trigger" aria-label={t("db.ui.unscheduledCount", { count: unscheduled.length })} aria-haspopup="dialog" aria-expanded={open} onClick={() => { if (open) close(); else setOpen(true); }}>{t("db.ui.unscheduledCount", { count: unscheduled.length })}</button>
    {open && <DatabasePopover anchor={triggerRef.current} label={t("dbx.cal.panelLabel")} className="db-calendar-unscheduled-panel" onClose={close}>
      <input ref={searchRef} data-popover-initial type="search" className="db-unscheduled-search" aria-label={t("db.ui.unscheduledSearchAria")} placeholder={t("dbx.cal.searchPh")} value={query} onChange={(event) => setQuery(event.target.value)} />
      {visible.length ? visible.map((item) => {
        const title = itemDisplayTitle(workspace, source, item), page = databaseItemPage(workspace, item);
        const movable = writable && !isLocked(item);
        return <div className="db-unscheduled-row" key={item.id} draggable={movable} onDragStart={movable ? event => startDatabaseItemDrag(event, item) : undefined}>
          {view.config?.showPageIcon !== false && <span className="db-calendar-record-glyph" aria-hidden="true">{page?.icon ? <AppearanceGlyph icon={page.icon} color={page.iconColor} /> : <SpriteIcon id="file-description" size={15} />}</span>}<span className="db-unscheduled-title" title={title}>{title}</span>
          <button type="button" aria-label={t("dbx.cal.openItemAria", { title })} onClick={() => { const anchor = triggerRef.current; close(); onOpenItemPage?.(item.pageId, anchor); }}>{t("dbx.cal.openBtn")}</button>
          {writable && <DatePicker label={t("dbx.cal.setItemAria", { title })} value={null} disabled={isLocked(item)} onChange={(next) => {
            if (isLocked(item)) return;
            onUpdateItemValue?.(item.id, dateProperty.id, next);
            if (normalizeDate(next)?.start) requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
          }} />}
        </div>;
      }) : <p>{unscheduled.length ? t("db.ui.unscheduledNone") : t("db.ui.unscheduledEmpty")}</p>}
      {unscheduled.length > 0 && writable && <p className="db-unscheduled-hint">{t("db.ui.unscheduledHint")}</p>}
    </DatabasePopover>}</>;
}

export function DatabaseCalendar({ workspace, source, view, items: projectedItems, onOpenItemPage, onCreateItem, onUpdateItemValue, onUpdateView, runtime }) {
  const { locale, t } = useI18n();
  const { filter } = subitemViewConfig(view);
  const items = useMemo(() => filterSubitems(projectedItems, filter), [projectedItems, filter]);
  const normalized = normalizeViewConfig("calendar", view.config);
  const config = normalized.calendar;
  const dateProperty = surfaceDateProperty(source, config.datePropertyId);
  const writable = canWriteSurfaceDate(dateProperty);
  const itemDates = useMemo(() => {
    const now = Date.now();
    return new Map(items.map(item => [item.id, resolveSurfaceDate(workspace, source, item, dateProperty, now)]));
  }, [workspace, source, items, dateProperty]);
  const firstScheduled = [...itemDates.values()].find(Boolean)?.start.slice(0, 10);
  const canDrop = !runtime?.locked && writable && Boolean(onUpdateItemValue);
  const canCreateOnDay = !runtime?.locked && writable && Boolean(onCreateItem);
  const [localAnchor, setLocalAnchor] = useState(null);
  const anchor = (runtime?.locked ? localAnchor : null) || config.anchorDate || firstScheduled || localDay();
  const monthAnchor = calendarMonth(anchor) || calendarMonth(localDay());
  const monthMode = config.mode === "month";
  const [openMonth, setMonthWindow] = useState(() => openCalendarMonthWindow(monthAnchor));
  const [viewedMonth, setViewedMonth] = useState(monthAnchor);
  const calendarScroller = useRef(null);
  const scrollAnchor = useRef(null);
  const pendingScroll = useRef(null);
  const days = monthMode ? monthWindowDays(openMonth, config.startOfWeek) : calendarDays(anchor, config.startOfWeek, config.mode);
  const weekdayIndexes = Array.from({ length: 7 }, (_, index) => (config.startOfWeek + index) % 7).filter((day) => config.showWeekends || (day !== 0 && day !== 6));
  const visibleDays = days.filter((day) => config.showWeekends || ![0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay()));
  const firstVisibleInMonth = new Set(visibleDays.filter((day, index) => index === 0 || day.slice(0,7) !== visibleDays[index-1].slice(0,7)));
  useLayoutEffect(() => {
    if (scrollAnchor.current === monthAnchor) {
      scrollAnchor.current = null;
      return;
    }
    setMonthWindow(openCalendarMonthWindow(monthAnchor));
    setViewedMonth(monthAnchor);
    if (calendarScroller.current) calendarScroller.current.scrollTop = 0;
  }, [monthAnchor, monthMode, view.id]);
  useLayoutEffect(() => {
    const old = pendingScroll.current;
    if (!old) return;
    pendingScroll.current = null;
    const scroller = calendarScroller.current;
    const cell = scroller?.querySelector(`[data-date="${old.day}"]`);
    if (cell) scroller.scrollTop += cell.getBoundingClientRect().top - old.top;
  }, [openMonth]);
  const isLocked = (item) => Boolean(runtime?.locked || workspace.pages?.find((page) => page.id === item?.pageId)?.settings?.locked);
  const updateConfig = (patch) => {
    if (runtime?.locked) setLocalAnchor(patch.anchorDate);
    else onUpdateView?.(view.id, { config: { ...normalized, calendar: { ...config, ...patch } } });
  };
  const scrollMonths = event => {
    if (!monthMode) return;
    const scroller = event.currentTarget;
    const top = scroller.getBoundingClientRect().top;
    const markers = [...scroller.querySelectorAll("[data-month-start]")];
    const current = markers.findLast(mark => mark.dataset.monthStart <= openMonth.end && mark.getBoundingClientRect().top <= top + 30)?.dataset.monthStart;
    const visible = current && current >= openMonth.start ? current : openMonth.start;
    if (visible !== viewedMonth) {
      setViewedMonth(visible);
      if (onUpdateView && !runtime?.locked && visible !== monthAnchor) {
        scrollAnchor.current = visible;
        updateConfig({ anchorDate: visible });
      }
    }
    const wheelDistance = event.type === "wheel"
      ? event.deltaY * (event.deltaMode === 1 ? 22 : event.deltaMode === 2 ? scroller.clientHeight : 1)
      : 0;
    if (scroller.scrollTop + wheelDistance <= 0 || scroller.scrollTop + scroller.clientHeight + wheelDistance < scroller.scrollHeight - 100) return;
    if (pendingScroll.current) return;
    const next = appendCalendarMonth(openMonth);
    const first = monthWindowDays(next, config.startOfWeek).find(day => !config.showWeekends ? ![0,6].includes(new Date(dayMs(day)).getUTCDay()) : true);
    const retained = scroller.querySelector(`[data-date="${first}"]`);
    if (retained) pendingScroll.current = { day: first, top: retained.getBoundingClientRect().top };
    setMonthWindow(next);
  };
  const moveTo = (item, target) => {
    if (!canDrop || isLocked(item) || !Number.isFinite(dayMs(target))) return;
    const current = itemDates.get(item.id);
    if (!current?.start) onUpdateItemValue?.(item.id, dateProperty.id, { start:target, end:null, includeTime:false, timeZone:null });
    else onUpdateItemValue?.(item.id, dateProperty.id, shiftDate(current, Math.round((dayMs(target) - dayMs(current.start)) / DAY)));
  };
  const updateDate = (item, next) => {
    if (!canDrop || isLocked(item)) return;
    const current = itemDates.get(item.id);
    if (current?.start && next?.start && current.start.slice(0, 10) !== next.start.slice(0, 10)) {
      moveTo(item, next.start.slice(0, 10));
    } else onUpdateItemValue?.(item.id, dateProperty.id, next);
  };
  const createOnDay = (day) => {
    if (!canCreateOnDay) return;
    const created = onCreateItem(source.id, { values: { [dateProperty.id]: { start: day, end: null, includeTime: false, timeZone: null } } });
    if (created?.pageId) onOpenItemPage?.(created.pageId);
  };
  const pointer = useDatabasePointerCommit(view.id);
  const dateGesture = (event, item, edge) => {
    if (!canDrop || isLocked(item)) return;
    const calendar = event.currentTarget.closest(".db-calendar-workspace");
    pointer(event, release => {
      const cell = document.elementFromPoint(release.clientX, release.clientY)?.closest(".db-calendar-cell");
      if (cell?.closest(".db-calendar-workspace") !== calendar) return;
      if (edge) {
        const date = itemDates.get(item.id);
        if (cell.dataset.date !== (date[edge] || date.start).slice(0, 10)) updateDateEdge(item, edge, cell.dataset.date);
      } else moveTo(item, cell.dataset.date);
    });
  };
  const updateDateEdge = (item, edge, target) => {
    if (canDrop && !isLocked(item)) onUpdateItemValue(item.id, dateProperty.id, resizeDate(itemDates.get(item.id), edge, target));
  };
  const edgeControl = (item, edge, title, day) => canDrop && <button type="button" className={"db-cal-range-edge edge-"+edge} disabled={isLocked(item)}
    aria-label={t(edge === "start" ? "dbx.cal.adjustStartAria" : "dbx.cal.adjustEndAria", { title })} title={t("dbx.cal.adjustEdgeTitle")}
    onPointerDown={event => dateGesture(event,item,edge)} onKeyDown={event => {
      if (!["ArrowLeft","ArrowRight"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); updateDateEdge(item,edge,isoDay(dayMs(day)+(event.key === "ArrowLeft" ? -DAY : DAY)));
    }}>{edge === "start" ? "‹" : "›"}</button>;
  const jump = (day) => {
    if (monthMode) {
      const month = calendarMonth(day);
      pendingScroll.current = null;
      setMonthWindow(openCalendarMonthWindow(month));
      setViewedMonth(month);
      if (calendarScroller.current) calendarScroller.current.scrollTop = 0;
    }
    updateConfig({anchorDate:day});
  };
  const navigate = (delta) => {
    const d = new Date(`${monthMode ? viewedMonth : anchor}T00:00:00Z`);
    if (config.mode === "week") d.setUTCDate(d.getUTCDate() + delta * 7);
    else { d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + delta); }
    jump(isoDay(d.getTime()));
  };
  return <div className="db-calendar-workspace">
    <div className="db-calendar-toolbar"><strong>{config.mode === "week" ? `${days[0]} — ${days[6]}` : t("dbx.cal.monthYear", { year: Number(viewedMonth.slice(0,4)), month: Number(viewedMonth.slice(5,7)) })}</strong>
      <div className="db-calendar-toolbar-actions">
        <button type="button" aria-label={t("db.ui.prevPeriod")} title={t("db.ui.prevPeriod")} onClick={() => navigate(-1)}><IconChevronLeft size={15} aria-hidden="true" /></button><button type="button" onClick={() => jump(localDay())}>{t("db.ui.today")}</button><button type="button" aria-label={t("db.ui.nextPeriod")} title={t("db.ui.nextPeriod")} onClick={() => navigate(1)}><IconChevronRight size={15} aria-hidden="true" /></button>
      </div>
    </div>
    <div className="db-calendar-scroller" data-scroll-months={monthMode || undefined} ref={calendarScroller} onScroll={scrollMonths}
      onWheel={event => { if (event.deltaY > Math.abs(event.deltaX) && !event.shiftKey) scrollMonths(event); }}
      tabIndex={monthMode ? 0 : undefined} role={monthMode ? "region" : undefined} aria-label={monthMode ? t("dbx.cal.scrollAria") : undefined}><div className="db-calendar-weekdays" data-weekends={String(config.showWeekends)} aria-hidden="true">{weekdayIndexes.map((day) => <span key={day} data-weekend={String(day === 0 || day === 6)}>{format.formatWeekday(day, locale, "short")}</span>)}</div>
    <div className={`db-calendar-grid mode-${config.mode}`} data-weekends={String(config.showWeekends)} role="grid" aria-label={t("dbx.cal.calAria")}>{visibleDays.map((day) => {
      const records = items.filter(item => { const date = itemDates.get(item.id); return date?.start && date.start.slice(0,10) <= day && (date.end || date.start).slice(0,10) >= day; });
      const date = new Date(`${day}T00:00:00Z`);
      const outside = monthMode && (day.slice(0,7) < openMonth.start.slice(0,7) || day.slice(0,7) > openMonth.end.slice(0,7));
      const isToday = day === localDay();
      const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
      const monthStart = monthMode && firstVisibleInMonth.has(day) && date.getUTCDate() <= 3 ? calendarMonth(day) : null;
      return <section className={`db-calendar-cell ${outside ? "is-outside" : ""}${isToday ? " is-today" : ""}${weekend ? " is-weekend" : ""}`} aria-current={isToday ? "date" : undefined} role="gridcell" tabIndex={0} aria-label={day} data-date={day} data-weekend={String(weekend)} key={day}
        data-month-start={monthStart || undefined}
        onKeyDown={(event) => { event.stopPropagation(); if (canCreateOnDay && event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); createOnDay(day); } }}
        onDragOver={(event) => markDatabaseItemDrop(event, source.id, canDrop)} onDragLeave={leaveDatabaseItemDrop} onDrop={(event) => {
          const itemId = takeDatabaseItemDrop(event, source.id, canDrop);
          const item = items.find((entry) => entry.id === itemId);
          if (item) moveTo(item, day);
        }}>
        <header>{canCreateOnDay && <button type="button" className="db-calendar-add" aria-label={t("dbx.cal.addOnDayAria", { day })} title={t("dbx.list.newPageBtn")} onClick={() => createOnDay(day)}><IconPlus size={15} aria-hidden="true" /></button>}<span className="db-calendar-date">{(date.getUTCDate() === 1 || monthStart) && <span className="db-calendar-month-label">{t("dbx.cal.monthShort", { month: date.getUTCMonth() + 1 })}</span>}<time dateTime={day}>{date.getUTCDate()}</time></span></header>
        {records.map((item) => { const title = itemDisplayTitle(workspace, source, item); const page = databaseItemPage(workspace, item); const date = itemDates.get(item.id), first = date.start.slice(0,10) === day, last = (date.end || date.start).slice(0,10) === day;
          if (!first) return <article key={item.id} className="db-calendar-span" data-item-id={item.id}><button className="db-calendar-continuation" onClick={event=>onOpenItemPage?.(item.pageId,event.currentTarget)} title={title}>{title}</button>{last && edgeControl(item,"end",title,day)}</article>;
          const movable = canDrop && !isLocked(item);
          return <article className="db-calendar-chip" key={item.id} data-item-id={item.id} draggable={movable} onDragStart={movable ? event => startDatabaseItemDrag(event, item) : undefined}>
          {edgeControl(item,"start",title,day)}
          {canDrop && <button type="button" className="db-drag-handle" disabled={isLocked(item)} aria-label={t("dbx.cal.dragToDayAria", { title })} onPointerDown={(event)=>dateGesture(event,item)}>⋮⋮</button>}
          <button type="button" className="db-calendar-record" title={title} onClick={(event) => onOpenItemPage?.(item.pageId, event.currentTarget)}>{view.config?.showPageIcon !== false && <span className="db-calendar-record-glyph" aria-hidden="true">{page?.icon ? <AppearanceGlyph icon={page.icon} color={page.iconColor} /> : <SpriteIcon id="file-description" size={15} />}</span>}<span className="db-calendar-record-title">{title}</span></button>
          {last && edgeControl(item,"end",title,day)}
          {movable && <DatePicker label={t("dbx.cal.moveItemAria", { title })} triggerContent={<SpriteIcon id="calendar" size={15} />} value={itemDates.get(item.id)} onChange={(next) => updateDate(item, next)} />}
        </article>; })}
      </section>;
    })}</div></div>
  </div>;
}

export function DatabaseTimeline({ workspace, source, view, items, onOpenItemPage, onUpdateItemValue, onUpdateView, runtime }) {
  const { t } = useI18n();
  const normalized = normalizeViewConfig("timeline", view.config);
  const config = normalized.timeline;
  const pointer = useDatabasePointerCommit(view.id);
  const [notice,setNotice] = useState("");
  const [loaded, setLoaded] = useState({ key: null, extra: 0 });
  const dateProperty = surfaceDateProperty(source, config.datePropertyId);
  const separateEnd = Boolean(config.endDatePropertyId && config.endDatePropertyId !== dateProperty?.id);
  const endProperty = separateEnd ? surfaceDateProperty(source, config.endDatePropertyId) : null;
  const dates = useMemo(() => {
    const now = Date.now();
    return new Map(items.map(item => [item.id, timelineDates(
      resolveSurfaceDate(workspace, source, item, dateProperty, now),
      resolveSurfaceDate(workspace, source, item, endProperty, now), separateEnd,
    )]));
  }, [workspace, source, items, dateProperty, endProperty, separateEnd]);
  if (!dateProperty) return <p className="db-surface-message">{config.datePropertyId ? t("dbx.tl.missingSelectedProp") : t("dbx.tl.addDatePropHint")}</p>;
  const pages = new Map(workspace.pages.map(page => [page.id, page]));
  const writeStart = canWriteSurfaceDate(dateProperty);
  const writeEnd = separateEnd ? canWriteSurfaceDate(endProperty) : writeStart;
  const movable = writeStart && writeEnd;
  const hourly = config.scale === "hour";
  const step = hourly ? HOUR : DAY;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const axis = (stamp,timeZone) => hourly ? axisTime(stamp,timeZone,zone) : dayMs(stamp);
  const range = timelineWindow([...dates.values()], config);
  const duration = range.end - range.start;
  const locked = item => !onUpdateItemValue || runtime?.locked || pages.get(item.pageId)?.settings?.locked;
  const canChange = (item, edge) => !locked(item) && (edge === "start" ? writeStart : edge === "end" ? writeEnd : movable);
  const patch = values => onUpdateView?.(view.id, { config: { ...normalized, timeline: { ...config, ...values } } });
  const change = (item,edge,delta) => {
    if (!canChange(item, edge)) return;
    const now = Date.now();
    const startValue = resolveSurfaceDate(workspace, source, item, dateProperty, now);
    const endValue = resolveSurfaceDate(workspace, source, item, endProperty, now);
    const changed = timelineDateChange(startValue, endValue, separateEnd, edge, delta, hourly ? "hour" : "day");
    if (changed.error) {setNotice(changed.error);return;}
    if ((changed.start && !writeStart) || (changed.end && !writeEnd)) return;
    setNotice("");
    const fields = {}, expected = {};
    if (writeStart) expected[dateProperty.id] = item.values[dateProperty.id];
    if (separateEnd && writeEnd) expected[endProperty.id] = item.values[endProperty.id];
    if (changed.start) fields[dateProperty.id]=changed.start;
    if (changed.end && endProperty) fields[endProperty.id]=changed.end;
    if (runtime?.updateDatabaseDateFields && Object.keys(fields).length) runtime.updateDatabaseDateFields(item.id,fields,expected);
    else for (const [id,value] of Object.entries(fields)) onUpdateItemValue?.(item.id,id,value);
  };
  const begin = (event, item, edge) => {
    if (!canChange(item, edge || "move")) return;
    const track = event.currentTarget.closest(".db-timeline-track");
    const from = event.clientX;
    const width = Math.max(1, track.getBoundingClientRect().width);
    pointer(event, release => {
      const delta = Math.round((release.clientX - from) / width * duration / step);
      if (delta) change(item,edge || "move",delta);
    });
  };
  const keys = (event, item, edge) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault(); event.stopPropagation();
    change(item, edge, event.key === "ArrowLeft" ? -1 : 1);
  };
  const pageWindow = delta => patch({ windowStart: isoDay(range.start + delta * duration), windowEnd: isoDay(range.end - DAY + delta * duration) });
  const ticks = timelineTicks(range, config.scale);
  const today = dayMs(localDay());
  const showTable = config.showTable === true;
  const columns = timelineSideColumns(source, config);
  const titleField = columns.find(property => property.type === "title");
  const dataColumns = columns.filter(property => property.type !== "title");
  const limit = timelineLoadLimit(config.loadLimit);
  const loadingKey = `${view.id}:${limit}`;
  const capacity = limit == null ? Infinity : limit + (loaded.key === loadingKey ? loaded.extra : 0);
  const barPositions = new Map();
  for (const item of items) {
    const date = dates.get(item.id);
    if (!date?.start) continue;
    const start = axis(date.start,date.timeZone);
    const finish = axis(date.end || date.start,date.end ? date.endZone : date.timeZone);
    const end = hourly && date.start.includes("T") ? Math.max(start+HOUR/12,finish) : finish+DAY;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= range.start || start >= range.end) continue;
    barPositions.set(item.id, {
      left: Math.max(0, (start-range.start)/duration*100),
      width: (Math.min(end,range.end)-Math.max(start,range.start))/duration*100,
    });
  }
  const scoped = showTable ? items : items.filter(item => barPositions.has(item.id) || !dates.get(item.id)?.start);
  const displayed = scoped.slice(0, capacity);
  const dataCell = (item, property) => {
    const value = resolvePropertyValue(workspace, source, item, property);
    return property.type === "checkbox" ? value ? t("db.ui.checked") : t("db.ui.unchecked") : formatPropertyValue(workspace, property, value) || "—";
  };
  function statistic(property) {
    if (!property) return null;
    const calculation = config.tableCalculations?.[property.id];
    return calculation && calculation !== "none" ? <><span>{CALCULATIONS[calculation]}</span> <strong>{computeColumnStat(workspace,source,items,property,calculation).text || "—"}</strong></> : null;
  }
  return <div className="db-timeline-workspace">
    <div className="db-timeline-toolbar">{onUpdateView && !runtime?.locked && <button type="button" className="db-timeline-table-toggle" aria-pressed={showTable} onClick={()=>patch({showTable:!showTable})}>{showTable ? t("db.ui.hideSideTable") : t("db.ui.showSideTable")}</button>}<label>{t("dbx.tl.scaleLabel")}<select aria-label={t("dbx.tl.scaleAria")} value={config.scale} onChange={event => patch({ scale: event.target.value, ...scaleWindow(event.target.value, range.start + duration / 2) })}>{["hour","day","week","month","quarter","year"].map((id) => <option key={id} value={id}>{t(`dbx.tl.scale.${id}`)}</option>)}</select></label><button aria-label={t("dbx.tl.prevRange")} onClick={() => pageWindow(-1)}>‹</button><span>{isoDay(range.start)} — {isoDay(range.end-DAY)}</span>{hourly && <small>{zone}</small>}<input type="date" aria-label={t("dbx.tl.jumpDateAria")} value={isoDay(range.start+duration/2)} onChange={event=>{if(event.target.value)patch(scaleWindow(config.scale,dayMs(event.target.value)+DAY/2));}} /><button aria-label={t("dbx.tl.nextRange")} onClick={() => pageWindow(1)}>›</button></div>
    {notice && <p className="db-surface-message" role="status">{notice}</p>}
    <div className="db-timeline-scroll"><div className="db-timeline-view" data-scale={config.scale} data-side-table={showTable || undefined} role={showTable ? "table" : undefined} aria-label={showTable ? t("dbx.tl.withSideAria") : undefined}
      style={showTable ? {"--db-timeline-side-width":160 + 112*dataColumns.length+"px","--db-timeline-columns":["160px", ...dataColumns.map(()=>"112px")].join(" ")} : undefined}><div className="db-timeline-axis">{ticks.map(tick => <span key={tick.ms} style={{left: tick.left + "%"}}><time dateTime={isoDay(tick.ms)}>{tick.label}</time></span>)}{config.showToday && today >= range.start && today < range.end && <i className="db-timeline-today" aria-label={t("db.ui.today")} style={{ left:(today-range.start)/duration*100+"%" }} />}</div>
      {showTable && <div className="db-timeline-row db-timeline-side-header" role="row"><div className="db-timeline-side" role="presentation"><span role="columnheader">{titleField?.name || t("db.prop.title")}</span>{dataColumns.map(property=><span role="columnheader" key={property.id} title={property.name}>{property.name}</span>)}</div><span className="db-v9-sr-only" role="columnheader">{t("dbx.tl.dateRangeCol")}</span></div>}
      {displayed.map(item => {
        const date = dates.get(item.id);
        const bar = barPositions.get(item.id);
        if (!showTable && !bar) return null;
        const title = itemDisplayTitle(workspace,source,item);
        const barDates = bar ? date.start + (date.end ? " → " + date.end : "") : null;
        const disabled = Boolean(locked(item));
        const drag = movable && !disabled;
        const label = <button className="db-timeline-label" onClick={event => onOpenItemPage?.(item.pageId,event.currentTarget)}>{title}</button>;
        return <div className="db-timeline-row" role={showTable ? "row" : undefined} data-timeline-item={item.id} key={item.id}>
          {showTable ? <div className="db-timeline-side" role="presentation"><span role="cell">{label}</span>{dataColumns.map(property=>{
            const value = dataCell(item,property);
            return <span key={property.id} role="cell" data-property-id={property.id} title={value}>{value}</span>;
          })}</div> : label}
          <div className="db-timeline-track" role={showTable ? "cell" : undefined} onDragOver={event=>markDatabaseItemDrop(event,source.id,movable && !runtime?.locked && Boolean(onUpdateItemValue))} onDragLeave={leaveDatabaseItemDrop} onDrop={event=>{
            const id=takeDatabaseItemDrop(event,source.id,movable && !runtime?.locked), moving=items.find(i=>i.id===id);
            if (!moving || !canChange(moving, "move") || !dates.get(id)?.start) return;
            const rect=event.currentTarget.getBoundingClientRect(), target=range.start+(event.clientX-rect.left)/Math.max(1,rect.width)*duration;
            change(moving,"move",Math.round((target-axis(dates.get(id).start,dates.get(id).timeZone))/step));
          }}>{bar && <div className="db-timeline-bar" data-item-id={item.id} role="group" aria-label={title+"，"+barDates} title={barDates}
            style={{left:bar.left+"%", width:bar.width+"%"}} draggable={drag} onDragStart={drag ? event => startDatabaseItemDrag(event,item) : undefined}>
            {writeStart && <button className="db-timeline-resize-start" disabled={disabled} aria-label={t("dbx.cal.adjustStartAria", { title })} onPointerDown={e=>begin(e,item,"start")} onKeyDown={e=>keys(e,item,"start")}>↔</button>}
            {movable && <><button className="db-drag-handle" disabled={disabled} aria-label={t("dbx.tl.dragTimeAria", { title })} onPointerDown={e=>begin(e,item)}>⋮⋮</button><button disabled={disabled} aria-label={t(hourly ? "dbx.tl.moveBackHour" : "dbx.tl.moveBackDay", { title })} onClick={()=>change(item,"move",-1)}>‹</button></>}
            <span aria-hidden="true">{date.start.slice(0,hourly ? 16 : 10).replace("T"," ")}{date.end ? " → "+date.end.slice(0,hourly ? 16 : 10).replace("T"," ") : ""}</span>
            {movable && <button disabled={disabled} aria-label={t(hourly ? "dbx.tl.moveFwdHour" : "dbx.tl.moveFwdDay", { title })} onClick={()=>change(item,"move",1)}>›</button>}
            {writeEnd && <button className="db-timeline-resize" disabled={disabled} aria-label={t("dbx.cal.adjustEndAria", { title })} onPointerDown={e=>begin(e,item,"end")} onKeyDown={e=>keys(e,item,"end")}>↔</button>}
          </div>}</div></div>;
      })}
      {showTable && columns.some(property => config.tableCalculations?.[property.id] && config.tableCalculations[property.id] !== "none") &&
        <div className="db-timeline-row db-timeline-side-footer" role="row"><div className="db-timeline-side" role="presentation"><span role="cell">{statistic(titleField)}</span>{dataColumns.map(property=><span key={property.id} role="cell" data-calculation-for={property.id}>{statistic(property)}</span>)}</div><span role="cell" /></div>}
    </div></div>
    {!showTable && <aside className="db-unscheduled"><strong>{t("db.ui.unscheduled")}</strong>{displayed.filter(item => !dates.get(item.id)?.start).map(item => <button key={item.id} onClick={() => onOpenItemPage?.(item.pageId)}>{itemDisplayTitle(workspace,source,item)}</button>)}</aside>}
    {displayed.length < scoped.length && <button type="button" className="db-timeline-load-more" onClick={()=>setLoaded({key:loadingKey,extra:capacity})}>{t("db.ui.loadMore", { shown: displayed.length, total: scoped.length })}</button>}
  </div>;
}
