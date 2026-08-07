# Desktop Left Rail and Mailbox Refinement

Status: implemented and verified

## Recall

| Item | Detail |
| --- | --- |
| User request | Apply six desktop-client refinements from the supplied screenshots: hide Work Ledger stop/download controls while retaining their behavior; align the rightmost hover action for Projects, Project, Task, Chat, and Mission rows; restore the dark message-workspace top-left corner; move a pinned Project and all of its Task/Chat/Mission rows under Pinned while preserving row navigation; hide the workspace Search action while Mailbox is selected; and reduce the Mailbox tab/search prominence while improving the overall list hierarchy. |
| Acceptance criteria | In the Tauri desktop client, stop and project-download controls are absent from Task/Mission/Chat hover rails but their callbacks/services remain available to other hosts. The trailing action centers of the Projects toolbar, Project header, and Task/Chat/Mission rows differ by at most one rendered pixel. A pinned Project appears exactly once, as a complete expandable group under Pinned, and every child row invokes the same detail-selection path as an unpinned row. Selecting Mailbox hides the workspace Search button and returning to Projects restores it. Mailbox uses compact primitive sizes, a compact control row, restrained card/list hierarchy, intact archive/read/open behavior, and keyboard focus. The dark production page visibly clips the message workspace to its top-left radius. Focused tests, Overlay typecheck/build, Node-launched desktop browser runs, task-scoped screenshots, original-resolution review, second diff review, commit, and legacy remote push pass. |
| Hard constraints | Desktop-only scope; do not add mobile/tablet/responsive work. Reuse the existing Button, SearchField, SegmentedControl, Accordion, Badge, Avatar, ProjectLedgerGroup, and navigation-row primitives. Keep Project pin persistence and `setWorkLedgerProjectPinned` as the only pin source; add no local pin shadow state or alternate group renderer. Keep `.workspace-main` as the single workspace-radius owner. Do not remove stop/download services or callbacks, add a fallback/gate, create a worktree, or restart/refresh/close the user's running OpenCorvus/Overlay. Playwright must be started by Node.js against an isolated page. Commit subjects start with `dsw-33987`, and pushes go to `legacy-remote`. |
| Supplied evidence | Six screenshots show: stop/download/rename/archive crowding the selected Work Ledger row; row-family action endpoints drifting; a square dark workspace corner; a pinned Project shortcut duplicated above its complete Project group; Search remaining beside the active Mailbox launcher; and an oversized two-row Mailbox control block with full-bleed low-hierarchy message rows. Original files are the six `codex-clipboard-*.png` paths supplied in the user request. |
| Sources read | Root `AGENTS.md`; Browser control skill; `specs/README.md`; July record index; `2026-07-20-work-ledger-session-pin-retirement.md`; `2026-07-20-project-hover-boundary.md`; `2026-07-20-projects-toolbar-organization-and-create-menus.md`; `2026-07-20-opaque-neutral-shell-left-rail.md`; `2026-07-20-left-rail-resting-seam-retirement.md`; current `App.tsx`, `WorkLedger.tsx`, `ProjectLedgerGroup.tsx`, `MailboxPanel.tsx`, workspace/titlebar/sidebar/work-ledger/mailbox CSS, host transport, design tokens, and focused/browser tests. |
| Whole-repository search evidence | `App.tsx` is the only workspace Search/Mailbox launcher owner. `WorkLedger.tsx` is the only Task/Mission/Chat action renderer and the only consumer of `setWorkLedgerProjectPinned`; its `pinnedProjects` section renders a Project-only shortcut while the main `LedgerList` still consumes every group. `ProjectLedgerGroup` is the single complete Project+children renderer. `work-ledger.css` owns row action widths; `sidebar.css` owns the row's 6px trailing padding and the Project's 20px action buttons; `design-language.css` owns the shared Project action centerline. `MailboxPanel.tsx` is the only mailbox renderer and already uses the mature primitives, but it leaves both SegmentedControl/SearchField at their default medium root sizes and stacks them as full-width rows. `mailbox.css` is the only Mailbox surface owner. `.workspace-main` is declared only in `workspace.css`, already owns `border-radius: var(--oc-radius-xl) 0 0 0` and `overflow: hidden`, and is covered by computed-radius tests; the supplied screenshot proves the running artifact's square corner but does not prove whether its loaded bundle predates that source repair. Stop/download call sites also remain in `main.tsx`, task/mission services, route contracts, and download service tests; those functional paths are preserved. Direct regression owners are the Work Ledger consolidation/service tests, Mailbox panel/contextbar tests, left-rail density/alignment tests, workspace continuity tests, and the existing Node browser fixtures for Work Ledger, Mailbox, and workspace continuity. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration boundary forbids unrequested delegation. |
| Git baseline | `HEAD`, `work-v0.0.12beta-yr-0720`, and `legacy-remote/work-v0.0.12beta-yr-0720` resolve to `287779bc42623f2f5c3b14daf584bfad9e5c7d4c`; the pre-change push passed hooks and reported everything up to date. |

