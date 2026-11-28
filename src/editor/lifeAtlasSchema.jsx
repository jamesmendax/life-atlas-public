import { useContext, useState } from "react";
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultProps,
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
} from "@blocknote/core";
import { SuggestionMenu } from "@blocknote/core/extensions";
import { closeHistory } from "@tiptap/pm/history";
import { lifeAtlasCodeBlockSpec } from "./codeBlockSpec.js";
import katex from "katex";
import {
  createReactBlockSpec,
  getDefaultReactSlashMenuItems,
  useEditorSelectionChange,
  useEditorState,
} from "@blocknote/react";
import IconBlockquote from "@tabler/icons-react/dist/esm/icons/IconBlockquote.mjs";
import IconBrandDatabricks from "@tabler/icons-react/dist/esm/icons/IconBrandDatabricks.mjs";
import IconChartBar from "@tabler/icons-react/dist/esm/icons/IconChartBar.mjs";
import IconColumns2 from "@tabler/icons-react/dist/esm/icons/IconColumns2.mjs";
import IconColumns3 from "@tabler/icons-react/dist/esm/icons/IconColumns3.mjs";
import IconColumns from "@tabler/icons-react/dist/esm/icons/IconColumns.mjs";
import IconDatabase from "@tabler/icons-react/dist/esm/icons/IconDatabase.mjs";
import IconFileTypePdf from "@tabler/icons-react/dist/esm/icons/IconFileTypePdf.mjs";
import IconFolderSymlink from "@tabler/icons-react/dist/esm/icons/IconFolderSymlink.mjs";
import IconForms from "@tabler/icons-react/dist/esm/icons/IconForms.mjs";
import IconLayoutDashboard from "@tabler/icons-react/dist/esm/icons/IconLayoutDashboard.mjs";
import IconLink from "@tabler/icons-react/dist/esm/icons/IconLink.mjs";
import IconListDetails from "@tabler/icons-react/dist/esm/icons/IconListDetails.mjs";
import IconMath from "@tabler/icons-react/dist/esm/icons/IconMath.mjs";
import IconPageBreak from "@tabler/icons-react/dist/esm/icons/IconPageBreak.mjs";
import IconTable from "@tabler/icons-react/dist/esm/icons/IconTable.mjs";
import IconTopologyStar3 from "@tabler/icons-react/dist/esm/icons/IconTopologyStar3.mjs";
import IconAt from "@tabler/icons-react/dist/esm/icons/IconAt.mjs";
import IconTimeline from "@tabler/icons-react/dist/esm/icons/IconTimeline.mjs";
import { DatabaseView } from "../components/DatabaseView.jsx";
import { serializeDatabaseOccurrenceSourceIds, serializeDatabaseOccurrenceViewIds } from "../domain/databaseOccurrenceViews.js";
import { LifeAtlasEditorRuntimeContext } from "./EditorRuntime.jsx";
import { TabsHeader, TabPanelMarker, SyncedContentReference } from "./EditorContainers.jsx";
import { PageMention, UserMention, DateMention, getMentionMenuItems } from "./Mentions.jsx";
import { createTabsDocument, walkBlocks } from "../domain/blockDocument.js";
import { revealEditorBlock } from "./revealEditorBlock.js";
import { projectEditorialSection } from "../domain/editorialSections.js";
import { useDialogs } from "../ui/DialogProvider.jsx";
import { localMediaBlockSpecs } from "./LocalMediaBlocks.jsx";
import { createLifeAtlasTableSpec } from "./simpleTableCells.js";
import { MarketComponentBlock } from "./MarketComponentBlock.jsx";
import { ActionButtonBlock } from "./ActionButtonBlock.jsx";
import { InlineEquation } from "./InlineEquation.jsx";
import { getSlashMenuCatalog, SLASH_MARKDOWN_HINTS } from "./slashMenuCatalog.js";
import { tWorkspace } from "../i18n/workspaceRuntime.js";
import { isRemoteUrl, remotePlaceholderDataUrl } from "./remoteMedia.js";
import { ColumnLayout, ColumnListLayout } from "./ColumnLayout.jsx";
export { LifeAtlasEditorRuntimeContext } from "./EditorRuntime.jsx";

