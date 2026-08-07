# Agent Card Time And Action Chrome Repair

## Recall

- User request: move the Agent-card time to the correct header position and remove the visible frames around the upper-right icon actions shown in the supplied screenshots.
- Acceptance criteria:
  - the persisted timestamp remains adjacent to the Agent identity/status instead of moving to the far edge when duration exists;
  - duration remains the flexible trailing metadata item without changing its source or formatting;
  - the hover/focus action rail and its metadata group render without an outer border, filled capsule, or shadow;
  - icon buttons keep the shared `Button` primitive, hit targets, hover/focus color feedback, keyboard focus, and existing behavior;
  - focused tests, Overlay typecheck/build, a real isolated desktop screenshot, and a second visual review pass succeed.
- Hard constraints: no new renderer, fallback, compatibility selector, alternate timestamp, hard-coded color, handwritten icon, or process restart; preserve unrelated terminal-panel and backend worktree changes; use the existing Node-started browser harness on Windows.
- Sources read: `AGENTS.md`, `specs/README.md`, `specs/current/architecture/07-panel-reactivity.md`, `specs/current/architecture/12-overlay-card-system.md`, `specs/records/2026-07/2026-07-11-agent-message-card-action-icons.md`, `specs/records/2026-07/2026-07-15-agent-message-card-reference-surface.md`, `specs/records/2026-07/2026-07-15-borderless-small-icon-actions.md`, `ChatBubble.tsx`, `CardHeaderChrome.tsx`, `chat-bubble.css`, and focused card/chat/browser tests.
- Whole-repository search evidence: `ChatBubbleIdentity` is the only Agent identity-row owner and the only non-user owner of `.chat-bubble__stamp`; `CardDurationChip` is shared with `CardHeader`, while the Agent-only auto-margin rule lives in `chat-bubble.css`; `CardHeaderChrome` is the only owner of card metadata/control groups; `.chat-bubble__hover-actions` is the only Agent toolbar frame owner. Existing browser coverage for this rail is concentrated in `chat-bubble-disclosure-button-browser.test.ts` and the Agent-card screenshot fixture.
- Independent agent feedback: none; the user did not request delegation, so the primary agent performs the implementation and independent second review.

## Causal chain

`ChatBubbleIdentity` currently renders duration before timestamp, and the non-compact Agent rule gives duration `margin-left: auto`. Once a duration exists, that margin pushes both duration and the following timestamp to the far edge. Agent turns without duration do not show the defect, explaining the inconsistent placement in the supplied screenshot. The action rail separately paints a pill border, elevated background, radius, and shadow even though its child icon buttons are already borderless; metadata hints also retain capsule padding/radius. These container frames, rather than the icon primitive, produce the unwanted boxes.

## Implementation plan

1. Render the persisted timestamp before `CardDurationChip` in the existing identity row so the timestamp stays beside status and duration alone consumes trailing space.
2. Replace the Agent hover-action container's pill chrome with a transparent, borderless, shadowless layout while preserving reveal, focus, hit targets, and button interaction styles.
3. Flatten Agent metadata hints inside the same action rail by removing their local capsule geometry only in the Agent surface.
4. Keep pointer feedback glyph-only by removing the Agent action buttons' hover/focus fill while preserving the shared keyboard `focus-visible` outline.
5. Add focused source/browser regression assertions, run typecheck/build and docs health, then capture and inspect the real isolated Agent-card fixture in light and dark themes.

## Call-site disposition

| Surface | Disposition |
| --- | --- |
| `ChatBubbleIdentity` | Reorder existing timestamp and shared duration chip; keep both canonical values. |
| `CardHeader` | Preserve current duration placement; it does not render Agent timestamps. |
| `CardHeaderChrome` | Preserve markup, actions, tooltips, and behavior as the single chrome owner. |
| `chat-bubble.css` hover-action rail | Remove only container border/fill/shadow; preserve layout/reveal and child button behavior. |
| Agent metadata hints | Remove capsule geometry through the existing Agent-surface selector; retain text/tooltips. |
| User footer | Preserve timestamp and action behavior. |

## Test-contract correction

The focused run exposed a stale ownership assertion that prohibited `CardHeader` from importing the shared clock even though its canonical tool-timing tooltip computes live timing rows there. The production ownership is unchanged: `CardHeader` may read the shared clock for tool rows, `CardDurationChip` remains the shared duration formatter, and `ChatBubble` does not create a second timer. The regression now states that exact boundary.

## Verification

```powershell
bun test packages/overlay/test/chat-bubble.test.ts packages/overlay/test/card-header-chrome.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay build
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/agent-card-separation-browser.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Validation result

- Focused ChatBubble/CardHeaderChrome regressions: 13 passed, 0 failed.
- Overlay TypeScript typecheck: passed.
- Overlay production Vite build: passed; the existing large-chunk advisory remains non-failing.
- Real Node-started Agent-card browser test: passed after proving timestamp/status adjacency, timestamp-before-duration order, transparent toolbar/metadata/button backgrounds, zero container borders, no shadow, and the existing chronological execution list.
- Product documentation single-source test: passed.
- The staged monthly-record link check and scratch-snapshot health check passed. The full combined documentation run still reports the unrelated existing `payload.ts` references to retired `docs/merge/**` and `docs/todos/**` paths plus one unrelated five-second document-health timeout; those production sources are outside this visual task and were not changed.

## Visual review

- `.scratch/agent-card-separation-light.png`: reviewed; the persisted timestamp sits directly after status on all three cards, duration remains at the trailing edge, and the Architect model/token/action row has no capsule or per-icon fill.
- `.scratch/agent-card-separation-dark.png`: reviewed; the same hierarchy remains clear without a dark-theme outline or filled action patch.
- The first accepted-geometry capture exposed an unwanted metadata tooltip because the pointer rested on the Token hint; the final capture moved the pointer to the copy action.
- The next capture exposed a remaining 6% shared Button hover wash around the copy glyph; the Agent ghost-action selector was corrected to override that fill, and both final screenshots were recaptured and reviewed without the icon frame.

## Second review

- `ChatBubbleIdentity` still consumes the same persisted timestamp and shared duration chip; only their visual order changed, so no timer or data source was added.
- `CardHeaderChrome` remains the only metadata/control owner; the change adds no action renderer, icon, event path, or state.
- Agent actions retain hover/focus reveal, hit targets, tooltips, and keyboard `focus-visible`; pointer feedback is color-only.
- The user's running OpenCorvus/Overlay process was not restarted, refreshed, stopped, or used as the test target. All visual evidence came from isolated fixture processes.
