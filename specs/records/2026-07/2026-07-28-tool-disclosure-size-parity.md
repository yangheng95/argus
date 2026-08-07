# Tool Disclosure Summary and Expanded Row Size Parity

## Recall

### User requirement

- The supplied screenshot shows that the icon and text size in compact transcript headings such as `Tools` do not match the icon and text size of the rows revealed after expansion.
- Repair the mismatch at its source instead of visually compensating for it in one state.

### Acceptance criteria

- The collapsed `Tools` disclosure marker and the icons in its expanded tool rows resolve to the same computed width and height.
- A collapsed `Tools` label and the expanded tool name and summary resolve to the same computed font size.
- The same parity holds when a disclosure summary shows the current tool icon instead of the aggregate chevron.
- Existing one-line truncation, tool detail expansion, keyboard disclosure behavior, chronology, row height, and light/dark theme behavior remain intact.
- A real isolated desktop Overlay fixture is rendered through the Node-started browser runner, screenshots are personally inspected, and any visible mismatch is corrected before delivery.

### Hard constraints

- Follow `AGENTS.md`: use one presentation source, no fallback selector, compatibility branch, gate, state machine, hidden message, or second disclosure renderer.
- Keep `CardParts.tsx` as the single transcript disclosure renderer, `Card`/`CardHeader` as the generic tool-row renderer, and `messages.css` as the transcript-local presentation owner.
- Reuse the existing `Icon` primitive and its standard size token. Do not add an arbitrary icon-size API or duplicate a numeric size in component code.
- This is desktop-only visual acceptance. Do not add tablet, mobile, or responsive work.
- Do not restart, refresh, close, or reuse the user's running OpenCorvus/Overlay process. Validation uses only a task-scoped isolated fixture.
- Playwright must run through Node on Windows.
- Preserve and exclude all unrelated concurrent worktree changes. Do not create another worktree.
- Commit subjects start with `dsw-33987`; push the delivered commit to the current `myhexin` tracking branch.

### Sources read before implementation

- `AGENTS.md`
- supplied screenshot `codex-clipboard-068a5cc7-b780-484b-a091-9ca6e2b65d1a.png`
- browser-control skill instructions
- `specs/current/architecture/12-overlay-card-system.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-15-tool-call-single-line-authority.md`
- `specs/records/2026-07/2026-07-16-overlay-codex-tool-disclosure-visual-repair.md`
- `specs/records/2026-07/2026-07-16-overlay-consecutive-tool-call-grouping.md`
- `specs/records/2026-07/2026-07-19-codex-activity-rhythm-and-tool-panel.md`
- `specs/records/2026-07/2026-07-21-tools-context-spacing-consistency.md`
- `packages/overlay/src/components/CardParts.tsx`
- `packages/overlay/src/components/Card.tsx`
- `packages/overlay/src/components/CardHeader.tsx`
- `packages/overlay/src/components/ui/Icon.tsx`
- `packages/overlay/src/styles/primitives/icon.css`
- `packages/overlay/src/styles/surfaces/card.css`
- `packages/overlay/src/styles/surfaces/messages.css`
- focused unit and Node browser tests for disclosure chronology, overflow, one-line headers, tool details, and light/dark presentation

### Whole-repository search evidence

| Owner or consumer | Search result | Decision |
| --- | --- | --- |
| `CardParts.tsx` | `ExecutionDisclosureRun` is the only production renderer of `work-details-toggle`, `msg-transcript-disclosure__marker`, and `msg-work-details__tool-icon`. | Preserve its disclosure state and markup. |
| `CardHeader.tsx` / `Card.tsx` | Expanded events render generic tool cards whose leading `.card__icon .oc-icon` uses the shared standard icon tier. | Preserve the generic renderer; use its standard tier as the transcript parity target. |
| `Icon.tsx` / `icon.css` | The shared primitive owns named `compact` and `standard` tiers; `standard` is the default. | Reuse `--oc-icon-size-standard`; do not introduce another number or component branch. |
| `messages.css` | The collapsed marker is fixed to 13px, the current-tool summary asks for `compact`, collapsed tool text uses `--transcript-activity-font-size`, and expanded tool text independently uses `--ui-font-control`. | Replace the split sizing with one transcript-local font token and one transcript-local icon token. |
| `ChatBubble.tsx` / `Card.tsx` | These are the two production `CardParts` consumers. | No behavior or call-site change. |
| Browser tests | Chronology, card separation, Chat disclosure, Sub-agent dock, visible-final-message, and Tools-context-spacing fixtures consume the same classes. | Add exact parity evidence to the canonical chronology fixture; preserve all other consumers. |
| Static tests | `message-overflow.test.ts` already validates the transcript CSS source. | Extend it to reject the retired 13px marker and require the one-token contract. |

The search commands covered `msg-work-details`, `work-details-toggle`, `ExecutionDisclosureRun`, `ExecutionEventRun`, `msg-transcript-disclosure__marker`, `msg-work-details__tool-icon`, `.card__icon`, and `transcript-activity-font-size` across the repository. No backend route, store, database record, or message-order projection participates in this visual mismatch.

### Baseline evidence

