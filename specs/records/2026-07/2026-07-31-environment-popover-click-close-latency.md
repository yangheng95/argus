# Environment Popover click-close latency repair

## Recall

### User request

The user reported that the expanded Environment Information floating panel does
not collapse immediately when its toolbar button is clicked again and asked for
the cause and a repair. The supplied screenshot identifies
`data-ui="project-runtime-status-dropdown"` and its Environment Information
HoverCard as the delivery surface.

### Acceptance criteria

1. An explicitly pinned Environment Information HoverCard closes in the same
   click that unpins it; it must not wait for a hover-leave timer.
2. Pointer-hover preview, the Kobalte safe pointer region, explicit pinning,
   child navigation, hidden-anchor cleanup, placement, and visual composition
   remain unchanged.
3. The result is verified on a real isolated Overlay page by clicking the actual
   toolbar trigger and visually reviewing screenshots. UI automation tests are
   neither added nor run.
4. TypeScript typecheck, Vite build, localization validation, and documentation
   health checks pass.
5. The finished change is reviewed, committed with the `dsw-33987` prefix, and
   pushed to the `myhexin` `v0.0.26beta` delivery branch without including the
   unrelated user edit in
   `specs/artifacts/opencorvus-workbuddy-qoderwork-multica-codex-benchmark-catalog.md`.

### Hard constraints

- Preserve the controlled Kobalte HoverCard as the mature primitive and keep
  `panelOpen` as the only visibility source.
- Do not replace the 300 ms library close delay with a locally hard-coded timing
  override. The delay is correct for pointer-safe hover dismissal; explicit
  click intent must update the controlled state directly.
- Do not add compatibility, fallback, a second visibility source, a gate, a
  state machine, or UI test artifacts.
- Do not restart, refresh, close, or otherwise disturb the user's existing
  OpenCorvus / Overlay process. Use a separate local page for visual acceptance.
- Do not create a worktree and do not overwrite unrelated working-tree changes.

### Read material

- `AGENTS.md`, especially the UI visual-acceptance rule, UI automation-test
  prohibition, spec/index discipline, Git delivery requirements, Claude Code
  consultation contract, and running-process boundary.
- `specs/current/architecture/07-panel.md`, whose current contract says:
  clicking the Environment button pins the surface and clicking it again
  “unpins and closes it.”
- `specs/current/architecture/12-overlay-card-system.md` and
  `specs/current/architecture/99-principles.md`.
- `packages/overlay/src/components/TaskDirBar.tsx`.
- `packages/overlay/src/components/ui/HoverCard.tsx`.
- Kobalte's installed `hover-card-root.tsx` and `hover-card-trigger.tsx`
  implementation.
- `packages/overlay/src/styles/surfaces/conversation.css`.

### Full-repository grep

| Symbol / surface | Call points and disposition |
| --- | --- |
| `ProjectRuntimeStatusPanel` | Defined in `TaskDirBar.tsx`; wrapped once by `ProjectRuntimeToolbarActions`; mounted once from `App.tsx`. Keep this ownership. |
| `panelOpen` / `panelPinned` | Local signals exist only in `ProjectRuntimeStatusPanel`. Keep them local; repair the explicit close transition only. |
| `closeRuntimePanel` | The existing canonical explicit close helper already clears both signals. Reuse it from the second-click branch. |
| `setRuntimePanelOpen` | Kobalte `onOpenChange` adapter. It deliberately ignores delayed hover close while pinned. Keep this behavior. |
| `toggleRuntimePanel` | The only explicit trigger-click transition. Its pinned branch currently clears only `panelPinned`; replace that incomplete transition with `closeRuntimePanel()`. |
| `HoverCard` | The shared wrapper is the only Kobalte HoverCard owner, and `TaskDirBar.tsx` is its only feature consumer. Keep the primitive unchanged. |
| Kobalte close timing | Installed `@kobalte/core` defaults `closeDelay` to 300 ms and schedules `disclosureState.close()` after pointer/focus exit. This timer is appropriate for hover, not explicit click dismissal. |
| Toolbar wiring | `App.tsx` supplies anchor visibility and navigation callbacks only; no visibility mutation belongs there. |
| Styles | `conversation.css` owns placement and enter motion only. There is no exit transition that explains the click lag, so CSS is unchanged. |

The grep also exposed existing tests that assert TSX/CSS/DOM strings or browser
rendering for the touched TaskDirBar, HoverCard, TaskProgress, dialog, terminal,
and related conversation surfaces. Under the repository's 2026-07-29 UI
automation-test prohibition, these files must be deleted rather than run or
updated:

