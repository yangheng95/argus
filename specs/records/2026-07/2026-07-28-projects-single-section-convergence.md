# Projects Single-Section Convergence

## Recall

| Item | Evidence |
| --- | --- |
| User requirement | Remove the `Chats` heading and place everything currently beneath it into `Projects`. The supplied desktop screenshot shows anonymous Project groups under `Chats`, a separate `Pinned` section, and named groups under `Projects`. |
| Acceptance criteria | The left Dock renders no `Chats` section heading or dedicated Chats group wrapper. Anonymous and named Project groups render exactly once beneath the existing `Projects` toolbar, retain their complete Chat/Mission/Task hierarchy and anonymous-project promotion action, and share the same Project renderer and layout. `Pinned` remains a separate complete-project section. Both by-Project and one-list organization include anonymous Project work. Focused unit tests, i18n validation, typecheck/build, a Node-launched real browser fixture, task-scoped screenshot inspection, document-health checks, second review, commit, and git-cc push pass. |
| Hard constraints | Desktop-only scope. Reuse `ProjectLedgerGroup`, `LedgerList`, the existing Projects toolbar, sort/organization preferences, and canonical Work Ledger rows. Do not add a second projection, compatibility selector, hidden heading, local state, fallback, gate, iframe, mock-only visual result, worktree, or process restart. Playwright runs through the existing Node browser runner against an isolated fixture. |
| Supplied artifact | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-67336ef6-c5f6-4bc2-99f6-3a51d37cabf0.png`, inspected at original resolution. |
| Read records | `specs/records/2026-07/2026-07-25-anonymous-project-chats-promotion-and-attachments.md`; `specs/records/2026-07/2026-07-27-anonymous-project-mission-classification-repair.md`; `specs/records/2026-07/2026-07-25-left-dock-hierarchical-grid-alignment.md`; `specs/current/architecture/07-panel.md`. The first two records established a dedicated Chats projection that the current user requirement now supersedes. |
| Whole-repository grep | `rg -n --hidden --glob '!node_modules' --glob '!dist*' "Chats|Projects|Pinned|Anonymous project" .`; `rg -n -C 5 "work_ledger\\.chats|work-ledger-chat-groups|work-ledger-chat-group|implicitProjectGroups|unpinnedGroups|work-ledger-project-group" packages/overlay/test packages/overlay/src -S`; `rg -n "work_ledger\\.chats" packages --glob '!sdk/openapi.json' -S`; `rg -n "work-ledger-chat-groups|work-ledger-chat-group" packages --glob '!dist*' -S`. Production ownership is confined to `WorkLedger.tsx`, the two locale keys, and one Chats-specific CSS wrapper. Direct tests are `anonymous-project-mission-classification.test.ts`, `work-ledger-top-level-alignment.test.ts`, `projects-toolbar.test.ts`, and `global-new-chat-provider-error-browser.test.ts`. |
| Independent agent feedback | None requested. This is one tightly coupled projection/render/test change; no sub-agent was authorized or needed. |

## Root Cause

The left Dock groups every backend Work Ledger row by its authoritative
`directory`, but the frontend then partitions that one collection a second time:
implicit dated directories become `implicitProjectGroups` and render through a
dedicated `Chats` wrapper, while non-implicit directories become
`projectGroups` and feed `Projects`. The one-list projection separately filters
implicit directories out. The visible split is therefore a real competing
frontend projection, not merely an extra label.

The correct replacement is to keep one grouped collection, partition only by the
existing persisted Project pin fact, and feed every unpinned directory to the
existing Projects `LedgerList`. Anonymous identity remains a directory property
used solely to expose the existing promotion action and anonymous display label;
it no longer determines section ownership or renderer identity.

## Call-Site Inventory

| Call site | Current behavior | Disposition |
| --- | --- | --- |
| `WorkLedger.tsx::renderGroups` one-list projection | Excludes implicit directories after excluding pinned groups. | Remove the implicit-directory filter so one-list Projects includes anonymous work. |
| `WorkLedger.tsx::implicitProjectGroups` | Creates a renamed duplicate projection for the Chats section. | Delete. |
| `WorkLedger.tsx::projectGroups` | Excludes implicit directories. | Replace with the canonical grouped collection. |
| `WorkLedger.tsx::pinnedProjects` | Selects explicitly pinned non-implicit Project groups. | Keep. |
| `WorkLedger.tsx::unpinnedGroups` | Receives only named Project groups. | Make it receive every non-pinned group. |
| `WorkLedger.tsx` Chats JSX | Renders heading, wrapper, and anonymous Project groups with dedicated data identifiers. | Delete. |
| `WorkLedger.tsx` Projects `LedgerList` child renderer | Does not pass anonymous-project presentation semantics. | Pass `isImplicitProjectDirectory(group.directory)` while retaining the single `work-ledger-project-group` renderer identity. |
| `en-US.json`, `zh-CN.json` | Define the now-dead `work_ledger.chats` label. | Delete the key in both locales. |
| `work-ledger.css` | Gives the dedicated Chats wrapper the same grid geometry as Pinned. | Delete the Chats selector; keep Pinned geometry. |
| `anonymous-project-mission-classification.test.ts` | Requires the dedicated Chats projection and excludes anonymous rows from Projects. | Reverse the contract: one Projects projection, no Chats wrapper/key, full anonymous hierarchy, promotion semantics retained. |
| `projects-toolbar.test.ts` | Verifies grouped/flat source selection but not anonymous inclusion. | Assert canonical groups feed Projects and the flat projection has no implicit-directory exclusion. |
| `work-ledger-top-level-alignment.test.ts` | Couples shared geometry to the Chats wrapper. | Retire that selector assertion and keep Projects/Pinned shared-grid evidence. |
| `global-new-chat-provider-error-browser.test.ts` | Waits for and measures a dedicated Chats group; uses its selector for promotion. | Verify no Chats heading/wrapper, assert anonymous and named directories are both Projects groups, preserve hierarchy/promotion, measure both against the Projects heading, and capture the converged Dock. |
| `launch.ts::settleForcedBrowserSidecarTermination` | Treats a nonzero Windows `taskkill /T /F` helper result as a terminal failure even when the canonical sidecar exit observation succeeds moments later; a disappearing enumerated descendant therefore creates a false browser-test failure. | Keep the bounded force attempt and canonical exit wait, but report the helper failure only when the sidecar also fails to exit. The observed sidecar exit becomes the single termination outcome. |
| `OverlayBrowserSidecar.browserProxy().close` | Overrides the shared 30-second browser RPC inactivity budget with a local 5-second close-only timeout, so a valid loaded Chromium shutdown is declared inactive before the canonical budget. | Delete the timeout fork and use `BROWSER_RPC_INACTIVITY_TIMEOUT_MS`; a genuinely inactive close still fails and enters the same forced termination path. |
| `browser-error-collector.test.ts` | Covers successful force+exit and force failure+no exit, but not the Windows descendant-disappearance race. | Add a force-failure+observed-exit regression and retain the aggregate failure assertion when exit is not observed. |
| `specs/current/architecture/07-panel.md` | Documents global launch ownership but not the current single section projection. | Record Projects as the sole unpinned directory section and anonymous identity as presentation/action semantics only. |
| `specs/README.md`, `specs/records/2026-07/README.md` | Do not index this decision. | Add this record as the latest Projects organization decision. |

## Implementation

1. Collapse the frontend partition to `groups -> pinnedProjects | unpinnedGroups`
   and include implicit directories in the existing one-list projection.
2. Delete the Chats JSX, data identifiers, locale key, and wrapper CSS; render
   anonymous groups through the same Projects `LedgerList` and data identity as
   named groups while passing the existing anonymous presentation boolean.
3. Update source tests and the production Overlay browser fixture to prove exact
   ownership, no duplicate rows, promotion continuity, shared geometry, and the
   absence of the Chats heading.
4. Build and run the browser fixture with Node, inspect the task-scoped screenshot
   at original resolution, then run a second diff review and documentation health
   tests.

The first browser replay exposed current fixture contract drift for
`/chat/capability`, Work Ledger Chat `experience`, and the Mission Skill catalog;
the fixture must use the same canonical response shapes as the other production
Overlay browser fixtures. A later replay completed the page workflow but exposed
the Windows sidecar-cleanup race recorded above. These are toolchain defects
encountered before the original checker could pass, so they are repaired and the
same checker is rerun rather than waived.

## Verification

- `bun test --timeout 30000 packages/overlay/test/anonymous-project-mission-classification.test.ts packages/overlay/test/projects-toolbar.test.ts packages/overlay/test/work-ledger-top-level-alignment.test.ts packages/overlay/test/browser-error-collector.test.ts`
  passed: 43 tests, 0 failures, 1,320 assertions.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/launch-sidecar.test.ts`
  passed: 3 tests, 0 failures.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/global-new-chat-provider-error-browser.test.ts`
  passed the real production-Overlay fixture. The inspected task-scoped screenshot
  `.scratch/projects-single-section-convergence.png` shows one `项目` heading,
  both the anonymous and named Project groups beneath it, and no `Chats`
  heading. The separately inspected
  `.scratch/anonymous-project-promotion-menu.png` shows that the anonymous group
  retains its promotion action.
- `bun run --cwd packages/overlay typecheck`, `bun run --cwd packages/overlay check:i18n`,
  and `bun run --cwd packages/overlay build:vite` passed.
- `bun test --timeout 60000 packages/opencorvus/test/script/historical-docs-links.test.ts`
  passed: 22 tests, 0 failures.
- `bun test --timeout 60000 packages/opencorvus/test/script/product-docs-single-source.test.ts`
  passed: 8 tests, 0 failures.
- `bun test --timeout 60000 packages/opencorvus/test/script/document-health.test.ts`
  reached the complete checker: 62 tests passed and its sole failure names eight
  independently edited, concurrently untracked July records that another task
  has already linked from the shared monthly index. This record is staged and is
  not among the offenders; rerun after those concurrent records settle.
- `git diff --check` passed before the final review.