function inlineText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((entry) => {
    if (typeof entry === "string") return entry;
    if (typeof entry?.text === "string") return entry.text;
    return inlineText(entry?.content);
  }).join("");
}

const CalloutBlock = createReactBlockSpec(
  {
    type: "callout",
    propSchema: {
      ...defaultProps,
      icon: { default: "💡" },
      tone: { default: "neutral", values: ["neutral", "gray", "brown", "blue", "yellow", "red", "green"] },
    },
    content: "inline",
  },
  {
    render: ({ block, contentRef, editor }) => {
      const dialogs = useDialogs();
      return (
      <div className={`life-callout life-callout-${block.props.tone}`} data-callout-icon={block.props.icon ? "present" : "none"}>
        <button
          type="button"
          className="life-callout-icon"
          aria-label={block.props.icon ? "编辑 Callout 图标" : "添加 Callout 图标"}
          contentEditable={false}
          disabled={!editor.isEditable}
          onClick={async () => {
            const icon = await dialogs.promptText({ title: "Callout 图标", initialValue: block.props.icon ?? "💡" });
            if (icon !== null) editor.updateBlock(block, { props: { icon: icon.trim().slice(0, 8) } });
          }}
        >
          {block.props.icon}
        </button>
        <div className="life-callout-content" ref={contentRef} />
      </div>
      );
    },
  },
);


function EditorialCardView({ imageUrl, eyebrow, title, excerpt, pageId = "", layout = "card" }) {
  const runtime = useContext(LifeAtlasEditorRuntimeContext);
  const Wrapper = pageId ? "button" : "div";
  return (
    <Wrapper
      type={pageId ? "button" : undefined}
      className={`life-editorial-card life-editorial-${layout}`}
      onClick={pageId ? () => runtime?.openPage?.(pageId) : undefined}
    >
      {imageUrl && <img className="life-editorial-image" src={isRemoteUrl(imageUrl) ? remotePlaceholderDataUrl(imageUrl) : imageUrl} alt="" loading="lazy" />}
      <span className="life-editorial-copy">
        {eyebrow && <small className="life-editorial-eyebrow">{eyebrow}</small>}
        <strong className="life-editorial-title">{title || "无标题"}</strong>
        {excerpt && <span className="life-editorial-excerpt">{excerpt}</span>}
      </span>
    </Wrapper>
  );
}

const EditorialCardBlock = createReactBlockSpec(
  {
    type: "editorialCard",
    propSchema: {
      imageUrl: { default: "" },
      eyebrow: { default: "" },
      title: { default: "Editorial Card" },
      excerpt: { default: "" },
      pageId: { default: "" },
      layout: { default: "card", values: ["card", "media-left"] },
    },
    content: "none",
  },
  {
    render: ({ block }) => <EditorialCardView {...block.props} />,
  },
);

const EditorialSectionBlock = createReactBlockSpec(
  {
    type: "editorialSection",
    propSchema: {
      sourceId: { default: "" },
      layout: { default: "cards-3", values: ["cards-2", "cards-3", "media-left"] },
      filterJson: { default: "" },
      sortsJson: { default: "" },
      limit: { default: 3 },
      titlePropertyId: { default: "" },
      eyebrowPropertyId: { default: "" },
      excerptPropertyId: { default: "" },
      imagePropertyId: { default: "" },
      fallbackJson: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block }) => {
      const runtime = useContext(LifeAtlasEditorRuntimeContext);
      const projected = projectEditorialSection(runtime?.workspace, {
        sourceId: block.props.sourceId,
        layout: block.props.layout,
        filter: block.props.filterJson,
        sorts: block.props.sortsJson,
        limit: block.props.limit,
        titlePropertyId: block.props.titlePropertyId,
        eyebrowPropertyId: block.props.eyebrowPropertyId,
        excerptPropertyId: block.props.excerptPropertyId,
        imagePropertyId: block.props.imagePropertyId,
      });
      let fallbackCards = [];
      try {
        const parsed = block.props.fallbackJson ? JSON.parse(block.props.fallbackJson) : [];
        fallbackCards = Array.isArray(parsed) ? parsed : [];
      } catch {
        fallbackCards = [];
      }
      const cards = projected.cards.length ? projected.cards : fallbackCards;
      return (
        <section className={`life-editorial-section life-editorial-section-${block.props.layout}`} data-source-id={block.props.sourceId}>
          {cards.length ? cards.map((card, index) => (
            <EditorialCardView key={card.itemId || card.pageId || `fallback-${index}`} {...card} layout={block.props.layout === "media-left" ? "media-left" : "card"} />
          )) : (
            <div className="life-editorial-empty">选择数据源后，这里会按筛选、排序和数量限制展示内容。</div>
          )}
        </section>
      );
    },
  },
);

