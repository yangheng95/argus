# Goal-scoped delegated-worker contract projection

## Recall

### User request

Monitor Mission `bea70267fe9d5843`, repair every evidenced problem immediately, and treat shared infrastructure defects systemically across every affected Agent and Expert Squad. Intervene in or restart the Mission only when the verified repair cannot be consumed reliably by the current execution.

### Acceptance criteria

1. Every goal-scoped `delegated_worker` receives the exact persisted Goal contract selected by `work_scope.goal_id`, including identity, objective, complete `acceptance_specs`, `owned_paths`, dependencies, kind, priority, and bound RequirementSet/ContractGraph artifact identities.
2. Task-scoped delegated workers do not receive an implicit Goal contract.
3. A Goal from another Task cannot be projected through the current Task dispatcher.
4. The repair applies through the shared delegated-worker adapter to all Expert Squads and dynamic Agent identities using `base_role: delegated-worker`; no Prism-specific prompt, fallback, gate, retry, or compatibility path is introduced.
5. Exact selected `artifact:<id>` payload projection remains unchanged.
6. Focused regressions, document-health checks, typecheck, commit, normal-hook push to `legacy-remote`, and a bounded runtime verification succeed.

### Hard constraints

- Preserve all unrelated staged, unstaged, untracked, and concurrent changes. Do not stash, reset, restore, delete, broadly stage, or create a worktree.
- Use one canonical persisted Goal row as the contract source. `goal:*` evidence labels cannot become a second selector.
- Do not infer Goal facts from the delegated instruction, artifact summaries, filenames, Agent identity, or Squad identity.
- Do not restart the Mission for ordinary progress. After verification, prefer an explicit continuation using the same Mission only if the blocked worker can consume the repaired contract without polluted output; otherwise settle the old execution and use a never-reused run.
- Commit subjects start with `dsw-33987`; push only to `legacy-remote`.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/15-agent-facts-and-turns.md`
- `specs/records/2026-07/2026-07-25-goal-worker-evidence-continuation-repair.md`
- `specs/records/2026-07/2026-07-24-delegated-context-prominence.md`
- `packages/opencorvus/src/delegated-worker/context.ts`
- `packages/opencorvus/src/delegated-worker/agent.ts`
- `packages/opencorvus/src/orchestrator/delegated-worker-tool.ts`
- `packages/opencorvus/src/orchestrator/dispatch-agent-tool.ts`
- `packages/opencorvus/src/agent/projected-agent-work-scope.ts`
- `packages/opencorvus/src/prompt/upstream-context.ts`
- `packages/opencorvus/src/engine/store.ts`
- `packages/opencorvus/test/orchestrator/delegated-worker-tool.test.ts`

### Whole-repository search evidence

- `delegatedWorkerContextSections` has one production caller: `createDelegatedWorkerTool`.
- `DelegatedWorkerAgent.run` receives the adapter-rendered sections and has no independent Goal-store projection.
- `delegated-worker/context.ts` expands only exact `artifact:<id>` refs. A `goal:<id>` ref is displayed as a label and never resolves the Goal row.
- `prompt/upstream-context.ts` states that sub-agents read `acceptance_specs` and the Goal contract directly from the Goal row, but that helper is not called by delegated workers.
- The shared `delegated-worker` base role is used by `general`, `review-debug`, `research-studio`, `mirror/prism`, and `tanzeqi/mirror-watch`; therefore a Prism-only prompt repair would leave the same defect active elsewhere.
- Build, integrity, visual QA, requirements, architect, frontend research, and frontend design have separate typed adapters. This defect is at the shared delegated-worker context projection boundary.

### Independent Agent feedback

No independent or parallel Agent review was requested for this repair, so none was started.

## Failure evidence

At `2026-07-25T08:00:18Z`, goal-scoped PRD Author Session `ses_067b7a7d1ffdYTHbUEfjwwtHFZ` returned blocking coordination request `art_f984a1136001RJAj6p5ufS5RQL`. The worker received Goal ID `gol_f981f882b001xB6vn6gZYM5CRM` but could not locate the authoritative `acceptance_specs`; it correctly refused to infer them from RequirementSet or ContractGraph summaries.

The Task board simultaneously exposed two complete persisted acceptance specs for that Goal. This proves the data existed and the Agent-to-Orchestrator return path worked; the loss occurred while projecting the scheduler-selected Goal into the delegated-worker prompt.

## Causal chain

1. Orchestrator dispatches a delegated worker with `work_scope.kind="goal"` and an exact `goal_id`.
2. `dispatch-agent-tool.ts` validates and preserves the exact work scope.
3. `delegated-worker-tool.ts` passes only Task, reason, and evidence refs to `delegatedWorkerContextSections`.
4. `delegated-worker/context.ts` expands artifact payloads but has no work-scope input and cannot render the selected Goal row.
5. The worker sees a Goal label and upstream artifact summaries, but not the authoritative acceptance and ownership contract.
6. Correct workers block through `request_orchestrator_decision`; permissive workers risk inventing acceptance text. Both outcomes are systemic defects.

## Call-point decisions

| Call point | Decision |
| --- | --- |
| `delegated-worker/context.ts` | Accept the validated `workScope`; for Goal scope, load the exact Goal row, prove `goal.task_id === task.id`, parse the persisted acceptance specs, and render one complete canonical Goal JSON block. |
| `orchestrator/delegated-worker-tool.ts` | Pass the dispatch execution's already-validated work scope into the shared context projector. |
| `delegated-worker/agent.ts` | Preserve; it remains a transport-neutral renderer of supplied visible sections. |
| `prompt/upstream-context.ts` | Preserve; Build-oriented narrative upstream summaries are not a substitute for the delegated worker's exact Goal contract. |
| Expert Squad manifests and Agent prompts | Preserve; every `base_role: delegated-worker` consumer receives the repair through the shared adapter. |
| `delegated-worker-tool.test.ts` | Cover task scope, exact Goal projection, complete acceptance/ownership fields, cross-Task rejection, and existing artifact behavior. |

## Verification plan

- `bun test packages/opencorvus/test/orchestrator/delegated-worker-tool.test.ts`
- `bun test packages/opencorvus/test/delegated-worker/agent.test.ts`
- `bun test packages/opencorvus/test/orchestrator/dispatch-agent-tool.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- Review the exact owned-file diff, commit only those files, and push through normal hooks to `legacy-remote`.

