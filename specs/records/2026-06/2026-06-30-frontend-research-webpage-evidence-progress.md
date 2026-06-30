# 2026-06-30 Frontend Research Webpage Evidence Progress

## Recall

- User request: "`又出问题了`" for task `tsk_f1749a848001qrPeSOlpPqE469`, title `帮我复刻这个页面：https://www.tradingview.com/markets/usa/ 要求每个组件一个goal单独复刻，图片等非代码资源请复...`.
- Acceptance criteria:
  - The new failure must be separated from the prior citation-map loop; do not reuse the previous root cause without evidence.
  - `frontend_research` must not leave an empty child session while host-prepared webpage evidence runs for minutes.
  - Long host webpage evidence stages must expose real stage progress through the workflow step/lifecycle path.
  - The fix must not weaken source evidence requirements, skip evidence stages, add fallback, gate, route bypass, or compatibility behavior.
  - Add focused tests and keep the previous citation-map tests passing.
- Hard constraints:
  - Do not restart, kill, refresh, or otherwise intervene in running OpenCorvus / overlay processes.
  - Do not use git reset or broad revert.
  - Do not create new worktrees.
  - Keep specs under `specs/records/2026-06/**` and update the month README.
  - Preserve current dirty worktree changes that are not part of this repair.
- Sources read:
  - `specs/records/2026-06/2026-06-30-frontend-research-citation-loop-root-repair.md`.
  - Runtime DB `C:\Users\chuan\.local\share\opencorvus\opencorvus.db` for task/session/tool evidence.
  - Task runtime artifacts under `C:\Users\chuan\myhexin-local\demos\economy\us-country\.opencorvus\r\t\fC\NIjF5k\`.
  - `packages/opencorvus/src/orchestrator/tools.ts`.
  - `packages/opencorvus/src/research/agent.ts`.
  - `packages/opencorvus/src/research/webpage-prd-evidence.ts`.
  - `packages/opencorvus/src/orchestrator/webpage-evidence.ts`.
  - `packages/opencorvus/src/session/status.ts`.
  - `packages/opencorvus/src/agent/runner.ts`.
  - `packages/opencorvus/test/orchestrator/webpage-evidence.test.ts`.
  - `packages/opencorvus/test/research/webpage-prd-evidence.test.ts`.
  - `packages/opencorvus/test/frontend-research/agent.test.ts`.
- Whole-repository search evidence:
  - `rg -n "dispatchFrontendResearchStage|FrontendResearchInputSchema|frontend_research|runResearchSession|source_urls|prepare.*Research|prepared.*evidence|Browser" packages/opencorvus/src/orchestrator packages/opencorvus/src/research packages/opencorvus/test/frontend-research packages/opencorvus/test/research -g "*.ts"`.
  - `rg -n "ensureLiveWebpageEvidence|webpage evidence|prepareWebpagePrdEvidence|onStatus\(|SessionStatus|trackStep|taskID" packages/opencorvus/src/orchestrator/webpage-evidence.ts packages/opencorvus/src/frontend-design packages/opencorvus/test -g "*.ts"`.
  - `rg -n "onStatus|SessionStatus.set\(|status=streaming|summary" packages/opencorvus/src/agent packages/opencorvus/src/session packages/opencorvus/src/orchestrator -g "*.ts"`.
  - `rg -n "ensureLiveWebpageEvidence\(|prepareWebpagePrdEvidence\(|LiveWebpageEvidencePipeline|runLiveWebpageEvidenceStage|webpage evidence" packages/opencorvus/test packages/opencorvus/src -g "*.ts"`.
- Runtime evidence:
  - The new task had root session `ses_0e8b657b6ffeUbYGy3yOvkR73j`, orchestrator session `ses_0e8b64d06ffe7PjdnvWkjtBjP0`, and frontend-research child session `ses_0e8b4a8ffffefEv8lbS0dcF9jw`.
  - The frontend-research child session had zero messages and zero parts.
  - Orchestrator called `frontend_research` three times. The first failed JSON parsing, the second failed the input-mode schema because `continuation_artifact_id: "null"` was combined with `source_urls`, and the third used valid fresh input.
  - The third call ran from `1782802238956` to `1782802345375` and failed with `external abort signal fired`.
  - Runtime failure file `.opencorvus/r/t/fC/NIjF5k/fd/webpage-evidence/webpage-evidence-failure.json` records phase `captureRuntimeState` and error `orchestrator aborted`.
  - Runtime artifacts show extract, compile, and analyze produced substantial webpage evidence before cancel; `captureRuntimeState` was the interrupted stage.
  - Timeline only showed parent orchestrator streaming events, then cancellation, then the child frontend-research terminal error after cancel. It did not expose the host evidence phases before child agent prompting.
- Independent agent feedback:
  - Not collected. The available multi-agent tool explicitly forbids spawning sub-agents unless the user asks for sub-agents or parallel agent work; that higher-priority tool rule overrides the project recall template field.

## Root Cause

This is not the previous citation-map output-tool loop. The child frontend-research session is created before host webpage evidence preparation, but `prepareWebpagePrdEvidence` runs synchronously before `runAgentSession` appends the first visible child prompt. For large pages, the host evidence pipeline can spend minutes in extract, compile, analyze, and runtime-state capture while the child session has no messages or visible stage progress.

The direct trigger in the new task was user cancellation while the valid third `frontend_research` call was inside `captureRuntimeState`. The deeper design issue is missing observability for the pre-agent host evidence stage. The code already has a workflow progress event path (`trackStepProgress`), but `dispatchFrontendResearchStage` passes `onStatus: () => {}` and the evidence pipeline does not emit per-stage progress.

## Decision

Expose the existing host evidence sequence as real progress events:

- `ensureLiveWebpageEvidence` accepts an optional progress callback and emits before/after each concrete stage.
- `prepareWebpagePrdEvidence` forwards that callback.
- `runResearchSession` marks the already-created child session as streaming while evidence is prepared and forwards progress through `onStatus`.
- `dispatchFrontendResearchStage` routes `onStatus` into `trackStepProgress("frontend_research", summary)`.

This does not change routing, skip any evidence phase, downgrade errors, or add fallback. It only makes the existing mandatory host evidence stages visible.

## Call Point Inventory

| Surface                                                          | Current behavior                                                             | Required change                                                                                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/orchestrator/webpage-evidence.ts`       | Runs evidence stages silently until success/failure.                         | Emit progress callbacks around materialize, reuse, extract, compile, analyze, captureRuntimeState, and sourcePackage. |
| `packages/opencorvus/src/research/webpage-prd-evidence.ts`       | Calls `ensureLiveWebpageEvidence` without progress reporting.                | Forward optional progress callback.                                                                                   |
| `packages/opencorvus/src/research/agent.ts`                      | Creates child session, then prepares webpage evidence before visible prompt. | Set child session streaming and forward progress before `runAgentSession`.                                            |
| `packages/opencorvus/src/orchestrator/tools.ts`                  | Passes `onStatus: () => {}` to frontend/deep research.                       | Forward status to `trackStepProgress`.                                                                                |
| `packages/opencorvus/test/orchestrator/webpage-evidence.test.ts` | Verifies stage execution, not progress observability.                        | Assert progress sequence follows real stage order.                                                                    |
| `packages/opencorvus/test/research/webpage-prd-evidence.test.ts` | Verifies evidence prompt surface, not progress forwarding.                   | Assert progress reaches the PRD preparation caller.                                                                   |
| `packages/opencorvus/test/frontend-research/agent.test.ts`       | Verifies host-prepared evidence config.                                      | Keep as prompt/config guard; add text if needed after implementation.                                                 |

