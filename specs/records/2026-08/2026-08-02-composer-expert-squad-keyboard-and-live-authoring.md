# Composer Expert Squad Keyboard Selection and Live Authoring

Date: 2026-08-02

Status: implemented and visually verified

## Recall

| Item | Details |
| --- | --- |
| User requirement | Repair the Composer Expert Squad picker so Up/Down keyboard navigation can reach and select Research Studio, and add an option that can produce a new Expert Squad live. |
| Acceptance criteria | Opening `Skills & squads` keeps search available; ArrowDown from the search field transfers focus into the first visible result; Kobalte Listbox owns subsequent Up/Down, Enter, and Space behavior; Research Studio is visibly reachable and selectable without a pointer; a visible Expert Squad action selects the exact built-in `advanced` package plus the canonical `expert-squad-authoring` Skill; the user can continue writing the live production request in the Composer; real Vite interaction and fresh screenshots are manually inspected. |
| Hard constraints | Preserve `prompt_profile.active` as the only active Expert Squad identity; do not invent a fake package ID, second writer, panel-only synthetic package, fallback, route gate, state machine, or hidden message. Use the existing Kobalte primitive. Do not add, modify, update, or run UI automation tests. Delete UI source/browser tests and fixtures discovered in the touched search surface. Run Playwright only through Node for interactive visual inspection. Preserve concurrent changes and commit only task-owned paths with the `dsw-33987` prefix. |
| Existing architecture read | `specs/current/architecture/04-extensions.md`; `specs/records/2026-07/2026-07-28-conversational-expert-squad-runtime-authoring-repair.md`; `specs/records/2026-07/2026-07-30-mission-automatic-expert-squad-production-phase.md`; `specs/records/2026-08/2026-08-01-research-studio-built-in-expert-squad.md`; the built-in Advanced manifest and `expert-squad-authoring` Skill. |
| Whole-repository grep | `ComposerReferenceSelector` has one implementation and two `ChatComposer` call sites: editable launch selection and read-only active-conversation display. `setComposerMentionDirectiveSelected` has one implementation and the editable selector is its only production caller. `expert-squad-authoring` is projected by the built-in Advanced manifest; the Skill requires `expert_squad_author`, which reuses the SDK definition validator/writer, Registry validation, and Manager import. Mission's canonical production contract creates one project-scoped Advanced production Task and reconciles the resulting ID/version/digest before domain use. The touched test search exposed `app-shell.test.ts`, `interaction-dialog-host.test.ts`, `selection-control-primitive.test.ts`, and the orphan `conversation-artifact-summary` browser fixture as prohibited UI automation/source-assertion assets; they will be deleted without execution. |
| Independent agent feedback | No independent Agent was requested, so none was started. |

## Causal chain

1. The editable Composer reference popover focuses a standalone search input.
2. Its result rows are independent Checkbox controls inside plain `div` lists.
3. No listbox owns the filtered result collection, focused key, or directional navigation.
4. Therefore ArrowUp and ArrowDown remain ordinary search-input cursor keys and cannot move to Research Studio; pointer selection and repeated Tab navigation are the only available paths.
5. The canonical package-production capability already exists, but it appears only as a generic Skill row. The selector does not expose the intended Advanced bootstrap producer and authoring Skill as one understandable action.

## Design

Replace the editable result container with the existing Kobalte-backed
`ListboxRoot` in multiple-selection mode. Keep the current search field and
filtered catalog, but group Skill and Expert Squad options through the Listbox
collection. ArrowDown or ArrowUp from the search field hands focus to the
Listbox once; Kobalte owns all navigation and selection after that boundary.
Selected keys remain derived only from the visible Composer directives.

Add one action row to the Expert Squad group. Activating it atomically selects
the exact `advanced` Squad and `expert-squad-authoring` Skill directives in the
visible Composer text. The action is not persisted as a reference, never
appears in `expertSquadIDs`, and does not create an alternate active-profile
field. Submission follows the existing Mission production contract and the
single SDK writer/Registry/Manager installation path.

## Implementation inventory

| Surface | Decision |
| --- | --- |
| `packages/overlay/src/components/ComposerReferenceSelector.tsx` | Replace Checkbox result rows with grouped Kobalte Listbox items, add search-to-listbox focus handoff, and add the live-authoring action. |
| `packages/overlay/src/components/ChatComposer.tsx` | Keep both existing call sites; the editable callback remains the sole draft writer and the read-only surface receives no authoring action. |
| `packages/overlay/src/services/composer-mention.ts` | Reuse the current visible-directive writer unchanged. |
| `packages/overlay/src/styles/surfaces/composer.css` | Adapt existing reference-row styles to Listbox item state and give the action a distinct but restrained treatment. |
| `packages/overlay/src/i18n/{en-US,zh-CN}.json` | Add exact live-authoring action label and explanation. |
| Prohibited UI tests/fixtures discovered by the required impact search | Delete without running; do not replace with another automated UI assertion. |

## Verification plan

1. Run targeted non-UI typecheck, i18n integrity, build, `git diff --check`,
   historical-doc links, and document-health checks.
2. Start the real Vite Overlay without touching any existing production
   process.
3. Use Node-driven browser interaction to open `Skills & squads`, press
   ArrowDown/ArrowUp and select Research Studio without a pointer, then inspect
   the resulting visible `@squad("research-studio")` directive.
4. Activate the live-authoring action through the same keyboard path and inspect
   the visible `@squad("advanced")` plus
   `@skill("expert-squad-authoring")` directives.
5. Capture and manually inspect fresh screenshots for the keyboard-focused
   Research Studio row and the live-authoring result.
6. Perform a second diff/review, commit task-owned paths, fetch the current
   legacy remote branch, integrate if required, and push to `legacy-remote`.

## Verification result

- The editable popup now exposes one grouped Kobalte Listbox. With the search
  value `Research Studio`, one ArrowDown moved focus from the search input to
  the exact Research Studio option. The live element reported
  `role="option"`, `data-highlighted`, and `aria-selected="false"` before
  selection. Enter changed it to `aria-selected="true"` and wrote the exact
  visible `@squad("research-studio")` directive.
- The live-authoring action was reached with the same ArrowDown path and
  reported the exact highlighted action key. Enter closed the popup, removed
  the previously selected Research Studio reference, and wrote exactly
  `@squad("advanced") @skill("expert-squad-authoring")`. The action itself
  never entered the visible reference set.
- Fresh Vite screenshots were manually inspected:
  `specs/artifacts/2026-08-02-composer-research-studio-keyboard-focus.png`,
  `specs/artifacts/2026-08-02-composer-live-expert-squad-authoring.png`, and
  `specs/artifacts/2026-08-02-composer-live-expert-squad-authoring-result.png`.
  The first pass exposed two adjacent plus marks on the action row; the action
  selection marker was removed and the corrected screenshot shows one
  restrained action icon.
- The real Vite Overlay connected to the existing read-only port-7878 backend
  without restarting or terminating it. The final browser log contained only
  the earlier connection warnings from before the server URL was corrected and
  no new UI error.
- Overlay typecheck, i18n integrity, Vite production build, and
  `git diff --check` passed. Historical-link and document-health checks passed
  62/62 in an isolated index that marked the concurrent
  `mission-selected-squad-stage-ownership-calibration` record tracked for the
  check without staging or committing it; the ordinary shared-index run
  otherwise failed only because that concurrent README-linked record remained
  untracked. Prohibited UI source/browser tests and the orphan fixture found by
  the impact search were deleted without execution and were not replaced.
