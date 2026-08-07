# Composer Reference Popover Continuity And Two-Line Rows

## Recall

### User requirements

- Repair the empty Composer reference Popover that appears after selecting an Expert Squad.
- Reduce every Skill, Mission Skill, and Expert Squad result from three text rows to two.
- Move the `Skill`, `Mission Skill`, and Expert Squad identity annotation onto the first row beside the
  displayed name.
- The supplied references are
  `C:/Users/10132/AppData/Local/Temp/codex-clipboard-8c588375-feb3-45a2-aad7-cd46861f6223.png`
  and
  `C:/Users/10132/AppData/Local/Temp/codex-clipboard-f2b851ca-0df1-47d1-9c8c-b9ad45b65597.png`.

### Acceptance criteria

- Selecting or deselecting any Skill, Mission Skill, or Expert Squad keeps the same Popover visibly
  populated and interactive.
- The focused search field remains usable and the dedicated results region remains the only scrolling
  owner.
- Every catalog item renders a first row containing its displayed name and type/identity annotation,
  followed by one description row.
- Long names, manifest IDs, and descriptions truncate within the existing Popover width without
  expanding the row or producing a third line.
- Selectable and read-only launch-reference views reuse the same two-line option renderer.
- A real page is opened, an Expert Squad is selected and deselected, Skill/Mission Skill/Expert Squad
  rows are inspected, screenshots are captured, and the final result is personally reviewed.

### Hard constraints

- Root `AGENTS.md` applies.
- Keep visible `@skill`, `@mission`, and `@squad` directives as the only selection source; do not add
  hidden selection state, a fallback catalog, or a second active Expert Squad field.
- Reuse the current Kobalte Popover and Checkbox primitives and the existing dedicated results
  scroller.
- Do not add, modify, update, or run User Interface (UI) automated tests. None of the repository-wide
  call-site searches found a UI test that directly asserts this component or its row classes.
- Preserve the unrelated dirty
  `specs/artifacts/opencorvus-workbuddy-qoderwork-multica-codex-benchmark-catalog.md`.
- Do not create a worktree. Browser interaction uses the Browser skill and Node.js-backed control.
- Commit subjects begin with `dsw-33987`; push checkpoints and the completed delivery to `legacy-remote`.

### Hard-disk sources read

- `AGENTS.md`
- both user-supplied screenshots
- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/12-overlay-card-system.md`
- `specs/records/2026-07/2026-07-30-composer-reference-selector-and-model-search.md`
- `packages/overlay/src/components/ComposerReferenceSelector.tsx`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/components/ui/Checkbox.tsx`
- `packages/overlay/src/components/ui/Popover.tsx`
- `packages/overlay/src/services/composer-mention.ts`
- `packages/overlay/src/services/composer-expert-squad-catalog.ts`
- `packages/overlay/src/services/global-composer-references.ts`
- `packages/overlay/src/styles/primitives/popover.css`
- `packages/overlay/src/styles/surfaces/composer.css`

### Whole-repository grep result

Repository-wide searches covered `ComposerReferenceSelector`, both component mount sites,
`setComposerMentionDirectiveSelected`, `VisibleComposerReferences`, `visibleComposerReferences`,
all `composer-reference-*` row and Popover selectors, shared Popover/Checkbox call sites, related
translation keys, and tests mentioning the same UI contracts.

| Owner / call site | Evidence | Disposition |
| --- | --- | --- |
| `ChatComposer.tsx` new-request mount | The selectable renderer receives live visible references and writes the updated directive text back into the same draft. | Preserve the call contract; verify selection does not blank the still-open Popover. |
| `ChatComposer.tsx` active-conversation mount | The read-only renderer uses the same option-copy function. | Let the two-line row repair apply identically without introducing a second renderer. |
| `ComposerReferenceSelector.tsx:setSelected` | Selection updates the draft while the search field stays focused and the controlled Popover stays open. | Preserve visible-reference editing and controlled-open semantics. |
| `ComposerReferenceSelector.tsx:renderOption` | Name, metadata, and description are three sibling rows inside a grid copy container. | Group name and metadata into one first-row wrapper; keep description as the second row. |
| `.composer-reference-popover` | `overflow: hidden` makes the outer Popover a programmatically scrollable container, while `.composer-reference-results` already owns user scrolling. | Make the outer shell clip without becoming a scroll container; retain the results scroller as the single owner. |
| shared `Popover` / `Checkbox` primitives | Other call sites rely on their canonical accessibility and interaction behavior. | Do not change either primitive for a component-local layout/scroll ownership defect. |
| pure mention/protocol tests | They cover visible directive insertion and projection, not rendered UI. | Leave them unchanged because the behavior contract does not change. |
| UI tests | No direct `ComposerReferenceSelector` or `composer-reference-*` presentation assertion was found. | Add no UI test and delete none. |

