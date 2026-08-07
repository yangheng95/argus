# Active Tool Wave Across Agent Surfaces

## Recall

| Item | Evidence |
| --- | --- |
| User requirement | Every active Tool call must pulse in the scheduler Agent card, the compact Subagent progress card, and the right-Dock Subagent message card. Reuse one motion treatment, make its cycle slightly slower, and remove the leading `>` from Tool-call disclosure rows. |
| Supplied evidence | `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-2cc92bb3-7132-4718-8fa8-e640543fe0ce.png` was inspected at original resolution. It shows the scheduler `dispatch_agent` Tool as `Active`, while the compact and Dock child surfaces show the current `write` Tool as `Pending`; the three surfaces must express the same live-activity affordance. |
| Acceptance criteria | Canonical `running` and `pending` Tool states use one shared traveling-wave animation in all three surfaces; completed and error Tools remain static; the cycle increases from 1.6 seconds to 2 seconds; scheduler and Dock Tool disclosure rows have no leading chevron while retaining button/ARIA expansion; reduced-motion remains static and readable; a real Node-launched Vite page proves the animation name, duration, movement, terminal-state exclusion, marker removal, and visible result in the scheduler, compact Subagent, and right-Dock message surfaces. |
| Hard constraints | Persisted Tool `state.status` remains the only trigger. Do not add a second active flag, timer, JavaScript animation, status store, fallback, synthetic message, or surface-specific keyframe. Preserve exact-session Dock routing and the current Tool projection. Do not restart or refresh the user's running OpenCorvus/Overlay process. Preserve all unrelated dirty-worktree changes. |
| Sources read | Root `AGENTS.md`; Browser skill; supplied screenshot; `2026-07-24-agent-card-palette-and-running-tool-wave.md`; `2026-07-26-agent-card-live-tool-activity.md`; `tool.ts`; `Card.tsx`; `InlineToolPart.tsx`; `CardParts.tsx`; `SubagentProgressGrid.tsx`; `subagent-presentation.ts`; `messages.css`; `conversation.css`; design-language motion tokens; focused source and Node browser tests. |
| Whole-repository grep | `selectCurrentToolPart()` defines the current active Tool as the latest `running` or `pending` Tool. Scheduler and right-Dock message rows share `CardParts.tsx::.msg-work-details`, nested Tool cards share `Card.tsx::.card[data-kind=tool]`, and inline Tools use `InlineToolPart.tsx::.msg-tool`; all already expose canonical `data-status` and consume the single `tool-running-wave` block in `messages.css`. The compact `SubagentProgressEventRow` renders the same projected Tool status only on its trailing status span, so its row cannot consume the shared status-qualified animation. `subagent-progress-dock-browser.test.ts` owns compact-card and exact-session Dock verification; `agent-card-separation-browser.test.ts` owns scheduler/ordinary Agent Tool motion and reduced-motion verification. |
| Independent Agent feedback | None. The user did not request delegation or parallel agents. |

## Causal chain

Observable symptom: Tool lifecycle text is consistent across the three Agent
surfaces, but live motion is missing from the compact Subagent row and pending
current Tools remain static.

Direct trigger: the shared CSS animation recognizes only `running`; the compact
row also does not project its canonical Tool status onto the row that owns the
Tool name and detail.

Deep cause: the original motion contract was written before the current-Tool
projection established that both `running` and `pending` are live Tool states.
The animation selector was not updated when compact and Dock activity converged
on that projection.

## Call-point disposition

| Owner | Disposition |
| --- | --- |
| `packages/overlay/src/utils/tool.ts` | Preserve `running`/`pending` active selection and canonical status normalization unchanged. |
| `packages/overlay/src/components/{CardParts,Card,InlineToolPart}.tsx` | Preserve existing canonical `data-status` projection; scheduler and Dock already converge here. |
| `packages/overlay/src/components/CardParts.tsx` | Remove the leading chevron from Tool-backed execution disclosures while retaining it for patch-only disclosures; preserve the full-row Button and `aria-expanded` interaction contract. |
| `packages/overlay/src/components/SubagentProgressGrid.tsx` | Project the existing Tool event status onto the compact row; do not derive another activity state. |
| `packages/overlay/src/styles/tokens/design-language.css` | Add one Tool-wave cycle token at 2 seconds instead of slowing unrelated skeleton shimmer. |
| `packages/overlay/src/styles/surfaces/messages.css` | Replace the running-only keyframe contract with one active Tool wave covering `running` and `pending` across all four canonical Tool-row shapes, including compact Subagent rows. |
| `packages/overlay/src/styles/surfaces/conversation.css` | Replace the pre-existing Agent Rail tooltip `160ms` literal exposed by the required motion-coverage suite with the existing slow-duration token; do not create another timing value. |
| Focused tests | Prove all production owners consume the single selector/keyframe, terminal states stay static, duration is 2 seconds, motion changes position, and reduced-motion disables it. |

## Implementation

1. Write focused source regressions for canonical status projection, all shared
   selectors, active/terminal state boundaries, and the dedicated duration
   token.
2. Extend the compact Subagent row with its existing Tool status attribute.
3. Replace the running-only animation with one active Tool wave and remove the
   old keyframe/timing source.
4. Extend the real scheduler and Subagent/Dock browser fixtures to cover both
   active statuses and all three user-visible surfaces.
5. Run focused tests, Overlay typecheck/build, required document checks, and
   Node/Vite visual verification. Inspect task-scoped screenshots and correct
   any excessive speed, contrast loss, clipping, or terminal-state motion.

## Progress

- [x] Supplied evidence, prior decisions, and all production/test call points reviewed.
- [x] Shared active Tool motion and chevron removal implemented.
- [x] Focused, type, document, and real Vite visual verification complete.
- [x] Second review complete.
- [x] Commit and legacy remote synchronization complete.

## Verification

- Focused Tool motion, motion-token, delegated-context, and compact Subagent
  regressions pass: 11 tests, 60 assertions, 0 failures.
- The complete Overlay TypeScript check passes.
- The real Node-launched Vite batch passes both
  `agent-card-separation-browser.test.ts` and
  `subagent-progress-dock-browser.test.ts`. It proves `running` scheduler Tool
  content and `pending` compact/Dock Tool content all use
  `tool-active-wave` at 2 seconds, observes mask-position movement, keeps
  completed Tool content static, disables motion under reduced-motion, and
  finds zero Tool-disclosure chevron nodes.
- `.scratch/running-tool-wave-light.png` was inspected at original resolution;
  the scheduler Tool hierarchy remains readable with the slower traveling
  wave. `.scratch/active-tool-wave-subagent-dock.png` was inspected at original
  resolution; the compact pending Bash row and Dock pending Write row retain
  legible hierarchy, completed rows remain visually stable, and the shared
  Tool disclosure rows no longer show a separate leading chevron.
- After staging the indexed record, the required historical-link,
  document-health, and product-document single-source batch passes all 92 tests
  with 1,446 assertions.
- The broader icon-coverage suite's task-owned Tool consumer assertion passes.
  Four unrelated concurrent-worktree failures remain in icon size ownership,
  diagram SVG geometry, duplicate Workflow glyph registration, and retired
  color aliases; this task does not rewrite those owners.
- `git diff --check` passes.
- Commit `144347fb5f` passed the complete legacy remote pre-push hook: SDK import
  integrity, AI runtime integrity, all-package TypeScript checks, API route
  inventory, generated API documentation, Overlay i18n, and secret scan. The
  branch was synchronized to `legacy-remote/v0.0.19beta`.
