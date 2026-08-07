# Progressive-list Indentation And Occlusion

Date: 2026-07-30
Status: Delivered
Owner: Codex

## Glossary

- UI: User Interface, the visible application surface.
- CSS: Cascading Style Sheets, the browser presentation language.

## Recall

| Item                  | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User requirement      | Add a leading indent before the numeric summaries at the top of the Goals and Requirements workbenches. Give the shared `展开显示` label a partially occluded, hazy appearance. Apply the numeric indentation to the related Goals / Requirements list surfaces together rather than repairing one screenshot in isolation.                                                                                                                                                                                                                                                                                                                                                          |
| Supplied evidence     | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-27968f81-8680-4ce8-a1b0-04b6546e5574.png` was inspected at original resolution. The `0/13` summary is visually too close to the panel edge, while the `展开显示` label is fully crisp and does not communicate that additional content is hidden behind the collapsed boundary.                                                                                                                                                                                                                                                                                                                                                   |
| Acceptance criteria   | Goals and Requirements numeric summaries share one increased leading inset and retain their existing pill geometry, tones, total projections, and toolbar placement. The collapsed shared progressive-list action keeps legible text and native Button focus/activation semantics while gaining a restrained partial occlusion/softening treatment; the expanded collapse action remains crisp. Project, Goal, and Requirement consumers all receive the shared disclosure treatment from one owner. The real page is opened, interacted with, screenshotted, and personally reviewed.                                                                                               |
| Hard constraints      | Preserve the canonical `TaskScopePanelShell`, `ProgressiveList`, and Button primitive owners. Do not add a fallback, compatibility route, duplicated per-surface state, gate, hard-coded list-specific branch, iframe, query override, mobile scope, or UI automated test. Do not add, modify, update, delete, or run UI automated tests. Use Node-based browser tooling for Windows visual acceptance. Preserve unrelated dirty user changes and stage only this task's files/hunks. Commit subjects start with `dsw-33987` and delivery is pushed to `myhexin`.                                                                                                                    |
| Sources read          | Root `AGENTS.md`; Browser control skill; supplied screenshot; `specs/README.md`; `specs/current/architecture/07-panel.md`; `2026-07-30-project-goal-requirement-progressive-lists.md`; `2026-07-30-goals-workbench-leading-summary-and-row-composition.md`; current `Board.tsx`, `TaskDirBar.tsx`, `GoalGroup.tsx`, `RequirementsPanel.tsx`, `LedgerList.tsx`, `ProgressiveList.tsx`, `SurfaceHeader.tsx`, `button.css`, `header.css`, `inspector.css`, `work-ledger.css`, and existing conversation/text mask recipes.                                                                                                                                                              |
| Whole-repository grep | `TaskScopePanelShell` is the sole mounted owner of the Goals and Requirements top numeric badges; `Board.tsx` creates both `passed/total` strings and the Architect count. `TaskDirBar.tsx` projects the same counts only into Right Dock launcher summaries and does not own the mounted workbench toolbar. `.task-scope-panel .oc-surface-header[data-ui="task-scope-toolbar"]` is the sole production toolbar inset owner. `ProgressiveList` is the sole local ten-entry disclosure owner and has exactly three production consumers: `GoalList`, `RequirementsPanel`, and ordinary `LedgerList`. `.oc-progressive-list__toggle` in `button.css` is the sole shared action style. |
| Independent feedback  | No sub-agent was started because the user did not request delegation. Claude Code CLI 2.1.147 was invoked read-only with only `Read,Grep,Glob`, but authentication failed before inspection (`Not logged in`). No independent conclusion is claimed; Codex retains implementation and second-review responsibility.                                                                                                                                                                                                                                                                                                                                                                  |
| Git baseline          | Branch `work-v0.0.24beta-yr-0729` initially matched `myhexin/work-v0.0.24beta-yr-0729` at `2d4ccae450`. Unrelated in-progress changes exist in Conversation Goal badge production files, its architecture chapter, and its record; they are outside this task and must remain untouched.                                                                                                                                                                                                                                                                                                                                                                                             |

## Causal Analysis And Call-site Decisions

The numeric summary itself is not misplaced by its data projection. Both
workbenches mount it through the same `SurfaceHeader`, whose task-scope override
currently sets only a six-pixel horizontal header inset. The disclosure content
below it already composes the panel content inset and row-trigger inset, so the
toolbar summary begins materially closer to the panel edge than the indexed
rows. The repair belongs in the task-scope toolbar recipe, not in the two badge
instances or their numeric strings.

The collapsed-list action is fully crisp because its shared style only changes
padding, margin, color, size, and weight. The component already owns the real
expanded state, so it can expose that state to its own shared label and apply a
paint-only collapsed treatment without inventing another state source.

| Owner or consumer                             | Decision                                                                                                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Board.tsx::TaskScopePanelShell`              | Preserve as the sole Goals / Requirements toolbar and badge mount. No per-panel prop or duplicate offset is added.                                                     |
| `inspector.css` task-scope toolbar            | Increase the shared leading inset so both numeric summaries align with the disclosure content rhythm. Preserve header height, divider, surface, and trailing geometry. |
| `ProgressiveList.tsx`                         | Preserve the single expanded signal and expose the current state on the existing root/action label for paint-only styling.                                             |
| `button.css` progressive-list recipe          | Add the restrained collapsed label occlusion/softening treatment once; keep the expanded collapse label crisp, legible, keyboard accessible, and Button-owned.         |
| `GoalList`, `RequirementsPanel`, `LedgerList` | Preserve unchanged as the three canonical consumers; all receive the shared treatment.                                                                                 |
| `TaskDirBar.tsx` launcher summaries           | Preserve unchanged because launcher summaries are a different compact row and are not the top workbench metric shown in the screenshot.                                |
| UI tests                                      | Do not modify or run them under the repository-wide UI automation prohibition.                                                                                         |

