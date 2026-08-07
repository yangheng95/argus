# Expert Squad SDK stability refactor

## Recall

### User requirements

- Deeply trace why Mirror Watch `aggregate-report` repeatedly failed, distinguishing algorithm defects from infrastructure defects.
- Fix the shared mechanism rather than treating model completion judgment as the problem.
- Reverse-audit sibling Agent algorithms, especially Prism, and determine whether the Squad SDK needs repair.
- Keep the existing Expert Squad manifest protocol on schema v1. Do not invent schema v2, compatibility aliases, fallback paths, workflow gates, or a second source of truth.
- Resolve the full exposed problem surface and obtain independent Agent review.

### Acceptance

1. The SDK validates the portable manifest v1 data shape and generic graph integrity, but does not prescribe Requirements, Architect, Goal, or Integrity topology.
2. Malformed untyped authoring input produces deterministic exhaustive diagnostics instead of an incidental `TypeError` or only the first error.
3. Package materialization validates completely before mutation and publishes a fully written directory with one same-parent rename; a failed write never exposes the final directory.
4. Package Engine and Task Artifact publishers are always idempotent by Host contract; package code cannot opt out or choose `false`.
5. Typed consumers completely read and validate every exact predecessor before any source-selection or publication side effect.
6. Prism and Mirror Watch share the generic exact-read/envelope/selection primitive while retaining their own domain codecs and lineage rules.
7. Existing manifest `schema_version: 1` is the only supported manifest version. No v2, fallback, migration, alias, or dual parser exists.
8. SDK package paths and Plugin project paths consume one canonical cross-platform path contract, including Windows device names, trailing dot/space, and Unicode NFC rejection.
9. Targeted non-UI tests, typecheck, package generation checks, document-health checks, independent review, commit, and `legacy-remote` push complete.

### Hard constraints

- Preserve all concurrent worktree changes. Do not reset, stash, restore, broadly stage, or create another worktree.
- Do not modify or run UI automation tests. This change has no UI delivery surface.
- Do not add a Host workflow gate or workflow state machine. Natural orchestration remains prompt/package-owned.
- Do not change Task/Goal completion judgment or lifecycle projection; the incident evidence does not establish those as root causes.
- Specs remain under `specs/`; this record and the current architecture are the documentation sources.

### Material reviewed

- `specs/records/2026-07/2026-07-29-prism-algorithm-stability-audit.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/99-principles.md`
- SDK authoring, Registry, ToolHost, Plugin Artifact ABI, Task Artifact ABI, Prism Watch, Mirror Watch, portable-template, built-in authoring Skill, and their non-UI tests.

### Full-repository call-point inventory

| Surface | Call points and disposition |
| --- | --- |
| SDK manifest topology | `validateExpertSquadManifestDispatchTopology` is called by package validation, collaboration validation, source-capability validation, Registry, generators, and tests. Keep the exported name for callers but replace its semantics with v1 shape plus graph integrity; delete the workflow-role policy helper. |
| Manifest v1 shape | Registry currently owns `ManifestSchema`; SDK aliases an OpenAPI-generated response type and therefore has no runtime parser. Move the portable v1 schema to the SDK and make Registry consume it, while Registry continues to own filesystem closure and installed-package checks. |
| Authoring input | `expert-squad-author` parses JSON and casts to the typed definition. Route untyped input through the SDK v1/package parser before nested dereference. |
| Package writer | Conversation authoring, Multica import, portable-template generation, and direct SDK callers use `writeExpertSquadPackage`. Replace sequential final-directory writes with same-parent staging and rename publication. |
| Engine publication | Eight Prism/Mirror package publishers call `engineArtifacts.publish` with `idempotent: true`. Remove this caller choice and inject `true` in `plugin-tool-host`; retain Core's broader Engine publication input for non-package callers. |
| Task publication | Four package materializers call `taskArtifacts.publish` with `idempotent: true`. Remove the option from the package Host ABI and inject `true` in `plugin-tool-host`; retain the internal Store execution contract. |
| Exact Artifact consumption | `readExactArtifact` is the correct byte/digest primitive. Prism source observation, Mirror delivery/resource handling, and `aggregate-report` duplicate envelope and sequencing logic. Add shared settled-read, envelope-inspection, and post-validation selection helpers in Plugin. |
| Aggregate report | `aggregate-report` currently selects each locator immediately after its read, before the complete envelope/domain batch has passed. Move all selection after exhaustive validation; publication remains after selection. |
| Cross-platform paths | SDK package authoring has a partial private path check while Plugin has the mature ProjectRelativePath contract. Move that contract to the lower SDK package, make Plugin re-export it, add Unicode NFC canonicality, and use it before package writes. |
| Documentation and generated payload | Current architecture, SDK docs in both languages, authoring Skill source/payload, portable-template source/payload, package sources, and package tests encode the old gate or caller-selected idempotency. Regenerate owned payloads and update only non-UI contract tests. |

### Independent Agent feedback

