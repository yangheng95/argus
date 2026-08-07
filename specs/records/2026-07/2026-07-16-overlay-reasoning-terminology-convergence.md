# Overlay Reasoning Terminology Convergence

## Recall

### User requirement

- The supplied conversation screenshot shows an outer `Thinking 1` execution disclosure and an inner `Reasoning` item.
- The conversation stream has `reasoning`, not a separate `thinking` message kind; adjust the visible terminology accordingly.

### Acceptance criteria

- A collapsed execution disclosure counts reasoning parts as `Reasoning {{count}}` in English and `推理 {{count}}` in Simplified Chinese.
- Expanded reasoning content continues to use the existing `ReasoningPart` renderer and `transcript.reasoning` label.
- The message protocol, chronological grouping, disclosure ownership, and persisted part types remain unchanged.
- Focused browser tests reject the old `Thinking` aggregate and a real isolated desktop page is screenshot and visually reviewed.

### Hard constraints

- Keep `reasoning` as the single message-part type; do not add a `thinking` type, alias, fallback, compatibility path, second renderer, or hidden message.
- Keep `CardParts.tsx` as the single execution-summary owner and the existing i18n catalogs as the visible terminology source.
- Preserve unrelated dirty worktree changes and do not restart or refresh the user's running OpenCorvus/Overlay.
- Run browser acceptance through Node on Windows, not Bun.
- Commit subjects start with `dsw-33987` and push the current delivery branch to `legacy-remote`.

### Sources read before implementation

- `AGENTS.md`
- supplied screenshot `codex-clipboard-68f85c17-cee3-434c-b91a-9337b9f541fe.png`
- `specs/records/2026-07/2026-07-14-overlay-message-execution-chronology.md`
- `specs/records/2026-07/2026-07-15-message-transcript-visual-language-repair.md`
- `specs/records/2026-07/2026-07-16-overlay-codex-tool-disclosure-visual-repair.md`
- `packages/overlay/src/components/CardParts.tsx`
- `packages/overlay/src/components/ReasoningPart.tsx`
- Overlay English and Simplified-Chinese i18n catalogs
- chronology and chat-bubble disclosure browser tests

### Whole-repository search evidence

- `rg -n "execution_reasoning" .` found one production consumer in `CardParts.tsx` and exactly two catalog values, one per supported locale.
- `workSummary()` derives the aggregate kind from actual `part.type === "reasoning"`; there is no `thinking` message-part branch.
- `RenderableCardPart` sends the same real reasoning part to `ReasoningPart`, which uses `transcript.reasoning` for the inner label.
- Exact `Thinking 1` search found two active browser assertions. Other hits are historical delivery records and must remain historical evidence rather than being rewritten.
- Backend `Message.ReasoningPart`, streaming processor events, and transport projection consistently use `reasoning`; no protocol or backend change is required.
- The current worktree contains unrelated uncommitted expert-squad/settings/spec-index changes. Task-owned source and browser-test files are clean at start.

### Independent agent feedback

- No sub-agent was started because the user did not request delegation and the active collaboration policy forbids unrequested sub-agents.

## Causal chain

The provider stream creates a `reasoning` part, the Overlay chronological projection correctly groups that part as reasoning, and the expanded renderer correctly labels it `Reasoning`. Only the aggregate i18n value renames that same kind to `Thinking`, producing two names for one data type. The repair belongs in the canonical aggregate terminology, not in the message model or grouping logic.

## Implementation plan

1. Change `transcript.execution_reasoning` to `Reasoning {{count}}` and `推理 {{count}}` in the two locale catalogs.
2. Update the two production-shaped Node browser assertions to require `Reasoning 1` and explicitly reject visible `Thinking` in the aggregate control.
3. Repair any stale browser assertions exposed by the production-shaped checks only when component ownership and current design-token evidence prove the expected behavior changed.
4. Run focused i18n and browser checks, Overlay typecheck/build, required documentation checks, and `git diff --check`.
5. Inspect the isolated browser screenshots at original resolution, perform a second scoped diff review, commit only task-owned hunks, and push `legacy-remote`.

## Verification plan

