import { useRef, useSyncExternalStore } from "react";
import { TableHandlesExtension } from "@blocknote/core/extensions";
import {
  ColorPickerButton, FormattingToolbar, FormattingToolbarController, getFormattingToolbarItems,
  TableCellButton, TableCellMenu, TableCellMergeButton, TableHandlesController, useBlockNoteEditor,
  useComponentsContext, useEditorState, useExtensionState,
} from "@blocknote/react";
import IconTableColumn from "@tabler/icons-react/dist/esm/icons/IconTableColumn.mjs";
import { useDialogs } from "../ui/DialogProvider.jsx";
import { mergeSelectedTableCells, splitTableCell, tableCellForHandle, tableMergeSelection } from "./simpleTableCells.js";

function MergeCellsButton() {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext();
  const dialogs = useDialogs();
  const pending = useRef(false);
  const availability = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor.isEditable) return null;
      const selected = tableMergeSelection(editor.prosemirrorState);
      return selected ? (selected.crossesHeader ? "header" : "ready") : null;
    },
  });
  if (!availability) return null;
  const crossesHeader = availability === "header";
  const merge = async () => {
    if (pending.current || !editor.isEditable || editor.prosemirrorView.composing) return;
    editor.prosemirrorView.domObserver.flush();
    const state = editor.prosemirrorState;
    const selected = tableMergeSelection(state);
    if (!selected || selected.crossesHeader) return;
    pending.current = true;
    try {
      if (selected.hasContent && !await dialogs.confirm({
        title: "合并单元格？",
        description: "只会保留左上角单元格的内容。其他选中单元格中的内容将被清除，可用撤销恢复。",
        confirmLabel: "合并单元格",
        danger: true,
      })) return;
      const result = mergeSelectedTableCells(editor, selected, state.doc);
      if (result && !result.ok && !editor.prosemirrorView?.isDestroyed) {
        await dialogs.alert({ title: "未能合并单元格", description: result.message });
      }
    } finally {
      pending.current = false;
    }
  };
  return <Components.FormattingToolbar.Button
    className="bn-button"
    label="合并单元格"
    mainTooltip={crossesHeader ? "不能跨越表头边界" : "合并单元格"}
    isDisabled={crossesHeader}
    icon={<IconTableColumn size={18} stroke={1.7} />}
    onMouseDown={(event) => { if (event.button === 0) event.preventDefault(); }}
    onClick={merge} />;
}

function subscribeEditorFocus(listener) {
  document.addEventListener("focusin", listener);
  return () => document.removeEventListener("focusin", listener);
}

function LifeAtlasFormattingToolbar() {
  const editor = useBlockNoteEditor();
  const anotherEditorFocused = useSyncExternalStore(subscribeEditorFocus, () => {
    const owner = document.activeElement?.closest(".bn-container");
    return Boolean(owner && owner !== editor.prosemirrorView.dom.closest(".bn-container"));
  });
  if (anotherEditorFocused) return null;
  return <FormattingToolbar>
    {getFormattingToolbarItems().map((item) => item.type === TableCellMergeButton ? <MergeCellsButton key={item.key} /> : item)}
  </FormattingToolbar>;
}

function LifeAtlasCellMenu() {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext();
  const state = useExtensionState(TableHandlesExtension);
  const cellAtHandle = useEditorState({ editor, selector: ({ editor }) => {
    if (!editor.isEditable || !state?.block || state.rowIndex === undefined || state.colIndex === undefined) return null;
    const target = tableCellForHandle(editor.prosemirrorState, state.block.id, state.rowIndex, state.colIndex);
    return target && (target.cell.attrs.rowspan > 1 || target.cell.attrs.colspan > 1) ? target.position : null;
  } });
  return <TableCellMenu>
    {cellAtHandle !== null && <Components.Generic.Menu.Item onClick={() => {
      if (!editor.isEditable) return;
      const current = editor.prosemirrorState;
      const target = tableCellForHandle(current, state.block.id, state.rowIndex, state.colIndex);
      if (target) splitTableCell(editor, target.position, current.doc);
    }}>拆分单元格</Components.Generic.Menu.Item>}
    <ColorPickerButton />
  </TableCellMenu>;
}

function LifeAtlasCellHandle(props) {
  return <TableCellButton {...props} tableCellMenu={LifeAtlasCellMenu} />;
}

export function TableCellControls() {
  return <>
    <FormattingToolbarController formattingToolbar={LifeAtlasFormattingToolbar} />
    <TableHandlesController tableCellHandle={LifeAtlasCellHandle} />
  </>;
}
