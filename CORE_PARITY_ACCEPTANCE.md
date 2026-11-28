> 历史文档（2026-11-01 起以 docs/blueprint/ 为准，本文仅供查阅）

# Life Atlas Core-Parity Implementation & Acceptance Report

Generated: 2026-09-19T01:07:33.488Z

## Scope

Implemented and verified the handoff's Phase 1, Phase 2 and Phase 3 only. Phase 4 remains planning-only: no IndexedDB workspace migration, realtime collaboration/Yjs/WebSocket, cloud asset backend, permissions backend or multi-device sync was added.

## Key delivered behavior

- Phase 1: native nested Tabs, canonical synced content, atomic Page/User/Date mentions, expanded typed database properties, normalized dates, Chart/Form/Dashboard/Map views, deterministic migration and linked-source semantics.
- Phase 2: real Calendar/Timeline work surfaces, accessible Board movement, configurable Gallery, nested typed filters, stable multi-sort/grouping and a bounded typed Formula AST engine without eval/Function.
- Phase 3: reusable page/database templates with fresh IDs, local page/block discussions with anchor lifecycle, first-class attachment metadata/provider boundary, expanded entity search, full workspace JSON roundtrip and stable v9 migration.
- P0 Columns integration: the native BlockNote per-block + / six-dot Side Menu now remains bound to the active Life Atlas custom-column block while a real pointer crosses the narrow column gap/resizer. The fix uses BlockNote's public SideMenuExtension freeze/unfreeze lifecycle and does not patch node_modules, impersonate XL column DOM, or add a full-height pointer overlay.

## Acceptance evidence

- Unit/regression suite: all 17 test modules passed in this verifier.
- Browser suite: 6 scenarios / 35 checks passed with zero captured browser/console/HTTP errors.
- Native Side Menu regression specifically uses a stepped Playwright mouse path to [data-test="dragHandleAdd"] and [data-test="dragHandle"], verifies the active block ID remains stable, activates the native +, confirms insertion in the second column, and confirms the column resizer remains hit-testable.
- Sites-compatible production output exists at dist/client/index.html, dist/server/index.js and dist/.openai/hosting.json.

## Visual evidence

- .qa/phase1-editor-mixed-tabs.png
- .qa/phase1-database-dashboard.png
- .qa/phase2-work-surfaces-calendar.png
- .qa/phase2-work-surfaces-timeline.png
- .qa/phase2-work-surfaces-gallery.png
- .qa/phase3-workspace-workspace.png

A final fresh visual/a11y review is recorded separately at .qa/core-parity-final.png.

## Permitted limitations / non-goals

- Phase 4 is intentionally not implemented.
- Attachments remain local metadata/provider locators; binary payloads are not embedded in workspace localStorage JSON.
- The project keeps its existing project-owned multi-column model instead of adopting GPL/commercial BlockNote XL multi-column.
- Large split chunks from optional PDF/export dependencies may remain in the production bundle; they are lazy build artifacts and do not affect acceptance behavior.

## Artifact integrity

See .qa/core-parity-delivery-manifest.json for SHA-256 checksums of delivery-critical sources, tests, build outputs and visual evidence.
