# Phase-Local Build Closure Orchestration

Status: Implemented and verified
Date: 2026-08-02
Owner: Codex

## Recall

### User request

The operator rejected recovery designs that create additional Mission phases or ask another specialist to clean up a recoverable failure:

> 正常情况下一个phase要执行完任务，不能让其他agent擦屁股。真正的问题是如何正确编排，防止在一个phase鬼打墙

The operator established the phase-local production owner:

> 每个专家团持有build agent，可以兜底完成任务，而不是让可恢复异常逃逸

The operator then authorized implementation and widened the scheduler's autonomy requirement:

> 开始修复问题，补充：调度器应该尽力保证任务完成，如果遇到未回复问题，不确定的多余commit等也需要自行处理

### Acceptance criteria

- One Mission phase remains one fixed-Squad Task and is responsible for its complete accepted result.
- A package-owned Build agent is the phase-local production and recovery owner. Review-only agents report evidence and never repair the product.
- Recoverable product, repository, toolchain, evidence, unanswered-question, and uncertain unrelated-commit conditions do not escape into a correction or retest Mission phase.
- A mandatory non-Build node interruption continues through that node's exact bound lineage; Build never substitutes for its terminal-success evidence or Artifact.
- After all required nodes and the initial Build occurrence succeed, a blocking downstream product finding is routed once to the same Task's exact package-owned Build owner. Immutable dispatch lineage prevents a second closure occurrence. That Build Turn continues concrete repair and affected verification until delivery is complete or the remaining blocker is external, destructive, outside the fixed Squad's authority, or requires a product decision that available evidence cannot determine.
- Phase closure completely reads and selects the existing canonical Build Artifact and does not publish a parallel copy; its terminal Build result and Host-observed changes/checks are the closure evidence.
- Research, planning, testing, visual review, and integrity review are not restarted for the repair. Mission does not manufacture a correction, retest, or final-review stage.
- A dismissed or unanswered question causes the scheduler to make and record a reversible evidence-backed assumption whenever possible. Only missing credentials, external authority, destructive approval, or an irreducible product decision remains operator-blocking.
- An uncertain extra commit is inspected against task-owned paths, current behavior, and Host-observed diffs. Unrelated commits are preserved; overlap is reconciled by Build. Commit count, HEAD drift, or provenance uncertainty alone does not fail acceptance.
- Provider, network, process, compaction, and tool execution interruptions are physical evidence. The scheduler resumes the bound dispatch lineage or routes recoverable work to the phase Build owner; it does not create a new Task.
- No Host scheduling gate, retry counter, workflow state machine, compatibility path, fallback profile, or generic `universal-build` substitution is added.
- Focused positive non-User-Interface contracts, typecheck, documentation checks, second review, commit, and `myhexin/v0.0.28beta` push succeed.

### Hard constraints

- Preserve every parallel change. No reset, restore, stash, new worktree, history rewrite, broad formatting, or broad staging.
- Keep the fixed Squad, selected workflow, immutable dispatch lineage, and Delivery Slice evidence-subject semantics.
- A verification-only Expert Squad remains verification-only. The phase-local Build ownership requirement applies to Squads selected to produce the phase deliverable; it does not authorize MirrorTest or another audit-only Squad to edit the System Under Test.
- Do not add, modify, update, or run User-Interface automation tests.
- Do not restart or mutate the live OpenCorvus process, database, Mission, Session, or historical Task state without separate authorization.

### Current repository and prior work

- Current branch: `v0.0.28beta`.
- Pre-change HEAD: `1f16481df3ca401d6dba470c2527e3d9dd13694c`.
- The worktree was clean at intake.
- Concurrent commits `d1a8f76483` and `1f16481df3` were preserved. They own project bootstrap recovery and Overlay dock behavior and do not overlap this repair.
- Prior commit `3df81c538d` already separated advisory-only Integrity evidence, added one same-Task Build repair dispatch for blocking product findings, corrected compaction helper descriptor projection, and added bounded large Artifact materialization.

### Sources read

- Root `AGENTS.md` supplied in the task context.
- `specs/current/architecture/14-agent-runtime-mode.md`
- `specs/current/architecture/15-agent-facts-and-turns.md`
- `specs/records/2026-08/2026-08-02-same-task-repair-first-orchestration.md`
- `specs/records/2026-08/2026-08-02-task-acceptance-compaction-and-large-artifact-repair.md`
- `packages/opencorvus/src/prompt/core/mission-core.txt`
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
- `packages/opencorvus/src/engine/describe.ts`
- Base, Advanced, and Research Studio manifests, scheduler overlays, producer prompts, and package READMEs.
- `packages/opencorvus/src/prompt/fragments/build-runtime-discipline.ts`
- `packages/opencorvus/src/prompt/core/engineering-craft.txt`
- Orchestrator lifecycle, coordination, and prompt contract tests.
- SDK Expert Squad manifest topology validator and authoring guidance.

