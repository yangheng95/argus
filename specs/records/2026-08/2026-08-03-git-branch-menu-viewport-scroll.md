# Desktop Git Branch Menu Viewport and Scroll Verification

## Recall

| Subject                    | Recorded fact                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request               | Verify the desktop Git branch dropdown in the current OpenCorvus repository: keep the menu inside the screen, scroll long branch lists inside the menu, and reduce branch-row height. Use the complete `packages/overlay` Vite page for real interaction, screenshots, and human visual review.                                                                 |
| Acceptance                 | The complete menu frame stays within the desktop viewport near edges and the bottom; a real overflowing local-branch list scrolls from first to last without moving the background; rows use the canonical 26-pixel scaled navigation density with unclipped text, icons, current-branch check, and selected state; task-owned processes remain isolated.       |
| Hard constraints           | Do not add, modify, update, or run user interface automation tests. Do not restart, refresh, close, reuse, or otherwise disturb the running OpenCorvus or Overlay. Drive Playwright with Node, not Bun. Do not create a worktree, add a fallback, duplicate a data source, add a gate, or scatter hard-coded geometry. Preserve unrelated working-tree changes. |
| Canonical artifacts read   | The user-provided `image.png`, `TaskDirBar.tsx`, `conversation.css`, `dropdown-menu.css`, `DropdownMenu.tsx`, Overlay package scripts, Vite configuration, and the density and shell-size tokens.                                                                                                                                                               |
| Existing records read      | `specs/README.md`, the August records index, and the isolation precedents named by the canonical research report. There is no `specs/records/README.md`; the root and monthly indexes are the applicable sources.                                                                                                                                               |
| Git baseline               | Branch `work-v0.0.29beta-yr-0803` tracks `legacy-remote/work-v0.0.29beta-yr-0803`. The task-start checkpoint `d1f095cc3e` captured only the branch-menu rules in `conversation.css`. The unrelated unstaged `card.css` and Conversation error-indicator record changes remain excluded from this delivery.                                                            |
| Whole-repository search    | Searches covered `ProjectRuntimeStatusPanel`, `ProjectRuntimeToolbarActions`, the branch menu and option classes, VCS service functions and routes, `Vcs.branches` / `Vcs.switchBranch`, shared menu primitives, the navigation density token, standalone Vite configuration, runtime-root isolation, generated SDK routes, records, and the Overlay test tree. |
| Test-path audit            | No test under `packages/overlay/test` references the branch-menu renderer, selectors, or component. `meta-vcs-branches.test.ts` is a non-UI transport/store contract and remains untouched. Existing unrelated browser fixtures found by filename search are outside the touched product path and are not run.                                                  |
| Independent Agent feedback | A bounded read-only child session was asked to perform visual review. Its terminal receipt contained no usable review body, so it was not treated as acceptance evidence. The parent session performed the complete real-page review.                                                                                                                           |
| Attachment boundary        | The user screenshot was read at its original 1234 × 1696 dimensions and identified the overflowing Git branch menu, its excessive row height, and the intended desktop delivery surface.                                                                                                                                                                        |

## Call-point inventory and disposition

