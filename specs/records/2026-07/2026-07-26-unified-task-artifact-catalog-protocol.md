# Unified Task Artifact Catalog And Exact-Read Protocol

Status: In progress
Date: 2026-07-26
Owner: Codex

## Recall

### User request

The user requires a systemic refactor of Artifact discovery and consumption in
long-horizon orchestration:

- every Task Agent must be able to discover and read durable Artifacts itself;
- correctness must not depend on Host-composed semantic handoff bodies;
- the protocol must work for every current Expert Squad and future Squad
  packages without repeated prompt or Core-projector tuning;
- Artifact search must have an explicit answer for relevance, time ordering,
  misses, exact reads, binary resources, and the possibility of an Artifact
  becoming undiscoverable;
- Artifact discovery must expose an explicit hierarchy across exact identity,
  current versus historical versions, stable names/labels, deterministic text
  matches, and bounded fuzzy relevance. Fuzzy discovery may return candidates
  but must never silently select or substitute an exact evidence locator;
- missing optional domain fields are valid defaults, not failures;
- wrong evidence, missing exact evidence, corrupt bytes, wrong paths, silent
  truncation, and stuck execution are errors that must remain visible;
- all Expert Squad implementations, `PromptProfileResolver`, package-tool ABI,
  Squad authoring SDK, portable template, documentation, and tests must be
  calibrated together;
- no fallback, compatibility path, scheduling gate, retry state machine,
  retry cap, or Host-side automatic Goal completion may be introduced;
- the historical benchmark wrapper is retired; validation must publish ten
  real end-to-end Missions for the authoritative E01--E10 cases in
  `specs/artifacts/长程编排测试.md` on isolated port 7879 and inspect every
  Mission-created Task against the real database, per the user's latest
  explicit entry-point and port overrides;
- an independent Agent must review the technical route and final implementation
  repeatedly until no known issue remains;
- the completed work must be committed with the `dsw-33987` prefix and pushed
  to `myhexin`.

The user also asked why Artifacts are not stored on disk. The verified answer is
that they already are persisted in two forms:

1. structured Task facts in SQLite table `engine_artifact`;
2. immutable file trees and binary resources in the filesystem-backed
   `TaskArtifactStore`.

The failure is not absence of persistence. It is the absence of one complete
Task-scoped discovery and exact-read protocol over both authoritative stores.

### Acceptance criteria

1. `artifact_search` without a text query can enumerate every registered
   Task-scoped inter-Agent evidence Artifact through stable pagination.
2. `artifact_read` reads one exact locator and returns the canonical stored
   bytes with explicit completeness, byte offsets, total bytes, and SHA-256
   digest.
3. Exact file-resource reads validate Task ownership, manifest identity, path,
   byte count, media type, and SHA-256 before and after the read.
4. JSON payloads are never silently truncated, summarized, parked in a hidden
   temporary file, or replaced by a Host-generated semantic rendering.
5. Binary data is never copied into SQLite or embedded as base64 in prompts.
6. Search derives Task authority from the current persisted Session lineage;
   the model cannot request another Task's catalog.
7. Search has an explicit stable order and cursor. Concurrent insertions after
   a first page do not create duplicates or omissions inside that page series.
8. Exact missing IDs, cross-Task references, invalid locators, wrong paths,
   digest mismatches, corrupt manifests, and invalid UTF-8 text are explicit
   errors. Empty query results and absent optional filters are valid results.
9. A zero-finding PASS Integrity Artifact is exactly readable by Orchestrator,
   Build, Integrity, delegated workers, and package Agents.
10. Goal-scoped Integrity sees only the Requirement IDs in that Goal's
    acceptance contract; Task-scoped Integrity sees the Task RequirementSet.
11. Process-recovery evidence retains exact affected Session and Goal
    attribution. A Task-level recovery cannot be presented as evidence that an
    unrelated Goal worker failed.
12. A cancelled dispatch exposes any real child Session and already-persisted
    partial facts without fabricating a verdict.
13. Current and future Expert Squad schedulers and workers receive the catalog
    tools even when `inherit_base_tools` is `false`; packages cannot remove or
    shadow them.
14. A package tool can publish a namespaced JSON Artifact through the shared
    Host ABI without adding a new Core `EngineArtifactKind`.
15. A package tool can publish a filesystem snapshot whose canonical manifest
    contains sufficient provenance for catalog filtering without a second DB
    pointer row.
16. Existing typed output tools may continue to validate and persist their
    domain schemas, but consumer-specific prompt-body projectors no longer own
    Artifact transport.
17. Every distributed Expert Squad, the portable template, the JS authoring
    SDK, product SDK documentation, and generated built-in payload agree on the
    same protocol.
18. Targeted unit, integration, contract, docs, typecheck, and independent
    review pass.
19. Ten real end-to-end Missions are published through the real Mission entry
    point on port 7879, one for each authoritative E01--E10 business case in
    `specs/artifacts/长程编排测试.md`. Their Mission-created Tasks run against
    the real database and reach truthful terminal outcomes without
    Artifact-driven restart loops. A directly created Task, self-referential
    protocol probe, missing-locator probe, invalid-path probe, or digest
    mismatch probe may be used for infrastructure diagnosis but does not count
    toward the ten.
20. Every catalog locator that can be selected as cross-Task evidence is
    importable by the same Mission import service. The imported Artifact and
    every referenced resource are target-owned and remain readable if the
    source Task runtime tree is unavailable.
21. Resource-bearing Engine Artifacts use one envelope whose resource
    membership is expressed as verified `TaskArtifactRef` values. Domain
    payloads do not use runtime paths, namespaced string refs, or domain-specific
    ID readers as an inter-Agent transport.
22. A Task Artifact snapshot or resource can be imported directly. Mission
    does not need a package-specific Engine pointer row or copied handoff body.
23. Search exposes current and historical Engine Artifact versions explicitly,
    preserves each immutable digest, and makes version status/revision part of
    the returned candidate rather than inferring "new" or "old" from a label.
24. Search supports stable label/name discovery and deterministic bounded fuzzy
    candidate discovery. Every returned candidate declares its match tier and
    score inputs; exact locator reads remain the only evidence-consumption
    operation, and zero or ambiguous fuzzy matches remain visible observations.
25. A pending Goal attempt whose exact child Session is terminal and whose
    exact Build Host observation is persisted appears in the next database-
    backed Orchestrator context as a named Terminal Goal Refill with Goal,
    attempt, Session, final-message, and Host-observation locator identities.
    This projection is evidence only: it does not auto-complete, retry, or fail
    the Goal.

### Hard constraints

- The shared dirty worktree is authoritative. No reset, restore, stash,
  cleanup, or new worktree is allowed.
- Concurrent changes in Expert Squad packages, generated payload,
  `dispatch-adapter-input.ts`, graceful shutdown, Orchestrator prompt, Overlay,
  benchmark retirement, tests, and documentation must be preserved.
- The running OpenCorvus, Overlay, and sidecar processes must not be changed
  except for the user-authorized isolated port-7879 E2E service. Unrelated
  processes and ports must not be changed.
- No database migration or compatibility reader is added. This unpublished
  project adopts the new schema directly and test databases are rebuilt from
  the current schema.
- Artifact absence does not become a Host scheduling gate. Tools expose facts
  and explicit read errors; the Orchestrator still decides naturally.
- Search never auto-broadens, auto-selects a replacement Artifact, dispatches,
  retries, or completes a Goal.
- Dispatch retains natural work intent and exact work scope only. Same-Task
  Artifact locators and bodies are selected by the consumer through its own
  catalog tools and never cross the scheduler-to-worker adapter boundary.
- A selected locator cannot be silently replaced by a search result.
- Existing domain validation remains domain-owned. Catalog transport does not
  become a universal domain report or acceptance aggregate.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/15-agent-facts-and-turns.md`
- `specs/records/2026-07/2026-07-24-expert-squad-fact-turn-sdk-calibration.md`
- `packages/opencorvus/src/engine/engine.sql.ts`
- `packages/opencorvus/src/engine/artifact.ts`
- `packages/opencorvus/src/engine/store.ts`
- `packages/opencorvus/src/task-artifact/store.ts`
- `packages/plugin/src/task-artifact.ts`
- `packages/plugin/src/tool.ts`
- `packages/opencorvus/src/tool/task-tool-execution-scope.ts`
- `packages/opencorvus/src/tool/global-tools.ts`
- `packages/opencorvus/src/tool/tool-id-catalog.ts`
- `packages/opencorvus/src/agent/tool-pool-data.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- the consumer projections, prompts, package tools, Squad manifests, SDK
  authoring files, portable template, tests, and docs listed below.

SQLite FTS5 was also checked against the upstream SQLite documentation. FTS5
external-content tables require the application to keep a second index in sync,
and inconsistent content/index state produces unreliable results. The
`unicode61` tokenizer does not provide general Chinese substring behavior;
`trigram` supports substring matching but queries shorter than three Unicode
characters do not match. BM25 is ranking, not a completeness mechanism.

### Full-repository grep result and disposition

The required pre-design repository-wide search was performed for
`EngineArtifactTable`, `recordEngineArtifact`, `updateEngineArtifact`,
`TaskArtifactStore`, `TaskArtifactRef`, `artifact_id`, `artifact_ids`,
`domain_artifact_refs`, `handoff`, `publish_interactive_artifact`,
`builtInToolIDs`, `inherit_base_tools`, and SDK `consumes`/`produces`.

#### Authoritative persistence and lifecycle

| Call-point family                       | Files                                                                                                                                                                                                                                                                                                                                                | Disposition                                                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Engine schema and write/read API        | `engine/engine.sql.ts`, `engine/artifact.ts`, `engine/store.ts`, `engine/index.ts`                                                                                                                                                                                                                                                                   | preserve SQLite as the structured-fact source; add generic package-output kind and direct catalog provider                              |
| Engine fact producers                   | `engine/{agent-coordination,completion-decision,dispatch-lineage,persist,queue}.ts`, `fact-check/persist.ts`, `frontend-design/{artifact,design-resource-manifest}.ts`, `visual-qa/persist.ts`, `verification/goal-observation.ts`, `acceptance/visual-feedback-verification.ts`, `browser-preview/persist.ts`, `orchestrator/{build-tool,tools}.ts` | preserve domain persistence; remove mutable-fact assumptions where exact-reference stability requires it                                |
| Filesystem snapshot source              | `task-artifact/store.ts`, `plugin/src/task-artifact.ts`, `plugin/src/tool.ts`, `tool/plugin-tool-host.ts`                                                                                                                                                                                                                                            | keep file bytes and manifest as their only source; add provenance and live catalog enumeration/read                                     |
| Filesystem snapshot producers/consumers | frontend-replica `prepare-source-context.ts`, `artifact-set.ts`, `source-project-generator.ts`; Prism `prepare-visual-reference.ts`; `browser-preview/{region-comparison,scroll-slice-comparison}.ts`                                                                                                                                                | publish/read through the shared manifest protocol; keep verified materialization, remove semantic handoff ownership                     |
| Attachment-backed evidence              | `storage/attachment-store.ts`, `engine_task.attachments`, `engine_task.system_artifacts`, Browser Preview evidence payloads                                                                                                                                                                                                                          | remain exact resource locators or Task inputs; no binary database copy                                                                  |
| Interactive Artifacts                   | `interactive-artifact/**`, `publish_interactive_artifact`                                                                                                                                                                                                                                                                                            | remain visible message-owned UI output, not an inter-Agent evidence authority; a durable evidence Artifact may reference one explicitly |

#### Consumer-specific Artifact transport

| Family                       | Files                                                                                                                                                                                                                                                                                          | Disposition                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| generic input projectors     | `requirements/input-projection.ts`, `architect/input-projection.ts`, `goal-workload-analyst/input-projection.ts`, `intent-analysis/input-projection.ts`, `frontend-design/input-projection.ts`, `fact-check/fact-projection.ts`, `integrity/fact-projection.ts`, `delegated-worker/context.ts` | retain Task/Goal intent and schema validation; remove semantic body transport                                                     |
| research/design renderers    | `research/prompt-section.ts`, `frontend-design/{handoff,prompt-section}.ts`, `visual-qa/context.ts`, `prompt/upstream-context.ts`                                                                                                                                                              | replace prompt-body composition with exact locators; keep domain output construction and binary attachment staging                |
| Integrity renderers          | `integrity/{root-history,build-feedback,render-markdown,team-agent,review-artifact}.ts`                                                                                                                                                                                                        | remove Artifact transport special cases; preserve review schema and Goal-vs-Task scope semantics                                  |
| Build/Orchestrator renderers | `build/{agent,prompt-context}.ts`, `orchestrator/{build-tool,build-feedback,visual-qa-stage,read-context-tool,tools}.ts`                                                                                                                                                                       | retain work scope/reason/selected locators; remove copied semantic bodies and oldest-first bounded-history dependency             |
| adapter contract             | `agent/dispatch-adapter-input.ts` and adapter callers                                                                                                                                                                                                                                          | converge repeated raw IDs on the canonical locator schema when the concurrent edit is available; do not overwrite concurrent work |
| package handoff prompts      | all seven repository Squad manifests plus listed `README.md`, `selector.md`, Agent `system.md`, and Prism/Frontend Replica coordination Skills                                                                                                                                                 | teach discover/read protocol once; keep workflow dependencies and Mission cross-Task stage boundaries                             |

#### Capability, SDK, template, and documentation

