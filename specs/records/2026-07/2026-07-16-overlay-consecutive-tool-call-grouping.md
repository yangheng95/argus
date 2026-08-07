# Overlay Consecutive Tool-Call Grouping

## Recall

| Item | Detail |
| --- | --- |
| User request | Merge consecutive tool calls in one conversation into one disclosure instead of rendering a vertical stack of `Tools 1` rows. |
| Acceptance criteria | Adjacent tool/reasoning execution parts separated only by tool-only message boundaries or empty text render under one disclosure with an aggregate count; visible narrative text and its visible role boundary still split execution disclosures; expanding the aggregate preserves every tool call and its source order; keyboard disclosure behavior remains intact; a real isolated desktop page is screenshot and visually reviewed. |
| Hard constraints | Keep persisted messages and chronology unchanged; retain `CardParts` as the single disclosure renderer and `message-part.ts` as the single render-run projection; no backend grouping source, fallback renderer, hidden/synthetic message, keyword rule, state machine, mobile/tablet scope, new worktree, or intervention in the user's running OpenCorvus process; launch Playwright/browser fixtures with Node. |
| Supplied evidence | The user screenshot shows six consecutive collapsed `Tools 1` rows between two visible narrative sections, demonstrating that non-visible message segmentation is leaking into the visual grouping. |
| Sources read | `AGENTS.md`; browser-control skill; `specs/current/architecture/99-principles.md`; `2026-07-16-overlay-codex-tool-disclosure-visual-repair.md`; `CardParts.tsx`; `message-part.ts`; `messages.css`; message render-order tests; chronology fixture and Node browser test. |
| Whole-repository search | `rg` found `partitionMessagePartRenderRuns` only in `message-part.ts`, `CardParts.tsx`, and its focused unit tests. `boundaryMessageHasNarrativeContent` is likewise owned by `message-part.ts` and consumed only by `CardParts.tsx` plus focused tests. Production `CardParts` call sites are `ChatBubble.tsx` and recursive `Card.tsx`. `ExecutionDisclosureRun` and `workSummary` have one production owner in `CardParts.tsx`; `.msg-work-details*` presentation has one production owner in `messages.css`. No backend, store, route, or service creates the disclosure groups. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |
| Git baseline | Current branch `work-v0.0.6beta-yr-0716` is at pushed commit `84cc83693`. Pre-existing unrelated Expert Squad generated/formatting changes and the narrow-window typography record remain unstaged and will not be overwritten or included in this delivery. |

## Root cause

`CardParts` suppresses a flattened message boundary when that message contains no visible narrative, and it also suppresses whitespace-only text. However, `partitionMessagePartRenderRuns` classifies every such source part as a body run before rendering decides to suppress it. A sequence `tool -> hidden boundary -> empty text -> tool` therefore becomes `execution -> body -> execution` even though the body run produces no pixels. The UI exposes storage segmentation as repeated `Tools 1` rows.

## Implementation plan

1. Make collapsed render-run projection decide body visibility before partitioning. Skip only parts that already have no collapsed visual representation, so tool-only boundaries and empty text become transparent while visible narrative boundaries remain chronological separators.
2. Simplify `CardParts` to render the projected body parts directly; the projection, not a second render-time condition, owns whether a boundary is visible.
3. Extend focused unit coverage for multiple tool-only message boundaries, aggregate counts, visible narrative separation, disabled disclosure behavior, and exact execution order.
4. Extend the isolated chronology fixture/browser assertions so repeated tool-only messages collapse into one aggregate disclosure while expansion exposes all original tools in order.
5. Run focused tests, Overlay typecheck/build/i18n, document-health checks, and Node-launched browser acceptance; inspect fresh desktop screenshots, iterate if needed, review the diff twice, commit only task-owned files with the `dsw-33987` prefix, and push the git-cc tracking branch.

## Verification plan

