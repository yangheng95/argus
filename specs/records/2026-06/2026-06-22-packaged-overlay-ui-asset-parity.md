# Packaged Overlay UI Asset Parity

Date: 2026-06-22
Status: Implemented

## Acronyms

- UI: User Interface, the overlay web application served under `/ui/`.
- GUI: Graphical User Interface, the visible overlay surface.
- SPA: Single Page Application, the browser client that handles routes after
  `index.html` loads.
- JS: JavaScript, the executable browser bundle emitted by Vite.
- CSS: Cascading Style Sheets, the browser styling bundle emitted by Vite.

## Task Definition

Make the compiled overlay-server artifact prove that its embedded `/ui/`
bundle matches the current `packages/overlay/dist-vite` output and that
non-entry static assets resolve under `/ui/assets/`. This prevents GUI
performance and visual verification from silently measuring stale packaged
assets or rendering a broken titlebar brand logo.

## Recall

| Source                                                          | Constraint carried forward                                                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                     | No fallback, no duplicate UI source, test every change, and do not hide generated-file tool failures.                 |
| `2026-06-22-overlay-ui-serving-source.md`                       | Runtime source selection must remain one source: physical bundle first, embedded only when no physical bundle exists. |
| `2026-06-22-screenshot-browser-defer-initial-measure.md`        | Live 7878 was still serving old embedded assets while current `dist-vite` used newer filenames.                       |
| `2026-06-21-dispatch-algorithm-agent-audit.md` HOUSEKEEPING-001 | `overlay-ui-embedded.generated.ts` must return to the empty source form after build tooling runs.                     |
| `2026-06-18-titlebar-brand-guide-popover-primitive.md`          | The brand logo must be resolved through the Vite asset graph and must not fall out of `dist-vite` at runtime.         |

## Call Point Inventory

| Surface                | Evidence                                                                                                                            | Decision                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Overlay Vite build     | `packaged-overlay-server-health.test.ts` runs `bun run build:vite` before compiling the overlay-server artifact.                    | Treat that freshly built `dist-vite/index.html` as the expected packaged UI asset reference.                                |
| Overlay-server compile | `packages/opencorvus/script/build.ts` temporarily writes `overlay-ui-embedded.generated.ts`, compiles, then resets it in `finally`. | Keep this single compile-time embedding path; do not add runtime workspace fallback.                                        |
| Packaged health test   | Existing test only asserted that packaged `/ui/index.html` contained `./assets/`.                                                   | Parse current JS/CSS asset names and assert the compiled server serves those exact names.                                   |
| Asset fetches          | A stale or missing asset can otherwise be masked by SPA fallback HTML.                                                              | Request each expected JS/CSS URL and assert MIME type is JS/CSS, not HTML.                                                  |
| Vite base              | `vite.config.ts` used Vite's default `/` base, so JS-imported SVG assets compiled to root `/assets/...`.                            | Set `base: "./"` so imported assets resolve relative to the `/ui/assets/` script URL.                                       |
| Titlebar brand logo    | Visual QA of the compiled server showed a broken image icon at the titlebar brand position.                                         | Assert the packaged JS does not contain the root absolute brand logo URL and that `/ui/assets/<logo>.svg` is served as SVG. |

## Root Cause

The previous packaged health test proved that the compiled overlay-server could
serve some embedded UI, but it did not prove that the embedded UI was the same
bundle just emitted by `build:vite`. A stale executable could pass by serving an
older `index.html` with any `./assets/` reference, which is exactly the failure
mode seen on live port 7878.

The visual pass also exposed a second packaged serving issue: Vite emitted the
JS-imported titlebar logo as `/assets/opencorvus-logo-dark-*.svg`. Because the
overlay is served below `/ui/`, the browser requested the server root
`/assets/...`, not `/ui/assets/...`, and rendered a broken image icon.

## Fix Plan

1. Parse JS and CSS asset references from `packages/overlay/dist-vite/index.html`
   after the health test's Vite build.
2. Start the compiled overlay-server artifact as before.
3. Parse packaged `/ui/index.html` and assert its JS/CSS refs equal the current
   dist refs.
4. Fetch every expected JS/CSS asset through `/ui/` and assert the response MIME
   is the corresponding asset type, not HTML.
5. Build overlay assets with `base: "./"` so JS-imported assets resolve relative
   to the served script under `/ui/assets/`.
6. Assert the packaged JS does not contain a root absolute brand logo URL and
   that the referenced brand SVG is served from `/ui/assets/`.
7. Restore `overlay-ui-embedded.generated.ts` to the empty source form if a
   prior interrupted tool left generated content in the worktree.

## Acceptance

- A packaged overlay-server artifact with stale embedded UI asset names fails
  the health test.
- The artifact can still run without a sibling `ui/` directory.
- Runtime source selection remains unchanged and does not introduce fallback to
  workspace `dist-vite`.
- `overlay-ui-embedded.generated.ts` remains empty in repository source.
- The titlebar brand logo loads in the compiled `/ui/` page; no root
  `/assets/opencorvus-logo-*.svg` URL remains in the packaged JS.

## Verification

- `bun test packages/opencorvus/test/script/packaged-overlay-server-health.test.ts --timeout 240000`
- `bun test packages/opencorvus/test/script/build-artifact.test.ts packages/opencorvus/test/script/package-linux-binary.test.ts --timeout 60000`
- `bun test packages/overlay/test/titlebar-brand-strip.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/opencorvus typecheck`
- Visual QA: `.scratch/packaged-overlay-ui-asset-parity.png` captured from the
  compiled overlay-server `/ui/index.html`; `.brand-logo` loaded from
  `/ui/assets/opencorvus-logo-dark-DzLoBvHF.svg` with natural size `1000x1000`.
- `git status --short packages/opencorvus/src/server/overlay-ui-embedded.generated.ts`

## Self Review

- The test compares asset filenames from one authoritative current Vite output
  to the compiled artifact response; it does not teach runtime code to search
  alternative UI directories.
- The asset fetch assertions reject the common SPA fallback masking mode.
- The logo fix changes the single overlay build base instead of adding a server
  fallback for root `/assets/`.
