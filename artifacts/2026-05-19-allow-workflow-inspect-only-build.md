# Superseded: Allow workflow inspect-only direct build

Superseded on 2026-05-19 by `artifacts/2026-05-19-retire-build-inspect-only.md`.
Build inspect-only mode is retired; Build is implementation-only.

Date: 2026-05-19

## User request

Error reported: task-level workflow `build` rejected `directBuildIntent="inspect_only"` and told the orchestrator to use the stage-agent path instead.

The requested change is to identify the source and remove this restriction.

## Recall and constraints

- `AGENTS.md` delegates to `CLAUDE.md`.
- `CLAUDE.md` forbids fallback/double-source fixes, requires root-cause analysis before edits, and requires tests for code changes.
- The existing build prompt already supports explicit exploration-only direct requests: it tells build to keep the worktree clean and report findings with `status="passed"` and `files_changed: []`.

## Repository evidence

`rg` for the exact error and related terms found one host-side rejection source:

- `packages/opencorvus/src/orchestrator/tools.ts`: build tool rejects `directBuildIntent === "inspect_only"` for `kind="workflow"` task-level builds before `BuildAgent.run`.

Related single-source prompt/test locks:

- `packages/opencorvus/src/orchestrator/tools.ts`: build tool description and `directBuildIntent` schema description say inspect-only workflow direct builds are not allowed.
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`: orchestrator core prompt says task-level inspect-only build is not a workflow path.
- `packages/opencorvus/test/orchestrator/tools.test.ts`: test asserts inspect-only workflow direct build is rejected before starting BuildAgent.
- `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts`: prompt hygiene test asserts the old prohibition remains.

## Implementation plan

1. Remove only the host-side `directBuildIntent === "inspect_only"` workflow rejection.
2. Update build tool descriptions so `inspect_only` is an explicit allowed task-level workflow intent for read-only exploration.
3. Update orchestrator core prompt to allow inspect-only direct build when it is the smallest responsible read-only path, while keeping multi-goal decomposition guidance intact.
4. Replace the rejection test with a positive test proving inspect-only workflow direct build starts `BuildAgent.run`, preserves target request text, creates a task-level run, and does not require a goal graph.
5. Update prompt hygiene assertions.

## Acceptance

- The exact rejection string no longer exists in source/test prompt material.
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "workflow task-level"` passes.
- `bun test packages/opencorvus/test/agent/core-prompt-hygiene.test.ts --test-name-pattern "orchestrator prompt treats direct build"` passes.
- Final self-review confirms there is no parallel old prohibition left for `inspect_only`.

## Verification

- PASS: `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "workflow task-level"`
- PASS: `bun test packages/opencorvus/test/agent/core-prompt-hygiene.test.ts --test-name-pattern "orchestrator prompt treats direct build"`
- PARTIAL: `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "task-level direct build creates|accepted deliver completes|workflow task-level"` passed the inspect-only and direct task-scope rejection cases, then exited non-zero because unrelated `accepted deliver completes the task without publish_delivery` still times out at 5s after plugin/config install side effects.
- Known unrelated prompt hygiene failures observed when running the full file: `engineering-craft.txt` inventory drift and a stale delivery prompt text assertion from the 2026-05-18 engineering-craft / delivery refactor surface.
