# Overlay Compact Legal Frame Query

Date: 2026-06-23
Status: Verified

## Acronyms

- CSS: Cascading Style Sheets, the browser styling and layout language.
- GUI: Graphical User Interface, the visible overlay surface.
- QA: Quality Assurance, the verification pass that checks delivered behavior.
- UI: User Interface, visible controls and layout surfaces.

## Task Definition

Illegal raw browser viewports must not trigger small-panel overlay layouts. The
overlay shell already has a token-owned legal minimum size and aspect frame; the
responsive compact rules must read that legal shell size instead of
`window.innerWidth` through viewport media queries.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback logic, no duplicate source, no blind patching, test every change, visually verify UI work, and commit/push every round. |
| `2026-06-22-overlay-layout-aspect-frame.md` | Legal layout frame derives from `--ui-overlay-min-width` and `--ui-overlay-min-height`; do not restore native resize feedback loops. |
| `2026-06-22-center-workbench-panel-min-size-contract.md` | Center workbench panel minimum width remains owned by `--ui-workbench-panel-min-width`. |
| `2026-06-23-overlay-panel-legal-size-contract.md` | Left activity shell, pane resize ranges, and center panel resize ranges must reject illegal small panels. |
| User feedback 2026-06-23 | Limit aspect ratio and minimum panel width; illegal aspect ratios and too-small panels are not allowed. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Legal shell size | `base.css` sets body `min-width`, `min-height`, and aspect-clamped height from overlay tokens. | Keep body as the legal shell and make it the named CSS query container for overlay descendants. |
| Compact workspace CSS | `workspace.css` still uses `@media (width < 1120px)`, so a 900px browser fixture enters compact layout even though body is clamped to 1120px. | Replace raw viewport media query with a named shell container query. |
| Compact right toolbar CSS | `activity.css` has the same raw viewport `@media (width < 1120px)`. | Replace with the same named shell container query. |
| Other compact CSS | `titlebar.css`, `dialog.css`, `messages.css`, `settings.css`, `workspace-onboarding.css`, `conversation.css`, `composer.css`, and `inspector.css` still had width-based viewport media queries. | Move overlay-wide rules to `overlay-shell` and component-local rules to their existing component containers. |
| Descendant panel width clamps | Floating panels and inline clamps in `card.css`, `cmdk.css`, `composer.css`, `conn-banner.css`, `conversation.css`, `dialog.css`, `field.css`, `inspector.css`, `messages.css`, `notifications.css`, `titlebar.css`, `workspace-onboarding.css`, and `design-language.css` still used raw `vw`. | Keep `base.css` as the only raw viewport width reader for the legal shell; all descendant width clamps use `cqw`. |
| Static contract tests | `overlay-window-size-contract.test.ts`, `workspace-surface-consistency.test.ts`, and `overlay-architecture-guards.test.ts` assert raw media query text. | Update them to require shell container query ownership and reject raw viewport width queries. |
| Browser visual tests | `left-pane-resizer-browser.test.ts`, `center-workbench-separator-browser.test.ts`, and `side-activity-toolbar-browser.test.ts` currently expect illegal narrow viewports to activate compact layout. | Change illegal narrow checks to assert the legal desktop frame remains active and capture replacement screenshots. |

## Root Cause

The legal size contract was split at the responsive trigger. Body layout and
zoom use the legal minimum frame, but CSS compact rules still read the raw
viewport width. In browser tests or embedded hosts that can expose a viewport
below `1120px`, `@media (width < 1120px)` activates compact panel rules while
the body is simultaneously clamped back to `1120px`. That creates the visible
mixed layout: full-width legal shell plus illegal compact panel heights and
toolbar placement.

## Fix Plan

1. Add a named inline-size query container to the legal body shell.
2. Replace the workspace and right-toolbar compact `@media (width < 1120px)`
   rules with `@container overlay-shell (width < 1120px)`.
3. Replace remaining width-based responsive rules with legal shell or
   component container queries.
4. Replace descendant panel `vw` width clamps with `cqw`, leaving `base.css`
   as the only raw viewport width owner for the legal shell itself.
5. Update static tests so compact rules and surface width clamps cannot read
   raw viewport width.
6. Update browser tests so illegal narrow viewports verify legal desktop frame
   behavior instead of accepting compact small-panel behavior.
7. Run focused static/unit tests, overlay typecheck, browser visual tests,
   inspect screenshots, self-review, commit, and push.

## Acceptance

- Raw viewport width below `1120px` cannot force overlay compact layout while
  the legal shell is still `1120px`.
- Left activity shell, chat/workspace, center workbench, and right toolbar keep
  legal desktop frame semantics in illegal narrow browser fixtures.
- Existing legal panel minimums and aspect frame sources remain unchanged.
- No JS dataset gate, duplicate size constant, fallback layout, or second panel
  width source is introduced.
- Focused tests, visual QA, self-review, commit, and push pass.

## Verification

- PASS: `bun test packages/overlay/test/overlay-window-size-contract.test.ts packages/overlay/test/workspace-surface-consistency.test.ts packages/overlay/test/pane-config.test.ts packages/overlay/test/center-workbench-size.test.ts packages/overlay/test/overlay-layout-frame.test.ts packages/overlay/test/provider-settings-layout.test.ts packages/overlay/test/titlebar-brand-guide-primitive.test.ts packages/overlay/test/executor-settings.test.ts packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/overlay-architecture-guards.test.ts --timeout 30000`
  - `180 pass`, `0 fail`, `7806 expect() calls`.
- PASS: `bun run --cwd packages/overlay typecheck`
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/center-workbench-separator-browser.test.ts`
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/left-pane-resizer-browser.test.ts`
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/side-activity-toolbar-browser.test.ts`
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/titlebar-menubar.test.ts`
- PASS: static scan confirmed production CSS raw `vw` remains only in
  `base.css`, where it constructs the legal shell frame.
- Visual QA: reviewed
  `.scratch/center-workbench-separator-illegal-narrow-legal-frame.png`,
  `.scratch/left-pane-resizer-illegal-narrow-legal-frame.png`,
  `.scratch/side-activity-toolbar-illegal-narrow-legal-frame.png`, and
  `.scratch/titlebar-illegal-narrow-legal-frame.png`.

## Self Review

- The legal body shell is now the named width query container. Overlay-wide
  compact decisions read that legal shell, and component-local compact
  decisions read their existing component containers.
- Center workbench separators no longer depend on a hardcoded `520px`
  viewport predicate; they render from the actual resize metrics and panel
  range.
- Descendant floating panels no longer use raw `vw` width clamps. `base.css`
  remains the single raw viewport width reader because it owns the legal
  overlay frame construction.
- No fallback path, duplicate size constant, JS gate, or compatibility branch
  was introduced.
