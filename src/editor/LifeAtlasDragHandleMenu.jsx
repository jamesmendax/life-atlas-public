import { useContext, useLayoutEffect, useState } from "react";
import { Menu } from "@mantine/core";
import { useBlockNoteEditor } from "@blocknote/react";
import IconArrowDown from "@tabler/icons-react/dist/esm/icons/IconArrowDown.mjs";
import IconArrowUp from "@tabler/icons-react/dist/esm/icons/IconArrowUp.mjs";
import IconArrowsExchange from "@tabler/icons-react/dist/esm/icons/IconArrowsExchange.mjs";
import IconCheck from "@tabler/icons-react/dist/esm/icons/IconCheck.mjs";
import IconColumnsOff from "@tabler/icons-react/dist/esm/icons/IconColumnsOff.mjs";
import IconCopy from "@tabler/icons-react/dist/esm/icons/IconCopy.mjs";
import IconExternalLink from "@tabler/icons-react/dist/esm/icons/IconExternalLink.mjs";
import IconLayoutColumns from "@tabler/icons-react/dist/esm/icons/IconLayoutColumns.mjs";
import IconLink from "@tabler/icons-react/dist/esm/icons/IconLink.mjs";
import IconPalette from "@tabler/icons-react/dist/esm/icons/IconPalette.mjs";
import IconTrash from "@tabler/icons-react/dist/esm/icons/IconTrash.mjs";
import { cloneBlockDocument } from "../domain/blockDocument.js";
import { LifeAtlasEditorRuntimeContext } from "./EditorRuntime.jsx";
import { convertEditorBlocks, getBlockConversionOptions } from "./blockCommands.js";
import { runEditorTransaction } from "./editorTransactions.js";
import {
  findEnclosingColumnContext,
  moveEditorColumnLayout,
  removeEditorBlocks,
  removeEditorColumn,
  removeEditorColumnLayout,
  unwrapEditorColumnLayout,
} from "./blockDrag.js";
import { selectedEditorBlocks, topLevelEditorBlocks } from "./editorCommandContext.js";
import { copyImagePixels } from "./imageClipboard.js";

export { selectedEditorBlocks } from "./editorCommandContext.js";

const blockColors = [
  ["default", "默认"], ["gray", "灰色"], ["brown", "棕色"], ["orange", "橙色"], ["yellow", "黄色"],
  ["green", "绿色"], ["blue", "蓝色"], ["purple", "紫色"], ["pink", "粉色"], ["red", "红色"],
];

export function duplicateEditorBlocks(editor, block) {
  return runEditorTransaction(editor, "duplicate:blocks", () => {
    const blocks = topLevelEditorBlocks(editor, selectedEditorBlocks(editor, block).map((entry) => entry.id));
    if (blocks.length) editor.insertBlocks(cloneBlockDocument(blocks), blocks.at(-1), "after");
  });
}

