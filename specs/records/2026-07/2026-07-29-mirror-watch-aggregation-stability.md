# Mirror Watch Aggregation Stability

## Recall

### User request

- Explain the repeated `aggregate-report` failures from the complete Mirror Watch Task using the
  real execution trace.
- Distinguish algorithm instability from infrastructure failure; do not replace model-owned Task
  completion judgment with a Host completion gate.
- Trace the claimed origin and scope of expert-survey schema version 2, compare Prism Watch and
  the SDK, and repair every exposed algorithmic weakness precisely.

### Acceptance

1. A malformed expert answer is rejected by its own producer publication, before report dispatch.
2. One validation attempt returns every independently detectable violation in deterministic order.
3. Aggregation consumes immutable typed predecessor payloads/resources, not mutable project paths
   whose bytes can drift away from selected Artifact locators.
4. A retry with the same exact inputs is idempotent: it neither fails because an identical report
   already exists nor publishes a duplicate canonical aggregation.
5. A changed input cannot reuse an older report or Artifact.
6. Prism Watch typed predecessor chains retain complete schema diagnostics and exact locator
   consumption; the generic SDK remains domain-neutral and documents/tests the package-owned ABI.
7. Real package-tool-chain tests cover invalid producer output, multiple simultaneous defects,
   immutable-input drift, exact retry, and changed-input rejection.

### Hard constraints

- The Orchestrator and model retain lifecycle judgment; no Goal-status completion gate or workflow
  state machine is introduced.
- No fallback, partial aggregation, skipped vote, normalization, alternate path, or legacy runner.
- No live OpenCorvus/Overlay restart or mutation of the runtime database.
- Preserve concurrent worktree changes; edit and commit only task-owned paths.

### Evidence read

- Runtime Task `tsk_fa967691a001blOLSh3ofJBz4L`, root Session
  `ses_056989663ffeGVcLe4inodyQxh`, and all descendant message/tool parts from the read-only runtime
  database.
- `expert-squads/tanzeqi/mirror-watch/lib/mirror-watch/{expert-survey,aggregate-report}.ts`.
- `expert-squads/tanzeqi/mirror-watch/tools/{publish-expert-survey,aggregate-report}.ts`.
- Mirror Watch producer/report prompts, manifest projection, package tests, Artifact Host ABI,
  Prism Watch typed observation publishers, and SDK authoring contract.
- Prior records `2026-07-29-mirror-watch-typed-expert-publication.md` and
  `2026-07-29-watch-artifact-and-terminal-protocol-convergence.md`.

### Full-repository call-point inventory

| Surface | Current role | Required correction |
|---|---|---|
| `mirror-watch-research-lead` | generic `artifact_publish` of research files | replace with package-owned typed publication |
| `mirror-watch-expert-surveyor` | typed immutable expert publisher | retain; make domain diagnostics exhaustive |
| `mirror-watch-persona-surveyor` | generic `artifact_publish` of vote files | replace with package-owned typed publication |
| `mirror-watch-report-analyst` | invokes aggregate package tool | reduce input to exact locators plus report path; exact retry only |
| `publish-expert-survey.ts` | validates immutable resources | return all domain/resource violations together |
| `aggregate-report.ts` tool | reads selected Engine Artifacts but also mutable paths | consume research/persona/expert bytes only through typed Artifacts |
| `aggregate-report.ts` library | fail-fast parsing and `wx` report write | separate validation/compute from idempotent materialization |
| Plugin Artifact Host | exact read/select/publish | add opt-in atomic semantic idempotency for trusted package publishers; no workflow policy |
| Prism Watch publishers | typed brief → plan → research chain | use the same atomic retry primitive and exhaustive independent-source reads; no Mirror-specific schema |
| SDK authoring | domain-neutral package ABI guidance | document immutable payloads, pre-side-effect validation, and atomic exact-publication retries, not domain inference |

## Proven causal chain

The first report worker called the aggregate tool with valid paths and received only
`expert_vote_paths[1].reason must contain exactly one ### Pick 1 heading`. After one expert repair,
the next call exposed the same defect in the other expert. The worker then probed with a missing
path and duplicate path before being cancelled. A second report worker reproduced the first-expert
heading failure. Only after both expert Markdown files were repaired did a third report worker
succeed.

This is not a model-completion defect and not an infrastructure outage. The direct trigger was an
exact-heading producer/consumer mismatch. The deeper instability was:

- validation occurred for the first time in the terminal consumer;
- fail-fast errors exposed one defect at a time;
- selected expert Artifact locators named pre-repair snapshots while the old aggregator reread
  mutable repaired paths;
- the report was written with exclusive-create before downstream publication, so a failure after
  that write was not safely replayable;
- canonical publication had no atomic exact-input replay primitive.

A package-local “search, then publish” repair would still have a time-of-check/time-of-use race:
two concurrent retries could both observe no result and publish duplicates. Therefore immutable
typed inputs and domain validation remain algorithm responsibilities, while exact-publication
atomicity belongs to the Artifact Host infrastructure. This split does not alter lifecycle
judgment or route model decisions.

Commit `6b15b261a0130345de4c765b129d4da7fbd8f008` introduced the typed
`mirror-watch/expert-survey` package codec `{ vote, resource_roles }`, but its schema-version-2
claim had no authoritative Mirror Watch protocol basis. The typed payload remains the sole V1
contract; it is not a Prism or SDK global schema and has no V2 alias.

## Implementation plan

1. Add package-owned typed research-delivery and persona-cohort codecs/publishers.
2. Make all producer validators collect stable issue arrays and publish only on zero issues.
3. Make aggregation resolve exactly one authority, research delivery, persona cohort, and two
   expert surveys from immutable selected Engine Artifacts; consume their structured payloads,
   prove cross-Artifact source lineage, and remove mutable survey/vote path arguments.
4. Split validation/compute from report materialization. Accept an existing report only when its
   bytes equal the newly computed digest.
5. Extend the trusted package publication ABI with opt-in `idempotent: true`. Derive a canonical
   semantic identity from Task, stable owner, type, schema, label, payload, resource content
   identities, and exact sources; insert-or-reuse it inside one database transaction. Ignore
   retry-specific Session/tool-call identities and snapshot IDs while verifying semantic equality.
6. Update prompts, manifest projections, generated payload, package tests, Prism/SDK contract
   tests, and documentation indexes.
7. Run focused package tests, SDK tests, typecheck, generated-payload checks, documentation health,
   and a final diff review before commit/push.