### Whole-repository grep and call-site disposition

```text
rg -n "fresh correction stage|fresh held independent audit|new fixed-profile Mission Task|same Task's exact Build|exact Build or implementation owner" packages/opencorvus/src packages/opencorvus/test specs/current
rg -n "quota/network/provider failures|recent_agent_failures|recent_tool_execute_failures|question|unanswered|dismissed" packages/opencorvus/src packages/opencorvus/test
rg -n "unrelated.*commit|commit.*unrelated|no_project_diff|HEAD|provenance" packages/opencorvus/src packages/opencorvus/test specs/current
rg -n '"base_role"\s*:\s*"build"' packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad
```

| Surface | Disposition |
| --- | --- |
| Mission reconciliation | Remove automatic correction/retest stage creation. A terminal unaccepted Task is a true failed phase only after its own Orchestrator exhausted phase-local Build ownership. |
| Shared Orchestrator | Make completion-seeking scheduling explicit: resolve reversible uncertainty, route all recoverable delivery work to the exact package Build owner, and fail only on irreducible blockers. |
| Runtime failure projection | Stop instructing the model that physical Agent/tool failures require a new Task. Preserve and continue the exact affected workflow or closure occurrence; do not transfer a mandatory non-Build evidence contract to Build. |
| Base and Advanced overlays | Bind repair to their exact declared Build identities and require the Build Turn to close affected verification without restarting review nodes. |
| Build runtime discipline | Treat unanswered non-authority questions, uncertain extra commits, HEAD drift, and unrelated concurrent work as inspect-and-resolve Build work. Preserve unrelated changes. |
| Research Studio | Make the sole final report writer use the Build runtime template because it is the package-owned final delivery and recovery owner; preserve research-only scope. |
| Expert Squad authoring | Require every production Squad to declare a package-owned Build-template final delivery owner; keep verification-only packages read-only. |
| Tests | Replace the obsolete positive assertion for fresh correction stages with positive current-Phase closure, assumption, commit reconciliation, and physical-continuation contracts. |
| Architecture/docs | Record one phase-local Build closure and remove repeat review/repair semantics. |

### Independent agent feedback

Three prior independent read-only audits agreed that the frequent failures were algorithmic rather than machine exhaustion:

1. Two recent failures were advisory-only reviews incorrectly mapped to Task failure.
2. Two contained real product blockers but never returned to Build.
3. One large-Artifact Tester stopped without its required report after compaction; the physical stream end was treated as completion.
4. No audited failure had CPU, memory, network, Provider, or uniform timeout evidence sufficient to explain the terminal decision.

## Implementation plan

1. Rewrite Mission reconciliation so phase-local recovery remains inside its existing Task and fresh stages represent only independently acceptable cross-Squad deliverables.
2. Extend shared Orchestrator recovery guidance for unanswered questions, uncertain commits, evidence/tool interruptions, and exact Build ownership.
3. Align dynamic recovery text, lifecycle descriptions, Base, Advanced, Research Studio, and authoring guidance.
4. Replace stale positive prompt contracts and add positive runtime projection coverage without adding UI or negative tests.
5. Regenerate affected built-in Expert Squad payloads and versions.
6. Update current architecture and documentation indexes.
7. Run focused tests, package typecheck, generated-contract checks, docs checks, and second diff review.
8. Commit only task-owned paths with the `dsw-33987` prefix and push the current delivery branch to `myhexin`.

## Verification

- Focused scheduler, runtime projection, and built-in package contracts: 66 passed, 0 failed.
- Historical documentation links and document health: 62 passed, 0 failed.
- Root typecheck: 8 package tasks passed.
- API route inventory: 6 rules clean across 33 files.
- Generated API documentation check: 310 operations across 24 groups matched.
- `git diff --check`: clean.
- Second review found and resolved two contract conflicts: Build no longer substitutes for failed mandatory non-Build nodes, and immutable lineage plus single-canonical-Artifact rules prevent repeated closure dispatches and duplicate handoffs.
- Advisory-only Integrity `concerns` remains acceptable evidence; only a downstream blocking product or final-deliverable finding after complete mandatory workflow evidence enters Phase closure.
