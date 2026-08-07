# Agent Card Palette and Running Tool Wave

## Recall

| Item | Evidence |
| --- | --- |
| User requirement | Different Agent cards currently reuse too few colors and are easy to confuse. Add more colors, but keep every color minimal, fresh, and visually quiet. Render Tools that are currently executing with a Thinking-like wave shimmer. |
| Supplied evidence | `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-62950994-18f2-491f-9a26-09fc1015a809.png` shows a pale Agent surface with expanded chronological Tool rows. The screenshot was inspected at original resolution. |
| Acceptance criteria | Known Agent stages use a substantially broader theme-adaptive hue set without saturated/heavy card fills; commonly adjacent roles do not share the same accent; the existing 7% surface tint and 26% border tint remain the only Agent-card color projection; only `running` Tool presentation receives a left-to-right wave shimmer; completed, error, and pending Tools remain static; reduced-motion users receive a static readable Tool row; real light/dark desktop screenshots are inspected and corrected. |
| Hard constraints | Preserve `stageAccent` as the single stage-to-token resolver, `Card` / `ChatBubble` as the only stage projection path, and persisted Tool `state.status` as the only running-state source. Do not add a second status field, renderer, iframe, preview override, fallback color generator, or JavaScript animation loop. Use the existing motion-duration token and the real Node-launched browser fixture. Do not restart or refresh the user's running OpenCorvus / Overlay process. |
| Sources read | `AGENTS.md`; Browser skill; supplied screenshot; `specs/current/architecture/12-overlay-card-system.md`; `specs/records/2026-07/2026-07-15-agent-message-card-reference-surface.md`; `card-color.ts`; `Card.tsx`; `ChatBubble.tsx`; `CardParts.tsx`; `CardHeader.tsx`; `InlineToolPart.tsx`; `card.css`; `chat-bubble.css`; `messages.css`; `design-language.css`; focused source and browser tests. |
| Whole-repository grep | `stageAccent` is called only by `ChatBubble.tsx`, `ConversationAgentRail.tsx`, and card-tree construction that ultimately projects through `Card.tsx`; `card.css` is the single owner of `--card-stage-*` declarations; `chat-bubble.css` consumes the resulting `--card-stage` for the 7% background and 26% border. Tool status is projected as `data-status` by `Card.tsx` and `InlineToolPart.tsx`; `messages.css` owns transcript Tool presentation. Direct regression owners are `card-stage-tokens.test.ts`, `chat-bubble.test.ts`, `overlay-architecture-guards.test.ts`, and `agent-card-separation-browser.test.ts`. |
| Independent Agent feedback | None. The current execution policy does not authorize spawning sub-agents unless the user explicitly requests delegation or parallel agents. |
| Workspace preservation | The worktree contains a large unrelated Agent/runtime refactor. The files selected below were clean at investigation time except `specs/README.md`, whose existing unrelated index addition must be preserved and excluded from this task's staged patch. |

## Root cause

The stage system already has one resolver and one visual projection, but almost
every Agent stage color is an interpolation of only four semantic status colors:
accent, good, warn, and bad. Multiple role pairs therefore converge onto nearly
the same hue even though they have different token names. The card tint is
already quiet; the missing dimension is hue variety, not stronger saturation or
more surface paint.

Running Tools already expose canonical `data-status="running"` on both Tool
cards and the compact inline Tool renderer. Their current styles change only a
badge color. The animation belongs on those existing status-qualified visual
owners, not in message data or a new runtime state.

## Call-point disposition

| Surface | Disposition |
| --- | --- |
| `packages/overlay/src/utils/card-color.ts` | Preserve as the single known-stage-to-CSS-token resolver; do not add raw color fallback. |
| `packages/overlay/src/components/ChatBubble.tsx` | Preserve stage projection and Agent-card structure. |
| `packages/overlay/src/components/Card.tsx` | Preserve canonical `data-status` projection for Tool cards. |
| `packages/overlay/src/components/InlineToolPart.tsx` | Preserve canonical `data-status` projection for compact Tools. |
| `packages/overlay/src/styles/surfaces/card.css` | Replace four-color stage interpolation with a broader low-chroma, `light-dark()` OKLCH stage palette. Keep user/system/tool semantic colors and existing card tint strength. |
| `packages/overlay/src/styles/surfaces/messages.css` | Add the running-only wave mask to canonical Tool content and a reduced-motion override. |
| `packages/overlay/test/card-stage-tokens.test.ts` | Assert theme-adaptive low-chroma stage declarations and enough unique Agent-stage colors. |
| `packages/overlay/test/browser/fixtures/agent-card-separation/main.tsx` | Add real Agent cards covering the broader palette and change the existing Build Tool to `running`. |
| `packages/overlay/test/browser/agent-card-separation-browser.test.ts` | Assert palette uniqueness, quiet surface/border projection, animation ownership, static non-running rows, reduced-motion behavior, and capture light/dark task-scoped screenshots. |

## Implementation

1. Define calm per-stage OKLCH (OKLab Lightness, Chroma, Hue) accents with a
   constrained light/dark lightness and chroma range. Preserve semantic colors
   for user, assistant, system, and Tool surfaces.
2. Apply a CSS mask-position wave only to visible content of canonical
   `running` Tool rows. Reuse the established skeleton-shimmer cycle duration
   and disable the animation under `prefers-reduced-motion`.
3. Extend the existing real ChatBubble fixture rather than adding a parallel
   palette renderer. Capture and inspect both themes.
4. Run focused source tests, the Node browser test, Overlay typecheck/build, and
   the required historical-docs/document-health checks. Repeat visual review
   after any correction.

## Verification

- `bun test packages/overlay/test/card-stage-tokens.test.ts packages/overlay/test/running-tool-wave.test.ts packages/overlay/test/chat-bubble.test.ts` passed: 12 tests and 250 assertions.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/agent-card-separation-browser.test.ts` passed after exercising actual disclosure controls, two Tool statuses, animation movement, and reduced-motion emulation.
- `bun run typecheck && bun run build` passed in `packages/overlay`; the production Vite build transformed 4,952 modules.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` passed all 21 tests.
- The combined document-health run passed 80 tests and exposed two unrelated concurrent-worktree failures: the July index links another untracked record (`2026-07-24-completed-message-card-auto-collapse.md`), and another task deleted tracked `15-agent-context-packet.md` before its replacement is committed.
- The broad Overlay architecture suite passed 124 tests. Its three remaining failures reproduce against `HEAD` or the unrelated dirty `inspector.css`: the checked-in `messages.css` duplicate-selector debt is already 10 while the stale budget is 5, and the concurrent Goal Group refactor has not yet restored the running/blocked status selectors expected by two guards. The new running-Tool selector itself is unique, uses no raw color, and passes the relevant raw-color/surface ownership guards.
- `.scratch/agent-card-palette-light.png` and `.scratch/agent-card-palette-dark.png` were inspected at original resolution after the final browser run. Twelve actual Agent cards show a quiet lavender, sand, blue, cyan, rose, peach, green, teal, and violet range without glow, shadow, heavy fill, or a second identity rail.
- `.scratch/running-tool-wave-light.png` and `.scratch/running-tool-wave-dark.png` were inspected at original resolution after the final browser run. The running Bash row shows the intended traveling fade while the completed Read row stays static and legible; the browser assertion confirms the wave position changes and that reduced-motion removes both mask and animation.
- The first required `myhexin` push attempt ran the real pre-push hook and was blocked by unrelated Fact Check / Visual QA TypeScript errors in the concurrent dirty worktree. A final push retry remains required after this task's commit.
