# Overlay Five-Surface Codex Polish

## Recall

| Item | Detail |
| --- | --- |
| User requirement | 1. Make the pictured error popup dismiss after a delay. 2. Show Multica Squad `name` as each selection title instead of its UUID. 3. Keep Tools and related execution groups expandable and render their collapsed copy in a lighter Codex-like tone. 4. Make Expert Squad catalog/list icons consistent. 5. Adjust File/Edit/View/Help spacing to match the supplied Codex titlebar reference. |
| Acceptance criteria | Runtime API-error toasts have a positive named lifetime while remaining in notification-center history; question choices visibly separate a human label from the stable reply value; the Multica fixture renders Squad names but submits exact UUIDs; execution disclosure remains one keyboard-accessible control with muted copy; catalog/list icons share one size and column; titlebar navigation/menu geometry is visibly closer to the reference; focused tests, typecheck/build, and fresh isolated desktop screenshots pass. |
| Hard constraints | Keep notification state, `Question`, `InteractionCard`, `CardParts`, `ExpertSquadPanel`, and `TitlebarMenubar` as their existing single owners; no fallback renderer/value guess, keyword parser, second notification source, hidden message, gate, state machine, mobile/tablet scope, new worktree, or interference with the user's running OpenCorvus process; browser fixtures use Node. |
| Supplied evidence | Five screenshots at `C:/Users/10132/AppData/Local/Temp/codex-clipboard-*.png`, personally inspected at original resolution. |
| Sources read | `AGENTS.md`; browser-control skill; notification lifecycle/log-upload record; compact tool-disclosure and consecutive grouping records; expert-squad redesign record; titlebar dropdown/sidebar parity record; `notification-state.ts`, `notify.ts`, `log.ts`, `main.tsx`, `question/index.ts`, `orchestrator/interaction-tools.ts`, `InteractionCard.tsx`, `CardParts.tsx`, `ExpertSquadPanel.tsx`, `TitlebarNavigation.tsx`, `TitlebarMenubar.tsx`, and their CSS/test owners. |
| Git baseline | Clean `work-v0.0.6beta-yr-0716` at `21c8cadf0`; `myhexin/work-v0.0.6beta-yr-0716` already contains the same commit. A pre-change `git push myhexin HEAD` passed the full hook and reported everything up to date. |
| Independent agent feedback | None. The user did not request delegation; the active collaboration policy forbids unrequested sub-agents. The primary agent owns implementation, screenshot review, and the second diff review. |

## Whole-repository search evidence

- `showStoredNotification` and its timer map are owned by `notification-state.ts`; `notifyLoggedError` is the one AppLog-to-toast adapter. `reportOverlayRuntimeError` supplies the pictured `Error` title and `runtime:<scope>` identity. Existing log-upload recovery already proves delayed dismissal plus retained history.
- `Question.Option` currently conflates display `label` with the reply value, and `Question.Reply` documents answers as selected labels. `InteractionCard` stores and submits `opt.label`. All production `Question.ask` / `askAndFormat` call sites and focused tests were enumerated; the Multica browser fixture deliberately encodes UUIDs as labels, reproducing the screenshot.
- `partitionMessagePartRenderRuns` is the only grouping projection, `CardParts.ExecutionDisclosureRun` is the only Tools/Reasoning/Changes disclosure renderer, and `.msg-work-details*` in `messages.css` is its only presentation owner.
- `ExpertSquadPanel` has exactly one catalog icon and one repeated list icon. Their shared CSS owner currently diverges at 32/44px and their JSX diverges at 18/20px; row padding also offsets the list icon column from the catalog header.
- `App.tsx` composes sidebar toggle, `TitlebarNavigation`, and `TitlebarMenubar` once. `titlebar.css` owns all relevant gaps; the current 2px family and 4.5px trigger padding produce the tighter geometry visible in the OpenCorvus screenshot.

## Cause chain and call-site disposition

| Surface | Observable symptom | Direct cause | Root repair |
| --- | --- | --- | --- |
| Error popup | Mission wake API error remains until manually closed. | Runtime AppLog errors call `notifyLoggedError` with its zero lifetime. | Give runtime diagnostics the existing named transient lifetime; retain `centerHistory: true` so only the toast is dismissed. |
| Multica choice title | UUID is the large title and name is buried in description. | `Question.Option.label` is both presentation and reply identity, so callers use the UUID to preserve exactness. | Make `value` the required stable answer and `label` presentation-only across the canonical question contract; render names and submit UUID values. |
| Tools disclosure | Collapsed execution copy is visually too strong. | The existing label uses `--text-soft` plus medium weight at control size. | Preserve disclosure behavior and chronology; move collapsed copy/marker to the muted tier and body weight. |
| Expert Squad icons | Header and row icons differ in size and column. | Separate 32/44px geometry, 18/20px glyphs, and row-only inset. | Reuse one icon geometry/glyph size and align the catalog header to the row content inset. |
| Titlebar spacing | Back/forward and File/Edit/View/Help are denser than Codex. | All titlebar groups share the 2px gap and menu triggers use sub-5px inline padding. | Introduce titlebar-scoped navigation/menu spacing tokens and apply them to the existing owners only. |

