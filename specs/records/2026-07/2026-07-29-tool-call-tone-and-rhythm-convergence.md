# Tool Call Tone and Rhythm Convergence

## Recall

| Item | Evidence |
| --- | --- |
| User requirement | Lighten every Tool-call row, including root/Orchestrator and child-Agent conversations, to match the restrained Codex reference; make Tool-call vertical spacing and line height identical at `1.5`. |
| Follow-up correction | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-e4048254-6af5-44be-9e47-9d6d85ffc10f.png` shows that the first repair gave the Tool row a `1.5` internal line height but left the preceding narrative boundary at the historical 4px compact gap, while the following narrative retained the 12px transcript-run rhythm. The upper and lower Tool boundaries must both use the same 12px (`1.5 × 8px`) scaled transcript gap. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-eb5b8530-e52e-4653-9ac9-b7db6080ed9d.png` shows a root Orchestrator transcript whose Tool rows are quieter than narrative text and share one compact baseline rhythm. The image was inspected at original resolution. |
| Acceptance criteria | Root-Agent and exact child-Session Tool summaries use one lighter semantic foreground; expanded chronological Tool rows inherit the same foreground; resting and interactive states do not fall back to the darker Tool-detail color; summary and expanded Tool rows use one unitless `1.5` line height and one matching `1.5em` row box; Tool names/details remain one line and ellipsize; the real desktop page is opened, interacted with, screenshot, and personally reviewed in both the main conversation and Sub-agent conversation surface. |
| Hard constraints | Keep `CardParts` as the only execution-disclosure renderer and `Card`/`CardHeader` as the only expanded Tool renderer. Use the existing Button/Card primitives and theme tokens. Do not add a second renderer, palette, fallback, compatibility selector, state source, mobile scope, or UI automated test. Do not run existing UI automated tests. Do not restart or refresh the user's running OpenCorvus/Overlay process. |
| Sources read | `AGENTS.md`; Browser skill; supplied screenshot; `specs/current/architecture/12-overlay-card-system.md`; the July Tool single-line, Codex disclosure, activity-rhythm, tone-unification, context-spacing, live-Tool, size-parity, and dispatch-name records; `CardParts.tsx`; `Card.tsx`; `CardHeader.tsx`; `InlineToolPart.tsx`; `messages.css`; `card.css`; `button.css`; theme and typography tokens. |
| Whole-repository grep | Searches covered `msg-work-details`, `work-details-toggle`, `transcript-activity-*`, `msg-work-details__tool-*`, nested Tool cards, `InlineToolPart`, `CardParts`, exact Sub-agent conversation projection, Button text-disclosure chrome, all production call sites, historical decisions, and existing test consumers. Production ownership is singular: `ExecutionDisclosureRun` emits every collapsed Tool summary, `ExecutionEventRun` reuses the canonical nested Tool Card, and the exact Sub-agent panel projects its backend transcript through the same conversation card path. |
| Independent Agent feedback | None. The user did not request delegation, and current collaboration policy prohibits unrequested sub-agents. |
| Workspace preservation | The pre-existing modification in `packages/opencorvus/src/skill/builtin-payload.ts` and concurrent Composer/workspace/spec changes are unrelated and must not be edited, staged, or committed by this task. |

## Evidence and root cause

Root/Orchestrator and exact child-Agent conversations do not have separate Tool
renderers. `SubagentConversationPanel` projects the selected backend transcript
into the same `Card`/`CardParts` path used by the main conversation.

The mismatch is inside that shared style owner:

- the compact summary Button and collapsed nested Tool header use
  `--text-muted`, while `.msg-work-details__tool-detail` independently switches
  to the darker `--text-soft`;
- pointer states also switch collapsed Tool rows back to `--text-soft`;
- typography uses a fixed `20px` line box and a separate `24px` row box, so the
  vertical space is not authored by the requested `1.5` rhythm.

The root repair is to define one transcript-local Tool foreground and one
unitless `1.5` rhythm at `.msg-work-details`, then route both the summary and
nested Tool Card through those values. No component or data-flow change is
needed.

The follow-up screenshot exposed a second, independent boundary rule in
`chat-bubble.css`: the same-message narrative-to-Tool edge still used the 4px
`--ui-gap-xs`, while a following message run used 12px. That is why only the
lower edge visually carried the requested rhythm. The correction promotes the
existing 12px transcript-run interval to one conversation-local custom
property and consumes it at both the same-message narrative-to-Tool edge and
the next-run edge. It does not add Button padding or a second Tool renderer.
Real-page geometry then exposed one more contributor: the first Markdown
paragraph in the run after a Tool carried its normal 5px top margin, so the
lower visible boundary was 17px even though the run margin itself was 12px.
The Tool-to-next-narrative selector now neutralizes that first-block margin,
leaving exactly one 12px boundary on each side.

## Call-site disposition

