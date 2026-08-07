# Right Dock Goal And Requirement Disclosures

Date: 2026-07-30
Status: Complete
Owner: Codex

## Glossary

- UI: User Interface, the visible application surface.
- CSS: Cascading Style Sheets, the browser presentation language.
- DOM: Document Object Model, the rendered browser element tree.

## Recall

| Item                  | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement      | In the Right Dock, clicking a Goal row must only expand or collapse that Goal and must no longer navigate to an expert execution record. Requirement rows must gain the same click-to-expand/collapse behavior. Goal and Requirement lists must share row styling, corrected row height, animated expansion, and a disclosure icon.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Supplied evidence     | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-77480db1-d5ec-468d-aba2-dacdbc54a9a2.png` shows six compact Goal rows without a disclosure affordance. `C:/Users/10132/AppData/Local/Temp/codex-clipboard-ae898219-b482-440d-94a8-16e75d6790c8.png` shows thirteen Requirements as tall, always-expanded divided blocks. Both images were inspected at original resolution.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Acceptance criteria   | Goal activation changes only its disclosure state and never changes the active Right Dock destination or scrolls the Conversation to an expert record. Requirement activation reveals/hides its full description and metadata. Both lists render a 32-pixel shared summary rhythm, a trailing canonical chevron that rotates with native open state, one shared hover/focus treatment, and a height/opacity content transition. Existing Goal default-open rules, persisted operator choice, status/revision/title order, objective, acceptance, worktree action, semantic colors, and Requirement data remain intact. Keyboard activation uses native disclosure semantics. A real desktop page is clicked and task-scoped screenshots are personally reviewed.                                                                                                                  |
| Hard constraints      | Reuse the existing Solid `Disclosure`, `Icon`, Goal-state projection, and conversation presentation state. Do not add a renderer, state source, hand-written icon, route, fallback, compatibility path, gate, iframe, query override, mobile scope, or UI automated test. Do not add, modify, update, delete, or run existing UI automated tests. Browser verification uses the Browser skill through Node.js, never Bun. Preserve unrelated shared-worktree changes.                                                                                                                                                                                                                                                                                                                                                                                                             |
| Sources read          | Root `AGENTS.md`; Browser control skill; both user screenshots; `specs/current/architecture/07-panel.md`; the July 28 Goals navigation record; the July 30 Goals row record; current `Board.tsx`, `GoalGroup.tsx`, `RequirementsPanel.tsx`, `ui/Disclosure.tsx`, `store/conversation-ui.ts`, `services/goal-locate.ts`, `services/goal-summary-focus.ts`, `Icon`/`Button` primitives, `disclosure.css`, `section.css`, `inspector.css`, density/motion tokens, and all related production/test consumers found by repository search.                                                                                                                                                                                                                                                                                                                                              |
| Whole-repository grep | `GoalList` is mounted only by `GoalsBoardPanel`; `RequirementsPanel` is mounted only by `RequirementsBoardPanel`. `GoalGroup.onHeaderClick` is the sole production caller coupling Goal expansion to `locateGoalExecutionRecord`; removing that coupling leaves `goal-locate.ts` as an independent historical execution-location service while Environment-to-Goals navigation continues through `goal-summary-focus.ts`. `Disclosure` is the canonical native `details`/`summary` adapter and already owns the Lucide chevron, marker removal, hover, focus, and open-state rotation. `inspector.css` solely owns `.gwg-*` and `.req-*` list geometry. `conversation-ui.ts` is the single task-scoped presentation-state source. Existing source-string, DOM, browser, screenshot, and CSS tests that mention Goal/Requirement rows are UI tests and remain untouched and unrun. |
| Independent review    | Claude Code `2.1.147` was checked from the repository root and invoked read-only with only `Read,Grep,Glob`, streaming output, no session persistence, and an explicit prohibition on edits, tests, delegation, and worktrees. It stopped before reading files because the local CLI is not authenticated (`Not logged in`). No Claude finding is claimed; Codex owns the evidence review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Git baseline          | Delivery branch is `work-v0.0.24beta-yr-0729`. The worktree contains unrelated concurrent Right Dock Architecture hiding, workspace-corner, and animation-duration changes. This delivery owns only the two row components, canonical opt-in disclosure animation, task-scope list CSS, the exact current-architecture sentence that still mandates deeper Goal navigation, this record, its visual artifacts, and the two spec indexes.                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Cause Chain

1. The visible symptom is that a Goal click expands the row and then moves the
   operator to an expert execution card.
2. The direct trigger is `GoalGroup.onHeaderClick`: it first calls
   `toggleExpanded()`, then calls `locateGoalExecutionRecord()` for locatable
   Goals.
3. That service intentionally expands a rendered Conversation card and requests
   a highlighted scroll to it. The navigation is therefore not caused by the
   Goal title, expert-squad identity, tab label, or Goal data.
4. Requirements use a separate static divided-list renderer with no disclosure
   semantics, while Goals hand-compose a Button-based disclosure. Two visual and
   interaction paths produced inconsistent density and no shared indicator or
   animation.
5. The repository already has one native disclosure adapter. Reusing it for
   both rows removes the duplicate interaction implementation and lets one
   primitive own semantics, keyboard behavior, icon rotation, and opt-in motion.

## Complete Call-Site Disposition

| Owner or consumer                                     | Current evidence                                                                                                                                | Disposition                                                                                                                                                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Board.tsx::GoalsBoardPanel`                          | Sole production `GoalList` mount over `TaskBoard.goals`.                                                                                        | Preserve data and mount.                                                                                                                                                                                            |
| `GoalGroup.tsx::GoalGroup`                            | Sole detailed Goal row; one handler couples folding and execution-record navigation.                                                            | Compose canonical `Disclosure`; bind native open changes only to the existing `gwg:` task-persisted presentation key; remove locate/busy wiring from row activation.                                                |
| `GoalGroup.tsx::GoalList`                             | Sole Goal list wrapper.                                                                                                                         | Add the shared task-scope disclosure-list class; preserve order and projection.                                                                                                                                     |
| `Board.tsx::RequirementsBoardPanel`                   | Sole production `RequirementsPanel` mount over `TaskBoard.requirements`.                                                                        | Preserve data and mount.                                                                                                                                                                                            |
| `RequirementsPanel.tsx`                               | Sole Requirement row renderer; rows are always expanded.                                                                                        | Split each row into a canonical disclosure summary and body; use a namespaced task-persisted presentation key with a collapsed default.                                                                             |
| `ui/Disclosure.tsx`                                   | Canonical native `details`/`summary` adapter and chevron owner.                                                                                 | Add one opt-in `animated` data contract; preserve all current callers by default.                                                                                                                                   |
| `disclosure.css`                                      | Sole marker, focus, hover, indicator, and native open-state owner.                                                                              | Add opt-in `::details-content` block-size/opacity motion plus reduced-motion handling; do not duplicate chevrons in feature CSS.                                                                                    |
| `inspector.css`                                       | Sole Goal/Requirement feature geometry owner.                                                                                                   | Replace separate list rhythms with one shared 32-pixel row shell and shared content surface; retain Goal- and Requirement-specific columns and bodies.                                                              |
| `conversation-ui.ts`                                  | Single task-scoped persisted card-presentation owner.                                                                                           | Reuse unchanged with `gwg:` and `req:` namespaces; add no state source.                                                                                                                                             |
| `services/goal-locate.ts`                             | Existing explicit Conversation execution-record locator; Goal row is its only current production caller.                                        | Stop calling it from Goal activation. Preserve the service for separate execution-location ownership and historical non-UI contracts; do not relabel a removed row action as dead service deletion in this UI task. |
| `services/goal-summary-focus.ts` and `TaskDirBar.tsx` | Environment Goal activation opens/focuses the matching Right Dock Goal summary without locating execution history.                              | Preserve unchanged.                                                                                                                                                                                                 |
| `specs/current/architecture/07-panel.md`              | Still says the Goal workbench retains deeper execution-record navigation.                                                                       | Replace that obsolete sentence with disclosure-only Goal row activation and shared Goal/Requirement list semantics.                                                                                                 |
| Existing Goal/Requirement UI tests                    | Several files assert Button markup, absent chevrons/Disclosure, `.req-item` geometry, execution-location imports, DOM behavior, or screenshots. | Leave untouched and unrun under the project-wide UI automated-test prohibition.                                                                                                                                     |

