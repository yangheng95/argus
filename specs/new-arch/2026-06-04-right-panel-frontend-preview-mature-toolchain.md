# Right Panel Frontend Preview Mature Toolchain

Date: 2026-06-04
Status: Replacement plan

## Acronyms

- UI: User Interface, the visible controls and preview surface the user operates.
- UX: User Experience, the end-to-end interaction quality around preview launch, resize, diagnostics, and verification.
- MCP: Model Context Protocol, used here only for existing browser automation infrastructure, not as a UI feature.
- CSP: Content Security Policy, browser security policy controlling what the overlay and embedded pages may load.
- HMR: Hot Module Replacement, Vite's live module update mechanism during development.

## Decision

The previous frontend preview plan is retired and removed. It must not be used as source material for implementation.

The right-panel frontend preview must be built from mature primitives:

- Kobalte/Solid UI primitives for tabs, buttons, toggles, menus, and tooltips.
- Vite dev or preview server for local frontend projects when the project already exposes that runtime.
- A sandboxed browser iframe as the embedded right-panel viewport.
- Playwright through the existing browser runtime for screenshots, console/pageerror/requestfailed evidence, and viewport verification.
- Storybook only for component-library preview surfaces.
- Sandpack or WebContainers only for explicit browser-sandbox code-lab tasks, not for normal local project preview.

No hand-written browser, custom devtools, custom tab keyboard model, custom resize state machine, repo-root fallback, static-file fallback, or package-manager-specific startup rule is allowed.

## Codebase Evidence

| Area | Evidence | Decision |
| --- | --- | --- |
| Right panel shell | `packages/overlay/src/index.html` owns `.sections` with Explorer, Files, and Inspector bodies. | Add any future preview as a first-class right-panel surface only after this spec, not by reviving retired markup. |
| Tab primitive | `packages/overlay/src/components/ui/Tabs.tsx` wraps Kobalte Tabs. | Continue using Kobalte-backed primitives; do not hand-roll tab behavior. |
| Right panel tab state | `packages/overlay/src/components/RightPanelTabs.tsx` and `packages/overlay/src/main.tsx` own tab values and activation. | Keep one tab state source. |
| Files responsibility | `packages/overlay/src/components/RightFilesPanel.tsx` owns Changes/Diff only. | Do not mix frontend preview into Files/Diff. |
| API transport | `packages/overlay/src/services/api.ts` routes requests through HostTransport. | New preview routes must use HostTransport/api helpers, not raw fetch. |
| Browser evidence runtime | `packages/opencorvus/src/browser/webpage/render.ts`, `packages/opencorvus/src/runtime/page-capture.ts`, and browser runtime specs already cover Playwright evidence. | Reuse existing runtime direction for verification. |
| Removed preview family | `packages/overlay/test/acceptance-panel-mount.test.ts` asserts retired preview mount names do not return. | Treat those assertions as guardrails, not as a TODO to reverse. |

## Independent Agent Findings

| Agent | Scope | Finding |
| --- | --- | --- |
| Codebase explorer | Overlay right panel wiring | Current right panel has Explorer, Files, and Inspector only; no accepted live frontend preview surface exists. |
| Toolchain explorer | Mature frameworks | Best main path is Vite plus sandboxed iframe plus Playwright evidence; Storybook/Sandpack/WebContainers are scenario-specific, not the default. |
| Risk reviewer | Architecture and acceptance | Do not restore retired preview mounts; all errors must be visible; visual validation needs real UI evidence, not schema-only tests. |

## Target Architecture

The product surface should be a right-panel Preview surface backed by a server-side preview target record:

1. The backend resolves one preview target for the active task directory.
2. The backend starts or observes the configured preview runtime and returns a structured preview target: URL, root, command, status, diagnostics, and evidence IDs.
3. The overlay renders that URL in a sandboxed iframe and controls the viewport with Kobalte-backed controls.
4. The backend Playwright runtime captures verification evidence for the same URL and viewport presets.
5. Console and runtime diagnostics come from Playwright evidence and, for controlled same-origin pages only, explicit postMessage instrumentation.

The UI never chooses a package manager or guesses a root. It displays the backend-resolved command and failure evidence.

## Toolchain Selection

| Toolchain | Use | Rejection Boundary |
| --- | --- | --- |
| Vite | Local frontend dev/preview when the project declares Vite or generated source uses Vite. | Do not make OpenCorvus a Vite-only product; Vite is one supported runtime profile. |
| Sandboxed iframe | Right-panel embedded preview viewport. | Do not promise cross-origin DOM/console access. |
| Playwright | Screenshot, visible verification, console/pageerror/requestfailed evidence. | Do not replace it with custom screenshot or pixel logic in overlay UI. |
| Kobalte | Tabs, segmented controls, toggle buttons, menus, tooltips. | Do not write custom keyboard/ARIA behavior. |
| Storybook | Component-library or design-system preview. | Do not use it as the default for arbitrary app URLs. |
| Sandpack/WebContainers | Explicit in-browser code sandbox tasks. | Do not use them for normal local worktree preview. |
| Tauri Webview | Future stronger isolation if iframe cannot satisfy native constraints. | Do not start here; it complicates DOM layout and cross-platform diagnostics. |

## Implementation Requirements

- A new backend route family must be directory-scoped and return a single preview target contract. Route naming must be decided after grepping existing route definitions.
- Preview startup must fail truthfully with root, command, status, and diagnostics. It must not try another root or another server kind.
- Overlay UI controls must use existing Kobalte-backed primitives and overlay design tokens.
- Viewport presets must live in one shared config consumed by UI and Playwright verification.
- The iframe must use a deliberate sandbox/allow/referrerpolicy contract.
- Cross-origin diagnostics must be labeled as externally observed Playwright evidence; same-origin postMessage diagnostics must validate origin.
- Mission page behavior is out of scope unless a separate Mission-specific spec replaces or extends its Channels column.

## Required Tests

- Overlay structure test: right panel bodies and tab state are updated from one source, and retired preview mount names remain absent.
- UI primitive test: Preview controls use Kobalte-backed primitives, not raw custom ARIA tab/button behavior.
- Route contract test: preview target route is directory-scoped and does not appear in no-directory bypass lists.
- Startup resolver test: monorepo subpackage resolves one target; failure payload includes root, command, reason, and evidence.
- Transport test: overlay preview service uses HostTransport/api helpers and no raw fetch/EventSource.
- Visual test: Playwright opens the resolved URL at each viewport preset and records screenshot plus console/pageerror/requestfailed evidence.
- Visible acceptance: the right panel shows launch, ready, failed, reload, and diagnostics states in the actual overlay window.

## Rejected Designs

| Design | Reason |
| --- | --- |
| Restore the retired right-panel preview component family | It was explicitly removed and is protected by tests. |
| Build a custom browser/devtools UI | Violates mature-toolchain requirement and creates a second browser runtime. |
| Guess repo root, port, package manager, or static server | Creates fallback and hides the real preview target failure. |
| Put preview inside Files/Diff | Breaks RightFilesPanel's single responsibility. |
| Use Storybook as universal app preview | Storybook is excellent for components, not arbitrary project URLs. |
| Use WebContainers as default | It adds cross-origin isolation and browser-Node constraints that are unnecessary for local desktop preview. |

## Acceptance Criteria

- The old frontend preview plan is not present in the repository.
- No active code or spec instructs agents to restore the retired preview component family.
- The replacement design names mature toolchains and their boundaries.
- Future implementation can proceed from this spec without hand-rolling UI interactions or browser functionality.