| Family              | Files                                                                                                                                                                                                             | Disposition                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Core tool inventory | `tool/{global-tools,tool-id-catalog,registry}.ts`, `agent/{tool-pool-data,tool-pool-contract,runtime-template-registry}.ts`, `session/{runtime-contract,runtime-contract-validation}.ts`, `orchestrator/tools.ts` | make search/read mandatory platform transport capabilities for every Task scheduler and worker           |
| active projection   | `expert-squad/{prompt-profile-resolver,registry,protocol-schema}.ts`                                                                                                                                              | include platform tools in projection hash, reject package shadowing, preserve inactive-package isolation |
| package-tool ABI    | `packages/plugin/src/{tool,task-artifact}.ts`                                                                                                                                                                     | add one Core-owned Artifact Host contract; do not copy TaskArtifact schemas into the JS authoring SDK    |
| JS authoring SDK    | `packages/sdk/js/src/expert-squad-authoring.ts` and its collaboration/calibration tests                                                                                                                           | keep `consumes`/`produces` as evidence topology; state that bodies are discovered/read from the catalog  |
| portable template   | `specs/artifacts/portable-expert-squad-template/**`                                                                                                                                                               | teach future packages the same publish/search/read contract and no-handoff-body rule                     |
| product docs        | English/Chinese `packages/web/src/content/docs/reference/sdk.mdx`                                                                                                                                                 | document the shared protocol and error/default boundary                                                  |
| generated built-ins | `packages/opencorvus/generated/expert-squad-payload.ts`                                                                                                                                                           | regenerate from package sources; never hand-edit                                                         |

### Independent-agent feedback

Three independent read-only audits were requested.

The E2E audit found:

- the newest exact Integrity Artifact was unreadable, while oldest-first bounded
  history consumed the projection budget;
- PASS with zero findings was silently dropped from Build feedback;
- Goal-level Integrity projected the full Task RequirementSet;
- Task-level process recovery lost Session-to-Goal attribution;
- cancelled dispatch lost an already-created Session and partial evidence;
- verification commands modified tracked evidence;
- Orchestrator context overflow occurred after workers had already completed.

The protocol audit concluded that current transport is not composition-complete
and required:

- universal Task-scoped search and exact read;
- canonical producer/scope/payload/resource metadata;
- namespaced package types without one Core kind per package output;
- stable pagination and explicit exact-read errors;
- no semantic ranking, latest-selection fallback, auto-completion, or workflow
  state machine;
- TaskArtifact binary resources to remain in the filesystem store;
- package tools to receive a shared Artifact Host ABI.

The Squad/SDK audit initially suggested writing a DB pointer when a filesystem
snapshot publishes, then challenged and rejected that route: SQLite plus
filesystem cannot provide an atomic two-store commit. A DB pointer would create
the precise orphan/unfindable failure this refactor must remove. The accepted
route is a live catalog with two mutually exclusive providers, each reading its
own canonical store.

The final MVCC (Multi-Version Concurrency Control) and consumer audit found
additional counterexamples after the first green focused suite:

- current/history rows did not yet prove same-Task and same-kind partition
  authority or that current was the greatest revision;
- exact resolution selected `artifact_id + digest` globally before checking
  Task ownership, allowing a corrupt foreign partition to shadow a valid row;
- paged Engine reads still selected, hashed, and parsed the complete JSON
  payload before slicing one transport page;
- Integrity collapsed two selected historical diffs that touched the same
  file, Workload collapsed ContractGraphs by bare ID, Research evidence refs
  dropped the Artifact digest, and Visual Feedback resolved an inner Browser
  Preview reference by current bare ID;
- Integrity review locator validation and review insertion were separated by
  independent transactions.

The accepted corrections are database partition constraints plus transfer
preflight validation, Task-constrained exact resolution, aligned bounded block
reads, full locator identity in every consumer projection, and one
caller-owned transaction for review validation and persistence. These are
transport/data-integrity rules, not scheduler gates.

The live E01 G1 reconciliation audit then proved:

- G1 had exactly one attempt with `retry_count=0`; the child Session, expert
  output, Build Host observation, and terminal wake were all persisted;
- the same attempt eventually completed, so neither Artifact loss nor Goal
  retry was the cause;
- `orchestrator-core.txt` promises a named Terminal Goal Refill, but
  `engine/describe.ts` projected only generic catalog and prompt-owner prose;
- each model turn already rebuilds Task Context from the database, so the
  missing exact refill projection—not wake loss—allowed the model to run an
  independent Goal for roughly fourteen minutes before reconciling G1.

The accepted correction is a read-only Terminal Goal Refill derived from the
latest unresolved attempt, exact child Session, durable terminal lifecycle
event, and exact Build Host observation. It exposes only identities and the
Host-observation locator; Artifact bodies remain behind `artifact_read`. It
does not introduce a Host outcome, retry rule, gate, or state machine.

The producer/search audit found a second systemic P1:

- every non-`expert_output` typed domain Artifact currently receives the Core
  producer `engine-artifact/<kind>`, even when a projected worker produced it;
- the public exact producer filters therefore cannot find RequirementSet,
  ContractGraph, Workload, Research, Frontend Design, Visual QA, Integrity, or
  Fact Check outputs by their real Agent, Squad, or Session;
- producer identity must be derived from the persisted completed assistant
  turn, dispatch lineage, and Worker Turn Descriptor, never from model-authored
  payload fields or a process-local dispatch object;
- Host materializers and operator/API mutations must remain honestly Core-
  owned rather than being attributed to a worker that did not produce them;
- updates must preserve immutable producer authority instead of re-deriving it
  from payload and silently reverting it to Core.

The same audit confirmed that historical and fuzzy search must remain a
discovery layer. Exact Engine evidence is still only
`{artifact_id, catalog_revision, expected_sha256}`
followed by `artifact_read`; even a unique fuzzy top result is not an evidence
binding.

### Codex review feedback: composition-completeness correction

The first catalog implementation made discovery complete but did not yet make
resource transport composition-complete. Independent review found four
connected defects:

1. catalog metadata exposed `resources` only for `expert_output`; other
   resource-bearing Engine kinds were indexed as resource-free;
2. Browser Preview persisted `manifest_path` and `artifact_paths` strings and
   depended on domain-specific ID-plus-path readers;
3. cross-Task import copied resources only when the source kind was
   `expert_output`;
4. `CrossTaskArtifactImportSchema` excluded the Task Artifact provider, even
   though package tools publish direct snapshots that downstream Mission Tasks
   must consume.

The corrected protocol is:

- the catalog remains a live union of the Engine and filesystem stores; neither
  store gets a shadow pointer row merely for discovery;
- every resource-bearing Engine fact is stored in the shared
  `EngineArtifactEnvelope`, with semantic payload separated from an ordered
  list of exact `TaskArtifactRef` resources;
- payloads may describe stable semantic resource roles, but may not contain
  runtime filesystem paths or duplicate resource bytes;
- exact reads continue to use the closed `ArtifactReadLocator` union;
- Mission import accepts an exact locator from either catalog provider;
- importing an Engine envelope copies its resources and publishes a
  target-owned envelope with immutable source lineage;
- importing a direct Task Artifact snapshot or resource copies its verified
  bytes into one target-owned `engine_resource` snapshot and publishes one
  target Engine envelope describing that imported snapshot/resource;
- `panel.query_task` exposes status only, while
  `panel.query_task_artifacts` pages the terminal source Task's complete
  catalog locators to Mission. Neither reproduces Artifact bodies or invents
  package-specific handoff fields;
- domain readers may validate domain payload schemas after a generic exact
  read, but may not bypass the generic locator/digest/resource read protocol.

### Real smoke evidence and provider-schema correction

The preflight direct-Task smoke on port 7879 reached a truthful terminal
success against the isolated SQLite database. It does not count toward the ten
Mission E2E cases. Its first `dispatch_agent` call nevertheless exposed a
systemic provider-schema defect before the model corrected itself:

- the canonical local schema required `instruction: string` for the selected
  `research-studio-writer` target;
- the provider-bound schema flattened the target-discriminated union into one
  root object and kept the first branch definition for every repeated field;
- because `instruction` belonged to a later branch, its first definition was
  the neutral cross-target placeholder `null | []`;
- the model therefore emitted `instruction: []`, exactly as the provider
  schema permitted, and local validation rejected it;
- the successful second call followed the visible validation error and is not
  evidence that the first-call contract is stable.

Independent repository inspection and Claude CLI analysis both confirmed this
is a deterministic product-contract defect, not an LLM flake. The first
projected branch owned every provider-visible field because the Host added
cross-target placeholders, and strict GPT schemas then made every polluted
field mandatory. Reordering agents would only move the corruption to a
different target.

The accepted replacement is:

- `dispatch_agent` remains one tool and its provider root remains an object;
- that root owns exactly one `dispatch` property containing the complete
  target-discriminated union;
- each nested target variant exposes only its real adapter fields and preserves
  its own requiredness, enum, bound, description, and local Zod validation;
- the neutral `null | []` cross-target placeholder map and silent accepted-field
  filtering are deleted rather than retained as compatibility;
- the provider transform never recursively flattens that nested union;
- root unions used by other tools are still projected as root objects, but
  repeated property schemas are joined by their value domains instead of
  first-branch wins;
- OpenAI-strict and Gemini tests prove the nested union survives, the writer
  variant requires `instruction: string`, foreign non-null fields fail, and
  target ordering cannot change provider-visible semantics.

This preserves the canonical target-discriminated validator without adding an
automatic retry, fallback, gate, target-name lookup, second dispatch tool, or
prompt-only workaround. Before the ten Missions are fired, the same schema
must also pass a real first-call dispatch smoke on port 7879.

This is a direct replacement, not a compatibility reader. Existing
`browser_preview_evidence:*`, `artifact:<id>`, raw manifest paths, and
consumer-spliced resource mappings are removed from model-facing contracts.

Mandatory regression evidence:

- generic search -> exact Engine read -> exact binary resource read for a real
  Browser Preview screenshot;
- exact import of an Engine envelope, a Task Artifact snapshot, and a single
  Task Artifact resource;
- target reads return identical digests after the source Task runtime tree is
  unavailable;
- catalog `resource_count` and media-type facets match the envelope;
- Visual QA cannot accept a formatted-but-missing, foreign-Task, stale-digest,
  wrong-kind, wrong-operation, or resource-free evidence locator;
- no domain-specific ID/path reader is invoked by the cross-Agent or
  cross-Task transport path.

Claude CLI independently reproduced the same first-branch-wins causal chain and
classified the retry as a visible error-driven recovery that masked the broken
wire contract. Claude proposed a canonical flat superset as one repair. The
independent Agent challenged that proposal because a flat superset still loses
target-specific requiredness. Static provider proofs show that both the current
Hexin OpenAI-strict route and Gemini projection retain a nested
`dispatch.anyOf` object union, so the exact nested contract is selected over
the weaker flat approximation.

### Mission Task-creation schema correction

The first Mission smoke was a self-referential protocol probe. It proved the
Mission-to-Task route and corrected `dispatch_agent` ABI can execute, but it
did not implement E01 and therefore contributes zero cases to the formal
E01--E10 result.

Real database inspection across the diagnostic Mission batch exposed a second
systemic first-call contract defect before the E01 smoke:

- nine Mission sessions attempted `panel.create_task` with workflow names,
  sequences, booleans, or other planning metadata inside `checks.named` or
  `checks.custom`;
- local `CheckConfig` validation rejected those calls because named values are
  command configurations and custom values are nested records;
- AI SDK `asSchema` conversion was reproduced locally converting both dynamic
  record value schemas to `additionalProperties: false`, so the model could
  not see the local validator's value contract;
- `checks.custom` has no checker consumer and only copied itself through
  `resolvedChecks`;
- a separate retry attempted to write `metadata.mission`, even though Mission
  provenance is exclusively Host-owned and stamped by `panel.create_task`.

The accepted ownership repair is:

- delete the unconsumed `checks.custom` field rather than preserve a second
  metadata channel;
- retain the canonical Host check configuration for HTTP/UI callers and Task
  storage;
- project a Mission-specific `create_task.checks` schema containing only
  explicit executable Host checks and no dynamic named map;
- remove Host-owned `metadata` and `source` from the Mission tool schema;
- describe workflow selection as Task request intent and keep it out of checks;
- keep strict local validation and visible failures for malformed check
  configurations; do not add normalization, retry, fallback, or a scheduling
  gate;
- add provider-bound tests that inspect the exact model-visible Mission schema
  and a real E01 Mission test that requires the first `create_task` call to
  succeed without a validation retry.

### GoalGraph independent implementation review

The first immutable-Goal implementation passed fourteen focused tests, but the
independent read-only review found that those tests did not exercise the real
reader graph and one test actively preserved the historical dual source. The
implementation is therefore not accepted yet.

Repository-wide call-point inspection covered
`appendGoalFact`, `appendGoalRevision`, `retractGoal`,
`resolveTaskGoalProjection`, `listGoalsForContractGraphArtifact`,
`goalContractGraphArtifactLocator`, `readPersistedArchitectFidelity`, every
`contract_graph_artifact_id` reader, and every `architect_fidelity` reader.

The confirmed issues and mandatory dispositions are:

| Severity | Confirmed issue                                                                                                                                                                | Required single-source disposition                                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | `resolveTaskGoalProjection` concatenates ContractGraph membership with `operator_instruction_goal`, while add/modify/retract create graph-external active facts                | delete the operator Goal scan and GoalRetraction projection path; every add/modify/remove operation must atomically append one explicit `goal_graph_projection` whose producer says `operator_command`                                    |
| P0       | unchanged dependent Goal rows retain birth-graph dependency revision IDs; only one scheduler reader rewrites them, while Architect and Build read raw rows and the birth graph | introduce one `CurrentGoalMembershipContext` resolver that owns authoritative membership order, effective current dependency revisions, current exact graph locator, and immutable birth provenance; every execution consumer must use it |
| P1       | fidelity is written to mutable Task metadata after Goal identity is chosen, but Build treats it as an execution contract                                                       | persist normalized fidelity inside the immutable GoalGraph artifact, include each Goal's fidelity slice in its revision signature, and delete Task-metadata fidelity transport                                                            |
| P1       | a stale specialist turn cannot become current, but the raw `projection:null` writer also rejects it and the adapter mislabels it as infrastructure failure                     | projected writes retain compare-and-swap integrity; a completed stale/missing-prior specialist turn is preserved as a non-current raw graph fact with a structured conflict finding and returns terminal success                          |
| P1       | unknown removal IDs are silently filtered before the complete-partition check                                                                                                  | removals must be unique, current, disjoint from returned Goals, and exactly cover omitted prior members; every typo or historical ID is an explicit evidence error                                                                        |
| P2       | lineage traversal can cycle or stop on a missing ancestor; `supersede_of` has no persisted integrity proof                                                                     | reject cycles, missing ancestors, and cross-Task ancestors on insert and read; the unpublished database schema is rebuilt rather than tolerated                                                                                           |
| P2       | `persistArchitectGoalGraph` accepts a general DB handle although graph-and-Goal persistence must be atomic                                                                     | accept only a transaction-owned handle or own the transaction; add rollback evidence after graph insertion and before Goal insertion                                                                                                      |
| P2       | payload schema permits duplicate/overlapping membership and removals                                                                                                           | enforce uniqueness and disjointness at schema parse time as well as persistence time                                                                                                                                                      |

The review rejected putting an operator producer directly into
`architect_contract_graph`: a producer tag would not change the fact that an
operator writer was copying or rewriting an Architect-owned domain fact.
Therefore domain topology and executable membership are separate first-class
facts:

- `architect_contract_graph` is written only by a completed Architect turn and
  contains graph, validation findings, fidelity, exact RequirementSet locator,
  and exact prior Architect graph locator;
- `goal_graph_projection` is the only executable-membership fact and contains a
  discriminated producer, exact prior projection locator, exact current
  Architect graph locator or null, ordered Goal revision IDs, and structured
  removals;
- an operator command writes only `goal_graph_projection` and immutable Goal
  rows; it references the existing Architect graph without copying or claiming
  ownership of it;
- a non-current specialist candidate is stored as a projection-null
  `goal_graph_projection` with its observed-current locator and conflict
  finding. It does not consume or replace the current tip.

Current projection is not selected by wall-clock order. Among
`goal_graph_projection` Artifacts with non-null projection, every exact
`prior_projection_artifact_locator` forms one immutable edge. The only
unreferenced successful projection is current. Zero tips means no Goal
projection; more than one tip is an explicit data conflict. A null candidate
never consumes a tip.

`CurrentGoalMembershipContext` is the only current execution view:

```ts
interface CurrentGoalMembershipContext {
  taskID: string
  contractGraphArtifactLocator?: EngineArtifactLocator
  requirementSetArtifactLocator?: EngineArtifactLocator
  producer?: GoalGraphProducer
  fidelity: ArchitectFidelityState
  goals: CurrentGoalContext[]
  historicalGoals: GoalRow[]
}

interface CurrentGoalContext {
  goal: GoalRow
  membershipIndex: number
  effectiveDependsOn: string[]
  birthContractGraphArtifactLocator?: EngineArtifactLocator
}
```

The row remains immutable. `effectiveDependsOn` is projected by logical
lineage against the exact membership in the current GoalGraph; no reader may
substitute `engine_goal.depends_on` as a current dependency after a predecessor
revision. The current graph locator comes from membership, never from an
unchanged Goal's birth binding.

The production consumers that must converge on this resolver are scheduler
description, Task API and workbench current-Goal surfaces, Architect prior
input, Build target/context and sibling lookup, delegated-worker context,
workload analysis, Integrity fact projection, build contract audit, and Goal
diagnostics. Goal row birth bindings remain available only for historical
provenance and exact replay of the graph that created that revision.

### 2026-07-26 implementation checkpoint

The user explicitly authorized deletion of the old database. The prior
permission restriction has since been removed, but the real acceptance service
already uses a fresh current-schema SQLite database beneath an isolated
`OPENCORVUS_HOME` on port 7879. The unrelated global runtime database is not
part of this isolated acceptance run and no deletion of it is claimed.

Independent checkpoint review found that the old populated database has 934
Artifact rows but none of the derived catalog columns. Current code now refuses
schema refresh before rotating files when a populated stale
`engine_artifact` or `engine_goal` would require invented hashes. This is an
explicit reset requirement, not a compatibility migration.

The proposed SQLite SHA-256 user-defined-function trigger was rejected after
runtime verification. Bun 1.3.13 exposes no SQLite UDF API, SQLite was not
compiled with `sha3`, and a native extension would create a new cross-platform
binary dependency. The accepted integrity design is:

1. every Engine Artifact payload is validated as a finite canonical JSON value;
2. the Host serializes it exactly once and binds that same text to SQLite while
   deriving byte count, full SHA-256, fixed 64 KiB block SHA-256 values, one
   digest of that ordered block index, and bounded catalog metadata;
3. SQLite triggers independently require TEXT, valid JSON, exact byte count,
   canonical digest/block-index shape, complete block coverage, and atomic
   payload/index/catalog-identity changes;
4. MySQL transfer recomputes and compares every derived Artifact field before
   rebuilding SQLite;
5. catalog enumeration selects only bounded same-row metadata and verifies a
   digest covering every field that can affect entry projection, search,
   filtering, or ordering; it never selects the raw payload or complete block
   array;
6. an exact-read page selects only its aligned payload window and at most three
   covered block hashes with SQLite `json_extract`, verifies those blocks, and
   returns the locator's immutable full SHA-256; the shared SDK assembler
   recomputes that full SHA-256 before releasing the complete bytes;
7. no cross-call verified cache is used, because DB reset/replacement would
   invalidate its proof;
8. UTF-8 pagination uses BLOB byte offsets, rejects continuation-byte starts,
   and backs off a truncated trailing code point without emitting a
   non-advancing page;
9. database open requires UTF-8 encoding and schema health compares critical
   trigger SQL as well as table columns.

This removes the earlier payload-size amplification without claiming that a
catalog page is total O(1): mixed-provider totals and facets still scan the
Task's bounded index rows. The supported database protocol prevents payload,
block index, and catalog identity from being updated separately. If an
attacker first removes those triggers and then performs a coordinated
payload-plus-block-hash rewrite, an isolated page has no Merkle proof; the
complete assembler still rejects it against the locator's full SHA-256. A
Merkle store was deliberately not introduced because it would add another
persistence protocol for an out-of-contract trigger-removal attack. Large
binary or multi-file evidence belongs in `TaskArtifactStore`; oversized legacy
JSON diff rows are a producer-format problem, not permission to skip digest
verification.

Additional implemented boundaries:

- both worker `artifact_search` and Mission `query_task_artifacts` project the
  same strict transport page, omit caller-owned filters and aggregate facets,
  and adapt the page limit until the complete in-band JSON is at most 40 KiB;
  transport truncation is always false for a returned page, while
  `metadata_truncated` remains the separate semantic signal for bounded catalog
  metadata;
- `query_task` is now a bounded status-only surface. It no longer aggregates a
  Task's Agent graph or Artifact catalog into one tool result; Mission traverses
  Artifact membership through cursor pages;
- Task Artifact publication uses an append-only, fsynced sequence reservation
  ledger. Visible failure cleanup can delete any unreferenced resource
  snapshot without sequence reuse, and bootstrap reconciliation removes
  crash-orphan resources while preserving valid referenced evidence;
- non-text Task Artifact resources return one complete verified media
  attachment; invalid partial PNG/PDF fragments are no longer emitted;
- package-tool `engineArtifacts.read` preserves the attachment bytes instead of
  dropping them;
- producer IDs, Artifact IDs/types, queries, filters, cursors, facet values,
  error strings, entries, and resource arrays have one exported bounded ABI;
- Goal RequirementSet and ContractGraph bindings now freeze both Artifact ID
  and SHA-256, with SQLite same-Task/kind/digest constraints; Build and
  Integrity use those frozen locators rather than generating a fresh digest
  from a mutable raw ID;
- selected-locator Host validation resolves the same exact locator again for
  domain validation, eliminating the verified-locator-then-raw-ID substitution
  path;
- Task Artifact publication flushes every regular file and manifest before the
  atomic rename, then flushes directory metadata on POSIX platforms;
- the old Build/Integrity semantic body renderer modules and Artifact scopes in
  `read_context` are deleted; domain validation remains, but transport is
  `artifact_search` / `artifact_read` / `artifact_select`;
- every repository Expert Squad README/selector, the portable template, JS
  authoring SDK, and English/Chinese SDK reference declare the same platform
  transport and default-versus-error boundary.

## Diagnosis

### Observable failure

A long-running Goal repeatedly dispatched Build and Integrity workers even
after valid PASS reviews and no-diff validation. Workers explicitly said that
the exact selected Artifact body was unavailable. The Orchestrator then tried
to compensate by asking another worker to summarize history, which produced
more Artifacts that downstream workers still could not read.

### Direct trigger

Artifact identities were persisted, but each consumer had a different,
incomplete way to obtain bodies:

- Orchestrator could list a bounded Integrity history but not exact-read an
  arbitrary Artifact;
- Build silently received no body for a valid zero-finding PASS;
- delegated workers received full JSON copied into prompts;
- frontend packages propagated filesystem refs through tool results and
  package-specific handoff text;
- binary evidence had verified stores but no universal catalog path.

### Root design cause

The system conflated three responsibilities:

1. domain output validation and persistence;
2. evidence selection for one dispatch;
3. transport of evidence bytes to the consumer.

Domain modules correctly own the first responsibility. The Orchestrator
correctly owns natural selection and dispatch intent. But transport was
reimplemented in every consumer projector, making completeness depend on every
producer/consumer pair knowing each other.

### Why prompt tuning cannot repair it

The model cannot read bytes for which no tool exists. Rephrasing "consume this
Artifact" only creates repeated failed attempts, summaries, and larger context.
The repair must expose the existing durable facts through one protocol while
leaving domain interpretation and scheduling judgment to the model.

## Architecture decision

### 1. Artifact Catalog is a live union, not a third store

`ArtifactCatalog` has two providers:

1. `EngineArtifactCatalogProvider`
   - enumerates the current Task's `engine_artifact` rows directly;
   - exact read returns the row's stored JSON bytes and metadata;
   - uses SQLite `rowid` only as an internal stable membership watermark, not as
     public Artifact identity.
2. `TaskArtifactCatalogProvider`
   - enumerates the current Task's committed snapshot directories;
   - validates every canonical manifest through `TaskArtifactStore`;
   - exact read returns the manifest or one verified resource;
   - never writes a duplicate DB pointer.

The provider discriminator is routing, not fallback. A locator belongs to
exactly one provider. Failure in that provider is exposed and is never retried
against the other.

The catalog has no persisted table, shadow index, FTS table, search daemon, or
background synchronization. It is deterministically rebuildable from the two
sources on every call.

### 2. Canonical locators

The public locator is a discriminated value, not a display prefix that later
must be stripped:

```ts
type ArtifactLocator = { source: "engine"; artifact_id: string } | { source: "task_snapshot"; snapshot_id: string }
```

Resource reads add the exact manifest member:

```ts
type ArtifactResourceLocator = {
  source: "task_snapshot"
  snapshot_id: string
  tree: string
  path: string
  media_type: string
  bytes: number
  sha256: string
}
```

Existing raw Engine Artifact IDs remain the database identity stored in foreign
keys. Prompt/API tool input carries the typed locator directly; it does not
invent `artifact:` display strings or aliases.

### 3. Engine catalog envelope

Engine rows project:

- source and exact locator;
- Task ID;
- optional Goal Attempt ID;
- Core kind;
- stable label;
- created time;
- updated time during the operational-state retirement window;
- raw payload byte count and SHA-256;
- optional namespaced domain type and schema version;
- producer lineage when stored by the generic package Host ABI;
- immutable resource locators present in the payload.

Existing Core kinds stay readable without forced domain migration. One generic
Core kind, `expert_output`, carries future package-defined values:

```ts
{
  artifact_type: "<expert-squad-id>/<domain-name>",
  schema_version: 1,
  producer: {
    owner_kind,
    expert_squad_id,
    agent_id,
    projection_hash,
    session_id,
    message_id,
    tool_call_id
  },
  payload: <canonical JSON value>,
  resources: <exact TaskArtifact refs, if any>
}
```

Adding a new package `artifact_type` never changes the Core enum or creates a
Core renderer. The Host validates only the transport envelope and same-Task
resource refs. Domain schema remains package-owned.

### 4. Filesystem snapshot manifest

The direct-cutover manifest adds:

- canonical publication sequence for stable Task-local enumeration;
- created time;
- optional Goal Attempt ID;
- producer owner kind, Squad, Agent, projection hash, Session, message, and tool
  call;
