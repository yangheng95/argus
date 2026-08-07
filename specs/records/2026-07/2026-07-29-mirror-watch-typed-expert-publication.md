# Mirror Watch typed expert publication and aggregation boundary

## Recall

### User request

Deeply determine whether the repeated `mirror-watch/shared/aggregate-report` failures came from the aggregation algorithm or OpenCorvus infrastructure, then implement a targeted systemic repair.

### Acceptance

1. Preserve strict, fail-loud expert semantics without accepting ambiguous Markdown variants or adding a fallback parser.
2. Reject an invalid expert answer while it is still owned by `mirror-watch-expert-surveyor`; the report worker must never be the first domain validator.
3. Publish `mirror-watch/expert-survey` through one package-owned typed producer rather than generic model-authored `artifact_publish`.
4. Make `aggregate-report` consume the two exact selected typed expert Artifacts and remove `expert_vote_paths` from its public input.
5. Keep persona scoring, deterministic 3-2-1 aggregation, report rendering, exact source selection, and the single aggregate-report call unchanged.
6. Produce one complete diagnostic for all missing, duplicated, or misordered expert analysis headings, with the canonical expert file path in the error.
7. Regenerate the bundled Expert Squad payload and pass package, payload, typecheck, and documentation-health verification.

### Hard constraints

- No fallback, compatibility parser, heading normalization, host gate, workflow state machine, hidden message, or second aggregation source.
- The fix belongs to the Mirror Watch package unless current evidence proves a reusable Host defect.
- Do not restart, refresh, terminate, or otherwise touch a running OpenCorvus/Overlay process.
- Preserve all unrelated concurrent changes. The OpenCorvus worktree was clean at investigation start on `v0.0.24beta`, `905e3e05ee2fe80b1dd1ed13aedea7c52304ee81`.
- The observed demo repository is evidence only. Its modified `.opencorvus/opencorvus.jsonc` and untracked `dashboard/` remain untouched.
- Playwright, if later required, runs through Node rather than Bun.

### Read records and source evidence

- `specs/records/2026-07/2026-07-14-mirror-watch-latest-protocol-e2e.md`
- `specs/records/2026-07/2026-07-28-package-tool-artifact-publication-repair.md`
- `packages/opencorvus/src/skill/builtin/expert-squad-authoring/SKILL.md`
- Current Task `tsk_fa967691a001blOLSh3ofJBz4L` from the immutable main database
- `expert-squads/tanzeqi/mirror-watch/**`
- `packages/opencorvus/test/expert-squad/mirror-watch-package.test.ts`

The older repair deliberately kept the strict aggregate parser and added prompt literals. The current real Task disproves prompt-only closure: both expert workers published `mirror-watch/expert-survey` Artifacts, yet the report consumer rejected their Markdown contract. The first report worker then called the final aggregation tool five times, including nonexistent and duplicate path probes; a second report worker failed once on the other expert; only a third report worker succeeded.

### Full call-point inventory

