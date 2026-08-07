# Overlay Workspace Surface Continuity

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Codex visually fuses the window titlebar with the left rail and separately fuses the message surface with the expanded right dock. Overlay currently paints themes inconsistently; the light theme exposes a square-looking message-panel top-left corner, the workspace ambient diffusion is not visible along both the left and top edges, and the message-panel header style is wrong. |
| Acceptance criteria | The titlebar and left rail keep one `--rail-surface`; the message area, its header, and the open right dock use one continuous workspace material in light, dark, and VS Code dark; the workspace retains one clipped top-left radius in every theme; the message header and resting right-dock seams disappear as separate chrome; independent diffuse shadows are visible along both the workspace's left and top edges; focused source tests, three-theme rendered screenshots, manual visual review, and a second code review pass succeed. |
| Hard constraints | Visual-only change. No DOM fork, fallback, compatibility selector, gate, theme-specific geometry, new interaction state, mobile/tablet scope, worktree, or restart/refresh/termination of the user's running OpenCorvus/Overlay. Playwright is started by Node and uses an activity-reset inactivity timeout. Preserve unrelated dirty changes. |
| Sources read | `AGENTS.md`; `specs/records/2026-07/2026-07-10-overlay-codex-strict-parity-remediation.md`; `2026-07-13-codex-visual-style-alignment.md`; `2026-07-13-sidebar-surface-continuity.md`; `2026-07-13-overlay-shell-icon-and-message-axis-root-repair.md`; `2026-07-14-overlay-neutral-codex-chrome-repair.md`; current `App.tsx`, `design-language.css`, all three theme palettes, `titlebar.css`, `activity.css`, `sidebar.css`, `workspace.css`, `inspector.css`, `conversation.css`, and related source/browser tests. |
| Whole-repository search evidence | Enumerated every definition and consumer of `--rail-surface`, `--chat-canvas`, `--workspace-ambient-fill`, `--inspector-surface`, `--panel-body-bg`, `--ui-workspace-edge-shadow-*`, `.workspace-main`, `.right-dock`, `.right-dock-resizer`, and the single-corner tests. `App.tsx` proves the right dock is a child of `.workspace-main`; no DOM or state change is required. |
| Independent agent feedback | Not requested; no sub-agent spawned. |

## Root Cause Chain

1. The outer workspace owns the correct single top-left clipping radius, but its parent `.panel-body` is white in the light theme. The workspace and its parent therefore meet as white-on-white, making the clipped corner visually disappear as a right angle.
2. `--workspace-ambient-fill`, `--chat-canvas`, and `--inspector-surface` do not describe one material relationship. Light uses white, white, and a separate gray; dark themes map the same roles differently. The open right dock therefore reads as a second panel instead of the continuation of the message surface.
3. The right dock and its resize hit area draw resting vertical divider lines, which contradict the intended continuous surface even though the dock root itself is transparent.
4. The sole workspace shadow uses a negative horizontal offset but a positive vertical offset. It produces left/down diffusion, not independent left/top diffusion. A negative vertical replacement would still be clipped because `.panel-body` is an `overflow: hidden` parent whose top edge coincides with the workspace top edge. The top channel must therefore diffuse inward while the left channel diffuses outward. `--shadow-lg` otherwise adds theme-specific elevation in unrelated directions.
5. `.chat-header.oc-surface-header` inherits the generic `--oc-header-bg` material. Dark themes therefore paint a brighter strip above the message canvas even after the workspace and dock materials are unified. The message header needs to inherit its own workspace rather than the generic panel-header material.

## Call-Site Disposition

