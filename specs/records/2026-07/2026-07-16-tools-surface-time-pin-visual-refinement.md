# Tools Surface, Tool Time, and Pin Visual Refinement

## Recall

| Item | Detail |
| --- | --- |
| User requirements | 1. Make the expanded Tools content use the same color tone as the conversation background, only slightly darker. 2. Keep the visible tool-call duration, but make hover expose the actual tool-call time instead of the argument summary. 3. Tilt the shared pin glyph to the right. |
| Acceptance criteria | The expanded Tools/Reasoning surface derives from `--chat-canvas`, preserves its hue, and is slightly darker; the tool parameter summary no longer owns a native hover title; hovering the canonical tool header still opens the existing Kobalte timing tooltip and hovering its trailing duration exposes the exact persisted start time; the shared pin glyph rotates right in Mission, Chat, Project-menu, and pinned-project surfaces; focused unit/static coverage, Node-launched browser checks, screenshots, typecheck, and document health pass. |
| Hard constraints | Preserve `CardParts` as the only execution-disclosure owner, `CardHeader` as the only rich tool-timing tooltip owner, `CardDurationChip` as the only duration renderer, `part.state.time.start/end` as the only timing source, and `pin-tilted` as the only Work Ledger pin glyph. Do not add a second renderer, fallback time, custom popup, handwritten icon, mobile/tablet scope, worktree, or interaction with the user's running OpenCorvus/Overlay. Browser validation uses isolated fixtures and Node-started Playwright. |
| Supplied evidence | `codex-clipboard-6b31eeb1-d43e-49a5-9f20-eb63e7f57240.png`, `codex-clipboard-359994d9-7f08-4e71-846a-1b1f6fb56641.png`, and `codex-clipboard-ea3ac8b0-bb98-49a1-b8f9-ed076e576246.png`, inspected at original resolution. |
| Sources read | `AGENTS.md`; browser-control skill; `specs/README.md`; `specs/current/architecture/99-principles.md`; the 2026-07-14 tool timing, 2026-07-15 single-line Tool, 2026-07-16 execution-disclosure stability, and 2026-07-16 pin/header-order records; `CardParts.tsx`, `CardHeader.tsx`, `CardHeaderChrome.tsx`, `card-timing.ts`, `tool-card-node.ts`, `messages.css`, `base.css`, Work Ledger components, relevant locale/theme files, and their focused/static/browser tests. |
| Whole-repository search evidence | `rg` enumerated every `CardDurationChip`, `toolTimingRows`, `toolToCardNode`, `msg-work-details[data-expanded]`, `--chat-canvas`, `pin-tilted`, and `.icon-pin-tilted` call site. The concrete ownership and per-call decision table follows below. |
| Independent agent feedback | None. The user did not request delegation, so no sub-agent was started. |

## Evidence and root cause

The Tools hue mismatch is caused by `.msg-work-details[data-expanded="true"]` mixing the neutral `--surface-inset` token with transparency. A colored host/conversation canvas therefore remains cyan while the expanded execution surface becomes neutral gray. The correct base is the inherited `--chat-canvas`; mixing that base with a small amount of black preserves hue while lowering all color channels consistently.

Tool timing data is already complete and persisted. `toolToCardNode()` requires `state.time.start`, validates `state.time.end`, and `toolTimingRows()` feeds the existing Kobalte tooltip. The observed argument popup comes from the nested `.card__subtitle` native `title`, while the trailing `CardDurationChip` deliberately has no tool title. The repair is presentation ownership: let the parent Tool header keep hover ownership and give the existing duration chip the persisted start-time title. No new timing source is needed.

The pin registry already exposes one Lucide-backed `pin-tilted` glyph to every Work Ledger pin surface. Its shared CSS transform is `rotate(-45deg)`, which visibly leans left. Changing that single transform to `rotate(45deg)` turns every existing call site to the right without changing hit targets or pin behavior.

## Whole-repository call-site decisions

| Surface / call site | Decision |
| --- | --- |
| `messages.css` `.msg-work-details[data-expanded="true"]` | Replace the neutral `--surface-inset` mix with a local semantic expanded-surface token derived from inherited `--chat-canvas` and a small black mix. |
| `CardParts.tsx` execution disclosure | Keep markup, disclosure ownership, persistence, ordering, and interaction unchanged. |
| Light, dark, and VS Code Dark `--chat-canvas` declarations plus `.chat`/`.chat-scroll` consumers | Keep unchanged; they remain the conversation color source consumed by the execution surface. |
| `message-embed.test.ts` and message-chronology browser fixture | Update the source contract and prove the expanded surface is the same non-neutral hue and darker than a colored fixture conversation canvas; capture the expanded surface screenshot. |
| `tool-card-node.ts` / `toolTimingRows()` | Keep persisted time projection and the rich Started/Finished/Duration/Status rows unchanged. |
| `CardHeader.tsx` `.card__subtitle` | Preserve ellipsis and content; suppress only the nested native title for Tool cards so the parent Kobalte trigger owns Tool hover. Non-Tool subtitle titles remain unchanged. |
| `CardDurationChip` in `CardHeaderChrome.tsx` | Preserve visible duration and shared clock; use the existing precise timestamp formatter for a Tool-only persisted start-time title. Agent/session duration titles remain unchanged. |
| `CardHeader` and `ChatBubbleIdentity` `CardDurationChip` callers | Keep both callers; behavior differentiates from the existing `node.kind`, not from new props or a second renderer. |
| `card-duration-single-source.test.ts`, `card-timing.test.ts`, and message-chronology browser test | Add regression coverage for the Tool duration title, native Tool-summary-title removal, and continued rich timing-tooltip behavior. |
| `Icon.tsx` `pin-tilted` registry plus Work Ledger/Project call sites | Keep unchanged; all production pin surfaces continue to use the shared icon. |
| `base.css` `.icon-pin-tilted` | Change the single shared transform from `-45deg` to `45deg`. |
| `focused-popup-surface.test.ts`, Work Ledger static tests, and titlebar/Work Ledger browser fixture | Update the direction assertion, assert the real Mission-row glyph matrix leans right, and inspect the existing Mission-actions screenshot. |

