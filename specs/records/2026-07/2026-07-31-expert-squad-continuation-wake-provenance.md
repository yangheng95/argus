# Expert Squad Continuation Wake Provenance Repair

Date: 2026-07-31
Status: Implemented
Owner: Codex

## Recall

### User request

The user supplied active Task `tsk_fb87ce048001vyB5vGvi12uiv9`, asked why
scheduling stopped after an Expert Squad switch, requested the repair and asked
that the repair avoid side effects.

### Acceptance criteria

- A successful `select_expert_squad` change remains the sole visible write to
  root `prompt_profile.active` and schedules one durable continuation wake.
- The next Orchestrator wake resolves the selected scheduler projection and sees
  an exact typed Expert Squad selection occurrence in Wake Provenance.
- The selection occurrence tells the Orchestrator to make the next natural
  scheduling decision from current Task evidence; it does not auto-dispatch,
  create a Goal, reopen a terminal Task, or become a second active-profile source.
- Diagnostic `event.note` remains non-authoritative and is never projected as
  model instructions.
- Same-profile no-op, failed-wake overlay restoration, current-turn projection
  immutability, Mission fixed-profile stage Tasks, and every other typed wake
  remain unchanged.
- Focused positive non-UI contract tests, OpenCorvus typecheck, document health,
  and diff checks pass.

### Hard constraints

- Preserve unrelated staged and unstaged work in the shared worktree; create no
  worktree and do not reset, restore, stash, broadly format, or broadly stage.
- Do not restart, refresh, terminate, or modify the running OpenCorvus/Overlay.
- Keep `prompt_profile.active` and `PromptProfileResolver` as the only selection
  and projection authorities.
- Add no host gate, workflow state, automatic dispatch, fallback, synthetic user
  message, hidden message, or untyped instruction channel.
- Add and run only non-UI positive contract tests. Do not run UI automation.
- Commit subject must start with `dsw-33987`; push only to `legacy-remote/v0.0.27beta`.

### Sources read

- Runtime SQLite rows for the supplied Task, root and Orchestrator Sessions,
  Messages, Parts, Decision Log, and Task state through immutable SQLite reads.
