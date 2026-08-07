# Task Acceptance, Compaction, and Large-Artifact Root Repair

Status: Completed
Date: 2026-08-02
Owner: Codex

## Recall

### User request

The operator asked why recent database Tasks fail frequently, requested several
independent Agents to cross-check whether the cause is algorithmic or
performance-related, asked for a systemic repair, and authorized implementation:

> 检查为什么数据库中最近的几个任务为什么频繁失败，现在的算法不对吗，还是性能问题导致的？

> 找几个agent交叉检查分析

> 有没有系统性修复方案？

> 开始修复问题

The earlier correction remains binding:

> 只调用build尝试修复

### Acceptance criteria

- An Integrity result containing only advisory findings remains acceptable
  current-Task evidence; it does not dispatch Build and does not fail the Task.
- A blocking downstream product finding dispatches only the exact current
  Build or implementation owner once before failure. Research, planning,
  testing, Visual Review, and Integrity Review are not rerun.
- Compaction preserves exact resumable tool cursors and immutable references;
  it never invents an approximate byte offset or restarts a completed prefix.
- Internal helper messages such as `compaction` do not create false worker
  descriptor mismatch diagnostics, while real primary-worker descriptor
  mismatches remain visible.
- Large immutable Artifact resources have a bounded tool-assisted inspection
  path that does not require repeated full model-context ingestion.
- No Host scheduling gate, retry state machine, fallback path, compatibility
  alias, or lifecycle mutation is introduced.
- Focused positive non-User-Interface tests, typecheck, documentation checks,
  second review, commit, and `legacy-remote/v0.0.28beta` push succeed.

### Hard constraints

- Preserve all parallel work; no reset, restore, stash, new worktree, broad
  formatting, or broad staging.
- Do not restart or mutate the running OpenCorvus process, database, Mission,
  Session, or Task state without separate operator authorization.
- Do not add, modify, update, or run User-Interface automation tests.
- Reviewers remain read-only; product repair remains owned by Build.
- Prompt guidance and root-cause code repairs own routing behavior. Host code
  may validate data shape and evidence integrity but must not decide workflow.

### Evidence and sources read

- Root `AGENTS.md` supplied in the task context.
- Read-only SQLite evidence from the 20 most recently updated Tasks and the
  five true failures.
- The failing Earthquake, payment-core, TCO, warehouse, and large-resource
  Task/Session/Artifact records.
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
- `packages/opencorvus/src/prompt/core/integrity-team-core.txt`
- Base and Advanced Orchestrator, Tester, and Integrity Reviewer overlays.
- `packages/opencorvus/src/orchestrator/agent.ts`
- `packages/opencorvus/src/orchestrator/task-lifecycle-tools.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/engine/describe.ts`
- `packages/opencorvus/src/agent/role-contract.ts`
- `packages/opencorvus/src/session/compaction.ts`
- `packages/opencorvus/src/session/compaction-tool-result-reader.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/src/tool/artifact-catalog.ts`
- `packages/opencorvus/src/artifact-catalog/index.ts`
- `packages/plugin/src/artifact-catalog.ts`
- Focused Integrity, Orchestrator, descriptor, compaction, and Artifact tests.

### Whole-repository grep and call-site disposition

```text
rg -n "verdict|advisory|needs_correction|non-pass|Build once|same Build" packages/opencorvus/src packages/opencorvus/test specs/current/architecture
rg -n "descriptor_error|worker_turn_descriptor|AgentRoleContract|controlSurface" packages/opencorvus/src packages/opencorvus/test
rg -n "compaction_tool_result_reference|ReadCompactionToolResult|next_offset|byte_offset" packages/opencorvus/src packages/opencorvus/test packages/plugin/src
rg -n "artifact_read|completely read|complete=true|ArtifactReadInputSchema" packages/opencorvus/src packages/opencorvus/test packages/plugin/src
```

