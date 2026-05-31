# 2026-04-30 Result Schema Hardening

## Evidence

The requirements agent can register facts successfully and still end without
calling its terminal submit tool:

- `register_requirement` succeeded 9 times, so the incremental schema works.
- `submit_requirements` was not called, and the host threw
  `requirements agent did not call submit_requirements after registering 9 requirement(s)`.

Reviewing submit/result schemas found three contract gaps:

1. `submit_requirements` and `submit_integrity_review` are empty-object tools.
2. `BuildResultSchema` says `status="failed"` requires `error` only in prose.
3. `report_build_result` hand-defines a tool schema that is not the same object
   as the final `BuildResultSchema`.

Follow-up evidence showed the same terminal-submit miss can hit Architect and
other collector agents after their facts are already registered. Therefore this
is not a requirements-only schema bug. The session-level terminal contract must
also narrow the tool surface once the collector is ready to finalize.

## Exhaustive Grep

Commands run before design:

- `rg -n "submit_requirements|submit_integrity_review|report_build_result|BuildResultSchema|BuildTestResult|terminalTool|isReadyToFinalize|inputSchema: z\\.object\\(\\{\\}\\)|z\\.object\\(\\{\\}\\)" packages/opencorvus/src packages/opencorvus/test specs -g "*.ts" -g "*.md" -g "*.txt"`
- `rg -n "create.*OutputTools|terminalTool|inputSchema: z\\.object|status: z\\.enum|z\\.discriminatedUnion|safeParse\\(|collector\\.|finalized" packages/opencorvus/src/requirements packages/opencorvus/src/architect packages/opencorvus/src/integrity packages/opencorvus/src/build packages/opencorvus/src/intent-analysis packages/opencorvus/src/frontend-design packages/opencorvus/src/delivery packages/opencorvus/src/prosecutor packages/opencorvus/src/orchestrator packages/opencorvus/src/session -g "*.ts"`

| Call point | Finding | Decision |
| --- | --- | --- |
| `requirements/output-tools.ts::submit_requirements` | empty `z.object({})` terminal schema | replace with `RequirementsSubmitSchema` requiring `final: true` |
| `integrity/agent.ts::submit_integrity_review` | empty `z.object({})` terminal schema | replace with `IntegritySubmitSchema` requiring `final: true` |
| `prompt/core/requirements-core.txt` | tells the model to call no-arg submit | update to explicit payload |
| `prompt/core/integrity-core.txt` | tells the model to call no-arg submit | update to explicit payload |
| `build/types.ts::BuildResultSchema` | failed branch does not require `error` | replace object with discriminated union |
| `build/agent.ts::report_build_result.inputSchema` | duplicate schema source | reuse `BuildResultSchema` directly |
| `session/loop.ts::terminalToolChoice` | named tool choice is set but all work tools remain visible | add one terminal-tool scoping function when `isReadyToFinalize()` is true |
| `build-agent/types.test.ts` | missing negative branch tests | add failed-without-error and passed-with-error tests |

## Agent Submission Table

| Agent | Terminal call | Payload carries result? | Fix |
| --- | --- | --- | --- |
| Requirements | `submit_requirements` | no, collector already has requirements/decisions | require explicit `{ final: true }`; terminal-ready turns expose only this tool |
| Architect | `submit_architect` | `summary`; validation reads collector | keep existing schema; terminal-ready turns expose only this tool |
| Integrity | `submit_integrity_review` | no, collector already has dimensions | require explicit `{ final: true }`; terminal-ready turns expose only this tool |
| Build | `report_build_result` | yes, `status`/summary/tests/error | reuse the shared discriminated `BuildResultSchema`; terminal-ready turns expose only this tool |
| Delivery | `submit_verdict` | yes, accepted/rejected verdict | already uses the shared discriminated `DeliveryVerdict`; keep as-is |

## Design

Terminal submit tools must not be empty-object schemas. A submit action is a
real protocol payload, so it must carry an explicit confirmation field:

- `submit_requirements({ final: true })`
- `submit_integrity_review({ final: true })`

Build result must be a true discriminated union:

- `status="passed"`: no `error`; optional `commit_ref`; required `patch_summary`; `tests` defaults to `[]`.
- `status="failed"`: required `error`; optional `commit_ref`; required `patch_summary`; `tests` defaults to `[]`.

The `report_build_result` tool uses the same `BuildResultSchema` object as the
post-run parser. There is no second schema and no runtime-only branch
requirement.

When a terminal collector contract reports `isReadyToFinalize() === true`, the
session loop sends only that terminal tool in the provider request and pins
`toolChoice` to the same tool name. This is not a fallback path and carries no
miss counter: the collector readiness predicate remains the single source of
truth for when work tools are no longer relevant.

## Verification

- Unit tests assert no-arg submit schemas require `final`.
- Build result tests assert failed-without-error is rejected and passed-with-error is rejected.
- Session loop tests assert terminal-ready turns narrow the visible tool surface
  to the terminal tool.
- Targeted agent tests run.
- `opencorvus` typecheck runs.