## Causal Chain

1. **Desktop action clutter:** `WorkLedgerRowView` renders stop and download whenever row state permits, with no host presentation boundary. The callbacks and services are correctly separate, so the desktop can omit only those two controls without deleting behavior.
2. **Trailing-axis drift:** the Project action button is 20px wide and ends at the canonical Project-list edge, placing its center 10px inward. A Work Ledger action is 18px wide but the Task row adds 6px trailing padding, placing its center 15px inward. Dynamic action count changes rail width, but the last icon's five-pixel center error is the fixed padding mismatch.
3. **Pinned hierarchy duplication:** `pinnedProjects` feeds a Project-only shortcut above the scroll owner, while the main list still receives `groups()`. The same group is therefore rendered in two different forms, and the shortcut has no child-row selection path. The replacement is to partition the one group collection and render pinned groups through the same `WorkLedgerProjectGroupView` used everywhere else.
4. **Search visibility:** Search and Mailbox are unconditional siblings in `App.tsx`; only the sidebar header actions currently respond to `mailboxActive`. Search therefore remains visible after the surface switch.
5. **Mailbox hierarchy:** the mailbox passes `data-size="sm"` to segmented items, but primitive sizing belongs to the SegmentedControl root. Search also defaults to medium. Full-width stacking, full-bleed divided rows, and strong unread fills make controls and row backgrounds compete with message content.
6. **Dark corner:** the supplied artifact shows an observable square boundary. Current source and tests already describe a single rounded/clipped workspace owner, so the exact loaded-artifact trigger is unknown until the current production bundle is rendered. Verification must inspect the real dark corner pixels; any implementation change, if still needed, belongs only to `.workspace-main` and its existing surface test.

## Call-Site Disposition

| Surface | Decision |
| --- | --- |
| `WorkLedgerRowView` | Derive desktop-host presentation from the canonical host transport. Exclude stop/download from the Tauri action count and rendered hover rail, while keeping `canStop`, `canDownload`, callbacks, services, and non-Tauri behavior. |
| Work Ledger group derivation | Keep one `groups()` source, derive pinned and unpinned partitions, and build one-list mode from unpinned items only so no pinned child is duplicated. |
| `WorkLedgerProjectGroupView` | Reuse unchanged selection callbacks for both partitions. Add only a section-specific `data-ui` input if required for unique test/DOM identity; do not duplicate Project or child markup. |
| Pinned section | Move it inside the existing Work Ledger scroll owner and render complete Project groups. Delete the Project-only shortcut and its dedicated unpin overlay styles. Unpin remains the existing Project menu action. |
| Work-row trailing geometry | Replace the unrelated literal trailing padding with a calculation from the canonical Project action half-size and the Work Ledger action size, keeping the same centerline for every row kind and action count. |
| `App.tsx` context actions | Render workspace Search only when Work Ledger is active; keep Mailbox toggle mounted so focus and return navigation remain stable. |
| `MailboxPanel.tsx` | Pass `size="sm"` to SegmentedControl and SearchField, place them in one compact controls row, and keep all existing data/action/state ownership. Retain mark-all-read and refresh as accessible primitive actions with compact chrome. |
| `mailbox.css` | Keep one surface owner; reduce header gaps/padding, give the compact controls a balanced grid, and convert full-bleed divided items into restrained rounded rows with quieter unread/attention hierarchy and preserved focus/archive/expanded content behavior. |
| `.workspace-main` | Do not change speculatively. Rebuild and run the current dark production fixture first; preserve the single radius/clip owner. If the current build still renders square, repair this one rule and add pixel-backed evidence. |
| Tests | Update source regressions for host-scoped action visibility, partitioned full-group pinning, conditional Search, compact Mailbox primitive roots, and canonical trailing-axis math. Update real browser fixtures to click pinned child rows, prove detail selection, measure all rightmost action centers, prove desktop stop/download absence, verify Mailbox control geometry/Search visibility/keyboard behavior, and capture light/dark screenshots. |
| Documentation | Index this record in `specs/README.md` and the July records README, then run historical-link, document-health, and product-doc single-source checks. |

## Verification Plan

1. Update focused regressions first so the old pinned shortcut, unconditional Search, medium Mailbox roots, desktop stop/download controls, and five-pixel trailing drift are rejected.
2. Implement the single-source Work Ledger partition/renderer reuse, desktop presentation boundary, trailing-axis correction, conditional Search, and primitive-based Mailbox refinement.
3. Run focused Bun tests, Overlay TypeScript/i18n/build, documentation health, and `git diff --check`.
4. Run the existing isolated desktop browser fixtures through Node.js. Capture task-scoped Work Ledger pin/action-alignment and Mailbox light/dark evidence, plus the three-theme workspace surface screenshots.
5. Inspect screenshots at original resolution, iterate on actual visual defects, re-run focused checks, review the final diff and exact call-site searches, then commit and push the verified branch through legacy remote hooks.

