# Prism Algorithm Stability Audit

## Recall

### User request

- Infer the algorithm-design defects in other agents from the proven Mirror Watch aggregation
  instability, with particular attention to Prism.
- Treat model-owned Task completion judgment as out of scope; diagnose and repair algorithm
  stability instead of adding lifecycle gates.
- Make the corrections systematic and evidence-backed rather than changing isolated prompt text.

### Acceptance

1. Prism Watch represents target products and observation questions with stable identities and
   enforces the complete target-product by question matrix before research.
2. Every typed Prism consumer verifies the exact predecessor type, schema, projected producer,
   source lineage, and payload before recording source selection or publishing output.
3. One invalid Prism publication reports every independently detectable cross-Artifact, coverage,
   evidence-gap, and resource violation in deterministic order.
4. Missing research rows and `unresolved_evidence_gaps` have an exact one-to-one relationship;
   evidenced rows cannot be reported as unresolved and missing rows cannot silently disappear.
5. Exact retries of package-owned and generic Agent publications reuse one canonical Artifact
   within the same logical Goal; changed inputs remain distinct.
6. Prism file materializers either reuse byte-identical successful output with matching provenance
   or reject a conflict; an existing file never becomes an unexplained retry failure.
7. The same logical-Goal-scoped retry primitive is applied to model-facing snapshots and
   package-owned Task Artifact publishers in Mirror Watch, Prism, Frontend Innovate, and Frontend
   Replica where identical bytes have one canonical meaning.
8. Tests exercise wrong producers, incomplete product-question coverage, simultaneous violations,
   lineage drift, exact retry, changed input, and materialization conflicts.

### Hard constraints

- Do not modify model Task-completion judgment, Goal completion, scheduler ordering, or introduce a
  Host workflow gate/state machine.
- Do not add fallback readers, legacy Prism schemas, inferred product aliases, partial matrices, or
  silent normalization.
- Preserve the current running OpenCorvus/Overlay process and runtime database.
- Preserve all unrelated worktree changes and use the current main worktree.

### Evidence read

- The completed Mirror Watch stability record and its proven producer/consumer, mutable-input,
  fail-fast, and retry failure chain.
- Every package tool and Artifact read/select/publish call under `expert-squads/**`.
- Prism Watch brief, plan, and competitor-research codecs, publishers, prompts, workflow graph,
  and real projected-package test.
- Prism `materialize-asset` and `prepare-visual-reference`; Frontend Innovate and Frontend Replica
  package-owned Task Artifact publishers.
- Plugin Engine Artifact and Task Artifact Host contracts, Core publication implementations, and
  generic `artifact_publish` tool.

### Full-repository call-point inventory

| Surface | Existing behavior | Required correction |
|---|---|---|
| Prism source-observation brief | URL list has no stable product identity | replace with exact product ID/name/URL targets |
| Prism observation plan | arbitrary product string and partial question coverage | bind product IDs and enforce the full target-question matrix |
| Prism competitor research | late sequential checks; gap list is unbound | validate full lineage and exact missing-row/gap correspondence |
| Prism typed predecessor reader | validates type/version but not producer; selects early | validate projected producer and defer selection until all checks pass |
| Prism source list reader | selects successful inputs before sibling failures are known | complete every read first, then select only after a clean validation result |
| Prism resources | Host discovers unreadable resources sequentially during publish | pre-read every exact ref concurrently and return all violations |
| generic `artifact_publish` | retry publishes duplicate equivalent Engine Artifacts | use semantic idempotency scoped to the stable logical Goal |
| package Engine Artifact publishers | semantic idempotency lacks logical Goal partition | include stable Goal identity when present |
| Prism `materialize-asset` | refetches and `wx` fails on exact retry | persist and verify one input-and-byte provenance record |
| model and package Task Artifact publishers | identical retry creates a new snapshot identity | add logical-Goal-scoped content-addressed atomic snapshot reuse |
| OpenTest runners | run-ID/digest-bound evidence already rejects drift | retain; no duplicate algorithm is added |
| Frontend generated project | verifies exact source and output manifests | retain; opt canonical package snapshots into exact retry |

