# Interactive Artifact Turn Visibility Repair

## Recall

| Item | Record |
| --- | --- |
| User request | Diagnose and then fix why the Wuhan-to-Hangzhou route map was not rendered in Chat. |
| Acceptance criteria | The persisted `map@1` route is mounted and visible when its assistant turn finishes; the policy applies to every inline Interactive Artifact renderer; ordinary completed text-only turns retain their compact default; an explicit user collapse remains authoritative; the real desktop page is opened, exercised, screenshotted, and visually reviewed; no User Interface (UI) automation test is added, modified, or run. |
| Hard constraints | One real conversation message stream and one card-tree projection; no fallback renderer, duplicate Artifact surface, state machine, keyword inference, hidden message, or Host gate; preserve unrelated dirty-worktree edits; delete touched obsolete UI automation tests instead of updating or running them; commit subjects begin with `dsw-33987`; push only to the legacy remote. |
| Sources read | `AGENTS.md`; `specs/current/architecture/07-panel.md`; `specs/records/2026-07/2026-07-31-map-artifact-basemap-and-route-rendering.md`; persisted session `ses_027e36de0ffe7m4aZjwFHLdMrm`; `Conversation.tsx`, `ChatBubble.tsx`, `CardParts.tsx`, `InteractiveArtifactPart.tsx`, `MapArtifact.tsx`, `utils/card-tree.ts`, `utils/message-part.ts`, `services/tree-writer.ts`, and `utils/debug-info.ts`. |
| Whole-repository search | The map publisher completed and persisted `art_fd81ded7d001Z3r1op5yQUr6zt` with a LineString and eight Point features. The session conversation route returns both the tool part and the `interactive-artifact` part. `CardParts` can render that part and `InteractiveArtifactPart` selects `MapArtifact`, but `ChatBubble` mounts all body parts only while the card is expanded. `defaultExpandedForNode` changes every finished non-user agent/message card to collapsed without considering durable interactive presentation content. The map turn therefore unmounts its only renderer at completion. `card-fold-store.test.ts` is an existing UI-state automation test in the touched path and must be deleted without execution. |
| Independent agent feedback | None. The user did not request sub-agents or parallel audit, so no delegation was started. |

## Causal Chain

The route GeoJSON and Interactive Artifact reference are durable and readable. The direct trigger is the assistant turn reaching a finished status. The shared card fold policy then returns `false`; `ChatBubble` removes the card body; and Solid never mounts `InteractiveArtifactPart` or `MapArtifact`. Previous map work repaired MapLibre basemap and route styling after mount, but did not repair the parent turn's visibility lifecycle, so it could not address this failure.

The copied debug blob's `tools: 0` is not evidence of publication failure: it counts stored CardTree node kinds, while message-owned tool parts are rendered as ephemeral nested cards. The persisted tool result and Artifact row are the authoritative evidence.

After preserving the completed presentation surface, the real desktop console exposed a second trigger: Vite had copied MapLibre's module-worker entry as a raw `?url` asset. That entry imports `./maplibre-gl-shared.mjs`, but the dependency was not emitted at that stable path, so the backend returned HTML for the request and WebView rejected it as a module MIME mismatch. The worker failure prevented the GeoJSON source, markers, route layer, and `fitBounds` result from completing.

## Design

The card fold policy remains the single owner of default expansion. It will classify a card containing a real `interactive-artifact` message part as a presentation-bearing turn and default that turn to expanded before applying the generic finished-card collapse rule. `cardExpanded` remains the single operator-override source, so a user can still collapse the turn and that explicit choice continues to win.

This is renderer-independent: map, document, chart, table, diagram, media, and future renderers using the existing `interactive-artifact` protocol receive the same visibility lifecycle. The repair does not inspect titles, tool names, Artifact payloads, or model prose and does not introduce a second rendering path.

MapLibre's module worker must be emitted through Vite's `?worker&url` pipeline so its dependency graph is bundled as one deployable worker asset. A dependency-bearing module entry must not be published as an opaque raw URL.

## Implementation

1. Add one semantic `CardNode` content predicate beside the existing fold policy.
2. Make presentation-bearing turns default expanded before the generic completed-turn collapse decision.
3. Delete `packages/overlay/test/card-fold-store.test.ts` because it automates UI disclosure behavior and is forbidden by the current project rules.
4. Bundle the MapLibre worker dependency graph through Vite instead of copying only its entry module.
5. Update the Panel architecture contract and spec indexes.

## Verification

- `bun run typecheck` passed in `packages/overlay` after both code changes.
- `bun run build:vite` passed with 7,083 modules. Its worker output is one `maplibre-gl-worker-*.js` asset of 466,311 bytes; the previous raw 19 KB entry and missing sibling request are gone.
- `bunx tauri build --no-bundle` passed with the generated embedded server payload and the frozen production Vite output.
- The release executable was started against the existing local database. Session `ses_027e36de0ffe7m4aZjwFHLdMrm` reopened with its completed Artifact turn expanded; the map fitted Wuhan through Hangzhou and visibly rendered the blue LineString and all eight Point markers. The manually reviewed screenshot is `specs/artifacts/interactive-artifact-turn-visibility.png`.
- The real WebView developer console was opened after the map became idle. It contained no error; `specs/artifacts/interactive-artifact-map-console.png` records that review. Before the worker repair, the same console had shown the missing `maplibre-gl-shared.mjs` MIME error.
- No UI automation test was run, added, or updated. The touched obsolete `packages/overlay/test/card-fold-store.test.ts` was deleted as required.
- The documented historical-link and document-health test paths do not exist in this branch, so their attempted commands could not enter a checker. `bun run docs:check` is the available documentation checker and passed.
- A second code/diff review passed. Selective staging contains only this repair; unrelated concurrent changes remain unstaged in the shared worktree.
