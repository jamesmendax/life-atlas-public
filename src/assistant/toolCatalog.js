import { desktopToolCatalog } from "./desktopTools.js";

const string = (description, maxLength, minLength = 1) => ({ type: "string", description, maxLength, minLength });
const choice = (description, values) => ({ type: "string", description, enum: values });
const flag = (description) => ({ type: "boolean", description });
const integer = (description, minimum, maximum) => ({ type: "integer", description, minimum, maximum });
const number = (description, minimum, maximum) => ({ type: "number", description, minimum, maximum });
const array = (description, items, maxItems, minItems = 0) => ({ type: "array", description, items, minItems, maxItems });
const object = (properties, required) => ({ type: "object", properties, required, additionalProperties: false });
const strings = (description, maxItems) => ({ type: "array", description, maxItems, items: string("Item ID or label.", 200) });
const pageId = string('An exact page ID returned by a tool, or "current" for the page the user was viewing when sending this request.', 200);
const folderId = string("The exact folder ID returned by a search.", 200);
const markdown = string("Life Atlas Markdown with editable headings, lists, quotes, pipe tables, links, formatting and callouts. Send the actual document, without a surrounding Markdown code fence.", 16000, 0);
const blockTypes = ["markdown", "table", "callout", "section", "image", "video", "file"];
const blockFields = {
  markdown,
  rows: array("For table: rows of cells that can contain inline Markdown.", array("A row of cells.", string("Cell text.", 800, 0), 20, 1), 100, 1),
  header: flag("For table: whether to treat the first row as headers. Defaults to true."),
  icon: string("For callout: an emoji or an empty string.", 24, 0),
  tone: choice("For callout: its tone.", ["neutral", "gray", "brown", "blue", "yellow", "red", "green"]),
  heading: string("For section: heading text with optional inline Markdown.", 400),
  level: integer("For section: heading level, default 2.", 1, 4),
  url: string("For image, video or file: a selected managed attachment URL or a reuse_url from read_page for this same page. A web image may use an image URL obtained with the web tools.", 2400),
  name: string("For media: display name.", 240, 0),
  caption: string("For media: optional caption.", 600, 0),
};
const columnItems = object({ type: choice("Block type inside a column.", blockTypes), ...blockFields }, ["type"]);
const nativeBlocks = array('Native editable blocks instead of markdown. Use {"type":"table","rows":[["Item","Status"],["Design","Ready"]]} for a table and {"type":"columns","columns":[[{"type":"markdown","markdown":"Left"}],[{"type":"callout","markdown":"Right"}]]} for a layout. Sections take heading and optional markdown. Media takes url.', object({
  type: choice("Block type.", [...blockTypes, "columns"]),
  ...blockFields,
  columns: array("For columns: 2 to 5 columns, each containing a list of native blocks.", array("Blocks in one column.", columnItems, 80), 5, 2),
}, ["type"]), 100);
const fonts = ["default", "serif", "mono"];
const sourceId = string("Data source ID returned by list_page_databases.", 200);
const viewId = string("Database view ID returned by list_page_databases.", 200);
const propertyId = string("Database property ID returned by list_page_databases.", 200);
const viewTypes = ["table", "board", "list", "gallery", "calendar", "timeline", "chart", "form", "dashboard", "map", "roadmap", "feed"];
const simplePropertyTypes = ["title", "text", "number", "select", "multi_select", "status", "date", "checkbox", "url", "email", "phone", "unique_id", "created_time", "modified_time"];
const propertyValue = {
  description: "A value appropriate to the property's type. A select or status value may be its option ID or exact label. Use an ISO date for a date. Null clears a value.",
  anyOf: [string("Text or option ID.", 1800, 0), { type: "number" }, { type: "boolean" }, { type: "null" }, strings("Option IDs or labels.", 20)],
};

