# Progressive-list Crisp Disclosure Label

Date: 2026-08-02
Status: Delivered
Owner: Codex

## Glossary

- UI: User Interface, the visible application surface.
- CSS: Cascading Style Sheets, the browser presentation language.

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User requirement | Remove the blur effect from the shared `Show more` disclosure shown in the supplied Overlay screenshot. |
| Acceptance criteria | Collapsed `Show more` and expanded `Show less` remain crisp and readable while preserving the existing disclosure placement, Button interaction, focus ownership, item limit, and expanded state. |
| Hard constraints | Preserve unrelated worktree changes. Keep `ProgressiveList` as the single disclosure owner. Do not introduce a replacement visual effect, fallback, compatibility branch, or per-consumer styling. Do not add, modify, update, delete, or run UI automated tests. Validate through a real page, interaction, screenshot, and manual visual review. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied screenshot; `2026-07-30-project-goal-requirement-progressive-lists.md`; `2026-07-30-progressive-list-indentation-and-occlusion.md`; current `ProgressiveList.tsx` and `button.css`. |
| Whole-repository grep | `ProgressiveList` has three production consumers: `GoalGroup`, `RequirementsPanel`, and `LedgerList`. `.oc-progressive-list__toggle-label` has one style owner in `button.css`; its collapsed selector is the only production owner of the `blur()` and gradient masks. |
| Independent feedback | No sub-agent was started because the user did not request delegation. Codex retains implementation and second-review responsibility. |
| Git baseline | Branch `v0.0.28beta` and `myhexin/v0.0.28beta` both resolve to `ca1b06ebb4159f3e56fee60f1bd2dee31c44d2d2`; the worktree is clean. |

## Causal Analysis And Call-site Decisions

The screenshot is not a font-rendering or compositor defect. The shared
collapsed selector explicitly applies a scale-aware `blur()` and two gradient
masks to the label. This makes an ordinary disclosure control resemble damaged
or unfocused text. The expanded state appears crisp only because the selector no
longer matches.

| Owner or consumer | Decision |
| --- | --- |
| `button.css` | Remove the label transition and the complete collapsed blur/mask rule. |
| `ProgressiveList.tsx` | Preserve the single expanded state, disclosure label, and Button semantics unchanged. |
| `GoalGroup`, `RequirementsPanel`, `LedgerList` | Preserve unchanged; all inherit the crisp shared disclosure. |
| UI tests | Do not modify or run them under the repository-wide UI automation prohibition. |

## Implementation And Validation Plan

1. Commit and push this plan as the pre-change checkpoint.
2. Delete the shared label blur, masks, and now-unused filter transition.
3. Run Overlay typecheck, localization validation, production Vite build,
   documentation health checks, and `git diff --check`; do not run UI tests.
4. Open the real current-source Overlay page, inspect and activate the
   disclosure, capture a task-scoped screenshot, and manually review both
   labels for crisp rendering.
5. Perform a second exact-diff and call-site review, update this record with the
   verified result, commit only task-owned files, reconcile the remote branch,
   and push `v0.0.28beta` to `myhexin`.

## Delivered Result

- The collapsed-only `blur()` and both gradient masks were deleted from the
  shared Button style owner.
- The filter transition and label `span` that existed only for that visual
  effect were deleted as dead presentation structure. `ProgressiveList` keeps
  its single expanded signal, item projection, Button, accessible expanded
  state, and translated disclosure text.
- `GoalGroup`, `RequirementsPanel`, and `LedgerList` remain unchanged and all
  inherit the crisp disclosure through the shared primitive.
- No UI automated test was added, modified, deleted, or run.

## Verification

| Surface | Evidence and result |
| --- | --- |
| Real collapsed disclosure | The current production Vite build was served through the repository `Server.listen` route on isolated port `17879` and loaded with real project data. The sidebar rendered one `Show more` Button with `aria-expanded="false"`, computed `filter: none`, `mask-image: none`, and no WebKit mask. Manual review confirmed crisp text. Evidence: `specs/artifacts/2026-08-02-progressive-list-crisp-show-more.jpg`. |
| Real expanded disclosure | Activating the same Button rendered one `Show less` action with computed `filter: none` and `mask-image: none`. Manual review confirmed the label remained crisp and the list disclosed its additional rows. Collapsing again restored the crisp `Show more` state. |
| Non-UI checks | Overlay typecheck, localization validation, and production Vite build passed. Historical documentation links passed 2 tests, document health passed 60 tests, product documentation single-source passed 8 tests, and `git diff --check` passed. The Vite build transformed 7,061 modules; only existing third-party directive and chunk-size warnings remained. |

The visual pass did not restart the user's running packaged Overlay. Loading
the isolated current-source page triggered the application's existing
`POST /global/projects/anonymous` startup request and returned `201`; the
disclosure interaction itself remained local UI state. The isolated server was
stopped after evidence capture.