| Surface | Disposition |
| --- | --- |
| Shared Orchestrator core and dynamic Recovery Discipline | State the advisory-only acceptance boundary and preserve the exact one-Build repair path for blocking findings. |
| Base and Advanced Orchestrator overlays | Use the same severity semantics; do not treat every non-pass label as repair-bearing. |
| Integrity core and Base Integrity Reviewer | Emit `concerns` only as advisory evidence when every finding is advisory; identify blocking findings explicitly. |
| Lifecycle and review tool descriptions | Describe advisory evidence and blocking repair evidence without implementing a Host gate. |
| Workbench projections | Retain fact projection only; no acceptance authority is moved into the Board. |
| `listAgentMessageRefs` | Validate descriptor identity only for primary worker messages; helper identity is classified through `AgentRoleContract`, not string matching. |
| Compaction transcript, reader, and prompt | Carry exact persisted tool references and require authoritative cursor retrieval before summarization. |
| Artifact read schema, implementation, and read facts | Add one exact bounded materialization/inspection contract rather than a second Artifact source. |
| Base/Advanced consumer prompts and package docs | Prefer bounded tool-assisted inspection for large structured resources while still selecting exact immutable evidence. |
| Focused tests | Add positive contracts for advisory acceptance, helper descriptor projection, exact compaction cursor preservation, and bounded large-resource inspection. |

### Independent Agent feedback

Three independent read-only audits agreed on the causal split:

1. Database audit: among the latest 20 Tasks, 12 completed, 3 were cancelled,
   and 5 truly failed. Two of those five failures contained only advisory
   Integrity findings; two contained blocking findings but never returned to
   Build; one exhausted work on very large resources.
2. Scheduler audit: the acceptance algorithm conflated a non-`pass` label with
   blocking repair evidence. Existing prompts also made workflow occurrences
   immutable without the exact same-Task Build repair exception.
3. Compaction/performance audit: no out-of-memory, provider, network, or global
   timeout root cause was found. The failing Tester made 109 successful
   `artifact_read` calls, accumulated roughly 789 seconds of read latency and
   13.6 million tokens, compacted once, then restarted large CSV reads because
   the summary retained approximate rather than authoritative offsets. A
   helper `compaction` message also produced a false descriptor mismatch.

Performance is therefore an amplifier. The primary causes are acceptance
semantics, missing repair routing, and unbounded evidence consumption.

## Implementation plan

1. Complete the single-Build repair contract by separating advisory-only
   evidence from blocking findings in every scheduler-visible prompt surface.
2. Classify helper Agent messages through the canonical role contract before
   validating worker descriptor identity.
3. Make compaction summaries recover exact continuation cursors from persisted
   tool results and test the authoritative path.
4. Add one bounded large-resource Artifact inspection/materialization contract,
   integrate it with complete-read provenance, and update consumer guidance.
5. Regenerate affected built-in package payloads and versions.
6. Run focused positive tests, package typecheck, route/docs checks, and a
   second diff review.
7. Commit only task-owned paths with the `dsw-33987` prefix and push the
   current main delivery branch to `legacy-remote`.

## Verification

- Advisory-only Integrity concerns and blocking-only Build repair are aligned
  across shared Orchestrator guidance, dynamic Recovery Discipline, Base,
  Advanced, lifecycle tools, Visual Review guidance, and current architecture.
- Base version `2026.08.02.2` and Advanced version `2026.08.02.1` bind the
  changed package prompts to new immutable package digests.
- `artifact_read delivery=materialized_file` verified a complete published CSV
  resource, returned a read-only content-addressed cache path, and reproduced
  its exact bytes without inline body transport.
- Helper descriptor projection, compaction cursor guidance, Artifact
  provenance, Integrity traceability, package resolution, and scheduler prompt
  suites passed: 71 focused tests plus 31 Base/Advanced/scheduler contract
  tests and 25 plugin Artifact tests.
- OpenCorvus and plugin package typechecks passed.
- Repository-wide typecheck passed.
- `api:routes-check` passed across 33 route files.
- `docs:check` passed across 310 operations and 24 groups.
- Historical documentation links passed. Document Health passed 62/62 after
  the new record entered the Git index.
- No live OpenCorvus process, database, Mission, Session, or historical Task
  state was restarted or mutated.