function PageLinkView({ block, editor }) {
  const runtime = useContext(LifeAtlasEditorRuntimeContext);
  const [query, setQuery] = useState("");
  const page = runtime?.workspace?.pages?.find((candidate) => candidate.id === block.props.pageId);
  if (!block.props.pageId) {
    const needle = query.trim().toLocaleLowerCase();
    const available = (runtime?.workspace?.pages || []).filter((entry) => entry.id !== runtime?.pageId && !entry.trashedAt);
    const matches = (needle ? available.filter((entry) => (entry.title || "无标题页面").toLocaleLowerCase().includes(needle)) : available.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))).slice(0, 8);
    return <div className="life-page-link-picker" contentEditable={false}>
      <input aria-label="搜索要链接的页面" autoFocus disabled={!editor.isEditable} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.stopPropagation()} />
      {matches.map((entry) => <button key={entry.id} type="button" disabled={!editor.isEditable} onClick={() => editor.updateBlock(block, { props: { pageId: entry.id, label: entry.title || "无标题页面" } })}><IconPageBreak size={16} /><span>{entry.title || "无标题页面"}</span></button>)}
      {!matches.length && <p className="life-editor-empty">没有匹配的页面</p>}
    </div>;
  }
  const label = !page ? "已删除的页面" : `${page.title || "无标题页面"}${page.trashedAt ? "（在回收站）" : ""}`;
  return <button type="button" className="life-page-link-block" title={label} disabled={!page || Boolean(page.trashedAt)} onClick={() => page && !page.trashedAt && runtime?.openPage?.(page.id)}>
    <IconPageBreak size={17} stroke={1.7} aria-hidden="true" />
    <span>{label}</span>
    <small aria-hidden="true">Page</small>
  </button>;
}

const PageLinkBlock = createReactBlockSpec(
  {
    type: "pageLink",
    propSchema: {
      pageId: { default: "" },
      label: { default: "页面" },
    },
    content: "none",
  },
  {
    render: (props) => <PageLinkView {...props} />,
  },
);

function EquationView({ block, editor, contentRef }) {
  const [editing, setEditing] = useState(() => editor.getTextCursorPosition().block.id === block.id);
  useEditorSelectionChange(() => setEditing(editor.getTextCursorPosition().block.id === block.id), editor);
  const source = inlineText(block.content);
  return <div className="life-equation-block">
    <div className="life-equation-rendered" contentEditable={false} onClick={() => { if (editor.isEditable) editor.setTextCursorPosition(block, "end"); }}>
      {source ? <div dangerouslySetInnerHTML={{ __html: katex.renderToString(source, { displayMode: true, throwOnError: false, output: "html", trust: false }) }} /> : <span className="life-equation-placeholder">输入 LaTeX 公式</span>}
    </div>
    <code ref={contentRef} className={`life-equation-source${editing ? "" : " is-collapsed"}`} />
  </div>;
}

const EquationBlock = createReactBlockSpec(
  {
    type: "equation",
    propSchema: { display: { default: true } },
    content: "plain",
  },
  {
    render: (props) => <EquationView {...props} />,
  },
);