```powershell
bun run --cwd packages/overlay check:i18n
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay build
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/message-part-chronology-browser.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/chat-bubble-disclosure-button-browser.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

### Implementation and acceptance evidence

- `ReasoningPart` remains the only reasoning renderer and now requires an explicit `self` or `parent` disclosure owner. Parent-owned instances render the same streaming Markdown immediately but do not emit `reasoning-toggle`; self-owned instances retain the existing collapsed signal, Button primitive, keyboard behavior, and Markdown path.
- `ExecutionEventRun` is the only caller that projects parent ownership. The two normal-body projections explicitly request self ownership, so all four `collapseWorkDetails` consumer families converge on the same single-layer behavior without a second state source.
- The expanded reasoning chrome selector now applies only to self-owned disclosure. The prior chat-bubble-only flattening override was deleted, making parent-owned reasoning flat in both chat bubbles and structured cards.
- Focused unit regressions passed 12/12 across reasoning ownership, work-details presentation, and chronological partitioning.
- The production-shaped chronology Node browser test passed and now proves one outer control, zero inner reasoning controls, parent ownership, direct `display: block` Markdown, exact chronology, tool timing, and screenshot output.
- The production-shaped chat-bubble Node browser test passed after a full Vite production build and proves zero nested reasoning controls plus flat light/dark expanded surfaces. The build retained only the existing informational large-chunk warning.
- Overlay TypeScript typecheck passed. `check:i18n` currently reports the unrelated `worktree.empty` key made unused by a concurrent unstaged `TaskDirBar.tsx` change; this follow-up neither consumes nor owns that key.
- Historical-links and product-doc single-source checks passed. The combined document-health run passed 77/78 checks; its sole failure is the concurrent README link to the still-untracked `2026-07-16-agent-models-content-inset.md`, outside this follow-up's files.
- Personally inspected `.scratch/message-part-chronology-component.png`, `.scratch/overlay-codex-tool-reasoning-expanded.png`, and `.scratch/overlay-transcript-dark-expanded.png`: opening `Reasoning 1` immediately shows the reasoning body with no second label, button, pill, or nested card surface.
- The in-app Browser skill independently opened the isolated chronology fixture and confirmed `outerControls: 1`, `innerReasoningControls: 0`, `owner: parent`, `expanded: true`, and visible body text. The isolated tab and Node-started Vite process were closed afterward; the user's running Overlay was not touched.

## Implementation and acceptance evidence

- The two locale catalogs now name the aggregate `reasoning` count `Reasoning {{count}}` and `推理 {{count}}`; the protocol type, `workPartKind()`, `ReasoningPart`, chronological partitioning, and disclosure state are unchanged.
- Both production-shaped browser tests explicitly require `Reasoning 1` and reject `Thinking` in the aggregate label.
- The chat-bubble regression now tests the actual reasoning body text for collapsed-content leakage. A generic `includes("Reasoning")` check became invalid once the legitimate collapsed aggregate adopted that same noun.
- The browser run exposed two stale assertions from earlier same-day UI changes. Current component evidence proves `CardDurationChip` is the final sibling in `CardHeader`, so the keyboard assertion now checks the whole header in its real title-summary-duration order. Current design-token evidence proves message text uses `--ui-font-title` (15px), so the browser expectation now matches that canonical token instead of the retired 14px value.
- Overlay i18n validation, TypeScript typecheck, and the Vite production build passed. The existing large-chunk warning remains informational.
- `message-part-chronology-browser.test.ts` passed through the required Node runner, including exact aggregate labels, no old terminology, chronology, keyboard focus, expanded tool/reasoning order, timing tooltip, and screenshot output.
- `chat-bubble-disclosure-button-browser.test.ts` passed through the required Node runner, including collapsed/expanded reasoning, light/dark surfaces, focus, keyboard behavior, and screenshot output.
- Historical-link and product-document single-source suites passed 25/25. The full document-health working-tree run passed 51 checks but could not be cleanly accepted: a concurrent untracked `2026-07-16-work-ledger-pin-and-agent-header-order.md` entry is already linked by another unstaged README edit, and two process-heavy checks timed out under the concurrent run. The staged task tree excludes that unrelated entry while tracking this task's record; final hook verification remains authoritative for the delivered commit.
- Personally inspected `.scratch/message-part-chronology-collapsed.png`: both compact controls read `Tools 3 · Reasoning 1` and `Tools 2 · Reasoning 1`; no `Thinking` text remains.
- Personally inspected `.scratch/message-part-chronology-component.png`: expanded reasoning and tools stay in canonical order, the inner item reads `Reasoning`, and the outer aggregate uses the same real data-type noun.
- An additional background in-app Browser attempt reached the isolated fixture title but its module body remained blank in that browser surface. It did not replace or weaken the successful repository-owned Node/Playwright rendering evidence above. The temporary fixture and tab were closed without touching the user's running Overlay.

## Single-layer disclosure follow-up

### Recall

#### User requirement

- The supplied screenshot shows the `Reasoning 1` execution disclosure expanded into a second `Reasoning` disclosure.
- Remove the two-level structure.

#### Acceptance criteria

- A reasoning part inside an execution disclosure has exactly one interactive disclosure control: the outer execution summary.
- Expanding the outer summary immediately reveals the real reasoning Markdown; there is no nested `reasoning-toggle`.
- A reasoning part rendered outside an execution disclosure retains its existing collapsed-by-default, keyboard-accessible self disclosure.
- Message chronology, the `reasoning` protocol type, Markdown streaming, hidden-part reactivity, and aggregate counts remain unchanged.
- Production-shaped Node browser tests cover the single-control DOM contract and generate a desktop screenshot that is inspected at original resolution.

#### Hard constraints

- Keep `ReasoningPart` as the only reasoning renderer; do not add a direct Markdown branch in `CardParts`, a second renderer, fallback, compatibility selector, hidden message, or persisted disclosure state.
- Treat the parent execution disclosure as the only state owner while a reasoning part is inside its body; `ReasoningPart` may project that ownership but must not create another button there.
- Preserve unrelated dirty expert-squad, Settings, and spec-index edits.
- Do not restart, refresh, close, or reuse the user's running OpenCorvus/Overlay. Browser acceptance uses isolated Node-started fixtures on Windows.
- Commit subjects start with `dsw-33987` and the task commit is pushed to `legacy-remote`.

#### Sources read before implementation

- `AGENTS.md` and the browser-control skill instructions.
- Supplied screenshot `codex-clipboard-05c25891-1dd7-4b17-91bd-ab80afee0a37.png`.
- `specs/current/architecture/12-overlay-card-system.md`.
- `specs/records/2026-07/2026-07-14-overlay-message-execution-chronology.md`.
- `specs/records/2026-07/2026-07-15-agent-message-card-reference-surface.md`.
- This reasoning-terminology record and `2026-07-16-overlay-codex-tool-disclosure-visual-repair.md`.
- `CardParts.tsx`, `ReasoningPart.tsx`, the reasoning visibility store, `messages.css`, and focused unit/browser regressions.

#### Whole-repository search and call-site inventory

| Surface | Search result | Follow-up disposition |
| --- | --- | --- |
| `ReasoningPart` production render | `rg` found one production call in `CardParts.tsx`; tests and historical records are the remaining hits. | Keep this single renderer and pass explicit disclosure ownership from the existing part projection. |
| Execution disclosure owner | `ExecutionDisclosureRun`, `ExecutionEventRun`, and `workSummary()` have one production owner in `CardParts.tsx`. | Keep the outer Solid disclosure and aggregate label unchanged; make its open body the reasoning visibility owner. |
| Collapsed execution consumers | `ChatBubble.tsx` has three `collapseWorkDetails` call sites and `Card.tsx` has one; all converge through `PartCollection`. | Repair the shared `CardParts` path once so message, child-agent, and structured-card consumers cannot diverge. |
| Reasoning self disclosure | `reasoning-toggle` is emitted only by `ReasoningPart.tsx`; browser consumers are chronology, chat-bubble, and isolated reasoning tests. | Retain it only for self-owned reasoning and assert its absence inside expanded work details. |
| Presentation | `.msg-reasoning*` and `.msg-work-details*` production selectors are owned by `messages.css`; an existing chat-bubble override already flattens expanded nested reasoning visually but does not remove the nested control or cover structured cards. | Express self-owned expansion directly in the canonical selector and keep parent-owned reasoning flat everywhere. |
| Store/reactivity | `reasoning.ts` owns part-key reactivity and always returns visible; its comments still claim all disclosure state belongs to `ReasoningPart`. | Preserve behavior and update the ownership description to match the parent/self projection. |

#### Independent agent feedback

- No sub-agent was started because the user did not request delegation and the active collaboration policy forbids unrequested sub-agents.

### Causal chain

`partitionMessagePartRenderRuns()` correctly groups the real reasoning part into an execution run. `ExecutionDisclosureRun` then owns the run's collapsed state, but after it opens, `RenderableCardPart` mounts `ReasoningPart`, which unconditionally creates a second collapsed signal and a second button. The prior terminology repair made both layers read consistently, but did not remove the duplicate ownership. The structural repair is to project parent ownership through the existing renderer so the outer disclosure is the only control for grouped reasoning while standalone reasoning keeps its own disclosure.

### Implementation plan

1. Give `ReasoningPart` an explicit parent/self disclosure-owner contract. Parent-owned reasoning renders its Markdown immediately and emits no inner toggle; self-owned reasoning preserves the current signal and Button behavior.
2. Thread parent ownership only through `ExecutionEventRun`; normal body rendering continues to request self ownership. Keep all Markdown rendering inside `ReasoningPart`.
3. Scope expanded reasoning chrome to self-owned disclosure so structured cards do not retain a visual inner container after the nested control is removed. Update the store comments without changing reactivity.
4. Add focused source regressions for both ownership modes and production-shaped browser assertions for one control, direct content visibility, chronology, keyboard behavior, and light/dark presentation.
5. Run focused unit/browser tests, Overlay typecheck/build/i18n, required documentation health checks, inspect the generated desktop screenshot, perform a second diff review, commit only task-owned files, and push `legacy-remote`.

### Verification plan

```powershell
bun test packages/overlay/test/reasoning-part.test.ts packages/overlay/test/message-embed.test.ts packages/overlay/test/message-part-render-order.test.ts
bun run --cwd packages/overlay check:i18n
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay build
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/message-part-chronology-browser.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/chat-bubble-disclosure-button-browser.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```
