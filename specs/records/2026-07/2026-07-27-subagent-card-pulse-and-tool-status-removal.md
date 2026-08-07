# Sub-agent Card Pulse and Tool Status-label Removal

## Recall

| Item                       | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement           | Remove visible `Completed`, `Active`, `Pending`, and equivalent status labels from Tool execution rows. Remove the Sub-agent thumbnail card's top-right execution-state indicator. Express active execution by pulsing the whole Sub-agent card, and remove the Tool-row pulse inside that thumbnail card.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Supplied evidence          | `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-492406ae-2302-425f-b153-aa114618f8e6.png` shows repeated green `Completed` and blue `Active` Tool labels, a top-right `Running` label on the Sub-agent card, and a compact Tool row carrying its own terminal label.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Acceptance criteria        | No production Tool row renders a visible lifecycle label; the compact Sub-agent card has no header status text, dot, or avatar status ring; a running compact card pulses as one surface; its internal Tool rows have no Tool-wave animation; non-running compact cards stay static; reduced-motion keeps the card static; real Node-launched Vite verification includes a task-scoped screenshot inspected at the target region.                                                                                                                                                                                                                                                                                                       |
| Hard constraints           | Persisted Tool and Agent status remains canonical runtime data and continues to drive error styling, Tool behavior, and the single card-level running animation. Do not add a second state source, fallback, local signal, synthetic message, or temporary iframe. Preserve exact-session routing and all unrelated dirty-worktree changes. Do not restart or refresh the user's running OpenCorvus/Overlay process.                                                                                                                                                                                                                                                                                                                    |
| Sources read               | Root `AGENTS.md`; Browser skill; supplied screenshot; memory notes for `SubagentProgressGrid`; `2026-07-27-active-tool-wave-all-agent-surfaces.md`; `InlineToolPart.tsx`; `CardParts.tsx`; `SubagentProgressGrid.tsx`; `dialog.ts`; `messages.css`; `conversation.css`; focused source and Node/Vite browser tests.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Whole-repository grep      | Visible Tool lifecycle labels are rendered by `InlineToolPart.tsx::.tool-status`, `CardParts.tsx::.msg-work-details__tool-status`, `SubagentProgressGrid.tsx::.subagent-progress-event__status`, and legacy session-dialog HTML in `dialog.ts`. The compact header status is owned only by `SubagentProgressGrid.tsx::.subagent-progress-card__state`; its `Avatar status` prop adds a second running ring. `messages.css` owns all Tool-row wave selectors and explicitly includes compact `.subagent-progress-event`; `conversation.css` owns compact card status/header/event styling. Browser expectations occur in agent-card separation, chat disclosure, interactive artifacts, message chronology, and Sub-agent Dock fixtures. |
| Independent Agent feedback | None. The user did not request sub-agents or parallel agent work.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### Follow-up Recall

| Item                 | Evidence                                                                                                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User follow-up       | “我要求的子agent卡片缩略时有脉冲效果呢？” The shipped motion is not visibly communicating a pulse in the compact card.                                                                                                                                          |
| Current implementation | The animation is present only on the canonical `data-status="running"` card, but it changes a thin border from 30% to 52% role colour and an 18% outer shadow. The captured target-region screenshot makes the effect effectively indistinguishable from a static selected border. |
| Revised acceptance   | The running compact card must visibly breathe as one complete surface through a restrained surface tint, border, and surrounding role-colour halo. The animation must not transform geometry or disturb virtual-list ownership. Text remains readable; internal Tool rows, terminal cards, and reduced-motion rendering remain static. |
| Re-checked call points | `SubagentProgressGrid.tsx` remains the sole compact-card renderer; `conversation.css` remains the sole compact-card motion owner; `running-tool-wave.test.ts`, `subagent-card-pulse-browser.test.ts`, and `subagent-progress-dock-browser.test.ts` own the focused source and real-page verification. |

## Causal chain

Observable symptom: execution state is repeated as text at the end of every Tool
row and again in the Sub-agent card header, while the compact Tool row and its
parent card compete to express activity.

Direct trigger: four presentation owners render `statusLabel`, and the shared
Tool-wave selector includes compact Sub-agent Tool events.

Deep cause: lifecycle data was projected directly into every visual surface
instead of assigning one low-noise activity affordance to the compact card.
The canonical state itself is correct and must remain unchanged.

Follow-up observable symptom: the label duplication is gone, but the intended
whole-card pulse is not perceptible in normal use.

Follow-up direct trigger: the keyframe animates only a one-pixel border and a
low-alpha shadow; it does not change the card surface or geometry.

Follow-up deep cause: the first visual acceptance proved that a computed shadow
changed, but did not prove that the change was salient enough to communicate
running activity. The repair must strengthen the existing single animation,
not add another status source or nested motion.

Follow-up browser finding: a first revision also animated `transform: scale`.
The canonical fixture simultaneously exposed a missing preceding virtual user
card after a parallel conversation-summary change. Removing the transform did
not restore that row, so the transform is not proven to be its cause. Geometry
animation is still rejected as unnecessary risk; the final pulse changes only
paint properties. A focused real-page test owns the pulse evidence independently
of that later, unrelated virtual-list assertion.

