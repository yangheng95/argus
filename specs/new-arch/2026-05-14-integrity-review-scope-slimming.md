# Integrity Review Scope Slimming - 2026-05-14

## Problem

Integrity review has accumulated overlapping responsibilities:

- requirement extraction fidelity
- post-build REQ completion evidence
- repository baseline regression evidence
- graph / decomposition / solution-quality review

The worst overlap is trigger semantics. `orchestrator-core.txt` says standalone
integrity is not a wave-level loop, while the build tool result tells the
orchestrator to call `integrity` once after each eligible wave. That makes a
task-end requirements-integrity reviewer behave like routine wave review.

## Decision

Keep Integrity focused on task semantic integrity:

- original request mining into REQ rows
- REQ rows mapped to goals and acceptance specs
- post-build raw REQ status evidence when available
- hallucinated or unsupported task scope

Repository baseline is an evidence source, not a separate review surface.
Integrity may cite existing tests, behavior, design docs, historical plans, and
source contracts when judging pass / issue, but it must not become a full
regression-review replacement for Acceptance.

Standalone integrity is task-end or suspicion-triggered. Build results must not
instruct the orchestrator to call standalone integrity after every build wave.

## Changes

- Collapse the `integrity-core.txt` Repository Baseline section into the
  Evidence Requirement section.
- Remove build-result text that instructs wave-level `integrity` calls.
- Scope `solution_quality` to decomposition / acceptance defects that threaten
  task semantic integrity, not general Architect style review.
- Add prompt-hygiene tests that enforce repository baseline as evidence, not a
  top-level Integrity section, and prevent wave-level integrity instructions
  from reappearing in build tool output.

## Acceptance

- `integrity-core.txt` contains no `## Repository Baseline` section.
- Evidence rules still mention existing tests, public behavior, design docs,
  historical plans, current source contracts, and repository evidence.
- `orchestrator/tools.ts` does not contain `call \`integrity\` ONCE` or
  `wave-level architecture review`.
- `solution_quality` says it is not a second full Architect review.
- Targeted prompt tests pass.