### Independent-agent feedback

- No sub-agent was requested, so no sub-agent was used.

## Causal chain

The Expert Squad selection succeeds: the chosen `@squad("...")` directive appears in the Composer and
the Popover remains mounted with its complete child DOM. The blank surface is a paint-position failure,
not missing catalog data.

The live page proves the direct trigger. Before selection, the focused search field and results are
visible. Updating the Composer draft changes the anchor-side layout while focus stays in that search
field. Because the Popover shell uses `overflow: hidden`, it is still a scroll container even though
users cannot scroll it. Focus preservation then moves that outer shell to `scrollTop: 1049.14`; its
heading is laid out at `offsetTop: 0` but paints at `-1040.57px`, outside the Popover's clipped
`8px..467px` viewport. The shell remains visible at `430px × 459px`, retains 38,960 bytes of child
markup, and therefore paints as an empty white card. The nested results region was already intended
to be the sole scroller.

The root repair is to remove scroll ownership from the outer shell while keeping clipping and the
existing nested results scroller. The row-density request is independent but shares the same renderer:
the current sibling name, metadata, and description spans necessarily form three grid rows. A semantic
first-row wrapper makes the displayed name and annotation one bounded line, with the description as
the only second line.

## Implementation plan

1. Change the Popover shell from scroll-container clipping to non-scrolling clipping while preserving
   its dimensions, border, and nested results overflow.
2. Group option name and type/identity metadata into one bounded first-row wrapper, then adjust the
   existing CSS to keep both first-row segments and the second-row description ellipsized.
3. Update this record and both spec indexes with implementation and visual evidence.
4. Run focused typecheck, Overlay build, internationalization, documentation-health, and diff checks;
   do not run UI tests.
5. Reload the real page, select and deselect an Expert Squad, inspect Skill, Mission Skill, and Expert
   Squad rows, capture screenshots, and personally review Popover continuity and two-line density.
6. Re-read the diff and screenshots, fetch and converge with `legacy-remote`, commit only task-owned paths,
   push `v0.0.26beta`, and verify local/remote convergence.

## Progress

- [x] Capture the request, screenshots, prior design record, constraints, full call sites, and live-page
  causal evidence.
- [x] Implement non-scrolling Popover clipping and the shared two-line option renderer.
- [x] Complete non-UI static/build/document verification.
- [x] Complete real-page interaction, screenshots, and personal visual review.
- [x] Complete second review, commit, push, and remote convergence.

## Visual acceptance evidence

The source Overlay was served as a real Vite page at `http://localhost:5174/` against the live
OpenCorvus server on port `7878`. Browser interaction used the Browser skill; no UI test, fixture,
baseline, or automated visual assertion was created or run.

- `specs/artifacts/2026-07-31-composer-reference-selected-squad-continuity.png` shows the selected
  `完整开发流程` Expert Squad, its visible `@squad("...")` directive, the selection count, and the same
  populated Popover after the state update.
- `specs/artifacts/2026-07-31-composer-reference-mission-skill-two-line.png` shows
  `mirror-prism-cluster` with `Mission Skill` on its first row and the description on the second.
- `specs/artifacts/2026-07-31-composer-reference-skill-two-line.png` shows `skill-installer` with
  `Skill` on its first row and the description on the second.

The selected Expert Squad was then deselected through the same Checkbox. After both selection and
deselection, the outer shell reported `overflow: clip`, `scrollTop: 0`, and a heading top aligned
within the Popover border. The selected row measured approximately `45px`, with an `18px` first row
and a `14px` description row. All three screenshots were personally inspected for visible content,
two-row hierarchy, truncation, spacing, and Popover anchoring.

## Verification evidence

- `bun run typecheck` in `packages/overlay`: passed.
- `bun run build:vite` in `packages/overlay`: passed after transforming 7,062 modules.
- `bun run overlay:i18n-check`: passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 2 passed.
- `git diff --check`: passed.
- No UI automation test was added, modified, updated, or run.

The implementation and its three task-scoped screenshots were committed as `9fbe22c85c` after
fast-forwarding the two latest legacy remote commits. The full pre-push hook then passed workspace typecheck,
route inventory, generated documentation consistency, Overlay internationalization, and secret
scanning. Local and `legacy-remote/v0.0.26beta` both resolved to the same implementation commit after the
push.
