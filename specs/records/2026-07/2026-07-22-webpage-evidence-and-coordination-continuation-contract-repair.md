# Webpage Evidence And Coordination Continuation Contract Repair

Date: 2026-07-22
Status: Implemented and validated
Owner: Codex

## Recall

### User request

The user asked why Session `ses_077467a28ffei5yd6MTWgQg33l` failed with
`prompt owner missing during attach`, then asked for a globally coherent and rational
repair rather than a local patch.

### Acceptance criteria

- The exact `projectRelativeEvidencePath` returned by `webpage_extract`,
  `webpage_compile`, and `webpage_runtime_state` is accepted unchanged by the projected
  `prepare-source-context` package tool.
- TaskArtifact publication paths retain their stricter portable artifact grammar; a
  project runtime path is not reclassified as a TaskArtifact path.
- A terminal coordination handoff settles its current prompt generation, and
  `respond_agent_coordination(decision="continue")` starts one new prompt generation in
  the same frozen worker Session.
- Same-session continuation still rejects a genuinely streaming/retry or terminal
  Session through the existing continuation target validator.
- Tests exercise the producer-to-consumer webpage evidence relay and the released-owner
  continuation boundary without adding a retry, fallback, gate, hidden wake, synthetic
  message, or second lifecycle source.

### Hard constraints

- Preserve `SessionPromptState` as the sole current-process prompt-owner source.
- Preserve the durable coordination request/response/action artifacts and the frozen
  projected worker runtime contract.
- Do not weaken `TaskArtifactRelativePathSchema` or accept absolute, parent-traversal,
  backslash, Windows device, non-canonical, or cross-task paths.
- Do not restart, stop, refresh, or otherwise interfere with the running OpenCorvus or
  Overlay process.
- Preserve all unrelated worktree changes. Any commit subject must start with
  `dsw-33987` and any push must target `myhexin`.

### Sources read

- `AGENTS.md`
- Runtime log and SQLite evidence for Session `ses_077467a28ffei5yd6MTWgQg33l`, Task
  `tsk_f88b850ce0010bpaS0QiqOzX55`, coordination request
  `art_f88ba80b3001Xkl4r5vxWq5sqA`, and response
  `art_f88be5786001wtWzdZBGuimxQy`
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/13-agent-communication-matrix.md`
- `specs/records/2026-07/2026-07-21-p0-stateful-mcp-coordination-cancellation-convergence.md`
- `specs/records/2026-07/2026-07-22-task-f855-coordination-handoff-and-mirror-watch-planning-repair.md`
- `specs/records/2026-07/2026-07-16-platform-legacy-debt-cleanup.md`
- The prompt-state, Session loop, agent runner, coordination tool, project-runtime path,
  plugin TaskArtifact ABI, webpage evidence tools, Frontend Replica package tool, and
  focused tests named below.

### Whole-repository search evidence

The pre-plan search covered every production and test occurrence of
`resume_existing`, `TaskArtifactRelativePathSchema`, `projectRelativeEvidencePath`,
`managedRuntimeDirectory`, `webpage_evidence_path`, and `prepare-source-context`.

| Surface | Call points | Disposition |
| --- | --- | --- |
| Existing-owner resume | `session/shell-exec.ts`, `session/loop.ts`, first-turn lifecycle test | Preserve: this means attach to a currently live owner. |
| Fresh wake | `session/wake.ts` | Preserve: it already uses `resume_existing:false` to start a fresh generation after a prior loop ended. |
| Coordination continue | `orchestrator/tools.ts`, Orchestrator and task-conversation route tests | Replace `resume_existing:true` with a fresh generation; update every exact assertion. |
| Prompt owner storage | `session/prompt/state.ts`, prompt-state tests | Preserve: `finish()` correctly deletes the completed generation owner and `attach()` correctly rejects a missing owner. |
| TaskArtifact path ABI | `packages/plugin/src/task-artifact.ts`, TaskArtifact store and ABI tests | Preserve unchanged for immutable snapshot tree/file names. |
| Project runtime path producer | `project/runtime-paths.ts`, webpage output resolver and three webpage tools | Preserve `.opencorvus/.r/.../webpage-evidence` as the canonical task-scoped project path. |
| Project path consumers | Frontend Replica `prepare-source-context` / `generate-source-project`; Mirror Watch canonical path helper; package tests | Add one plugin-owned canonical project-relative path predicate/schema, consume it from both packages, and preserve package-specific error wording. Do not change artifact schemas. |
| Projected webpage relay | `frontend-replica-source-project.test.ts` | Strengthen the existing real relay assertion so the hidden runtime-root path is parsed through the project-path ABI before unchanged consumption. |
| Coordination tests | `orchestrator/tools.test.ts`, `task-conversation-routes.test.ts` | Update fresh-generation expectations and add released-owner regression evidence; do not mock a live old owner into existence. |
| Synchronous handoff wake residue | Task-conversation A2A E2E and restart seed fixture | Remove the retired queued coordination wake expectation; same-process handoff returns synchronously, while restart recovery enters through `server_restart_active_task_recovered`. |

No sub-agent was used because the user did not request delegation or parallel Agents.

## Causal diagnosis

The webpage tools correctly returned the canonical task runtime path
`.opencorvus/.r/t/sq/HCL5Sq/webpage-evidence`. The Frontend Replica package incorrectly
typed that project path as a `TaskArtifactRelativePathSchema`; its artifact grammar
rejects the leading-dot `.opencorvus` segment. The worker therefore performed a legal
terminal coordination handoff instead of inventing a different evidence identity.

That handoff ended and released its prompt generation as designed. The Orchestrator
later appended a visible continue message to the same durable Session, but the
continuation caller passed `resume_existing:true`. `SessionPrompt.loop` therefore
looked only for the released owner and, when none existed, called `attach()`, producing
the observed error. This is a deterministic contract mismatch, not a process restart,
timeout, cancellation, or random race.

## Implementation plan

1. Add a plugin-owned canonical project-relative path schema distinct from the
   TaskArtifact publication-path schema, with positive coverage for hidden project
   directories and negative cross-platform traversal/device/path cases.
2. Use that schema for the Frontend Replica webpage-evidence project path and preserve
   the existing exact managed-runtime-directory identity check. Replace Mirror Watch's
   duplicate path algorithm with the same plugin predicate while preserving its package
   error contract.
3. Change coordination `continue_worker` to start a fresh Session prompt generation
   while preserving the same durable Session, frozen runtime contract, visible message,
   and execution lease.
4. Update all exact continuation call assertions and add released-owner regression
   evidence so a future mock-only test cannot restore `resume_existing:true`.
5. Replace stale A2A E2E assertions that still expect a queued coordination wake with
   the synchronous handoff and server-restart lifecycle-fact protocols already owned by
   current architecture.
6. Regenerate the bundled Expert Squad payload, run focused package/lifecycle/route
   tests, typecheck and documentation health, inspect the final diff, and commit/push
   only this repair if the pre-existing dirty worktree can be isolated safely.

## Validation plan

- `bun test packages/opencorvus/test/expert-squad/project-path-abi.test.ts`
- `bun test packages/opencorvus/test/expert-squad/frontend-replica-source-project.test.ts`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "respond_agent_coordination continue starts the next generation in the same worker session"`
- `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts -t "coordination"`
- `bun test packages/opencorvus/test/session/prompt-state-terminal.test.ts`
- `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts`
- `bun run --cwd packages/plugin typecheck`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `git diff --check`