- existing exact file inventory, media types, sizes, and SHA-256 digests.

`TaskToolExecutionScope` projects `goalAttemptID?: string` from the already
persisted `SessionRuntimeContractIdentity` and cross-checks it with the
`WorkerTurnDescriptor` for workers.

The publication sequence is allocated under the TaskArtifact store's
Task-local publication lock from an append-only disk reservation ledger. A
reservation is flushed before its snapshot manifest can commit and is never
deleted or reused. Failed publications and deleted unreferenced
`engine_resource` snapshots therefore leave legal sequence gaps; a later
snapshot always receives a larger sequence, so an older catalog cursor cannot
admit a replacement member. The manifest and snapshot directory are still one
filesystem commit. The lock is a data-integrity critical section, not a Task
lease or scheduling gate.

Resource publication and its parent Engine Artifact row cross SQLite and the
filesystem, so they cannot be one atomic transaction. The single protocol is:

1. reserve a monotonic sequence and commit the target-owned resource snapshot;
2. commit the Engine Artifact envelope that references its exact snapshot
   identity;
3. on a visible writer failure, remove that resource snapshot while retaining
   its sequence reservation;
4. during project bootstrap, remove every `engine_resource` snapshot that has
   no exact target-owned Engine envelope reference, and hard-fail on corrupt,
   stale, foreign-Task, or missing referenced evidence.

Catalog snapshots are never garbage-collected by this recovery. Sequence gaps
are valid catalog history, not corruption; duplicate, unreserved, or malformed
sequence facts are corruption.

No v1 compatibility reader remains. The unpublished direct schema uses the new
manifest contract, tests rebuild fixtures, and stale invalid manifests are
reported explicitly rather than silently omitted.

### 5. Search

`artifact_search` derives Task ID from the current persisted tool execution
scope and accepts optional structured filters:

- source;
- exact Core kind or namespaced artifact type;
- exact stable label;
- exact Goal subject;
- Goal Attempt ID;
- producer Squad, Agent, or Session;
- resource media type;
- created-time range;
- version scope: current, historical, or all;
- discovery query;
- explicit newest, oldest, name, or relevance order;
- page size and opaque cursor.

Search behavior:

1. With no discovery query, every catalog entry within the structured filters
   and version scope is enumerable. This is the completeness path.
2. Engine history is evaluated at the first page's frozen catalog revision:
   - `current` returns the greatest revision of each Artifact at that point;
   - `historical` returns every smaller revision;
   - `all` returns both;
   - immutable Task Artifact snapshots are always `immutable`, never
     reclassified as historical.
3. Every entry declares `version_state` and its Engine catalog revision or
   Task Artifact publication sequence. Historical Engine versions retain their
   own exact `{artifact_id, catalog_revision, expected_sha256}` locator.
4. Exact labels are a structured filter. A discovery query is matched only
   against bounded controlled directory fields: identity and digest, label,
   kind/type, producer Agent/Squad/Session, Goal subjects, resource path/media
   type, and typed-writer names/tags. Search never scans hidden payload prose or
   binary bodies.
5. A query explicitly chooses `substring` or `fuzzy` mode. Both modes classify
   higher-confidence matches before lower tiers. `fuzzy` alone may add bounded
   fuzzy candidates. Match tiers are `exact_identity`, `exact_label`,
   `exact_metadata_value`, `label_prefix`, `label_substring`,
   `metadata_substring`, `fuzzy_label`, or `fuzzy_metadata`. Fuzzy scoring uses
   the already-adopted mature `fuzzysort` library and one Search-ABI threshold;
   no second persisted full-text index is created.
6. Fuzzy matching is candidate discovery only. It never silently broadens a
   structured filter, substitutes a selected locator, or persists a top result
   as evidence.
7. With no query, explicit order is `newest`, `oldest`, or `name`. Query
   relevance order sorts by match tier and fuzzy score, then newest update/
   creation time, source, Artifact ID, digest, and revision. Every tuple is
   deterministic; callers may still explicitly request the non-relevance
   orders.
8. The first page captures provider membership watermarks:
   - maximum global Engine catalog revision;
   - maximum Task-local snapshot publication sequence.
9. Later pages re-enumerate only entries at or below those watermarks, apply
   the cursor's filter digest, sort, and continue after the prior tuple.
10. The cursor is opaque, versioned, and bound to authority, normalized
    filters, version scope, query, order, frozen membership, and ranking tuple.
    Changing any input starts a new page series; old cursor versions fail
    explicitly rather than entering a compatibility reader.
11. Concurrent entries published after the watermarks are excluded until a new
    search, so they cannot duplicate or displace prior-page results.

No persisted FTS5, BM25, or embedding store is added. Fuzzy relevance is a
deterministic ephemeral ordering over the frozen authoritative catalog, not a
correctness mechanism or second source. If future measurements require an
acceleration cache, it must be discardable and fully rebuildable and cannot
change membership, match tiers, locators, or exact-read behavior.

### 6. Search misses

An empty page is a valid result and returns:

- `catalog_total`;
- `filtered_total`;
- applied normalized filters;
- available sources, kinds/types, producer IDs, media types, and time range,
  bounded as metadata rather than semantic summaries;
- resolution status: `no_match`, `unique_candidate`,
  `ambiguous_candidates`, or `incomplete_catalog`;
- unmatched exact filter values and limitations caused by provider errors or
  truncated searchable metadata;
- explicit statement that no-query pagination is the completeness path.

The tool does not automatically retry with fewer filters. The Agent chooses
whether to remove a text query, relax a structured filter, enumerate the Task,
or exact-read a selected locator.

Provider error or relevant metadata truncation prevents a `no_match` or
`unique_candidate` claim, but two observed candidates remain unambiguously
`ambiguous_candidates` even when another provider is unavailable. Resolution
uses the frozen full filtered count, never the current page length. Unmatched
filter diagnostics distinguish a value absent from the base catalog from an
empty intersection among individually valid filters. Multiple candidates
require another structured filter or exact inspection. A single fuzzy
candidate still requires exact read and an explicit model-visible selection
before it can become evidence.

`version_scope="historical"` returns only historical Engine rows; immutable
Task Artifacts appear in `current` and `all`. Only `version_scope="all"`, no
query, complete pagination, and `catalog_complete=true` prove that the full
live Task catalog has been enumerated.

This separates:

- **search miss**: no current entry matches the supplied filters; valid result;
- **missing Artifact**: exact selected locator does not exist in its canonical
  provider; explicit error;
- **wrong Artifact**: locator exists but its Task/scope/type/evidence does not
  satisfy the consumer's domain need; visible evidence for Agent judgment;
- **corrupt Artifact**: manifest, path, size, digest, JSON bytes, or UTF-8 is
  invalid; explicit error.

No registered Artifact is theoretically undiscoverable because a no-query
search paginates the complete live catalog. Text search can miss typos, aliases,
or concepts not present in stable metadata; that is why it is never the
existence test.

### 7. Exact read

`artifact_read` accepts one typed exact locator plus `byte_offset` and
`max_bytes`.

For Engine payloads it:

- selects the exact same-Task row;
- reads `CAST(payload AS TEXT)` rather than reserializing parsed JSON;
- returns a UTF-8-boundary-aligned chunk;
- returns `byte_start`, `byte_end`, `next_offset`, `total_bytes`,
  `complete`, and the full-payload SHA-256;
- returns raw bytes even when an optional domain schema parser rejects the
  payload, while exposing the schema diagnostic separately.

For Task snapshots it:

- returns the canonical manifest bytes through the same chunk contract; or
- reads one exact resource member through `TaskArtifactStore` verification.

Text resources use byte chunks. Binary resources return one real attachment
with exact media type and digest metadata. Binary bytes are not rendered as
text, copied into the DB, or embedded in the prompt.

The result sets the existing no-park/no-silent-truncation tool metadata so the
generic tool-output budget cannot replace it with a hidden file.

### 8. Prompt and dispatch boundary

Every Task Agent receives a short shared protocol fragment:

- search is optional when exact locators are supplied;
- exact selected locators must be read before claiming evidence is absent;
- a selected locator cannot be silently substituted;
- no-query enumeration is the completeness path;
- optional missing domain fields are not transport failures;
- exact missing/cross-Task/corrupt/path/digest failures must be reported;
- Artifact tools do not decide acceptance or lifecycle.

Dispatch retains:

- Task or Goal work scope;
- natural reason and requested work;
- exact selected Artifact locators;
- explicit attachments/input refs where the consumer contract needs them.

It removes:

- copied Artifact JSON/Markdown bodies;
- consumer-specific "latest" selection;
- PASS-dropping special cases;
- generated summary Artifacts used only to compensate for unreadable evidence.

Typed binary materialization remains because it moves real bytes, not semantic
interpretation.

### 9. Mandatory projection

`artifact_search`, `artifact_read`, and `artifact_select` are reserved Core
Task discovery/provenance tools:

- all platform runtime templates receive them;
- all active Expert Squad schedulers and workers receive them;
- `inherit_base_tools: false` cannot remove them;
- a package cannot declare or shadow their IDs;
- they are included in capability projection hashes;
- inactive package resources remain invisible;
- Orchestrator gets the same implementation through
  `createOrchestratorTools`, not a divergent wrapper.

The common prompt fragment is composed through the shared resolved Agent prompt
path rather than duplicated in seven Squad packages. Package prompts are
calibrated only where they currently contradict self-discovery or require
consumer-composed handoff bodies.

### 10. Package Host ABI and Squad SDK

Package tools receive:

```ts
host.engineArtifacts.publish({
  artifact_type,
  schema_version,
  label,
  payload,
  resources?
})
```

Package consumers use the same explicit protocol through
`engineArtifacts.search`, `engineArtifacts.read`, and
`engineArtifacts.select`; a source passed to `publish` must have been completely
read and then selected earlier in that same ToolHost invocation (or in earlier
persisted tool facts from the same physical Turn).

Task, producer, Goal Attempt, timestamps, projection hash, and Core
`expert_output` kind come from the trusted persisted execution scope, not
caller input.

The package Host also exposes typed `search`, `read`, and `select` only when a package tool
must programmatically consume durable evidence. These operations call the same
catalog service and cannot accept a caller-supplied Task ID.

The JS Expert Squad authoring SDK keeps collaboration `consumes` and `produces`
as semantic evidence topology. It does not copy the plugin runtime ABI or
generate per-consumer renderers. Documentation states that declared outputs are
published through a typed domain tool and discovered/read through the shared
catalog.

### 11. Goal scope, recovery, abort, and verification repairs

The catalog repair alone does not resolve every proven retry cause:

1. Goal-level Integrity projections filter RequirementSet rows by the current
   Goal acceptance Requirement IDs.
2. Task-level Integrity retains the full RequirementSet.
3. Recovery projections expose exact affected Session IDs and their resolved
   Goal/Goal Attempt ownership.
4. Cancelled dispatch returns the real created child Session, terminal error,
   and registered partial facts without fabricating completion.
5. Verification artifacts are written to isolated runtime output unless a
   final integration/publish task explicitly owns the tracked report.
6. Oversized semantic history composition is retired in favor of catalog
   locators and exact read.

These are evidence-flow repairs, not retry gates or automatic acceptance.

## Implementation sequence

### Phase A — protocol types and live providers

- add shared locator, envelope, query, page, read-chunk, resource, producer, and
  error schemas;
- implement direct Engine provider;
- extend TaskArtifact manifest and execution provenance;
- implement verified filesystem provider;
- implement stable live union and cursor watermarks;
- add focused provider/search/read tests.

### Phase B — universal Agent tools and package Host

- add reserved `artifact_search`, `artifact_read`, and `artifact_select`;
- project them into all scheduler/worker runtime templates and active Squad
  capability hashes;
- add Orchestrator AI SDK wrappers over the same service;
- add package `engineArtifacts` Host ABI;
- verify `inherit_base_tools: false`, package shadow rejection, inactive
  isolation, and cross-Task rejection.

### Phase C — consumer transport retirement and causal repairs

- replace copied body handoffs with work scope, reason, and exact locators;
- retain domain parsers and output validation;
- retain binary materialization only through exact resource refs;
- repair Goal-scoped Requirement projection;
- repair recovery attribution and cancelled-dispatch result visibility;
- isolate non-deterministic verification output;
- remove the oldest-first Integrity-history workaround and PASS-dropping
  special case.

### Phase D — Expert Squads and SDK calibration

- calibrate general, Frontend Innovate, Frontend Replica, Research Studio,
  Review & Debug, Prism, Mirror Watch, MirrorTest, and the portable template;
- update JS authoring SDK tests and English/Chinese documentation;
- regenerate built-in Expert Squad payload from source;
- preserve and reconcile concurrent package/generated changes.

### Phase E — verification and real E2E

- run focused catalog, TaskArtifact, tool registry, runtime projection, Prompt
  Profile, Orchestrator, Integrity, Build, package, SDK, and docs tests;
- run typecheck, route/API/docs checks required by hooks;
- request independent implementation review, repair all findings, and repeat;
- start only the user-authorized isolated backend on port 7879;
- publish ten real database E2E Missions without the retired benchmark wrapper;
- inspect terminal Mission/Task/Goal/Session/Artifact facts and delivered
  resources;
- distinguish valid defaults from missing/corrupt/wrong/stuck evidence;
- repeat independent review until no known issue remains;
- commit task-owned files and push through normal hooks to `myhexin`.

## Test matrix