| Call point                                                                          | Disposition                                                                                                                                                            |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TaskDirBar.tsx::ProjectRuntimeStatusPanel`                                         | Keep the sole Kobalte DropdownMenu renderer, `fitViewport`, right-start placement, open-time branch load, exact current check, and real branch switch.                 |
| `TaskDirBar.tsx::ProjectRuntimeToolbarActions` and `App.tsx`                        | Keep the sole wrapper and chat-header mount. Do not create a fixture-only renderer.                                                                                    |
| `conversation.css::.project-runtime-control-menu`                                   | Keep the shared shell-relative width bound.                                                                                                                            |
| `conversation.css::.project-runtime-branch-menu`                                    | Verify the task checkpoint's single internal scroll container and shell-relative block-size bound in the real page; replace only if observed geometry proves it wrong. |
| `conversation.css::.project-runtime-branch-menu .project-runtime-control-menu-item` | Verify the task checkpoint's canonical navigation-row minimum, compact padding, and line height against real content and states.                                       |
| `design-language.css::--oc-density-navigation-row`                                  | Keep the existing 26-pixel scaled token as the sole density source.                                                                                                    |
| `DropdownMenu.tsx` and `dropdown-menu.css`                                          | Keep the shared mature Kobalte wrapper and recipes unless evidence proves a shared root defect.                                                                        |
| `services/meta.ts`                                                                  | Keep the real `GET vcs/branches` and `POST vcs/branch` boundary.                                                                                                       |
| `server/routes/app.ts` and generated SDK routes                                     | Keep the existing project-scoped branch-list and switch contracts.                                                                                                     |
| `project/vcs.ts`                                                                    | Keep real `refs/heads` enumeration, current-first ordering, and exact local-branch switching.                                                                          |
| `packages/overlay` Vite entry and settings                                          | Use the complete production entry on an isolated dynamic port and connect through the real server URL setting.                                                         |
| Overlay UI tests, fixtures, and baselines                                           | No branch-menu UI test exists. Do not run or modify unrelated UI automation.                                                                                           |

## Single implementation decision

The menu continues to have one geometry and interaction implementation: Kobalte owns
dynamic placement and viewport fitting, while `.project-runtime-branch-menu` owns the
one bounded internal scrolling box and its branch-specific compact density. The real
page determines whether the checkpointed rules are correct. A failure must be traced
to the actual positioner, containing-block geometry, CSS cascade, or scroll ownership
and fixed at that sole owner; no second renderer, query override, synthetic branch
data, fallback, or host-side gate is permitted.

## 2026-08-04 follow-up

### Recall

- User feedback: the real branch menu remains too tall; its maximum height should be
  approximately half of the desktop screen.
- Acceptance: preserve the existing compact rows, current-branch state, Kobalte
  placement, and single internal scroll container while limiting the menu to 50% of
  the canonical Overlay shell height.
- Re-inspection confirmed that `TaskDirBar.tsx` has one branch-menu renderer and
  `conversation.css::.project-runtime-branch-menu` remains its only block-size owner.
- The required read-only Claude Code invocation again used CLI version `2.1.147`, but
  authentication failed with `Not logged in`; no Claude output is acceptance evidence.

### Follow-up decision

Replace the near-full-shell maximum with one relative bound derived from
`--ui-overlay-shell-height`. Do not change the mature DropdownMenu primitive, branch
rows, placement, data loading, or switching behavior.

### Follow-up evidence

- The complete Overlay Vite page ran on isolated port `4174` against the healthy real
  backend and current repository. The headed Node-driven Playwright interaction used
  the real 42-branch response without a fixture, network interception, or query
  override.
- The canonical Overlay shell measured approximately 1,234 pixels high and the open
  branch menu measured 617.14 pixels high. Its `clientHeight` was 616 pixels and its
  `scrollHeight` was 1,111 pixels.
- A real wheel gesture moved the internal menu from `scrollTop=0` to 494.86 pixels.
  Human review of fresh top and bottom screenshots confirmed complete borders,
  unclipped icons and labels, the current-branch selected state, and readable later
  branches after scrolling.
- The isolated Vite command exceeded the terminal wrapper timeout while settling its
  child process, after all evidence had been captured. The wrapper terminated the
  owned process tree, and a direct probe confirmed port `4174` was released. The
  user's running OpenCorvus and Overlay were not restarted, refreshed, or closed.
- A bounded read-only child review reached terminal success but returned no usable
  review body, so it was not treated as acceptance evidence. The parent performed the
  final diff and screenshot review.

## Verification plan

1. Run the required read-only Claude Code review after checking the installed command,
   version, and help, and reconcile its evidence without allowing edits or delegation.
2. Start the complete Overlay Vite page on an isolated port and use the existing real
   backend and repository branch data without synthetic fixtures or request overrides.
3. In a real desktop browser, open this repository-bound Chat and its Environment
   information panel, then inspect the menu frame, compact current-branch state, and
   first-to-last internal wheel scroll at source and shorter desktop heights. Capture
   fresh screenshots for the menu region and context.
4. If any visual criterion fails, fix the unique root owner and repeat the full visual
   loop. If the checkpointed implementation passes, do not manufacture another product
   diff.
5. Run only allowed non-UI checks: Overlay TypeScript typecheck, Overlay production
   build, historical-document link health, and the repository hook checks. Do not run
   any Overlay unit or browser test.
6. Stop only the exact task-owned processes, review every final diff, exclude unrelated
   work, commit with the `dsw-33987` prefix, and push the current branch to `legacy-remote`.

## Evidence and second review

- `bun run typecheck` passed in `packages/overlay`.
- `bun run build:vite` passed after transforming 7,061 modules. Existing
  third-party module-directive and large-chunk warnings remained warnings.
- The required read-only Claude Code invocation used CLI version `2.1.147` and
  the repository-prescribed streaming flags, but the local CLI returned
  `Not logged in`. No Claude output was used as evidence.
- A headed Node-driven Playwright session opened the complete isolated Vite
  page against the real running OpenCorvus backend. It selected this real Chat,
  opened Environment information, and opened the real 42-branch list returned
  for the current repository. No UI test, fixture, network interception, or
  screenshot baseline was added or run.
- At the source screenshot viewport of 1234 × 1696, the compact menu measured
  1,112 pixels high and remained entirely inside the viewport. Each sampled
  branch row measured 26 pixels with a 16.8-pixel line height and 3-pixel block
  padding; branch icons, current-branch highlight, and check remained unclipped.
- At the same desktop width and a shorter 800-pixel window, the menu was bounded
  to 784 pixels with 8-pixel top and bottom clearance. Its scroll box measured
  `clientHeight=783` and `scrollHeight=1111`; a real wheel gesture moved it from
  `scrollTop=0` to the exact maximum `328`, exposing the final branch without
  scrolling the page.
- The parent session personally reviewed fresh top-of-list, bottom-of-list, and
  full source-height screenshots. The popup border remained complete on all
  sides, selected and hover paint stayed inside each row, and later branches
  were readable after scrolling.
- The isolated Vite listener was stopped by the exact owner of port 4173 and the
  port was confirmed released. The user's running OpenCorvus window was not
  restarted, refreshed, or closed.
- Final diff review confirmed checkpoint `d1f095cc3e` contains only the 12-line
  `conversation.css` change. Concurrent `card.css` and Conversation
  error-indicator documentation changes remain unstaged and excluded.