const TableOfContentsBlock = createReactBlockSpec(
  { type: "tableOfContents", propSchema: {}, content: "none" },
  {
    render: ({ editor }) => {
      const headings = useEditorState({
        editor, on: "change",
        selector: ({ editor: current }) => walkBlocks(current.document).filter((block) => block.type === "heading")
          .map((block) => ({ id: block.id, level: block.props.level || 1, title: inlineText(block.content) || "无标题" })),
      });
      return (
        <nav className="life-toc-block" aria-label="页面目录">
          <div className="life-special-block-label"><IconListDetails size={15} />目录</div>
          {headings.length ? headings.map((heading) => (
            <button type="button" key={heading.id} style={{ "--toc-level": heading.level }} onClick={() => {
              revealEditorBlock(editor.prosemirrorView.dom, heading.id, () => {
                editor.setTextCursorPosition(heading.id, "start");
                editor.focus();
              });
            }}>
              {heading.title}
            </button>
          )) : <span>添加标题后会自动出现在这里。</span>}
        </nav>
      );
    },
  },
);

const BreadcrumbBlock = createReactBlockSpec(
  { type: "breadcrumb", propSchema: {}, content: "none" },
  {
    render: () => {
      const runtime = useContext(LifeAtlasEditorRuntimeContext);
      const trail = runtime?.breadcrumb || [];
      return <div className="life-breadcrumb-block">{trail.map((label, index) => <span key={`${label}-${index}`}>{index > 0 && <b>›</b>}{label}</span>)}</div>;
    },
  },
);

const TabsBlock = createReactBlockSpec(
  {
    type: "tabs",
    propSchema: { activeTabId: { default: "" } },
    content: "none",
  },
  { render: (props) => <TabsHeader {...props} /> },
);

const TabPanelBlock = createReactBlockSpec(
  { type: "tabPanel", propSchema: { tabId: { default: "" }, label: { default: "标签" }, icon: { default: "" } }, content: "none" },
  { render: (props) => <TabPanelMarker {...props} /> },
);

const SyncedBlock = createReactBlockSpec(
  {
    type: "syncedBlock",
    propSchema: { sourceId: { default: "" } },
    content: "none",
  },
  {
    render: (props) => <SyncedContentReference {...props} schema={lifeAtlasSchema}
      getSlashItems={(nested, query, runtime) => Promise.resolve(filterLifeAtlasSlashMenuItems(nested, runtime, query))}
      getMentionItems={getMentionMenuItems} />,
  },
);

const ColumnListBlock = createReactBlockSpec(
  {
    type: "columnList",
    propSchema: { columns: { default: 2, values: [2, 3, 4, 5] } },
    content: "none",
  },
  {
    render: (props) => <ColumnListLayout {...props} />,
  },
);

const ColumnBlock = createReactBlockSpec(
  {
    type: "column",
    propSchema: {
      width: { default: 50 },
      index: { default: 0 },
      count: { default: 2 },
    },
    content: "none",
  },
  {
    render: (props) => <ColumnLayout {...props} />,
  },
);

function databasePageBlock(page, blocks) {
  if (page?.pageType !== "database" || !page.databaseSourceId || !page.databaseViewId) return null;
  const matches = [];
  const visit = (entries) => {
    for (const block of entries || []) {
      if (block.type === "databaseView" && block.props?.sourceId === page.databaseSourceId && block.props?.viewId === page.databaseViewId) matches.push(block);
      visit(block.children);
    }
  };
  visit(blocks);
  return matches.length === 1 ? matches[0] : null;
}