## Progress

- [x] Supplied screenshots, current source, history, tests, call sites, and git baseline inspected.
- [x] Recall, causal chain, call-site disposition, and verification plan recorded.
- [x] Focused regressions updated.
- [x] Implementation complete.
- [x] Static and browser verification complete.
- [x] Original-resolution visual review and second code review complete.
- [x] Final commit and legacy remote push complete.

## Verification Results

- The Tauri fixture renders zero stop/download controls while preserving rename/archive and the underlying stop/download callbacks. The browser-host inspection still renders those controls, proving the behavior was retained rather than deleted.
- A pinned Project is rendered once through `ProjectLedgerGroup`, with all Task/Chat/Mission rows under Pinned; selecting a pinned Task loads its normal center detail, and unpin/repin moves the complete group between the two sections.
- Rendered trailing-action centers for Projects, Project, Mission, Chat, and Task resolve to the same pixel centerline within the one-pixel tolerance.
- Mailbox selection hides workspace Search, uses the compact one-row tab/search controls, retains read/archive/restore/refresh and keyboard interaction, and returns focus and the Work Ledger surface when toggled closed.
- The first rebuilt dark fixture reported a non-zero radius and appeared rounded, but that evidence did not cover the user's real detail layout and its background assertion compared two transparent elements. The later user screenshot disproved the “older artifact” inference; the dark-corner follow-up below supersedes that incorrect conclusion.
- Focused source tests: 33 passed. Overlay typecheck and Vite production build passed. The combined Node-launched browser suite passed all 6 scenarios across Work Ledger, Mailbox, project grouping, titlebar switching, and light/dark/VS Code dark workspace continuity. Documentation checks and push-hook verification remain the final handoff steps.

## Dark-Corner Follow-up Recall

| Item | Detail |
| --- | --- |
| User correction | The user supplied a new dark-theme screenshot of the real Mission detail surface. At the exact boundary between the dark left rail and message canvas, the canvas is visibly square despite the source declaring a non-zero top-left radius. |
| Revised acceptance | The real production App shell with a selected Task/Mission detail must visibly expose rail-colored pixels outside the rounded workspace corner in dark and VS Code dark, not merely report a non-zero computed radius. The corner backing, the workspace interior, and the rail must be measured as distinct semantic materials, and the delivered screenshot must show the curve at original resolution. |
| New evidence | `.workspace-main` remains the only radius and clip owner. `.panel-body` is intentionally transparent, so the visible material behind its clipped child is `body --body-bg`. Light maps `--body-bg` to `--rail-surface`, but dark and VS Code dark map `--body-bg` to the same color as `--chat-canvas`. The rounded area is therefore clipped correctly and then visually filled by an identical backing color. |
| Test failure analysis | `workspace-surface-continuity-browser.test.ts` compared `.panel-body` with `.sidebar`; both are transparent, so its “clipped workspace corner must reveal rail” assertion passed without testing the composited backing. The earlier real-App assertion checked only `borderTopLeftRadius != 0` and `overflow: hidden`. These observations explain why the prior verification passed while the user-visible defect remained. |
| Whole-repository search revision | Re-enumerated `--body-bg`, `--rail-surface`, `--chat-canvas`, `--workspace-ambient-fill`, `.panel-body`, `.workspace-main`, `.sidebar`, and all corner/browser tests. `body` is the sole opaque backing behind the transparent panel; all three palette files are the only token sources; the architecture guard requires `.panel-body` to remain transparent; no second radius owner or theme-specific geometry is needed. |
| Corrective design | Make `--body-bg` alias `--rail-surface` in dark and VS Code dark, matching the existing light topology. Keep `.panel-body` transparent and `.workspace-main` as the sole radius owner. Replace the false transparent-to-transparent browser assertion with body/rail backing equality plus backing/workspace inequality, add screenshot pixel sampling to the three-theme shell fixture, and verify the same material inequalities plus an original-resolution screenshot in a production selected-Task App shell. |

## Dark-Corner Follow-up Result

- Dark and VS Code dark now use the rail material as the opaque window backing while the message workspace keeps its existing canvas material and sole 24px clipped corner.
- The corrected browser regression rejects a non-zero-but-invisible radius: it checks body/rail equality, backing/workspace inequality, the actual clipped-corner pixel, and an interior workspace pixel in all three themes.
- The production selected-Task fixture asserts the same material relationship and its full-page screenshot visibly shows the curve at the exact boundary reported by the user. An isolated production App preview independently reported `body = rail = rgb(38, 40, 44)`, `workspace = rgb(26, 27, 30)`, `radius = 24px`, and `overflow = hidden`.
- Focused palette/architecture coverage passed 141 tests; workspace continuity, selected-Task Work Ledger, and titlebar/detail browser runs passed; Overlay typecheck and production build passed; documentation health passed 87 tests when run without unrelated parallel resource contention.
