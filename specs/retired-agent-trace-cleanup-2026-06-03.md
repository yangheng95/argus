# Retired Agent Trace Cleanup - 2026-06-03

## Evidence

- Current source still used the retired implementation-review identity as a live namespace, artifact label prefix, route label, and documentation term.
- The active responsibility is acceptance review under integrity/build ownership, not an independent implementation-review agent.
- Keeping the old namespace would leave a second conceptual owner for screenshots, verdicts, evidence manifests, and retry feedback.

## Plan

| Surface | Action |
| --- | --- |
| Runtime review modules | Rename the live review namespace from the retired identity to `acceptance`. |
| Tests | Rename test paths and imports to match the single active namespace. |
| Artifact labels and event strings | Rename review evidence labels/events to `acceptance_*` / `acceptance-*`. |
| Product docs and specs | Remove references to retired agent identities; describe acceptance review through integrity/build ownership. |

## Verification

- Static scans must not find retired agent identity strings in source, tests, docs, specs, or web docs.
- Targeted acceptance/integrity/orchestrator tests must pass.
- Package typecheck must pass before commit and push.