- SDK gate audit: the dispatch adapter ABI contains no universal Requirements/Architect/Integrity topology. The SDK gate contradicts the architecture statement that the platform does not force every Squad through one planning graph.
- SDK writer audit: raw values can reach nested SDK dereferences and produce incidental `TypeError`; validation is fail-fast; final-directory sequential writes are observable and crash-unsafe. It recommended one portable runtime v1 schema in the SDK and a staging-directory publication boundary.
- SDK writer audit also found that package paths omitted Windows reserved names, trailing dot/space, and Unicode normalization while Plugin already had most of the canonical rule. The final implementation moves that primitive to SDK and makes Plugin reuse it rather than copying checks.
- Artifact primitive audit: keep `readExactArtifact` as the base, add only generic settled read/envelope/select primitives, and leave product/question/resource/producer-domain rules in each package. It found the `aggregate-report` pre-validation selection exception.
- Main-agent resolution: adopt the shared v1 schema as the sole portable manifest shape source. Registry imports it and retains environment closure ownership. This avoids both the current compile-time-only SDK and a duplicate Registry/SDK parser.

### Grep evidence

The repository-wide search covered:

- `validateExpertSquadManifestDispatchTopology`, `assertWorkflowDispatchContracts`, manifest schemas, JSONC parsing, and all package-definition writers;
- `engineArtifacts.publish`, `taskArtifacts.publish`, `idempotent: true`, `readExactArtifact`, Artifact selection, and all Prism/Mirror typed publishers;
- architecture, authoring Skill, portable-template, SDK docs, Registry tests, SDK tests, package tests, and generated payloads.

No second manifest version or existing equivalent exhaustive validation error class was found. No Task/Goal completion code path participates in the reproduced aggregate sequencing defect.

## Causal analysis

The incident is a compound stability defect across three responsibility boundaries:

1. **Policy was mistaken for data integrity.** The SDK encoded one historical planning topology as universal validity. A structurally valid Squad could therefore be rejected or coerced toward irrelevant adapters. This is an algorithm/protocol defect, not an LLM completion defect.
2. **Validation had no transaction boundary.** Untyped data was asserted as a generated TypeScript type, validators stopped at the first error, and the writer created the final directory before all bytes existed. Retry behavior therefore depended on timing and the first observed failure.
3. **Artifact consumption had no semantic commit point.** Exact byte reads were sound, but consumers reimplemented envelope checks and one aggregate path selected inputs during read. A later invalid predecessor could leave partial selection observations even though no valid aggregate existed.

Infrastructure contributed only the mechanisms that made these bugs observable: concurrent package Tools, persistent Artifact facts, and filesystem visibility. Those mechanisms are not the root cause and do not need a new gate. The repair is to give data validation, filesystem publication, and semantic selection explicit atomic boundaries.

## Implementation

### 1. Manifest v1 and diagnostics

- Define and export the existing manifest v1 runtime schemas from the public SDK.
- Parse unknown values with `safeParse`, normalize Zod issues into stable path-sorted diagnostics, and combine them with graph/package diagnostics.
- Keep only canonical identifier, nonblank metadata, known projected-agent/dependency, uniqueness, canonical dependency order, and acyclic-graph invariants.
- Delete Requirements/Architect/Goal/Integrity role-topology enforcement and update all callers/tests/docs.
- Make Registry reuse the SDK v1 schema and continue owning package filesystem closure, package resource references, installation identity, and environment-specific checks.

### 2. Atomic package publication

- Render and validate the complete file inventory in memory.
- Create a staging directory under the final directory's parent, write every file there, then rename staging to the final path.
- Never overwrite an existing final package and never clean a directory that this invocation did not create.
- On failure, remove only staging and preserve both primary and cleanup failures with `AggregateError`.

### 3. Package publication ABI

- Expose package Engine and Task publish requests without an `idempotent` field.
- Inject `idempotent: true` at the package ToolHost boundary before calling Core publishers.
- Remove repeated literals and update generated package payloads.

### 4. Artifact semantic transaction

- Add ordered settled exact reads that report all input failures.
- Add generic Engine envelope inspection for locator, JSON envelope, artifact type, schema version, and producer ownership.
- Add one selection helper that accepts only successfully completed exact reads.
- Migrate Prism/Mirror duplicate generic logic while leaving domain codecs local.
- In `aggregate-report`, perform all exact-read, envelope, payload, producer, lineage, and product-question checks before one selection batch; publish only afterward.

### 5. Verification and review

- Add non-UI regression tests for valid noncanonical workflow shapes, exhaustive malformed-input diagnostics, atomic writer failure/concurrency, Host-forced idempotency, settled Artifact failures, and zero selection/publication on aggregate validation failure.
- Reject noncanonical cross-platform package paths through the SDK-owned ProjectRelativePath primitive and keep the Plugin export as the same runtime object.
- Run targeted SDK, Plugin, Registry, ToolHost, Prism, and Mirror Watch tests; typecheck affected packages; regenerate owned payloads; run SDK/OpenAPI/docs health checks.
- Re-read the diff and compare it against all three independent reviews before commit.

## Codex review

The first draft risked leaving Registry as the runtime shape owner and adding a second SDK parser. Independent review correctly identified that as dual-source protocol ownership. The revised design transfers the portable existing v1 schema to the SDK and makes Registry consume it; Registry still owns only environment closure. The review also caught `aggregate-report` selecting before batch validation, contradicting the earlier broad claim that every typed publisher already delayed selection. Both corrections are mandatory implementation items.