## Implementation Plan

1. Extend the canonical `Disclosure` with opt-in content motion and reduced-motion
   behavior.
2. Recompose Goal rows through controlled native disclosures, preserving
   existing default-open and persistence semantics while removing execution
   navigation from the row trigger.
3. Recompose Requirement rows through the same controlled native disclosures,
   with a one-line summary and expanded full description/metadata.
4. Converge both lists on one shared row-height, spacing, hover/focus, divider,
   chevron, and animated-content contract in `inspector.css`.
5. Update the current architecture and this record; do not touch UI tests.
6. Run Overlay typecheck, localization, production build, documentation health,
   formatting, and diff checks. Start the real current-source page, click both
   panels, inspect active destination and open state, and personally review
   collapsed/expanded screenshots.
7. Perform a second diff and visual review, commit only task-owned changes,
   fetch/reconcile the shared branch, and push to `myhexin`.

## Status

- [x] User evidence, repository state, historical decisions, and production/test call points inspected.
- [x] Claude Code review attempted; authentication limitation recorded.
- [x] Plan committed and pushed before implementation (`e0ac759ab6`).
- [x] Component, primitive, CSS, and architecture implementation.
- [x] Static verification and real-page visual review.
- [x] Second review, final commit, and push.

## Verification

- Overlay TypeScript typecheck passed.
- Overlay localization integrity passed with digest
  `6aa073ad759b98c7`.
