# Conversation Card Border And Tool Disclosure Repair

Date: 2026-08-04

CSS means Cascading Style Sheets. UI means User Interface.

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | Restore the disappeared Conversation card border and repair the broken Tool-call presentation shown in the two supplied screenshots. |
| Supplied evidence | `C:/Users/hengu/AppData/Local/Temp/codex-clipboard-8c545648-a5c9-4942-b713-7a5482c547c7.png` shows the current desktop shell; `C:/Users/hengu/AppData/Local/Temp/codex-clipboard-5ac12814-459f-467f-bb1b-a35e4c9e97ad.png` shows a borderless Orchestrator turn and long `artifact_read` parameters painting across the expanded `artifact_search` card. |
| Acceptance criteria | Agent and User turns regain one complete rounded semantic border, inset, and background; an expanded execution disclosure keeps its summary on one bounded row; complete Tool input/output remains readable only in the expanded Tool body; long JSON cannot overlap adjacent headers or cards; the current real desktop page is captured and personally reviewed. |
| Hard constraints | Preserve unrelated dirty-worktree changes. Do not add, modify, update, or run UI automated tests. Delete the related existing UI-only tests discovered through the touched stylesheet paths. Use Node-backed Browser inspection, never Bun-backed Playwright. Do not add a gate, fallback, second message surface, clipping patch, or local state source. |
| Sources read | Root `AGENTS.md`; Browser control skill; both supplied screenshots; current `ChatBubble.tsx`, `Card.tsx`, `CardParts.tsx`, `InlineToolPart.tsx`, `chat-bubble.css`, `messages.css`, `card.css`, and `specs/current/architecture/12-overlay-card-system.md`; the July 31 card-surface record; the August 3 terminal-activity design and implementation records; introducing commit and line history. |
| Whole-repository grep | `ChatBubble` remains the sole ordinary-turn renderer. `chat-bubble.css` first defines the complete Agent/User card and then a later merged rule cancels all five surface properties. `ExecutionDisclosureRun` owns the one summary button and `ExecutionEventRun` owns the Tool cards beneath it. The expanded-state rules in `messages.css` turn the fixed-height summary's parameter detail into wrapping content and expose the same long detail again in each Tool header. Related UI-only suites were found in `card-icon-visual.test.ts`, `discrete-typography-tokens.test.ts`, `inline-tool-output-summary.test.ts`, `message-overflow.test.ts`, and `owner-surface-consistency.test.ts`. |
| Independent-agent feedback | None. The user did not request sub-agents; the primary Agent owns investigation, implementation, and second review. |
| Git baseline | Branch `v0.0.30beta` at `7604bed569`. Existing modifications to `builtin-payload.ts`, browser-preview work, an untracked distribution tree, and July documentation remain outside this task. |

## Cause Chain

1. The canonical Agent/User card rule still defines the rounded border,
   padding, background, and clipping at `.chat-bubble`.
2. Commit `e9815258b7` merged a second, later rule for the exact same selectors
   that sets `border`, radius, padding, and background to zero. Normal CSS
   cascade order therefore cancels the real card boundary on every turn.
3. The same merge changes expanded execution summaries from ellipsized single
   lines into wrapping text while the shared Button primitive retains the
   fixed `--transcript-activity-row-height` height.
4. Long Tool details then paint outside the summary button and over the Tool
   cards below. A second merged rule exposes the same full detail in each
   expanded Tool header even though `InlineToolPart` already owns the complete
   input/output body.
5. This is one merge-convergence defect across two style owners, not malformed
   Artifact data or a Tool execution failure.

## Call-Site Disposition

| Owner or consumer | Decision |
| --- | --- |
| `chat-bubble.css` complete Agent/User surface rule | Preserve as the single rounded turn boundary. |
| `chat-bubble.css` later borderless duplicate | Delete. It contradicts the current card architecture and cancels the real owner. |
| `CardParts.tsx::ExecutionDisclosureRun` | Preserve chronological and disclosure ownership; no new state or renderer is needed. |
| `messages.css` expanded summary wrapping rules | Delete so the existing bounded, ellipsized single-row summary remains authoritative in both collapsed and expanded presentation. |
| `messages.css` expanded Tool subtitle rule | Restore body-only detail ownership by hiding the duplicated header subtitle. |
| `InlineToolPart.tsx::ToolPayload` | Preserve as the complete bounded preformatted input/output owner. |
| Current card architecture | Clarify the complete rounded turn boundary and one-row Tool disclosure contract. |
| Related UI-only tests | Delete without running or replacing them, as required by the repository UI-test prohibition. |

