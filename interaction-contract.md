> 历史文档（2026-11-01 起以 docs/blueprint/ 为准，本文仅供查阅）

# Frontend interaction contract

This milestone implements the agreed icon purposes using local demonstration data. Browser interaction acceptance is pending; build and source checks are recorded separately. No external messages, AI requests, team invitations or credentials are transmitted.

## Shared behavior

- The recursive project tree belongs exclusively in the left Private section. Disclosure changes stay inline. Project selection updates the content canvas.
- Workspace menus and tool navigation must remain reachable when the tree is expanded. Small-screen navigation must have a visible way to open it.
- Capture, inbox, project records and search refer to the same record objects. Assigning an inbox record changes its location rather than making a disconnected copy.
- Private header creation shows the current selected parent. Root creation is a distinct action in the Private menu. Each project menu applies to that project.
- Moving a project into itself or its descendants is rejected. Trashing a parent retains its descendants and related records for restoration.
- Recent visits reflect actual selection. Opening a nested search result expands its ancestor path.
- Dialogs support Escape, labelled fields, initial focus and return focus. Decorative marks do not create empty tab stops.
- External integrations are explicitly previews. Only local configuration/selection is demonstrated. No simulated response should be presented as a real external action.
- Temporary data is clearly identified as such. Export contains frontend demonstration data, never secrets.

## Acceptance sequence

1. Open quick capture, enter an unassigned note, save, and locate it in Inbox.
2. Assign that note to a project, open the project, and find the same note in global search.
3. Create a nested child, collapse and expand its parent, rename and move it; prevent cyclic moves.
4. Trash and restore a project subtree and verify record associations are preserved.
5. Open workspace settings, notifications, messages and every tool entry. Confirm actionable controls have a result, with clear preview labels for external services.
6. Check keyboard dismissal/focus and sidebar access at narrow widths.

Parent owns integration decisions and acceptance. Luna owns production code and bounded verification. Neither a successful build nor worker completion alone establishes visual/browser acceptance.
