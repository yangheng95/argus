# Frontend Replica Default Fidelity And End-to-End Acceptance

Date: 2026-08-07

Status: implemented; isolated model-backed end-to-end acceptance passed.

## Recall

### User request

- Set the webpage-replica expert squad's default similarity requirement to 80%.
- Then run end-to-end testing.

### Acceptance criteria

1. Frontend Replica owns one package-local default requiring at least 80% visual fidelity when the current operator does not provide another threshold.
2. An explicit operator threshold remains authoritative for that Task; the default does not overwrite it.
3. The 80% result is evaluated from current rendered source-to-target evidence across the accepted desktop surface, not inferred from source prose, implementation claims, or one opaque score.
4. Missing source regions, incorrect information architecture, broken required interactions, placeholder content, or unavailable rendered evidence remain blockers even if an aggregate comparison reaches 80%.
5. The package projects the same acceptance contract to the Orchestrator and every worker that defines, implements, or reviews fidelity. No global core prompt, duplicate hard-coded threshold, compatibility path, Host gate, or second runtime evaluator is introduced.
6. Package discovery, manifest validation, runtime projection, generated payload parity, and a real model-backed Frontend Replica Task are verified end to end.
7. Real desktop Browser evidence and fresh screenshots are personally inspected. No User Interface automated test is added, modified, or run.
8. Focused non-User-Interface checks, documentation health, diff review, a `dsw-33987` commit, and a push to legacy remote complete delivery.

### Hard constraints

- `prompt_profile.active` remains the only active expert-squad identity and `PromptProfileResolver` remains the only package projection authority.
- The runtime Structural Similarity Index Measure comparator remains operator/benchmark evidence and does not become the final workflow verdict or a Host-side gate.
- The default is desktop-only. Tablet, mobile, and multi-end migration remain out of scope unless explicitly requested.
- Source completeness, module order, layout density, interaction semantics, and rendered proof cannot be traded away to reach a numeric aggregate.
- The existing live backend on port 7878 and Overlay on port 5175 are not stopped or replaced. Any source-package end-to-end run uses an isolated explicit `OPENCORVUS_HOME`, project, and port.
- Preserve unrelated worktree changes, do not reset, and do not bypass Git hooks.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/02-data.md`
- `specs/records/2026-07/2026-07-01-frontend-replica-requirements-webpage-generation.md`
- `specs/records/2026-07/2026-07-05-frontend-replica-goal-bound-reference-crops.md`
- `specs/records/2026-07/2026-07-17-frontend-replica-package-protocol-e2e.md`
- `expert-squads/builtin/frontend-replica/expert-squad.jsonc`
- `expert-squads/builtin/frontend-replica/README.md`
- `expert-squads/builtin/frontend-replica/selector.md`
- Frontend Replica Orchestrator, Requirements, Architect, Interface Modeler, Implementer, Visual Reviewer, and Integrity Reviewer prompts
- `packages/opencorvus/src/runtime/visual-page.ts`
- Expert-squad manifest schema, Registry, payload generator, and package-skill projection call sites
- Browser control skill for real desktop interaction and screenshot inspection

### Whole-repository search result

- No current Frontend Replica package prompt defines a default numeric fidelity threshold.
- `packages/opencorvus/src/runtime/visual-page.ts` accepts explicit Structural Similarity Index Measure thresholds for operator and benchmark evidence, but its own contract states that model vision and concrete findings own workflow judgment.
- `packages/opencorvus/script/benchmark/assets/tradingview-world-economy-95-request.md` declares a benchmark-specific 95% requirement. It is not a general default and must remain unchanged.
- Frontend Replica is a strict clear-text project package under `expert-squads/builtin/frontend-replica`; generated payload content is derived from tracked package files.
- Package Skills are the existing single-source mechanism for sharing one contract across the scheduler and selected workers.
- The live machine currently has an existing backend listener on 7878 and Overlay development page on 5175; isolated runtime ownership is required for a separate source-package end-to-end run.
- The historical documentation test paths named by older records no longer exist on this branch. `bun run docs:check` is the current authoritative documentation validation command; the missing old tests will not be recreated.

### Independent agent feedback

None requested. No sub-agent is used.

## Diagnosis

Changing the generic visual comparator would not satisfy the user request. It would silently affect unrelated operator and benchmark workflows while leaving Frontend Replica's Requirements and reviewers unaware of the default. Repeating `80%` independently across role prompts would create threshold drift.

The package-local single source is a shared Frontend Replica acceptance Skill projected through the manifest. It defines the default, explicit override rule, evidence dimensions, and non-compensable blockers once. The scheduler and fidelity-owning workers consume the same Skill through `PromptProfileResolver`.

## Implementation plan

1. Add one package-owned shared acceptance Skill with the default 80% rendered visual-fidelity floor, explicit-operator override semantics, dimension evidence, and non-compensable blockers.
2. Project that Skill to the Frontend Replica scheduler and the intent, requirements, architecture, interface-modeling, implementation, visual-review, and integrity-review workers; bump the package revision and regenerate the tracked payload.
3. Add focused positive package-contract coverage that validates the manifest, exact Skill projection, and composed content for every fidelity-owning participant.
4. Run focused contract tests, payload generation parity, typecheck, API/document checks, and Git whitespace/staged checks.
5. Run a real isolated Frontend Replica Task through the current source runtime, inspect streamed sessions and Task Artifacts, open the produced desktop page in the real Browser, capture fresh Task-scoped screenshots, and manually compare the source and target evidence.
6. Perform a second code/diff/evidence review, update this record with exact commands and identities, commit with the required prefix, and push to legacy remote.

## Planned validation

```text
bun test packages/opencorvus/test/expert-squad/frontend-replica-package.test.ts
bun packages/opencorvus/script/generate-expert-squad-payload.ts
bun run --cwd packages/opencorvus typecheck
bun run api:routes-check
bun run docs:check
git diff --check
git diff --cached --check
```

## Implementation

- Added `frontend-replica/shared/acceptance` as the package-owned single source for the default rendered-fidelity contract.
- The default requires at least 80% overall fidelity only when the operator gives no numeric threshold; an explicit operator threshold remains authoritative.
- Missing source regions, incorrect information architecture, reordered modules, broken required interactions, placeholders, blank filler, and unavailable current comparison evidence remain non-compensable blockers.
- Projected the shared Skill to the scheduler and all ten package agents through the manifest, then regenerated the tracked built-in payload.
- Bumped the Frontend Replica package revision to `2026.08.07.1`.
- Added positive non-User-Interface package-contract coverage for manifest validation, exact Skill projection, and composed acceptance content.

## End-to-end acceptance

The isolated run used a deterministic local `Northstar Operations` desktop reference at `http://127.0.0.1:49180/` and an isolated target Git repository under `.scratch/frontend-replica-80-e2e/project`. This fixture verifies package defaulting and the complete real workflow; it is not presented as an external production-site benchmark.