### Catalog and exact read

- complete no-query enumeration across Engine and filesystem providers;
- deterministic newest-first order;
- provider watermarks and cursor filter binding;
- concurrent insert during pagination without duplicate/omission;
- empty query result with diagnostics;
- exact missing, malformed, and foreign Task locator errors;
- long multibyte JSON chunk reassembly byte-for-byte;
- payload SHA-256 stability;
- optional domain schema failure with raw bytes still readable;
- no generic tool-result parking/truncation.

### Filesystem resources

- provenance and Goal Attempt in canonical manifest;
- complete file inventory and media filters;
- text chunk read;
- binary attachment read;
- wrong tree/path/media/bytes/digest errors;
- mutated manifest/file errors before and after read;
- publication/read/delete cleanup;
- no DB pointer row and no catalog orphan.

### Projection and SDK

- general scheduler and workers receive both tools;
- MirrorTest `inherit_base_tools: false` scheduler and workers receive both tools;
- portable/future `inherit_base_tools: false` package receives both tools;
- package shadow attempt fails catalog validation;
- inactive package resources do not leak;
- projection hash includes mandatory tools;
- package namespaced output publishes and reads without a new Core kind;
- collaboration `consumes`/`produces` remains semantic topology only.

### Consumer and causal regressions

- PASS/zero-finding Integrity Artifact exact-read by every consumer;
- Goal Integrity contains only its Requirement IDs;
- Task Integrity contains the whole RequirementSet;
- selected locator body is not copied into worker prompt;
- delegated worker no longer receives a full JSON dump;
- binary staging still materializes verified bytes;
- recovery for other Goals is labeled unrelated;
- cancelled dispatch exposes child Session and partial evidence;
- verification-only run produces no tracked-project diff;
- search/read has no Goal completion, retry, dispatch, or mutation side effect.

### Real end-to-end

- ten distinct real Tasks in the real DB;
- at least two different Expert Squads;
- Engine JSON and filesystem snapshot production;
- downstream Agent discovers without a semantic body handoff;
- exact selected Artifact consumption;
- Chinese and English metadata search;
- empty-query recovery by explicit broader enumeration;
- missing, corrupt, wrong-path, and binary cases are visible and correctly
  classified;
- completed Tasks have real terminal Goal results, Sessions, Artifact lineage,
  delivered files, and no Artifact-driven restart loop.

## Review checkpoints

The independent reviewers must explicitly answer:

1. Can any registered inter-Agent evidence Artifact remain unenumerable?
2. Can any exact locator be silently substituted, truncated, or summarized?
3. Can a new package Artifact type require a Core projector or enum addition?
4. Can a package remove or shadow the transport tools?
5. Is there any DB/FS dual-write visibility authority?
6. Does any consumer still own a semantic Artifact transport body?
7. Can query ranking or ordering hide existence?
8. Are optional defaults still separated from missing/corrupt/wrong evidence?
9. Can Goal/Task scope or recovery attribution leak?
10. Do real E2E facts prove completion without benchmark/mocked evidence?

Implementation remains incomplete until every answer is supported by passing
tests and real database evidence.

## 2026-07-26 independent review correction — remove the transport legacy

### Recall

- The operator explicitly rejected compatibility work and asked to drop the
  historical transport burden rather than merely make existing tests green.
- The reviewed failure family is broader than Task-local payload copying:
  cross-Task Mission handoff, dispatch outcomes, coordination/mailbox evidence,
  workflow-node evidence ownership, and Task expert-squad lifetime all still
  contain prose or naked-ID transports.
- `prompt_profile.active` in the root Session overlay remains the sole active
  expert-squad identity. A second `engine_task.expert_squad_id`,
  `selected_workflow`, step-status table, Host workflow gate, automatic
  advancement, compatibility parser, or fallback lookup is forbidden.
- Optional/default fields remain valid. Only missing selected evidence,
  corrupt bytes/digest/schema, foreign authority, invalid/escaping paths,
  failed persistence/tool execution, and stuck execution are failures.
- Independent review confirmed that Mirror Watch and Research Studio locator
  prompts are already updated, while Prism, Mission handoff, SubAgentProtocol,
  coordination/mailbox refs, SDK prose, portable generation, and several tests
  still expose the retired protocols.
- Repository-wide searches covered `artifact_ids`,
  `requirement_set_artifact_id`, `domain_artifact_refs`,
  `renderFactReferences`, `evidence_refs`, `promptProfile`,
  `select_expert_squad`, `virtual_workflows`, `query_task`,
  `panel.create_task`, `JSON.stringify(locator)`, TaskArtifact collection
  schemas, and every dispatch adapter registration/executor surface.

### The atomic replacement

The following are deleted as model-to-model transport ABIs:

1. `artifact:<id>` and naked Artifact IDs outside database-internal relational
   columns;
2. `domain_artifact_refs` and line-oriented `SubAgentProtocol` output;
3. consumer-specific Artifact inventory, handoff body, Markdown context packet,
   or copied payload;
4. arbitrary string `evidence_refs` for Artifact/Session/Goal/File facts;
5. Mission `create_task.request` packets that copy predecessor evidence;
6. prompt keywords that describe an ABI without executing it through the
   current schema.

No compatibility parser accepts these forms after the cutover. Historical tests
that assert them are deleted or rewritten against the new typed protocol.

### Cross-Task evidence through one composition-complete immutable import

Task authority remains closed by default. A receiving Task can read predecessor
evidence only through an immutable import created with the receiving Task:

- the sole public request is `{source_task_id, locator}` where `locator` is the
  shared `ArtifactReadLocator`: exact `engine_artifact`,
  `task_artifact_snapshot`, or `task_artifact_resource`. Naked IDs,
  foreign-Task reads, directory-copy guesses, grants, package-specific pointer
  rows, and late-running-Task imports do not exist;
- the sole caller is a real Mission `panel.create_task.artifact_imports`
  execution in the same project and Mission lineage as the source Task;
- `panel.query_task` enumerates the complete stable source Task catalog rather
  than one provider subset. Mission selects one returned exact locator; it
  does not reconstruct a locator, body, path, or resource inventory;
- before the target Task is published, exact read validates source Task
  authority, terminal source status, locator identity, payload or manifest
  digest, resource path/media/size/digest, and complete catalog metadata. A
  selected missing, stale, corrupt, deleted, foreign-project, or unauthorized
  source is a visible pre-publication error;
- every selected source becomes one target-owned Engine Artifact. An Engine
  envelope preserves its source Artifact type, schema version, and payload.
  A plain Engine Artifact, direct Task Artifact snapshot, or direct Task
  Artifact resource is wrapped in the corresponding imported Artifact type
  without inventing a package-specific handoff schema;
- every referenced file resource is verified and copied into target-owned
  immutable `engine_resource` snapshots. The target envelope contains only the
  copied `TaskArtifactRef` values. Missing or corrupt resources fail the whole
  import rather than degrading to payload-only evidence;
- the target envelope records immutable `import_lineage` containing the exact
  `source_task_id`, complete source `ArtifactReadLocator`, source kind, and
  source producer. There is no package-specific import receipt type,
  source-payload string, resource-mapping payload, or second import ledger;
- the target Task row and imported Engine Artifacts commit through the same
  Task-creation transaction after target resources are published. Failed
  creation removes its prepared target resources, and crash recovery removes
  unreferenced `engine_resource` snapshots;
- successful import never reads the source again. Deleting or archiving the
  source cannot break exact reads of the target envelope or copied resources;
- request idempotency compares the normalized exact import set. The same
  request ID with a different source Task or locator is an explicit conflict;
- importing does not complete a Task, choose a workflow or squad, advance a
  node, auto-select evidence, or decide which imported Artifact a target Agent
  should consume.

`panel.create_task` returns the exact source-to-imported Engine locator mapping.
The receiving scheduler or worker enumerates its own catalog, selects the
target-owned Artifact by `import_lineage`, and exact-reads that returned locator.
The Mission chooses immutable source facts but never reconstructs payloads in
request text and never receives a foreign-read capability.

### One DispatchOutcome and one EvidenceLocator

Every adapter returns one schema-validated JSON outcome. The outcome kind is
one of:

- `started`, for a real asynchronous execution handle;
- `terminal_success`, with a concrete child Session and visible final message;
- `coordination`, with a typed coordination request locator;
- `partial`, when the worker Turn exists but required output persistence did
  not complete;
- `infrastructure_failure`, with exact failed-operation evidence.

Ordinary same-Task dispatch outcomes do **not** transport domain Artifact
locators. A completed Turn proves only the Session/message outcome. Consumers
discover required or optional domain facts from the Task Catalog by immutable
producer, Artifact type, Goal attempt, workflow, and node lineage. Explicit
locators remain valid only for user/scheduler pinning and the cross-Task import
request above.

The serialized JSON is the model-visible tool result and is derived once from
the validated object. Tool metadata is observability only and is not a second
semantic channel. Goal, completion, coordination, mailbox, Mission query,
dispatch, and recovery use the same discriminated EvidenceLocator family.

The adapter contract is the single registry for input schema, Session kind,
private tools, execution/worktree mode, completion mode, and executor factory.
Provider-neutral `null`/empty placeholders remain absence, not errors; non-empty
fields owned by another target remain schema errors.

### Workflow evidence facts without a workflow engine

The manifest declares immutable node evidence contracts:

- `consumes` Artifact/evidence types;
- `produces` Artifact/evidence types;
- Goal applicability expressed by existing Goal contract fields;
- dependencies and dispatch scope.

Every visible `dispatch_agent` call names the selected manifest workflow and
node. Dispatch lineage and produced Artifact provenance record those declared
identities so a later scheduler can reconstruct which real call produced which
evidence, including when one Agent identity owns multiple nodes.

There is no persisted active workflow, node status, auto-advance, omission gate,
or state machine. The Orchestrator still makes every scheduling decision.
Recorded tool calls, terminal outcomes, Artifact provenance, and exact reads are
execution facts rather than a second workflow authority.

### Fixed expert-squad lifetime from the existing single source

The root Session `prompt_profile.active` remains the only selected identity.
The fix removes mutation paths that can silently reinterpret an executing Task:

- ordinary Task messages no longer accept a profile change;
- package uninstall/update cannot rewrite active historical root Sessions;
- the only correction surface remains the visible initial
  `select_expert_squad` decision before domain execution;
- the root binding includes the resolved package/projection digest in the same
  canonical prompt-profile configuration so later wakes cannot silently mix
  package epochs.

This does not add a Task-row mirror or a Host routing gate.

### Data integrity closure

The independent review identified three persistence defects that must be fixed
before higher-level protocol work can be trusted:

- `Database.rebuildSqlite` imports while SQLite foreign-key enforcement is
  disabled. It must execute `PRAGMA foreign_key_check` inside the rebuild
  transaction and reject every violation before `COMMIT`.
- Catalog enumeration verifies one bounded identity over the exact Engine row
  fields used for entry projection, search, filtering, and ordering without
  loading the raw payload or full block index. Any mismatch makes the Engine
  provider incomplete with a visible error. Exact pages verify covered payload
  blocks, and complete SDK reads additionally verify the locator's full
  SHA-256, so corrupted derived fields or bytes cannot silently become complete
  evidence.
- Architect replanning must never update an existing Goal row, replace its
  RequirementSet digest, or clear/rebind its ContractGraph. The old
  `insertArchitectGoals` → `persistArchitectContractGraph` →
  `bindGoalsToContractGraph` write sequence is deleted and replaced by one
  transaction-owned `persistArchitectGoalGraph`.
- Each projected ContractGraph Artifact explicitly stores the exact
  RequirementSet locator, exact prior ContractGraph locator, ordered
  `goal_revision_ids`, and structured `{goal_id, reason}` removals. A
  conflicting raw graph uses `projection: null`; a valid graph with no Goals
  uses a non-null projection with `goal_revision_ids: []`. Current projection
  never infers membership from Goal bindings or time alone.
- A Goal ID is an immutable contract revision and execution identity. An
  unchanged contract reuses the exact existing ID, preserving attempts,
  workspace facts, status, and evidence. A modified contract receives a new ID
  with `supersede_of`; a new logical Goal receives a new ID; a removed Goal is
  omitted from the new membership without deleting history.
- Unchanged comparison includes the exact RequirementSet locator, all Goal
  contract fields, logical dependency lineages, acceptance contract
  references, and the Goal's normalized ContractGraph slice. An upstream
  revision ID changing by itself does not cascade revisions to unchanged
  dependents.
- The transaction verifies the exact prior graph is still the current
  projected tip, validates a complete returned/removed partition, preallocates
  only new or changed IDs, maps Graph/finding/fidelity references, writes the
  Graph Artifact, inserts new revisions already bound to its exact digest, and
  performs a final membership consistency check before commit. Events are
  emitted only after commit. SQLite rejects every in-place `engine_goal`
  update.

### Additional closure requirements from review

- Cursor production must be closed under its own schema for worst-case encoded
  provider errors and IDs.
- Every TaskArtifact path, identifier, tree, file, artifact, and publication
  collection has shared finite limits with boundary tests.
- SDK calibration rejects private inventory, handoff payloads, naked IDs, and
  retired ABI names in every repository package and portable template.
- Non-image/PDF binary reads must provide a real consumer-readable byte path;
  `attachment: true` without readable bytes is not success.
- Integrity cannot parse selected Artifact bodies into a second semantic
  prompt/tool projection; workers use exact catalog reads.
