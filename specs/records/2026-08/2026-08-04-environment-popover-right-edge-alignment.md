# Environment Popover Right-edge Alignment

Date: 2026-08-04
Status: Implemented
Owner: Coding Assistant

## Glossary

- UI: User Interface, the visible application surface.
- CSS: Cascading Style Sheets, the browser layout and presentation language.
- DOM: Document Object Model, the browser-rendered element tree.

## Recall

### User requirement

The supplied desktop screenshot shows that the Environment Information HoverCard
still overlaps the readable Conversation lane when the Workbench has enough width.
Move the panel slightly toward the right edge so it no longer covers the dialog.

### Acceptance criteria

- At the supplied wide desktop geometry, the open Environment panel moves toward
  the Overlay's right edge and remains outside the readable Conversation lane.
- The existing panel width, `bottom-end` placement, eight-pixel vertical gutter,
  viewport fitting, animation-frame anchor tracking, open/pin state, and Right
  Dock coexistence remain canonical.
- The horizontal displacement follows the existing trailing Right Dock control
  width plus header gap at every UI scale.
- Compact Workbenches retain Kobalte's mature viewport slide behavior; the panel
  stays visible and unclipped rather than acquiring a second layout mode.
- No coordinate override, duplicated panel, observer, viewport signal, fallback,
  UI automation test, or unrelated layout change is introduced.
- Overlay typecheck/build/localization checks, document health, an isolated real
  desktop page, screenshots, and a second manual review complete before delivery.

### Hard constraints

- Preserve concurrent live-diff changes in `DiffPreviewPanel.tsx`, current panel
  architecture, and its task record; do not stage or overwrite them.
- Do not restart, close, refresh, or otherwise interfere with the operator's
  running OpenCorvus/Overlay process. Visual verification uses an isolated Vite
  process and Node-driven real browser interaction.
- Do not create, update, or run UI automation tests.
- Commit subjects use `dsw-33987`; delivery goes to `legacy-remote`.

### Material read before implementation

- `AGENTS.md` and `CLAUDE.md`.
- The supplied screenshot.
- `specs/current/architecture/07-panel.md`.
- `specs/records/2026-07/2026-07-23-environment-popover-right-dock-responsive-coexistence.md`.
- `specs/records/2026-08/2026-08-04-environment-popover-anchor-motion-and-conversation-presentation.md`.
- `packages/overlay/src/components/App.tsx` and `TaskDirBar.tsx`.
- `packages/overlay/src/components/ui/HoverCard.tsx`.
- `packages/overlay/src/styles/tokens/design-language.css`.
- `packages/overlay/src/styles/surfaces/conversation.css`.
- `packages/overlay/src/utils/layout-tokens.ts`.
- Installed Kobalte 0.13.11 Popper declarations and runtime middleware.

### Whole-repository search evidence

Searches covered `ProjectRuntimeStatusPanel`, every `HoverCard.Content` call,
`project-runtime-status-panel`, `project-runtime-trigger-anchor`,
`--ui-runtime-environment-chat-clearance`, `--ui-header-control-height`,
`--oc-header-gap`, `trailingAction`, Kobalte `shift`, and existing Environment
records.

| Owner / call point                     | Current fact                                                                                                                                                          | Disposition                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `TaskDirBar.ProjectRuntimeStatusPanel` | Owns the only Environment HoverCard and anchors `bottom-end` to the Environment button.                                                                               | Supply the mature Popper cross-axis shift only at this feature call site.                                        |
| `App.tsx`                              | Places one Right Dock toggle immediately after Environment through `trailingAction`.                                                                                  | Keep structure and control ordering unchanged.                                                                   |
| Design-language tokens                 | Own the header control height, header gap, Environment width, and readable-content clearance.                                                                         | Add one derived Environment anchor-shift token equal to the trailing control width plus gap.                     |
| `layout-tokens.ts`                     | Canonically resolves CSS length tokens into scale-aware pixel numbers for JavaScript layout APIs.                                                                     | Reuse it; do not duplicate CSS parsing or hard-code pixels.                                                      |
| Kobalte Popper                         | `shift` maps to Floating UI `alignmentAxis`; `bottom-end` uses this as the aligned cross-axis offset, while default `slide: true` keeps overflow inside the viewport. | Pass the negated derived token to move this end-aligned panel toward the physical right in left-to-right layout. |
| `conversation.css`                     | Reserves panel-width plus chat-header padding in wide Workbenches.                                                                                                    | Keep unchanged; correct the panel's physical placement rather than widening the readable-content exclusion.      |
| Other HoverCards/poppers               | No other Overlay HoverCard call exists; DropdownMenu placements are separate primitives.                                                                              | Keep unchanged.                                                                                                  |
| UI tests                               | UI automation is prohibited for this task.                                                                                                                            | Do not add, modify, search further, or run UI tests.                                                             |

