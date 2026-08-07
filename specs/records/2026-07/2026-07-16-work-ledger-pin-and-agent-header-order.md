# Work Ledger Pin And Agent Header Order

## Recall

| Item | Detail |
| --- | --- |
| User request | Make the pinned pushpin match the supplied Work Ledger crop; in the Agent-card header, move elapsed time directly after the persisted clock time and shift the hover action buttons to the far right. |
| Acceptance criteria | Mission/Chat row pin actions keep the supplied angled Lucide pushpin identity and render at the established optically enlarged footprint; the Agent header reads identity/status, persisted time, elapsed time, then a right-aligned hover/focus action rail; compact child-Agent timing, generic card headers, user-message footer actions, pin/unpin behavior, accessible labels, keyboard focus, and tooltips remain intact; focused tests, typecheck/build, Node-started browser checks, and manually reviewed desktop screenshots pass. |
| Hard constraints | Reuse the existing `pin-tilted`, `Button`, `CardDurationChip`, `ChatBubbleIdentity`, and `CardHeaderChrome` owners; do not add a second icon, duration source, renderer, fallback selector, mobile/tablet scope, or state machine; do not restart, refresh, or close the user's running OpenCorvus/Overlay; run Playwright through Node against isolated fixture servers; preserve unrelated dirty Expert Squad and generated-payload changes. |
| Supplied evidence | The first 408 x 88 crop highlights an angled pushpin immediately before the archive action. The second 1094 x 89 crop shows the current incorrect Agent order: the action rail precedes `50m 56s`; the user explicitly requests elapsed time beside `03:29:18 PM` and the buttons farther right. |
| Sources read | `AGENTS.md`; Browser control skill; both supplied images; `specs/current/architecture/12-overlay-card-system.md`; `2026-07-12-work-ledger-pin-unpin.md`; `2026-07-14-left-dock-vertical-density.md`; `2026-07-15-work-ledger-icons-and-popup-surface-unification.md`; `2026-07-15-agent-card-time-and-action-chrome.md`; `2026-07-16-project-pin-optical-size-repair.md`; `2026-07-16-card-header-metadata-and-conversation-scale.md`; current `ChatBubble.tsx`, `CardHeaderChrome.tsx`, `WorkLedger.tsx`, `ProjectLedgerGroup.tsx`, `Icon.tsx`, `base.css`, `chat-bubble.css`, `work-ledger.css`, `sidebar.css`, and focused source/browser tests. |
| Whole-repository search evidence | `CardDurationChip` has two production header owners: generic `CardHeader` and conversation `ChatBubble`; within `ChatBubbleIdentity` it also owns compact child-Agent timing. The top-level Agent currently suppresses that inline chip, mounts `ChatBubbleActions`, then mounts a trailing duration. `pin-tilted` has one registry entry and one shared transform; its three call sites are project-group pin, Mission/Chat row pin, and the pinned-project leading glyph. Mission/Chat row pin geometry is owned by the existing `work-ledger.css` action rail. Regression call sites are `chat-bubble.test.ts`, `card-duration-single-source.test.ts`, `agent-card-separation-browser.test.ts`, `chat-bubble-disclosure-button-browser.test.ts`, `focused-popup-surface.test.ts`, `work-ledger-consolidation.test.ts`, `command-palette.test.ts`, and `titlebar-toolbar-toggle-browser.test.ts`. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |
| Git baseline | Work started from `5641172a1`, equal to `legacy-remote/work-v0.0.6beta-yr-0716`. During verification, the parallel reasoning-terminology owner committed `1e2da8096` on the same branch; this task continued from that new local `HEAD` while preserving unrelated Expert Squad, payload, and remaining spec-index changes. |

## Diagnosis

The Agent header's visual defect is the markup order, not flex timing. The top-level branch calls `ChatBubbleIdentity` with `duration={false}`, then renders `ChatBubbleActions`, then renders `CardDurationChip`. Because identity meta is the only flexible item, the toolbar sits before elapsed time while the elapsed chip occupies the trailing edge. Restoring the shared duration inside `ChatBubbleIdentity` places it immediately after the persisted timestamp and leaves the action rail as the final flex item.

The Work Ledger already consumes the requested shared angled pushpin and the July optical-size correction. The baseline browser rendered a Mission pin at 18 x 18 pixels with a 17.82-pixel transformed glyph inside the established 18-pixel button; the existing browser assertion still expects the pre-correction 14-pixel glyph and fails before writing current screenshot evidence. Reintroducing another pin implementation or local transform would create a forbidden second source. This task therefore corrects the stale rendered contract, captures the current Mission/Chat action rail, and changes production pin geometry only if the fresh screenshot still differs from the supplied reference.

## Call-site disposition

