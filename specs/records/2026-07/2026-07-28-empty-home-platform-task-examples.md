# Empty-home platform task examples

## Recall

| Item | Evidence |
| --- | --- |
| User request | Replace two of the six first-screen examples with “创建专家团” and “长程编排任务”. |
| Acceptance criteria | The empty home still shows exactly six compact examples; “做海报” and “写日报” are replaced by the two requested OpenCorvus platform tasks in both locales; clicking either new example fills the real Composer with an actionable prompt; focused source and real Vite browser checks pass; a fresh screenshot is visually reviewed. |
| Hard constraints | Preserve all concurrent dirty-worktree changes. Do not restart or manipulate the user's running OpenCorvus/Overlay. Keep the existing single suggestions collection, shared Button/Icon primitives, desktop-only grid, and click-to-fill interaction. Use Node, not Bun, for browser automation. |
| Read records | `AGENTS.md`; `specs/records/2026-07/2026-07-27-empty-home-task-examples.md`; Browser skill instructions. |
| Whole-repository grep | The six example identities and prompt bindings are owned by `packages/overlay/src/components/Conversation.tsx`; locale strings are owned by `en-US.json` and `zh-CN.json`; exact catalog assertions are owned by `conversation-empty-state-source.test.ts`, `mission-i18n.test.ts`, and the real Vite path in `browser/command-palette.test.ts`. The retired `poster` and `daily-report` identities have no other production consumers. |
| Independent agent feedback | None. The user did not request sub-agents or independent parallel review. |

## Decision

Replace the general-purpose “Design a poster” and “Write a daily report”
examples with “Create an expert squad” and “Orchestrate a long-running task”.
This keeps the six-card geometry and interaction unchanged while making the
first screen explain two core OpenCorvus capabilities.

Reuse the canonical `avatar-assistant` and `mission` icons. The examples remain
prompt starters rather than hidden navigation or mode switches: clicking a card
fills the visible Composer, where the user can refine and submit the request.

## Call-site disposition

| Owner | Disposition |
| --- | --- |
| `Conversation.tsx` `homeSuggestions` | Replace the `poster` and `daily-report` entries and retain their existing grid positions and tones. |
| `en-US.json` / `zh-CN.json` | Remove the two retired label/prompt pairs and add complete localized pairs for the requested examples. |
| `conversation-empty-state-source.test.ts` | Assert the new six-item canonical identity list and the two canonical icon bindings. |
| `mission-i18n.test.ts` | Assert the complete new locale catalog and exact requested Chinese labels. |
| `browser/command-palette.test.ts` | Assert the new rendered identities and verify both new cards fill the real Composer with their English prompts. |

## Verification

1. Run focused source and locale tests.
2. Run the Node-launched real Vite browser suite that owns the empty-home
   screenshot and interaction checks.
3. Inspect the fresh screenshot at original resolution and correct any visible
   label clipping, density, or alignment regression.
4. Run Overlay typecheck and the required historical-document link test.
5. Review only task-owned paths, commit with the `dsw-33987` prefix, and push
   the current delivery branch to `myhexin` through normal hooks.

## Codex review feedback

The first focused source run exposed one assertion already stale against the
current production launcher contract: `Conversation` now accepts the canonical
`work` mode in addition to `chat` and `expert-squad`. The review synchronizes
that exact structural assertion and does not change the concurrent launcher
implementation.

The first real Vite run stopped before the empty home because the shared Work
Ledger transport contract now requires every Chat row to declare its canonical
`experience`, while this fixture's three Chat-row constructors predated that
field. The fixture now declares `chat` explicitly for those existing rows
instead of weakening strict transport parsing.

Once the fixture reached the target surface, its left-Dock assertions still
expected the retired 13-pixel label tier. The freshly rendered page consistently
measures static navigation, Project, Chat, Mission, and Task labels at the
current shared 14-pixel body tier. Temporary diagnostic synchronization let
the run continue through both target screenshots, but this unrelated assertion
change is not retained in the task diff.

The next runs passed the target geometry and prompt-fill assertions but stopped
in the broad suite's later Work Ledger menu cleanup. Pointer-closing the open
modal Portal was intercepted by its backdrop, so both mouse-opened and
keyboard-opened paths were temporarily closed with Escape to continue the
visual review. That unrelated cleanup change is likewise not retained.

The target surface itself rendered at 1440 by 900 and 1920 by 1050 with all six
cards aligned and unclipped. Both new card identities rendered in the intended
positions, and clicking each filled the real Composer with its localized
English prompt. The broad suite later reached an unrelated stale Agent Squad
menu focus assertion (`body` is focused while the assertion expects the intent
trigger), so the full broad test remains non-green outside this task's delivery
surface.
