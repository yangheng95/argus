# Task Artifact Resource-Set ABI Repair

Status: Implemented; final review in progress
Date: 2026-08-05
Owner: Codex

## Recall

### User request

Investigate the failed Mirror Watch Task `tsk_fd075aa11001hE6URpVsOvN9hF`,
repair the exposed defects, and review the completed implementation. The
failure occurred after 105 validated persona vote files could not cross the
model-facing Task Artifact transport and therefore could not reach the sole
typed `mirror-watch/persona-survey-cohort` publisher.

### Acceptance criteria

1. `artifact_snapshot` atomically publishes every schema-valid inventory up to
   the declared 256-resource limit without returning an oversized expanded-ref
   body.
2. One compact content-addressed resource-set locator is the model-facing
   authority for the complete snapshot tree; no expanded-ref fallback or
   alternate publication path remains.
3. Trusted package tools resolve that locator through `TaskArtifactHost`, verify
   the exact committed manifest, and retain existing per-resource byte, media
   type, path, and Secure Hash Algorithm 256-bit (SHA-256) validation.
4. Generic `artifact_publish` and every touched typed package publisher consume
   the same resource-set transport rather than model-supplied `TaskArtifactRef`
   arrays.
5. Mirror Watch publishes and consumes an exact 105-vote cohort from one
   immutable snapshot, then its deterministic report producer can consume that
   typed Artifact without mutable-path rereads.
6. Positive non-User Interface (UI) tests prove 105-resource Mirror Watch
   publication and the platform's declared 256-resource snapshot capacity.
7. The obsolete test that treats oversized snapshot rejection as success is
   removed rather than updated into another negative assertion.
8. Architecture, package prompts, authoring guidance, generated payloads, and
   repository documentation describe one resource-set protocol.
9. Targeted tests, typecheck, document health, generated-artifact checks,
   independent diff review, commit, and `git-cc` push succeed.

### Hard constraints

- Preserve the shared dirty worktree. Do not reset, stash, restore, delete, or
  include unrelated Overlay, distribution, story, or documentation changes.
- Do not increase the 40,960-byte structured-output boundary as a workaround.
- Do not split one semantic snapshot, accept cross-snapshot cohort resources,
  add compatibility readers, dual resource inputs, fallback, workflow gates,
  or hidden persistence after a failed tool result.
- Keep Task Artifact persistence atomic and content addressed.
- Do not add, modify, or run UI automation tests. Tests in scope assert only
  protocol, persistence, package-tool, and runtime contracts.
- Do not retain negative tests in touched paths.
- Mirror Watch remains one self-contained Version 1 package; release a new
  package revision instead of changing an installed content-addressed revision
  in place.

### Material read

