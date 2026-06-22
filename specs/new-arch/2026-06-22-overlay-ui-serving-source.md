# Overlay UI Serving Source

Date: 2026-06-22
Status: Implemented

## Acronyms

- UI: User Interface, the overlay web application served under `/ui/`.
- GUI: Graphical User Interface, the visible overlay surface.
- SPA: Single Page Application, the overlay client bundle that handles client-side routes.
- VSIX: Visual Studio Code Extension package format.

## Task Definition

Repair the live overlay `/ui/` source mismatch found during GUI performance
testing: port 7878 served stale embedded assets while the repository source,
tests, and `packages/overlay/dist-vite` already contained the current
virtualized screenshot browser bundle.

## Evidence

- `http://127.0.0.1:7878/ui/index.html` referenced
  `assets/index-UQD58TVp.js` and `assets/index-CuZLxk6G.css`.
- The current workspace `packages/overlay/dist-vite/index.html` referenced
  `assets/index-FYMMLsbF.js` and `assets/index-BMk967K2.css`.
- `packages/opencorvus/src/server/overlay-ui.ts` returned `serveEmbedded(c)`
  before calling `resolveOverlayDir()` whenever the generated embedded table
  had `/index.html`.
- The active process was the Tauri extracted sidecar executable under
  `%LOCALAPPDATA%/ai.opencorvus.overlay/embedded/...`, with no sibling `ui/`
  directory.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no double UI source, test every change, and visually verify UI-related changes. |
| `2026-06-19-vscode-media-ui-dist-vite-single-source.md` | Stale shipped UI assets can mask current source fixes; `dist-vite` is the bundle source for local verification and VSIX media sync. |
| `2026-06-21-overlay-payload-stamp-rerun-discipline.md` | Packaged overlay-server artifacts are generated from one build script and should not depend on loose sidecar UI directories. |
| `2026-06-21-dispatch-algorithm-agent-audit.md` HOUSEKEEPING-001 | Generated embedded UI modules must reset to the empty source form after builds so typecheck does not depend on local dist artifacts. |
| `2026-06-22-screenshot-browser-open-jank.md` | Screenshot browser performance acceptance depends on the current virtualized `dist-vite` bundle, not stale embedded assets. |

## Call Point Inventory

| Surface | Current evidence | Decision |
| --- | --- | --- |
| `/ui` route mount | `server.ts` mounts `OverlayUI.routes()` in two server modes. | Keep one route factory. |
| Physical bundle resolver | `resolveOverlayDir()` finds executable-sibling `ui/` first, then workspace `packages/overlay/dist-vite`. | Treat a resolved physical bundle as the serving source before embedded files. |
| Embedded bundle | `overlay-ui-embedded.generated.ts` is empty in source and populated only during overlay-server compile/package. | Use embedded files only when no physical bundle is available. |
| Tests | Existing handler tests cover route semantics through `dirOverride`; package tests cover embedded module generation. | Add a pure source-selection regression so embedded cannot shadow the current physical bundle. |

## Root Cause

The source-selection order made compile-time embedded files dominate runtime
physical bundles. That is correct only for single-file packages without a
physical UI bundle. In a local desktop sidecar run, it made `/ui/` serve the
sidecar's embedded bundle even when the workspace had a newer `dist-vite`
bundle, so GUI verification measured old code while tests exercised new code.

## Fix Plan

1. Introduce one explicit `selectOverlayUiServingSource` helper.
2. Select exactly one source in this order:
   - explicit route directory override,
   - resolved physical bundle from `resolveOverlayDir()`,
   - embedded bundle,
   - missing.
3. Update `routes()` to call the helper once and serve only that source.
4. Add tests for all source-selection branches, especially physical bundle
   winning over embedded availability.
5. Verify handler tests, packaging tests, typecheck, and a real rendered `/ui`
   screenshot served through `OverlayUI.routes()`.

## Acceptance

- If workspace `dist-vite/index.html` exists, `/ui/` serves that physical bundle
  even when embedded UI files exist in the binary.
- Single-file packages without a physical bundle still serve embedded UI files.
- Missing physical and embedded sources still return the existing 404 message.
- Route path validation, SPA fallback, MIME types, and asset rewriting are
  unchanged.
- No new UI storage path, iframe, compatibility data source, or second screenshot
  browser implementation is introduced.

## Verification

- `bun test packages/opencorvus/test/server/overlay-ui-handler.test.ts packages/opencorvus/test/server/overlay-ui-traversal.test.ts --timeout 30000`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/build-artifact.test.ts packages/opencorvus/test/script/package-linux-binary.test.ts --timeout 60000`
- Direct Hono request through `OverlayUI.routes()` returned the same asset names
  as `packages/overlay/dist-vite/index.html`:
  `index-FYMMLsbF.js` and `index-BMk967K2.css`.
- Node-owned browser screenshot:
  `.scratch/overlay-ui-source-serving.png`, reviewed as a nonblank current
  overlay UI shell using `./assets/index-FYMMLsbF.js`.
