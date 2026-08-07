# Overlay Startup Surface and Overscroll Containment

Date: 2026-07-31
Status: Accepted

## Recall

| Item | Evidence |
| --- | --- |
| User requirement | Replace the white screen with black edge visible while the desktop client loads with a loading surface; prevent pulling a white region past the top or bottom of every internal scrollable surface. |
| Acceptance criteria | The native window has an application-colored first frame; its document immediately renders an accessible OpenCorvus loading surface before JavaScript mounts; reaching a scroll edge does not transfer further vertical overscroll to the WebView viewport. |
| Hard constraints | Desktop-only. Keep the existing native WebView, one owner per existing scroll surface, and native scrolling. Do not add a JavaScript wheel proxy, custom scrollbar, iframe, fallback, UI automation test, or per-page duplicate rule. Preserve unrelated worktree changes. |
| Read records | `2026-07-30-mission-entry-scroll-regression.md`, which establishes the existing one-owner scroll contract and forbids a second scroller. |
| Whole-repository grep | `rg` enumerated all Overlay production `overflow`, `overscroll-behavior`, window construction, `show_window`, `#overlayAppHost`, and `#chatScroll` call sites. Existing local containment occurs only on selected surfaces; the document viewport has no global overscroll policy. The main window is made visible in Rust setup before the frontend module renders. |
| Independent agent feedback | None; the user did not request delegation. |

## Root Cause

1. `src-tauri/tauri.conf.json` has no window background color, so the WebView host paints its platform default while the application document has not loaded.
2. `src/index.html` starts with an empty application host. Even after document creation there is no loading content until `main.tsx` mounts Solid.
3. `base.css` bounds `body` but does not set a document-level `overscroll-behavior`; selected nested containers use `contain`, leaving an exhausted nested scroll to reach the WebView viewport and expose the native white overscroll area.

## Design and Call-site Disposition

| Surface | Change |
| --- | --- |
| `src-tauri/tauri.conf.json` | Set the main window background color to the loading surface color so the first native pixel is not white. |
| `src/index.html` and `src/main.tsx` | Add the static, accessible first-frame loading mark and remove it at the one Solid mount boundary before the normal root renders. |
| `src/styles/cascade/base.css` | Put `overscroll-behavior: none` on the document viewport (`html`) as the sole global edge policy. Existing panel-specific overflow ownership and containment remain unchanged. |
| Existing browser UI tests | Do not run, modify, or replace them. This task is accepted by manual client interaction and screenshots. |
| `specs/README.md` | Add this record to the central index. |

## Verification Plan

1. Validate Tauri configuration and production build/typecheck.
2. Run the real Overlay with Node-based browser tooling, inspect the initial document loading surface before module mount, and manually inspect screenshots.
3. Exercise top and bottom wheel input on populated client views and confirm the document viewport does not move beyond its zero scroll range.
4. Perform a second diff review, commit task-owned files with the required prefix, then push through normal hooks.

## Result

The main Tauri window now declares the same neutral `#f4f4f4` backing color used by the immediate HTML loading surface. Before JavaScript executes, the client displays the centered OpenCorvus mark, restrained spinner, and accessible loading status rather than an empty white WebView. The one Solid mount boundary clears that static child before rendering, so it cannot remain below or in front of the live application.

The document viewport now owns the sole global vertical `overscroll-behavior-y: none` policy. It does not alter any existing internal scroll range, overflow owner, scrollbar, virtualization, or follow-lock controller; it only prevents exhausted wheel input from escaping those surfaces into the native WebView viewport.

## Verification

- Node-based Playwright manual inspection loaded the real Vite page with JavaScript disabled: the loading surface was visible at `1280x760`, reported `aria-busy=true`, and rendered the OpenCorvus mark, spinner, and status.
- With the real module enabled, the application mounted normally (`.titlebar` became the host's first child) and the loading surface was absent. The inspected screenshot showed the normal OpenCorvus workspace with no retained loading layer.
- In a real persisted conversation, `#chatScroll` measured `684px` high with `2029px` of content. After moving it to its lower bound and sending another downward wheel action, it remained at `1166px` (its exact maximum) while both document and body scroll positions remained `0`; the computed document overscroll policy was `none`. The task-scoped screenshot was manually reviewed and showed one bounded transcript with its composer fixed below it.
- `..\\..\\node_modules\\.bin\\tsc.exe --noEmit` passed in `packages/overlay`.
- `node --max-old-space-size=4096 .\\node_modules\\vite\\bin\\vite.js build --config vite.config.ts` passed in `packages/overlay` after transforming 7,062 modules. The unmodified Radix `use client` and chunk-size notices remain warnings. The default 2GB Node heap had exhausted during this pre-existing large build, so the same command was rerun with a sufficient local heap.
- `bun test test\\script\\historical-docs-links.test.ts` passed in `packages/opencorvus` with 2 tests and 2 expectations.
- `git diff --check` passed.

## Second Review

- The loading surface uses only the native window background plus the existing first document; no new window, timeout, state machine, fallback, or JavaScript visibility gate was introduced.
- `replaceChildren()` is located at the existing unique application mount boundary, ensuring the pre-mount DOM cannot become a parallel root.
- The overscroll rule is placed on `html`, the only common ancestor of every application scroller. Existing component-level containment stays intact, so there remains a single scroll owner per panel.