```powershell
bun test packages/overlay/test/message-part-render-order.test.ts packages/overlay/test/message-embed.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
bun run --cwd packages/overlay build
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/message-part-chronology-browser.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Implementation and acceptance evidence

- `partitionMessagePartRenderRuns` now filters only collapsed parts that already have no visual representation: tool-only message boundaries, whitespace-only text, empty reasoning, and empty patches. These parts no longer fragment the adjacent execution run.
- A visible narrative boundary remains in the body run with its text and therefore still separates execution disclosures. Persisted source parts, ordering keys, message identities, and tool content are unchanged.
- `CardParts` now consumes the projection directly instead of repeating boundary visibility logic with reconstructed indexes. This preserves one grouping authority and removes the index mismatch that would occur after transparent parts are skipped.
- Focused unit tests pass with 10 tests and 0 failures, including three tools merged across invisible message segments and visible narrative separation.
- The isolated chronology fixture now contains three pre-narrative tool calls and two post-narrative tool calls across flattened tool-only messages. Its Node-launched browser test passes and asserts exactly two disclosure buttons (`Tools 3 · Thinking 1`, `Tools 2 · Thinking 1`), seven expanded events, one visible boundary, one narrative body, complete tool order, keyboard expansion, compact geometry, and timing details.
- Fresh task-scoped screenshots `.scratch/message-part-chronology-collapsed.png` and `.scratch/message-part-chronology-component.png` were inspected at original resolution. The collapsed view shows one aggregate row on each side of the narrative; the expanded view shows all tools in a quiet chronological container without duplicate boundaries or layout regressions.
- Interactive in-app Browser inspection against the isolated fixture confirmed the two aggregate labels, expansion state `[true, false]`, exactly one visible narrative boundary/body, and the ordered expanded tools `mission_state`, `mission_plan`, `mission_dispatch`.
- Overlay TypeScript and the production Vite build pass. The existing large-chunk warning remains informational.
- Historical links and product-doc single-source tests pass. Document health currently also reports three unrelated untracked July records already linked by concurrent worktree changes; this task does not stage those records. Overlay i18n currently reports two unused keys owned by separate concurrent card/Changes edits; this task changes no locale keys.

## Second review

- The diff introduces no message mutation, renderer, backend source, fallback, compatibility path, state machine, keyword classifier, or new styling.
- `message-part.ts` remains the only chronological grouping projection; `CardParts` remains the only disclosure renderer; `Card` remains the tool detail renderer.
- Every source tool part remains present exactly once when expanded, and only content that already rendered nothing becomes transparent to grouping.

## 2026-07-16 Follow-up Recall: aggregate only source-adjacent execution parts

### Latest user requirement

- Tool calls must not be collected into a turn-wide or cross-message aggregate.
- Only execution parts that are literally adjacent in the canonical flattened part sequence may share one disclosure.
- Render every resulting disclosure and narrative segment in original timeline order.

### Acceptance criteria

- A boundary, text part, empty text part, empty reasoning part, empty patch, file, embed, interaction, or other non-execution source part terminates the active execution group even when that intervening part produces no collapsed pixels.
- Adjacent non-empty reasoning, tool, and patch parts remain one execution group and preserve their exact source order.
- Tool-only message boundaries remain visually hidden, but tools on their two sides render as separate disclosure bars in chronological position.
- Expanding each bar reveals only that adjacent group's source parts, exactly once and in order; keyboard behavior and existing styling remain unchanged.

### Recalled sources and whole-repository evidence

- Re-read `AGENTS.md`, the browser-control skill, this full record, `specs/current/architecture/12-overlay-card-system.md`, `CardParts.tsx`, `message-part.ts`, focused render-order tests, and the isolated chronology fixture/browser test.
- Whole-repository grep confirms `partitionMessagePartRenderRuns` has one production consumer in `CardParts.tsx`; `CardParts` has the canonical `ChatBubble.tsx` and recursive `Card.tsx` call sites. `boundaryMessageHasNarrativeContent` is used only by the same projection/tests. No backend, store, route, or second component owns grouping.
- Commit `3f0562b9c6` introduced the regression by filtering non-visible body parts before adjacency partitioning. That changes source adjacency: `tool -> boundary -> tool` becomes `tool -> tool` for grouping purposes.
- The pre-regression projection grouped by literal source neighbors and suppressed only non-narrative boundary rendering. Restoring that ownership is a direct replacement, not a second grouping path or compatibility branch.
- Existing unrelated OpenCorvus source/test/spec changes and generated `packages/overlay/dist-artifacts/` remain outside this task. No sub-agent is used because the user did not request delegation.

### Implementation plan

1. Make `partitionMessagePartRenderRuns` partition the untouched source sequence by adjacent execution/body kind; do not filter intervening parts before grouping.
2. Keep tool-only boundaries hidden at the single collapsed renderer while retaining them as chronological separators.
3. Replace tests that authorize cross-boundary aggregation with literal-adjacency assertions, including invisible boundary, whitespace, empty reasoning, and empty patch separators.
4. Update the isolated fixture expectations to prove separate bars appear in source order, run focused/type/build/i18n/docs checks, inspect fresh desktop screenshots, then commit and push only task-owned files.