- Isolated backend: `http://127.0.0.1:47891`, with an explicit scratch `OPENCORVUS_HOME`; the existing listeners on 7878 and 5175 were not touched.
- Task: `tsk_fdb65292b001VALxrtspB6qm9g`.
- Root Session: `ses_0249ad54cffelPy7YnhokEBjMK`.
- Orchestrator Session: `ses_0249ac824ffefQGjmWpQAU2sXR`.
- Prompt profile: `frontend-replica@2026.08.07.1`.
- The request intentionally omitted a numeric similarity threshold. The Orchestrator loaded `frontend-replica-acceptance` and applied the 80% default.
- All declared workflow nodes ran in dependency order. Visual and Integrity review ran in parallel only after implementation.
- The first reviews rejected incomplete region bindings and stale immutable-byte provenance. The same implementation lineage repaired the region hooks, then repaired the snapshot/preview byte binding; both review lineages were continued after each repair.
- Final immutable implementation resource: snapshot `8ba9b9e1-c4f0-5791-aec8-4db92ec3c776`, 7,830 bytes, with the exact hook-bearing `index.html` served by the accepted preview.
- Final true-size 1280 by 800 comparisons passed: header `0.998`, summary and metrics `1.000`, workspace `0.985`, and footer `0.959` Structural Similarity Index Measure scores. Every region is above the 0.80 default.
- Final Integrity verdict: `pass` (`art_fdba4e18d001JRqV15wfNeNvoD`).
- Final Visual Review verdict: `accepted` (`art_fdba639ca001Q9eyogNTv3QqSs`).
- The Task reached terminal inactive status with all Explorer, Research, Analysis, Architecture, Interface, Implementation, Visual Review, and Integrity occurrences completed.

## Manual desktop review

The source and generated target were opened in the real in-app Browser at an explicit 1280 by 800 viewport. The screenshots were personally inspected. Header, greeting, four metric cards, service chart, activity list, footer, module order, desktop density, and source content matched. `New report` was visible, enabled, keyboard-focusable, and clickable; the click left the dashboard unchanged, matching the source evidence. The target Browser console contained no warning or error entries.

No User Interface automated test, fixture, screenshot baseline, or pixel assertion file was added or run. Browser interactions and screenshots were ephemeral acceptance evidence attached to the Task.