## Implementation plan

1. Route the expanded Tools surface through a conversation-canvas-derived semantic color and strengthen its source/browser color contract.
2. Remove the Tool subtitle's competing native title and expose the precise persisted call start time from the existing duration chip while preserving the rich Kobalte timing tooltip.
3. Rotate the shared pin glyph to the right and update its static and real-browser visual contract.
4. Run focused tests, Node browser fixtures, inspect current-goal screenshots, run Overlay typecheck/i18n plus spec/document checks, then perform a second diff review, commit with the required prefix, fetch/merge the delivery branch if needed, and push to `legacy-remote`.

## Verification

- Focused Tool/surface/icon coverage passed: 24 tests and 178 assertions across `card-duration-single-source`, `card-timing`, `message-embed`, `focused-popup-surface`, and `card-header-title`.
- Adjacent header, conversation, Work Ledger, startup chrome, and theme coverage passed: 62 tests and 736 assertions across six suites.
- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/overlay check:i18n` passed.
- The titlebar/Work Ledger Node browser scenario passed and asserted a positive rotation-matrix coefficient for the real Mission pin glyph. `.scratch/work-ledger-mission-actions.png` was inspected; the shared pin leans right without changing the action rail.
- The Node message-chronology browser scenario passed after one tooling-only rerun. An earlier command timeout left the first fixture lifecycle dirty and produced `ERR_CONNECTION_REFUSED` during browser cleanup; no product assertion failed. The stale fixture was isolated to port 5193, the original scenario was rerun alone, and it passed with the exact colored-canvas mix, Tool duration/start-time equality, missing parameter native title, rich timing rows, keyboard path, and screenshots.
- `.scratch/message-part-chronology-component.png` and `.scratch/tool-timing-tooltip-hover.png` were inspected. The expanded Tools surface preserves the cyan conversation hue at a slightly lower brightness; the timing popup retains Started, Finished, Duration, and Status.
- The in-app browser independently loaded the isolated fixture on port 5194. Its real DOM exposed visible `2s` duration text, `Jun 21, 2026, 07:59:59 AM` as the duration's hover/accessibility title, no Tool summary title, conversation background `rgb(228, 246, 250)`, and Tools background `color(srgb 0.858353 0.926118 0.941176)`. The inspected screenshot showed the intended same-tone separation without gray drift.
- `historical-docs-links.test.ts` and `product-docs-single-source.test.ts` passed. The combined document-health run otherwise passed 79 checks but correctly reported two README targets not yet tracked: this task record and the concurrent, unrelated `2026-07-16-conversation-and-home-width-alignment.md`. This task record will be staged before the final rerun; the concurrent record remains outside this task's commit ownership.

## 2026-07-17 Tool start-time inline-hover correction

### Recall

| Item | Detail |
| --- | --- |
| User requirement | Retry the Tool hover behavior: when the operator hovers a Tool row, show that tool call's start time in the illustrated trailing-header position immediately before its elapsed duration. |
| Acceptance criteria | A Tool header shows no inline start-time text at rest; hovering the whole Tool header or focusing it from the keyboard reveals the persisted start time immediately before the existing duration; the value is localized to seconds, uses semantic `<time>` markup with the exact ISO timestamp, and leaves the existing Started/Finished/Duration/Status tooltip intact. The real desktop fixture, screenshot review, focused tests, and Overlay typecheck must pass. |
| Hard constraints | Keep `part.state.time.start` -> `CardNode.time` as the only start-time source and `CardDurationChip` as the shared trailing timing owner. Do not add host state, a second clock, a duplicate popup, a fallback timestamp, a mobile/tablet layout, or interfere with the user's running OpenCorvus/Overlay. Playwright must run through Node. Per the user's latest instruction, do not push this correction. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-6efa4c9c-dd5c-4466-a637-c2b369cc9f05.png`, inspected at original resolution; the marked target is the gap directly before the visible `0s` duration. |
| Sources read | `AGENTS.md`; Browser control skill; this record's prior implementation evidence; `CardHeader.tsx`; `CardHeaderChrome.tsx`; `card-timing.ts`; `time.ts`; `card.css`; `message-part-chronology-browser.test.ts`; `card-duration-single-source.test.ts`; `card-timing.test.ts`; the message chronology fixture. |
| Whole-repository search evidence | `rg` enumerated every `CardDurationChip` call (`CardHeader`, `ChatBubble`), every `.card__duration` style/test consumer, all `toolTimingRows` consumers, every Tool timing trigger, and the shared `stamp`/`preciseStamp` formatters. `CardHeader` is the only Tool timing-tooltip trigger; `CardHeaderChrome` is the only duration renderer; `card.css` is the only `.card__duration` style owner. |
| Independent agent feedback | None. The user did not request sub-agents, so none were started. |
| Existing workspace state | Preserve the unrelated, already-uncommitted Chat scroll/composer changes in `App.tsx`, `Conversation.tsx`, `conversation.css`, their tests, and the 2026-07-17 Chat alignment record/index edits. |

