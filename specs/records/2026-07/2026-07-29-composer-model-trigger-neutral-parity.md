# Composer Model Trigger Neutral Parity

## Recall

| Item | Evidence |
| --- | --- |
| User requirement | Make the OpenCorvus Composer model-selection button visually consistent with the supplied Codex Composer reference. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-7e591b4a-3f06-4959-a39f-c66584d1a3ad.png` was inspected at original resolution. The OpenCorvus selected-model trigger is a blue outlined/accent pill, while the Codex selected-model trigger is a neutral text button with a neutral chevron and no persistent boundary. |
| Acceptance criteria | A selected OpenCorvus model uses the same neutral resting surface, medium label weight, and neutral disclosure icon as the unselected trigger and the supplied Codex control. Hover retains the existing neutral wash; keyboard focus retains the existing accent ring. Trigger height, padding, label content, model selection, Provider Popover, Hexin budget tooltip, send behavior, and responsive behavior remain unchanged. The real desktop page is opened, the exact Composer region is captured, and the screenshot is personally reviewed. |
| Hard constraints | Desktop-only scope. Reuse the existing `Button`, `Popover`, semantic tokens, and canonical `.composer-model-selector` owner. Do not add a component, duplicate style source, provider/model label formatter, reasoning-effort control, fallback, compatibility path, gate, state machine, responsive work, or UI automated test. Do not add, modify, update, delete, or run existing UI tests. Preserve unrelated dirty worktree changes. Browser control and screenshots use the Browser skill through Node.js, never Bun. Commit subjects begin with `dsw-33987` and delivery pushes to `myhexin`. |
| Sources read | Root `AGENTS.md`; Browser control skill; the supplied screenshot; `specs/current/architecture/06-provider.md`; `specs/current/architecture/07-panel.md`; `2026-07-29-composer-model-single-source-repair.md`; `2026-07-29-composer-model-selection-and-multica-import.md`; `2026-07-29-composer-shadow-parity.md`; `2026-07-19-codex-button-height-primitive.md`; `ComposerModelSelector.tsx`; `ChatComposer.tsx`; `composer.css`; shared Button and Popover primitives; commit `836ced9691`. |
| Whole-repository grep | Searches covered `ComposerModelSelector`, `composerModel`, `modelLabel`, `composer-model-selector`, `composer-model-selector-trigger`, `composer-model-selector-value`, `data-requires-selection`, and the selected-state CSS selector. `ChatComposer.tsx` is the sole production mount; `ComposerModelSelector.tsx` is the sole trigger renderer and selection-state owner; `composer.css` is the sole production visual owner. Historical specs and forbidden UI tests consume these selectors but are not implementation owners and remain untouched and unrun. No backend, state, route, locale, database, transport, model-catalog, label, effort, or popup-content change is required. |
| Independent review | Claude Code `2.1.147` was invoked from the repository root with read-only `Read,Grep,Glob` tools, no session persistence, streaming output, and explicit prohibitions on edits, tests, and delegation. It returned `Not logged in · Please run /login` before reading the repository, so no Claude finding is claimed. The primary agent owns the evidence-based diagnosis and final second review. |
| Git baseline | Branch `work-v0.0.24beta-yr-0729` at `b6c43e9ca0` was verified converged with `myhexin/work-v0.0.24beta-yr-0729` after fetch. Existing changes in `conversation-history-recovery-routes.test.ts` and both spec indexes are unrelated and will be preserved; only task-owned index additions may share those index files. |

## Cause Chain

1. `ChatComposer.tsx` mounts one `ComposerModelSelector`; there are not separate
   New Chat and conversation implementations.
2. `ComposerModelSelector.tsx` renders one Kobalte-backed `Popover.Trigger`
   through the shared `Button` primitive and exposes whether a model is absent
   through `data-requires-selection`.
3. Commit `836ced9691` added four selected-only rules using
   `:not([data-requires-selection="true"])`: a persistent accent surface and
   inset boundary, stronger hover/focus accent paint, an accent chevron, and a
   stronger label weight.
4. The supplied Codex reference does not give selected state a persistent
   container or accent treatment. Selection is already communicated by the
   label, so the added decoration duplicates state and visually diverges from
   the reference.
5. The root repair is to delete those selected-only projections. The canonical
   neutral resting, hover, and focus rules already express the target behavior
   for every selection state.

## Complete Call-Site Disposition

| Owner / consumer | Decision |
| --- | --- |
| `packages/overlay/src/components/ChatComposer.tsx` | Preserve the sole model-selector mount and Composer layout. |
| `packages/overlay/src/components/ComposerModelSelector.tsx` | Preserve the sole trigger markup, raw provider/model label, selection authority, `data-requires-selection`, Button/Popover behavior, Provider catalog, and Hexin budget tooltip. The attribute still communicates missing-model semantics to existing owners; it no longer paints a selected-only surface. |
| `packages/overlay/src/styles/surfaces/composer.css` base selector | Preserve the transparent resting surface, neutral text, pill hit target, dimensions, transition, neutral hover wash, and focus ring. |
| `packages/overlay/src/styles/surfaces/composer.css` selected-only selectors | Delete the persistent accent surface/border, selected-only hover/focus paint, accent chevron, and stronger label weight introduced by `836ced9691`. |
| Shared `Button`, `Popover`, `Tooltip`, and icon primitives | Preserve. They already provide mature semantics, interaction, and keyboard behavior. |
| Provider/model catalog, model label, and reasoning variant systems | Preserve. The user reported a button-style mismatch; changing identity text or adding an effort selector would expand behavior without evidence. |
| Existing Overlay UI tests and browser fixtures | Do not modify or run. This pure User Interface (UI) change is accepted through typecheck/build, real-page interaction, and personally inspected screenshots. |

## Implementation And Verification Plan

1. Land this Recall and both spec-index entries before the product change.
2. Delete only the four selected-only visual projections in the canonical
   Composer stylesheet.
3. Run Overlay typecheck, production build, documentation-health checks, and
   `git diff --check`; do not run UI tests.
4. Start or reuse a real isolated OpenCorvus page through the Browser skill,
   select a model, capture the exact Composer region at rest, hover, and
   keyboard focus as needed, and personally inspect the result.
5. Re-grep the owners, inspect the final diff and screenshot a second time,
   update this record with verification evidence, fetch/converge, commit only
   task-owned paths and hunks, push to `myhexin`, and verify remote convergence.

## Progress

- [x] Inspect the supplied image, current architecture, historical decisions,
      production owners, selected-state introducing commit, and dirty Git
      baseline.
- [x] Record the Recall, causal chain, complete call-site disposition, and
      verification plan.
- [x] Attempt and record the authentication-blocked read-only Claude Code
      review.
- [x] Remove the selected-only visual branch.
- [x] Complete static/build verification and real-page visual acceptance.
- [x] Complete second review and prepare the isolated task-owned commit.

## Verification Evidence

| Check | Result |
| --- | --- |
| Overlay typecheck | `bun run --cwd packages/overlay typecheck` passed. |
| Overlay production build | `bun run --cwd packages/overlay build:vite` passed across 7,055 modules. Existing third-party `use client` and large-chunk advisories remained warnings. |
| Documentation health | `bun test --timeout 20000 packages/opencorvus/test/script/historical-docs-links.test.ts` passed: 22 tests, 0 failures. |
| Static patch integrity | `git diff --check` passed. No User Interface (UI) automated test was added, modified, deleted, updated, or run. |
| Real selected resting state | The real Vite Overlay at `http://127.0.0.1:5173/` was connected through the visible Network settings to the already-running healthy OpenCorvus backend on port `7878`. After selecting `hexin/gpt-5.6-sol`, the task-scoped screenshot and computed styles showed a 32-pixel-high trigger with transparent surface, no border, no box shadow, neutral label and chevron, and label weight `500`. Personal inspection confirmed the persistent blue capsule was absent and the control matched the supplied neutral Codex rhythm. |
| Real keyboard-focus state | Opening the real Provider/model Popover, selecting the model, and closing it with Escape retained keyboard focus. The task-scoped screenshot and computed styles showed only the existing neutral hover wash plus the two-pixel semantic accent ring. The label, chevron, geometry, and Popover placement did not move. |
| Interaction and cleanup | The real model Popover listed connected Providers, selected the requested model, closed normally, and left submission disabled because the Composer body was empty. The Browser-only server URL was restored from the temporary `7878` verification target to its prior `7879` value, and the verification tab was closed. Console entries were limited to expected connection failures while the prior unavailable `7879` target was active and stream closure during the temporary server-URL transition; no error was attributed to the model trigger. |

## Second Review

- The final production grep contains no selected-only
  `:not([data-requires-selection="true"])` projection. The
  `data-requires-selection` attribute remains in the component for the existing
  missing-model contract; historical specifications and forbidden UI tests
  that mention the retired paint rule remain untouched.
- The product diff deletes only the four visual branches introduced by
  `836ced9691`. It does not change component markup, state, model identity,
  Provider data, reasoning variants, localization, routes, transport, or
  backend behavior.
- Source evidence, computed styles, and both personally inspected real-page
  states agree: selected state is communicated once by the label, while hover
  and keyboard focus remain the only transient visual feedback.