- Pending coordination and mailbox prompt projections expose total/truncation
  and preserve attention-required evidence rather than silently hiding it.

## 2026-07-27 theoretical-closure correction

### Recall

- The operator requires a squad-independent Artifact protocol: a newly
  installed expert squad may define its domain schema and semantics, but must
  not require Core handoff concatenation, catalog projection code, retry
  keywords, or package-specific indexing glue.
- Defaults and omitted optional domain fields are legal. The canonical
  transport omits object properties whose JavaScript value is `undefined`;
  root/array `undefined`, sparse arrays, accessors, symbols, functions,
  non-finite numbers, cycles, and custom prototypes are representation errors.
- A real provider schema review found that a model-facing recursive JSON record
  is converted to `additionalProperties: false` by strict OpenAI/Hexin schema
  normalization. The model-facing publish ABI therefore accepts one strict
  `payload_json` string and parses it once at the Host boundary. Plugin callers
  retain the typed structured publisher and reach the same canonical
  publication function.
- Repository-wide caller searches covered `EngineArtifactTable.payload`,
  `payload_sha256`, `expected_sha256`, `updateEngineArtifact`,
  `updateEngineArtifactsWhere`, `updateEngineArtifactWhereReturning`,
  `artifact_search`, `artifact_read`, `artifact_select`, cross-Task import, evidence validation,
  Goal bindings, coordination, wake queues, and generated SDK/OpenAPI surfaces.
- Independent Claude review identified four protocol counterexamples:
  non-envelope Core rows lacked type/producer/search metadata; import lineage
  was not a catalog filter; deterministic research contract failures were
  reported as retryable partial outcomes; and stable cursor membership did not
  detect deletion or in-place update.

### Closed generic catalog projection

Every valid expert-domain publication is an `EngineArtifactEnvelope` and keeps
its declared namespaced type, producer, resource set, and optional immutable
import lineage. Every non-envelope Core row receives the mechanically derived
type `opencorvus/core/<kind>` and one Core producer projection derived from the
same persisted kind. This is one generic rule, not a whitelist of known kinds.
An invalid `expert_output` remains an explicit transport diagnostic and is
never relabelled as a valid Core artifact.

Consequently adding a new `EngineArtifactKind` or expert-squad Artifact type
does not require a catalog projector. Resource-bearing evidence still uses the
envelope because only it can bind exact immutable resource locators.

### Search and lineage completeness

`import_lineage.source_task_id` is projected into the same-row catalog index,
covered by the catalog metadata digest, returned on each catalog entry, and
filterable through `import_source_task_ids`. A receiving Agent can therefore
select one of multiple same-type imports without reading every payload or
depending on a handoff message. Cross-Task enumeration and import use the same
Mission/project lineage authority predicate; catalog discovery never grants a
general foreign-Task read capability.

Cursor membership freezes both insertion upper bounds and a deterministic
identity digest/count for each active provider. A later deletion, update of a
previously frozen identity whose historical version is missing, provider-total
drift, or missing provider becomes a visible provider error and
`catalog_complete=false`; totals remain the frozen first-page totals. A normal
update is reconstructed from the exact prior version at or below the cursor's
revision upper bound. New rows above the insertion upper bounds remain outside
the cursor and appear only in a new search.

### Locator semantics

An `engine_artifact` locator is content-addressed. Immutable published evidence
remains readable for its lifetime. A canonical mutable Engine row update moves
the complete `OLD` row into `engine_artifact_version` through the database's
`AFTER UPDATE` trigger in the same SQLite transaction and allocates a strictly
greater globally unique catalog revision. The application writer never owns a
second manual archive step. Exact
`artifact_id + catalog_revision + expected_sha256` reads resolve either current or history inside
the caller's Task authority; they never substitute current bytes. Frozen
search cursors reconstruct the greatest version not newer than their revision
upper bound, including label-only updates whose payload digest is unchanged.

The current/history partition enforces one immutable Task, kind, Goal-attempt
attribution, and creation time for an Artifact identity. Runtime history
insertion must be strictly older than current, every revision may occur in
exactly one current/history row across all Artifacts, and direct history update
or deletion is rejected while its Task and current Artifact remain live.
Task/Artifact deletion remains the only cascading lifecycle cleanup. MySQL
transfer rejects globally reused revisions, cross-authority history,
history-at-or-after-current, missing-current partitions, and derived metadata
drift before rebuilding SQLite.

Every durable-resource retention scan is version-aware. TaskArtifact recovery
and AttachmentStore garbage collection enumerate both current and historical
Engine versions, so a snapshot or attachment referenced only by an exact old
locator cannot be collected. Missing runtime roots continue into database
reference verification instead of returning early, and raw Core payloads with
zero envelope resources are not parsed as resource envelopes.

### Acceptance

- Provider schemas prove that model `artifact_publish` can carry non-empty,
  nested canonical JSON for OpenAI/Hexin and Gemini.
- Boundary tests cover undefined omission, arbitrary legal JSON keys,
  duplicate-key rejection, and every non-canonical JavaScript value family.
- All Engine Artifact kinds are enumerated in tests and produce searchable
  type/producer metadata without per-kind code.
- Multi-import tests select by source Task lineage, then exact-read the chosen
  target-owned locator.
- Pagination tests mutate and delete frozen members and require an explicit
  incomplete result with frozen totals.
- Database tests reject same-revision current/history overlap, cross-Artifact
  global revision reuse, direct history deletion, and malformed MySQL transfer
  partitions while preserving Task/Artifact cascade deletion.
- Recovery and garbage-collection tests retain resources referenced only by
  historical Artifact versions and reject a missing runtime root that still
  has live database references.
- Deterministic schema/canonical/domain persistence errors are
  `infrastructure_failure` with exact path evidence; real database/runtime
  failures remain `partial`.
- Generated SDK, OpenAPI, portable squad template, built-in squads, authoring
  guidance, and schema snapshots expose only the final ABI.
- A fresh real-database E01 Mission on port 7879 must complete without message
  injection, task fabrication, or manual Artifact handoff before E02-E10 fire.

## 2026-07-27 real E01 smoke corrections

### Recall

- The operator requires every real E01--E10 Mission to run in a temporary
  project directory against the isolated port-7879 database.
- Publishing the original E01 input is the only allowed Mission input.
  Observer-authored follow-up messages or handoff bodies cannot be used to
  steer the run.
- The benchmark acceptance surface is desktop unless an individual input
  explicitly requests another platform. Missing mobile work is a valid
  default; inventing mobile acceptance is a scope-evidence error.
- Repository searches covered Mission intake, `panel.create_task` request
  authoring, the exact-original-input contract, and Mission prompt tests.

The first authoritative E01 Mission was incorrectly launched against the
OpenCorvus source repository. Task startup then treated the repository's
pre-existing dirty tree as baseline material and created a broad checkpoint.
That run was formally aborted and does not count toward E01. All subsequent
E01--E10 Missions use independently initialized temporary Git projects.

A fresh E01 Mission in a temporary project correctly inspected only the
project shape and exact Expert Squad catalog, performed no NVIDIA domain
research in Mission, loaded no guessed Mission Skill, persisted its Mission
contract, and created a real Mission-owned Task. Its authored Task request
nevertheless added mobile and responsive delivery even though the E01 input
did not request either. The Task was formally aborted without an observer
message.

One shared Task-request authoring prompt fragment now requires Mission,
Control, and right-sidebar Chat Task briefs to preserve the operator's delivery
surfaces exactly and forbids adding absent mobile, tablet, responsive,
multi-platform, native, browser, API, deployment, or other delivery/acceptance
surfaces. Prompt regressions cover all three authors without adding a Host
gate, rewriting a dispatched Task, or weakening downstream acceptance.

The next E01 run exposed a separate Architect input-projection defect.
`solution-architect` correctly exact-read the RequirementSet Artifact, but the
model-visible `register_contract` schema still exposed the legacy-named
`evidence_refs: string[]` even though the Task had zero ResearchEvidence refs.
The model copied the RequirementSet Artifact ID into that unrelated namespace,
received six `unknown or stale research evidence ref` errors, and then repaired
the calls by omission. The underlying Artifact was neither missing nor stale;
the schema advertised a field with no legal value and an ambiguous name.

`register_contract` now omits `evidence_refs` entirely when the projected
ResearchEvidence set is empty. When exact ResearchEvidence refs exist, the
field is an enum over only those exact values and explicitly rejects the
interpretation that an Engine Artifact ID, locator, digest, RequirementSet
locator, filename, or free-form label belongs there. The integrity check
remains as defense in depth, while the normal model path no longer learns the
namespace through avoidable errors. The tool input object is strict: a caller
that still submits the hidden field receives an explicit validation error and
the collector remains unchanged, rather than Zod silently stripping the
evidence error into an apparently valid ungrounded contract.

## 2026-07-27 parallel E01--E10 crash and search hierarchy correction

### Recall

- The operator requires all ten authoritative Mission inputs to run in
  parallel against a real isolated database on port 7879, with no fabricated
  Task, injected message, benchmark wrapper, or manual handoff.
- Artifact discovery must expose an explicit hierarchy: current versus
  historical versions, exact stable names, deterministic time/name ordering,
  and opt-in fuzzy search. Fuzzy candidates are never evidence selections.
- Defaults remain legal. Missing, corrupt, wrong-path, false evidence,
  process death, and stuck ownership are failures.
- The old isolated database may be deleted; no compatibility migration or
  fallback is authorized.
- Whole-repository searches covered every `Session.updatePart` producer,
  Bash live metadata call, Tool wrapper, Batch child execution, Artifact
  locator constructor, Goal birth binding, and current/history catalog read.
- Independent review rejected a rowid watermark, `{id, sha}` historical
  locators, locale-dependent ordering, implicit fuzzy fallback, unowned live
  metadata promises, post-truncation-only materialization, pre-hook-only
  materialization, and Batch bypasses.

All ten real Tasks remained marked running after the port-7879 process died.
The exact process terminal evidence was:

`InlineBase64InPartError` for part
`prt_f9ffcb92c001IFLNt3m2PGKZjB`, belonging to E02 Build Goal
`gol_f9ff48f41008dyYhHgVA7CfHeE`. The Build Bash call fetched
`/src/main.tsx`; the returned source text contained an `application/json`
base64 data URL. Bash copied raw cumulative output into live metadata,
`Session.updatePart` correctly rejected the inline bytes, and the unowned
asynchronous metadata rejection reached the global `unhandledRejection`
boundary. The guard was not the defect; the producer and promise-ownership
boundaries were.

The correction keeps the write-boundary veto and establishes:

1. one terminal tool-result canonicalizer that writes each complete inline
   data URL to `AttachmentStore` and replaces every JSON string leaf with the
   content-addressed reference;
2. canonicalization before generic output truncation and again after mutable
   `tool.execute.after` hooks;
3. MIME agreement for structured attachments, alias preservation, cycle
   rejection, and strict JSON serialization;
4. one coalescing, serial, error-owning live-metadata sink per direct or Batch
   child call; Bash live output is recursively redacted and background calls
   close the sink before returning;
5. exact producer-side materialization of tool input while execution retains
   the original argument object, plus recursive failure diagnostic redaction;
6. Engine locators
   `{artifact_id, catalog_revision, expected_sha256}` and Goal birth columns
   that freeze the same triple;
7. `version_scope=current|historical|all`, exact `labels`, explicit
   `query.mode=substring|fuzzy`, and deterministic
   `relevance|newest|oldest|name` ordering;
8. a catalog-revision watermark, immutable Task publication watermark,
   version-complete membership identity, Search ABI-bound cursor, and full
   sort tuple. No locale/ICU comparator participates.

Targeted evidence after this correction includes package typecheck, catalog,
locator, terminal-refill, tool-result materialization, and live-metadata
tests. A fresh database and process are still required before the ten real
Missions can count as restarted acceptance.

### Parallel-start evidence and additional root corrections

The first fresh ten-way launch exposed a Bun module-evaluation race rather
than a Mission-content failure. Ten concurrent project registries evaluated
the same dynamic built-in tool graph; one completed and the other callers
observed temporal-dead-zone bindings such as `WebFetchTool`. A standalone
twenty-way reproduction produced one success and nineteen failures.
Built-in tool discovery now owns one process-wide immutable load promise, and
`Tool.define` returns an invocation wrapper without mutating its shared
definition object. The same reproduction now produces twenty successes.

The second launch crossed tool discovery, then four Missions failed because
independent Browser MCP child processes built into the same temporary
`stdio.js` path and raced to rename it. Source bundles now build in memory,
derive a SHA-256 content identity, write a unique staging file, and atomically
publish one content-addressed `.mjs` cache entry. A ten-process regression
produces ten successes and one unique final bundle.

The first shutdown also revealed that an abort callback re-entered
`Session.tree` after its project context had ended. The callback now captures
the exact project identity and uses `treeInProject`; the next ten-Mission
shutdown settled its owned prompts and exited zero.

Independent review found that the new Engine locator revision was absent from
six runtime projections and that search transports omitted `resolution`.
The correction covers Architect conflict/current projection, Goal mutation,
CompletionDecision, Engine view, Workbench board, Panel plan output, worker
search, and Panel search. Focused Goal mutation, delete, historical binding,
CompletionDecision, catalog, and Panel tests pass with exact revision-bearing
locators.

Artifact discovery additionally exposes:

- exact logical `goal_ids`, plus Goal, Goal-attempt, producer Session, and
  import-source facets;