const DatabaseBlock = createReactBlockSpec(
  {
    type: "databaseView",
    propSchema: {
      sourceId: { default: "" },
      viewId: { default: "" },
      viewIdsJson: { default: "" },
      sourceIdsJson: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => {
      const runtime = useContext(LifeAtlasEditorRuntimeContext);
      const workspace = runtime?.workspace || { dataSources: [], databaseItems: [], databaseViews: [], relations: [], pages: [] };
      const page = workspace.pages?.find((entry) => entry.id === runtime?.pageId);
      // The declaration selects presentation, not source ownership. Match the
      // live editor tree so nesting and duplicated occurrences remain intact.
      const fullPage = databasePageBlock(page, editor.document)?.id === block.id;
      const changeView = (props) => {
        if (runtime?.locked || !editor.isEditable) return;
        editor.updateBlock(block, { props });
        if (fullPage) runtime?.updatePageDatabaseView?.(page.id, props.viewId, props.sourceIdsJson);
      };
      const database = (
        <DatabaseView
          workspace={workspace}
          sourceId={block.props.sourceId}
          sourceIdsJson={block.props.sourceIdsJson}
          viewId={block.props.viewId}
          viewIdsJson={block.props.viewIdsJson}
          containerPageId={page?.id}
          runtime={runtime}
          onSelectView={(viewId) => changeView({ viewId })}
          onChangeViewSet={changeView}
          onOpenOccurrence={runtime?.openPageAt ? () => runtime.openPageAt(runtime.pageId, block.id) : undefined}
          inline={!fullPage}
          onUpdateView={runtime?.updateDatabaseView}
          onUpdateItemValue={runtime?.updateDatabaseItemValue}
          onCreateItem={runtime?.createDatabaseItem}
          onOpenItemPage={runtime?.openPage}
          onCreateView={runtime?.createDatabaseView}
          onAddProperty={runtime?.addDatabaseProperty}
          onTurnIntoPage={runtime?.createFullPageFromSource}
          onTurnIntoInline={fullPage ? () => runtime?.turnFullPageDatabaseInline?.(page.id) : undefined}
          onSelectSource={fullPage ? undefined : (sourceId) => {
            if (runtime?.locked || !editor.isEditable) return;
            const priorType = workspace.databaseViews?.find((entry) => entry.id === block.props.viewId)?.type || "table";
            const view = runtime?.createLinkedView?.(sourceId, { type: priorType, name: "Linked View" });
            if (view?.id) editor.updateBlock(block, { props: { sourceId, sourceIdsJson: serializeDatabaseOccurrenceSourceIds([sourceId]), viewId: view.id, viewIdsJson: serializeDatabaseOccurrenceViewIds([view.id]) } });
          }}
        />
      );
      if (!fullPage) return database;
      return <div className="page-full-database" onMouseDownCapture={(event) => {
        // Fullpage presentation still lives inside an atomic editor block.
        // Keep its normal controls in the database surface, as for inline DBs.
        const control = event.target.closest?.('button, summary, [role="tab"]');
        const ordinaryInside = event.currentTarget.contains(event.target) && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
        if (control || ordinaryInside) event.stopPropagation();
      }}>{database}</div>;
    },
  },
);

export const lifeAtlasSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    table: createLifeAtlasTableSpec(),
    codeBlock: lifeAtlasCodeBlockSpec,
    ...localMediaBlockSpecs,
    callout: CalloutBlock(),
    editorialCard: EditorialCardBlock(),
    editorialSection: EditorialSectionBlock(),
    pageLink: PageLinkBlock(),
    equation: EquationBlock(),
    tableOfContents: TableOfContentsBlock(),
    breadcrumb: BreadcrumbBlock(),
    tabs: TabsBlock(),
    tabPanel: TabPanelBlock(),
    syncedBlock: SyncedBlock(),
    columnList: ColumnListBlock(),
    column: ColumnBlock(),
    databaseView: DatabaseBlock(),
    marketComponent: MarketComponentBlock(),
    actionButton: ActionButtonBlock(),
  },
  inlineContentSpecs: { ...defaultInlineContentSpecs, pageMention: PageMention, userMention: UserMention, dateMention: DateMention, inlineEquation: InlineEquation },
});

function layoutBlock(columns) {
  return {
    type: "columnList",
    props: { columns },
    children: Array.from({ length: columns }, (_, index) => ({
      type: "column",
      props: { width: 50, index, count: columns },
      children: [{ type: "paragraph", content: "" }],
    })),
  };
}

