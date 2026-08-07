# Overlay Tool Call Timing Tooltip

## Recall

### User requirement

- 工具调用 hover 时显示时间等信息。

### Acceptance criteria

- Hovering the tool-call header opens a real Kobalte tooltip beside its visible duration chip.
- The same header remains the single keyboard-focusable expand/collapse control and owns the tooltip relationship.
- The tooltip shows the persisted start time, completed time when present, elapsed duration, and current terminal/runtime status.
- Running tools continue to update elapsed duration from the shared Overlay clock; completed tools remain stable.
- Agent/session duration behavior remains unchanged.
- English and Chinese copy, focused unit tests, Overlay typecheck/build, a Node browser test, in-app browser inspection, and screenshot review pass.

### Hard constraints

- `part.state.time.start/end` projected to `CardNode.time/timeCompleted` remains the only tool timing source.
- `CardDurationChip` remains the only duration renderer for structured cards and chat bubbles.
- Reuse `@kobalte/core/tooltip` and `.card-meta-tooltip`; do not create a custom floating layer or duplicate timer.
- No fallback timestamp, mount-time clock, hidden message, compatibility branch, or second tool-card renderer.
- Preserve the existing dirty worktree and 19 staged entries. Do not restart or refresh the user's running OpenCorvus/Overlay processes.
- Browser validation uses an isolated Vite fixture and Node/in-app browser control.

### Sources read

- `AGENTS.md`
- Browser control skill instructions.
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/current/architecture/12-overlay-card-system.md`
- `specs/records/2026-06/2026-06-04-overlay-tool-agent-timer-single-source.md`
- `specs/records/2026-06/2026-06-19-card-header-chrome-single-source.md`
- `specs/records/2026-07/2026-07-14-overlay-message-execution-chronology.md`
- `CardHeaderChrome.tsx`, `CardHeader.tsx`, `tool-card-node.ts`, `time.ts`, shared tooltip CSS, locale files, and duration/browser tests.

### Whole-repository search evidence

| Surface              | Finding                                                                                                                                                                              | Decision                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Tool time projection | `toolToCardNode()` strictly requires `state.time.start`, validates `state.time.end`, and projects them to `CardNode.time/timeCompleted`.                                             | Keep unchanged.                                                                                    |
| Duration rendering   | `CardDurationChip` is shared by `CardHeader` and `ChatBubble`; static tests forbid private elapsed renderers.                                                                        | Extend this single component only.                                                                 |
| Clock                | `useNowTick()` already supplies live elapsed time for running cards.                                                                                                                 | Reuse; no interval or observation timestamp.                                                       |
| Tooltip primitive    | `CardMetaHint`, Work Ledger, sidebar version, and other surfaces use Kobalte Tooltip with `.card-meta-tooltip`.                                                                      | Reuse the same primitive and class.                                                                |
| Visual target        | Tool cards already show `.card__duration` inside the shared header button.                                                                                                           | Make the existing tool header the trigger; do not nest a second interactive element in the button. |
| Tests                | `card-duration-single-source.test.ts` covers timing provenance but not detailed hover content. The real `message-part-chronology` Vite fixture already renders a promoted tool card. | Add behavioral detail tests and extend that real component fixture/browser test.                   |

### Independent agent feedback

- None. The user did not request delegation, and collaboration policy forbids unrequested sub-agents.

## Interaction contract

The compact duration remains visible in the tool header. Hovering the existing tool-header button opens a structured tooltip containing:

1. exact persisted start timestamp;
2. exact persisted finish timestamp when completed;
3. elapsed duration from the existing duration calculation;
4. localized status.

The header remains the only keyboard-focusable control and Kobalte connects it to the tooltip content. The tooltip is informational only. Clicking the tool header continues to own expansion/collapse, and the timing surface does not create a new action.

## Implementation plan

1. Extract a pure tool-timing presentation helper that formats `CardNode.time/timeCompleted/status` without owning a clock.
2. Render the existing tool-header button as the Kobalte tooltip trigger only for `node.kind === "tool"`; keep the duration chip non-interactive and retain the current simple session duration chip for non-tool cards.
3. Add localized labels and small structured tooltip layout rules under the existing card tooltip surface.
4. Add unit coverage for completed/running tool details and browser coverage for hover plus keyboard accessibility.

## Verification and second review

- `bun test packages/overlay/test/card-timing.test.ts packages/overlay/test/card-duration-single-source.test.ts`: 16 passed.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay check:i18n`: passed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/message-part-chronology-browser.test.ts`: passed against the real `Card` component fixture under Node-launched Playwright.
- `.scratch/tool-timing-tooltip-hover.png`: reviewed at 920 × 420; the title and four timing rows are legible, aligned, and anchored to the tool header without changing chronology.
- Second review removed the invalid focusable-tooltip trigger nested inside the header button. The final DOM has one tool-header button, one Kobalte trigger, and one projected timing source.