- The branch baseline is `b0754fdc0c` on `work-v0.0.23beta-yr-0728`; fetch confirmed the tracking branch was neither ahead nor behind before implementation.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/message-part-chronology-browser.test.ts` produced the isolated baseline screenshots.
- `.scratch/message-part-chronology-collapsed.png` and `.scratch/message-part-chronology-component.png` visibly reproduce the mismatch: the aggregate chevron is smaller than the expanded wrench/tool icons.
- The baseline run reached all page assertions and screenshots but reported an isolated browser cleanup timeout. This is not counted as a passing baseline and must be rechecked with the original command.
- The worktree already contains unrelated concurrent edits. Task-owned `messages.css`, `message-overflow.test.ts`, and the chronology browser test were clean at task start.

### Independent agent feedback

- No sub-agent was started because the user did not request delegation and the active collaboration policy forbids unrequested sub-agents. The primary agent owns the implementation, visual inspection, and second review.

## Root cause

The transcript disclosure has one semantic row system but three size sources. The aggregate chevron is boxed at a hard-coded 13px, a running/current tool icon is explicitly rendered with the compact primitive tier, and expanded tool cards use the standard primitive tier. Typography currently resolves to 14px in both states, but the summary and expanded card rules reference separate variables, so parity is accidental rather than guaranteed. The visible defect is therefore a split presentation contract, not a grouping, chronology, icon asset, or disclosure-state defect.

## Implementation plan

1. Add one transcript-local icon-size token next to the existing activity font/line/row tokens, deriving it from the shared standard `Icon` tier.
2. Route the aggregate marker, current-tool summary icon, collapsed tool card icon, and expanded tool card icon through that one token.
3. Route both collapsed and expanded tool headers through the same transcript-local font-size token.
4. Extend the static CSS regression to require the shared token and reject the hard-coded 13px marker.
5. Extend the real chronology browser regression to compare computed summary label, summary marker/current-tool icon, tool title/summary, and tool icon dimensions in both light and dark themes; save focused screenshots.
6. Run focused tests, Overlay typecheck/build, document-health tests, inspect screenshots, correct any visible regression, perform a second diff review, commit only task-owned hunks, and push `myhexin`.

## Verification plan

```powershell
bun test packages/overlay/test/message-overflow.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay build
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/message-part-chronology-browser.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Implementation result

- `messages.css` now defines `--transcript-activity-icon-size` from the shared standard `Icon` tier and projects it into the aggregate marker, current-tool summary icon, and expanded tool-card icon.
- Expanded tool cards now inherit both subtitle and header sizing from `--transcript-activity-font-size`; the summary and expanded states therefore no longer depend on separate typography sources.
- The component tree, disclosure behavior, event chronology, tool grouping, and backend data path are unchanged. No compatibility branch, fallback selector, alternate renderer, state machine, or gate was introduced.
- The chronology fixture now imports the production `icon.css` primitive. Without that import, Lucide's browser default rendered fixture SVGs at 24px and the fixture could not represent production icon geometry.
- The real browser regression measures the current-tool summary label/icon and expanded tool title/summary/icon, checks the dispatch-agent current-tool icon, repeats the measurements in dark mode, and captures both themes.
- The fixture server inactivity window is 30 seconds because a measured cold Vite start took 18.4 seconds; the former 15-second window stopped before the real checker. This changes only the isolated test runner's readiness allowance.

## Acceptance evidence

- `bun test packages/overlay/test/message-overflow.test.ts`: 3 passed, 0 failed, including the new source-contract regression.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay build`: passed; Vite transformed 7,057 modules and completed the production bundle.
- The Node browser runner passed the chronology test with Playwright 1.59.1 and its matching Chromium 1217 executable: 1 passed, 0 failed.
- The browser checker measured the summary label, expanded tool title, and expanded tool summary at the same 14px computed font size.
- It measured the current-tool summary icon, dispatch-agent current-tool icon, and expanded tool icon at the same 14px square dimensions in both light and dark themes.
- `.scratch/tool-disclosure-size-parity-light.png` and `.scratch/tool-disclosure-size-parity-dark.png` were personally inspected. The former small-heading/large-content jump is absent; focus, hover, expansion, and chronology remain visually coherent.
- The first browser attempt exposed a missing matching Playwright browser binary, not a product failure. The official Playwright installer supplied Chromium 1217 and the exact package-reported executable completed the original checker.
- The three required document suites completed 92 passes. Their sole remaining failure lists five unrelated concurrent July records that are linked from the shared monthly README but are still untracked; after this task record was staged, it disappeared from the offender list. Those foreign records are deliberately not staged or modified by this delivery.
- The user's running OpenCorvus/Overlay process was not restarted, refreshed, closed, or reused.

## Second review

- A second repository search confirmed `ExecutionDisclosureRun` remains the only production owner of both disclosure-summary variants and generic `Card` remains the expanded-row owner.
- The final task diff changes only transcript-local CSS and its focused static/browser evidence; it adds no renderer, state, message, route, persistence, or backend source.
- The supplied crop also prompted inspection of the Environment `Tools`/`Workspace`/`PRD` surface. Its current concurrent work already resolves headings and rows through a separate 13px/16px contract, so it is not the source of this transcript mismatch and none of those unrelated changes are included here.
- Concurrent image-preview and index edits share some files with this task. They remain outside the task-owned staged hunks and are not part of this delivery.