- Task-local `trace.jsonl` and timeline logs.
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-22-turn-projection-and-coordination-handoff-repair.md`
- `packages/opencorvus/src/orchestrator/event.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/orchestrator/agent.ts`
- `packages/opencorvus/src/engine/queue.ts`

### Whole-repository search evidence

- `OrchestratorEvent` is defined only in `orchestrator/event.ts`; its runtime
  consumers are Orchestrator processing, Task loop/Queue, and the scheduler wake
  runtime adapter.
- `select_expert_squad` is the only production caller that schedules a profile
  continuation; it currently passes the actionable transition only through
  diagnostic `event.note`.
- Typed current-ingress fields are `rootMessage`, `taskIntent`,
  `coordinationRequest`, `goalTerminalRefill`, `taskWaitActivity`, and
  `processRecovery`; `renderWakeProvenanceNotice()` projects these fields and
  intentionally ignores `note`.
- Other production `dispatchTaskLoop()` callers cover Task messages,
  retry/replan intents, Goal terminal refill, scheduled wait activity,
  coordination, and process recovery. None owns Expert Squad selection.
- Queue persistence embeds the complete `OrchestratorEvent` JSON in the durable
  `queued_operator_wake` Artifact; adding one typed optional occurrence requires
  no database migration or API compatibility path.
- Existing transition coverage proves only that the selected tool table is
  installed. It does not prove that the selection occurrence reaches the next
  runtime system prompt, which allowed the supplied Task to load Research Studio
  tools and still repeat the historical “wait for the next wake” conclusion.

### Independent agent feedback

No sub-agent was used because the user did not request delegation or parallel
agents.

## Causal diagnosis

The root overlay write, queue acceptance, continuation wake, and selected
Research Studio tool projection all succeeded. The direct stop occurred because
the next model turn returned `finish=stop` without a scheduling tool call. The
deep data-flow defect is that `select_expert_squad` encodes “selection completed;
continue scheduling” only in `event.note`, while `note` is intentionally a
diagnostic-only field and never reaches Wake Provenance. The durable Orchestrator
Session therefore retained the prior assistant conclusion that it should wait
for a later wake, but received no typed current occurrence proving that the later
wake had arrived.

## Call-site disposition

| Surface | Current consumers | Disposition |
| --- | --- | --- |
| `OrchestratorEvent` | Queue, Task loop, Orchestrator prompt composition, scheduler wake adapter, non-UI tests | Add one optional typed `expertSquadSelection` occurrence. |
| `select_expert_squad` | Fresh Task owner correction before domain execution | Dispatch the exact resolved transition occurrence alongside diagnostic `note`; retain overlay atomicity and no-op behavior. |
| `renderWakeProvenanceNotice()` | Every Orchestrator wake | Render the exact selection occurrence and identify it as current ingress; continue natural scheduling from current Task evidence. |
| queued wake persistence | Durable Queue delivery and recovery | Preserve the complete typed event under the existing internal `orchestrator_event` source kind; do not change operator-wake classification. |
| `PromptProfileResolver` / runtime contract | All projected scheduler and worker turns | Preserve unchanged; runtime evidence proves selected projection loading already works. |
| Task/Mission/UI/API | Task ownership, Mission stage ledger, Overlay and routes | Preserve unchanged; no database, route, OpenAPI, or UI work. |

## Implementation plan

1. Add the typed selection occurrence to `OrchestratorEvent`.
2. Populate it from the already resolved `select_expert_squad` transition and
   retain `note` only for logs.
3. Render it in Wake Provenance while preserving existing Queue and operator-wake semantics.
4. Add focused positive tests for the dispatch event and next-wake runtime
   system projection.
5. Update current architecture wording and indexes, run focused verification,
   review the diff, then commit through an isolated current-HEAD index and push.

## Verification commands

- `bun test packages/opencorvus/test/orchestrator/expert-squad-continuation-wake.test.ts`
- focused existing Expert Squad scheduler projection and tool tests when their
  positive test names can be selected without running unrelated negative cases
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`

## Implementation and review result

- `OrchestratorEvent` now carries one typed `expertSquadSelection` occurrence
  with the previous profile, active profile, resolved Expert Squad identity,
  and scheduler projection hash.
- `select_expert_squad` builds the diagnostic note and typed occurrence from the
  same resolved transition, writes only root `prompt_profile.active`, and queues
  the complete event through the existing durable Task wake path.
- Wake Provenance now identifies the exact successful selection occurrence and
  asks the newly projected Orchestrator to make its next natural scheduling
  decision from current Task evidence. The occurrence is not a user message,
  active-profile source, Goal, dispatch command, or workflow state.
- Second review removed a proposed Queue `source_kind` addition because it was
  not required for the causal repair. Existing internal `orchestrator_event`
  persistence, operator-wake classification, terminal Task reopening, and
  Queue behavior remain byte-for-byte unchanged.
- New positive non-UI tests passed: 2 tests and 5 assertions cover the complete
  typed occurrence and its exact next-wake provenance.
- The existing selected-profile scheduler transition test passed: 1 test and
  16 assertions prove the next wake installs the selected Expert Squad runtime
  identity and tool table.
- `bun run --cwd packages/opencorvus typecheck` passed.
- Historical links, document health, and product-doc single-source checks passed
  in an isolated current-index copy: 72 tests and 1,281 assertions. The first
  working-index run exposed only that new record files were not yet tracked;
  the isolated-index rerun proved the complete intended commit state without
  modifying the user's shared staged index.
- `git diff --check` passed. No UI test was added, modified, or run, and the
  running OpenCorvus/Overlay process was not restarted or modified.