## Call-point disposition

| Owner                      | Disposition                                                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InlineToolPart.tsx`       | Remove the visible Tool status chip; retain canonical `data-status` for behavior and motion.                                                                |
| `CardParts.tsx`            | Remove status from disclosure text, tooltip, and visible trailing label; retain the section's canonical `data-status`.                                      |
| `SubagentProgressGrid.tsx` | Remove compact Tool labels, top-right Agent status, and avatar running ring; keep the card's canonical `data-status`.                                       |
| `dialog.ts`                | Remove the legacy session-dialog Tool status chip so it cannot preserve a fourth visual source.                                                             |
| `messages.css`             | Delete retired Tool-label rules and remove only the compact Sub-agent Tool row from the shared Tool-wave selector.                                          |
| `conversation.css`         | Delete retired header/event status rules and add one reduced-motion-safe running-card pulse.                                                                |
| Focused and browser tests  | Prove visible labels are absent, compact Tool rows are static, the running card pulses, terminal cards do not pulse, and reduced-motion disables the pulse. |

## Implementation

1. Add source-level regressions for all production render owners and animation
   boundaries.
2. Remove the visual status renderers and their dead style rules.
3. Move compact running activity to one whole-card keyframe driven by the
   existing Agent status.
4. Update the real Vite fixture assertions and capture the target Sub-agent
   card region for visual review.
5. Run focused tests, Overlay typecheck, required document checks, and a second
   diff review before committing and synchronizing the branch to git-cc.

## Progress

- [x] Supplied evidence, prior decision, and full call-point grep reviewed.
- [x] Production implementation and regressions complete.
- [x] Real Vite visual verification and screenshot review complete.
- [x] Second review complete.
- [x] Commit and git-cc synchronization complete.
- [x] Follow-up evidence and original screenshot re-reviewed.
- [x] Strengthened whole-surface pulse implemented and regression-tested.
- [x] Follow-up real Vite screenshot inspected.
- [x] Follow-up commit and git-cc synchronization complete.

## Verification

- Focused Tool presentation, compact Sub-agent projection, and delegated-context
  tests pass: 12 tests, 53 assertions, 0 failures.
- The complete Overlay TypeScript check passes.
- The real Node-launched Vite Sub-agent/Dock test passes. It proves the running
  card uses `subagent-progress-card-running-pulse` at 1.6 seconds, observes the
  card shadow changing, keeps pending/completed compact Tool rows static,
  removes header and Tool status nodes, keeps terminal cards static, and
  disables the pulse under reduced motion.
- `.scratch/subagent-card-running-pulse.png` was inspected at original
  resolution: the whole compact card carries a restrained role-colored pulse,
  while the `bash` row has no nested wave or lifecycle label.
  `.scratch/tool-wave-subagent-dock.png` and
  `.scratch/subagent-progress-dock.png` were also inspected at original
  resolution: compact running/completed cards have no top-right state labels,
  and full Tool disclosure rows no longer show trailing lifecycle text.
- The chronology Vite browser regression passes and proves collapsed Tool
  disclosures remain interactive without status text.
- The broader Agent-card browser regression reaches and passes this task's Tool
  label/motion assertions, then fails on the concurrently changed rewind-menu
  disabled-state assertion. Chat-disclosure and interactive-artifact fixtures
  stop earlier because their expected Work Ledger rows are absent. These
  failures precede or follow this task's surface and do not contradict the
  passing dedicated Vite evidence.
- Historical-link and document-health checks pass 85 tests with 1,384
  assertions when run against an isolated validation index that marks all
  concurrently referenced July records as tracked.
- `git diff --check` passes.
- Follow-up source regression passes 4 tests with 32 assertions. It proves
  compact Tool rows remain motionless, the card keyframe changes paint only,
  and no lifecycle label or nested status owner returned.
- The focused real Node-launched Vite follow-up passes 1/1. It samples the
  canonical running card at rest and at the 800ms peak, proving border,
  surface colour, and shadow all change while `transform` does not; the
  terminal card and internal Tool row remain static, and reduced-motion
  removes the animation.
- `.scratch/subagent-card-running-pulse.png` was re-inspected at original
  resolution. The compact card now has a clearly visible role-coloured surface
  tint and surrounding halo at peak without reducing text legibility or
  animating internal rows.
- The full Sub-agent/Dock fixture reaches its later timeline-split assertion
  and currently fails because a concurrent `ConversationArtifactSummary`
  insertion changes which preceding virtual item is mounted. The same failure
  remains after removing the experimental transform and occurs after the new
  focused pulse test's entire acceptance surface.
- Overlay typecheck passes after the concurrent file-summary work settled.
- Historical document links pass 22/22 after a concurrent temporary SDK
  directory settled. Document health passes 62/63; its remaining monthly-index
  failure reports the concurrently added, currently untracked
  `2026-07-27-conversation-artifact-file-summary.md`, which is not owned by
  this follow-up.
