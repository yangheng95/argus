# Dispatch Agent Initial/Continuation Schema Repair

## Recall

### User request

The user reported that Task `tsk_fd01ed4d8001nY5KZkSxOWJHnH` was again
broken. The supplied Task Debug Info showed one Orchestrator Session remaining
`streaming`, no Goal facts, no terminal reason, and no process incident.

### Acceptance

- A projected workflow's ready initial node can be expressed unambiguously by
  the model-visible `dispatch_agent` schema and creates its first occurrence.
- A continuation still names exactly one persisted lineage authority, reuses
  the source Session and immutable adapter input, and adds only successor-Turn
  guidance and evidence.
- The fix replaces the ambiguous protocol instead of adding a router bypass,
  fallback, retry gate, or keyword repair.
- Positive non-User-Interface contract tests cover the provider-visible JSON
  Schema shape and both successful initial and continuation execution.
- Focused tests, repository typecheck, Application Programming Interface route
  checks, documentation checks, and git-cc push pass.

### Hard constraints

- `prompt_profile.active` and the selected Mirror Watch package remain the
  single squad authority.
- The binding virtual workflow remains mandatory; no node may be skipped.
- Existing user changes in the shared worktree are not overwritten or included
  in this repair.
- No User Interface automation test is created, modified, or run.
- No compatibility branch, fallback, Host workflow gate, or state machine is
  introduced.
- New commits use the `dsw-33987` subject prefix and land on
  `v0.0.31beta`, then push to `git-cc`.

### Evidence read

- Live Task `/task/:taskID`, `/board`, and `/conversation` projections.
- The complete real Orchestrator transcript for
  `ses_02fe11ad3ffeeNrbQAksxeo0MG`.
- `specs/current/architecture/03-control.md`.
- `specs/current/architecture/13-agent-communication-matrix.md`.
- `specs/current/architecture/15-agent-facts-and-turns.md`.
- `specs/records/2026-08/2026-08-04-task-lifecycle-session-closure-system-repair-plan.md`.
- Commit `4c54e42028` and its changes to
  `packages/opencorvus/src/orchestrator/dispatch-agent-tool.ts`.

### Whole-repository grep

- `rg -n "continuation_guidance|continuation_dispatch_id|coordination_action_id|continuation requires exactly one lineage authority" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-08`
- `rg -n "jsonSchema|inputSchema|tool\\.inputSchema|zodToJson|asSchema|toJSONSchema" packages/opencorvus/test packages/opencorvus/src`
- `rg -n "Task Debug Info|Agent Invocation DAG|activity.after_terminal|Goals \\(" packages specs/current specs/records/2026-08`

### Independent agent feedback

No independent Agent was requested, so none was dispatched. The live failed
Orchestrator transcript is the primary independent runtime evidence.

## Causal diagnosis

The observable symptom was an active Task with one durable streaming
Orchestrator Session. The direct trigger was not a lost terminal publication:
the Orchestrator deliberately parked the Task for twenty minutes after sixteen
failed `dispatch_agent` attempts.

Every failed call selected the continuation-shaped branch, supplied
`continuation_guidance` as `x` or `wrong`, and supplied both lineage fields as
`null`. The parser therefore correctly emitted `continuation requires exactly
one lineage authority` before any worker occurrence or Session could be
created.

Commit `4c54e42028` introduced the deeper cause. It replaced one
target-discriminated schema per projected Agent with a flat union containing
two overlapping branches per target: adapter-specific initial input and a
generic continuation envelope. The only structural distinction was the
presence of unrelated fields, so the provider-visible tool schema offered two
same-target alternatives without a discriminator. The model repeatedly chose
the smaller continuation alternative while trying to perform the explicitly
required initial Requirements dispatch. Waiting could never heal this static
schema ambiguity.

The first real streamed message-flow rerun then exposed two additional defects
from the same `4c54e42028` authority bundle, neither visible in the supplied
Task because the schema failed earlier:

1. `commitSession` reread the inserted `WorkerTurnDescriptor` and compared the
   complete JavaScript objects with `isDeepStrictEqual`. SQLite persistence and
   schema parsing normalize optional properties, so an exact descriptor with
   the same ID, Session, payload, and canonical hash was rejected before the
   Requirements message could run.
2. The runner fingerprinted the raw post-descriptor `promptArgs`, while
   `continuePersistedPrompt` first parsed those arguments through the canonical
   `PromptInput` schema. Schema defaults/normalization changed the serialized
   representation, so the already persisted exact user-message receipt was
   rejected as belonging to a different prompt.

These were not Task-terminal publication failures. They were successive
authority-admission failures on the exact path that begins after a valid
initial dispatch.

## Repair design

`dispatch_agent` will expose an explicit `turn` discriminated union inside each
target-discriminated request:

- `turn.kind = initial` contains the exact workflow subject and the exact
  target-specific adapter input;
- `turn.kind = continuation` contains exactly one lineage-authority variant,
  successor guidance, and exact evidence locators.

The outer request keeps one variant per target, restoring target discrimination.
The nested turn keeps one explicit variant per authority kind, so JSON Schema
generation never needs to infer intent from missing optional keys. Execution
unwraps the selected turn once and passes the existing canonical lineage and
adapter-input facts downstream unchanged.

Descriptor admission compares its persisted immutable identity
`id + sessionID + canonical hash`, rather than a runtime object-shape equality
that is not part of the persistence contract. The runner parses the
descriptor-bound Prompt input once, then uses that same canonical value for the
prepared input, persisted receipt fingerprint, and continued prompt. The
message, Parts, descriptor, and dispatch lineage remain in the existing single
SQLite transaction.

The Orchestrator core prompt, live projected-target inventory prompt, current
architecture, and package-owned continuation guidance all name the new exact
paths. The generated embedded package payload is regenerated from those source
packages; it is not edited as a second source.

## Verification

1. Inspect the generated provider-visible JSON Schema and positively assert the
   exact nested `initial`, `coordination`, and `continuation` authority shapes.
2. Run successful initial dispatch tests for representative and complete
   adapter projections.
3. Run successful continuation tests proving same-Session reuse, frozen source
   input, incremental guidance, and evidence.
4. Run focused Orchestrator tool and workflow-binding contracts.
5. Run package and repository typecheck plus `api:routes-check`, `docs:check`,
   and historical documentation links.
   The Prism asset-materialization contract performs a real package import and
   local Hypertext Transfer Protocol fetch; like the other full Prism closure
   contracts in that file, it has no five-second unit-test deadline.
6. Rebuild/restart the real runtime if the repository's existing packaging
   workflow permits it, then resume the reported Task and inspect its real
   visible message flow. If runtime replacement is blocked by shared local
   state, report that limit explicitly rather than calling static tests a live
   Task acceptance.
7. Review the final diff, commit with `dsw-33987`, merge current git-cc changes
   if any, and push `v0.0.31beta` to `git-cc`.