- The complete Vite production build passed. Existing Radix `"use client"`
  notices and the existing large-chunk advisory were the only warnings.
- A real current-source desktop page at `http://127.0.0.1:5173/` loaded the
  persisted Task board with 6 Goals and 13 Requirements.
- The final Goal and Requirement summaries both measured exactly 32 CSS pixels,
  matching the shared control-height token.
- Clicking the first Goal changed its native `details[open]` state from false
  to true while the selected Right Dock tab remained `Goals` and the
  Conversation scroll offset remained `1364.5714111328125`.
- Clicking the first Requirement changed its native `details[open]` state from
  false to true while the selected Right Dock tab remained `Requirements` and
  the same Conversation scroll offset remained unchanged.
- Chromium reported the expanded content transition as block-size `0.2s`,
  opacity `0.12s`, transform `0.2s`, and discrete content visibility `0.2s`.
  The trailing indicator rotated to the open-state matrix and retained its
  canonical transform transition.
- Codex personally inspected the real expanded Goal and Requirement screenshots:
  `specs/artifacts/2026-07-30-right-dock-goal-disclosure.png` and
  `specs/artifacts/2026-07-30-right-dock-requirement-disclosure.png`. Both
  surfaces preserve the shared one-line density, column alignment, divider,
  focus visibility, chevron, and readable expanded body without overlap or
  clipping.
- No UI automated test was added, modified, deleted, or run.
- The isolated implementation commit is `9e3460454a` and the git-cc remote
  `myhexin/work-v0.0.24beta-yr-0729` resolved to the same commit after the
  required pre-push checks passed.
- The document-health suite reached 62/63; its only failure is the shared
  worktree's unrelated, untracked
  `2026-07-30-conversation-running-dot-and-hover-time.md` already linked by the
  concurrently edited July index. This delivery neither owns nor stages that
  separate record. Historical-link health for the committed spec tree passed
  22/22, and `docs:check` passed.