## Implementation plan

1. Extend the canonical Question option schema to require `{ value, label, description }`; update all production creators, projections, tests, generated OpenAPI/SDK artifacts, and `InteractionCard` selection storage so displayed labels never determine answer identity.
2. Apply the existing named transient notification duration to runtime diagnostics and add lifecycle regression coverage for timer dismissal plus history retention.
3. Refine the existing execution disclosure label/marker token usage without changing grouping or expansion.
4. Converge Expert Squad header/list icon geometry and alignment in the existing component/CSS owners.
5. Adjust titlebar-only navigation, group, and trigger spacing; extend source/browser geometry assertions.
6. Run focused tests, full typecheck/build/i18n/API-doc verification, Node browser fixtures, inspect fresh screenshots at original size, correct visual defects, perform a second diff review, commit with `dsw-33987`, and push `myhexin`.

## Verification plan

```powershell
bun test packages/opencorvus/test/question/question.test.ts packages/opencorvus/test/tool/question.test.ts
bun test packages/overlay/test/runtime-diagnostics-source.test.ts packages/overlay/test/notification-center-primitive.test.ts packages/overlay/test/message-embed.test.ts packages/overlay/test/config-panel-sizing.test.ts packages/overlay/test/titlebar-menubar-primitive.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
bun run --cwd packages/overlay build
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/multica-import-browser.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/message-part-chronology-browser.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/expert-squad-panel.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/titlebar-menubar.test.ts
bun run api:generate
bun run api:routes-check
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Implementation and visual review result

- Runtime diagnostics now carry the existing five-second transient notification lifetime as explicit log metadata. The toast auto-dismisses while the notification-center entry remains owned by the existing history store.
- Question choices now require a stable `value` in addition to the human `label`. `InteractionCard` displays the label and submits the value; Multica emits Squad names as labels and exact Squad IDs as values. LLM-facing summaries include both without parsing display text.
- Execution disclosure keeps the existing keyboard-accessible `<details>` owner and chronology, with its collapsed label moved to muted body typography.
- Expert Squad catalog and row icons now share a 44px container and 20px glyph, with their left edges aligned within the one-pixel list border.
- Titlebar navigation clusters and File/Edit/View/Help use scoped spacing tokens instead of the shared two-pixel gap.

Fresh Node/Playwright screenshots were inspected at original size:

- `.scratch/multica-runtime-error-toast.png`
- `.scratch/multica-squad-multi-select.png`
- `.scratch/message-part-chronology-collapsed.png`
- `.scratch/expert-squad-settings-details-current.png`
- `.scratch/titlebar-window-controls-windows.png`

The isolated in-app browser preview was also inspected without restarting or refreshing the user's OpenCorvus process. It showed the real titlebar, navigation, and live workspace surface with the new spacing.

## Verification result

- OpenCorvus and Overlay TypeScript checks: passed.
- Focused question, intent-analysis, runtime notification, execution disclosure, Expert Squad, titlebar, and interaction tests: passed (the combined first pass was 115/116 before one stale output assertion was corrected; the rerun passed 17/17).
- Multica Node/Playwright fixture: passed, including name labels, exact UUID request payload, error-toast screenshot, and timed dismissal.
- Message chronology Node/Playwright fixture: passed.
- Expert Squad Node/Playwright fixture: passed 4/4 after calibrating the list-border edge to a one-pixel tolerance.
- Titlebar Node/Playwright spacing/locale matrix: the relevant primary subtest passed. Three unrelated subtests remain red because concurrent window-control/layout work changed dark-theme color and removed the old right activity toolbar fixture assumptions.
- Overlay i18n and production Vite build: passed.
- API generation, route inventory, and rendered API documentation check: passed.
- Historical links and product-doc single-source tests: passed. The first document-health run passed 77/78 while this record and two concurrent records were untracked; after staging this record and repairing the concurrently corrupted July index, the final document-health and historical-link rerun passed 74/74.
- `git diff --check`: passed.