- `AGENTS.md`
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/14-agent-runtime-mode.md`
- `specs/current/architecture/15-agent-facts-and-turns.md`
- `specs/records/2026-07/2026-07-26-unified-task-artifact-catalog-protocol.md`
- `specs/records/2026-07/2026-07-27-projected-worker-task-artifact-publication.md`
- `specs/records/2026-08/2026-08-05-mirror-watch-workflow-provenance-and-prism-convergence.md`
- `packages/plugin/src/artifact-producer.ts`
- `packages/plugin/src/artifact-catalog.ts`
- `packages/plugin/src/task-artifact.ts`
- `packages/opencorvus/src/tool/artifact-catalog.ts`
- `packages/opencorvus/src/task-artifact/store.ts`
- `packages/opencorvus/src/tool/plugin-tool-host.ts`
- Mirror Watch manifest, prompts, Skills, immutable-resource library, typed
  publishers, aggregator, and current package tests.
- The exact runtime database messages, Tool calls, coordination requests,
  coordination responses, Artifact inventory, and project files for the failed
  Task.

### Full-repository grep result

Repository-wide searches covered `artifact_snapshot`, `artifact_publish`,
`resource_refs`, `TaskArtifactRefSchema`, `TaskArtifactHost`,
`engineArtifacts.publish`, `structuredOutputBytes`, `publishResources`, Mirror
Watch typed publishers, Prism source publication, authoring Skills, generated
payloads, and all package prompts. The externally expanded resource transport
is owned by the Core snapshot/publish tools plus four model-facing typed package
publishers. Internal Engine Artifact envelopes and cross-Task copies legitimately
retain verified expanded refs after Host-side resolution.

The exact failed input produces an estimated 51,478-byte snapshot receipt,
10,518 bytes above the 40,960-byte boundary. Repeating the same snapshot
identity in 105 refs accounts for about 26,985 bytes. The schema nevertheless
declares 256 resources as valid. The first Orchestrator recovery response
approved six snapshots without reading the package's same-snapshot validator;
the second response corrected that unsupported claim after the typed publisher
rejected the 105 refs.

### Independent Agent feedback

No independent Agent was requested or launched. Final review remains the main
Agent's explicit second-pass responsibility.

## Root cause

The Task Artifact snapshot identity already content-addresses a canonical
manifest containing every path, media type, byte count, and digest. The
model-facing Application Binary Interface (ABI) redundantly expands that
manifest into full `TaskArtifactRef` values and repeats the snapshot identity in
every element. Output size therefore grows with inventory cardinality even
though the model only needs to hand the immutable set to a publisher. The
pre-publication boundary rejection made this representational defect look like
a supported capacity limit and prevented a valid 105-resource publication.

Mirror Watch correctly requires one snapshot for an atomic cohort, but its
typed tool accepts the expanded refs rather than the set identity. Its existing
package test checks closure and topology only, so the physical producer-to-
consumer ABI was never exercised at the package's authoritative cohort size.

## Design

1. Add a strict `TaskArtifactResourceSetLocator` consisting of one exact
   snapshot identity and tree name.
2. Make `artifact_snapshot` return only that locator and the derived resource
   count after successful atomic publication.
3. Add `TaskArtifactHost.resources(locator)` to verify the committed snapshot
   and derive the exact ordered refs inside the trusted Host boundary.
4. Replace model-facing `artifact_publish.resources` with one nullable
   `resource_set`; `null` is the single explicit representation of no files.
   The Host resolves the set before the unchanged canonical Engine Artifact
   envelope is persisted.
5. Replace resource-ref arguments on Mirror Watch research, expert, and persona
   publishers and Prism source observation with one resource-set locator. Each
   domain publisher resolves, validates, and orders the refs before publishing
   its unchanged typed payload and internal expanded resource membership.
6. Keep internal `EngineArtifactEnvelope.resources` and cross-Task copies as
   verified storage facts. They are not model transport and therefore do not
   duplicate authority.
7. Update prompts and authoring documentation to pass a resource-set locator.
   Regenerate repository-owned payload modules through the existing generator.
8. Replace the oversize-rejection test with positive 256-resource snapshot and
   publication evidence. Add a real projected Mirror Watch package-tool test
   for the complete 105-person authority-backed cohort and downstream typed
   envelope.

## Verification

- Targeted plugin Task Artifact schemas and store tests.
- Projected worker `artifact_snapshot` and `artifact_publish` tests with 256
  resources.
- Real projected Mirror Watch typed publisher test with 105 resources.
- Prism package publisher contract tests affected by the ABI replacement.
- Expert Squad Registry/payload/document-health tests.
- OpenCorvus package typecheck and Application Programming Interface (API)
  route/documentation checks required by hooks.
- Final `git diff --check`, focused code review, clean task-owned diff, commit
  subject prefixed `dsw-33987`, and push to `git-cc/v0.0.31beta`.

## Progress

- [x] Runtime failure and repository root cause reconstructed.
- [x] Single-source resource-set design selected.
- [x] Plugin and Host ABI implemented.
- [x] Package publishers and prompts migrated.
- [x] Positive 105-resource and 256-resource scale tests implemented and passing.
- [x] Generated artifacts and documentation synchronized.
- [ ] Final review, commit, and push completed.
