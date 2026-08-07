# Mirror Watch Goal Cardinality Convergence

Date: 2026-07-22
Status: Implemented and validated
Owner: Codex

## Recall

### User request

The user rejected the 109-Goal Mirror Watch design as categorically incorrect and stated
that a Task should generally not exceed 30 Goals. The repair must model Goals at the
acceptance-delivery level rather than using one Goal per persona row.

### Acceptance criteria

- The complete AInvest workflow has exactly five durable Goals: research, Denis expert,
  Oleg expert, complete persona cohort, and report.
- The single persona-cohort Goal owns every exact authority persona and every unique
  canonical vote path as one cohesive collection deliverable.
- The persona worker still emits exactly one independently grounded JSON vote for every
  authority object; no vote is inferred, skipped, normalized, duplicated, or merged.
- Report aggregation still receives and strictly validates all individual vote paths.
- The graph has four static-data contracts and six contract-backed dependency reasons:
  research to both experts and the cohort, then those three producers to report.
- No sharding scheme, hidden subworkflow, state machine, fallback path, or host-side
  Mirror Watch validator is introduced merely to keep the Goal count below 30.

### Hard constraints

- Preserve the typed coordination-handoff lifecycle repair already committed.
- Preserve the package-owned exact cohort, canonical paths, deterministic aggregation,
  and expert/persona authorship boundaries.
- Goal identity represents an independently schedulable acceptance surface, not one data
  row or one output file.
- Do not restart, refresh, stop, or otherwise interfere with the running OpenCorvus or
  Overlay process.
- Preserve unrelated `.DS_Store` files and concurrent repository work. Commit subjects
  use `dsw-33987` and push the current main delivery branch to `legacy-remote` without bypassing
  hooks.

### Sources read

- `AGENTS.md`
- User correction in the current task
- Runtime evidence and prior diagnosis for `tsk_f85524735001bQQa99RjbisIPM`
- `specs/records/2026-07/2026-07-14-mirror-watch-latest-protocol-e2e.md`
- `specs/records/2026-07/2026-07-22-task-f855-coordination-handoff-and-mirror-watch-planning-repair.md`
- Mirror Watch README, manifest, delivery contract, Requirements, Architect,
  Orchestrator, persona worker, report worker, and aggregate implementation
- `packages/opencorvus/test/expert-squad/mirror-watch-package.test.ts`
- `packages/opencorvus/script/generate-expert-squad-payload.ts`

### Whole-repository search evidence

The current-package search enumerated every live `109`, `108 contracts`, `214`,
`105 separate`, per-persona Goal/session/ownership, `all 107`, unique vote path,
and `architect_goal_min_count` reference. Historical records remain immutable evidence;
the active package, focused tests, and generated payload are the replacement boundary.

| Surface | Disposition |
| --- | --- |
| Requirements overlay | Replace `architect_goal_min_count=109` with five delivery Goals and one cohort collection owner. |
| Architect overlay | Replace 109 Goals / 108 contracts / 214 reasons with 5 / 4 / 6 and one persona-vote-collection contract. |
| Orchestrator overlay | Dispatch two expert Goals plus one cohort Goal after research; report follows their three terminal results. |
| Persona worker | Consume the complete exact cohort and ordered vote-path list, writing one strictly verified vote per persona. |
| Manifest virtual workflow | Describe the persona Agent as the owner of one complete cohort Goal. |
| Package README | Replace per-persona Session/Goal claims with per-vote identity isolation inside one cohort deliverable. |
| Aggregate tool | Preserve unchanged; it already validates every exact individual path and identity. |
| Focused package tests | Pin five Goals, four contracts, six reasons, cohort ownership, and absence of the 109-Goal model. |
| Generated payload | Regenerate from the changed tracked package bytes. |

No sub-agent was used because the user did not request delegation or parallel Agents.

## Causal correction

The previous repair preserved a historical one-persona-per-Goal decision after finding
that a prior five-Goal attempt lacked explicit ownership detail. That conclusion confused
missing cohort acceptance specifications with a need for 105 scheduler nodes. The correct
repair is to make the cohort Goal itself explicit and strict: it owns the exact authority
set and all unique vote paths, while each vote remains independently grounded and
validated as data. Scheduler topology does not need to mirror collection cardinality.

## Implementation plan

1. Rewrite the active Mirror Watch Requirements, Architect, Orchestrator, persona worker,
   README, and manifest around the five-Goal collection model.
2. Replace per-persona graph contracts with one exact persona-vote-collection contract;
   retain individual path/identity validation in the worker and aggregate tool.
3. Update focused positive/negative prompt assertions and regenerate the tracked payload.
4. Run Mirror Watch, payload, Architect, typecheck, docs-health, and diff validation.
5. Perform a second review, commit, and push the current delivery branch.

## Validation plan

- `bun test packages/opencorvus/test/expert-squad/mirror-watch-package.test.ts`
- `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts`
- `bun test packages/opencorvus/test/architect/output-tools.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`
- `git diff --check`

## Implementation and validation evidence

- Active Mirror Watch package topology is exactly 5 Goals, 4 static-data contracts,
  6 contract-backed dependency reasons, and 1 final-report assembly owner.
- The persona-cohort Goal owns the complete authority and ordered vote-path collection;
  the persona worker still writes and rereads one independently grounded JSON vote per
  exact authority object, and the unchanged aggregate tool remains the final strict
  per-path identity validator.
- The tracked Expert Squad payload was regenerated from the updated package sources.
- Focused Mirror Watch package suite: 12 passed, 0 failed, 541 assertions.
- Payload-generation and Architect output suites: 69 passed, 0 failed, 265 assertions.
- OpenCorvus TypeScript typecheck completed successfully.
- Historical links, document health, and product-doc single-source suites: 87 passed,
  0 failed, 1,415 assertions.
- Active-package legacy-topology search found no `109 goals`, `105 separate persona
  goals`, `all 105 persona goals`, `all 107 succeed`, `214 dependency`, or
  `one explicit-persona goal` phrase.
- `git diff --check` completed without whitespace errors before final review.