No backend route, database model, conversation protocol, Right Dock width source,
panel width, localization key, or open-state owner changes.

### Independent feedback

Claude Code 2.1.147 was invoked read-only with `Read,Grep,Glob`, medium effort,
no session persistence, and a bounded budget. The local CLI is not authenticated
and returned `Not logged in · Please run /login` with `is_error: true`; it made no
files changes and supplied no review conclusion.

## Evidence-backed root cause

`bottom-end` currently aligns the Environment panel's right edge with the
Environment button. The actual toolbar has one Right Dock button plus the shared
header gap after that anchor. The wide Conversation clearance assumes the panel
occupies the trailing lane, but the unshifted anchor leaves precisely that trailing
toolbar span unused and displaces the panel into the readable lane. This is a
placement-offset defect, not a panel-width or clearance-width defect.

## Implementation plan

1. Add one derived design token for the Environment anchor shift, composed from
   the existing header control height and header gap.
2. Resolve that token through the existing layout-token utility and pass its
   negative value to the Environment HoverCard's Kobalte `shift` prop, reacting
   to the existing UI zoom source.
3. Run non-UI validation, launch an isolated real Overlay page at the supplied
   desktop geometry, and correct any visible clipping or overlap.
4. Perform a second diff review, update this record's status and evidence, commit
   only this task's files, reconcile the branch, and push to `legacy-remote`.

## Status

- [x] Screenshot, history, component, token, and installed Popper diagnosis.
- [x] Scale-aware right-edge alignment implementation.
- [x] Non-UI validation.
- [x] Real-page interaction and screenshot review.
- [x] Second review.

## Validation results

- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay check:i18n`: passed with catalog hash
  `ca3dd2196dd8b3e9`.
- `bun run --cwd packages/overlay build:vite`: passed after transforming 7,073
  modules. Existing third-party `use client` and chunk-size advisories remained
  informational.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts
packages/opencorvus/test/script/document-health.test.ts
packages/opencorvus/test/script/product-docs-single-source.test.ts`: 70 passed,
  0 failed after the new record entered the Git index required by document health.
- `bunx biome check` on the changed source and record files: passed.
- `git diff --check`: passed.
- A one-off Node-driven Chromium interaction opened an isolated Vite page at the
  supplied 2,114 by 1,293 desktop geometry without touching the running Overlay.
  The Environment panel resolved to `left=1794`, `right=2094`, and `width=300`;
  its trigger resolved to `right=2056`, the trailing Right Dock control to
  `left=2066` and `right=2098`, and the viewport to `right=2114`. The derived
  anchor shift resolved from the 32-pixel control plus six-pixel header gap.
- Original-resolution manual review confirmed that the panel now occupies the
  trailing toolbar span, retains a safe right inset, remains fully readable, and
  no longer covers the real long Conversation cards or Composer:
  - [right-edge geometry](../../artifacts/2026-08-04-environment-popover-right-edge-alignment.png)
  - [real Conversation](../../artifacts/2026-08-04-environment-popover-right-edge-with-conversation.png)
- Browser Preview publication reported that this Chat has no Task context. A
  dedicated no-write preview Task was created; visual evidence was then collected
  through a self-contained isolated Vite/Chromium process that explicitly
  terminated its known server PID after each capture. The preview Task was
  explicitly cancelled after verification and its terminal record was retained.
