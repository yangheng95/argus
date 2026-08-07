# Agent Card Live Tool Activity

## Recall

| Item | Evidence |
| --- | --- |
| User requirement | Replace the static Tool text in every Agent card, including the Subagent full-conversation message box, with the actual Tool that is currently active. |
| Supplied evidence | `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-3f5d8983-e0d9-414b-b7cd-1efe8154265d.png` shows repeated generic activity summaries such as “Edited files, read files, ran commands” between Agent messages. The screenshot was inspected at original resolution. |
| Acceptance criteria | Every ordinary Agent bubble, nested Agent bubble, and exact-session Subagent conversation renders the real current Tool name, concise arguments/detail, and canonical status instead of a static Tool count/category; the display updates when the Tool part moves from running to completed; historical execution disclosures remain expandable; Subagent progress cards use the same Tool display projection; real desktop Vite screenshots are inspected and corrected. |
| Hard constraints | Persisted/live Tool parts and `state.status` remain the only data source. Do not add a second activity store, local signal, query override, iframe, synthetic message, status field, fallback Tool name, or backend preview path. Preserve the exact Subagent transcript route and the existing `CardParts` renderer. Do not restart or refresh the user's running OpenCorvus/Overlay process. Preserve all unrelated dirty-worktree changes. |
| Sources read | `AGENTS.md`; Browser skill; supplied screenshot; memory note for `SubagentProgressGrid` and exact session routing; `CardParts.tsx`; `ChatBubble.tsx`; `Card.tsx`; `SubagentProgressGrid.tsx`; `subagent-presentation.ts`; `tool.ts`; `conversation-agents.ts`; transport-protocol activity projection; related unit and Node browser fixtures. |
| Whole-repository grep | `collapseWorkDetails` is enabled by all ordinary and nested Agent message surfaces in `ChatBubble.tsx` and `Card.tsx`. Every execution disclosure is owned by `CardParts.tsx`; its `workSummary()` is the static `Tools N / Changes N` source. The exact-session `SubagentConversationPanel` renders the same conversation cards, so it reaches the same owner. `SubagentProgressGrid.tsx` separately calls `subagentProgressEvents()`, which already delegates Tool description to `describeToolPart()`. Direct browser expectations for the retired count text occur in message chronology, chat-bubble disclosure, and interactive-artifact tests. |
| Independent Agent feedback | None. The current execution policy does not authorize spawning sub-agents because the user did not request delegation or parallel agents. |
| Workspace preservation | `HEAD` and `legacy-remote/v0.0.18beta` both resolve to `c5931ba6ee`. A large unrelated runtime refactor is present. `packages/overlay/src/services/events.ts` contains formatting-only concurrent changes and is outside this implementation. `specs/README.md` and the July index already contain another task's uncommitted catalog entry; it must be preserved. |

## Root cause

The backend and transport layers already retain the exact Tool name, bounded
input, output metadata, and canonical `state.status` for both hydrated and live
conversation parts. The message renderer discards that information only in the
collapsed execution header: `CardParts.workSummary()` counts part kinds and
returns `Tools N / Changes N`.

This is a presentation projection defect. Adding another activity API or Agent
state would create a second source. The repair belongs in the shared Tool
presentation layer: select the current Tool from the real chronological run,
describe it through `describeToolPart()`, and render that same model everywhere.

## Call-point disposition

| Surface | Disposition |
| --- | --- |
| `packages/overlay/src/utils/tool.ts` | Preserve `describeToolPart()` and canonical status normalization as the only Tool display decoder; add one pure projection that selects a running/pending Tool first, otherwise the latest real Tool, and returns its existing display model. |
| `packages/overlay/src/components/CardParts.tsx` | Replace the static count-only execution header with the projected actual Tool icon, name, detail, and status; preserve disclosure ownership and chronological body. |
| `packages/overlay/src/utils/subagent-presentation.ts` | Reuse the same projection for the Subagent progress-card Tool event path instead of independently decoding the part. |
| `packages/overlay/src/components/ChatBubble.tsx` | No structural change; ordinary, nested, and exact-session Subagent messages inherit the shared `CardParts` repair. |
| `packages/overlay/src/components/SubagentConversationPanel.tsx` | No structural change; preserve exact transcript routing and canonical conversation rendering. |
| `packages/overlay/src/styles/surfaces/messages.css` | Extend the existing disclosure row only as needed for a bounded icon/name/detail/status layout and running-state projection. |
| `packages/overlay/src/i18n/{en-US,zh-CN}.json` | Delete the retired `transcript.execution_tool` count label after the shared renderer no longer references it; preserve the patch-count label. |
| Unit/browser tests | Assert active-over-completed selection, live status updates, ordinary Agent and Subagent message-box coverage, disclosure behavior, and visually inspect task-scoped screenshots. |

## Implementation

1. Add focused failing tests for current Tool selection and replace browser
   expectations that encode the retired count summary.
2. Implement the pure current-Tool projection on canonical Tool parts.
3. Render that model in the shared execution disclosure header without changing
   the expandable chronological Tool cards.
4. Reuse the projection in Subagent progress presentation.
5. Run focused unit tests, Overlay typecheck/build, required document-health
   tests, and the real Node-launched Vite browser fixtures. Inspect screenshots
   at desktop size and correct any clipping, hierarchy, or status drift.

## Verification

- Focused Tool and message-presentation unit coverage passed: 36 tests,
  260 assertions, 0 failures.
- The five task-scoped Node/Playwright browser fixtures passed together against
  the real Vite page:
  `agent-card-separation-browser.test.ts`,
  `message-part-chronology-browser.test.ts`,
  `chat-bubble-disclosure-button-browser.test.ts`,
  `inline-interactive-artifacts-browser.test.ts`, and
  `subagent-progress-dock-browser.test.ts`.
- The browser run completed Vite's production build before exercising the page.
  Screenshots were inspected at desktop size for:
  a completed multi-Tool Agent run, a running Bash Tool with its real command,
  and the exact-session Subagent conversation showing a completed `read_file`
  Tool. Tool name/detail/status hierarchy remained readable and long detail
  text truncated within the message width.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  passed all 21 tests.
- The Overlay panel i18n checker passed after deleting the retired static
  Tool-count key from both locales.
- `document-health.test.ts` reached 81 passes and two unrelated failures:
  other concurrent untracked July records are absent from Git's tracked-file
  catalog. This record is indexed and is included in this task's commit. The
  combined historical-doc repeat also observed a concurrently removed
  `packages/sdk/js/.tmp-sdk-build/tsconfig.json` between discovery and read;
  the isolated historical-doc run had already passed all 21 tests.
- The final full Overlay `bun run typecheck` passed.