### Independent-agent feedback

No sub-agent was used: the current execution policy does not authorize delegation for this request.
The inventory and causal review were performed directly against every repository call point.

## Proven design defects

The Prism prompt asks the researcher to map every named product and every question, but the typed
brief contains only `target_urls`, the plan accepts an unrelated free-form `product`, and the
publisher checks only that each question appears somewhere. Therefore a plan can omit most of the
required product-question matrix and still become canonical. The research publisher then validates
only the reduced plan, so downstream Product Requirements work receives a structurally valid but
algorithmically incomplete result.

The same chain verifies Artifact type and schema but not the projected producer that was assigned
to create it. Its helper calls `select` before downstream semantic checks. Plan coverage, terminal
output, research coverage, resource indexing, and unresolved gaps fail at separate sequential
branches. These reproduce the same instability class as Mirror Watch: late validation, one defect
per retry, and side effects before the complete input is known.

Prism also exposes two retry surfaces outside the typed chain. `materialize-asset` exclusively
creates a project file after every network fetch, so a successful first attempt makes an identical
retry fail while a changed remote response has no durable input/output binding.
`prepare-visual-reference` publishes a new Task Artifact snapshot for identical bytes. The latter
is shared with other package-owned materializers and belongs in the Task Artifact Host's atomic
publication primitive, not in per-Agent search-before-publish code.

## Implementation plan

1. Correct Prism source-observation schema version 1 in place with stable target product IDs,
   exact target-question observations, exact terminal owner, and structured unresolved-gap
   identities. Delete the incomplete shape; do not add another version or a compatibility reader.
2. Split exact predecessor reads from selection. Collect type, version, producer, lineage, payload,
   coverage, gap, and resource violations before selecting exact sources and publishing.
3. Make competitor research consume and validate both the exact plan and its exact brief source,
   and publish both locators as direct immutable provenance.
4. Partition semantic Engine Artifact identity by stable Goal ID when one exists, and make generic
   `artifact_publish` use the same atomic exact-input retry primitive without exposing route choices
   to the model.
5. Add opt-in Task Artifact idempotency based on Task, stable producer, inventory paths/media, and
   exact bytes; perform lookup/reuse under the existing publication lock.
6. Opt canonical package materializers into Task Artifact idempotency and make Prism asset
   materialization verify a durable input-and-byte provenance record on retry.
7. Update Prism prompts, README, SDK authoring guidance, generated payload, tests, and spec indexes;
   run focused chains, full typecheck, API/docs checks, and hook-safe legacy remote delivery.

## Implementation outcome

- Prism Watch keeps schema version 1 and corrects it in place: stable targets replace URL-only
  inputs; plans cover the exact target-question Cartesian product, preserve page scope/evidence
  requirements/limitations, and research gaps bind one-to-one to missing rows. The incomplete
  shape is not retained as a compatibility path.
- Typed Prism and Mirror Watch publishers complete all predecessor/resource reads and domain
  validation before selection, verify assigned projected producers, and publish exact lineage.
- Generic and package Engine Artifacts reuse exact semantics atomically within the stable logical
  Goal. Generic and package Task Artifact snapshots use the same logical-Goal partition with a
  content-derived identity under the existing Task publication lock.
- Prism asset materialization now atomically renames one `A###` directory containing the asset and
  its complete provenance. Exact retry verifies and returns the stored record without a second
  network request; changed provenance or bytes is rejected.
- Package-owned materializers in Prism, Mirror Watch, Frontend Innovate, and Frontend Replica opt
  into the canonical Task Artifact retry primitive. OpenTest retains its existing run-ID and
  execution-input digest contract because the audit found no equivalent duplicate-publication
  algorithm to replace.