function createSlashActions(editor, runtime) {
  const insertReference = (block) => {
    const view = editor.prosemirrorView;
    view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
    let inserted;
    editor.transact(() => {
      const current = editor.getTextCursorPosition().block;
      const empty = Array.isArray(current.content) && current.content.length === 0;
      inserted = empty
        ? editor.replaceBlocks([current], [{ ...block, id: current.id, children: current.children }]).insertedBlocks[0]
        : editor.insertBlocks([block], current, "after")[0];
      editor.setTextCursorPosition(inserted, "start");
      let next = editor.getTextCursorPosition().nextBlock;
      while (next && editor.schema.blockSchema[next.type].content === "none") {
        editor.setTextCursorPosition(next, "start");
        next = editor.getTextCursorPosition().nextBlock;
      }
      if (!next) next = editor.insertBlocks([{ type: "paragraph" }], editor.getTextCursorPosition().block, "after")[0];
      editor.setTextCursorPosition(next, "start");
    });
    view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
    return inserted;
  };
  const createDatabase = (type = "table") => {
    const created = runtime?.createInlineDatabase?.(type, runtime?.pageId);
    if (!created) return;
    insertReference({
      type: "databaseView",
      props: { sourceId: created.sourceId, sourceIdsJson: serializeDatabaseOccurrenceSourceIds([created.sourceId]), viewId: created.viewId, viewIdsJson: serializeDatabaseOccurrenceViewIds([created.viewId]) },
    });
  };

  return {
    subPage: {
      icon: <IconPageBreak size={18} />,
      run: () => {
        const page = runtime?.createSubPage?.("新页面");
        insertReference({ type: "pageLink", props: { pageId: page?.pageId || "", label: page?.title || "新页面" } });
      },
    },
    linkToPage: {
      icon: <IconLink size={18} />,
      run: () => insertOrUpdateBlockForSlashMenu(editor, { type: "pageLink", props: { pageId: "", label: "" } }),
    },
    callout: {
      icon: <IconBlockquote size={18} />,
      run: () => insertOrUpdateBlockForSlashMenu(editor, {
        type: "callout",
        props: { icon: "💡", tone: "neutral" },
      }),
    },
    toggleHeading4: {
      icon: <span className="slash-text-icon">H4</span>,
      run: () => insertOrUpdateBlockForSlashMenu(editor, { type: "heading", props: { level: 4, isToggleable: true } }),
    },
    pdf: {
      icon: <IconFileTypePdf size={18} />,
      run: () => insertOrUpdateBlockForSlashMenu(editor, { type: "file", props: { name: "PDF 文件" } }),
    },
    ...Object.fromEntries(["table", "board", "gallery", "list", "calendar", "timeline", "roadmap", "map", "chart", "form", "dashboard", "feed"].map((type) => [
      `view:${type}`,
      {
        icon: type === "chart" ? <IconChartBar size={18} /> : type === "form" ? <IconForms size={18} /> : type === "dashboard" ? <IconLayoutDashboard size={18} /> : type === "roadmap" ? <IconTimeline size={18} /> : <IconDatabase size={18} />,
        run: () => createDatabase(type),
      },
    ])),
    inlineDatabase: { icon: <IconDatabase size={18} />, run: () => createDatabase("table") },
    fullPageDatabase: { icon: <IconTable size={18} />, run: () => runtime?.createFullPageDatabase?.() },
    linkedView: {
      icon: <IconLink size={18} />,
      run: () => insertOrUpdateBlockForSlashMenu(editor, { type: "databaseView", props: { sourceId: "", viewId: "" } }),
    },
    actionButton: { icon: <IconListDetails size={18} />, run: () => insertReference({ type: "actionButton" }) },
    toc: { icon: <IconListDetails size={18} />, run: () => insertOrUpdateBlockForSlashMenu(editor, { type: "tableOfContents" }) },
    equation: { icon: <IconMath size={18} />, run: () => insertOrUpdateBlockForSlashMenu(editor, { type: "equation", content: "" }) },
    breadcrumb: { icon: <IconFolderSymlink size={18} />, run: () => insertOrUpdateBlockForSlashMenu(editor, { type: "breadcrumb" }) },
    syncedBlock: {
      icon: <IconTopologyStar3 size={18} />,
      run: () => {
        const source = runtime?.syncedStore?.createSource([{ type: "paragraph", content: "" }]);
        if (source) insertOrUpdateBlockForSlashMenu(editor, { type: "syncedBlock", props: { sourceId: source.id } });
      },
    },
    tabs: { icon: <IconColumns size={18} />, run: () => insertOrUpdateBlockForSlashMenu(editor, createTabsDocument()) },
    ...Object.fromEntries([2, 3, 4, 5].map((columns) => [
      `columns:${columns}`,
      {
        icon: columns === 2 ? <IconColumns2 size={18} /> : columns === 3 ? <IconColumns3 size={18} /> : <IconColumns size={18} />,
        run: () => insertOrUpdateBlockForSlashMenu(editor, layoutBlock(columns)),
      },
    ])),
    editorialCard: {
      icon: <IconLayoutDashboard size={18} />,
      run: () => insertOrUpdateBlockForSlashMenu(editor, {
        type: "editorialCard",
        props: { title: "内容标题", eyebrow: "分类 · 阅读时间", excerpt: "这里填写简短摘要。", imageUrl: "", pageId: "", layout: "card" },
      }),
    },
    editorial3Cards: {
      icon: <IconColumns3 size={18} />,
      run: () => insertOrUpdateBlockForSlashMenu(editor, {
        type: "columnList",
        props: { columns: 3 },
        children: [33.33, 33.33, 33.34].map((width, index) => ({
          type: "column",
          props: { width, index, count: 3 },
          children: [{
            type: "editorialCard",
            props: { title: `内容 ${index + 1}`, eyebrow: "精选", excerpt: "卡片摘要", imageUrl: "", pageId: "", layout: "card" },
          }],
        })),
      }),
    },
    editorialMediaText: {
      icon: <IconColumns2 size={18} />,
      run: () => insertOrUpdateBlockForSlashMenu(editor, {
        type: "editorialCard",
        props: { title: "图文内容", eyebrow: "阅读", excerpt: "图片在左，标题与摘要在右。", imageUrl: "", pageId: "", layout: "media-left" },
      }),
    },
    editorialSection: {
      icon: <IconLayoutDashboard size={18} />,
      run: () => {
        const source = runtime?.workspace?.dataSources?.[0];
        insertOrUpdateBlockForSlashMenu(editor, {
          type: "editorialSection",
          props: { sourceId: source?.id || "", layout: "cards-3", filterJson: "", sortsJson: "", limit: 3, titlePropertyId: "", eyebrowPropertyId: "", excerptPropertyId: "", imagePropertyId: "" },
        });
      },
    },
    openMentionMenu: {
      icon: <IconAt size={18} />,
      run: () => editor.getExtension(SuggestionMenu)?.openSuggestionMenu("@", { deleteTriggerCharacter: true, ignoreQueryLength: true }),
    },
    inlineEquation: { icon: <IconMath size={18} />, run: () => runtime?.openInlineEquationDialog?.(editor) },
  };
}

