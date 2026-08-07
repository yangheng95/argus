# Neutral Codex Tool Wave

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | Replace the current Tool-call pulse with a Codex-style wave and do not use a special color. |
| Acceptance criteria | Running and pending Tool identity text in the active conversation carries one smooth horizontal wave; the wave uses only semantic neutral text tones in light and dark themes; terminal Tools and reduced-motion rendering stay static; the affected real page is operated, captured, and visually reviewed. |
| Hard constraints | Preserve canonical parent and Tool status ownership, the existing renderer, and the reduced-motion boundary. Do not add state, timers, fallback paths, special accent colors, User Interface (UI) automation tests, fixtures, or screenshot baselines. Preserve unrelated dirty-worktree changes and selectively commit only task-owned files. |
| Sources read | Root `AGENTS.md`; Browser control skill; `2026-08-02-running-tool-pulse-visibility-repair.md`; `2026-08-03-streaming-conversation-terminal-activity-design.md`; `2026-08-03-streaming-conversation-terminal-activity-implementation-plan.md`; `InlineToolPart.tsx`; `messages.css`; Overlay package scripts; Git history and blame for the Tool animation owner. |
| Whole-repository grep | `messages.css` is the single Tool-identity animation owner. The production selector covers full Tool cards, inline Tool rows, and collapsed execution disclosures. The August 3 integration replaced the prior opacity pulse with the shared traveling wave but retained an accent/white peak and left the now-unreferenced `tool-active-pulse` keyframes behind. `msg-streaming-status` is a separate terminal-text consumer and is outside this Tool-only request. |
| Independent agent feedback | None. The user did not request sub-agents, so the primary agent owns implementation and second review. |

## Causal chain

1. Canonical active-parent and running/pending Tool status already select the
   correct Tool identity surfaces.
2. The selected declaration already moves a narrow gradient through the text,
   so renderer or lifecycle changes are unnecessary.
3. Its highlight peak is still built from `--accent` and white, which creates
   the special-color treatment the user asked to remove.
4. The previous opacity keyframes remain defined but have no consumer after the
   wave integration, leaving the old pulse implementation as dead code.
5. The direct replacement is one neutral semantic gradient from muted text to
   normal and strong text and back, while preserving the existing wave path.

## Implementation and verification plan

1. Replace only the Tool wave's accent/white stops with neutral semantic text
   tokens and update its ownership comment.
2. Delete the unreferenced `tool-active-pulse` keyframes so the wave is the sole
   Tool activity implementation.
3. Run formatting/diff checks, Overlay typecheck/build, and documentation-health
   checks without running User Interface automation tests.
4. Start the real current-source Overlay, operate an active Tool surface through
   the Browser, capture the affected region, and personally review the neutral
   wave in both resting and highlight phases.
5. Re-review the exact diff, selectively commit task-owned files, push to
   legacy remote, and record the resulting evidence here.

## Progress

- [x] Current implementation, history, status ownership, and animation call
      sites inspected.
- [x] Neutral Tool wave implemented and old pulse keyframes removed.
- [x] Static verification complete.
- [x] Real-page visual acceptance and second review complete.
- [x] Selective commit and legacy remote push complete.

The neutral Tool-wave CSS and the visual-verification evidence landed in shared
branch commit `71b8faa84b`. That commit was created concurrently with the Work
Ledger delivery after this task had selectively staged only its three CSS hunks
and this record; no unrelated working-tree content was staged by this task.
The task-specific delivery record landed in `eb88d28318`, and both commits were
pushed through the normal legacy remote hooks to `v0.0.30beta`.

## Visual evidence

The current-source Vite Overlay was opened as a real page against the running
local OpenCorvus backend. An active `dispatch_agent` disclosure for
`target=mirror-prd-ainvest-feature-mapper` supplied the canonical active-parent
and running-Tool status; no fixture, query override, synthetic message, or
temporary interaction surface was used.

In the light theme, the Tool label and detail computed
`animation-name: msg-terminal-activity-wave`, `animation-duration: 5.6s`, and a
gradient resolving to neutral gray values from `rgb(89, 97, 100)` through
`rgb(24, 27, 29)`. Screenshots at the `130%` resting position and a traveling
`-28.7787%` position were personally reviewed: the narrow darkening moves
through the Tool identity without geometry movement or accent color.

The existing Appearance control was then used to select Dark, the same real
Tool surface was reviewed, and its semantic gradient resolved from
`rgb(146, 156, 173)` through `rgb(241, 243, 245)` with the same wave keyframe.
The wave remained neutral and legible against the dark surface. The original
Light setting was restored through the same control before the Browser tab was
closed. Completed Tool rows stayed static in both themes.

## Verification

- `bunx tsc --noEmit --pretty false` in `packages/overlay`: passed.
- `bunx vite build --config vite.config.ts` in `packages/overlay`: passed after
  transforming 7,062 modules; existing dependency-directive and chunk-size
  warnings only.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`:
  passed, 2 tests.
- `bun test packages/opencorvus/test/script/document-health.test.ts`: passed,
  60 tests and 1,142 expectations.
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`:
  passed, 8 tests and 44 expectations.
- Production owner grep confirms one Tool animation declaration and no
  remaining `tool-active-pulse` keyframes.
- No User Interface automated test was run, added, modified, or updated.
- The pre-implementation legacy remote push initially encountered a transient Domain
  Name System (DNS) resolution failure. The delivery retry passed the full
  pre-push typecheck, route, documentation, localization, and secret checks and
  advanced legacy remote `v0.0.30beta` through `eb88d28318`.