- exact full stored names with a 2048-character storage bound and a
  separately bounded 512-character transport preview;
- unmatched-filter diagnostics computed from the full candidate set rather
  than truncated display facets;
- `incomplete_catalog` only when provider failure or query-relevant search
  metadata truncation can affect the requested resolution.

The third clean-database launch created one real Task for every E01--E10
Mission. All ten crossed Mission planning and entered durable Task execution
without initialization error. This is execution evidence only, not final
case acceptance.

The same run then exercised Artifact transport rather than a synthetic
contract:

- E01, E03, E04, E07, E08, and E10 enumerated and exact-read typed Engine
  Artifacts by immutable revision-bearing locator;
- E02 exact-read a 105279-byte Artifact across multiple byte pages;
- E06 published a real multi-file Task Artifact snapshot from its project
  repository and began publishing the semantic expert-output envelope;
- every observed search response carried explicit `resolution`, provider
  health, exact candidate count, and catalog-completeness facts.

The run also exposed a semantics/documentation mismatch rather than a missing
index. Several consumers tried `producer_agent_ids` against typed Architect
or Workload facts. Those facts are Host projections and therefore correctly
carry Core ownership; the source Agent turn is payload provenance, not the
catalog producer. Each search returned an honest `no_match` and the consumers
recovered through exact label/kind enumeration. Tool and schema descriptions
now state this boundary explicitly: Core typed facts are selected by label,
kind, type, Goal, and time, while producer filters apply only to entries that
actually carry projected-Agent or Mission producer provenance.

Batch execution now uses the same child boundary as a direct tool call. Each
child owns a distinct persisted part/call identity and invocation authority,
receives its own `tool.execute.before` and `tool.execute.after` hooks, writes
only materialized input/live metadata/result/failure values, and settles its
durable part before the Batch result completes. A real Session-backed
regression verifies the child invocation surface and completed durable part;
the focused Artifact, materialization, Browser MCP, global-tool concurrency,
and Batch suites pass together.

### Exact-version terminal review and final clean launch

Independent review constructed label-only Engine Artifact updates in a real
temporary SQLite database. They proved three remaining exactness defects:

- `Engine.Model.Artifact.locator` duplicated the shared locator schema and
  silently stripped `catalog_revision` from Task Board and Task Conversation
  response contracts;
- Integrity de-duplication treated `{artifact_id, expected_sha256}` as a
  complete identity;
- Goal Workload input equality used the same incomplete pair.

All three now use the complete immutable identity
`{artifact_id, catalog_revision, expected_sha256}`. The public Artifact
response reuses `EngineArtifactLocatorSchema` rather than maintaining another
schema. Label-only same-ID/same-SHA revisions remain distinct in Integrity and
Workload projections. Real SQLite counterexamples pass, generated Task Board
and Task Conversation SDK types retain the revision, and an independent scan
found all 63 generated Engine locator shapes complete.

Two other runtime-discovered protocol mismatches were corrected:

- Artifact `sort=name` and its cursor use the full exact label, not the
  512-character transport preview;
- provider-wide unrelated metadata truncation no longer marks an exact
  filtered result incomplete; only query-relevant truncated candidates affect
  resolution.

Task Artifact repository paths now share the canonical project-relative path
schema, so Unicode and spaces are legal while absolute paths, traversal,
backslashes, Windows device names, colons, and trailing-dot/space segments
remain invalid. A real store regression publishes and exact-reads
`evidence/投资 摘要.pdf`.

The prior ten-way process loaded code from before these corrections. Before
restart its observable progress was E01 1/23, E02 2/7, E03 direct-delivery
review running, E04 0/6, E05 direct-delivery visual review running, E06 2/4,
E07 direct-delivery execution running, E08 1/7, E09 2/4, and E10 1/6. It was
not counted as acceptance. Every Mission was closed through the official
abort route, each Task settled with zero running ownership, and the server
exited normally. One E05 Vite process that had escaped ownership was observed
and terminated separately; this remains runtime evidence to classify if it
recurs in the final launch.

The final launch uses the latest working tree on port 7879, a new temporary
OpenCorvus home and SQLite database, and ten independently initialized
temporary Git projects. E01--E10 were submitted concurrently through
`mission.wake` from their authoritative benchmark sections and common
acceptance principles. No Task was created directly, no prior database or
project was reused, and no observer message or benchmark runner participates.

### Final-launch correction: workflow applicability is part of the contract

The preceding paragraph recorded the first run labelled “final”, but that run
was intentionally aborted and does not count as acceptance. Its resolved
runtime prompt still described Artifact search as substring-only. The shared
PromptProfileResolver protocol now exposes current/history/all scope, exact
labels, substring/fuzzy modes, relevance/newest/oldest/name ordering,
candidate-to-exact-read behavior, and Core-producer semantics. An independent
all-package render inspected all eight repository squads and all one hundred
scheduler/worker prompts: every prompt contained exactly one identical
Artifact protocol block and no stale substring-only text.

The current clean run is
`/private/tmp/opencorvus-artifact-final2.ZopObg`, with a fresh OpenCorvus home,
SQLite database, and E01--E10 Git repositories. All ten Missions created one
real Mission-owned Task and entered execution concurrently on port 7879.

E06 exposed a separate package-contract defect. Its greenfield dashboard
request contained no reference URL, but Mission authored the Task request as
using both General `planned-delivery` and `interface-delivery`. The public
catalog describes `interface-delivery` as generic interface work, while its
first mandatory node is `interface-investigator`; the General scheduler
overlay correctly permits that Agent only for one operator-supplied source
URL. Request Interpreter therefore could not satisfy the selected graph. Its
first coordination attempt also paired a Message ID with the current worker
Session instead of the Message's producing Orchestrator Session, which the
Host correctly rejected. Its exact Engine Artifact retry created a genuine
pending interaction asking for a URL or an exception. The observer did not
reply or inject evidence.

This is not missing operator intent. It is a mismatch between catalog
applicability, immutable graph structure, Mission-authored workflow intent,
and worker preconditions. The correction must:

1. replace the ambiguous General interface graph with separate greenfield and
   supplied-reference contracts, not a runtime branch or fallback;
2. make the greenfield graph carry its own requirements, architecture,
   interface design, workload review, rendered review, and independent
   interface-integrity lineage, while the supplied-reference graph alone
   begins with `interface-investigator`;
3. make Mission treat catalog workflow summaries as applicability information
   and name an inferred workflow only when exactly one complete graph matches
   the authored Task; it must not combine overlapping package graphs or turn a
   missing input of an inapplicable graph into a user question;
4. keep operator- or exact Mission-Skill-selected workflow IDs as ordinary
   visible intent;
5. synchronize General README/manifest, Mission prompt, current architecture,
   public documentation, package tests, resolver catalog expectations, and
   the portable authoring guidance where applicable.

Repository-wide searches before implementation covered
`interface-delivery`, `interface-investigator`, `planned-delivery`,
`virtual_workflows`, `expert_squad_catalog`, workflow recommendation
serialization, final scheduler prompt rendering, General package tests,
virtual-workflow residue tests, current architecture documents, and English
and Chinese public Agent/architecture documentation. No Host workflow state,
keyword classifier, gate, compatibility alias, or automatic completion is
authorized.

The corrected implementation now exposes four non-overlapping General graphs:
planned non-interface delivery, evidence-as-deliverable investigation,
greenfield interface delivery, and supplied-reference interface delivery.
Portable package authoring, the SDK authoring contract, and public SDK docs
state that workflow IDs/labels/descriptions are applicability APIs: each
variant names all mandatory external inputs, conditional variants use separate
graphs, and overlapping labels are not combined. The public SDK Artifact
section was also corrected from its stale substring-only statement to the
implemented version scope, exact facets, substring/fuzzy modes, four ordering
modes, resolution, pagination, and exact-read rule.

A fresh real E06 smoke used
`/private/tmp/opencorvus-artifact-smoke.j7C27F`, a new database, and a new Git
repository. Mission catalog returned General version `2026.07.27.1` and all
four exact workflow descriptions. Mission created one real Task whose authored
request contains the original delivery intent and no workflow ID or combined
workflow language. The Task Orchestrator visibly selected only
`greenfield-interface-delivery`, dispatched `request-interpreter`, obtained
terminal-success intent evidence, and continued through exact Artifact search.
The worker explicitly recorded that there was no operator clarification gap.
No pending interaction and no `interface-investigator` Session existed. This
proves the former E06 reference-URL blocker is removed on the real
Mission-to-Task path; it is smoke evidence, not final E06 product acceptance.

### Final3 red-team correction: discovery must originate in the consumer

#### Recall

- The operator requires every Agent to search and read the complete Task
  Artifact catalog itself. Orchestrator-selected locator arrays are still a
  handoff protocol even when they copy no payload bytes.
- A valid default or empty optional domain field is not an error. Missing or
  corrupt selected evidence, invalid paths, incorrect evidence, and stuck
  execution remain explicit errors.
- Host flow gates, fallback lookup, automatic completion, compatibility
  readers, keyword routing, and retry state machines remain forbidden.
- The authoritative E01--E10 Missions must be restarted after the replacement;
  a run using the retired dispatch ABI cannot count as acceptance.
- Read materials include this plan's prior Recall, the current architecture
  documents, every dispatch adapter schema/executor, Agent prompt projection,
  output-tool validation, Intent collector/persistence, catalog provider
  composition, cross-Task import, SDK/template documentation, and the final3
  database.
- Repository-wide searches covered `artifact_locators`,
  `evidence_locators`, `requirement_set_artifact_locator`,
  `prior_goal_graph_projection_artifact_locator`,
  `knownRequirementIDs`, `knownResearchEvidenceRefs`,
  `intent_summary`, `intent_slots`, `goalSubjectByAttempt`,
  `artifactImports`, `artifact_imports`, `source_locator`, and every related
  test fixture.
- Independent review found two P1 defects: Intent Analysis was not a durable
  Artifact, and every observed downstream dispatch depended on a
  scheduler-selected locator. It also found one P2 provider-isolation defect
  and the exact-revision/documentation/concurrency coverage gaps recorded
  below.

#### Real final3 evidence and disposition

`/private/tmp/opencorvus-artifact-final3.GUNf6j` used a fresh SQLite database,
ten fresh Git projects, and ten concurrent real Missions on port 7879. It
proved exact locator transport and real disk persistence, but it failed the
consumer-origin discovery criterion:

- all ten Missions created exactly one Mission-owned Task and reached real
  specialist stages with zero pending operator interactions;
- the catalog accumulated globally unique, digest-consistent revisions and
  five filesystem snapshots whose producer Session, Message, and completed
  `artifact_snapshot` call joined exactly;
- 36 of 36 downstream dispatch locators were first selected by the
  Orchestrator, and every completed consumer then exact-read those handed-off
  locators;
- all ten Intent turns wrote process-local/Decision Log facts but zero
  searchable Intent Artifacts; Requirements dispatch prose restated the
  missing semantics;
- the run had no historical Engine version and no `expert_output`, so it did
  not prove those real-runtime paths;
- E05 encountered eleven genuine external HTTP 404 results while also
  completing four searches, seventeen successful fetches, and eight evidence
  updates. These are source-path observations, not catalog or scheduler
  failures; final product acceptance must reject any surviving bad citation
  or missing evidence.

The run was closed through all ten official Mission abort routes. Every Task
settled, and the database showed zero active Task, running/pending tool part,
or pending interaction before the isolated server exited normally with
`sessions=0 toolParts=0`.

#### Atomic replacement

1. Intent Analysis publishes one canonical searchable Engine Artifact. The
   Decision Log keeps only lifecycle/locator facts and does not duplicate its
   semantic payload.
2. Dispatch adapter inputs no longer accept scheduler-selected Artifact
   locator arrays or Architect-specific evidence locators. Work identity such
   as Task, Goal scope, exact message subject, explicit operator attachment,
   or explicit source URL remains typed input; durable Task evidence does not.
3. Every projected consumer receives the non-shadowable catalog tools,
   enumerates/searches the Task catalog, and exact-reads its own chosen
   locators. Role prompts name relevant Artifact kinds and selection semantics
   without embedding a candidate inventory.
4. Successful consumer `artifact_read` calls are durable observed facts, not
   automatic semantic sources. After a complete exact read, the consumer calls
   `artifact_select` for every Artifact that semantically supports its typed
   output. Domain persistence stores both `observed_artifact_locators` and
   `source_artifact_locators`, enforces `source ⊆ observed`, and accepts zero
   selections. Missing optional fields remain valid; a typed producer may still
   reject zero or ambiguous selected sources only when that domain contract
   explicitly requires one canonical authority. No latest-item substitution
   occurs.
5. Architect Requirement coverage, prior projection, visual authority, and
   research evidence validation are bound from its own completed reads before
   goal projection persists. Arbitrary string research `evidence_refs` are
   removed from the Architect contract transport.
6. Catalog provider dependencies are isolated. A malformed Engine Goal
   attempt becomes a structured Engine provider error and cannot suppress a
   healthy Task Artifact-only result.
7. Generic immediate publication carries its own publication-specific
   `source_artifact_locators`, validated against complete reads from earlier
   assistant messages under the same physical Turn parent. Multiple outputs in
   one Turn therefore share observed facts without sharing semantic sources.
8. Cross-Task imports use the exact revision in every request, mapping, and
   lineage fixture and preserve the source Artifact's original consumption
   provenance inside `import_lineage.source_provenance`; target-local
   observed/source fields stay target-local. Multica docs expose search, read,
   select, snapshot, and publish tools. Concurrency tests prove unique revisions and transaction rollback without
   orphan revision/history rows.