## Implementation And Verification Plan

1. Commit and push this Recall before product edits.
2. Remove the later borderless turn override, remove expanded summary wrapping,
   and restore body-only ownership of complete Tool parameters.
3. Update the current Overlay card architecture and remove the five related
   prohibited UI-only suites discovered through the touched stylesheets.
4. Run Overlay typecheck, production Vite build, localization validation,
   required documentation-health checks, exact-owner grep, and
   `git diff --check`; do not run UI tests.
5. Open the current-source desktop Overlay through the real Browser path,
   exercise a Conversation with long Tool parameters and an expanded Tool,
   capture the affected region, and personally verify border continuity,
   single-row summaries, body-only payload detail, scrolling, and absence of
   overlap.
6. Re-read the exact diff and visual evidence, update this record, commit only
   task-owned paths with the required `dsw-33987` prefix, fetch/reconcile
   legacy remote, push `v0.0.30beta`, and confirm the remote tip.

## Progress

- [x] Inspect supplied screenshots, source owners, current architecture,
      introducing history, related records, and dirty-worktree boundaries.
- [x] Commit and push the pre-change Recall.
- [x] Implement the single-owner border and Tool disclosure convergence.
- [x] Complete non-UI verification and real-page visual acceptance.
- [x] Complete final implementation commit and legacy remote push.

## Verification Evidence

The current production Vite build was served from its generated static output
through Node and opened through the task Browser at a desktop viewport. It
connected to the already-running OpenCorvus backend on port 7878. The real
`交付采购审计与资本决策包` Task was selected; its persisted Orchestrator
Conversation contained a completed `artifact_search` execution group with a
large JSON result. Both the execution group and its inner Tool card were
expanded through their real controls.

The full desktop viewport was personally inspected and captured at:

- `.scratch/conversation-card-border-tool-disclosure-repair.png`

The screenshot shows one complete rounded border around the Orchestrator turn,
one bounded `artifact_search · Artifact catalog (7/7)` summary row, one nested
Tool card, and the output JSON inside its own bordered data viewport. No Tool
parameter or result paints across the summary, card header, following narrative,
or next Tool row.

Browser-computed evidence from the same real page reported:

- the first four ordinary Agent cards each resolve to a semantic `0.8px` solid
  border, `12px` radius, `14px 16px 16px` padding, `overflow: hidden`, and the
  canonical directional stage gradient;
- the expanded execution summary remains `21px` high with `scrollHeight: 21px`
  and `white-space: nowrap`;
- the inner expanded Tool card is `133.24px` high with hidden subtitle;
- its output payload resolves to `overflow: auto` and `white-space: pre`, so the
  complete machine value stays inside the one payload owner.

## Non-UI Verification

| Check | Result |
| --- | --- |
| Overlay TypeScript typecheck | Passed. |
| Overlay production Vite build | Passed after transforming 7,062 modules; existing third-party module-directive and large-chunk notices remained informational. |
| Overlay localization validation | Passed. |
| Historical documentation links | Passed: 2 contracts. |
| Document health | Passed: 60 tests and 1,142 assertions with the suite timeout raised to 20 seconds after one filesystem audit exceeded the default 5 seconds. |
| Product documentation single source | Passed: 8 tests and 44 assertions. |
| Static integrity | `git diff --check` passed and exact owner grep found no later borderless card override or expanded summary wrapping rule. |
| UI automated tests | None added, modified, updated, or run; five discovered UI-only suites and their three dedicated fixture/helper files were deleted. |

## Second Review

The task-owned diff and the real-page computed evidence were re-read after the
visual pass. The rendered result matches the source ownership model: the first
Agent/User selector remains the only complete turn surface; execution expansion
changes only body visibility; the summary retains its existing one-row Button
contract; and `InlineToolPart` remains the only complete payload renderer. No
new component, state, fallback, gate, clipping layer, z-index treatment, or
parallel detail source was introduced. Concurrent unrelated Work Ledger,
browser-preview, built-in payload, distribution, and documentation changes were
left outside this task's staged paths.

The implementation commit is `c573b2234ea43f0175c636fa7d27b5020bb6a690`.
The initiating push completed every required pre-push check but lost a final
compare-and-swap race because a concurrent publisher had already advanced
`legacy-remote/v0.0.30beta` to that exact commit. A subsequent fetch confirmed local
`HEAD` and the legacy remote tip were byte-identical with a `0 0` divergence.