| Surface | Decision |
| --- | --- |
| `chat-bubble.css::.chat-bubble` | Own one scaled 12px transcript-run gap (`1.5 ×` the 8px base interval) for both Tool boundaries. |
| `chat-bubble.css::msg-text + msg-work-details` | Replace the historical 4px upper gap with the shared transcript-run gap; preserve the adjacent Markdown bottom-margin neutralization. |
| `chat-bubble.css::card-message-run + card-message-run` | Consume the same custom property instead of retaining an independent 12px literal, so the lower and upper Tool boundaries cannot drift again. |
| `chat-bubble.css::card-message-run:has(msg-work-details) + card-message-run` | Neutralize only the first Markdown block's normal top margin after a Tool, preventing a hidden 5px addition to the lower 12px boundary. |
| `CardParts.tsx::ExecutionDisclosureRun` | Preserve markup, current-Tool projection, disclosure state, and one-line name/detail structure. |
| `CardParts.tsx::ExecutionEventRun` | Preserve chronological rendering and canonical nested Tool Card reuse. |
| `SubagentConversationPanel.tsx` / `services/subagent-conversation.ts` | Preserve exact-session loading and projection; it inherits the shared Tool presentation. |
| `messages.css::.msg-work-details` | Add the single lighter Tool foreground and hover foreground; replace fixed pixel line/row geometry with `1.5` and `1.5em`. |
| `messages.css::work-details-toggle` | Consume the shared foreground without changing the Button primitive globally. |
| `messages.css::msg-work-details__tool-icon/name/detail` | Inherit the one shared foreground instead of retaining an independently darker detail color. |
| `messages.css::nested collapsed Tool Card` | Consume the same foreground and hover foreground; retain transparent chrome, one-line ellipsis, shared font/icon size, and current expansion behavior. |
| `card.css`, `button.css`, theme palettes | Preserve unchanged; global Card/Button/theme behavior must not be altered for this transcript-local request. |
| Existing UI tests and browser fixtures | Do not modify or run them under the 2026-07-29 UI automated-test prohibition. Validate through a real isolated page, direct interaction, screenshots, and personal visual review only. |

## Implementation and verification plan

1. Replace the split Tool tone and fixed pixel rhythm at the single
   transcript execution style owner.
2. Run Overlay typecheck, production build, internationalisation, document
   health, and `git diff --check`; these checks validate non-UI/static
   integrity without asserting rendered UI.
3. Launch an isolated real Overlay page without touching the user's running
   process. Use the in-app browser to inspect the root conversation and exact
   Sub-agent conversation, exercise Tool disclosure, capture scoped desktop
   screenshots, and correct any remaining tone or rhythm mismatch.
4. Review the scoped diff and screenshots a second time, update this record
   with evidence, reconcile the tracked legacy remote branch, commit with the required
   `dsw-33987` prefix, push `legacy-remote`, and verify local/remote convergence.

## Verification evidence

- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/overlay check:i18n` passed.
- `bun run --cwd packages/overlay build` passed after transforming 7,057
  modules. The existing large-chunk advisory remained non-blocking.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts
  packages/opencorvus/test/script/document-health.test.ts` passed all 85
  checks after the new record was tracked.
- `git diff --check` passed for the scoped stylesheet and documentation files.
- The isolated real Overlay at `http://127.0.0.1:5227/` loaded the live
  `静安寺商务晚餐决策页` Work conversation without restarting or refreshing the
  user's running Overlay process.
- Manual in-app-browser review covered the visible `delegate_agent`,
  `websearch`, `apply_patch`, `bash`, and `browser_preview` Tool rows in their
  real Work card. A scoped screenshot confirmed one quiet gray hierarchy,
  consistent single-line rhythm, preserved ellipsis, and no regression in the
  surrounding narrative layout.
- Browser computed-style inspection across 11 compact Tool summaries confirmed
  `14px` text, `21px` line height, and `21px` row height. Resting icon, name,
  and detail foregrounds all resolved to the same 92%-alpha semantic muted
  gray; the focused row resolved to the existing opaque muted gray.
- Eight chronological nested Tool headers were also inspected. Collapsed rows
  resolved to the same `21px` line and row geometry; the expanded header kept
  its Card chrome while adopting the same `21px` line height and semantic
  muted foreground.
- Read-only enumeration of every session under every project currently
  registered by the live backend found zero child sessions. A separate exact
  child-session screenshot therefore could not be obtained without fabricating
  data or mutating the user's runtime. Source review confirms that
  `SubagentConversationPanel` projects an exact backend child transcript through
  the same `StoreCardNode` / `CardParts` renderer and `.msg-work-details` style
  owner reviewed above; there is no child-only Tool presentation path.
- No UI automated tests were added, modified, or run. The real-page interaction
  and screenshot were exploratory acceptance evidence only and were not saved
  as a repeatable test or baseline.
- Follow-up acceptance used the isolated real Overlay and copied live data at
  `http://127.0.0.1:7881/ui/`. The existing `静安寺商务晚餐决策页` Work
  conversation rendered 11 real Tool rows; no fixture, synthetic message, or
  UI override was introduced.
- Computed geometry across nine complete narrative-to-Tool-to-narrative
  boundaries measured `12px` above and `12px` below every Tool row. The Tool
  line and row height remained `21px`; the first Markdown block after each Tool
  resolved to `0px` top margin instead of adding its former 5px.
- The follow-up screenshot was personally reviewed at the visible
  `browser_preview` boundary. Upper and lower whitespace now use the same
  rhythm while surrounding Markdown wrapping and the lighter Tool hierarchy
  remain intact.