const catalog = [
  ["search_workspace", "查找工作区", "Find pages, folders or recoverable items in Trash by title or path. Omit the query to list all items of the selected kind. Results include titles, paths and IDs.", {
    query: string("A title or path fragment. An empty query lists items of the selected kind.", 200, 0),
    kind: choice("The kind of target to find. Defaults to active pages.", ["page", "folder", "trashed_page", "trashed_folder"]),
    offset: integer("Zero-based result offset. Defaults to zero.", 0, 100000),
    limit: integer("Maximum results. Defaults to five.", 1, 10),
  }, []],
  ["read_page", "读取页面", "Read a requested page's metadata and a bounded slice of its local blocks, including table rows and column hierarchy. Reuse media's reuse_url only on the same page. Preserve tables with truncated previews when revising other content.", {
    page_id: pageId,
    offset: integer("Start at this zero-based block index. Defaults to zero.", 0, 100000),
    metadata_only: flag("Return page metadata and no body text."),
  }, ["page_id"]],
  ["create_page", "新建页面", "Create a normal page in a requested folder or as a child of a requested page. When neither is supplied, use the current workspace location.", {
    title: string("New page title.", 200),
    folder_id: folderId,
    parent_page_id: pageId,
    markdown,
    blocks: nativeBlocks,
  }, ["title"]],
  ["update_page", "编辑页面", "Rename a page or append or replace its body with native editable blocks or Markdown. Only replace the entire body when the user asks. Preserve linked databases, child pages and synced content with append or a focused edit_block.", {
    page_id: pageId,
    title: string("New page title.", 200),
    markdown,
    blocks: nativeBlocks,
    mode: choice("Append to the body, or replace the entire body. Defaults to append.", ["append", "replace"]),
  }, ["page_id"]],
  ["edit_block", "编辑区块", "Edit one native block without rewriting unrelated content. Use read_page to obtain its exact block ID. Use replace_blocks for a table, callout or another native block, or remove for a childless text block.", {
    page_id: pageId,
    block_id: string("The existing block ID returned by read_page.", 200),
    operation: choice("The requested operation.", ["replace_text", "remove", "replace_blocks"]),
    text: string("New plain text for replace_text. For formatted blocks use replace_blocks.", 8000, 0),
    markdown,
    blocks: nativeBlocks,
  }, ["page_id", "block_id", "operation"]],
  ["search_covers", "查找本地图集", "Find built-in cover art by title, tag or category. Results contain cover IDs for update_page_display.", {
    query: string("Optional title, tag or category to match.", 100, 0),
    limit: integer("Maximum results. Defaults to five.", 1, 10),
  }, []],
  ["update_page_display", "修改页面显示", "Change page appearance or set the edit lock when explicitly requested. Unlock a locked page in a separate call using only page_id and locked.", {
    page_id: pageId,
    font: choice("Page font.", fonts),
    small_text: flag("Enable small text."),
    presentation: choice("Reading column width or focus mode.", ["default", "full", "focus"]),
    icon: string("One emoji, or an empty string to remove the icon.", 64, 0),
    cover_id: string("Built-in cover ID from search_covers, or an empty string to remove the cover.", 200, 0),
    cover_url: string("Use a selected managed image, an existing image's reuse_url on this page, or an image URL from the web tools as the cover. Use instead of cover_id.", 2400),
    cover_position: number("Vertical cover position from 0 to 100.", 0, 100),
    locked: flag("Set or remove the edit lock only when the user specifically asks."),
  }, ["page_id"]],
  ["duplicate_page", "复制页面", "Copy an ordinary page and its owned child pages, or copy a database record in its current table. Standalone database sources must be copied using the app's database workflow.", {
    page_id: pageId,
    title: string("Optional title for the new copy. Defaults to the existing title with a copy suffix.", 200),
  }, ["page_id"]],
  ["move_page", "移动页面", "Move a page and its owned contents into an active folder or under another active page. Set exactly one destination. Database records stay in their data source.", {
    page_id: pageId,
    folder_id: folderId,
    parent_page_id: pageId,
  }, ["page_id"]],
  ["trash_page", "移到回收站", "When the user asks to delete a page, move it and its owned contents to the recoverable Trash.", {
    page_id: pageId,
  }, ["page_id"]],
  ["restore_page", "恢复页面", "Restore a page that is the root of its own recoverable Trash group.", {
    page_id: pageId,
  }, ["page_id"]],
  ["create_folder", "新建文件夹", "Create a folder at the Private root or under a specified active folder.", {
    name: string("New folder name.", 120),
    parent_folder_id: folderId,
  }, ["name"]],
  ["update_folder", "整理文件夹", "Rename or move a regular folder. Set parent_folder_id to an empty string to move it to the Private root.", {
    folder_id: folderId,
    name: string("New folder name.", 120),
    parent_folder_id: string("Destination folder ID or an empty string for the Private root.", 200, 0),
  }, ["folder_id"]],
  ["trash_folder", "回收文件夹", "When the user asks to delete a folder, move it and the pages it contains into the recoverable Trash.", {
    folder_id: folderId,
  }, ["folder_id"]],
  ["restore_folder", "恢复文件夹", "Restore a regular folder and its recoverable Trash group.", {
    folder_id: folderId,
  }, ["folder_id"]],
  ["create_database", "创建数据库", "Create an independent full-page database or an inline database on the requested page. Uses standard fields when properties are omitted.", {
    title: string("New database title.", 200),
    mode: choice("A full page or an inline database occurrence.", ["page", "inline"]),
    folder_id: folderId,
    parent_page_id: pageId,
    type: choice("Initial view type. Defaults to table.", viewTypes),
    properties: {
      type: "array", description: "New database fields, including at most one title field.", maxItems: 15,
      items: {
        type: "object", required: ["name", "type"], additionalProperties: false, properties: {
          name: string("Property label.", 100),
          type: choice("Property kind.", simplePropertyTypes),
          options: strings("Option labels for select, status or multi_select.", 12),
        },
      },
    },
  }, ["title"]],
  ["list_page_databases", "查看页面数据库", "Find data sources explicitly shown in the requested page. Specify one source for its view and property IDs.", {
    page_id: pageId,
    source_id: sourceId,
  }, ["page_id"]],
  ["query_database_records", "查询数据库记录", "Find or paginate records in a page's database. Optionally filter by a title or value fragment. Values are returned for the selected properties.", {
    page_id: pageId,
    source_id: sourceId,
    view_id: viewId,
    query: string("Optional record search phrase.", 200, 0),
    property_ids: strings("Property IDs for fields to include.", 6),
    count_only: flag("Return the number of matching records and no record fields or titles."),
    offset: integer("Zero-based record offset. Defaults to zero.", 0, 100000),
    limit: integer("Maximum number of records to return. Defaults to five.", 1, 10),
  }, ["page_id", "source_id"]],
  ["create_database_record", "新增数据库记录", "Create a record in an existing database, with the normal defaults and a record page.", {
    page_id: pageId,
    source_id: sourceId,
    title: string("Title for the new record.", 200),
    markdown,
  }, ["page_id", "source_id", "title"]],
  ["update_database_record", "修改数据库记录", "Set one editable database property on a requested record. Protected, relational and automatically calculated properties are edited directly in Life Atlas.", {
    page_id: pageId,
    source_id: sourceId,
    item_id: string("The record ID returned by query_database_records.", 200),
    property_id: propertyId,
    value: propertyValue,
  }, ["page_id", "source_id", "item_id", "property_id", "value"]],
  ["update_database_view", "修改数据库视图", "Change an existing view's name, layout, open mode, shown properties, grouping, simple sorting or filter. Unspecified settings are preserved.", {
    page_id: pageId,
    source_id: sourceId,
    view_id: viewId,
    name: string("New display name for this view.", 120),
    type: choice("View type.", viewTypes),
    visible_property_ids: strings("Visible database properties. An empty list shows just the title.", 32),
    open_records_in: choice("How record pages open.", ["peek", "side", "page"]),
    show_database_title: flag("Show the source title in this view."),
    show_page_icon: flag("Show page icons in this view."),
    group_property_id: string("Group by this property, or an empty string to clear grouping.", 200, 0),
    sort_property_id: string("Sort by this property, or an empty string to clear sorting.", 200, 0),
    sort_direction: choice("Sort direction. Defaults to ascending.", ["asc", "desc"]),
    filter_property_id: string("Filter on this property, or an empty string to clear filtering.", 200, 0),
    filter_operator: choice("Simple property comparison.", [
      "equals", "not_equals", "contains", "not_contains", "starts_with", "is_empty", "is_not_empty", "checked", "unchecked",
      "before", "after", "on_or_before", "on_or_after", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal",
    ]),
    filter_value: propertyValue,
  }, ["page_id", "source_id", "view_id"]],
  ["read_workspace_settings", "读取工作区设置", "Read the local appearance, startup and workspace identity settings.", {}, []],
  ["update_workspace_settings", "修改工作区设置", "Change local appearance, startup or workspace identity settings.", {
    theme: choice("System, light or dark appearance mode.", ["system", "light", "dark"]),
    default_font: choice("Default font for new pages.", fonts),
    start_page: choice("Open the last page or Home at startup.", ["last", "home"]),
    workspace_name: string("Workspace name, up to 60 Unicode characters.", 120),
    workspace_icon: string("One emoji, or an empty string to clear the icon.", 64, 0),
    sidebar_collapsed: flag("Collapse or expand the workspace sidebar."),
    sidebar_width: integer("Sidebar width in pixels between 200 and 480.", 200, 480),
  }, []],
  ...desktopToolCatalog,
];

export const workspaceAssistantTools = catalog.map(([name, , description, properties, required]) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
}));

export const workspaceToolLabels = Object.fromEntries(catalog.map(([name, label]) => [name, label]));

export function workspaceToolParameters(name) {
  return workspaceAssistantTools.find((tool) => tool.function.name === name)?.function.parameters;
}

