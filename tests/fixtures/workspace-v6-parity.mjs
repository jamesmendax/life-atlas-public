// Frozen pre-v7 shapes. These fixtures deliberately retain shared legacy views,
// divergent sync keys, unknown metadata and nested Columns to catch data loss.
export function legacyWorkspace() {
  const time = "2026-09-01T09:00:00.000Z";
  return {
    schemaVersion: 6,
    customWorkspaceMetadata: { preserve: true },
    folders: [{ id: "folder", name: "Projects", createdAt: time, updatedAt: time }],
    pages: [{
      id: "page", folderId: "folder", title: "Migration project", icon: "P", iconColor: "#aabbcc",
      cover: null, createdAt: time, updatedAt: time, customPageMetadata: "keep",
      content: [
        { id: "tabs", type: "tabs", props: { tabs: "Overview|Notes|Files", active: 1 } },
        { id: "columns", type: "columnList", props: { columns: 2 }, children: [
          { id: "column-a", type: "column", props: { width: 60, index: 0, count: 2 }, children: [
            { id: "sync-a", type: "syncedBlock", props: { syncKey: "shared" }, content: [{ type: "text", text: "Canonical content", styles: { bold: true } }] },
            { id: "chart", type: "databaseView", props: { sourceId: "source", viewId: "view", presentation: "chart" } },
          ] },
          { id: "column-b", type: "column", props: { width: 40, index: 1, count: 2 }, children: [
            { id: "sync-b", type: "syncedBlock", props: { syncKey: "shared" }, content: [{ type: "text", text: "Canonical content", styles: { bold: true } }] },
            { id: "sync-conflict", type: "syncedBlock", props: { syncKey: "shared" }, content: [{ type: "text", text: "Do not discard this version", styles: {} }] },
          ] },
        ] },
        { id: "table", type: "databaseView", props: { sourceId: "source", viewId: "view", presentation: "database" } },
        { id: "form", type: "databaseView", props: { sourceId: "source", viewId: "view", presentation: "form" } },
        { id: "dashboard", type: "databaseView", props: { sourceId: "source", viewId: "view", presentation: "dashboard" } },
      ],
    }, { id: "record-page", folderId: "folder", title: "Release", content: [{ id: "record-body", type: "paragraph", content: "Preserve record page" }], createdAt: time, updatedAt: time }],
    dataSources: [{ id: "source", title: "Projects", ownerPageId: "page", customSource: "keep", properties: [
      { id: "title", name: "Name", type: "title", config: {}, options: [] },
      { id: "date", name: "Date", type: "date", config: {}, options: [] },
    ] }],
    databaseItems: [{ id: "record", sourceId: "source", pageId: "record-page", values: { title: "Release", date: "2026-09-19", futureProperty: { preserve: true } }, createdAt: time, updatedAt: time }],
    databaseViews: [{ id: "view", sourceId: "source", name: "Shared view", type: "table", filter: null, sorts: [], config: { chartType: "line", custom: 42 }, customView: "keep" }],
    relations: [],
    ui: { selectedPageId: "page", selectedFolderId: "folder", customUi: "keep" },
  };
}
