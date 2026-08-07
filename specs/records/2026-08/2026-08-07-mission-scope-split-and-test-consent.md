# Mission Scope Partitioning and Test-Consent Semantics

Date: 2026-08-07

Status: Implemented and locally validated; legacy remote delivery pending network recovery.

## Recall

| Item | Details |
| --- | --- |
| User requirement | Mission 的 Prompt 必须明确自动按照输入任务的 scope，把工作切分给不同专家团，而不是把全部工作塞进一个 Task。调度器在测试前提出的询问如果被拒绝或超时，含义都是不执行该询问覆盖的测试。 |
| Acceptance criteria | Mission first partitions the complete requested scope by positive held-Squad ownership, creates a separate fixed-`promptProfile` Task for every unavoidable cross-Squad partition, and only then applies delivery-closure granularity inside each single-Squad partition. The scheduler's optional test question names the exact testing increment; an explicit refusal or automatic deadline expiry selects `skip_optional_testing`, and none of the testing described by that question is dispatched or executed. Tests already explicitly required by the operator or a selected binding workflow remain part of the authored Task contract and are never relabeled as optional. |
| Hard constraints | Keep `prompt_profile.active` and Task `promptProfile` as the single fixed-Squad authority. Keep the behavior prompt-owned; do not add a Host gate, state machine, hidden preference field, fallback, keyword router, synthetic message, or second workflow source. Preserve visible question evidence. Do not add, modify, or run User Interface automation tests. Use only positive non-User-Interface prompt contract tests. Preserve unrelated commits and shared-worktree changes. Commit subjects use `dsw-33987`; delivery targets the legacy remote. |
| Sources read | Root `AGENTS.md`; `packages/opencorvus/src/prompt/core/mission-core.txt`; `packages/opencorvus/src/prompt/core/orchestrator-core.txt`; `packages/opencorvus/src/orchestrator/interaction-tools.ts`; `specs/current/architecture/01-agents.md` and `99-principles.md`; `2026-08-02-mission-task-delivery-closure-granularity.md`; `2026-08-06-cognition-aligned-verification-budget-scheduling.md`; existing verification-budget prompt contract test. |
| Whole-repository grep | Current Mission text already states that different Squads cannot share a Task, but its first-wake and stage-design procedures begin from delivery closure grouping and repeatedly emphasize avoiding fragmentation. The older 2026-08-02 record explicitly defaults to one large fixed-Squad Task. The current scheduler maps rejected or expired verification questions to `required_only`, whose wording still authorizes the acceptance-floor test path instead of explicitly skipping the testing named in the question. No dedicated Mission prompt contract test currently covers scope-first Squad partitioning. |
| Independent Agent feedback | No independent Agent was requested. Current collaboration policy prohibits inferred sub-agent spawning; the primary Agent will perform implementation and a separate semantic diff review. |
| Git baseline | Branch `v0.0.35beta` was clean and six commits ahead of the last locally known `legacy-remote/v0.0.35beta`. The required pre-change fetch was attempted, but the legacy remote TLS handshake failed before remote state could be refreshed. No existing commit or file was rewritten. |

## Root-cause analysis

The observed Mission tendency is not caused by Task creation tooling. The direct trigger is ordering in the Mission reasoning contract: it asks the model to group the complete outcome into coherent delivery closures before requiring a complete scope-to-Squad ownership partition. The prompt contains the correct local invariant that different Squads never share a Task, but the stronger repeated “one coherent closure” framing lets an oversized candidate Task survive too long and makes cross-Squad splitting look like an exception rather than the first partitioning step.

The testing ambiguity has the same prompt-level cause. The question is described as asking about optional additional testing, yet its refusal and expiry outcome is named `required_only` and explicitly says to continue. That outcome is correct for mandatory evidence, but it does not state the operator's decisive semantic fact: every test named by the optional question is skipped. The fix belongs in the scheduler prompt and Question tool description, not a Host permission gate.

## Design

### Scope-first Mission partitioning

Mission will build a scope ownership matrix before deriving Task closures:

1. Enumerate every requested deliverable, operation, mutable resource, and acceptance obligation.
2. Assign each scope partition to exactly one held Squad using positive catalog evidence.
3. Split every unavoidable ownership change into a separate fixed-`promptProfile` Task stage.
4. Within each single-Squad partition, group only the work that shares one independently meaningful acceptance, mutation, and evidence lifecycle.
5. Connect dependent partitions with accepted Artifact imports and dispatch all dependency-independent partitions together.

This does not create one Task per Agent, file, acceptance bullet, or format. It changes the decision order so a cross-Squad request can never be authored as one Task before ownership is resolved.

### Test-consent outcome

The optional question will expose `skip_optional_testing` as the recommended compact choice and `run_optional_testing` as the smallest concrete package-executable test increment. Refusal or deadline expiry has the same semantic result as `skip_optional_testing`: do not dispatch or execute any test, regression, fact-checking, or independent review described by that question.

An explicitly requested test or a mandatory node in the already selected binding workflow is outside this optional question. Such evidence remains mandatory because it was already part of the accepted contract, not because rejection silently chose a fallback test mode.

## Implementation and validation plan

1. Reorder Mission first-wake and stage-design instructions around the scope ownership matrix, then align current architecture.
2. Replace the ambiguous `required_only`/`extra_assurance` question choices with explicit skip/run optional-testing outcomes in the Orchestrator prompt and Question tool description.
3. Update the positive verification-budget test and add a positive Mission prompt contract test.
4. Run the two focused non-User-Interface prompt tests, package typecheck, documentation checks that exist on this branch, and `git diff --check`.
5. Perform a separate semantic review for single-source ownership, mandatory-workflow preservation, refusal/expiry meaning, and accidental Host-gate language.
6. Commit with the required prefix, fetch/reconcile legacy remote, push through hooks, and report any external delivery blocker exactly.

## Implementation outcome

- Mission decision priority, first-wake intake, every-wake reconciliation, stage-design procedure, and pre-dispatch challenge now all require the complete input scope to be partitioned by positive held-Squad ownership before Task closure grouping.
- Every unavoidable ownership change is authored as a separate stage and separate fixed-`promptProfile` Task. Dependency-independent partitions share the ready frontier; dependent partitions retain accepted Artifact handoffs.
- Same-Squad delivery closure remains proportional: the new ordering does not create Tasks per Agent, file, format, or acceptance bullet.
- The optional verification choices are now `skip_optional_testing` and `run_optional_testing`. Refusal and automatic deadline expiry are exactly equivalent to `skip_optional_testing`; the scheduler is explicitly prohibited from dispatching or executing any testing or assurance work named by the question.
- Tests already required by the operator, repository contract, or selected binding workflow remain outside the optional question and retain their original acceptance authority.
- Current architecture and the two directly superseded historical decisions now point to this scope-first and explicit-consent contract. No Host field, gate, workflow state, hidden message, route, database schema, package graph, or User Interface behavior changed.

## Validation evidence

- `bun test ./packages/opencorvus/test/mission-scope-partition-policy.test.ts ./packages/opencorvus/test/orchestrator/verification-budget-policy.test.ts`: 2 passed, 0 failed, 6 positive assertions.
- `bun run --cwd packages/opencorvus typecheck`: passed with exit code 0.
- `bun run docs:check`: passed, 323 operations in 25 groups.
- `git diff --check`: passed.
- A separate semantic diff review confirmed that scope ownership is resolved before closure grouping, no Task can span distinct positive Squad ownership, rejected/expired optional tests are not executed, selected binding workflows remain authoritative, and no Host scheduling gate or second lifecycle source was introduced.