| Call point                                                                         | Current responsibility                                                                         | Decision                                                                                                                                                                         |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expert-squads/tanzeqi/mirror-watch/agents/mirror-watch-expert-surveyor/system.md` | Writes Markdown/HTML/data.js, then uses generic snapshot/publish tools                         | Replace generic publication with the typed expert publisher; invalid owned files are repaired before one successful publication.                                                 |
| `expert-squads/tanzeqi/mirror-watch/skills/delivery-contract/SKILL.md`             | Declares the Markdown vote and report tool arguments                                           | Declare typed expert Artifact payload as the inter-Agent contract; delete `expert_vote_paths` from aggregation input.                                                            |
| `expert-squads/tanzeqi/mirror-watch/lib/mirror-watch/aggregate-report.ts`          | Parses expert Markdown and aggregates all inputs                                               | Extract the expert validator into one shared domain module; accept already parsed expert votes only.                                                                             |
| `expert-squads/tanzeqi/mirror-watch/tools/aggregate-report.ts`                     | Reads source Artifacts, rereads expert paths, aggregates and publishes                         | Parse exactly two selected schema-v2 expert Artifact payloads and pass their typed votes to the engine.                                                                          |
| `expert-squads/tanzeqi/mirror-watch/tools/publish-expert-survey.ts`                | Missing                                                                                        | Add the sole typed publisher: validate exact immutable snapshot resources and publish the schema-v2 expert Artifact.                                                             |
| `expert-squads/tanzeqi/mirror-watch/expert-squad.jsonc`                            | Projects aggregate-report only to report analyst; expert uses generic tools                    | Project the typed publisher only to `mirror-watch-expert-surveyor`; bump package revision.                                                                                       |
| `expert-squads/tanzeqi/mirror-watch/agents/mirror-watch-report-analyst/system.md`  | Derives two Markdown paths and invokes aggregate once                                          | Consume exact typed expert Artifacts and invoke aggregate once without expert paths.                                                                                             |
| `expert-squads/tanzeqi/mirror-watch/agents/orchestrator/system.md`                 | Requires exact source Artifacts and one aggregate call                                         | Preserve; clarify that typed expert publication is terminal-success evidence.                                                                                                    |
| `expert-squads/tanzeqi/mirror-watch/README.md`                                     | Describes the package protocol                                                                 | Update the typed producer/consumer boundary and four-field aggregate call.                                                                                                       |
| `packages/opencorvus/test/expert-squad/mirror-watch-package.test.ts`               | Package projection, tool bundle, runtime publication, parser and deterministic report coverage | Add typed publisher projection/runtime tests, invalid-publication/no-artifact tests, selected Artifact consumption, removed path-field assertions, and full heading diagnostics. |
| `packages/opencorvus/generated/expert-squad-payload.ts`                            | Bundled generated package payload                                                              | Regenerate from the tracked canonical package source; never hand-edit.                                                                                                           |
| `specs/README.md`, `specs/records/2026-07/README.md`                               | Spec indexes                                                                                   | Add this record and run documentation-health checks.                                                                                                                             |

Search also found old Python source/report templates and historical records. They are parity evidence, not runtime call points, and remain unchanged.

### Root-cause classification

The 3-2-1 scoring and report-rendering algorithms did not fail. Core Artifact infrastructure also retained every tool error, source locator, and publication correctly. The primary defect is the package protocol boundary:

1. A model-generated Markdown string was treated as the cross-Agent data contract.
2. Generic `artifact_publish` allowed the producer to publish a domain Artifact without running the consumer's validator.
3. The final aggregation tool therefore became both late validator and renderer.
4. Prompt-only exact-heading rules did not establish executable producer/consumer parity.

Infrastructure amplified the defect only by offering a generic publisher where this package needed a typed domain publisher. The existing package-tool Host API already provides the correct single-source publication mechanism, so no global Host modification is justified.

No independent agent feedback was requested or used; the current collaboration policy does not authorize spawning sub-agents for this task.

## Implementation

1. Extract the strict expert vote parser and schema-v2 Artifact payload parser into `lib/mirror-watch/expert-survey.ts`.
2. Add `tools/publish-expert-survey.ts` as the only successful publisher of expert survey facts and resources.
3. Remove expert Markdown path parsing from the aggregation engine and public report-tool schema.
4. Make the report tool require exactly two selected typed expert Artifact envelopes and validate their producer, schema, identities, and uniqueness.
5. Update prompts, Skill, README, manifest projection/version, focused tests, and generated payload.

## Verification

- `bun test packages/opencorvus/test/expert-squad/mirror-watch-package.test.ts`
- `bun run packages/opencorvus/script/generate-expert-squad-payload.ts`
- `bun run typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- Relevant document-health and generated-artifact tests discovered from repository scripts
- Final diff review and a second focused package test run