## Implementation

- `delegatedWorkerContextSections` now requires the dispatcher-selected `ProjectedAgentWorkScope`.
- Goal scope resolves only `work_scope.goal_id`, rejects an absent or cross-Task Goal, parses the persisted acceptance specs, and renders the selected Goal's complete acceptance and ownership contract.
- Task scope remains unchanged and cannot promote a `goal:*` evidence label into an implicit Goal selector.
- `createDelegatedWorkerTool` passes the already validated execution work scope through the one shared adapter path, so General, Review & Debug, Research Studio, Mirror Prism, and Mirror Watch inherit the same repair without Squad-specific branches.
- The Mirror Watch package regression was also repaired where it still asserted retired optional Architect dispatch fields that no longer exist in the canonical package prompt.

## Verification evidence

- The seven-file shared-adapter and representative cross-Squad suite passed: `48 pass, 0 fail, 2780 expect() calls`.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `historical-docs-links.test.ts` passed: `21 pass, 0 fail`.
- `product-docs-single-source.test.ts` passed: `8 pass, 0 fail`.
- The first `document-health.test.ts` run exposed that this new record and an unrelated concurrently authored Sub-agent record were referenced before being tracked. The new record is included in this repair commit; the unrelated record remains owned by its concurrent change and is not staged by this repair.

## Runtime disposition

The bounded snapshot at `2026-07-25T08:21:08Z` showed Mission `bea70267fe9d5843` and Task `tsk_f98043840001cqEeODYdBWjJg3` already terminal-failed. The exact terminal error identifies two PRD Author Turns, Sessions `ses_067b7a7d1ffdYTHbUEfjwwtHFZ` and `ses_067acb443ffd0ZVfhHAlszqeNH`, that lacked the canonical acceptance specs and safely refused inference. All visible execution Sessions were terminal or idle, pending permissions were empty, and backend PID `62714` still owned listener `127.0.0.1:7878`.

Because the Task is terminal and its two Author Sessions were created with irreparable old prompt context, it cannot reliably consume this repair in place. After the verified commit is loaded, the correct minimum intervention is to leave the failed Mission as evidence and publish a new Mission from a never-reused run directory; no Goal-only or Session-only restart can make this terminal Task authoritative again.
