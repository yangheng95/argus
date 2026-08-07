# Composer Parallelism and Unattended controls

## Recall

### User request

Move Agent parallelism and the combined “automatically confirm new tasks / skip questions” behavior onto the input box as two controls named `Parallelism` and `无人值守`.

### Acceptance criteria

- The composer bottom toolbar exposes exactly two new runtime-policy controls beside the existing intent/model/send controls.
- `Parallelism` reads and writes the effective `assistant.max_executor_groups` value used by `AgentSemaphore` and task budget resolution.
- `无人值守` atomically represents `experimental.auto_confirm_proposed_tasks=true` plus `experimental.auto_question=true`; disabling it writes both false.
- The UI accurately explains that unanswered questions are skipped by the existing five-minute stale timeout, not immediately.
- Missing or invalid config does not silently fall back to a guessed value; controls are unavailable until the authoritative config is present.
- Updates use the existing `/config` JSON Merge Patch owner, update `appStore.config` from the server response, expose errors, and prevent overlapping writes.
- The adapted Run menu no longer contains settings shortcuts that were substituted for historical runtime controls.
- Desktop browser screenshots and interactions verify both controls without restarting the user's OpenCorvus process.

### Hard constraints

- No retired parallel config field, alternate active state, local-only preference, fallback default, fake toggle, or duplicated runtime source.
- Preserve `assistant.max_executor_groups`, `experimental.auto_confirm_proposed_tasks`, and `experimental.auto_question` as their existing backend authorities.
- Use mature existing Button/form primitives and current composer layout tokens.
- Preserve the unrelated dirty worktree and do not intervene in live OpenCorvus/Overlay processes.

### Sources read

- an untracked July planning draft that was read during the original task and is not retained
- `specs/records/2026-07/2026-07-11-overlay-left-rail-density-and-run-menu.md`
- `packages/opencorvus/src/config/config.ts`
- `packages/opencorvus/src/engine/{agent-semaphore,config,helpers}.ts`
- `packages/opencorvus/src/question/index.ts`
- `packages/opencorvus/src/orchestrator/task-proposal-tool.ts`
- `packages/opencorvus/src/server/routes/config.ts`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/services/{config,config-load}.ts`
- `packages/overlay/src/styles/surfaces/composer.css`

### Whole-repository search evidence

`rg` covered `max_executor_groups`, `max_runs`, `auto_question`, `auto_confirm_proposed_tasks`, unattended/parallelism/concurrency terms, question rejection, proposed-task confirmation, all composer toolbar owners, config patch clients, and current/historical Run menu tests. `max_runs` has no current runtime/config owner. `max_executor_groups`, `auto_question`, and `auto_confirm_proposed_tasks` remain live schema and runtime inputs.

### Independent agent feedback

No sub-agent was used because the user did not request delegation. The primary agent owns implementation and GUI review.

## Mechanism

`Parallelism` is project configuration because it controls the maximum concurrent Agent sessions used by fan-out phases. The server `/config` response materializes the effective value when the project does not explicitly override it, so the composer must not invent a UI default.

`无人值守` is one product control over two existing fine-grained mechanisms: proposed follow-up tasks are created without confirmation, and unanswered question interactions are rejected after the canonical stale timeout so the Agent can proceed from available context. The combined UI writes both fields atomically in one merge patch.

## Verification

- Pure control-contract tests for authoritative reads and exact patches.
- Composer source/i18n/layout tests.
- Node browser interaction test with real `/config` request capture and screenshot review.
- Overlay typecheck/build, docs health, and `git diff --check`.

## Result

- The composer now renders `Parallelism` as a positive-integer control sourced from the server-materialized `assistant.max_executor_groups` value. Invalid or absent configuration does not receive a guessed UI default.
- `无人值守` is one pressed-state control that atomically patches `auto_confirm_proposed_tasks` and `auto_question`; its tooltip states the real five-minute stale-question behavior.
- The Run menu retains Executor but no longer misclassifies Agent Models, Expert Squads, or Permissions as runtime actions.
- The real browser fixture captured both exact PATCH bodies, verified the reactive values (`3 → 5`, unattended `false → true`), preserved keyboard composer resizing, and produced `chat-composer-run-controls.png` for visual review.
- Focused unit tests, Overlay TypeScript, production Vite build, and the browser interaction test passed.
