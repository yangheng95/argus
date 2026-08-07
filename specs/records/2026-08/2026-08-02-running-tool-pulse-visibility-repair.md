# Running Tool Pulse Visibility Repair

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | The pulse effect on an in-progress Tool call has disappeared. Restore a perceptible running cue. |
| Supplied evidence | The supplied screenshot was inspected at original resolution. It shows a live `dispatch_agent target=base-developer` disclosure whose text appears uniformly dim and static. |
| Acceptance criteria | A Tool with canonical child status `running` inside the canonical active parent conversation has a clearly perceptible, low-noise text pulse. The pulse uses the existing 6.8-second shared cadence, completes one concise breath near the start of the cycle, then rests. Pending and terminal Tools, non-active parents, ordinary narrative, compact Agent contents, and reduced-motion rendering remain static. The current-source Overlay is operated as a real page and the affected region is captured and personally reviewed. |
| Hard constraints | Keep canonical child and parent status as the only trigger. Preserve the existing compositor-owned opacity implementation, shared duration token, reduced-motion boundary, renderer, and hierarchy. Do not add a timer, state, fallback, gate, alternate renderer, mask repaint, synthetic message, iframe, query override, fixture, screenshot baseline, or User Interface (UI) automated test. Do not restart or mutate the user's native OpenCorvus process. Preserve unrelated dirty-worktree changes. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied screenshot; `2026-07-29-conversation-streaming-text-wave.md`; `2026-07-30-parent-execution-wave-scope.md`; `2026-07-30-overlay-runtime-efficiency-root-repair.md`; `App.tsx`; `Card.tsx`; `CardHeader.tsx`; `CardParts.tsx`; `InlineToolPart.tsx`; `SubagentProgressGrid.tsx`; `messages.css`; `conversation.css`; `markdown.css`; and motion tokens. |
| Whole-repository grep | `App.tsx` is the sole owner of `data-conversation-execution-status`. `Card.tsx`, `InlineToolPart.tsx`, and `CardParts.tsx` are the production Tool-status renderers. `messages.css` is the sole Tool-text animation owner and covers full Tool cards, inline Tool rows, and collapsed execution disclosures. `conversation.css` separately owns compact Agent surface motion and thinking text. `--ui-duration-loop-tool-wave` has exactly three consumers: running Tool text, compact Agent surface wave, and retry-thinking color wave. No second Tool-text keyframe or animation owner exists. |
| Independent agent feedback | None. The user did not request sub-agents, so the primary agent owns implementation and second review. |
| Git baseline | Local and `legacy-remote/v0.0.28beta` both pointed to `1f16481df3ca401d6dba470c2527e3d9dd13694c` after fetch. The worktree already contained unrelated orchestration, Expert Squad, test, and specification changes; none may be staged or rewritten by this task. |

## Causal chain

1. The Tool call still projects `data-status="running"`, and its selected Task
   still projects the parent execution as `active`; the animation selector has
   not lost its lifecycle input.
2. The July 30 runtime-efficiency repair replaced the traveling glyph mask with
   compositor-owned whole-text opacity, correctly removing per-frame glyph
   repaint.
3. The replacement keyframe spreads a 70% to 100% opacity transition evenly
   across the full 6.8-second shared cycle.
4. That slow, low-amplitude change is technically animated but perceptually
   indistinguishable from static muted text, matching the supplied screenshot.
5. The root correction is to keep opacity composition while concentrating one
   larger-amplitude breath near the start of the existing cycle and reserving
   the remainder as an explicit quiet interval.

## Complete call-site disposition