export function getLifeAtlasSlashMenuItems(editor, runtime) {
  const defaultsByKey = new Map(getDefaultReactSlashMenuItems(editor).map((item) => [item.key, item]));
  const actions = createSlashActions(editor, runtime);
  const items = [];
  for (const entry of getSlashMenuCatalog(tWorkspace)) {
    const base = entry.defaultKey ? defaultsByKey.get(entry.defaultKey) : null;
    const action = entry.action ? actions[entry.action] : null;
    if (!base && !action) continue;
    items.push({
      key: entry.id,
      title: entry.title,
      subtext: entry.subtext,
      aliases: entry.aliases,
      group: entry.group,
      icon: action ? action.icon : base.icon,
      badge: SLASH_MARKDOWN_HINTS[entry.id],
      onItemClick: action ? action.run : base.onItemClick,
    });
  }
  const advancedGroup = tWorkspace("slash.group.advanced");
  const synced = (runtime?.syncedStore?.listSources() || []).filter((source) => !source.deletedAt).map((source, index) => ({
    title: tWorkspace("slash.syncedRefTitle", { index: index + 1 }),
    subtext: inlineText(source.blocks?.[0]?.content).slice(0, 60) || tWorkspace("slash.syncedRefEmpty"),
    aliases: ["synced reference", "同步引用"],
    group: advancedGroup,
    icon: <IconTopologyStar3 size={18} />,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "syncedBlock", props: { sourceId: source.id } }),
  }));
  const lastAdvanced = items.findLastIndex((item) => item.group === advancedGroup);
  items.splice(lastAdvanced + 1, 0, ...synced);
  return items;
}

export function filterLifeAtlasSlashMenuItems(editor, runtime, query) {
  return filterSuggestionItems(getLifeAtlasSlashMenuItems(editor, runtime), query);
}