### Corrected causal chain

The previous repair exposed `preciseStamp(node.time)` only as the native
`title` of the narrow elapsed-duration span. That requires the pointer to land
on the `0s` text and delegates presentation timing and placement to the browser;
it cannot render a value in the marked header gap when the Tool row itself is
hovered. The rich Kobalte tooltip already proves that the persisted start time
is available, but it is a separate elevated detail surface and does not satisfy
the requested inline location.

The correction belongs in the shared trailing timing renderer: render one
semantic start-time element from `CardNode.time` immediately before the existing
duration and let the Tool header's existing hover/focus state reveal it. This
keeps data and rendering ownership single-source while making the requested
placement deterministic.

### Call-site disposition

| Surface / call site | Decision |
| --- | --- |
| `CardHeader` -> `CardDurationChip` | Keep the canonical Tool header order and hover trigger; the shared timing renderer inserts the start value directly before duration. |
| `ChatBubble` -> `CardDurationChip` | Keep unchanged; its agent nodes do not receive Tool-only start markup. |
| `CardDurationChip` | For valid Tool timestamps, render a localized-to-seconds `<time>` before the elapsed span; retain the full persisted ISO value for semantics and the existing precise title. |
| `card.css` | Add one Tool-only inline-time style that is hidden at rest and revealed by `.card__head:hover` or `.card__head:focus-within`; keep duration styling and tooltip chrome unchanged. |
| `toolTimingRows` / `card-timing.ts` | Keep unchanged; the structured timing tooltip remains authoritative for Started, Finished, Duration, and Status detail rows. |
| Source/unit tests | Assert one shared Tool-only inline start projection, semantic timestamp ownership, hover/focus CSS, and absence of a second timing computation. |
| Node browser fixture | Assert hidden-at-rest behavior, hover and keyboard-focus visibility, exact placement before duration, equality with the persisted start value, continued tooltip rows, and capture the updated Tool-hover screenshot. |

### Implementation and verification plan

1. Extend the existing trailing timing renderer and Tool header CSS without changing timing data flow or tooltip ownership.
2. Add focused source and real-browser regression assertions for rest, hover, focus, value, semantic timestamp, order, and geometry.
3. Run focused tests, Overlay typecheck/i18n, and the Node-launched message-chronology browser scenario; inspect the current-goal screenshot at original resolution and iterate if placement is wrong.
4. Run required spec/document checks, review the scoped diff twice, and create a task-only local commit without pushing.

### Correction result

- `CardDurationChip` now projects one Tool-only semantic `<time>` from the
  existing persisted `CardNode.time` immediately before the elapsed-duration
  span. It remains absent from layout at rest and is revealed by the existing
  Tool header hover or keyboard-focus state; no timing source, clock, tooltip,
  or host state was added.
- Focused timing/header coverage passed: 25 tests and 235 assertions across
  `card-duration-single-source`, `card-timing`, and `card-header-chrome`.
- The original Node-launched `message-part-chronology-browser` scenario passed
  its full real-page checker. It proves hidden-at-rest behavior, persisted ISO
  timestamp semantics, hover and focus visibility, placement immediately
  before duration, equality with the existing structured Started value, and
  continued Started/Finished/Duration/Status tooltip content.
- `.scratch/tool-timing-tooltip-hover.png` was inspected at original resolution.
  The hover state shows `07:59:59 AM` directly before `2s` in the requested
  trailing-header position without displacing the tooltip or wrapping the Tool
  summary. The in-app browser independently verified the same value, exact
  `2026-06-20T23:59:59.000Z` semantic timestamp, focused visibility, and an
  eight-pixel gap before duration in
  `.scratch/tool-start-time-inline-focus-iab.png`.
- Overlay TypeScript, i18n, and production Vite build passed. Historical-links
  and product-docs single-source checks passed (25 tests, 95 assertions).
  Document health passed 54 of 55 checks; its only failure is the concurrently
  authored and indexed but still untracked
  `2026-07-17-tools-reasoning-density-card-tone-alignment.md`, outside this
  correction's file ownership. The correction neither created nor indexed that
  record.
- No push was performed, per the user's explicit instruction.