| Owner or consumer | Decision |
| --- | --- |
| `packages/overlay/src/components/App.tsx` | Preserve the sole canonical parent execution projection. |
| `packages/overlay/src/components/Card.tsx` and `CardHeader.tsx` | Preserve full Tool-card child status and `.card__main` structure. |
| `packages/overlay/src/components/InlineToolPart.tsx` | Preserve inline Tool child status and label/detail structure. |
| `packages/overlay/src/components/CardParts.tsx` | Preserve collapsed execution disclosure status and label/detail structure. |
| `packages/overlay/src/styles/surfaces/messages.css` | Keep the single running-Tool selector and `tool-active-pulse`; change only its opacity keyframe stops so the existing 6.8-second cycle has one perceptible breath followed by a long rest. |
| `packages/overlay/src/styles/tokens/design-language.css` | Preserve the shared 6.8-second duration token because it also owns compact Agent and retry-thinking cadence. |
| `packages/overlay/src/styles/surfaces/conversation.css` | Preserve compact Agent and retry-thinking animation owners; they are not the reported Tool-text regression. |
| Existing UI tests directly encountered in the affected presentation path | Delete obsolete source/browser assertions without running them, as required by the current UI-test prohibition; do not replace them with another automated visual assertion. |

## Implementation and verification plan

1. Commit and push this Recall before product edits.
2. Retune the existing opacity keyframe without changing status, renderer,
   animation ownership, or the shared cadence.
3. Delete directly encountered obsolete UI tests in the affected Tool
   presentation path without running them.
4. Run whitespace, Overlay typecheck/build, localization, and documentation
   health checks. Do not run UI tests.
5. Start an isolated current-source backend and Vite page, operate the real
   desktop UI through the Browser, inspect computed animation state over time,
   capture the affected region, and personally review the screenshot.
6. Re-grep owners, review the exact diff, update this record, selectively
   commit only task-owned content, push through normal hooks to `legacy-remote`, and
   verify remote convergence.

## Progress

- [x] Supplied screenshot, history, render chain, lifecycle scope, motion owner,
      performance change, and complete production call sites inspected.
- [x] Recall committed and pushed as `5ba0a19cc2`.
- [x] Product correction and obsolete UI-test cleanup complete.
- [x] Static, type, build, localization, and documentation verification complete.
- [x] Real-page visual acceptance and second review complete.
- [x] Implementation commit `1ab744c190` and legacy remote push complete; final
      delivery-record convergence follows this recorded verification.

## Visual evidence

The current-source Vite Overlay was opened as a real page and connected
read-only to the already-running local OpenCorvus server on port 7878. The
native application and backend were not restarted, and no message, Task,
setting, or other product state was mutated. The selected active Task exposed
the same live `dispatch_agent target=base-developer` disclosure shown in the
user's evidence.

The shared parent projected `active`, the exact Tool projected `running`, and
the Tool label computed `animation-name: tool-active-pulse` with a `6.8s`
duration. Fifteen samples across one cycle observed stable rest frames at
opacity `1`, a trough at approximately `0.49`, and a return to `1`. The final
capture pass measured `0.442836` at the trough and `0.994897` after recovery.
The text and icon pulse without geometry movement; narrative, terminal Tool
rows, and Agent-card contents remain static.

- [`2026-08-02-running-tool-pulse-trough.png`](../../artifacts/2026-08-02-running-tool-pulse-trough.png)
  captures the visibly dim breath phase on the real active
  `dispatch_agent target=base-developer` row.
- [`2026-08-02-running-tool-pulse-rest.png`](../../artifacts/2026-08-02-running-tool-pulse-rest.png)
  captures the same row restored to its stable full-opacity interval.

Both screenshots were inspected at original resolution. The affected Tool row
changes clearly between the two frames while its surrounding message and the
three compact Agent cards retain the same layout. The temporary Vite server
and Browser tab were closed after acceptance.

## Verification

- `bun run typecheck` in `packages/overlay`: passed.
- `bun run build:vite` in `packages/overlay`: passed after transforming 7,061
  modules; existing dependency-directive and chunk-size warnings only.
- `bun run --cwd packages/overlay check:i18n`: passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`:
  passed.
- `bun test packages/opencorvus/test/script/document-health.test.ts`: passed,
  60 tests and 1,142 expectations, using a temporary Git index that also
  treated the concurrently authored August record as tracked. The first
  shared-index run correctly reported only that other task's linked but
  untracked record.
- `git diff --check`: passed.
- Production owner grep confirms one Tool-text animation owner, one keyframe,
  and the existing canonical parent-active plus child-running selector.
- No UI automated test was run, added, modified, or updated. Four directly
  encountered obsolete UI assertion files and their two dedicated fixture
  directories were deleted without execution, per the repository rule.
