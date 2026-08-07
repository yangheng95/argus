# Environment Popover Right Dock Close Anchor Follow

Date: 2026-08-05
Status: Validated
Owner: Coding Assistant

## Glossary

- UI: User Interface, the visible application surface.
- CSS: Cascading Style Sheets, the browser layout and motion language.
- DOM: Document Object Model, the browser-rendered element tree.

## Recall

### User requirement

When Environment Information is expanded and its HoverCard is visible, closing
the right-side component Panel must move the HoverCard with its toolbar anchor
without a visible delay or later catch-up.

### Acceptance criteria

- The already-visible Environment HoverCard follows its trigger from the first
  frame through the complete canonical Right Dock closing transition.
- The existing Kobalte HoverCard, Portal, controlled open/pin owner,
  `bottom-end` placement, responsive shift, and Dock visibility owner remain the
  only presentation and layout sources.
- Animation-frame tracking is enabled only for this moving Environment anchor;
  other poppers retain event-driven positioning.
- No timer, DOM observer, copied coordinate, CSS transform override, fallback,
  second visibility state, or UI automation test is introduced.
- Overlay typecheck, build, localization, document health, isolated real-page
  interaction, screenshot inspection, and a second review complete before
  delivery.

### Hard constraints

- Preserve unrelated concurrent working-tree changes and do not create a
  worktree.
- Do not restart, close, refresh, or otherwise interfere with the operator's
  running OpenCorvus or Overlay process; visual verification uses an isolated
  process.
- Do not add, modify, update, or run UI automation tests. Browser interaction is
  manual acceptance evidence only and runs through Node.
- Commit subjects use `dsw-33987`; delivery goes to `myhexin`.

### Material read before implementation

- `AGENTS.md` and `CLAUDE.md`.
- The supplied desktop screenshot.
- `specs/current/architecture/07-panel.md`.
- `specs/records/2026-08/2026-08-04-environment-popover-anchor-motion-and-conversation-presentation.md`.
- `specs/records/2026-08/2026-08-05-environment-popover-right-dock-open-dismissal.md`.
- `packages/overlay/src/components/TaskDirBar.tsx` and
  `packages/overlay/src/components/ui/HoverCard.tsx`.
- `packages/overlay/src/styles/surfaces/workspace.css`.
- Installed Kobalte 0.13.11 HoverCard and Popper runtime/type projection.
- `patches/@kobalte%2Fcore@0.13.11.patch` and the Git history that added and
  removed `autoUpdateAnimationFrame` at the Environment call site.

### Whole-repository search evidence

Searches covered `ProjectRuntimeStatusPanel`, `HoverCard.Root`,
`rightDockOpen`, Right Dock width transitions, `autoUpdate`,
`autoUpdateAnimationFrame`, the Kobalte package patch, installed dependency
projection, current panel architecture, historical records, and Git history.

| Owner / call point | Current fact | Disposition |
| --- | --- | --- |
| `workspace.css` | Right Dock closing continuously animates `flex-basis`, `width`, and `max-width`, moving the chat-header trigger while its own dimensions remain fixed. | Keep the canonical Dock motion unchanged. |
| Kobalte Popper / Floating UI | The tracked package patch exposes Floating UI's mature `animationFrame` auto-update option, and the installed runtime/type projection contains it. | Reuse the existing opt-in primitive capability. |
| `TaskDirBar.ProjectRuntimeStatusPanel` | The Environment `HoverCard.Root` no longer passes `autoUpdateAnimationFrame`; commit `635c152acd` removed the one call-site opt-in while leaving the package capability and architecture claim intact. | Restore the opt-in only at this owner. |
| `HoverCard.tsx` | The shared wrapper remains a thin Kobalte composition and needs no second positioning implementation. | Keep unchanged. |
| Current architecture and 2026-08-04 record | Both declare per-frame anchor tracking in both Dock directions, but current source no longer satisfies that contract. | Restore source-to-document convergence. |
| UI test paths | UI automation is prohibited for this task. | Do not inspect, modify, or run them; verify through an isolated real page and screenshots. |

