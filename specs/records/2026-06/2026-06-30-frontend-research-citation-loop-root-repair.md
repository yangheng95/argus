# 2026-06-30 Frontend Research Citation Loop Root Repair

## Recall

- User request: "`frontend-research` 循环卡死了" for task `tsk_f172b34430012zPctxsGY5henX`, title `帮我复刻这个页面：https://www.tradingview.com/markets/usa/ 要求每个组件一个goal单独复刻`.
- Acceptance criteria:
  - The same TradingView source-page research path must no longer get stuck in a repeated `update_research_citation` correction loop.
  - `frontend_research` must still require real evidence references; unknown `evidence_ids` remain rejected.
  - The repair must not add fallback, compatibility, gate, state-machine, or route-bypass logic.
  - Code changes need focused tests, then the relevant tests must pass.
- Hard constraints:
  - Do not restart, kill, refresh, or otherwise intervene in running OpenCorvus / overlay processes.
  - Do not use git reset or broad revert.
  - Do not create new worktrees.
  - Keep specs under `specs/records/2026-06/**` and update the month README.
  - Preserve current dirty worktree changes that are not part of this repair.
- Sources read:
  - `AGENTS.md` instructions supplied in the user message.
  - `specs/README.md`.
  - `specs/records/2026-06/README.md`.
  - `specs/current/architecture/01-agents.md`.
  - `specs/records/2026-06/2026-06-03-frontend-research-direct-investigation-fix.md`.
  - `specs/records/2026-06/2026-06-21-frontend-research-context-digest.md`.
  - `packages/opencorvus/src/research/agent.ts`.
  - `packages/opencorvus/src/research/output-tools.ts`.
  - `packages/opencorvus/src/research/schema.ts`.
  - `packages/opencorvus/src/prompt/core/frontend-research-core.txt`.
  - `packages/opencorvus/src/orchestrator/tools.ts` around `FrontendResearchInputSchema`, `dispatchFrontendResearchStage`, and continuation validation.
  - `packages/opencorvus/test/research/output-tools.test.ts`.
  - Runtime DB `C:\Users\chuan\.local\share\opencorvus\opencorvus.db` for task/session/tool evidence.
- Whole-repository search evidence:
  - `rg -n "frontend[-_]research|FrontendResearch|frontend_research" packages/opencorvus/src packages/opencorvus/test -g "*.ts" -g "*.tsx"`.
  - `rg -n "unknownClaimIDError|knownCollectorClaimIDs|ResearchBundleCitationEntrySchema|validateResearchBundleInputSemantics|researchMissingActions|citation_map|update_research_citation|terminalTool|shouldExposeOnlyTerminalTool" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`.
  - `rg -n "ResearchBundleCitationEntrySchema|citation_map|claim_id|ResearchBundleInputSchema|ResearchBriefSchema|validateResearchBriefIntegrity|validateResearchBriefSemantics" packages/opencorvus/src/research/schema.ts packages/opencorvus/test -g "*.ts"`.
- Runtime evidence:
  - Task has no goals and no `frontend_research_brief` artifact.
  - Task artifact list contains only `orchestrator-stream-error` caused by user cancellation.
  - Decision log records `frontend-research_session_error` with `error=session cancelled`.
  - Session tree: root -> orchestrator -> one `frontend-research` child session `ses_0e8d3bfedffea2NlwHUB2eIUos`.
  - The child session produced 18 messages and 154 parts before cancellation.
  - Tool counts show 8 `update_research_citation` calls, all completed with textual `Error:` outputs; all citation errors were `citation.claim_id references unknown claim id`.
  - The model used bundle-style claim ids such as `claim_desktop_reference_truth`, while the tool only accepted previously registered structured ids like `fact_*`, `inf_*`, `doc_*`, `fs_*`, `acc_*`, and `data_*`.
- Independent agent feedback:
  - Not collected. The available multi-agent tool explicitly forbids spawning sub-agents unless the user asks for sub-agents or parallel agent work; that higher-priority tool rule overrides the project recall template field.

## Root Cause

