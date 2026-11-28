# Notion-informed refactor notes

This document records architecture observations from the local reverse-engineered sample in `D:\opencode\notion-re`. It is a design/engineering reference, not a source-copy plan.

## Patterns worth carrying into Life Atlas

### 1. Records first, UI second
The recovered data model treats pages, blocks, collections, collection views and space/sidebar state as distinct records. UI surfaces derive from those records rather than owning duplicate content.

Life Atlas mapping:
- `Page` remains the editable record.
- `Folder` remains navigation-only hierarchy.
- `DataSource` owns database rows/schema.
- `DatabaseView` owns filters/sorts/grouping/presentation only.
- sidebar expansion/selection lives in workspace UI state, never in page content.

### 2. Sidebar order/state is workspace state
The recovered `space_view`/sidebar state keeps private-page ordering and navigation state separately from page content.

Life Atlas mapping:
- extract sidebar/tree rendering from `App.jsx`.
- keep tree expansion/selection in `workspace.ui`.
- sidebar rows are one reusable navigation primitive with hover actions, disclosure and selection state.

### 3. Block canvas is continuous
The recovered editor works around a block tree and atomic operations; drag handles, slash insertion and block menus are editor affordances over that tree rather than separate dashboard widgets.

Life Atlas mapping:
- BlockNote remains the rich-text engine.
- one `.life-editor` document surface for every normal Page.
- slash menu, mention menu and side/drag menu remain controllers attached to that editor.
- typography, hover chrome and spacing come from shared product tokens, not per-page special CSS.

### 4. Operations are the mutation boundary
Recovered transactions use small commands (add/remove/update/set/list ordering) and immutable/path-addressed records. Life Atlas is local-only, but the same boundary is useful.

Life Atlas mapping:
- keep mutations in domain/repository helpers.
- components request changes through callbacks instead of mutating persisted objects.
- keep undo/redo inside the editor engine and workspace persistence behind the repository adapter.

### 5. Database and view are separate
Recovered collection records and collection-view records are separate. A view is a query/presentation over the same source.

Life Atlas mapping:
- preserve existing DataSource / DatabaseView separation.
- database header, tabs, settings and property menus become shared surface/control primitives.
- changing view type/config must never copy rows.

### 6. Menus and popovers are a visual system
The recovered UI repeatedly composes compact menu/popover surfaces around contextual actions instead of introducing a new card/dialog style for each feature.

Life Atlas mapping:
- shared menu/popover/dialog/control tokens.
- page action menu, context menu, database source picker, property menu, query settings and customization overlays use the same radius, border, elevation, row height and focus treatment.

## Refactor boundaries

- Do not copy Notion brand chrome, login/auth UI, proprietary assets or large decompiled functions.
- Do not rebuild BlockNote.
- Do not merge DataSource and DatabaseView.
- Do not keep the Mendax replica installer/page-specific CSS. That was a one-off demo and is removed.
- Existing user Pages/Folders/database data remain intact. Only the assistant-generated page tagged with the exact legacy replica marker is removed by schema migration.

## Target source structure

- `src/domain/navigation.js`: pure tree ordering/selectors.
- `src/components/WorkspaceSidebar.jsx`: sidebar/tree presentation.
- `src/ui/product-system.css`: product tokens and shared shell/editor/menu/database visual primitives.
- `src/App.jsx`: application composition and commands, not sidebar implementation details.
- `src/editor/PageEditor.jsx`: BlockNote adapter/controllers.
- `src/components/DatabaseView.jsx`: view orchestration over one source using shared UI primitives.