| Source | Decision |
| --- | --- |
| `styles/tokens/design-language.css` | Replace the diagonal workspace edge offset with explicit outward-left and inset-top diffusion tokens. Keep geometry theme-independent. |
| `styles/cascade/{light,dark,vscode-dark}.css` | Make `--panel-body-bg` the rail material and make both `--workspace-ambient-fill` and `--inspector-surface` aliases of `--chat-canvas`. The three themes keep their colors but share the same surface topology. |
| `styles/surfaces/workspace.css` | Compose two diffuse shadows, one for the left edge and one for the top edge; remove the unrelated generic elevation shadow. Remove resting dock/resizer seams while preserving the real resize hit area and hover/focus indicator. |
| `styles/surfaces/header.css` | Keep the shared header primitive intact, but make the existing message-header specialization transparent, borderless, and shadowless so it belongs to the message canvas. |
| `styles/surfaces/conversation.css` | Delete the redundant `.chat-header-main` `min-width` declaration after explicit user approval; the shared `.oc-surface-header__main` primitive remains its only owner. |
| `styles/surfaces/{titlebar,sidebar,conversation,inspector}.css` | No new styling source. Existing rail and workspace consumers inherit the corrected semantic topology. |
| Source tests | Pin the two-region material topology, independent edge shadows, single corner, and seam-free dock. |
| Browser benchmark | Render the actual shell relationship with an open right dock for all three desktop themes; assert material equality and geometry, capture screenshots, and inspect them at original resolution. |

## Verification Plan

1. Run focused token, palette, workspace, right-dock, and corner source tests.
2. Run the Node-started three-theme workspace-continuity browser benchmark with inactivity-based timeout.
3. Inspect all three screenshots and iterate until the corner, left/top diffusion, and right-dock continuity are visually correct.
4. Run Overlay typecheck, i18n, build, historical/document health, and scoped diff checks.
5. Review the final source and screenshots a second time before commit and legacy remote push.

## Progress

- [x] Recall existing decisions and enumerate all related sources/call sites.
- [x] Establish the causal chain and single-source design.
- [x] Implement the material topology and independent edge diffusion.
- [x] Add and pass source/browser regressions.
- [x] Complete visual and code second review.
- [ ] Commit with `dsw-33987` prefix and push to `legacy-remote`.

## Result

- The titlebar and left rail now share the rail material, while the message canvas, transparent message header, and expanded right dock share the chat material in light, dark, and VS Code dark themes.
- The light-theme top-left corner is visibly clipped against the rail backing instead of disappearing into a white parent surface.
- The workspace owns separate outward-left and inset-top diffuse shadows. The open dock and resting resize hit area no longer draw competing seams; hover and keyboard-focus feedback remain intact.
- The redundant `.chat-header-main` width declaration was deleted after explicit user approval. `.oc-surface-header__main` is the single remaining owner.
- Focused source coverage passed: 87 tests, 0 failures across 12 files. Node-started Playwright coverage passed for the three-theme continuity fixture, the light-theme reference, and the current titlebar/message-header/right-dock fixture.
- Overlay `typecheck`, `check:i18n`, and `build:vite` passed. Historical document links passed 20/20 and product-document single-source checks passed 4/4.
- Visual evidence was reviewed at original resolution: `.scratch/workspace-surface-continuity-{light,dark,vscode-dark}.png` and `.scratch/codex-message-header-toolbar-{closed,open}.png`. The second review confirmed the shared materials, single rounded corner, both diffusion channels, corrected message header, and absence of a visible fixture error notification.

## Known Unrelated Repository Failures

The full document-health suite still reports three pre-existing/concurrent dirty-worktree failures outside this change: generated SDK/OpenAPI compatibility fields, an expert-squad prompt scan exceeding that test's fixed five-second process timeout, and monthly-index references to eight concurrent untracked specs. Expanded elevation coverage also reports existing literal `z-index` values in `composer.css` and `inspector.css`. None of those files or behaviors is changed as part of this surface-continuity repair.

## Browser Tool Note

The in-app Browser rejected a local `file:` preview because of its URL security policy. No localhost workaround or alternate browser was introduced. The required visual verification instead used the repository's Node-started Playwright fixtures and their rendered screenshots, without touching the user's running Overlay process.

## Delivery Status

Implementation commit `9535bb7808` and the earlier plan commit `e26e4b749f` are complete locally. The required `git push legacy-remote v0.0.3beta` was attempted without bypassing hooks, but the repository-wide pre-push typecheck failed in concurrent uncommitted `packages/opencorvus` browser-preview and frontend-design changes. The failures are missing contract members such as `sourcePackageAbsolute`, `sourcePackageRelative`, `webpageEvidenceAbsolute`, and `primaryWebpageEvidenceArtifacts`; none originates in this task's staged or committed files. The push therefore remains honestly incomplete. The shared dirty changes were not stashed, overwritten, staged, or folded into this repair.
