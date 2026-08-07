# Orchestrator Ready-Frontier Parallel Dispatch

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User requirement | “调度器在并行调度上非常的保守，应该是能并行尽量并行，而不是浪费时间”。 Independent executable work must start together instead of waiting for one worker to finish before dispatching the next. |
| Acceptance criteria | On every scheduler decision epoch, the Orchestrator identifies the complete currently eligible frontier. It emits one `dispatch_agent` call per independent frontier item in the same response, subject only to real `depends_on`, active execution, task-wide `assistant.max_executor_groups`, per-agent `goal_concurrency`, and write-isolation contracts. It waits only when the eligible frontier is empty. A `started` result prevents duplicate dispatch of that exact item but does not stop sibling frontier calls already issued in the same response. |
| Hard constraints | Repair prompt-owned scheduling judgment rather than adding a Host gate, queue, workflow engine, state machine, automatic dispatch, keyword route, compatibility path, or fallback. Keep `depends_on`, `assistant.max_executor_groups`, per-agent `goal_concurrency`, `use_worktree`, and current-project Build serialization as their existing single sources. Do not change or run User Interface automated tests. Preserve all unrelated dirty-worktree changes. |
| Sources read | `specs/current/architecture/01-agents.md`, `04-extensions.md`, `08-agent-tool-adapter.md`, and `99-principles.md`; `2026-07-20-orchestrator-tool-call-decision-epoch.md`; `2026-07-22-expert-squad-reviewer-single-concurrency.md`; `session/prompt/system.txt`; `orchestrator-core.txt`; `dispatch-agent-tool.ts`; `orchestrator/agent.ts`; `prompt-profile-resolver.ts`; `engine/describe.ts`; the General package README and manifest; and focused scheduler, workflow, prompt, and collaboration-closure tests. |
| Whole-repository grep | Searches covered `parallel`, `concurrent`, `dispatch_agent`, `started`, `depends_on`, `goal_concurrency`, `max_executor_groups`, `dispatchable`, `Collaboration Closure`, `wait`, `virtual_workflows`, and every prompt/test occurrence of the binding workflow text. The global scheduler policy has one core source in `orchestrator-core.txt`. Package workflow scheduling guidance is appended only by `PromptProfileResolver.composeResolvedAgentPrompt`. The dynamic target catalog in `orchestrator/agent.ts` explains one call payload but does not own scheduling policy. `dispatch-agent-tool.ts` executes one exact dispatch per call and returns typed outcomes; it is not an admission controller. |
| Git baseline | After `git fetch`, remote `legacy-remote/v0.0.26beta` contained the local prior HEAD and one concurrent Composer plan. The branch was safely fast-forwarded to `00ffd0f881389c1cc93e0f1a336628870e2e6875`. Existing staged/unstaged Composer edits and unrelated artifact deletions remain untouched. |
| Independent agent feedback | None. The user did not request multiple agents or parallel audit, so the active collaboration policy prohibits inferred sub-agent spawning. The primary agent owns the required second review. |

## Cause Chain

1. The Host already exposes the complete Goal graph, immutable `depends_on`
   edges, task-wide parallelism, per-agent Goal concurrency, and workspace
   isolation contracts.
2. The global Orchestrator prompt says independent work may run in parallel,
   but phrases it as permission rather than the default scheduling obligation.
3. The same prompt strongly emphasizes that a Goal-scoped Build returning
   `kind="started"` ends the current wake. It correctly prevents duplicate
   dispatch of that Goal, but never distinguishes that from sibling
   `dispatch_agent` calls which should already have been emitted in the same
   assistant response.
4. The virtual-workflow prompt likewise says independent nodes “may” run
   concurrently and only explicitly requires concurrent repetition across
   disjoint Goals. It does not require the complete dependency-ready node
   frontier to dispatch together.
5. The core also says Collaboration Closure explicitly identifies dispatchable
   Goals, while the canonical Closure intentionally publishes facts without a
   Host-authored dispatchability verdict. That contradiction encourages the
   model to wait for a marker which never exists.
6. A model following both prompts conservatively can therefore choose one
   eligible item, receive `started`, end the wake, and leave equally eligible
   siblings idle until a later refill. No configured limit caused that lost
   parallelism.

## Complete Call-Site Disposition