## Implementation result

- Added the plugin-owned `ProjectRelativePathSchema` and canonical predicate as the
  package-tool ABI for project paths. Hidden `.opencorvus/.r/**` paths are legal while
  absolute, traversal, non-canonical, Windows-device, control-character, and backslash
  paths remain rejected.
- Frontend Replica now uses the project-path ABI for both the host-produced webpage
  evidence directory and its editable output project. Its exact
  `managedRuntimeDirectory/webpage-evidence` identity check remains the current-task
  authority; no arbitrary project directory became consumable.
- Mirror Watch's duplicate canonical-project-path algorithm now delegates to the same
  plugin predicate while retaining its package-specific diagnostic contract.
- `respond_agent_coordination continue_worker` now starts a fresh prompt generation in
  the same frozen worker Session. Existing-owner shell resume remains the only caller of
  `resume_existing:true`; `SessionPromptState.attach()` still rejects a missing owner.
- The task-conversation E2E no longer expects the retired coordination wake. It proves
  synchronous same-process handoff and uses the existing
  `server_restart_active_task_recovered` lifecycle fact for cross-process recovery.
- Its direct task fixture now records the required user creator provenance instead of
  inserting obsolete `metadata=null`; production terminal-lineage parsing remains
  strict rather than gaining a compatibility path for malformed tasks.
- The generated Expert Squad payload was refreshed from current authoring sources. Its
  generic Bun resolvability test now reuses the production artifact external-module
  list, including the host-resolved channel runtime bridge, rather than inventing a
  second build configuration.

## Validation evidence

- RED evidence: the new project-path ABI import failed to resolve, and the coordination
  test observed `resume_existing:true` where it required a fresh generation.
- Combined focused suites: 74 passed, 0 failed, 1,093 assertions across project-path
  ABI, real projected webpage relay, Frontend Replica, Mirror Watch, payload generation,
  and prompt-owner lifecycle.
- Coordination continuation: 1 passed, 0 failed, 32 assertions with a deliberately
  completed and released prior prompt owner.
- Task-conversation A2A E2E: 2 passed, 0 failed, 69 assertions covering synchronous
  handoff, fresh generation, visible replay, and restart lifecycle-fact recovery.
- Full task-conversation route suite: 37 passed, 0 failed, 326 assertions, including
  cancel, ask-user, redispatch, fail-task, replay, restart, and direct-cancel paths.
- Plugin and OpenCorvus TypeScript typechecks passed.
- Historical links, product-doc single source, and document health passed after the new
  record was added to the Git index as required by the tracked-record contract.
- `git diff --check` passed.
