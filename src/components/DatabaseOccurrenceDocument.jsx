import IconArrowLeft from "@tabler/icons-react/dist/esm/icons/IconArrowLeft.mjs";
import { DatabaseView } from "./DatabaseView.jsx";

// An expanded occurrence keeps its original page/block address. Editing its
// view writes through to that block; opening it never creates another Page.
export function DatabaseOccurrenceDocument({ page, block, runtime, documentRef }) {
  const change = (props) => runtime.updateDatabaseOccurrence(page.id, block.id, props);
  return <article ref={documentRef} className="page-document is-full-width database-occurrence-document" aria-label="数据库整页" data-page-id={page.id} data-block-id={block.id}>
    <button type="button" className="text-action" aria-label="返回所在页面" onClick={() => runtime.openPage(page.id)}><IconArrowLeft size={14} aria-hidden="true" />{page.title || "无标题页面"}</button>
    <DatabaseView
      workspace={runtime.workspace}
      sourceId={block.props.sourceId}
      sourceIdsJson={block.props.sourceIdsJson}
      viewId={block.props.viewId}
      viewIdsJson={block.props.viewIdsJson}
      containerPageId={page.id}
      runtime={runtime}
      onSelectView={(viewId) => change({ viewId })}
      onChangeViewSet={change}
      onUpdateView={runtime.updateDatabaseView}
      onUpdateItemValue={runtime.updateDatabaseItemValue}
      onCreateItem={runtime.createDatabaseItem}
      onOpenItemPage={runtime.openPage}
      onCreateView={runtime.createDatabaseView}
      onAddProperty={runtime.addDatabaseProperty}
    />
  </article>;
}