- `packages/overlay/test/environment-local-branch-controls.test.ts`
- `packages/overlay/test/hover-card-primitive.test.ts`
- `packages/overlay/test/task-progress-collapse.test.ts`
- `packages/overlay/test/overlay-startup-chrome-parity.test.ts`
- `packages/overlay/test/recent-dir-remove-hover-layout.test.ts`
- `packages/overlay/test/terminal-panel.test.ts`
- `packages/overlay/test/dialog-primitive.test.ts`
- `packages/overlay/test/browser/agent-reply-box-primitives.test.ts`
- `packages/overlay/test/browser/card-header-metadata-tooltip-browser.test.ts`
- `packages/overlay/test/browser/goal-group-css-residue-browser.test.ts`
- `packages/overlay/test/browser/primitive-radius-input-weight-browser.test.ts`

### Independent review feedback

Claude Code 2.1.147 was invoked in read-only mode with `Read,Grep,Glob`, medium
effort, no session persistence, and a bounded budget. The CLI could not perform
the review because it is not authenticated (`Not logged in · Please run
/login`). No files were modified. This is recorded as unavailable independent
feedback rather than invented evidence; the primary review therefore relies on
the source, installed dependency, current architecture contract, real-page
interaction, and a separate final self-review.

## Evidence-backed cause

Observable behavior:

- The pinned panel remains visible briefly after the trigger is clicked.

Direct trigger:

- `toggleRuntimePanel()` sees `panelPinned() === true` and calls only
  `setPanelPinned(false)`.
- `runtimePanelOpen()` still reads `panelOpen() === true`, so the controlled
  HoverCard remains open after the click.

Deeper cause:

- The implementation treats “unpin” and “close” as separate transitions even
  though the documented explicit click intent is one transition.
- Once unpinned, the panel eventually closes only when Kobalte's hover/focus
  machinery requests `onOpenChange(false)`. Kobalte's installed default
  `closeDelay` is 300 ms, which produces the reported lag.

Why timing or CSS changes would not fix the root:

- Setting `closeDelay={0}` would globally remove the mature pointer-safe grace
  period and degrade ordinary hover traversal.
- Removing the enter animation would not update the still-true controlled open
  state.
- A second click handler or timeout would create another visibility source.

## Implementation

1. Replace the incomplete pinned branch in `toggleRuntimePanel()` with the
   existing `closeRuntimePanel()` helper. This atomically clears pin and open
   state in one synchronous Solid update.
2. Delete the discovered UI automation-test files without running them.
3. Keep `HoverCard`, its default delay, `setRuntimePanelOpen`, styles, and all
   data-loading behavior unchanged.

## Validation

- Inspect the focused diff to confirm only the pinned second-click transition
  changed.
- Run `bun run --cwd packages/overlay typecheck`.
- Run `bun run --cwd packages/overlay build:vite`.
- Run `bun run --cwd packages/overlay check:i18n`.
- Run
  `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` and
  the applicable documentation health checks.
- Start a separate Vite page without stopping the existing Overlay, connect
  through the in-app Browser, click the Environment trigger open and closed,
  inspect the immediate state, and manually review screenshots.
- Perform a second source/diff review, commit with `dsw-33987`, fetch the
  current `myhexin` branch, and push the main worktree branch.

## Validation results

- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay build:vite`: passed.
- `bun run --cwd packages/overlay check:i18n`: passed.
- Real isolated Overlay page at `http://127.0.0.1:14327/`:
  - opening by exact Environment Information trigger produced the expected
    panel composition;
  - the second exact trigger click immediately produced
    `aria-expanded="false"`, no `data-pinned`, and zero
    `#projectRuntimeStatusPanel` Portal nodes;
  - browser diagnostics contained no warnings or errors;
  - the temporary Vite process was identity-checked and stopped without
    touching the user's existing OpenCorvus / Overlay process.
- Visual evidence:
  - [open state](../../artifacts/2026-07-31-environment-popover-click-close-open.png)
  - [immediate closed state](../../artifacts/2026-07-31-environment-popover-click-close-closed.png)
- The first documentation-health run correctly reported the new record as
  untracked because the index contract reads `git ls-files`; after staging,
  `document-health.test.ts` and `product-docs-single-source.test.ts` passed
  70/70.
- `historical-docs-links.test.ts` passed 2/2 after the pre-existing unrelated
  benchmark-catalog edit was isolated for the command and restored
  byte-for-byte. That user change remains outside this repair.