## Implementation And Validation Plan

1. Commit and push this plan as the pre-change checkpoint.
2. Invoke Claude Code read-only to challenge the shared-owner and visual
   treatment decision; record any usable feedback without delegating edits.
3. Patch only the shared toolbar inset and progressive-list component/style
   owners. Format the touched production files.
4. Run Overlay TypeScript typecheck, localization check, production Vite build,
   documentation health checks, and `git diff --check`. Do not run UI tests.
5. Open the real current-source page through the supported browser runtime,
   inspect Goals and Requirements numeric summaries, activate the shared
   progressive-list action, and capture fresh collapsed/expanded screenshots.
   Personally review legibility, occlusion strength, focus semantics, and
   alignment; iterate from the visual evidence.
6. Perform a second call-site and exact-diff review, update this record with the
   verified result, commit only task-owned files, reconcile the remote branch,
   and push to `myhexin`.

## Delivered Result

- `TaskScopePanelShell` remains the single Goals / Requirements toolbar owner.
  Its task-scope recipe now gives both top numeric summaries one shared
  token-derived leading inset without changing badge data, pill geometry, or
  the trailing toolbar rhythm.
- `ProgressiveList` exposes its existing expanded signal on the shared root and
  wraps only the Button-owned label. Collapsed labels use a soft upper-edge
  mask plus a `0.45px` scale-aware blur; expanded labels return to the canonical
  crisp state. The three production consumers remain unchanged.
- No UI automated test or screenshot baseline was created, changed, or run.
  The PNG files below are task-scoped manual visual evidence only.

## Verification

| Surface | Evidence and result |
| --- | --- |
| Requirements, collapsed | Real `Phase 02: 重启反馈洞察完整交付` task rendered all 13 Requirements. The `0/13` pill has the requested leading inset, and `Show more` visibly recedes behind a readable hazy upper edge. Evidence: `specs/artifacts/2026-07-30-progressive-list-requirements-collapsed.png`. |
| Requirements, expanded | Activating the real Button exposed Requirements 11–13, changed the action to `Show less`, and removed the mask/blur so the collapse label is crisp. Evidence: `specs/artifacts/2026-07-30-progressive-list-requirements-expanded.png`. |
| Goals | The same real task rendered `0/6`; the summary occupies the same indented content band as the Goal rows. Evidence: `specs/artifacts/2026-07-30-progressive-list-goals-indent.png`. |
| Shared project disclosure | The real project ledger inherited the same collapsed `Show more` treatment from `ProgressiveList`; no ledger-specific branch was introduced. |
| Static checks | `bun run --cwd packages/overlay typecheck`, `bun run --cwd packages/overlay check:i18n`, `bun run --cwd packages/overlay build:vite`, the historical-doc links, document-health, and product-doc single-source tests, plus `git diff --check`, completed successfully. Three document-health repository scans exceeded the combined run's fixed five-second per-test timeout; the exact three tests passed together under a 60-second timeout in 2.28 seconds. The final Vite rebuild transformed 7,055 modules; only the existing third-party directive and chunk-size warnings remained. |

The visual pass used the current production build from `packages/overlay/dist-vite`
through the repository's real `Server.listen` route on an isolated local port.
The normal CLI host-recovery lifecycle was not started, and only read-only
navigation and disclosure interactions were performed. A second visual review
after strengthening the haze confirmed that collapsed text is perceptibly
occluded but still readable, while the expanded action and both numeric
summaries remain clear.
