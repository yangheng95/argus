# Mirror Watch workflow provenance and Prism convergence

## Recall

### User requirements

- Explain why the completed TradingView report Task did not follow the Mirror Watch workflow and produced an unrelated HTML deliverable.
- Treat the Mirror Watch author's confirmation as authoritative: only the second declared workflow, `research-survey-report`, is authentic.
- Delete the first workflow, `financial-product-competitor-research`.
- Remove the third workflow, `mirror-prism-source-observation`, from Mirror Watch and keep its source-observation responsibility only as an internal, self-contained Prism capability.
- Expert Squads must be self-contained and must not reference another Squad's private identity or runtime resources.

### Acceptance criteria

- The Mirror Watch manifest exposes exactly `research-survey-report` and only the agents/resources required by that workflow.
- Mirror Watch selector, README, and orchestrator instructions describe only the authentic report workflow.
- Prism's AInvest workflow retains its source-observation predecessor, but the agent, skill, tool, library, Artifact terminology, prompts, and tests use Prism-owned identities and paths.
- Current package source and generated payload contain no Prism runtime reference to Mirror Watch private identities or paths.
- Positive package tests assert the complete current projections and workflow dependency graphs.
- The generated embedded Expert Squad payload is refreshed from the staged authoring sources.

### Hard constraints

- Directly replace the invalid contracts; do not add aliases, fallbacks, gates, compatibility readers, or a second workflow source.
- Do not rewrite historical records merely because they document the superseded design.
- Do not add, update, or run User Interface automated tests. This is a non-User Interface package-contract repair.
- Do not add negative tests; validate the exact positive current contract instead.
- Preserve unrelated untracked workspace files.

### Evidence read before implementation

- `AGENTS.md`, especially the self-contained Expert Squad and exact binding virtual-workflow rules.
- `specs/current/architecture/04-extensions.md` and `specs/current/architecture/99-principles.md`.
- `specs/records/2026-07/2026-07-14-mirror-watch-latest-protocol-e2e.md`.
- `specs/records/2026-07/2026-07-22-cross-squad-goal-ownership-and-sdk-collaboration-contract.md`.
- `specs/records/2026-07/2026-07-23-mirror-prism-unified-squad.md` and `2026-07-23-mirror-prism-single-squad-cutover.md`.
- Current Mirror Watch and Prism manifests, prompts, skills, tools, libraries, package tests, and generated payload.

### Repository search and provenance result

- `research-survey-report` entered Mirror Watch in commit `d4224baaeb2`; its contemporary selector constrained the package to the full AInvest survey/report protocol.
- `financial-product-competitor-research` first appears in checkpoint commit `489daf1077a`; the associated record describes preservation of pre-existing package work but provides no author protocol or product requirement establishing that workflow.
- `mirror-prism-source-observation` first appears in commit `3c0694794e3` as a cross-Squad Mission stage. Later Prism convergence copied its implementation into Prism, but retained `mirror-watch-*` names and therefore did not finish the ownership cutover.
- Current search finds the invalid workflow IDs in the Mirror Watch manifest, selector, orchestrator prompt, planning prompts, tests, and generated payload. Prism contains package-local copies under `agents/mirror-watch-competitor-researcher`, `lib/mirror-watch`, and corresponding skill/tool names.
- No independent sub-agent was requested or used; this investigation was performed against Git history and current source-of-truth files.

## Root cause

The Task selected a manifest contract that had been expanded beyond the author's actual Mirror Watch protocol. Because virtual workflows are binding scheduler contracts, the orchestrator treated invented competitor/source-observation graphs as legitimate choices. The resulting research scope and HTML report contract could therefore diverge before any agent wrote the deliverable. The third workflow then survived a later Prism convergence as copied implementation with Mirror Watch identity, leaving ownership ambiguous even though the files were physically inside Prism.

This is a source-contract failure, not a rendering failure. Fixing prompts around the final HTML would retain the false scheduler choices and would not address the cause.

## Implementation plan

1. Reduce Mirror Watch to the author's `research-survey-report` graph and delete first/third-workflow-only agents and instructions.
2. Rename the Prism-local source observer and all of its private skill/tool/library/Artifact vocabulary to Prism-owned identities, preserving the existing AInvest dependency order.
3. Replace obsolete tests with exact positive assertions for both complete package projections.
4. Regenerate the embedded payload, run targeted package and documentation checks, inspect the final diff, then commit and push.

## Validation record

- Mirror Watch package and planning tests: passed; the manifest projects exactly the author's six-node `research-survey-report` graph.
- Prism package test: eight tests passed, including exact projection, dependency order, package-owned source-observation publisher, and immutable Artifact reuse.
- Embedded payload generation and freshness checks: passed. The initially combined run's Bun import-build case exceeded its 30-second test timeout under concurrent load; its isolated rerun passed in 13.4 seconds.
- Historical documentation links: passed.
- Document-health checks: 59 relevant checks passed. One combined-run process audit exceeded its five-second test timeout and passed in 0.2 seconds when rerun alone. The monthly-index check is temporarily blocked by an unrelated concurrent workspace record that has been linked but not yet added to Git; this task neither stages nor modifies that record.
- Repository typecheck: all eight scoped packages passed, including OpenCorvus and Overlay cold checks.
- `git diff --cached --check`: passed.

## Second review

- The staged Mirror Watch source and payload contain one workflow ID: `research-survey-report`.
- Prism's source-observation runtime closure uses `prism-source-observer`, `prism/prism-source-observer/source-observation`, `prism/shared/publish-source-observation`, `prism/source-observation`, and `lib/prism/*` identities.
- Current Prism source contains no Mirror Watch private identity or path reference.
- Historical records retain their original claims as provenance; no compatibility alias or alternate workflow remains in current package source.
