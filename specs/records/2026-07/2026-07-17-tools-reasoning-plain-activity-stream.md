# Tools/Reasoning Plain Activity Stream

## Recall

| Item | Evidence and constraint |
| --- | --- |
| User requirement | Restyle collapsed Tool and Reasoning presentation to match the supplied Codex activity-list reference: icon-led, text-like rows with no container background and no hover colour change. The user's follow-up screenshot explicitly requires an individually expanded Tool call to retain a distinct background surface for its output. |
| Acceptance criteria | Aggregate Tools/Reasoning, standalone Reasoning, and collapsed nested Tool headers remain readable and expandable; their resting and pointer-hover backgrounds are transparent; hover does not change their text/icon colour. An expanded Tool output alone renders on a token-backed inset background with border and radius, without adding a background to the aggregate disclosure or Reasoning. Chronological order, timing tooltip, keyboard focus outline, disclosure persistence, and tool output remain functional; focused source tests and real desktop screenshots in light/dark themes pass. |
| Hard constraints | Keep `CardParts` as the only aggregate chronology/disclosure owner, `ReasoningPart` as the only reasoning renderer, and `Card`/`CardHeader` as the only Tool renderer. Remove the superseded visual rules directly; do not add a second renderer, fallback, gate, hidden state, mobile scope, worktree, or interaction with the user's running OpenCorvus/Overlay. Browser fixtures must be started with Node. Preserve unrelated dirty E2E files and packaged artifacts. |
| Supplied evidence | `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-f5855bbf-8481-4710-9c0a-a91d74ea82e7.png` shows a compact, icon-led activity list on the parent surface with no nested fill or visible hover wash. The follow-up `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-3d4befbc-6341-4956-869b-51dd845f371c.png` shows that opening a Tool call reveals a light inset output panel with a subtle border and rounded corners below the unchanged plain Tool header. Both were visually inspected from the user messages. |
| Sources read | `AGENTS.md`; Browser skill; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/current/architecture/{07-panel-reactivity,99-principles}.md`; the 2026-07-16 Codex Tool disclosure, refresh-stability, and Tools surface records; the superseded 2026-07-17 density/card-tone record; `CardParts.tsx`, `ReasoningPart.tsx`, `Card.tsx`, `messages.css`, `card.css`, and focused source/browser tests. |
| Whole-repository search | `rg` enumerated every `msg-work-details`, `reasoning-toggle`, Tool `card__head` hover, expanded-background token, and conversation-card-background consumer. Production ownership remains singular. The affected regression consumers are `message-embed.test.ts`, `message-part-chronology-browser.test.ts`, and `chat-bubble-disclosure-button-browser.test.ts`; standalone Reasoning is additionally consumed by `reasoning-toggle-button-browser.test.ts` and `reasoning-markdown-browser.test.ts`. Card timing tests consume hover visibility but do not require a colour change. No independent visual implementation exists. |
| Independent-agent feedback | Not requested by the user; no sub-agent was started. |

## Root cause

The current visual does not come from the Tool or Reasoning renderers. `messages.css` deliberately adds a second, nested surface to the expanded aggregate disclosure and standalone Reasoning, then adds hover washes and stronger hover colours to both disclosure labels and nested Tool headers. Those rules were appropriate for the superseded card-tone target, but directly contradict the new plain activity-list reference. At the same time, the aggregate Tool-output override currently removes the default expanded output panel and leaves only a vertical rule, which contradicts the follow-up reference. The correct repair is to retire the aggregate/Reasoning surfaces and hover-colour declarations while restoring one Tool-owned expanded output surface at the existing output element.

## Call-site decisions

| Call site | Decision |
| --- | --- |
| `CardParts.tsx` `ExecutionDisclosureRun` | Preserve chronological grouping, icon marker, summary, persisted expansion, and event structure. |
| `ReasoningPart.tsx` | Preserve self/parent disclosure ownership and Markdown rendering. |
| `Card.tsx` / `CardHeader` | Preserve Tool icon, title, timing tooltip, output, and expansion interaction. |
| `messages.css` standalone Reasoning | Remove expanded fill/border chrome and hover colour changes; retain transparent base and keyboard focus outline supplied by the shared Button primitive. |
| `messages.css` aggregate Tools/Reasoning | Remove the expanded-background token, fill, and background transition; retain compact typographic spacing. |
| `messages.css` work-details toggle | Remove hover background/text/icon colour changes and their transition; keep the same muted presentation across rest and pointer hover. |
| `messages.css` nested Tool header | Keep the local transparent override in rest, hover, and focus-within so global Card hover chrome cannot leak into the activity list. |
| `messages.css` nested Tool output | Replace the aggregate-only transparent/left-rail override with one token-backed inset panel using the existing surface, border, and radius tokens. This panel appears only when the canonical Tool body is expanded. |
| Tool timing hover | Preserve the existing start-time/tooltip interaction; it changes information visibility, not row background or text colour. |
| Focus-visible | Preserve the shared focus outline; it is required keyboard affordance, not hover colour styling. |

## Verification plan

1. Update source contracts to require transparent rest/expanded/hover surfaces and stable text/icon colours.
2. Replace the superseded CSS rules at the single style owner; do not change renderer markup or state.
3. Update real browser assertions from card-tone comparisons to aggregate/Reasoning transparency, rest-versus-hover equality, and an expanded Tool output panel with non-transparent background, border, and radius.
4. Run focused unit/static tests, Node-started chronology and full-conversation browser tests, TypeScript checks, document-health checks, and whitespace validation.
5. Inspect current-goal desktop screenshots in light and dark themes, correct any visual mismatch, then perform a second repository/diff review.

## Progress

- 2026-07-17: Recall, root cause, exhaustive call-site decisions, and verification plan recorded before implementation.
- 2026-07-17: User follow-up clarified that only collapsed/list chrome and Reasoning are background-free; an individually expanded Tool output must retain its own inset background. Acceptance criteria and call-site decisions were revised before code changes.
- 2026-07-17: Removed the aggregate and standalone Reasoning fills, flattened activity-list indentation, locked disclosure and nested Tool headers to transparent/static-colour hover presentation, and retired the aggregate override that had flattened Tool output into a left rule. Expanded Tool output now consumes the existing canonical `.msg-tool-output` inset background, border, radius, and scrolling contract.

## Codex second-review feedback

The first browser pass proved that merely deleting feature hover rules was incomplete: the shared Button primitive then supplied its general hover wash. The repair was revised to explicitly project transparent backgrounds and unchanged semantic colours on the two activity-list controls while preserving the primitive's `box-shadow` focus ring. A later hover screenshot also showed that the shared Card rule still increased duration opacity; the task-scoped Tool header now holds duration opacity steady while retaining start-time and timing-tooltip visibility.

The independent chronology fixture then proved that the Tool override was incorrectly coupled to a `.chat-bubble` ancestor. That host dependency allowed generic Card hover chrome to leak into any other legitimate `CardParts` rendering path. All nested Tool presentation selectors now attach directly to `.msg-work-details__body`, the actual single component scope, and the same fixture passes without host emulation or a compatibility selector.

## Verification

- `bun test packages/overlay/test/{message-embed,reasoning-part,chat-bubble,card-duration-single-source,card-header-title,work-details-muted-label}.test.ts` — 27 passed, 0 failed.
- `node packages/overlay/test/browser/browser-runner.mjs packages/overlay/test/browser/reasoning-toggle-button-browser.test.ts packages/overlay/test/browser/message-part-chronology-browser.test.ts packages/overlay/test/browser/chat-bubble-disclosure-button-browser.test.ts` — 3 passed, 0 failed through the required Node runner. Coverage includes transparent rest/hover/focus backgrounds, stable text/icon/duration colour, focus-ring retention, chronological order and refresh persistence, timing tooltip, transparent aggregate/Reasoning surfaces, expanded Tool output background/border/radius, and light/dark full-page rendering.
- `bun run --cwd packages/overlay typecheck` — passed before final documentation update.
- Final document-health, i18n, formatting, whitespace, repository-diff, commit, and git-cc push checks are recorded after completion.

## Visual review

Personally inspected the final desktop screenshots at original size: `.scratch/message-part-chronology-collapsed.png`, `.scratch/message-part-chronology-component.png`, `.scratch/tool-timing-tooltip-hover.png`, `.scratch/reasoning-toggle-{rest,focus}-{light,dark}.png`, and `packages/overlay/.scratch/{overlay-codex-tool-reasoning-expanded,overlay-transcript-dark-expanded}.png`. The collapsed list and Reasoning use no nested fill; hover does not add row colour or brighten duration; keyboard focus remains visible; and expanded Tool output alone has the requested inset panel in both themes. The user's running OpenCorvus/Overlay process was not touched.