| Surface | Decision |
| --- | --- |
| Top-level non-user `ChatBubble` header | Stop suppressing `ChatBubbleIdentity` duration and delete the trailing duplicate chip, producing time -> elapsed -> rightmost actions. |
| Compact child-Agent `ChatBubbleIdentity` | Preserve existing inline duration behavior. |
| Generic `CardHeader` | Preserve its separate action -> duration order; the user request is scoped to the pictured Agent conversation header. |
| User message footer | Preserve timestamp/actions order and hover behavior. |
| `CardHeaderChrome` / `CardDurationChip` | Preserve data sources, formatting, ticking, metadata tooltip, and action behavior. |
| `pin-tilted` registry and shared transform | Keep as the only pushpin identity and optical correction. |
| Project-group and pinned-project pin call sites | Preserve; the supplied crop targets the Mission/Chat Work Ledger row action. |
| Mission/Chat row pin call site and action rail | Preserve behavior and current computed geometry; update stale browser geometry coverage and capture a fresh screenshot. |
| Focused source/browser tests | Replace the old trailing-duration topology assertions with timestamp-adjacent duration and rightmost-toolbar geometry; assert the corrected pin footprint without weakening button containment or action order. |

## Verification plan

1. Update source regressions before production markup so the requested order is explicit.
2. Change only the top-level Agent header composition and remove the duplicate trailing duration.
3. Run focused unit tests, Overlay typecheck/i18n/build, and spec-health checks.
4. Run the existing Agent-card and Work Ledger fixtures through the Node browser runner, capture scoped screenshots, inspect them at original resolution, and correct any visual mismatch.
5. Review the exact task diff twice, stage only task-owned hunks, commit with the `dsw-33987` prefix, push the current branch to `legacy-remote`, and leave unrelated dirty files untouched.

## Progress

- [x] Recall, prior decisions, complete call-site search, and baseline browser diagnosis.
- [x] Focused test-contract update and production implementation.
- [x] Typecheck, i18n, production build, and focused documentation verification.
- [x] Fresh screenshot review and second review.
- [x] Task-only commit and legacy remote push.

## Codex review feedback

The first full `titlebar-toolbar-toggle-browser` run reached and accepted the new pin geometry, then failed later because the suite still waited for the retired Review secondary toolbar and Changes/Diff tabs. Current production, focused source tests, and `2026-07-16-review-changes-and-empty-dock-alignment.md` all require the opposite: ordinary Review opens `data-active-view="changes"` with no secondary header or view-tab DOM. The stale browser assertion was replaced with that current canonical contract. The unmodified full suite then passed end to end; no Review production behavior was changed.

## Verification result

| Check | Result |
| --- | --- |
| Focused source tests | Passed: 40 tests, 0 failures, 667 expectations across ChatBubble, card timing/chrome, shared pin identity, Work Ledger, and startup chrome. |
| Overlay typecheck and i18n | Passed. |
| Production build | Passed: Vite transformed 2,456 modules and emitted the production bundle; the existing large-chunk advisory remains informational. |
| Agent-card Node browser fixture | Passed. Computed geometry proves persisted timestamp precedes elapsed time, elapsed time precedes the action rail, and the action rail right edge equals the identity-row right edge. |
| Work Ledger/titlebar Node browser fixture | Passed both subtests. Mission/Chat pins render from the shared 18-pixel action box with an approximately 19.8-pixel transformed angled glyph, and the complete surrounding toolbar/Right Dock workflow remained valid. |
| Command Palette Node browser fixture | Passed. The project pin uses the same shared optical transform and renders 20 x 20 pixels while adjacent action glyphs remain 14 x 14 pixels inside unchanged 18-pixel buttons. |
| Documentation checks | Passed on the exact staged delivery: 78 tests, 0 failures, 1,216 expectations across historical links, document health, and product-doc single source. The earlier pre-staging run's expected untracked-record failure and transient five-second scan timeout both cleared on the unchanged staged rerun. |
| Whitespace | Scoped `git diff --check` passed. |

## Visual review

- `.scratch/agent-card-separation-light.png` and `.scratch/agent-card-separation-dark.png`: reviewed at original resolution. Each top-level Agent header reads identity/status -> clock time -> elapsed time, while metadata/copy controls stay at the far right in both themes.
- `.scratch/work-ledger-mission-actions.png` and `.scratch/work-ledger-chat-actions-visible.png`: reviewed at original resolution. The angled pin has stronger optical weight than edit/archive without shifting or overlapping the compact rail.
- `.scratch/overlay-sidebar-project-actions.png`: reviewed at original resolution. The same pin identity remains centered and legible beside plus/delete, with unchanged row height and spacing.

## Second review

- `CardDurationChip` still has one timing/formatting implementation; the Agent composition moved the existing chip rather than creating a second duration source.
- Compact child-Agent timing and generic `CardHeader` ordering are unchanged.
- All pin surfaces still resolve through the one `pin-tilted` registry entry and one shared CSS transform; no feature-local icon or transform was added.
- Pin/unpin event handling, tooltips, accessible names, keyboard focus, action order, button sizes, and row geometry are unchanged.
- The user's running OpenCorvus/Overlay process was not stopped, refreshed, restarted, or used as a test target; all browser evidence came from isolated Node-started fixtures.

## Delivery result

- Implementation commit: `2e0a596fe` (`dsw-33987 align pinned actions and agent timing`).
- The mandatory legacy remote pre-push hook passed SDK import/runtime checks, typecheck across 10 packages, API route inventory, rendered API documentation, Overlay i18n, and secret scan.
- `legacy-remote/work-v0.0.6beta-yr-0716` advanced from `1e2da8096` to `2e0a596fe`; unrelated dirty Expert Squad, payload, and Review-index work remained outside the delivery commit.
