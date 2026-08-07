# Right Panel Frontend Preview Mature Toolchain

Date: 2026-06-04
Status: Superseded historical plan

> Superseded on 2026-06-17 by the task-scoped browser preview target/evidence
> contract and the strict request-schema notes. The iframe viewport requirements
> below are historical rejected direction; current overlay tests assert that the
> browser preview panel does not render an iframe or accept local query/signal
> preview sources.

## Acronyms

- UI: User Interface, the visible controls and preview surface the user operates.
- UX: User Experience, the end-to-end interaction quality around preview launch, resize, diagnostics, and verification.
- MCP: Model Context Protocol, used here only for existing browser automation infrastructure, not as a UI feature.
- CSP: Content Security Policy, browser security policy controlling what the overlay and embedded pages may load.
- HMR: Hot Module Replacement, Vite's live module update mechanism during development.

## Decision

The previous frontend preview plan is retired and removed. It must not be used as source material for implementation.

The superseded replacement plan proposed these mature primitives:

- Kobalte/Solid UI primitives for tabs, buttons, toggles, menus, and tooltips.
- Vite dev or preview server for local frontend projects when the project already exposes that runtime.
- A sandboxed browser iframe as the embedded right-panel viewport; this was
  later rejected in favor of task-scoped backend preview target/evidence.
- Playwright through the existing browser runtime for screenshots, console/pageerror/requestfailed evidence, and viewport verification.
- Storybook only for component-library preview surfaces.
- Sandpack or WebContainers only for explicit browser-sandbox code-lab tasks, not for normal local project preview.

No hand-written browser, custom devtools, custom tab keyboard model, custom resize state machine, repo-root fallback, static-file fallback, or package-manager-specific startup rule is allowed.

## Codebase Evidence

| Area                     | Evidence                                                                                                                                                             | Decision                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Right panel shell        | `packages/overlay/src/index.html` owns `.sections` with Explorer, Files, and Inspector bodies.                                                                       | Add any future preview as a first-class right-panel surface only after this spec, not by reviving retired markup. |
| Tab primitive            | `packages/overlay/src/components/ui/Tabs.tsx` wraps Kobalte Tabs.                                                                                                    | Continue using Kobalte-backed primitives; do not hand-roll tab behavior.                                          |
| Right panel tab state    | `packages/overlay/src/components/RightPanelTabs.tsx` and `packages/overlay/src/main.tsx` own tab values and activation.                                              | Keep one tab state source.                                                                                        |
| Files responsibility     | `packages/overlay/src/components/RightFilesPanel.tsx` owns Changes/Diff only.                                                                                        | Do not mix frontend preview into Files/Diff.                                                                      |
| API transport            | `packages/overlay/src/services/api.ts` routes requests through HostTransport.                                                                                        | New preview routes must use HostTransport/api helpers, not raw fetch.                                             |
| Browser evidence runtime | `packages/opencorvus/src/browser/webpage/render.ts`, `packages/opencorvus/src/runtime/page-capture.ts`, and browser runtime specs already cover Playwright evidence. | Reuse existing runtime direction for verification.                                                                |
| Removed preview family   | `packages/overlay/test/acceptance-panel-mount.test.ts` asserts retired preview mount names do not return.                                                            | Treat those assertions as guardrails, not as a TODO to reverse.                                                   |

## Independent Agent Findings

| Agent              | Scope                       | Finding                                                                                                                                         |
| ------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Codebase explorer  | Overlay right panel wiring  | Current right panel has Explorer, Files, and Inspector only; no accepted live frontend preview surface exists.                                  |
| Toolchain explorer | Mature frameworks           | Best main path is Vite plus sandboxed iframe plus Playwright evidence; Storybook/Sandpack/WebContainers are scenario-specific, not the default. |
| Risk reviewer      | Architecture and acceptance | Do not restore retired preview mounts; all errors must be visible; visual validation needs real UI evidence, not schema-only tests.             |

## Target Architecture

The superseded product surface proposed a right-panel Preview surface backed by a server-side preview target record:

1. The backend resolves one preview target for the active task.
2. The backend returns the saved task preview target artifact: URL, root, status, diagnostics, and evidence IDs.
3. The overlay would have rendered that URL in a sandboxed iframe; the current
   contract rejects iframe preview rendering and keeps the backend evidence path
   as the source of truth.
