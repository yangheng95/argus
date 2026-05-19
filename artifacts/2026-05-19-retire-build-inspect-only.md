# Retire build inspect-only mode

Date: 2026-05-19

## User request

The prior change made task-level workflow `build({ request, directBuildIntent: "inspect_only" })`
legal. That was the wrong abstraction: it turned Build into a read-only
exploration agent, which then produced sessions that claimed to have read
content without carrying durable requirements, goal contracts, or useful
conversation evidence.

Retire this mode. Build remains an implementation dispatcher only.

## Recall and constraints

- Supersedes `artifacts/2026-05-19-allow-workflow-inspect-only-build.md`.
- `AGENTS.md` delegates to `CLAUDE.md`.
- No fallback / compatibility path: remove the old intent rather than keeping
  two valid read-only routes.
- Durable exploration belongs to stage agents such as `analyze_intent`,
  `requirements`, and the registered `explore` subagent; Build can read files
  only as part of an implementation/rework attempt.
- User clarified during implementation: repository investigation must use only
  the `requirements`, `analyze_intent`, and `explore` agents. `architect` may
  consume their durable records and produce contracts, but must not be described
  as the generic repository-investigation agent in Build's rejection path.
- Every behavior change needs tests that prove the removed behavior no longer
  starts.

## Repository evidence and call sites

`rg inspect_only|no-edit analysis|read-only exploration|read-only investigation`
found these active source/test locks:

- `packages/opencorvus/src/orchestrator/tools.ts`: build tool schema,
  description, and workflow missing-intent error expose `inspect_only`.
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`: core prompt
  tells the orchestrator fresh workflow direct builds may use `inspect_only`.
- `packages/opencorvus/src/prompt/core/build-core.txt`: Build prompt declares
  explicit no-edit exploration/analysis as a valid build session and explains
  how to skip commit / merge_back.
- `packages/opencorvus/src/build/agent.ts`: direct-request prompt repeats the
  same no-edit exploration branch; `report_build_result` tool description also
  accepts explicit no-edit analysis as a normal passed outcome.
- `packages/opencorvus/src/build/types.ts`: BuildResult comments describe
  passed no-edit analysis as a valid terminal result.
- `packages/opencorvus/src/engine/workflow.ts`: pipeline step hint says
  task-level direct build can be used for scoped workflow implementation.
  This remains valid, but it must not imply read-only exploration.
- `packages/opencorvus/src/agent/agent.ts`: `explore` is a registered
  read-oriented subagent. Orchestrator currently disables the generic `task`
  tool, so this change must not pretend Build can hand work to `explore` unless
  a later explicit orchestrator explore dispatch tool is wired.
- `packages/opencorvus/test/orchestrator/tools.test.ts`: positive test proves
  inspect-only workflow direct build starts BuildAgent.
- `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts`: prompt hygiene
  asserts the old build/orchestrator prompt text exists.
- `packages/opencorvus/test/build-agent/prompt-context.test.ts`: request-path
  prompt test asserts the no-edit analysis branch exists.
- `packages/opencorvus/test/build-agent/types.test.ts`: schema test names a
  no-edit analysis passed result. The schema can still accept empty
  `files_changed` for honest no-change implementation outcomes, but the test
  must stop documenting Build as an exploration endpoint.

## Implementation plan

1. Change the build tool schema so `directBuildIntent` only accepts
   `"modify_files"`.
2. Add an execute-time guard for direct test invocation with stale
   `inspect_only`, returning a rejection before `BuildAgent.run`.
3. Rewrite build tool and orchestrator prompt text: task-level direct build is
   implementation-only; repository investigation must use `analyze_intent`,
   `requirements`, or the registered `explore` subagent surface rather than
   Build.
4. Remove Build prompt/direct-request no-edit exploration instructions and
   replace them with implementation-only wording.
5. Remove no-edit analysis wording from BuildResult comments/tool
   descriptions while still allowing empty `files_changed` for honest no-change
   implementation outcomes.
6. Invert tests so they prove `inspect_only` and no-edit exploration prompt
   branches no longer exist in source/test prompt material.

## Acceptance

- `rg -n "inspect_only|no-edit analysis|read-only exploration|read-only investigation" packages/opencorvus/src packages/opencorvus/test`
  returns no matches.
- Workflow task-level `directBuildIntent: "inspect_only"` is rejected before
  `BuildAgent.run`.
- Build prompt and direct request prompt no longer tell Build to act as a
  read-only exploration agent.
- Targeted tests for orchestrator tools, core prompt hygiene, BuildAgent prompt
  context, and BuildResult schema pass.
- `bun run --cwd packages/opencorvus typecheck` passes.

## Verification

- PASS: `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "workflow task-level"`
- PASS: `bun test packages/opencorvus/test/agent/core-prompt-hygiene.test.ts --test-name-pattern "build prompt does not define|orchestrator prompt treats direct build"`
- PASS: `bun test packages/opencorvus/test/build-agent/prompt-context.test.ts --test-name-pattern "request-path rejects"`
- PASS: `bun test packages/opencorvus/test/build-agent/types.test.ts --test-name-pattern "no-change implementation"`
- PASS: `bun run --cwd packages/opencorvus typecheck`
- PASS: `rg -n "inspect_only|no-edit analysis|read-only exploration|read-only investigation|exploration, investigation, or analysis|explicit no-edit" packages/opencorvus/src packages/opencorvus/test`
  returned no matches.

## Follow-up correction: wire real Explore dispatch

User correction: saying "repository investigation belongs to explore" is not
sufficient while the orchestrator disables the generic `task` tool and has no
explicit `explore` tool. That leaves `explore` registered but unreachable from
workflow orchestration.

Additional implementation plan:

1. Add an explicit orchestrator `explore` tool.
2. Dispatch the registered `explore` subagent through `SessionPrompt.prompt`
   in a child session under the orchestrator session.
3. Disable mutation-oriented tools for this dispatch (`write`, `edit`, `bash`,
   `task`, TODO tools) so repository investigation remains read-only through
   the host contract.
4. Return the final explore text to the current orchestrator turn through
   `SubAgentProtocol.yieldResult`.
5. Persist the result as `decision_log.phase="explore"` and an
   `engine_artifact.kind="exploration"` row so later wakes and downstream
   stage agents can consume it.
6. Add tests proving the tool dispatches `agent="explore"`, returns the result,
   persists it, and exposes `explore` in the orchestrator tool list.

Additional verification:

- PASS: `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "explore dispatches|workflow task-level"`
- PASS: `bun run --cwd packages/opencorvus typecheck`