No backend route, database model, message protocol, Dock width token,
localization key, panel catalog, or CSS geometry change is required.

### Independent feedback

No subagent was used because the user did not request multi-agent delegation.
The conclusion is supported directly by current source, installed dependency
runtime/types, Git history, and the prior accepted geometry evidence.

## Evidence-backed root cause

The Right Dock and Environment trigger move in the normal flex layout, while the
HoverCard positioner is portaled. Kobalte's ordinary `autoUpdate` observes
resizes and scrolling, but the fixed-size trigger changes only its viewport
position during the Dock width transition. The repository already exposes
Floating UI's animation-frame tracking through the Kobalte package patch, but a
later commit removed the Environment call site's opt-in. The portaled positioner
therefore waits for a later observable update and visibly catches up. This is a
missing primitive option at the feature owner, not a CSS timing or Dock-state
problem.

## Implementation plan

1. Restore `autoUpdateAnimationFrame` only on the Environment
   `HoverCard.Root`.
2. Run overlay typecheck, build, localization, document-health, patch
   projection, and diff checks without UI tests.
3. Launch an isolated real Overlay page, open Environment while the Right Dock
   is open, close the actual Dock control, capture and inspect the moving/final
   surface, and perform a second source/diff/screenshot review.
4. Update this record with evidence, commit only task-owned changes, reconcile
   the delivery branch with `myhexin`, and push.

## Status

- [x] Screenshot, source, architecture, dependency, patch, and history diagnosis.
- [x] Environment anchor-tracking opt-in restoration.
- [x] Non-UI validation.
- [x] Real-page interaction and screenshot review.
- [x] Second source, diff, and screenshot review.

## Validation results

### Source and toolchain

- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay build:vite`: passed after 7,073 modules;
  third-party informational warnings did not fail the build.
- `bun run --cwd packages/overlay check:i18n`: passed with localization hash
  `d0a34c94f99923db`.
- The installed Kobalte runtime and declarations project
  `autoUpdateAnimationFrame` through to Floating UI's `animationFrame` option.
- `git diff --check`: passed for the implementation diff.
- No UI automation test was added, modified, updated, or run.

### Isolated real-page acceptance

The current Overlay source was served at `http://127.0.0.1:5184` against an
isolated OpenCorvus backend on port `7896`. Its database, data directory, and
project were all under
`.scratch/environment-anchor-follow-20260805/`; no operator process or user
database was touched.

Through the real page, the `Chat` conversation was selected, the actual Right
Dock control was opened, and the Environment Information link was expanded.
The visible HoverCard contained the live Environment disclosure, change count,
tool action, local project, branch, commit action, GitHub CLI status, and Files
tool. Closing the actual Right Dock control kept the HoverCard expanded and
moved it to the trigger's closed-Dock position.

Measured rendered geometry remained on the same placement contract:

| Surface | Right Dock open | Right Dock closed |
| --- | ---: | ---: |
| Trigger right edge | 861 px | 1,222 px |
| HoverCard right edge | 899 px | 1,260 px |
| Existing HoverCard-to-trigger offset | 38 px | 38 px |

The live page reports the canonical Right Dock transition as `0.2s` over
`flex-basis`, `width`, and `max-width`. The restored Floating UI animation-frame
tracking updates the portaled positioner during that layout motion instead of
waiting for a later resize or scroll observation.

- [Right Dock open with Environment HoverCard](../../artifacts/2026-08-05-environment-popover-right-dock-close-before.png)
- [Right Dock closed with Environment HoverCard still anchored](../../artifacts/2026-08-05-environment-popover-right-dock-close-closed.png)

Both screenshots were inspected at the task region. A second real close cycle
and a final source/diff review reproduced the same 38 px relative placement and
found no clipped content, flash, dismissal, or unrelated layout change.