| Owner or consumer | Decision |
| --- | --- |
| `packages/opencorvus/src/prompt/core/orchestrator-core.txt` | Make complete ready-frontier dispatch the default. Require one call per independent eligible item in the same response before waiting. Clarify that `started` closes only duplicate scheduling of that exact item and does not cancel sibling calls already emitted. Derive eligibility from current Goal/dependency/execution/Closure facts rather than a nonexistent Host verdict. Preserve dependency, budget, concurrency, worktree, and lifecycle boundaries. |
| `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts` | Apply the same mandatory ready-frontier rule to the selected binding virtual workflow. Distinguish independent agent identities from repetitions of one agent whose `goal_concurrency` is `single`. |
| `packages/opencorvus/src/orchestrator/agent.ts` | Preserve. It renders the active target catalog and target-specific payload fields; duplicating scheduling policy here would create a second source. |
| `packages/opencorvus/src/orchestrator/dispatch-agent-tool.ts` | Preserve. One tool invocation continues to own one exact dispatch. Parallelism comes from multiple independent calls in one model response, not a second batch-dispatch application programming interface. |
| `packages/opencorvus/src/engine/describe.ts` | Preserve. It renders durable Goals and collaboration facts without introducing a Host-derived dispatchable set or admission verdict. The model derives the current frontier from those visible facts. |
| `packages/opencorvus/src/config/config.ts` and package manifests | Preserve `assistant.max_executor_groups` and `goal_concurrency` as the existing task-wide and per-agent capability bounds. |
| `packages/opencorvus/test/orchestrator/orchestrator-core-prompt.test.ts` | Add a positive prompt contract proving complete-frontier, same-response dispatch and exact-item `started` semantics. |
| `packages/opencorvus/test/expert-squad/virtual-workflow-dispatch-scope.test.ts` | Add a positive resolved-prompt contract proving dependency-ready workflow nodes dispatch as one frontier while declared single-agent repetition remains serialized. |
| `specs/current/architecture/01-agents.md` and `04-extensions.md` | Record ready-frontier dispatch as the scheduler behavior while retaining model judgment and the existing declarative bounds. |

## Implementation And Verification Plan

1. Commit and push this investigation record before product changes.
2. Strengthen the global Orchestrator core and resolved virtual-workflow prompt
   at their existing single scheduling-policy sources.
3. Add positive non-UI prompt-projection contracts for global and binding
   workflow scheduling.
4. Run the two focused contract files, TypeScript checking, documentation
   health, the required historical-document link test, and `git diff --check`.
5. Re-grep every scheduling-policy owner, perform a second exact-diff review,
   update this record and indexes, commit only task-owned paths through a
   current-HEAD isolated index, push through normal hooks to `legacy-remote`, and
   verify remote convergence.

## Progress

- [x] Scheduler prompt, workflow projection, dependency, concurrency,
      dispatch-result, collaboration-closure, architecture, tests, Git
      baseline, and unrelated worktree state inspected.
- [x] Recall commit `048a3e60ac` and legacy remote push complete.
- [x] Global and binding workflow ready-frontier contract implemented.
- [x] Focused contracts, typecheck, document health, and diff checks pass.
- [x] Implementation commit `cd4cdc1369`, complete pre-push hook, legacy remote push,
      and immediate remote convergence complete.

## Verification And Second Review

- Focused Orchestrator core and resolved virtual-workflow contracts: 18 passed,
  0 failed, 153 expectations.
- Historical index, product documentation single source, and document health:
  73 passed, 0 failed, 1378 expectations.
- `packages/opencorvus` TypeScript checking passed.
- `git diff --check` passed, and the final owner grep found no retained
  permission-only parallel wording, old within-Goal concurrency sentence, or
  false claim that Collaboration Closure supplies an explicit dispatchability
  verdict.
- The first root-level historical-document invocation did not enter the test
  runner because concurrent work has deleted root `test-preload.ts`. Running
  through the canonical `packages/opencorvus/bunfig.toml` package boundary
  entered the real runner and passed; no concurrent deletion was restored or
  modified.
- Second review traced same-response multiple-tool support through the shared
  session prompt, which already requires multiple independent tool calls in
  one response, and verified `max_executor_groups` is rendered in the Task
  runtime facts. It then found and repaired the deeper Closure contradiction:
  the core had required an explicit Host dispatchability marker that
  `renderCollaborationClosure` intentionally does not publish. The final
  contract makes the model derive eligibility from the complete Goal,
  dependency, active-execution, and Closure facts before filling the ready
  frontier.
- The two directly changed test files contained retained negative assertions
  from older prompt-removal work. They were removed under the current positive
  test contract; all remaining assertions in those files prove current prompt,
  projection, concurrency, or dispatch-schema behavior.