4. The backend Playwright runtime captures verification evidence for the same URL and viewport presets.
5. Console and runtime diagnostics come from Playwright evidence and, for controlled same-origin pages only, explicit postMessage instrumentation.

The UI never chooses a package manager, guesses a root, or reads project package metadata. It displays the backend-resolved task target and failure evidence.

Automatic preview startup must feed this same artifact model. If a future Vite, Storybook, Sandpack, WebContainers, or browser-runtime launcher discovers or starts a preview URL, it must persist `browser_preview_target` first; the right-panel resolver must not gain a second manifest, command, or package metadata source.

## Toolchain Selection

| Toolchain              | Use                                                                                      | Rejection Boundary                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Vite                   | Local frontend dev/preview when the project declares Vite or generated source uses Vite. | Do not make OpenCorvus a Vite-only product; Vite is one supported runtime profile. |
| Sandboxed iframe       | Historical rejected embedded preview viewport.                                           | Current preview work must not reintroduce iframe rendering.                        |
| Playwright             | Screenshot, visible verification, console/pageerror/requestfailed evidence.              | Do not replace it with custom screenshot or pixel logic in overlay UI.             |
| Kobalte                | Tabs, segmented controls, toggle buttons, menus, tooltips.                               | Do not write custom keyboard/ARIA behavior.                                        |
| Storybook              | Component-library or design-system preview.                                              | Do not use it as the default for arbitrary app URLs.                               |
| Sandpack/WebContainers | Explicit in-browser code sandbox tasks.                                                  | Do not use them for normal local worktree preview.                                 |
| Tauri Webview          | Future stronger isolation if iframe cannot satisfy native constraints.                   | Do not start here; it complicates DOM layout and cross-platform diagnostics.       |

## Implementation Requirements

- The backend route family is task-scoped: `GET /task/{taskID}/browser-preview`, `PUT /task/{taskID}/browser-preview/target`, and `POST /task/{taskID}/browser-preview/capture`.
- Saved preview targets and preview capture evidence live as task-scoped `engine_artifact` facts: `browser_preview_target` and `browser_preview_evidence`. The stale `acceptance_preview` name must not be revived.
- Preview startup must fail truthfully with root, status, and diagnostics. It must not try another root or another server kind.
- Overlay UI controls must use existing Kobalte-backed primitives and overlay design tokens.
- Viewport presets must live in one shared config consumed by UI and Playwright verification.
- The historical iframe sandbox contract must not be treated as current
  implementation guidance.
- Cross-origin diagnostics must be labeled as externally observed Playwright evidence; same-origin postMessage diagnostics must validate origin.
- Mission page behavior is out of scope unless a separate Mission-specific spec replaces or extends its Channels column.

## Required Tests

- Overlay structure test: right panel bodies and tab state are updated from one source, and retired preview mount names remain absent.
- UI primitive test: Preview controls use Kobalte-backed primitives, not raw custom ARIA tab/button behavior.
- Route contract test: preview target route is directory-scoped and does not appear in no-directory bypass lists.
- Startup resolver test: task artifact resolves one target; failure payload includes root, reason, and evidence.
- Transport test: overlay preview service uses HostTransport/api helpers and no raw fetch/EventSource.
- Visual test: Playwright opens the resolved URL at each viewport preset and records screenshot plus console/pageerror/requestfailed evidence.
- Visible acceptance: the right panel shows launch, ready, failed, reload, and diagnostics states in the actual overlay window.

## Rejected Designs

| Design                                                   | Reason                                                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Restore the retired right-panel preview component family | It was explicitly removed and is protected by tests.                                                        |
| Build a custom browser/devtools UI                       | Violates mature-toolchain requirement and creates a second browser runtime.                                 |
| Guess repo root, port, package manager, or static server | Creates fallback and hides the real preview target failure.                                                 |
| Put preview inside Files/Diff                            | Breaks RightFilesPanel's single responsibility.                                                             |
| Use Storybook as universal app preview                   | Storybook is excellent for components, not arbitrary project URLs.                                          |
| Use WebContainers as default                             | It adds cross-origin isolation and browser-Node constraints that are unnecessary for local desktop preview. |

## Acceptance Criteria

- The old frontend preview plan is not present in the repository.
- No active code or spec instructs agents to restore the retired preview component family.
- The replacement design names mature toolchains and their boundaries.
- Future implementation can proceed from this spec without hand-rolling UI interactions or browser functionality.