`ResearchBundleCitationEntrySchema.claim_id` is currently a free-form string, but `update_research_citation` rejects any value that is not already a structured brief item id. This creates a hidden second contract:

- The schema and prompt tell the agent to build a citation map for bundle claims.
- The executable tool treats `claim_id` as a pointer to facts, inferences, document sections, webpage contract rows, or open questions.

For a large webpage evidence brief, the model naturally creates bundle-local citation keys (`claim_desktop_reference_truth`, `claim_page_surfaces`, etc.). Those keys are valid for a citation map, but the tool rejects them because they are not structured item ids. Since `citation_map` is required before the terminal tool can be exposed, the session stays in update-tool mode and burns turns trying to repair a non-semantic mismatch.

This is not an orchestrator repeat-dispatch loop. It is a single frontend-research child session stuck in its output-tool protocol.

## Decision

Make `citation_map.claim_id` a bundle-local citation key. Keep strong validation for `evidence_ids`, because evidence references are the load-bearing traceability source. Do not require citation keys to duplicate structured brief ids.

This removes the contradictory second source of truth and keeps the durable evidence boundary intact:

- Structured brief ids remain validated inside their own arrays.
- Bundle markdown sections and evidence notes still validate evidence ids.
- Citation map entries validate evidence ids and persist as claim-to-evidence records for bundle-local claims.
- No automatic aliasing, id rewriting, compatibility mapping, retry gate, or fallback is added.

## Call Point Inventory

| Surface | Current behavior | Required change |
| --- | --- | --- |
| `packages/opencorvus/src/research/schema.ts` | `ResearchBundleCitationEntrySchema.claim_id` is free-form but not described as bundle-local. | Describe it as a bundle-local citation key to match executable semantics. |
| `packages/opencorvus/src/research/output-tools.ts` | `validateResearchBundleInputSemantics` and `update_research_citation` reject citation claim ids that do not match structured brief ids. | Stop validating citation claim ids against structured ids; keep evidence id validation. |
| `packages/opencorvus/src/research/output-tools.ts` | `knownCollectorClaimIDs` / `unknownClaimIDError` exist only for citation claim rejection. | Remove those helpers if unused after the contract fix. |
| `packages/opencorvus/src/prompt/core/frontend-research-core.txt` | Mentions `citation_map` but does not clarify claim-key ownership. | Add one sentence: `citation_map.claim_id` is bundle-local and must not be confused with `fact_ids` fields. |
| `packages/opencorvus/test/research/output-tools.test.ts` | Tests assert unknown citation claim ids are rejected. | Replace that assertion with bundle-local citation acceptance and preserve unknown evidence rejection. |
| `packages/opencorvus/test/research/agent-runtime-root.test.ts` | Continuation hydration uses a structured claim id. | No required code change unless tests reveal a stricter helper assumption. |

## Verification Plan

1. `bun test packages/opencorvus/test/research/output-tools.test.ts`
2. `bun test packages/opencorvus/test/research/agent-runtime-root.test.ts`
3. `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
4. Review the patch manually against the runtime DB evidence and confirm the repair does not weaken evidence-id validation.

## Verification Results

- `bun test packages/opencorvus/test/research/output-tools.test.ts`: passed, 19 tests.
- `bun test packages/opencorvus/test/research/agent-runtime-root.test.ts`: passed, 2 tests.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: passed, 19 tests.
- `bun test packages/opencorvus/test/frontend-research/agent.test.ts`: passed, 3 tests.
- `bun test packages/opencorvus/test/agent/core-prompt-hygiene.test.ts`: passed, 58 tests.
- `git diff --check -- packages/opencorvus/src/research/schema.ts packages/opencorvus/src/research/output-tools.ts packages/opencorvus/src/prompt/core/frontend-research-core.txt packages/opencorvus/test/research/output-tools.test.ts packages/opencorvus/test/research/agent-runtime-root.test.ts specs/records/2026-06/2026-06-30-frontend-research-citation-loop-root-repair.md specs/records/2026-06/README.md`: passed.