No partial compatibility ABI will remain. The ten real Missions restart only
after focused contracts, typecheck, generated SDK, and independent review
confirm the old scheduler-selected transport is absent.

### Consumer-origin implementation checkpoint

The replacement is now implemented across the Core adapters and durable fact
writers:

- Requirements, Architect, Workload, Frontend Design, Build, Visual QA,
  Integrity, Fact Check, and delegated-worker dispatch schemas carry no
  same-Task Artifact locator inventory.
- Architect derives the one completely-read RequirementSet and optional prior
  GoalGraph from persisted `artifact_read` facts. Zero RequirementSets produce
  an explicit unprojectable candidate; multiple RequirementSets, corrupt
  locators, or contradictory completed reads remain evidence errors.
- GoalGraphProjection now stores the canonical projected Goal contracts.
  Every EngineGoal row is verified byte-semantically against that Artifact
  when membership is resolved, so EngineGoal is a checked materialization and
  cannot become a second contract authority.
- Frontend Design, ContractGraph, Workload, Fact Check, Visual QA, Integrity,
  and Build Host observations record the exact locators completely read by
  their own producer Session. Reused Build Sessions use a `(time_created,
part_id)` high-water mark so prior-turn reads cannot leak into the new
  observation.
- Integrity preserves Task Artifact snapshot/resource provenance as the full
  `ArtifactReadLocator` union while keeping RequirementSet and ContractGraph
  typed subsets Engine-specific.
- Complete-read auditing validates input/output locator equality, canonical
  digest, stable total length, requested byte windows, contiguous coverage,
  and a terminal chunk. Partial coverage is missing evidence; contradictory
  completed facts are data-integrity errors.
- Engine catalog providers are isolated: a malformed Goal-attempt subject is
  reported under `provider_errors` without hiding healthy filesystem
  snapshots. MVCC tests cover current/history partition exclusivity, global
  revision uniqueness, and transaction rollback of the clock/current/history
  mutation as one unit.
- Search hierarchy is explicit: `version_scope=current|historical|all`, exact
  labels, deterministic substring search, bounded fuzzy candidate discovery,
  and `relevance|newest|oldest|name` ordering. Fuzzy results never select
  evidence; every consumer exact-reads one immutable locator.

The retired scheduler locator renderer and Visual QA locator-only prompt
renderers have been deleted. Generated SDK/payload refresh, final independent
review, and the fresh E01--E10 Mission acceptance run remain outstanding at
this checkpoint.

### Final9 correction: advisory references are not Host admission gates

#### Recall

- The operator explicitly distinguishes valid defaults from errors. Empty or
  imperfect advisory fields do not fail a Task; wrong/missing exact evidence,
  corrupt bytes, invalid paths, and stuck execution remain errors.
- The ten visible `artifact-final9-e01` through `artifact-final9-e10`
  Missions, their Tasks, and
  `/private/tmp/opencorvus-artifact-final9.k6rx4X/home/data/opencorvus.db`
  must remain in place. No database switch, reset, Task deletion, hidden
  observer message, or direct Task injection is authorized.
- Final9 E09 reached a terminal infrastructure failure only after two
  `goal-workload-analyst` Sessions had completely read the exact current
  RequirementSet, ContractGraph, and GoalGraphProjection and successfully
  registered all four workload briefs.
- The first review used `references.design_sections` to carry exact Artifact
  locator/fragment descriptions. The second review narrowed its references,
  but the same post-Turn Host validator still rejected legitimate Requirement
  IDs that were present in the completely read RequirementSet.
- Repository-wide searches covered
  `workloadReferenceIndexFromCompletedArtifactReads`,
  `artifactProvenanceForAgentTurn`, `design_sections`,
  `reference_coverage_ids`, `visual_spec_ids`, `acceptance_spec_ids`,
  `contract_ids`, `register_workload_brief`, every Goal Workload caller and
  persistence path, and tests under
  `test/goal-workload-analyst` and `test/orchestrator`.
- The persisted `goal_workload` Artifact already carries canonical
  `observed_artifact_locators` and `source_artifact_locators`, validated from
  completed `artifact_read` and explicit `artifact_select` calls. The
  additional post-Turn string-membership validator is not provenance.

#### Causal chain

1. The specialist completed the requested read-only analysis and its visible
   final message truthfully named the exact immutable Artifacts it used.
2. `GoalWorkloadAnalystAgent.analyze` then rebuilt a partial allow-list from
   only ContractGraph and Frontend Design payloads.
3. That allow-list does not model RequirementSet IDs, GoalGraph fragments, or
   arbitrary advisory reference strings, yet the Host treated every mismatch
   as fatal after the model Turn had already succeeded.
4. The Orchestrator received an infrastructure exception instead of the
   collected workload facts, retried the same specialist, and finally
   terminated E09 without starting repository investigation.
5. This validator was introduced during consumer-origin Artifact refactoring,
   but it recreates the forbidden handoff/gate pattern: the consumer's exact
   reads are no longer sufficient unless a Host-maintained semantic allow-list
   also understands every domain reference vocabulary.

#### Atomic correction

1. Remove the post-Turn advisory-reference membership gate and its
   `workloadReferenceIndexFromCompletedArtifactReads` helper. Keep Zod shape
   validation, selected Goal membership, exact Artifact read integrity, and
   persisted observed/selected provenance.
2. Keep `references.*` as advisory workload lenses. Unknown, empty, or
   inapplicable string references remain visible facts; they cannot discard a
   completed Agent result. Downstream consumers judge their usefulness from
   the exact source locators.
3. Clarify the Goal Workload prompt/tool description: use canonical IDs only
   when an exactly read Artifact declares them; leave inapplicable arrays empty;
   never encode Artifact locators or JSON fragments in `design_sections`.
4. Add a regression proving that a completed workload Turn with imperfect
   advisory references still returns and persists its facts, while unknown
   Goal IDs and malformed exact Artifact locators continue to fail through
   their existing data-integrity paths.
5. Re-run the focused Goal Workload and Orchestrator persistence tests, then
   typecheck. Preserve the Final9 database. A server restart is considered
   only if the running E09 Mission needs the new code to recover, and then it
   must reuse the same OpenCorvus home/database and keep all visible records.

### Final9 correction: Deep Research must discover unknown URLs

#### Recall

- Final9 E05's `deep-research` Session completed 64 `webfetch` calls but also
  produced 43 fetch errors, including repeated guessed Marriott/Swire paths,
  guessed Trip/RestaurantGuru slugs, bot-blocked Tripadvisor pages, and Google
  search-result URLs passed directly to `webfetch`.
- It made only three `websearch` calls. Successful fetches prove that the
  network and `webfetch` implementation were generally available; this is a
  research strategy defect, not a global network outage.
- The shared Explore and built-in research-report guidance already says to
  search first when the exact URL is unknown and never invent URLs. The Deep
  Research Core says the opposite: prefer `webfetch`, with `websearch` as a
  last resort, and its tool pool currently omits `websearch`.
- A 403, 404, 406, 429, unavailable source, or zero search result is an
  observable source limitation. It is not permission to retry guessed path
  variants, and it is not by itself a Task failure.
- Repository-wide searches covered the Deep Research Core, runtime tool-pool
  assignment, dispatch `source_urls` schema and executor, Research Studio and
  Frontend Innovate package overlays, `webfetch`/`websearch` tool descriptions,
  built-in research-report guidance, and their prompt/tool-pool tests.

#### Atomic correction

1. Preserve exact user/dispatcher-supplied `source_urls` as first-read
   authorities. `webfetch` may also follow exact links discovered inside a
   successfully fetched page.
2. When no exact source URL or discovered link identifies the needed page,
   Deep Research uses `websearch`; it never invents path segments or sends a
   search-engine results URL to `webfetch`.
3. After an exact URL returns an access/path error, record the limitation and
   search for another authoritative source. Do not repeat the same locator or
   synthesize locale/path variants unless a returned page/search result
   supplied that exact URL.
4. Project `websearch` into the Deep Research runtime and align the Core prompt.
   This is an Agent capability/prompt correction, not a Host URL gate, retry
   state machine, or fallback.
5. Add prompt and tool-pool regressions for exact-source-first,
   unknown-source-search, no guessed/search-engine fetch URL, and truthful
   zero-result/access-limitation handling.

### Final9 correction: binary complete reads must satisfy the binary transport contract

#### Recall

- Final9 has exposed repeated `artifact_select` and `artifact_publish` failures
  in E02, E04, E05, and E06. The failure text says completed read facts
  disagree, but every identified locator is a Task Artifact binary image
  resource.
- The persisted facts show one canonical binary read per affected locator:
  `byte_offset=0`, `max_bytes=65536`, `byte_start=0`,
  `byte_end=total_bytes`, `complete=true`, `next_offset=null`,
  `attachment=true`, and the exact locator-owned SHA-256. The resources range
  from 258001 to 736002 bytes.
- `readTaskArtifact` and the shared `readExactArtifact` contract intentionally
  return a non-text Task Artifact resource as one complete attachment,
  irrespective of the text transport page size. `readExactArtifact` already
  requires Task Artifact resource identity, offset zero, a terminal complete
  range, locator-owned byte count, and exact digest.
- `completeArtifactReadLocatorsFromFacts` applies the text-window
  `byte_end - byte_start <= request.max_bytes` rule to every fact, including
  complete binary attachments. Therefore every binary resource larger than
  65536 bytes is falsely classified as contradictory.
- The false contradiction is evaluated over the whole physical Turn. One
  legitimate large screenshot consequently prevents selection or publication
  of unrelated, otherwise valid Artifacts in that Turn.
- Repository-wide searches covered every caller of
  `completeArtifactReadLocatorsFromFacts`,
  `completeArtifactReadLocatorsForSession`,
  `artifactProvenanceForSession`,
  `artifactProvenanceForAgentTurn`,
  `completeArtifactReadsBeforePublication`, and
  `selectedArtifactFactsForSession`; the binary branches in
  `readTaskArtifact` and `readExactArtifact`; Artifact read/select/publish
  tools; plugin assembler tests; persisted-fact tests; and projected worker
  integration tests.
- The visible Final9 Missions, Tasks, database, and running sessions remain
  authoritative. This correction does not authorize a database switch,
  deletion, observer message, direct Task creation, or restart while nine
  Tasks are making progress.

#### Causal chain

1. A worker completely reads an immutable screenshot through the canonical
   one-attachment binary transport.
2. The Host persists the truthful complete range and materializes the
   attachment for the model.
3. The later provenance audit incorrectly applies a text pagination bound to
   that binary range and throws a data-integrity error.
4. `artifact_select` and `artifact_publish` audit all completed reads in the
   Turn, so the false error blocks even locators unrelated to the screenshot.
5. Workers retry valid publication/selection calls, but no retry can repair a
   deterministic contract contradiction inside the Host.

#### Atomic correction

1. Make the pure completed-read audit distinguish the two existing canonical
   transports. Text chunks remain bounded by `max_bytes`; binary attachments
   are valid only for `task_artifact_resource`, at offset zero, with no text,
   one complete terminal range, and `total_bytes` equal to the locator-owned
   resource byte count.
2. Preserve every digest, locator, stable-total, range, contiguity, and
   terminal-chunk check. Do not suppress a genuinely corrupt locator, add a
   retry/fallback, or weaken exact evidence.
3. Add shared-protocol regressions proving a binary attachment larger than the
   requested text page is complete, while oversized text, partial binary,
   nonzero-offset binary, wrong byte count, wrong source, and digest mismatch
   remain hard failures.
4. Audit validity by exact locator. Invalid locators remain excluded and fail
   when explicitly selected, while neither a legitimate large binary read nor
   a genuinely invalid unrelated locator may poison selection/provenance for
   another completely read locator in the same physical Turn.
5. Run focused plugin Artifact protocol tests, OpenCorvus persisted-fact and
   artifact publish/select tests, typecheck, and independent review before
   commit and push. Keep the current Final9 database in place; load the fix
   only through a same-database restart after active Tasks settle or recovery
   becomes necessary.

#### Independent review feedback

- A read-only database audit found 14 completed attachment reads. All 14
  satisfy the canonical binary contract, and 12 exceed their requested
  65536-byte text page size. This confirms a product protocol mismatch rather
  than model-authored evidence corruption.
- The first code review rejected a remaining global failure path:
  input/output locator mismatch still threw before grouping. The revised audit
  groups by the requested exact locator, marks only that locator invalid, and
  lets an independent valid locator complete. Session persistence no longer
  reintroduces the pre-group throw.
- The review also found that a nonterminal text fact could make zero progress
  or end at the declared total. The audit now matches the exact reader:
  every nonterminal chunk advances and ends strictly before the total.
- A final reverse review found that one early `complete=true` text fact could
  coexist with a later valid terminal fact. Every terminal fact now ends
  exactly at the stable total; an early terminal invalidates only its locator.
- The initial fixtures did not exercise the package ToolHost call site. A real
  regression now publishes a 70000-byte PNG through the Task Artifact store,
  reads it through `readExactArtifact`, selects it, publishes a sourced expert
  Artifact, and reads back the persisted observed/source provenance.
- Empty artifact searches remain valid. One model-authored
  `artifact_publish.resources` JSON string was rejected by the existing strict
  schema and corrected on the next attempt; the schema is intentionally not
  weakened.