## Verification Plan

1. `bun test packages/opencorvus/test/orchestrator/webpage-evidence.test.ts`
2. `bun test packages/opencorvus/test/research/webpage-prd-evidence.test.ts`
3. `bun test packages/opencorvus/test/frontend-research/agent.test.ts`
4. `bun test packages/opencorvus/test/research/output-tools.test.ts`
5. `bun test packages/opencorvus/test/research/agent-runtime-root.test.ts`
6. `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
7. `git diff --check`

## Verification Results

- `bun test packages/opencorvus/test/orchestrator/webpage-evidence.test.ts`: passed, 7 tests.
- `bun test packages/opencorvus/test/research/webpage-prd-evidence.test.ts`: passed, 5 tests.
- `bun test packages/opencorvus/test/frontend-research/agent.test.ts`: passed, 4 tests.
- `bun test packages/opencorvus/test/research/output-tools.test.ts`: passed, 19 tests.
- `bun test packages/opencorvus/test/research/agent-runtime-root.test.ts`: passed, 2 tests.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: passed, 19 tests.
- `bun run typecheck` from `packages/opencorvus`: passed.
- `git diff --check -- packages/opencorvus/src/orchestrator/webpage-evidence.ts packages/opencorvus/src/research/webpage-prd-evidence.ts packages/opencorvus/src/research/agent.ts packages/opencorvus/src/orchestrator/tools.ts packages/opencorvus/test/orchestrator/webpage-evidence.test.ts packages/opencorvus/test/research/webpage-prd-evidence.test.ts packages/opencorvus/test/frontend-research/agent.test.ts specs/records/2026-06/2026-06-30-frontend-research-webpage-evidence-progress.md specs/records/2026-06/README.md`: passed.