export function LifeAtlasDragHandleMenu({ block, blockIds, opened, onDismiss }) {
  const editor = useBlockNoteEditor();
  const runtime = useContext(LifeAtlasEditorRuntimeContext);
  const [query, setQuery] = useState("");
  useLayoutEffect(() => { if (opened) setQuery(""); }, [opened]);
  const locked = Boolean(runtime?.locked || !editor.isEditable);
  const selectedBlocks = blockIds.map((blockId) => editor.getBlock(blockId)).filter(Boolean);
  const columnContext = block?.id ? findEnclosingColumnContext(editor.prosemirrorView?.state?.doc, block.id) : null;
  const conversions = getBlockConversionOptions(editor, blockIds);
  const needle = query.trim().toLocaleLowerCase();
  const matches = (words) => !needle || words.toLocaleLowerCase().includes(needle);
  const showConversion = matches(`转换为 turn into convert ${conversions.map((target) => target.label).join(" ")}`);
  const showColumnLayout = Boolean(columnContext) && matches("分栏 取消分栏 合并单栏 上移整个分栏 下移整个分栏 删除当前栏 删除整个分栏 column unwrap layout");
  const showDuplicate = matches("复制 duplicate copy");
  const showImageCopy = block?.type === "image" && blockIds.length === 1 && matches("复制图片 copy image");
  const showMove = matches("移动到 move");
  const showLink = matches("复制区块链接 copy link");
  const showColor = matches(`颜色 color ${blockColors.map(([, name]) => name).join(" ")} 文字 背景`);
  const showRow = block?.type === "table" && editor.settings.tables.headers && matches("行标题 header row");
  const showColumn = block?.type === "table" && editor.settings.tables.headers && matches("列标题 header column");
  const showDelete = matches("删除 delete");
  const hasResults = showConversion || showColumnLayout || showImageCopy || showDuplicate || showMove || showLink || showColor || showRow || showColumn || showDelete;
  const explain = (result) => { if (!result?.ok && result?.message) runtime?.showEditorStatus?.(result.message); };
  const setColor = (property, value) => explain(runEditorTransaction(editor, `color:${property}`, () => {
    const targets = blockIds.map((blockId) => editor.getBlock(blockId));
    if (targets.some((target) => !target || !editor.schema.blockSchema[target.type]?.propSchema[property])) throw new Error("所选区块不支持同一种颜色设置。");
    for (const target of targets) editor.updateBlock(target.id, { props: { [property]: value } });
  }, { focus: true }));

  return <Menu.Dropdown className="bn-menu-dropdown bn-drag-handle-menu life-block-menu" onKeyDownCapture={(event) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.target.closest("[data-menu-dropdown]") !== event.currentTarget) return;
    event.preventDefault();
    event.stopPropagation();
    onDismiss();
  }}>
    <Menu.Search className="life-block-menu-search" aria-label="搜索区块操作" placeholder="搜索操作…" value={query} onChange={(event) => setQuery(event.currentTarget.value)} onKeyDownCapture={(event) => { if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) event.stopPropagation(); }} />
    {showConversion && <Menu.Sub position="right-start" width={270} withinPortal={false} openDelay={90} closeDelay={150} transitionProps={{ duration: 90 }}>
      <Menu.Sub.Target><Menu.Sub.Item className="bn-menu-item" leftSection={<IconArrowsExchange size={16} />} disabled={locked}>转换为</Menu.Sub.Item></Menu.Sub.Target>
      <Menu.Sub.Dropdown className="bn-menu-dropdown life-block-conversion-menu">
        {conversions.map((target) => <Menu.Item key={target.id} className="bn-menu-item" aria-label={target.label} aria-keyshortcuts={target.shortcut?.replace("Ctrl", "Control")} disabled={target.disabled} title={target.reason || undefined} leftSection={target.current ? <IconCheck size={15} /> : <span className="life-menu-check-space" />} rightSection={target.shortcut ? <kbd aria-hidden="true">{target.shortcut}</kbd> : undefined} onClick={() => explain(convertEditorBlocks(editor, blockIds, target.id))}>{target.label}</Menu.Item>)}
        {conversions.every((target) => target.disabled) && <Menu.Label className="life-block-menu-reason">{conversions[0]?.reason}</Menu.Label>}
      </Menu.Sub.Dropdown>
    </Menu.Sub>}
    {showImageCopy && <Menu.Item className="bn-menu-item" leftSection={<IconCopy size={16} />} onClick={async () => {
      try {
        const outer = editor.prosemirrorView.dom.querySelector(`.bn-block-outer[data-id="${CSS.escape(block.id)}"]`);
        const image = [...(outer?.querySelectorAll("img.bn-visual-media") || [])].find((element) => element.closest(".bn-block-outer") === outer);
        await copyImagePixels(image);
        runtime?.showEditorStatus?.("已复制图片");
      } catch { runtime?.showEditorStatus?.("未能复制图片"); }
    }}>复制图片</Menu.Item>}
    {showDuplicate && <Menu.Item className="bn-menu-item" aria-keyshortcuts="Control+D" leftSection={<IconCopy size={16} />} rightSection={<kbd aria-hidden="true">Ctrl+D</kbd>} disabled={locked} onClick={() => explain(runEditorTransaction(editor, "duplicate:blocks", () => {
      const blocks = topLevelEditorBlocks(editor, blockIds);
      if (blocks.length) editor.insertBlocks(cloneBlockDocument(blocks), blocks.at(-1), "after");
    }, { focus: true }))}>复制</Menu.Item>}
    {showMove && <Menu.Item className="bn-menu-item" leftSection={<IconExternalLink size={16} />} disabled={locked || !runtime?.appendBlocksToPage} onClick={() => {
      try { runtime?.openBlockMoveDialog?.(topLevelEditorBlocks(editor, blockIds), editor); }
      catch (error) { explain({ ok: false, message: error.message }); }
    }}>移动到…</Menu.Item>}
    {showLink && <Menu.Item className="bn-menu-item" leftSection={<IconLink size={16} />} disabled={!block || !runtime?.pageId} onClick={async () => {
      if (!block || !runtime?.pageId) return;
      try { await navigator.clipboard.writeText(`lifeatlas://page/${runtime.pageId}#block-${block.id}`); runtime.showEditorStatus?.("已复制区块链接"); }
      catch { runtime.showEditorStatus?.("未能复制区块链接"); }
    }}>复制区块链接</Menu.Item>}
    {showColor && <Menu.Sub position="right-start" width={304} withinPortal={false} openDelay={90} closeDelay={150} transitionProps={{ duration: 90 }}>
      <Menu.Sub.Target><Menu.Sub.Item className="bn-menu-item" leftSection={<IconPalette size={16} />} disabled={locked || !selectedBlocks.length || !selectedBlocks.every((target) => editor.schema.blockSchema[target.type]?.propSchema.textColor || editor.schema.blockSchema[target.type]?.propSchema.backgroundColor)}>颜色</Menu.Sub.Item></Menu.Sub.Target>
      <Menu.Sub.Dropdown className="bn-menu-dropdown life-block-colors-menu">
        {[["textColor", "文字"], ["backgroundColor", "背景"]].map(([property, label]) => <div key={property}>
          <Menu.Label>{label}</Menu.Label>
          {blockColors.map(([color, name]) => <Menu.Item key={color} className="bn-menu-item" disabled={!selectedBlocks.every((target) => editor.schema.blockSchema[target.type]?.propSchema[property])} leftSection={<span className="life-block-color-chip" data-color={color} data-kind={property}>A</span>} rightSection={selectedBlocks.every((target) => target.props[property] === color) ? <IconCheck size={14} /> : undefined} onClick={() => setColor(property, color)}>{name}{property === "backgroundColor" && color !== "default" ? "背景" : ""}</Menu.Item>)}
        </div>)}
      </Menu.Sub.Dropdown>
    </Menu.Sub>}
    {showRow && <Menu.Item className="bn-menu-item" disabled={locked} rightSection={block.content.headerRows ? <IconCheck size={14} /> : undefined} onClick={() => explain(runEditorTransaction(editor, "table:header-row", () => editor.updateBlock(block.id, { content: { ...editor.getBlock(block.id).content, headerRows: block.content.headerRows ? undefined : 1 } }), { preserveSelection: false }))}>行标题</Menu.Item>}
    {showColumn && <Menu.Item className="bn-menu-item" disabled={locked} rightSection={block.content.headerCols ? <IconCheck size={14} /> : undefined} onClick={() => explain(runEditorTransaction(editor, "table:header-column", () => editor.updateBlock(block.id, { content: { ...editor.getBlock(block.id).content, headerCols: block.content.headerCols ? undefined : 1 } }), { preserveSelection: false }))}>列标题</Menu.Item>}
    {showColumnLayout && <Menu.Sub position="right-start" width={240} withinPortal={false} openDelay={90} closeDelay={150} transitionProps={{ duration: 90 }}>
      <Menu.Sub.Target><Menu.Sub.Item className="bn-menu-item" leftSection={<IconLayoutColumns size={16} />} disabled={locked}>分栏布局</Menu.Sub.Item></Menu.Sub.Target>
      <Menu.Sub.Dropdown className="bn-menu-dropdown life-block-column-layout-menu">
        <Menu.Label>第 {columnContext.columnIndex + 1} 栏 / 共 {columnContext.columnCount} 栏</Menu.Label>
        <Menu.Item className="bn-menu-item" leftSection={<IconColumnsOff size={15} />} disabled={locked} onClick={() => explain(unwrapEditorColumnLayout(editor, block.id, { focus: true }))}>取消分栏（合并为单栏）</Menu.Item>
        <Menu.Item className="bn-menu-item" leftSection={<IconArrowUp size={15} />} disabled={locked || columnContext.siblingIndex <= 0} onClick={() => explain(moveEditorColumnLayout(editor, block.id, "up", { focus: true }))}>上移整个分栏</Menu.Item>
        <Menu.Item className="bn-menu-item" leftSection={<IconArrowDown size={15} />} disabled={locked || columnContext.siblingIndex >= columnContext.siblingCount - 1} onClick={() => explain(moveEditorColumnLayout(editor, block.id, "down", { focus: true }))}>下移整个分栏</Menu.Item>
        <Menu.Divider />
        <Menu.Item className="bn-menu-item life-block-delete" leftSection={<IconTrash size={15} />} disabled={locked} onClick={() => explain(removeEditorColumn(editor, block.id, { focus: true }))}>删除当前栏</Menu.Item>
        <Menu.Item className="bn-menu-item life-block-delete" leftSection={<IconTrash size={15} />} disabled={locked} onClick={() => explain(removeEditorColumnLayout(editor, block.id, { focus: true }))}>删除整个分栏</Menu.Item>
      </Menu.Sub.Dropdown>
    </Menu.Sub>}
    {showDelete && <><Menu.Divider /><Menu.Item className="bn-menu-item life-block-delete" leftSection={<IconTrash size={16} />} disabled={locked} onClick={() => explain(removeEditorBlocks(editor, blockIds, { focus: true }))}>删除</Menu.Item></>}
    {!hasResults && <Menu.Label className="life-block-menu-empty" role="status">没有匹配的操作</Menu.Label>}
  </Menu.Dropdown>;
}
