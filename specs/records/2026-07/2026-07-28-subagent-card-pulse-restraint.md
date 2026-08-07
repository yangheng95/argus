# Sub-agent Card Pulse Restraint

## Recall

| Item | Evidence |
| --- | --- |
| User requirement | “把子agent缩略卡片的脉冲呼吸效果减弱，现在有点浓妆艳抹了” — keep the running pulse, but make the compact Sub-agent card visibly quieter. |
| Acceptance criteria | A running compact card still breathes as one paint-only surface; the peak uses only a light role-colour tint and restrained perimeter halo; text and nested Tool rows remain visually stable; terminal cards and reduced-motion rendering remain static. |
| Hard constraints | Preserve canonical Agent status as the sole activity source, exact-session routing, compact-card geometry, the shared motion duration token, and all unrelated dirty-worktree changes. Do not add a second state source, fallback, local signal, geometry animation, temporary iframe, mobile scope, or interfere with the running OpenCorvus/Overlay process. Playwright runs through Node. Commit subjects start with `dsw-33987` and delivery pushes to `legacy-remote`. |
| Sources read | Root `AGENTS.md`; Browser skill; memory note and rollout summary for `SubagentProgressGrid`; `2026-07-27-subagent-card-pulse-and-tool-status-removal.md`; `SubagentProgressGrid.tsx`; `conversation.css`; `running-tool-wave.test.ts`; focused Node/Vite pulse fixture; current peak screenshot. |
| Whole-repository grep | `SubagentProgressGrid.tsx` remains the sole compact-card renderer. `conversation.css` owns the only `subagent-progress-card-running-pulse` keyframes. `running-tool-wave.test.ts`, `subagent-card-pulse-browser.test.ts`, and `subagent-progress-dock-browser.test.ts` are the only focused pulse assertions. `--card-stage` remains the existing role-colour projection and `--ui-duration-loop-pulse` remains the shared 1.6-second loop token. |
| Independent Agent feedback | None. The user did not request sub-agents or parallel agent work. |

## Causal chain

Observable symptom: the running compact card reads as heavily tinted and surrounded
by a conspicuous coloured glow at the pulse peak.

Direct trigger: the peak mixes 8% role colour into the whole surface, raises the
border to 68%, adds a 2px 24% outer ring, and adds a 20px 30% halo.

Deep cause: the prior follow-up optimized for making the pulse unmistakable after
an under-salient first attempt, but the resulting amplitude exceeds the surrounding
low-noise card language. The canonical activity state and one-card animation model
are correct; only the paint amplitude needs recalibration.

## Call-point disposition

| Owner | Disposition |
| --- | --- |
| `packages/overlay/src/styles/surfaces/conversation.css` | Keep the existing keyframe and shared duration; reduce only peak surface, border, perimeter, and halo strength. |
| `packages/overlay/test/running-tool-wave.test.ts` | Replace the old large-halo expectation with the restrained peak contract while retaining paint-only and reduced-motion assertions. |
| `packages/overlay/test/browser/subagent-card-pulse-browser.test.ts` | Reuse the real Node/Vite fixture to prove the quieter running card still changes paint, while terminal, nested Tool, geometry, and reduced-motion behavior stay unchanged. |

## Implementation

1. Reduce the existing peak paint values without introducing another animation or
   changing the shared timing system.
2. Update the focused source regression to reject the superseded large halo.
3. Run focused tests and Overlay typecheck.
4. Launch the real Vite fixture with Node, inspect the target-region screenshot at
   original resolution, and iterate if the result is still too loud or too faint.
5. Run documentation health checks, review the exact diff twice, commit only
   task-owned hunks, reconcile the delivery branch, and push to `legacy-remote`.

## Progress

- [x] Baseline, prior decision, screenshot, and full call-point grep reviewed.
- [x] Pulse amplitude and regression updated.
- [x] Real Vite screenshot inspected and accepted.
- [x] Focused checks and second review complete.
- [x] Commit and legacy remote synchronization complete.

## Verification

- `bun test packages/overlay/test/running-tool-wave.test.ts`: 4 tests and
  34 assertions pass. The keyframe remains one paint-only, reduced-motion-safe
  whole-card animation, now explicitly rejects the superseded 20px halo, and
  retains static nested Tool rows.
- `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1 node --test
  packages/overlay/test/browser/subagent-card-pulse-browser.test.ts`: 1/1
  passes against the real Vite fixture. The running card still changes border,
  surface, and shadow at the 800ms peak; geometry, terminal cards, nested Tool
  rows, and reduced-motion rendering remain static.
- `.scratch/subagent-card-running-pulse.png` was inspected at original
  resolution. The former full pink wash and broad halo are gone; the running
  Frontend card keeps only a light role-coloured edge and quiet surface
  breathing without competing with its content.
- A second in-app Browser pass against the isolated Vite fixture confirmed the
  three-card desktop composition, a 1.6-second running animation, no transform,
  and zero browser console errors.
- `bun run --cwd packages/overlay typecheck` and
  `bun run --cwd packages/overlay check:i18n` pass.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  passes 22/22. `document-health.test.ts` passes 63/63 with a temporary
  validation index that marks this record and the two concurrently referenced
  untracked July records as tracked; the real Git index remains untouched.
- `git diff --check` passes.
